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

## Auth

The navily.com login modal is gated by Cloudflare Turnstile (anti-bot), so direct credential POSTs don't work. Two supported flows:

**1. Browser-driven login (`navily auth login`).** Spawns the user's installed Chrome (`/Applications/Google Chrome.app/...` on macOS, override with `NAVILY_CHROME_PATH`) with `--remote-debugging-port=0` + an ephemeral `--user-data-dir`, attaches via CDP using `playwright-core`, scripts the login modal, then harvests cookies. Implementation: `src/auth/chrome.ts` (launch + CDP) and `src/auth/login.ts` (form-fill + cookie harvest). We do **not** use Playwright's launcher because its Chromium instrumentation (navigator.webdriver, etc.) trips Turnstile; attaching to a vanilla Chrome process avoids that. If Turnstile presents a challenge the headed window lets the user solve it manually — the flow polls cookies until the session is established.

**2. Manual paste.** Same as before:
- `navily auth from-curl` — paste a `Copy as cURL` from DevTools
- `navily auth set <cookie-string>` — set raw cookie value
- `NAVILY_COOKIE` env var also works

Cookie lifetime ≈ 1 h (`cf_clearance` rotation). On Cloudflare/auth errors the CLI exits non-zero (codes 2/3) and tells the user to refresh.

### JA3 alignment caveat

`cf_clearance` is bound to the JA3 of the browser that minted it. The cookie minted by Chrome 135 will only validate against requests that present a Chrome-135-compatible JA3. cycletls sends a pinned Chrome-131 JA3 (`CHROME_JA3` in `src/client.ts`). For most Chrome versions Cloudflare is lenient enough that this still works, but if `auth login` succeeds and subsequent calls fail with `CloudflareBlockedError`, the JA3 has drifted — update `CHROME_JA3`/`CHROME_UA` to match the user's Chrome (or pin Chrome with a managed install).

### Headless mode is blocked

`navily auth login --headless` exists but **does not work against navily.com**. We tried the standard puppeteer-extra-stealth evasions (navigator.webdriver, plugins, languages, chrome.runtime, permissions API, WebGL, media codecs) — all live in `src/auth/stealth.ts`. Turnstile's JS-level checks pass after the patches, but Cloudflare's WAF still serves a "Just a moment..." 403 on `/api/proxy` because the rejection happens at the TLS/connection layer (HTTP/2 framing, in-browser XHR fingerprinting) where init scripts can't reach. Important detail: the stealth patches only run when `headless: true` is passed in `LoginOptions` — applying them to headed Chrome creates a hybrid fingerprint Cloudflare detects more easily, so don't move the `addInitScript` call out of that guard.

For CI/agent contexts, use one of:
- `xvfb-run -a navily auth login` on Linux — real headed Chrome in a virtual framebuffer
- Mint the cookie locally with `navily auth login`, save it to a secret store, inject via `NAVILY_COOKIE` env var in the agent

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
  auth/
    chrome.ts      — locate Chrome, spawn with remote-debug, CDP-attach via playwright-core
    login.ts       — drive the navily.com login modal, harvest session cookies
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
