import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx } from './db.js';
import { START_COINS, outcome } from './scoring.js';
import { settleMatch } from './settle.js';
import { discover, syncFixtures, refreshResults, startScheduler } from './sync.js';
import { seedDemo } from './demo.js';
import { validateAccount, validPassword, PASSWORD_MSG, validAvatar, MIN_AGE } from './validate.js';
import { standingsFor } from './standings.js';
import { kindFor, defaultFees, roundBoard, redBoard, carryOf, settleRound, settleChampionship, credit, balance, validColor, COLOR_ES, COLOR_ICON, commissionPct, splitFee, takeCommission, dropCommission, refGreen, refRed, refGold } from './prizes.js';
import { publicKey, pull, flush, startNotifier, enqueueForUser } from './push.js';
import { apiKey, FREE_KEY, testSource } from './providers/thesportsdb.js';
import { getSetting, setSetting } from './db.js';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 90;
const MAX_COINS = 10_000_000;
const GROUP_COLORS = ['#f5c542', '#ff9f43', '#4cc9f0', '#ff7eb6', '#b6e63e', '#b79cff', '#ff6b6b', '#e8eef0'];

if (process.env.PRODE_DEMO) seedDemo();

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

// ---------- cuentas ----------
const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');
const sameHash = (a, b) => crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const publicUser = (u) => ({
  id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, nick: u.nick,
  birth_date: u.birth_date, fav_team: u.fav_team, avatar: u.avatar, color: u.color, is_admin: !!u.is_admin,
});
const userById = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);

// ---------- administrador único ----------
// Hay UN solo admin: la cuenta de PRODE_ADMIN_EMAIL, creada por el servidor con PRODE_ADMIN_PASSWORD.
// Nadie puede registrarse con ese mail ni volverse admin. Sin esas variables (solo para probar en la
// compu) el primer usuario registrado queda como admin.
const ADMIN_EMAIL = (process.env.PRODE_ADMIN_EMAIL || '').trim().toLowerCase();
function bootstrapAdmin() {
  if (!ADMIN_EMAIL) {
    console.log('⚠️  Falta PRODE_ADMIN_EMAIL: el primer usuario que se registre será admin. Configuralo antes de publicar la app.');
    return;
  }
  const pass = process.env.PRODE_ADMIN_PASSWORD || '';
  if (!validPassword(pass)) throw new Error('PRODE_ADMIN_PASSWORD es obligatoria (8 o más caracteres, con letras y números)');
  const salt = crypto.randomBytes(8).toString('hex');
  const cur = db.prepare('SELECT * FROM users WHERE email=?').get(ADMIN_EMAIL);
  if (!cur) {
    db.prepare(`INSERT INTO users(email, salt, pass_hash, first_name, last_name, nick, birth_date, color, is_admin)
      VALUES (?,?,?,?,?,?,?,?,1)`).run(ADMIN_EMAIL, salt, hashPass(pass, salt), 'Administrador', 'PRODE', 'Admin', '1990-01-01', GROUP_COLORS[0]);
  } else if (!sameHash(hashPass(pass, cur.salt), cur.pass_hash)) {
    db.prepare('UPDATE users SET salt=?, pass_hash=? WHERE id=?').run(salt, hashPass(pass, salt), cur.id); // la variable manda
  }
  db.prepare('UPDATE users SET is_admin = (email = ?)').run(ADMIN_EMAIL);
}
const adminId = () => db.prepare('SELECT id FROM users WHERE is_admin=1').get()?.id;

function newSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id) VALUES (?,?)').run(token, userId);
  return token;
}
bootstrapAdmin();
const attempts = new Map();
function throttle(key, max = 10) {
  const now = Date.now(), a = (attempts.get(key) || []).filter((t) => now - t < 10 * 60e3);
  if (a.length >= max) throw new HttpError(429, 'Demasiados intentos, probá en unos minutos');
  a.push(now); attempts.set(key, a);
}
function authUser(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const u = t && db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.created_at > datetime('now', ?)`).get(t, `-${SESSION_DAYS} days`);
  if (!u) throw new HttpError(401, 'Sesión vencida');
  return u;
}

// ---------- grupos ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    const c = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    if (!db.prepare('SELECT 1 FROM groups WHERE code=?').get(c)) return c;
  }
}
const cleanColor = (c) => (GROUP_COLORS.includes(c) ? c : GROUP_COLORS[0]);
function createGroup(user, name, color) {
  name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (name.length < 2) throw bad('Poné un nombre para el grupo');
  return tx(() => {
    const id = Number(db.prepare('INSERT INTO groups(name, code, color, owner_id) VALUES (?,?,?,?)')
      .run(name, newCode(), cleanColor(color), user.id).lastInsertRowid);
    db.prepare('INSERT INTO memberships(user_id, group_id, coins) VALUES (?,?,?)').run(user.id, id, START_COINS);
    return id;
  });
}
function joinGroup(user, code) {
  const g = db.prepare('SELECT * FROM groups WHERE code=?').get(String(code || '').trim());
  if (!g) throw bad('No existe un grupo con ese código');
  db.prepare('INSERT OR IGNORE INTO memberships(user_id, group_id, coins) VALUES (?,?,?)').run(user.id, g.id, START_COINS);
  return g.id;
}
function member(user, gid) {
  const row = db.prepare(`SELECT mb.coins, mb.red_coins, mb.gold_coins, g.* FROM memberships mb JOIN groups g ON g.id=mb.group_id
    WHERE mb.user_id=? AND mb.group_id=?`).get(user.id, Number(gid));
  if (!row) throw new HttpError(403, 'No sos parte de ese grupo');
  return row;
}
function owner(user, gid) {
  const g = member(user, gid);
  if (g.owner_id !== user.id) throw new HttpError(403, 'Solo el creador del grupo puede hacer esto');
  return g;
}
function myGroups(user) {
  return db.prepare(`SELECT g.id, g.name, g.color, g.code, mb.coins, mb.red_coins, mb.gold_coins, (g.owner_id=?1) AS is_owner,
      (SELECT COUNT(*) FROM memberships WHERE group_id=g.id) AS members
    FROM memberships mb JOIN groups g ON g.id=mb.group_id WHERE mb.user_id=?1 ORDER BY mb.joined_at`)
    .all(user.id).map((g) => ({ ...g, is_owner: !!g.is_owner }));
}
const meBundle = (u) => ({
  user: publicUser(u), groups: myGroups(u),
  ...(u.is_admin && { admin_pending: db.prepare("SELECT (SELECT COUNT(*) FROM coin_requests WHERE status='pending') + (SELECT COUNT(*) FROM redemptions WHERE status='pending') AS n").get().n }),
});

// ---------- partidos ----------
const isLocked = (m) => m.status !== 'scheduled' || new Date(m.kickoff) <= new Date();

function listMatches(user, gid, q) {
  member(user, gid);
  const results = q.get('scope') === 'results';
  const where = ['c.enabled=1'], args = [gid, gid, user.id, gid, user.id, user.id, gid];
  if (q.get('comp')) { where.push('m.comp_id=?'); args.push(Number(q.get('comp'))); }
  where.push(results ? "m.status IN ('finished','cancelled')" : "m.status NOT IN ('finished','cancelled')");
  if (!results) { where.push('m.kickoff > ?'); args.push(new Date(Date.now() - 4 * 3600e3).toISOString()); }
  const rows = db.prepare(`SELECT m.*, c.name AS comp_name, c.kind AS comp_kind, c.entry_fee,
      p.pick AS p_pick, p.home AS p_home, p.away AS p_away, p.points AS p_points, p.exact AS p_exact,
      (SELECT COUNT(*) FROM comments WHERE match_id=m.id AND group_id=?) AS n_comments,
      EXISTS(SELECT 1 FROM round_entries e WHERE e.group_id=? AND e.comp_id=m.comp_id AND e.round=m.round AND e.user_id=?) AS enrolled,
      EXISTS(SELECT 1 FROM red_entries r WHERE r.group_id=? AND r.comp_id=m.comp_id AND r.round=m.round AND r.user_id=?) AS red_enrolled
    FROM matches m JOIN competitions c ON c.id=m.comp_id
    LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=? AND p.group_id=?
    WHERE ${where.join(' AND ')} ORDER BY m.kickoff ${results ? 'DESC' : 'ASC'} LIMIT ${results ? 60 : 120}`).all(...args);
  return rows.map((m) => ({
    id: m.id, comp_id: m.comp_id, comp: m.comp_name, kind: m.comp_kind, round: m.round, home: m.home, away: m.away,
    home_badge: m.home_badge, away_badge: m.away_badge, kickoff: m.kickoff, status: m.status,
    home_goals: m.home_goals, away_goals: m.away_goals, locked: isLocked(m), comments: m.n_comments,
    enrolled: !!m.enrolled, red_enrolled: !!m.red_enrolled, fee: m.entry_fee,
    mine: { pick: m.p_pick, prediction: m.p_home == null ? null : { home: m.p_home, away: m.p_away }, points: m.p_points, exact: m.p_exact },
  }));
}

// 🟢 el ganador (pick) exige estar anotado en la fecha con fichas verdes; 🔴 el marcador exacto exige además la inscripción roja.
function play(user, gid, matchId, body) {
  member(user, gid);
  if (body.bet !== undefined) throw bad('No hay apuestas por partido: se juega por fecha con pozo.');
  return tx(() => {
    const m = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
    if (!m) throw new HttpError(404, 'Partido inexistente');
    if (isLocked(m)) throw new HttpError(409, 'El partido ya empezó: no se puede modificar');
    const key = [user.id, gid, m.id];
    if (body.pick === null) { db.prepare('DELETE FROM predictions WHERE user_id=? AND group_id=? AND match_id=?').run(...key); return { ok: true }; }
    const green = db.prepare('SELECT 1 FROM round_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').get(gid, m.comp_id, m.round, user.id);
    const red = db.prepare('SELECT 1 FROM red_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').get(gid, m.comp_id, m.round, user.id);
    if (!green) throw new HttpError(403, 'Para pronosticar tenés que anotarte a la fecha con fichas verdes.');
    const cur = db.prepare('SELECT * FROM predictions WHERE user_id=? AND group_id=? AND match_id=?').get(...key);
    let pick = body.pick !== undefined ? body.pick : cur?.pick ?? null;
    let goals = body.prediction !== undefined ? body.prediction : cur?.home != null ? { home: cur.home, away: cur.away } : null;
    if (body.pick !== undefined && !['L', 'E', 'V'].includes(pick)) throw bad('Elegí quién gana: local, empate o visitante');
    if (goals) {
      if (![goals.home, goals.away].every((n) => Number.isInteger(n) && n >= 0 && n <= 30)) throw bad('Marcador inválido');
      if (!red) {
        if (body.prediction) throw new HttpError(403, 'Para pronosticar los goles exactos tenés que anotarte al pozo de goles con fichas rojas.');
        goals = null;
      }
    }
    if (!pick && goals) pick = outcome(goals.home, goals.away);
    if (pick && goals && outcome(goals.home, goals.away) !== pick) throw bad('El marcador no coincide con el ganador que elegiste');
    if (!pick && !goals) { db.prepare('DELETE FROM predictions WHERE user_id=? AND group_id=? AND match_id=?').run(...key); return { ok: true }; }
    db.prepare(`INSERT INTO predictions(user_id, group_id, match_id, pick, home, away) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id, group_id, match_id) DO UPDATE SET pick=excluded.pick, home=excluded.home, away=excluded.away`)
      .run(...key, pick, goals?.home ?? null, goals?.away ?? null);
    return { ok: true };
  });
}

/** Ranking del grupo. Con comp/round filtra por torneo y fecha: puntos y resultado neto de fichas. */
function ranking(gid, comp, round) {
  const players = db.prepare(`SELECT u.id, u.nick, u.avatar, u.color, u.fav_team, mb.coins,
      COALESCE((SELECT SUM(p.points) FROM predictions p JOIN matches m ON m.id=p.match_id
        WHERE p.user_id=u.id AND p.group_id=?1 AND (?2 IS NULL OR m.comp_id=?2) AND (?3 IS NULL OR m.round=?3)), 0) AS points,
      (SELECT COUNT(*) FROM predictions p JOIN matches m ON m.id=p.match_id
        WHERE p.user_id=u.id AND p.group_id=?1 AND p.exact=1 AND (?2 IS NULL OR m.comp_id=?2) AND (?3 IS NULL OR m.round=?3)) AS exact,
      COALESCE((SELECT SUM(re.payout - re.fee) FROM round_entries re WHERE re.user_id=u.id AND re.group_id=?1 AND re.payout IS NOT NULL
        AND (?2 IS NULL OR re.comp_id=?2) AND (?3 IS NULL OR re.round=?3)), 0)
       AS net
    FROM memberships mb JOIN users u ON u.id=mb.user_id WHERE mb.group_id=?1`).all(gid, comp, round);
  return players;
}

// ---------- rutas ----------
const routes = [];
const route = (method, path, fn, opts = {}) =>
  routes.push({ method, re: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn, ...opts });

route('GET', '/api/config', () => ({ min_age: MIN_AGE, colors: GROUP_COLORS, start_coins: START_COINS }), { open: true });

route('POST', '/api/register', ({ body, ip }) => {
  throttle('reg:' + ip, 20);
  const v = validateAccount(body);
  if (v.error) throw bad(v.error);
  if (!validPassword(body.password)) throw bad(PASSWORD_MSG);
  if (body.accept !== true) throw bad(`Tenés que confirmar que tenés ${MIN_AGE} años o más y aceptar las reglas`);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(v.value.email)) throw bad('Ya hay una cuenta con ese mail');
  if (/^admin/i.test(v.value.nick) || db.prepare('SELECT 1 FROM users WHERE nick=?').get(v.value.nick)) throw bad('Ese apodo ya está en uso, elegí otro');
  const code = String(body.code || '').trim();
  if (code && !db.prepare('SELECT 1 FROM groups WHERE code=?').get(code)) throw bad('No existe un grupo con ese código');
  const first = !ADMIN_EMAIL && !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const salt = crypto.randomBytes(8).toString('hex'), u = v.value;
  const id = Number(db.prepare(`INSERT INTO users(email, salt, pass_hash, first_name, last_name, nick, birth_date, fav_team, color, is_admin)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(u.email, salt, hashPass(body.password, salt), u.first_name, u.last_name, u.nick,
    u.birth_date, u.fav_team, GROUP_COLORS[id_mod(u.nick)], first ? 1 : 0).lastInsertRowid);
  const user = userById(id);
  if (code) joinGroup(user, code);
  return { token: newSession(id), ...meBundle(user) };
}, { open: true });
const id_mod = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % GROUP_COLORS.length;

route('POST', '/api/login', ({ body }) => {
  const email = String(body.email || '').trim().toLowerCase();
  throttle('login:' + email);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = u && sameHash(hashPass(String(body.password || ''), u.salt), u.pass_hash);
  if (!ok) throw new HttpError(401, 'Mail o contraseña incorrectos');
  return { token: newSession(u.id), ...meBundle(u) };
}, { open: true });

