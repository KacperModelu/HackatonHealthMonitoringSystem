#include "datagenerator.h"
#include "cardiodb.h"

#include <QDate>
#include <QDateTime>
#include <QHash>
#include <QObject>
#include <QSet>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QTimeZone>
#include <QVariant>
#include <QVector>

#include <algorithm>
#include <cmath>
#include <random>
#include <tuple>

namespace DataGenerator {

namespace {

struct DbError
{
    QString message;
};

// Schedule point ids (see schedule_point in the database)
enum SchedulePoint {
    EcgPre = 1, EcgPost = 2, Annual = 7, L12m = 8, SupineL90 = 9, UprightL90 = 10,
    FD14 = 11, FD75 = 12, Rminus14 = 13, Rplus5 = 15, Rplus30 = 16,
};

// Average multiplier of baseline VO2peak per test (N3.07 schedule)
double phaseVo2(int sp)
{
    switch (sp) {
    case Annual: return 0.99;
    case SupineL90: return 0.92;
    case FD14: return 0.86;
    case FD75: return 0.90;
    case Rminus14: return 0.92;
    case Rplus5: return 0.85;
    case Rplus30: return 0.96;
    default: return 1.0;
    }
}

double phaseWeight(int sp)
{
    switch (sp) {
    case FD14: return 0.975;
    case FD75: case Rminus14: return 0.97;
    case Rplus5: return 0.98;
    case Rplus30: return 0.995;
    default: return 1.0;
    }
}

int phaseHrRest(int sp)
{
    switch (sp) {
    case SupineL90: return -6;
    case FD14: return -3;
    case FD75: case Rminus14: return -2;
    case Rplus5: return 9;
    case Rplus30: return 2;
    default: return 0;
    }
}

bool affectedByFlight(int sp)
{
    return sp == FD14 || sp == FD75 || sp == Rminus14 || sp == Rplus5 || sp == Rplus30;
}

QVector<int> protocolLoads(bool light)
{
    QVector<int> loads{light ? 45 : 50};
    for (int w = light ? 60 : 75; w <= (light ? 300 : 475); w += light ? 15 : 25)
        loads.append(w);
    return loads;
}

enum class Kind {
    Hypertension, Hypotension, Tachycardia, Bradycardia, Fever, Co2, Desaturation,
    Artifacts, Deconditioning, EcgAbnormal, TestStopped,
};

struct Event
{
    Kind kind;
    QString code;
    QString text;
    int start = 0;          // flight days, 0 = not tied to flight days
    int end = 0;
    QString ecgType;        // for EcgAbnormal
};

class Generator
{
public:
    explicit Generator(const Person &p) : m_p(p) {}

    Result run()
    {
        m_today = QDate::currentDate();
        const bool male = m_p.sex == 'M';

        const double height = m_p.heightCm.value_or(
            std::clamp(male ? 178 + gauss(6) : 166 + gauss(6), 150.0, 200.0));
        const double weight = m_p.weightKg.value_or(
            std::clamp(male ? 78 + gauss(8) : 62 + gauss(6), 45.0, 110.0));
        m_weight = std::round(weight * 10) / 10;
        m_light = m_weight < 65;
        m_birth = m_today.addYears(-m_p.age).addDays(-randint(0, 360));

        // Personal baseline
        m_vo2Base = male ? uni(39, 48) : uni(33, 42);
        m_responder = uni(0.5, 1.3);
        m_hrRest = randint(52, 68);
        m_hrMaxOffset = uni(-6, 6);
        m_sbp = randint(108, 126);
        m_dbp = randint(66, 80);
        m_vtFrac = uni(0.58, 0.70);
        m_skin = uni(33.6, 34.3);
        m_resp = uni(13, 16);
        m_qtc = randint(388, 425) + (male ? 0 : 10);
        m_pr = randint(135, 185);
        m_qrs = randint(84, 102);
        m_axis = randint(10, 75);

        Result result;
        m_crewId = insert(
            "INSERT INTO crew_member (first_name, last_name, sex, birth_date, height_cm, "
            "weight_kg, agency, cycle_protocol, regular_cyclist, created_in_app) "
            "VALUES (?,?,?,?,?,?,NULL,?,0,1)",
            {m_p.firstName, m_p.lastName, QString(QChar::fromLatin1(m_p.sex)),
             iso(m_birth), std::round(height), m_weight, m_light ? "light" : "nominal"}).toInt();
        result.crewId = m_crewId;

        // A completed mission that ended 5–6 weeks ago, so R+30 has happened.
        m_duration = randint(150, 190);
        m_return = m_today.addDays(-randint(35, 45));
        m_launch = m_return.addDays(-m_duration);
        result.mission = QStringLiteral("SIM-%1").arg(m_crewId, 3, 10, QChar('0'));
        m_missionId = insert("INSERT INTO mission (name, launch_date, return_date) VALUES (?,?,?)",
                             {result.mission, iso(m_launch), iso(m_return)});
        insert("INSERT INTO crew_assignment (crew_id, mission_id, role) VALUES (?,?,?)",
               {m_crewId, m_missionId, "Flight Engineer"});

        pickEvents();

        result.vitalsReadings = vitals();
        result.cycleTests = cycleTests();
        result.ecgs = ecgs();

        for (const auto &e : m_events) {
            insert("INSERT INTO simulated_event (crew_id, mission_id, kind, start_flight_day, "
                   "end_flight_day, description, source) VALUES (?,?,?,?,?,?,'app')",
                   {m_crewId, m_missionId, e.code,
                    e.start ? QVariant(e.start) : QVariant(),
                    e.end ? QVariant(e.end) : QVariant(), e.text});
            result.events << (e.start ? QObject::tr("%1 (flight days %2–%3)")
                                            .arg(e.text).arg(e.start).arg(e.end)
                                      : e.text);
        }
        return result;
    }

private:
    // --- random helpers --------------------------------------------------------
    double uni(double a, double b) { return std::uniform_real_distribution<double>(a, b)(m_rng); }
    int randint(int a, int b) { return std::uniform_int_distribution<int>(a, b)(m_rng); }
    double gauss(double sd) { return std::normal_distribution<double>(0.0, sd)(m_rng); }

