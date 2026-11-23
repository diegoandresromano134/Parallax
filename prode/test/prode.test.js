import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.PRODE_DB = ':memory:';
process.env.PRODE_NO_LISTEN = '1';
process.env.PRODE_ADMIN_EMAIL = 'jefe@prode.com';
process.env.PRODE_ADMIN_PASSWORD = 'jefe12345';

const { outcome, predictionPoints } = await import('../server/scoring.js');
const { mapEvent, mapStatus } = await import('../server/providers/thesportsdb.js');
const { ageOn, validateAccount, validPassword } = await import('../server/validate.js');
const { computeTable } = await import('../server/standings.js');
const { vapidAuth, queueReminders, pull } = await import('../server/push.js');
const { rankEntrants, splitPot, kindFor } = await import('../server/prizes.js');
const { server } = await import('../server/server.js');

// ---------- reglas puras ----------
test('puntos del PRODE', () => {
  assert.equal(predictionPoints({ home: 2, away: 1 }, { home: 2, away: 1 }), 3);
  assert.equal(predictionPoints({ home: 1, away: 0 }, { home: 3, away: 1 }), 1);
  assert.equal(predictionPoints({ home: 0, away: 0 }, { home: 1, away: 1 }), 1);
  assert.equal(predictionPoints({ home: 1, away: 0 }, { home: 0, away: 2 }), 0);
  assert.equal(outcome(0, 0), 'E');
});
test('mapeo de TheSportsDB', () => {
  assert.equal(mapStatus('Match Finished'), 'finished'); assert.equal(mapStatus('Postponed'), 'postponed');
  const m = mapEvent({ idEvent: '1', strHomeTeam: 'A', strAwayTeam: 'B', strTimestamp: '2026-08-01T21:00:00', intHomeScore: '2', intAwayScore: null, strStatus: 'NS', intRound: '3' });
  assert.equal(m.kickoff, '2026-08-01T21:00:00.000Z'); assert.equal(m.away_goals, null); assert.equal(m.round, 'Fecha 3');
});
test('edad mínima de 16 años', () => {
  const hoy = new Date('2026-06-15T12:00:00Z');
  assert.equal(ageOn('2010-06-15', hoy), 16); assert.equal(ageOn('2010-06-16', hoy), 15); assert.equal(ageOn('2010-02-30', hoy), null);
  const base = { email: 'a@b.com', first_name: 'Ana', last_name: 'Paz', nick: 'ana', birth_date: '2010-06-16' };
  assert.match(validateAccount(base, hoy).error, /al menos 16/);
  assert.ok(validateAccount({ ...base, birth_date: '2010-06-15' }, hoy).value);
  assert.ok(validPassword('clave1234')); assert.ok(!validPassword('corta1')); assert.ok(!validPassword('sololetras'));
});
test('tabla de posiciones calculada', () => {
  const t = computeTable([{ status: 'finished', home: 'A', away: 'B', home_goals: 2, away_goals: 0 }, { status: 'finished', home: 'B', away: 'C', home_goals: 1, away_goals: 1 }, { status: 'scheduled', home: 'A', away: 'C' }]);
  assert.deepEqual(t.map((r) => [r.team, r.points, r.gd]), [['A', 3, 2], ['C', 1, 0], ['B', 1, -2]]);
});
test('firma VAPID verificable', () => {
  const { jwt, pub } = vapidAuth('https://web.push.apple.com/abc');
  const [h, b, s] = jwt.split('.'), raw = Buffer.from(pub, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});
test('premios: desempate y reparto del pozo', () => {
  const e = (user_id, pts, exact, err) => ({ user_id, pts, exact, err });
  const r = rankEntrants([e(1, 5, 1, 4), e(2, 6, 0, 9), e(3, 5, 2, 7), e(4, 5, 1, 2)]);
  assert.deepEqual(r.map((x) => x.user_id), [2, 3, 4, 1]);
  assert.deepEqual([...splitPot(300, r)], [[2, 300]]);
  const tie = rankEntrants([e(1, 4, 1, 3), e(2, 4, 1, 3), e(3, 2, 0, 1)]);
  assert.deepEqual([...splitPot(301, tie)], [[1, 151], [2, 150]]);
  assert.equal(kindFor('Copa Libertadores'), 'cup'); assert.equal(kindFor('Argentine Primera Division'), 'league');
});

// ---------- servidor ----------
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const acct = (n, extra = {}) => ({ email: `${n}@mail.com`, password: 'clave1234', first_name: n, last_name: 'Prueba', nick: n, birth_date: '1990-05-10', accept: true, ...extra });
const hrs = (h) => new Date(Date.now() + h * 3600e3).toISOString();
let ADM, A, B, gid, CODE;
const coins = async (u, g = gid) => (await call('GET', '/api/me', null, u.token)).data.groups.find((x) => x.id === g).coins;
const grant = (u, amount, g = gid) => call('POST', '/api/admin/grant', { user_id: u.user.id, group_id: g, amount }, ADM.token);
const newComp = async (name, kind) => (await call('POST', '/api/admin/competitions', { name, kind }, ADM.token)).data.id;
const newMatch = async (comp, home, away, kickoff, round) => (await call('POST', '/api/admin/matches', { comp_id: comp, home, away, kickoff, round }, ADM.token)).data.id;
const result = (id, home, away) => call('POST', `/api/admin/matches/${id}/result`, { home, away }, ADM.token);
const join = (u, comp, round, g = gid) => call('POST', `/api/groups/${g}/rounds/join`, { comp_id: comp, round }, u.token);
const pred = (u, id, h, a, g = gid) => call('PUT', `/api/matches/${id}/play?group=${g}`, { prediction: { home: h, away: a } }, u.token);

test('cuentas: registro obligatorio, mayores de 16, un solo admin', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.match((await call('POST', '/api/register', acct('menor', { birth_date: '2020-01-01' }))).data.error, /16/);
  assert.match((await call('POST', '/api/register', acct('x1', { password: '123' }))).data.error, /contraseña/);
  assert.match((await call('POST', '/api/register', acct('x2', { accept: false }))).data.error, /confirmar/);
  ADM = (await call('POST', '/api/login', { email: 'jefe@prode.com', password: 'jefe12345' })).data;
  assert.equal(ADM.user.is_admin, true);
  A = (await call('POST', '/api/register', acct('Diego'))).data;
  assert.equal(A.user.is_admin, false);
  assert.match((await call('POST', '/api/register', acct('Intruso', { email: 'JEFE@prode.com' }))).data.error, /mail/);
  assert.match((await call('POST', '/api/register', acct('Administrador2'))).data.error, /apodo/);
  assert.equal((await call('POST', '/api/login', { email: 'diego@mail.com', password: 'mala1234' })).status, 401);
});

