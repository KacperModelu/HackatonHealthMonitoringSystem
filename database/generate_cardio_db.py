#!/usr/bin/env python3
"""Build the cardiology analysis database (SQLite).

    python3 database/generate_cardio_db.py            # -> database/cardio_analysis.db
    python3 database/generate_cardio_db.py out.db

Reference tables are transcribed from NASA MRID JSC 28913 documents
MEDB 1.6 (Resting ECG) and N3.07 (Cycle Ergometer Test / Aerobic Functional
Capacity). Crew, missions, test sessions, results and vitals are SYNTHETIC:
generated with a fixed seed so every run produces the same database.
"""

import math
import random
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
TODAY = date(2026, 11, 14)
rng = random.Random(2026)


def iso(d):
    return d.isoformat()


def r1(x):
    return round(x, 1)


# ---------------------------------------------------------------------------
# Part 1: reference data from the MRID documents
# ---------------------------------------------------------------------------

REQUIREMENTS = [
    (1, "MEDB 1.6", "Resting ECG", "Medical Operations", None, "Medical Requirements",
     "To assess pre- and postflight ECG recordings on long-duration flight crew members "
     "at rest using a 12-lead electrocardiogram (ECG).",
     "12-lead ECG tracing",
     "Pre- and postflight ECG reports related to the cardiovascular examination.",
     30, "All ISS crew members", "2013-12-19"),
    (2, "N3.07", "Cycle Ergometer Test/Aerobic Functional Capacity", "Medical Operations",
     "Cardiovascular, Exercise, Muscle", "Medical Requirements (MR)",
     "Annual assessment of cardiovascular status and aerobic fitness testing before, during "
     "and following ISS flight. Documents that the astronaut maintains an acceptable "
     "cardiovascular training status and has no clinically significant cardiac abnormalities; "
     "data are used to set and adjust exercise prescriptions.",
     "ECG, heart rate, oxygen consumption to peak exercise (VO2 peak). Ratings of perceived "
     "exertion (RPE) during ground tests. Blood pressure pretest, during exercise and "
     "throughout recovery.",
     "Assessment of aerobic capacity by Exercise Physiologists (EP). ECG interpretation by a "
     "cardiologist of ground tests.",
     30, "All U.S. crewmembers", "2017-07-24"),
]

# id, req, phase, activity, label, anchor, min, max, flex, duration, personnel, location, notes
SCHEDULE = [
    (1, 1, "preflight", "Resting ECG", "L-9/6 m to L-10 d", "launch", -270, -10, None, 15,
     "Lab Technician, crew member", "JSC / Russia",
     "Also as clinically indicated. Supine 15 min, 10 electrode sites."),
    (2, 1, "postflight", "Resting ECG", "R+0/3 d", "return", 0, 3, None, 15,
     "Technician, crew member", "JSC / Russia", "Also as clinically indicated."),
    (3, 2, "preflight_training", "CMS CEVIS Ops", "L-1 year", "launch", -365, -365, 30, 60,
     "CMS Ops Instructors/Crew", "U.S.", "HRM, CEVIS and Countermeasures Software."),
    (4, 2, "preflight_training", "PPFS Ops", "L-300 d", "launch", -300, -300, 30, 90,
     "PPFS Ops Instructors/Crew", "ESA (Köln)", "Portable Pulmonary Function System."),
    (5, 2, "preflight_training", "VO2 Training", "L-180 d", "launch", -180, -180, 30, 90,
     "Instructors/Crew", "U.S. / ESA", "Optional sub-max portion of the protocol."),
    (6, 2, "preflight_training", "VO2 Proficiency Training", "L-90 to L-30 d", "launch", -90, -30,
     30, 60, "Instructors/Crew/Exercise Physiologist", "U.S.",
     "30 min if combined with a data collection session. Repeat if launch slips > 3 months."),
    (7, 2, "annual", "Annual Cycle Test (non-assigned astronaut)", "Annually", "annual", None,
     None, 30, 60, "Lab Personnel, Crewmember, Physician (on call)", "JSC",
     "Parvo Medics TrueOne 2400 preferred; PPFS acceptable."),
    (8, 2, "preflight", "Upright Test", "L-12 months", "launch", -365, -365, 30, 60,
     "Lab Personnel, Crewmember, Physician (on call)", "JSC",
     "PPFS preferred. A peak test within 1 year of launch may substitute."),
    (9, 2, "preflight", "Supine Measure", "L-90/30 d", "launch", -90, -30, 30, 60,
     "Lab Personnel, Crewmember, Physician (on call)", "JSC",
     "Ideally L-1 month; within 14 days of the upright test."),
    (10, 2, "preflight", "Upright Test", "L-90/30 d", "launch", -90, -30, 30, 60,
     "Lab Personnel, Crewmember, Physician (on call)", "JSC",
     "PPFS required unless hardware failure. Repeat if launch delayed > 3 months."),
    (11, 2, "inflight", "Cycle Ergometry Test", "FD 14", "flight_day", 14, 14, 2, 85,
     "ISS Crewmember, Ground Monitoring Personnel", "ISS",
     "First performance: 85 min (Med Ops 60, Exercise 25)."),
    (12, 2, "inflight", "Cycle Ergometry Test", "FD 75", "flight_day", 75, 75, 7, 70,
     "ISS Crewmember, Ground Monitoring Personnel", "ISS",
     "Subsequent performance: 70 min (Med Ops 45, Exercise 25)."),
    (13, 2, "inflight", "Cycle Ergometry Test", "R-14 d", "return", -14, -14, 5, 70,
     "ISS Crewmember, Ground Monitoring Personnel", "ISS",
     "Repeat if mission is extended by > 16 days."),
    (14, 2, "inflight", "Cycle Ergometry Test", "As clinically indicated", "flight_day", None,
     None, None, 70, "ISS Crewmember, Ground Monitoring Personnel", "ISS",
     "May be requested before an EMU EVA."),
    (15, 2, "postflight", "Cycle Exercise Test", "R+5 d", "return", 5, 5, 2, 60,
     "Lab Personnel, Crewmember, Physician (on call)", "JSC",
     "Crew surgeon recommended to monitor."),
    (16, 2, "postflight", "Cycle Exercise Test", "R+30 d", "return", 30, 30, 4, 60,
     "Lab Personnel, Crewmember, Physician (on call)", "JSC",
     "Physician on call within 15 minutes."),
    (17, 2, "debrief", "Postflight Debrief", "~R+30 d", "return", 30, 30, None, None,
     "ASCR/Crewmember/Lab Personnel/Crew surgeon", "JSC",
     "Part of the Med Ops overall debrief."),
]