    static QString iso(const QDate &d) { return d.toString(Qt::ISODate); }

    QVariant insert(const char *sql, const QVariantList &args)
    {
        QSqlQuery q;
        q.prepare(QString::fromLatin1(sql));
        for (const auto &a : args)
            q.addBindValue(a);
        if (!q.exec())
            throw DbError{q.lastError().text()};
        return q.lastInsertId();
    }

    int ageOn(const QDate &d) const
    {
        return d.year() - m_birth.year()
               - ((d.month() < m_birth.month()
                   || (d.month() == m_birth.month() && d.day() < m_birth.day())) ? 1 : 0);
    }

    // --- deviations from the norm ----------------------------------------------
    void pickEvents()
    {
        const double r = uni(0, 1);
        const int count = r < 0.2 ? 0 : r < 0.6 ? 1 : r < 0.88 ? 2 : 3;

        std::vector<Kind> pool = {
            Kind::Hypertension, Kind::Hypotension, Kind::Tachycardia, Kind::Bradycardia,
            Kind::Fever, Kind::Co2, Kind::Desaturation, Kind::Artifacts,
            Kind::Deconditioning, Kind::EcgAbnormal, Kind::TestStopped,
        };
        std::shuffle(pool.begin(), pool.end(), m_rng);

        const auto span = [this](int minLen, int maxLen, double earliest = 0.05) {
            const int len = randint(minLen, maxLen);
            const int start = randint(std::max(2, int(m_duration * earliest)), m_duration - len - 2);
            return std::pair<int, int>{start, start + len - 1};
        };

        for (int i = 0; i < count; ++i) {
            Event e{pool[size_t(i)], {}, {}};
            switch (e.kind) {
            case Kind::Hypertension: {
                const int start = randint(int(m_duration * 0.4), int(m_duration * 0.7));
                e.start = start;
                e.end = std::min(m_duration, start + randint(25, 50));
                e.code = "hypertension";
                e.text = QObject::tr("Rising blood pressure trend");
                break;
            }
            case Kind::Hypotension:
                std::tie(e.start, e.end) = span(4, 8);
                e.code = "hypotension";
                e.text = QObject::tr("Low blood pressure episode (e.g. dehydration)");
                break;
            case Kind::Tachycardia:
                std::tie(e.start, e.end) = span(3, 6);
                e.code = "tachycardia";
                e.text = QObject::tr("High resting heart rate (stress, poor sleep or illness)");
                break;
            case Kind::Bradycardia:
                std::tie(e.start, e.end) = span(10, 20);
                e.code = "bradycardia";
                e.text = QObject::tr("Resting heart rate about 13 bpm lower than usual");
                break;
            case Kind::Fever:
                std::tie(e.start, e.end) = span(3, 6);
                e.code = "fever";
                e.text = QObject::tr("Mild infection: skin temperature, heart rate and breathing up");
                break;
            case Kind::Co2:
                std::tie(e.start, e.end) = span(3, 5);
                e.code = "co2";
                e.text = QObject::tr("Elevated cabin CO2: faster breathing, lower SpO2");
                break;
            case Kind::Desaturation:
                std::tie(e.start, e.end) = span(1, 3);
                e.code = "desaturation";
                e.text = QObject::tr("Marked drop in blood oxygen (SpO2 below 92%)");
                break;
            case Kind::Artifacts: {
                const int n = randint(4, 8);
                for (int k = 0; k < n; ++k)
                    m_artifacts.insert(randint(1, m_duration) * 2 + randint(0, 1));
                e.code = "sensor_artifacts";
                e.text = QObject::tr("%1 isolated sensor artifacts (implausible single readings)")
                             .arg(m_artifacts.size());
                break;
            }
            case Kind::Deconditioning:
                m_responder = uni(1.8, 2.1);
                e.code = "deconditioning";
                e.text = QObject::tr("Strong loss of aerobic fitness in flight (VO2peak down ~25–30%)");
                break;
            case Kind::EcgAbnormal: {
                const QStringList types = {"avb1", "qtc", "pvc"};
                e.ecgType = types[randint(0, 2)];
                e.code = "ecg_" + e.ecgType;
                e.text = e.ecgType == "avb1" ? QObject::tr("First-degree AV block on postflight ECG")
                       : e.ecgType == "qtc"  ? QObject::tr("Prolonged QTc on postflight ECG")
                                             : QObject::tr("Premature ventricular complexes on postflight ECG");
                m_ecgSpecial = e.ecgType;
                break;
            }
            case Kind::TestStopped:
                m_testStopped = true;
                e.code = "test_terminated";
                e.text = QObject::tr("R+5 cycle test stopped for unusual shortness of breath");
                break;
            }
            m_events.append(e);
        }
    }

