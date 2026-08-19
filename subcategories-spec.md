# Subcategories — Implementation Spec (Milestone 4)

Adds a second level to categorisation: every category may own many subcategories.
"Home" splits into rent, bills, fixing; "Food" into groceries, restaurants, and so on.

This spec extends [expense-tracker-spec.md](expense-tracker-spec.md); where it is silent, that
document still applies. Where it is silent too, prefer the simplest thing that works.

**Prerequisite:** the database is wiped before this ships (`docker compose down -v` on the Pi).
All data logged so far is test data. No migration is written.

---

## 1. Decisions already taken

| Question | Decision |
|---|---|
| Do subcategories have their own icon and colour? | **No.** A subcategory is a name. It inherits its parent's icon and colour. |
| What happens to history when a subcategory is re-parented? | **Nothing.** A transaction records both its category and its subcategory as they were when logged. Past charts never change shape. |
| Where is the subcategory chosen? | **Same screen**, appearing below the category grid once a category is picked. |
| Can NFC tags select a subcategory? | **No.** Tags carry a category only, as today. |

---

## 2. Data model

### `subcategories`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `name` | TEXT NOT NULL | 1–40 chars after trimming |
| `category_id` | INTEGER NOT NULL FK | → `categories.id`, `ON DELETE RESTRICT` |
| `is_archived` | BOOLEAN NOT NULL | default `false` |
| `created_at` | DATETIME NOT NULL | UTC, server-set |

- Unique constraint on `(name, category_id)` **among non-archived rows only**, mirroring categories.
  The same name may exist under two different parents — "Bills" under both "Home" and "Office" is
  legitimate and must be allowed.
- A subcategory has no `kind` of its own. Its kind is its parent's.
- No `icon`, no `colour`. Deliberately: they are inherited, so there is nothing to keep in sync.

### `transactions` — one new column

| Column | Type | Notes |
|---|---|---|
| `subcategory_id` | INTEGER NULL FK | → `subcategories.id`, `ON DELETE RESTRICT` |

`category_id` stays exactly as it is. **Both are stored**, and that redundancy is the point: it is
what freezes history. Move "Rent" from "Home" to "Fixed costs" and January's transaction still
reports "Home", because January's row recorded "Home" at the time.

### Invariants

- On **write** (`POST`, `PATCH`), if `subcategory_id` is given, the subcategory must belong to the
  category named in the same request, and must not be archived. Mismatch → `422`.
- On **read**, no such check is ever applied. Rows whose subcategory has since moved to another
  parent are correct data, not corruption. This is the one place where the two columns may
  legitimately disagree, and nothing in the system may try to "repair" it.

---

## 3. API

### 3.1 Categories carry their subcategories

`GET /api/categories` gains a `subcategories` array on each category, so the add-transaction sheet
can render the whole picker from a single request:

```json
{
  "id": 1, "name": "Home", "kind": "expense", "icon": "house", "color": "#3b82f6",
  "is_archived": false, "created_at": "2026-08-18T09:00:00Z",
  "subcategories": [
    { "id": 4, "name": "Bills", "is_archived": false },
    { "id": 3, "name": "Rent", "is_archived": false }
  ]
}
```

Sorted by `name` ascending. Archived subcategories are included only when `include_archived=true`.

### 3.2 Subcategory endpoints

**`POST /api/subcategories`** — body `{ "name": "Rent", "category_id": 1 }`.
Validation: name 1–40 chars trimmed; category must exist and not be archived; duplicate
`(name, category_id)` among non-archived → `409`. Response `201`.

**`PATCH /api/subcategories/{id}`** — body: any subset of `name`, `category_id`.
Changing `category_id` re-parents it. **The new parent must have the same `kind` as the old one**
→ else `422`. Duplicate name under the new parent → `409`. Response `200`, `404` if not found.

**`DELETE /api/subcategories/{id}`** — soft-delete, sets `is_archived = true`. `204`, idempotent.
Never touches transactions.

**`PATCH /api/subcategories/{id}/restore`** — `200`; `409` if a live sibling now holds the name.

Archiving a **category** does not archive its subcategories, and does not need to: the category
itself disappears from the picker, so its children are unreachable anyway.

### 3.3 Transactions

`POST` and `PATCH` accept an optional `subcategory_id`. Sending `null` on `PATCH` clears it.

Responses embed the subcategory as it was recorded, or `null`:

```json
{
  "id": 12, "type": "expense", "amount": 42.50,
  "category": { "id": 1, "name": "Home", "icon": "house", "color": "#3b82f6", "is_archived": false },
  "subcategory": { "id": 3, "name": "Rent", "is_archived": false },
  "timestamp": "2026-08-18T14:30:00Z", "notes": null, "created_at": "2026-08-18T12:30:00Z"
}
```

`GET /api/transactions` gains an optional `subcategory_id` filter.

### 3.4 Dashboard

`GET /api/dashboard/by-category` gains **`group`** — `category` | `subcategory`, default
`category`. Existing behaviour is unchanged when the parameter is absent.

With `group=subcategory`, each slice is one subcategory:

```json
{
  "total": 445.30,
  "slices": [
    {
      "category_id": 1, "subcategory_id": 3,
      "name": "Home · Rent", "color": "#3b82f6", "icon": "house",
      "is_archived": false, "amount": 320.00, "percentage": 71.9
    }
  ]
}
```

