import { describe, it, expect } from "vitest";
import { fmtCell } from "../src/formatters.js";

describe("fmtCell", () => {
  it("renders true and false as glyphs", () => {
    expect(fmtCell(true)).toBe("✓");
    expect(fmtCell(false)).toBe("·");
  });

  it("renders null and undefined as empty", () => {
    expect(fmtCell(null)).toBe("");
    expect(fmtCell(undefined)).toBe("");
  });

  it("renders numbers", () => {
    expect(fmtCell(42)).toBe("42");
    expect(fmtCell(3.14)).toBe("3.14");
  });

  it("renders objects with name preferentially", () => {
    expect(fmtCell({ id: 5, name: "Sanary" })).toBe("Sanary");
  });

  it("renders objects with id when no name", () => {
    expect(fmtCell({ id: 7 })).toBe("#7");
  });

  it("joins short primitive lists", () => {
    expect(fmtCell(["sand", "algae"])).toBe("sand, algae");
  });

  it("counts non-primitive lists", () => {
    expect(fmtCell([{ a: 1 }, { a: 2 }])).toBe("[2 items]");
  });

  it("truncates long strings with ellipsis", () => {
    const long = "x".repeat(200);
    const out = fmtCell(long);
    expect(out.length).toBe(80);
    expect(out.endsWith("…")).toBe(true);
  });
});
