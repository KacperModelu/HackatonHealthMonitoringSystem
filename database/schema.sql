-- Cardiology analysis database for the Astronaut Health Monitoring System.
--
-- Part 1 (reference data) comes from two NASA Medical Requirements
-- Integration Documents (JSC 28913):
--   * MEDB 1.6  Resting ECG                              (rev. 12/19/2013)
--   * N3.07     Cycle Ergometer Test / Aerobic Capacity  (rev. 07/24/2017)
--
-- Part 2 (crew, missions, sessions, results, vitals) is SYNTHETIC demo data
-- produced by generate_cardio_db.py. It is not real astronaut data.

PRAGMA foreign_keys = ON;

------------------------------------------------------------------------------
-- Part 1: reference data from the MRID documents
------------------------------------------------------------------------------

CREATE TABLE medical_requirement (
    id                       INTEGER PRIMARY KEY,
    code                     TEXT NOT NULL UNIQUE,      -- 'MEDB 1.6', 'N3.07'
    title                    TEXT NOT NULL,
    sponsor                  TEXT NOT NULL,
    discipline               TEXT,
    category                 TEXT NOT NULL,
    purpose                  TEXT NOT NULL,
    measurement_parameters   TEXT NOT NULL,
    deliverables             TEXT NOT NULL,
    min_flight_duration_days INTEGER,                  -- applies to flights >= N days
    crew_required            TEXT NOT NULL,
    revised_date             TEXT NOT NULL             -- ISO date
);

-- When each activity happens. Offsets are in days relative to an anchor:
--   'launch' (L-), 'flight_day' (FD), 'return' (R-/R+), or 'annual'.
CREATE TABLE schedule_point (
    id               INTEGER PRIMARY KEY,
    requirement_id   INTEGER NOT NULL REFERENCES medical_requirement(id),
    phase            TEXT NOT NULL CHECK (phase IN
                       ('preflight_training','annual','preflight','inflight','postflight','debrief')),
    activity         TEXT NOT NULL,
    label            TEXT NOT NULL,                    -- as written in the document, e.g. 'L-90/30 d'
    anchor           TEXT NOT NULL CHECK (anchor IN ('launch','flight_day','return','annual')),
    offset_days_min  INTEGER,                          -- earliest nominal day (NULL for annual)
    offset_days_max  INTEGER,                          -- latest nominal day
    flexibility_days INTEGER,                          -- +/- days allowed
    duration_min     INTEGER,
    personnel        TEXT,
    location         TEXT,
    notes            TEXT
);

-- Peak cycle exercise test load protocol (N3.07, page 7). Pedalling at 75 rpm.
CREATE TABLE protocol_stage (
    protocol         TEXT NOT NULL CHECK (protocol IN ('nominal','light')),
    stage_no         INTEGER NOT NULL,                 -- 0 = seated rest, 99 = cool down
    stage_type       TEXT NOT NULL CHECK (stage_type IN ('rest','exercise','cooldown')),
    watts            INTEGER NOT NULL,
    duration_sec     INTEGER NOT NULL,
    elapsed_end_sec  INTEGER,                          -- elapsed time at end of stage (NULL for cool down)
    PRIMARY KEY (protocol, stage_no)
);

CREATE TABLE termination_criterion (
    id             INTEGER PRIMARY KEY,                -- numbering as in N3.07 page 8
    requirement_id INTEGER NOT NULL REFERENCES medical_requirement(id),
    description    TEXT NOT NULL,
    is_clinical    INTEGER NOT NULL CHECK (is_clinical IN (0,1))
);

CREATE TABLE test_constraint (
    id             INTEGER PRIMARY KEY,
    requirement_id INTEGER NOT NULL REFERENCES medical_requirement(id),
    applies_to     TEXT NOT NULL,                      -- 'ground', 'inflight', 'all'
    description    TEXT NOT NULL
);

CREATE TABLE equipment (
    id             INTEGER PRIMARY KEY,
    requirement_id INTEGER NOT NULL REFERENCES medical_requirement(id),
    setting        TEXT NOT NULL CHECK (setting IN ('ground','inflight')),
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('hardware','software'))
);

-- Clinical reference ranges used to flag results. These are general adult
-- clinical values (NOT taken from the MRID documents); adjust as needed.
CREATE TABLE reference_range (
    parameter     TEXT PRIMARY KEY,
    unit          TEXT NOT NULL,
    normal_low    REAL,
    normal_high   REAL,
    critical_low  REAL,
    critical_high REAL,
    note          TEXT
);

------------------------------------------------------------------------------
-- Part 2: synthetic crew data
------------------------------------------------------------------------------