- Transactions with no subcategory are grouped under their bare category, with
  `subcategory_id: null` and `name` set to the category name alone. They are **not** hidden and not
  lumped into a single "Other".
- Slices are grouped by the `(category_id, subcategory_id)` pair recorded on the transaction, so a
  re-parented subcategory does not retroactively move between slices.
- **Colour shading.** Each slice's colour is its parent's palette colour, lightened by its position
  within that parent's group, so one category stays visually one block. The backend computes the
  final hex and returns it in `color`; the frontend never derives colours. Cap the lightening so
  the last slice of a large group stays legible — after roughly six steps, stop lightening.

---

## 4. Frontend

### 4.1 Add / edit transaction sheet

The full-height category picker sheet is **removed**. Category selection moves inline, into the
transaction sheet itself, and the net result is one screen fewer than today.

Below the amount field:

1. **Category grid** — square tiles, three per row, each showing the category's Lucide icon in its
   colour above the category name. The selected tile is visibly active. The final tile is **`+`**,
   which expands the inline "new category" form already built (name, icon grid, colour swatches)
   without leaving the sheet.

   The grid shows **nine tiles** (three rows). If more categories exist, the ninth position becomes
   a **`…`** tile that expands the grid to show them all; the `+` tile then sits at the end of the
   expanded grid. Nine is the expected working set, and the date and notes fields must stay
   reachable without a long scroll.
2. **Subcategory row** — appears only once a category is selected, and only if that category has
   subcategories or the user taps to add one. Rendered as chips, all visible at once, no dropdown.
   Tapping selects; tapping the selected one clears it. A trailing **`+`** chip opens a single
   name field to create one inline, which is then selected. The new subcategory belongs to the
   currently selected category.
3. Date & time, notes, as today.

**Subcategories are optional.** Save is enabled by amount and category alone; the subcategory row
never blocks saving.

Changing the category after a subcategory was chosen **clears the subcategory**, since it belonged
to the previous parent.

In **edit** mode the sheet pre-selects both. If the transaction's subcategory has since been
re-parented away, it is still shown as selected — history is not silently rewritten — but changing
the category clears it as usual.

### 4.2 Home pie chart

A small segmented control on the chart card: **Categories | Subcategories**. It switches the
`group` parameter and re-renders chart and legend. The choice persists for the session; it does not
need to survive a reload.

Tapping a slice filters the transaction list as it does today — by category in category view, by
subcategory in subcategory view.

Transaction rows show the subcategory as part of the existing subtitle line, before the notes:
`Rent · weekly bill · 14:30`.

The Trends view keeps no such toggle — see
[balance-and-trends-spec.md](balance-and-trends-spec.md).

### 4.3 Settings

Settings becomes a small hub with two entries:

- **Categories** — the management screen. Lists categories grouped with their subcategories
  underneath. From here: rename / recolor / re-icon / archive a category, and add / rename /
  re-parent / archive a subcategory. Re-parenting offers only categories of the same kind.
  Archiving asks for confirmation and explains that past transactions are kept.
- **NFC tags** — unchanged.

Category management currently lives inside the picker sheet being deleted, so it moves here rather
than being written from scratch.

---

## 5. NFC

Unchanged. Tags carry `?add=expense&category=<id>`. The sheet opens with that category selected,
its subcategory chips visible and none selected, and the amount focused. Adding a subcategory is
one optional tap before saving.

---

## 6. Tests

Extending the existing suite:

- creating a subcategory under an archived category is rejected
- duplicate name under the same parent → `409`; the same name under a different parent → `201`
- re-parenting to a category of a different kind → `422`
- logging a transaction whose `subcategory_id` belongs to a different category → `422`
- logging to an archived subcategory → `422`
- **history freeze**: log a transaction, re-parent its subcategory, then confirm the transaction
  and `by-category` still report the original category
- `group=subcategory` puts transactions with no subcategory under their bare category name
- `group=subcategory` percentages sum consistently with `group=category` totals
- archiving a subcategory keeps its past transactions visible in the list and in both groupings

---

## 7. Acceptance criteria

- [ ] A category can be created from the grid's `+` tile without leaving the sheet
- [ ] A subcategory can be created from the `+` chip and is immediately selected
- [ ] Saving without a subcategory works and always did
- [ ] Changing the category clears a previously chosen subcategory
- [ ] The pie toggles between category and subcategory views, with shaded slices per parent
- [ ] Re-parenting a subcategory in Settings leaves past transactions and past chart slices exactly
      as they were
- [ ] Archiving a subcategory removes it from the chips but keeps its history
- [ ] An NFC tag still opens the sheet with its category selected and the amount focused
- [ ] `pytest` passes

---

## 8. Resolved

1. **The `+` chip for creating subcategories inline** — keep it. Subcategories can be created from
   the sheet as well as from Settings.
2. **Category grid size** — nine tiles, then a `…` tile to expand. See §4.1.
3. **Trends** gets no category/subcategory toggle. It is reworked separately, and more deeply, in
   [balance-and-trends-spec.md](balance-and-trends-spec.md).

## 9. Out of scope

Multiple accounts — deferred. The starting balance is built globally first, in
[balance-and-trends-spec.md](balance-and-trends-spec.md); when accounts arrive, that single value
moves onto the account. Everything already listed
as out of scope in the original spec remains so.
