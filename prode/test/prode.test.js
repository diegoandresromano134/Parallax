import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PRODE_DB = ':memory:';
process.env.PRODE_NO_LISTEN = '1';
process.env.PRODE_CODE = 'amigos';

const { outcome, predictionPoints, settleBets } = await import('../server/scoring.js');
const { mapEvent, mapStatus } = await import('../server/providers/thesportsdb.js');
const { server } = await import('../server/server.js');
const { db } = await import('../server/db.js');

test('puntos del PRODE', () => {
  assert.equal(predictionPoints({ home: 2, away: 1 }, { home: 2, away: 1 }), 3);
  assert.equal(predictionPoints({ home: 1, away: 0 }, { home: 3, away: 1 }), 1);
  assert.equal(predictionPoints({ home: 0, away: 0 }, { home: 1, away: 1 }), 1);
  assert.equal(predictionPoints({ home: 1, away: 0 }, { home: 0, away: 2 }), 0);
  assert.equal(outcome(0, 0), 'E');
});

test('pozo: se reparte entre los que acertaron', () => {
  const r = settleBets([
    { user_id: 1, pick: 'L', stake: 100 }, { user_id: 2, pick: 'L', stake: 300 },
    { user_id: 3, pick: 'V', stake: 200 }], { home: 1, away: 0 });
  assert.deepEqual([...r], [[1, 150], [2, 450], [3, 0]]);
});

test('pozo: si nadie acierta se devuelve todo', () => {
  const r = settleBets([{ user_id: 1, pick: 'L', stake: 100 }, { user_id: 2, pick: 'V', stake: 50 }], { home: 1, away: 1 });
  assert.deepEqual([...r], [[1, 100], [2, 50]]);
});

test('mapeo de TheSportsDB', () => {
  assert.equal(mapStatus('Match Finished'), 'finished');
  assert.equal(mapStatus('Not Started'), 'scheduled');
  assert.equal(mapStatus('Postponed'), 'postponed');
  assert.equal(mapStatus('2H'), 'live');
  const m = mapEvent({ idEvent: '1', strHomeTeam: 'A', strAwayTeam: 'B', strTimestamp: '2026-08-01T21:00:00',
    intHomeScore: '2', intAwayScore: null, strStatus: 'NS', intRound: '3' });
  assert.equal(m.kickoff, '2026-08-01T21:00:00.000Z');
  assert.equal(m.home_goals, 2); assert.equal(m.away_goals, null); assert.equal(m.round, 'Fecha 3');
  assert.equal(mapEvent({ idEvent: '2', strHomeTeam: 'A' }), null);
});

// ---- flujo completo contra el servidor HTTP ----
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};

test('flujo completo: registro, apuesta, resultado y liquidación', async () => {
  assert.equal((await call('POST', '/api/register', { name: 'Diego', pin: '1234', code: 'mal' })).status, 400);
  const a = (await call('POST', '/api/register', { name: 'Diego', pin: '1234', code: 'amigos' })).data;
  const b = (await call('POST', '/api/register', { name: 'Marcos', pin: '4321', code: 'AMIGOS' })).data;
  assert.equal(a.user.is_admin, true); assert.equal(b.user.is_admin, false);
  assert.equal((await call('POST', '/api/login', { name: 'diego', pin: '0000' })).status, 401);

  const comp = (await call('POST', '/api/admin/competitions', { name: 'Test' }, a.token)).data.id;
  assert.equal((await call('POST', '/api/admin/competitions', { name: 'x' }, b.token)).status, 403);
  const future = new Date(Date.now() + 86400e3).toISOString();
  const mid = (await call('POST', '/api/admin/matches', { comp_id: comp, home: 'Boca', away: 'River', kickoff: future }, a.token)).data.id;

  // Diego: 1-0 y 100 al local; Marcos: 0-2 y 300 al visitante
  assert.equal((await call('PUT', `/api/matches/${mid}/play`, { prediction: { home: 1, away: 0 }, bet: { pick: 'L', stake: 100 } }, a.token)).data.coins, 900);
  await call('PUT', `/api/matches/${mid}/play`, { prediction: { home: 0, away: 2 }, bet: { pick: 'V', stake: 300 } }, b.token);
  // cambiar la apuesta devuelve la anterior
  assert.equal((await call('PUT', `/api/matches/${mid}/play`, { bet: { pick: 'L', stake: 200 } }, a.token)).data.coins, 800);
  assert.equal((await call('PUT', `/api/matches/${mid}/play`, { bet: { pick: 'L', stake: 5000 } }, a.token)).status, 400);
  assert.equal((await call('GET', `/api/matches/${mid}/plays`, null, a.token)).status, 409); // oculto hasta que empiece

  const list = (await call('GET', '/api/matches', null, a.token)).data;
  assert.equal(list[0].pool.L.total, 200); assert.equal(list[0].pool.V.total, 300);

  // termina 1-0 (el admin carga el resultado)
  await call('POST', `/api/admin/matches/${mid}/result`, { home: 1, away: 0 }, a.token);
  const rank = (await call('GET', '/api/ranking', null, a.token)).data.players;
  assert.equal(rank[0].name, 'Diego'); assert.equal(rank[0].coins, 800 + 500); // se lleva todo el pozo
  assert.equal(rank[0].points, 3); assert.equal(rank[1].coins, 700); assert.equal(rank[1].points, 0);
  // idempotente
  await call('POST', `/api/admin/matches/${mid}/result`, { home: 1, away: 0 }, a.token);
  assert.equal((await call('GET', '/api/me', null, a.token)).data.coins, 1300);
  assert.equal((await call('PUT', `/api/matches/${mid}/play`, { bet: null }, a.token)).status, 409);
  assert.equal((await call('GET', `/api/matches/${mid}/plays`, null, a.token)).data.length, 2);
});

test('partido cancelado devuelve las fichas', async () => {
  const a = (await call('POST', '/api/login', { name: 'Diego', pin: '1234' })).data;
  const comp = db.prepare('SELECT id FROM competitions LIMIT 1').get().id;
  const mid = (await call('POST', '/api/admin/matches', { comp_id: comp, home: 'X', away: 'Y', kickoff: new Date(Date.now() + 3600e3).toISOString() }, a.token)).data.id;
  const before = (await call('GET', '/api/me', null, a.token)).data.coins;
  await call('PUT', `/api/matches/${mid}/play`, { bet: { pick: 'E', stake: 50 } }, a.token);
  await call('POST', `/api/admin/matches/${mid}/result`, { cancel: true }, a.token);
  assert.equal((await call('GET', '/api/me', null, a.token)).data.coins, before);
});

test.after(() => server.close());