NOMINAL = [50] + list(range(75, 476, 25))     # 50, 75 ... 475 W
LIGHT = [45] + list(range(60, 301, 15))       # 45, 60 ... 300 W


def protocol_rows():
    rows = []
    for name, loads in (("nominal", NOMINAL), ("light", LIGHT)):
        rows.append((name, 0, "rest", 0, 180, 180))
        elapsed = 180
        for i, w in enumerate(loads, start=1):
            dur = 180 if i == 1 else 60
            elapsed += dur
            rows.append((name, i, "exercise", w, dur, elapsed))
        rows.append((name, 99, "cooldown", 50 if name == "nominal" else 45, 180, None))
    return rows


TERMINATION = [
    (1, 2, "Onset of symptoms consistent with angina pectoris", 1),
    (2, 2, "Sustained ventricular tachycardia (7 or more sequential complexes)", 1),
    (3, 2, "Cardiac dysrhythmia not observed preflight accompanied by unusual symptoms of "
           "exertional intolerance", 1),
    (4, 2, "Technical difficulties monitoring the ECG", 0),
    (5, 2, "Unusual or severe shortness of breath (inconsistent with level of effort)", 1),
    (6, 2, "Signs of poor perfusion, including pallor, cyanosis, or cold and clammy skin", 1),
    (7, 2, "Volitional fatigue (repeat test if effort judged submaximal)", 0),
]

CONSTRAINTS = [
    (1, "all", "No caffeine or alcohol for 12 hours prior to testing."),
    (1, "all", "Subject lies supine for 15 minutes while tracings are recorded from 10 electrode sites."),
    (1, "all", "Raw data to PACS within 24 hours; final report in MMIS within three business days."),
    (2, "ground", "Testing performed during normal clinic hours; physician on call within 15 minutes."),
    (2, "all", "Symptomatic dysrhythmia or hemodynamic compromise pretest: notify medical monitor and postpone."),
    (2, "all", "No max exercise 24 hours prior to testing; no exercise 8 hours prior."),
    (2, "all", "Wear workout clothing (shorts, t-shirt, sneakers)."),
    (2, "all", "No large meals 2 hours prior; light meal permitted up to 60 minutes before test."),
    (2, "all", "Limit caffeine 8 hours prior; one cup (8 oz) of coffee permitted up to 60 minutes before."),
    (2, "all", "No alcohol or nicotine 8 hours prior to test."),
    (2, "all", "Do not apply lotion to the torso on the day of testing."),
    (2, "all", "Contraindication: musculoskeletal injury preventing maximal cycle exercise."),
    (2, "ground", "No Neutral Buoyancy training 48 hours prior to test (72 hours preferred)."),
    (2, "ground", "Not within 72 h of overseas or 48 h of domestic travel unless approved by Crew Surgeon."),
    (2, "ground", "All monitoring personnel AED qualified; AED present; EP monitoring ECG is BLS certified."),
    (2, "inflight", "Crewmember uses PPFS for VO2 and ECG heart rate, plus a Heart Rate Monitor as redundancy."),
    (2, "inflight", "Ku-band required for the exercise portion (max 21 minute window); no Ku LOS."),
    (2, "inflight", "CEVIS limited to 350 W; at 350 W the stage is extended to max 3 minutes, then cool down."),
    (2, "ground", "12-lead ECG to cardiologist and PACS within 48 h; final report to EMR within 14 days."),
]

EQUIPMENT = [
    (1, "ground", "12-lead electrocardiogram (ECG) machine", "hardware"),
    (1, "ground", "Electrodes and skin prep supplies", "hardware"),
    (2, "ground", "LODE Electronic Cycle Ergometer", "hardware"),
    (2, "ground", "Supine Cycle Ergometer", "hardware"),
    (2, "ground", "Electrocardiographic System (GE CASE)", "hardware"),
    (2, "ground", "Metabolic Gas Analyzer (Parvo Medics TrueOne 2400 or PPFS)", "hardware"),
    (2, "ground", "Metabolic Gas Analyzer accessories and consumables", "hardware"),
    (2, "ground", "Sphygmomanometer", "hardware"),
    (2, "ground", "RPE Chart", "hardware"),
    (2, "ground", "Electrocardiographic Software", "software"),
    (2, "ground", "Metabolic Gas Analysis Software", "software"),
    (2, "inflight", "ISS Ergometer (CEVIS)", "hardware"),
    (2, "inflight", "CEVIS Accessory Bag", "hardware"),
    (2, "inflight", "Isolator Kit Assembly", "hardware"),
    (2, "inflight", "On-Orbit Mounting Frame", "hardware"),
    (2, "inflight", "IVIS Box, Blue", "hardware"),
    (2, "inflight", "IVIS Box, Red", "hardware"),
    (2, "inflight", "Station Support Computer Kit 1", "hardware"),
    (2, "inflight", "USB", "hardware"),
    (2, "inflight", "Heart Rate Monitor Kit", "hardware"),
    (2, "inflight", "PPFS and accessories", "hardware"),
    (2, "inflight", "3 Liter calibration syringe/HRF", "hardware"),
    (2, "inflight", "PFM/PAM Calibration Syringe", "hardware"),
    (2, "inflight", "Tube", "hardware"),
    (2, "inflight", "PPFS accessories kit", "hardware"),
    (2, "inflight", "Calibration gases", "hardware"),
    (2, "inflight", "Countermeasures Software (CMSS)", "software"),
]

