import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx } from './db.js';
import { START_COINS, MIN_STAKE } from './scoring.js';
import { settleMatch } from './settle.js';
import { discover, syncFixtures, refreshResults, startScheduler } from './sync.js';
import { seedDemo } from './demo.js';
import { validateAccount, validPassword, PASSWORD_MSG, validAvatar, MIN_AGE } from './validate.js';
import { standingsFor } from './standings.js';
import { kindFor, defaultFees, roundBoard, champBoard, settleRound, settleChampionship, splitPot } from './prizes.js';
import { publicKey, pull, flush, startNotifier, enqueueForUser } from './push.js';
import { apiKey, FREE_KEY, testSource } from './providers/thesportsdb.js';
import { getSetting, setSetting } from './db.js';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 90;
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
  const row = db.prepare(`SELECT mb.coins, g.* FROM memberships mb JOIN groups g ON g.id=mb.group_id
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
  return db.prepare(`SELECT g.id, g.name, g.color, g.code, mb.coins, (g.owner_id=?1) AS is_owner,
      (SELECT COUNT(*) FROM memberships WHERE group_id=g.id) AS members
    FROM memberships mb JOIN groups g ON g.id=mb.group_id WHERE mb.user_id=?1 ORDER BY mb.joined_at`)
    .all(user.id).map((g) => ({ ...g, is_owner: !!g.is_owner }));
}
const meBundle = (u) => ({
  user: publicUser(u), groups: myGroups(u),
  ...(u.is_admin && { admin_pending: db.prepare("SELECT COUNT(*) AS n FROM coin_requests WHERE status='pending'").get().n }),
});

// ---------- partidos ----------
const isLocked = (m) => m.status !== 'scheduled' || new Date(m.kickoff) <= new Date();

function listMatches(user, gid, q) {
  member(user, gid);
  const results = q.get('scope') === 'results';
  const where = ['c.enabled=1'];
  const args = [user.id, gid, user.id, gid, gid];
  if (q.get('comp')) { where.push('m.comp_id=?'); args.push(Number(q.get('comp'))); }
  where.push(results ? "m.status IN ('finished','cancelled')" : "m.status NOT IN ('finished','cancelled')");
  if (!results) { where.push('m.kickoff > ?'); args.push(new Date(Date.now() - 4 * 3600e3).toISOString()); }
  const rows = db.prepare(`SELECT m.*, c.name AS comp_name, c.kind AS comp_kind,
      p.home AS p_home, p.away AS p_away, p.points AS p_points,
      b.pick AS b_pick, b.stake AS b_stake, b.payout AS b_payout,
      (SELECT COUNT(*) FROM comments WHERE match_id=m.id AND group_id=?) AS n_comments
    FROM matches m JOIN competitions c ON c.id=m.comp_id
    LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=? AND p.group_id=?
    LEFT JOIN bets b ON b.match_id=m.id AND b.user_id=? AND b.group_id=?
    WHERE ${where.join(' AND ')} ORDER BY m.kickoff ${results ? 'DESC' : 'ASC'} LIMIT ${results ? 60 : 120}`)
    .all(args[4], args[0], args[1], args[2], args[3], ...args.slice(5));
  if (!rows.length) return [];
  const pools = db.prepare(`SELECT match_id, pick, SUM(stake) AS total, COUNT(*) AS n FROM bets
    WHERE group_id=? AND match_id IN (${rows.map(() => '?').join(',')}) GROUP BY match_id, pick`).all(gid, ...rows.map((r) => r.id));
  return rows.map((m) => ({
    id: m.id, comp_id: m.comp_id, comp: m.comp_name, kind: m.comp_kind, round: m.round, home: m.home, away: m.away,
    home_badge: m.home_badge, away_badge: m.away_badge, kickoff: m.kickoff, status: m.status,
    home_goals: m.home_goals, away_goals: m.away_goals, locked: isLocked(m), comments: m.n_comments,
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

function play(user, gid, matchId, body) {
  member(user, gid);
  return tx(() => {
    const m = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
    if (!m) throw new HttpError(404, 'Partido inexistente');
    if (isLocked(m)) throw new HttpError(409, 'El partido ya empezó: no se puede modificar');
    if (body.prediction !== undefined) {
      if (body.prediction === null) db.prepare('DELETE FROM predictions WHERE user_id=? AND group_id=? AND match_id=?').run(user.id, gid, m.id);
      else {
        const { home, away } = body.prediction;
        if (![home, away].every((n) => Number.isInteger(n) && n >= 0 && n <= 30)) throw bad('Resultado inválido');
        db.prepare(`INSERT INTO predictions(user_id, group_id, match_id, home, away) VALUES (?,?,?,?,?)
          ON CONFLICT(user_id, group_id, match_id) DO UPDATE SET home=excluded.home, away=excluded.away`).run(user.id, gid, m.id, home, away);
      }
    }
    if (body.bet) {
      const kind = db.prepare('SELECT kind FROM competitions WHERE id=?').get(m.comp_id).kind;
      if (kind === 'league') throw bad('En las ligas se juega por fecha: pronosticá los resultados y anotate al pozo de la fecha.');
    }
    if (body.bet !== undefined) {
      const old = db.prepare('SELECT stake FROM bets WHERE user_id=? AND group_id=? AND match_id=?').get(user.id, gid, m.id);
      if (old) {
        db.prepare('UPDATE memberships SET coins=coins+? WHERE user_id=? AND group_id=?').run(old.stake, user.id, gid);
        db.prepare('DELETE FROM bets WHERE user_id=? AND group_id=? AND match_id=?').run(user.id, gid, m.id);
      }
      if (body.bet !== null) {
        const { pick, stake } = body.bet;
        if (!['L', 'E', 'V'].includes(pick)) throw bad('Elegí local, empate o visitante');
        if (!Number.isInteger(stake) || stake < MIN_STAKE) throw bad(`La apuesta mínima es ${MIN_STAKE} fichas`);
        const coins = db.prepare('SELECT coins FROM memberships WHERE user_id=? AND group_id=?').get(user.id, gid).coins;
        if (stake > coins) throw bad('No te alcanzan las fichas');
        db.prepare('UPDATE memberships SET coins=coins-? WHERE user_id=? AND group_id=?').run(stake, user.id, gid);
        db.prepare('INSERT INTO bets(user_id, group_id, match_id, pick, stake) VALUES (?,?,?,?,?)').run(user.id, gid, m.id, pick, stake);
      }
    }
    return { coins: db.prepare('SELECT coins FROM memberships WHERE user_id=? AND group_id=?').get(user.id, gid).coins };
  });
}

/** Ranking del grupo. Con comp/round filtra por torneo y fecha: puntos y resultado neto de fichas. */
function ranking(gid, comp, round) {
  const players = db.prepare(`SELECT u.id, u.nick, u.avatar, u.color, u.fav_team, mb.coins,
      COALESCE((SELECT SUM(p.points) FROM predictions p JOIN matches m ON m.id=p.match_id
        WHERE p.user_id=u.id AND p.group_id=?1 AND (?2 IS NULL OR m.comp_id=?2) AND (?3 IS NULL OR m.round=?3)), 0) AS points,
      (SELECT COUNT(*) FROM predictions p JOIN matches m ON m.id=p.match_id
        WHERE p.user_id=u.id AND p.group_id=?1 AND p.points=3 AND (?2 IS NULL OR m.comp_id=?2) AND (?3 IS NULL OR m.round=?3)) AS exact,
      COALESCE((SELECT SUM(b.payout - b.stake) FROM bets b JOIN matches m ON m.id=b.match_id
        WHERE b.user_id=u.id AND b.group_id=?1 AND b.payout IS NOT NULL AND (?2 IS NULL OR m.comp_id=?2) AND (?3 IS NULL OR m.round=?3)), 0)
      + COALESCE((SELECT SUM(re.payout - re.fee) FROM round_entries re WHERE re.user_id=u.id AND re.group_id=?1 AND re.payout IS NOT NULL
        AND (?2 IS NULL OR re.comp_id=?2) AND (?3 IS NULL OR re.round=?3)), 0)
      + COALESCE((SELECT SUM(ce.payout - ce.fee) FROM champ_entries ce WHERE ce.user_id=u.id AND ce.group_id=?1 AND ce.payout IS NOT NULL
        AND (?2 IS NULL OR ce.comp_id=?2) AND ?3 IS NULL), 0) AS net
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
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 10 || amount > 1_000_000) throw bad('Pedí entre 10 y 1.000.000 de fichas');
  const open = db.prepare("SELECT COUNT(*) AS n FROM coin_requests WHERE user_id=? AND group_id=? AND status='pending'").get(user.id, g.id).n;
  if (open >= 3) throw bad('Ya tenés 3 pedidos esperando respuesta. Esperá a que el admin los resuelva.');
  const note = String(body.note || '').trim().slice(0, 200) || null;
  db.prepare('INSERT INTO coin_requests(user_id, group_id, amount, note) VALUES (?,?,?,?)').run(user.id, g.id, amount, note);
  const a = adminId();
  if (a) { enqueueForUser(a, 'Pedido de fichas', `${user.nick} pide ${amount} fichas en ${g.name}.`); flush(); }
  return { ok: true };
});
route('GET', '/api/groups/:gid/coin-requests', ({ user, params }) => {
  member(user, params.gid);
  return db.prepare(`SELECT id, amount, note, status, granted, created_at FROM coin_requests
    WHERE user_id=? AND group_id=? ORDER BY id DESC LIMIT 10`).all(user.id, Number(params.gid));
});
// ---------- premios: pozo por fecha (ligas) y del campeonato (copas) ----------
const now = () => new Date().toISOString();
function roundInfo(gid, userId, comp, round) {
  const ms = db.prepare('SELECT status, kickoff FROM matches WHERE comp_id=? AND round=?').all(comp.id, round);
  const first = ms.reduce((a, m) => (m.kickoff < a ? m.kickoff : a), ms[0].kickoff);
  const entries = db.prepare(`SELECT e.user_id, e.fee, e.payout, u.nick, u.avatar, u.color FROM round_entries e JOIN users u ON u.id=e.user_id
    WHERE e.group_id=? AND e.comp_id=? AND e.round=?`).all(gid, comp.id, round);
  const settled = !!db.prepare('SELECT 1 FROM round_settled WHERE group_id=? AND comp_id=? AND round=?').get(gid, comp.id, round);
  const nickOf = new Map(entries.map((e) => [e.user_id, e]));
  const board = roundBoard(gid, comp.id, round).map((b) => ({ ...b, nick: nickOf.get(b.user_id).nick, avatar: nickOf.get(b.user_id).avatar, color: nickOf.get(b.user_id).color, payout: nickOf.get(b.user_id).payout }));
  return {
    comp_id: comp.id, comp: comp.name, round, fee: comp.entry_fee, first_kickoff: first,
    can_join: !settled && first > now() && ms.every((m) => m.status === 'scheduled'), settled,
    matches: ms.length, finished: ms.filter((m) => m.status === 'finished').length,
    pot: entries.reduce((s, e) => s + e.fee, 0), players: entries.length, joined: entries.some((e) => e.user_id === userId), board,
  };
}
function champInfo(gid, userId, comp) {
  const entries = db.prepare('SELECT e.user_id, e.fee, e.payout FROM champ_entries e WHERE e.group_id=? AND e.comp_id=?').all(gid, comp.id);
  const users = new Map(db.prepare('SELECT id, nick, avatar, color FROM users').all().map((u) => [u.id, u]));
  const left = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND status NOT IN ('finished','cancelled')").get(comp.id).n;
  return {
    comp_id: comp.id, comp: comp.name, fee: comp.champ_fee, open: !!comp.champ_open && !comp.closed_at, closed: !!comp.closed_at, pending_matches: left,
    pot: entries.reduce((s, e) => s + e.fee, 0), players: entries.length, joined: entries.some((e) => e.user_id === userId),
    board: champBoard(gid, comp.id).map((b) => ({ ...b, nick: users.get(b.user_id).nick, avatar: users.get(b.user_id).avatar, color: users.get(b.user_id).color, payout: entries.find((e) => e.user_id === b.user_id)?.payout ?? null })),
  };
}
route('GET', '/api/groups/:gid/pots', ({ user, params }) => {
  const gid = Number(params.gid); member(user, gid);
  const comps = db.prepare('SELECT * FROM competitions WHERE enabled=1').all();
  const since = new Date(Date.now() - 21 * 864e5).toISOString(), until = new Date(Date.now() + 21 * 864e5).toISOString();
  const rounds = [], champs = [];
  for (const c of comps) {
    if (c.kind === 'league' && c.entry_fee > 0) {
      const rs = db.prepare(`SELECT round, MIN(kickoff) AS first FROM matches WHERE comp_id=? AND round IS NOT NULL GROUP BY round
        HAVING first > ? AND first < ? ORDER BY first`).all(c.id, since, until);
      for (const r of rs) rounds.push(roundInfo(gid, user.id, c, r.round));
    } else if (c.champ_fee > 0 && db.prepare('SELECT 1 FROM matches WHERE comp_id=?').get(c.id)) champs.push(champInfo(gid, user.id, c));
  }
  return { rounds, champs };
});
route('POST', '/api/groups/:gid/rounds/join', ({ user, params, body }) => {
  const gid = Number(params.gid); member(user, gid);
  return tx(() => {
    const comp = db.prepare("SELECT * FROM competitions WHERE id=? AND enabled=1 AND kind='league'").get(Number(body.comp_id));
    if (!comp || comp.entry_fee <= 0) throw bad('Ese torneo no tiene pozo por fecha');
    const info = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND round=?').get(comp.id, String(body.round));
    if (!info.n) throw bad('No existe esa fecha');
    const r = roundInfo(gid, user.id, comp, String(body.round));
    if (r.joined) throw bad('Ya estás anotado en esta fecha');
    if (!r.can_join) throw bad('La inscripción cerró: la fecha ya empezó');
    const coins = db.prepare('SELECT coins FROM memberships WHERE user_id=? AND group_id=?').get(user.id, gid).coins;
    if (coins < comp.entry_fee) throw bad(`Necesitás ${comp.entry_fee} fichas para anotarte. Pedile fichas al admin.`);
    db.prepare('UPDATE memberships SET coins=coins-? WHERE user_id=? AND group_id=?').run(comp.entry_fee, user.id, gid);
    db.prepare('INSERT INTO round_entries(group_id, comp_id, round, user_id, fee) VALUES (?,?,?,?,?)').run(gid, comp.id, String(body.round), user.id, comp.entry_fee);
    return { ok: true };
  });
});
route('POST', '/api/groups/:gid/rounds/leave', ({ user, params, body }) => {
  const gid = Number(params.gid); member(user, gid);
  return tx(() => {
    const comp = db.prepare('SELECT * FROM competitions WHERE id=?').get(Number(body.comp_id));
    const e = comp && db.prepare('SELECT * FROM round_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').get(gid, comp.id, String(body.round), user.id);
    if (!e) throw bad('No estabas anotado');
    if (!roundInfo(gid, user.id, comp, String(body.round)).can_join) throw bad('La fecha ya empezó: no se puede salir');
    db.prepare('DELETE FROM round_entries WHERE group_id=? AND comp_id=? AND round=? AND user_id=?').run(gid, comp.id, e.round, user.id);
    db.prepare('UPDATE memberships SET coins=coins+? WHERE user_id=? AND group_id=?').run(e.fee, user.id, gid);
    return { ok: true };
  });
});
route('POST', '/api/groups/:gid/champs/:cid/join', ({ user, params }) => {
  const gid = Number(params.gid); member(user, gid);
  return tx(() => {
    const comp = db.prepare('SELECT * FROM competitions WHERE id=? AND enabled=1').get(Number(params.cid));
    if (!comp || comp.champ_fee <= 0) throw bad('Ese torneo no tiene pozo de campeonato');
    if (!comp.champ_open || comp.closed_at) throw bad('La inscripción al campeonato está cerrada');
    if (db.prepare('SELECT 1 FROM champ_entries WHERE group_id=? AND comp_id=? AND user_id=?').get(gid, comp.id, user.id)) throw bad('Ya estás anotado en el campeonato');
    const coins = db.prepare('SELECT coins FROM memberships WHERE user_id=? AND group_id=?').get(user.id, gid).coins;
    if (coins < comp.champ_fee) throw bad(`Necesitás ${comp.champ_fee} fichas para anotarte. Pedile fichas al admin.`);
    db.prepare('UPDATE memberships SET coins=coins-? WHERE user_id=? AND group_id=?').run(comp.champ_fee, user.id, gid);
    db.prepare('INSERT INTO champ_entries(group_id, comp_id, user_id, fee, joined_at) VALUES (?,?,?,?,?)').run(gid, comp.id, user.id, comp.champ_fee, now());
    return { ok: true };
  });
});
route('GET', '/api/groups/:gid/ranking', ({ user, params, url }) => {
  member(user, params.gid);
  const comp = url.searchParams.get('comp') ? Number(url.searchParams.get('comp')) : null;
  const round = url.searchParams.get('round') || null;
  return { filtered: !!(comp || round), players: ranking(Number(params.gid), comp, round) };
});

