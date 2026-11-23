import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.PRODE_DB = ':memory:';
process.env.PRODE_NO_LISTEN = '1';
process.env.PRODE_ADMIN_EMAIL = 'jefe@prode.com';
process.env.PRODE_ADMIN_PASSWORD = 'jefe12345';

const { outcome, predictionPoints, settleBets } = await import('../server/scoring.js');
const { mapEvent, mapStatus } = await import('../server/providers/thesportsdb.js');
const { ageOn, validateAccount, validPassword } = await import('../server/validate.js');
const { computeTable } = await import('../server/standings.js');
const { vapidAuth, queueReminders, pull } = await import('../server/push.js');
const { server } = await import('../server/server.js');
const { db } = await import('../server/db.js');

test('puntos del PRODE', () => {
  assert.equal(predictionPoints({ home: 2, away: 1 }, { home: 2, away: 1 }), 3);
  assert.equal(predictionPoints({ home: 1, away: 0 }, { home: 3, away: 1 }), 1);
  assert.equal(predictionPoints({ home: 0, away: 0 }, { home: 1, away: 1 }), 1);
  assert.equal(predictionPoints({ home: 1, away: 0 }, { home: 0, away: 2 }), 0);
  assert.equal(outcome(0, 0), 'E');
});

test('pozo: se reparte entre los que acertaron; si nadie acierta se devuelve', () => {
  const r = settleBets([{ user_id: 1, pick: 'L', stake: 100 }, { user_id: 2, pick: 'L', stake: 300 }, { user_id: 3, pick: 'V', stake: 200 }], { home: 1, away: 0 });
  assert.deepEqual([...r], [[1, 150], [2, 450], [3, 0]]);
  const d = settleBets([{ user_id: 1, pick: 'L', stake: 100 }, { user_id: 2, pick: 'V', stake: 50 }], { home: 1, away: 1 });
  assert.deepEqual([...d], [[1, 100], [2, 50]]);
});

test('mapeo de TheSportsDB', () => {
  assert.equal(mapStatus('Match Finished'), 'finished');
  assert.equal(mapStatus('Postponed'), 'postponed');
  const m = mapEvent({ idEvent: '1', strHomeTeam: 'A', strAwayTeam: 'B', strTimestamp: '2026-08-01T21:00:00', intHomeScore: '2', intAwayScore: null, strStatus: 'NS', intRound: '3' });
  assert.equal(m.kickoff, '2026-08-01T21:00:00.000Z'); assert.equal(m.away_goals, null); assert.equal(m.round, 'Fecha 3');
});

test('edad mínima de 16 años', () => {
  const hoy = new Date('2026-06-15T12:00:00Z');
  assert.equal(ageOn('2010-06-15', hoy), 16);
  assert.equal(ageOn('2010-06-16', hoy), 15); // le falta un día
  assert.equal(ageOn('2010-02-30', hoy), null); // no existe
  const base = { email: 'a@b.com', first_name: 'Ana', last_name: 'Paz', nick: 'ana', birth_date: '2010-06-16' };
  assert.match(validateAccount(base, hoy).error, /al menos 16/);
  assert.ok(validateAccount({ ...base, birth_date: '2010-06-15' }, hoy).value);
  assert.match(validateAccount({ ...base, email: 'nope' }, hoy).error, /mail/);
  assert.ok(validPassword('clave1234')); assert.ok(!validPassword('corta1')); assert.ok(!validPassword('sololetras'));
});

test('tabla de posiciones calculada', () => {
  const t = computeTable([
    { status: 'finished', home: 'A', away: 'B', home_goals: 2, away_goals: 0 },
    { status: 'finished', home: 'B', away: 'C', home_goals: 1, away_goals: 1 },
    { status: 'scheduled', home: 'A', away: 'C', home_goals: null, away_goals: null }]);
  assert.deepEqual(t.map((r) => [r.team, r.points, r.gd]), [['A', 3, 2], ['C', 1, 0], ['B', 1, -2]]);
});

