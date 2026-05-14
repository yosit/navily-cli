"""HTTP client for navily.com.

Auth model
==========
Navily uses a Laravel session cookie + XSRF-TOKEN cookie. Both are gated by
Cloudflare's Turnstile anti-bot challenge, so programmatic login is not
possible. The CLI accepts a session cookie obtained from a real browser
(see `navily auth from-curl` or `navily auth set`).

Cloudflare's cf_clearance cookie is bound to the browser's TLS fingerprint
(JA3). We use `curl_cffi` with chrome131 impersonation so our outbound TLS
matches Chrome and the clearance cookie remains valid. Node's stdlib `https`
and ordinary curl get a 403 challenge page.

Two URL surfaces
================
1. Direct endpoints on www.navily.com (e.g. `/ajax/get-session-data`,
   `/api/map-search`, `/api/ports/get-with-media`).
2. Proxied endpoints: POST `/api/proxy` with body `{url, method, data}`.
   The Laravel server forwards to api.navily.com with the user's signed
   token. This is how the SPA accesses `/users/me`, `/ports/{id}`,
   `/regions/{id}/ports`, etc.

A 419 status indicates a stale CSRF token; the CLI surfaces that as
`NavilyAuthError` so the user can refresh their cookie. A 401/403 plus
Cloudflare HTML triggers `CloudflareBlockedError`.
"""
from __future__ import annotations
from typing import Any, Iterable
from urllib.parse import urlencode

from curl_cffi import requests as cffi_requests

from .config import get_xsrf_token

WEB_BASE = "https://www.navily.com"
DEFAULT_TIMEOUT = 30


class NavilyError(Exception):
    """Base class for client errors. Carries status, url, body."""

    def __init__(self, message: str, *, status: int | None = None, url: str | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.url = url
        self.body = body


class NavilyAuthError(NavilyError):
    """Session cookie missing, expired, or rejected by Sanctum/CSRF."""


class CloudflareBlockedError(NavilyError):
    """Cloudflare returned a challenge page. The cookie likely expired."""


class NotFoundError(NavilyError):
    """The proxy returned 'route ... could not be found' or upstream 404."""


def _default_headers(cookie: str, xsrf: str, referer: str) -> dict[str, str]:
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Priority": "u=1, i",
        "Referer": referer,
        "Sec-Ch-Ua": '"Brave";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Gpc": "1",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
        ),
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookie,
        "X-XSRF-TOKEN": xsrf,
    }


