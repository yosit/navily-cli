/**
 * dripline plugin for navily.com.
 *
 * Exposes navily marinas, anchorages, weather, reviews, regions, and the
 * authenticated user's boats/lists/bookings as DuckDB tables. Backed by the
 * NavilyClient from @yosit/navily-cli, which uses cycletls (Chrome JA3
 * impersonation) — required because both www.navily.com and api.navily.com
 * are Cloudflare-gated and reject Node's built-in HTTP clients.
 *
 * Auth: connection.config.cookie wins; falls back to NAVILY_COOKIE env var
 * or ~/.config/navily/cookie (whatever the navily CLI was set up with).
 */
import type { DriplinePluginAPI, QueryContext } from "dripline";
import { NavilyClient, loadCookie } from "@yosit/navily-cli";

// ── client lifecycle ─────────────────────────────────────────────────────
//
// cycletls spawns a Go subprocess on first use, so we cache one NavilyClient
// per distinct cookie for the life of the process. Different connections with
// different cookies coexist; rotating the cookie creates a new instance.

const clientCache = new Map<string, NavilyClient>();

function resolveCookie(ctx: QueryContext): string {
  const fromConfig = ctx.connection?.config?.cookie;
  if (typeof fromConfig === "string" && fromConfig.trim()) {
    return fromConfig.trim();
  }
  const fromDisk = loadCookie();
  if (fromDisk) return fromDisk;
  throw new Error(
    "No navily cookie. Set the `cookie` field on the dripline connection, " +
      "set NAVILY_COOKIE, or run `navily auth from-curl` (writes ~/.config/navily/cookie).",
  );
}

function getClient(ctx: QueryContext): NavilyClient {
  const cookie = resolveCookie(ctx);
  let client = clientCache.get(cookie);
  if (!client) {
    client = new NavilyClient(cookie);
    clientCache.set(cookie, client);
  }
  return client;
}

// ── small shape helpers ──────────────────────────────────────────────────

function qual(ctx: QueryContext, name: string): string | undefined {
  const v = ctx.quals.find((q) => q.column === name)?.value;
  return v === undefined || v === null ? undefined : String(v);
}

function qualNum(ctx: QueryContext, name: string): number | undefined {
  const s = qual(ctx, name);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Paginated<T>.data, raw array, or [single]. */
function* rows(payload: unknown): Generator<Record<string, unknown>> {
  if (payload == null) return;
  if (Array.isArray(payload)) {
    for (const r of payload) if (r && typeof r === "object") yield r as Record<string, unknown>;
    return;
  }
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    // Laravel-style paginated wrapper: { data: T[], links, meta }.
    if (Array.isArray(obj.data)) {
      for (const r of obj.data) if (r && typeof r === "object") yield r as Record<string, unknown>;
      return;
    }
    // www.navily.com search wrappers: { status, results: [...] }.
    if (Array.isArray(obj.results)) {
      for (const r of obj.results) if (r && typeof r === "object") yield r as Record<string, unknown>;
      return;
    }
    yield obj;
  }
}

const J = (v: unknown): string =>
  v === undefined || v === null ? "" : JSON.stringify(v);
const S = (v: unknown): string => (v == null ? "" : String(v));
const N = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
const B = (v: unknown): number => (v ? 1 : 0);

// Boolean type in dripline is stored as 0/1; we mirror the github plugin's choice.

// ── plugin ───────────────────────────────────────────────────────────────