    // --- in-flight vitals, twice a day -------------------------------------------
    int vitals()
    {
        QSqlQuery q;
        q.prepare(QStringLiteral(
            "INSERT INTO vitals_reading (crew_id, mission_id, measured_at, flight_day, "
            "systolic_mmhg, diastolic_mmhg, heart_rate_bpm, resp_rate_bpm, skin_temp_c, spo2_pct) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)"));
        int rows = 0;
        for (int fd = 1; fd <= m_duration; ++fd) {
            const QDate day = m_launch.addDays(fd - 1);
            const double adapt = std::min(fd / 10.0, 1.0);     // fluid shift settles in ~10 days
            for (int slot = 0; slot < 2; ++slot) {
                const bool evening = slot == 1;
                const QDateTime t(day, QTime(evening ? 19 : 6, randint(0, 50)), QTimeZone::UTC);
                double sbp = m_sbp - 4 * adapt + (evening ? 3 : 0) + gauss(4);
                double dbp = m_dbp - 2 * adapt + gauss(3);
                double hr = m_hrRest + 3 - 3 * adapt + (evening ? 6 : 0) + gauss(3);
                double resp = m_resp + gauss(0.9);
                double skin = m_skin + (evening ? 0.3 : 0) + gauss(0.25);
                double spo2 = 97.6 + gauss(0.6);

                for (const auto &e : m_events) {
                    if (!e.start || fd < e.start || fd > e.end)
                        continue;
                    switch (e.kind) {
                    case Kind::Hypertension: {
                        const double k = double(fd - e.start) / std::max(e.end - e.start, 1);
                        sbp += 12 + 16 * k;
                        dbp += 7 + 9 * k;
                        break;
                    }
                    case Kind::Hypotension:
                        sbp -= 20 + uni(0, 6);
                        dbp -= 10 + uni(0, 4);
                        hr += 8;
                        break;
                    case Kind::Tachycardia:
                        hr = 102 + uni(0, 18) + (evening ? 5 : 0);   // resting HR > 100
                        resp += 1.5;
                        break;
                    case Kind::Bradycardia:
                        hr -= 13;
                        break;
                    case Kind::Fever:
                        skin += 1.5 + uni(0, 0.5);
                        hr += 14;
                        resp += 2.5;
                        break;
                    case Kind::Co2:
                        resp += 4.5 + uni(0, 1.5);
                        spo2 -= 2.3 + uni(0, 1.2);
                        hr += 6;
                        break;
                    case Kind::Desaturation:
                        spo2 -= 6 + uni(0, 2.5);
                        resp += 3;
                        hr += 10;
                        break;
                    default:
                        break;
                    }
                }

                if (m_artifacts.contains(fd * 2 + slot)) {
                    switch (randint(0, 3)) {
                    case 0: spo2 = uni(80, 86); break;           // cold finger / loose probe
                    case 1: hr = uni(140, 170); break;           // motion artifact
                    case 2: skin = uni(29.5, 30.8); break;       // sensor lost skin contact
                    default: sbp = uni(175, 195); break;         // cuff too small / talking
                    }
                }

                q.addBindValue(m_crewId);
                q.addBindValue(m_missionId);
                q.addBindValue(t.toString(QStringLiteral("yyyy-MM-ddTHH:mm")) + 'Z');
                q.addBindValue(fd);
                q.addBindValue(int(std::lround(sbp)));
                q.addBindValue(int(std::lround(dbp)));
                q.addBindValue(int(std::lround(hr)));
                q.addBindValue(std::round(resp * 10) / 10);
                q.addBindValue(std::round(skin * 10) / 10);
                q.addBindValue(std::round(std::min(spo2, 100.0) * 10) / 10);
                if (!q.exec())
                    throw DbError{q.lastError().text()};
                ++rows;
            }
        }
        return rows;
    }

