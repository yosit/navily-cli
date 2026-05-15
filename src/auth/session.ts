import { saveCookie } from "../config.js";
import { launchChromeWithCdp, type ChromeSession } from "./chrome.js";
import { loginToNavily } from "./login.js";

export interface LoginAndSaveOptions {
  email: string;
  password: string;
  headless?: boolean;
  keepOpen?: boolean;
  timeoutMs?: number;
  onStep?: (step: string) => void;
}

export interface LoginAndSaveResult {
  cookieHeader: string;
  cookiePath: string;
  userAgent: string;
  displayMode: ChromeSession["displayMode"];
}

export async function loginAndSaveCookie(
  opts: LoginAndSaveOptions,
): Promise<LoginAndSaveResult> {
  const step = opts.onStep ?? (() => {});
  const requested = opts.headless ? "headless" : "headed";
  step(`Launching Chrome (${requested} requested)`);
  const session = await launchChromeWithCdp({ headless: opts.headless });
  if (session.displayMode === "xvfb") {
    step("Using headed Chrome under xvfb-run");
  } else {
    step(`Using ${session.displayMode} Chrome`);
  }

  try {
    const result = await loginToNavily(session.browser, {
      email: opts.email,
      password: opts.password,
      timeoutMs: opts.timeoutMs,
      keepOpen: opts.keepOpen,
      headless: session.headless,
      onStep: step,
    });
    const cookiePath = saveCookie(result.cookieHeader);

    return {
      cookieHeader: result.cookieHeader,
      cookiePath,
      userAgent: result.userAgent,
      displayMode: session.displayMode,
    };
  } finally {
    if (!opts.keepOpen) await session.teardown();
    else step("Browser left open; close it manually when done");
  }
}
