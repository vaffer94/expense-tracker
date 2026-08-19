from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Index, Integer, String, text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    kind: Mapped[str] = mapped_column(String(7), nullable=False)
    icon: Mapped[str] = mapped_column(String(64), nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    subcategories: Mapped[list["Subcategory"]] = relationship(
        primaryjoin="Category.id == Subcategory.category_id",
        order_by="Subcategory.name",
        lazy="selectin",
        viewonly=True,
    )

    __table_args__ = (
        Index(
            "uq_category_live_name_kind", "name", "kind",
            unique=True, sqlite_where=text("is_archived = 0"),
        ),
    )


class Subcategory(Base):
    """A second level under a category. Inherits its parent's kind, icon and colour."""

    __tablename__ = "subcategories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    category: Mapped["Category"] = relationship(lazy="joined")

    __table_args__ = (
        Index(
            "uq_subcategory_live_name_parent", "name", "category_id",
            unique=True, sqlite_where=text("is_archived = 0"),
        ),
    )


class Setting(Base):
    """Key/value so that a new setting never needs a schema change."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(7), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Recorded alongside category_id, never derived from it: this is what freezes history when a
    # subcategory is later re-parented.
    subcategory_id: Mapped[int | None] = mapped_column(
        ForeignKey("subcategories.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    category: Mapped[Category] = relationship(lazy="joined")
    subcategory: Mapped["Subcategory | None"] = relationship(lazy="joined", foreign_keys=[subcategory_id])
