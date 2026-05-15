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

This plugin lives in the `navily-cli` workspace and isn't published to npm.
Install from the repo by URL:

```bash
runline plugin install git:github.com/<your-fork>/navily-cli#packages/runline-plugin
```

Or wire it in programmatically:

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

### Ports (marinas) — reads

- `port.get({ portId })`
- `port.getWithMedia({ portId })` — incl. photos/equipments/hours.
- `port.getPriceTonight({ portId })` — marinas only; anchorages return 500.
- `port.getMyComment({ portId })` — current user's own review.
- `port.listComments({ portId })`
- `port.listPhotos({ portId })`
- `port.listEquipments({ portId })`
- `port.getWeather({ portId })` — 33-entry forecast.
- `port.listShops({ portId })`
- `port.listBookableAround({ portId, portsCount? })`

### Ports — writes

- `port.markVisited({ portId })` → mark "I've been here" (`POST /ports/{portId}/discover`). **Side effect on your account.**

### Moorings (anchorages)

- `mooring.get({ mooringId })`
- `mooring.listComments({ mooringId })`
- `mooring.listPhotos({ mooringId })`
- `mooring.getWeather({ mooringId })` — incl. wind/wave protection scores.
- `mooring.listShops({ mooringId })`

### Regions

- `region.list()` — global index.
- `region.get({ regionId })`
- `region.listPorts({ regionId })`
- `region.listMoorings({ regionId })`

### Current user

- `me.listBoats()`
- `me.listLists()` / `me.listListEntries({ listId })` / `me.listListComments({ listId })`
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
- Tables marked "(page 1)" only fetch the first Laravel page. Pagination
  loops aren't wired through `NavilyClient` yet.

## License

MIT
