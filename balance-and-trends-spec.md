# Starting balance & Trends rework — Implementation Spec (Milestone 5)

Two connected changes. The app records what you *spend*, but never what you *have*: there is no
balance concept anywhere in it today. This adds one, and reworks Trends from a chart that shows
flows into one that also shows the stock those flows accumulate into.

Extends [expense-tracker-spec.md](expense-tracker-spec.md). Ships alongside or after
[subcategories-spec.md](subcategories-spec.md); the two do not depend on each other.

---

## 1. Decisions already taken

| Question | Decision |
|---|---|
| How is the starting balance modelled? | **As a setting, not a transaction.** Nothing happened, no money moved — it is the number the running total starts from. It therefore never appears in any statistic and needs no exclusion flag. |
| What does the Home header show? | **This month's net** (income − expenses for that month), as a subtitle under the month name. The `NET` tile is removed from the summary strip, which drops to two tiles. |
| Where is the balance seen? | **Trends only**, as a running line over the selected period. |
| What does the Trends "total" line plot? | **Running balance** — starting balance plus everything logged up to each point, including transactions from before the selected period. |
| Multiple accounts? | Deferred. When they arrive, the single starting balance moves onto the account row. |

---

## 2. Data model

### `settings`

A key/value table, so that later settings never require a schema change:

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | e.g. `starting_balance` |
| `value` | TEXT NOT NULL | stored as text, parsed by the reader |

Only one key exists for now: `starting_balance`. Absent key means `0.0`.

Deliberately **not** a typed single-row table: adding a column to an existing table is the one
migration `create_all` cannot perform, and a key/value store never needs one.

### The starting balance has no date

It is an offset, not an event: "the money I had before I started tracking". It applies from the
beginning of time, so every running total simply begins from it. Nothing to validate against the
earliest transaction.

Validation: any value in `-1_000_000 … 1_000_000`, at most 2 decimal places. **Negative is
allowed** — starting in debt is a real state.

---

## 3. API

### 3.1 Settings

**`GET /api/settings`** → `{ "starting_balance": 1000.00 }`

**`PUT /api/settings`** — body `{ "starting_balance": 1000.00 }`. Response `200` with the stored
object. Partial updates are not needed; the whole object is small.

### 3.2 Trends gains a balance series

`GET /api/dashboard/trends` gains a `balance` field on every bucket:

```json
{
  "granularity": "day",
  "opening_balance": 1000.00,
  "buckets": [
    { "period": "2026-08-01", "income": 0.00, "expense": 42.50, "balance": 957.50 },
    { "period": "2026-08-02", "income": 2000.00, "expense": 0.00, "balance": 2957.50 }
  ]
}
```

- `opening_balance` is the balance immediately **before** the first bucket: the starting balance
  plus every transaction dated earlier than the range. This is what makes the line meaningful when
  you are looking at a three-month window of a two-year history.
- `balance` on each bucket is the running total at the **end** of that bucket.
- The series therefore requires a query over transactions *outside* the requested range. That is a
  single aggregate, not a full scan of the rows.
- Zero-filled buckets carry the balance forward unchanged, never a gap or a zero.

### 3.3 Monthly comparison

New: **`GET /api/dashboard/monthly-comparison`**

Query params: `from`, `to`, `tz` (as the other dashboard routes) and `type` — `expense` | `income`,
default `expense`.

```json
{
  "months": ["2026-06", "2026-07", "2026-08"],
  "categories": [
    {
      "category_id": 1, "name": "Home", "color": "#3b82f6", "icon": "house", "is_archived": false,
      "total": 920.00,
      "buckets": [
        { "period": "2026-06", "amount": 320.00, "change_pct": null },
        { "period": "2026-07", "amount": 400.00, "change_pct": 25.0 },
        { "period": "2026-08", "amount": 200.00, "change_pct": -50.0 }
      ]
    }
  ]
}
```

- Always bucketed by **calendar month** in `tz`, whatever granularity the Trends view is using.
- `months` is dense: every calendar month touched by the range appears, and every category carries
  a bucket for each, zero-filled.
- `change_pct` compares each month to **the month immediately before it**, within this response:
  `(amount − previous) / previous × 100`, rounded to 1 decimal.
