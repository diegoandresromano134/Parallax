import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx, getSetting, setSetting } from './db.js';
import { START_COINS, MIN_STAKE } from './scoring.js';
import { settleMatch } from './settle.js';
import { discover, syncFixtures, refreshResults, startScheduler } from './sync.js';
import { seedDemo } from './demo.js';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const PORT = Number(process.env.PORT) || 3000;

// Código de invitación del grupo: solo quien lo tenga puede crear cuenta.
if (process.env.PRODE_CODE) setSetting('invite', process.env.PRODE_CODE);
else if (!getSetting('invite')) setSetting('invite', crypto.randomBytes(3).toString('hex'));
if (process.env.PRODE_DEMO) seedDemo();

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

// ---------- usuarios ----------
const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
const publicUser = (u) => ({ id: u.id, name: u.name, coins: u.coins, is_admin: !!u.is_admin });

function newSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id) VALUES (?,?)').run(token, userId);
  return token;
}
const attempts = new Map();
function throttle(key) {
  const now = Date.now(), a = (attempts.get(key) || []).filter((t) => now - t < 10 * 60e3);
  if (a.length >= 10) throw new HttpError(429, 'Demasiados intentos, probá en unos minutos');
  a.push(now); attempts.set(key, a);
}
function authUser(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const u = t && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t);
  if (!u) throw new HttpError(401, 'Sesión vencida');
  return u;
}

// ---------- partidos ----------
const isLocked = (m) => m.status !== 'scheduled' || new Date(m.kickoff) <= new Date();

function listMatches(user, q) {
  const results = q.get('scope') === 'results';
  const where = ['c.enabled=1'];
  const args = [user.id, user.id];
  if (q.get('comp')) { where.push('m.comp_id=?'); args.push(Number(q.get('comp'))); }
  where.push(results ? "m.status IN ('finished','cancelled')" : "m.status NOT IN ('finished','cancelled')");
  // próximos: incluye los de las últimas 4 h (en juego) y descarta restos viejos sin resultado
  if (!results) { where.push('m.kickoff > ?'); args.push(new Date(Date.now() - 4 * 3600e3).toISOString()); }
  const rows = db.prepare(`SELECT m.*, c.name AS comp_name,
      p.home AS p_home, p.away AS p_away, p.points AS p_points,
      b.pick AS b_pick, b.stake AS b_stake, b.payout AS b_payout
    FROM matches m JOIN competitions c ON c.id=m.comp_id
    LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=?
    LEFT JOIN bets b ON b.match_id=m.id AND b.user_id=?
    WHERE ${where.join(' AND ')} ORDER BY m.kickoff ${results ? 'DESC' : 'ASC'} LIMIT ${results ? 60 : 120}`).all(...args);
  if (!rows.length) return [];
  const pools = db.prepare(`SELECT match_id, pick, SUM(stake) AS total, COUNT(*) AS n FROM bets
    WHERE match_id IN (${rows.map(() => '?').join(',')}) GROUP BY match_id, pick`).all(...rows.map((r) => r.id));
  return rows.map((m) => ({
    id: m.id, comp_id: m.comp_id, comp: m.comp_name, round: m.round, home: m.home, away: m.away,
    home_badge: m.home_badge, away_badge: m.away_badge, kickoff: m.kickoff, status: m.status,
    home_goals: m.home_goals, away_goals: m.away_goals, locked: isLocked(m),
    pool: Object.fromEntries(['L', 'E', 'V'].map((k) => {
      const r = pools.find((p) => p.match_id === m.id && p.pick === k);
      return [k, { total: r?.total || 0, n: r?.n || 0 }];
    })),
    mine: {
      prediction: m.p_home == null ? null : { home: m.p_home, away: m.p_away, points: m.p_points },
      bet: m.b_pick ? { pick: m.b_pick, stake: m.b_stake, payout: m.b_payout } : null,
    },
  }));
}