test('firma VAPID verificable', () => {
  const { jwt, pub } = vapidAuth('https://web.push.apple.com/abc');
  const [h, b, s] = jwt.split('.');
  const raw = Buffer.from(pub, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(b, 'base64url')).aud, 'https://web.push.apple.com');
});

// ---- flujo completo contra el servidor HTTP ----
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const acct = (n, extra = {}) => ({ email: `${n}@mail.com`, password: 'clave1234', first_name: n, last_name: 'Prueba', nick: n, birth_date: '1990-05-10', accept: true, ...extra });
let A, B, ADM, gid, mid, comp;

test('registro: obligatorio, mayores de 16 y datos válidos', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/matches?group=1')).status, 401);
  assert.match((await call('POST', '/api/register', acct('menor', { birth_date: '2020-01-01' }))).data.error, /16/);
  assert.match((await call('POST', '/api/register', acct('x1', { password: '123' }))).data.error, /contraseña/);
  assert.match((await call('POST', '/api/register', acct('x2', { accept: false }))).data.error, /confirmar/);
  assert.match((await call('POST', '/api/register', acct('x3', { code: 'NOEXISTE' }))).data.error, /grupo/);
  ADM = (await call('POST', '/api/login', { email: 'jefe@prode.com', password: 'jefe12345' })).data;
  assert.equal(ADM.user.is_admin, true);
  A = (await call('POST', '/api/register', acct('Diego'))).data;
  assert.equal(A.user.is_admin, false); assert.equal(A.groups.length, 0); // el primero en registrarse NO es admin
  assert.match((await call('POST', '/api/register', acct('Otro', { email: 'DIEGO@mail.com' }))).data.error, /mail/);
  assert.match((await call('POST', '/api/register', acct('Intruso', { email: 'JEFE@prode.com' }))).data.error, /mail/); // no se puede registrar el mail del admin
  assert.match((await call('POST', '/api/register', acct('Administrador2'))).data.error, /apodo/);
  assert.match((await call('POST', '/api/register', acct('diego', { email: 'otro@mail.com' }))).data.error, /apodo/);
  assert.equal((await call('POST', '/api/login', { email: 'diego@mail.com', password: 'mala1234' })).status, 401);
  assert.equal((await call('POST', '/api/login', { email: 'DIEGO@mail.com', password: 'clave1234' })).status, 200);
});

test('grupos: crear, unirse con código, y cada grupo es independiente', async () => {
  const g = (await call('POST', '/api/groups', { name: 'Los pibes', color: '#4cc9f0' }, A.token)).data;
  gid = g.groups[0].id; const code = g.groups[0].code;
  assert.equal(g.groups[0].coins, 0); assert.equal(g.groups[0].is_owner, true); // nadie arranca con fichas
  B = (await call('POST', '/api/register', acct('Marcos', { code: code.toLowerCase() }))).data;
  assert.equal(B.groups[0].name, 'Los pibes'); assert.equal(B.groups[0].is_owner, false);
  assert.equal((await call('PATCH', `/api/groups/${gid}`, { name: 'X' }, B.token)).status, 403);
  assert.equal((await call('PATCH', `/api/groups/${gid}`, { name: 'Los pibes FC' }, A.token)).data.groups[0].name, 'Los pibes FC');
  // un tercero sin grupo no puede ver nada del grupo
  const C = (await call('POST', '/api/register', acct('Ajeno'))).data;
  assert.equal((await call('GET', `/api/matches?group=${gid}`, null, C.token)).status, 403);
  assert.equal((await call('GET', `/api/groups/${gid}/ranking`, null, C.token)).status, 403);
});

