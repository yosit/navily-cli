"""Commander-style CLI for navily.com (built on click)."""
from __future__ import annotations
import sys
from typing import Callable

import click

from .client import (
    NavilyClient, NavilyError, NavilyAuthError, CloudflareBlockedError, NotFoundError,
)
from .config import (
    save_cookie, load_cookie, extract_cookie_from_curl, COOKIE_FILE,
)
from .formatters import emit_json, emit_table


def _client() -> NavilyClient:
    cookie = load_cookie()
    if not cookie:
        click.echo(
            "No cookie configured. Run:\n"
            "  navily auth from-curl   # paste a `Copy as cURL` from DevTools\n"
            "or set NAVILY_COOKIE in your env.",
            err=True,
        )
        sys.exit(2)
    return NavilyClient(cookie)


def _output(ctx: click.Context, data) -> None:
    fmt = ctx.obj.get("format", "json")
    if fmt == "table":
        emit_table(data)
    else:
        emit_json(data)


def _run(ctx: click.Context, fn: Callable):
    try:
        _output(ctx, fn())
    except CloudflareBlockedError as e:
        click.echo(f"✗ Cloudflare blocked: {e}", err=True)
        sys.exit(3)
    except NavilyAuthError as e:
        click.echo(f"✗ Auth error: {e}", err=True)
        sys.exit(2)
    except NotFoundError as e:
        click.echo(f"✗ Not found: {e}", err=True)
        sys.exit(4)
    except NavilyError as e:
        click.echo(f"✗ {e}", err=True)
        sys.exit(1)


# ── root ──────────────────────────────────────────────────────────────────

@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.option(
    "--format", "-f", "format_",
    type=click.Choice(["json", "table"]),
    default="json",
    help="Output format. Default: json.",
)
@click.pass_context
def main(ctx: click.Context, format_: str) -> None:
    """navily — CLI for navily.com (marinas, anchorages, weather, reviews).

    Uses the session cookie you exported from a real browser (DevTools →
    Copy as cURL). Cloudflare blocks anything that doesn't look like Chrome,
    so the CLI mimics Chrome's TLS fingerprint via curl_cffi.
    """
    ctx.ensure_object(dict)
    ctx.obj["format"] = format_


# ── auth ──────────────────────────────────────────────────────────────────

@main.group()
def auth() -> None:
    """Manage the session cookie."""


@auth.command("from-curl")
@click.option("--stdin", is_flag=True, help="Read the curl command from stdin instead of opening $EDITOR.")
def auth_from_curl(stdin: bool) -> None:
    """Extract the cookie from a 'Copy as cURL' command.

    Opens $EDITOR for paste, or reads from stdin with --stdin.
    """
    if stdin:
        text = sys.stdin.read()
    else:
        text = click.edit("# Paste a 'Copy as cURL' command here, then save and quit.\n") or ""
    cookie = extract_cookie_from_curl(text)
    if not cookie:
        click.echo("No cookie found in input. Look for a `-b '...'` or `-H 'cookie: ...'` flag.", err=True)
        sys.exit(1)
    path = save_cookie(cookie)
    click.echo(f"✓ Cookie saved to {path}")


@auth.command("set")
@click.argument("cookie_string")
def auth_set(cookie_string: str) -> None:
    """Save a raw cookie string (the value of the `Cookie:` request header)."""
    path = save_cookie(cookie_string)
    click.echo(f"✓ Cookie saved to {path}")


@auth.command("show-path")
def auth_show_path() -> None:
    """Print the path where the cookie is stored."""
    click.echo(str(COOKIE_FILE))


@auth.command("status")
@click.pass_context
def auth_status(ctx: click.Context) -> None:
    """Verify the cookie still works by calling /ajax/get-session-data."""
    _run(ctx, lambda: _client().whoami())


# ── identity ──────────────────────────────────────────────────────────────

@main.command()
@click.pass_context
def whoami(ctx: click.Context) -> None:
    """Show the logged-in user (name, email, avatar)."""
    _run(ctx, lambda: _client().whoami())


@main.command()
@click.pass_context
def me(ctx: click.Context) -> None:
    """Show the full user profile (configuration, counts, language)."""
    _run(ctx, lambda: _client().me())


