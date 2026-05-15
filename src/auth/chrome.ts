/**
 * Launch the user's installed Chrome with remote debugging enabled and an
 * ephemeral profile, then attach via CDP using playwright-core.
 *
 * Why not let Playwright launch its bundled Chromium? Cloudflare Turnstile
 * sniffs for Playwright's instrumentation (navigator.webdriver, CDP-launched
 * Chromium quirks). By spawning a vanilla Chrome ourselves and *attaching*
 * over CDP, we get a real browser TLS fingerprint with none of those tells.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Browser } from "playwright-core";

export interface ChromeSession {
  browser: Browser;
  /** Kill the Chrome process and clean up its temp profile. */
  teardown: () => Promise<void>;
}

export interface LaunchOptions {
  /** Run Chrome with --headless=new. Default false. */
  headless?: boolean;
}

/**
 * A recent stable Chrome desktop UA. We override Chrome's default headless UA
 * (which contains "HeadlessChrome") because Cloudflare's bot detection
 * keys on it. Keep aligned with the JA3 family pinned in src/client.ts.
 */
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAC_DEFAULT = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function locateChrome(): string {
  if (process.env.NAVILY_CHROME_PATH) return process.env.NAVILY_CHROME_PATH;
  if (process.platform === "darwin" && existsSync(MAC_DEFAULT)) return MAC_DEFAULT;
  // Linux candidates; first hit wins.
  if (process.platform === "linux") {
    for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
      if (existsSync(p)) return p;
    }
  }
  throw new Error(
    "Could not find Chrome. Install Google Chrome or set NAVILY_CHROME_PATH " +
      "to the Chrome binary.",
  );
}

/**
 * Spawn Chrome with `--remote-debugging-port=0`, wait for it to write its
 * chosen port to `<profile>/DevToolsActivePort`, and attach via CDP.
 */
export async function launchChromeWithCdp(opts: LaunchOptions = {}): Promise<ChromeSession> {
  const binary = locateChrome();
  const profileDir = mkdtempSync(join(tmpdir(), "navily-chrome-"));

  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Without this, --remote-debugging-port sets navigator.webdriver=true,
    // which Cloudflare Turnstile detects and refuses to auto-solve.
    "--disable-blink-features=AutomationControlled",
    "--disable-features=ChromeWhatsNewUI",
  ];
  if (opts.headless) {
    // Default to --headless=new (Chrome 109+). NAVILY_HEADLESS_MODE=old picks
    // the legacy headless binary path, which sometimes evades a different
    // bot-detection codepath.
    const mode = process.env.NAVILY_HEADLESS_MODE === "old" ? "--headless" : "--headless=new";
    args.push(
      mode,
      "--window-size=1280,800",
      "--hide-scrollbars",
      "--mute-audio",
      `--user-agent=${REAL_CHROME_UA}`,
    );
  }
  args.push("about:blank");

  const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });

  let exited = false;
  child.on("exit", () => { exited = true; });

  const port = await readDevToolsPort(profileDir, child, 15_000);

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  } catch (e) {
    await killChrome(child, profileDir);
    throw new Error(`CDP attach failed: ${(e as Error).message}`);
  }

  const teardown = async (): Promise<void> => {
    try { await browser.close(); } catch { /* ignore */ }
    if (!exited) await killChrome(child, profileDir);
    else cleanupProfile(profileDir);
  };

  return { browser, teardown };
}

async function readDevToolsPort(
  profileDir: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<number> {
  const portFile = join(profileDir, "DevToolsActivePort");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      cleanupProfile(profileDir);
      throw new Error(`Chrome exited before DevTools came up (code ${child.exitCode})`);
    }
    if (existsSync(portFile)) {
      // File format: first line is the port, second line is the ws path.
      const first = readFileSync(portFile, "utf8").split("\n")[0]?.trim();
      const port = Number(first);
      if (Number.isFinite(port) && port > 0) return port;
    }
    await delay(100);
  }
  await killChrome(child, profileDir);
  throw new Error("Timed out waiting for Chrome's DevTools port");
}

async function killChrome(child: ChildProcess, profileDir: string): Promise<void> {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    // Give it 2s to shut down gracefully, then SIGKILL.
    const start = Date.now();
    while (child.exitCode === null && Date.now() - start < 2_000) {
      await delay(50);
    }
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  cleanupProfile(profileDir);
}

function cleanupProfile(profileDir: string): void {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