route('POST', '/api/logout', ({ req }) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run((req.headers.authorization || '').replace(/^Bearer /, ''));
  return { ok: true };
});
route('GET', '/api/me', ({ user }) => meBundle(user));
route('PATCH', '/api/me', ({ user, body }) => {
  const v = validateAccount({ ...userById(user.id), ...body });
  if (v.error) throw bad(v.error);
  if ((!user.is_admin && /^admin/i.test(v.value.nick)) || db.prepare('SELECT 1 FROM users WHERE nick=? AND id<>?').get(v.value.nick, user.id)) throw bad('Ese apodo ya está en uso, elegí otro');
  if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(v.value.email, user.id)) throw bad('Ya hay una cuenta con ese mail');
  const cur = userById(user.id);
  let avatar = cur.avatar;
  if (body.avatar !== undefined) { if (!validAvatar(body.avatar)) throw bad('La foto no es válida o es muy pesada'); avatar = body.avatar || null; }
  const color = GROUP_COLORS.includes(body.color) ? body.color : cur.color;
  const x = v.value;
  db.prepare(`UPDATE users SET email=?, first_name=?, last_name=?, nick=?, birth_date=?, fav_team=?, avatar=?, color=? WHERE id=?`)
    .run(x.email, x.first_name, x.last_name, x.nick, x.birth_date, x.fav_team, avatar, color, user.id);
  return meBundle(userById(user.id));
});
route('POST', '/api/me/password', ({ user, body }) => {
  if (!sameHash(hashPass(String(body.current || ''), user.salt), user.pass_hash)) throw bad('La contraseña actual no es correcta');
  if (!validPassword(body.password)) throw bad(PASSWORD_MSG);
  const salt = crypto.randomBytes(8).toString('hex');
  db.prepare('UPDATE users SET salt=?, pass_hash=? WHERE id=?').run(salt, hashPass(body.password, salt), user.id);
  return { ok: true };
});

