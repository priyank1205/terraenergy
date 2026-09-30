// Tiny observable store with URL-hash persistence, so every view is linkable.

export const ENERGY_COMMODITIES = ["crude", "products", "lng", "pipeline_gas", "coal"];
export const COMMODITIES = [...ENERGY_COMMODITIES, "rare_earths"];
export const LENSES = ["flows", "balances", "chokepoints"];

export const DEFAULTS = {
  lens: "flows",
  commodity: "crude",
  topN: 60,
  metric: "hormuz_oil_share",
  year: 2025,
  selected: null, // { type: "country" | "flow" | "chokepoint", id }
  compare: null,
  partner: null, // ISO3 of a trading partner of the selected country
  trade: null, // { a: ISO3, b: ISO3, frequency: "A" | "M" }
  projection: "flat",
  layers: { pipelines: false, terminals: false, particles: true, labels: true },
  scenario: "hormuz",
  panelOpen: true,
};

const SEL_TYPES = new Set(["country", "flow", "chokepoint"]);

/** Parse a location hash into a partial state. Pure — tested. */
export function parseHash(hash) {
  const out = {};
  const q = new URLSearchParams(String(hash || "").replace(/^#\/?/, ""));
  const lens = q.get("lens");
  if (LENSES.includes(lens)) out.lens = lens;
  const c = q.get("c");
  if (c === "all" || COMMODITIES.includes(c)) out.commodity = c;
  const n = Number(q.get("n"));
  if (Number.isFinite(n) && n >= 5 && n <= 400) out.topN = Math.round(n);
  const m = q.get("m");
  if (m && /^[a-z0-9_]+$/.test(m)) out.metric = m;
  const y = Number(q.get("y"));
  if (Number.isInteger(y) && y >= 2000 && y <= 2025) out.year = y;
  const sel = q.get("sel");
  if (sel) {
    const [type, ...rest] = sel.split(":");
    const id = rest.join(":");
    if (SEL_TYPES.has(type) && id) out.selected = { type, id: type === "flow" ? Number(id) : id };
  }
  const cmp = q.get("cmp");
  if (cmp && /^[A-Z]{3}$/.test(cmp)) out.compare = cmp;
  const pt = q.get("pt");
  if (pt && /^[A-Z]{3}$/.test(pt) && out.selected?.type === "country" && out.selected.id !== pt) out.partner = pt;
  const pair = q.get("trade");
  if (pair && /^[A-Z]{3}-[A-Z]{3}$/.test(pair)) {
    const [a, b] = pair.split("-");
    if (a !== b) out.trade = { a, b, frequency: q.get("tf") === "M" ? "M" : "A" };
  }
  if (q.get("p") === "globe") out.projection = "globe";
  const sc = q.get("scenario");
  if (sc === "none") out.scenario = null;
  return out;
}

/** Serialize the linkable subset of state into a hash. Pure — tested. */
export function toHash(s) {
  const q = new URLSearchParams();
  q.set("lens", s.lens);
  if (s.lens === "flows") {
    q.set("c", s.commodity);
    if (s.topN !== DEFAULTS.topN) q.set("n", String(s.topN));
  }
  if (s.lens === "balances") {
    q.set("m", s.metric);
    if (s.year !== DEFAULTS.year) q.set("y", String(s.year));
  }
  if (s.selected) q.set("sel", `${s.selected.type}:${s.selected.id}`);
  if (s.compare) q.set("cmp", s.compare);
  if (s.partner && s.selected?.type === "country") q.set("pt", s.partner);
  if (s.trade) { q.set("trade", `${s.trade.a}-${s.trade.b}`); if (s.trade.frequency === "M") q.set("tf", "M"); }
  if (s.projection === "globe") q.set("p", "globe");
  if (s.scenario === null) q.set("scenario", "none");
  return `#${q.toString()}`;
}

export function createStore(initial) {
  let state = { ...DEFAULTS, ...initial, layers: { ...DEFAULTS.layers, ...(initial?.layers || {}) } };
  const subs = new Set();
  let urlTimer = null;

  function syncUrl() {
    if (typeof location === "undefined" || typeof history === "undefined") return; // non-browser (tests)
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const h = toHash(state);
      if (h !== location.hash) history.replaceState(null, "", h);
    }, 120);
  }

  return {
    get: () => state,
    set(patch) {
      if (patch.commodity && patch.commodity !== state.commodity && state.selected?.type === "flow" && !("selected" in patch)) {
        patch = { ...patch, selected: null };
      }
      // A partner belongs to the selected country; drop it when the selection moves elsewhere.
      if ("selected" in patch && !("partner" in patch) && state.partner && JSON.stringify(patch.selected) !== JSON.stringify(state.selected)) {
        patch = { ...patch, partner: null };
      }
      const next = { ...state, ...patch };
      if (patch.layers) next.layers = { ...state.layers, ...patch.layers };
      const changed = Object.keys(patch).filter((k) => JSON.stringify(state[k]) !== JSON.stringify(next[k]));
      if (!changed.length) return;
      state = next;
      subs.forEach((fn) => fn(state, new Set(changed)));
      syncUrl();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
