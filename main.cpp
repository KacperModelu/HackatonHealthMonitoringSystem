#include "cardiodb.h"
#include "login.h"
#include <QApplication>
#include <QMessageBox>

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    QString error;
    if (!CardioDb::open(CardioDb::defaultPath(), &error)) {
        QMessageBox::critical(nullptr, QObject::tr("Database error"),
                              QObject::tr("Could not open the cardio database.\n\n%1").arg(error));
    }

    Login w;
    w.show();
    return a.exec();
}
