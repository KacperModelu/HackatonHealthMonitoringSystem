#ifndef LOGIN_H
#define LOGIN_H

#include <QJsonArray>
#include <QJsonObject>
#include <QDialog>

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
    void on_pushButton_2_clicked();
    void on_pushButton_3_clicked(); // <-- upewnij się, że to jest w login.h
private:
    Ui::Login *ui;
    QJsonArray usersArray; // trzyma wszystkich użytkowników (imię, wiek, płeć)
    void loadUsers();
    void saveUsers();
};

#endif // LOGIN_H
