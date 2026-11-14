#include "login.h"
#include "mainform.h"
#include "ui_login.h"
#include <QApplication>
#include <QDebug>
#include <QFile>
#include <QJsonDocument>

Login::Login(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::Login)
{
    ui->setupUi(this);
    loadUsers();
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

        // Tworzymy obiekt użytkownika i zapisujemy go na dysku
        QJsonObject newUser;
        newUser["fullName"] = fullName;
        newUser["age"] = age;
        newUser["sex"] = sex;
        usersArray.append(newUser);
        saveUsers();

        // Dodajemy do ComboBoxa i zaznaczamy
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

void Login::on_pushButton_3_clicked()
{
    int index = ui->comboBox->currentIndex();

    // Zabezpieczenie na wypadek pustej listy
    if (index < 0 || index >= usersArray.size()) {
        return;
    }

    // Usuwamy z pamięci, aktualizujemy plik users.json i czyścimy wpis z ComboBoxa
    usersArray.removeAt(index);
    saveUsers();
    ui->comboBox->removeItem(index);
}

void Login::loadUsers()
{
    QFile file("users.json");
    if (!file.open(QIODevice::ReadOnly)) {
        return; // Przy pierwszym uruchomieniu plik jeszcze nie istnieje — lista będzie pusta
    }

    QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
    usersArray = doc.array();
    file.close();

    ui->comboBox->clear();
    for (const QJsonValue &val : usersArray) {
        QJsonObject obj = val.toObject();
        ui->comboBox->addItem(obj["fullName"].toString());
    }
}

void Login::saveUsers()
{
    QFile file("users.json");
    if (!file.open(QIODevice::WriteOnly)) {
        return;
    }

    QJsonDocument doc(usersArray);
    file.write(doc.toJson());
    file.close();
}