// torneos, partidos y juego
route('GET', '/api/competitions', () => {
  const comps = db.prepare(`SELECT c.id, c.name, c.country, c.kind, c.entry_fee, c.champ_fee FROM competitions c
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
  return db.prepare(`SELECT u.nick, u.avatar, u.color, p.home, p.away, p.points, b.pick, b.stake, b.payout
    FROM memberships mb JOIN users u ON u.id=mb.user_id
    LEFT JOIN predictions p ON p.user_id=u.id AND p.group_id=mb.group_id AND p.match_id=?1
    LEFT JOIN bets b ON b.user_id=u.id AND b.group_id=mb.group_id AND b.match_id=?1
    WHERE mb.group_id=?2 AND (p.user_id IS NOT NULL OR b.user_id IS NOT NULL) ORDER BY u.nick`).all(m.id, gid);
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
  return { key_set: k !== FREE_KEY, hint: k !== FREE_KEY ? '••••' + k.slice(-4) : null, from: getSetting('thesportsdb_key') ? 'panel' : process.env.THESPORTSDB_KEY ? 'variable de entorno' : 'gratuita' };
};
route('GET', '/api/admin/overview', () => ({
  competitions: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM matches WHERE comp_id=c.id) AS matches
    FROM competitions c ORDER BY c.enabled DESC, c.country DESC, c.name`).all().map(({ standings_json, ...c }) => c),
  users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  groups: db.prepare('SELECT id, name, code FROM groups ORDER BY name').all().map((g) => ({
    ...g, members: db.prepare(`SELECT u.id, u.nick, mb.coins FROM memberships mb JOIN users u ON u.id=mb.user_id WHERE mb.group_id=? ORDER BY u.nick`).all(g.id) })),
  pending: db.prepare("SELECT COUNT(*) AS n FROM coin_requests WHERE status='pending'").get().n,
  source: sourceInfo(),
}), { admin: true });
route('POST', '/api/admin/settings', ({ body }) => {
  if (body.thesportsdb_key !== undefined) {
    const k = String(body.thesportsdb_key).trim();
    if (k && !/^[A-Za-z0-9_-]{3,80}$/.test(k)) throw bad('La clave tiene caracteres que no corresponden');
    setSetting('thesportsdb_key', k);
  }
  return sourceInfo();
}, { admin: true });
route('POST', '/api/admin/test-source', async () => {
  try { return { ok: true, ...(await testSource()) }; } catch (e) { return { ok: false, error: e.message }; }
}, { admin: true });

