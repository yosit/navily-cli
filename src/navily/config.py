"""Auth/config: how the CLI gets the navily.com session cookie."""
from __future__ import annotations
import os
import re
from pathlib import Path
from urllib.parse import unquote

CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "navily"
COOKIE_FILE = CONFIG_DIR / "cookie"


def save_cookie(cookie_string: str) -> Path:
    """Save the cookie string to the config dir with 600 perms."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    COOKIE_FILE.write_text(cookie_string.strip() + "\n")
    COOKIE_FILE.chmod(0o600)
    return COOKIE_FILE


def load_cookie() -> str | None:
    """Read the cookie string: NAVILY_COOKIE env var wins, else the file."""
    env = os.environ.get("NAVILY_COOKIE")
    if env:
        return env.strip()
    if COOKIE_FILE.exists():
        return COOKIE_FILE.read_text().strip()
    return None


def extract_cookie_from_curl(curl_command: str) -> str | None:
    """Extract the cookie string from a 'Copy as cURL' paste.

    Looks for `-b '...'`, `--cookie '...'`, or `-H 'cookie: ...'` and returns
    the cookie string. Returns None if none of those are present.
    """
    # -b '...' or --cookie '...'
    m = re.search(r"(?:-b|--cookie)\s+(['\"])(.*?)\1", curl_command, flags=re.DOTALL)
    if m:
        return m.group(2).strip()
    # -H 'cookie: ...' (case-insensitive)
    m = re.search(r"-H\s+(['\"])[Cc]ookie:\s*(.*?)\1", curl_command, flags=re.DOTALL)
    if m:
        return m.group(2).strip()
    return None


def get_xsrf_token(cookie_string: str) -> str:
    """Extract the URL-decoded XSRF-TOKEN value from a cookie string."""
    for c in cookie_string.split("; "):
        if c.startswith("XSRF-TOKEN="):
            return unquote(c.split("=", 1)[1])
    return ""
