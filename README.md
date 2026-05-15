# navily-cli

TypeScript CLI client for [navily.com](https://www.navily.com) — search marinas and anchorages, read reviews, check the weather forecast for a port, list nearby shops, view bookings.

## Install

### Prerequisites

- **Node ≥ 20** — `node --version` to check
- **Google Chrome** — optional. Only needed for `navily auth login --browser`. The default login path is browserless and works from `NAVILY_EMAIL`/`NAVILY_PASSWORD`.
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

### Vex agent

Vex does not need Chrome or a display server. Install from source, build the
CLI and plugins, then provide credentials as environment variables:

```bash
git clone https://github.com/yosit/navily-cli.git
cd navily-cli
pnpm install
pnpm build:all

export NAVILY_EMAIL=you@example.com
export NAVILY_PASSWORD=…
node ./bin/navily.mjs whoami
```

For pipeline steps that expect `navily` on `PATH`, link the package after the
build:

```bash
pnpm link --global
navily whoami
```

The first command mints `~/.config/navily/cookie`; later CLI, runline, and
dripline calls share that cookie. Concurrent processes use a lock file in the
same config directory, so they do not race multiple login handshakes. If Vex
injects a pre-minted `NAVILY_COOKIE`, that value takes precedence and skips
auto-login.

### Uninstall

```bash
pnpm unlink --global @yosit/navily-cli
rm -rf ~/.config/navily
```

## Authenticate

navily.com is gated by Cloudflare, so the CLI uses `cycletls` for a Chrome-like TLS fingerprint during both login and API calls. In CI/agent contexts, set credentials and run any command:

```bash
export NAVILY_EMAIL=you@example.com
export NAVILY_PASSWORD=…
navily whoami
navily port show 301
```

If no cookie exists, or a saved cookie expires, the command logs in, saves a fresh cookie to `~/.config/navily/cookie`, and retries once. `NAVILY_COOKIE` still takes precedence and skips auto-login entirely.

### Option A — Browserless env-var login (recommended)

Runs the Navily login flow directly over `cycletls`; no browser or display server is required.

```bash
export NAVILY_EMAIL=you@example.com NAVILY_PASSWORD=…   # or use `psst` to keep secrets out of your shell
navily auth login
```

On success the cookie is saved and verified. Normal subcommands use the same path automatically, so `auth login` is mainly useful as an explicit preflight.

If browserless login is blocked by Cloudflare, run `navily auth login --browser` where Chrome is available, or set `NAVILY_COOKIE` from a pre-minted session. Automatic Chrome fallback is opt-in with `NAVILY_AUTH_BROWSER_FALLBACK=1`.

### Option B — Chrome login fallback

Where Chrome is installed, you can force the original modal-driving flow:

```bash
navily auth login --browser
```

This opens a fresh ephemeral Chrome profile and fills the form.

### Option C — Paste a cookie from DevTools

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

Cookies can expire. With `NAVILY_EMAIL` and `NAVILY_PASSWORD` set, commands refresh automatically; otherwise re-run `auth login` or re-export when you see an auth or Cloudflare error.

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

- **Auth**: Laravel session cookie + `X-XSRF-TOKEN` header. Cookie is obtained either by browserless `cycletls` login, by `navily auth login --browser`, or by pasting from DevTools.
- **TLS**: Cloudflare validates the `cf_clearance` cookie against the client's TLS fingerprint (JA3). Node's built-in `https` and `fetch` get a 403 challenge page even with valid cookies. We use [`cycletls`](https://github.com/Danny-Dasilva/CycleTLS) (a Go binary auto-installed via npm) that performs Chrome-grade TLS impersonation. The first request to a client spawns the Go process; calling `client.close()` shuts it down.
- **API surface**: two channels.
  - Direct AJAX on `www.navily.com` (`/ajax/...`, `/api/...`).
  - A server-side proxy: `POST /api/proxy` with body `{url, method, data}` forwards to `api.navily.com`. The CLI uses this for `/users/me`, `/ports/{id}/...`, `/moorings/{id}/...`, `/regions/{id}/...`, etc.

Endpoints, entities, and quirks are documented in `docs/kb/`.

## Develop

```bash
pnpm install
pnpm build:all        # builds CLI + runline/dripline plugins
pnpm test             # vitest
psst run "pnpm test:live" # real Aegina map/media download smoke test
pnpm lint:all         # typechecks CLI + plugins
pnpm dev -- whoami    # run from source via tsx
```

Plugin deployment note: `packages/runline-plugin/dist/` and
`packages/dripline-plugin/dist/` are generated and not tracked. Run
`pnpm build:plugins` or `pnpm build:all` before deploying either plugin.
The generated runline plugin includes `navily.map.staticImage` and
`navily.media.download`; the generated dripline plugin includes
`navily_map_static_image` and `navily_media_download`.

## Programmatic use

```ts
import { NavilyClient } from "@yosit/navily-cli";

const client = new NavilyClient();
try {
  const me = await client.me();
  console.log(me);
} finally {
  await client.close();   // releases the cycletls subprocess
}
```
