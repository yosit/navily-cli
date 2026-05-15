import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createStaticMapImage,
  downloadMedia,
  NavilyClient,
  type StaticMapMarker,
} from "../src/index.js";

const runLive = process.env.NAVILY_LIVE_TESTS === "1" ? describe : describe.skip;

runLive("Aegina live map and media downloads", () => {
  let client: NavilyClient;
  let outputDir: string;

  beforeAll(async () => {
    client = new NavilyClient();
    outputDir = await mkdtemp(join(tmpdir(), "navily-aegina-live-"));
  });

  afterAll(async () => {
    // cycletls installs its own process-exit cleanup handler. Calling
    // client.close() inside Vitest can race that handler and surface a
    // harmless kill ESRCH as an unhandled rejection after teardown.
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
  });

  it("downloads a static map for Aegina using real Navily search results", async () => {
    const spots = await searchAegina(client);
    const markers = spots.slice(0, 8).map(markerFromSpot);

    const map = await createStaticMapImage({
      center: { latitude: 37.745, longitude: 23.43 },
      markers,
      zoom: 12,
      width: 640,
      height: 420,
      outputDir,
      filename: "aegina-navily-live-map.svg",
    });

    expect(map.contentType).toBe("image/svg+xml");
    expect(map.markers).toBeGreaterThan(0);
    expect(map.tiles).toBeGreaterThan(0);
    expect(map.bytes).toBeGreaterThan(10_000);
    expect((await stat(map.path)).size).toBe(map.bytes);
  }, 120_000);

  it("downloads a real Navily photo for an Aegina-area place", async () => {
    const spots = await searchAegina(client);
    const photo = await firstPhotoUrl(client, spots);

    const media = await downloadMedia(client, {
      url: photo.url,
      outputDir,
      filename: `aegina-${photo.kind}-${photo.id}`,
    });

    expect(media.contentType).toMatch(/^image\//);
    expect(media.bytes).toBeGreaterThan(1024);
    expect((await stat(media.path)).size).toBe(media.bytes);
  }, 120_000);
});

async function searchAegina(client: NavilyClient): Promise<Array<Record<string, unknown>>> {
  const response = await client.mapSearch(37.745, 23.43, 25_000, "port,mooring");
  const results = Array.isArray(response.results) ? response.results : [];
  expect(results.length).toBeGreaterThan(0);
  return results as Array<Record<string, unknown>>;
}

function markerFromSpot(spot: Record<string, unknown>): StaticMapMarker {
  const coordinate = spot.coordinate as Record<string, unknown> | undefined;
  const latitude = Number(coordinate?.latitude);
  const longitude = Number(coordinate?.longitude);
  expect(Number.isFinite(latitude)).toBe(true);
  expect(Number.isFinite(longitude)).toBe(true);
  return {
    latitude,
    longitude,
    label: typeof spot.name === "string" ? spot.name : String(spot.id ?? "Navily"),
  };
}

async function firstPhotoUrl(
  client: NavilyClient,
  spots: Array<Record<string, unknown>>,
): Promise<{ id: number; kind: string; url: string }> {
  for (const spot of spots.slice(0, 15)) {
    const id = Number(spot.id);
    const kind = String(spot.kind);
    if (!Number.isFinite(id) || !/^(port|mooring)$/.test(kind)) continue;

    const response = kind === "mooring"
      ? await client.mooringPhotos(id)
      : await client.portPhotos(id);
    const rows = rowsFromResponse(response);
    const first = rows.find((row) => typeof row.url === "string" && row.url.length > 0);
    if (first?.url) return { id, kind, url: String(first.url) };
  }

  throw new Error("No Aegina-area port/mooring photo URL found in the first 15 map results.");
}

function rowsFromResponse(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data.filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
