#include "cardiodb.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QObject>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>

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

    // Databases created before the ground-truth table existed.
    q.exec(QStringLiteral(
        "CREATE TABLE IF NOT EXISTS simulated_event ("
        " id INTEGER PRIMARY KEY,"
        " crew_id INTEGER NOT NULL REFERENCES crew_member(id),"
        " mission_id INTEGER REFERENCES mission(id),"
        " kind TEXT NOT NULL, start_flight_day INTEGER, end_flight_day INTEGER,"
        " description TEXT NOT NULL,"
        " source TEXT NOT NULL CHECK (source IN ('generator','app')))"));
    return true;
}

bool isOpen()
{
    return QSqlDatabase::contains() && QSqlDatabase::database().isOpen();
}

bool ensureOpen(QString *error)
{
    return isOpen() || open(defaultPath(), error);
}

} // namespace CardioDb
