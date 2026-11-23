import { db } from './db.js';
import { outcome, pickPoints, isExact } from './scoring.js';
import { enqueueForUser } from './push.js';
import { settleRoundsFor } from './prizes.js';

/**
 * Liquida un partido terminado: marca quién acertó el ganador (verde) y el marcador exacto (roja) y, si era
 * el último de la fecha, reparte los pozos de la fecha. Es idempotente. Llamar dentro de tx().
 */
export function settleMatch(id) {
  const m = db.prepare('SELECT * FROM matches WHERE id=?').get(id);
  if (!m || m.settled) return false;
  if (m.status === 'finished' && m.home_goals != null && m.away_goals != null) {
    const real = { home: m.home_goals, away: m.away_goals }, who = { L: m.home, V: m.away, E: 'empate' }[outcome(real.home, real.away)];
    const set = db.prepare('UPDATE predictions SET points=?, exact=? WHERE user_id=? AND group_id=? AND match_id=?');
    const seen = new Set();
    for (const p of db.prepare('SELECT * FROM predictions WHERE match_id=?').all(id)) {
      const hit = p.pick ? pickPoints(p.pick, real) : null, exact = p.home != null ? (isExact(p, real) ? 1 : 0) : null;
      set.run(hit, exact, p.user_id, p.group_id, id);
      if (!seen.has(p.user_id)) {
        seen.add(p.user_id);
        enqueueForUser(p.user_id, 'Terminó el partido', `${m.home} ${real.home}-${real.away} ${m.away} (${who === 'empate' ? 'empate' : 'ganó ' + who}). ${hit ? '¡Acertaste el ganador!' : hit === 0 ? 'No acertaste el ganador.' : ''}${exact ? ' ¡Y el marcador exacto!' : ''}`.trim());
      }
    }
  } else if (m.status !== 'cancelled') return false;
  db.prepare('UPDATE matches SET settled=1 WHERE id=?').run(id);
  settleRoundsFor(m.comp_id, m.round); // si era el último partido de la fecha, se reparten los pozos
  return true;
}