// grupos
route('POST', '/api/groups', ({ user, body }) => ({ id: createGroup(user, body.name, body.color), ...meBundle(user) }));
route('POST', '/api/groups/join', ({ user, body }) => { const id = joinGroup(user, body.code); return { id, ...meBundle(user) }; });
route('PATCH', '/api/groups/:gid', ({ user, params, body }) => {
  const g = owner(user, params.gid);
  const name = String(body.name ?? g.name).trim().replace(/\s+/g, ' ').slice(0, 30);
  if (name.length < 2) throw bad('Poné un nombre para el grupo');
  db.prepare('UPDATE groups SET name=?, color=? WHERE id=?').run(name, cleanColor(body.color ?? g.color), g.id);
  return meBundle(user);
});
route('POST', '/api/groups/:gid/code', ({ user, params }) => {
  const g = owner(user, params.gid);
  db.prepare('UPDATE groups SET code=? WHERE id=?').run(newCode(), g.id);
  return meBundle(user);
});
route('POST', '/api/groups/:gid/leave', ({ user, params }) => {
  const g = member(user, params.gid);
  if (g.owner_id === user.id) throw bad('Sos el creador del grupo, no podés salir. Pasale la posta a alguien o dejalo.');
  db.prepare('DELETE FROM memberships WHERE user_id=? AND group_id=?').run(user.id, g.id);
  return meBundle(user);
});
route('GET', '/api/groups/:gid/members', ({ user, params }) => {
  member(user, params.gid);
  return db.prepare(`SELECT u.id, u.nick, u.avatar, u.color, u.fav_team, mb.coins, (g.owner_id=u.id) AS is_owner
    FROM memberships mb JOIN users u ON u.id=mb.user_id JOIN groups g ON g.id=mb.group_id
    WHERE mb.group_id=? ORDER BY u.nick`).all(Number(params.gid)).map((m) => ({ ...m, is_owner: !!m.is_owner }));
});
route('POST', '/api/groups/:gid/members/:uid/password', ({ user, params, body }) => {
  // Reemplaza al "olvidé mi contraseña" por mail: el creador del grupo da una clave temporal.
  owner(user, params.gid);
  if (!member({ id: Number(params.uid) }, params.gid)) throw bad('No es parte del grupo');
  if (userById(Number(params.uid))?.is_admin) throw new HttpError(403, 'No se puede cambiar la clave del administrador');
  if (!validPassword(body.password)) throw bad(PASSWORD_MSG);
  const salt = crypto.randomBytes(8).toString('hex');
  db.prepare('UPDATE users SET salt=?, pass_hash=? WHERE id=?').run(salt, hashPass(body.password, salt), Number(params.uid));
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(params.uid));
  return { ok: true };
});
// fichas: solo las carga el admin, a pedido
route('POST', '/api/groups/:gid/coin-requests', ({ user, params, body }) => {
  const g = member(user, params.gid);
  const amount = Number(body.amount), color = validColor(body.color || 'green');
  if (!color) throw bad('Elegí el color de fichas: verdes, rojas o doradas');
  if (!Number.isInteger(amount) || amount < 10 || amount > MAX_COINS) throw bad(`Pedí entre 10 y ${MAX_COINS.toLocaleString('es-AR')} fichas`);
  const open = db.prepare("SELECT COUNT(*) AS n FROM coin_requests WHERE user_id=? AND group_id=? AND status='pending'").get(user.id, g.id).n;
  if (open >= 3) throw bad('Ya tenés 3 pedidos esperando respuesta. Esperá a que el admin los resuelva.');
  const note = String(body.note || '').trim().slice(0, 200) || null;
  db.prepare('INSERT INTO coin_requests(user_id, group_id, amount, note, color) VALUES (?,?,?,?,?)').run(user.id, g.id, amount, note, color);
  const a = adminId();
  if (a) { enqueueForUser(a, 'Pedido de fichas', `${user.nick} pide ${amount.toLocaleString('es-AR')} fichas ${COLOR_ES[color]} ${COLOR_ICON[color]} en ${g.name}.`); flush(); }
  return { ok: true };
});
route('GET', '/api/groups/:gid/coin-requests', ({ user, params }) => {
  member(user, params.gid);
  return db.prepare(`SELECT id, amount, color, note, status, granted, created_at FROM coin_requests
    WHERE user_id=? AND group_id=? ORDER BY id DESC LIMIT 10`).all(user.id, Number(params.gid));
});
// ---------- premios con fichas de colores ----------
const now = () => new Date().toISOString();
const bare = (u) => ({ nick: u.nick, avatar: u.avatar, color: u.color });
function roundInfo(gid, userId, comp, round) {
  const ms = db.prepare('SELECT status, kickoff FROM matches WHERE comp_id=? AND round=?').all(comp.id, round);
  const first = ms.reduce((a, m) => (m.kickoff < a ? m.kickoff : a), ms[0].kickoff);
  const users = new Map(db.prepare('SELECT id, nick, avatar, color FROM users').all().map((u) => [u.id, u]));
  const entries = db.prepare('SELECT user_id, fee, COALESCE(pot, fee) AS pot, payout FROM round_entries WHERE group_id=? AND comp_id=? AND round=?').all(gid, comp.id, round);
  const reds = db.prepare('SELECT user_id, fee, COALESCE(pot, fee) AS pot, payout FROM red_entries WHERE group_id=? AND comp_id=? AND round=?').all(gid, comp.id, round);
  const settled = !!db.prepare('SELECT 1 FROM round_settled WHERE group_id=? AND comp_id=? AND round=?').get(gid, comp.id, round);
  const pay = (list, id) => list.find((e) => e.user_id === id)?.payout ?? null;
  const open = !settled && first > now() && ms.every((m) => m.status === 'scheduled');
  const joined = entries.some((e) => e.user_id === userId), redJoined = reds.some((e) => e.user_id === userId);
  return {
    comp_id: comp.id, comp: comp.name, round, fee: comp.entry_fee, first_kickoff: first,
    can_join: open, settled, matches: ms.length, finished: ms.filter((m) => m.status === 'finished').length,
    pot: entries.reduce((s, e) => s + e.pot, 0), players: entries.length, joined,
    board: roundBoard(gid, comp.id, round).map((b) => ({ ...b, ...bare(users.get(b.user_id)), payout: pay(entries, b.user_id) })),
    red: {
      fee: comp.red_fee, can_join: open && joined && !redJoined && comp.red_fee >= 0, joined: redJoined, players: reds.length,
      carry: carryOf(gid, comp.id), pot: reds.reduce((s, e) => s + e.pot, 0) + (settled ? 0 : carryOf(gid, comp.id)),
      board: redBoard(gid, comp.id, round).map((b) => ({ ...b, ...bare(users.get(b.user_id)), payout: pay(reds, b.user_id) })),
    },
  };
}
const teamsOf = (compId) => db.prepare('SELECT DISTINCT t FROM (SELECT home AS t FROM matches WHERE comp_id=?1 UNION SELECT away FROM matches WHERE comp_id=?1) ORDER BY t').all(compId).map((r) => r.t);
function champInfo(gid, userId, comp) {
  const entries = db.prepare(`SELECT e.user_id, e.fee, COALESCE(e.pot, e.fee) AS pot, e.payout, e.pick, u.nick, u.avatar, u.color FROM champ_entries e JOIN users u ON u.id=e.user_id
    WHERE e.group_id=? AND e.comp_id=? ORDER BY u.nick`).all(gid, comp.id);
  const closed = !!comp.closed_at, mine = entries.find((e) => e.user_id === userId);
  return {
    comp_id: comp.id, comp: comp.name, fee: comp.champ_fee, open: !!comp.champ_open && !closed, closed, champion: comp.champion || null,
    pending_matches: db.prepare("SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND status NOT IN ('finished','cancelled')").get(comp.id).n,
    pot: entries.reduce((s, e) => s + e.pot, 0), players: entries.length, joined: !!mine, my_pick: mine?.pick ?? null, teams: teamsOf(comp.id),
    // las elecciones de los demás se ven recién cuando el campeonato cierra, para que nadie copie
    picks: closed ? entries.map((e) => ({ nick: e.nick, avatar: e.avatar, color: e.color, pick: e.pick, payout: e.payout })) : [],
  };
}
/** Pozos acumulados del grupo (todo lo que está en juego ahora), por color. Alimenta los contadores en vivo. */
function jackpot(gid) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  if (gid === null) { // todos los grupos (para el admin)
    const sum = (t, extra = '') => one(`SELECT COALESCE(SUM(COALESCE(e.pot, e.fee)),0) AS pot, COUNT(*) AS n FROM ${t} e JOIN competitions c ON c.id=e.comp_id WHERE c.enabled=1 ${extra}`);
    const open = (t) => `AND NOT EXISTS (SELECT 1 FROM round_settled s WHERE s.group_id=e.group_id AND s.comp_id=e.comp_id AND s.round=e.round)`;
    const g = sum('round_entries', open()), r = sum('red_entries', open()), y = sum('champ_entries', 'AND c.closed_at IS NULL');
    const carry = one('SELECT COALESCE(SUM(amount),0) AS v FROM red_carry').v;
    return { green: { pot: g.pot, entries: g.n }, red: { pot: r.pot + carry, entries: r.n, carry }, gold: { pot: y.pot, entries: y.n } };
  }
  const g = one(`SELECT COALESCE(SUM(COALESCE(e.pot, e.fee)),0) AS pot, COUNT(*) AS n FROM round_entries e JOIN competitions c ON c.id=e.comp_id
    WHERE e.group_id=? AND c.enabled=1 AND NOT EXISTS (SELECT 1 FROM round_settled s WHERE s.group_id=e.group_id AND s.comp_id=e.comp_id AND s.round=e.round)`, gid);
  const r = one(`SELECT COALESCE(SUM(COALESCE(e.pot, e.fee)),0) AS pot, COUNT(*) AS n FROM red_entries e JOIN competitions c ON c.id=e.comp_id
    WHERE e.group_id=? AND c.enabled=1 AND NOT EXISTS (SELECT 1 FROM round_settled s WHERE s.group_id=e.group_id AND s.comp_id=e.comp_id AND s.round=e.round)`, gid);
  const carry = one('SELECT COALESCE(SUM(amount),0) AS v FROM red_carry WHERE group_id=?', gid).v;
  const y = one(`SELECT COALESCE(SUM(COALESCE(e.pot, e.fee)),0) AS pot, COUNT(*) AS n FROM champ_entries e JOIN competitions c ON c.id=e.comp_id
    WHERE e.group_id=? AND c.enabled=1 AND c.closed_at IS NULL`, gid);
  return { green: { pot: g.pot, entries: g.n }, red: { pot: r.pot + carry, entries: r.n, carry }, gold: { pot: y.pot, entries: y.n } };
}
route('GET', '/api/groups/:gid/pots', ({ user, params }) => {
  const gid = Number(params.gid); member(user, gid);
  const comps = db.prepare('SELECT * FROM competitions WHERE enabled=1').all();
  const since = new Date(Date.now() - 21 * 864e5).toISOString(), until = new Date(Date.now() + 21 * 864e5).toISOString();
  const rounds = [], champs = [];
  for (const c of comps) {
    const rs = db.prepare(`SELECT round, MIN(kickoff) AS first FROM matches WHERE comp_id=? AND round IS NOT NULL GROUP BY round
      HAVING first > ? AND first < ? ORDER BY first`).all(c.id, since, until);
    for (const r of rs) rounds.push(roundInfo(gid, user.id, c, r.round));
    if (c.champ_fee > 0 && db.prepare('SELECT 1 FROM matches WHERE comp_id=?').get(c.id)) champs.push(champInfo(gid, user.id, c));
  }
  return { rounds, champs, jackpot: jackpot(gid), commission_pct: commissionPct() };
});
const needCoins = (uid, gid, color, fee, what) => {
  if (balance(uid, gid, color) < fee) throw bad(`Necesitás ${fee.toLocaleString('es-AR')} fichas ${COLOR_ES[color]} ${COLOR_ICON[color]} para ${what}. Sin fichas no se puede jugar: pedíselas al admin.`);
};
const spend = (uid, gid, color, fee) => credit(uid, gid, color, -fee);

