#include "mainform.h"
#include "./ui_mainform.h"
#include "datagenerator.h"
#include <QApplication>
#include <QMessageBox>
#include <QScreen>
#include <QGuiApplication>

mainform::mainform(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::mainform)
{
    ui->setupUi(this);

    // Wyśrodkowanie okna mainform na ekranie
    QRect screenGeometry = QGuiApplication::primaryScreen()->availableGeometry();
    move((screenGeometry.width() - width()) / 2,
         (screenGeometry.height() - height()) / 2);
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

    // Wzrost i waga są opcjonalne (puste = losowa, realistyczna wartość).
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

    DataGenerator::Person person;
    person.firstName = name;
    person.lastName = surname;
    person.age = ageYears;
    person.sex = ui->comboBox->currentIndex() == 1 ? 'F' : 'M';   // Man / Woman
    if (!optionalNumber(ui->lineEdit_4->text(), 120, 230, &person.heightCm)) {
        QMessageBox::warning(this, tr("Invalid height"), tr("Height must be in cm (120–230)."));
        return;
    }
    if (!optionalNumber(ui->lineEdit_5->text(), 35, 200, &person.weightKg)) {
        QMessageBox::warning(this, tr("Invalid weight"), tr("Weight must be in kg (35–200)."));
        return;
    }

    // Generowanie fałszywych danych do analizy (zapis do database/cardio_analysis.db)
    QString error;
    QApplication::setOverrideCursor(Qt::WaitCursor);
    const auto result = DataGenerator::generate(person, &error);
    QApplication::restoreOverrideCursor();
    if (!result) {
        QMessageBox::critical(this, tr("Could not generate data"), error);
        return;
    }

    QString summary = tr("Generated data for %1 %2 (crew id %3, mission %4):\n\n"
                         "• %5 vitals readings (twice a day in flight)\n"
                         "• %6 cycle ergometer tests\n"
                         "• %7 resting ECGs\n\n")
                          .arg(name, surname).arg(result->crewId).arg(result->mission)
                          .arg(result->vitalsReadings).arg(result->cycleTests).arg(result->ecgs);
    if (result->events.isEmpty())
        summary += tr("No deviations from the norm were simulated (healthy profile).");
    else
        summary += tr("Simulated deviations from the norm:\n• %1")
                       .arg(result->events.join(QStringLiteral("\n• ")));
    QMessageBox::information(this, tr("Data generated"), summary);

    QString fullName = name + " " + surname;
    emit userAdded(fullName, age, sex);
    this->close();
}