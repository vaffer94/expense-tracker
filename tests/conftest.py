import os

os.environ.setdefault("APP_USER", "test")
os.environ.setdefault("APP_PASSWORD", "secret")
os.environ["DATABASE_URL"] = "sqlite://"  # in-memory

import pytest
from fastapi.testclient import TestClient

from backend.database import Base, engine
from backend.main import app

AUTH = ("test", "secret")


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        c.auth = AUTH
        yield c


@pytest.fixture
def category(client):
    def make(name="Groceries", kind="expense", icon="shopping-cart", color="#22c55e"):
        r = client.post("/api/categories", json={"name": name, "kind": kind, "icon": icon, "color": color})
        assert r.status_code == 201, r.text
        return r.json()
    return make


@pytest.fixture
def subcategory(client):
    def make(category_id, name="Rent"):
        r = client.post("/api/subcategories", json={"name": name, "category_id": category_id})
        assert r.status_code == 201, r.text
        return r.json()
    return make


@pytest.fixture
def transaction(client):
    def make(category_id, amount=10.0, type="expense", timestamp=None, notes=None, subcategory_id=None):
        body = {"type": type, "amount": amount, "category_id": category_id}
        if timestamp:
            body["timestamp"] = timestamp
        if notes:
            body["notes"] = notes
        if subcategory_id:
            body["subcategory_id"] = subcategory_id
        return client.post("/api/transactions", json=body)
    return make
