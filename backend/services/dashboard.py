from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Category, Transaction


def resolve_range(from_: str, to: str, tz: str):
    """Interpret from/to in the caller's timezone; return UTC-naive bounds + the zone.

    Bare dates and naive datetimes are local wall-clock; explicit offsets win.
    """
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, f"Unknown timezone '{tz}'")

    def parse(value: str, label: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            raise HTTPException(422, f"Invalid '{label}' date: {value}")
        return parsed.replace(tzinfo=zone) if parsed.tzinfo is None else parsed.astimezone(zone)

    start_local, end_local = parse(from_, "from"), parse(to, "to")
    if end_local <= start_local:
        raise HTTPException(422, "'to' must be after 'from'")
    to_utc = lambda d: d.astimezone(timezone.utc).replace(tzinfo=None)
    return to_utc(start_local), to_utc(end_local), start_local, end_local, zone


def _rows(db: Session, start: datetime, end: datetime):
    stmt = select(Transaction).where(Transaction.timestamp >= start, Transaction.timestamp < end)
    return db.scalars(stmt).unique().all()


def summary(db: Session, start: datetime, end: datetime) -> dict:
    rows = _rows(db, start, end)
    income = sum(r.amount for r in rows if r.type == "income")
    expense = sum(r.amount for r in rows if r.type == "expense")
    return {
        "total_income": round(income, 2),
        "total_expense": round(expense, 2),
        "net": round(income - expense, 2),
        "transaction_count": len(rows),
    }


def by_category(db: Session, start: datetime, end: datetime, type_: str) -> dict:
    totals: dict[int, float] = {}
    for row in _rows(db, start, end):
        if row.type == type_:
            totals[row.category_id] = totals.get(row.category_id, 0.0) + row.amount
    total = round(sum(totals.values()), 2)

    slices = []
    for category_id, amount in totals.items():
        category = db.get(Category, category_id)
        slices.append({
            "category_id": category.id,
            "name": category.name,
            "color": category.color,
            "icon": category.icon,
            "is_archived": category.is_archived,
            "amount": round(amount, 2),
            "percentage": round(amount / total * 100, 1) if total else 0.0,
        })
    slices.sort(key=lambda s: s["amount"], reverse=True)
    return {"total": total, "slices": slices}


def _period_key(day: date, granularity: str) -> str:
    if granularity == "day":
        return day.isoformat()
    if granularity == "week":
        return (day - timedelta(days=day.weekday())).isoformat()
    return day.strftime("%Y-%m")


def _period_starts(start: date, end: date, granularity: str) -> list[str]:
    """Every bucket key touching [start, end), so the series is dense."""
    keys, cursor = [], start
    if granularity == "week":
        cursor = start - timedelta(days=start.weekday())
    elif granularity == "month":
        cursor = start.replace(day=1)
    while cursor < end:
        keys.append(_period_key(cursor, granularity))
        if granularity == "day":
            cursor += timedelta(days=1)
        elif granularity == "week":
            cursor += timedelta(days=7)
        else:
            cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    return keys


def trends(db, start, end, start_local, end_local, zone, granularity: str) -> dict:
    buckets = {
        key: {"period": key, "income": 0.0, "expense": 0.0}
        for key in _period_starts(start_local.date(), end_local.date(), granularity)
    }
    for row in _rows(db, start, end):
        local_day = row.timestamp.replace(tzinfo=timezone.utc).astimezone(zone).date()
        bucket = buckets.get(_period_key(local_day, granularity))
        if bucket:
            bucket[row.type] += row.amount
    for bucket in buckets.values():
        bucket["income"] = round(bucket["income"], 2)
        bucket["expense"] = round(bucket["expense"], 2)
    return {"granularity": granularity, "buckets": list(buckets.values())}
