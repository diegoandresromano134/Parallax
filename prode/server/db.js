import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.env.PRODE_DB || resolve(here, '../data/prode.db');
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL, pass_hash TEXT NOT NULL,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  nick TEXT NOT NULL UNIQUE COLLATE NOCASE,
  birth_date TEXT NOT NULL, fav_team TEXT, avatar TEXT, color TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT, owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL, joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, group_id));
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE, name TEXT NOT NULL, country TEXT,
  season TEXT, enabled INTEGER NOT NULL DEFAULT 0, synced_at TEXT, standings_json TEXT);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY, comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  ext_id TEXT UNIQUE, round TEXT, home TEXT NOT NULL, away TEXT NOT NULL,
  home_badge TEXT, away_badge TEXT, kickoff TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|live|finished|postponed|cancelled
  home_goals INTEGER, away_goals INTEGER, settled INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS matches_kickoff ON matches(kickoff);
-- El juego es por grupo: cada grupo tiene sus fichas, su pozo y su ranking.
CREATE TABLE IF NOT EXISTS predictions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  home INTEGER NOT NULL, away INTEGER NOT NULL, points INTEGER,
  PRIMARY KEY (user_id, group_id, match_id));
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS comments_match ON comments(group_id, match_id);
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS push_queue (
  id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  pinged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS coin_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  granted INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), resolved_at TEXT);
CREATE TABLE IF NOT EXISTS coin_log (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, group_id INTEGER NOT NULL,
  amount INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
-- Premios: pozo por fecha (ligas) y pozo del campeonato (copas). Todo es por grupo.
CREATE TABLE IF NOT EXISTS round_entries (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  round TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fee INTEGER NOT NULL, payout INTEGER, joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, comp_id, round, user_id));
CREATE TABLE IF NOT EXISTS round_settled (
  group_id INTEGER NOT NULL, comp_id INTEGER NOT NULL, round TEXT NOT NULL,
  settled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, comp_id, round));
CREATE TABLE IF NOT EXISTS champ_entries (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fee INTEGER NOT NULL, payout INTEGER, joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, comp_id, user_id));
-- Ficha ROJA: pozo de goles por fecha (con acumulado). Ficha DORADA: campeón del torneo.
CREATE TABLE IF NOT EXISTS red_entries (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  round TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fee INTEGER NOT NULL, payout INTEGER, joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, comp_id, round, user_id));
CREATE TABLE IF NOT EXISTS red_carry (
  group_id INTEGER NOT NULL, comp_id INTEGER NOT NULL, amount INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, comp_id));
CREATE TABLE IF NOT EXISTS house_take (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, comp_id INTEGER NOT NULL, color TEXT NOT NULL, amount INTEGER NOT NULL,
  reason TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
-- Fichas canjeables por premios que define el admin
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, cost INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, reward_id INTEGER,
  title TEXT NOT NULL, cost INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', -- pending|delivered|rejected
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), resolved_at TEXT);
CREATE TABLE IF NOT EXISTS notified (
  user_id INTEGER NOT NULL, match_id INTEGER NOT NULL, kind TEXT NOT NULL,
  PRIMARY KEY (user_id, match_id, kind));
`);

// Migración: columnas nuevas (idempotente). Billeteras por color: coins = VERDES, red_coins = ROJAS, gold_coins = DORADAS.
const addColumn = (table, col, ddl) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
};
// torneos: entry_fee = inscripción VERDE (por fecha), red_fee = ROJA (goles por fecha), champ_fee = DORADA (campeón)
for (const [col, ddl] of [['kind', "TEXT NOT NULL DEFAULT 'league'"], ['entry_fee', 'INTEGER NOT NULL DEFAULT 5000'], ['red_fee', 'INTEGER NOT NULL DEFAULT 5000'],
  ['champ_fee', 'INTEGER NOT NULL DEFAULT 5000'], ['champ_open', 'INTEGER NOT NULL DEFAULT 1'], ['closed_at', 'TEXT'], ['champion', 'TEXT']]) addColumn('competitions', col, ddl);
addColumn('memberships', 'red_coins', 'INTEGER NOT NULL DEFAULT 0');
addColumn('memberships', 'gold_coins', 'INTEGER NOT NULL DEFAULT 0');
addColumn('champ_entries', 'pick', 'TEXT');
for (const t of ['coin_requests', 'coin_log', 'rewards', 'redemptions']) addColumn(t, 'color', "TEXT NOT NULL DEFAULT 'green'");

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const getSetting = (k) => db.prepare('SELECT v FROM settings WHERE k=?').get(k)?.v;
export const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
