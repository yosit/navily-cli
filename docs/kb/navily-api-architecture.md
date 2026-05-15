---
title: Navily API Architecture
tags: [navily, api, architecture, endpoints, auth, cloudflare, laravel]
---

# Navily API Architecture

## TL;DR

- **Frontend**: `https://www.navily.com` (Laravel + Vue SPA). Cloudflare-gated.
- **Backend API**: `https://api.navily.com` (Laravel Sanctum / signed). Cloudflare-gated. Browser cannot call it directly (CORS).
- **Bridge**: `POST https://www.navily.com/api/proxy` with body `{url, method, data}` is a server-side proxy that forwards the SPA's calls to `api.navily.com` using the user's session.
- **Auth**: session cookie (`navily_session`, HttpOnly) + `XSRF-TOKEN` cookie. The XSRF value is sent in the `X-XSRF-TOKEN` header on every state-changing call.
- **Login**: the CLI can mint a session cookie browserlessly from `NAVILY_EMAIL`/`NAVILY_PASSWORD` using `cycletls`, or accept a pre-minted cookie via `NAVILY_COOKIE`.
- **TLS**: requests must impersonate Chrome (JA3 fingerprint). Plain curl and Node `https` can get a 403 Cloudflare challenge even with a valid session cookie. We use `cycletls` with a pinned Chrome-style JA3/user-agent.

## API Bases

| Base | URL | Purpose | Auth |
|------|-----|---------|------|
| Web + REST | `https://www.navily.com` | Pages, AJAX `/api/*` `/ajax/*`, proxy gateway | Laravel session cookie + `X-XSRF-TOKEN` |
| Backend (mobile) | `https://api.navily.com` | Resource API used by the mobile app & SPA proxy | Sanctum bearer (proxy-only from web) |
| Media CDN (signed) | `https://api.navily.com/mediaRouter/{token}` | Images/videos, token in path; supports `?w=W` resize | None |
| Media (alt) | `https://api.navily.com/media/{token}` | Newer media variant seen in JS bundle | None |
| Static map snapshots | `https://www.navily.com/static_cache/460x250-{lat}_{lon}.jpg` | Cached map thumbnails | None |
| Video CDN | `https://cdn.navily.com/videos/...` | Homepage videos | None |

## Authentication

**Type**: Laravel server-session.

Cookies (set by login on `www.navily.com`):

| Cookie | Purpose | HttpOnly | Used as |
|--------|---------|----------|---------|
| `navily_session` | Server session (encrypted) | yes | Identifies the user |
| `XSRF-TOKEN` | CSRF token (encrypted) | no | URL-decoded → `X-XSRF-TOKEN` header |
| `cf_clearance` | Cloudflare bot pass, bound to TLS+IP | yes | Must accompany every request |
| `__stripe_mid` / `__stripe_sid` | Stripe analytics | — | Irrelevant for API |
| `crisp-client/...` | Crisp chat widget | — | Irrelevant for API |

### `whoami` endpoint

```
GET /ajax/get-session-data
Cookie: <full cookie string>
X-Requested-With: XMLHttpRequest
→ 200 {"status": true, "name": "...", "phone": null, "email": "...", "avatar": ""}
```

Unauthenticated returns `{"status": false}` (verified by elimination, not yet by a test).

### Login and refresh

The CLI reproduces the web login flow over `cycletls`:

1. `GET /` to bootstrap the anonymous Laravel session and XSRF cookie.
2. `POST /api/proxy` for `/users/check-email`.
3. `POST /api/proxy` for `/users/validated-email`.
4. `POST /login` with `{email, password}`.
5. `GET /ajax/get-session-data` to verify the authenticated session.

If Cloudflare rejects browserless login, `NAVILY_COOKIE` can still inject a pre-minted cookie, and `navily auth login --browser` can mint one through Chrome.

## Two API surfaces

### 1. Direct AJAX on www.navily.com

| Method | Path | Purpose | Notes |
|--------|------|---------|-------|
| GET | `/ajax/get-session-data` | Whoami | Returns `{status, name, phone, email, avatar}` |
| GET | `/api/search?q={q}` | Quick search | Hybrid; returns `{status, results: […]}` |
| GET | `/api/map-search?latitude=&longitude=&distance=[&kinds=]` | Spots near coordinate | `kinds` is `port,mooring` (or one) |
| GET | `/api/map-search/price?id={portId}` | Tonight's price for a bookable marina | Marinas only; anchorages → 500 |
| GET | `/api/ports/get-with-media?id={portId}` | Full marina detail incl. medias, equipments, hours, visits | Marinas only |
| GET | `/api/markdown-to-html?text={md}` | Server-side markdown render | Returns HTML body (text/html) |
| POST | `/api/proxy` | Gateway to api.navily.com | Body: `{url, method, data}` |