@main.command("user")
@click.argument("user_id", type=int)
@click.pass_context
def user_cmd(ctx: click.Context, user_id: int) -> None:
    """Show a public user profile by id."""
    _run(ctx, lambda: _client().user(user_id))


# ── search ────────────────────────────────────────────────────────────────

@main.command()
@click.argument("query")
@click.option("--limit", default=6, show_default=True)
@click.option("--kinds", default="port,mooring,user,shop,region", show_default=True,
              help="Comma-separated subset of kinds to include.")
@click.pass_context
def search(ctx: click.Context, query: str, limit: int, kinds: str) -> None:
    """Search ports, anchorages, users, shops, regions."""
    _run(ctx, lambda: _client().search_places(query, limit=limit, kinds=kinds))


@main.command()
@click.argument("latitude", type=float)
@click.argument("longitude", type=float)
@click.option("--distance", "distance_m", default=25000, show_default=True,
              help="Radius in meters.")
@click.option("--kinds", default=None, help="port,mooring or just one.")
@click.pass_context
def map(ctx: click.Context, latitude: float, longitude: float, distance_m: int, kinds: str | None) -> None:
    """List ports + anchorages near a coordinate."""
    _run(ctx, lambda: _client().map_search(latitude, longitude, distance_m=distance_m, kinds=kinds))


# ── port ──────────────────────────────────────────────────────────────────

@main.group()
def port() -> None:
    """Marina (port) commands. Use the numeric id from `search` or `map`."""


@port.command("show")
@click.argument("port_id", type=int)
@click.pass_context
def port_show(ctx: click.Context, port_id: int) -> None:
    """Full marina detail."""
    _run(ctx, lambda: _client().port(port_id))


@port.command("photos")
@click.argument("port_id", type=int)
@click.pass_context
def port_photos(ctx: click.Context, port_id: int) -> None:
    """Photos for a marina."""
    _run(ctx, lambda: _client().port_photos(port_id))


@port.command("comments")
@click.argument("port_id", type=int)
@click.pass_context
def port_comments(ctx: click.Context, port_id: int) -> None:
    """Reviews/comments for a marina."""
    _run(ctx, lambda: _client().port_comments(port_id))


@port.command("equipments")
@click.argument("port_id", type=int)
@click.pass_context
def port_equipments(ctx: click.Context, port_id: int) -> None:
    """Equipment list (water, electricity, fuel, wifi, …)."""
    _run(ctx, lambda: _client().port_equipments(port_id))


@port.command("weather")
@click.argument("port_id", type=int)
@click.pass_context
def port_weather(ctx: click.Context, port_id: int) -> None:
    """Marina weather forecast."""
    _run(ctx, lambda: _client().port_weather(port_id))


@port.command("shops")
@click.argument("port_id", type=int)
@click.pass_context
def port_shops(ctx: click.Context, port_id: int) -> None:
    """Shops near a marina."""
    _run(ctx, lambda: _client().port_shops(port_id))


@port.command("price")
@click.argument("port_id", type=int)
@click.pass_context
def port_price(ctx: click.Context, port_id: int) -> None:
    """Tonight's price for a bookable marina."""
    _run(ctx, lambda: _client().marina_price_tonight(port_id))


@port.command("nearby")
@click.argument("port_id", type=int)
@click.option("--count", default=12, show_default=True)
@click.pass_context
def port_nearby(ctx: click.Context, port_id: int, count: int) -> None:
    """Other bookable marinas around a marina."""
    _run(ctx, lambda: _client().port_bookable_around(port_id, count=count))


# ── mooring (anchorage) ───────────────────────────────────────────────────

@main.group()
def mooring() -> None:
    """Anchorage (mooring) commands."""


@mooring.command("show")
@click.argument("mooring_id", type=int)
@click.pass_context
def mooring_show(ctx: click.Context, mooring_id: int) -> None:
    """Full anchorage detail."""
    _run(ctx, lambda: _client().mooring(mooring_id))


@mooring.command("photos")
@click.argument("mooring_id", type=int)
@click.pass_context
def mooring_photos(ctx: click.Context, mooring_id: int) -> None:
    """Anchorage photos."""
    _run(ctx, lambda: _client().mooring_photos(mooring_id))


