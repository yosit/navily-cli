// Live smoke test: wires the plugin into runline and executes some
// READ actions against ~/.config/navily/cookie. Skips writes (would
// mutate the real account). Run: node smoke.mjs
import { Runline } from "runline";
import navily from "./dist/index.js";

const rl = Runline.create({
  plugins: [navily],
  connections: [{ name: "navily", plugin: "navily", config: {} }],
});

const code = `
  const me = await navily.identity.whoami();
  const hits = await navily.search.quick({ q: "palma" });
  const top = hits.results.ports[0];
  const port = await navily.port.get({ portId: top.id });
  const weather = await navily.port.getWeather({ portId: top.id });
  const equipments = await navily.port.listEquipments({ portId: top.id });
  return {
    whoami: me,
    topMatch: { id: top.id, name: top.name, region: top.regionName },
    portRating: port.rating.general,
    portCity: port.city,
    forecastSample: weather.slice(0, 2).map(w => ({
      at: w.at, wind_speed: w.wind?.speed, wind_dir: w.wind?.direction
    })),
    equipmentKeys: equipments.map(e => e.key),
  };
`;

const out = await rl.execute(code);

if (out.error) {
  console.error("execute error:", out.error);
  process.exit(1);
}
console.log("logs:", out.logs);
console.log("\nresult:");
console.dir(out.result, { depth: null });

process.exit(0);
