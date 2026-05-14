/**
 * HTTP client for navily.com.
 *
 * Auth model
 * ----------
 * Navily uses a Laravel session cookie + XSRF-TOKEN cookie. Both are gated
 * by Cloudflare's Turnstile anti-bot challenge, so programmatic login is
 * not possible. The CLI accepts a session cookie obtained from a real
 * browser (see `navily auth from-curl` or `navily auth set`).
 *
 * TLS fingerprinting
 * ------------------
 * Cloudflare's `cf_clearance` cookie is bound to the browser's TLS
 * fingerprint (JA3). Node's built-in `https` and `fetch` get a 403
 * challenge page even with a valid clearance cookie. We use `cycletls`,
 * which wraps a small Go binary that performs Chrome-grade TLS
 * impersonation.
 *
 * Two URL surfaces
 * ----------------
 * 1. Direct AJAX on www.navily.com (`/ajax/...`, `/api/...`).
 * 2. Proxied: POST `/api/proxy` with body `{url, method, data}`. The
 *    Laravel server forwards to api.navily.com using the user's session.
 *
 * A 419 status indicates a stale CSRF token; the CLI surfaces that as
 * `NavilyAuthError`. A 401/403 plus a Cloudflare challenge HTML triggers
 * `CloudflareBlockedError`.
 */
import { createRequire } from "node:module";
import type { CycleTLSClient, CycleTLSResponse } from "cycletls";
import { getXsrfToken } from "./config.js";

// cycletls exports a function via CJS `module.exports = initCycleTLS`. TS's
// NodeNext resolution surfaces it as a namespace, so we side-load it via
// createRequire and assert the call signature.
const initCycleTLS = createRequire(import.meta.url)("cycletls") as
  (opts?: { port?: number; debug?: boolean }) => Promise<CycleTLSClient>;

export const WEB_BASE = "https://www.navily.com";
const DEFAULT_TIMEOUT_MS = 30_000;

const CHROME_JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type CycleTLSInstance = CycleTLSClient;

