// After Continue: dump the password step.
import { launchChromeWithCdp } from "../dist/auth/chrome.js";
const email = process.env.NAVILY_EMAIL;
const { browser, teardown } = await launchChromeWithCdp();
try {
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://www.navily.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(6_000);
  await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((e) => (e.innerText || "").trim() === "Login");
    a?.click();
  });
  await page.waitForTimeout(800);
  await page.locator("#auth-email").click();
  await page.keyboard.type(email, { delay: 60 });
  // Wait for Continue to enable.
  await page.locator('[data-cy="check-email-btn"]:not([disabled])').waitFor({ timeout: 15_000 });
  await page.locator('[data-cy="check-email-btn"]').click();
  await page.waitForTimeout(3_500);

  const dump = await page.evaluate(() => {
    function d(el) {
      return { tag: el.tagName, type: el.getAttribute("type") || "", id: el.id, cls: (el.className?.toString?.() || "").slice(0, 80), txt: (el.innerText || "").trim().slice(0, 40), dt: el.getAttribute("data-cy") || "", visible: el.offsetParent !== null, disabled: !!el.disabled };
    }
    return {
      modalText: document.getElementById("auth-modal")?.innerText?.trim().slice(0, 400),
      inputs: [...document.querySelectorAll("#auth-modal input")].map(d),
      buttons: [...document.querySelectorAll("#auth-modal button")].map(d),
    };
  });
  console.log(JSON.stringify(dump, null, 2));
} finally { await teardown(); }
