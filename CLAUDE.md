# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A Python CLI (`navily`) for [navily.com](https://www.navily.com): search marinas/anchorages, read reviews, fetch weather forecasts, list a region's spots, view bookings, etc.

## Tech stack

- **Runtime**: Python ≥ 3.10
- **HTTP**: `curl_cffi` with `impersonate="chrome131"` — mandatory, see below
- **CLI**: `click`
- **Tables**: `rich`
- **Tests**: `pytest`
- **Packaging**: `hatchling`

## Critical: Cloudflare TLS fingerprint requirement

Both `www.navily.com` and `api.navily.com` are Cloudflare-gated. The `cf_clearance` cookie is bound to the browser's TLS fingerprint (JA3 hash).

Plain `curl`, Node's `https`, and Python's `requests` all get a 403 challenge page even with a valid `cf_clearance` cookie. We **must** use a TLS-impersonating client. `curl_cffi` is the chosen one.

If you change the HTTP client, the API stops working. Don't switch to `requests` or `httpx` "for simplicity".

## Critical: no programmatic login

The navily.com login modal is gated by Cloudflare Turnstile (anti-bot). We cannot post credentials directly.

The CLI requires an existing browser session cookie:
- `navily auth from-curl` — paste a `Copy as cURL` from DevTools
- `navily auth set <cookie-string>` — set raw cookie value
- `NAVILY_COOKIE` env var also works

Cookie lifetime ≈ 1 h (`cf_clearance` rotation). On Cloudflare/auth errors the CLI exits non-zero and tells the user to refresh.

## Two API surfaces

1. **Direct www endpoints**: `/ajax/...`, `/api/...` on `www.navily.com`. Limited surface (~10 endpoints): `whoami`, `search`, `map-search`, `map-search/price`, `ports/get-with-media`, `markdown-to-html`.
2. **Proxied endpoints** via `POST /api/proxy` with body `{url, method, data}`. The Laravel backend forwards to `api.navily.com`. This is the richer surface: `/users/me`, `/ports/{id}/...`, `/moorings/{id}/...`, `/regions/{id}/...`, `/search/places`, `/boats`, `/lists`, `/demands`, `/cards`, etc.

The proxy returns `{"message": "The route X could not be found."}` (HTTP 200) for unknown paths — surfaced as `NotFoundError`. Always check the message, not just the status code.

## Project layout

```
src/navily/
  __init__.py
  cli.py           — click commands
  client.py        — NavilyClient: one method per endpoint
  config.py        — cookie save/load, curl parsing, XSRF extraction
  formatters.py    — JSON and Rich-table output
tests/
  test_config.py
  test_formatters.py
```

## Commands

```bash
pip install -e .
pytest                # run tests
navily --help         # see all commands
```

## Credential storage

Cookies live in `~/.config/navily/cookie` (mode 600). The CLI never echoes the cookie. The user obtains the cookie via DevTools → Copy as cURL.

`NAVILY_COOKIE` env var wins over the file.

## Knowledge base

Detailed endpoint reference is in `../navily-kb/.napkin/specs/`:
- `navily-api-architecture.md` — endpoints, entities, errors, quirks
- `navily-api-intent.md` — screen/intent/trigger per endpoint
