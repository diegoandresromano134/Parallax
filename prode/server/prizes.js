// Premios en fichas de colores (billeteras separadas por jugador y grupo):
//  🟢 VERDE: inscripción por fecha/ronda de cualquier torneo. Se pronostica QUIÉN GANA cada partido (Local, Empate
//     o Visitante). Gana el pozo verde quien acierta más ganadores en la fecha; si hay empate, se reparte.
//  🔴 ROJA: inscripción por fecha para el pozo de GOLES (hay que estar anotado en verde). Se pronostica el MARCADOR
//     EXACTO. Para llevarse el pozo hay que haber acertado también la mayoría de los ganadores de la fecha y tener
//     marcadores exactos; gana quien más exactos tiene. Si nadie lo logra, la mitad del pozo queda acumulada para la
//     fecha siguiente y la otra mitad se la queda la casa.
//  🟡 DORADA: inscripción por torneo para elegir al CAMPEÓN. Se reparte entre quienes acertaron; si nadie acierta
//     se queda la casa.
import { db, getSetting } from './db.js';
import { enqueueForUser } from './push.js';

export const CUP_RE = /libertadores|sudamericana|copa argentina|recopa|supercopa|trofeo de campeones/i;
export const kindFor = (name) => (CUP_RE.test(name) ? 'cup' : 'league');
/** Valores de ejemplo: 5.000 por inscripción. El admin los cambia por torneo. */
export const defaultFees = () => ({ entry_fee: 5000, red_fee: 5000, champ_fee: 5000 });

/** Comisión del admin sobre cada inscripción (porcentaje). Por defecto 20%: de $5.000, $4.000 al pozo y $1.000 al admin. */
export const commissionPct = () => { const raw = getSetting('commission_pct'); if (raw === undefined) return 20; const v = Number(raw); return Number.isFinite(v) && v >= 0 && v <= 90 ? v : 20; };
export function splitFee(fee, pct = commissionPct()) {
  const house = Math.round((fee * pct) / 100);
  return { pot: fee - house, house };
}
/** Anota la comisión del admin de una inscripción (ref permite devolverla si la inscripción se devuelve). */
export function takeCommission(gid, compId, color, amount, ref, reason) {
  if (amount > 0) db.prepare("INSERT INTO house_take(group_id, comp_id, color, amount, reason, kind, ref) VALUES (?,?,?,?,?, 'commission', ?)").run(gid, compId, color, amount, reason, ref);
}
export const dropCommission = (ref) => db.prepare("DELETE FROM house_take WHERE kind='commission' AND ref=?").run(ref);
export const refGreen = (gid, comp, round, uid) => `g:${gid}:${comp}:${round}:${uid}`;
export const refRed = (gid, comp, round, uid) => `r:${gid}:${comp}:${round}:${uid}`;
export const refGold = (gid, comp, uid) => `c:${gid}:${comp}:${uid}`;

export const WALLET = { green: 'coins', red: 'red_coins', gold: 'gold_coins' };
export const COLOR_ES = { green: 'verdes', red: 'rojas', gold: 'doradas' };
export const COLOR_ICON = { green: '🟢', red: '🔴', gold: '🟡' };
export const validColor = (c) => (WALLET[c] ? c : null);
export const balance = (uid, gid, color) => db.prepare(`SELECT ${WALLET[color]} AS v FROM memberships WHERE user_id=? AND group_id=?`).get(uid, gid)?.v ?? 0;
export function credit(uid, gid, color, amount) {
  db.prepare(`UPDATE memberships SET ${WALLET[color]}=${WALLET[color]}+? WHERE user_id=? AND group_id=?`).run(amount, uid, gid);
}

