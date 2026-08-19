from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category
from ..schemas import CategoryCreate, CategoryOut, CategoryPatch, Kind

router = APIRouter(prefix="/api/categories", tags=["categories"])


def _get(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(404, "Category not found")
    return category


def _live_conflict(db: Session, name: str, kind: str, exclude_id: int | None = None) -> bool:
    stmt = select(Category).where(
        Category.name == name, Category.kind == kind, Category.is_archived.is_(False)
    )
    if exclude_id is not None:
        stmt = stmt.where(Category.id != exclude_id)
    return db.scalars(stmt).first() is not None


def _payload(category: Category, include_archived: bool) -> dict:
    """The sheet renders the whole picker from this, so subcategories ride along."""
    data = {c.name: getattr(category, c.name) for c in Category.__table__.columns}
    data["subcategories"] = [
        s for s in category.subcategories if include_archived or not s.is_archived
    ]
    return data


@router.get("", response_model=list[CategoryOut])
def list_categories(
    kind: Kind | None = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
):
    stmt = select(Category).order_by(Category.name.asc())
    if kind:
        stmt = stmt.where(Category.kind == kind)
    if not include_archived:
        stmt = stmt.where(Category.is_archived.is_(False))
    return [_payload(c, include_archived) for c in db.scalars(stmt).unique().all()]


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    if _live_conflict(db, payload.name, payload.kind):
        raise HTTPException(409, f"A {payload.kind} category named '{payload.name}' already exists")
    category = Category(**payload.model_dump())
    db.add(category)
    db.commit()
    return category


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, payload: CategoryPatch, db: Session = Depends(get_db)):
    category = _get(db, category_id)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    name = changes.get("name")
    if name and _live_conflict(db, name, category.kind, exclude_id=category.id):
        raise HTTPException(409, f"A {category.kind} category named '{name}' already exists")
    for field, value in changes.items():
        setattr(category, field, value)
    db.commit()
    return category


@router.delete("/{category_id}", status_code=204)
def archive_category(category_id: int, db: Session = Depends(get_db)):
    category = _get(db, category_id)
    category.is_archived = True
    db.commit()
    return Response(status_code=204)


@router.patch("/{category_id}/restore", response_model=CategoryOut)
def restore_category(category_id: int, db: Session = Depends(get_db)):
    category = _get(db, category_id)
    if category.is_archived and _live_conflict(db, category.name, category.kind, category.id):
        raise HTTPException(409, f"A {category.kind} category named '{category.name}' already exists")
    category.is_archived = False
    db.commit()
    return category
