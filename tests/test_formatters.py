"""Tests for output formatters."""
import io
import json
from contextlib import redirect_stdout

from navily.formatters import emit_json, emit_table, _fmt_cell, _render_list_of_dicts


def test_emit_json_pretty():
    buf = io.StringIO()
    with redirect_stdout(buf):
        emit_json({"a": 1, "b": [2, 3]})
    out = buf.getvalue()
    assert json.loads(out) == {"a": 1, "b": [2, 3]}
    # pretty: contains newlines + indentation
    assert "\n" in out


def test_fmt_cell_bool_check():
    assert _fmt_cell(True) == "✓"
    assert _fmt_cell(False) == "·"


def test_fmt_cell_none_empty():
    assert _fmt_cell(None) == ""


def test_fmt_cell_dict_with_name():
    assert _fmt_cell({"id": 5, "name": "Sanary"}) == "Sanary"


def test_fmt_cell_dict_with_id():
    assert _fmt_cell({"id": 7}) == "#7"


def test_fmt_cell_short_list_joins():
    assert _fmt_cell(["sand", "algae"]) == "sand, algae"


def test_fmt_cell_long_string_truncates():
    s = "x" * 200
    out = _fmt_cell(s)
    assert len(out) == 78
    assert out.endswith("…")


def test_render_list_of_dicts_chooses_preferred_columns():
    rows = [
        {"id": 1, "kind": "port", "name": "A", "extra": "x"},
        {"id": 2, "kind": "mooring", "name": "B", "extra": "y"},
    ]
    table = _render_list_of_dicts(rows, title=None)
    col_names = [c.header for c in table.columns]
    # preferred columns appear first
    assert col_names[:3] == ["id", "kind", "name"]
    assert "extra" in col_names


def test_render_list_of_dicts_empty():
    table = _render_list_of_dicts([], title=None)
    assert len(table.columns) == 1