export class NavilyError extends Error {
  status?: number;
  url?: string;
  body?: unknown;
  constructor(
    message: string,
    opts: { status?: number; url?: string; body?: unknown } = {},
  ) {
    super(message);
    this.name = "NavilyError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

export class NavilyAuthError extends NavilyError {
  constructor(message: string, opts?: { status?: number; url?: string; body?: unknown }) {
    super(message, opts);
    this.name = "NavilyAuthError";
  }
}

export class CloudflareBlockedError extends NavilyError {
  constructor(message: string, opts?: { status?: number; url?: string; body?: unknown }) {
    super(message, opts);
    this.name = "CloudflareBlockedError";
  }
}

export class NotFoundError extends NavilyError {
  constructor(message: string, opts?: { status?: number; url?: string; body?: unknown }) {
    super(message, opts);
    this.name = "NotFoundError";
  }
}

export interface NavilyClientOptions {
  timeout?: number;
  referer?: string;
}

interface ProxyBody {
  url: string;
  method: string;
  data: Record<string, unknown>;
}

export class NavilyClient {
  private readonly cookie: string;
  private readonly xsrf: string;
  private readonly timeout: number;
  private readonly referer: string;
  private cycleTlsPromise: Promise<CycleTLSInstance> | null = null;

  constructor(cookie: string, opts: NavilyClientOptions = {}) {
    if (!cookie) {
      throw new NavilyAuthError(
        "No cookie provided. Run `navily auth set` or set NAVILY_COOKIE.",
      );
    }
    this.cookie = cookie;
    this.xsrf = getXsrfToken(cookie);
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
    this.referer = opts.referer ?? `${WEB_BASE}/carte`;
  }

  /** Release the cycletls Go subprocess. Call after the last request. */
  async close(): Promise<void> {
    const p = this.cycleTlsPromise;
    if (p) {
      this.cycleTlsPromise = null;
      const t = await p;
      await t.exit();
    }
  }

  private cycleTls(): Promise<CycleTLSInstance> {
    if (!this.cycleTlsPromise) {
      this.cycleTlsPromise = initCycleTLS();
    }
    return this.cycleTlsPromise;
  }

  private baseHeaders(): Record<string, string> {
    return {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Priority: "u=1, i",
      Referer: this.referer,
      "sec-ch-ua": '"Brave";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-GPC": "1",
      Cookie: this.cookie,
      "X-Requested-With": "XMLHttpRequest",
      "X-XSRF-TOKEN": this.xsrf,
    };
  }

  // ── low-level request ──────────────────────────────────────────────────

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { params?: Record<string, string | number>; jsonBody?: unknown } = {},
  ): Promise<T> {
    let url = path.startsWith("http") ? path : `${WEB_BASE}${path}`;
    if (opts.params && Object.keys(opts.params).length > 0) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.params)) qs.set(k, String(v));
      url += (url.includes("?") ? "&" : "?") + qs.toString();
    }

    const headers = this.baseHeaders();
    const body = opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : "";
    if (opts.jsonBody !== undefined) headers["Content-Type"] = "application/json";

    const t = await this.cycleTls();
    let res: CycleTLSResponse;
    try {
      res = await t(
        url,
        {
          body,
          ja3: CHROME_JA3,
          userAgent: CHROME_UA,
          headers,
          timeout: Math.ceil(this.timeout / 1000),
        },
        method.toLowerCase() as "get" | "post",
      );
    } catch (e) {
      throw new NavilyError(`HTTP request failed: ${(e as Error).message}`, { url });
    }

    return this.parseResponse<T>(res, url);
  }

  private parseResponse<T>(res: CycleTLSResponse, url: string): T {
    const status = res.status;
    const headers = (res.headers ?? {}) as Record<string, string>;
    const ct = (headers["content-type"] ?? headers["Content-Type"] ?? "") as string;
    const raw = res.body;
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);

    if (status === 403 && typeof text === "string" && text.includes("Just a moment")) {
      throw new CloudflareBlockedError(
        "Cloudflare challenge — your cookie's cf_clearance has expired. Refresh the cookie in your browser and re-export it.",
        { status, url },
      );
    }
    if (status === 419) {
      throw new NavilyAuthError(
        "CSRF token mismatch (419). Your XSRF-TOKEN cookie is stale — refresh and re-export.",
        { status, url },
      );
    }
    if (status === 401) {
      throw new NavilyAuthError("Unauthenticated (401). Re-export your cookie.", { status, url });
    }

    // cycletls auto-parses JSON when content-type allows; raw may already be
    // an object. We treat object as success, string as text and parse.
    let data: unknown;
    if (typeof raw === "object" && raw !== null) {
      data = raw;
    } else {
      if (!ct.startsWith("application/json")) {
        throw new NavilyError(
          `Non-JSON response (status ${status}, content-type ${JSON.stringify(ct)})`,
          { status, url, body: text.slice(0, 500) },
        );
      }
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new NavilyError(`Bad JSON: ${(e as Error).message}`, {
          status, url, body: text.slice(0, 500),
        });
      }
    }

    // Soft-404: proxy returned HTTP 200 with {"message":"The route X could not be found."}
    if (
      data && typeof data === "object" && !Array.isArray(data)
      && typeof (data as { message?: unknown }).message === "string"
      && (data as { message: string }).message.includes("could not be found")
    ) {
      throw new NotFoundError((data as { message: string }).message, { status, url, body: data });
    }

    if (status >= 400) {
      const message =
        data && typeof data === "object" && "message" in (data as Record<string, unknown>)
          ? String((data as { message: unknown }).message)
          : text.slice(0, 300);
      throw new NavilyError(`HTTP ${status}: ${message}`, { status, url, body: data });
    }

    return data as T;
  }

  // ── direct www.navily.com endpoints ────────────────────────────────────

  /** GET /ajax/get-session-data — basic profile (name, email, avatar). */
  whoami() {
    return this.request<import("./types.js").SessionData>("GET", "/ajax/get-session-data");
  }

  /** GET /api/search?q=… — quick autocomplete-style search. */
  quickSearch(query: string) {
    return this.request<{ status: string; results: unknown[] }>(
      "GET",
      "/api/search",
      { params: { q: query } },
    );
  }

  /** GET /api/map-search — spots near a coordinate within `distanceM` meters. */
  mapSearch(
    latitude: number,
    longitude: number,
    distanceM = 25_000,
    kinds?: string,
  ) {
    const params: Record<string, string | number> = {
      latitude,
      longitude,
      distance: distanceM,
    };
    if (kinds) params.kinds = kinds;
    return this.request<{ status: string; results: import("./types.js").MapSearchResult[] }>(
      "GET",
      "/api/map-search",
      { params },
    );
  }

  /** GET /api/map-search/price — tonight's price for a bookable marina (marinas only). */
  marinaPriceTonight(marinaId: number) {
    return this.request<import("./types.js").PriceTonight>(
      "GET",
      "/api/map-search/price",
      { params: { id: marinaId } },
    );
  }

  /** GET /api/ports/get-with-media — full marina detail incl. photos, equipments, hours. */
  marinaWithMedia(marinaId: number) {
    return this.request<{ status: string; port: unknown }>(
      "GET",
      "/api/ports/get-with-media",
      { params: { id: marinaId } },
    );
  }

  // ── proxied api.navily.com endpoints ───────────────────────────────────

  /** POST /api/proxy — forward a request to api.navily.com. */
  private proxy<T = unknown>(
    path: string,
    method: "get" | "post" | "put" | "delete" | "patch" = "get",
    data: Record<string, unknown> = {},
  ): Promise<T> {
    const body: ProxyBody = { url: path, method, data };
    return this.request<T>("POST", "/api/proxy", { jsonBody: body });
  }

  // User
  /** GET /users/me — full profile. */
  me() { return this.proxy<import("./types.js").User>("/users/me"); }
  /** GET /users/{id} — public profile. */
  user(userId: number) { return this.proxy<import("./types.js").User>(`/users/${userId}`); }

  // Ports (marinas)
  /** GET /ports/{id} — full marina detail. */
  port(portId: number) { return this.proxy(`/ports/${portId}`); }
  /** GET /ports/{id}/comment — your own review on this marina. */
  portComment(portId: number) { return this.proxy(`/ports/${portId}/comment`); }
  /** GET /ports/{id}/comments — paginated reviews. */
  portComments(portId: number) { return this.proxy(`/ports/${portId}/comments`); }
  /** GET /ports/{id}/photos — paginated photos. */
  portPhotos(portId: number) { return this.proxy(`/ports/${portId}/photos`); }
  /** GET /ports/{id}/equipments — fuel, water, electricity, wifi, etc. */
  portEquipments(portId: number) {
    return this.proxy<import("./types.js").Equipment[]>(`/ports/${portId}/equipments`);
  }
  /** GET /ports/{id}/weather — 33-entry forecast. */
  portWeather(portId: number) { return this.proxy<unknown[]>(`/ports/${portId}/weather`); }
  /** GET /ports/{id}/shops — nearby shops. */
  portShops(portId: number) { return this.proxy<unknown[]>(`/ports/${portId}/shops`); }
  /** GET /ports/{id}/bookable-around-ports — alternative marinas nearby. */
  portBookableAround(portId: number, portsCount = 12) {
    return this.proxy<unknown[]>(`/ports/${portId}/bookable-around-ports`, "get", { portsCount });
  }

  // Moorings (anchorages)
  /** GET /moorings/{id} — full anchorage detail. */
  mooring(mooringId: number) { return this.proxy(`/moorings/${mooringId}`); }
  /** GET /moorings/{id}/comments — paginated reviews. */
  mooringComments(mooringId: number) { return this.proxy(`/moorings/${mooringId}/comments`); }
  /** GET /moorings/{id}/photos — paginated photos. */
  mooringPhotos(mooringId: number) { return this.proxy(`/moorings/${mooringId}/photos`); }
  /** GET /moorings/{id}/weather — forecast with wind/wave-protection scores. */
  mooringWeather(mooringId: number) { return this.proxy<unknown[]>(`/moorings/${mooringId}/weather`); }
  /** GET /moorings/{id}/shops — nearby shops. */
  mooringShops(mooringId: number) { return this.proxy<unknown[]>(`/moorings/${mooringId}/shops`); }

  // Regions
  /** GET /regions — paginated global index. */
  regions() { return this.proxy("/regions"); }
  /** GET /regions/{id} — region detail. */
  region(regionId: number) { return this.proxy(`/regions/${regionId}`); }
  /** GET /regions/{id}/ports — paginated marinas in a region. */
  regionPorts(regionId: number) { return this.proxy(`/regions/${regionId}/ports`); }
  /** GET /regions/{id}/moorings — paginated anchorages in a region. */
  regionMoorings(regionId: number) { return this.proxy(`/regions/${regionId}/moorings`); }

  // Search (via proxy)
  /** GET /search/places — hybrid search across ports/moorings/users/shops/regions. */
  searchPlaces(
    query: string,
    opts: { limit?: number; kinds?: string } = {},
  ) {
    const limit = opts.limit ?? 6;
    const kinds = opts.kinds ?? "port,mooring,user,shop,region";
    return this.proxy("/search/places", "get", {
      query_string: query,
      query_limit: limit,
      kinds,
    });
  }

  /** GET /search/standard-boats — boat catalog. per_page must be >= 10. */
  searchStandardBoats(keyword: string, perPage = 10) {
    if (perPage < 10) throw new NavilyError("per_page must be at least 10");
    return this.proxy("/search/standard-boats", "get", { keyword, per_page: perPage });
  }

  // Personal
  /** GET /boats — your saved boats. */
  boats() { return this.proxy("/boats"); }
  /** GET /lists — your favourites lists. */
  lists() { return this.proxy("/lists"); }
  /** GET /lists/{id}/entries — places in a list. */
  listEntries(listId: number) { return this.proxy(`/lists/${listId}/entries`); }
  /** GET /lists/{id}/comments — paginated comments on a list. */
  listComments(listId: number) { return this.proxy(`/lists/${listId}/comments`); }
  /** GET /cards — saved payment cards. */
  cards() { return this.proxy<unknown[]>("/cards"); }
  /** GET /notifications. */
  notifications() { return this.proxy<unknown[]>("/notifications"); }
  /** GET /notifications/count — last failed payment intents. */
  notificationsCount() { return this.proxy("/notifications/count"); }
  /** GET /demands — booking demands. */
  demands() { return this.proxy<unknown[]>("/demands"); }
  /** GET /demands/infos — booking summary. */
  demandsInfos() { return this.proxy("/demands/infos"); }
  /** GET /demands/offers — pending marina offers. */
  demandsOffers() { return this.proxy<unknown[]>("/demands/offers"); }
  /** GET /user-subscriptions/last — your last subscription. */
  subscriptionLast() { return this.proxy("/user-subscriptions/last"); }
  /** GET /misc/countries — 251 countries. */
  countries() { return this.proxy<import("./types.js").Country[]>("/misc/countries"); }
}
