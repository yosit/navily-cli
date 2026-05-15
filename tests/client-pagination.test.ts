import { describe, expect, it } from "vitest";
import { NavilyClient, NavilyError } from "../src/index.js";

describe("pagination validation", () => {
  it("rejects invalid page numbers before making a request", () => {
    const client = new NavilyClient("XSRF-TOKEN=x; navily_session=y", { autoAuth: false });

    expect(() => client.portPhotos(123, { page: 0 })).toThrow(NavilyError);
  });
});