function play(user, matchId, body) {
  return tx(() => {
    const m = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
    if (!m) throw new HttpError(404, 'Partido inexistente');
    if (isLocked(m)) throw new HttpError(409, 'El partido ya empezó: no se puede modificar');
    if (body.prediction !== undefined) {
      if (body.prediction === null) db.prepare('DELETE FROM predictions WHERE user_id=? AND match_id=?').run(user.id, m.id);
      else {
        const { home, away } = body.prediction;
        if (![home, away].every((n) => Number.isInteger(n) && n >= 0 && n <= 30)) throw bad('Resultado inválido');
        db.prepare(`INSERT INTO predictions(user_id, match_id, home, away) VALUES (?,?,?,?)
          ON CONFLICT(user_id, match_id) DO UPDATE SET home=excluded.home, away=excluded.away`).run(user.id, m.id, home, away);
      }
    }
    if (body.bet !== undefined) {
      const old = db.prepare('SELECT stake FROM bets WHERE user_id=? AND match_id=?').get(user.id, m.id);
      if (old) {
        db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(old.stake, user.id);
        db.prepare('DELETE FROM bets WHERE user_id=? AND match_id=?').run(user.id, m.id);
      }
      if (body.bet !== null) {
        const { pick, stake } = body.bet;
        if (!['L', 'E', 'V'].includes(pick)) throw bad('Elegí local, empate o visitante');
        if (!Number.isInteger(stake) || stake < MIN_STAKE) throw bad(`La apuesta mínima es ${MIN_STAKE} fichas`);
        const coins = db.prepare('SELECT coins FROM users WHERE id=?').get(user.id).coins;
        if (stake > coins) throw bad('No te alcanzan las fichas');
        db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(stake, user.id);
        db.prepare('INSERT INTO bets(user_id, match_id, pick, stake) VALUES (?,?,?,?)').run(user.id, m.id, pick, stake);
      }
    }
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
  });
}

function ranking() {
  return db.prepare(`SELECT u.id, u.name, u.coins,
      COALESCE((SELECT SUM(points) FROM predictions WHERE user_id=u.id), 0) AS points,
      (SELECT COUNT(*) FROM predictions WHERE user_id=u.id AND points=3) AS exact,
      (SELECT COUNT(*) FROM bets WHERE user_id=u.id AND payout IS NOT NULL AND payout>stake) AS bets_won,
      (SELECT COUNT(*) FROM bets WHERE user_id=u.id AND payout IS NOT NULL) AS bets_done
    FROM users u ORDER BY u.coins DESC, points DESC, u.name`).all();
}

// ---------- rutas ----------
const routes = [];
const route = (method, path, fn, admin = false, open = false) =>
  routes.push({ method, re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn, admin, open });

route('POST', '/api/register', async ({ body, ip }) => {
  throttle('reg:' + ip);
  const name = String(body.name || '').trim(), pin = String(body.pin || '');
  if (name.length < 2 || name.length > 20) throw bad('El nombre debe tener entre 2 y 20 letras');
  if (!/^\d{4,8}$/.test(pin)) throw bad('El PIN debe tener entre 4 y 8 números');
  if (String(body.code || '').trim().toLowerCase() !== getSetting('invite').toLowerCase()) throw bad('Código de grupo incorrecto');
  if (db.prepare('SELECT 1 FROM users WHERE name=?').get(name)) throw bad('Ese nombre ya está en uso');
  const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const salt = crypto.randomBytes(8).toString('hex');
  const id = Number(db.prepare('INSERT INTO users(name, salt, pin_hash, is_admin, coins) VALUES (?,?,?,?,?)')
    .run(name, salt, hashPin(pin, salt), first ? 1 : 0, START_COINS).lastInsertRowid);
  return { token: newSession(id), user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) };
}, false, true);

route('POST', '/api/login', async ({ body }) => {
  const name = String(body.name || '').trim();
  throttle('login:' + name.toLowerCase());
  const u = db.prepare('SELECT * FROM users WHERE name=?').get(name);
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPin(String(body.pin || ''), u.salt), 'hex'), Buffer.from(u.pin_hash, 'hex'));
  if (!ok) throw new HttpError(401, 'Nombre o PIN incorrectos');
  return { token: newSession(u.id), user: publicUser(u) };
}, false, true);

route('GET', '/api/me', ({ user }) => publicUser(user));
route('GET', '/api/competitions', () => db.prepare(`SELECT c.id, c.name, c.country FROM competitions c
  WHERE c.enabled=1 AND EXISTS (SELECT 1 FROM matches WHERE comp_id=c.id) ORDER BY c.country DESC, c.name`).all());
route('GET', '/api/matches', ({ user, url }) => listMatches(user, url.searchParams));
route('PUT', '/api/matches/:id/play', ({ user, params, body }) => play(user, Number(params.id), body));
route('GET', '/api/matches/:id/plays', ({ params }) => {
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(Number(params.id));
  if (!m) throw new HttpError(404, 'Partido inexistente');
  if (!isLocked(m)) throw new HttpError(409, 'Las jugadas se ven cuando empieza el partido');
  return db.prepare(`SELECT u.name, p.home, p.away, p.points, b.pick, b.stake, b.payout FROM users u
    LEFT JOIN predictions p ON p.user_id=u.id AND p.match_id=?1
    LEFT JOIN bets b ON b.user_id=u.id AND b.match_id=?1
    WHERE p.user_id IS NOT NULL OR b.user_id IS NOT NULL ORDER BY u.name`).all(m.id);
});
route('GET', '/api/ranking', () => ({ start: START_COINS, players: ranking() }));

