#include "cardio_analysis.h"

cardio_analysis::cardio_analysis(QObject *parent)
    : QAbstractItemModel(parent)
{}

QVariant cardio_analysis::headerData(int section, Qt::Orientation orientation, int role) const
{
    // FIXME: Implement me!
}

QModelIndex cardio_analysis::index(int row, int column, const QModelIndex &parent) const
{
    // FIXME: Implement me!
}

QModelIndex cardio_analysis::parent(const QModelIndex &index) const
{
    // FIXME: Implement me!
}

int cardio_analysis::rowCount(const QModelIndex &parent) const
{
    if (!parent.isValid())
        return 0;

    // FIXME: Implement me!
}

int cardio_analysis::columnCount(const QModelIndex &parent) const
{
    if (!parent.isValid())
        return 0;

    // FIXME: Implement me!
}

QVariant cardio_analysis::data(const QModelIndex &index, int role) const
{
    if (!index.isValid())
        return QVariant();

    // FIXME: Implement me!
    return QVariant();
}