// 🟢 inscripción a la fecha (todos los partidos de la fecha, con ganador y resultado exacto)
route('POST', '/api/groups/:gid/rounds/join', ({ user, params, body }) => {
  const gid = Number(params.gid); member(user, gid);
  return tx(() => {
    const comp = db.prepare('SELECT * FROM competitions WHERE id=? AND enabled=1').get(Number(body.comp_id));
    if (!comp) throw bad('Ese torneo no existe');
    if (!db.prepare('SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND round=?').get(comp.id, String(body.round)).n) throw bad('No existe esa fecha');
    const r = roundInfo(gid, user.id, comp, String(body.round));
    if (r.joined) throw bad('Ya estás anotado en esta fecha');
    if (!r.can_join) throw bad('La inscripción cerró: la fecha ya empezó');
    needCoins(user.id, gid, 'green', comp.entry_fee, 'anotarte a la fecha');
    spend(user.id, gid, 'green', comp.entry_fee);
    const { pot, house } = splitFee(comp.entry_fee), round = String(body.round);
    db.prepare('INSERT INTO round_entries(group_id, comp_id, round, user_id, fee, pot) VALUES (?,?,?,?,?,?)').run(gid, comp.id, round, user.id, comp.entry_fee, pot);
    takeCommission(gid, comp.id, 'green', house, refGreen(gid, comp.id, round, user.id), `Comisión · ${comp.name} · ${round}`);
    return { ok: true };
  });
});
// 🔴 inscripción al pozo de goles de la fecha (hay que estar anotado en verde)
route('POST', '/api/groups/:gid/rounds/join-red', ({ user, params, body }) => {
  const gid = Number(params.gid); member(user, gid);
  return tx(() => {
    const comp = db.prepare('SELECT * FROM competitions WHERE id=? AND enabled=1').get(Number(body.comp_id));
    if (!comp) throw bad('Ese torneo no existe');
    if (!db.prepare('SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND round=?').get(comp.id, String(body.round)).n) throw bad('No existe esa fecha');
    const r = roundInfo(gid, user.id, comp, String(body.round));
    if (!r.joined) throw bad('Primero tenés que anotarte a la fecha con fichas verdes');
    if (r.red.joined) throw bad('Ya estás anotado en el pozo de goles');
    if (!r.can_join) throw bad('La inscripción cerró: la fecha ya empezó');
    needCoins(user.id, gid, 'red', comp.red_fee, 'anotarte al pozo de goles');
    spend(user.id, gid, 'red', comp.red_fee);
    const { pot, house } = splitFee(comp.red_fee), round = String(body.round);
    db.prepare('INSERT INTO red_entries(group_id, comp_id, round, user_id, fee, pot) VALUES (?,?,?,?,?,?)').run(gid, comp.id, round, user.id, comp.red_fee, pot);
    takeCommission(gid, comp.id, 'red', house, refRed(gid, comp.id, round, user.id), `Comisión pozo de goles · ${comp.name} · ${round}`);
    return { ok: true };
  });
});
// salir antes de que empiece la fecha: se devuelve lo pagado. Salir de verde también saca de roja.
route('POST', '/api/groups/:gid/rounds/leave', ({ user, params, body }) => {
  const gid = Number(params.gid); member(user, gid);
  return tx(() => {
    const comp = db.prepare('SELECT * FROM competitions WHERE id=?').get(Number(body.comp_id)), round = String(body.round);
    const e = comp && db.prepare('SELECT * FROM round_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').get(gid, comp.id, round, user.id);
    if (!e) throw bad('No estabas anotado');
    if (!roundInfo(gid, user.id, comp, round).can_join) throw bad('La fecha ya empezó: no se puede salir');
    const red = db.prepare('SELECT * FROM red_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').get(gid, comp.id, round, user.id);
    if (red) { dropCommission(refRed(gid, comp.id, round, user.id)); credit(user.id, gid, 'red', red.fee); db.prepare('DELETE FROM red_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').run(gid, comp.id, round, user.id); }
    db.prepare('DELETE FROM round_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').run(gid, comp.id, round, user.id);
    db.prepare('DELETE FROM predictions WHERE user_id=? AND group_id=? AND match_id IN (SELECT id FROM matches WHERE comp_id=? AND round=?)').run(user.id, gid, comp.id, round);
    dropCommission(refGreen(gid, comp.id, round, user.id));
    credit(user.id, gid, 'green', e.fee);
    return { ok: true };
  });
});
route('POST', '/api/groups/:gid/rounds/leave-red', ({ user, params, body }) => {
  const gid = Number(params.gid); member(user, gid);
  return tx(() => {
    const comp = db.prepare('SELECT * FROM competitions WHERE id=?').get(Number(body.comp_id)), round = String(body.round);
    const e = comp && db.prepare('SELECT * FROM red_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').get(gid, comp.id, round, user.id);
    if (!e) throw bad('No estabas anotado en el pozo de goles');
    if (!roundInfo(gid, user.id, comp, round).can_join) throw bad('La fecha ya empezó: no se puede salir');
    db.prepare('DELETE FROM red_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').run(gid, comp.id, round, user.id);
    db.prepare('UPDATE predictions SET home=NULL, away=NULL WHERE user_id=? AND group_id=? AND match_id IN (SELECT id FROM matches WHERE comp_id=? AND round=?)').run(user.id, gid, comp.id, round);
    dropCommission(refRed(gid, comp.id, round, user.id));
    credit(user.id, gid, 'red', e.fee);
    return { ok: true };
  });
});
// 🟡 elegir al campeón del torneo. Se puede cambiar la elección mientras la inscripción siga abierta.
route('POST', '/api/groups/:gid/champs/:cid/join', ({ user, params, body }) => {
  const gid = Number(params.gid); member(user, gid);
  return tx(() => {
    const comp = db.prepare('SELECT * FROM competitions WHERE id=? AND enabled=1').get(Number(params.cid));
    if (!comp || comp.champ_fee <= 0) throw bad('Ese torneo no tiene pozo del campeón');
    if (!comp.champ_open || comp.closed_at) throw bad('La inscripción al campeón está cerrada');
    const pick = String(body.pick || '').trim();
    if (!teamsOf(comp.id).includes(pick)) throw bad('Elegí un equipo de la lista');
    const mine = db.prepare('SELECT * FROM champ_entries WHERE group_id=? AND comp_id=? AND user_id=?').get(gid, comp.id, user.id);
    if (mine) { db.prepare('UPDATE champ_entries SET pick=? WHERE group_id=? AND comp_id=? AND user_id=?').run(pick, gid, comp.id, user.id); return { ok: true, changed: true }; }
    needCoins(user.id, gid, 'gold', comp.champ_fee, 'elegir al campeón');
    spend(user.id, gid, 'gold', comp.champ_fee);
    const { pot, house } = splitFee(comp.champ_fee);
    db.prepare('INSERT INTO champ_entries(group_id, comp_id, user_id, fee, pot, pick, joined_at) VALUES (?,?,?,?,?,?,?)').run(gid, comp.id, user.id, comp.champ_fee, pot, pick, now());
    takeCommission(gid, comp.id, 'gold', house, refGold(gid, comp.id, user.id), `Comisión campeón · ${comp.name}`);
    return { ok: true };
  });
});
// ---------- canje de fichas por premios (los define el admin) ----------
route('GET', '/api/rewards', () => db.prepare('SELECT id, title, description, cost, color FROM rewards WHERE active=1 ORDER BY cost').all());
route('GET', '/api/groups/:gid/redemptions', ({ user, params }) => {
  member(user, params.gid);
  return db.prepare('SELECT id, title, cost, color, status, created_at FROM redemptions WHERE user_id=? AND group_id=? ORDER BY id DESC LIMIT 10').all(user.id, Number(params.gid));
});
route('POST', '/api/groups/:gid/redeem', ({ user, params, body }) => {
  const gid = Number(params.gid), g = member(user, gid);
  const r = tx(() => {
    const rw = db.prepare('SELECT * FROM rewards WHERE id=? AND active=1').get(Number(body.reward_id));
    if (!rw) throw bad('Ese premio ya no está disponible');
    const coins = balance(user.id, gid, rw.color);
    if (coins < rw.cost) throw bad(`Te faltan ${(rw.cost - coins).toLocaleString('es-AR')} fichas ${COLOR_ES[rw.color]} para canjear este premio`);
    credit(user.id, gid, rw.color, -rw.cost);
    db.prepare('INSERT INTO redemptions(user_id, group_id, reward_id, title, cost, color) VALUES (?,?,?,?,?,?)').run(user.id, gid, rw.id, rw.title, rw.cost, rw.color);
    return rw;
  });
  const a = adminId();
  if (a) { enqueueForUser(a, 'Canje de fichas', `${user.nick} (${g.name}) canjeó "${r.title}" por ${r.cost.toLocaleString('es-AR')} fichas ${COLOR_ES[r.color]}.`); flush(); }
  return { ok: true };
});
route('GET', '/api/groups/:gid/ranking', ({ user, params, url }) => {
  member(user, params.gid);
  const comp = url.searchParams.get('comp') ? Number(url.searchParams.get('comp')) : null;
  const round = url.searchParams.get('round') || null;
  return { filtered: !!(comp || round), players: ranking(Number(params.gid), comp, round) };
});