`/api/files/{remove-local|upload-local|upload-to-api-from-web}` exist in the JS bundle but are upload-only; not implemented in the CLI.

### 2. Proxied api.navily.com endpoints

All called via `POST /api/proxy` with JSON body `{url, method, data}`. The proxy returns `{"message": "The route X could not be found."}` for unknown routes — surfaced by the client as `NotFoundError`.

#### User
| Method | Path | Description |
|--------|------|-------------|
| GET | `/users/me` | Full current-user profile (incl. configuration: language/currency/units) |
| GET | `/users/{id}` | Public user profile |
| POST | `/users/update` | Update profile fields |
| POST | `/users/check-email` | Email availability |
| POST | `/users/check-password` | Verify password (sensitive op) |
| POST | `/users/forgotten` | Password reset request |
| POST | `/users/register-with-otp` | Register via OTP |
| POST | `/users/update/password` | Change password |
| POST | `/users/update/identity` | Update identity document |
| POST | `/users/update/identity/remove` | Remove identity doc |
| POST | `/users/billing-info` | Billing details |
| POST | `/users/validated-email` | Confirm email |

#### Ports (marinas)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/ports/{id}` | Full marina detail (same shape as `/api/ports/get-with-media`) |
| GET | `/ports/{id}/comment` | Current user's own comment on this marina |
| GET | `/ports/{id}/comments` | Paginated reviews + replies, with English translations |
| GET | `/ports/{id}/photos` | Paginated photos |
| GET | `/ports/{id}/equipments` | Equipment list (water/electricity/fuel/wifi/showers/wc/recycling/…) |
| GET | `/ports/{id}/services` | Returns `{message: ""}` — placeholder |
| GET | `/ports/{id}/weather` | 33-entry weather forecast (3-hourly?) |
| GET | `/ports/{id}/shops` | Nearby shops |
| GET | `/ports/{id}/bookable-around-ports` | Other bookable marinas around this one. Optional `data.portsCount` (default 12) |
| GET | `/ports/{id}/hashed` | Hashed booking flow — needs a valid demand hash |
| POST | `/ports/{id}/discover` | Mark "I've been here" |
| POST | `/ports/{id}/comments/create` | Post a review |
| POST | `/ports/comments/{commentId}/update` | Edit a review |
| POST | `/ports/api-access-identifiers` | Navily Pro (marina staff) login |

#### Moorings (anchorages)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/moorings/{id}` | Full anchorage detail |
| GET | `/moorings/{id}/comments` | Paginated reviews |
| GET | `/moorings/{id}/photos` | Paginated photos |
| GET | `/moorings/{id}/weather` | Forecast with `wind`, `wave`, `windProtectionScore`, `waveProtectionScore`, `recommendationScore` |
| GET | `/moorings/{id}/shops` | Nearby shops |

Note: no `/equipments`, `/services`, `/comment`, `/bookable-around-ports` on moorings.

#### Regions (geographic hierarchy)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/regions` | Paginated index of all regions globally |
| GET | `/regions/{id}` | Region detail (country, coordinate) |
| GET | `/regions/{id}/ports` | Paginated marinas in a region |
| GET | `/regions/{id}/moorings` | Paginated anchorages in a region |

#### Search
| Method | Path | Description |
|--------|------|-------------|
| GET | `/search/places` | Hybrid search. **Required data**: `query_string`, `query_limit`, `kinds`. `kinds` ∈ {port, mooring, user, shop, region}, comma-joined |
| GET | `/search/standard-boats` | Standard boat catalog. **Required data**: `keyword`, `per_page` (`>=10`) |

#### Lists (favourites)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/lists` | User's lists |
| GET | `/lists/{id}/entries` | Places in a list (array, may be empty) |
| GET | `/lists/{id}/comments` | Paginated list comments |

`/lists/{id}` (without `/entries`) returns "route not found".

