// Premios en fichas.
//  - Ligas: pozo por FECHA. Se anotan antes de que empiece la fecha; gana quien suma más puntos
//    en todos los partidos de esa fecha (desempate: más resultados exactos, luego menos goles errados).
//  - Copas: premio por partido (apuestas a pozo, ver settle.js) y pozo del CAMPEONATO por puntos acumulados.
import { db } from './db.js';
import { enqueueForUser } from './push.js';

export const CUP_RE = /libertadores|sudamericana|copa argentina|recopa|supercopa|trofeo de campeones/i;
/** Tipo de torneo según el nombre: copas por eliminación vs ligas por fecha. */
export const kindFor = (name) => (CUP_RE.test(name) ? 'cup' : 'league');
export const defaultFees = (kind) => (kind === 'cup' ? { entry_fee: 0, champ_fee: 300 } : { entry_fee: 100, champ_fee: 0 });

/** Ordena a los participantes: puntos, luego exactos, luego menor error de goles. */
export function rankEntrants(list) {
  const key = (e) => [e.pts, e.exact, -e.err];
  return [...list].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return a.user_id - b.user_id;
  });
}
const sameScore = (a, b) => a.pts === b.pts && a.exact === b.exact && a.err === b.err;

/** Reparte el pozo entre los empatados en primer lugar. El resto de la división va al primero. */
export function splitPot(pot, board) {
  if (!board.length) return new Map();
  const winners = board.filter((e) => sameScore(e, board[0]));
  const share = Math.floor(pot / winners.length), out = new Map(winners.map((w) => [w.user_id, share]));
  out.set(winners[0].user_id, share + (pot - share * winners.length));
  return out;
}

// Desempate por goles errados: un partido sin pronóstico cuenta como un error grande, así saltearse partidos no ayuda.
const MISSING_ERR = 10;

function scoreboard(entrants, rows, totalFor) {
  const by = new Map(rows.map((r) => [r.user_id, r]));
  return rankEntrants(entrants.map((e) => {
    const r = by.get(e.user_id), n = r?.n || 0;
    return { user_id: e.user_id, pts: r?.pts || 0, exact: r?.exact || 0, played: n, err: (r?.err || 0) + Math.max(0, totalFor(e.user_id) - n) * MISSING_ERR };
  }));
}
const AGG = `SUM(COALESCE(p.points,0)) AS pts, SUM(p.points=3) AS exact,
  SUM(ABS(p.home-m.home_goals)+ABS(p.away-m.away_goals)) AS err, COUNT(*) AS n`;

export function roundBoard(gid, compId, round) {
  const entrants = db.prepare('SELECT user_id FROM round_entries WHERE group_id=? AND comp_id=? AND round=?').all(gid, compId, round);
  const rows = db.prepare(`SELECT p.user_id, ${AGG} FROM predictions p JOIN matches m ON m.id=p.match_id
    WHERE p.group_id=? AND m.comp_id=? AND m.round=? AND m.status='finished'
      AND p.user_id IN (SELECT user_id FROM round_entries WHERE group_id=? AND comp_id=? AND round=?) GROUP BY p.user_id`)
    .all(gid, compId, round, gid, compId, round);
  const total = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND round=? AND status='finished'").get(compId, round).n;
  return scoreboard(entrants, rows, () => total);
}
/** Campeonato: solo cuentan los partidos que empezaron después de inscribirse. */
export function champBoard(gid, compId) {
  const entrants = db.prepare('SELECT user_id FROM champ_entries WHERE group_id=? AND comp_id=?').all(gid, compId);
  const rows = db.prepare(`SELECT p.user_id, ${AGG} FROM predictions p JOIN matches m ON m.id=p.match_id
    JOIN champ_entries e ON e.user_id=p.user_id AND e.group_id=p.group_id AND e.comp_id=m.comp_id
    WHERE p.group_id=? AND m.comp_id=? AND m.status='finished' AND m.kickoff > e.joined_at GROUP BY p.user_id`).all(gid, compId);
  const tot = new Map(db.prepare(`SELECT e.user_id, COUNT(m.id) AS n FROM champ_entries e JOIN matches m ON m.comp_id=e.comp_id
    WHERE e.group_id=? AND e.comp_id=? AND m.status='finished' AND m.kickoff > e.joined_at GROUP BY e.user_id`).all(gid, compId).map((r) => [r.user_id, r.n]));
  return scoreboard(entrants, rows, (uid) => tot.get(uid) || 0);
}