REFERENCE_RANGES = [
    ("systolic_mmhg", "mmHg", 90, 130, 70, 160, "Resting systolic blood pressure"),
    ("diastolic_mmhg", "mmHg", 60, 85, 45, 100, "Resting diastolic blood pressure"),
    ("heart_rate_bpm", "bpm", 50, 100, 40, 130, "Resting heart rate"),
    ("resp_rate_bpm", "breaths/min", 12, 20, 8, 25, "Resting respiratory rate"),
    ("skin_temp_c", "°C", 32.5, 35.5, 31.5, 36.5, "Skin temperature (wearable sensor)"),
    ("spo2_pct", "%", 95, 100, 92, 100.5, "Peripheral oxygen saturation"),
    ("pr_ms", "ms", 120, 200, None, 300, "ECG PR interval"),
    ("qrs_ms", "ms", 70, 110, None, 120, "ECG QRS duration"),
    ("qtc_ms", "ms", 350, 450, None, 500, "ECG QTc (Bazett); 460 ms upper limit for women"),
    ("rer_peak", "", 1.10, None, None, None, "RER >= 1.10 suggests maximal effort"),
]


# ---------------------------------------------------------------------------
# Part 3: gamification tasks and plain-language guide
# ---------------------------------------------------------------------------

# code, title, description, why, category, points
HEALTH_TASKS = [
    ("morning_vitals", "Morning vitals check",
     "Right after waking, before coffee or exercise: blood pressure, heart rate, SpO2.",
     "Measuring at the same time each day makes trends easy to spot.", "measure", 10),
    ("evening_vitals", "Evening vitals check",
     "Before sleep, sit still for 5 minutes and repeat the measurements.",
     "A second daily reading shows how your body handled the day.", "measure", 5),
    ("aerobic", "Aerobic session (CEVIS / treadmill)",
     "30+ minutes of cycling or running at the intensity in your exercise prescription.",
     "Keeps your heart and VO2peak from declining in microgravity.", "exercise", 20),
    ("resistance", "Resistance training (ARED)",
     "Complete today's resistance exercise protocol.",
     "Protects muscles and bones, which also supports blood circulation.", "exercise", 20),
    ("hydration", "Drink 2 litres of water",
     "Spread it over the day; log it in your hydration tracker.",
     "Fluids shift toward your head in space; drinking enough supports blood volume.",
     "recovery", 5),
    ("sleep", "Sleep 8 hours",
     "Keep a regular sleep window and dim the lights an hour before.",
     "Poor sleep raises resting heart rate and blood pressure.", "recovery", 10),
    ("wellbeing", "How do you feel?",
     "Log your mood, energy and any symptoms (headache, dizziness, palpitations).",
     "Symptoms you notice early help the flight surgeon act early.", "recovery", 5),
    ("learn", "Read one guide topic",
     "Open the Guide tab and read about one health indicator.",
     "Knowing what is normal for you helps you spot changes yourself.", "learn", 5),
]