/** Verde: más ganadores acertados. Los empatados se reparten el pozo. */
export function rankEntrants(list) {
  return [...list].sort((a, b) => b.pts - a.pts || a.user_id - b.user_id);
}
/** Roja: más marcadores exactos y, a igual cantidad, menos goles errados. Califican solo quienes acertaron la mayoría de los ganadores. */
export function rankRed(list) {
  return [...list].sort((a, b) => (b.eligible - a.eligible) || b.exact - a.exact || a.err - b.err || a.user_id - b.user_id);
}
/** Acertar "la mayoría" = más de la mitad de los partidos jugados de la fecha. */
export const hasMajority = (hits, total) => total > 0 && hits * 2 > total;
const sameGreen = (a, b) => a.pts === b.pts;
const sameRed = (a, b) => a.exact === b.exact && a.err === b.err;

/** Reparte el pozo entre los empatados en primer lugar. El resto de la división va al primero. */
export function splitPot(pot, board, same = sameGreen) {
  if (!board.length) return new Map();
  const winners = board.filter((e) => same(e, board[0]));
  const share = Math.floor(pot / winners.length), out = new Map(winners.map((w) => [w.user_id, share]));
  out.set(winners[0].user_id, share + (pot - share * winners.length));
  return out;
}

// Desempate por goles errados (roja): un partido sin marcador pronosticado cuenta como un error grande.
const MISSING_ERR = 10;
function scoreboard(entrants, rows, total, rank) {
  const by = new Map(rows.map((r) => [r.user_id, r]));
  return rank(entrants.map((e) => {
    const r = by.get(e.user_id), pts = r?.pts || 0;
    return { user_id: e.user_id, pts, exact: r?.exact || 0, err: (r?.err || 0) + Math.max(0, total - (r?.n || 0)) * MISSING_ERR, eligible: hasMajority(pts, total) ? 1 : 0, total };
  }));
}
const AGG = `SUM(COALESCE(p.points,0)) AS pts, SUM(COALESCE(p.exact,0)) AS exact,
  SUM(CASE WHEN p.home IS NOT NULL THEN ABS(p.home-m.home_goals)+ABS(p.away-m.away_goals) ELSE 0 END) AS err,
  SUM(CASE WHEN p.home IS NOT NULL THEN 1 ELSE 0 END) AS n`;
const finishedIn = (compId, round) => db.prepare("SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND round=? AND status='finished'").get(compId, round).n;

function board(table, rank, gid, compId, round) {
  const entrants = db.prepare(`SELECT user_id FROM ${table} WHERE group_id=? AND comp_id=? AND round=?`).all(gid, compId, round);
  const rows = db.prepare(`SELECT p.user_id, ${AGG} FROM predictions p JOIN matches m ON m.id=p.match_id
    WHERE p.group_id=? AND m.comp_id=? AND m.round=? AND m.status='finished'
      AND p.user_id IN (SELECT user_id FROM ${table} WHERE group_id=? AND comp_id=? AND round=?) GROUP BY p.user_id`)
    .all(gid, compId, round, gid, compId, round);
  return scoreboard(entrants, rows, finishedIn(compId, round), rank);
}
export const roundBoard = (gid, compId, round) => board('round_entries', rankEntrants, gid, compId, round); // 🟢
export const redBoard = (gid, compId, round) => board('red_entries', rankRed, gid, compId, round); // 🔴
export const carryOf = (gid, compId) => db.prepare('SELECT amount FROM red_carry WHERE group_id=? AND comp_id=?').get(gid, compId)?.amount || 0;

const nick = (id) => db.prepare('SELECT nick FROM users WHERE id=?').get(id)?.nick || '?';
const fmt = (n) => n.toLocaleString('es-AR');