- `change_pct` is `null` for the first month, and `null` when the previous month was `0` — a
  percentage change from zero is undefined. The frontend renders that case as "new" when the
  current amount is above zero, and as nothing at all when both are zero.
- Categories sorted by `total` descending. Categories with no activity in the whole range are
  omitted entirely.
- Grouped by the category recorded on the transaction, so archived categories still appear.

---

## 4. Frontend

### 4.1 Home

- **Header row** — the month name gains a subtitle: that month's net, formatted as currency and
  signed, green when positive and red when negative. It is the month's own income minus expenses,
  and has nothing to do with the starting balance.
- **Summary strip** — drops to two tiles, income and expenses. The `NET` tile is removed; the
  header subtitle replaces it.

Nothing else on Home changes.

### 4.2 Trends — line chart

The existing income and expense lines stay. A third line, **Total**, plots the running balance.

- Balance is plotted against a **second y-axis on the right**. It is typically an order of
  magnitude larger than per-bucket income and expenses, and on a shared axis it would flatten the
  other two lines into the floor. This is not cosmetic: on one axis the chart stops communicating.
- The balance line is visually distinct from the flow lines — heavier, and in a neutral colour
  rather than the green/red pair, so it does not read as a third category of money.
- Tapping still labels points; the tooltip shows all three.

### 4.3 Trends — monthly comparison

Below the line chart, replacing today's flat category breakdown list: **one row per category**,
scrolled vertically, each showing

- the category avatar and name on the left, and its total for the whole range on the right
- a small **bar per month**, drawn in the category's colour, heights relative to that category's
  own largest month — so each row is readable regardless of whether the category spends €20 or
  €2000
- under each bar, the month's short label and the `change_pct`, tinted red when spending rose and
  green when it fell (an expense increase is bad news, the inverse of the income convention)
- `null` change renders as "—", or as "new" when the previous month was zero and this one is not

Bars are plain CSS elements, not chart instances. One Chart.js instance per category row would be
a dozen canvases on a phone for no gain.

**When the range covers fewer than two calendar months** — the `1M` filter usually does — there is
nothing to compare. The section shows the single month's figures with no percentages, and a one
line note that a longer range is needed for comparison. It is not hidden: an empty-looking section
is more confusing than an explained one.

### 4.4 Settings

Gains a **Starting balance** field: a currency input, saved on blur or by an explicit Save, with a
one-line explanation ("money you already had before you started tracking; it shifts the Total line
in Trends and nothing else").

---

## 5. Tests

- setting and reading back a starting balance, including a negative one and zero
- more than 2 decimal places rejected
- absent setting reads as `0.0`
- `opening_balance` accounts for transactions dated before the range, not only the starting balance
- the balance series carries forward across zero-filled buckets
- the balance series is unaffected by which granularity is requested — the final bucket's balance is
  the same for `day`, `week` and `month` over the same range
- `monthly-comparison` emits dense months and zero-filled category buckets across a gap
- `change_pct` is `null` for the first month and when the previous month is zero
- `change_pct` is correct for a rise and for a fall
- a category archived mid-range still appears with its history intact

---

## 6. Acceptance criteria

- [ ] Setting a starting balance in Settings moves the Total line in Trends and changes nothing else
- [ ] The Home header shows the month's net, and the summary strip has two tiles
- [ ] Paging to a past month shows that month's net in the header
- [ ] The Trends chart shows three lines, with the balance on its own right-hand axis and the
      income and expense lines still legible
- [ ] The balance line is continuous across periods with no transactions
- [ ] The comparison section lists one row per category with a bar per month and a percentage
- [ ] A category that spent nothing in one month shows a zero bar, not a missing one
- [ ] The `1M` range explains why there is nothing to compare rather than showing an empty section
- [ ] `pytest` passes

---

## 7. Open questions

1. **Which `type` does the comparison show?** Specified as expenses by default, with `type` as a
   parameter. Should the UI expose a toggle to see income comparisons too, or is expenses enough?
2. **Does the comparison respect the pie's category/subcategory view?** Currently category-level
   only. Subcategory-level rows would multiply the row count considerably.