test('grupos: crear, unirse con código, aislados entre sí; nadie arranca con fichas', async () => {
  const g = (await call('POST', '/api/groups', { name: 'Los pibes', color: '#4cc9f0' }, A.token)).data.groups[0];
  gid = g.id; CODE = g.code;
  assert.equal(g.coins, 0);
  B = (await call('POST', '/api/register', acct('Marcos', { code: CODE.toLowerCase() }))).data;
  assert.equal(B.groups[0].name, 'Los pibes');
  assert.equal((await call('PATCH', `/api/groups/${gid}`, { name: 'X' }, B.token)).status, 403);
  const C = (await call('POST', '/api/register', acct('Ajeno'))).data;
  assert.equal((await call('GET', `/api/matches?group=${gid}`, null, C.token)).status, 403);
});

test('SIN FICHAS NO SE JUEGA: ni anotarse ni pronosticar', async () => {
  const comp = await newComp('Liga Sin Fichas', 'league');
  const m = await newMatch(comp, 'A', 'B', hrs(24), 'Fecha 1');
  assert.match((await join(A, comp, 'Fecha 1')).data.error, /Sin fichas/);
  assert.equal((await pred(A, m, 1, 0)).status, 403); // no está anotado
  assert.match((await call('PUT', `/api/matches/${m}/play?group=${gid}`, { bet: { pick: 'L', stake: 50 } }, A.token)).data.error, /fecha/); // no hay apuesta por partido
  const list = (await call('GET', `/api/matches?group=${gid}`, null, A.token)).data;
  assert.equal(list.find((x) => x.id === m).enrolled, false);
  // con fichas: se anota y recién ahí pronostica
  await grant(A, 150);
  assert.equal((await join(A, comp, 'Fecha 1')).status, 200);
  assert.equal(await coins(A), 50);
  assert.equal((await pred(A, m, 1, 0)).status, 200);
  assert.equal((await call('GET', `/api/matches?group=${gid}`, null, A.token)).data.find((x) => x.id === m).enrolled, true);
  // salir de la fecha devuelve la inscripción y borra sus pronósticos
  await call('POST', `/api/groups/${gid}/rounds/leave`, { comp_id: comp, round: 'Fecha 1' }, A.token);
  assert.equal(await coins(A), 150);
  assert.equal((await call('GET', `/api/matches?group=${gid}`, null, A.token)).data.find((x) => x.id === m).mine.prediction, null);
  await grant(A, -150); // deja el saldo en cero para los tests siguientes
});

