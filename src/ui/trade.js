import { COMMODITY_META, countryName } from "../data.js";
import { escapeHtml } from "../format.js";
import { loadLatestTrade, loadSavedTrade, periodLabel, productRows, tradeCsv } from "../trade.js";
import { el, icon, section } from "./dom.js";

const money = (v) => v == null ? "Not reported" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
const tonnes = (v) => v == null ? "Weight not reported" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(v)} t`;
const dateText = (v) => v ? new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
const categoryLabel = (key) => key === "pipeline_gas" ? "Gaseous natural gas" : COMMODITY_META[key]?.label || key;

export function openTradeExplorer(app, state) {
  const { db } = app;
  const { a, b, frequency } = state;
  let data = null, closed = false, generation = 0, category = state.category || "all", reportedOnly = state.reportedOnly || false;
  let controller = null;
  const previousFocus = document.activeElement;
  const overlay = el("div", { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": "Trade between two countries" });
  const status = el("p", { class: "trade-status", role: "status", "aria-live": "polite" }, "Loading saved reports and checking the latest publication…");
  const results = el("div", { class: "trade-results" });
  const refresh = el("button", { class: "btn small", onclick: () => load(true) }, "Check for updates");
  const download = el("button", { class: "btn small", disabled: true, onclick: () => {
    const url = URL.createObjectURL(new Blob([tradeCsv(data, category)], { type: "text/csv;charset=utf-8" }));
    const link = el("a", { href: url, download: `trade-${a}-${b}-${frequency}.csv` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } }, "Download product records");
  const update = (patch) => app.store.set({ trade: { ...state, category, reportedOnly, ...patch } });
  const countrySelect = (label, value, other, key) => {
    const select = el("select", { class: "select", "aria-label": label });
    for (const c of [...db.countries].sort((x, y) => x.name.localeCompare(y.name))) {
      select.append(el("option", { value: c.iso, selected: value === c.iso, disabled: c.iso === other }, `${c.flag || ""} ${c.name}`));
    }
    select.addEventListener("change", () => update({ [key]: select.value }));
    return el("label", {}, el("span", { class: "label" }, label), select);
  };
  const frequencySelect = el("select", { class: "select", "aria-label": "Reporting period" },
    el("option", { value: "A", selected: frequency === "A" }, "Latest annual reports"),
    el("option", { value: "M", selected: frequency === "M" }, "Latest monthly reports"));
  frequencySelect.addEventListener("change", () => update({ frequency: frequencySelect.value }));
  const categorySelect = el("select", { class: "select", "aria-label": "Product category" }, el("option", { value: "all", selected: category === "all" }, "All energy & rare earths"),
    ...Object.keys(COMMODITY_META).filter((k) => k !== "all").map((k) => el("option", { value: k, selected: category === k }, categoryLabel(k))));
  categorySelect.addEventListener("change", () => { category = categorySelect.value; render(); });
  const strict = el("input", { type: "checkbox", checked: reportedOnly });
  strict.addEventListener("change", () => { reportedOnly = strict.checked; render(); });
  const close = () => app.store.set({ trade: null });
  const modal = el("div", { class: "modal glass trade-modal" },
    el("div", { class: "modal-head" }, el("h2", {}, "Trade between two countries"),
      el("button", { class: "icon-btn", "aria-label": "Close trade explorer", html: icon("x"), onclick: close })),
    el("div", { class: "modal-body" },
      el("p", { class: "trade-intro" }, "Exactly which energy and rare earth product groups are traded, with each country's customs declaration shown separately."),
      el("div", { class: "trade-selectors" }, countrySelect("Country A", a, b, "a"),
        el("button", { class: "btn trade-swap", "aria-label": "Swap countries", onclick: () => update({ a: b, b: a }) }, "⇄"),
        countrySelect("Country B", b, a, "b"), el("label", {}, el("span", { class: "label" }, "Reporting period"), frequencySelect)),
      el("div", { class: "trade-toolbar" }, categorySelect, el("label", { class: "toggle" }, strict, "Hide estimated weights"), refresh, download),
      status, results,
      el("details", { class: "trade-methods" }, el("summary", {}, "How to read these figures"),
        el("p", {}, "Imports declared by the buyer and exports declared by the seller describe the same direction of trade. They are never added or averaged. Dates can differ; compare values only for matching periods. Annual and monthly reports are separate datasets, and one month is not a full-year total."),
        el("p", {}, "Weights are tonnes of traded product, with UN Comtrade estimates labelled. Missing weights are left blank, never inferred from price. Values are current US dollars; imports usually include freight and insurance (CIF), while exports usually use the exporting border value (FOB). These valuation and reporting differences can produce discrepancies."),
        el("p", {}, "The scope matches the map: crude oil, petroleum products, coal, LNG, gaseous natural gas, and rare earth metals and compounds. It excludes LPG, electricity, ores and finished magnets. Six-digit HS categories do not identify individual mines, shipments, companies or every rare earth element. “Other rare earth compounds” cannot be reliably split into neodymium, dysprosium, etc. from these records."),
        el("p", {}, "The map uses annual converted volumes and modelled routes; this view uses original customs records, including smaller and value-only trades. Countries that do not report, suppressed values and unreported products remain gaps. No row means no available declaration, not proven zero trade."),
        el("a", { href: "https://comtradeplus.un.org/DataAvailability", target: "_blank", rel: "noopener" }, "UN Comtrade publication availability"), " · ",
        el("a", { href: "https://uncomtrade.org/docs/quantity-and-weight-data-in-un-comtrade/", target: "_blank", rel: "noopener" }, "Weight methodology"))));
  overlay.append(modal);
  const onKey = (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      const focusable = [...modal.querySelectorAll("button:not([disabled]), select, input, a, summary")].filter((e) => e.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener("keydown", onKey, true);
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) close(); });
  document.body.append(overlay);
  modal.querySelector("select").focus();

  function declaration(records) {
    if (!records.length) return el("div", { class: "trade-missing" }, "No declaration available");
    return el("div", {}, ...records.map((r) => {
      const quality = r.tonnes == null ? "Weight missing" : r.weight_estimated ? "Source-estimated weight" : "Recorded weight";
      return el("div", { class: "trade-declaration" },
        el("div", { class: "trade-weight" }, reportedOnly && r.weight_estimated ? "Estimated weight hidden" : tonnes(r.tonnes)),
        el("div", { class: "trade-value" }, money(r.usd)),
        el("div", { class: "trade-period" }, periodLabel(r.period)),
        el("span", { class: `badge ${r.weight_estimated ? "restricted" : ""}` }, quality),
        el("details", {}, el("summary", {}, "Source & precision"),
          el("p", {}, `${countryName(db, r.reporter)} · ${r.flow === "M" ? "import" : "export"} declaration · ${r.classification || "HS"}. ${r.aggregate ? "Aggregated by UN Comtrade. " : ""}${r.original_classification === false ? "Converted HS classification. " : ""}`),
          el("p", {}, `Product weight: ${tonnes(r.tonnes)}. Basis: ${r.weight_basis || "net weight"}.`),
          el("p", {}, `CIF: ${money(r.cif_usd)} · FOB: ${money(r.fob_usd)}`),
          el("p", {}, `Source released: ${dateText(r.released)}. Retrieved: ${dateText(r.retrieved_at)}.`),
          el("a", { href: r.source_url || "https://comtradeplus.un.org/", target: "_blank", rel: "noopener" }, "Open source record")));
    }));
  }

  function render() {
    if (!data || closed) return;
    results.replaceChildren();
    download.disabled = !(data.snapshots || []).some((s) => s.records?.length);
    results.append(el("div", { class: "trade-publications" }, ...data.snapshots.map((s) =>
      el("div", { class: "callout" }, el("b", {}, `${countryName(db, s.reporter)} reports`),
        el("p", {}, `${periodLabel(s.period)}${s.released ? ` · released ${dateText(s.released)}` : ""}`),
        el("p", { class: "note" }, s.warning || s.message || `${data.saved ? "Saved copy · " : ""}Last checked ${dateText(s.checked_at)}${s.cached ? " · cached up to 6 hours" : ""}`)))));
    const periods = [...new Set(data.snapshots.map((s) => s.period).filter(Boolean))];
    if (periods.length > 1) results.append(el("p", { class: "callout warn" }, "Different reporting periods: these columns are not a like-for-like comparison. Use each declaration's date; do not subtract them to calculate a discrepancy or balance."));
    for (const [from, to] of [[a, b], [b, a]]) {
      const rows = productRows(data, from, to, category);
      const title = `${countryName(db, from)} → ${countryName(db, to)}`;
      const table = el("table", { class: "trade-table" }, el("caption", { class: "sr-only" }, title),
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Product / HS code"),
          el("th", { scope: "col" }, `${countryName(db, from)} reports exports`), el("th", { scope: "col" }, `${countryName(db, to)} reports imports`))),
        el("tbody", {}, ...rows.map((r) => el("tr", {},
          el("th", { scope: "row" }, el("span", { class: "trade-product" }, r.product), el("span", { class: "trade-hs" }, `HS ${r.hs}`),
            el("span", { class: "trade-category" }, categoryLabel(r.category))),
          el("td", {}, declaration(r.exports)), el("td", {}, declaration(r.imports))))));
      results.append(section(escapeHtml(title), `${rows.length} product groups`, rows.length ? el("div", { class: "trade-table-scroll" }, table)
        : el("p", { class: "note" }, "No declarations available for this direction and filter. This does not establish zero trade.")));
    }
  }

  async function load(force = false) {
    const version = ++generation;
    controller?.abort(); controller = new AbortController();
    refresh.disabled = true;
    status.textContent = "Checking the latest published reports for both countries…";
    if (!data) {
      try { data = await loadSavedTrade(a, b, frequency); if (version !== generation || closed) return; render(); }
      catch { /* live query can still succeed */ }
    }
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const live = await loadLatestTrade(a, b, frequency, { refresh: force, signal: controller.signal });
      if (version !== generation || closed) return;
      // Keep saved declarations only for reporter-level request failures, with explicit status.
      live.snapshots = live.snapshots.map((s) => {
        if (s.status !== "error") return s;
        const saved = data?.snapshots?.find((x) => x.reporter === s.reporter && x.records?.length);
        return saved ? { ...saved, status: "stale", warning: s.warning } : s;
      });
      data = live;
      const failed = live.snapshots.some((s) => ["error", "stale"].includes(s.status));
      status.textContent = failed ? "Some reports could not be refreshed. Saved dates and gaps are shown below."
        : "Publication check complete. Each country's latest available report is shown; periods may differ.";
      render();
    } catch (error) {
      if (version !== generation || closed) return;
      status.textContent = data ? "Live check unavailable. Showing saved declarations; their reporting dates are listed below."
        : "No saved report and the live check is unavailable. Run the local app with npm start, then retry.";
      if (!data) results.replaceChildren(el("p", { class: "note" }, "No figures have been inferred or substituted."));
    } finally {
      clearTimeout(timeout);
      if (!closed && version === generation) refresh.disabled = false;
    }
  }
  load();
  return () => { closed = true; generation++; controller?.abort(); overlay.remove(); document.removeEventListener("keydown", onKey, true); previousFocus?.focus?.(); };
}