#### Boats
| Method | Path | Description |
|--------|------|-------------|
| GET | `/boats` | User's boats (Laravel pagination resource) |
| POST | `/boats/create` | Add a boat |
| POST | `/boats/{id}/update` | Update a boat |
| POST | `/boats/{id}/document` | Upload boat document |
| POST | `/boats/{id}/document/remove` | Remove document |

`/boats/{id}` GET returns 500 "The boat does not exist" — endpoint exists but expects an id you own.

#### Demands (booking requests)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/demands` | Your booking demands |
| GET | `/demands/infos` | Summary: `{hasActive, hasHistory, offersCount, nextConfirmedBooking, offerToBeConfirmed}` |
| GET | `/demands/offers` | Marina offers awaiting your confirmation |
| GET | `/demands/{id}/messages` | Conversation thread |
| POST | `/demands/{id}/send` | Send a booking demand |
| POST | `/demands/{id}/confirm` | Confirm an offer |
| POST | `/demands/{id}/cancel` | Cancel |
| POST | `/demands/{id}/check-in-time` | Update check-in time |

#### Resalib (hashed/guest booking variants)
Booking flow accessible by hash without a session. Same verbs as `/demands` but under `/resalib/demands/{id}/hashed/...`. Endpoints include `/messages`, `/email`, `/identity`, `/boats/document`, `/stripe/setup-intent`, `/cancel`, `/confirm-offer`, `/check-email-taken`, `/media/{id}` (DELETE).

#### Subscriptions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/user-subscriptions/last` | Last subscription record |
| GET | `/user-subscriptions/promotion-code/check` | Validate promo code |
| GET | `/user-subscriptions/stripe/navily-premium` | Stripe setup info |
| POST | `/user-subscriptions/create/premium-yearly/web` | Subscribe |
| POST | `/user-subscriptions/payment-intent` | Create payment intent |
| POST | `/user-subscriptions/payment-intents/{id}/stripe-infos` | Stripe extras |
| POST | `/user-subscriptions/{id}/cancel/web` | Cancel |
| POST | `/user-subscriptions/{id}/active-renewal/web` | Re-enable auto-renewal |

#### Cards
| Method | Path | Description |
|--------|------|-------------|
| GET | `/cards/sca/setup-intent` | Stripe SCA setup |
| POST | `/cards/sca/create` | Create card |
| POST | `/cards/{id}/remove` | Remove card |
| GET | `/cards` | List cards |

#### OTP
- `POST /otp/email/check`, `POST /otp/email/create`
- `POST /otp/phone/check`, `POST /otp/phone/create`

#### Misc / utility
| Method | Path | Description |
|--------|------|-------------|
| GET | `/misc/countries` | 251 countries: `{id, code, callingCode, name, emergencyPhone, vhf, flag}` |
| GET | `/notifications` | User notifications |
| GET | `/notifications/count` | `{lastPaymentIntentFailed, lastPremiumPaymentIntentFailed}` — not a plain count |
| POST | `/logs/action` | Client-side analytics |
| POST | `/medias/{id}/delete` | Delete a media |
| GET | `/zoho-invoices/{id}/url` | Zoho invoice link |

## Entity Shapes

