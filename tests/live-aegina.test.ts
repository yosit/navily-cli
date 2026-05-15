import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createStaticMapImage,
  downloadStaticMapThumbnail,
  downloadMedia,
  NavilyClient,
  type StaticMapMarker,
} from "../src/index.js";

const runLive = process.env.NAVILY_LIVE_TESTS === "1" ? describe : describe.skip;

runLive("Navily live supported endpoints", () => {
  let client: NavilyClient;
  let outputDir: string;
  let aeginaSpots: Array<Record<string, unknown>> = [];
  let portId = 0;
  let mooringId = 0;
  let regionId = 0;
  let userId = 0;
  let listId = 0;

  beforeAll(async () => {
    client = new NavilyClient();
    outputDir = await mkdtemp(join(tmpdir(), "navily-aegina-live-"));
    aeginaSpots = await searchAegina(client);
    portId = idForKind(aeginaSpots, "port");
    mooringId = idForKind(aeginaSpots, "mooring");
    regionId = await discoverRegionId(client);
    const me = await client.me() as Record<string, unknown>;
    userId = Number(me.id) || Number((await client.whoami() as Record<string, unknown>).id) || 0;
  }, 120_000);

  afterAll(async () => {
    // cycletls installs its own process-exit cleanup handler. Calling
    // client.close() inside Vitest can race that handler and surface a
    // harmless kill ESRCH as an unhandled rejection after teardown.
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
  });

  it("covers identity endpoints", async () => {
    const whoami = await client.whoami() as Record<string, unknown>;
    expect(whoami.status).toBe(true);

    const me = await client.me() as Record<string, unknown>;
    expect(Number(me.id)).toBeGreaterThan(0);

    const profile = await client.user(userId || Number(me.id)) as Record<string, unknown>;
    expect(Number(profile.id)).toBeGreaterThan(0);
  }, 120_000);

  it("covers search and map discovery endpoints", async () => {
    const quick = await client.quickSearch("aegina") as Record<string, unknown>;
    expect(quick.status).toBeTruthy();

    const places = await client.searchPlaces("aegina", { limit: 3, kinds: "port,mooring,region" }) as Record<string, unknown>;
    expect(
      Array.isArray(places.ports) ||
      Array.isArray(places.moorings) ||
      Array.isArray(places.regions),
    ).toBe(true);

    const boats = await client.searchStandardBoats("Beneteau", 10);
    expect(rowsFromResponse(boats).length).toBeGreaterThan(0);

    expect(aeginaSpots.length).toBeGreaterThan(0);

    const portPrice = await client.marinaPriceTonight(portId) as Record<string, unknown>;
    expect(portPrice.status ?? portPrice.result ?? portPrice).toBeTruthy();
  }, 120_000);

  it("covers marina endpoints", async () => {
    const port = await client.port(portId) as Record<string, unknown>;
    expect(Number(port.id)).toBe(portId);

    const withMedia = await client.marinaWithMedia(portId) as Record<string, unknown>;
    expect(withMedia.status).toBeTruthy();

    const comment = await client.portComment(portId);
    expect(comment).toBeDefined();

    const comments = await client.portComments(portId, { page: 1 });
    expect(Array.isArray(comments.data)).toBe(true);

    const commentsAll = await client.portCommentsAll(portId, { maxPages: 1 });
    expect(Array.isArray(commentsAll.data)).toBe(true);

    const photos = await client.portPhotos(portId, { page: 1 });
    expect(Array.isArray(photos.data)).toBe(true);

    const photosAll = await client.portPhotosAll(portId, { maxPages: 1 });
    expect(Array.isArray(photosAll.data)).toBe(true);

    const equipments = await client.portEquipments(portId);
    expect(Array.isArray(equipments)).toBe(true);

    const weather = await client.portWeather(portId);
    expect(Array.isArray(weather)).toBe(true);

    const shops = await client.portShops(portId);
    expect(Array.isArray(shops)).toBe(true);

    const nearby = await client.portBookableAround(portId, 3);
    expect(Array.isArray(nearby)).toBe(true);
  }, 180_000);

  it("covers mooring endpoints", async () => {
    const mooring = await client.mooring(mooringId) as Record<string, unknown>;
    expect(Number(mooring.id)).toBe(mooringId);

    const comments = await client.mooringComments(mooringId, { page: 1 });
    expect(Array.isArray(comments.data)).toBe(true);

    const commentsAll = await client.mooringCommentsAll(mooringId, { maxPages: 1 });
    expect(Array.isArray(commentsAll.data)).toBe(true);

    const photos = await client.mooringPhotos(mooringId, { page: 1 });
    expect(Array.isArray(photos.data)).toBe(true);

    const photosAll = await client.mooringPhotosAll(mooringId, { maxPages: 1 });
    expect(Array.isArray(photosAll.data)).toBe(true);

    const weather = await client.mooringWeather(mooringId);
    expect(Array.isArray(weather)).toBe(true);

    const shops = await client.mooringShops(mooringId);
    expect(Array.isArray(shops)).toBe(true);
  }, 180_000);

  it("covers region endpoints", async () => {
    const regions = await client.regions({ page: 1 });
    expect(Array.isArray(regions.data)).toBe(true);
    expect(regionId).toBeGreaterThan(0);

    const regionsAll = await client.regionsAll({ maxPages: 1 });
    expect(Array.isArray(regionsAll.data)).toBe(true);

    const region = await client.region(regionId) as Record<string, unknown>;
    expect(Number(region.id)).toBe(regionId);

    const ports = await client.regionPorts(regionId, { page: 1 });
    expect(Array.isArray(ports.data)).toBe(true);

    const portsAll = await client.regionPortsAll(regionId, { maxPages: 1 });
    expect(Array.isArray(portsAll.data)).toBe(true);

    const moorings = await client.regionMoorings(regionId, { page: 1 });
    expect(Array.isArray(moorings.data)).toBe(true);

    const mooringsAll = await client.regionMooringsAll(regionId, { maxPages: 1 });
    expect(Array.isArray(mooringsAll.data)).toBe(true);
  }, 180_000);

  it("covers personal read endpoints", async () => {
    const boats = await client.boats();
    expect(rowsFromResponse(boats)).toBeDefined();

    const lists = await client.lists();
    const listRows = rowsFromResponse(lists);
    expect(listRows).toBeDefined();
    listId = firstNumericId(listRows);

    if (listId > 0) {
      const entries = await client.listEntries(listId);
      expect(rowsFromResponse(entries)).toBeDefined();

      const comments = await client.listComments(listId, { page: 1 });
      expect(Array.isArray(comments.data)).toBe(true);

      const commentsAll = await client.listCommentsAll(listId, { maxPages: 1 });
      expect(Array.isArray(commentsAll.data)).toBe(true);
    }

    const cards = await client.cards();
    expect(Array.isArray(cards)).toBe(true);

    const notifications = await client.notifications();
    expect(Array.isArray(notifications)).toBe(true);

    const notificationCount = await client.notificationsCount();
    expect(notificationCount).toBeDefined();

    const demands = await client.demands();
    expect(Array.isArray(demands)).toBe(true);

    const demandInfos = await client.demandsInfos();
    expect(demandInfos).toBeDefined();

    const offers = await client.demandsOffers();
    expect(Array.isArray(offers)).toBe(true);

    const subscription = await client.subscriptionLast();
    expect(subscription).toBeDefined();
  }, 180_000);

  it("covers reference and proxy escape hatch reads", async () => {
    const countries = await client.countries();
    expect(countries.length).toBeGreaterThan(100);

    const proxiedCountries = await client.callProxy("/misc/countries", "get") as unknown[];
    expect(proxiedCountries.length).toBeGreaterThan(100);
  }, 120_000);

  it("downloads static maps and media for Aegina", async () => {
    const markers = aeginaSpots.slice(0, 8).map(markerFromSpot);

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

    const satellite = await createStaticMapImage({
      center: { latitude: 37.745, longitude: 23.43 },
      markers: markers.slice(0, 5),
      zoom: 12,
      width: 640,
      height: 420,
      outputDir,
      filename: "aegina-navily-live-satellite.svg",
      tileProvider: "esriWorldImagery",
    });
    expect(satellite.tileProvider).toBe("esriWorldImagery");
    expect(satellite.tiles).toBeGreaterThan(0);
    expect((await stat(satellite.path)).size).toBe(satellite.bytes);

    const thumbnail = await downloadStaticMapThumbnail({
      latitude: 37.745,
      longitude: 23.43,
      outputDir,
      filename: "aegina-navily-thumbnail.jpg",
    });
    expect(thumbnail.contentType).toMatch(/^image\//);
    expect(thumbnail.bytes).toBeGreaterThan(1024);
    expect((await stat(thumbnail.path)).size).toBe(thumbnail.bytes);

    const photo = await firstPhotoUrl(client, aeginaSpots);
    const media = await downloadMedia(client, {
      url: photo.url,
      outputDir,
      filename: `aegina-${photo.kind}-${photo.id}`,
    });
    expect(media.contentType).toMatch(/^image\//);
    expect(media.bytes).toBeGreaterThan(1024);
    expect((await stat(media.path)).size).toBe(media.bytes);
  }, 240_000);
});

async function searchAegina(client: NavilyClient): Promise<Array<Record<string, unknown>>> {
  const response = await client.mapSearch(37.745, 23.43, 25_000, "port,mooring");
  const results = Array.isArray(response.results) ? response.results : [];
  expect(results.length).toBeGreaterThan(0);
  return results as Array<Record<string, unknown>>;
}

async function discoverRegionId(client: NavilyClient): Promise<number> {
  const search = await client.quickSearch("Saronic") as { results?: { regions?: unknown } };
  const regions = Array.isArray(search.results?.regions)
    ? search.results.regions.filter(isRecord)
    : [];
  const id = firstNumericId(regions);
  expect(id).toBeGreaterThan(0);
  return id;
}

function idForKind(spots: Array<Record<string, unknown>>, kind: "port" | "mooring"): number {
  const row = spots.find((spot) => spot.kind === kind && Number(spot.id) > 0);
  const id = Number(row?.id);
  expect(id).toBeGreaterThan(0);
  return id;
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

function firstNumericId(rows: Array<Record<string, unknown>>): number {
  return Number(rows.find((row) => Number(row.id) > 0)?.id ?? 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
