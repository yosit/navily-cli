"""Output formatters: JSON (default) and a compact 'table' format for terminal use."""
from __future__ import annotations
import json
import sys
from typing import Any

from rich.console import Console
from rich.table import Table


def emit_json(data: Any) -> None:
    """Emit JSON to stdout (pretty by default)."""
    json.dump(data, sys.stdout, indent=2, ensure_ascii=False, default=str)
    sys.stdout.write("\n")


def emit_table(data: Any, *, title: str | None = None) -> None:
    """Emit a Rich table best-effort. Falls back to JSON for non-list/dict.

    - list[dict]: each dict is a row; columns are the union of keys (first 12).
    - dict with 'data' key (Laravel pagination): renders 'data' as the list.
    - dict otherwise: 2-column key/value table.
    """
    console = Console()

    if isinstance(data, dict) and isinstance(data.get("data"), list):
        rows = data["data"]
        rendered = _render_list_of_dicts(rows, title=title)
        console.print(rendered)
        meta = data.get("meta")
        if isinstance(meta, dict) and "current_page" in meta:
            console.print(
                f"[dim]page {meta.get('current_page')}/{meta.get('last_page')} — "
                f"{meta.get('from') or 0}–{meta.get('to') or 0} of {meta.get('total') or '?'}[/dim]"
            )
        return

    if isinstance(data, list):
        console.print(_render_list_of_dicts(data, title=title))
        return

    if isinstance(data, dict):
        console.print(_render_dict_kv(data, title=title))
        return

    # scalar
    console.print(str(data))


def _render_list_of_dicts(rows: list, *, title: str | None) -> Table:
    table = Table(title=title, show_lines=False, expand=False)
    if not rows:
        table.add_column("(empty)", justify="left")
        return table
    if not isinstance(rows[0], dict):
        table.add_column("value")
        for r in rows:
            table.add_row(str(r))
        return table

    # Pick columns: prefer well-known short keys first, then up to 12 others.
    preferred = ["id", "kind", "name", "type", "city", "country", "countryCode",
                 "regionName", "bookable", "rating", "distance", "createdAt", "updatedAt"]
    all_keys: list[str] = []
    seen = set()
    for row in rows:
        for k in row.keys():
            if k not in seen:
                seen.add(k)
                all_keys.append(k)
    ordered = [k for k in preferred if k in seen]
    for k in all_keys:
        if k not in ordered:
            ordered.append(k)
    cols = ordered[:12]
    for c in cols:
        table.add_column(c, overflow="fold", max_width=40)
    for row in rows:
        table.add_row(*[_fmt_cell(row.get(c)) for c in cols])
    return table


def _render_dict_kv(d: dict, *, title: str | None) -> Table:
    table = Table(title=title, show_header=False, show_lines=False, expand=False)
    table.add_column("field", style="bold")
    table.add_column("value", overflow="fold")
    for k, v in d.items():
        table.add_row(k, _fmt_cell(v))
    return table


def _fmt_cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "✓" if v else "·"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return v if len(v) <= 80 else v[:77] + "…"
    if isinstance(v, dict):
        # Show 'name' or 'id' if present, else compact JSON
        if "name" in v:
            return str(v["name"])
        if "id" in v:
            return f"#{v['id']}"
        return json.dumps(v, ensure_ascii=False)[:80]
    if isinstance(v, list):
        if all(isinstance(x, (str, int, float)) for x in v):
            return ", ".join(str(x) for x in v)[:80]
        return f"[{len(v)} items]"
    return str(v)