class NavilyClient:
    """Reusable client for navily.com. Construct with a cookie string."""

    def __init__(
        self,
        cookie: str,
        *,
        timeout: int = DEFAULT_TIMEOUT,
        impersonate: str = "chrome131",
        referer: str = f"{WEB_BASE}/carte",
    ):
        if not cookie:
            raise NavilyAuthError("No cookie provided. Run `navily auth set` or set NAVILY_COOKIE.")
        self._cookie = cookie
        self._xsrf = get_xsrf_token(cookie)
        self._timeout = timeout
        self._impersonate = impersonate
        self._referer = referer
        self._session = cffi_requests.Session()

    # ── low-level request ──────────────────────────────────────────────────

    def _request(self, method: str, path: str, *, params: dict | None = None, json_body: Any = None) -> Any:
        url = path if path.startswith("http") else f"{WEB_BASE}{path}"
        if params:
            url = f"{url}?{urlencode(params)}"
        headers = _default_headers(self._cookie, self._xsrf, self._referer)
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        try:
            r = self._session.request(
                method,
                url,
                headers=headers,
                json=json_body,
                timeout=self._timeout,
                impersonate=self._impersonate,
            )
        except Exception as e:
            raise NavilyError(f"HTTP request failed: {e}", url=url) from e

        return self._parse_response(r, url)

    def _parse_response(self, r: Any, url: str) -> Any:
        status = r.status_code
        ct = r.headers.get("content-type", "")
        text = r.text

        # Cloudflare challenge — clearance cookie expired or fingerprint mismatch
        if status == 403 and "Just a moment" in text:
            raise CloudflareBlockedError(
                "Cloudflare challenge — your cookie's cf_clearance has expired. "
                "Refresh the cookie in your browser (visit any navily.com page) and re-export it.",
                status=status, url=url,
            )

        if status == 419:
            raise NavilyAuthError(
                "CSRF token mismatch (419). Your XSRF-TOKEN cookie is stale — refresh and re-export.",
                status=status, url=url,
            )

        if status == 401:
            raise NavilyAuthError("Unauthenticated (401). Re-export your cookie.", status=status, url=url)

        if not ct.startswith("application/json"):
            raise NavilyError(
                f"Non-JSON response (status {status}, content-type {ct!r})",
                status=status, url=url, body=text[:500],
            )

        try:
            data = r.json()
        except Exception as e:
            raise NavilyError(f"Bad JSON: {e}", status=status, url=url, body=text[:500]) from e

        # Soft-404 from the proxy: 200 OK but body is `{"message": "The route X could not be found."}`
        if isinstance(data, dict) and "could not be found" in str(data.get("message", "")):
            raise NotFoundError(data["message"], status=status, url=url, body=data)

        # Upstream Sanctum/proxy non-2xx wrapped as 200: rare but check
        if status >= 400:
            raise NavilyError(
                f"HTTP {status}: {data.get('message') if isinstance(data, dict) else str(data)[:300]}",
                status=status, url=url, body=data,
            )

        return data

    # ── public: direct www.navily.com endpoints ────────────────────────────

    def whoami(self) -> dict:
        """GET /ajax/get-session-data — basic profile (name, email, avatar)."""
        return self._request("GET", "/ajax/get-session-data")

    def quick_search(self, query: str) -> dict:
        """GET /api/search?q=… — quick autocomplete-style search.

        Returns regions, ports, moorings, shops matching the query.
        """
        return self._request("GET", "/api/search", params={"q": query})

    def map_search(
        self,
        latitude: float,
        longitude: float,
        distance_m: int = 25000,
        kinds: str | None = None,
    ) -> dict:
        """GET /api/map-search — spots near a coordinate within `distance_m` meters.

        `kinds` is a comma-separated subset of {port, mooring}.
        """
        params: dict[str, Any] = {
            "latitude": latitude,
            "longitude": longitude,
            "distance": distance_m,
        }
        if kinds:
            params["kinds"] = kinds
        return self._request("GET", "/api/map-search", params=params)

    def marina_price_tonight(self, marina_id: int) -> dict:
        """GET /api/map-search/price — tonight's price for a bookable marina."""
        return self._request("GET", "/api/map-search/price", params={"id": marina_id})

    def marina_with_media(self, marina_id: int) -> dict:
        """GET /api/ports/get-with-media — full marina detail incl. photos, equipments, hours."""
        return self._request("GET", "/api/ports/get-with-media", params={"id": marina_id})

    def markdown_to_html(self, text: str) -> str:
        """GET /api/markdown-to-html — render markdown server-side. Returns HTML text."""
        url = f"{WEB_BASE}/api/markdown-to-html?{urlencode({'text': text})}"
        headers = _default_headers(self._cookie, self._xsrf, self._referer)
        r = self._session.get(url, headers=headers, timeout=self._timeout, impersonate=self._impersonate)
        if r.status_code >= 400:
            raise NavilyError(f"HTTP {r.status_code}", status=r.status_code, url=url, body=r.text[:300])
        return r.text

    # ── public: proxied api.navily.com endpoints ───────────────────────────

    def _proxy(self, path: str, method: str = "get", data: dict | None = None) -> Any:
        """POST /api/proxy — forward a request to api.navily.com.

        The SPA's axios wraps every call this way. `path` must be a Laravel
        route relative to api.navily.com (e.g. `/users/me`, `/ports/301`).
        """
        body = {"url": path, "method": method, "data": data or {}}
        return self._request("POST", "/api/proxy", json_body=body)

    # User
    def me(self) -> dict:
        """GET /users/me — full profile (firstName, lastName, configuration, counts, …)."""
        return self._proxy("/users/me")

    def user(self, user_id: int) -> dict:
        """GET /users/{id} — public profile."""
        return self._proxy(f"/users/{user_id}")

    # Ports (marinas)
    def port(self, port_id: int) -> dict:
        """GET /ports/{id} — full marina detail."""
        return self._proxy(f"/ports/{port_id}")

    def port_comment(self, port_id: int) -> dict:
        """GET /ports/{id}/comment — current user's own comment on this marina."""
        return self._proxy(f"/ports/{port_id}/comment")

    def port_comments(self, port_id: int) -> dict:
        """GET /ports/{id}/comments — paginated reviews/comments with translations."""
        return self._proxy(f"/ports/{port_id}/comments")

    def port_photos(self, port_id: int) -> dict:
        """GET /ports/{id}/photos — paginated photos."""
        return self._proxy(f"/ports/{port_id}/photos")

    def port_equipments(self, port_id: int) -> list[dict]:
        """GET /ports/{id}/equipments — fuel, water, electricity, wifi, etc."""
        return self._proxy(f"/ports/{port_id}/equipments")

    def port_weather(self, port_id: int) -> list[dict]:
        """GET /ports/{id}/weather — 33-entry weather/wind/wave forecast."""
        return self._proxy(f"/ports/{port_id}/weather")

    def port_shops(self, port_id: int) -> list[dict]:
        """GET /ports/{id}/shops — nearby shops."""
        return self._proxy(f"/ports/{port_id}/shops")

    def port_bookable_around(self, port_id: int, count: int = 12) -> list[dict]:
        """GET /ports/{id}/bookable-around-ports — alt bookable marinas nearby."""
        return self._proxy(f"/ports/{port_id}/bookable-around-ports", data={"portsCount": count})

    # Moorings (anchorages)
    def mooring(self, mooring_id: int) -> dict:
        """GET /moorings/{id} — full anchorage detail."""
        return self._proxy(f"/moorings/{mooring_id}")

    def mooring_comments(self, mooring_id: int) -> dict:
        """GET /moorings/{id}/comments — paginated anchorage reviews."""
        return self._proxy(f"/moorings/{mooring_id}/comments")

    def mooring_photos(self, mooring_id: int) -> dict:
        """GET /moorings/{id}/photos — paginated anchorage photos."""
        return self._proxy(f"/moorings/{mooring_id}/photos")

    def mooring_weather(self, mooring_id: int) -> list[dict]:
        """GET /moorings/{id}/weather — wind/wave-protection-scored forecast."""
        return self._proxy(f"/moorings/{mooring_id}/weather")

    def mooring_shops(self, mooring_id: int) -> list[dict]:
        """GET /moorings/{id}/shops — nearby shops."""
        return self._proxy(f"/moorings/{mooring_id}/shops")

    # Regions
    def regions(self) -> dict:
        """GET /regions — paginated index of all regions globally."""
        return self._proxy("/regions")

    def region(self, region_id: int) -> dict:
        """GET /regions/{id} — region detail with country, coordinate."""
        return self._proxy(f"/regions/{region_id}")

    def region_ports(self, region_id: int) -> dict:
        """GET /regions/{id}/ports — paginated marinas in a region."""
        return self._proxy(f"/regions/{region_id}/ports")

    def region_moorings(self, region_id: int) -> dict:
        """GET /regions/{id}/moorings — paginated anchorages in a region."""
        return self._proxy(f"/regions/{region_id}/moorings")

    # Search (via proxy)
    def search_places(
        self,
        query: str,
        *,
        limit: int = 6,
        kinds: str = "port,mooring,user,shop,region",
    ) -> dict:
        """GET /search/places — hybrid search across ports/moorings/users/shops/regions."""
        return self._proxy(
            "/search/places",
            data={"query_string": query, "query_limit": limit, "kinds": kinds},
        )

    def search_standard_boats(self, keyword: str, *, per_page: int = 10) -> dict:
        """GET /search/standard-boats — standard boat catalog (per_page >= 10)."""
        if per_page < 10:
            raise NavilyError("per_page must be at least 10")
        return self._proxy("/search/standard-boats", data={"keyword": keyword, "per_page": per_page})

    # Personal
    def boats(self) -> dict:
        """GET /boats — current user's saved boats (paginated, Laravel resource)."""
        return self._proxy("/boats")

    def lists(self) -> dict:
        """GET /lists — current user's favorites lists."""
        return self._proxy("/lists")

    def list_entries(self, list_id: int) -> list[dict] | dict:
        """GET /lists/{id}/entries — places in a list."""
        return self._proxy(f"/lists/{list_id}/entries")

    def list_comments(self, list_id: int) -> dict:
        """GET /lists/{id}/comments — paginated comments on a list."""
        return self._proxy(f"/lists/{list_id}/comments")

    def cards(self) -> list[dict]:
        """GET /cards — saved payment cards."""
        return self._proxy("/cards")

    def notifications(self) -> list[dict]:
        """GET /notifications — current user's notifications."""
        return self._proxy("/notifications")

    def notifications_count(self) -> dict:
        """GET /notifications/count — last failed payment intents (no plain count)."""
        return self._proxy("/notifications/count")

    def demands(self) -> list[dict]:
        """GET /demands — booking demands (your reservations)."""
        return self._proxy("/demands")

    def demands_infos(self) -> dict:
        """GET /demands/infos — booking summary (active/history/offers/next)."""
        return self._proxy("/demands/infos")

    def demands_offers(self) -> list[dict]:
        """GET /demands/offers — pending marina offers awaiting your confirmation."""
        return self._proxy("/demands/offers")

    def subscription_last(self) -> list[dict] | dict:
        """GET /user-subscriptions/last — your last subscription (Premium)."""
        return self._proxy("/user-subscriptions/last")

    def countries(self) -> list[dict]:
        """GET /misc/countries — 251 countries with code/calling/vhf/flag."""
        return self._proxy("/misc/countries")
