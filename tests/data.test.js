import assert from "node:assert/strict";
import { test } from "node:test";
import { bilateral, buildDb, flowValue, flowYears, mergeParts, mergePortwatch, partners, ranking, refreshPortwatch, search, topFlows, tradeTotals, valueAt } from "../src/data.js";

function fixture() {
  const countries = ["SAU", "CHN", "JPN", "ARE", "USA"].map((iso) => ({
    iso, name: { SAU: "Saudi Arabia", CHN: "China", JPN: "Japan", ARE: "United Arab Emirates", USA: "United States" }[iso],
    region: "ME", flag: "", lp: [0, 0], ei: true, aliases: iso === "ARE" ? ["uae"] : iso === "USA" ? ["us", "america"] : [],
  }));
  const flows = [
    { id: 1, c: "crude", f: "SAU", t: "CHN", v: 1480, part: 0.92, cp: ["hormuz", "malacca"], y: 2025 },
    { id: 2, c: "crude", f: "SAU", t: "CHN", v: 130, part: 0.08, cp: ["bab_el_mandeb", "malacca"], y: 2025 },
    { id: 3, c: "crude", f: "ARE", t: "JPN", v: 900, cp: ["hormuz"], y: 2025 },
    { id: 4, c: "crude", f: "SAU", t: "JPN", v: 700, cp: ["hormuz"], y: 2025 },
    { id: 5, c: "lng", f: "USA", t: "JPN", v: 6, cp: ["cape_good_hope"], y: 2025 },
    { id: 6, c: "rare_earths", f: "CHN", t: "JPN", v: 18000, cp: [], y: 2025, years: [2024, 2025] },
  ];
  return buildDb({
    meta: { metrics: { oil_import_dep: { label: "Oil import dependence", unit: "%" } } },
    countries: { countries, regions: { ME: "Middle East" }, neighbours: {} },
    latest: { oil_import_dep: { JPN: [100, 2025, "EI"], CHN: [73, 2025, "EI"], USA: [0, 2025, "EI"] } },
    flows: { flows, nodes: [], node_names: [], units: { crude: "kb/d", lng: "bcm" } },
    chokepoints: { chokepoints: [{ id: "hormuz", name: "Strait of Hormuz", status: "closed" }], portwatch: {}, portwatch_names: {}, as_of: "2026-09-23" },
    context: {},
    world110: null,
  });
}

test("mergeParts combines terminal splits of the same trade", () => {
  const db = fixture();
  const merged = mergeParts(db.flows.filter((f) => f.c === "crude"));
  const sauChn = merged.find((f) => f.f === "SAU" && f.t === "CHN");
  assert.equal(sauChn.v, 1610);
  assert.equal(sauChn.parts.length, 2);
});

test("topFlows ranks logical trades but keeps every route segment", () => {
  const db = fixture();
  const top1 = topFlows(db, "crude", 1);
  assert.deepEqual(top1.map((f) => f.id).sort(), [1, 2]);
  const forJapan = topFlows(db, "crude", 10, { country: "JPN" });
  assert.deepEqual(forJapan.map((f) => f.id).sort(), [3, 4]);
});

test("partners shares add up to 100%", () => {
  const db = fixture();
  const { rows, total } = partners(db, "JPN", "crude", "imp");
  assert.equal(total, 1600);
  assert.deepEqual(rows.map((r) => r.iso), ["ARE", "SAU"]);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.share, 0) - 100) < 1e-9);
});

test("bilateral lists every commodity a pair trades, in both directions, with shares from each side", () => {
  const db = fixture();
  const jpn = bilateral(db, "JPN", "CHN");
  assert.deepEqual(jpn.exp, []);
  assert.equal(jpn.imp.length, 1);
  assert.equal(jpn.imp[0].c, "rare_earths");
  assert.equal(jpn.imp[0].share, 100);
  const sau = bilateral(db, "CHN", "SAU");
  assert.equal(sau.imp[0].v, 1610); // terminal splits merged
  assert.deepEqual(sau.imp[0].flows.map((f) => f.id), [1, 2]);
  assert.equal(sau.imp[0].share, 100); // all of China's crude imports
  assert.ok(Math.abs(sau.imp[0].partnerShare - (100 * 1610) / 2310) < 1e-9); // part of Saudi crude exports
  const japan = bilateral(db, "JPN", "SAU");
  assert.equal(japan.imp[0].share, (100 * 700) / 1600);
  assert.deepEqual(bilateral(db, "JPN", "USA").imp.map((r) => r.c), ["lng"]);
});

