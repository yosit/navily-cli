# navily skill

Claude Code skill: CLI for [navily.com](https://www.navily.com) (marinas, anchorages, weather, reviews, bookings).

## Setup

```bash
pnpm install
pnpm build
pnpm link --global
```

Set `NAVILY_EMAIL` and `NAVILY_PASSWORD`; the CLI mints and refreshes cookies automatically. `NAVILY_COOKIE` can still provide a pre-minted cookie.

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
| `NAVILY_EMAIL` | Login email for automatic browserless auth |
| `NAVILY_PASSWORD` | Login password for automatic browserless auth |
| `NAVILY_COOKIE` | Full cookie string (overrides `~/.config/navily/cookie`) |

## How it works

- Cloudflare requires a Chrome-like TLS fingerprint — we use `cycletls`.
- Two URL surfaces: direct AJAX on `www.navily.com` and proxied `POST /api/proxy` → `api.navily.com`.
- See `docs/kb/navily-api-architecture.md` for the full endpoint catalog.
