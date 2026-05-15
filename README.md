# navily-cli

TypeScript CLI client for [navily.com](https://www.navily.com) — search marinas and anchorages, read reviews, check the weather forecast for a port, list nearby shops, view bookings.

## Install

### Prerequisites

- **Node ≥ 20** — `node --version` to check
- **Google Chrome** — only needed for `navily auth login` (drives a real Chrome to mint the session cookie). Skip if you only use `NAVILY_COOKIE` or `navily auth from-curl`.
- **pnpm** — `npm i -g pnpm` if you don't have it. npm and yarn also work; commands below show pnpm.

`cycletls` (our TLS-impersonating HTTP client) ships a small Go binary inside its npm package — you don't need a Go toolchain. macOS arm64/x64 and Linux x64 are tested.

### From source (current path)

The package is published to GitHub Packages (`@yosit` scope), which requires auth — for now the simplest install is from a clone:

```bash
git clone https://github.com/yosit/navily-cli.git
cd navily-cli
pnpm install            # also runs `pnpm build` via the prepare script
pnpm link --global      # exposes `navily` on your PATH
navily --help
```

Verify:

```bash
navily --version
which navily            # should point at the linked bin
```

### From source, without global link

If you'd rather not link globally, run it directly from the clone:

```bash
node /path/to/navily-cli/bin/navily.mjs --help
# or alias it:
alias navily="node /path/to/navily-cli/bin/navily.mjs"
```

### From the GitHub Packages registry

If you have a GitHub PAT with `read:packages`:

```bash
# Add a registry hint for the @yosit scope (one-time):
npm config set @yosit:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken "$GITHUB_TOKEN"

# Then install globally:
pnpm add -g @yosit/navily-cli
# or with npm:
npm i -g @yosit/navily-cli
```

### Uninstall

```bash
pnpm uninstall --global @yosit/navily-cli   # if installed from registry
pnpm unlink --global @yosit/navily-cli      # if linked from a clone
rm -rf ~/.config/navily                     # wipes the saved cookie
```

## Authenticate

navily.com is gated by Cloudflare Turnstile, so we can't POST credentials directly. Two ways to get a working cookie:

### Option A — `navily auth login` (recommended)

Drives your installed Chrome through the login modal. Requires Google Chrome (override the binary with `NAVILY_CHROME_PATH`).

```bash
export NAVILY_EMAIL=you@example.com NAVILY_PASSWORD=…   # or use `psst` to keep secrets out of your shell
navily auth login
```

A Chrome window opens against a fresh ephemeral profile, the CLI fills the form, and Turnstile usually passes silently. If it shows a challenge, solve it in the window — the flow waits and resumes. On success the cookie is saved and verified.

**Note on headless mode:** `--headless` exists but Cloudflare's WAF on navily.com refuses headless Chrome at the connection layer (Turnstile-side stealth patches aren't enough). For CI/agent use, either run inside `xvfb-run` on Linux, or mint the cookie locally and pass it through as `NAVILY_COOKIE`.

### Option B — Paste a cookie from DevTools

1. In Chrome, log into <https://www.navily.com>.
2. Open DevTools → Network tab.
3. Click any `/ajax/get-session-data` or `/api/map-search` request.
4. Right-click → **Copy → Copy as cURL**.
5. Pipe it to:

```bash
pbpaste | navily auth from-curl --stdin
navily auth status   # verify
```

The cookie is saved to `~/.config/navily/cookie` (mode 600). You can also set `NAVILY_COOKIE` directly in your env.

Cookies rotate (Cloudflare's `cf_clearance` typically lasts <1 h). Re-run `auth login` or re-export when you see a `Cloudflare blocked` error.

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

- **Auth**: Laravel session cookie + `X-XSRF-TOKEN` header. Cookie is obtained either by pasting from DevTools or by `navily auth login`, which drives a real Chrome (CDP-attach) through the Turnstile-gated login modal.
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
