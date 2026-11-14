#include "login.h"
#include "mainform.h"
#include "ui_login.h"
#include <QDebug>

Login::Login(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::Login)
{
    ui->setupUi(this);

    ui->comboBox->addItem("Jan Kowalski");
    ui->comboBox->addItem("Anna Nowak");
    ui->comboBox->addItem("Piotr Wiśniewski");
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
        ui->comboBox->addItem(fullName);
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