// torneos, partidos y juego
route('GET', '/api/competitions', () => {
  const comps = db.prepare(`SELECT c.id, c.name, c.country, c.kind, c.entry_fee, c.red_fee, c.champ_fee FROM competitions c
    WHERE c.enabled=1 AND EXISTS (SELECT 1 FROM matches WHERE comp_id=c.id) ORDER BY c.country DESC, c.name`).all();
  const rounds = db.prepare(`SELECT comp_id, round, MIN(kickoff) AS first FROM matches WHERE round IS NOT NULL
    GROUP BY comp_id, round ORDER BY first`).all();
  return comps.map((c) => ({ ...c, rounds: rounds.filter((r) => r.comp_id === c.id).map((r) => r.round) }));
});
route('GET', '/api/competitions/:id/standings', ({ params }) => standingsFor(Number(params.id)) || (() => { throw new HttpError(404, 'Torneo inexistente'); })());
route('GET', '/api/matches', ({ user, url }) => listMatches(user, Number(url.searchParams.get('group')), url.searchParams));
route('PUT', '/api/matches/:id/play', ({ user, params, body, url }) => play(user, Number(url.searchParams.get('group')), Number(params.id), body));
route('GET', '/api/matches/:id/plays', ({ user, params, url }) => {
  const gid = Number(url.searchParams.get('group')); member(user, gid);
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(Number(params.id));
  if (!m) throw new HttpError(404, 'Partido inexistente');
  if (!isLocked(m)) throw new HttpError(409, 'Las jugadas se ven cuando empieza el partido');
  return db.prepare(`SELECT u.nick, u.avatar, u.color, p.pick, p.home, p.away, p.points, p.exact
    FROM predictions p JOIN users u ON u.id=p.user_id WHERE p.group_id=? AND p.match_id=? ORDER BY u.nick`).all(gid, m.id);
});
route('GET', '/api/matches/:id/comments', ({ user, params, url }) => {
  const gid = Number(url.searchParams.get('group')); member(user, gid);
  return db.prepare(`SELECT c.id, c.body, c.created_at, u.id AS user_id, u.nick, u.avatar, u.color FROM comments c
    JOIN users u ON u.id=c.user_id WHERE c.group_id=? AND c.match_id=? ORDER BY c.id DESC LIMIT 100`)
    .all(gid, Number(params.id)).reverse();
});
route('POST', '/api/matches/:id/comments', ({ user, params, body, url }) => {
  const gid = Number(url.searchParams.get('group')); member(user, gid);
  throttle(`cm:${user.id}`, 30);
  const text = String(body.body || '').trim().slice(0, 280);
  if (!text) throw bad('Escribí un comentario');
  if (!db.prepare('SELECT 1 FROM matches WHERE id=?').get(Number(params.id))) throw new HttpError(404, 'Partido inexistente');
  db.prepare('INSERT INTO comments(group_id, match_id, user_id, body) VALUES (?,?,?,?)').run(gid, Number(params.id), user.id, text);
  return { ok: true };
});
route('DELETE', '/api/comments/:id', ({ user, params }) => {
  const c = db.prepare('SELECT * FROM comments WHERE id=?').get(Number(params.id));
  if (!c) throw new HttpError(404, 'No existe');
  const g = db.prepare('SELECT owner_id FROM groups WHERE id=?').get(c.group_id);
  if (c.user_id !== user.id && g.owner_id !== user.id) throw new HttpError(403, 'No podés borrar este comentario');
  db.prepare('DELETE FROM comments WHERE id=?').run(c.id);
  return { ok: true };
});

