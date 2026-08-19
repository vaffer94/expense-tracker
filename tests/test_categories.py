def test_requires_auth(client):
    client.auth = None
    assert client.get("/api/categories").status_code == 401
    assert client.get("/").status_code == 401


def test_create_and_list(client, category):
    category("Groceries")
    category("Salary", kind="income", icon="wallet", color="#3b82f6")
    expenses = client.get("/api/categories", params={"kind": "expense"}).json()
    assert [c["name"] for c in expenses] == ["Groceries"]


def test_bad_color_and_icon_rejected(client):
    base = {"name": "X", "kind": "expense", "icon": "shopping-cart", "color": "#123456"}
    assert client.post("/api/categories", json=base).status_code == 422
    assert client.post("/api/categories", json={**base, "color": "#22c55e", "icon": "nope"}).status_code == 422


def test_duplicate_live_name_conflicts(client, category):
    category("Groceries")
    r = client.post("/api/categories", json={
        "name": "Groceries", "kind": "expense", "icon": "shopping-cart", "color": "#22c55e"})
    assert r.status_code == 409
    # same name is fine on the other kind
    assert client.post("/api/categories", json={
        "name": "Groceries", "kind": "income", "icon": "wallet", "color": "#22c55e"}).status_code == 201


def test_duplicate_allowed_once_archived(client, category):
    first = category("Groceries")
    assert client.delete(f"/api/categories/{first['id']}").status_code == 204
    second = category("Groceries")
    assert second["id"] != first["id"]
    # restoring the archived one now collides
    assert client.patch(f"/api/categories/{first['id']}/restore").status_code == 409


def test_archive_is_idempotent_and_hides_from_picker(client, category):
    c = category("Fun", icon="music", color="#ec4899")
    assert client.delete(f"/api/categories/{c['id']}").status_code == 204
    assert client.delete(f"/api/categories/{c['id']}").status_code == 204
    assert client.get("/api/categories").json() == []
    assert len(client.get("/api/categories", params={"include_archived": True}).json()) == 1


def test_kind_is_immutable(client, category):
    c = category()
    assert client.patch(f"/api/categories/{c['id']}", json={"kind": "income"}).status_code == 422
    assert client.patch(f"/api/categories/{c['id']}", json={"name": "Food"}).json()["name"] == "Food"


def test_missing_category_404(client):
    assert client.patch("/api/categories/999", json={"name": "x"}).status_code == 404
    assert client.delete("/api/categories/999").status_code == 404
