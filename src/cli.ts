/** commander-based CLI. */
import { Command } from "commander";
import { readFileSync, writeFileSync, unlinkSync, existsSync, readSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NavilyClient,
  NavilyError,
  NavilyAuthError,
  CloudflareBlockedError,
  NotFoundError,
} from "./client.js";
import {
  saveCookie, extractCookieFromCurl, COOKIE_FILE,
} from "./config.js";
import { emitJson, emitTable } from "./formatters.js";
import { AutoAuthUnavailableError } from "./auth/auto.js";
import { loginViaHttpAndSaveCookie } from "./auth/http.js";
import { loginAndSaveCookie } from "./auth/session.js";

type Format = "json" | "table";

function getFormat(program: Command): Format {
  const v = program.opts<{ format?: string }>().format;
  if (v === "table") return "table";
  return "json";
}

function emit(format: Format, data: unknown): void {
  if (format === "table") emitTable(data);
  else emitJson(data);
}

async function run(format: Format, fn: (c: NavilyClient) => Promise<unknown>): Promise<void> {
  const c = new NavilyClient(null, {
    autoAuth: true,
    onAuthStep: (s) => process.stderr.write(`→ ${s}\n`),
  });
  try {
    const data = await fn(c);
    emit(format, data);
  } catch (e) {
    handleError(e);
  } finally {
    await c.close();
  }
}