test('fichas: solo las carga el admin, a pedido', async () => {
  const play = (t, body) => call('PUT', `/api/matches/${mid0}/play?group=${gid}`, body, t);
  const comp0 = (await call('POST', '/api/admin/competitions', { name: 'Tmp', kind: 'cup' }, ADM.token)).data.id;
  const mid0 = (await call('POST', '/api/admin/matches', { comp_id: comp0, home: 'A', away: 'B', kickoff: new Date(Date.now() + 864e5).toISOString() }, ADM.token)).data.id;
  assert.match((await play(A.token, { bet: { pick: 'L', stake: 50 } })).data.error, /alcanzan/); // sin fichas no se apuesta
  assert.equal((await call('PUT', `/api/matches/${mid0}/play?group=${gid}`, { prediction: { home: 1, away: 0 } }, A.token)).status, 200); // pero se pronostica
  // el creador del grupo y los jugadores no pueden cargar fichas ni tocar el panel
  assert.equal((await call('POST', '/api/admin/grant', { user_id: A.user.id, group_id: gid, amount: 999 }, A.token)).status, 403);
  assert.equal((await call('POST', `/api/groups/${gid}/members/${A.user.id}/coins`, { delta: 999 }, A.token)).status, 404);
  assert.equal((await call('GET', '/api/admin/coin-requests', null, A.token)).status, 403);
  assert.equal((await call('POST', '/api/admin/settings', { thesportsdb_key: 'x123' }, A.token)).status, 403);
  // pedidos
  assert.equal((await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 5 }, A.token)).status, 400);
  assert.equal((await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 1000, note: 'Para el finde' }, A.token)).status, 200);
  await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 300 }, B.token);
  const pend = (await call('GET', '/api/admin/coin-requests', null, ADM.token)).data;
  assert.equal(pend.length, 2); assert.equal(pend[0].nick, 'Diego'); assert.equal(pend[0].note, 'Para el finde');
  assert.equal((await call('POST', `/api/admin/coin-requests/${pend[0].id}`, { action: 'approve' }, ADM.token)).status, 200); // aprueba lo pedido
  assert.equal((await call('POST', `/api/admin/coin-requests/${pend[1].id}`, { action: 'approve', amount: 500 }, ADM.token)).status, 200); // ajusta el monto
  assert.equal((await call('POST', `/api/admin/coin-requests/${pend[1].id}`, { action: 'approve' }, ADM.token)).status, 404); // no se aprueba dos veces
  await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 777 }, B.token);
  const r3 = (await call('GET', '/api/admin/coin-requests', null, ADM.token)).data;
  await call('POST', `/api/admin/coin-requests/${r3[0].id}`, { action: 'reject' }, ADM.token);
  const mine = (await call('GET', `/api/groups/${gid}/coin-requests`, null, B.token)).data;
  assert.deepEqual(mine.map((r) => [r.status, r.granted]), [['rejected', null], ['approved', 500]]);
  assert.equal((await call('GET', '/api/me', null, A.token)).data.groups[0].coins, 1000);
  assert.equal((await call('GET', '/api/me', null, B.token)).data.groups[0].coins, 500);
  // carga directa y movimientos
  await call('POST', '/api/admin/grant', { user_id: B.user.id, group_id: gid, amount: 500 }, ADM.token);
  assert.equal((await call('POST', '/api/admin/grant', { user_id: B.user.id, group_id: gid, amount: -5000 }, ADM.token)).status, 400);
  const led = (await call('GET', '/api/admin/ledger', null, ADM.token)).data;
  assert.deepEqual(led.map((l) => l.amount), [500, 500, 1000]);
  // pedidos abiertos limitados a 3
  for (let i = 0; i < 3; i++) await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 10 }, A.token);
  assert.match((await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 10 }, A.token)).data.error, /3 pedidos/);
});

