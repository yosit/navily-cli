# navily-cli

CLI client for [navily.com](https://www.navily.com) — search marinas and anchorages, read reviews, check the weather forecast for a port, list nearby shops, etc.

## Install

```bash
pipx install .
# or
pip install .
```

## Authenticate

navily.com is gated by Cloudflare Turnstile, so the CLI cannot log you in programmatically. Log in once in a real browser, then export your session cookie.

1. In Brave/Chrome, log into <https://www.navily.com>.
2. Open DevTools → Network tab.
3. Click any `/ajax/get-session-data` or `/api/map-search` request.
4. Right-click → **Copy → Copy as cURL**.
5. Run:

```bash
navily auth from-curl --stdin <<<'<paste the curl command here>'
# verify
navily auth status
```

The cookie is saved to `~/.config/navily/cookie` (mode 600). You can also set `NAVILY_COOKIE` directly in your env.

Cookies rotate (Cloudflare's `cf_clearance` typically lasts <1h). Re-export when you see a `Cloudflare blocked` error.

## Commands

```bash
navily whoami                        # basic profile
navily me                            # full profile
navily search "cannes"               # hybrid search (ports/moorings/users/shops/regions)
navily map 43.5 7.0 --distance 25000 # places near coordinate
navily port show 301                 # full marina detail (Sanary-sur-Mer)
navily port comments 301
navily port photos 301
navily port equipments 301
navily port weather 301
navily port shops 301
navily port price 301                # tonight's bookable price
navily port nearby 301 --count 5
navily mooring show 49111            # full anchorage detail (Aegina)
navily mooring weather 49111         # with wind/wave protection scores
navily region show 298               # Provence-Alpes-Côte d'Azur
navily region ports 298
navily region moorings 298
navily boats                         # your saved boats
navily lists                         # your favourites lists
navily bookings summary
navily countries
```

All commands default to `--format json`. Pass `-f table` for a Rich-rendered table.

## How it works

- **Auth**: Laravel session cookie + `X-XSRF-TOKEN` header. No programmatic login (Cloudflare Turnstile gates the login form).
- **TLS**: Cloudflare validates the `cf_clearance` cookie against the client's TLS fingerprint. We use [`curl_cffi`](https://github.com/lexiforest/curl_cffi) with Chrome 131 impersonation so requests look identical to Chrome.
- **API surface**: two channels.
  - Direct AJAX on `www.navily.com` (`/ajax/...`, `/api/...`).
  - A server-side proxy: `POST /api/proxy` with body `{url, method, data}` forwards to `api.navily.com`. The CLI uses this for `/users/me`, `/ports/{id}`, `/regions/{id}/...`, etc.

Endpoints, entities, and quirks are documented in the napkin KB at `../navily-kb/.napkin/specs/`.

## Develop

```bash
python -m venv .venv && .venv/bin/pip install -e '.[test]'
.venv/bin/pytest
```
