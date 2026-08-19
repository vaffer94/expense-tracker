# Expense Tracker — Implementation Spec

Build a personal expense/income tracker. Developed on macOS, deployed to a Raspberry Pi via Docker. Single user. Mobile-first web app accessed from a phone browser on the local network. NFC tags act as physical shortcuts into the "add expense" flow.

This spec is the source of truth. Where it is silent, prefer the simplest thing that works.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn |
| ORM | SQLAlchemy 2.x (declarative) |
| Migrations | None. Create tables on startup via `Base.metadata.create_all` |
| DB | SQLite, file at `/app/data/expenses.db` |
| Frontend | Static HTML + CSS + vanilla ES modules. No build step, no bundler |
| Charts | Chart.js v4 (vendored locally in `frontend/vendor/`, not CDN — the Pi may be offline) |
| Icons | Lucide, vendored locally as an SVG sprite |
| Auth | HTTP Basic Auth |
| Container | Docker, multi-arch (`linux/amd64` for Mac dev, `linux/arm64` for Pi) |

The FastAPI app serves the frontend as static files. One container, one port, no separate web server.

---

## 2. Data model

### `categories`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `name` | TEXT NOT NULL | |
| `kind` | TEXT NOT NULL | `"expense"` or `"income"` |
| `icon` | TEXT NOT NULL | Lucide icon name, e.g. `"shopping-cart"` |
| `color` | TEXT NOT NULL | hex, must be one of the fixed palette |
| `is_archived` | BOOLEAN NOT NULL | default `false` |
| `created_at` | DATETIME NOT NULL | UTC, server-set |

- Unique constraint on `(name, kind)` **among non-archived rows only** (partial unique index). Archiving a category frees its name for reuse.
- Expense and income categories are **separate lists**. A category is only ever offered in the picker matching its `kind`.

### `transactions`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `type` | TEXT NOT NULL | `"expense"` or `"income"` |
| `amount` | REAL NOT NULL | always stored **positive**; `type` carries the sign |
| `category_id` | INTEGER NOT NULL FK | → `categories.id`, `ON DELETE RESTRICT` |
| `timestamp` | DATETIME NOT NULL | when the transaction happened; user-editable |
| `notes` | TEXT NULL | optional |
| `created_at` | DATETIME NOT NULL | UTC, server-set, never editable |

- Index on `timestamp` (all dashboard queries filter by date range).
- Index on `category_id`.
- Invariant: `transaction.type` must equal `category.kind` of the referenced category. Enforce in the service layer; reject with 422 on mismatch.

### Time handling

Store all datetimes in **UTC**. The API accepts and returns ISO-8601 with offset. The frontend converts to local time for display and sends local-time-with-offset on write. Month boundaries for the dashboard are computed in the **user's local timezone**, passed as an IANA tz string (e.g. `Europe/Rome`) — default it from the browser, allow override via the `TZ` env var.

### Seed data

None. The database starts empty. The frontend must handle the empty state (see §5.1).

---

## 3. Color palette

Categories pick from exactly these ten. Reject anything else with 422.

```
#ef4444  red
#f97316  orange
#f59e0b  amber
#84cc16  lime
#22c55e  green
#06b6d4  cyan
#3b82f6  blue
#8b5cf6  violet
#ec4899  pink
#78716c  stone
```

---

## 4. API

All routes under `/api`. All require Basic Auth (§7). All responses JSON.

### Error format

Every 4xx/5xx returns:

```json
{ "detail": "Human-readable message" }
```

FastAPI's default validation errors are acceptable for 422.

### 4.1 Categories

**`GET /api/categories`**

Query params:
- `kind` — optional, `expense` | `income`. Filters.
- `include_archived` — optional bool, default `false`.

Response `200`:
```json
[
  {
    "id": 1,
    "name": "Groceries",
    "kind": "expense",
    "icon": "shopping-cart",
    "color": "#22c55e",
    "is_archived": false,
    "created_at": "2026-08-18T09:00:00Z"
  }
]
```

Sorted by `name` ascending.

**`POST /api/categories`**

Body:
```json
{ "name": "Groceries", "kind": "expense", "icon": "shopping-cart", "color": "#22c55e" }
```

Validation:
- `name`: 1–40 chars after trimming, non-empty
- `kind`: must be `expense` or `income`
- `icon`: must be in the vendored Lucide set
- `color`: must be in the palette
- duplicate `(name, kind)` among non-archived → `409`

Response `201`: the created category object.

**`PATCH /api/categories/{id}`**

Body: any subset of `name`, `icon`, `color`. **`kind` is immutable** — attempting to change it returns `422`. Renaming does not affect existing transactions.

