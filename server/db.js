// Access to the SQLite database (database/cardio_analysis.db, created by
// database/generate_cardio_db.py). Uses Node's built-in node:sqlite, so there are no
// native dependencies to compile.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const defaultDbPath = path.resolve(here, '../database/cardio_analysis.db');

// Opens the database and makes sure it is usable:
//   1. the file must exist (it is built by the Python script, never created empty here),
//   2. foreign keys are switched on (SQLite leaves them off by default, per connection),
//   3. tables added after the first version are created if missing, so older copies of
//      the file keep working without a separate migration step.
// CARDIO_DB lets you point the app at a copy, so experiments do not touch the tracked file.
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
  db.exec(WELLBEING_TABLES);
  return db;
}

// Tables for the psychological and cognitive assessments (same as database/schema.sql).
const WELLBEING_TABLES = `-- Psychological wellbeing questionnaire (10 questions, up to 10 points each)
CREATE TABLE IF NOT EXISTS psych_assessment (
    id        INTEGER PRIMARY KEY,
    crew_id   INTEGER NOT NULL REFERENCES crew_member(id),
    taken_at  TEXT NOT NULL,                      -- ISO datetime (UTC)
    score     INTEGER NOT NULL,
    max_score INTEGER NOT NULL,
    percent   REAL NOT NULL                        -- < 60 % = contact support
);
CREATE TABLE IF NOT EXISTS psych_answer (
    assessment_id INTEGER NOT NULL REFERENCES psych_assessment(id),
    question_no   INTEGER NOT NULL,
    question      TEXT NOT NULL,
    answer        TEXT NOT NULL,
    points        INTEGER NOT NULL CHECK (points BETWEEN 0 AND 10),
    PRIMARY KEY (assessment_id, question_no)
);
-- Private journal entries (supportive activity)
CREATE TABLE IF NOT EXISTS journal_entry (
    id         INTEGER PRIMARY KEY,
    crew_id    INTEGER NOT NULL REFERENCES crew_member(id),
    written_at TEXT NOT NULL,
    text       TEXT NOT NULL
);
-- Cognitive tests: reaction, memory, two_back, matrix, spatial, symbols
CREATE TABLE IF NOT EXISTS cognitive_result (
    id              INTEGER PRIMARY KEY,
    crew_id         INTEGER NOT NULL REFERENCES crew_member(id),
    taken_at        TEXT NOT NULL,
    test            TEXT NOT NULL CHECK (test IN ('reaction','memory','two_back','matrix','spatial','symbols')),
    correct         INTEGER,                      -- NULL for reaction time
    max_correct     INTEGER,
    avg_reaction_ms REAL,                         -- reaction time only
    false_starts    INTEGER,                      -- reaction time only
    duration_sec    REAL,                         -- digit-symbol matching only
    details         TEXT NOT NULL                 -- one line per trial / question
);
CREATE INDEX IF NOT EXISTS idx_psych_crew     ON psych_assessment(crew_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_cognitive_crew ON cognitive_result(crew_id, test, taken_at);`;

// Runs fn inside a transaction; rolls back if it throws.
// node:sqlite is synchronous, so nothing else can run between BEGIN and COMMIT:
// a generated profile (hundreds of rows in many tables) is stored fully or not at all.
// Not re-entrant: do not call transaction() from inside fn.
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
