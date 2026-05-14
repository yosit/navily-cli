import { describe, it, expect } from "vitest";
import { extractCookieFromCurl, getXsrfToken } from "../src/config.js";

describe("extractCookieFromCurl", () => {
  it("extracts cookie from -b flag", () => {
    const curl = `curl 'https://www.navily.com/ajax/get-session-data' \\
      -H 'accept: */*' \\
      -b 'cf_clearance=abc; XSRF-TOKEN=xyz; navily_session=def' \\
      -H 'x-requested-with: XMLHttpRequest'`;
    expect(extractCookieFromCurl(curl)).toBe(
      "cf_clearance=abc; XSRF-TOKEN=xyz; navily_session=def",
    );
  });

  it("extracts cookie from --cookie flag", () => {
    const curl = `curl --cookie "a=1; b=2" https://example.com`;
    expect(extractCookieFromCurl(curl)).toBe("a=1; b=2");
  });

  it("extracts cookie from -H cookie header", () => {
    const curl = `curl 'https://example.com' -H 'cookie: a=1; b=2'`;
    expect(extractCookieFromCurl(curl)).toBe("a=1; b=2");
  });

  it("handles Cookie header with capital C", () => {
    const curl = `curl https://example.com -H "Cookie: a=1"`;
    expect(extractCookieFromCurl(curl)).toBe("a=1");
  });

  it("returns null when no cookie present", () => {
    expect(extractCookieFromCurl("curl 'https://example.com'")).toBeNull();
  });
});

describe("getXsrfToken", () => {
  it("URL-decodes the XSRF-TOKEN value", () => {
    const cookie = "cf_clearance=abc; XSRF-TOKEN=foo%3Dbar%2B; navily_session=xx";
    expect(getXsrfToken(cookie)).toBe("foo=bar+");
  });

  it("returns empty string when missing", () => {
    expect(getXsrfToken("a=1; b=2")).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(getXsrfToken("")).toBe("");
  });
});