CREATE TABLE crew_member (
    id                 INTEGER PRIMARY KEY,
    first_name         TEXT NOT NULL,
    last_name          TEXT NOT NULL,
    sex                TEXT NOT NULL CHECK (sex IN ('M','F')),
    birth_date         TEXT NOT NULL,                 -- approximate (from age) for users added in the app
    height_cm          REAL,                          -- NULL when not entered
    weight_kg          REAL,
    agency             TEXT,
    -- N3.07: 'light' for < 65 kg unless a regular cyclist; NULL if weight unknown
    cycle_protocol     TEXT CHECK (cycle_protocol IN ('nominal','light')),
    regular_cyclist    INTEGER NOT NULL DEFAULT 0 CHECK (regular_cyclist IN (0,1)),
    created_in_app     INTEGER NOT NULL DEFAULT 0 CHECK (created_in_app IN (0,1))
);

CREATE TABLE mission (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    launch_date TEXT NOT NULL,
    return_date TEXT NOT NULL,
    CHECK (return_date > launch_date)
);

CREATE TABLE crew_assignment (
    crew_id    INTEGER NOT NULL REFERENCES crew_member(id),
    mission_id INTEGER NOT NULL REFERENCES mission(id),
    role       TEXT NOT NULL,
    PRIMARY KEY (crew_id, mission_id)
);

CREATE TABLE test_session (
    id                 INTEGER PRIMARY KEY,
    crew_id            INTEGER NOT NULL REFERENCES crew_member(id),
    mission_id         INTEGER REFERENCES mission(id),       -- NULL for annual tests
    schedule_point_id  INTEGER NOT NULL REFERENCES schedule_point(id),
    session_date       TEXT NOT NULL,
    position           TEXT CHECK (position IN ('supine','upright','seated')),
    location           TEXT NOT NULL,                         -- 'JSC', 'ISS', ...
    gas_analyzer       TEXT,                                  -- 'PPFS', 'Parvo Medics TrueOne 2400', NULL
    status             TEXT NOT NULL CHECK (status IN ('completed','terminated','repeat_required')),
    termination_id     INTEGER REFERENCES termination_criterion(id),
    maximal_effort     INTEGER CHECK (maximal_effort IN (0,1)),
    notes              TEXT
);

-- 12-lead resting ECG report (MEDB 1.6, and resting ECG before cycle tests).
CREATE TABLE ecg_result (
    session_id     INTEGER PRIMARY KEY REFERENCES test_session(id),
    heart_rate_bpm INTEGER NOT NULL,
    pr_ms          INTEGER NOT NULL,
    qrs_ms         INTEGER NOT NULL,
    qt_ms          INTEGER NOT NULL,
    qtc_ms         INTEGER NOT NULL,                  -- Bazett
    axis_deg       INTEGER NOT NULL,
    rhythm         TEXT NOT NULL,
    finding        TEXT NOT NULL,
    abnormal       INTEGER NOT NULL CHECK (abnormal IN (0,1)),
    cardiologist_report_date TEXT
);

-- Summary of one peak cycle ergometer test (N3.07).
CREATE TABLE cycle_test_result (
    session_id          INTEGER PRIMARY KEY REFERENCES test_session(id),
    protocol            TEXT NOT NULL CHECK (protocol IN ('nominal','light')),
    peak_watts          INTEGER NOT NULL,
    exercise_time_sec   INTEGER NOT NULL,
    vo2peak_l_min       REAL,                         -- NULL when no gas analysis
    vo2peak_ml_kg_min   REAL,
    vt_vo2_ml_kg_min    REAL,                         -- ventilatory threshold
    vt_percent_vo2peak  REAL,
    hr_rest_bpm         INTEGER NOT NULL,
    hr_peak_bpm         INTEGER NOT NULL,
    rer_peak            REAL,
    rpe_peak            INTEGER CHECK (rpe_peak BETWEEN 6 AND 20),   -- Borg scale, ground only
    hr_recovery_1min    INTEGER                        -- HR drop after 1 min recovery
);

-- Per-stage measurements during the cycle test.
CREATE TABLE stage_measurement (
    session_id      INTEGER NOT NULL REFERENCES test_session(id),
    stage_no        INTEGER NOT NULL,
    watts           INTEGER NOT NULL,
    heart_rate_bpm  INTEGER NOT NULL,
    vo2_ml_kg_min   REAL,
    rpe             INTEGER,
    PRIMARY KEY (session_id, stage_no)
);

-- Blood pressure: pretest (supine/seated), during exercise and recovery.
CREATE TABLE bp_measurement (
    session_id     INTEGER NOT NULL REFERENCES test_session(id),
    seq            INTEGER NOT NULL,
    timepoint      TEXT NOT NULL,                     -- 'supine_rest', 'seated_rest', 'stage_4', 'recovery_3', ...
    systolic_mmhg  INTEGER NOT NULL,
    diastolic_mmhg INTEGER NOT NULL,
    heart_rate_bpm INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
);

