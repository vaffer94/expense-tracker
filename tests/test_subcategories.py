ROME = {"tz": "Europe/Rome", "from": "2026-08-01", "to": "2026-09-01"}
AUG = "2026-08-10T12:00:00+02:00"


def test_create_and_embed_in_category(client, category, subcategory):
    home = category("Home", icon="house", color="#3b82f6")
    subcategory(home["id"], "Rent")
    subcategory(home["id"], "Bills")
    body = client.get("/api/categories").json()
    assert [s["name"] for s in body[0]["subcategories"]] == ["Bills", "Rent"]


def test_duplicate_name_per_parent(client, category, subcategory):
    home = category("Home", icon="house", color="#3b82f6")
    office = category("Office", icon="briefcase", color="#8b5cf6")
    subcategory(home["id"], "Bills")
    assert client.post("/api/subcategories", json={"name": "Bills", "category_id": home["id"]}).status_code == 409
    # the same name under a different parent is legitimate
    assert client.post("/api/subcategories", json={"name": "Bills", "category_id": office["id"]}).status_code == 201


def test_cannot_add_to_archived_category(client, category):
    home = category("Home", icon="house", color="#3b82f6")
    client.delete(f"/api/categories/{home['id']}")
    assert client.post("/api/subcategories", json={"name": "Rent", "category_id": home["id"]}).status_code == 422


def test_reparenting_across_kinds_rejected(client, category, subcategory):
    home = category("Home", icon="house", color="#3b82f6")
    salary = category("Salary", kind="income", icon="wallet", color="#22c55e")
    rent = subcategory(home["id"], "Rent")
    r = client.patch(f"/api/subcategories/{rent['id']}", json={"category_id": salary["id"]})
    assert r.status_code == 422 and "income" in r.json()["detail"]


def test_transaction_subcategory_must_match_category(client, category, subcategory, transaction):
    home = category("Home", icon="house", color="#3b82f6")
    food = category("Food", icon="pizza", color="#f97316")
    rent = subcategory(home["id"], "Rent")
    r = transaction(food["id"], subcategory_id=rent["id"])
    assert r.status_code == 422
    assert transaction(home["id"], subcategory_id=rent["id"]).status_code == 201


def test_archived_subcategory_rejected(client, category, subcategory, transaction):
    home = category("Home", icon="house", color="#3b82f6")
    rent = subcategory(home["id"], "Rent")
    client.delete(f"/api/subcategories/{rent['id']}")
    r = transaction(home["id"], subcategory_id=rent["id"])
    assert r.status_code == 422 and "archived" in r.json()["detail"].lower()
    assert client.get("/api/categories").json()[0]["subcategories"] == []


def test_history_is_frozen_when_reparented(client, category, subcategory, transaction):
    home = category("Home", icon="house", color="#3b82f6")
    fixed = category("Fixed costs", icon="calendar", color="#78716c")
    rent = subcategory(home["id"], "Rent")
    transaction(home["id"], amount=500, timestamp=AUG, subcategory_id=rent["id"])

    assert client.patch(f"/api/subcategories/{rent['id']}", json={"category_id": fixed["id"]}).status_code == 200

    item = client.get("/api/transactions").json()["items"][0]
    assert item["category"]["name"] == "Home"          # not "Fixed costs"
    assert item["subcategory"]["name"] == "Rent"

    slices = client.get("/api/dashboard/by-category",
                        params={**ROME, "type": "expense", "group": "subcategory"}).json()["slices"]
    assert slices[0]["name"] == "Home · Rent"


def test_group_by_subcategory_keeps_bare_category(client, category, subcategory, transaction):
    home = category("Home", icon="house", color="#3b82f6")
    rent = subcategory(home["id"], "Rent")
    transaction(home["id"], amount=500, timestamp=AUG, subcategory_id=rent["id"])
    transaction(home["id"], amount=100, timestamp=AUG)          # no subcategory

    body = client.get("/api/dashboard/by-category",
                      params={**ROME, "type": "expense", "group": "subcategory"}).json()
    names = [s["name"] for s in body["slices"]]
    assert names == ["Home · Rent", "Home"]
    assert body["total"] == 600.0
    # shades of the same parent colour, not the same colour twice
    assert body["slices"][0]["color"] != body["slices"][1]["color"]

    grouped = client.get("/api/dashboard/by-category", params={**ROME, "type": "expense"}).json()
    assert len(grouped["slices"]) == 1 and grouped["total"] == 600.0


def test_type_all_mixes_both_kinds(client, category, transaction):
    food = category("Food", icon="pizza", color="#f97316")
    pay = category("Salary", kind="income", icon="wallet", color="#22c55e")
    transaction(food["id"], amount=40, timestamp=AUG)
    transaction(pay["id"], amount=60, type="income", timestamp=AUG)
    body = client.get("/api/dashboard/by-category", params={**ROME, "type": "all"}).json()
    assert body["total"] == 100.0
    assert {s["name"]: s["percentage"] for s in body["slices"]} == {"Salary": 60.0, "Food": 40.0}


def test_filter_transactions_by_subcategory(client, category, subcategory, transaction):
    home = category("Home", icon="house", color="#3b82f6")
    rent = subcategory(home["id"], "Rent")
    transaction(home["id"], amount=500, timestamp=AUG, subcategory_id=rent["id"])
    transaction(home["id"], amount=100, timestamp=AUG)
    assert client.get("/api/transactions", params={"subcategory_id": rent["id"]}).json()["total"] == 1


def test_patch_clears_subcategory(client, category, subcategory, transaction):
    home = category("Home", icon="house", color="#3b82f6")
    rent = subcategory(home["id"], "Rent")
    tid = transaction(home["id"], subcategory_id=rent["id"]).json()["id"]
    assert client.patch(f"/api/transactions/{tid}", json={"subcategory_id": None}).json()["subcategory"] is None
