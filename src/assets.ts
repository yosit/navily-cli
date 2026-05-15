import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { NavilyClient } from "./client.js";

const TILE_SIZE = 256;
const DEFAULT_TILE_URL_TEMPLATE =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const USER_AGENT = "navily-cli/0.3.0 (+https://github.com/yosit/navily-cli)";
const MAX_MERCATOR_LATITUDE = 85.05112878;

export interface StaticMapMarker {
  latitude: number;
  longitude: number;
  label?: string;
  color?: string;
}

export interface StaticMapOptions {
  center?: { latitude: number; longitude: number };
  markers?: StaticMapMarker[];
  zoom?: number;
  width?: number;
  height?: number;
  outputDir?: string;
  filename?: string;
  tileUrlTemplate?: string;
}

export interface StaticMapResult {
  path: string;
  contentType: "image/svg+xml";
  bytes: number;
  width: number;
  height: number;
  zoom: number;
  center: { latitude: number; longitude: number };
  markers: number;
  tiles: number;
}

export interface MediaDownloadOptions {
  url: string;
  outputDir?: string;
  filename?: string;
}

export interface MediaDownloadResult {
  path: string;
  contentType: string;
  bytes: number;
  url: string;
}

export async function createStaticMapImage(
  options: StaticMapOptions,
): Promise<StaticMapResult> {
  const markers = (options.markers ?? []).map(normalizeMarker);
  const center = options.center
    ? normalizeCoordinate(options.center)
    : centerFromMarkers(markers);
  const width = boundedInteger(options.width ?? 1024, 128, 4096, "width");
  const height = boundedInteger(options.height ?? 768, 128, 4096, "height");
  const zoom = boundedInteger(options.zoom ?? 13, 1, 19, "zoom");
  const template =
    options.tileUrlTemplate ??
    process.env.NAVILY_TILE_URL_TEMPLATE ??
    DEFAULT_TILE_URL_TEMPLATE;

  const centerPx = coordinateToWorldPixel(center.latitude, center.longitude, zoom);
  const left = centerPx.x - width / 2;
  const top = centerPx.y - height / 2;
  const minTileX = Math.floor(left / TILE_SIZE);
  const maxTileX = Math.floor((left + width) / TILE_SIZE);
  const minTileY = Math.floor(top / TILE_SIZE);
  const maxTileY = Math.floor((top + height) / TILE_SIZE);
  const tileCount = 2 ** zoom;
  const tileImages: string[] = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) continue;
      const wrappedX = wrapTileX(tileX, tileCount);
      const tileUrl = template
        .replaceAll("{z}", String(zoom))
        .replaceAll("{x}", String(wrappedX))
        .replaceAll("{y}", String(tileY));
      const tile = await fetchTile(tileUrl);
      if (!tile) continue;
      const x = tileX * TILE_SIZE - left;
      const y = tileY * TILE_SIZE - top;
      tileImages.push(
        `<image x="${round(x)}" y="${round(y)}" width="${TILE_SIZE}" height="${TILE_SIZE}" href="data:${tile.contentType};base64,${tile.base64}" />`,
      );
    }
  }

  if (tileImages.length === 0) {
    throw new Error("No map tiles could be downloaded for the requested static image.");
  }

  const markerSvg = markers
    .map((marker) => {
      const px = coordinateToWorldPixel(marker.latitude, marker.longitude, zoom);
      const x = px.x - left;
      const y = px.y - top;
      const color = marker.color ?? "#d62828";
      const label = marker.label
        ? `<text x="${round(x + 12)}" y="${round(y - 10)}" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="700" paint-order="stroke" stroke="#ffffff" stroke-width="4" fill="#111827">${escapeXml(marker.label)}</text>`
        : "";
      return `<g><circle cx="${round(x)}" cy="${round(y)}" r="8" fill="${escapeXml(color)}" stroke="#ffffff" stroke-width="3" /><circle cx="${round(x)}" cy="${round(y)}" r="2.5" fill="#ffffff" />${label}</g>`;
    })
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#cfd8dc" />
  ${tileImages.join("\n  ")}
  ${markerSvg}
  <text x="10" y="${height - 10}" font-family="Inter, Arial, sans-serif" font-size="11" fill="#111827" paint-order="stroke" stroke="#ffffff" stroke-width="3">Map tiles (c) OpenStreetMap contributors</text>
