from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Category, Setting, Subcategory, Transaction


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


def shade(hex_color: str, step: int) -> str:
    """Lighten a palette colour by its position within its parent group.

    Keeps one category reading as one visual block when split into subcategories. Capped, or the
    last slices of a large group wash out to white.
    """
    factor = min(step, 6) * 0.11
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    mix = lambda c: round(c + (255 - c) * factor)
    return "#%02x%02x%02x" % (mix(r), mix(g), mix(b))


def by_category(db: Session, start: datetime, end: datetime, type_: str, group: str = "category") -> dict:
    """Aggregate a range into pie slices.

    `type_` may be "expense", "income" or "all"; "all" mixes both, so its percentages are shares of
    total money moved, not of spending. Grouping by subcategory keys on the (category, subcategory)
    pair *recorded on the transaction*, so a later re-parenting never reshapes past charts.
    """
    totals: dict[tuple[int, int | None], float] = {}
    for row in _rows(db, start, end):
        if type_ != "all" and row.type != type_:
            continue
        key = (row.category_id, row.subcategory_id if group == "subcategory" else None)
        totals[key] = totals.get(key, 0.0) + row.amount
    total = round(sum(totals.values()), 2)

    slices = []
    for (category_id, subcategory_id), amount in totals.items():
        category = db.get(Category, category_id)
        subcategory = db.get(Subcategory, subcategory_id) if subcategory_id else None
        slices.append({
            "category_id": category.id,
            "subcategory_id": subcategory_id,
            "name": f"{category.name} \u00b7 {subcategory.name}" if subcategory else category.name,
            "color": category.color,
            "icon": category.icon,
            "is_archived": category.is_archived or (subcategory.is_archived if subcategory else False),
            "amount": round(amount, 2),
            "percentage": round(amount / total * 100, 1) if total else 0.0,
        })
    slices.sort(key=lambda s: s["amount"], reverse=True)

    if group == "subcategory":
        seen: dict[int, int] = {}
        for entry in slices:
            step = seen.get(entry["category_id"], 0)
            seen[entry["category_id"]] = step + 1
            entry["color"] = shade(entry["color"], step)

    return {"total": total, "slices": slices}


def starting_balance(db: Session) -> float:
    row = db.get(Setting, "starting_balance")
    return float(row.value) if row else 0.0


def set_starting_balance(db: Session, value: float) -> None:
    row = db.get(Setting, "starting_balance")
    if row:
        row.value = str(value)
    else:
        db.add(Setting(key="starting_balance", value=str(value)))
    db.commit()


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
        key: {"period": key, "income": 0.0, "expense": 0.0, "balance": 0.0}
        for key in _period_starts(start_local.date(), end_local.date(), granularity)
    }
    for row in _rows(db, start, end):
        local_day = row.timestamp.replace(tzinfo=timezone.utc).astimezone(zone).date()
        bucket = buckets.get(_period_key(local_day, granularity))
        if bucket:
            bucket[row.type] += row.amount

    # The balance line has to be true for the window being looked at, so it starts from everything
    # that happened before it - not from zero.
    earlier = db.scalars(select(Transaction).where(Transaction.timestamp < start)).unique().all()
    opening = starting_balance(db) + sum(
        r.amount if r.type == "income" else -r.amount for r in earlier
    )

    running = opening
    for bucket in buckets.values():
        bucket["income"] = round(bucket["income"], 2)
        bucket["expense"] = round(bucket["expense"], 2)
        running += bucket["income"] - bucket["expense"]
        bucket["balance"] = round(running, 2)

    return {
        "granularity": granularity,
        "opening_balance": round(opening, 2),
        "buckets": list(buckets.values()),
    }


def _months_between(start: date, end: date) -> list[str]:
    """Every calendar month touched by [start, end), densely."""
    months, cursor = [], start.replace(day=1)
    while cursor < end:
        months.append(cursor.strftime("%Y-%m"))
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    return months


def monthly_comparison(db, start, end, start_local, end_local, zone, type_: str) -> dict:
    """Per category, one figure per calendar month plus its change from the month before."""
    months = _months_between(start_local.date(), end_local.date())
    per_category: dict[int, dict[str, float]] = {}

    for row in _rows(db, start, end):
        if row.type != type_:
            continue
        local_month = row.timestamp.replace(tzinfo=timezone.utc).astimezone(zone).strftime("%Y-%m")
        if local_month not in months:
            continue
        per_category.setdefault(row.category_id, {m: 0.0 for m in months})[local_month] += row.amount

    rows = []
    for category_id, amounts in per_category.items():
        category = db.get(Category, category_id)
        buckets, previous = [], None
        for month in months:
            amount = round(amounts[month], 2)
            # A change from zero is undefined, not infinite: the frontend renders it as "new".
            change = None if previous in (None, 0) else round((amount - previous) / previous * 100, 1)
            buckets.append({"period": month, "amount": amount, "change_pct": change})
            previous = amount
        rows.append({
            "category_id": category.id,
            "name": category.name,
            "color": category.color,
            "icon": category.icon,
            "is_archived": category.is_archived,
            "total": round(sum(amounts.values()), 2),
            "buckets": buckets,
        })

    rows.sort(key=lambda r: r["total"], reverse=True)
    return {"months": months, "categories": rows}