    // --- cycle ergometer tests (N3.07) ---------------------------------------------
    int cycleTests()
    {
        int n = 0;
        cycleTest(Annual, m_launch.addDays(-randint(480, 540)), "upright", "JSC",
                  "Parvo Medics TrueOne 2400", false);
        ++n;
        cycleTest(L12m, m_launch.addDays(-365 + randint(-30, 30)), "upright", "JSC", "PPFS", false);
        ++n;
        const QDate upright = m_launch.addDays(-randint(32, 60));
        cycleTest(SupineL90, upright.addDays(-randint(2, 12)), "supine", "JSC",
                  randint(0, 1) ? "PPFS" : "Parvo Medics TrueOne 2400", false);
        ++n;
        cycleTest(UprightL90, upright, "upright", "JSC", "PPFS", false);
        ++n;
        cycleTest(FD14, m_launch.addDays(13 + randint(-2, 2)), QString(), "ISS", "PPFS", true);
        ++n;
        cycleTest(FD75, m_launch.addDays(74 + randint(-7, 7)), QString(), "ISS", "PPFS", true);
        ++n;
        cycleTest(Rminus14, m_return.addDays(-14 + randint(-5, 5)), QString(), "ISS", "PPFS", true);
        ++n;
        cycleTest(Rplus5, m_return.addDays(5 + randint(-2, 2)), "upright", "JSC", "PPFS", false,
                  m_testStopped);
        ++n;
        const QDate r30 = m_return.addDays(30 + randint(-4, 4));
        if (r30 <= m_today) {
            cycleTest(Rplus30, r30, "upright", "JSC", "PPFS", false);
            ++n;
        }
        return n;
    }