-- Daily in-flight monitoring (what the app's vitals window shows).
CREATE TABLE vitals_reading (
    id              INTEGER PRIMARY KEY,
    crew_id         INTEGER NOT NULL REFERENCES crew_member(id),
    mission_id      INTEGER NOT NULL REFERENCES mission(id),
    measured_at     TEXT NOT NULL,                    -- ISO datetime (UTC)
    flight_day      INTEGER NOT NULL,
    systolic_mmhg   INTEGER NOT NULL,
    diastolic_mmhg  INTEGER NOT NULL,
    heart_rate_bpm  INTEGER NOT NULL,
    resp_rate_bpm   REAL NOT NULL,
    skin_temp_c     REAL NOT NULL,
    spo2_pct        REAL NOT NULL
);

CREATE INDEX idx_session_crew      ON test_session(crew_id, session_date);
CREATE INDEX idx_vitals_crew_time  ON vitals_reading(crew_id, measured_at);

------------------------------------------------------------------------------
-- Analysis views
------------------------------------------------------------------------------

-- One row per session with crew, mission and schedule label.
CREATE VIEW v_session_overview AS
SELECT s.id              AS session_id,
       c.first_name || ' ' || c.last_name AS crew_member,
       m.name            AS mission,
       r.code            AS requirement,
       sp.phase,
       sp.label          AS schedule_label,
       s.session_date,
       s.position,
       s.location,
       s.status,
       tc.description    AS termination_reason
FROM test_session s
JOIN crew_member c           ON c.id = s.crew_id
JOIN schedule_point sp       ON sp.id = s.schedule_point_id
JOIN medical_requirement r   ON r.id = sp.requirement_id
LEFT JOIN mission m          ON m.id = s.mission_id
LEFT JOIN termination_criterion tc ON tc.id = s.termination_id;

-- Aerobic capacity before / during / after flight, with % change vs the
-- last preflight upright test (L-90/30 d).
CREATE VIEW v_vo2_trend AS
WITH upright AS (
    SELECT s.crew_id, s.mission_id, sp.label, sp.phase, s.session_date,
           ct.vo2peak_ml_kg_min, ct.peak_watts, ct.hr_peak_bpm
    FROM test_session s
    JOIN schedule_point sp    ON sp.id = s.schedule_point_id
    JOIN cycle_test_result ct ON ct.session_id = s.id
    WHERE s.status = 'completed' AND COALESCE(s.position,'upright') = 'upright'
      AND s.mission_id IS NOT NULL
),
baseline AS (
    SELECT crew_id, mission_id, vo2peak_ml_kg_min AS base_vo2
    FROM upright WHERE label = 'L-90/30 d'
)
SELECT c.first_name || ' ' || c.last_name AS crew_member,
       m.name AS mission, u.label, u.phase, u.session_date,
       u.vo2peak_ml_kg_min, u.peak_watts, u.hr_peak_bpm,
       ROUND(100.0 * (u.vo2peak_ml_kg_min - b.base_vo2) / b.base_vo2, 1) AS pct_change_vs_preflight
FROM upright u
JOIN baseline b   ON b.crew_id = u.crew_id AND b.mission_id = u.mission_id
JOIN crew_member c ON c.id = u.crew_id
JOIN mission m     ON m.id = u.mission_id
ORDER BY crew_member, u.session_date;

-- In-flight vitals outside the reference ranges.
CREATE VIEW v_vitals_alerts AS
SELECT v.id, c.first_name || ' ' || c.last_name AS crew_member, m.name AS mission,
       v.measured_at, v.flight_day, x.parameter, x.value,
       CASE WHEN x.value < rr.critical_low OR x.value > rr.critical_high THEN 'critical'
            ELSE 'warning' END AS severity
FROM vitals_reading v
JOIN crew_member c ON c.id = v.crew_id
JOIN mission m     ON m.id = v.mission_id
JOIN (
    SELECT id, 'systolic_mmhg'  AS parameter, systolic_mmhg  AS value FROM vitals_reading UNION ALL
    SELECT id, 'diastolic_mmhg',               diastolic_mmhg          FROM vitals_reading UNION ALL
    SELECT id, 'heart_rate_bpm',               heart_rate_bpm          FROM vitals_reading UNION ALL
    SELECT id, 'resp_rate_bpm',                resp_rate_bpm           FROM vitals_reading UNION ALL
    SELECT id, 'skin_temp_c',                  skin_temp_c             FROM vitals_reading UNION ALL
    SELECT id, 'spo2_pct',                     spo2_pct                FROM vitals_reading
) x ON x.id = v.id
JOIN reference_range rr ON rr.parameter = x.parameter
WHERE x.value < rr.normal_low OR x.value > rr.normal_high;

-- Abnormal ECG findings.
CREATE VIEW v_ecg_findings AS
SELECT o.crew_member, o.mission, o.schedule_label, o.session_date,
       e.heart_rate_bpm, e.pr_ms, e.qrs_ms, e.qtc_ms, e.rhythm, e.finding
FROM ecg_result e
JOIN v_session_overview o ON o.session_id = e.session_id
WHERE e.abnormal = 1;