route('GET', '/api/admin/coin-requests', () => db.prepare(`SELECT r.id, r.amount, r.note, r.created_at, u.nick, u.id AS user_id, g.name AS group_name, g.id AS group_id,
    (SELECT coins FROM memberships WHERE user_id=r.user_id AND group_id=r.group_id) AS coins
  FROM coin_requests r JOIN users u ON u.id=r.user_id JOIN groups g ON g.id=r.group_id
  WHERE r.status='pending' ORDER BY r.id`).all(), { admin: true });

function grantCoins(userId, groupId, amount, reason) {
  const mb = db.prepare('SELECT coins FROM memberships WHERE user_id=? AND group_id=?').get(userId, groupId);
  if (!mb) throw bad('Ese jugador no está en ese grupo');
  if (mb.coins + amount < 0) throw bad('No se pueden dejar fichas en negativo');
  db.prepare('UPDATE memberships SET coins=coins+? WHERE user_id=? AND group_id=?').run(amount, userId, groupId);
  db.prepare('INSERT INTO coin_log(user_id, group_id, amount, reason) VALUES (?,?,?,?)').run(userId, groupId, amount, reason);
}
route('POST', '/api/admin/coin-requests/:id', ({ params, body }) => {
  const r = db.prepare("SELECT * FROM coin_requests WHERE id=? AND status='pending'").get(Number(params.id));
  if (!r) throw new HttpError(404, 'Ese pedido ya fue resuelto');
  const g = db.prepare('SELECT name FROM groups WHERE id=?').get(r.group_id);
  if (body.action === 'approve') {
    const amount = body.amount === undefined ? r.amount : Number(body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) throw bad('Monto inválido');
    tx(() => {
      grantCoins(r.user_id, r.group_id, amount, `Pedido #${r.id}`);
      db.prepare("UPDATE coin_requests SET status='approved', granted=?, resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(amount, r.id);
    });
    enqueueForUser(r.user_id, 'Fichas cargadas', `Te cargaron ${amount} fichas en ${g.name}.`);
  } else if (body.action === 'reject') {
    db.prepare("UPDATE coin_requests SET status='rejected', resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(r.id);
    enqueueForUser(r.user_id, 'Pedido de fichas', `Tu pedido de ${r.amount} fichas en ${g.name} no fue aprobado.`);
  } else throw bad('Acción inválida');
  flush();
  return { ok: true };
}, { admin: true });
route('POST', '/api/admin/grant', ({ body }) => {
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) throw bad('Monto inválido');
  tx(() => grantCoins(Number(body.user_id), Number(body.group_id), amount, String(body.reason || 'Carga directa').slice(0, 100)));
  if (amount > 0) { enqueueForUser(Number(body.user_id), 'Fichas cargadas', `Te cargaron ${amount} fichas.`); flush(); }
  return { ok: true };
}, { admin: true });
route('GET', '/api/admin/ledger', () => db.prepare(`SELECT l.id, l.amount, l.reason, l.created_at, u.nick, g.name AS group_name
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
  const fee = (v, cur) => { if (v === undefined) return cur; const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw bad('Monto inválido'); return n; };
  if (body.kind !== undefined && !['league', 'cup'].includes(body.kind)) throw bad('Tipo inválido');
  db.prepare('UPDATE competitions SET enabled=?, kind=?, entry_fee=?, champ_fee=?, champ_open=? WHERE id=?').run(
    body.enabled === undefined ? c.enabled : body.enabled ? 1 : 0, body.kind ?? c.kind, fee(body.entry_fee, c.entry_fee), fee(body.champ_fee, c.champ_fee),
    body.champ_open === undefined ? c.champ_open : body.champ_open ? 1 : 0, id);
  return { ok: true };
}, { admin: true });
route('GET', '/api/admin/pots', () => {
  const rounds = db.prepare(`SELECT e.group_id, g.name AS group_name, e.comp_id, c.name AS comp, e.round, COUNT(*) AS players, SUM(e.fee) AS pot,
    (SELECT COUNT(*) FROM matches m WHERE m.comp_id=e.comp_id AND m.round=e.round AND m.status NOT IN ('finished','cancelled')) AS pending
    FROM round_entries e JOIN groups g ON g.id=e.group_id JOIN competitions c ON c.id=e.comp_id
    WHERE NOT EXISTS (SELECT 1 FROM round_settled s WHERE s.group_id=e.group_id AND s.comp_id=e.comp_id AND s.round=e.round)
    GROUP BY e.group_id, e.comp_id, e.round ORDER BY c.name, e.round`).all();
  const champs = db.prepare(`SELECT c.id AS comp_id, c.name AS comp, c.champ_open, COUNT(e.user_id) AS players, COALESCE(SUM(e.fee),0) AS pot, COUNT(DISTINCT e.group_id) AS groups,
    (SELECT COUNT(*) FROM matches m WHERE m.comp_id=c.id AND m.status NOT IN ('finished','cancelled')) AS pending
    FROM competitions c LEFT JOIN champ_entries e ON e.comp_id=c.id WHERE c.closed_at IS NULL AND c.champ_fee>0 AND c.enabled=1 GROUP BY c.id`).all();
  return { rounds, champs };
}, { admin: true });
route('POST', '/api/admin/rounds/close', ({ body }) => {
  const done = tx(() => settleRound(Number(body.group_id), Number(body.comp_id), String(body.round), true));
  flush(); return { settled: done };
}, { admin: true });
route('POST', '/api/admin/competitions/:id/close', ({ params }) => {
  const done = tx(() => settleChampionship(Number(params.id)));
  flush(); return { settled: done };
}, { admin: true });
route('POST', '/api/admin/competitions', ({ body }) => {
  const name = String(body.name || '').trim();
  if (!name) throw bad('Falta el nombre');
  const kind = body.kind === 'cup' ? 'cup' : body.kind === 'league' ? 'league' : kindFor(name), fees = defaultFees(kind);
  return { id: Number(db.prepare('INSERT INTO competitions(name, country, enabled, kind, entry_fee, champ_fee) VALUES (?,?,1,?,?,?)').run(name, 'Manual', kind, fees.entry_fee, fees.champ_fee).lastInsertRowid) };
}, { admin: true });
route('POST', '/api/admin/matches', ({ body }) => {
  const kickoff = new Date(body.kickoff);
  if (!body.comp_id || !body.home || !body.away || isNaN(kickoff)) throw bad('Faltan datos del partido');
  const id = Number(db.prepare('INSERT INTO matches(comp_id, round, home, away, kickoff) VALUES (?,?,?,?,?)')
    .run(Number(body.comp_id), body.round || null, String(body.home).trim(), String(body.away).trim(), kickoff.toISOString()).lastInsertRowid);
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