test("tradeTotals sums imports and exports per commodity", () => {
  const db = fixture();
  const t = tradeTotals(db, "SAU");
  assert.equal(t.crude.exp, 2310);
  assert.equal(t.crude.imp, 0);
  assert.equal(tradeTotals(db, "JPN").lng.imp, 6);
});

test("all-commodity view compares on an energy basis", () => {
  const db = fixture();
  const lng = db.flowById.get(5);
  const crude = db.flowById.get(3);
  assert.ok(flowValue(lng, "all") > 0 && flowValue(crude, "all") > flowValue(lng, "all"));
  assert.equal(flowValue(crude, "crude"), 900);
});

test("rare earth trade uses tonnes and stays out of energy rankings and partners", () => {
  const db = fixture();
  assert.deepEqual(topFlows(db, "rare_earths", 10).map((f) => f.id), [6]);
  assert.equal(flowValue(db.flowById.get(6), "rare_earths"), 18000);
  assert.equal(tradeTotals(db, "JPN").rare_earths.imp, 18000);
  assert.equal(partners(db, "JPN", "rare_earths", "imp").rows[0].share, 100);
  assert.ok(topFlows(db, "all", 400).every((f) => f.c !== "rare_earths"));
  assert.ok(partners(db, "JPN", "all", "imp").rows.every((r) => r.iso !== "CHN"));
  assert.deepEqual(topFlows(db, "rare_earths", 20, { country: "USA" }), []);
  assert.equal(flowYears([db.flowById.get(6)]), "2024 / 2025");
});

test("ranking and valueAt", () => {
  const db = fixture();
  assert.deepEqual(ranking(db, "oil_import_dep", 2).map((r) => r.iso), ["JPN", "CHN"]);
  assert.equal(valueAt(db, "oil_import_dep", "CHN", 2025).v, 73);
  assert.equal(valueAt(db, "oil_import_dep", "CHN", 2010), null); // no history loaded, no fabricated past
});

test("search matches names, aliases and chokepoints", () => {
  const db = fixture();
  assert.equal(search(db, "uae", {})[0].id, "ARE");
  assert.equal(search(db, "america", {})[0].id, "USA");
  assert.equal(search(db, "hormuz", {})[0].kind, "chokepoint");
  assert.deepEqual(search(db, "   ", {}), []);
});

test("mergePortwatch appends new days, skips known ones and leaves gaps empty", () => {
  const db = { portwatch: { chokepoint6: { start: "2026-09-18", end: "2026-09-20", tanker: [2, 0, 1], total: [7, 3, 6], tanker_dwt: [1, 0, 1] } } };
  const added = mergePortwatch(db, [
    { portid: "chokepoint6", date: Date.UTC(2026, 8, 20), n_tanker: 9, n_total: 9 }, // already present
    { portid: "chokepoint6", date: "2026-09-22", n_tanker: 3, n_total: 8, capacity_tanker: 5000 },
    { portid: "chokepoint99", date: "2026-09-22", n_tanker: 1, n_total: 1 }, // unknown chokepoint
  ]);
  const s = db.portwatch.chokepoint6;
  assert.equal(added, 1);
  assert.deepEqual(s.tanker, [2, 0, 1, null, 3]);
  assert.equal(s.end, "2026-09-22");
  assert.equal(db.portwatchLive, true);
});

test("refreshPortwatch never throws when offline", async () => {
  const db = { portwatch: { chokepoint6: { start: "2026-09-18", end: "2026-09-20", tanker: [1], total: [1], tanker_dwt: [1] } } };
  const added = await refreshPortwatch(db, { fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(added, 0);
});
