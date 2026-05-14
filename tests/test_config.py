"""Tests for cookie helpers."""
from navily.config import extract_cookie_from_curl, get_xsrf_token


def test_extract_cookie_from_curl_b_flag():
    curl = """curl 'https://www.navily.com/ajax/get-session-data' \\
      -H 'accept: */*' \\
      -b 'cf_clearance=abc; XSRF-TOKEN=xyz; navily_session=def' \\
      -H 'x-requested-with: XMLHttpRequest'"""
    assert extract_cookie_from_curl(curl) == "cf_clearance=abc; XSRF-TOKEN=xyz; navily_session=def"


def test_extract_cookie_from_curl_h_header():
    curl = """curl 'https://example.com' -H 'cookie: a=1; b=2'"""
    assert extract_cookie_from_curl(curl) == "a=1; b=2"


def test_extract_cookie_from_curl_none():
    assert extract_cookie_from_curl("curl 'https://example.com'") is None


def test_get_xsrf_token_url_decodes():
    cookie = "cf_clearance=abc; XSRF-TOKEN=foo%3Dbar%2B; navily_session=xx"
    assert get_xsrf_token(cookie) == "foo=bar+"


def test_get_xsrf_token_missing():
    assert get_xsrf_token("a=1; b=2") == ""
