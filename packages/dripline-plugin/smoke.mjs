// Quick live smoke test: wires the plugin into dripline and runs a few SELECTs
// against the cookie at ~/.config/navily/cookie. Run with: node smoke.mjs

import { Dripline } from "dripline";
import navily from "./dist/index.js";

const dl = await Dripline.create({
  plugins: [navily],
  connections: [{ name: "navily", plugin: "navily", config: {} }],
  cache: { enabled: false },
});

async function show(label, sql) {
  console.log(`\n── ${label} ──`);
  console.log(sql);
  try {
    const rows = await dl.query(sql);
    console.log(`${rows.length} row(s)`);
    for (const r of rows.slice(0, 3)) console.log(r);
  } catch (e) {
    console.error("query failed:", e?.message ?? e);
  }
}

console.log("tables:", dl.tables().map((t) => t.table).slice(0, 5), "…");

await show("whoami", "SELECT * FROM navily_whoami");
await show(
  "countries (5)",
  "SELECT id, code, name, vhf FROM navily_countries ORDER BY id LIMIT 5",
);
await show(
  "search 'palma'",
  "SELECT id, kind, name, region_name FROM navily_search WHERE q = 'palma' LIMIT 5",
);
await show(
  "port 686",
  "SELECT id, name, country_code, city, place_number, rating_general, comments FROM navily_port WHERE id = 686",
);
await show(
  "port 686 weather (4)",
  "SELECT forecast_at, temperature, wind_speed, wind_direction, score FROM navily_port_weather WHERE port_id = 686 LIMIT 4",
);
await show(
  "port 686 equipments",
  "SELECT key, name, cost, is_available FROM navily_port_equipments WHERE port_id = 686 LIMIT 6",
);
await show(
  "map search Palma harbour",
  "SELECT id, kind, name, distance, rating FROM navily_map_search WHERE center_latitude = '39.5696' AND center_longitude = '2.6502' AND max_distance = 30000 ORDER BY distance LIMIT 5",
);

await dl.close();
process.exit(0);
