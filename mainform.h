#ifndef MAINFORM_H
#define MAINFORM_H

#include <QMainWindow>

QT_BEGIN_NAMESPACE
namespace Ui {
class mainform;
}
QT_END_NAMESPACE

class mainform : public QMainWindow
{
    Q_OBJECT

public:
    explicit mainform(QWidget *parent = nullptr);
    ~mainform() override;

signals:
    void userAdded(const QString &fullName, const QString &age, const QString &sex);

private slots:
    void on_pushButton_clicked();
private:
    Ui::mainform *ui;
};
#endif