const nick = (id) => db.prepare('SELECT nick FROM users WHERE id=?').get(id)?.nick || '?';
const pay = (uid, gid, amount) => db.prepare('UPDATE memberships SET coins=coins+? WHERE user_id=? AND group_id=?').run(amount, uid, gid);

/** Cierra una fecha: reparte el pozo. Llamar dentro de tx(). `force` ignora partidos pendientes (cierre manual). */
export function settleRound(gid, compId, round, force = false) {
  if (db.prepare('SELECT 1 FROM round_settled WHERE group_id=? AND comp_id=? AND round=?').get(gid, compId, round)) return false;
  const left = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND round=? AND status NOT IN ('finished','cancelled')").get(compId, round).n;
  if (left && !force) return false;
  const entries = db.prepare('SELECT user_id, fee FROM round_entries WHERE group_id=? AND comp_id=? AND round=?').all(gid, compId, round);
  db.prepare('INSERT INTO round_settled(group_id, comp_id, round) VALUES (?,?,?)').run(gid, compId, round);
  if (!entries.length) return true;
  const comp = db.prepare('SELECT name FROM competitions WHERE id=?').get(compId).name;
  const played = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND round=? AND status='finished'").get(compId, round).n;
  const setPay = db.prepare('UPDATE round_entries SET payout=? WHERE group_id=? AND comp_id=? AND round=? AND user_id=?');
  if (!played) { // fecha suspendida entera: se devuelve la inscripción
    for (const e of entries) { pay(e.user_id, gid, e.fee); setPay.run(e.fee, gid, compId, round, e.user_id); enqueueForUser(e.user_id, 'Fecha suspendida', `${comp} · ${round} se suspendió. Te devolvimos ${e.fee} fichas.`); }
    return true;
  }
  const pot = entries.reduce((s, e) => s + e.fee, 0), board = roundBoard(gid, compId, round), prizes = splitPot(pot, board);
  for (const e of entries) setPay.run(prizes.get(e.user_id) || 0, gid, compId, round, e.user_id);
  for (const [uid, amount] of prizes) pay(uid, gid, amount);
  const names = [...prizes.keys()].map(nick).join(' y ');
  for (const e of entries) {
    const won = prizes.get(e.user_id);
    enqueueForUser(e.user_id, `${comp} · ${round}`, won ? `¡Ganaste el pozo de la fecha! +${won} fichas.` : `Terminó la fecha. Ganó ${names} (${board[0].pts} pts).`);
  }
  return true;
}

/** Después de liquidar un partido de liga: si la fecha ya terminó, se reparten los pozos de todos los grupos. */
export function settleRoundsFor(compId, round) {
  if (!round) return;
  for (const { group_id } of db.prepare('SELECT DISTINCT group_id FROM round_entries WHERE comp_id=? AND round=?').all(compId, round)) settleRound(group_id, compId, round);
}

/** Cierra el campeonato en todos los grupos (lo confirma el admin). Llamar dentro de tx(). */
export function settleChampionship(compId) {
  const comp = db.prepare('SELECT * FROM competitions WHERE id=?').get(compId);
  if (!comp || comp.closed_at) return false;
  for (const { group_id: gid } of db.prepare('SELECT DISTINCT group_id FROM champ_entries WHERE comp_id=?').all(compId)) {
    const entries = db.prepare('SELECT user_id, fee FROM champ_entries WHERE group_id=? AND comp_id=?').all(gid, compId);
    const pot = entries.reduce((s, e) => s + e.fee, 0), board = champBoard(gid, compId), prizes = splitPot(pot, board);
    const setPay = db.prepare('UPDATE champ_entries SET payout=? WHERE group_id=? AND comp_id=? AND user_id=?');
    for (const e of entries) setPay.run(prizes.get(e.user_id) || 0, gid, compId, e.user_id);
    for (const [uid, amount] of prizes) pay(uid, gid, amount);
    const names = [...prizes.keys()].map(nick).join(' y ');
    for (const e of entries) {
      const won = prizes.get(e.user_id);
      enqueueForUser(e.user_id, `Terminó ${comp.name}`, won ? `¡Ganaste el campeonato! +${won} fichas.` : `Ganó ${names} el campeonato del grupo.`);
    }
  }
  db.prepare("UPDATE competitions SET closed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), champ_open=0 WHERE id=?").run(compId);
  return true;
}
