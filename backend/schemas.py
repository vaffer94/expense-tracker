import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

PALETTE = {
    "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
    "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#78716c",
}

# Allowed icons are exactly the symbols in the vendored sprite: one source of truth.
SPRITE = Path(__file__).resolve().parent.parent / "frontend" / "vendor" / "lucide-sprite.svg"
ICONS = {i for i in re.findall(r'<symbol id="([^"]+)"', SPRITE.read_text()) if not i.startswith("ui-")}

Kind = Literal["expense", "income"]


def to_utc_naive(dt: datetime) -> datetime:
    """Normalise an aware or naive (assumed UTC) datetime to naive UTC."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def check_amount(v: float) -> float:
    if v <= 0:
        raise ValueError("amount must be greater than 0")
    if v > 1_000_000:
        raise ValueError("amount must not exceed 1000000")
    if round(v, 2) != v:
        raise ValueError("amount must have at most 2 decimal places")
    return v


def check_timestamp(dt: datetime) -> datetime:
    dt = to_utc_naive(dt)
    if dt > datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24):
        raise ValueError("timestamp cannot be more than 24h in the future")
    return dt


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    kind: Kind
    icon: str
    color: str

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not 1 <= len(v) <= 40:
            raise ValueError("name must be 1-40 characters")
        return v

    @field_validator("icon")
    @classmethod
    def _icon(cls, v: str) -> str:
        if v not in ICONS:
            raise ValueError("unknown icon")
        return v

    @field_validator("color")
    @classmethod
    def _color(cls, v: str) -> str:
        v = v.lower()
        if v not in PALETTE:
            raise ValueError("color must be one of the palette")
        return v


class CategoryPatch(BaseModel):
    """`kind` is immutable — extra="forbid" turns an attempt to change it into a 422."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None

    _name = field_validator("name")(CategoryCreate._name.__func__)
    _icon = field_validator("icon")(CategoryCreate._icon.__func__)
    _color = field_validator("color")(CategoryCreate._color.__func__)


class SubcategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    category_id: int

    _name = field_validator("name")(CategoryCreate._name.__func__)


class SubcategoryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    category_id: Optional[int] = None

    _name = field_validator("name")(CategoryCreate._name.__func__)


class SubcategoryEmbedded(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_archived: bool


class SubcategoryOut(SubcategoryEmbedded):
    category_id: int


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: str
    icon: str
    color: str
    is_archived: bool
    created_at: datetime
    subcategories: list[SubcategoryEmbedded] = []

    @field_serializer("created_at")
    def _ser(self, dt: datetime) -> str:
        return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


class CategoryEmbedded(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    icon: str
    color: str
    is_archived: bool


class TransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Kind
    amount: float
    category_id: int
    subcategory_id: Optional[int] = None
    timestamp: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=500)

    _amount = field_validator("amount")(check_amount)
    _ts = field_validator("timestamp")(check_timestamp)


class TransactionPatch(BaseModel):
    """`type` is immutable — extra="forbid" makes an attempt to change it a 422."""

    model_config = ConfigDict(extra="forbid")

    amount: Optional[float] = None
    category_id: Optional[int] = None
    subcategory_id: Optional[int] = None
    timestamp: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=500)

    _amount = field_validator("amount")(check_amount)
    _ts = field_validator("timestamp")(check_timestamp)


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    amount: float
    category: CategoryEmbedded
    subcategory: Optional[SubcategoryEmbedded] = None
    timestamp: datetime
    notes: Optional[str]
    created_at: datetime

    @field_serializer("timestamp", "created_at")
    def _ser(self, dt: datetime) -> str:
        return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int


class Summary(BaseModel):
    total_income: float
    total_expense: float
    net: float
    transaction_count: int


class Slice(BaseModel):
    category_id: int
    subcategory_id: Optional[int] = None
    name: str
    color: str
    icon: str
    is_archived: bool
    amount: float
    percentage: float


class ByCategory(BaseModel):
    total: float
    slices: list[Slice]


class Bucket(BaseModel):
    period: str
    income: float
    expense: float
    balance: float


class Trends(BaseModel):
    granularity: str
    opening_balance: float
    buckets: list[Bucket]


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starting_balance: float = 0.0

    @field_validator("starting_balance")
    @classmethod
    def _balance(cls, v: float) -> float:
        if abs(v) > 1_000_000:
            raise ValueError("starting balance must be within +/- 1000000")
        if round(v, 2) != v:
            raise ValueError("starting balance must have at most 2 decimal places")
        return v


class ComparisonBucket(BaseModel):
    period: str
    amount: float
    change_pct: Optional[float] = None


class ComparisonRow(BaseModel):
    category_id: int
    name: str
    color: str
    icon: str
    is_archived: bool
    total: float
    buckets: list[ComparisonBucket]


class MonthlyComparison(BaseModel):
    months: list[str]
    categories: list[ComparisonRow]