Response `200`: updated object. `404` if not found.

**`DELETE /api/categories/{id}`**

Soft-delete: sets `is_archived = true`. Never removes the row, never touches transactions. History and past charts remain intact and correctly colored.

Response `204`. `404` if not found. Deleting an already-archived category is idempotent → `204`.

Archived categories:
- do not appear in the category picker
- still appear in dashboard breakdowns and the transaction list, rendered normally
- can be un-archived via `PATCH /api/categories/{id}/restore` → `200`. If a live category now holds that `(name, kind)`, return `409`.

### 4.2 Transactions

**`GET /api/transactions`**

Query params:
- `from` — ISO date/datetime, inclusive. Optional.
- `to` — ISO date/datetime, exclusive. Optional.
- `type` — `expense` | `income`. Optional.
- `category_id` — int. Optional.
- `limit` — int, default 50, max 200
- `offset` — int, default 0

Response `200`:
```json
{
  "items": [
    {
      "id": 12,
      "type": "expense",
      "amount": 42.50,
      "category": {
        "id": 1, "name": "Groceries", "icon": "shopping-cart",
        "color": "#22c55e", "is_archived": false
      },
      "timestamp": "2026-08-18T14:30:00+02:00",
      "notes": "weekly shop",
      "created_at": "2026-08-18T12:30:00Z"
    }
  ],
  "total": 137
}
```

Sorted by `timestamp` **descending**, tie-broken by `id` descending. Category is embedded, not just an ID — the list needs icon and color to render.

**`POST /api/transactions`**

Body:
```json
{
  "type": "expense",
  "amount": 42.50,
  "category_id": 1,
  "timestamp": "2026-08-18T14:30:00+02:00",
  "notes": "weekly shop"
}
```

Validation:
- `amount`: `> 0`, max 2 decimal places, max 1_000_000. Zero and negative → `422`
- `category_id`: must exist. Archived category → `422` ("cannot log to an archived category")
- `type` must match the category's `kind` → else `422`
- `timestamp`: optional; defaults to server now. May be in the past. **Future timestamps beyond 24h ahead → `422`** (guards against typos in the year field)
- `notes`: optional, max 500 chars

Response `201`: the created transaction, in the same embedded shape as `GET`.

**`PATCH /api/transactions/{id}`**

Body: any subset of `amount`, `category_id`, `timestamp`, `notes`. Same validation as POST. `type` is immutable — to change an expense into an income, delete and re-create.

Response `200`. `404` if not found.

**`DELETE /api/transactions/{id}`**

Hard delete. Response `204`. `404` if not found.

### 4.3 Dashboard

All three accept `from`, `to` (required) and `tz` (IANA string, required).

**`GET /api/dashboard/summary`**

```json
{
  "total_income": 2000.00,
  "total_expense": 445.30,
  "net": 1554.70,
  "transaction_count": 23
}
```

**`GET /api/dashboard/by-category`**

Query param `type` — `expense` | `income`, required.

```json
{
  "total": 445.30,
  "slices": [
    {
      "category_id": 1, "name": "Groceries", "color": "#22c55e",
      "icon": "shopping-cart", "is_archived": false,
      "amount": 320.00, "percentage": 71.9
    }
  ]
}
```

Sorted by `amount` descending. Categories with zero transactions in range are omitted. Percentages rounded to 1 decimal; they may not sum to exactly 100 — the frontend must not assume they do.

**`GET /api/dashboard/trends`**

Query param `granularity` — `day` | `week` | `month`. Required.

```json
{
  "granularity": "day",
  "buckets": [
    { "period": "2026-08-01", "income": 0.00, "expense": 42.50 },
    { "period": "2026-08-02", "income": 2000.00, "expense": 0.00 }
  ]
}
```

**Buckets must be dense** — emit a zero-filled bucket for every period in the range, including those with no transactions. A sparse series produces a misleading chart. Bucket boundaries computed in `tz`, not UTC.

`period` format: `YYYY-MM-DD` for day and week (week = its Monday), `YYYY-MM` for month.

---

## 5. Frontend

Mobile-first. Design target: a 390×844 viewport. It should be usable at desktop widths but need not be beautiful there — center the content in a max-width column.

Two top-level views: **Home** and **Trends**. No router library; a simple hash-based toggle (`#/` and `#/trends`) is enough so the back button works.

### 5.1 Home view

Vertical scroll, single column:

1. **Header** — current period label, e.g. "August 2026", with `‹` `›` chevrons to step months. Defaults to the current calendar month.
2. **Summary strip** — three figures: income, expenses, net. Net is green when positive, red when negative.
3. **Pie chart** — expenses by category for the selected month. Slice colors come from the category color. Tapping a slice filters the transaction list below to that category; tapping again clears. A legend below the chart shows name, amount, and percentage.
4. **Transaction list** — all transactions in the selected month, newest first. Each row: category icon in a colored circle, category name, notes preview (truncated), amount (prefixed `−` for expense, `+` for income, colored red/green), and time.
5. **Bottom bar** — fixed, always visible, safe-area padded:
   - left: smaller "Income" button (green, plus icon)
   - center: large circular "+" button (blue) — add expense
   - right: "Trends" tab button

**Empty states.** Both must be handled explicitly:
- *No categories yet* — replace the chart with a prompt: "Create your first category to get started", with a button opening the new-category form directly. The + button still works; it opens the sheet, which itself shows the empty picker with only "Add new category".
- *Categories exist but no transactions this month* — chart area shows "No spending recorded in August", list shows "Nothing here yet".

**Pagination.** Load the first 50, then infinite-scroll further pages via `offset`. A month rarely exceeds this, but do not assume it.

### 5.2 Add / edit transaction sheet

A bottom sheet sliding up over a dimmed backdrop. Dismiss by backdrop tap, swipe-down, or a cancel button. Dismissing with unsaved input shows a confirm prompt.

Fields, top to bottom:
1. **Amount** — numeric input, `inputmode="decimal"`, large type. Accepts both `.` and `,` as decimal separator (Italian keyboards). Currency symbol € shown as a static prefix.
2. **Category** — a row showing the selected category's icon, color, and name (or "Select category"). Tapping opens the picker (§5.3).
3. **Date & time** — pre-filled with now, in local time. Tapping opens a native `datetime-local` input.
4. **Notes** — single-line text input, optional.

Primary button: "Save expense" / "Save income". Disabled until amount > 0 and a category is selected.

In **edit** mode the sheet is pre-filled, the title reads "Edit expense", and the category picker only offers categories of the same `kind`.

### 5.3 Category picker

Full-height sheet layered over the transaction sheet. Shows only non-archived categories matching the current `kind`. Each row: colored circle with Lucide icon, name. Tapping selects and returns.

Pinned at the bottom: **"+ Add new category"**. Tapping expands an inline form in place — no navigation away:
- name text input
- icon grid — a scrollable grid of Lucide icons, ~60 curated options, single-select
- color row — the ten palette swatches, single-select
- "Create" button

On create, the category is saved, immediately selected for the current transaction, and the picker closes. The `kind` is inherited from whichever flow is open — it is not a user choice here.

**Managing categories.** Long-press (or a small pencil affordance) on a category row in the picker reveals rename / recolor / re-icon / archive. Archiving asks for confirmation and explains that past transactions are kept.

### 5.4 Transaction interactions

- **Tap a row** → opens the sheet in edit mode
- **Swipe left on a row** → reveals a red delete action; tapping it deletes after a confirm. Support touch swipe; on desktop, a delete button appears on hover.

Both operations refresh the chart and summary optimistically, reverting on API error with a toast.

### 5.5 Trends view

1. **Time filter** — segmented control: `1M` / `3M` / `1Y`. Maps to granularity `day` / `week` / `month` respectively.
2. **Line chart** — two series, income (green `#22c55e`) and expenses (red `#ef4444`), over the selected range. Points labelled on tap.
3. **Category breakdown** — below the chart, a list of expense categories for the range with a horizontal bar proportional to the largest, showing name, icon, color, and total.

Back to Home via the bottom bar.

### 5.6 General

- All API errors surface as a toast; never fail silently.
- A brief skeleton or spinner while fetching; the app must not flash empty content.
- Amounts formatted with `Intl.NumberFormat` using the browser locale, EUR currency.
- Add a web app manifest and appropriate meta tags so it can be added to the iOS/Android home screen and open without browser chrome.

---

## 6. NFC integration

Each physical tag stores a URL:

```
http://<pi-host>:8000/?add=expense&category=<category_id>
```

On load, if `add` and `category` are both present and valid:
1. open the add-transaction sheet immediately, in the mode given by `add`
2. pre-select the given category
3. **autofocus the amount field** so the keyboard is already up

Then `history.replaceState` to strip the query params, so a refresh or back-navigation doesn't re-trigger the sheet.

If the category ID does not exist or is archived, open the sheet anyway with no category pre-selected and show a toast: "That category no longer exists."

