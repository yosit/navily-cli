/** Output formatters: JSON (default) and a compact table format for terminal use. */
import Table from "cli-table3";

export function emitJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

const PREFERRED_COLUMNS = [
  "id", "kind", "name", "type", "city", "country", "countryCode",
  "regionName", "bookable", "rating", "distance", "createdAt", "updatedAt",
];

const MAX_CELL_LEN = 80;

export function emitTable(data: unknown, title?: string): void {
  // Laravel-paginated resource: render data[] and footer
  if (isObject(data) && Array.isArray((data as { data?: unknown }).data)) {
    const rows = (data as { data: unknown[] }).data;
    renderRows(rows, title);
    const meta = (data as { meta?: unknown }).meta;
    if (isObject(meta) && "current_page" in (meta as Record<string, unknown>)) {
      const m = meta as Record<string, unknown>;
      const from = m.from ?? 0;
      const to = m.to ?? 0;
      const total = m.total ?? "?";
      process.stdout.write(
        `page ${m.current_page}/${m.last_page} — ${from}–${to} of ${total}\n`,
      );
    }
    return;
  }

  if (Array.isArray(data)) {
    renderRows(data, title);
    return;
  }

  if (isObject(data)) {
    renderKeyValue(data as Record<string, unknown>, title);
    return;
  }

  process.stdout.write(String(data) + "\n");
}

function renderRows(rows: unknown[], title?: string): void {
  if (rows.length === 0) {
    process.stdout.write(`${title ? title + ": " : ""}(empty)\n`);
    return;
  }
  if (!isObject(rows[0])) {
    // scalar list
    rows.forEach(r => process.stdout.write(String(r) + "\n"));
    return;
  }

  const keys = orderedKeys(rows as Record<string, unknown>[]);
  const cols = keys.slice(0, 12);
  const table = new Table({
    head: cols,
    style: { head: ["bold"], border: [] },
    wordWrap: true,
  });
  for (const row of rows as Record<string, unknown>[]) {
    table.push(cols.map(c => fmtCell(row[c])));
  }
  if (title) process.stdout.write(title + "\n");
  process.stdout.write(table.toString() + "\n");
}

function renderKeyValue(d: Record<string, unknown>, title?: string): void {
  const table = new Table({
    style: { border: [] },
    wordWrap: true,
  });
  for (const [k, v] of Object.entries(d)) {
    table.push([{ content: k, hAlign: "left", vAlign: "top" }, fmtCell(v)]);
  }
  if (title) process.stdout.write(title + "\n");
  process.stdout.write(table.toString() + "\n");
}

function orderedKeys(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  const out: string[] = [];
  for (const k of PREFERRED_COLUMNS) if (seen.has(k)) out.push(k);
  for (const k of seen) if (!out.includes(k)) out.push(k);
  return out;
}

export function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "✓" : "·";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return truncate(v);
  if (Array.isArray(v)) {
    const allPrimitives = v.every(
      x => typeof x === "string" || typeof x === "number" || typeof x === "boolean",
    );
    if (allPrimitives) return truncate(v.map(x => String(x)).join(", "));
    return `[${v.length} items]`;
  }
  if (isObject(v)) {
    const r = v as Record<string, unknown>;
    if (typeof r.name === "string") return r.name;
    if (typeof r.id === "number") return `#${r.id}`;
    return truncate(JSON.stringify(r));
  }
  return String(v);
}

function truncate(s: string): string {
  if (s.length <= MAX_CELL_LEN) return s;
  return s.slice(0, MAX_CELL_LEN - 1) + "…";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
