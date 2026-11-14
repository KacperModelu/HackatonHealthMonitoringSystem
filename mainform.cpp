#include "mainform.h"
#include "./ui_mainform.h"

mainform::mainform(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::mainform)
{
    ui->setupUi(this);
}

mainform::~mainform()
{
    delete ui;
}

void mainform::on_pushButton_clicked()
{
    QString name = ui->lineEdit->text().trimmed();
    QString surname = ui->lineEdit_2->text().trimmed();
    QString age = ui->lineEdit_3->text().trimmed();
    QString sex = ui->comboBox->currentText();

    if (name.isEmpty() || surname.isEmpty()) {
        return;
    }

    QString fullName = name + " " + surname;
    emit userAdded(fullName, age, sex);
    this->close();
}