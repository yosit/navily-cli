/** Cookie management: load from $NAVILY_COOKIE or ~/.config/navily/cookie. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR =
  process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "navily")
    : join(homedir(), ".config", "navily");
export const COOKIE_FILE = join(CONFIG_DIR, "cookie");

/** Persist the cookie string with 600 perms. */
export function saveCookie(cookieString: string): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(COOKIE_FILE, cookieString.trim() + "\n");
  chmodSync(COOKIE_FILE, 0o600);
  return COOKIE_FILE;
}

/** Read the cookie: NAVILY_COOKIE env var wins, else the file, else null. */
export function loadCookie(): string | null {
  if (process.env.NAVILY_COOKIE) return process.env.NAVILY_COOKIE.trim();
  if (existsSync(COOKIE_FILE)) return readFileSync(COOKIE_FILE, "utf8").trim();
  return null;
}

/**
 * Extract the cookie string from a "Copy as cURL" paste.
 * Looks for `-b '...'`, `--cookie '...'`, or `-H 'cookie: ...'`.
 */
export function extractCookieFromCurl(curlCommand: string): string | null {
  // -b '...' or --cookie '...'
  const flag = curlCommand.match(/(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/);
  if (flag) return flag[2]!.trim();
  // -H 'cookie: ...' (case-insensitive header name)
  const header = curlCommand.match(/-H\s+(['"])[Cc]ookie:\s*([\s\S]*?)\1/);
  if (header) return header[2]!.trim();
  return null;
}

/** Pull the URL-decoded XSRF-TOKEN cookie value. Returns "" if not present. */
export function getXsrfToken(cookieString: string): string {
  for (const c of cookieString.split("; ")) {
    if (c.startsWith("XSRF-TOKEN=")) {
      return decodeURIComponent(c.slice("XSRF-TOKEN=".length));
    }
  }
  return "";
}
