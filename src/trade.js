// Product-level customs data stays separate from the map's converted energy volumes.
export function savedPair(data, a, b) {
  const pair = (data.records || []).filter((r) => (r.exporter === a && r.importer === b) || (r.exporter === b && r.importer === a));
  return { a, b, frequency: "A", products: data.products, saved: true, snapshots: [a, b].map((reporter) => {
    const latest = new Map();
    for (const r of pair.filter((r) => r.reporter === reporter && r.frequency === "A")) {
      const key = `${r.flow}|${r.hs}`;
      const prev = latest.get(key);
      if (!prev || r.period > prev.period || (r.period === prev.period && (r.retrieved_at || "") > (prev.retrieved_at || ""))) latest.set(key, r);
    }
    const records = [...latest.values()];
    return { reporter, partner: reporter === a ? b : a, frequency: "A", status: "snapshot", records,
      period: [...new Set(records.map((r) => r.period))].sort().join(" / "),
      checked_at: null, message: "Saved declarations; latest publication has not been checked." };
  }) };
}

export function productRows(data, from, to, category = "all") {
  const rows = new Map();
  for (const snapshot of data?.snapshots || []) {
    for (const r of snapshot.records || []) {
      if (r.exporter !== from || r.importer !== to || (category !== "all" && r.category !== category)) continue;
      // Do not put an aggregate beside its own subdivisions for the same declaration.
      if (r.hs.length === 4 && snapshot.records.some((x) => x.flow === r.flow && x.period === r.period && x.hs.length === 6 && x.hs.startsWith(r.hs))) continue;
      const row = rows.get(r.hs) || { hs: r.hs, product: r.product, category: r.category, imports: [], exports: [] };
      row[r.flow === "M" ? "imports" : "exports"].push(r);
      rows.set(r.hs, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.hs.localeCompare(b.hs));
}

export function tradeCsv(data, category = "all") {
  const header = ["exporter", "importer", "reporter", "declaration", "HS", "product", "classification", "period", "frequency", "tonnes", "weight_estimated", "trade_value_USD", "CIF_USD", "FOB_USD", "source_released", "retrieved_at", "source_url", "weight_basis", "quantity", "quantity_unit_code", "quantity_estimated", "reported", "aggregate", "original_classification"];
  const records = (data?.snapshots || []).flatMap((s) => s.records || []).filter((r) => category === "all" || r.category === category);
  const rows = records.map((r) => [r.exporter, r.importer, r.reporter, r.flow === "M" ? "import" : "export", r.hs, r.product, r.classification, r.period, r.frequency, r.tonnes,
    r.weight_estimated, r.usd, r.cif_usd, r.fob_usd, r.released, r.retrieved_at, r.source_url,
    r.weight_basis, r.quantity, r.quantity_unit_code, r.quantity_estimated, r.reported, r.aggregate, r.original_classification]);
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\n");
}

export function periodLabel(period) {
  if (/^\d{6}$/.test(String(period))) return new Date(`${String(period).slice(0, 4)}-${String(period).slice(4)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return period || "No published period";
}

let savedPromise;
export async function loadSavedTrade(a, b, frequency) {
  const pairKey = [a, b].sort().join("-");
  let detailed = null;
  try {
    const res = await fetch(`public/data/bilateral/${pairKey}-${frequency}.json`);
    if (res.ok) detailed = { ...await res.json(), saved: true };
  } catch { /* fall back to the full saved declarations */ }
  if (frequency === "M") return detailed;
  if (detailed && !detailed.snapshots.some((s) => ["error", "stale"].includes(s.status) && !s.records?.length)) return detailed;
  if (!savedPromise) savedPromise = fetch("public/data/trade_details.json").then((r) => {
    if (!r.ok) throw new Error("Saved trade data unavailable");
    return r.json();
  }).catch((error) => { savedPromise = null; throw error; });
  let fallback;
  try { fallback = savedPair(await savedPromise, a, b); }
  catch (error) { if (detailed) return detailed; throw error; }
  if (!detailed) return fallback;
  detailed.snapshots = detailed.snapshots.map((s) => ["error", "stale"].includes(s.status) && !s.records?.length
    ? { ...fallback.snapshots.find((x) => x.reporter === s.reporter), status: "stale", warning: s.warning }
    : s);
  return detailed;
}

// Live lookups need the local server (scripts/serve.py). A static host such as GitHub Pages has no /api/trade:
// after the first miss the explorer shows saved records only and stops asking.
let liveServer = true;
export const liveTradeAvailable = () => liveServer;

export async function loadLatestTrade(a, b, frequency, { refresh = false, signal } = {}) {
  if (!liveServer) throw Object.assign(new Error("Live trade lookup needs the local server."), { code: "no-server" });
  const res = await fetch(`/api/trade?${new URLSearchParams({ a, b, frequency, refresh: refresh ? "1" : "0" })}`, { signal });
  const json = res.headers.get("content-type")?.includes("application/json");
  if (!json && (res.status === 404 || res.status === 405 || res.ok)) {
    liveServer = false;
    throw Object.assign(new Error("Live trade lookup needs the local server."), { code: "no-server" });
  }
  if (!res.ok && !json) throw new Error("Live trade lookup is unavailable on this server.");
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.snapshots)) throw new Error("Invalid trade response");
  return data;
}
