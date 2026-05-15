/**
 * runline plugin for navily.com.
 *
 * Exposes navily as JavaScript actions an agent can call from the QuickJS
 * sandbox. Pairs with `dripline-plugin-navily` (SQL reads) — runline is
 * better when you want to chain calls or perform writes.
 *
 * Action handlers run on the host (Node), not in the sandbox, so they
 * have full access to `cycletls` (Chrome JA3 impersonation) via
 * `@yosit/navily-cli`'s NavilyClient — required for Cloudflare-gated
 * www.navily.com / api.navily.com.
 *
 * Auth chain: connection.config.cookie -> NAVILY_COOKIE env ->
 * ~/.config/navily/cookie -> NAVILY_EMAIL/NAVILY_PASSWORD auto-auth.
 */
import type { ActionContext, RunlinePluginAPI } from "runline";
import {
  createStaticMapImage,
  downloadMedia,
  downloadStaticMapThumbnail,
  NavilyClient,
  type StaticMapMarker,
} from "@yosit/navily-cli";

// Reuse clients for the life of the process. The default auto-auth client
// shares ~/.config/navily/cookie with the CLI and uses the lock file there,
// so parallel commands/processes do not stampede login handshakes.
const clientCache = new Map<string, NavilyClient>();

function getConfiguredCookie(ctx: ActionContext): string | null {
  const fromConfig = ctx.connection?.config?.cookie;
  if (typeof fromConfig === "string" && fromConfig.trim()) {
    return fromConfig.trim();
  }
  return null;
}

function getClient(ctx: ActionContext): NavilyClient {
  const cookie = getConfiguredCookie(ctx);
  const key = cookie ? `cookie:${cookie}` : "auto";
  let client = clientCache.get(key);
  if (!client) {
    client = cookie ? new NavilyClient(cookie) : new NavilyClient();
    clientCache.set(key, client);
  }
  return client;
}

// ── input helpers ────────────────────────────────────────────────────────

function num(input: unknown, key: string): number {
  const v = (input as Record<string, unknown>)?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`missing or invalid required input '${key}' (expected number)`);
}

function str(input: unknown, key: string): string {
  const v = (input as Record<string, unknown>)?.[key];
  if (typeof v === "string" && v.length > 0) return v;
  throw new Error(`missing or invalid required input '${key}' (expected string)`);
}

function optStr(input: unknown, key: string): string | undefined {
  const v = (input as Record<string, unknown>)?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function optNum(input: unknown, key: string): number | undefined {
  const v = (input as Record<string, unknown>)?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function optBool(input: unknown, key: string): boolean {
  const v = (input as Record<string, unknown>)?.[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.toLowerCase());
  return false;
}

function pageOpts(input: unknown): {
  page?: number;
  perPage?: number;
  maxPages?: number;
} {
  return {
    page: optNum(input, "page"),
    perPage: optNum(input, "perPage"),
    maxPages: optNum(input, "maxPages"),
  };
}

function optCenter(input: unknown): { latitude: number; longitude: number } | undefined {
  const latitude = optNum(input, "latitude") ?? optNum(input, "centerLatitude");
  const longitude = optNum(input, "longitude") ?? optNum(input, "centerLongitude");
  return latitude === undefined || longitude === undefined
    ? undefined
    : { latitude, longitude };
}

function markers(input: unknown): StaticMapMarker[] {
  const record = (input as Record<string, unknown>) ?? {};
  const raw = record.markers ?? record.markersJson;
  if (raw === undefined || raw === null || raw === "") return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) {
    throw new Error("markers must be an array or markersJson must be a JSON array");
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`markers[${index}] must be an object`);
    }
    const row = item as Record<string, unknown>;
    const latitude = valueNum(row.latitude ?? row.lat);
    const longitude = valueNum(row.longitude ?? row.lng ?? row.lon);
    if (latitude === undefined || longitude === undefined) {
      throw new Error(`markers[${index}] must include latitude and longitude`);
    }
    return {
      latitude,
      longitude,
      label: typeof row.label === "string" ? row.label : undefined,
      color: typeof row.color === "string" ? row.color : undefined,
    };
  });
}

function valueNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// ── plugin ───────────────────────────────────────────────────────────────

