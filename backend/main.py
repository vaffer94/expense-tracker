from pathlib import Path

from fastapi import FastAPI
from fastapi.exception_handlers import http_exception_handler
from fastapi.staticfiles import StaticFiles

from . import models  # noqa: F401  (registers tables)
from .auth import basic_auth, credentials
from .database import Base, engine
from .routers import categories, dashboard, settings, subcategories, transactions

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


def create_app() -> FastAPI:
    credentials()  # fail fast rather than serve unprotected
    Base.metadata.create_all(engine)

    app = FastAPI(title="Expense Tracker", docs_url=None, redoc_url=None)
    app.middleware("http")(basic_auth)
    for router in (categories.router, subcategories.router, transactions.router,
                   dashboard.router, settings.router):
        app.include_router(router)
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
    return app


app = create_app()
