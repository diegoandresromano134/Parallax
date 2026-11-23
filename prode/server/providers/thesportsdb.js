// Proveedor de fixtures: TheSportsDB (https://www.thesportsdb.com/documentation).
// Funciona con la clave gratuita ("123"), pero el plan gratuito limita la cantidad
// de partidos que devuelve por consulta. Con THESPORTSDB_KEY (plan pago, ~USD 9/mes
// para una persona) trae temporadas completas.
const BASE = 'https://www.thesportsdb.com/api/v1/json';
import { getSetting } from '../db.js';
export const FREE_KEY = '123';
// La clave de la suscripción se carga desde el panel de administración (o por variable de entorno).
export const apiKey = () => getSetting('thesportsdb_key') || process.env.THESPORTSDB_KEY || FREE_KEY;
const KEY = apiKey;

// Torneos que se activan solos al descubrirlos; el admin puede cambiar el resto.
export const DEFAULT_ENABLED =
  /liga profesional|primera divisi[oó]n|copa argentina|libertadores|sudamericana|supercopa argentina|trofeo de campeones|recopa/i;

async function get(path) {
  const res = await fetch(`${BASE}/${KEY()}/${path}`, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`TheSportsDB ${res.status} en ${path.split('?')[0]}`);
  return res.json();
}

/** Torneos de fútbol de Argentina + torneos sudamericanos. */
export async function discover() {
  const out = new Map();
  const arg = await get('search_all_leagues.php?c=Argentina&s=Soccer');
  for (const l of arg.countries || arg.leagues || [])
    out.set(l.idLeague, { ext_id: l.idLeague, name: l.strLeague, country: 'Argentina' });
  const all = await get('all_leagues.php');
  for (const l of all.leagues || [])
    if (l.strSport === 'Soccer' && /libertadores|sudamericana|recopa/i.test(l.strLeague))
      out.set(l.idLeague, { ext_id: l.idLeague, name: l.strLeague, country: 'Sudamérica' });
  return [...out.values()];
}

export async function currentSeason(extId) {
  const d = await get(`lookupleague.php?id=${extId}`);
  return d.leagues?.[0]?.strCurrentSeason || null;
}

function toIso(e) {
  let t = e.strTimestamp;
  if (t) { if (!/(Z|[+-]\d\d:?\d\d)$/.test(t)) t += 'Z'; }
  else if (e.dateEvent) t = `${e.dateEvent}T${e.strTime || '00:00:00'}Z`;
  const d = t && new Date(t);
  return d && !isNaN(d) ? d.toISOString() : null;
}

export function mapStatus(s) {
  s = (s || '').toLowerCase();
  if (/cancel|canc|walkover|awarded/.test(s)) return 'cancelled';
  if (/postp|^pst$|susp|abandon|delay/.test(s)) return 'postponed';
  if (/finish|^ft$|^aet$|^pen$|after/.test(s)) return 'finished';
  if (/^(1h|2h|ht|et|bt|p|live|in play|break)/.test(s)) return 'live';
  return 'scheduled';
}

export function mapEvent(e) {
  const kickoff = toIso(e);
  if (!kickoff || !e.strHomeTeam || !e.strAwayTeam) return null;
  const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    ext_id: e.idEvent, round: e.intRound ? `Fecha ${e.intRound}` : null,
    home: e.strHomeTeam, away: e.strAwayTeam,
    home_badge: e.strHomeTeamBadge || null, away_badge: e.strAwayTeamBadge || null,
    kickoff, status: mapStatus(e.strStatus), home_goals: n(e.intHomeScore), away_goals: n(e.intAwayScore),
  };
}

/** Todos los partidos conocidos de la temporada actual del torneo. */
export async function fixtures(comp) {
  const season = comp.season || (await currentSeason(comp.ext_id));
  const events = new Map();
  const add = (d) => { for (const e of d?.events || []) events.set(e.idEvent, e); };
  if (season) add(await get(`eventsseason.php?id=${comp.ext_id}&s=${encodeURIComponent(season)}`));
  // Siempre sumamos los próximos y últimos: con la clave gratuita son los más frescos.
  for (const p of ['eventsnextleague', 'eventspastleague']) {
    try { add(await get(`${p}.php?id=${comp.ext_id}`)); } catch { /* opcional */ }
  }
  return { season, matches: [...events.values()].map(mapEvent).filter(Boolean) };
}

/** Estado actual de un partido puntual. */
export async function lookup(extId) {
  const d = await get(`lookupevent.php?id=${extId}`);
  return d.events?.[0] ? mapEvent(d.events[0]) : null;
}

/** Tabla de posiciones oficial (puede venir vacía en copas o con la clave gratuita). */
export async function table(comp) {
  const season = comp.season || (await currentSeason(comp.ext_id));
  if (!season) return [];
  const d = await get(`lookuptable.php?l=${comp.ext_id}&s=${encodeURIComponent(season)}`);
  const n = (v) => Number(v) || 0;
  return (d.table || []).map((r) => ({
    pos: n(r.intRank), team: r.strTeam, badge: r.strBadge || null, played: n(r.intPlayed), won: n(r.intWin),
    drawn: n(r.intDraw), lost: n(r.intLoss), gf: n(r.intGoalsFor), ga: n(r.intGoalsAgainst),
    gd: n(r.intGoalDifference), points: n(r.intPoints),
  }));
}

/** Prueba la clave: trae la Liga Profesional (id 4406) y cuenta los partidos de su temporada. */
export async function testSource() {
  const key = apiKey();
  const league = (await get('lookupleague.php?id=4406')).leagues?.[0];
  if (!league) throw new Error('La fuente respondió pero sin datos: revisá la clave');
  const season = league.strCurrentSeason;
  const ev = (await get(`eventsseason.php?id=4406&s=${encodeURIComponent(season)}`)).events || [];
  return { premium: key !== FREE_KEY, league: league.strLeague, season, events: ev.length };
}
