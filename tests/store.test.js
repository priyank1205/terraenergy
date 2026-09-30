import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, DEFAULTS, parseHash, toHash } from "../src/store.js";

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
