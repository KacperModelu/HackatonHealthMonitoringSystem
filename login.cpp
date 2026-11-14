#include "login.h"
#include "mainform.h"
#include "statsscreen.h"
#include "ui_login.h"
#include <QApplication>
#include <QFile>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QScreen>

Login::Login(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::Login)
{
    ui->setupUi(this);
    loadUsers(); // <-- 1. Wczytanie użytkowników z pliku przy starcie

    // Wyśrodkowanie okna Login na ekranie
    QRect screenGeometry = QGuiApplication::primaryScreen()->availableGeometry();
    move((screenGeometry.width() - width()) / 2,
         (screenGeometry.height() - height()) / 2);
}

Login::~Login()
{
    delete ui;
}

void Login::on_pushButton_clicked()
{
    int index = ui->comboBox->currentIndex();
    if (index < 0 || index >= usersArray.size()) {
        return;
    }

    statsscreen *stats = new statsscreen(nullptr);
    stats->setAttribute(Qt::WA_DeleteOnClose);

    connect(stats, &QObject::destroyed, qApp, &QApplication::quit);

    this->hide();
    stats->show();
}

void Login::on_pushButton_2_clicked()
{
    mainform *addForm = new mainform(nullptr);
    addForm->setAttribute(Qt::WA_DeleteOnClose);

    bool *created = new bool(false);

    connect(addForm, &mainform::userAdded, this, [this, created](const QString &fullName, const QString &age, const QString &sex) {
        *created = true;

        // <-- 2. Zapis nowego użytkownika do tablicy i pliku JSON
        QJsonObject newUser;
        newUser["fullName"] = fullName;
        newUser["age"] = age;
        newUser["sex"] = sex;
        usersArray.append(newUser);
        saveUsers();

        ui->comboBox->addItem(fullName);
        ui->comboBox->setCurrentText(fullName);
        this->show();
    });

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
    if (index < 0 || index >= usersArray.size()) {
        return;
    }

    usersArray.removeAt(index);
    saveUsers();
    ui->comboBox->removeItem(index);
}

void Login::loadUsers()
{
    QFile file("users.json");
    if (!file.open(QIODevice::ReadOnly)) {
        return;
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