### Marina (port)
```ts
interface Port {
  id: number;
  kind: "port";
  name: string;
  type: "aflot" | string;      // observed only "aflot" so far
  plan: "basic" | "master";
  isPremium: boolean;
  isMaster: boolean;
  inAppPayments: boolean;
  termsValidated: boolean;
  mooringTypes: ("mooring_line" | "quay_dock" | string)[] | null;
  coordinate: { latitude: number; longitude: number };
  dms: string; dm: string;     // formatted coordinate strings
  countryCode: string;         // ISO-3166-1 alpha-2
  city: string | null;
  language: string;            // BCP-47-ish, lowercase
  phone: string | null;
  vhf: string | null;
  maxDraft: number | null;     // meters
  maxLength: number | null;    // meters
  placeNumber: number | null;  // berth count
  acceptMultihull: boolean;
  timezone: string;            // IANA, e.g. "Europe/Paris"
  rating: {
    general: number;
    details: { welcoming: number; cleanliness: number; services: number; shops: number; tourism: number };
  };
  gasStation: GasStation | null;
  counts: { likes: number; comments: number; commentsWithMessage: number; users: number; bookings: number };
  partnerLinks: string[];
  timeSinceLastConnection: string | null;  // human-readable, e.g. "Marina connected 16 h ago"
  medias: Media[];             // photo gallery
  documents: { id: number; type: "plan" | string; media: Media; createdAt: string; updatedAt: string }[];
  userComment: Comment | null;
  responseRate: number | null; // 0–100
  email: string | null;
  description: string;         // HTML
  presentation: string;        // plain-text counterpart
  touristTax: number | null;
  hasCouplePlacement: boolean;
  listIds: number[];           // lists this user has saved it in
  permissions: { demand: 0|1; addPhoto: 0|1; info: 0|1; list: 0|1; like: 0|1; report: 0|1; comment: 0|1; book: 0|1 };
  shops: Shop[];
  nearbyShops: { premium: Shop[]; categories: { id: number; label: string; slug: string; shopsCount: number }[] };
  currency: string;            // ISO-4217
  currencySymbol: string;
  website: string | null;
  events: unknown[];
  visits: Visit[];             // webcams / tourism links
  price: unknown | null;
  equipments: Equipment[];     // see Equipment shape
  demand: { maximumDays: number; maximumAnticipation: number; maximumHour: number; isDisabledTonight: boolean; response: { averageTime: number; percent: number }; next: unknown | null; stopId: number | null };
  userEmails: string[];
  notificationEmails: string[];
  hours: PortHours;
  breadcrumbs: Breadcrumb[];   // country → region → … → port
  url: string;                 // relative web URL, e.g. "/port/sanary-sur-mer/301"
  media: { url: string };      // primary cover (static_cache thumb)
}
```

### Mooring (anchorage)
Similar to Port but without `equipments`, `hours`, `demand`, `placeNumber`, `maxLength`, `gasStation`, `inAppPayments`, `mooringTypes`. Adds:
```ts
interface Mooring {
  id: number;
  kind: "mooring";
  type: "anchor" | string;
  name: string;
  protections: ("n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"nw")[];
  seabeds: ("sand"|"rock"|"algae"|"mud"|"weed"|"shells"|"gravel")[];
  hasDock: boolean;
  hasHawser: boolean;
  hasMooringBuoy: boolean;
  authorizeAnchor: boolean;
  hasPontoon: boolean;
  hasBeach: boolean;
  hasShop: boolean;
  hasWaterSource: boolean;
  alert: unknown | null;
  // …common fields: coordinate, timezone, rating, counts, medias, breadcrumbs, url
}
```

### Equipment
```ts
interface Equipment {
  key: "electricity"|"water"|"shower"|"wc"|"fuel"|"used_water"|"wifi"|"launching_ramp"|"recycling"|"bike"|"car_rental"|"camera"|"night_watchman"|"launderette"|"ice"|"shipchandler"|"customs_clearance"|"crane";
  name: string;                 // localised label
  icon: string;                 // https URL
  cost: "included"|"free"|null;
  access: "controlled"|"24"|null;
  value: number | null;         // e.g. count of showers
  details: string[];            // human-readable bullet lines
  isAvailable: boolean;
}
```

### Weather entry
Port weather:
```ts
interface PortForecast {
  at: string;                    // ISO timestamp
  text: string;                  // headline
  texts: string[];               // detail lines
  icon: string;
  temperature: number;
  wave: { height: number; period?: number; direction?: number };
  wind: { speed: number; direction: number; gust?: number };
  guess: string;
  score: number;
}
```

Anchorage weather adds `windProtectionScore`, `waveProtectionScore`, `recommendationScore`.

### Comment / review
```ts
interface Comment {
  id: number;
  message: { original: string; translated: string };
  // + author, date, rating, replies (TODO: probe deeper)
}
```

### User
```ts
interface User {
  id: number;
  firstName: string;
  lastName?: string;             // visible on self only
  email?: string;                // self only
  avatar: string | null;
  contributorScore: number;
  topContributor: boolean;
  itineraryAllowed: boolean;
  reporter: boolean;
  alert: unknown | null;
  boat: Boat | null;
  counts: { boats?: number; moorings: number; comments?: number };
  createdAt?: string;            // ISO
  updatedAt?: string;            // ISO
  description: string | null;
  nationality: string | null;    // ISO 3166-1 alpha-2 (self only)
  configuration?: { language: string; advertisable: boolean; currency: string; /* … */ };
}
```