test('fichas: solo las carga el admin, a pedido', async () => {
  assert.equal((await call('POST', '/api/admin/grant', { user_id: A.user.id, group_id: gid, amount: 999 }, A.token)).status, 403);
  assert.equal((await call('GET', '/api/admin/coin-requests', null, A.token)).status, 403);
  assert.equal((await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 5 }, A.token)).status, 400);
  await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 1000, note: 'Para el finde' }, A.token);
  await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 300 }, B.token);
  const pend = (await call('GET', '/api/admin/coin-requests', null, ADM.token)).data;
  assert.equal(pend.length, 2); assert.equal(pend[0].note, 'Para el finde');
  await call('POST', `/api/admin/coin-requests/${pend[0].id}`, { action: 'approve' }, ADM.token);
  await call('POST', `/api/admin/coin-requests/${pend[1].id}`, { action: 'approve', amount: 1000 }, ADM.token); // ajusta el monto
  assert.equal((await call('POST', `/api/admin/coin-requests/${pend[1].id}`, { action: 'approve' }, ADM.token)).status, 404);
  assert.equal(await coins(A), 1000); assert.equal(await coins(B), 1000);
  await call('POST', `/api/groups/${gid}/coin-requests`, { amount: 777 }, B.token);
  const r3 = (await call('GET', '/api/admin/coin-requests', null, ADM.token)).data;
  await call('POST', `/api/admin/coin-requests/${r3[0].id}`, { action: 'reject' }, ADM.token);
  assert.equal(await coins(B), 1000);
  assert.equal((await call('POST', '/api/admin/grant', { user_id: B.user.id, group_id: gid, amount: -5000 }, ADM.token)).status, 400);
  const led = (await call('GET', '/api/admin/ledger', null, ADM.token)).data;
  assert.ok(led.length >= 2);
});

test('todos los torneos igual: pozo por fecha, gana el que más puntos suma', async () => {
  const lig = await newComp('Liga Test', 'league'), copa = await newComp('Copa Libertadores Test');
  assert.equal((await call('GET', '/api/admin/overview', null, ADM.token)).data.competitions.find((c) => c.id === copa).kind, 'cup');
  for (const [comp, round] of [[lig, 'Fecha 1'], [copa, 'Octavos']]) {
    await grant(A, 500); await grant(B, 500); const [a0, b0] = [await coins(A), await coins(B)];
    const m1 = await newMatch(comp, 'P', 'F', hrs(24), round), m2 = await newMatch(comp, 'R', 'B', hrs(48), round);
    assert.equal((await join(A, comp, round)).status, 200); assert.equal((await join(A, comp, round)).status, 400);
    assert.equal((await join(B, comp, round)).status, 200);
    const pot = (await call('GET', `/api/groups/${gid}/pots`, null, A.token)).data.rounds.find((r) => r.comp_id === comp && r.round === round);
    assert.equal(pot.pot, 200); assert.equal(pot.can_join, true);
    await pred(A, m1, 2, 0); await pred(A, m2, 1, 1); await pred(B, m1, 1, 0); await pred(B, m2, 0, 2);
    await result(m1, 2, 0);
    assert.equal((await call('POST', `/api/groups/${gid}/rounds/leave`, { comp_id: comp, round }, B.token)).status, 400); // ya empezó
    assert.equal(await coins(A), a0 - 100); // la fecha sigue abierta
    await result(m2, 1, 1); // terminó la fecha: A (6 pts) le gana a B (1 pt)
    assert.equal(await coins(A), a0 + 100); assert.equal(await coins(B), b0 - 100);
    const done = (await call('GET', `/api/groups/${gid}/pots`, null, A.token)).data.rounds.find((r) => r.comp_id === comp);
    assert.equal(done.settled, true); assert.equal(done.board[0].nick, 'Diego'); assert.equal(done.board[0].payout, 200);
    await call('POST', '/api/admin/rounds/close', { group_id: gid, comp_id: comp, round }, ADM.token); // no paga dos veces
    assert.equal(await coins(A), a0 + 100);
  }
  // inscripción cerrada si la fecha ya empezó
  const mm = await newMatch(lig, 'E', 'F', hrs(-1), 'Fecha 0');
  assert.equal((await join(A, lig, 'Fecha 0')).status, 400); assert.ok(mm);
  // ranking: neto de la fecha
  const rk = (await call('GET', `/api/groups/${gid}/ranking?comp=${lig}&round=Fecha%201`, null, A.token)).data.players;
  assert.equal(rk.find((p) => p.nick === 'Diego').net, 100); assert.equal(rk.find((p) => p.nick === 'Marcos').net, -100);
});

