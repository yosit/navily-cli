# navily skill

Claude Code skill: CLI for [navily.com](https://www.navily.com) (marinas, anchorages, weather, reviews, bookings).

## Setup

```bash
pip install /Users/yosit/code/navily-cli
```

Then capture a session cookie from a real browser (no programmatic login — Cloudflare Turnstile gates the form):

1. Log in at https://www.navily.com in Brave/Chrome.
2. DevTools → Network → click any `/ajax/get-session-data` row → right-click → **Copy → Copy as cURL**.
3. `navily auth from-curl --stdin <<< 'PASTE'`
4. `navily auth status` to verify.

Cookies rotate (~1h Cloudflare `cf_clearance` lifetime). When you see "Cloudflare blocked", re-export.

`NAVILY_COOKIE` env var also works as an alternative to the file.

## Commands

| Command | What it does |
|---------|-------------|
| `navily whoami` | Basic profile (`/ajax/get-session-data`) |
| `navily me` | Full profile + configuration |
| `navily search "<q>"` | Hybrid search (ports/moorings/users/shops/regions) |
| `navily map <lat> <lon> [--distance N --kinds port,mooring]` | Spots near a coordinate |
| `navily port show <id>` / `comments` / `photos` / `equipments` / `weather` / `shops` / `price` / `nearby` | Marina detail |
| `navily mooring show <id>` / `comments` / `photos` / `weather` / `shops` | Anchorage detail |
| `navily region show <id>` / `ports` / `moorings` / `list` | Region detail and contents |
| `navily boats` / `lists` / `cards` / `notifications` | Personal data |
| `navily bookings list` / `summary` / `offers` | Booking demands |
| `navily countries` / `search-boats <kw>` / `subscription` | Misc |

Output: `--format json` (default) or `-f table` (Rich tables; pass before subcommand).

## Environment variables

| Var | Purpose |
|-----|---------|
| `NAVILY_COOKIE` | Full cookie string (overrides `~/.config/navily/cookie`) |

## How it works

- Cloudflare requires Chrome TLS fingerprint — we use `curl_cffi` (Chrome 131 impersonation).
- Two URL surfaces: direct AJAX on `www.navily.com` and proxied `POST /api/proxy` → `api.navily.com`.
- See `../navily-kb/.napkin/specs/navily-api-architecture.md` for the full endpoint catalog.
