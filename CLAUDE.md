# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A TypeScript CLI (`navily`) for [navily.com](https://www.navily.com): search marinas/anchorages, read reviews, fetch weather forecasts, list a region's spots, view bookings, etc.

## Tech stack

- **Runtime**: Node ≥ 20
- **HTTP**: `cycletls` (Go binary, Chrome TLS impersonation) — mandatory, see below
- **CLI**: `commander`
- **Tables**: `cli-table3`
- **Tests**: `vitest`
- **Build**: `tsc` → `dist/`

## Critical: Cloudflare TLS fingerprint requirement

Both `www.navily.com` and `api.navily.com` are Cloudflare-gated. The `cf_clearance` cookie is bound to the browser's TLS fingerprint (JA3 hash).

Node's built-in `https` and `fetch` get a 403 challenge page even with a valid `cf_clearance` cookie. We **must** use a TLS-impersonating client.

`cycletls` ships a small Go binary that opens a local WebSocket; the JS side proxies requests through it with a Chrome JA3 string. The first request to a `NavilyClient` spawns the subprocess; call `client.close()` to shut it down when done. The CLI handles this automatically.

If you change the HTTP client, the API stops working. Don't switch to `node-fetch`, `undici`, or `axios` "for simplicity".

cycletls's npm package has a packaging quirk: `form-data` and `ws` are runtime deps but not declared. We list them explicitly in `package.json` to keep the install reproducible.

## Critical: no programmatic login

The navily.com login modal is gated by Cloudflare Turnstile (anti-bot). We cannot post credentials directly.

The CLI requires an existing browser session cookie:
- `navily auth from-curl` — paste a `Copy as cURL` from DevTools
- `navily auth set <cookie-string>` — set raw cookie value
- `NAVILY_COOKIE` env var also works

Cookie lifetime ≈ 1 h (`cf_clearance` rotation). On Cloudflare/auth errors the CLI exits non-zero (codes 2/3) and tells the user to refresh.

## Two API surfaces

1. **Direct www endpoints**: `/ajax/...`, `/api/...` on `www.navily.com`. Small surface: `whoami`, `search`, `map-search`, `map-search/price`, `ports/get-with-media`, `markdown-to-html`.
2. **Proxied endpoints** via `POST /api/proxy` with body `{url, method, data}`. The Laravel backend forwards to `api.navily.com`. This is the richer surface: `/users/me`, `/ports/{id}/...`, `/moorings/{id}/...`, `/regions/{id}/...`, `/search/places`, `/boats`, `/lists`, `/demands`, `/cards`, etc.

The proxy returns `{"message": "The route X could not be found."}` (HTTP 200) for unknown paths — surfaced as `NotFoundError`. Always check the message, not just the status code.

## Project layout

```
src/
  cli.ts           — commander program; one subcommand per endpoint
  client.ts        — NavilyClient: one method per endpoint
  config.ts        — cookie save/load, curl parsing, XSRF extraction
  formatters.ts    — JSON and cli-table3 output
  types.ts         — shared TypeScript interfaces
  index.ts         — public API re-exports
bin/
  navily.mjs       — shebang wrapper around dist/cli.js
tests/
  config.test.ts
  formatters.test.ts
```

## Commands

```bash
pnpm install
pnpm build             # tsc → dist/
pnpm test              # vitest
pnpm lint              # tsc --noEmit
pnpm dev -- whoami     # run from source via tsx
node ./bin/navily.mjs --help
```

## Credential storage

Cookies live in `~/.config/navily/cookie` (mode 600). The CLI never echoes the cookie. The user obtains the cookie via DevTools → Copy as cURL.

`NAVILY_COOKIE` env var wins over the file.

## Knowledge base

Detailed endpoint reference is in `../navily-kb/.napkin/specs/`:
- `navily-api-architecture.md` — endpoints, entities, errors, quirks
- `navily-api-intent.md` — screen/intent/trigger per endpoint
