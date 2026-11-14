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