# topic, title, order, what, how (steps | separated), why in space, when to act, requirement
GUIDE = [
    ("colors", "Reading the colours", 0,
     "Every value in this app is coloured by how it compares with the normal range. "
     "Green means within the normal range. Amber means outside the normal range but not "
     "dangerous: worth a second look. Red means far outside the normal range.",
     "Green: carry on.|Amber: re-measure in a few minutes, sitting still. If it stays amber, "
     "watch the trend over the next days.|Red: re-measure now. If it is still red, contact "
     "the flight surgeon.",
     "One unusual reading is often caused by movement, talking, or a loose sensor. "
     "A trend over several days tells more than a single number.",
     "Contact the flight surgeon for any red value that repeats, or for amber values "
     "together with symptoms. This app does not replace medical advice.", None),
    ("systolic_mmhg", "Blood pressure", 1,
     "The pressure of blood on your artery walls, written as two numbers: systolic (when the "
     "heart beats) over diastolic (when it relaxes), e.g. 118/76 mmHg.",
     "Sit or stay restrained and relaxed for 5 minutes.|Put the cuff on your bare upper arm, at "
     "heart level.|Do not talk or move during the measurement.|Take two readings one minute "
     "apart and record both.",
     "In microgravity body fluids shift toward the head, and blood pressure is often slightly "
     "lower in flight. After landing, standing up can make you dizzy because the circulation "
     "has to re-adapt to gravity.",
     "Systolic above 130 or diastolic above 85 on several days: mention it at your next "
     "medical conference. Above 160/100, or below 90 systolic with dizziness: contact the "
     "flight surgeon.", None),
    ("heart_rate_bpm", "Resting heart rate", 2,
     "How many times your heart beats per minute while you are at rest.",
     "Measure right after waking, before coffee or exercise.|Stay still for one minute.|Read "
     "the value from the heart rate monitor or count your pulse for 60 seconds.",
     "Resting heart rate often drops slightly in flight. A resting rate that climbs over "
     "several days can point to poor sleep, stress, illness or loss of fitness.",
     "Resting rate above 100 or below 40 with symptoms, or a feeling of skipped or irregular "
     "beats: contact the flight surgeon.", None),
    ("resp_rate_bpm", "Respiratory rate", 3,
     "How many breaths you take per minute at rest.",
     "Sit relaxed and breathe normally.|Count each time your chest rises for 60 seconds, or "
     "read the value from the wearable sensor.",
     "Raised carbon dioxide (CO2) in the cabin can make you breathe faster and cause "
     "headaches. If several crew members breathe faster at the same time, suspect the air, "
     "not your body.",
     "Above 20 breaths per minute at rest for more than a day, or shortness of breath: report "
     "it, and ask the ground to check cabin CO2.", None),
    ("skin_temp_c", "Skin temperature", 4,
     "The temperature measured by the sensor on your skin. It is lower than core body "
     "temperature (about 37 °C) and normally lies between 32.5 and 35.5 °C.",
     "Keep the sensor in firm contact with the skin.|Avoid measuring right after exercise or "
     "a hygiene session.",
     "Your immune system changes in space, so infections can appear more easily. A rise "
     "together with a higher heart rate is an early sign of fever.",
     "More than 1 °C above your usual value and you feel unwell: tell the flight surgeon.",
     None),
    ("spo2_pct", "Blood oxygen (SpO2)", 5,
     "The percentage of your red blood cells that carry oxygen. Healthy values are 95–100 %.",
     "Warm your hand first.|Put the pulse oximeter on a fingertip and keep still for 30 "
     "seconds.|Read the value once the number stops changing.",
     "The station air normally has the same oxygen pressure as on Earth at sea level. A drop "
     "can mean a problem with the cabin air, a respiratory illness, or just cold fingers.",
     "Below 95 %: re-measure on a warm finger. Below 92 %, or with shortness of breath: "
     "contact the flight surgeon immediately.", None),
    ("vo2peak", "Aerobic fitness (VO2peak)", 6,
     "The most oxygen your body can use during maximal exercise, in ml per kg per minute. "
     "It is the best single measure of heart and lung fitness.",
     "Measured during the cycle ergometer test: 3 minutes of seated rest, then the load rises "
     "every minute until you cannot continue.|Heart rate, ECG, blood pressure and breathing "
     "gases are recorded throughout.",
     "Without gravity the heart and muscles work less and lose fitness. VO2peak usually drops "
     "most in the first weeks of flight; regular hard exercise limits the loss.",
     "A drop of more than 15 % from your preflight value: discuss your exercise prescription "
     "with the exercise physiologist.", 2),
    ("ecg", "Resting ECG", 7,
     "An electrocardiogram records the heart's electrical activity using 10 electrodes "
     "(12 leads). It shows heart rhythm and how signals travel through the heart.",
     "Lie on your back for 15 minutes while the tracing is recorded.|Electrodes go on the "
     "chest and limbs; the skin is prepared first.",
     "Done before and after long flights to compare the heart's rhythm and conduction.",
     "Palpitations, fainting or chest pain at any time: contact the flight surgeon "
     "immediately.", 1),
]


def add_gamification(db, crew_ids_by_mission, today):
    """Synthetic task history: completions during and after each mission."""
    g = random.Random(4242)          # separate RNG keeps the rest of the data unchanged
    task_ids = {code: i for i, (code, *_rest) in enumerate(HEALTH_TASKS, start=1)}
    # How likely each task is done on a given day, for an average crew member.
    base_p = {"morning_vitals": 0.92, "evening_vitals": 0.7, "aerobic": 0.8,
              "resistance": 0.75, "hydration": 0.65, "sleep": 0.55, "wellbeing": 0.6,
              "learn": 0.15}
    rows = []
    for (launch, _ret), crew_ids in crew_ids_by_mission.items():
        for cid in crew_ids:
            diligence = g.uniform(0.75, 1.1)
            day = launch
            while day < today:
                # Fewer tasks done on the ground after the mission
                factor = diligence if day <= _ret else diligence * 0.8
                for code, p in base_p.items():
                    if g.random() < min(p * factor, 0.98):
                        rows.append((cid, task_ids[code], day.isoformat()))
                day += timedelta(days=1)
    db.executemany("INSERT INTO task_completion (crew_id, task_id, completed_on) VALUES (?,?,?)",
                   rows)


# ---------------------------------------------------------------------------
# Part 2: synthetic crew data
# ---------------------------------------------------------------------------

