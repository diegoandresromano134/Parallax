import { db, tx } from './db.js';
import { settleMatch } from './settle.js';
import { flush } from './push.js';
import * as provider from './providers/thesportsdb.js';

const log = (...a) => console.log(new Date().toISOString(), '[sync]', ...a);

function upsertMatch(compId, m) {
  const ex = db.prepare('SELECT id, settled FROM matches WHERE ext_id=?').get(m.ext_id);
  if (ex?.settled) return; // ya liquidado: no se toca
  tx(() => {
    if (ex) {
      db.prepare(`UPDATE matches SET comp_id=?, round=?, home=?, away=?, home_badge=?, away_badge=?,
        kickoff=?, status=?, home_goals=?, away_goals=? WHERE id=?`)
        .run(compId, m.round, m.home, m.away, m.home_badge, m.away_badge, m.kickoff, m.status, m.home_goals, m.away_goals, ex.id);
      settleMatch(ex.id);
    } else {
      const r = db.prepare(`INSERT INTO matches(comp_id, ext_id, round, home, away, home_badge, away_badge,
        kickoff, status, home_goals, away_goals) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(compId, m.ext_id, m.round, m.home, m.away, m.home_badge, m.away_badge, m.kickoff, m.status, m.home_goals, m.away_goals);
      settleMatch(Number(r.lastInsertRowid));
    }
  });
}

/** Busca los torneos disponibles. Los nuevos se activan solos si son de los que importan. */
export async function discover() {
  const list = await provider.discover();
  let added = 0;
  for (const c of list) {
    const r = db.prepare('INSERT OR IGNORE INTO competitions(ext_id, name, country, enabled) VALUES (?,?,?,?)')
      .run(c.ext_id, c.name, c.country, provider.DEFAULT_ENABLED.test(c.name) ? 1 : 0);
    added += Number(r.changes);
  }
  log(`torneos: ${list.length} encontrados, ${added} nuevos`);
  return { found: list.length, added };
}

/** Baja fixture y resultados de todos los torneos activados. */
export async function syncFixtures() {
  const comps = db.prepare('SELECT * FROM competitions WHERE enabled=1 AND ext_id IS NOT NULL').all();
  const report = [];
  for (const c of comps) {
    try {
      const { season, matches } = await provider.fixtures(c);
      for (const m of matches) upsertMatch(c.id, m);
      db.prepare("UPDATE competitions SET season=?, synced_at=datetime('now') WHERE id=?").run(season, c.id);
      try {
        const rows = await provider.table({ ...c, season });
        if (rows.length) db.prepare('UPDATE competitions SET standings_json=? WHERE id=?').run(JSON.stringify(rows), c.id);
      } catch { /* la tabla es opcional: si falla se calcula con los resultados */ }
      report.push({ name: c.name, matches: matches.length });
    } catch (e) {
      log(`error en ${c.name}: ${e.message}`);
      report.push({ name: c.name, error: e.message });
    }
  }
  log('fixtures', JSON.stringify(report));
  await flush();
  return report;
}

/** Actualiza solo los partidos que ya empezaron y todavía no tienen resultado final. */
export async function refreshResults() {
  const pending = db.prepare(`SELECT m.id, m.ext_id, m.comp_id FROM matches m JOIN competitions c ON c.id=m.comp_id
    WHERE c.enabled=1 AND m.ext_id IS NOT NULL AND m.settled=0
      AND m.kickoff < ? AND m.kickoff > ?`)
    .all(new Date(Date.now() - 100 * 60e3).toISOString(), new Date(Date.now() - 4 * 864e5).toISOString());
  for (const p of pending) {
    try { const m = await provider.lookup(p.ext_id); if (m) upsertMatch(p.comp_id, m); }
    catch (e) { log(`no se pudo actualizar ${p.ext_id}: ${e.message}`); }
  }
  await flush();
  return pending.length;
}

export function startScheduler() {
  const safe = (name, fn) => () => fn().catch((e) => log(`${name}: ${e.message}`));
  setTimeout(safe('inicial', async () => {
    if (!db.prepare('SELECT 1 FROM competitions WHERE ext_id IS NOT NULL LIMIT 1').get()) await discover();
    await syncFixtures();
  }), 3000);
  setInterval(safe('resultados', refreshResults), 10 * 60 * 1000); // cada 10 min
  setInterval(safe('fixtures', syncFixtures), 6 * 60 * 60 * 1000); // cada 6 h
  setInterval(safe('torneos', discover), 24 * 60 * 60 * 1000); // diario: aparecen torneos nuevos
}