    void cycleTest(int sp, const QDate &d, const QString &position, const QString &location,
                   const QString &analyzer, bool inflight, bool stopped = false)
    {
        const QVariant sid = insert(
            "INSERT INTO test_session (crew_id, mission_id, schedule_point_id, session_date, "
            "position, location, gas_analyzer, status, termination_id, maximal_effort, notes) "
            "VALUES (?,?,?,?,?,?,?,?,?,1,?)",
            {m_crewId, sp == Annual ? QVariant() : QVariant(m_missionId), sp, iso(d),
             position.isEmpty() ? QVariant() : QVariant(position), location,
             analyzer.isEmpty() ? QVariant() : QVariant(analyzer),
             stopped ? "terminated" : "completed", stopped ? 5 : 7,
             stopped ? QVariant(QStringLiteral("Dyspnea out of proportion to workload; test "
                                               "stopped. Follow-up at R+30."))
                     : QVariant()});

        const double weight = m_weight * phaseWeight(sp) * uni(0.99, 1.01);
        const double loss = (1 - phaseVo2(sp)) * (affectedByFlight(sp) ? m_responder : 1.0);
        double vo2peak = m_vo2Base * (1 - loss) * uni(0.97, 1.03);
        if (stopped)
            vo2peak *= uni(0.80, 0.88);

        const auto loads = protocolLoads(m_light);
        double targetW = (vo2peak - 7) * weight / 10.8;          // ACSM leg cycling
        if (inflight)
            targetW = std::min(targetW, 350.0);                  // CEVIS limit
        QVector<int> stages;
        for (int w : loads)
            if (w <= targetW)
                stages.append(w);
        if (stages.isEmpty())
            stages.append(loads.first());
        const int peakW = stages.last();
        const int partial = peakW < loads.last() ? randint(5, 55) : 0;
        const int exerciseSec = 180 + 60 * int(stages.size() - 1) + partial
                                + ((inflight && peakW == 350) ? 120 : 0);

        const int hrRest = m_hrRest + phaseHrRest(sp) + randint(-3, 3);
        int hrPeak = int(std::lround(208 - 0.7 * ageOn(d) + m_hrMaxOffset + uni(-3, 3)));
        if (position == QLatin1String("supine"))
            hrPeak -= randint(4, 9);
        if (sp == Rplus5)
            hrPeak += randint(0, 5);
        if (stopped)
            hrPeak -= randint(8, 15);

        const bool gas = !analyzer.isEmpty();
        const double vtFrac = m_vtFrac * (sp == Rplus5 ? 0.93 : 1.0) * uni(0.97, 1.03);
        const double rer = stopped ? uni(1.00, 1.06) : uni(1.10, 1.24);
        const QVariant rpePeak = inflight ? QVariant() : QVariant(stopped ? randint(15, 17)
                                                                          : randint(18, 20));
        const double vo2Rest = 3.5;

        insert("INSERT INTO stage_measurement VALUES (?,?,?,?,?,?)",
               {sid, 0, 0, hrRest + randint(4, 9),
                gas ? QVariant(std::round((vo2Rest + uni(0.2, 1.0)) * 10) / 10) : QVariant(),
                inflight ? QVariant() : QVariant(6)});
        for (int n = 0; n < stages.size(); ++n) {
            const int w = stages[n];
            const double vo2 = std::min(10.8 * w / weight + 7, vo2peak);
            const double frac = (vo2 - vo2Rest) / (vo2peak - vo2Rest);
            const int hr = std::min(hrPeak, int(std::lround(
                hrRest + 8 + (hrPeak - hrRest - 8) * std::pow(frac, 1.05) + uni(-2, 2))));
            QVariant rpe;
            if (!inflight)
                rpe = std::clamp(int(std::lround(6 + (rpePeak.toInt() - 6) * std::pow(frac, 1.3))), 6, 20);
            insert("INSERT INTO stage_measurement VALUES (?,?,?,?,?,?)",
                   {sid, n + 1, w, hr,
                    gas ? QVariant(std::round(vo2 * uni(0.97, 1.03) * 10) / 10) : QVariant(), rpe});
        }

        const int hrr1 = randint(14, 30) - (sp == Rplus5 ? 6 : 0);
        insert("INSERT INTO cycle_test_result VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
               {sid, m_light ? "light" : "nominal", peakW, exerciseSec,
                gas ? QVariant(std::round(vo2peak * weight / 10) / 100) : QVariant(),
                gas ? QVariant(std::round(vo2peak * 10) / 10) : QVariant(),
                gas ? QVariant(std::round(vo2peak * vtFrac * 10) / 10) : QVariant(),
                gas ? QVariant(std::round(vtFrac * 1000) / 10) : QVariant(),
                hrRest, hrPeak, gas ? QVariant(std::round(rer * 100) / 100) : QVariant(),
                rpePeak, hrr1});

        // Blood pressure: pretest, every 2nd stage + peak, 5 minutes of recovery
        const int sbp0 = m_sbp + (sp == Rplus5 ? 6 : 0) + randint(-4, 4);
        const int dbp0 = m_dbp + (sp == Rplus5 ? 4 : 0) + randint(-3, 3);
        int seq = 0;
        const auto bp = [&](const QString &tp, double s, double dia, int hr) {
            insert("INSERT INTO bp_measurement VALUES (?,?,?,?,?,?)",
                   {sid, ++seq, tp, int(std::lround(s)), int(std::lround(dia)), hr});
        };
        bp("supine_rest", sbp0 - 2, dbp0, hrRest);
        bp("seated_rest", sbp0 + 2, dbp0, hrRest + 5);
        for (int n = 1; n <= stages.size(); ++n) {
            if (n % 2 != 0 && n != stages.size())
                continue;
            const int w = stages[n - 1];
            const double frac = double(w) / peakW;
            bp(QStringLiteral("stage_%1").arg(n), sbp0 + 0.27 * w + randint(-6, 6),
               dbp0 + randint(-6, 4) - 4 * frac,
               int(std::lround(hrRest + (hrPeak - hrRest) * std::pow(frac, 1.1))));
        }
        const double sbpPeak = sbp0 + 0.27 * peakW;
        int hrNow = hrPeak;
        for (int minute = 1; minute <= 5; ++minute) {
            hrNow -= minute == 1 ? hrr1 : randint(5, 10);
            bp(QStringLiteral("recovery_%1").arg(minute),
               sbp0 + (sbpPeak - sbp0) * std::exp(-0.45 * minute) + randint(-5, 5),
               dbp0 + randint(-5, 3), std::max(hrNow, hrRest + 10));
        }
    }

