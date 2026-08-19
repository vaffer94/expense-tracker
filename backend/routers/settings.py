from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import Settings
from ..services import dashboard as svc

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=Settings)
def get_settings(db: Session = Depends(get_db)):
    return Settings(starting_balance=svc.starting_balance(db))


@router.put("", response_model=Settings)
def put_settings(payload: Settings, db: Session = Depends(get_db)):
    svc.set_starting_balance(db, payload.starting_balance)
    return payload