/** 🔴 Pozo de goles de la fecha. Llamar dentro de tx(), junto con el cierre de la fecha. */
function settleRed(gid, compId, round, compName, played) {
  const entries = db.prepare('SELECT user_id, fee, COALESCE(pot, fee) AS pot FROM red_entries WHERE group_id=? AND comp_id=? AND round=?').all(gid, compId, round);
  if (!entries.length) return;
  const setPay = db.prepare('UPDATE red_entries SET payout=? WHERE group_id=? AND comp_id=? AND round=? AND user_id=?');
  if (!played) { // fecha suspendida entera: se devuelve la inscripción roja
    for (const e of entries) { dropCommission(refRed(gid, compId, round, e.user_id)); credit(e.user_id, gid, 'red', e.fee); setPay.run(e.fee, gid, compId, round, e.user_id); enqueueForUser(e.user_id, 'Fecha suspendida', `${compName} · ${round} se suspendió. Te devolvimos ${fmt(e.fee)} fichas rojas.`); }
    return;
  }
  const carry = carryOf(gid, compId), pot = entries.reduce((s, e) => s + e.pot, 0) + carry;
  const qualified = redBoard(gid, compId, round).filter((b) => b.eligible && b.exact > 0);
  if (!qualified.length) {
    // nadie acertó goles exactos (con la mayoría de los ganadores): la mitad queda acumulada y la otra mitad se la queda la casa
    const kept = Math.floor(pot / 2), house = pot - kept;
    for (const e of entries) setPay.run(0, gid, compId, round, e.user_id);
    db.prepare('INSERT INTO red_carry(group_id, comp_id, amount) VALUES (?,?,?) ON CONFLICT(group_id, comp_id) DO UPDATE SET amount=excluded.amount').run(gid, compId, kept);
    db.prepare('INSERT INTO house_take(group_id, comp_id, color, amount, reason) VALUES (?,?,?,?,?)').run(gid, compId, 'red', house, `Nadie acertó goles exactos en ${compName} · ${round}`);
    for (const e of entries) enqueueForUser(e.user_id, `${compName} · ${round}`, `Nadie acertó los goles exactos. De ${fmt(pot)} 🔴, ${fmt(kept)} pasan acumulados a la próxima fecha y ${fmt(house)} se queda la casa.`);
    return;
  }
  const prizes = splitPot(pot, qualified, sameRed);
  for (const e of entries) setPay.run(prizes.get(e.user_id) || 0, gid, compId, round, e.user_id);
  for (const [uid, amount] of prizes) credit(uid, gid, 'red', amount);
  db.prepare('DELETE FROM red_carry WHERE group_id=? AND comp_id=?').run(gid, compId);
  const names = [...prizes.keys()].map(nick).join(' y ');
  for (const e of entries) {
    const won = prizes.get(e.user_id);
    enqueueForUser(e.user_id, `${compName} · ${round}`, won ? `¡Ganaste el pozo de goles! +${fmt(won)} fichas rojas.` : `Pozo de goles: ganó ${names} (${qualified[0].exact} marcadores exactos).`);
  }
}

/** Cierra una fecha: reparte el pozo verde y el rojo. Llamar dentro de tx(). `force` ignora partidos pendientes (cierre manual). */
export function settleRound(gid, compId, round, force = false) {
  if (db.prepare('SELECT 1 FROM round_settled WHERE group_id=? AND comp_id=? AND round=?').get(gid, compId, round)) return false;
  const left = db.prepare("SELECT COUNT(*) AS n FROM matches WHERE comp_id=? AND round=? AND status NOT IN ('finished','cancelled')").get(compId, round).n;
  if (left && !force) return false;
  db.prepare('INSERT INTO round_settled(group_id, comp_id, round) VALUES (?,?,?)').run(gid, compId, round);
  const comp = db.prepare('SELECT name FROM competitions WHERE id=?').get(compId).name, played = finishedIn(compId, round);
  const entries = db.prepare('SELECT user_id, fee, COALESCE(pot, fee) AS pot FROM round_entries WHERE group_id=? AND comp_id=? AND round=?').all(gid, compId, round);
  const setPay = db.prepare('UPDATE round_entries SET payout=? WHERE group_id=? AND comp_id=? AND round=? AND user_id=?');
  if (entries.length && !played) { // fecha suspendida entera: se devuelve la inscripción completa (y la comisión)
    for (const e of entries) { dropCommission(refGreen(gid, compId, round, e.user_id)); credit(e.user_id, gid, 'green', e.fee); setPay.run(e.fee, gid, compId, round, e.user_id); enqueueForUser(e.user_id, 'Fecha suspendida', `${comp} · ${round} se suspendió. Te devolvimos ${fmt(e.fee)} fichas verdes.`); }
  } else if (entries.length) {
    const pot = entries.reduce((s, e) => s + e.pot, 0), b = roundBoard(gid, compId, round), prizes = splitPot(pot, b);
    for (const e of entries) setPay.run(prizes.get(e.user_id) || 0, gid, compId, round, e.user_id);
    for (const [uid, amount] of prizes) credit(uid, gid, 'green', amount);
    const names = [...prizes.keys()].map(nick).join(' y ');
    for (const e of entries) {
      const won = prizes.get(e.user_id);
      enqueueForUser(e.user_id, `${comp} · ${round}`, won ? `¡Ganaste el pozo de la fecha! +${fmt(won)} fichas verdes.` : `Terminó la fecha. Ganó ${names} (${b[0].pts} ganadores acertados).`);
    }
  }
  settleRed(gid, compId, round, comp, played);
  return true;
}