// avisos
route('GET', '/api/push/key', () => ({ key: publicKey() }), { open: true });
route('POST', '/api/push/subscribe', ({ user, body }) => {
  const ep = String(body.endpoint || '');
  if (!/^https:\/\//.test(ep) || ep.length > 1000) throw bad('Suscripción inválida');
  db.prepare(`INSERT INTO push_subs(user_id, endpoint) VALUES (?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id`).run(user.id, ep);
  return { ok: true };
});
route('POST', '/api/push/unsubscribe', ({ user, body }) => {
  db.prepare('DELETE FROM push_subs WHERE user_id=? AND endpoint=?').run(user.id, String(body.endpoint || ''));
  return { ok: true };
});
// lo llama el service worker del celular cuando llega un aviso
route('POST', '/api/push/pull', ({ body }) => ({ messages: pull(String(body.endpoint || '')) }), { open: true });

// ---------- panel del administrador ----------
const sourceInfo = () => {
  const k = apiKey();
  return { commission_pct: commissionPct(), key_set: k !== FREE_KEY, hint: k !== FREE_KEY ? '••••' + k.slice(-4) : null, from: getSetting('thesportsdb_key') ? 'panel' : process.env.THESPORTSDB_KEY ? 'variable de entorno' : 'gratuita' };
};
route('GET', '/api/admin/overview', () => ({
  competitions: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM matches WHERE comp_id=c.id) AS matches
    FROM competitions c ORDER BY c.enabled DESC, c.country DESC, c.name`).all().map(({ standings_json, ...c }) => c),
  users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  groups: db.prepare('SELECT id, name, code FROM groups ORDER BY name').all().map((g) => ({
    ...g, members: db.prepare(`SELECT u.id, u.nick, mb.coins, mb.red_coins, mb.gold_coins FROM memberships mb JOIN users u ON u.id=mb.user_id WHERE mb.group_id=? ORDER BY u.nick`).all(g.id) })),
  pending: db.prepare("SELECT COUNT(*) AS n FROM coin_requests WHERE status='pending'").get().n,
  source: sourceInfo(),
}), { admin: true });
route('POST', '/api/admin/settings', ({ body }) => {
  if (body.thesportsdb_key !== undefined) {
    const k = String(body.thesportsdb_key).trim();
    if (k && !/^[A-Za-z0-9_-]{3,80}$/.test(k)) throw bad('La clave tiene caracteres que no corresponden');
    setSetting('thesportsdb_key', k);
  }
  if (body.commission_pct !== undefined) {
    const v = Number(body.commission_pct);
    if (!Number.isFinite(v) || v < 0 || v > 90) throw bad('La comisión debe estar entre 0% y 90%');
    setSetting('commission_pct', v); // vale para las inscripciones nuevas; las ya hechas conservan su reparto
  }
  return sourceInfo();
}, { admin: true });
// 💼 Caja del admin: comisiones cobradas y pozos que se quedó la casa, por color
route('GET', '/api/admin/jackpot', () => jackpot(null), { admin: true });
route('GET', '/api/admin/cash', () => {
  const tot = (kind) => Object.fromEntries(['green', 'red', 'gold'].map((c) => [c, db.prepare('SELECT COALESCE(SUM(amount),0) AS v FROM house_take WHERE kind=? AND color=?').get(kind, c).v]));
  return {
    commission_pct: commissionPct(), commission: tot('commission'), unclaimed: tot('unclaimed'),
    recent: db.prepare(`SELECT h.amount, h.color, h.kind, h.reason, h.created_at, g.name AS group_name FROM house_take h JOIN groups g ON g.id=h.group_id ORDER BY h.id DESC LIMIT 15`).all(),
  };
}, { admin: true });
route('POST', '/api/admin/test-source', async () => {
  try { return { ok: true, ...(await testSource()) }; } catch (e) { return { ok: false, error: e.message }; }
}, { admin: true });

route('GET', '/api/admin/coin-requests', () => db.prepare(`SELECT r.id, r.amount, r.color, r.note, r.created_at, u.nick, u.id AS user_id, g.name AS group_name, g.id AS group_id
  FROM coin_requests r JOIN users u ON u.id=r.user_id JOIN groups g ON g.id=r.group_id
  WHERE r.status='pending' ORDER BY r.id`).all().map((r) => ({ ...r, coins: balance(r.user_id, r.group_id, r.color) })), { admin: true });

function grantCoins(userId, groupId, amount, reason, color = 'green') {
  if (!validColor(color)) throw bad('Color de fichas inválido');
  if (!db.prepare('SELECT 1 FROM memberships WHERE user_id=? AND group_id=?').get(userId, groupId)) throw bad('Ese jugador no está en ese grupo');
  if (balance(userId, groupId, color) + amount < 0) throw bad('No se pueden dejar fichas en negativo');
  credit(userId, groupId, color, amount);
  db.prepare('INSERT INTO coin_log(user_id, group_id, amount, reason, color) VALUES (?,?,?,?,?)').run(userId, groupId, amount, reason, color);
}
route('POST', '/api/admin/coin-requests/:id', ({ params, body }) => {
  const r = db.prepare("SELECT * FROM coin_requests WHERE id=? AND status='pending'").get(Number(params.id));
  if (!r) throw new HttpError(404, 'Ese pedido ya fue resuelto');
  const g = db.prepare('SELECT name FROM groups WHERE id=?').get(r.group_id);
  if (body.action === 'approve') {
    const amount = body.amount === undefined ? r.amount : Number(body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_COINS) throw bad('Monto inválido');
    tx(() => {
      grantCoins(r.user_id, r.group_id, amount, `Pedido #${r.id}`, r.color);
      db.prepare("UPDATE coin_requests SET status='approved', granted=?, resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(amount, r.id);
    });
    enqueueForUser(r.user_id, 'Fichas cargadas', `Te cargaron ${amount.toLocaleString('es-AR')} fichas ${COLOR_ES[r.color]} ${COLOR_ICON[r.color]} en ${g.name}.`);
  } else if (body.action === 'reject') {
    db.prepare("UPDATE coin_requests SET status='rejected', resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(r.id);
    enqueueForUser(r.user_id, 'Pedido de fichas', `Tu pedido de ${r.amount.toLocaleString('es-AR')} fichas ${COLOR_ES[r.color]} en ${g.name} no fue aprobado.`);
  } else throw bad('Acción inválida');
  flush();
  return { ok: true };
}, { admin: true });
route('GET', '/api/admin/rewards', () => db.prepare('SELECT * FROM rewards ORDER BY active DESC, cost').all(), { admin: true });
const rewardFields = (b, cur = {}) => {
  const title = String(b.title ?? cur.title ?? '').trim().slice(0, 80), cost = Number(b.cost ?? cur.cost);
  if (title.length < 2) throw bad('Poné un nombre para el premio');
  if (!Number.isInteger(cost) || cost < 1 || cost > 100_000_000) throw bad('El costo en fichas es inválido');
  const color = validColor(b.color ?? cur.color ?? 'green');
  if (!color) throw bad('Color de fichas inválido');
  return { title, cost, color, description: String(b.description ?? cur.description ?? '').trim().slice(0, 300) || null };
};
route('POST', '/api/admin/rewards', ({ body }) => {
  const r = rewardFields(body);
  return { id: Number(db.prepare('INSERT INTO rewards(title, description, cost, color) VALUES (?,?,?,?)').run(r.title, r.description, r.cost, r.color).lastInsertRowid) };
}, { admin: true });
route('PATCH', '/api/admin/rewards/:id', ({ params, body }) => {
  const cur = db.prepare('SELECT * FROM rewards WHERE id=?').get(Number(params.id));
  if (!cur) throw new HttpError(404, 'Premio inexistente');
  const r = rewardFields(body, cur);
  db.prepare('UPDATE rewards SET title=?, description=?, cost=?, color=?, active=? WHERE id=?').run(r.title, r.description, r.cost, r.color, body.active === undefined ? cur.active : body.active ? 1 : 0, cur.id);
  return { ok: true };
}, { admin: true });
route('GET', '/api/admin/redemptions', () => db.prepare(`SELECT r.id, r.title, r.cost, r.color, r.created_at, u.nick, u.email, g.name AS group_name
  FROM redemptions r JOIN users u ON u.id=r.user_id JOIN groups g ON g.id=r.group_id WHERE r.status='pending' ORDER BY r.id`).all(), { admin: true });
