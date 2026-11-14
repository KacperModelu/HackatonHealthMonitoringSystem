#include "login.h"
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