#ifndef LOGIN_H
#define LOGIN_H

#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>

namespace Ui {
class Login;
}

class Login : public QDialog
{
    Q_OBJECT

public:
    explicit Login(QWidget *parent = nullptr);
    ~Login();

private slots:
    void on_pushButton_clicked();
    void on_pushButton_2_clicked();
    void on_pushButton_3_clicked();

private:
    Ui::Login *ui;
    QJsonArray usersArray;
    void loadUsers();
    void saveUsers();
};

#endif // LOGIN_H