/** Después de liquidar un partido: si la fecha ya terminó, se reparten los pozos de todos los grupos. */
export function settleRoundsFor(compId, round) {
  if (!round) return;
  const groups = db.prepare(`SELECT group_id FROM round_entries WHERE comp_id=? AND round=? UNION SELECT group_id FROM red_entries WHERE comp_id=? AND round=?`).all(compId, round, compId, round);
  for (const { group_id } of groups) settleRound(group_id, compId, round);
}

/**
 * 🟡 Cierra el campeonato con el campeón que indica el admin. Se reparte entre quienes lo eligieron;
 * si nadie acierta, el pozo se lo queda la casa. Llamar dentro de tx().
 */
export function settleChampionship(compId, champion) {
  const comp = db.prepare('SELECT * FROM competitions WHERE id=?').get(compId);
  if (!comp || comp.closed_at) return false;
  const champ = String(champion || '').trim();
  if (!champ) throw Object.assign(new Error('Elegí el campeón'), { status: 400 });
  for (const { group_id: gid } of db.prepare('SELECT DISTINCT group_id FROM champ_entries WHERE comp_id=?').all(compId)) {
    const entries = db.prepare('SELECT user_id, fee, COALESCE(pot, fee) AS pot, pick FROM champ_entries WHERE group_id=? AND comp_id=? ORDER BY user_id').all(gid, compId);
    const pot = entries.reduce((s, e) => s + e.pot, 0), winners = entries.filter((e) => (e.pick || '').toLowerCase() === champ.toLowerCase());
    const setPay = db.prepare('UPDATE champ_entries SET payout=? WHERE group_id=? AND comp_id=? AND user_id=?');
    if (!winners.length) {
      for (const e of entries) { setPay.run(0, gid, compId, e.user_id); enqueueForUser(e.user_id, `Terminó ${comp.name}`, `El campeón fue ${champ}. Nadie lo eligió: el pozo dorado se lo queda la casa.`); }
      db.prepare('INSERT INTO house_take(group_id, comp_id, color, amount, reason) VALUES (?,?,?,?,?)').run(gid, compId, 'gold', pot, `Nadie acertó el campeón de ${comp.name} (${champ})`);
    } else {
      const share = Math.floor(pot / winners.length), extra = pot - share * winners.length;
      winners.forEach((w, i) => { const amount = share + (i === 0 ? extra : 0); setPay.run(amount, gid, compId, w.user_id); credit(w.user_id, gid, 'gold', amount); });
      for (const e of entries) {
        const won = winners.some((w) => w.user_id === e.user_id);
        if (!won) setPay.run(0, gid, compId, e.user_id);
        enqueueForUser(e.user_id, `Terminó ${comp.name}`, won ? `¡Acertaste el campeón (${champ})! Ganaste fichas doradas.` : `El campeón fue ${champ}. Esta vez no acertaste.`);
      }
    }
  }
  db.prepare("UPDATE competitions SET closed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), champ_open=0, champion=? WHERE id=?").run(champ, compId);
  return true;
}
