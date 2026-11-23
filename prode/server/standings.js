import { db } from './db.js';

/** Tabla de posiciones calculada con los partidos terminados que tenemos cargados. */
export function computeTable(matches) {
  const t = new Map();
  const row = (name, badge) => t.get(name) || t.set(name, { team: name, badge: badge || null, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }).get(name);
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_goals == null || m.away_goals == null) continue;
    const h = row(m.home, m.home_badge), a = row(m.away, m.away_badge);
    h.played++; a.played++; h.gf += m.home_goals; h.ga += m.away_goals; a.gf += m.away_goals; a.ga += m.home_goals;
    if (m.home_goals > m.away_goals) { h.won++; a.lost++; h.points += 3; }
    else if (m.home_goals < m.away_goals) { a.won++; h.lost++; a.points += 3; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }
  return [...t.values()]
    .sort((x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team))
    .map((r, i) => ({ pos: i + 1, ...r, gd: r.gf - r.ga }));
}

/** Tabla oficial si la fuente de datos la trajo; si no, la calculada. */
export function standingsFor(compId) {
  const c = db.prepare('SELECT * FROM competitions WHERE id=?').get(compId);
  if (!c) return null;
  if (c.standings_json) {
    try { const rows = JSON.parse(c.standings_json); if (rows.length) return { rows, computed: false, season: c.season }; } catch { /* se recalcula */ }
  }
  const rows = computeTable(db.prepare('SELECT * FROM matches WHERE comp_id=?').all(compId));
  return { rows, computed: true, season: c.season };
}
