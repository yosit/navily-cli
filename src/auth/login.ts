/**
 * Drive a headed Chrome to log in to navily.com, then harvest the resulting
 * session cookies.
 *
 * The login flow is a Vue/Element-UI modal with two steps (email → password)
 * gated by a Cloudflare Turnstile widget. With navigator.webdriver suppressed
 * (see chrome.ts), Turnstile auto-solves and the flow runs unattended. If
 * Turnstile presents an interactive challenge, the headed window lets the
 * user solve it; we wait for the Continue button to enable.
 */
import type { Browser, BrowserContext, Page } from "playwright-core";

import { STEALTH_INIT_SCRIPT } from "./stealth.js";

export interface LoginResult {
  cookieHeader: string;
  userAgent: string;
}

export interface LoginOptions {
  email: string;
  password: string;
  /** Max time to wait for the user to solve Turnstile + login to complete. */
  timeoutMs?: number;
  /** Leave the browser open after success (debugging). */
  keepOpen?: boolean;
  /**
   * Whether Chrome was launched headless. Controls stealth-patch installation:
   * patches *hurt* headed Chrome (they create their own fingerprint), so we
   * only install them when actually headless.
   */
  headless?: boolean;
  /** Per-step progress for the CLI to print. */
  onStep?: (step: string) => void;
}

const HOME = "https://www.navily.com/";

export async function loginToNavily(
  browser: Browser,
  opts: LoginOptions,
): Promise<LoginResult> {
  const step = opts.onStep ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const context = browser.contexts()[0] ?? (await browser.newContext());
  // Stealth patches only when headless. In headed mode Chrome already passes
  // Turnstile's silent checks; applying the patches there creates a hybrid
  // fingerprint (real-Chrome + faked-navigator surface) that Cloudflare
  // detects as its own tell.
  if (opts.headless) {
    await context.addInitScript(STEALTH_INIT_SCRIPT);
  }
  const page = context.pages()[0] ?? (await context.newPage());

  step("Loading navily.com");
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Give Cloudflare's JS challenge time to settle — without this, the first
  // /api/proxy call from the modal hits a 'Just a moment...' 403.
  await page.waitForTimeout(6_000);

  step("Opening login modal");
  await openLoginModal(page);

  step("Submitting email");
  await fillEmail(page, opts.email);

  step("Waiting for email check (Turnstile auto-solves silently)");
  await waitForCheckEmailEnabled(page, timeoutMs);
  await page.locator('[data-cy="check-email-btn"]').click();

  step("Submitting password");
  await fillPassword(page, opts.password);

  step("Waiting for login to complete");
  await waitForLoggedIn(page, timeoutMs);

  const userAgent = await page.evaluate(() => navigator.userAgent);
  const cookieHeader = await harvestCookieHeader(context);

  return { cookieHeader, userAgent };
}

async function openLoginModal(page: Page): Promise<void> {
  // The Login trigger is an <a> inside a navbar dropdown that's hidden until
  // the dropdown opens. Programmatic .click() bypasses CSS visibility and
  // fires the bound Vue handler, opening #auth-modal directly.
  const clicked = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find(
      (e) => (e.textContent || "").trim() === "Login",
    );
    if (!a) return false;
    (a as HTMLElement).click();
    return true;
  });
  if (!clicked) {
    throw new Error(
      "Couldn't find the Login link in navily.com's navbar. The page may " +
        "have been redesigned — see scripts/inspect-login.mjs to re-derive selectors.",
    );
  }
  await page.locator("#auth-email").waitFor({ state: "visible", timeout: 10_000 });
}

async function fillEmail(page: Page, email: string): Promise<void> {
  // Element UI's el-input wraps the native input and listens for real key
  // events; .fill() doesn't update v-model reliably. Use click + type.
  await page.locator("#auth-email").click();
  await page.keyboard.type(email, { delay: 30 });
}

async function fillPassword(page: Page, password: string): Promise<void> {
  await page.locator("#auth-password").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#auth-password").click();
  await page.keyboard.type(password, { delay: 30 });
  // [data-cy=login-btn] enables once the password field is non-empty.
  await page.locator('[data-cy="login-btn"]:not([disabled])').waitFor({ timeout: 10_000 });
  await page.locator('[data-cy="login-btn"]').click();
}

/**
 * Wait for the email-check Continue button to become enabled. The Vue model
 * only flips this after /api/proxy returns 200 — which itself depends on
 * Turnstile having passed (silently or interactively). If Turnstile shows a
 * visible challenge, the headed window lets the user solve it.
 */
async function waitForCheckEmailEnabled(page: Page, timeoutMs: number): Promise<void> {
  try {
    await page.locator('[data-cy="check-email-btn"]:not([disabled])').waitFor({ timeout: timeoutMs });
  } catch {
    throw new Error(
      "The email-check button never enabled. Either Turnstile is showing an " +
        "unsolved challenge in the browser, or /api/proxy is being blocked. " +
        "Solve the challenge in the visible window, then re-run.",
    );
  }
}

/**
 * "Logged in" = a session cookie has a real (long) value. navily.com sets
 * `navily_session` on successful login; before login it may exist as a short
 * anonymous-session value, so we require it to look substantial.
 */
async function waitForLoggedIn(page: Page, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cookies = await page.context().cookies(HOME);
    const hasSession = cookies.some(
      (c) => /navily_session|laravel_session/i.test(c.name) && c.value.length > 64,
    );
    if (hasSession) {
      // The page often navigates right after login submits, which destroys
      // the current execution context. Catch and retry on the next tick.
      try {
        const ok = await page.evaluate(async () => {
          try {
            const r = await fetch("/ajax/get-session-data", {
              credentials: "include",
              headers: { Accept: "application/json" },
            });
            if (!r.ok) return false;
            const j = await r.json();
            return Boolean(j?.user?.id || j?.id || j?.email);
          } catch { return false; }
        });
        if (ok) return;
      } catch (e) {
        if (!/context was destroyed|navigation/i.test((e as Error).message)) throw e;
        // Page is mid-navigation. Wait for it to settle, then retry next tick.
        try { await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }); } catch { /* ignore */ }
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    "Login did not complete within " + Math.round(timeoutMs / 1000) + "s. " +
      "Likely wrong credentials or an unsolved Turnstile challenge.",
  );
}

async function harvestCookieHeader(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies([
    "https://www.navily.com",
    "https://api.navily.com",
  ]);
  // Dedup by name; prefer www.navily.com over api.navily.com when both exist.
  const seen = new Map<string, string>();
  for (const c of cookies) {
    const isApi = c.domain.includes("api.navily.com");
    if (seen.has(c.name) && isApi) continue;
    seen.set(c.name, c.value);
  }
  return Array.from(seen, ([name, value]) => `${name}=${value}`).join("; ");
}
