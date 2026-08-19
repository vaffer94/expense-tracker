# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Weekly backups** — `scripts/backup.sh` snapshots the database to the SD card via cron, keeping
  a rolling set of 8. It copies the SQLite file rather than exporting rows, so it is independent of
  the schema and survives any future change to it. Setup and restore steps are in the README.

### Fixed

- The transaction sheet's Save button sat at the bottom, where the on-screen keyboard covers it —
  worst of all in the NFC flow, which opens with the amount field already focused. Save now lives
  in the sheet header, where no keyboard can reach it.

### Changed

- Pressing Enter in the transaction sheet saves, the same as tapping Save. The sheet is a real
  `<form>`, so this also means Enter does nothing while the entry is incomplete.

### Milestone 2 — access from outside the house

Infrastructure only. No application code changes are expected: Tailscale sits outside the
container, and the app already binds `0.0.0.0` and builds NFC URLs from whatever address it was
opened with.

- [ ] Tailscale on the Pi and on the phone, same account
- [ ] Reach the app at the Pi's tailnet hostname from mobile data
- [ ] Optional HTTPS on the tailnet via `tailscale serve`, so Basic Auth stops travelling in cleartext
- [ ] Exempt Tailscale from Android battery optimisation so the tunnel survives Doze

Setup steps are in [README](README.md#reaching-it-from-outside-the-house-tailscale).

### Milestone 4 — subcategories

Implemented on `feature/subcategories-and-balance`, awaiting testing.
Spec: [subcategories-spec.md](subcategories-spec.md).

- Categories can own subcategories, which inherit the parent's kind, icon and colour
- Transactions record both category and subcategory, so re-parenting never rewrites past charts
- The Home pie toggles Categories / Subcategories, with slices shaded per parent, and
  All / Expenses / Income
- The full-height category picker is gone: the transaction sheet has an inline category grid and
  subcategory chips, and category management moved to Settings

### Milestone 5 — starting balance and Trends rework

Implemented on `feature/subcategories-and-balance`, awaiting testing.
Spec: [balance-and-trends-spec.md](balance-and-trends-spec.md).

- A starting balance in Settings — the money you had before you started tracking
- Trends gains a running Total line on its own axis, starting from the balance at the beginning of
  the window rather than from zero
- The flat category list under the chart becomes a month-by-month comparison, one row per category
  with a bar per month and the change from the month before, for expenses and for income
- Transaction rows show the date beside the amount, and the subcategory in the subtitle
- The bottom-right nav button names its destination: Trends from the dashboard, Dashboard from
  Trends, each with its own icon
- The month's net moves into the Home header; the summary strip drops to two tiles

**Requires wiping the database** (`docker compose down -v`), which is why it ships while all data
is still test data.

### Later

Deliberately out of scope, with no hooks or abstractions built for them yet:
local LLM integration, budgets and alerts, CSV/JSON export, Telegram notifications,
multi-user and multi-currency, recurring transactions.

## [1.0.0] - 2026-08-19

### Milestone 1 — home network release

First working version: a mobile-first expense and income tracker, single user, running in one
container on the Raspberry Pi and reachable from any browser on the home network.

#### Added

- **Transactions** — add, edit (tap a row), and delete (swipe left, or hover on desktop), with
  amounts accepting both `.` and `,` as decimal separator.
- **Categories** — separate lists for expenses and income, each with a Lucide icon and a colour
  from a fixed ten-colour palette. Created inline from inside the add-expense flow, so a first
  category and a first expense happen in one pass.
- **Archiving instead of deleting** — an archived category leaves the picker but keeps its past
  transactions and chart slices intact and correctly coloured. Its name is freed for reuse.
- **Home view** — month summary (income, expenses, net), expense pie chart with a tappable legend
  that filters the list below, and an infinite-scrolling transaction list. Month chevrons move the
  whole view. Both empty states handled: no categories yet, and no activity this month.
- **Trends view** — income and expense lines over 1M / 3M / 1Y, bucketed by day / week / month,
  with dense zero-filled buckets so gaps in spending do not distort the line, plus a category
  breakdown for the range.
- **NFC tags** — `/?add=expense&category=<id>` opens the add sheet with that category selected and
  the keyboard already up on the amount field, then cleans the URL. Settings lists every category's
  tag URL with a copy button.
- **Basic Auth** on every route including the static files, compared with `secrets.compare_digest`.
  The app refuses to start if `APP_USER` or `APP_PASSWORD` is unset rather than running unprotected.
- **Installable** — web app manifest and iOS/Android meta tags, so it can be added to the home
  screen and opened without browser chrome.
- **Docker deployment** — one arch-agnostic image (verified building as `linux/arm64`), running
  as a non-root user, with SQLite in a named volume so data survives `docker compose down && up`
  without depending on host file ownership.

#### Notes

- Timezone-correct throughout: datetimes are stored in UTC, and month boundaries and chart buckets
  are computed in the viewer's timezone, so a late-night expense lands in the right day and month.
- Amounts are always stored positive; the transaction type carries the sign.
- 23 tests cover the parts that are easy to get wrong — amount and timezone validation, the
  type/kind invariant, archived-category behaviour, dense bucketing, and the 401.

[Unreleased]: https://github.com/vaffer94/expense-tracker/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/vaffer94/expense-tracker/releases/tag/v1.0.0