test('panel: clave de la suscripción y usuarios (solo admin)', async () => {
  let o = (await call('GET', '/api/admin/overview', null, ADM.token)).data;
  assert.equal(o.source.key_set, false);
  assert.ok(o.pending >= 3); assert.ok(o.groups.find((g) => g.id === gid).members.length === 2);
  const s = (await call('POST', '/api/admin/settings', { thesportsdb_key: ' ABC12345wxyz ' }, ADM.token)).data;
  assert.equal(s.key_set, true); assert.equal(s.hint, '••••wxyz'); assert.equal(JSON.stringify(s).includes('ABC123'), false); // nunca se devuelve la clave
  assert.equal((await call('POST', '/api/admin/settings', { thesportsdb_key: 'mala clave!' }, ADM.token)).status, 400);
  await call('POST', '/api/admin/settings', { thesportsdb_key: '' }, ADM.token);
  assert.equal((await call('GET', '/api/admin/overview', null, ADM.token)).data.source.key_set, false);
  const users = (await call('GET', '/api/admin/users', null, ADM.token)).data;
  assert.ok(users.some((u) => u.email === 'diego@mail.com' && /Los pibes/.test(u.groups)));
  assert.equal((await call('GET', '/api/admin/users', null, B.token)).status, 403);
  // nadie puede cambiarle la clave al admin
  assert.equal((await call('POST', `/api/groups/${gid}/members/${ADM.user.id}/password`, { password: 'hackeo1234' }, A.token)).status, 403);
  assert.equal((await call('POST', '/api/login', { email: 'jefe@prode.com', password: 'jefe12345' })).status, 200);
});

test('apuesta, resultado y liquidación por grupo', async () => {
  comp = (await call('POST', '/api/admin/competitions', { name: 'Test', kind: 'cup' }, ADM.token)).data.id;
  assert.equal((await call('POST', '/api/admin/competitions', { name: 'x' }, B.token)).status, 403);
  const future = new Date(Date.now() + 86400e3).toISOString();
  mid = (await call('POST', '/api/admin/matches', { comp_id: comp, home: 'Boca', away: 'River', kickoff: future, round: 'Fecha 1' }, ADM.token)).data.id;
  const play = (t, body) => call('PUT', `/api/matches/${mid}/play?group=${gid}`, body, t);
  assert.equal((await play(A.token, { prediction: { home: 1, away: 0 }, bet: { pick: 'L', stake: 100 } })).data.coins, 900);
  await play(B.token, { prediction: { home: 0, away: 2 }, bet: { pick: 'V', stake: 300 } });
  assert.equal((await play(A.token, { bet: { pick: 'L', stake: 200 } })).data.coins, 800); // cambiar devuelve lo anterior
  assert.equal((await play(A.token, { bet: { pick: 'L', stake: 5000 } })).status, 400);
  assert.equal((await call('GET', `/api/matches/${mid}/plays?group=${gid}`, null, A.token)).status, 409);
  const list = (await call('GET', `/api/matches?group=${gid}`, null, A.token)).data;
  const lm = list.find((m) => m.id === mid);
  assert.equal(lm.pool.L.total, 200); assert.equal(lm.pool.V.total, 300);

  await call('POST', `/api/admin/matches/${mid}/result`, { home: 1, away: 0 }, ADM.token);
  await call('POST', `/api/admin/matches/${mid}/result`, { home: 1, away: 0 }, ADM.token); // idempotente
  const r = (await call('GET', `/api/groups/${gid}/ranking`, null, A.token)).data.players;
  const diego = r.find((p) => p.nick === 'Diego'), marcos = r.find((p) => p.nick === 'Marcos');
  assert.equal(diego.coins, 800 + 500); assert.equal(diego.points, 3); assert.equal(diego.net, 300);
  assert.equal(marcos.coins, 700); assert.equal(marcos.net, -300);
  assert.equal((await call('GET', `/api/matches/${mid}/plays?group=${gid}`, null, A.token)).data.length, 2);
  // ranking filtrado por torneo y fecha
  const f = (await call('GET', `/api/groups/${gid}/ranking?comp=${comp}&round=Fecha%201`, null, A.token)).data;
  assert.equal(f.filtered, true); assert.equal(f.players.find((p) => p.nick === 'Diego').points, 3);
  const f2 = (await call('GET', `/api/groups/${gid}/ranking?round=Fecha%209`, null, A.token)).data;
  assert.equal(f2.players.find((p) => p.nick === 'Diego').points, 0);
  const comps = (await call('GET', '/api/competitions', null, A.token)).data;
  assert.deepEqual(comps.find((c) => c.id === comp).rounds, ['Fecha 1']);
  const st = (await call('GET', `/api/competitions/${comp}/standings`, null, A.token)).data;
  assert.equal(st.computed, true); assert.equal(st.rows[0].team, 'Boca');
});

