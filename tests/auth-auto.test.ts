import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
});

async function importWithEmptyConfig() {
  const dir = mkdtempSync(join(tmpdir(), "navily-test-"));
  tempDirs.push(dir);
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.NAVILY_COOKIE;
  delete process.env.NAVILY_EMAIL;
  delete process.env.NAVILY_PASSWORD;
  vi.resetModules();
  return import("../src/auth/auto.js");
}

describe("ensureFreshCookie", () => {
  it("respects NAVILY_COOKIE without requiring credentials", async () => {
    const { ensureFreshCookie } = await importWithEmptyConfig();
    process.env.NAVILY_COOKIE = "cf_clearance=abc; XSRF-TOKEN=xyz; navily_session=def";

    await expect(ensureFreshCookie()).resolves.toBe(
      "cf_clearance=abc; XSRF-TOKEN=xyz; navily_session=def",
    );
  });

  it("explains how to authenticate when no cookie or credentials exist", async () => {
    const { AutoAuthUnavailableError, ensureFreshCookie } = await importWithEmptyConfig();

    await expect(ensureFreshCookie()).rejects.toBeInstanceOf(AutoAuthUnavailableError);
    await expect(ensureFreshCookie()).rejects.toThrow("NAVILY_EMAIL/NAVILY_PASSWORD");
  });
});