function handleError(e: unknown): never {
  if (e instanceof AutoAuthUnavailableError) {
    process.stderr.write(`✗ ${e.message}\n`);
    process.exit(2);
  }
  if (e instanceof CloudflareBlockedError) {
    process.stderr.write(`✗ Cloudflare blocked: ${e.message}\n`);
    process.exit(3);
  }
  if (e instanceof NavilyAuthError) {
    process.stderr.write(`✗ Auth error: ${e.message}\n`);
    process.exit(2);
  }
  if (e instanceof NotFoundError) {
    process.stderr.write(`✗ Not found: ${e.message}\n`);
    process.exit(4);
  }
  if (e instanceof NavilyError) {
    process.stderr.write(`✗ ${e.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`✗ ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("navily")
    .description("CLI for navily.com (marinas, anchorages, weather, reviews).\n\n" +
      "Uses the session cookie you exported from a real browser (DevTools → Copy\n" +
      "as cURL). Cloudflare blocks anything that doesn't look like Chrome, so the\n" +
      "CLI mimics Chrome's TLS fingerprint via cycletls.")
    .option("-f, --format <fmt>", "output format: json|table", "json")
    .version("0.3.2");

  // ── auth ────────────────────────────────────────────────────────────
  const auth = program.command("auth").description("Manage the session cookie.");

  auth
    .command("from-curl")
    .description("Extract the cookie from a 'Copy as cURL' command.")
    .option("--stdin", "Read curl command from stdin (default opens $EDITOR)")
    .action(async (opts: { stdin?: boolean }) => {
      const text = opts.stdin ? readStdin() : await editorPrompt();
      const cookie = extractCookieFromCurl(text);
      if (!cookie) {
        process.stderr.write("No cookie found. Look for `-b '...'` or `-H 'cookie: ...'`.\n");
        process.exit(1);
      }
      const path = saveCookie(cookie);
      process.stdout.write(`✓ Cookie saved to ${path}\n`);
    });

  auth
    .command("set <cookie>")
    .description("Save a raw cookie string (the value of the `Cookie:` header).")
    .action((cookieString: string) => {
      const path = saveCookie(cookieString);
      process.stdout.write(`✓ Cookie saved to ${path}\n`);
    });

  auth
    .command("show-path")
    .description("Print the path where the cookie is stored.")
    .action(() => { process.stdout.write(COOKIE_FILE + "\n"); });

  auth
    .command("status")
    .description("Verify the cookie works by calling /ajax/get-session-data.")
    .action(() => run(getFormat(program), c => c.whoami()));

  auth
    .command("login")
    .description(
      "Log in and save the session cookie.\n" +
      "Reads credentials from NAVILY_EMAIL and NAVILY_PASSWORD env vars.\n" +
      "Uses browserless cycletls login by default. Pass --browser to drive " +
      "Google Chrome instead."
    )
    .option("--browser", "drive Chrome instead of browserless HTTP login")
    .option("--headless", "run Chrome headless when --browser is used")
    .option("--keep-open", "leave the browser open after a successful login")
    .option("--timeout <seconds>", "max seconds to wait for login + Turnstile", "180")
    .action(async (opts: { browser?: boolean; headless?: boolean; keepOpen?: boolean; timeout?: string }) => {
      await runLogin(opts);
    });

  // ── identity ────────────────────────────────────────────────────────
  program
    .command("whoami")
    .description("Show the logged-in user (name, email, avatar).")
    .action(() => run(getFormat(program), c => c.whoami()));

  program
    .command("me")
    .description("Show the full user profile (configuration, counts, language).")
    .action(() => run(getFormat(program), c => c.me()));

  program
    .command("user <id>")
    .description("Show a public user profile by id.")
    .action((id: string) => run(getFormat(program), c => c.user(Number(id))));

  // ── search / map ────────────────────────────────────────────────────
  program
    .command("search <query>")
    .description("Search ports, anchorages, users, shops, regions.")
    .option("--limit <n>", "max results", "6")
    .option("--kinds <list>", "comma-separated kinds", "port,mooring,user,shop,region")
    .action((query: string, opts: { limit: string; kinds: string }) => {
      run(getFormat(program), c =>
        c.searchPlaces(query, { limit: Number(opts.limit), kinds: opts.kinds })
      );
    });

  program
    .command("map <latitude> <longitude>")
    .description("List ports + anchorages near a coordinate.")
    .option("--distance <m>", "radius in meters", "25000")
    .option("--kinds <list>", "port,mooring or just one", "")
    .action((lat: string, lon: string, opts: { distance: string; kinds: string }) => {
      run(getFormat(program), c =>
        c.mapSearch(Number(lat), Number(lon), Number(opts.distance), opts.kinds || undefined)
      );
    });

  // ── port ────────────────────────────────────────────────────────────
  const port = program.command("port").description("Marina (port) commands.");
  port.command("show <id>").description("Full marina detail.")
    .action((id: string) => run(getFormat(program), c => c.port(Number(id))));
  port.command("photos <id>").description("Photos for a marina.")
    .action((id: string) => run(getFormat(program), c => c.portPhotos(Number(id))));
  port.command("comments <id>").description("Reviews/comments for a marina.")
    .action((id: string) => run(getFormat(program), c => c.portComments(Number(id))));
  port.command("equipments <id>").description("Equipment list.")
    .action((id: string) => run(getFormat(program), c => c.portEquipments(Number(id))));
  port.command("weather <id>").description("Marina weather forecast.")
    .action((id: string) => run(getFormat(program), c => c.portWeather(Number(id))));
  port.command("shops <id>").description("Shops near a marina.")
    .action((id: string) => run(getFormat(program), c => c.portShops(Number(id))));
  port.command("price <id>").description("Tonight's price for a bookable marina.")
    .action((id: string) => run(getFormat(program), c => c.marinaPriceTonight(Number(id))));
  port.command("nearby <id>").description("Other bookable marinas around a marina.")
    .option("--count <n>", "how many to return", "12")
    .action((id: string, opts: { count: string }) =>
      run(getFormat(program), c => c.portBookableAround(Number(id), Number(opts.count)))
    );

  // ── mooring ─────────────────────────────────────────────────────────
  const mooring = program.command("mooring").description("Anchorage (mooring) commands.");
  mooring.command("show <id>").description("Full anchorage detail.")
    .action((id: string) => run(getFormat(program), c => c.mooring(Number(id))));
  mooring.command("photos <id>").description("Anchorage photos.")
    .action((id: string) => run(getFormat(program), c => c.mooringPhotos(Number(id))));
  mooring.command("comments <id>").description("Anchorage reviews.")
    .action((id: string) => run(getFormat(program), c => c.mooringComments(Number(id))));
  mooring.command("weather <id>").description("Anchorage weather with wind/wave protection scores.")
    .action((id: string) => run(getFormat(program), c => c.mooringWeather(Number(id))));
  mooring.command("shops <id>").description("Shops near an anchorage.")
    .action((id: string) => run(getFormat(program), c => c.mooringShops(Number(id))));

  // ── region ──────────────────────────────────────────────────────────
  const region = program.command("region").description("Region commands.");
  region.command("show <id>").description("Region detail.")
    .action((id: string) => run(getFormat(program), c => c.region(Number(id))));
  region.command("ports <id>").description("All marinas in a region.")
    .action((id: string) => run(getFormat(program), c => c.regionPorts(Number(id))));
  region.command("moorings <id>").description("All anchorages in a region.")
    .action((id: string) => run(getFormat(program), c => c.regionMoorings(Number(id))));
  region.command("list").description("Paginated global region index.")
    .action(() => run(getFormat(program), c => c.regions()));

  // ── personal ────────────────────────────────────────────────────────
  program.command("boats").description("Your saved boats.")
    .action(() => run(getFormat(program), c => c.boats()));
  program.command("lists").description("Your favourites lists.")
    .action(() => run(getFormat(program), c => c.lists()));
  program.command("list-entries <id>").description("Entries in a favourites list.")
    .action((id: string) => run(getFormat(program), c => c.listEntries(Number(id))));
  program.command("cards").description("Saved payment cards.")
    .action(() => run(getFormat(program), c => c.cards()));
  program.command("notifications").description("Notifications.")
    .action(() => run(getFormat(program), c => c.notifications()));

  // ── bookings ────────────────────────────────────────────────────────
  const bookings = program.command("bookings").description("Booking demands.");
  bookings.command("list").description("All your booking demands.")
    .action(() => run(getFormat(program), c => c.demands()));
  bookings.command("summary").description("Booking summary.")
    .action(() => run(getFormat(program), c => c.demandsInfos()));
  bookings.command("offers").description("Marina offers awaiting your confirmation.")
    .action(() => run(getFormat(program), c => c.demandsOffers()));

  // ── misc ────────────────────────────────────────────────────────────
  program.command("countries").description("All 251 countries.")
    .action(() => run(getFormat(program), c => c.countries()));
  program.command("search-boats <keyword>").description("Search the standard boat catalog.")
    .option("--per-page <n>", "results per page (min 10)", "10")
    .action((kw: string, opts: { perPage: string }) =>
      run(getFormat(program), c => c.searchStandardBoats(kw, Number(opts.perPage)))
    );
  program.command("subscription").description("Your last subscription (Premium).")
    .action(() => run(getFormat(program), c => c.subscriptionLast()));

  return program;
}

function readStdin(): string {
  const chunks: Buffer[] = [];
  const fd = 0;
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n: number;
    try {
      n = readSync(fd, buf, 0, buf.length, null);
    } catch {
      break;
    }
    if (n === 0) break;
    chunks.push(buf.subarray(0, n));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runLogin(opts: {
  browser?: boolean;
  headless?: boolean;
  keepOpen?: boolean;
  timeout?: string;
}): Promise<void> {
  const email = process.env.NAVILY_EMAIL;
  const password = process.env.NAVILY_PASSWORD;
  if (!email || !password) {
    process.stderr.write("Set NAVILY_EMAIL and NAVILY_PASSWORD in your env.\n");
    process.exit(2);
  }
  const headless = Boolean(opts.headless) || process.env.NAVILY_HEADLESS === "1";
  const timeoutMs = Number(opts.timeout ?? 180) * 1000;

  const result = opts.browser || opts.headless || opts.keepOpen
    ? await loginAndSaveCookie({
      email,
      password,
      headless,
      timeoutMs,
      keepOpen: opts.keepOpen,
      onStep: (s) => process.stderr.write(`→ ${s}\n`),
    })
    : await loginViaHttpAndSaveCookie({
      email,
      password,
      timeoutMs,
      onStep: (s) => process.stderr.write(`→ ${s}\n`),
    });
  process.stdout.write(`✓ Cookie saved to ${result.cookiePath}\n`);

  // Smoke-test the cookie under our cycletls JA3. If Cloudflare rejects,
  // we want to know now, not when the user runs `navily port show 123`.
  process.stderr.write("→ Verifying cookie via /ajax/get-session-data…\n");
  const client = new NavilyClient(result.cookieHeader, { autoAuth: false });
  try {
    await client.whoami();
    process.stderr.write("✓ Cookie verified.\n");
  } catch (e) {
    process.stderr.write(
      `⚠ Cookie saved but verification failed: ${(e as Error).message}\n` +
      "  This usually means Chrome's TLS fingerprint drifted from cycletls's\n" +
      "  pinned JA3. The cookie may still work for some endpoints.\n",
    );
  } finally {
    await client.close();
  }
}

async function editorPrompt(): Promise<string> {
  const editor = process.env.EDITOR ?? "vi";
  const path = join(tmpdir(), `navily-curl-${Date.now()}.txt`);
  writeFileSync(path, "# Paste a 'Copy as cURL' command here, then save and quit.\n");
  spawnSync(editor, [path], { stdio: "inherit" });
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8");
  try { unlinkSync(path); } catch { /* ignore */ }
  return text;
}

export function main(argv: string[] = process.argv): void {
  buildProgram().parseAsync(argv).catch(handleError);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
