# Expense Tracker

A single-user expense and income tracker. FastAPI + SQLite on the back, static HTML/CSS/vanilla
ES modules on the front, one container, one port. Built for a phone browser on the local network,
with NFC tags as physical shortcuts into the "add expense" flow.

## Quick start

```bash
cp .env.example .env      # then edit APP_USER / APP_PASSWORD
docker compose up --build
```

Open <http://localhost:8000> and log in with the credentials from `.env`.
The app refuses to start if `APP_USER` or `APP_PASSWORD` is unset — it will not run unprotected.

### Running without Docker

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
APP_USER=dev APP_PASSWORD=dev DB_PATH=./data/expenses.db \
  .venv/bin/uvicorn backend.main:app --reload --port 8000
```

## Deploying to the Raspberry Pi

The image is arch-agnostic, so build it natively on the Pi — no registry needed:

```bash
git clone <this repo> && cd expense-tracker
cp .env.example .env && nano .env
docker compose up -d --build
```

### Where the data lives

The SQLite file lives in a Docker named volume, not in the project folder, so it survives
`docker compose down && docker compose up` and any rebuild. Copy it out or back in with:

```bash
docker compose cp app:/app/data/expenses.db ./backup.db      # snapshot
docker compose cp ./backup.db app:/app/data/expenses.db      # restore, then: docker compose restart
```

> `docker compose down -v` deletes that volume, and your data with it. `down` on its own is safe.

### Finding the Pi's LAN IP

You need it for the NFC tag URLs and to reach the app from your phone:

```bash
hostname -I | awk '{print $1}'      # on the Pi
```

Give the Pi a DHCP reservation in your router, or the IP (and every tag you wrote) may change.
The app is then at `http://<pi-ip>:8000`.

> Basic Auth over plain HTTP is only safe on a trusted LAN. Do not port-forward 8000 to the
> internet without a reverse proxy terminating TLS in front of it.

## Reaching it from outside the house (Tailscale)

The Pi's LAN address only exists inside your home network, so away from home there is nothing to
connect to. Tailscale fixes that by putting the phone and the Pi on the same private encrypted
network — without exposing anything to the public internet. Free for personal use.

**On the Pi:**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                  # prints a login link, open it and sign in
tailscale status                   # confirms the Pi joined
```

**On the phone:** install Tailscale from the App Store / Play Store and sign in with the *same*
account. That is the one-time cost of this approach: the phone has to be a member of the network
to reach a machine that has no public address.

**Then**, with MagicDNS on (the default), the app is reachable at the Pi's tailnet name from
anywhere — home Wi-Fi, mobile data, a hotel:

```
http://<pi-hostname>.<your-tailnet>.ts.net:8000
```

`tailscale status` on the Pi prints that name. Keep the container bound to `0.0.0.0:8000` as it
already is — that serves both the LAN and the tailnet, so nothing about the deployment changes.

### Optional: HTTPS on the tailnet

Basic Auth sends the password with every request, so plain HTTP is worth upgrading even on a
private network. Tailscale can terminate TLS with a real certificate, for free:

```bash
sudo tailscale serve --bg 8000     # older releases: tailscale serve https / http://localhost:8000
tailscale serve status             # shows the resulting https:// URL
```

The app is then at `https://<pi-hostname>.<your-tailnet>.ts.net` with no port and no certificate
warning.

> Use `tailscale serve`, **not** `tailscale funnel`. Serve keeps the app private to your devices;
> funnel publishes it to the entire internet.

## NFC tags

Categories are created by you, so their IDs only exist once you have made some. **Settings**
(the gear on the home screen) lists every live category with the exact URL to write to its tag:

```
http://<pi-ip>:8000/?add=expense&category=<category_id>
```

Write it to a tag with any NFC writer app (NFC Tools on Android/iOS) as a URL/URI record.

The URL shown in Settings uses whatever address you loaded the app from, so **open the app via the
Tailscale name before copying the tag URLs**. A tag written with the `192.168.x.x` address only
works at home; one written with the tailnet name works everywhere.
Tapping the tag opens the app with the add-expense sheet already open, that category selected,
and the keyboard up on the amount field.

## Tests

```bash
.venv/bin/python -m pytest
```

## Layout

```
backend/    FastAPI app: routers/, services/, models, schemas, Basic Auth
frontend/   static app served by the same container; vendor/ holds Chart.js + the Lucide sprite
tests/      pytest against an in-memory SQLite DB
data/       local dev database only; under Docker the DB lives in a named volume
```

Notes:

- Auth is enforced by one HTTP middleware, so it covers the static files as well as `/api`.
- The vendored `frontend/vendor/lucide-sprite.svg` is the single source of truth for icon names:
  the backend validates against the symbols it contains, and the picker's icon grid is built from
  them. Symbols prefixed `ui-` are app chrome and are never offered as category icons.
- Timezone: the browser sends its IANA zone with every dashboard request; a `TZ` env var on the
  server overrides it. Month and bucket boundaries are computed in that zone, not UTC.
