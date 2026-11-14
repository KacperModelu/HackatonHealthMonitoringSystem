#include "cardiodb.h"

#include <QCoreApplication>
#include <QDate>
#include <QDir>
#include <QFileInfo>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
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

} // namespace CardioDb
