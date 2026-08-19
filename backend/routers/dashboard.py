import os
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import ByCategory, Kind, Summary, Trends
from ..services import dashboard as svc

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def range_params(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    tz: str = Query(...),
):
    # The browser supplies its own zone; a TZ env var on the server overrides it.
    return svc.resolve_range(from_, to, os.getenv("TZ") or tz)


@router.get("/summary", response_model=Summary)
def get_summary(rng=Depends(range_params), db: Session = Depends(get_db)):
    return svc.summary(db, rng[0], rng[1])


@router.get("/by-category", response_model=ByCategory)
def get_by_category(type: Kind, rng=Depends(range_params), db: Session = Depends(get_db)):
    return svc.by_category(db, rng[0], rng[1], type)


@router.get("/trends", response_model=Trends)
def get_trends(
    granularity: Literal["day", "week", "month"],
    rng=Depends(range_params),
    db: Session = Depends(get_db),
):
    return svc.trends(db, *rng, granularity)
