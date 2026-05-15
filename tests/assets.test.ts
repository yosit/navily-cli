import { describe, expect, it } from "vitest";
import { tileTemplateForProvider } from "../src/index.js";

describe("tileTemplateForProvider", () => {
  it("uses OSM by default", () => {
    const tile = tileTemplateForProvider();

    expect(tile.provider).toBe("osm");
    expect(tile.template).toContain("tile.openstreetmap.org");
  });

  it("supports Esri satellite aliases without an API key", () => {
    const tile = tileTemplateForProvider("satellite");

    expect(tile.provider).toBe("esriWorldImagery");
    expect(tile.template).toContain("World_Imagery");
    expect(tile.template).toContain("{z}/{y}/{x}");
  });

  it("requires keys for commercial satellite providers", () => {
    expect(() => tileTemplateForProvider("maptilerSatellite")).toThrow("requires");
    expect(() => tileTemplateForProvider("mapboxSatellite")).toThrow("requires");
  });
});
