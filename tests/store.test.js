import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, DEFAULTS, parseHash, stateFromHash, toHash } from "../src/store.js";

test("parseHash reads valid parameters", () => {
  const s = parseHash("#lens=flows&c=lng&n=80&sel=country:JPN&p=globe");
  assert.deepEqual(s, { lens: "flows", commodity: "lng", topN: 80, selected: { type: "country", id: "JPN" }, projection: "globe" });
});

test("parseHash rejects invalid or hostile values", () => {
  const s = parseHash("#lens=evil&c=plutonium&n=99999&y=1850&m=<script>&sel=bogus:1&cmp=usa");
  assert.deepEqual(s, {});
});

test("flow selection ids are numbers", () => {
  assert.deepEqual(parseHash("#sel=flow:42").selected, { type: "flow", id: 42 });
});

test("toHash round-trips the linkable state", () => {
  const state = { ...DEFAULTS, lens: "balances", metric: "oil_import_dep", year: 2010, selected: { type: "chokepoint", id: "hormuz" } };
  const back = parseHash(toHash(state));
  assert.equal(back.lens, "balances");
  assert.equal(back.metric, "oil_import_dep");
  assert.equal(back.year, 2010);
  assert.deepEqual(back.selected, { type: "chokepoint", id: "hormuz" });
});

test("toHash omits defaults to keep links short", () => {
  assert.equal(toHash({ ...DEFAULTS }), "#lens=flows&c=crude");
});

test("country trade URLs preserve countries and monthly mode", () => {
  const trade = { a: "CHN", b: "USA", frequency: "M" };
  assert.deepEqual(parseHash(toHash({ ...DEFAULTS, trade })).trade, trade);
  assert.equal(parseHash("#trade=USA-USA").trade, undefined);
  assert.equal(parseHash("#trade=evil-USA").trade, undefined);
});

test("rare earth links round-trip and switching commodities clears stale flow selection", () => {
  const state = { ...DEFAULTS, commodity: "rare_earths", selected: { type: "country", id: "CHN" } };
  assert.equal(parseHash(toHash(state)).commodity, "rare_earths");
  const store = createStore({ selected: { type: "flow", id: 1 } });
  store.set({ commodity: "rare_earths" });
  assert.equal(store.get().selected, null);
  store.set({ selected: state.selected, commodity: "crude" });
  store.set({ commodity: "rare_earths" });
  assert.deepEqual(store.get().selected, state.selected);
});

test("partner links round-trip only with a selected country and clear when the selection moves", () => {
  const state = { ...DEFAULTS, selected: { type: "country", id: "IND" }, partner: "RUS" };
  assert.equal(parseHash(toHash(state)).partner, "RUS");
  assert.equal(parseHash("#pt=RUS").partner, undefined);
  assert.equal(parseHash("#sel=country:IND&pt=IND").partner, undefined);
  assert.equal(parseHash("#sel=country:IND&pt=rus").partner, undefined);
  const store = createStore({ selected: state.selected, partner: "RUS" });
  store.set({ commodity: "coal" });
  assert.equal(store.get().partner, "RUS");
  store.set({ selected: { type: "country", id: "IND" } }); // same selection keeps the partner
  assert.equal(store.get().partner, "RUS");
  store.set({ selected: { type: "country", id: "RUS" } });
  assert.equal(store.get().partner, null);
});

test("store notifies only on real changes and merges layers", () => {
  const store = createStore({});
  const seen = [];
  store.subscribe((_s, changed) => seen.push([...changed]));
  store.set({ commodity: "coal" });
  store.set({ commodity: "coal" }); // no-op
  store.set({ layers: { pipelines: true } });
  assert.deepEqual(seen, [["commodity"], ["layers"]]);
  assert.equal(store.get().layers.particles, true);
  assert.equal(store.get().layers.pipelines, true);
});

test("stateFromHash resets whatever a link leaves out, so no stale selection survives", () => {
  const s = stateFromHash("#lens=balances&m=co2_pc_t");
  assert.equal(s.lens, "balances");
  assert.equal(s.metric, "co2_pc_t");
  assert.equal(s.year, DEFAULTS.year);
  for (const k of ["selected", "compare", "partner", "trade"]) assert.equal(s[k], null, k);
  assert.equal(s.projection, "flat");
  assert.equal(s.scenario, "hormuz");
  assert.equal("commodity" in s, false, "the flows commodity isn't in a balances link, so the current one is kept");
  assert.deepEqual(stateFromHash("").selected, null);
  assert.equal(stateFromHash("").commodity, DEFAULTS.commodity);
  assert.equal(stateFromHash("#lens=flows&c=lng").topN, DEFAULTS.topN);
  assert.deepEqual(stateFromHash("#lens=chokepoints&sel=chokepoint:hormuz").selected, { type: "chokepoint", id: "hormuz" });
});

test("navigation adds a Back entry; sliders and URL-driven updates replace the current one", async () => {
  const calls = [];
  const loc = { hash: "" };
  globalThis.location = loc;
  globalThis.history = {
    pushState: (_s, _t, h) => { calls.push(["push", h]); loc.hash = h; },
    replaceState: (_s, _t, h) => { calls.push(["replace", h]); loc.hash = h; },
  };
  const settle = () => new Promise((r) => setTimeout(r, 160));
  try {
    const store = createStore({});
    store.set({ topN: 80 });
    await settle();
    store.set({ selected: { type: "country", id: "IND" } });
    store.set({ commodity: "lng" }); // batched with the selection: still one entry
    await settle();
    store.set({ selected: null }, { history: "replace" });
    await settle();
    assert.deepEqual(calls.map((c) => c[0]), ["replace", "push", "replace"]);
    assert.match(calls[1][1], /sel=country%3AIND/);
  } finally {
    delete globalThis.location;
    delete globalThis.history;
  }
});