// admin
route('GET', '/api/admin/overview', () => ({
  invite: getSetting('invite'),
  competitions: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM matches WHERE comp_id=c.id) AS matches
    FROM competitions c ORDER BY c.enabled DESC, c.country DESC, c.name`).all(),
  users: db.prepare('SELECT id, name, coins, is_admin FROM users ORDER BY name').all(),
}), true);
route('POST', '/api/admin/sync', async () => {
  const found = await discover();
  const report = await syncFixtures();
  const checked = await refreshResults();
  return { found, report, checked };
}, true);
route('PATCH', '/api/admin/competitions/:id', ({ params, body }) => {
  db.prepare('UPDATE competitions SET enabled=? WHERE id=?').run(body.enabled ? 1 : 0, Number(params.id));
  return { ok: true };
}, true);
route('POST', '/api/admin/competitions', ({ body }) => {
  const name = String(body.name || '').trim();
  if (!name) throw bad('Falta el nombre');
  return { id: Number(db.prepare('INSERT INTO competitions(name, country, enabled) VALUES (?,?,1)').run(name, 'Manual').lastInsertRowid) };
}, true);
route('POST', '/api/admin/matches', ({ body }) => {
  const kickoff = new Date(body.kickoff);
  if (!body.comp_id || !body.home || !body.away || isNaN(kickoff)) throw bad('Faltan datos del partido');
  const id = Number(db.prepare('INSERT INTO matches(comp_id, round, home, away, kickoff) VALUES (?,?,?,?,?)')
    .run(Number(body.comp_id), body.round || null, String(body.home).trim(), String(body.away).trim(), kickoff.toISOString()).lastInsertRowid);
  return { id };
}, true);
route('POST', '/api/admin/matches/:id/result', ({ params, body }) => tx(() => {
  const id = Number(params.id);
  if (body.cancel) db.prepare("UPDATE matches SET status='cancelled' WHERE id=? AND settled=0").run(id);
  else {
    const { home, away } = body;
    if (![home, away].every((n) => Number.isInteger(n) && n >= 0)) throw bad('Resultado inválido');
    db.prepare("UPDATE matches SET status='finished', home_goals=?, away_goals=? WHERE id=? AND settled=0").run(home, away, id);
  }
  return { settled: settleMatch(id) };
}), true);
route('POST', '/api/admin/users/:id/coins', ({ params, body }) => {
  const delta = Number(body.delta);
  if (!Number.isInteger(delta)) throw bad('Monto inválido');
  db.prepare('UPDATE users SET coins=MAX(0, coins+?) WHERE id=?').run(delta, Number(params.id));
  return { ok: true };
}, true);
route('POST', '/api/admin/users/:id/pin', ({ params, body }) => {
  if (!/^\d{4,8}$/.test(String(body.pin || ''))) throw bad('El PIN debe tener entre 4 y 8 números');
  const salt = crypto.randomBytes(8).toString('hex');
  db.prepare('UPDATE users SET salt=?, pin_hash=? WHERE id=?').run(salt, hashPin(String(body.pin), salt), Number(params.id));
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(params.id));
  return { ok: true };
}, true);

// ---------- servidor ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function serveStatic(url, res) {
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (rel.includes('..')) rel = '';
  let file = join(PUBLIC, rel || 'index.html');
  let data;
  try { data = await readFile(file); } catch { file = join(PUBLIC, 'index.html'); data = await readFile(file); }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Cache-Control': /sw\.js$|\.html$/.test(file) ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(data);
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 100_000) throw bad('Pedido demasiado grande'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw bad('JSON inválido'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (!url.pathname.startsWith('/api/')) return await serveStatic(url, res);
    for (const r of routes) {
      const mt = r.method === req.method && url.pathname.match(r.re);
      if (!mt) continue;
      const user = r.open ? null : authUser(req);
      if (r.admin && !user.is_admin) throw new HttpError(403, 'Solo para el administrador');
      const body = req.method === 'GET' ? {} : await readBody(req);
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      return send(200, await r.fn({ user, params: mt.groups || {}, body, url, ip }));
    }
    throw new HttpError(404, 'No existe');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e.status ? e.message : 'Error interno' });
  }
});

if (process.env.PRODE_NO_LISTEN !== '1') {
  server.listen(PORT, () => {
    console.log(`PRODE listo en http://localhost:${PORT}`);
    console.log(`Código de invitación del grupo: ${getSetting('invite')}`);
    console.log('El primer usuario que se registre queda como administrador.');
    if (!process.env.PRODE_DEMO && process.env.PRODE_SYNC !== '0') startScheduler();
  });
}
export { server };
