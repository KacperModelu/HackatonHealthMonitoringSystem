#include "login.h"
#include "mainform.h"
#include <QApplication>

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    Login w;
    w.show();

    // Jeśli oba okna mają odpalić się naraz po uruchomieniu apki, odkomentuj te 2 linijki:
    // mainform m;
    // m.show();

    return a.exec();
}