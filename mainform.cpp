#include "mainform.h"
#include "./ui_mainform.h"
#include "cardiodb.h"

#include <QMessageBox>

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
        QMessageBox::warning(this, tr("Missing data"), tr("Please enter name and surname."));
        return;
    }

    bool ok = false;
    const int ageYears = age.toInt(&ok);
    if (!ok || ageYears < 18 || ageYears > 99) {
        QMessageBox::warning(this, tr("Invalid age"), tr("Age must be a number between 18 and 99."));
        return;
    }

    // Wzrost i waga są opcjonalne; akceptujemy przecinek lub kropkę.
    const auto optionalNumber = [](const QString &text, double min, double max,
                                   std::optional<double> *out) {
        const QString t = text.trimmed().replace(',', '.');
        if (t.isEmpty())
            return true;
        bool valid = false;
        const double v = t.toDouble(&valid);
        if (!valid || v < min || v > max)
            return false;
        *out = v;
        return true;
    };

    CardioDb::NewCrewMember member;
    member.firstName = name;
    member.lastName = surname;
    member.age = ageYears;
    member.sex = ui->comboBox->currentIndex() == 1 ? 'F' : 'M';   // Man / Woman
    if (!optionalNumber(ui->lineEdit_4->text(), 120, 230, &member.heightCm)) {
        QMessageBox::warning(this, tr("Invalid height"), tr("Height must be in cm (120–230)."));
        return;
    }
    if (!optionalNumber(ui->lineEdit_5->text(), 35, 200, &member.weightKg)) {
        QMessageBox::warning(this, tr("Invalid weight"), tr("Weight must be in kg (35–200)."));
        return;
    }

    QString error;
    if (CardioDb::addCrewMember(member, &error) < 0) {
        QMessageBox::critical(this, tr("Database error"),
                              tr("Could not save the user.\n\n%1").arg(error));
        return;
    }

    QString fullName = name + " " + surname;
    emit userAdded(fullName, age, sex);
    this->close();
}