# first, last, sex, birth, height, weight, agency, regular cyclist
CREW = [
    ("Anna", "Kowalczyk", "F", "1986-04-12", 168, 61.5, "POLSA", 1),
    ("Marek", "Zieliński", "M", "1982-09-03", 181, 82.0, "ESA", 0),
    ("Elena", "Vasquez", "F", "1988-01-27", 163, 58.0, "NASA", 0),
    ("Tomasz", "Lewandowski", "M", "1979-06-18", 177, 78.5, "POLSA", 1),
    ("Hiro", "Tanabe", "M", "1984-11-30", 172, 70.0, "JAXA", 0),
    ("Claire", "Dubois", "F", "1985-07-08", 170, 66.0, "ESA", 0),
    ("James", "Whitford", "M", "1980-02-14", 186, 88.5, "NASA", 0),
    ("Sofia", "Lindqvist", "F", "1990-05-21", 174, 64.0, "ESA", 1),
    ("Rahul", "Menon", "M", "1987-12-02", 175, 73.0, "NASA", 1),
    ("Natalia", "Wiśniewska", "F", "1983-03-09", 166, 59.5, "POLSA", 0),
    ("Daniel", "Okafor", "M", "1985-08-25", 183, 84.0, "CSA", 0),
    ("Mei", "Lin", "F", "1989-10-16", 160, 54.5, "NASA", 0),
    # Not assigned to a mission yet: annual tests only.
    ("Paweł", "Mazur", "M", "1991-02-05", 179, 76.0, "POLSA", 0),
    ("Ingrid", "Halvorsen", "F", "1992-06-30", 171, 63.0, "ESA", 1),
    ("Lucas", "Moreau", "M", "1988-09-12", 180, 79.0, "ESA", 0),
]

MISSIONS = [
    (1, "HMS-1", "2024-03-10", "2024-09-08"),
    (2, "HMS-2", "2024-09-20", "2025-03-15"),
    (3, "HMS-3", "2025-03-25", "2025-10-02"),
    (4, "HMS-4", "2025-10-10", "2026-04-08"),
]
ROLES = ["Commander", "Flight Engineer 1", "Flight Engineer 2"]

# How strongly VO2peak drops in flight, relative to the cohort average.
# (Countermeasure response varies a lot between individuals.)
PHASE_VO2 = {   # schedule_point_id -> multiplier of baseline VO2peak (average responder)
    7: 0.99, 8: 1.00, 10: 1.00, 9: 0.92,
    11: 0.86, 12: 0.90, 13: 0.92, 14: 0.90, 15: 0.85, 16: 0.96,
}
PHASE_WEIGHT = {11: 0.975, 12: 0.97, 13: 0.97, 14: 0.97, 15: 0.98, 16: 0.995}
PHASE_HR_REST = {9: -6, 11: -3, 12: -2, 13: -2, 14: -2, 15: 9, 16: 2}