</svg>
`;

  const outputPath = await writeOutput(
    options.outputDir,
    options.filename ?? `navily-map-${Date.now()}.svg`,
    Buffer.from(svg, "utf8"),
  );

  return {
    path: outputPath,
    contentType: "image/svg+xml",
    bytes: Buffer.byteLength(svg),
    width,
    height,
    zoom,
    center,
    markers: markers.length,
    tiles: tileImages.length,
  };
}

export async function downloadMedia(
  client: NavilyClient,
  options: MediaDownloadOptions,
): Promise<MediaDownloadResult> {
  const downloaded = await client.downloadBinary(options.url);
  const body = downloaded.body;
  const filename = withExtension(
    sanitizeFilename(options.filename ?? filenameFromUrl(downloaded.url)),
    extensionForContentType(downloaded.contentType),
  );
  const outputPath = await writeOutput(options.outputDir, filename, body);
  return {
    path: outputPath,
    contentType: downloaded.contentType,
    bytes: body.byteLength,
    url: downloaded.url,
  };
}

function normalizeMarker(marker: StaticMapMarker): StaticMapMarker {
  const coordinate = normalizeCoordinate(marker);
  return {
    ...coordinate,
    label: marker.label,
    color: marker.color,
  };
}

function normalizeCoordinate(coordinate: {
  latitude: number;
  longitude: number;
}): { latitude: number; longitude: number } {
  if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)) {
    throw new Error("Invalid coordinate; latitude and longitude must be finite numbers.");
  }
  return {
    latitude: Math.max(
      -MAX_MERCATOR_LATITUDE,
      Math.min(MAX_MERCATOR_LATITUDE, coordinate.latitude),
    ),
    longitude: coordinate.longitude,
  };
}

function centerFromMarkers(markers: StaticMapMarker[]): {
  latitude: number;
  longitude: number;
} {
  if (markers.length === 0) {
    throw new Error("Static map requires a center coordinate or at least one marker.");
  }
  return normalizeCoordinate({
    latitude: markers.reduce((sum, m) => sum + m.latitude, 0) / markers.length,
    longitude: markers.reduce((sum, m) => sum + m.longitude, 0) / markers.length,
  });
}

function coordinateToWorldPixel(latitude: number, longitude: number, zoom: number): {
  x: number;
  y: number;
} {
  const lat = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const sin = Math.sin((lat * Math.PI) / 180);
  const scale = TILE_SIZE * 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

async function fetchTile(url: string): Promise<{
  contentType: string;
  base64: string;
} | null> {
  const res = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "image/png";
  return {
    contentType,
    base64: Buffer.from(await res.arrayBuffer()).toString("base64"),
  };
}

async function writeOutput(
  outputDir: string | undefined,
  filename: string,
  body: Buffer,
): Promise<string> {
  const dir = resolve(outputDir ?? process.env.NAVILY_OUTPUT_DIR ?? join(process.cwd(), "navily-output"));
  await mkdir(dir, { recursive: true });
  const path = join(dir, sanitizeFilename(filename));
  await writeFile(path, body);
  return path;
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  const integer = Math.round(value);
  if (integer < min || integer > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return integer;
}

function wrapTileX(x: number, tileCount: number): number {
  return ((x % tileCount) + tileCount) % tileCount;
}

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const base = basename(parsed.pathname);
    return base || `navily-media-${Date.now()}`;
  } catch {
    return `navily-media-${Date.now()}`;
  }
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "navily-output";
}

function withExtension(filename: string, extension: string): string {
  return extname(filename) ? filename : `${filename}.${extension}`;
}

function extensionForContentType(contentType: string): string {
  const clean = contentType.split(";")[0]?.trim().toLowerCase();
  if (clean === "image/jpeg" || clean === "image/jpg") return "jpg";
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  if (clean === "image/svg+xml") return "svg";
  return "bin";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function round(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}
