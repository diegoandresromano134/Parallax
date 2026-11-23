import { db, tx } from './db.js';
import { settleMatch } from './settle.js';

// Datos de PRUEBA para probar la app sin conexión a internet (PRODE_DEMO=1).
export function seedDemo() {
  if (db.prepare("SELECT 1 FROM competitions WHERE name LIKE '%(DEMO)'").get()) return;
  const teams = ['Boca Juniors', 'River Plate', 'Racing Club', 'Independiente', 'San Lorenzo', 'Estudiantes',
    'Vélez', 'Lanús', 'Talleres', 'Rosario Central', 'Newell\'s', 'Huracán'];
  const mk = (name, country, kind = 'league') =>
    Number(db.prepare('INSERT INTO competitions(name,country,enabled,kind) VALUES (?,?,1,?)').run(name, country, kind).lastInsertRowid);
  const lpf = mk('Liga Profesional (DEMO)', 'Argentina');
  const lib = mk('Copa Libertadores (DEMO)', 'Sudamérica', 'cup');
  const now = Date.now(), H = 3600e3, D = 24 * H;
  tx(() => {
    const ins = db.prepare(`INSERT INTO matches(comp_id, round, home, away, kickoff, status, home_goals, away_goals)
      VALUES (?,?,?,?,?,?,?,?)`);
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const past = i < 2;
      const t = new Date(now + (i - 2) * D + (i % 3) * 2 * H).toISOString();
      ids.push(Number(ins.run(lpf, `Fecha ${i + 1}`, teams[i * 2], teams[i * 2 + 1], t,
        past ? 'finished' : 'scheduled', past ? 2 - i : null, past ? i : null).lastInsertRowid));
    }
    for (let i = 0; i < 3; i++)
      ins.run(lib, 'Octavos', teams[i], teams[11 - i], new Date(now + (i + 1) * D + 20 * H).toISOString(), 'scheduled', null, null);
    for (const id of ids) settleMatch(id);
  });
  console.log('Datos DEMO cargados (partidos inventados para probar).');
}
