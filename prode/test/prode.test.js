import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.PRODE_DB = ':memory:';
process.env.PRODE_NO_LISTEN = '1';

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
let A, B, gid, mid, comp;

test('registro: obligatorio, mayores de 16 y datos válidos', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/matches?group=1')).status, 401);
  assert.match((await call('POST', '/api/register', acct('menor', { birth_date: '2020-01-01' }))).data.error, /16/);
  assert.match((await call('POST', '/api/register', acct('x1', { password: '123' }))).data.error, /contraseña/);
  assert.match((await call('POST', '/api/register', acct('x2', { accept: false }))).data.error, /confirmar/);
  assert.match((await call('POST', '/api/register', acct('x3', { code: 'NOEXISTE' }))).data.error, /grupo/);
  A = (await call('POST', '/api/register', acct('Diego'))).data;
  assert.equal(A.user.is_admin, true); assert.equal(A.groups.length, 0);
  assert.match((await call('POST', '/api/register', acct('Otro', { email: 'DIEGO@mail.com' }))).data.error, /mail/);
  assert.match((await call('POST', '/api/register', acct('diego', { email: 'otro@mail.com' }))).data.error, /apodo/);
  assert.equal((await call('POST', '/api/login', { email: 'diego@mail.com', password: 'mala1234' })).status, 401);
  assert.equal((await call('POST', '/api/login', { email: 'DIEGO@mail.com', password: 'clave1234' })).status, 200);
});

test('grupos: crear, unirse con código, y cada grupo es independiente', async () => {
  const g = (await call('POST', '/api/groups', { name: 'Los pibes', color: '#4cc9f0' }, A.token)).data;
  gid = g.groups[0].id; const code = g.groups[0].code;
  assert.equal(g.groups[0].coins, 1000); assert.equal(g.groups[0].is_owner, true);
  B = (await call('POST', '/api/register', acct('Marcos', { code: code.toLowerCase() }))).data;
  assert.equal(B.groups[0].name, 'Los pibes'); assert.equal(B.groups[0].is_owner, false);
  assert.equal((await call('PATCH', `/api/groups/${gid}`, { name: 'X' }, B.token)).status, 403);
  assert.equal((await call('PATCH', `/api/groups/${gid}`, { name: 'Los pibes FC' }, A.token)).data.groups[0].name, 'Los pibes FC');
  // un tercero sin grupo no puede ver nada del grupo
  const C = (await call('POST', '/api/register', acct('Ajeno'))).data;
  assert.equal((await call('GET', `/api/matches?group=${gid}`, null, C.token)).status, 403);
  assert.equal((await call('GET', `/api/groups/${gid}/ranking`, null, C.token)).status, 403);
});

test('apuesta, resultado y liquidación por grupo', async () => {
  comp = (await call('POST', '/api/admin/competitions', { name: 'Test' }, A.token)).data.id;
  assert.equal((await call('POST', '/api/admin/competitions', { name: 'x' }, B.token)).status, 403);
  const future = new Date(Date.now() + 86400e3).toISOString();
  mid = (await call('POST', '/api/admin/matches', { comp_id: comp, home: 'Boca', away: 'River', kickoff: future, round: 'Fecha 1' }, A.token)).data.id;
  const play = (t, body) => call('PUT', `/api/matches/${mid}/play?group=${gid}`, body, t);
  assert.equal((await play(A.token, { prediction: { home: 1, away: 0 }, bet: { pick: 'L', stake: 100 } })).data.coins, 900);
  await play(B.token, { prediction: { home: 0, away: 2 }, bet: { pick: 'V', stake: 300 } });
  assert.equal((await play(A.token, { bet: { pick: 'L', stake: 200 } })).data.coins, 800); // cambiar devuelve lo anterior
  assert.equal((await play(A.token, { bet: { pick: 'L', stake: 5000 } })).status, 400);
  assert.equal((await call('GET', `/api/matches/${mid}/plays?group=${gid}`, null, A.token)).status, 409);
  const list = (await call('GET', `/api/matches?group=${gid}`, null, A.token)).data;
  assert.equal(list[0].pool.L.total, 200); assert.equal(list[0].pool.V.total, 300);

  await call('POST', `/api/admin/matches/${mid}/result`, { home: 1, away: 0 }, A.token);
  await call('POST', `/api/admin/matches/${mid}/result`, { home: 1, away: 0 }, A.token); // idempotente
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
  const m2 = (await call('POST', '/api/admin/matches', { comp_id: comp, home: 'X', away: 'Y', kickoff: future }, A.token)).data.id;
  await call('PUT', `/api/matches/${m2}/play?group=${g2}`, { bet: { pick: 'L', stake: 500 } }, A.token);
  const l1 = (await call('GET', `/api/matches?group=${gid}`, null, A.token)).data.find((m) => m.id === m2);
  assert.equal(l1.pool.L.total, 0);
  await call('POST', `/api/admin/matches/${m2}/result`, { cancel: true }, A.token);
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
  const m3 = (await call('POST', '/api/admin/matches', { comp_id: comp, home: 'Lanús', away: 'Vélez', kickoff: soon }, A.token)).data.id;
  assert.ok(queueReminders() >= 1);
  assert.equal(queueReminders(), 0); // un solo aviso por partido
  const got = (await call('POST', '/api/push/pull', { endpoint: ep })).data.messages;
  assert.match(got.at(-1).body, /Lanús vs Vélez empieza en/);
  assert.equal(pull(ep).length, 0); // se entregan una sola vez
  assert.ok(m3);
});

test.after(() => server.close());
