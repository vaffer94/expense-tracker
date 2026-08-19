from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, Subcategory, Transaction
from ..schemas import (
    Kind, TransactionCreate, TransactionOut, TransactionPage, TransactionPatch, to_utc_naive,
)

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _check_category(db: Session, category_id: int, kind: str) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(422, "Category not found")
    if category.is_archived:
        raise HTTPException(422, "Cannot log to an archived category")
    if category.kind != kind:
        raise HTTPException(422, f"Category '{category.name}' is an {category.kind} category")
    return category


def _check_subcategory(db: Session, subcategory_id: int | None, category_id: int) -> None:
    """Only checked on write. Rows whose subcategory later moved elsewhere stay as recorded."""
    if subcategory_id is None:
        return
    subcategory = db.get(Subcategory, subcategory_id)
    if subcategory is None:
        raise HTTPException(422, "Subcategory not found")
    if subcategory.is_archived:
        raise HTTPException(422, "Cannot log to an archived subcategory")
    if subcategory.category_id != category_id:
        raise HTTPException(422, f"'{subcategory.name}' does not belong to that category")


@router.get("", response_model=TransactionPage)
def list_transactions(
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    type: Kind | None = None,
    category_id: int | None = None,
    subcategory_id: int | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    stmt = select(Transaction)
    if from_:
        stmt = stmt.where(Transaction.timestamp >= to_utc_naive(from_))
    if to:
        stmt = stmt.where(Transaction.timestamp < to_utc_naive(to))
    if type:
        stmt = stmt.where(Transaction.type == type)
    if category_id:
        stmt = stmt.where(Transaction.category_id == category_id)
    if subcategory_id:
        stmt = stmt.where(Transaction.subcategory_id == subcategory_id)

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    page = stmt.order_by(Transaction.timestamp.desc(), Transaction.id.desc()).limit(limit).offset(offset)
    return {"items": db.scalars(page).unique().all(), "total": total}


@router.post("", response_model=TransactionOut, status_code=201)
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    _check_category(db, payload.category_id, payload.type)
    _check_subcategory(db, payload.subcategory_id, payload.category_id)
    data = payload.model_dump()
    data["timestamp"] = data["timestamp"] or datetime.now(timezone.utc).replace(tzinfo=None)
    transaction = Transaction(**data)
    db.add(transaction)
    db.commit()
    return transaction


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(transaction_id: int, payload: TransactionPatch, db: Session = Depends(get_db)):
    transaction = db.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(404, "Transaction not found")
    changes = payload.model_dump(exclude_unset=True)
    category_id = changes.get("category_id") or transaction.category_id
    if "category_id" in changes and changes["category_id"] is not None:
        _check_category(db, category_id, transaction.type)
    if "subcategory_id" in changes:
        _check_subcategory(db, changes["subcategory_id"], category_id)
    for field, value in changes.items():
        if value is None and field in ("amount", "category_id", "timestamp"):
            continue
        setattr(transaction, field, value)
    db.commit()
    db.refresh(transaction)
    return transaction


@router.delete("/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    transaction = db.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(404, "Transaction not found")
    db.delete(transaction)
    db.commit()
    return Response(status_code=204)