test('el pozo no se mezcla entre grupos', async () => {
  const g2 = (await call('POST', '/api/groups', { name: 'Trabajo' }, A.token)).data.groups.at(-1).id;
  const future = new Date(Date.now() + 3600e3 * 5).toISOString();
  const m2 = (await call('POST', '/api/admin/matches', { comp_id: comp, home: 'X', away: 'Y', kickoff: future }, ADM.token)).data.id;
  await call('POST', '/api/admin/grant', { user_id: A.user.id, group_id: g2, amount: 1000 }, ADM.token);
  await call('PUT', `/api/matches/${m2}/play?group=${g2}`, { bet: { pick: 'L', stake: 500 } }, A.token);
  const l1 = (await call('GET', `/api/matches?group=${gid}`, null, A.token)).data.find((m) => m.id === m2);
  assert.equal(l1.pool.L.total, 0);
  await call('POST', `/api/admin/matches/${m2}/result`, { cancel: true }, ADM.token);
  const groups = (await call('GET', '/api/me', null, A.token)).data.groups;
  assert.equal(groups.find((g) => g.id === g2).coins, 1000); // devolución
});

test('comentarios por partido, visibles solo para el grupo', async () => {
  assert.equal((await call('POST', `/api/matches/${mid}/comments?group=${gid}`, { body: '  ' }, A.token)).status, 400);
  await call('POST', `/api/matches/${mid}/comments?group=${gid}`, { body: 'Se las dejo servidas' }, A.token);
  await call('POST', `/api/matches/${mid}/comments?group=${gid}`, { body: 'Cargado' }, B.token);
  const c = (await call('GET', `/api/matches/${mid}/comments?group=${gid}`, null, A.token)).data;
  assert.deepEqual(c.map((x) => x.nick), ['Diego', 'Marcos']);
  assert.equal((await call('DELETE', `/api/comments/${c[1].id}`, null, A.token)).status, 200); // el dueño del grupo modera
  const res = (await call('GET', `/api/matches?group=${gid}&scope=results`, null, A.token)).data;
  assert.equal(res[0].comments, 1);
});

test('perfil: cambiar datos, foto y contraseña', async () => {
  const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const me = (await call('PATCH', '/api/me', { fav_team: 'Boca', avatar: px, nick: 'DiegoR' }, A.token)).data.user;
  assert.equal(me.nick, 'DiegoR'); assert.equal(me.avatar, px); assert.equal(me.fav_team, 'Boca');
  assert.equal((await call('PATCH', '/api/me', { avatar: 'http://x.com/a.png' }, A.token)).status, 400);
  assert.equal((await call('PATCH', '/api/me', { birth_date: '2015-01-01' }, A.token)).status, 400); // no se puede "rejuvenecer"
  assert.equal((await call('POST', '/api/me/password', { current: 'mala', password: 'nueva1234' }, A.token)).status, 400);
  assert.equal((await call('POST', '/api/me/password', { current: 'clave1234', password: 'nueva1234' }, A.token)).status, 200);
  assert.equal((await call('POST', '/api/login', { email: 'diego@mail.com', password: 'nueva1234' })).status, 200);
});

