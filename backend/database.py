import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    DB_PATH = os.getenv("DB_PATH", "/app/data/expenses.db")
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    DB_URL = f"sqlite:///{DB_PATH}"

# An in-memory DB (tests) needs one shared connection or each session sees a fresh blank DB.
_in_memory = DB_URL in ("sqlite://", "sqlite:///") or ":memory:" in DB_URL
_pool = {"poolclass": StaticPool} if _in_memory else {}
engine = create_engine(DB_URL, connect_args={"check_same_thread": False}, **_pool)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(engine, "connect")
def _fk_on(conn, _):
    conn.execute("PRAGMA foreign_keys=ON")


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
