import assert from "node:assert/strict";
import { test } from "node:test";
import { periodLabel, productRows, savedPair, tradeCsv, liveTradeAvailable, loadLatestTrade } from "../src/trade.js";

const record = (patch = {}) => ({ exporter: "CHN", importer: "USA", reporter: "USA", flow: "M", hs: "284690",
  category: "rare_earths", product: "Other rare earth compounds", frequency: "A", period: "2025", tonnes: 100,
  usd: 9000, weight_estimated: false, ...patch });

test("the buyer and seller declarations stay separate in both directions", () => {
  const data = { snapshots: [{ records: [record(), record({ reporter: "CHN", flow: "X", tonnes: 91, usd: 8000 }),
    record({ exporter: "USA", importer: "CHN", reporter: "CHN", tonnes: 3 })] }] };
  const forward = productRows(data, "CHN", "USA");
  assert.equal(forward.length, 1);
  assert.equal(forward[0].imports[0].tonnes, 100);
  assert.equal(forward[0].exports[0].tonnes, 91);
  assert.equal(productRows(data, "USA", "CHN")[0].imports[0].tonnes, 3);
  assert.equal(productRows(data, "USA", "CHN")[0].exports.length, 0);
  assert.deepEqual(productRows(data, "CHN", "USA", "coal"), []);
});

test("saved fallback retains the latest product declaration without dropping older product coverage", () => {
  const data = savedPair({ records: [record({ period: "2024", tonnes: 1 }), record(),
    record({ hs: "280530", period: "2024", tonnes: null, usd: 4 }), record({ importer: "JPN", reporter: "JPN" })] }, "CHN", "USA");
  const rows = productRows(data, "CHN", "USA");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.hs === "284690").imports[0].tonnes, 100);
  assert.equal(rows.find((r) => r.hs === "280530").imports[0].tonnes, null);
  assert.equal(data.snapshots[1].period, "2024 / 2025");
  assert.equal(data.snapshots[1].checked_at, null);
});

test("an aggregate does not double count its subdivisions", () => {
  const rows = productRows({ snapshots: [{ records: [record({ hs: "2710", category: "products" }),
    record({ hs: "271019", category: "products" })] }] }, "CHN", "USA");
  assert.deepEqual(rows.map((r) => r.hs), ["271019"]);
});

test("CSV keeps missing weights empty, estimates flagged, and original source precision", () => {
  const data = { snapshots: [{ records: [record({ tonnes: null, product: 'Compound, "mixed"' }),
    record({ hs: "280530", tonnes: 0.000123, weight_estimated: true })] }] };
  const csv = tradeCsv(data);
  assert.ok(csv.includes('"Compound, ""mixed"""'));
  assert.ok(csv.includes('"0.000123","true"'));
  assert.ok(csv.includes('"A","","false"'));
  assert.equal(csv.split("\n").length, 3);
  assert.equal(tradeCsv(data, "coal").split("\n").length, 1);
  assert.equal(periodLabel("202607"), "July 2026");
  assert.equal(periodLabel("2025"), "2025");
});

test("a static host without the local API switches the explorer to saved records", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("<!doctype html>Not found", { status: 404, headers: { "content-type": "text/html" } }); };
  try {
    assert.equal(liveTradeAvailable(), true);
    await assert.rejects(loadLatestTrade("CHN", "USA", "A"), (e) => e.code === "no-server");
    assert.equal(liveTradeAvailable(), false);
    await assert.rejects(loadLatestTrade("CHN", "IND", "A"), (e) => e.code === "no-server");
    assert.equal(calls, 1, "later lookups don't ask again");
  } finally {
    globalThis.fetch = realFetch;
  }
});
