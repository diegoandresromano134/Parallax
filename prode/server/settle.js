import { db } from './db.js';
import { predictionPoints, settleBets } from './scoring.js';

/**
 * Liquida un partido terminado (puntos del PRODE + reparto del pozo) o devuelve
 * las apuestas si fue cancelado. Es idempotente. Llamar dentro de tx().
 */
export function settleMatch(id) {
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  if (!m || m.settled) return false;
  const bets = db.prepare('SELECT user_id, pick, stake FROM bets WHERE match_id=?').all(id);
  const addCoins = db.prepare('UPDATE users SET coins = coins + ? WHERE id=?');
  const setPayout = db.prepare('UPDATE bets SET payout=? WHERE user_id=? AND match_id=?');

  if (m.status === 'cancelled') {
    for (const b of bets) { addCoins.run(b.stake, b.user_id); setPayout.run(b.stake, b.user_id, id); }
  } else if (m.status === 'finished' && m.home_goals != null && m.away_goals != null) {
    const real = { home: m.home_goals, away: m.away_goals };
    const setPts = db.prepare('UPDATE predictions SET points=? WHERE user_id=? AND match_id=?');
    for (const p of db.prepare('SELECT * FROM predictions WHERE match_id=?').all(id))
      setPts.run(predictionPoints(p, real), p.user_id, id);
    for (const [uid, payout] of settleBets(bets, real)) { addCoins.run(payout, uid); setPayout.run(payout, uid, id); }
  } else return false;

  db.prepare('UPDATE matches SET settled=1 WHERE id=?').run(id);
  return true;
}
