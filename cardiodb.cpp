#include "cardiodb.h"

#include <QCoreApplication>
#include <QDate>
#include <QDir>
#include <QFileInfo>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QTimeZone>
#include <QVariant>

namespace CardioDb {

namespace {
void setError(QString *error, const QString &message)
{
    if (error)
        *error = message;
}
} // namespace

QString defaultPath()
{
    const QString besideApp =
        QDir(QCoreApplication::applicationDirPath()).filePath("cardio_analysis.db");
    if (QFileInfo::exists(besideApp))
        return besideApp;
#ifdef CARDIO_DB_PATH
    return QStringLiteral(CARDIO_DB_PATH);
#else
    return besideApp;
#endif
}

bool open(const QString &path, QString *error)
{
    // SQLite would silently create an empty database for a missing file.
    if (!QFileInfo::exists(path)) {
        setError(error, QObject::tr("Database file not found:\n%1\n\n"
                                    "Run: python3 database/generate_cardio_db.py").arg(path));
        return false;
    }

    QSqlDatabase db = QSqlDatabase::contains()
                          ? QSqlDatabase::database()
                          : QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"));
    db.setDatabaseName(path);
    if (!db.open()) {
        setError(error, db.lastError().text());
        return false;
    }

    QSqlQuery q(db);
    q.exec(QStringLiteral("PRAGMA foreign_keys = ON"));
    if (!q.exec(QStringLiteral("SELECT COUNT(*) FROM crew_member"))) {
        setError(error, QObject::tr("%1 is not a cardio analysis database: %2")
                            .arg(path, q.lastError().text()));
        db.close();
        return false;
    }
    return true;
}

bool isOpen()
{
    return QSqlDatabase::contains() && QSqlDatabase::database().isOpen();
}

QList<CrewEntry> crewMembers()
{
    QList<CrewEntry> result;
    if (!isOpen())
        return result;

    QSqlQuery q(QStringLiteral(
        "SELECT id, first_name || ' ' || last_name FROM crew_member "
        "ORDER BY last_name, first_name"));
    while (q.next())
        result.append({q.value(0).toInt(), q.value(1).toString()});
    return result;
}

int addCrewMember(const NewCrewMember &m, QString *error)
{
    if (!isOpen()) {
        setError(error, QObject::tr("The database is not open."));
        return -1;
    }

    // The form asks for age only, so the birth date is approximate.
    const QDate birth = QDate::currentDate().addYears(-m.age);

    // N3.07: light protocol for crew under 65 kg (unless they cycle regularly,
    // which the form doesn't ask about).
    QVariant protocol;
    if (m.weightKg)
        protocol = *m.weightKg < 65.0 ? QStringLiteral("light") : QStringLiteral("nominal");

    QSqlQuery q;
    q.prepare(QStringLiteral(
        "INSERT INTO crew_member (first_name, last_name, sex, birth_date, height_cm, "
        "weight_kg, cycle_protocol, regular_cyclist, created_in_app) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)"));
    q.addBindValue(m.firstName);
    q.addBindValue(m.lastName);
    q.addBindValue(QString(QChar::fromLatin1(m.sex)));
    q.addBindValue(birth.toString(Qt::ISODate));
    q.addBindValue(m.heightCm ? QVariant(*m.heightCm) : QVariant());
    q.addBindValue(m.weightKg ? QVariant(*m.weightKg) : QVariant());
    q.addBindValue(protocol);

    if (!q.exec()) {
        setError(error, q.lastError().text());
        return -1;
    }
    return q.lastInsertId().toInt();
}

// --- Dashboard queries ------------------------------------------------------

namespace {
std::optional<double> optDouble(const QVariant &v)
{
    if (v.isNull())
        return std::nullopt;
    return v.toDouble();
}
} // namespace

CrewProfile profile(int crewId)
{
    CrewProfile p;
    if (!isOpen())
        return p;
    QSqlQuery q;
    q.prepare(QStringLiteral(
        "SELECT c.id, c.first_name || ' ' || c.last_name, c.sex, c.birth_date, c.height_cm, "
        "       c.weight_kg, m.name, a.role, m.launch_date, m.return_date "
        "FROM crew_member c "
        "LEFT JOIN crew_assignment a ON a.crew_id = c.id "
        "LEFT JOIN mission m ON m.id = a.mission_id "
        "WHERE c.id = ? ORDER BY m.launch_date DESC LIMIT 1"));
    q.addBindValue(crewId);
    if (!q.exec() || !q.next())
        return p;
    p.id = q.value(0).toInt();
    p.fullName = q.value(1).toString();
    p.sex = q.value(2).toString();
    const QDate birth = QDate::fromString(q.value(3).toString(), Qt::ISODate);
    const QDate today = QDate::currentDate();
    p.age = today.year() - birth.year()
            - ((today.month() < birth.month()
                || (today.month() == birth.month() && today.day() < birth.day())) ? 1 : 0);
    p.heightCm = optDouble(q.value(4));
    p.weightKg = optDouble(q.value(5));
    p.mission = q.value(6).toString();
    p.role = q.value(7).toString();
    p.launch = QDate::fromString(q.value(8).toString(), Qt::ISODate);
    p.returnDate = QDate::fromString(q.value(9).toString(), Qt::ISODate);
    return p;
}

QList<VitalsPoint> vitalsHistory(int crewId)
{
    QList<VitalsPoint> result;
    if (!isOpen())
        return result;
    QSqlQuery q;
    q.prepare(QStringLiteral(
        "SELECT measured_at, flight_day, systolic_mmhg, diastolic_mmhg, heart_rate_bpm, "
        "       resp_rate_bpm, skin_temp_c, spo2_pct "
        "FROM vitals_reading WHERE crew_id = ? ORDER BY measured_at"));
    q.addBindValue(crewId);
    q.exec();
    while (q.next()) {
        QDateTime t = QDateTime::fromString(q.value(0).toString(), Qt::ISODate);
        t.setTimeZone(QTimeZone::UTC);
        result.append({t, q.value(1).toInt(), q.value(2).toDouble(), q.value(3).toDouble(),
                       q.value(4).toDouble(), q.value(5).toDouble(), q.value(6).toDouble(),
                       q.value(7).toDouble()});
    }
    return result;
}

QList<Vo2Point> vo2History(int crewId)
{
    QList<Vo2Point> result;
    if (!isOpen())
        return result;
    QSqlQuery q;
    q.prepare(QStringLiteral(
        "SELECT s.session_date, sp.label, sp.phase, ct.vo2peak_ml_kg_min, ct.peak_watts, "
        "       ct.hr_peak_bpm "
        "FROM test_session s "
        "JOIN schedule_point sp ON sp.id = s.schedule_point_id "
        "JOIN cycle_test_result ct ON ct.session_id = s.id "
        "WHERE s.crew_id = ? AND s.status = 'completed' "
        "  AND COALESCE(s.position, 'upright') = 'upright' "
        "ORDER BY s.session_date"));
    q.addBindValue(crewId);
    q.exec();
    while (q.next()) {
        result.append({QDate::fromString(q.value(0).toString(), Qt::ISODate),
                       q.value(1).toString(), q.value(2).toString(), optDouble(q.value(3)),
                       q.value(4).toInt(), q.value(5).toInt()});
    }
    return result;
}

QList<ReferenceRange> referenceRanges()
{
    QList<ReferenceRange> result;
    if (!isOpen())
        return result;
    QSqlQuery q(QStringLiteral(
        "SELECT parameter, unit, normal_low, normal_high, critical_low, critical_high "
        "FROM reference_range"));
    while (q.next()) {
        result.append({q.value(0).toString(), q.value(1).toString(), optDouble(q.value(2)),
                       optDouble(q.value(3)), optDouble(q.value(4)), optDouble(q.value(5))});
    }
    return result;
}

QList<HealthTask> healthTasks()
{
    QList<HealthTask> result;
    if (!isOpen())
        return result;
    QSqlQuery q(QStringLiteral(
        "SELECT id, code, title, description, why, category, points FROM health_task "
        "ORDER BY sort_order"));
    while (q.next()) {
        result.append({q.value(0).toInt(), q.value(1).toString(), q.value(2).toString(),
                       q.value(3).toString(), q.value(4).toString(), q.value(5).toString(),
                       q.value(6).toInt()});
    }
    return result;
}

QList<int> completedTaskIds(int crewId, const QDate &day)
{
    QList<int> result;
    if (!isOpen())
        return result;
    QSqlQuery q;
    q.prepare(QStringLiteral(
        "SELECT task_id FROM task_completion WHERE crew_id = ? AND completed_on = ?"));
    q.addBindValue(crewId);
    q.addBindValue(day.toString(Qt::ISODate));
    q.exec();
    while (q.next())
        result.append(q.value(0).toInt());
    return result;
}

bool setTaskDone(int crewId, int taskId, const QDate &day, bool done, QString *error)
{
    if (!isOpen()) {
        setError(error, QObject::tr("The database is not open."));
        return false;
    }
    QSqlQuery q;
    q.prepare(done ? QStringLiteral("INSERT OR IGNORE INTO task_completion "
                                    "(crew_id, task_id, completed_on, created_in_app) "
                                    "VALUES (?, ?, ?, 1)")
                   : QStringLiteral("DELETE FROM task_completion "
                                    "WHERE crew_id = ? AND task_id = ? AND completed_on = ?"));
    q.addBindValue(crewId);
    q.addBindValue(taskId);
    q.addBindValue(day.toString(Qt::ISODate));
    if (!q.exec()) {
        setError(error, q.lastError().text());
        return false;
    }
    return true;
}

QList<DayPoints> pointsPerDay(int crewId)
{
    QList<DayPoints> result;
    if (!isOpen())
        return result;
    QSqlQuery q;
    q.prepare(QStringLiteral(
        "SELECT tc.completed_on, SUM(t.points), COUNT(*) FROM task_completion tc "
        "JOIN health_task t ON t.id = tc.task_id WHERE tc.crew_id = ? "
        "GROUP BY tc.completed_on ORDER BY tc.completed_on"));
    q.addBindValue(crewId);
    q.exec();
    while (q.next()) {
        result.append({QDate::fromString(q.value(0).toString(), Qt::ISODate),
                       q.value(1).toInt(), q.value(2).toInt()});
    }
    return result;
}

QHash<QString, int> completionsPerTask(int crewId)
{
    QHash<QString, int> result;
    if (!isOpen())
        return result;
    QSqlQuery q;
    q.prepare(QStringLiteral(
        "SELECT t.code, COUNT(*) FROM task_completion tc "
        "JOIN health_task t ON t.id = tc.task_id WHERE tc.crew_id = ? GROUP BY t.code"));
    q.addBindValue(crewId);
    q.exec();
    while (q.next())
        result.insert(q.value(0).toString(), q.value(1).toInt());
    return result;
}

QList<GuideTopic> guideTopics()
{
    QList<GuideTopic> result;
    if (!isOpen())
        return result;
    QSqlQuery q(QStringLiteral(
        "SELECT topic, title, what_it_is, how_to_measure, why_in_space, when_to_act, "
        "       COALESCE(requirement_id, 0) FROM indicator_guide ORDER BY sort_order"));
    while (q.next()) {
        result.append({q.value(0).toString(), q.value(1).toString(), q.value(2).toString(),
                       q.value(3).toString().split('|', Qt::SkipEmptyParts),
                       q.value(4).toString(), q.value(5).toString(), q.value(6).toInt()});
    }
    return result;
}

QStringList requirementConstraints(int requirementId)
{
    QStringList result;
    if (!isOpen())
        return result;
    QSqlQuery q;
    q.prepare(QStringLiteral(
        "SELECT description FROM test_constraint WHERE requirement_id = ? "
        "AND applies_to IN ('all', 'inflight') ORDER BY id"));
    q.addBindValue(requirementId);
    q.exec();
    while (q.next())
        result << q.value(0).toString();
    return result;
}

QStringList requirementSchedule(int requirementId)
{
    QStringList result;
    if (!isOpen())
        return result;
    QSqlQuery q;
    q.prepare(QStringLiteral(
        "SELECT label, activity, phase FROM schedule_point WHERE requirement_id = ? "
        "AND phase IN ('preflight', 'inflight', 'postflight') ORDER BY id"));
    q.addBindValue(requirementId);
    q.exec();
    while (q.next()) {
        result << QStringLiteral("%1 – %2 (%3)")
                      .arg(q.value(0).toString(), q.value(1).toString(), q.value(2).toString());
    }
    return result;
}

} // namespace CardioDb
