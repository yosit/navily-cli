# runline-plugin-navily

[runline](https://github.com/Michaelliv/runline) plugin that turns
[navily.com](https://www.navily.com) into callable JS actions for agent code:
search, fetch marinas/anchorages/weather/reviews, look up regions, manage
your boats and bookings.

Pairs with [`dripline-plugin-navily`](../dripline-plugin) — dripline gives
you SQL `SELECT`s, runline gives you imperative actions you can chain
together. They use the same cookie file and `cycletls` auth layer, so they
avoid repeated login handshakes where possible.

Action handlers run on the host (Node), not in the QuickJS sandbox, so
the cycletls Go subprocess works fine.

## Install

This plugin lives in the `navily-cli` workspace and is built from source.
The plugin `dist/` directory is generated, so always build before deploying.

```bash
git clone https://github.com/yosit/navily-cli.git
cd navily-cli
pnpm install
pnpm --filter runline-plugin-navily build
```

### Install into runline

If your runline environment supports git package installs, install the plugin
from this repository subdirectory:

```bash
runline plugin install git+https://github.com/yosit/navily-cli.git#packages/runline-plugin
```

If the installer does not build workspace subdirectories, use a source checkout
and build first:

```bash
git clone https://github.com/yosit/navily-cli.git
cd navily-cli
pnpm install
pnpm build:all
runline plugin install ./packages/runline-plugin
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

runline plugin install ./packages/runline-plugin
```

The first action mints `~/.config/navily/cookie`; later runline, dripline, and
CLI calls share it. `NAVILY_COOKIE` can provide a pre-minted cookie and skips
auto-login.

### Programmatic use

```ts
import { Runline } from "runline";
import navily from "runline-plugin-navily";

const rl = Runline.create({
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

const result = await rl.execute(`
  const hits = await navily.search.quick({ q: "palma" });
  const top = hits.results.ports[0];
  const port = await navily.port.get({ portId: top.id });
  const weather = await navily.port.getWeather({ portId: top.id });
  return { name: port.name, rating: port.rating.general, forecast: weather.slice(0, 3) };
`);
```

## Auth

Cookie sources, in priority order:

1. The `cookie` field on the runline connection config.
2. `NAVILY_COOKIE` env var.
3. `~/.config/navily/cookie` (whatever `navily auth login` or `navily auth from-curl` wrote).
4. `NAVILY_EMAIL` and `NAVILY_PASSWORD` browserless auto-auth.

The auto-auth path uses the same lock file as the CLI, so parallel commands
share the minted cookie instead of racing multiple login handshakes.

## Actions

### Identity

- `identity.whoami()` → session info (`/ajax/get-session-data`).
- `identity.me()` → full authenticated profile (`/users/me`).
- `identity.user({ userId })` → public profile.

### Search

- `search.quick({ q })` → autocomplete hits bucketed by kind (`/api/search`).
- `search.places({ query, kinds?, limit? })` → hybrid (`/search/places`).
- `search.boats({ keyword, perPage? })` → boat catalog. `perPage ≥ 10`.
- `search.map({ latitude, longitude, distanceM?, kinds? })` → geo search.

### Rendered assets

- `map.staticImage({ latitude?, longitude?, zoom?, width?, height?, markersJson?, outputDir?, filename?, tileProvider?, tileApiKey?, tileUrlTemplate? })` → writes a static SVG map and returns `{ path, contentType, bytes }`.
- `map.staticThumbnail({ latitude, longitude, outputDir?, filename? })` → downloads Navily's cached 460x250 map thumbnail when present, otherwise writes a generated SVG fallback.
- `media.download({ url, outputDir?, filename? })` → downloads a Navily photo/media URL through the host session and returns `{ path, contentType, bytes }`.

`markersJson` is a JSON array of `{ "latitude": 37.74, "longitude": 23.43, "label": "Aegina Marina" }`.
If `latitude`/`longitude` are omitted, the map centers on the average marker
coordinate. Tiles default to OpenStreetMap. For satellite, pass
`tileProvider: "esriWorldImagery"` (no key), `maptilerSatellite`, or
`mapboxSatellite`; MapTiler/Mapbox require `tileApiKey` or provider env vars.
You can also set `NAVILY_TILE_URL_TEMPLATE` or pass `tileUrlTemplate` with
`{z}`, `{x}`, and `{y}` placeholders.

```js
const hits = await navily.search.map({
  latitude: 37.745,
  longitude: 23.43,
  distanceM: 20000,
  kinds: "port,mooring",
});

const markers = hits.results.map((spot) => ({
  latitude: spot.coordinate.latitude,
  longitude: spot.coordinate.longitude,
  label: spot.name,
}));

const map = await navily.map.staticImage({
  latitude: 37.745,
  longitude: 23.43,
  zoom: 12,
  markersJson: JSON.stringify(markers),
  filename: "aegina-navily-map.svg",
  tileProvider: "esriWorldImagery",
});

const photos = await navily.port.listPhotos({ portId: hits.results[0].id });
const photo = await navily.media.download({
  url: photos.data[0].url,
  filename: "aegina-marina.jpg",
});

return { mapPath: map.path, photoPath: photo.path };
```

### Ports (marinas) — reads

- `port.get({ portId })`
- `port.getWithMedia({ portId })` — incl. photos/equipments/hours.
- `port.getPriceTonight({ portId })` — marinas only; anchorages return 500.
- `port.getMyComment({ portId })` — current user's own review.
- `port.listComments({ portId, page?, perPage?, allPages?, maxPages? })`
- `port.listPhotos({ portId, page?, perPage?, allPages?, maxPages? })`
- `port.listEquipments({ portId })`
- `port.getWeather({ portId })` — 33-entry forecast.
- `port.listShops({ portId })`
- `port.listBookableAround({ portId, portsCount? })`

### Ports — writes

- `port.markVisited({ portId })` → mark "I've been here" (`POST /ports/{portId}/discover`). **Side effect on your account.**

### Moorings (anchorages)

- `mooring.get({ mooringId })`
- `mooring.listComments({ mooringId, page?, perPage?, allPages?, maxPages? })`
- `mooring.listPhotos({ mooringId, page?, perPage?, allPages?, maxPages? })`
- `mooring.getWeather({ mooringId })` — incl. wind/wave protection scores.
- `mooring.listShops({ mooringId })`

### Regions

- `region.list({ page?, perPage?, allPages?, maxPages? })` — global index.
- `region.get({ regionId })`
- `region.listPorts({ regionId, page?, perPage?, allPages?, maxPages? })`
- `region.listMoorings({ regionId, page?, perPage?, allPages?, maxPages? })`

### Current user

- `me.listBoats()`
- `me.listLists()` / `me.listListEntries({ listId })` / `me.listListComments({ listId, page?, perPage?, allPages?, maxPages? })`
- `me.listCards()`
- `me.listNotifications()` / `me.getNotificationsCount()`
- `me.listDemands()` / `me.getDemandsInfos()` / `me.listDemandsOffers()`
- `me.getLastSubscription()`

### Reference

- `reference.listCountries()` → 251 countries with VHF channel and emergency phone.

### Proxy escape hatches

The typed actions above don't cover navily's full write surface (`POST
/demands/{id}/cancel`, `POST /boats/create`, `POST /users/update`, `POST
/ports/{id}/comments/create`, etc.) because the request body shapes aren't
fully reverse-engineered. For those, call the proxy directly:

- `proxy.get({ path, data? })`
- `proxy.post({ path, data? })`
- `proxy.put({ path, data? })`
- `proxy.patch({ path, data? })`
- `proxy.delete({ path, data? })`

```js
// e.g. cancel a booking demand
return await navily.proxy.post({ path: "/demands/12345/cancel" });
```

The full endpoint catalog with payload notes is at
[`../../docs/kb/navily-api-architecture.md`](../../docs/kb/navily-api-architecture.md).

## Notes

- One `cycletls` Go subprocess is spawned lazily on first action and reused
  for the lifetime of the runline process; cookie rotation creates a new
  subprocess.
- Paginated actions accept `page`/`perPage`; set `allPages: true` to aggregate
  every page, optionally capped by `maxPages`.

## License

MIT
