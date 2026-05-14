# navily-cli

TypeScript CLI client for [navily.com](https://www.navily.com) — search marinas and anchorages, read reviews, check the weather forecast for a port, list nearby shops, view bookings.

## Install

```bash
pnpm install
pnpm build
pnpm link --global   # exposes the `navily` command
```

Or run directly from a clone:

```bash
node ./bin/navily.mjs --help
```

## Authenticate

navily.com is gated by Cloudflare Turnstile, so the CLI cannot log you in programmatically. Log in once in a real browser, then export your session cookie.

1. In Brave/Chrome, log into <https://www.navily.com>.
2. Open DevTools → Network tab.
3. Click any `/ajax/get-session-data` or `/api/map-search` request.
4. Right-click → **Copy → Copy as cURL**.
5. Pipe it to:

```bash
pbpaste | navily auth from-curl --stdin
# verify
navily auth status
```

The cookie is saved to `~/.config/navily/cookie` (mode 600). You can also set `NAVILY_COOKIE` directly in your env.

Cookies rotate (Cloudflare's `cf_clearance` typically lasts <1 h). Re-export when you see a `Cloudflare blocked` error.

## Commands

```bash
navily whoami                        # basic profile (/ajax/get-session-data)
navily me                            # full profile (/users/me via proxy)
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
navily mooring weather 49111         # forecast with wind/wave protection scores
navily region show 298               # Provence-Alpes-Côte d'Azur
navily region ports 298
navily region moorings 298
navily boats                         # your saved boats
navily lists                         # your favourites lists
navily bookings summary
navily countries
```

All commands default to `--format json`. Pass `-f table` (before the subcommand) for a tabular view:

```bash
navily -f table search "cannes" --limit 3
```

## How it works

- **Auth**: Laravel session cookie + `X-XSRF-TOKEN` header. No programmatic login — Cloudflare Turnstile gates the login form.
- **TLS**: Cloudflare validates the `cf_clearance` cookie against the client's TLS fingerprint (JA3). Node's built-in `https` and `fetch` get a 403 challenge page even with valid cookies. We use [`cycletls`](https://github.com/Danny-Dasilva/CycleTLS) (a Go binary auto-installed via npm) that performs Chrome-grade TLS impersonation. The first request to a client spawns the Go process; calling `client.close()` shuts it down.
- **API surface**: two channels.
  - Direct AJAX on `www.navily.com` (`/ajax/...`, `/api/...`).
  - A server-side proxy: `POST /api/proxy` with body `{url, method, data}` forwards to `api.navily.com`. The CLI uses this for `/users/me`, `/ports/{id}/...`, `/moorings/{id}/...`, `/regions/{id}/...`, etc.

Endpoints, entities, and quirks are documented in the napkin KB at `../navily-kb/.napkin/specs/`.

## Develop

```bash
pnpm install
pnpm build            # tsc → dist/
pnpm test             # vitest
pnpm lint             # tsc --noEmit
pnpm dev -- whoami    # run from source via tsx
```

## Programmatic use

```ts
import { NavilyClient, loadCookie } from "@yosit/navily-cli";

const cookie = loadCookie()!;
const client = new NavilyClient(cookie);
try {
  const me = await client.me();
  console.log(me);
} finally {
  await client.close();   // releases the cycletls subprocess
}
```
