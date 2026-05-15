// Diagnose what's still tripping CF in headless mode.
import { launchChromeWithCdp } from "../dist/auth/chrome.js";
import { STEALTH_INIT_SCRIPT } from "../dist/auth/stealth.js";

const email = process.env.NAVILY_EMAIL;
const { browser, teardown } = await launchChromeWithCdp({ headless: true });
try {
  const ctx = browser.contexts()[0];
  await ctx.addInitScript(STEALTH_INIT_SCRIPT);
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  page.on("response", async (r) => {
    if (r.url().includes("/api/proxy")) {
      const body = await r.text().catch(() => "<no body>");
      console.log("PROXY", r.status(), "->", body.slice(0, 200));
    }
  });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      console.log("CONSOLE", m.type(), "->", m.text().slice(0, 200));
    }
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200)));
  page.on("request", (r) => {
    if (r.url().includes("challenges.cloudflare.com") || r.url().includes("turnstile")) {
      console.log("TURNSTILE REQ", r.method(), r.url().slice(0, 200));
    }
  });

  await page.goto("https://www.navily.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(8_000);

  const fp = await page.evaluate(() => ({
    webdriver: navigator.webdriver,
    languages: navigator.languages,
    pluginsCount: navigator.plugins.length,
    pluginNames: [...navigator.plugins].map((p) => p.name),
    hasChromeObj: typeof window.chrome,
    hasChromeRuntime: typeof window.chrome?.runtime,
    ua: navigator.userAgent,
    platform: navigator.platform,
    hwConcurrency: navigator.hardwareConcurrency,
    vendor: navigator.vendor,
    outerHeight: window.outerHeight,
    outerWidth: window.outerWidth,
    devicePixelRatio: window.devicePixelRatio,
    notifPermission: Notification.permission,
  }));
  console.log("fingerprint:", JSON.stringify(fp, null, 2));

  await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((e) => (e.innerText || "").trim() === "Login");
    a?.click();
  });
  await page.waitForTimeout(800);
  await page.locator("#auth-email").click();
  await page.keyboard.type(email, { delay: 60 });
  // Wait so we can see the proxy 403 (or 200).
  await page.waitForTimeout(8_000);

  const turnstile = await page.evaluate(() => {
    const ts = document.querySelector(".turnstile-container");
    if (!ts) return null;
    const iframes = [...ts.querySelectorAll("iframe")];
    return {
      visible: ts.offsetParent !== null,
      html: ts.outerHTML.slice(0, 500),
      iframes: iframes.map((f) => ({ src: f.getAttribute("src") || "", w: f.clientWidth, h: f.clientHeight })),
    };
  });
  console.log("turnstile:", JSON.stringify(turnstile, null, 2));
} finally { await teardown(); }
