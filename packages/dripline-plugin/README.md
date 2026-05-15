# dripline-plugin-navily

[dripline](https://github.com/Michaelliv/dripline) plugin that turns
[navily.com](https://www.navily.com) into SQL tables: marinas, anchorages,
weather, reviews, regions, your boats and bookings.

Backed by the `NavilyClient` from [`@yosit/navily-cli`](../..), which uses
`cycletls` (Chrome JA3 impersonation) — required because both `www.navily.com`
and `api.navily.com` are Cloudflare-gated and reject Node's built-in HTTP
clients even with a valid session cookie.

## Install

This plugin lives in the `navily-cli` workspace and is built from source.
The plugin `dist/` directory is generated, so always build before deploying.

```bash
git clone https://github.com/yosit/navily-cli.git
cd navily-cli
pnpm install
pnpm --filter dripline-plugin-navily build
```

### Install into dripline

If your dripline environment supports git package installs, install the plugin
from this repository subdirectory:

```bash
dripline plugin install git+https://github.com/yosit/navily-cli.git#packages/dripline-plugin
```

If the installer does not build workspace subdirectories, use a source checkout
and build first:

```bash
git clone https://github.com/yosit/navily-cli.git
cd navily-cli
pnpm install
pnpm build:all
dripline plugin install ./packages/dripline-plugin
```

### Vex agent

Vex only needs env vars; no browser/display server is required:

```bash
export NAVILY_EMAIL=you@example.com
export NAVILY_PASSWORD=…

git clone https://github.com/yosit/navily-cli.git
cd navily-cli
pnpm install
pnpm build:all

dripline plugin install ./packages/dripline-plugin
```

The first query mints `~/.config/navily/cookie`; later dripline, runline, and
CLI calls share it. `NAVILY_COOKIE` can provide a pre-minted cookie and skips
auto-login.

### Programmatic use

```ts
import { Dripline } from "dripline";
import navily from "dripline-plugin-navily";

const dl = await Dripline.create({
  plugins: [navily],
  connections: [
    {
      name: "navily",
      plugin: "navily",
      config: {
        // Optional — otherwise uses NAVILY_COOKIE, ~/.config/navily/cookie,
        // or NAVILY_EMAIL/NAVILY_PASSWORD auto-auth.
        cookie: process.env.NAVILY_COOKIE,
      },
    },
  ],
});

const marinas = await dl.query(`
  SELECT name, country_code, rating_general, latitude, longitude
  FROM navily.navily_map_search
  WHERE center_latitude = '39.5696' AND center_longitude = '2.6502' AND max_distance = 50000
  ORDER BY rating_general DESC
`);
```

## Auth

Cookie sources, in priority order:

1. The `cookie` field on the dripline connection config.
2. `NAVILY_COOKIE` env var.
3. `~/.config/navily/cookie` (whatever `navily auth login` or `navily auth from-curl` wrote).
4. `NAVILY_EMAIL` and `NAVILY_PASSWORD` browserless auto-auth.

The auto-auth path uses the same lock file as the CLI, so parallel commands
share the minted cookie instead of racing multiple login handshakes.

## Tables

### Identity

- `navily_whoami` — session profile (`/ajax/get-session-data`).
- `navily_me` — full authenticated profile (`/users/me`).
- `navily_user(id)` — public profile for a user id.

### Search

- `navily_search(q)` — quick autocomplete (`/api/search`).
- `navily_search_places(query[, kinds, limit])` — hybrid (`/search/places`).
- `navily_search_boats(keyword[, per_page])` — boat catalog. `per_page ≥ 10`.
- `navily_map_search(center_latitude, center_longitude[, max_distance, kinds])` — geo search. **Pass coordinates as strings** (`'39.5696'`, not `39.5696`); dripline strips the decimal on float quals.

### Ports (marinas)

- `navily_port(id)` — full marina detail.
- `navily_port_with_media(id)` — marina with photos/equipments/hours.
- `navily_port_price_tonight(port_id)` — tonight's berth price (marinas only).
- `navily_port_comments(port_id)` — reviews (page 1).
- `navily_port_photos(port_id)` — photos (page 1).
- `navily_port_equipments(port_id)` — water/electricity/fuel/wifi/etc.
- `navily_port_weather(port_id)` — 33-entry forecast.
- `navily_port_shops(port_id)` — nearby shops.
- `navily_port_bookable_around(port_id[, ports_count])` — alt marinas nearby.

### Moorings (anchorages)

- `navily_mooring(id)` — full anchorage detail.
- `navily_mooring_comments(mooring_id)` — reviews (page 1).
- `navily_mooring_photos(mooring_id)` — photos (page 1).
- `navily_mooring_weather(mooring_id)` — forecast with wind/wave protection scores.
- `navily_mooring_shops(mooring_id)` — nearby shops.

### Regions

- `navily_regions` — global region index (page 1).
- `navily_region(id)` — region detail.
- `navily_region_ports(region_id)` — marinas in a region (page 1).
- `navily_region_moorings(region_id)` — anchorages in a region (page 1).

### Personal

- `navily_boats` — your boats.
- `navily_lists` — your favourites lists.
- `navily_list_entries(list_id)` — places in a list.
- `navily_list_comments(list_id)` — comments on a list (page 1).
- `navily_cards` — payment cards.
- `navily_notifications` — notifications.
- `navily_demands` — booking demands.
- `navily_demands_offers` — pending marina offers.
- `navily_subscription_last` — last subscription record.

### Reference

- `navily_countries` — 251 countries with VHF channel and emergency phone.

## Notes

- Tables marked "(page 1)" only fetch the first Laravel page. Pagination
  loops aren't wired through `NavilyClient` yet.
- Each row also carries a `raw` JSON column with the unmodified upstream
  payload, so you can `SELECT raw->'$.permissions' FROM navily_port WHERE id=…`
  to reach fields the plugin doesn't surface explicitly.
- One `cycletls` Go subprocess is spawned lazily on first query and reused
  for the lifetime of the dripline process; cookie rotation creates a new
  subprocess.
- **Float quals are broken in dripline 0.9.16** — `WHERE center_latitude =
  39.5696` arrives at the plugin as `395696` (decimal stripped), and
  `CAST(... AS DOUBLE)` arrives as `null`. Pass coordinates as string
  literals until [dripline #?] is fixed.
- The `forecast_at` column on weather tables is named to avoid colliding
  with DuckDB's `AT TIME ZONE` keyword.

## License

MIT