test('el creador resetea una contraseña y se cierran sus sesiones', async () => {
  assert.equal((await call('POST', `/api/groups/${gid}/members/${B.user.id}/password`, { password: 'temporal123' }, B.token)).status, 403);
  assert.equal((await call('POST', `/api/groups/${gid}/members/${B.user.id}/password`, { password: 'temporal123' }, A.token)).status, 200);
  assert.equal((await call('GET', '/api/me', null, B.token)).status, 401);
  assert.equal((await call('POST', '/api/login', { email: 'marcos@mail.com', password: 'temporal123' })).status, 200);
});

test('avisos: suscripción, recordatorio antes del cierre y entrega', async () => {
  const ep = 'https://push.example.com/abc123';
  assert.equal((await call('POST', '/api/push/subscribe', { endpoint: 'http://inseguro' }, A.token)).status, 400);
  await call('POST', '/api/push/subscribe', { endpoint: ep }, A.token);
  const soon = new Date(Date.now() + 45 * 60e3).toISOString();
  const m3 = (await call('POST', '/api/admin/matches', { comp_id: comp, home: 'Lanús', away: 'Vélez', kickoff: soon }, ADM.token)).data.id;
  assert.ok(queueReminders() >= 1);
  assert.equal(queueReminders(), 0); // un solo aviso por partido
  const got = (await call('POST', '/api/push/pull', { endpoint: ep })).data.messages;
  assert.match(got.at(-1).body, /Lanús vs Vélez empieza en/);
  assert.equal(pull(ep).length, 0); // se entregan una sola vez
  assert.ok(m3);
});

test.after(() => server.close());

// ---------- premios: pozo por fecha (ligas) y campeonato (copas) ----------
const { rankEntrants, splitPot, kindFor } = await import('../server/prizes.js');

test('premios: desempate y reparto del pozo', () => {
  const e = (user_id, pts, exact, err) => ({ user_id, pts, exact, err });
  const r = rankEntrants([e(1, 5, 1, 4), e(2, 6, 0, 9), e(3, 5, 2, 7), e(4, 5, 1, 2)]);
  assert.deepEqual(r.map((x) => x.user_id), [2, 3, 4, 1]); // puntos, luego exactos, luego menos error
  assert.deepEqual([...splitPot(300, r)], [[2, 300]]);
  const tie = rankEntrants([e(1, 4, 1, 3), e(2, 4, 1, 3), e(3, 2, 0, 1)]);
  assert.deepEqual([...splitPot(301, tie)], [[1, 151], [2, 150]]); // empate: se reparte, el resto va al primero
  assert.equal(kindFor('Copa Libertadores'), 'cup'); assert.equal(kindFor('Argentine Primera Division'), 'league');
});