route('POST', '/api/admin/redemptions/:id', ({ params, body }) => {
  const r = db.prepare("SELECT * FROM redemptions WHERE id=? AND status='pending'").get(Number(params.id));
  if (!r) throw new HttpError(404, 'Ese canje ya fue resuelto');
  if (body.action === 'deliver') {
    db.prepare("UPDATE redemptions SET status='delivered', resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(r.id);
    enqueueForUser(r.user_id, 'Premio entregado', `Tu canje de "${r.title}" fue marcado como entregado.`);
  } else if (body.action === 'reject') {
    tx(() => {
      credit(r.user_id, r.group_id, r.color, r.cost); // se devuelven las fichas
      db.prepare("UPDATE redemptions SET status='rejected', resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(r.id);
    });
    enqueueForUser(r.user_id, 'Canje rechazado', `Tu canje de "${r.title}" no se pudo hacer. Te devolvimos ${r.cost.toLocaleString('es-AR')} fichas ${COLOR_ES[r.color]}.`);
  } else throw bad('Acción inválida');
  flush();
  return { ok: true };
}, { admin: true });
route('POST', '/api/admin/grant', ({ body }) => {
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_COINS) throw bad('Monto inválido');
  const color = validColor(body.color || 'green');
  tx(() => grantCoins(Number(body.user_id), Number(body.group_id), amount, String(body.reason || 'Carga directa').slice(0, 100), color));
  if (amount > 0) { enqueueForUser(Number(body.user_id), 'Fichas cargadas', `Te cargaron ${amount.toLocaleString('es-AR')} fichas ${COLOR_ES[color]} ${COLOR_ICON[color]}.`); flush(); }
  return { ok: true };
}, { admin: true });
route('GET', '/api/admin/ledger', () => db.prepare(`SELECT l.id, l.amount, l.color, l.reason, l.created_at, u.nick, g.name AS group_name
  FROM coin_log l JOIN users u ON u.id=l.user_id JOIN groups g ON g.id=l.group_id ORDER BY l.id DESC LIMIT 40`).all(), { admin: true });
route('GET', '/api/admin/pending-matches', () => db.prepare(`SELECT m.id, m.home, m.away, m.kickoff, c.name AS comp
  FROM matches m JOIN competitions c ON c.id=m.comp_id WHERE m.settled=0 AND m.kickoff < ? ORDER BY m.kickoff`)
  .all(new Date().toISOString()), { admin: true });
route('GET', '/api/admin/users', () => db.prepare(`SELECT u.id, u.email, u.nick, u.first_name, u.last_name, u.birth_date, u.is_admin, u.created_at,
  (SELECT GROUP_CONCAT(g.name, ', ') FROM memberships mb JOIN groups g ON g.id=mb.group_id WHERE mb.user_id=u.id) AS groups
  FROM users u ORDER BY u.created_at DESC`).all(), { admin: true });
route('POST', '/api/admin/users/:id/password', ({ params, body }) => {
  if (!validPassword(body.password)) throw bad(PASSWORD_MSG);
  const salt = crypto.randomBytes(8).toString('hex');
  db.prepare('UPDATE users SET salt=?, pass_hash=? WHERE id=? AND is_admin=0').run(salt, hashPass(body.password, salt), Number(params.id));
  db.prepare('DELETE FROM sessions WHERE user_id=? AND user_id NOT IN (SELECT id FROM users WHERE is_admin=1)').run(Number(params.id));
  return { ok: true };
}, { admin: true });
route('POST', '/api/admin/sync', async () => {
  const found = await discover();
  const report = await syncFixtures();
  const checked = await refreshResults();
  return { found, report, checked };
}, { admin: true });
route('PATCH', '/api/admin/competitions/:id', ({ params, body }) => {
  const id = Number(params.id), c = db.prepare('SELECT * FROM competitions WHERE id=?').get(id);
  if (!c) throw new HttpError(404, 'Torneo inexistente');
  const fee = (v, cur) => { if (v === undefined) return cur; const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > MAX_COINS) throw bad('Monto inválido'); return n; };
  if (body.kind !== undefined && !['league', 'cup'].includes(body.kind)) throw bad('Tipo inválido');
  db.prepare('UPDATE competitions SET enabled=?, kind=?, entry_fee=?, red_fee=?, champ_fee=?, champ_open=? WHERE id=?').run(
    body.enabled === undefined ? c.enabled : body.enabled ? 1 : 0, body.kind ?? c.kind, fee(body.entry_fee, c.entry_fee), fee(body.red_fee, c.red_fee), fee(body.champ_fee, c.champ_fee),
    body.champ_open === undefined ? c.champ_open : body.champ_open ? 1 : 0, id);
  return { ok: true };
}, { admin: true });
route('GET', '/api/admin/pots', () => {
  const rounds = db.prepare(`SELECT e.group_id, g.name AS group_name, e.comp_id, c.name AS comp, e.round, COUNT(*) AS players, SUM(COALESCE(e.pot, e.fee)) AS pot,
    (SELECT COUNT(*) FROM matches m WHERE m.comp_id=e.comp_id AND m.round=e.round AND m.status NOT IN ('finished','cancelled')) AS pending
    , (SELECT COUNT(*) FROM red_entries r WHERE r.group_id=e.group_id AND r.comp_id=e.comp_id AND r.round=e.round) AS red_players
    FROM round_entries e JOIN groups g ON g.id=e.group_id JOIN competitions c ON c.id=e.comp_id
    WHERE NOT EXISTS (SELECT 1 FROM round_settled s WHERE s.group_id=e.group_id AND s.comp_id=e.comp_id AND s.round=e.round)
    GROUP BY e.group_id, e.comp_id, e.round ORDER BY c.name, e.round`).all();
  const champs = db.prepare(`SELECT c.id AS comp_id, c.name AS comp, c.champ_open, COUNT(e.user_id) AS players, COALESCE(SUM(COALESCE(e.pot, e.fee)),0) AS pot, COUNT(DISTINCT e.group_id) AS groups,
    (SELECT COUNT(*) FROM matches m WHERE m.comp_id=c.id AND m.status NOT IN ('finished','cancelled')) AS pending
    FROM competitions c LEFT JOIN champ_entries e ON e.comp_id=c.id WHERE c.closed_at IS NULL AND c.champ_fee>0 AND c.enabled=1 GROUP BY c.id`).all()
    .map((c) => ({ ...c, teams: teamsOf(c.comp_id) }));
  const house = db.prepare(`SELECT h.amount, h.color, h.reason, h.created_at, g.name AS group_name FROM house_take h JOIN groups g ON g.id=h.group_id WHERE h.kind='unclaimed' ORDER BY h.id DESC LIMIT 10`).all();
  return { rounds, champs, house };
}, { admin: true });
route('POST', '/api/admin/rounds/close', ({ body }) => {
  const done = tx(() => settleRound(Number(body.group_id), Number(body.comp_id), String(body.round), true));
  flush(); return { settled: done };
}, { admin: true });
route('POST', '/api/admin/competitions/:id/close', ({ params, body }) => {
  const id = Number(params.id), champion = String(body.champion || '').trim();
  if (!teamsOf(id).includes(champion)) throw bad('Elegí el campeón de la lista de equipos del torneo');
  const done = tx(() => settleChampionship(id, champion));
  flush(); return { settled: done };
}, { admin: true });
route('POST', '/api/admin/competitions', ({ body }) => {
  const name = String(body.name || '').trim();
  if (!name) throw bad('Falta el nombre');
  const kind = body.kind === 'cup' ? 'cup' : body.kind === 'league' ? 'league' : kindFor(name), fees = defaultFees();
  return { id: Number(db.prepare('INSERT INTO competitions(name, country, enabled, kind, entry_fee, red_fee, champ_fee) VALUES (?,?,1,?,?,?,?)').run(name, 'Manual', kind, fees.entry_fee, fees.red_fee, fees.champ_fee).lastInsertRowid) };
}, { admin: true });
route('POST', '/api/admin/matches', ({ body }) => {
  const kickoff = new Date(body.kickoff);
  if (!body.comp_id || !body.home || !body.away || isNaN(kickoff)) throw bad('Faltan datos del partido');
  const home = String(body.home).trim(), away = String(body.away).trim();
  const round = String(body.round || '').trim() || `${home} vs ${away} · ${kickoff.toISOString().slice(0, 10)}`;
  const id = Number(db.prepare('INSERT INTO matches(comp_id, round, home, away, kickoff) VALUES (?,?,?,?,?)')
    .run(Number(body.comp_id), round, home, away, kickoff.toISOString()).lastInsertRowid);
  return { id };
}, { admin: true });
route('POST', '/api/admin/matches/:id/result', async ({ params, body }) => {
  const id = Number(params.id);
  const settled = tx(() => {
    if (body.cancel) db.prepare("UPDATE matches SET status='cancelled' WHERE id=? AND settled=0").run(id);
    else {
      const { home, away } = body;
      if (![home, away].every((n) => Number.isInteger(n) && n >= 0)) throw bad('Resultado inválido');
      db.prepare("UPDATE matches SET status='finished', home_goals=?, away_goals=? WHERE id=? AND settled=0").run(home, away, id);
    }
    return settleMatch(id);
  });
  flush();
  return { settled };
}, { admin: true });

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
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 150_000) throw bad('Pedido demasiado grande'); chunks.push(c); }
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
      return send(200, await r.fn({ req, user, params: mt.groups || {}, body, url, ip }));
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
    console.log(ADMIN_EMAIL ? `Administrador: ${ADMIN_EMAIL}` : 'Sin PRODE_ADMIN_EMAIL: el primer usuario que se registre queda como administrador.');
    startNotifier();
    if (!process.env.PRODE_DEMO && process.env.PRODE_SYNC !== '0') startScheduler();
  });
}
export { server };
