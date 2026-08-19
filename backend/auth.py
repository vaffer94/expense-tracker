import base64
import binascii
import os
import secrets

from starlette.responses import JSONResponse

REALM = "Expense Tracker"
_UNAUTHORIZED = JSONResponse(
    {"detail": "Not authenticated"},
    status_code=401,
    headers={"WWW-Authenticate": f'Basic realm="{REALM}"'},
)


def credentials() -> tuple[str, str]:
    """Read credentials from the environment, refusing to run unprotected."""
    user, password = os.getenv("APP_USER"), os.getenv("APP_PASSWORD")
    if not user or not password:
        raise RuntimeError(
            "APP_USER and APP_PASSWORD must be set - refusing to start unprotected."
        )
    return user, password


async def basic_auth(request, call_next):
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "basic":
        return _UNAUTHORIZED
    try:
        user, _, password = base64.b64decode(token).decode("utf-8").partition(":")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return _UNAUTHORIZED
    want_user, want_password = credentials()
    ok_user = secrets.compare_digest(user, want_user)
    ok_password = secrets.compare_digest(password, want_password)
    if not (ok_user and ok_password):
        return _UNAUTHORIZED
    return await call_next(request)
