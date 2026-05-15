/**
 * Patches headless Chrome to look like a normal browser. Installed as an
 * init script so it runs in every new document before any page JS executes.
 *
 * These are the standard tells that Cloudflare Turnstile (and most bot
 * detectors) check. Layering more than this veers into a cat-and-mouse game
 * with vendor-specific heuristics — fine if it breaks, just add the next
 * patch.
 */
export const STEALTH_INIT_SCRIPT = `
(() => {
  // Re-assert webdriver=false in case anything restored it.
  try { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => undefined }); } catch {}

  // navigator.languages — headless returns []; real Chrome returns the
  // configured locale list.
  try {
    Object.defineProperty(Navigator.prototype, "languages", {
      get: () => ["en-US", "en"],
    });
  } catch {}

  // navigator.plugins — headless returns an empty PluginArray. Fake at least
  // the PDF viewer plugins Chrome ships with.
  try {
    const fakePlugin = (name, filename, desc) => ({ name, filename, description: desc, length: 1 });
    const plugins = [
      fakePlugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      fakePlugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      fakePlugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      fakePlugin("Microsoft Edge PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      fakePlugin("WebKit built-in PDF", "internal-pdf-viewer", "Portable Document Format"),
    ];
    Object.defineProperty(Navigator.prototype, "plugins", {
      get: () => Object.assign(plugins, { item: (i) => plugins[i] || null, namedItem: (n) => plugins.find((p) => p.name === n) || null, refresh: () => {} }),
    });
  } catch {}

  // window.chrome — headless ships a stub window.chrome but is missing the
  // chrome.runtime object. Turnstile and many bot detectors check
  // typeof window.chrome.runtime explicitly, so we always patch it in.
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" },
        OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
        PlatformArch: { ARM: "arm", ARM64: "arm64", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
        PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
        PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
        RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" },
        id: undefined,
        connect: () => {},
        sendMessage: () => {},
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = () => ({ requestTime: 0, startLoadTime: 0, commitLoadTime: 0, finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: "Other", wasFetchedViaSpdy: false, wasNpnNegotiated: false, npnNegotiatedProtocol: "unknown", wasAlternateProtocolAvailable: false, connectionInfo: "unknown" });
    }
    if (!window.chrome.csi) {
      window.chrome.csi = () => ({ startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 });
    }
    if (!window.chrome.app) {
      window.chrome.app = { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } };
    }
  } catch {}

  // Permissions API — headless returns "denied" for notifications, but real
  // Chrome returns "default" when permission hasn't been granted. Bot
  // detectors compare Notification.permission to permissions.query result;
  // a mismatch is a tell.
  try {
    const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (origQuery) {
      window.navigator.permissions.query = (params) => {
        if (params && params.name === "notifications") {
          return Promise.resolve({ state: Notification.permission, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
        }
        return origQuery(params);
      };
    }
  } catch {}

  // WebGL UNMASKED_VENDOR / UNMASKED_RENDERER — headless returns
  // "Google Inc.(Google)" / "ANGLE (...)" with specific suffixes. Hand back
  // values that look like a real macOS Chrome.
  try {
    const proto = WebGLRenderingContext.prototype;
    const orig = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === 37445) return "Intel Inc.";                       // UNMASKED_VENDOR_WEBGL
      if (p === 37446) return "Intel Iris OpenGL Engine";          // UNMASKED_RENDERER_WEBGL
      return orig.call(this, p);
    };
  } catch {}

  // Media codecs — Chromium-without-proprietary-codecs reports unsupported
  // for AC3/EC3 audio and h264 video, which Cloudflare uses as a headless
  // tell. Claim support for the codecs real Chrome ships.
  try {
    const PROPRIETARY = [
      'audio/mp4; codecs="ac-3"',
      'audio/mp4; codecs="ec-3"',
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4; codecs="avc1.4D401E"',
      'video/mp4; codecs="avc1.640028"',
      'video/mp4; codecs="mp4a.40.2"',
    ];
    const matches = (s) => PROPRIETARY.some((p) => p.replace(/"/g, "").toLowerCase() === s.replace(/"/g, "").toLowerCase());
    const origCanPlay = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (t) {
      if (typeof t === "string" && matches(t)) return "probably";
      return origCanPlay.call(this, t);
    };
    if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported) {
      const origIsSup = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = (t) => {
        if (typeof t === "string" && matches(t)) return true;
        return origIsSup(t);
      };
    }
  } catch {}

})();
`;