test('ligas por fecha: inscripción, apuestas bloqueadas, ganador cobra el pozo', async () => {
  const mk = async (n) => (await call('POST', '/api/register', acct(n, { code: G_CODE }))).data;
  const G = (await call('POST', '/api/groups', { name: 'Liga amigos' }, A.token)).data.groups.at(-1); const g = G.id; G_CODE = G.code;
  const P2 = await mk('Lucho'), P3 = await mk('Nico');
  for (const u of [A, P2, P3]) await call('POST', '/api/admin/grant', { user_id: u.user.id, group_id: g, amount: 1000 }, ADM.token);
  const lg = (await call('POST', '/api/admin/competitions', { name: 'Liga Test', kind: 'league' }, ADM.token)).data.id;
  const t = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const m1 = (await call('POST', '/api/admin/matches', { comp_id: lg, home: 'A', away: 'B', kickoff: t(24), round: 'Fecha 1' }, ADM.token)).data.id;
  const m2 = (await call('POST', '/api/admin/matches', { comp_id: lg, home: 'C', away: 'D', kickoff: t(48), round: 'Fecha 1' }, ADM.token)).data.id;
  const pred = (u, id, h, a) => call('PUT', `/api/matches/${id}/play?group=${g}`, { prediction: { home: h, away: a } }, u.token);
  // en liga no se apuesta por partido
  assert.match((await call('PUT', `/api/matches/${m1}/play?group=${g}`, { bet: { pick: 'L', stake: 50 } }, A.token)).data.error, /por fecha/);
  // inscripción: cobra 100, se puede salir antes de que empiece, no inscribirse dos veces
  const join = (u) => call('POST', `/api/groups/${g}/rounds/join`, { comp_id: lg, round: 'Fecha 1' }, u.token);
  assert.equal((await join(A)).status, 200); assert.equal((await join(A)).status, 400);
  assert.equal((await call('GET', '/api/me', null, A.token)).data.groups.find((x) => x.id === g).coins, 900);
  await call('POST', `/api/groups/${g}/rounds/leave`, { comp_id: lg, round: 'Fecha 1' }, A.token);
  assert.equal((await call('GET', '/api/me', null, A.token)).data.groups.find((x) => x.id === g).coins, 1000); // devolvió la inscripción
  for (const u of [A, P2, P3]) await join(u);
  const pots = (await call('GET', `/api/groups/${g}/pots`, null, A.token)).data.rounds.find((r) => r.comp_id === lg);
  assert.equal(pots.pot, 300); assert.equal(pots.players, 3); assert.equal(pots.joined, true); assert.equal(pots.can_join, true);
  // pronósticos: A acierta todo exacto; Lucho acierta ganadores; Nico nada
  await pred(A, m1, 2, 0); await pred(A, m2, 1, 1);
  await pred(P2, m1, 1, 0); await pred(P2, m2, 0, 2);
  await pred(P3, m1, 0, 3); await pred(P3, m2, 3, 0);
  // se liquida el primer partido: la fecha sigue abierta, no se paga nada todavía
  await call('POST', `/api/admin/matches/${m1}/result`, { home: 2, away: 0 }, ADM.token);
  assert.equal((await call('GET', '/api/me', null, A.token)).data.groups.find((x) => x.id === g).coins, 900);
  assert.equal((await call('POST', `/api/groups/${g}/rounds/leave`, { comp_id: lg, round: 'Fecha 1' }, P2.token)).status, 400); // ya empezó
  // termina el último: se reparte
  await call('POST', `/api/admin/matches/${m2}/result`, { home: 1, away: 1 }, ADM.token);
  const coins = async (u) => (await call('GET', '/api/me', null, u.token)).data.groups.find((x) => x.id === g).coins;
  assert.equal(await coins(A), 900 + 300); assert.equal(await coins(P2), 900); assert.equal(await coins(P3), 900);
  const done = (await call('GET', `/api/groups/${g}/pots`, null, A.token)).data.rounds.find((r) => r.comp_id === lg);
  assert.equal(done.settled, true); assert.equal(done.board[0].nick, 'DiegoR'); assert.equal(done.board[0].payout, 300);
  // idempotente: cerrar a mano de nuevo no paga otra vez
  await call('POST', '/api/admin/rounds/close', { group_id: g, comp_id: lg, round: 'Fecha 1' }, ADM.token);
  assert.equal(await coins(A), 1200);
  // el ranking muestra el neto de la fecha
  const rk = (await call('GET', `/api/groups/${g}/ranking?comp=${lg}&round=Fecha%201`, null, A.token)).data.players;
  assert.equal(rk.find((p) => p.nick === 'DiegoR').net, 200); assert.equal(rk.find((p) => p.nick === 'Lucho').net, -100);
  // inscripción cerrada para fechas que ya empezaron
  const m3 = (await call('POST', '/api/admin/matches', { comp_id: lg, home: 'E', away: 'F', kickoff: t(-1), round: 'Fecha 0' }, ADM.token)).data.id;
  assert.equal((await call('POST', `/api/groups/${g}/rounds/join`, { comp_id: lg, round: 'Fecha 0' }, A.token)).status, 400);
  assert.ok(m3);
});
let G_CODE;