### Region
```ts
interface Region {
  id: number;
  name: string | Record<string, string>;  // index returns localised map: {en, fr, es, it, de}
  slug: string;
  slugs?: Record<string, string>;
  coordinate: { latitude: number; longitude: number };
  country?: { id: number; code: string; callingCode: string; name: string; emergencyPhone: string; vhf: number; flag: string };
}
```

### Country
```ts
interface Country {
  id: number;
  code: string;        // ISO 3166-1 alpha-2
  callingCode: string;
  name: string;
  emergencyPhone: string;
  vhf: number;         // VHF channel
  flag: string;        // URL
}
```

### Pagination (Laravel resource format)
```ts
interface Paginated<T> {
  data: T[];
  links: { first: string; last: string; prev: string | null; next: string | null };
  meta: {
    current_page: number;
    last_page: number;
    from: number | null;
    to: number | null;
    total?: number;
    path: string;
    per_page?: number;
    links: { url: string | null; label: string; active: boolean }[];
  };
}
```

## Datetimes & Timezones

- All API datetimes are ISO 8601 with `+00:00` offset (UTC): e.g. `"2022-05-22T15:02:01+00:00"`.
- Each spot (port/mooring) carries an IANA `timezone` field (e.g. `"Europe/Paris"`). Use it for displaying local time at the spot.
- `hours.harbourOffice.week[]` and similar carry `weekday: 0..6` (Monday=0 inferred from data) plus local `HH:MM:SS` times (no timezone) — interpret in the port's `timezone`.
- `gasStation.updatedAt` and `createdAt` are `YYYY-MM-DD` (no time).
- Null sentinels: many optional datetime fields use plain `null`.

## Error Reference

| Status | Body shape | Meaning |
|--------|-----------|---------|
| 403 (HTML "Just a moment…") | HTML | Cloudflare challenge — refresh/re-mint the session cookie |
| 401 | `{"message": "Unauthenticated."}` | Sanctum / session invalid |
| 419 | (HTML) | Stale `XSRF-TOKEN` cookie |
| 405 | HTML "Method Not Allowed" | Wrong HTTP verb on otherwise-valid path |
| 422 | `{"message": "...", "errors": {field: [msg]}}` | Laravel validation failure |
| 429 | HTML "Too Many Requests" | Rate limiting (per-IP; observed on `/api/proxy`) |
| 500 (proxy body) | `{"message": "The signature is invalid."}` | Required `data` fields missing or wrong shape (HMAC over the payload). Send the data shape the JS calls use. |
| 500 (proxy body) | `{"message": "<resource> does not exist."}` | Valid endpoint, missing/invalid id |
| 200 (proxy body) | `{"message": "The route X could not be found."}` | Soft-404 from the proxy — the upstream Laravel route doesn't exist. Status code is 200; check the message. |

## Silent failures

- `/api/map-search/price` only works for **marinas**. For anchorages it returns 500 (not 404) — the endpoint is shared but pricing isn't defined.
- `/ports/{id}/services` exists but returns `{"message": ""}` — placeholder/stub.

## Server quirks

| Quirk | Affected | Workaround |
|-------|----------|------------|
| Cloudflare TLS fingerprint requirement | Every endpoint | Use `cycletls` Chrome impersonation. Plain curl/Node can fail with 403 |
| Soft-404 from proxy (200 + message) | All `/api/proxy` calls | Inspect `message`, treat "could not be found" as 404 |
| HAR cookie sanitisation | Browser HAR exports | Cookies stripped from HAR by Brave/Chrome — must re-capture via "Copy as cURL" |
| URL paths in French | Public web URLs | `/port/...` (marina), `/mouillage/...` (anchorage). API uses English `port`/`mooring` |
| Cookie rotation | Every endpoint | Re-mint or refresh the cookie when auth/Cloudflare errors occur |
| Pagination query string vs `data` | Proxy GETs | Append query params to `data` map, not to `url` — appending `?per_page=N` triggers signature error |
| `gasStation.updatedAt` is date-only | Port detail | `YYYY-MM-DD`, no time |
| Some endpoints CORS-blocked direct | `api.navily.com/*` | Use `/api/proxy` from web; mobile app uses Bearer token directly |
| HMAC signing on some `data` shapes | `/search/*`, paginated query params | Required `data` keys: `/search/places` needs `query_string,query_limit,kinds`; `/search/standard-boats` needs `keyword,per_page>=10` |
