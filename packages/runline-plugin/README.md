# runline-plugin-navily

[runline](https://github.com/Michaelliv/runline) plugin that turns
[navily.com](https://www.navily.com) into callable JS actions for agent code:
search, fetch marinas/anchorages/weather/reviews, look up regions, manage
your boats and bookings.

Pairs with [`dripline-plugin-navily`](../dripline-plugin) — dripline gives
you SQL `SELECT`s, runline gives you imperative actions you can chain
together. They share the same `NavilyClient` (cycletls / Chrome JA3
impersonation) so both get past Cloudflare with the same browser cookie.

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
        // Optional — falls back to NAVILY_COOKIE env, then ~/.config/navily/cookie.
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

A real browser session cookie is required (Cloudflare Turnstile gates the
login form, so credentials cannot be posted programmatically). Cookie sources,
in priority order:

1. The `cookie` field on the runline connection config.
2. `NAVILY_COOKIE` env var.
3. `~/.config/navily/cookie` (whatever `navily auth from-curl` wrote).

Cookie lifetime is roughly one hour; refresh from DevTools when calls start
failing with `CloudflareBlockedError` or `NavilyAuthError`.

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
[`../../../navily-kb/.napkin/specs/navily-api-architecture.md`](../../../navily-kb/.napkin/specs/navily-api-architecture.md).

## Notes

- One `cycletls` Go subprocess is spawned lazily on first action and reused
  for the lifetime of the runline process; cookie rotation creates a new
  subprocess.
- Tables marked "(page 1)" only fetch the first Laravel page. Pagination
  loops aren't wired through `NavilyClient` yet.

## License

MIT
