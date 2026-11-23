import { db } from './db.js';
import { predictionPoints } from './scoring.js';
import { enqueueForUser } from './push.js';
import { settleRoundsFor } from './prizes.js';

/**
 * Liquida un partido terminado: calcula los puntos de cada pronóstico y, si era el último de la
 * fecha, reparte el pozo de la fecha. Es idempotente. Llamar dentro de tx().
 */
export function settleMatch(id) {
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  if (!m || m.settled) return false;
  if (m.status === 'finished' && m.home_goals != null && m.away_goals != null) {
    const real = { home: m.home_goals, away: m.away_goals };
    const setPts = db.prepare('UPDATE predictions SET points=? WHERE user_id=? AND group_id=? AND match_id=?');
    const seen = new Set();
    for (const p of db.prepare('SELECT * FROM predictions WHERE match_id=?').all(id)) {
      const pts = predictionPoints(p, real);
      setPts.run(pts, p.user_id, p.group_id, id);
      if (!seen.has(p.user_id)) {
        seen.add(p.user_id);
        enqueueForUser(p.user_id, 'Terminó el partido', `${m.home} ${real.home}-${real.away} ${m.away}. Sumaste ${pts} ${pts === 1 ? 'punto' : 'puntos'}.`);
      }
    }
  } else if (m.status !== 'cancelled') return false;
  db.prepare('UPDATE matches SET settled=1 WHERE id=?').run(id);
  settleRoundsFor(m.comp_id, m.round); // si era el último partido de la fecha, se reparte el pozo
  return true;
}
