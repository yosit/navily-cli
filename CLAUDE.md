# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A TypeScript CLI (`navily`) for [navily.com](https://www.navily.com): search marinas/anchorages, read reviews, fetch weather forecasts, list a region's spots, view bookings, etc.

## Tech stack

- **Runtime**: Node >= 20
- **HTTP**: `cycletls` for Chrome-like TLS impersonation
- **CLI**: `commander`
- **Tables**: `cli-table3`
- **Tests**: `vitest`
- **Build**: `tsc` -> `dist/`

## Cloudflare/TLS requirement

Both `www.navily.com` and `api.navily.com` are Cloudflare-gated. Node's built-in `https` and `fetch` can get challenged even with valid cookies, so API and login requests use `cycletls` with a Chrome JA3/user-agent.

Do not replace `cycletls` with `fetch`, `undici`, `axios`, or plain `https` unless you also verify the Cloudflare behavior end to end.

`cycletls` starts a small Go subprocess on first request. Call `client.close()` after programmatic use; the CLI does this automatically.

## Auth

Preferred auth is browserless:

- `NAVILY_EMAIL` + `NAVILY_PASSWORD` let the CLI mint a cookie automatically on first use or after auth/Cloudflare failures.
- `NAVILY_COOKIE` still overrides the cookie file and skips auto-login.
- Cookies are saved at `~/.config/navily/cookie` with mode `600`.
- A lock file in the same config directory prevents concurrent commands from minting multiple cookies at once.

Fallback/manual flows:

- `navily auth login --browser` drives an installed Chrome through the login modal.
- `navily auth from-curl` and `navily auth set <cookie>` remain available for pre-minted cookies.

Never log credentials or cookie values.

## API surfaces

1. **Direct www endpoints**: `/ajax/...`, `/api/...` on `www.navily.com`.
2. **Proxied endpoints**: `POST /api/proxy` with body `{url, method, data}`, forwarded by Navily to `api.navily.com`.

The proxy can return `{"message": "The route X could not be found."}` with HTTP 200 for unknown paths. The client surfaces this as `NotFoundError`.

## Project layout

```text
src/
  cli.ts           - commander program; one subcommand per endpoint
  client.ts        - NavilyClient: one method per endpoint
  config.ts        - cookie save/load, curl parsing, XSRF extraction
  formatters.ts    - JSON and cli-table3 output
  types.ts         - shared TypeScript interfaces
  index.ts         - public API re-exports
  auth/
    auto.ts        - auto-cookie minting, refresh, locking
    http.ts        - browserless cycletls login
    chrome.ts      - Chrome fallback launcher
    login.ts       - Chrome modal-driving fallback
    session.ts     - shared browser login save helper
docs/kb/           - endpoint and data notes
bin/navily.mjs     - shebang wrapper around dist/cli.js
tests/             - vitest tests
```

## Commands

```bash
pnpm install
pnpm build:all
pnpm test
pnpm lint:all
pnpm dev -- whoami
node ./bin/navily.mjs --help
```

The plugin `dist/` directories are generated and ignored. Run
`pnpm build:plugins` or `pnpm build:all` before deploying runline/dripline
plugins.

## Knowledge base

Detailed endpoint reference lives in `docs/kb/`:

- `navily-api-architecture.md`
- `navily-api-intent.md`
- `navily-data-strategy.md`