test('copas: apuesta por partido y pozo del campeonato por puntos acumulados', async () => {
  const g = (await call('GET', '/api/me', null, A.token)).data.groups.find((x) => x.name === 'Liga amigos').id;
  const cup = (await call('POST', '/api/admin/competitions', { name: 'Copa Libertadores Test' }, ADM.token)).data.id;
  const adm = (await call('GET', '/api/admin/overview', null, ADM.token)).data.competitions.find((c) => c.id === cup);
  assert.equal(adm.kind, 'cup'); assert.equal(adm.champ_fee, 300); // se detecta sola
  const users = [A, (await call('POST', '/api/login', { email: 'lucho@mail.com', password: 'clave1234' })).data];
  const t = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const m1 = (await call('POST', '/api/admin/matches', { comp_id: cup, home: 'P', away: 'F', kickoff: t(24) }, ADM.token)).data.id;
  const m2 = (await call('POST', '/api/admin/matches', { comp_id: cup, home: 'R', away: 'B', kickoff: t(48) }, ADM.token)).data.id;
  const [a, l] = users;
  // apuesta por partido: sigue funcionando en copas
  assert.equal((await call('PUT', `/api/matches/${m1}/play?group=${g}`, { prediction: { home: 1, away: 0 }, bet: { pick: 'L', stake: 100 } }, a.token)).status, 200);
  await call('PUT', `/api/matches/${m1}/play?group=${g}`, { prediction: { home: 0, away: 1 }, bet: { pick: 'V', stake: 100 } }, l.token);
  // inscripción al campeonato
  const before = async (u) => (await call('GET', '/api/me', null, u.token)).data.groups.find((x) => x.id === g).coins;
  const [ca, cl] = [await before(a), await before(l)];
  assert.equal((await call('POST', `/api/groups/${g}/champs/${cup}/join`, null, a.token)).status, 200);
  assert.equal((await call('POST', `/api/groups/${g}/champs/${cup}/join`, null, a.token)).status, 400);
  await call('POST', `/api/groups/${g}/champs/${cup}/join`, null, l.token);
  await call('PUT', `/api/matches/${m2}/play?group=${g}`, { prediction: { home: 2, away: 2 } }, a.token);
  await call('PUT', `/api/matches/${m2}/play?group=${g}`, { prediction: { home: 1, away: 0 } }, l.token);
  await call('POST', `/api/admin/matches/${m1}/result`, { home: 1, away: 0 }, ADM.token); // el pozo del partido es para el local
  await call('POST', `/api/admin/matches/${m2}/result`, { home: 2, away: 2 }, ADM.token);
  assert.equal(await before(a), ca - 300 + 200); // inscripción 300, pozo del partido: 200 para quien acertó
  const pot = (await call('GET', `/api/groups/${g}/pots`, null, a.token)).data.champs.find((c) => c.comp_id === cup);
  assert.equal(pot.pot, 600); assert.equal(pot.board[0].nick, 'DiegoR'); assert.equal(pot.joined, true);
  // el admin cierra el campeonato: gana quien acumuló más puntos (Diego: 3+3=6 contra 0+0)
  assert.equal((await call('POST', `/api/admin/competitions/${cup}/close`, null, a.token)).status, 403);
  await call('POST', `/api/admin/competitions/${cup}/close`, null, ADM.token);
  assert.equal(await before(a), ca - 300 + 200 + 600);
  assert.equal(await before(l), cl - 300);
  assert.equal((await call('POST', `/api/groups/${g}/champs/${cup}/join`, null, l.token)).status, 400); // cerrado
  assert.equal(await before(a), ca - 300 + 200 + 600); // cerrar de nuevo no paga dos veces
  await call('POST', `/api/admin/competitions/${cup}/close`, null, ADM.token);
  assert.equal(await before(a), ca - 300 + 200 + 600);
});
