import { db } from './db.js';
import { predictionPoints, settleBets } from './scoring.js';
import { enqueueForUser } from './push.js';

/**
 * Liquida un partido terminado o devuelve las apuestas si fue cancelado.
 * Cada grupo tiene su propio pozo. Es idempotente. Llamar dentro de tx().
 */
export function settleMatch(id) {
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  if (!m || m.settled) return false;
  const bets = db.prepare('SELECT user_id, group_id, pick, stake FROM bets WHERE match_id=?').all(id);
  const addCoins = db.prepare('UPDATE memberships SET coins = coins + ? WHERE user_id=? AND group_id=?');
  const setPayout = db.prepare('UPDATE bets SET payout=? WHERE user_id=? AND group_id=? AND match_id=?');
  const notes = new Map(); // user_id -> texto para el aviso
  const title = `${m.home} vs ${m.away}`;

  if (m.status === 'cancelled') {
    for (const b of bets) {
      addCoins.run(b.stake, b.user_id, b.group_id); setPayout.run(b.stake, b.user_id, b.group_id, id);
      notes.set(b.user_id, `${title} se suspendió. Te devolvimos tus fichas.`);
    }
  } else if (m.status === 'finished' && m.home_goals != null && m.away_goals != null) {
    const real = { home: m.home_goals, away: m.away_goals };
    const setPts = db.prepare('UPDATE predictions SET points=? WHERE user_id=? AND group_id=? AND match_id=?');
    const score = `${m.home} ${real.home}-${real.away} ${m.away}`;
    for (const p of db.prepare('SELECT * FROM predictions WHERE match_id=?').all(id)) {
      const pts = predictionPoints(p, real);
      setPts.run(pts, p.user_id, p.group_id, id);
      notes.set(p.user_id, `${score}. Sumaste ${pts} ${pts === 1 ? 'punto' : 'puntos'}.`);
    }
    const byGroup = new Map();
    for (const b of bets) byGroup.set(b.group_id, [...(byGroup.get(b.group_id) || []), b]);
    for (const [gid, list] of byGroup) {
      for (const [uid, payout] of settleBets(list, real)) {
        const stake = list.find((b) => b.user_id === uid).stake;
        addCoins.run(payout, uid, gid); setPayout.run(payout, uid, gid, id);
        const net = payout - stake;
        const bet = net > 0 ? `Ganaste ${net} fichas.` : net < 0 ? `Perdiste ${-net} fichas.` : 'Te devolvieron las fichas.';
        notes.set(uid, (notes.get(uid) || score + '.') .replace(/\.$/, '') + `. ${bet}`);
      }
    }
  } else return false;

  db.prepare('UPDATE matches SET settled=1 WHERE id=?').run(id);
  for (const [uid, text] of notes) enqueueForUser(uid, 'Terminó el partido', text);
  return true;
}
