def test_amount_validation(client, category, transaction):
    c = category()
    assert transaction(c["id"], amount=0).status_code == 422
    assert transaction(c["id"], amount=-5).status_code == 422
    assert transaction(c["id"], amount=10.123).status_code == 422
    assert transaction(c["id"], amount=2_000_000).status_code == 422
    assert transaction(c["id"], amount=42.50).status_code == 201


def test_type_kind_mismatch_rejected(client, category, transaction):
    expense_cat = category()
    assert transaction(expense_cat["id"], type="income").status_code == 422


def test_archived_category_rejected(client, category, transaction):
    c = category()
    client.delete(f"/api/categories/{c['id']}")
    r = transaction(c["id"])
    assert r.status_code == 422
    assert "archived" in r.json()["detail"].lower()


def test_future_timestamp_rejected(client, category, transaction):
    c = category()
    assert transaction(c["id"], timestamp="2099-01-01T00:00:00+00:00").status_code == 422
    assert transaction(c["id"], timestamp="2020-01-01T00:00:00+00:00").status_code == 201


def test_embeds_category_and_sorts_desc(client, category, transaction):
    c = category()
    transaction(c["id"], amount=1, timestamp="2026-01-01T10:00:00+00:00")
    transaction(c["id"], amount=2, timestamp="2026-03-01T10:00:00+00:00")
    page = client.get("/api/transactions").json()
    assert page["total"] == 2
    assert [i["amount"] for i in page["items"]] == [2.0, 1.0]
    assert page["items"][0]["category"]["icon"] == "shopping-cart"


def test_patch_and_delete(client, category, transaction):
    c = category()
    tid = transaction(c["id"], amount=10).json()["id"]
    assert client.patch(f"/api/transactions/{tid}", json={"type": "income"}).status_code == 422
    assert client.patch(f"/api/transactions/{tid}", json={"amount": 12.5}).json()["amount"] == 12.5
    assert client.patch(f"/api/transactions/{tid}", json={"notes": None}).status_code == 200
    assert client.delete(f"/api/transactions/{tid}").status_code == 204
    assert client.delete(f"/api/transactions/{tid}").status_code == 404


def test_filters_and_pagination(client, category, transaction):
    c = category()
    for day in range(1, 6):
        transaction(c["id"], amount=day, timestamp=f"2026-05-0{day}T12:00:00+00:00")
    page = client.get("/api/transactions", params={"from": "2026-05-03", "limit": 2}).json()
    assert page["total"] == 3 and len(page["items"]) == 2
