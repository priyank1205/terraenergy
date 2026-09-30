// Data loading, indexing and selectors. Selectors are pure functions over the `db` object
// so they can be unit-tested without a browser.

import { COMMODITIES, ENERGY_COMMODITIES } from "./store.js";
import { toEJ } from "./format.js";

export const COMMODITY_META = {
  crude: { label: "Crude oil", short: "Crude", unit: "kb/d", group: "oil" },
  products: { label: "Oil products", short: "Products", unit: "kb/d", group: "oil" },
  lng: { label: "LNG", short: "LNG", unit: "bcm", group: "gas" },
  pipeline_gas: { label: "Pipeline gas", short: "Pipeline gas", unit: "bcm", group: "gas" },
  coal: { label: "Coal", short: "Coal", unit: "Mt", group: "coal" },
  rare_earths: { label: "Rare earths", short: "Rare earths", unit: "t", group: "minerals" },
  all: { label: "All energy trade", short: "All energy", unit: "EJ", group: "all" },
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadCore(base = "public/data/") {
  const [meta, countries, latest, flows, chokepoints, context, world] = await Promise.all([
    getJSON(`${base}meta.json`),
    getJSON(`${base}countries.json`),
    getJSON(`${base}latest.json`),
    getJSON(`${base}flows.json`),
    getJSON(`${base}chokepoints.json`),
    getJSON(`${base}context.json`),
    getJSON(`${base}world-110m.json`),
  ]);
  return buildDb({ meta, countries, latest, flows, chokepoints, context, world110: world });
}

export const loadHistory = (base = "public/data/") => getJSON(`${base}history.json`);

const PORTWATCH_API = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";

/**
 * Append any days IMF PortWatch has published since the bundled snapshot (it updates weekly).
 * Returns the number of new days merged; never throws (offline → 0).
 */
export async function refreshPortwatch(db, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const ids = Object.keys(db.portwatch || {});
  if (!ids.length) return 0;
  const lastEnd = ids.map((id) => db.portwatch[id].end).sort()[0];
  const where = `date > timestamp '${lastEnd} 00:00:00' AND portid IN (${ids.map((i) => `'${i}'`).join(",")})`;
  const url = `${PORTWATCH_API}?${new URLSearchParams({
    where, outFields: "date,portid,n_tanker,n_total,capacity_tanker", orderByFields: "date", resultRecordCount: "2000", f: "json",
  })}`;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) return 0;
    const json = await res.json();
    return mergePortwatch(db, (json.features || []).map((f) => f.attributes));
  } catch (e) {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Merge daily PortWatch records into the bundled series (pure; tested). */
export function mergePortwatch(db, records) {
  let added = 0;
  const dayMs = 864e5;
  for (const r of records) {
    const s = db.portwatch[r.portid];
    if (!s || !r.date) continue;
    const date = typeof r.date === "number" ? new Date(r.date).toISOString().slice(0, 10) : String(r.date).slice(0, 10);
    const idx = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${s.start}T00:00:00Z`)) / dayMs);
    if (idx < s.tanker.length) continue; // already have it
    while (s.tanker.length < idx) { // gap days stay empty rather than invented
      s.tanker.push(null); s.total.push(null); s.tanker_dwt.push(null);
    }
    s.tanker.push(r.n_tanker ?? null);
    s.total.push(r.n_total ?? null);
    s.tanker_dwt.push(r.capacity_tanker != null ? Math.round(r.capacity_tanker / 1000) : null);
    if (date > s.end) s.end = date;
    added++;
  }
  if (added) db.portwatchLive = true;
  return added;
}

export const loadWorld50 = (base = "public/data/") => getJSON(`${base}world-50m.json`);

/** Assemble indexes. Pure given parsed JSON. */
export function buildDb({ meta, countries, latest, flows, chokepoints, context, world110 }) {
  const byIso = new Map(countries.countries.map((c) => [c.iso, c]));
  const flowList = flows.flows;
  const flowById = new Map(flowList.map((f) => [f.id, f]));
  const byCountry = new Map();
  for (const f of flowList) {
    for (const [iso, dir] of [[f.f, "exp"], [f.t, "imp"]]) {
      if (!byCountry.has(iso)) byCountry.set(iso, { imp: [], exp: [] });
      byCountry.get(iso)[dir].push(f);
    }
  }
  const cpById = new Map(chokepoints.chokepoints.map((c) => [c.id, c]));
  return {
    meta, countries: countries.countries, regions: countries.regions, neighbours: countries.neighbours,
    byIso, latest, flows: flowList, flowById, byCountry, nodes: flows.nodes, nodeNames: flows.node_names,
    units: flows.units, flowCoverage: flows.coverage || {}, chokepoints: chokepoints.chokepoints, cpById, portwatch: chokepoints.portwatch,
    portwatchNames: chokepoints.portwatch_names, asOf: chokepoints.as_of, context, world110, world50: null,
    history: null,
  };
}

export const countryName = (db, iso) => db.byIso.get(iso)?.name ?? iso;
export const flag = (db, iso) => db.byIso.get(iso)?.flag || "🏳️";

/** Latest value for a metric: { v, year, src } or null. */
export function latestValue(db, metric, iso) {
  const row = db.latest[metric]?.[iso];
  return row ? { v: row[0], year: row[1], src: row[2] } : null;
}

/** Value for a metric in a given year (falls back to latest when history isn't loaded). */
export function valueAt(db, metric, iso, year) {
  // The newest slider position means "latest available" (2025 for EI countries, 2024 for most others).
  if (year == null || year >= 2025) return latestValue(db, metric, iso);
  const series = db.history?.series?.[metric]?.[iso];
  if (series && db.history) {
    const i = db.history.years.indexOf(year);
    const v = i >= 0 ? series[i] : null;
    if (v != null) return { v, year, src: db.latest[metric]?.[iso]?.[2] };
    return null;
  }
  const l = latestValue(db, metric, iso);
  return l && (year == null || l.year === year || year >= 2025) ? l : null;
}

export const flowValue = (f, commodity) => (commodity === "all" ? toEJ(f.v, f.c) : f.v);
export const matchesCommodity = (f, commodity) => commodity === "all" ? ENERGY_COMMODITIES.includes(f.c) : f.c === commodity;
export const flowYears = (flows) => [...new Set(flows.flatMap((f) => f.years || [f.y]))].sort().join(" / ") || "No data";

/** Aggregate flows between the same pair (terminal splits) into one logical flow. */
export function mergeParts(flows) {
  const m = new Map();
  for (const f of flows) {
    const k = `${f.f}|${f.t}|${f.c}`;
    const cur = m.get(k);
    if (cur) {
      cur.v += f.v;
      cur.parts.push(f);
    } else m.set(k, { ...f, parts: [f] });
  }
  return [...m.values()];
}

/** Top-N routed flows for the map (each route segment kept separately for drawing). */
export function topFlows(db, commodity, n, { country = null } = {}) {
  let list = country ? [...(db.byCountry.get(country)?.imp ?? []), ...(db.byCountry.get(country)?.exp ?? [])] : db.flows;
  list = list.filter((f) => matchesCommodity(f, commodity));
  const merged = mergeParts(list).sort((a, b) => flowValue(b, commodity) - flowValue(a, commodity));
  const keep = new Set(merged.slice(0, n).map((f) => `${f.f}|${f.t}|${f.c}`));
  return list.filter((f) => keep.has(`${f.f}|${f.t}|${f.c}`));
}

/** Trading partners of a country for one commodity: [{iso, v, share, flows}] sorted desc. */
export function partners(db, iso, commodity, dir) {
  const list = db.byCountry.get(iso)?.[dir] ?? [];
  const agg = new Map();
  for (const f of list) {
    if (!matchesCommodity(f, commodity)) continue;
    const other = dir === "imp" ? f.f : f.t;
    const v = flowValue(f, commodity);
    const cur = agg.get(other) || { iso: other, v: 0, flows: [] };
    cur.v += v;
    cur.flows.push(f);
    agg.set(other, cur);
  }
  const rows = [...agg.values()].sort((a, b) => b.v - a.v);
  const total = rows.reduce((s, r) => s + r.v, 0);
  rows.forEach((r) => (r.share = total ? (100 * r.v) / total : 0));
  return { rows, total };
}

/**
 * Everything one country trades with one partner, per commodity:
 * { imp: [...], exp: [...] } with rows {c, v, share, partnerShare, flows}. `share` is the partner's
 * part of `iso`'s imports (or exports) of that commodity; `partnerShare` is the same trade from the partner's side.
 */
export function bilateral(db, iso, partner) {
  const own = tradeTotals(db, iso);
  const theirs = tradeTotals(db, partner);
  const side = (dir) => {
    const rows = new Map();
    for (const f of db.byCountry.get(iso)?.[dir] ?? []) {
      if ((dir === "imp" ? f.f : f.t) !== partner) continue;
      const row = rows.get(f.c) || { c: f.c, v: 0, flows: [] };
      row.v += f.v;
      row.flows.push(f);
      rows.set(f.c, row);
    }
    const other = dir === "imp" ? "exp" : "imp";
    return [...rows.values()].map((r) => ({
      ...r,
      share: own[r.c][dir] ? (100 * r.v) / own[r.c][dir] : 0,
      partnerShare: theirs[r.c][other] ? (100 * r.v) / theirs[r.c][other] : 0,
    })).sort((a, b) => toEJ(b.v, b.c) - toEJ(a.v, a.c) || b.share - a.share);
  };
  return { imp: side("imp"), exp: side("exp") };
}

/** Totals of trade per commodity for a country: { crude: {imp, exp}, ... }. */
export function tradeTotals(db, iso) {
  const out = Object.fromEntries(COMMODITIES.map((c) => [c, { imp: 0, exp: 0 }]));
  const e = db.byCountry.get(iso);
  if (!e) return out;
  for (const f of e.imp) out[f.c].imp += f.v;
  for (const f of e.exp) out[f.c].exp += f.v;
  return out;
}

/** Top N countries for a metric (latest values). */
export function ranking(db, metric, n = 10, { desc = true, filter = null } = {}) {
  const vals = Object.entries(db.latest[metric] || {})
    .filter(([iso, row]) => row[0] != null && db.byIso.has(iso) && (!filter || filter(iso, row)))
    .map(([iso, row]) => ({ iso, v: row[0], year: row[1], src: row[2] }));
  vals.sort((a, b) => (desc ? b.v - a.v : a.v - b.v));
  return vals.slice(0, n);
}

/** Flows transiting a chokepoint, merged by pair: [{f,t,c,v}] sorted by energy content. */
export function chokepointFlows(db, cpId) {
  const list = db.flows.filter((f) => f.cp?.includes(cpId));
  return list;
}

/** Share of a chokepoint's routed oil passing to each importer (kb/d). */
export function exposureByImporter(db, cpId) {
  const agg = new Map();
  for (const f of chokepointFlows(db, cpId)) {
    if (f.c !== "crude" && f.c !== "products") continue;
    agg.set(f.t, (agg.get(f.t) || 0) + f.v);
  }
  return [...agg.entries()].map(([iso, v]) => ({ iso, v })).sort((a, b) => b.v - a.v);
}

/** Simple fuzzy search over countries, chokepoints and metrics. */
export function search(db, query, metrics) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (text) => {
    const t = text.toLowerCase();
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    if (t.split(/[\s(),-]+/).some((w) => w.startsWith(q))) return 60;
    if (t.includes(q)) return 40;
    return 0;
  };
  const results = [];
  for (const c of db.countries) {
    const s = Math.max(score(c.name), score(c.iso) - 5, ...c.aliases.map((a) => score(a) - 2));
    if (s > 0) results.push({ kind: "country", id: c.iso, label: c.name, icon: c.flag, s });
  }
  for (const cp of db.chokepoints) {
    const s = score(cp.name);
    if (s > 0) results.push({ kind: "chokepoint", id: cp.id, label: cp.name, s: s + 5, status: cp.status });
  }
  for (const [key, m] of Object.entries(metrics)) {
    const s = score(m.label);
    if (s > 0) results.push({ kind: "metric", id: key, label: m.label, s: s - 10 });
  }
  return results.sort((a, b) => b.s - a.s).slice(0, 12);
}
