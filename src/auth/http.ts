import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import type { CycleTLSClient, CycleTLSResponse } from "cycletls";

import { getXsrfToken, saveCookie } from "../config.js";

const initCycleTLS = createRequire(import.meta.url)("cycletls") as
  (opts?: { port?: number; debug?: boolean }) => Promise<CycleTLSClient>;

const WEB_BASE = "https://www.navily.com";
const CHROME_JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface HttpLoginOptions {
  email: string;
  password: string;
  timeoutMs?: number;
  onStep?: (step: string) => void;
}

export interface HttpLoginResult {
  cookieHeader: string;
  cookiePath: string;
}

type HttpMethod = "GET" | "POST";

export async function loginViaHttpAndSaveCookie(
  opts: HttpLoginOptions,
): Promise<HttpLoginResult> {
  const step = opts.onStep ?? (() => {});
  const client = await initCycleTLS();
  const jar = new CookieJar();
  const timeout = Math.ceil((opts.timeoutMs ?? 30_000) / 1000);

  async function request(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<CycleTLSResponse> {
    const cookie = jar.header();
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: `${WEB_BASE}/`,
      "sec-ch-ua": '"Brave";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-GPC": "1",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (cookie) {
      headers.Cookie = cookie;
      const xsrf = getXsrfToken(cookie);
      if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await client(
      path.startsWith("http") ? path : `${WEB_BASE}${path}`,
      {
        body: body === undefined ? "" : JSON.stringify(body),
        ja3: CHROME_JA3,
        userAgent: CHROME_UA,
        headers,
        timeout,
      },
      method.toLowerCase() as "get" | "post",
    );
    jar.addFromHeaders(res.headers as Record<string, string | string[] | undefined>);
    return res;
  }

  try {
    step("Starting browserless login");
    await expectOk(request("GET", "/"), "homepage bootstrap");

    step("Checking email");
    await expectOk(request("POST", "/api/proxy", {
      url: "/users/check-email",
      method: "post",
      data: { email: opts.email },
    }), "email check");
    await expectOk(request("POST", "/api/proxy", {
      url: "/users/validated-email",
      method: "post",
      data: { email: opts.email },
    }), "email validation");

    step("Submitting credentials");
    await expectOk(request("POST", "/login", {
      email: opts.email,
      password: opts.password,
    }), "login");

    step("Verifying session");
    const verify = await expectOk(request("GET", "/ajax/get-session-data"), "session verification");
    const data = parseJson(verify);
    if (!data || typeof data !== "object" || !(data as { status?: unknown }).status) {
      throw new Error("Login completed but session verification did not return an authenticated user.");
    }

    const cookieHeader = jar.header();
    const cookiePath = saveCookie(cookieHeader);
    return { cookieHeader, cookiePath };
  } finally {
    await client.exit();
    await delay(500);
  }
}

async function expectOk(
  promise: Promise<CycleTLSResponse>,
  label: string,
): Promise<CycleTLSResponse> {
  const res = await promise;
  const text = responseText(res);
  if (res.status === 403 && text.includes("Just a moment")) {
    throw new Error(
      `Cloudflare blocked browserless ${label}. Use NAVILY_COOKIE or run \`navily auth login --browser\` where Chrome is available.`,
    );
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Browserless ${label} failed with HTTP ${res.status}.`);
  }
  return res;
}

function parseJson(res: CycleTLSResponse): unknown {
  if (typeof res.body === "object" && res.body !== null) return res.body;
  if (typeof res.body !== "string" || !res.body) return null;
  try { return JSON.parse(res.body); } catch { return null; }
}

function responseText(res: CycleTLSResponse): string {
  return typeof res.body === "string" ? res.body : JSON.stringify(res.body);
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  addFromHeaders(headers: Record<string, string | string[] | undefined>): void {
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (name.toLowerCase() !== "set-cookie" || value === undefined) continue;
      const values = Array.isArray(value)
        ? value
        : String(value).split(/,(?=\s*[^;=]+=[^;]+)/);
      for (const setCookie of values) {
        const pair = setCookie.split(";")[0]?.trim();
        if (!pair) continue;
        const idx = pair.indexOf("=");
        if (idx <= 0) continue;
        this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
    }
  }

  header(): string {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join("; ");
  }
}