test('partido sin nombre de fecha: es su propia fecha', async () => {
  const comp = await newComp('Copa Sudamericana Test');
  const m = await newMatch(comp, 'Lanús', 'Nacional', hrs(30));
  const row = (await call('GET', `/api/matches?group=${gid}&comp=${comp}`, null, A.token)).data.find((x) => x.id === m);
  assert.match(row.round, /^Lanús vs Nacional/);
  await grant(A, 100); assert.equal((await join(A, comp, row.round)).status, 200);
  assert.equal((await pred(A, m, 1, 0)).status, 200);
});

test('campeonato de copas: pozo por puntos acumulados, lo cierra el admin', async () => {
  const cup = await newComp('Copa Argentina Test'); // se detecta como copa
  await grant(A, 1000); await grant(B, 1000);
  const m1 = await newMatch(cup, 'X', 'Y', hrs(24), 'Ronda 1'), m2 = await newMatch(cup, 'Z', 'W', hrs(48), 'Ronda 2');
  const [a0, b0] = [await coins(A), await coins(B)];
  assert.equal((await call('POST', `/api/groups/${gid}/champs/${cup}/join`, null, A.token)).status, 200);
  assert.equal((await call('POST', `/api/groups/${gid}/champs/${cup}/join`, null, A.token)).status, 400);
  await call('POST', `/api/groups/${gid}/champs/${cup}/join`, null, B.token);
  await join(A, cup, 'Ronda 1'); await join(B, cup, 'Ronda 1'); await join(A, cup, 'Ronda 2'); await join(B, cup, 'Ronda 2');
  await pred(A, m1, 1, 0); await pred(B, m1, 0, 1); await pred(A, m2, 2, 2); await pred(B, m2, 1, 0);
  await result(m1, 1, 0); await result(m2, 2, 2);
  const pot = (await call('GET', `/api/groups/${gid}/pots`, null, A.token)).data.champs.find((c) => c.comp_id === cup);
  assert.equal(pot.pot, 600); assert.equal(pot.board[0].nick, 'Diego'); assert.equal(pot.board[0].pts, 6);
  assert.equal((await call('POST', `/api/admin/competitions/${cup}/close`, null, A.token)).status, 403);
  const antes = await coins(A);
  await call('POST', `/api/admin/competitions/${cup}/close`, null, ADM.token);
  assert.equal(await coins(A), antes + 600);
  await call('POST', `/api/admin/competitions/${cup}/close`, null, ADM.token); // no paga dos veces
  assert.equal(await coins(A), antes + 600);
  assert.equal((await call('POST', `/api/groups/${gid}/champs/${cup}/join`, null, B.token)).status, 400);
  assert.ok(a0 >= 0 && b0 >= 0);
});

test('canje: el admin define los premios, el jugador canjea con fichas', async () => {
  assert.equal((await call('POST', '/api/admin/rewards', { title: 'Asado', cost: 500 }, A.token)).status, 403);
  assert.equal((await call('POST', '/api/admin/rewards', { title: 'x', cost: 500 }, ADM.token)).status, 400);
  const asado = (await call('POST', '/api/admin/rewards', { title: 'Asado para dos', description: 'En lo de Diego', cost: 500 }, ADM.token)).data.id;
  const camiseta = (await call('POST', '/api/admin/rewards', { title: 'Camiseta', cost: 100000 }, ADM.token)).data.id;
  const list = (await call('GET', '/api/rewards', null, B.token)).data;
  assert.deepEqual(list.map((r) => r.title), ['Asado para dos', 'Camiseta']);
  assert.match((await call('POST', `/api/groups/${gid}/redeem`, { reward_id: camiseta }, B.token)).data.error, /Te faltan/);
  const antes = await coins(B);
  assert.equal((await call('POST', `/api/groups/${gid}/redeem`, { reward_id: asado }, B.token)).status, 200);
  assert.equal(await coins(B), antes - 500);
  const pend = (await call('GET', '/api/admin/redemptions', null, ADM.token)).data;
  assert.equal(pend.length, 1); assert.equal(pend[0].nick, 'Marcos');
  assert.equal((await call('GET', '/api/admin/redemptions', null, B.token)).status, 403);
  assert.ok((await call('GET', '/api/me', null, ADM.token)).data.admin_pending >= 1);
  // rechazar devuelve las fichas
  await call('POST', `/api/admin/redemptions/${pend[0].id}`, { action: 'reject' }, ADM.token);
  assert.equal(await coins(B), antes);
  assert.equal((await call('POST', `/api/admin/redemptions/${pend[0].id}`, { action: 'deliver' }, ADM.token)).status, 404);
  // entregar
  await call('POST', `/api/groups/${gid}/redeem`, { reward_id: asado }, B.token);
  const p2 = (await call('GET', '/api/admin/redemptions', null, ADM.token)).data[0];
  await call('POST', `/api/admin/redemptions/${p2.id}`, { action: 'deliver' }, ADM.token);
  assert.equal(await coins(B), antes - 500);
  assert.deepEqual((await call('GET', `/api/groups/${gid}/redemptions`, null, B.token)).data.map((r) => r.status), ['delivered', 'rejected']);
  // un premio desactivado ya no se puede canjear
  await call('PATCH', `/api/admin/rewards/${asado}`, { active: false }, ADM.token);
  assert.match((await call('POST', `/api/groups/${gid}/redeem`, { reward_id: asado }, B.token)).data.error, /no está disponible/);
});