@mooring.command("comments")
@click.argument("mooring_id", type=int)
@click.pass_context
def mooring_comments(ctx: click.Context, mooring_id: int) -> None:
    """Anchorage reviews."""
    _run(ctx, lambda: _client().mooring_comments(mooring_id))


@mooring.command("weather")
@click.argument("mooring_id", type=int)
@click.pass_context
def mooring_weather(ctx: click.Context, mooring_id: int) -> None:
    """Anchorage weather (with wind/wave-protection scores)."""
    _run(ctx, lambda: _client().mooring_weather(mooring_id))


@mooring.command("shops")
@click.argument("mooring_id", type=int)
@click.pass_context
def mooring_shops(ctx: click.Context, mooring_id: int) -> None:
    """Shops near an anchorage."""
    _run(ctx, lambda: _client().mooring_shops(mooring_id))


# ── region ────────────────────────────────────────────────────────────────

@main.group()
def region() -> None:
    """Region (country/state/area) commands."""


@region.command("show")
@click.argument("region_id", type=int)
@click.pass_context
def region_show(ctx: click.Context, region_id: int) -> None:
    """Region detail."""
    _run(ctx, lambda: _client().region(region_id))


@region.command("ports")
@click.argument("region_id", type=int)
@click.pass_context
def region_ports(ctx: click.Context, region_id: int) -> None:
    """All marinas in a region."""
    _run(ctx, lambda: _client().region_ports(region_id))


@region.command("moorings")
@click.argument("region_id", type=int)
@click.pass_context
def region_moorings(ctx: click.Context, region_id: int) -> None:
    """All anchorages in a region."""
    _run(ctx, lambda: _client().region_moorings(region_id))


@region.command("list")
@click.pass_context
def region_list(ctx: click.Context) -> None:
    """Paginated index of regions globally (first page)."""
    _run(ctx, lambda: _client().regions())


# ── personal (account) ────────────────────────────────────────────────────

@main.command()
@click.pass_context
def boats(ctx: click.Context) -> None:
    """Your saved boats."""
    _run(ctx, lambda: _client().boats())


@main.command()
@click.pass_context
def lists(ctx: click.Context) -> None:
    """Your favourites lists."""
    _run(ctx, lambda: _client().lists())


@main.command("list-entries")
@click.argument("list_id", type=int)
@click.pass_context
def list_entries(ctx: click.Context, list_id: int) -> None:
    """Entries in a favourites list."""
    _run(ctx, lambda: _client().list_entries(list_id))


@main.command()
@click.pass_context
def cards(ctx: click.Context) -> None:
    """Saved payment cards."""
    _run(ctx, lambda: _client().cards())


@main.command()
@click.pass_context
def notifications(ctx: click.Context) -> None:
    """Notifications."""
    _run(ctx, lambda: _client().notifications())


# ── bookings (demands) ────────────────────────────────────────────────────

@main.group()
def bookings() -> None:
    """Booking demands (reservation requests to marinas)."""


@bookings.command("list")
@click.pass_context
def bookings_list(ctx: click.Context) -> None:
    """All your booking demands."""
    _run(ctx, lambda: _client().demands())


@bookings.command("summary")
@click.pass_context
def bookings_summary(ctx: click.Context) -> None:
    """Summary of active/history bookings + offers."""
    _run(ctx, lambda: _client().demands_infos())


@bookings.command("offers")
@click.pass_context
def bookings_offers(ctx: click.Context) -> None:
    """Marina offers awaiting your confirmation."""
    _run(ctx, lambda: _client().demands_offers())


# ── misc ──────────────────────────────────────────────────────────────────

@main.command()
@click.pass_context
def countries(ctx: click.Context) -> None:
    """All 251 countries (code, calling code, vhf, flag)."""
    _run(ctx, lambda: _client().countries())


@main.command()
@click.argument("keyword")
@click.option("--per-page", default=10, show_default=True)
@click.pass_context
def search_boats(ctx: click.Context, keyword: str, per_page: int) -> None:
    """Search the standard boat catalog (brand/model)."""
    _run(ctx, lambda: _client().search_standard_boats(keyword, per_page=per_page))


@main.command()
@click.pass_context
def subscription(ctx: click.Context) -> None:
    """Your last subscription (Navily Premium)."""
    _run(ctx, lambda: _client().subscription_last())


if __name__ == "__main__":
    main(obj={})
