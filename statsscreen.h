#ifndef STATSSCREEN_H
#define STATSSCREEN_H

#include <QDialog>

namespace Ui {
class statsscreen;
}

class statsscreen : public QDialog
{
    Q_OBJECT

public:
    explicit statsscreen(QWidget *parent = nullptr);
    ~statsscreen();

private:
    Ui::statsscreen *ui;
};

#endif // STATSSCREEN_H
