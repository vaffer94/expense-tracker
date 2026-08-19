ROME = {"tz": "Europe/Rome"}


def q(**kw):
    return {**ROME, **kw}


def test_summary_and_net(client, category, transaction):
    food = category("Food")
    pay = category("Salary", kind="income", icon="wallet", color="#3b82f6")
    transaction(food["id"], amount=445.30, timestamp="2026-08-10T12:00:00+02:00")
    transaction(pay["id"], amount=2000, type="income", timestamp="2026-08-01T09:00:00+02:00")
    s = client.get("/api/dashboard/summary", params=q(**{"from": "2026-08-01", "to": "2026-09-01"})).json()
    assert s == {"total_income": 2000.0, "total_expense": 445.3, "net": 1554.7, "transaction_count": 2}


def test_summary_buckets_by_tz_not_utc(client, category, transaction):
    """23:30 local on Jul 31 in Rome is 21:30 UTC — it belongs to July, not August."""
    food = category("Food")
    transaction(food["id"], amount=10, timestamp="2026-07-31T23:30:00+02:00")
    july = q(**{"from": "2026-07-01", "to": "2026-08-01"})
    august = q(**{"from": "2026-08-01", "to": "2026-09-01"})
    assert client.get("/api/dashboard/summary", params=july).json()["transaction_count"] == 1
    assert client.get("/api/dashboard/summary", params=august).json()["transaction_count"] == 0


def test_by_category_single_and_empty(client, category, transaction):
    food = category("Food")
    transaction(food["id"], amount=25, timestamp="2026-08-10T12:00:00+02:00")
    params = q(type="expense", **{"from": "2026-08-01", "to": "2026-09-01"})
    body = client.get("/api/dashboard/by-category", params=params).json()
    assert body["total"] == 25.0
    assert body["slices"][0]["percentage"] == 100.0

    empty = client.get("/api/dashboard/by-category",
                       params=q(type="expense", **{"from": "2026-01-01", "to": "2026-02-01"})).json()
    assert empty == {"total": 0.0, "slices": []}


def test_by_category_sorted_and_keeps_archived(client, category, transaction):
    food = category("Food")
    fun = category("Fun", icon="music", color="#ec4899")
    transaction(food["id"], amount=10, timestamp="2026-08-10T12:00:00+02:00")
    transaction(fun["id"], amount=90, timestamp="2026-08-11T12:00:00+02:00")
    client.delete(f"/api/categories/{fun['id']}")

    params = q(type="expense", **{"from": "2026-08-01", "to": "2026-09-01"})
    slices = client.get("/api/dashboard/by-category", params=params).json()["slices"]
    assert [s["name"] for s in slices] == ["Fun", "Food"]
    assert slices[0]["is_archived"] is True and slices[0]["color"] == "#ec4899"
    # the transaction itself is untouched and still listed
    assert client.get("/api/transactions").json()["total"] == 2


def test_trends_dense_buckets_across_a_gap(client, category, transaction):
    food = category("Food")
    transaction(food["id"], amount=5, timestamp="2026-08-01T12:00:00+02:00")
    transaction(food["id"], amount=7, timestamp="2026-08-05T12:00:00+02:00")
    body = client.get("/api/dashboard/trends",
                      params=q(granularity="day", **{"from": "2026-08-01", "to": "2026-08-06"})).json()
    assert [b["period"] for b in body["buckets"]] == [f"2026-08-0{d}" for d in range(1, 6)]
    assert [b["expense"] for b in body["buckets"]] == [5.0, 0.0, 0.0, 0.0, 7.0]


def test_trends_week_and_month_periods(client, category, transaction):
    food = category("Food")
    transaction(food["id"], amount=5, timestamp="2026-08-12T12:00:00+02:00")
    weeks = client.get("/api/dashboard/trends",
                       params=q(granularity="week", **{"from": "2026-08-01", "to": "2026-08-20"})).json()
    assert weeks["buckets"][0]["period"] == "2026-07-27"  # the Monday of the week holding Aug 1
    assert any(b["period"] == "2026-08-10" and b["expense"] == 5.0 for b in weeks["buckets"])

    months = client.get("/api/dashboard/trends",
                        params=q(granularity="month", **{"from": "2026-06-15", "to": "2026-09-01"})).json()
    assert [b["period"] for b in months["buckets"]] == ["2026-06", "2026-07", "2026-08"]


def test_trends_buckets_by_tz_not_utc(client, category, transaction):
    food = category("Food")
    transaction(food["id"], amount=8, timestamp="2026-08-02T00:30:00+02:00")  # 2026-08-01T22:30Z
    buckets = client.get("/api/dashboard/trends",
                         params=q(granularity="day", **{"from": "2026-08-01", "to": "2026-08-04"})).json()["buckets"]
    assert {b["period"]: b["expense"] for b in buckets} == {"2026-08-01": 0.0, "2026-08-02": 8.0, "2026-08-03": 0.0}


def test_bad_timezone_rejected(client):
    r = client.get("/api/dashboard/summary", params={"from": "2026-08-01", "to": "2026-09-01", "tz": "Mars/Olympus"})
    assert r.status_code == 422
