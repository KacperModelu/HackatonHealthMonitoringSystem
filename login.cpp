#include "login.h"
#include "cardiodb.h"
#include "mainform.h"
#include "ui_login.h"
#include <QDebug>

Login::Login(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::Login)
{
    ui->setupUi(this);
    reloadCrew();
}

// Lista członków załogi z bazy danych (id zapisane w itemData).
void Login::reloadCrew()
{
    ui->comboBox->clear();
    for (const auto &crew : CardioDb::crewMembers())
        ui->comboBox->addItem(crew.fullName, crew.id);
}

Login::~Login()
{
    delete ui;
}

void Login::on_pushButton_2_clicked()
{
    mainform *addForm = new mainform(nullptr);
    addForm->setAttribute(Qt::WA_DeleteOnClose);

    // Flaga sprawdzająca, czy użytkownik został utworzony
    bool *created = new bool(false);

    connect(addForm, &mainform::userAdded, this, [this, created](const QString &fullName, const QString &age, const QString &sex) {
        *created = true;
        reloadCrew();   // mainform zapisał już użytkownika w bazie
        ui->comboBox->setCurrentText(fullName);
        this->show();
    });

    // Gdy okno mainform zniknie z pamięci: jeśli NIE kliknięto "Create user", zamknij całą aplikację
    connect(addForm, &QObject::destroyed, this, [created]() {
        if (!(*created)) {
            QApplication::quit();
        }
        delete created;
    });

    this->hide();
    addForm->show();
}