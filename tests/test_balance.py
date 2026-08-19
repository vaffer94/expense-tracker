ROME = {"tz": "Europe/Rome"}


def q(**kw):
    return {**ROME, **kw}


def test_settings_roundtrip(client):
    assert client.get("/api/settings").json() == {"starting_balance": 0.0}
    assert client.put("/api/settings", json={"starting_balance": 1000.50}).status_code == 200
    assert client.get("/api/settings").json()["starting_balance"] == 1000.50
    # starting in debt is a real state
    assert client.put("/api/settings", json={"starting_balance": -250.0}).status_code == 200
    assert client.get("/api/settings").json()["starting_balance"] == -250.0


def test_settings_validation(client):
    assert client.put("/api/settings", json={"starting_balance": 10.123}).status_code == 422
    assert client.put("/api/settings", json={"starting_balance": 5_000_000}).status_code == 422


def test_balance_starts_from_the_starting_balance(client, category, transaction):
    food = category("Food")
    client.put("/api/settings", json={"starting_balance": 1000.0})
    transaction(food["id"], amount=42.50, timestamp="2026-08-01T12:00:00+02:00")
    body = client.get("/api/dashboard/trends",
                      params=q(granularity="day", **{"from": "2026-08-01", "to": "2026-08-04"})).json()
    assert body["opening_balance"] == 1000.0
    assert [b["balance"] for b in body["buckets"]] == [957.5, 957.5, 957.5]


def test_opening_balance_includes_earlier_transactions(client, category, transaction):
    """A three-month window of a longer history must not start the line at zero."""
    food = category("Food")
    pay = category("Salary", kind="income", icon="wallet", color="#3b82f6")
    client.put("/api/settings", json={"starting_balance": 100.0})
    transaction(pay["id"], amount=500, type="income", timestamp="2026-05-01T12:00:00+02:00")
    transaction(food["id"], amount=200, timestamp="2026-06-01T12:00:00+02:00")
    transaction(food["id"], amount=50, timestamp="2026-08-02T12:00:00+02:00")

    body = client.get("/api/dashboard/trends",
                      params=q(granularity="day", **{"from": "2026-08-01", "to": "2026-08-04"})).json()
    assert body["opening_balance"] == 400.0                      # 100 + 500 - 200
    assert [b["balance"] for b in body["buckets"]] == [400.0, 350.0, 350.0]


def test_balance_is_granularity_independent(client, category, transaction):
    food = category("Food")
    client.put("/api/settings", json={"starting_balance": 500.0})
    transaction(food["id"], amount=30, timestamp="2026-07-05T12:00:00+02:00")
    transaction(food["id"], amount=20, timestamp="2026-08-05T12:00:00+02:00")
    rng = {"from": "2026-07-01", "to": "2026-09-01"}
    finals = {
        g: client.get("/api/dashboard/trends", params=q(granularity=g, **rng)).json()["buckets"][-1]["balance"]
        for g in ("day", "week", "month")
    }
    assert set(finals.values()) == {450.0}, finals


def test_monthly_comparison_dense_and_percentages(client, category, transaction):
    food = category("Food")
    home = category("Home", icon="house", color="#3b82f6")
    transaction(food["id"], amount=320, timestamp="2026-06-10T12:00:00+02:00")
    transaction(food["id"], amount=400, timestamp="2026-07-10T12:00:00+02:00")
    transaction(food["id"], amount=200, timestamp="2026-08-10T12:00:00+02:00")
    transaction(home["id"], amount=50, timestamp="2026-08-11T12:00:00+02:00")

    body = client.get("/api/dashboard/monthly-comparison",
                      params=q(**{"from": "2026-06-01", "to": "2026-09-01"})).json()
    assert body["months"] == ["2026-06", "2026-07", "2026-08"]

    rows = {r["name"]: r for r in body["categories"]}
    assert [b["amount"] for b in rows["Food"]["buckets"]] == [320.0, 400.0, 200.0]
    assert [b["change_pct"] for b in rows["Food"]["buckets"]] == [None, 25.0, -50.0]
    assert rows["Food"]["total"] == 920.0

    # a category with nothing in the earlier months gets zero-filled buckets, not missing ones
    assert [b["amount"] for b in rows["Home"]["buckets"]] == [0.0, 0.0, 50.0]
    assert [b["change_pct"] for b in rows["Home"]["buckets"]] == [None, None, None]


def test_monthly_comparison_sorted_and_typed(client, category, transaction):
    food = category("Food")
    home = category("Home", icon="house", color="#3b82f6")
    pay = category("Salary", kind="income", icon="wallet", color="#22c55e")
    transaction(food["id"], amount=10, timestamp="2026-08-10T12:00:00+02:00")
    transaction(home["id"], amount=90, timestamp="2026-08-10T12:00:00+02:00")
    transaction(pay["id"], amount=999, type="income", timestamp="2026-08-10T12:00:00+02:00")

    rng = {"from": "2026-08-01", "to": "2026-09-01"}
    expenses = client.get("/api/dashboard/monthly-comparison", params=q(**rng)).json()
    assert [r["name"] for r in expenses["categories"]] == ["Home", "Food"]

    income = client.get("/api/dashboard/monthly-comparison", params=q(type="income", **rng)).json()
    assert [r["name"] for r in income["categories"]] == ["Salary"]


def test_archived_category_still_compared(client, category, transaction):
    fun = category("Fun", icon="music", color="#ec4899")
    transaction(fun["id"], amount=25, timestamp="2026-08-10T12:00:00+02:00")
    client.delete(f"/api/categories/{fun['id']}")
    body = client.get("/api/dashboard/monthly-comparison",
                      params=q(**{"from": "2026-08-01", "to": "2026-09-01"})).json()
    assert body["categories"][0]["name"] == "Fun" and body["categories"][0]["is_archived"] is True
