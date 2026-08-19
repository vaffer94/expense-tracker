from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, Subcategory
from ..schemas import SubcategoryCreate, SubcategoryOut, SubcategoryPatch

router = APIRouter(prefix="/api/subcategories", tags=["subcategories"])


def _get(db: Session, subcategory_id: int) -> Subcategory:
    subcategory = db.get(Subcategory, subcategory_id)
    if subcategory is None:
        raise HTTPException(404, "Subcategory not found")
    return subcategory


def _live_parent(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(422, "Category not found")
    if category.is_archived:
        raise HTTPException(422, "Cannot add to an archived category")
    return category


def _conflict(db: Session, name: str, category_id: int, exclude_id: int | None = None) -> bool:
    stmt = select(Subcategory).where(
        Subcategory.name == name,
        Subcategory.category_id == category_id,
        Subcategory.is_archived.is_(False),
    )
    if exclude_id is not None:
        stmt = stmt.where(Subcategory.id != exclude_id)
    return db.scalars(stmt).first() is not None


@router.get("", response_model=list[SubcategoryOut])
def list_subcategories(
    category_id: int | None = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
):
    stmt = select(Subcategory).order_by(Subcategory.name.asc())
    if category_id:
        stmt = stmt.where(Subcategory.category_id == category_id)
    if not include_archived:
        stmt = stmt.where(Subcategory.is_archived.is_(False))
    return db.scalars(stmt).unique().all()


@router.post("", response_model=SubcategoryOut, status_code=201)
def create_subcategory(payload: SubcategoryCreate, db: Session = Depends(get_db)):
    _live_parent(db, payload.category_id)
    if _conflict(db, payload.name, payload.category_id):
        raise HTTPException(409, f"'{payload.name}' already exists under that category")
    subcategory = Subcategory(**payload.model_dump())
    db.add(subcategory)
    db.commit()
    return subcategory


@router.patch("/{subcategory_id}", response_model=SubcategoryOut)
def update_subcategory(subcategory_id: int, payload: SubcategoryPatch, db: Session = Depends(get_db)):
    subcategory = _get(db, subcategory_id)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)

    parent_id = changes.get("category_id", subcategory.category_id)
    if "category_id" in changes and parent_id != subcategory.category_id:
        # Re-parenting is allowed, but only within the same kind: an expense subcategory under an
        # income category is meaningless. Past transactions keep the parent they recorded.
        new_parent = _live_parent(db, parent_id)
        if new_parent.kind != subcategory.category.kind:
            raise HTTPException(422, f"Cannot move a {subcategory.category.kind} subcategory to a {new_parent.kind} category")

    name = changes.get("name", subcategory.name)
    if _conflict(db, name, parent_id, exclude_id=subcategory.id):
        raise HTTPException(409, f"'{name}' already exists under that category")

    for field, value in changes.items():
        setattr(subcategory, field, value)
    db.commit()
    db.refresh(subcategory)
    return subcategory


@router.delete("/{subcategory_id}", status_code=204)
def archive_subcategory(subcategory_id: int, db: Session = Depends(get_db)):
    subcategory = _get(db, subcategory_id)
    subcategory.is_archived = True
    db.commit()
    return Response(status_code=204)


@router.patch("/{subcategory_id}/restore", response_model=SubcategoryOut)
def restore_subcategory(subcategory_id: int, db: Session = Depends(get_db)):
    subcategory = _get(db, subcategory_id)
    if subcategory.is_archived and _conflict(db, subcategory.name, subcategory.category_id, subcategory.id):
        raise HTTPException(409, f"'{subcategory.name}' already exists under that category")
    subcategory.is_archived = False
    db.commit()
    return subcategory