class Builder:
    def __init__(self, db):
        self.db = db
        self.session_id = 0
        self.crew = {}   # id -> dict

    # -- helpers -----------------------------------------------------------

    def age_on(self, crew, d):
        b = date.fromisoformat(crew["birth"])
        return d.year - b.year - ((d.month, d.day) < (b.month, b.day))

    def new_session(self, crew_id, mission_id, sp_id, d, position, location, analyzer,
                    status="completed", termination=7, maximal=1, notes=None):
        self.session_id += 1
        self.db.execute(
            "INSERT INTO test_session VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (self.session_id, crew_id, mission_id, sp_id, iso(d), position, location,
             analyzer, status, termination, maximal, notes))
        return self.session_id

    # -- crew ----------------------------------------------------------------

    def add_crew(self):
        for i, (fn, ln, sex, birth, h, w, agency, cyclist) in enumerate(CREW, start=1):
            protocol = "light" if (w < 65 and not cyclist) else "nominal"
            self.db.execute("INSERT INTO crew_member VALUES (?,?,?,?,?,?,?,?,?,?,0)",
                            (i, fn, ln, sex, birth, h, w, agency, protocol, cyclist))
            base = rng.uniform(39, 48) if sex == "M" else rng.uniform(33, 42)
            if cyclist:
                base += 3
            self.crew[i] = dict(
                id=i, sex=sex, birth=birth, weight=w, protocol=protocol,
                vo2_base=base,
                responder=rng.uniform(0.5, 1.35),          # in-flight deconditioning factor
                hr_rest=rng.randint(52, 66),
                hr_max_offset=rng.uniform(-6, 6),
                sbp=rng.randint(108, 126), dbp=rng.randint(66, 80),
                vt_frac=rng.uniform(0.58, 0.70),
                skin=rng.uniform(33.6, 34.3), resp=rng.uniform(13.0, 16.0),
                qtc=rng.randint(388, 425) + (10 if sex == "F" else 0),
                pr=rng.randint(135, 185), qrs=rng.randint(84, 102),
                axis=rng.randint(10, 75),
            )

    # -- cycle ergometer test --------------------------------------------------

    def cycle_test(self, crew_id, mission_id, sp_id, d, position, location, analyzer,
                   status="completed", termination=7, maximal=1, notes=None,
                   vo2_factor=1.0, inflight=False):
        c = self.crew[crew_id]
        sid = self.new_session(crew_id, mission_id, sp_id, d, position, location, analyzer,
                               status, termination, maximal, notes)
        weight = c["weight"] * PHASE_WEIGHT.get(sp_id, 1.0) * rng.uniform(0.99, 1.01)
        mult = PHASE_VO2.get(sp_id, 1.0)
        loss = (1 - mult) * (c["responder"] if sp_id in (11, 12, 13, 14, 15, 16) else 1)
        vo2peak = c["vo2_base"] * (1 - loss) * vo2_factor * rng.uniform(0.97, 1.03)
        if not maximal:
            vo2peak *= rng.uniform(0.86, 0.92)

        loads = NOMINAL if c["protocol"] == "nominal" else LIGHT
        target_w = (vo2peak - 7) * weight / 10.8            # ACSM leg cycling equation
        if inflight:
            target_w = min(target_w, 350)                   # CEVIS limit
        stages = [w for w in loads if w <= target_w] or loads[:1]
        peak_w = stages[-1]
        partial = rng.randint(5, 55) if peak_w < loads[-1] else 0
        if inflight and peak_w == 350:
            partial = 0
            notes = (notes + " " if notes else "") + "Reached CEVIS 350 W limit; stage extended."
            self.db.execute("UPDATE test_session SET notes=? WHERE id=?", (notes, sid))
        exercise_sec = 180 + 60 * (len(stages) - 1) + partial
        if inflight and peak_w == 350:
            exercise_sec += 120

        age = self.age_on(c, d)
        hr_rest = c["hr_rest"] + PHASE_HR_REST.get(sp_id, 0) + rng.randint(-3, 3)
        hr_peak = round(208 - 0.7 * age + c["hr_max_offset"] + rng.uniform(-3, 3))
        if not maximal:
            hr_peak -= rng.randint(10, 18)
        if position == "supine":
            hr_peak -= rng.randint(4, 9)
        if sp_id == 15:
            hr_peak += rng.randint(0, 5)

        has_gas = analyzer is not None
        vo2_rest = 3.5
        vt_frac = c["vt_frac"] * (0.93 if sp_id == 15 else 1.0) * rng.uniform(0.97, 1.03)
        rer = rng.uniform(1.10, 1.24) if maximal else rng.uniform(1.01, 1.07)
        rpe_peak = None if inflight else (rng.randint(18, 20) if maximal else rng.randint(14, 16))

        # Per-stage measurements
        self.db.execute("INSERT INTO stage_measurement VALUES (?,?,?,?,?,?)",
                        (sid, 0, 0, hr_rest + rng.randint(4, 9),
                         r1(vo2_rest + rng.uniform(0.2, 1.0)) if has_gas else None,
                         None if inflight else 6))
        for n, w in enumerate(stages, start=1):
            vo2_stage = min(10.8 * w / weight + 7, vo2peak)
            frac = (vo2_stage - vo2_rest) / (vo2peak - vo2_rest)
            hr = round(hr_rest + 8 + (hr_peak - hr_rest - 8) * frac ** 1.05 + rng.uniform(-2, 2))
            rpe = None if inflight else max(6, min(20, round(6 + (rpe_peak - 6) * frac ** 1.3)))
            self.db.execute("INSERT INTO stage_measurement VALUES (?,?,?,?,?,?)",
                            (sid, n, w, min(hr, hr_peak),
                             r1(vo2_stage * rng.uniform(0.97, 1.03)) if has_gas else None, rpe))

        hrr1 = rng.randint(14, 30) - (6 if sp_id == 15 else 0)
        self.db.execute(
            "INSERT INTO cycle_test_result VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, c["protocol"], peak_w, exercise_sec,
             round(vo2peak * weight / 1000, 2) if has_gas else None,
             r1(vo2peak) if has_gas else None,
             r1(vo2peak * vt_frac) if has_gas else None,
             r1(vt_frac * 100) if has_gas else None,
             hr_rest, hr_peak, round(rer, 2) if has_gas else None, rpe_peak, hrr1))

        # Blood pressure: pretest, every 2nd stage + peak, 5 min recovery
        sbp0 = c["sbp"] + (6 if sp_id == 15 else 0) + rng.randint(-4, 4)
        dbp0 = c["dbp"] + (4 if sp_id == 15 else 0) + rng.randint(-3, 3)
        seq = 0
        points = [("supine_rest", 0, -2, 0), ("seated_rest", 0, 2, 5)]
        for n, w in enumerate(stages, start=1):
            if n % 2 == 0 or n == len(stages):
                points.append((f"stage_{n}", w, 0, 0))
        for name, w, sbp_adj, hr_adj in points:
            seq += 1
            if w:
                frac = w / peak_w
                sbp = sbp0 + 0.27 * w + rng.randint(-6, 6)
                dbp = dbp0 + rng.randint(-6, 4) - 4 * frac
                hr = round(hr_rest + (hr_peak - hr_rest) * frac ** 1.1)
            else:
                sbp, dbp, hr = sbp0 + sbp_adj, dbp0, hr_rest + hr_adj
            self.db.execute("INSERT INTO bp_measurement VALUES (?,?,?,?,?,?)",
                            (sid, seq, name, round(sbp), round(dbp), hr))
        sbp_peak = sbp0 + 0.27 * peak_w
        hr_now = hr_peak
        for minute in range(1, 6):
            seq += 1
            hr_now = hr_now - (hrr1 if minute == 1 else rng.randint(5, 10))
            sbp_now = sbp0 + (sbp_peak - sbp0) * math.exp(-0.45 * minute) + rng.randint(-5, 5)
            self.db.execute("INSERT INTO bp_measurement VALUES (?,?,?,?,?,?)",
                            (sid, seq, f"recovery_{minute}", round(sbp_now),
                             dbp0 + rng.randint(-5, 3), max(hr_now, hr_rest + 10)))
        return sid

    # -- resting ECG -----------------------------------------------------------

    def ecg(self, crew_id, mission_id, sp_id, d, postflight=False, special=None):
        c = self.crew[crew_id]
        sid = self.new_session(crew_id, mission_id, sp_id, d, "supine",
                               rng.choice(["JSC", "JSC", "Star City"]), None,
                               termination=None, maximal=None)
        hr = c["hr_rest"] - 4 + rng.randint(-3, 3) + (9 if postflight else 0)
        pr = c["pr"] + rng.randint(-6, 6)
        qrs = c["qrs"] + rng.randint(-3, 3)
        qtc = c["qtc"] + rng.randint(-6, 6) + (9 if postflight else 0)
        rhythm, finding, abnormal = "Sinus rhythm", "Normal ECG", 0
        if hr < 50:
            rhythm, finding = "Sinus bradycardia", "Sinus bradycardia, physiologic (trained athlete)"
        if special == "avb1":
            pr, finding, abnormal = 214, "First-degree AV block", 1
        elif special == "pvc":
            finding, abnormal = "Isolated premature ventricular complexes (2 in 10 s)", 1
        elif special == "rbbb":
            qrs, finding = 106, "Incomplete right bundle branch block, normal variant"
        elif special == "qtc":
            qtc, finding, abnormal = 468 if c["sex"] == "F" else 458, "Borderline prolonged QTc", 1
        elif special == "earlyrep":
            finding = "Early repolarization pattern, normal variant"
        qt = round(qtc * math.sqrt(60 / hr))
        report = d + timedelta(days=rng.randint(2, 5))
        self.db.execute("INSERT INTO ecg_result VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (sid, hr, pr, qrs, qt, qtc, c["axis"] + rng.randint(-5, 5),
                         rhythm, finding, abnormal, iso(report)))
        return sid

    # -- in-flight vitals --------------------------------------------------------

    def vitals(self, crew_id, mission_id, launch, ret, events):
        c = self.crew[crew_id]
        days = (ret - launch).days
        rows = []
        for fd in range(1, days + 1):
            day = launch + timedelta(days=fd - 1)
            adapt = min(fd / 10, 1.0)                 # fluid shift settles over ~10 days
            for hour in (6, 19):
                t = datetime(day.year, day.month, day.day, hour, rng.randint(0, 50))
                evening = hour == 19
                sbp = c["sbp"] - 4 * adapt + (3 if evening else 0) + rng.gauss(0, 4)
                dbp = c["dbp"] - 2 * adapt + rng.gauss(0, 3)
                hr = c["hr_rest"] + 3 - 3 * adapt + (6 if evening else 0) + rng.gauss(0, 3)
                resp = c["resp"] + rng.gauss(0, 0.9)
                skin = c["skin"] + (0.3 if evening else 0) + rng.gauss(0, 0.25)
                spo2 = 97.6 + rng.gauss(0, 0.6)
                for kind, start, end in events:
                    if start <= fd <= end:
                        if kind == "co2":          # elevated cabin CO2 episode
                            resp += 4.5 + rng.uniform(0, 1.5)
                            spo2 -= 2.3 + rng.uniform(0, 1.2)
                            hr += 6
                        elif kind == "fever":      # mild infection
                            skin += 1.5 + rng.uniform(0, 0.4)
                            hr += 14
                            resp += 2.5
                        elif kind == "htn":        # rising blood pressure trend
                            k = (fd - start) / max(end - start, 1)
                            sbp += 12 + 14 * k
                            dbp += 7 + 8 * k
                        elif kind == "brady":
                            hr -= 12
                rows.append((crew_id, mission_id, t.isoformat(timespec="minutes") + "Z", fd,
                             round(sbp), round(dbp), round(hr), r1(resp), r1(skin),
                             r1(min(spo2, 100.0))))
        self.db.executemany(
            "INSERT INTO vitals_reading (crew_id, mission_id, measured_at, flight_day, "
            "systolic_mmhg, diastolic_mmhg, heart_rate_bpm, resp_rate_bpm, skin_temp_c, spo2_pct)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)", rows)