export default function navily(rl: RunlinePluginAPI): void {
  rl.setName("navily");
  rl.setVersion("0.2.0");
  rl.setConnectionSchema({
    cookie: {
      type: "string",
      required: false,
      description:
        "Full navily.com cookie string (incl. navily_session, XSRF-TOKEN, cf_clearance). " +
        "If omitted, the plugin uses NAVILY_COOKIE, ~/.config/navily/cookie, or " +
        "NAVILY_EMAIL/NAVILY_PASSWORD auto-auth.",
      env: "NAVILY_COOKIE",
    },
  });

  // ── identity ─────────────────────────────────────────────────────────

  rl.registerAction("identity.whoami", {
    description: "Current session profile (status, name, email, avatar) — /ajax/get-session-data",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).whoami();
    },
  });

  rl.registerAction("identity.me", {
    description: "Authenticated user — full profile from /users/me",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).me();
    },
  });

  rl.registerAction("identity.user", {
    description: "Public profile for any user — /users/{userId}",
    inputSchema: {
      userId: { type: "number", required: true, description: "navily user id" },
    },
    async execute(input, ctx) {
      return getClient(ctx).user(num(input, "userId"));
    },
  });

  // ── search ───────────────────────────────────────────────────────────

  rl.registerAction("search.quick", {
    description: "Quick autocomplete-style search across ports, moorings, regions, users — /api/search",
    inputSchema: {
      q: { type: "string", required: true, description: "search query" },
    },
    async execute(input, ctx) {
      return getClient(ctx).quickSearch(str(input, "q"));
    },
  });

  rl.registerAction("search.places", {
    description: "Hybrid search across ports, moorings, users, shops, regions — /search/places",
    inputSchema: {
      query: { type: "string", required: true, description: "search query" },
      kinds: {
        type: "string",
        required: false,
        description: "comma-joined subset of port,mooring,user,shop,region (default all)",
      },
      limit: { type: "number", required: false, description: "max results per kind (default 6)" },
    },
    async execute(input, ctx) {
      return getClient(ctx).searchPlaces(str(input, "query"), {
        kinds: optStr(input, "kinds"),
        limit: optNum(input, "limit"),
      });
    },
  });

  rl.registerAction("search.boats", {
    description: "Standard boat catalog — /search/standard-boats. perPage must be ≥ 10.",
    inputSchema: {
      keyword: { type: "string", required: true, description: "boat name keyword" },
      perPage: { type: "number", required: false, description: "page size, ≥10 (default 10)" },
    },
    async execute(input, ctx) {
      return getClient(ctx).searchStandardBoats(str(input, "keyword"), optNum(input, "perPage") ?? 10);
    },
  });

  rl.registerAction("search.map", {
    description: "Spots near a coordinate within `distanceM` meters — /api/map-search",
    inputSchema: {
      latitude: { type: "number", required: true },
      longitude: { type: "number", required: true },
      distanceM: { type: "number", required: false, description: "search radius in meters (default 25000)" },
      kinds: {
        type: "string",
        required: false,
        description: "'port', 'mooring', or 'port,mooring' (default both)",
      },
    },
    async execute(input, ctx) {
      return getClient(ctx).mapSearch(
        num(input, "latitude"),
        num(input, "longitude"),
        optNum(input, "distanceM") ?? 25_000,
        optStr(input, "kinds"),
      );
    },
  });

  // ── rendered assets ─────────────────────────────────────────────────

  rl.registerAction("map.staticImage", {
    description:
      "Render a static SVG map with OSM tiles and optional markers. Writes an image file and returns {path, contentType, bytes}.",
    inputSchema: {
      latitude: { type: "number", required: false, description: "center latitude" },
      longitude: { type: "number", required: false, description: "center longitude" },
      zoom: { type: "number", required: false, description: "web mercator zoom, 1-19 (default 13)" },
      width: { type: "number", required: false, description: "image width px, 128-4096 (default 1024)" },
      height: { type: "number", required: false, description: "image height px, 128-4096 (default 768)" },
      markersJson: {
        type: "string",
        required: false,
        description:
          "JSON array of {latitude,longitude,label?,color?}. If center is omitted, markers are averaged for the center.",
      },
      markers: {
        type: "object" as const,
        required: false,
        description: "Array of {latitude,longitude,label?,color?}; markersJson is safer across strict runtimes.",
      },
      outputDir: { type: "string", required: false, description: "output directory (default NAVILY_OUTPUT_DIR or ./navily-output)" },
      filename: { type: "string", required: false, description: "output filename (default timestamped .svg)" },
      tileUrlTemplate: {
        type: "string",
        required: false,
        description:
          "tile URL template with {z}/{x}/{y}; defaults to OSM or NAVILY_TILE_URL_TEMPLATE",
      },
      tileProvider: {
        type: "string",
        required: false,
        description: "osm, esriWorldImagery, maptilerSatellite, mapboxSatellite",
      },
      tileApiKey: {
        type: "string",
        required: false,
        description: "MapTiler/Mapbox API key when using those satellite providers",
      },
    },
    async execute(input) {
      return createStaticMapImage({
        center: optCenter(input),
        markers: markers(input),
        zoom: optNum(input, "zoom"),
        width: optNum(input, "width"),
        height: optNum(input, "height"),
        outputDir: optStr(input, "outputDir"),
        filename: optStr(input, "filename"),
        tileUrlTemplate: optStr(input, "tileUrlTemplate"),
        tileProvider: optStr(input, "tileProvider"),
        tileApiKey: optStr(input, "tileApiKey"),
      });
    },
  });

  rl.registerAction("map.staticThumbnail", {
    description:
      "Download Navily's cached 460x250 static map thumbnail for a coordinate. Writes a JPG and returns {path, contentType, bytes}.",
    inputSchema: {
      latitude: { type: "number", required: true },
      longitude: { type: "number", required: true },
      outputDir: { type: "string", required: false, description: "output directory (default NAVILY_OUTPUT_DIR or ./navily-output)" },
      filename: { type: "string", required: false, description: "output filename (default coordinate-based .jpg)" },
    },
    async execute(input) {
      return downloadStaticMapThumbnail({
        latitude: num(input, "latitude"),
        longitude: num(input, "longitude"),
        outputDir: optStr(input, "outputDir"),
        filename: optStr(input, "filename"),
      });
    },
  });

  rl.registerAction("media.download", {
    description:
      "Download a Navily photo/media URL through the host using the shared Navily cookie session. Writes the bytes and returns {path, contentType, bytes}.",
    inputSchema: {
      url: { type: "string", required: true, description: "Navily photo/media URL" },
      outputDir: { type: "string", required: false, description: "output directory (default NAVILY_OUTPUT_DIR or ./navily-output)" },
      filename: { type: "string", required: false, description: "output filename; extension inferred from content type if missing" },
    },
    async execute(input, ctx) {
      return downloadMedia(getClient(ctx), {
        url: str(input, "url"),
        outputDir: optStr(input, "outputDir"),
        filename: optStr(input, "filename"),
      });
    },
  });

  // ── ports (marinas) ──────────────────────────────────────────────────

  rl.registerAction("port.get", {
    description: "Marina detail — /ports/{portId}",
    inputSchema: { portId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).port(num(input, "portId"));
    },
  });

  rl.registerAction("port.getWithMedia", {
    description: "Marina detail incl. photos, equipments, hours — /api/ports/get-with-media",
    inputSchema: { portId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).marinaWithMedia(num(input, "portId"));
    },
  });

  rl.registerAction("port.getPriceTonight", {
    description:
      "Tonight's berth price for a bookable marina — /api/map-search/price. Marinas only; anchorages 500.",
    inputSchema: { portId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).marinaPriceTonight(num(input, "portId"));
    },
  });

  rl.registerAction("port.getMyComment", {
    description: "Current user's own review on this marina — /ports/{portId}/comment",
    inputSchema: { portId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).portComment(num(input, "portId"));
    },
  });

  rl.registerAction("port.listComments", {
    description: "Paginated reviews — /ports/{portId}/comments. Set allPages=true to aggregate pages.",
    inputSchema: {
      portId: { type: "number", required: true },
      page: { type: "number", required: false },
      perPage: { type: "number", required: false },
      allPages: { type: "boolean", required: false },
      maxPages: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const client = getClient(ctx);
      const opts = pageOpts(input);
      return optBool(input, "allPages")
        ? client.portCommentsAll(num(input, "portId"), opts)
        : client.portComments(num(input, "portId"), opts);
    },
  });

  rl.registerAction("port.listPhotos", {
    description: "Paginated photos — /ports/{portId}/photos. Set allPages=true to aggregate pages.",
    inputSchema: {
      portId: { type: "number", required: true },
      page: { type: "number", required: false },
      perPage: { type: "number", required: false },
      allPages: { type: "boolean", required: false },
      maxPages: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const client = getClient(ctx);
      const opts = pageOpts(input);
      return optBool(input, "allPages")
        ? client.portPhotosAll(num(input, "portId"), opts)
        : client.portPhotos(num(input, "portId"), opts);
    },
  });

  rl.registerAction("port.listEquipments", {
    description: "Equipment list (water/electricity/fuel/wifi/showers/wc/recycling/…) — /ports/{portId}/equipments",
    inputSchema: { portId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).portEquipments(num(input, "portId"));
    },
  });

  rl.registerAction("port.getWeather", {
    description: "33-entry forecast — /ports/{portId}/weather",
    inputSchema: { portId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).portWeather(num(input, "portId"));
    },
  });

  rl.registerAction("port.listShops", {
    description: "Nearby shops — /ports/{portId}/shops",
    inputSchema: { portId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).portShops(num(input, "portId"));
    },
  });

  rl.registerAction("port.listBookableAround", {
    description: "Other bookable marinas around this one — /ports/{portId}/bookable-around-ports",
    inputSchema: {
      portId: { type: "number", required: true },
      portsCount: { type: "number", required: false, description: "max alternatives (default 12)" },
    },
    async execute(input, ctx) {
      return getClient(ctx).portBookableAround(num(input, "portId"), optNum(input, "portsCount") ?? 12);
    },
  });

  rl.registerAction("port.markVisited", {
    description:
      "Mark 'I've been here' on a marina — POST /ports/{portId}/discover. Side effect on the user's account.",
    inputSchema: { portId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).callProxy(`/ports/${num(input, "portId")}/discover`, "post");
    },
  });

  // ── moorings (anchorages) ────────────────────────────────────────────

  rl.registerAction("mooring.get", {
    description: "Anchorage detail — /moorings/{mooringId}",
    inputSchema: { mooringId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).mooring(num(input, "mooringId"));
    },
  });

  rl.registerAction("mooring.listComments", {
    description: "Paginated reviews — /moorings/{mooringId}/comments. Set allPages=true to aggregate pages.",
    inputSchema: {
      mooringId: { type: "number", required: true },
      page: { type: "number", required: false },
      perPage: { type: "number", required: false },
      allPages: { type: "boolean", required: false },
      maxPages: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const client = getClient(ctx);
      const opts = pageOpts(input);
      return optBool(input, "allPages")
        ? client.mooringCommentsAll(num(input, "mooringId"), opts)
        : client.mooringComments(num(input, "mooringId"), opts);
    },
  });

  rl.registerAction("mooring.listPhotos", {
    description: "Paginated photos — /moorings/{mooringId}/photos. Set allPages=true to aggregate pages.",
    inputSchema: {
      mooringId: { type: "number", required: true },
      page: { type: "number", required: false },
      perPage: { type: "number", required: false },
      allPages: { type: "boolean", required: false },
      maxPages: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const client = getClient(ctx);
      const opts = pageOpts(input);
      return optBool(input, "allPages")
        ? client.mooringPhotosAll(num(input, "mooringId"), opts)
        : client.mooringPhotos(num(input, "mooringId"), opts);
    },
  });

  rl.registerAction("mooring.getWeather", {
    description:
      "Forecast with wind/wave protection scores — /moorings/{mooringId}/weather",
    inputSchema: { mooringId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).mooringWeather(num(input, "mooringId"));
    },
  });

  rl.registerAction("mooring.listShops", {
    description: "Nearby shops — /moorings/{mooringId}/shops",
    inputSchema: { mooringId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).mooringShops(num(input, "mooringId"));
    },
  });

  // ── regions ──────────────────────────────────────────────────────────

  rl.registerAction("region.list", {
    description: "Global region index — /regions. Set allPages=true to aggregate pages.",
    inputSchema: {
      page: { type: "number", required: false },
      perPage: { type: "number", required: false },
      allPages: { type: "boolean", required: false },
      maxPages: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const client = getClient(ctx);
      const opts = pageOpts(input);
      return optBool(input, "allPages") ? client.regionsAll(opts) : client.regions(opts);
    },
  });

  rl.registerAction("region.get", {
    description: "Region detail — /regions/{regionId}",
    inputSchema: { regionId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).region(num(input, "regionId"));
    },
  });

  rl.registerAction("region.listPorts", {
    description: "Marinas in a region — /regions/{regionId}/ports. Set allPages=true to aggregate pages.",
    inputSchema: {
      regionId: { type: "number", required: true },
      page: { type: "number", required: false },
      perPage: { type: "number", required: false },
      allPages: { type: "boolean", required: false },
      maxPages: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const client = getClient(ctx);
      const opts = pageOpts(input);
      return optBool(input, "allPages")
        ? client.regionPortsAll(num(input, "regionId"), opts)
        : client.regionPorts(num(input, "regionId"), opts);
    },
  });

  rl.registerAction("region.listMoorings", {
    description: "Anchorages in a region — /regions/{regionId}/moorings. Set allPages=true to aggregate pages.",
    inputSchema: {
      regionId: { type: "number", required: true },
      page: { type: "number", required: false },
      perPage: { type: "number", required: false },
      allPages: { type: "boolean", required: false },
      maxPages: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const client = getClient(ctx);
      const opts = pageOpts(input);
      return optBool(input, "allPages")
        ? client.regionMooringsAll(num(input, "regionId"), opts)
        : client.regionMoorings(num(input, "regionId"), opts);
    },
  });

  // ── current user's data ──────────────────────────────────────────────

  rl.registerAction("me.listBoats", {
    description: "Your saved boats — /boats",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).boats();
    },
  });

  rl.registerAction("me.listLists", {
    description: "Your favourites lists — /lists",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).lists();
    },
  });

  rl.registerAction("me.listListEntries", {
    description: "Places saved in a list — /lists/{listId}/entries",
    inputSchema: { listId: { type: "number", required: true } },
    async execute(input, ctx) {
      return getClient(ctx).listEntries(num(input, "listId"));
    },
  });

  rl.registerAction("me.listListComments", {
    description: "Comments on a list — /lists/{listId}/comments. Set allPages=true to aggregate pages.",
    inputSchema: {
      listId: { type: "number", required: true },
      page: { type: "number", required: false },
      perPage: { type: "number", required: false },
      allPages: { type: "boolean", required: false },
      maxPages: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const client = getClient(ctx);
      const opts = pageOpts(input);
      return optBool(input, "allPages")
        ? client.listCommentsAll(num(input, "listId"), opts)
        : client.listComments(num(input, "listId"), opts);
    },
  });

  rl.registerAction("me.listCards", {
    description: "Your saved payment cards — /cards",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).cards();
    },
  });

  rl.registerAction("me.listNotifications", {
    description: "Your notifications — /notifications",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).notifications();
    },
  });

  rl.registerAction("me.getNotificationsCount", {
    description: "Last failed payment intents — /notifications/count",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).notificationsCount();
    },
  });

  rl.registerAction("me.listDemands", {
    description: "Your booking demands — /demands",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).demands();
    },
  });

  rl.registerAction("me.getDemandsInfos", {
    description:
      "Booking summary: hasActive, hasHistory, offersCount, nextConfirmedBooking, offerToBeConfirmed — /demands/infos",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).demandsInfos();
    },
  });

  rl.registerAction("me.listDemandsOffers", {
    description: "Marina offers awaiting your confirmation — /demands/offers",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).demandsOffers();
    },
  });

  rl.registerAction("me.getLastSubscription", {
    description: "Your last subscription record — /user-subscriptions/last",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).subscriptionLast();
    },
  });

  // ── reference ────────────────────────────────────────────────────────

  rl.registerAction("reference.listCountries", {
    description: "251 countries with VHF channel and emergency phone — /misc/countries",
    inputSchema: {},
    async execute(_input, ctx) {
      return getClient(ctx).countries();
    },
  });

  // ── proxy escape hatch ───────────────────────────────────────────────
  //
  // Lets agents call any documented api.navily.com endpoint without
  // waiting for a typed wrapper. Same auth/CSRF/Cloudflare guarantees as
  // typed actions. See docs/kb/navily-api-architecture.md
  // for the catalog (POST /demands/{id}/cancel, /boats/create, /users/update,
  // POST /ports/{id}/comments/create, etc.).

  function proxyAction(method: "get" | "post" | "put" | "patch" | "delete") {
    return {
      description:
        `${method.toUpperCase()} via /api/proxy. Provide the api.navily.com path ` +
        `(starting with /) and the request \`data\` body. Response is whatever ` +
        `the upstream Laravel endpoint returns; soft-404 surfaces as a thrown ` +
        `NotFoundError.`,
      inputSchema: {
        path: {
          type: "string" as const,
          required: true,
          description: "api.navily.com path, e.g. /demands/123/cancel or /users/update",
        },
        data: {
          type: "object" as const,
          required: false,
          description: "request body (optional; sent as JSON-equivalent form data)",
        },
      },
      async execute(input: unknown, ctx: ActionContext) {
        const path = str(input, "path");
        const data = ((input as Record<string, unknown>)?.data ?? {}) as Record<
          string,
          unknown
        >;
        return getClient(ctx).callProxy(path, method, data);
      },
    };
  }

  rl.registerAction("proxy.get", proxyAction("get"));
  rl.registerAction("proxy.post", proxyAction("post"));
  rl.registerAction("proxy.put", proxyAction("put"));
  rl.registerAction("proxy.patch", proxyAction("patch"));
  rl.registerAction("proxy.delete", proxyAction("delete"));
}