**Writing the tags requires knowing the IDs.** Since the app seeds no categories, add a small **Settings → NFC tags** screen listing every non-archived category with its ID and the full URL to write, plus a copy button. This is the only way the user can set the tags up.

---

## 7. Authentication

HTTP Basic Auth on every route including static files. Credentials from env vars `APP_USER` and `APP_PASSWORD`.

- Compare with `secrets.compare_digest` — not `==`.
- If either env var is unset, refuse to start with a clear error rather than running unprotected.
- The realm is `Expense Tracker`; the browser will remember credentials, so this is a one-time prompt per device.

This is deliberately minimal — it is intended for a LAN-only deployment. Do not expose the port to the internet without putting a reverse proxy with TLS in front.

---

## 8. Project layout

```
expense-tracker/
├── backend/
│   ├── main.py              # app factory, static mount, auth dependency
│   ├── database.py          # engine, session, create_all
│   ├── models.py            # SQLAlchemy models
│   ├── schemas.py           # Pydantic request/response models
│   ├── auth.py              # Basic Auth dependency
│   ├── routers/
│   │   ├── categories.py
│   │   ├── transactions.py
│   │   └── dashboard.py
│   └── services/
│       └── dashboard.py     # bucketing, tz-aware aggregation
├── frontend/
│   ├── index.html
│   ├── manifest.json
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js           # view routing, init, NFC param handling
│   │   ├── api.js           # fetch wrappers
│   │   ├── home.js
│   │   ├── trends.js
│   │   ├── sheet.js         # add/edit transaction
│   │   ├── categories.js    # picker + inline create + manage
│   │   └── settings.js      # NFC tag URLs
│   └── vendor/
│       ├── chart.umd.js
│       └── lucide-sprite.svg
├── tests/
│   ├── test_categories.py
│   ├── test_transactions.py
│   └── test_dashboard.py
├── data/                    # SQLite lives here; gitignored, mounted volume
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 9. Docker

**Dockerfile** — single stage from `python:3.11-slim`. Install deps from `requirements.txt` first (layer caching), then copy source. Create `/app/data`. Run as a non-root user. `EXPOSE 8000`. `CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]`.

Do not pin a platform inside the Dockerfile — keep it arch-agnostic so the same file builds natively on both machines.

**docker-compose.yml** — one service, port `8000:8000`, `./data:/app/data` volume, `env_file: .env`, `restart: unless-stopped`.

**Mac dev:**
```bash
docker compose up --build
```

**Pi deploy:** build on the Pi directly (simplest, no registry needed):
```bash
docker compose up -d --build
```

The README should document both, plus how to find the Pi's LAN IP for the NFC tag URLs.

---

## 10. Tests

Pytest with FastAPI's `TestClient` against an in-memory SQLite database. Not exhaustive — cover the logic that is easy to get wrong:

- amount ≤ 0 rejected; > 2 decimals rejected
- `type` / `kind` mismatch rejected
- logging to an archived category rejected
- archiving a category leaves its transactions intact and still visible in `by-category`
- duplicate name allowed if the existing one is archived
- `trends` emits dense zero-filled buckets across a gap
- `trends` and `summary` bucket by the supplied `tz`, not UTC — test with a transaction near local midnight
- percentages in `by-category` handle a single-category total (100.0) and an empty range (empty slices, total 0)
- unauthenticated request returns 401

---

## 11. Acceptance criteria — Milestone 1

Done when all of the following hold:

- [ ] `docker compose up` on a clean checkout starts the app; visiting the host prompts for Basic Auth
- [ ] With an empty DB, the home view shows the "create your first category" prompt without errors
- [ ] A category can be created from inside the add-expense flow and is immediately selectable
- [ ] An expense saves and appears at once in the list, pie chart, and summary
- [ ] Income uses its own separate category list
- [ ] Tapping a transaction edits it; swiping deletes it after confirmation
- [ ] Month chevrons move the whole home view — summary, chart, and list — between months
- [ ] Trends renders all three ranges with dense buckets and no gaps in the line
- [ ] Archiving a category removes it from the picker but leaves past transactions and chart slices intact
- [ ] Settings lists each category's NFC URL with a copy button
- [ ] Opening `/?add=expense&category=<id>` opens the sheet with that category selected and the amount field focused; the URL is then cleaned
- [ ] Data survives `docker compose down && docker compose up`
- [ ] `pytest` passes

---

## 12. Out of scope for Milestone 1

Do not build these; do not add hooks or abstractions for them either. Milestone 2 will handle them.

- Local LLM integration and any chat interface
- Budgets, limits, or alerts
- CSV / JSON export
- Telegram notifications
- Multi-user or multi-currency support
- Recurring transactions
