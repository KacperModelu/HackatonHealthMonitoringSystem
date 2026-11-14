// Access to the SQLite database (database/cardio_analysis.db, created by
// database/generate_cardio_db.py). Uses Node's built-in node:sqlite, so there are no
// native dependencies to compile.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const defaultDbPath = path.resolve(here, '../database/cardio_analysis.db');

export function openDb(file = process.env.CARDIO_DB || defaultDbPath) {
  if (!existsSync(file)) {
    throw new Error(
      `Database not found: ${file}\nCreate it with: python3 database/generate_cardio_db.py`,
    );
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare('SELECT 1 FROM crew_member LIMIT 1').all();   // fails fast on a wrong file
  // Older copies of the database may not have this table yet.
  db.exec(`CREATE TABLE IF NOT EXISTS simulated_event (
      id INTEGER PRIMARY KEY,
      crew_id INTEGER NOT NULL REFERENCES crew_member(id),
      mission_id INTEGER REFERENCES mission(id),
      kind TEXT NOT NULL,
      start_flight_day INTEGER,
      end_flight_day INTEGER,
      description TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('generator','app')))`);
  return db;
}

// Runs fn inside a transaction; rolls back if it throws.
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Plain objects instead of null-prototype rows (nicer for JSON / tests).
export const plain = (rows) => rows.map((r) => ({ ...r }));