def jitter(d, flex):
    return d + timedelta(days=rng.randint(-flex, flex)) if flex else d


def build(path):
    if path.exists():
        path.unlink()
    db = sqlite3.connect(path)
    db.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))

    db.executemany("INSERT INTO medical_requirement VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   REQUIREMENTS)
    db.executemany("INSERT INTO schedule_point VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", SCHEDULE)
    db.executemany("INSERT INTO protocol_stage VALUES (?,?,?,?,?,?)", protocol_rows())
    db.executemany("INSERT INTO termination_criterion VALUES (?,?,?,?)", TERMINATION)
    db.executemany("INSERT INTO test_constraint (requirement_id, applies_to, description) "
                   "VALUES (?,?,?)", CONSTRAINTS)
    db.executemany("INSERT INTO equipment (requirement_id, setting, name, kind) "
                   "VALUES (?,?,?,?)", EQUIPMENT)
    db.executemany("INSERT INTO reference_range VALUES (?,?,?,?,?,?,?)", REFERENCE_RANGES)
    db.executemany("INSERT INTO health_task (code, title, description, why, category, points, "
                   "sort_order) VALUES (?,?,?,?,?,?,?)",
                   [t + (i,) for i, t in enumerate(HEALTH_TASKS)])
    db.executemany("INSERT INTO indicator_guide VALUES (?,?,?,?,?,?,?,?)", GUIDE)

    b = Builder(db)
    b.add_crew()
    db.executemany("INSERT INTO mission VALUES (?,?,?,?)", MISSIONS)

    # Special cases so the analysis views have something to show.
    ecg_special = {(2, "pre"): "avb1", (7, "post"): "pvc", (5, "pre"): "rbbb",
                   (12, "post"): "qtc", (4, "pre"): "earlyrep", (11, "post"): "pvc"}
    mission_wide_events = {
        2: [("co2", 41, 44)],                     # HMS-2 cabin CO2 episode, whole crew
    }
    crew_events = {
        7: [("htn", 120, 170)],                   # rising BP late in mission
        10: [("fever", 88, 92)],
        5: [("brady", 60, 75)],
    }

    for idx, (mid, name, launch_s, ret_s) in enumerate(MISSIONS):
        launch, ret = date.fromisoformat(launch_s), date.fromisoformat(ret_s)
        crew_ids = [idx * 3 + k + 1 for k in range(3)]
        for role, cid in zip(ROLES, crew_ids):
            db.execute("INSERT INTO crew_assignment VALUES (?,?,?)", (cid, mid, role))
            c = b.crew[cid]

            # Annual test the year before assignment
            b.cycle_test(cid, None, 7, launch - timedelta(days=rng.randint(480, 540)),
                         "upright", "JSC", "Parvo Medics TrueOne 2400")
            # Preflight
            b.cycle_test(cid, mid, 8, jitter(launch - timedelta(days=365), 30), "upright",
                         "JSC", "PPFS")
            upright_day = launch - timedelta(days=rng.randint(32, 60))
            b.cycle_test(cid, mid, 9, upright_day - timedelta(days=rng.randint(2, 12)),
                         "supine", "JSC", rng.choice(["PPFS", "Parvo Medics TrueOne 2400"]))
            if cid == 6:
                # Submaximal effort -> repeated within two weeks
                b.cycle_test(cid, mid, 10, upright_day - timedelta(days=9), "upright", "JSC",
                             "PPFS", status="repeat_required", maximal=0,
                             notes="RER 1.04 and RPE 15: effort judged submaximal, test rescheduled.")
            if cid == 9:
                b.cycle_test(cid, mid, 10, upright_day - timedelta(days=6), "upright", "JSC",
                             "PPFS", status="terminated", termination=4,
                             notes="Lead detachment; ECG signal lost at 150 W. Repeated.")
            b.cycle_test(cid, mid, 10, upright_day, "upright", "JSC", "PPFS")
            b.ecg(cid, mid, 1, launch - timedelta(days=rng.randint(20, 120)),
                  special=ecg_special.get((cid, "pre")))

            # In flight
            fd14 = launch + timedelta(days=13 + rng.randint(-2, 2))
            fd75 = launch + timedelta(days=74 + rng.randint(-7, 7))
            rm14 = ret - timedelta(days=14 + rng.randint(-5, 5))
            b.cycle_test(cid, mid, 11, fd14, None, "ISS", "PPFS", inflight=True)
            if cid == 4:
                b.cycle_test(cid, mid, 12, fd75, None, "ISS", None, inflight=True,
                             notes="PPFS unavailable: interim max test without gas analysis "
                                   "(CEVIS + heart rate monitor).")
            elif cid == 8:
                b.cycle_test(cid, mid, 12, fd75, None, "ISS", "PPFS", inflight=True,
                             status="terminated", termination=3,
                             notes="New-onset ventricular bigeminy with light-headedness at "
                                   "200 W; crew surgeon notified. Cleared after review.")
                b.cycle_test(cid, mid, 14, fd75 + timedelta(days=9), None, "ISS", "PPFS",
                             inflight=True, notes="Clinically indicated repeat after FD 75 stop.")
            else:
                b.cycle_test(cid, mid, 12, fd75, None, "ISS", "PPFS", inflight=True)
            if cid in (2, 10):
                b.cycle_test(cid, mid, 14, launch + timedelta(days=rng.randint(110, 140)), None,
                             "ISS", "PPFS", inflight=True, notes="Requested before EMU EVA.")
            b.cycle_test(cid, mid, 13, rm14, None, "ISS", "PPFS", inflight=True)

            # Postflight
            b.ecg(cid, mid, 2, ret + timedelta(days=rng.randint(0, 3)), postflight=True,
                  special=ecg_special.get((cid, "post")))
            if cid == 11:
                b.cycle_test(cid, mid, 15, jitter(ret + timedelta(days=5), 2), "upright", "JSC",
                             "PPFS", status="terminated", termination=5,
                             notes="Dyspnea out of proportion to workload; SpO2 stable. "
                                   "Follow-up at R+30.")
            else:
                b.cycle_test(cid, mid, 15, jitter(ret + timedelta(days=5), 2), "upright", "JSC",
                             "PPFS")
            b.cycle_test(cid, mid, 16, jitter(ret + timedelta(days=30), 4), "upright", "JSC",
                         "PPFS")
            # Annual test after return, if it has happened already
            annual_after = ret + timedelta(days=rng.randint(300, 360))
            if annual_after <= TODAY:
                b.cycle_test(cid, None, 7, annual_after, "upright", "JSC",
                             "Parvo Medics TrueOne 2400", vo2_factor=0.99)

            mission_events = mission_wide_events.get(mid, [])
            b.vitals(cid, mid, launch, ret, mission_events + crew_events.get(cid, []))

    # Non-assigned astronauts: annual tests only
    for cid in (13, 14, 15):
        for year in (2024, 2025, 2026):
            d = date(year, rng.randint(1, 10), rng.randint(1, 28))
            if d <= TODAY:
                b.cycle_test(cid, None, 7, d, "upright", "JSC", "Parvo Medics TrueOne 2400",
                             vo2_factor=1 + (year - 2024) * 0.01)

    crew_by_mission = {
        (date.fromisoformat(l), date.fromisoformat(r)): [i * 3 + k + 1 for k in range(3)]
        for i, (_m, _n, l, r) in enumerate(MISSIONS)
    }
    add_gamification(db, crew_by_mission, TODAY)

    db.commit()
    return db


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "cardio_analysis.db"
    db = build(out)
    print(f"Created {out}")
    for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        n = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table:24s} {n:6d}")
    db.close()


if __name__ == "__main__":
    main()
