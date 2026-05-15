import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import {
  CONFIG_DIR,
  COOKIE_LOCK_FILE,
  loadCookie,
} from "../config.js";
import { loginViaHttpAndSaveCookie } from "./http.js";
import { loginAndSaveCookie } from "./session.js";

export class AutoAuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutoAuthUnavailableError";
  }
}

export interface EnsureFreshCookieOptions {
  /** Mint a replacement cookie even when a cookie file exists. */
  force?: boolean;
  timeoutMs?: number;
  onStep?: (step: string) => void;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;
const LOCK_STALE_MS = 10 * 60_000;
const LOCK_WAIT_MS = 10 * 60_000;

export async function ensureFreshCookie(
  opts: EnsureFreshCookieOptions = {},
): Promise<string> {
  const envCookie = process.env.NAVILY_COOKIE?.trim();
  if (envCookie) return envCookie;

  const beforeLock = loadCookie();
  if (!opts.force && beforeLock) return beforeLock;

  const email = process.env.NAVILY_EMAIL;
  const password = process.env.NAVILY_PASSWORD;
  if (!email || !password) {
    throw new AutoAuthUnavailableError(
      "No cookie and no NAVILY_EMAIL/NAVILY_PASSWORD set. Run `navily auth login` interactively, set both env vars, or set NAVILY_COOKIE.",
    );
  }

  return withCookieLock(async () => {
    const current = loadCookie();
    if (!opts.force && current) return current;
    if (opts.force && current && current !== beforeLock) return current;

    const timeoutMs = opts.timeoutMs ?? authTimeoutFromEnv();
    let result;
    try {
      result = await loginViaHttpAndSaveCookie({
        email,
        password,
        timeoutMs,
        onStep: opts.onStep,
      });
    } catch (e) {
      if (process.env.NAVILY_AUTH_BROWSER_FALLBACK !== "1") throw e;
      opts.onStep?.(`Browserless login failed: ${(e as Error).message}`);
      opts.onStep?.("Falling back to Chrome login");
      result = await loginAndSaveCookie({
        email,
        password,
        headless: process.env.NAVILY_HEADLESS === "1",
        timeoutMs,
        onStep: opts.onStep,
      });
    }
    return result.cookieHeader;
  });
}

async function withCookieLock<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const fd = await acquireLock();
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try { unlinkSync(COOKIE_LOCK_FILE); } catch { /* already gone */ }
  }
}

async function acquireLock(): Promise<number> {
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(COOKIE_LOCK_FILE, "wx", 0o600);
      writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      return fd;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      maybeRemoveStaleLock();
      if (Date.now() - start > LOCK_WAIT_MS) {
        throw new Error(`Timed out waiting for auth lock: ${COOKIE_LOCK_FILE}`);
      }
      await delay(500);
    }
  }
}

function maybeRemoveStaleLock(): void {
  try {
    if (!existsSync(COOKIE_LOCK_FILE)) return;
    const ageMs = Date.now() - statSync(COOKIE_LOCK_FILE).mtimeMs;
    if (ageMs > LOCK_STALE_MS) unlinkSync(COOKIE_LOCK_FILE);
  } catch {
    // Another process may have released it between exists/stat/unlink.
  }
}

function authTimeoutFromEnv(): number {
  const raw = process.env.NAVILY_AUTH_TIMEOUT_SECONDS;
  if (!raw) return DEFAULT_LOGIN_TIMEOUT_MS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_LOGIN_TIMEOUT_MS;
  return seconds * 1000;
}