test('panel: clave de la suscripción (nunca se devuelve) y usuarios', async () => {
  assert.equal((await call('GET', '/api/admin/overview', null, ADM.token)).data.source.key_set, false);
  const s = (await call('POST', '/api/admin/settings', { thesportsdb_key: ' ABC12345wxyz ' }, ADM.token)).data;
  assert.equal(s.key_set, true); assert.equal(s.hint, '••••wxyz'); assert.equal(JSON.stringify(s).includes('ABC123'), false);
  assert.equal((await call('POST', '/api/admin/settings', { thesportsdb_key: 'x' }, A.token)).status, 403);
  await call('POST', '/api/admin/settings', { thesportsdb_key: '' }, ADM.token);
  assert.equal((await call('GET', '/api/admin/users', null, B.token)).status, 403);
  assert.equal((await call('POST', `/api/groups/${gid}/members/${ADM.user.id}/password`, { password: 'hackeo1234' }, A.token)).status, 403);
});

test('comentarios, perfil y claves temporales', async () => {
  const comp = await newComp('Liga Chat', 'league'), m = await newMatch(comp, 'A', 'B', hrs(5), 'Fecha 1');
  assert.equal((await call('POST', `/api/matches/${m}/comments?group=${gid}`, { body: '  ' }, A.token)).status, 400);
  await call('POST', `/api/matches/${m}/comments?group=${gid}`, { body: 'Se las dejo servidas' }, A.token);
  await call('POST', `/api/matches/${m}/comments?group=${gid}`, { body: 'Cargado' }, B.token);
  const c = (await call('GET', `/api/matches/${m}/comments?group=${gid}`, null, A.token)).data;
  assert.deepEqual(c.map((x) => x.nick), ['Diego', 'Marcos']);
  assert.equal((await call('DELETE', `/api/comments/${c[1].id}`, null, A.token)).status, 200); // el creador del grupo modera
  const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const me = (await call('PATCH', '/api/me', { fav_team: 'Boca', avatar: px, nick: 'DiegoR' }, A.token)).data.user;
  assert.equal(me.nick, 'DiegoR'); assert.equal(me.avatar, px);
  assert.equal((await call('PATCH', '/api/me', { birth_date: '2015-01-01' }, A.token)).status, 400);
  assert.equal((await call('POST', '/api/me/password', { current: 'clave1234', password: 'nueva1234' }, A.token)).status, 200);
  assert.equal((await call('POST', `/api/groups/${gid}/members/${B.user.id}/password`, { password: 'temporal123' }, B.token)).status, 403);
  assert.equal((await call('POST', `/api/groups/${gid}/members/${B.user.id}/password`, { password: 'temporal123' }, A.token)).status, 200);
  assert.equal((await call('GET', '/api/me', null, B.token)).status, 401);
});

test('avisos: recordatorio antes del cierre (solo a quien está anotado sin pronosticar) y entrega', async () => {
  const ep = 'https://push.example.com/abc123';
  assert.equal((await call('POST', '/api/push/subscribe', { endpoint: 'http://inseguro' }, A.token)).status, 400);
  await call('POST', '/api/push/subscribe', { endpoint: ep }, A.token);
  const comp = await newComp('Liga Aviso', 'league'); await grant(A, 200);
  await newMatch(comp, 'Lanús', 'Vélez', hrs(0.75), 'Fecha 9');
  assert.ok(queueReminders() >= 1);
  assert.equal(queueReminders(), 0);
  const got = (await call('POST', '/api/push/pull', { endpoint: ep })).data.messages;
  assert.match(got.at(-1).body, /Lanús vs Vélez empieza en/);
  assert.equal(pull(ep).length, 0);
});

test.after(() => server.close());
