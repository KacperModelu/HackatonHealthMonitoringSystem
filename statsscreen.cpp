#include "statsscreen.h"
#include "ui_statsscreen.h"

statsscreen::statsscreen(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::statsscreen)
{
    ui->setupUi(this);
}

statsscreen::~statsscreen()
{
    delete ui;
}