    // --- resting ECG (MEDB 1.6) ----------------------------------------------------
    int ecgs()
    {
        ecg(EcgPre, m_launch.addDays(-randint(20, 120)), false);
        ecg(EcgPost, m_return.addDays(randint(0, 3)), true);
        return 2;
    }

    void ecg(int sp, const QDate &d, bool post)
    {
        const QVariant sid = insert(
            "INSERT INTO test_session (crew_id, mission_id, schedule_point_id, session_date, "
            "position, location, gas_analyzer, status, termination_id, maximal_effort, notes) "
            "VALUES (?,?,?,?,'supine','JSC',NULL,'completed',NULL,NULL,NULL)",
            {m_crewId, m_missionId, sp, iso(d)});

        const int hr = m_hrRest - 4 + randint(-3, 3) + (post ? 9 : 0);
        int pr = m_pr + randint(-6, 6);
        const int qrs = m_qrs + randint(-3, 3);
        int qtc = m_qtc + randint(-6, 6) + (post ? 9 : 0);
        QString rhythm = "Sinus rhythm", finding = "Normal ECG";
        int abnormal = 0;
        if (hr < 50) {
            rhythm = "Sinus bradycardia";
            finding = "Sinus bradycardia, physiologic (trained athlete)";
        }
        if (post && m_ecgSpecial == QLatin1String("avb1")) {
            pr = randint(208, 236);
            finding = "First-degree AV block";
            abnormal = 1;
        } else if (post && m_ecgSpecial == QLatin1String("qtc")) {
            qtc = m_p.sex == 'F' ? randint(462, 480) : randint(452, 470);
            finding = "Borderline prolonged QTc";
            abnormal = 1;
        } else if (post && m_ecgSpecial == QLatin1String("pvc")) {
            finding = "Isolated premature ventricular complexes";
            abnormal = 1;
        }
        const int qt = int(std::lround(qtc * std::sqrt(60.0 / hr)));
        insert("INSERT INTO ecg_result VALUES (?,?,?,?,?,?,?,?,?,?,?)",
               {sid, hr, pr, qrs, qt, qtc, m_axis + randint(-5, 5), rhythm, finding, abnormal,
                iso(d.addDays(randint(2, 5)))});
    }

    const Person m_p;
    std::mt19937 m_rng{std::random_device{}()};
    QDate m_today, m_birth, m_launch, m_return;
    int m_duration = 0;
    int m_crewId = 0;
    QVariant m_missionId;
    double m_weight = 0;
    bool m_light = false;

    double m_vo2Base = 0, m_responder = 1, m_hrMaxOffset = 0, m_vtFrac = 0.6;
    double m_skin = 34, m_resp = 14;
    int m_hrRest = 60, m_sbp = 118, m_dbp = 76, m_qtc = 410, m_pr = 160, m_qrs = 90, m_axis = 40;

    QVector<Event> m_events;
    QSet<int> m_artifacts;          // flight_day * 2 + slot
    QString m_ecgSpecial;
    bool m_testStopped = false;
};

} // namespace

std::optional<Result> generate(const Person &person, QString *error)
{
    if (!CardioDb::ensureOpen(error))
        return std::nullopt;

    QSqlDatabase db = QSqlDatabase::database();
    if (!db.transaction()) {
        if (error)
            *error = db.lastError().text();
        return std::nullopt;
    }
    try {
        Generator g(person);
        Result r = g.run();
        if (!db.commit())
            throw DbError{db.lastError().text()};
        return r;
    } catch (const DbError &e) {
        db.rollback();
        if (error)
            *error = e.message;
        return std::nullopt;
    }
}

} // namespace DataGenerator