export default function navily(dl: DriplinePluginAPI): void {
  dl.setName("navily");
  dl.setVersion("0.1.0");
  dl.setConnectionSchema({
    cookie: {
      type: "string",
      required: false,
      description:
        "Full navily.com cookie string (incl. navily_session, XSRF-TOKEN, cf_clearance). " +
        "If omitted, the plugin reads NAVILY_COOKIE or ~/.config/navily/cookie.",
      env: "NAVILY_COOKIE",
    },
  });

  // ── identity ─────────────────────────────────────────────────────────

  dl.registerTable("navily_whoami", {
    description: "Current session profile from /ajax/get-session-data",
    columns: [
      { name: "status", type: "boolean" },
      { name: "name", type: "string" },
      { name: "email", type: "string" },
      { name: "phone", type: "string" },
      { name: "avatar", type: "string" },
    ],
    async *list(ctx) {
      const r = (await getClient(ctx).whoami()) as unknown as Record<
        string,
        unknown
      >;
      yield {
        status: B(r.status),
        name: S(r.name),
        email: S(r.email),
        phone: S(r.phone),
        avatar: S(r.avatar),
      };
    },
  });

  const userColumns = [
    { name: "id", type: "number" as const },
    { name: "first_name", type: "string" as const },
    { name: "last_name", type: "string" as const },
    { name: "email", type: "string" as const },
    { name: "avatar", type: "string" as const },
    { name: "contributor_score", type: "number" as const },
    { name: "top_contributor", type: "boolean" as const },
    { name: "nationality", type: "string" as const },
    { name: "moorings_count", type: "number" as const },
    { name: "comments_count", type: "number" as const },
    { name: "boats_count", type: "number" as const },
    { name: "created_at", type: "datetime" as const },
    { name: "updated_at", type: "datetime" as const },
    { name: "raw", type: "json" as const },
  ];
  function userRow(u: Record<string, unknown>): Record<string, unknown> {
    const counts = (u.counts ?? {}) as Record<string, unknown>;
    return {
      id: N(u.id),
      first_name: S(u.firstName),
      last_name: S(u.lastName),
      email: S(u.email),
      avatar: S(u.avatar),
      contributor_score: N(u.contributorScore),
      top_contributor: B(u.topContributor),
      nationality: S(u.nationality),
      moorings_count: N(counts.moorings),
      comments_count: N(counts.comments),
      boats_count: N(counts.boats),
      created_at: S(u.createdAt),
      updated_at: S(u.updatedAt),
      raw: J(u),
    };
  }

  dl.registerTable("navily_me", {
    description: "Authenticated user — full profile from /users/me",
    columns: userColumns,
    async *list(ctx) {
      yield userRow(
        (await getClient(ctx).me()) as unknown as Record<string, unknown>,
      );
    },
  });

  dl.registerTable("navily_user", {
    description: "Public user profile — /users/{id}",
    columns: userColumns,
    keyColumns: [{ name: "id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "id");
      if (id === undefined) return;
      yield userRow(
        (await getClient(ctx).user(id)) as unknown as Record<string, unknown>,
      );
    },
  });

  // ── search ───────────────────────────────────────────────────────────

  dl.registerTable("navily_search", {
    description:
      "Quick autocomplete-style search across ports/moorings/users/regions — /api/search?q=…",
    columns: [
      { name: "q", type: "string" },
      { name: "id", type: "number" },
      { name: "kind", type: "string" },
      { name: "type", type: "string" },
      { name: "name", type: "string" },
      { name: "region_name", type: "string" },
      { name: "latitude", type: "number" },
      { name: "longitude", type: "number" },
      { name: "rating", type: "number" },
      { name: "url", type: "string" },
      { name: "picture", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "q", required: "required" }],
    async *list(ctx) {
      const q = qual(ctx, "q");
      if (!q) return;
      // Response is {status, results: {users, ports, moorings, shops, regions, counts}}.
      const resp = (await getClient(ctx).quickSearch(q)) as unknown as {
        results?: Record<string, unknown>;
      };
      const buckets = (resp.results ?? {}) as Record<string, unknown>;
      const kinds: Array<[string, string]> = [
        ["ports", "port"],
        ["moorings", "mooring"],
        ["regions", "region"],
        ["users", "user"],
        ["shops", "shop"],
      ];
      for (const [bucket, kind] of kinds) {
        const arr = buckets[bucket];
        if (!Array.isArray(arr)) continue;
        for (const row of arr as Record<string, unknown>[]) {
          const coord = (row.coordinate ?? {}) as Record<string, unknown>;
          const rating = row.rating;
          yield {
            q,
            id: N(row.id),
            kind: S(row.kind ?? kind),
            type: S(row.type),
            name: S(row.name ?? row.firstName),
            region_name: S(row.regionName),
            latitude: N(coord.latitude),
            longitude: N(coord.longitude),
            rating:
              typeof rating === "object" && rating
                ? N((rating as Record<string, unknown>).general)
                : N(rating),
            url: S(row.url),
            picture: S(row.picture ?? row.avatar),
            raw: J(row),
          };
        }
      }
    },
  });

  dl.registerTable("navily_search_places", {
    description:
      "Hybrid search across ports, moorings, users, shops, regions — /search/places",
    columns: [
      { name: "query", type: "string" },
      { name: "id", type: "number" },
      { name: "kind", type: "string" },
      { name: "name", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [
      { name: "query", required: "required" },
      { name: "kinds", required: "optional" },
      { name: "limit", required: "optional" },
    ],
    async *list(ctx) {
      const q = qual(ctx, "query");
      if (!q) return;
      const limit = qualNum(ctx, "limit");
      const kinds = qual(ctx, "kinds");
      const resp = (await getClient(ctx).searchPlaces(q, {
        limit,
        kinds,
      })) as { results?: Record<string, unknown> } | unknown;
      // /search/places mirrors the quick-search shape: results bucketed by kind.
      const buckets = ((resp as { results?: Record<string, unknown> }).results ??
        {}) as Record<string, unknown>;
      const kindMap: Array<[string, string]> = [
        ["ports", "port"],
        ["moorings", "mooring"],
        ["regions", "region"],
        ["users", "user"],
        ["shops", "shop"],
      ];
      for (const [bucket, kind] of kindMap) {
        const arr = buckets[bucket];
        if (!Array.isArray(arr)) continue;
        for (const row of arr as Record<string, unknown>[]) {
          yield {
            query: q,
            id: N(row.id),
            kind: S(row.kind ?? kind),
            name: S(row.name ?? row.firstName),
            raw: J(row),
          };
        }
      }
    },
  });

  dl.registerTable("navily_search_boats", {
    description: "Standard boat catalog — /search/standard-boats. per_page must be ≥ 10.",
    columns: [
      { name: "keyword", type: "string" },
      { name: "id", type: "number" },
      { name: "name", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [
      { name: "keyword", required: "required" },
      { name: "per_page", required: "optional" },
    ],
    async *list(ctx) {
      const keyword = qual(ctx, "keyword");
      if (!keyword) return;
      const perPage = qualNum(ctx, "per_page") ?? 10;
      const resp = await getClient(ctx).searchStandardBoats(keyword, perPage);
      for (const row of rows(resp)) {
        yield {
          keyword,
          id: N(row.id),
          name: S(row.name),
          raw: J(row),
        };
      }
    },
  });

  dl.registerTable("navily_map_search", {
    description:
      "Spots near a coordinate within max_distance meters — /api/map-search. " +
      "Pass center_latitude / center_longitude as STRINGS (dripline drops the decimal on float quals). " +
      "kinds='port' or 'mooring' filters.",
    columns: [
      { name: "id", type: "number" },
      { name: "kind", type: "string" },
      { name: "type", type: "string" },
      { name: "name", type: "string" },
      { name: "bookable", type: "boolean" },
      { name: "is_master", type: "boolean" },
      { name: "latitude", type: "number" },
      { name: "longitude", type: "number" },
      { name: "distance", type: "number" },
      { name: "region_name", type: "string" },
      { name: "timezone", type: "string" },
      { name: "rating", type: "number" },
      { name: "has_dock", type: "boolean" },
      { name: "has_hawser", type: "boolean" },
      { name: "has_mooring_buoy", type: "boolean" },
      { name: "has_pontoon", type: "boolean" },
      { name: "has_beach", type: "boolean" },
      { name: "has_shop", type: "boolean" },
      { name: "has_water_source", type: "boolean" },
      { name: "likes", type: "number" },
      { name: "comments", type: "number" },
      { name: "url", type: "string" },
      { name: "picture", type: "string" },
      { name: "raw", type: "json" },
    ],
    // Key columns use `center_*` / `max_distance` to avoid colliding with
    // the per-row output columns of the same name — DuckDB would otherwise
    // re-apply the WHERE on the returned rows and drop everything.
    keyColumns: [
      { name: "center_latitude", required: "required" },
      { name: "center_longitude", required: "required" },
      { name: "max_distance", required: "optional" },
      { name: "kinds", required: "optional" },
    ],
    async *list(ctx) {
      const latitude = qualNum(ctx, "center_latitude");
      const longitude = qualNum(ctx, "center_longitude");
      if (latitude === undefined || longitude === undefined) return;
      const distance = qualNum(ctx, "max_distance") ?? 25_000;
      const kinds = qual(ctx, "kinds");
      const resp = await getClient(ctx).mapSearch(
        latitude,
        longitude,
        distance,
        kinds,
      );
      for (const row of rows(resp)) {
        const coord = (row.coordinate ?? {}) as Record<string, unknown>;
        const counts = (row.counts ?? {}) as Record<string, unknown>;
        yield {
          id: N(row.id),
          kind: S(row.kind),
          type: S(row.type),
          name: S(row.name),
          bookable: B(row.bookable),
          is_master: B(row.isMaster),
          latitude: N(coord.latitude),
          longitude: N(coord.longitude),
          distance: N(row.distance),
          region_name: S(row.regionName),
          timezone: S(row.timezone),
          rating: N(row.rating),
          has_dock: B(row.hasDock),
          has_hawser: B(row.hasHawser),
          has_mooring_buoy: B(row.hasMooringBuoy),
          has_pontoon: B(row.hasPontoon),
          has_beach: B(row.hasBeach),
          has_shop: B(row.hasShop),
          has_water_source: B(row.hasWaterSource),
          likes: N(counts.likes),
          comments: N(counts.comments),
          url: S(row.url),
          picture: S(row.picture),
          raw: J(row),
        };
      }
    },
  });

  // ── ports (marinas) ──────────────────────────────────────────────────

  function portRow(p: Record<string, unknown>): Record<string, unknown> {
    const coord = (p.coordinate ?? {}) as Record<string, unknown>;
    const rating = (p.rating ?? {}) as Record<string, unknown>;
    const ratingDetails = (rating.details ?? {}) as Record<string, unknown>;
    const counts = (p.counts ?? {}) as Record<string, unknown>;
    return {
      id: N(p.id),
      name: S(p.name),
      type: S(p.type),
      plan: S(p.plan),
      is_premium: B(p.isPremium),
      is_master: B(p.isMaster),
      in_app_payments: B(p.inAppPayments),
      country_code: S(p.countryCode),
      city: S(p.city),
      language: S(p.language),
      phone: S(p.phone),
      vhf: S(p.vhf),
      max_draft: N(p.maxDraft),
      max_length: N(p.maxLength),
      place_number: N(p.placeNumber),
      accept_multihull: B(p.acceptMultihull),
      timezone: S(p.timezone),
      latitude: N(coord.latitude),
      longitude: N(coord.longitude),
      rating_general: N(rating.general),
      rating_welcoming: N(ratingDetails.welcoming),
      rating_cleanliness: N(ratingDetails.cleanliness),
      rating_services: N(ratingDetails.services),
      rating_shops: N(ratingDetails.shops),
      rating_tourism: N(ratingDetails.tourism),
      likes: N(counts.likes),
      comments: N(counts.comments),
      comments_with_message: N(counts.commentsWithMessage),
      users: N(counts.users),
      bookings: N(counts.bookings),
      response_rate: N(p.responseRate),
      email: S(p.email),
      currency: S(p.currency),
      website: S(p.website),
      tourist_tax: N(p.touristTax),
      url: S(p.url),
      time_since_last_connection: S(p.timeSinceLastConnection),
      raw: J(p),
    };
  }
  const portColumns = [
    { name: "id", type: "number" as const },
    { name: "name", type: "string" as const },
    { name: "type", type: "string" as const },
    { name: "plan", type: "string" as const },
    { name: "is_premium", type: "boolean" as const },
    { name: "is_master", type: "boolean" as const },
    { name: "in_app_payments", type: "boolean" as const },
    { name: "country_code", type: "string" as const },
    { name: "city", type: "string" as const },
    { name: "language", type: "string" as const },
    { name: "phone", type: "string" as const },
    { name: "vhf", type: "string" as const },
    { name: "max_draft", type: "number" as const },
    { name: "max_length", type: "number" as const },
    { name: "place_number", type: "number" as const },
    { name: "accept_multihull", type: "boolean" as const },
    { name: "timezone", type: "string" as const },
    { name: "latitude", type: "number" as const },
    { name: "longitude", type: "number" as const },
    { name: "rating_general", type: "number" as const },
    { name: "rating_welcoming", type: "number" as const },
    { name: "rating_cleanliness", type: "number" as const },
    { name: "rating_services", type: "number" as const },
    { name: "rating_shops", type: "number" as const },
    { name: "rating_tourism", type: "number" as const },
    { name: "likes", type: "number" as const },
    { name: "comments", type: "number" as const },
    { name: "comments_with_message", type: "number" as const },
    { name: "users", type: "number" as const },
    { name: "bookings", type: "number" as const },
    { name: "response_rate", type: "number" as const },
    { name: "email", type: "string" as const },
    { name: "currency", type: "string" as const },
    { name: "website", type: "string" as const },
    { name: "tourist_tax", type: "number" as const },
    { name: "url", type: "string" as const },
    { name: "time_since_last_connection", type: "string" as const },
    { name: "raw", type: "json" as const },
  ];

  dl.registerTable("navily_port", {
    description: "Marina detail — /ports/{id}",
    columns: portColumns,
    keyColumns: [{ name: "id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "id");
      if (id === undefined) return;
      yield portRow(
        (await getClient(ctx).port(id)) as Record<string, unknown>,
      );
    },
  });

  dl.registerTable("navily_port_with_media", {
    description: "Marina detail incl. photos/equipments/hours — /api/ports/get-with-media",
    columns: portColumns,
    keyColumns: [{ name: "id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "id");
      if (id === undefined) return;
      const resp = (await getClient(ctx).marinaWithMedia(id)) as {
        port?: Record<string, unknown>;
      };
      if (resp.port) yield portRow(resp.port);
    },
  });

  dl.registerTable("navily_port_price_tonight", {
    description:
      "Tonight's berth price for a bookable marina — /api/map-search/price. Marinas only; anchorages 500.",
    columns: [
      { name: "port_id", type: "number" },
      { name: "price_tonight", type: "number" },
      { name: "currency", type: "string" },
      { name: "price_night_with_currency", type: "string" },
    ],
    keyColumns: [{ name: "port_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "port_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).marinaPriceTonight(id);
      const r = (resp.result ?? {}) as Record<string, unknown>;
      yield {
        port_id: id,
        price_tonight: N(r.priceTonight),
        currency: S(r.currency),
        price_night_with_currency: S(r.priceNightWithCurrency),
      };
    },
  });

  dl.registerTable("navily_port_comments", {
    description: "Reviews on a marina — /ports/{id}/comments (page 1)",
    columns: [
      { name: "id", type: "number" },
      { name: "port_id", type: "number" },
      { name: "message_original", type: "string" },
      { name: "message_translated", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "port_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "port_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).portComments(id);
      for (const c of rows(resp)) {
        const msg = (c.message ?? {}) as Record<string, unknown>;
        yield {
          id: N(c.id),
          port_id: id,
          message_original: S(msg.original),
          message_translated: S(msg.translated),
          raw: J(c),
        };
      }
    },
  });

  dl.registerTable("navily_port_photos", {
    description: "Photos on a marina — /ports/{id}/photos (page 1)",
    columns: [
      { name: "id", type: "number" },
      { name: "port_id", type: "number" },
      { name: "mime", type: "string" },
      { name: "url", type: "string" },
      { name: "width", type: "number" },
      { name: "height", type: "number" },
      { name: "ratio", type: "number" },
      { name: "likes", type: "number" },
      { name: "dislikes", type: "number" },
      { name: "created_at", type: "datetime" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "port_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "port_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).portPhotos(id);
      for (const m of rows(resp)) {
        const size = (m.size ?? {}) as Record<string, unknown>;
        const counts = (m.counts ?? {}) as Record<string, unknown>;
        yield {
          id: N(m.id),
          port_id: id,
          mime: S(m.mime),
          url: S(m.url),
          width: N(size.width),
          height: N(size.height),
          ratio: N(m.ratio),
          likes: N(counts.likes),
          dislikes: N(counts.dislikes),
          created_at: S(m.createdAt),
          raw: J(m),
        };
      }
    },
  });

  dl.registerTable("navily_port_equipments", {
    description:
      "Equipment list (water/electricity/fuel/wifi/showers/wc/recycling/…) — /ports/{id}/equipments",
    columns: [
      { name: "port_id", type: "number" },
      { name: "key", type: "string" },
      { name: "name", type: "string" },
      { name: "icon", type: "string" },
      { name: "cost", type: "string" },
      { name: "access", type: "string" },
      { name: "value", type: "number" },
      { name: "details", type: "json" },
      { name: "is_available", type: "boolean" },
    ],
    keyColumns: [{ name: "port_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "port_id");
      if (id === undefined) return;
      const resp = (await getClient(ctx).portEquipments(id)) as unknown as Array<
        Record<string, unknown>
      >;
      for (const e of resp ?? []) {
        yield {
          port_id: id,
          key: S(e.key),
          name: S(e.name),
          icon: S(e.icon),
          cost: S(e.cost),
          access: S(e.access),
          value: N(e.value),
          details: J(e.details),
          is_available: B(e.isAvailable),
        };
      }
    },
  });

  dl.registerTable("navily_port_weather", {
    description: "33-entry forecast for a marina — /ports/{id}/weather",
    columns: [
      { name: "port_id", type: "number" },
      { name: "forecast_at", type: "datetime" },
      { name: "text", type: "string" },
      { name: "temperature", type: "number" },
      { name: "wave_height", type: "number" },
      { name: "wave_period", type: "number" },
      { name: "wave_direction", type: "number" },
      { name: "wind_speed", type: "number" },
      { name: "wind_direction", type: "number" },
      { name: "wind_gust", type: "number" },
      { name: "score", type: "number" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "port_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "port_id");
      if (id === undefined) return;
      const resp = (await getClient(ctx).portWeather(id)) as Array<
        Record<string, unknown>
      >;
      for (const e of resp ?? []) {
        const wave = (e.wave ?? {}) as Record<string, unknown>;
        const wind = (e.wind ?? {}) as Record<string, unknown>;
        yield {
          port_id: id,
          forecast_at: S(e.at),
          text: S(e.text),
          temperature: N(e.temperature),
          wave_height: N(wave.height),
          wave_period: N(wave.period),
          wave_direction: N(wave.direction),
          wind_speed: N(wind.speed),
          wind_direction: N(wind.direction),
          wind_gust: N(wind.gust),
          score: N(e.score),
          raw: J(e),
        };
      }
    },
  });

  dl.registerTable("navily_port_shops", {
    description: "Shops near a marina — /ports/{id}/shops",
    columns: [
      { name: "id", type: "number" },
      { name: "port_id", type: "number" },
      { name: "name", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "port_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "port_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).portShops(id);
      for (const s of rows(resp)) {
        yield { id: N(s.id), port_id: id, name: S(s.name), raw: J(s) };
      }
    },
  });

  dl.registerTable("navily_port_bookable_around", {
    description:
      "Other bookable marinas around this one — /ports/{id}/bookable-around-ports",
    columns: [
      { name: "id", type: "number" },
      { name: "port_id", type: "number" },
      { name: "name", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [
      { name: "port_id", required: "required" },
      { name: "ports_count", required: "optional" },
    ],
    async *list(ctx) {
      const id = qualNum(ctx, "port_id");
      if (id === undefined) return;
      const portsCount = qualNum(ctx, "ports_count") ?? 12;
      const resp = await getClient(ctx).portBookableAround(id, portsCount);
      for (const r of rows(resp)) {
        yield { id: N(r.id), port_id: id, name: S(r.name), raw: J(r) };
      }
    },
  });

  // ── moorings (anchorages) ────────────────────────────────────────────

  function mooringRow(m: Record<string, unknown>): Record<string, unknown> {
    const coord = (m.coordinate ?? {}) as Record<string, unknown>;
    const rating = m.rating;
    const counts = (m.counts ?? {}) as Record<string, unknown>;
    return {
      id: N(m.id),
      name: S(m.name),
      type: S(m.type),
      country_code: S(m.countryCode),
      timezone: S(m.timezone),
      latitude: N(coord.latitude),
      longitude: N(coord.longitude),
      protections: J(m.protections),
      seabeds: J(m.seabeds),
      has_dock: B(m.hasDock),
      has_hawser: B(m.hasHawser),
      has_mooring_buoy: B(m.hasMooringBuoy),
      authorize_anchor: B(m.authorizeAnchor),
      has_pontoon: B(m.hasPontoon),
      has_beach: B(m.hasBeach),
      has_shop: B(m.hasShop),
      has_water_source: B(m.hasWaterSource),
      rating_general:
        typeof rating === "object" && rating
          ? N((rating as Record<string, unknown>).general)
          : N(rating),
      likes: N(counts.likes),
      comments: N(counts.comments),
      url: S(m.url),
      raw: J(m),
    };
  }
  const mooringColumns = [
    { name: "id", type: "number" as const },
    { name: "name", type: "string" as const },
    { name: "type", type: "string" as const },
    { name: "country_code", type: "string" as const },
    { name: "timezone", type: "string" as const },
    { name: "latitude", type: "number" as const },
    { name: "longitude", type: "number" as const },
    { name: "protections", type: "json" as const },
    { name: "seabeds", type: "json" as const },
    { name: "has_dock", type: "boolean" as const },
    { name: "has_hawser", type: "boolean" as const },
    { name: "has_mooring_buoy", type: "boolean" as const },
    { name: "authorize_anchor", type: "boolean" as const },
    { name: "has_pontoon", type: "boolean" as const },
    { name: "has_beach", type: "boolean" as const },
    { name: "has_shop", type: "boolean" as const },
    { name: "has_water_source", type: "boolean" as const },
    { name: "rating_general", type: "number" as const },
    { name: "likes", type: "number" as const },
    { name: "comments", type: "number" as const },
    { name: "url", type: "string" as const },
    { name: "raw", type: "json" as const },
  ];

  dl.registerTable("navily_mooring", {
    description: "Anchorage detail — /moorings/{id}",
    columns: mooringColumns,
    keyColumns: [{ name: "id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "id");
      if (id === undefined) return;
      yield mooringRow(
        (await getClient(ctx).mooring(id)) as Record<string, unknown>,
      );
    },
  });

  dl.registerTable("navily_mooring_comments", {
    description: "Reviews on an anchorage — /moorings/{id}/comments (page 1)",
    columns: [
      { name: "id", type: "number" },
      { name: "mooring_id", type: "number" },
      { name: "message_original", type: "string" },
      { name: "message_translated", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "mooring_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "mooring_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).mooringComments(id);
      for (const c of rows(resp)) {
        const msg = (c.message ?? {}) as Record<string, unknown>;
        yield {
          id: N(c.id),
          mooring_id: id,
          message_original: S(msg.original),
          message_translated: S(msg.translated),
          raw: J(c),
        };
      }
    },
  });

  dl.registerTable("navily_mooring_photos", {
    description: "Photos on an anchorage — /moorings/{id}/photos (page 1)",
    columns: [
      { name: "id", type: "number" },
      { name: "mooring_id", type: "number" },
      { name: "mime", type: "string" },
      { name: "url", type: "string" },
      { name: "width", type: "number" },
      { name: "height", type: "number" },
      { name: "ratio", type: "number" },
      { name: "likes", type: "number" },
      { name: "dislikes", type: "number" },
      { name: "created_at", type: "datetime" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "mooring_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "mooring_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).mooringPhotos(id);
      for (const m of rows(resp)) {
        const size = (m.size ?? {}) as Record<string, unknown>;
        const counts = (m.counts ?? {}) as Record<string, unknown>;
        yield {
          id: N(m.id),
          mooring_id: id,
          mime: S(m.mime),
          url: S(m.url),
          width: N(size.width),
          height: N(size.height),
          ratio: N(m.ratio),
          likes: N(counts.likes),
          dislikes: N(counts.dislikes),
          created_at: S(m.createdAt),
          raw: J(m),
        };
      }
    },
  });

  dl.registerTable("navily_mooring_weather", {
    description:
      "Forecast for an anchorage with wind/wave protection scores — /moorings/{id}/weather",
    columns: [
      { name: "mooring_id", type: "number" },
      { name: "forecast_at", type: "datetime" },
      { name: "text", type: "string" },
      { name: "temperature", type: "number" },
      { name: "wave_height", type: "number" },
      { name: "wave_period", type: "number" },
      { name: "wave_direction", type: "number" },
      { name: "wind_speed", type: "number" },
      { name: "wind_direction", type: "number" },
      { name: "wind_gust", type: "number" },
      { name: "wind_protection_score", type: "number" },
      { name: "wave_protection_score", type: "number" },
      { name: "recommendation_score", type: "number" },
      { name: "score", type: "number" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "mooring_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "mooring_id");
      if (id === undefined) return;
      const resp = (await getClient(ctx).mooringWeather(id)) as Array<
        Record<string, unknown>
      >;
      for (const e of resp ?? []) {
        const wave = (e.wave ?? {}) as Record<string, unknown>;
        const wind = (e.wind ?? {}) as Record<string, unknown>;
        yield {
          mooring_id: id,
          forecast_at: S(e.at),
          text: S(e.text),
          temperature: N(e.temperature),
          wave_height: N(wave.height),
          wave_period: N(wave.period),
          wave_direction: N(wave.direction),
          wind_speed: N(wind.speed),
          wind_direction: N(wind.direction),
          wind_gust: N(wind.gust),
          wind_protection_score: N(e.windProtectionScore),
          wave_protection_score: N(e.waveProtectionScore),
          recommendation_score: N(e.recommendationScore),
          score: N(e.score),
          raw: J(e),
        };
      }
    },
  });

  dl.registerTable("navily_mooring_shops", {
    description: "Shops near an anchorage — /moorings/{id}/shops",
    columns: [
      { name: "id", type: "number" },
      { name: "mooring_id", type: "number" },
      { name: "name", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "mooring_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "mooring_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).mooringShops(id);
      for (const s of rows(resp)) {
        yield { id: N(s.id), mooring_id: id, name: S(s.name), raw: J(s) };
      }
    },
  });

  // ── regions ──────────────────────────────────────────────────────────

  function regionName(name: unknown): string {
    if (typeof name === "string") return name;
    if (name && typeof name === "object") {
      const m = name as Record<string, string>;
      return m.en ?? m.fr ?? Object.values(m)[0] ?? "";
    }
    return "";
  }

  dl.registerTable("navily_regions", {
    description: "Global region index — /regions (page 1)",
    columns: [
      { name: "id", type: "number" },
      { name: "name", type: "string" },
      { name: "slug", type: "string" },
      { name: "country_code", type: "string" },
      { name: "country_name", type: "string" },
      { name: "latitude", type: "number" },
      { name: "longitude", type: "number" },
      { name: "raw", type: "json" },
    ],
    async *list(ctx) {
      const resp = await getClient(ctx).regions();
      for (const r of rows(resp)) {
        const coord = (r.coordinate ?? {}) as Record<string, unknown>;
        const country = (r.country ?? {}) as Record<string, unknown>;
        yield {
          id: N(r.id),
          name: regionName(r.name),
          slug: S(r.slug),
          country_code: S(country.code),
          country_name: S(country.name),
          latitude: N(coord.latitude),
          longitude: N(coord.longitude),
          raw: J(r),
        };
      }
    },
  });

  dl.registerTable("navily_region", {
    description: "Region detail — /regions/{id}",
    columns: [
      { name: "id", type: "number" },
      { name: "name", type: "string" },
      { name: "slug", type: "string" },
      { name: "country_code", type: "string" },
      { name: "country_name", type: "string" },
      { name: "latitude", type: "number" },
      { name: "longitude", type: "number" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "id");
      if (id === undefined) return;
      const r = (await getClient(ctx).region(id)) as Record<string, unknown>;
      const coord = (r.coordinate ?? {}) as Record<string, unknown>;
      const country = (r.country ?? {}) as Record<string, unknown>;
      yield {
        id: N(r.id),
        name: regionName(r.name),
        slug: S(r.slug),
        country_code: S(country.code),
        country_name: S(country.name),
        latitude: N(coord.latitude),
        longitude: N(coord.longitude),
        raw: J(r),
      };
    },
  });

  dl.registerTable("navily_region_ports", {
    description: "Marinas in a region — /regions/{id}/ports (page 1)",
    columns: portColumns.map((c) =>
      c.name === "id" ? c : c,
    ).concat([{ name: "region_id", type: "number" as const }]),
    keyColumns: [{ name: "region_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "region_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).regionPorts(id);
      for (const p of rows(resp)) {
        yield { ...portRow(p), region_id: id };
      }
    },
  });

  dl.registerTable("navily_region_moorings", {
    description: "Anchorages in a region — /regions/{id}/moorings (page 1)",
    columns: mooringColumns.concat([
      { name: "region_id", type: "number" as const },
    ]),
    keyColumns: [{ name: "region_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "region_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).regionMoorings(id);
      for (const m of rows(resp)) {
        yield { ...mooringRow(m), region_id: id };
      }
    },
  });

  // ── personal ─────────────────────────────────────────────────────────

  dl.registerTable("navily_boats", {
    description: "Your saved boats — /boats",
    columns: [
      { name: "id", type: "number" },
      { name: "name", type: "string" },
      { name: "raw", type: "json" },
    ],
    async *list(ctx) {
      const resp = await getClient(ctx).boats();
      for (const b of rows(resp)) {
        yield { id: N(b.id), name: S(b.name), raw: J(b) };
      }
    },
  });

  dl.registerTable("navily_lists", {
    description: "Your favourites lists — /lists",
    columns: [
      { name: "id", type: "number" },
      { name: "name", type: "string" },
      { name: "raw", type: "json" },
    ],
    async *list(ctx) {
      const resp = await getClient(ctx).lists();
      for (const l of rows(resp)) {
        yield { id: N(l.id), name: S(l.name), raw: J(l) };
      }
    },
  });

  dl.registerTable("navily_list_entries", {
    description: "Places saved in a list — /lists/{id}/entries",
    columns: [
      { name: "list_id", type: "number" },
      { name: "id", type: "number" },
      { name: "kind", type: "string" },
      { name: "name", type: "string" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "list_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "list_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).listEntries(id);
      for (const e of rows(resp)) {
        yield {
          list_id: id,
          id: N(e.id),
          kind: S(e.kind),
          name: S(e.name),
          raw: J(e),
        };
      }
    },
  });

  dl.registerTable("navily_list_comments", {
    description: "Comments on a list — /lists/{id}/comments (page 1)",
    columns: [
      { name: "list_id", type: "number" },
      { name: "id", type: "number" },
      { name: "raw", type: "json" },
    ],
    keyColumns: [{ name: "list_id", required: "required" }],
    async *list(ctx) {
      const id = qualNum(ctx, "list_id");
      if (id === undefined) return;
      const resp = await getClient(ctx).listComments(id);
      for (const c of rows(resp)) {
        yield { list_id: id, id: N(c.id), raw: J(c) };
      }
    },
  });

  dl.registerTable("navily_cards", {
    description: "Your saved payment cards — /cards",
    columns: [
      { name: "id", type: "number" },
      { name: "raw", type: "json" },
    ],
    async *list(ctx) {
      const resp = await getClient(ctx).cards();
      for (const c of rows(resp)) {
        yield { id: N(c.id), raw: J(c) };
      }
    },
  });

  dl.registerTable("navily_notifications", {
    description: "Your notifications — /notifications",
    columns: [
      { name: "id", type: "number" },
      { name: "raw", type: "json" },
    ],
    async *list(ctx) {
      const resp = await getClient(ctx).notifications();
      for (const n of rows(resp)) {
        yield { id: N(n.id), raw: J(n) };
      }
    },
  });

  dl.registerTable("navily_demands", {
    description: "Your booking demands — /demands",
    columns: [
      { name: "id", type: "number" },
      { name: "raw", type: "json" },
    ],
    async *list(ctx) {
      const resp = await getClient(ctx).demands();
      for (const d of rows(resp)) {
        yield { id: N(d.id), raw: J(d) };
      }
    },
  });

  dl.registerTable("navily_demands_offers", {
    description: "Marina offers awaiting your confirmation — /demands/offers",
    columns: [
      { name: "id", type: "number" },
      { name: "raw", type: "json" },
    ],
    async *list(ctx) {
      const resp = await getClient(ctx).demandsOffers();
      for (const o of rows(resp)) {
        yield { id: N(o.id), raw: J(o) };
      }
    },
  });

  dl.registerTable("navily_subscription_last", {
    description: "Your last subscription record — /user-subscriptions/last",
    columns: [{ name: "raw", type: "json" }],
    async *list(ctx) {
      const r = await getClient(ctx).subscriptionLast();
      yield { raw: J(r) };
    },
  });

  dl.registerTable("navily_countries", {
    description: "251 countries with VHF channel and emergency phone — /misc/countries",
    columns: [
      { name: "id", type: "number" },
      { name: "code", type: "string" },
      { name: "calling_code", type: "string" },
      { name: "name", type: "string" },
      { name: "emergency_phone", type: "string" },
      { name: "vhf", type: "number" },
      { name: "flag", type: "string" },
    ],
    async *list(ctx) {
      const resp = (await getClient(ctx).countries()) as unknown as Array<
        Record<string, unknown>
      >;
      for (const c of resp ?? []) {
        yield {
          id: N(c.id),
          code: S(c.code),
          calling_code: S(c.callingCode),
          name: S(c.name),
          emergency_phone: S(c.emergencyPhone),
          vhf: N(c.vhf),
          flag: S(c.flag),
        };
      }
    },
  });
}
