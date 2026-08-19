from pathlib import Path

from fastapi import FastAPI
from fastapi.exception_handlers import http_exception_handler
from fastapi.staticfiles import StaticFiles

from . import models  # noqa: F401  (registers tables)
from .auth import basic_auth, credentials
from .database import Base, engine
from .routers import categories, dashboard, settings, subcategories, transactions

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


class NoCacheStatic(StaticFiles):
    """Serve the frontend with revalidation instead of blind caching.

    Everything here ships inside the image, so a deploy changes files under paths that never
    change. Without this the browser keeps serving the old app after an update, and a stale icon
    sprite renders newly added icons as nothing at all - silently, with no broken-image marker.
    "no-cache" still stores the file; it just asks the server first, and the ETag makes that a 304.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


def create_app() -> FastAPI:
    credentials()  # fail fast rather than serve unprotected
    Base.metadata.create_all(engine)

    app = FastAPI(title="Expense Tracker", docs_url=None, redoc_url=None)
    app.middleware("http")(basic_auth)
    for router in (categories.router, subcategories.router, transactions.router,
                   dashboard.router, settings.router):
        app.include_router(router)
    app.mount("/", NoCacheStatic(directory=FRONTEND, html=True), name="frontend")
    return app


app = create_app()
