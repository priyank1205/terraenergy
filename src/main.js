// TerraEnergy — application bootstrap and controller.
/* global d3 */

import { metricScale, palette, refreshPalette } from "./colors.js";
import { COMMODITY_META, countryName, flowValue, flowYears, loadCore, matchesCommodity, loadHistory, loadWorld50, refreshPortwatch, topFlows, valueAt } from "./data.js";
import { fmt } from "./format.js";
import { MapView } from "./map.js";
import { createStore, parseHash } from "./store.js";
import { openAbout, openPalette, renderBanner, renderLegend, renderRail, toast, tooltipHtml } from "./ui/controls.js";
import { icon } from "./ui/dom.js";
import { Panel } from "./ui/panel.js";
import { openTradeExplorer } from "./ui/trade.js";

const $ = (s) => document.querySelector(s);

class App {
  constructor(db) {
    this.db = db;
    this.store = createStore(parseHash(location.hash));
    this.playing = false;
    this.highlightIds = null;
    this.historyPromise = null;
  }

  get state() {
    return this.store.get();
  }

  isMobile() {
    return window.innerWidth <= 860;
  }

  start() {
    refreshPalette();
    this.sheetExpanded = false;
    this.map = new MapView($("#map"), {
      onHover: (t, ev) => this.onHover(t, ev),
      onClick: (t) => this.onMapClick(t),
      onResize: () => this.panel && this.syncPanelVisibility(),
    });
    this.map.setWorld(this.db.world110, "110m");
    this.map.setNodes(this.db.nodes);
    this.map.setLabelPoints(this.db.countries);
    this.map.setInfrastructure({ pipelines: this.db.context.pipelines, terminals: this.db.context.lng_terminals });
    if (this.state.projection === "globe") this.map.setMode("globe");
    this.panel = new Panel({ root: $("#panel"), head: $("#panel-head"), body: $("#panel-body"), app: this });

    this.bindChrome();
    renderBanner($("#banner"), this);
    this.syncPanelVisibility();
    this.store.subscribe((s, changed) => this.onChange(s, changed));
    this.onChange(this.state, new Set(Object.keys(this.state)));
    if (this.state.partner) this.focusPartner();
    else if (this.state.selected) this.focusSelection(this.state.selected, false);

    // Progressive enhancement: detailed coastlines and history arrive after first paint.
    loadWorld50().then((topo) => this.map.setWorld(topo, "50m")).catch(() => {});
    // Live chokepoint traffic: merge days PortWatch has published since this build.
    refreshPortwatch(this.db).then((added) => {
      if (!added) return;
      renderBanner($("#banner"), this);
      if (this.state.lens === "chokepoints") renderRail($("#rail"), this);
      if (this.state.selected?.type === "chokepoint" || !this.state.selected) this.panel.render();
    });
    if (this.state.lens === "balances" && this.state.year !== 2025) this.ensureHistory().then(() => this.updateMap());
    window.addEventListener("hashchange", () => {
      const next = parseHash(location.hash);
      if (Object.keys(next).length) this.store.set({ ...next, partner: next.partner || null, trade: next.trade || null });
    });
  }

  // -------------------------------------------------------------- state → views
  onChange(s, changed) {
    const has = (...k) => k.some((x) => changed.has(x));
    if (has("trade")) {
      this.closeTrade?.(); this.closeTrade = null;
      if (s.trade && this.db.byIso.has(s.trade.a) && this.db.byIso.has(s.trade.b)) this.closeTrade = openTradeExplorer(this, s.trade);
    }
    if (has("lens")) {
      document.querySelectorAll(".lens-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.lens === s.lens)));
      if (this.playing && s.lens !== "balances") this.togglePlay(false);
    }
    if (has("projection")) {
      this.map.setMode(s.projection);
      $("#btn-projection").innerHTML = icon(s.projection === "globe" ? "map" : "globe");
      $("#btn-projection").setAttribute("aria-label", s.projection === "globe" ? "Switch to flat map" : "Switch to globe");
    }
    if (has("layers")) this.map.setLayers(s.layers);
    if (has("lens", "commodity", "topN", "metric", "year", "selected", "partner", "scenario", "layers")) this.updateMap();
    // Sliders update themselves; re-rendering the rail mid-drag would replace the element being dragged.
    if (has("lens", "commodity", "metric", "selected", "scenario", "layers")) renderRail($("#rail"), this);
    else if (has("year")) this.syncYearControl();
    if (has("lens", "commodity", "metric", "year", "scenario", "topN", "selected", "partner")) renderLegend($("#legend"), this, this.scaleInfo);
    if (has("selected", "compare", "partner") || (has("commodity") && s.selected?.type === "country") || (has("lens", "commodity", "metric") && !s.selected)) this.panel.render();
    if (has("selected", "panelOpen")) this.syncPanelVisibility();
  }

  syncPanelVisibility() {
    const mobile = this.isMobile();
    const panel = $("#panel");
    let bottom = 0;
    let open;
    if (mobile) {
      // Bottom sheet: expanded for a selection (or on request), otherwise a peek of the overview.
      const expanded = !!this.state.selected || this.sheetExpanded;
      open = true;
      panel.classList.remove("collapsed");
      panel.classList.toggle("peek", !expanded);
      bottom = expanded ? window.innerHeight * 0.62 : 132;
    } else {
      open = this.state.panelOpen || !!this.state.selected;
      panel.classList.remove("peek");
      panel.classList.toggle("collapsed", !open);
    }
    document.body.classList.toggle("panel-closed", !open);
    $("#btn-panel").classList.toggle("hidden", open || mobile);
    $("#btn-layers").classList.toggle("hidden", !mobile);
    if (!mobile) $("#rail").classList.remove("open");
    const panelW = open && !mobile ? panel.getBoundingClientRect().width + 24 : 0;
    const top = mobile ? 64 : 76 + ($("#banner").classList.contains("hidden") ? 0 : 30);
    const insets = { left: 0, right: panelW, top, bottom };
    const key = JSON.stringify(insets);
    if (key !== this._insetsKey) {
      this._insetsKey = key;
      this.map.setInsets(insets);
    }
  }

  updateMap() {
    const { db, state: s } = this;
    const P = palette();
    const sel = s.selected;
    const selCountry = sel?.type === "country" ? sel.id : null;
    const partner = selCountry ? s.partner : null;
    const closed = new Set(db.chokepoints.filter((c) => c.status === "closed").map((c) => c.id));
    const disrupted = (f) => s.scenario === "hormuz" && f.cp?.some((c) => closed.has(c));
    this.scaleInfo = null;

    // ---- country fills
    const fills = new Map();
    if (s.lens === "balances") {
      const meta = { ...db.meta.metrics[s.metric], key: s.metric };
      const vals = new Map();
      for (const c of db.countries) {
        const d = valueAt(db, s.metric, c.iso, s.year);
        if (d) vals.set(c.iso, d.v);
      }
      const scale = metricScale(meta, [...vals.values()]);
      this.scaleInfo = scale;
      for (const f of (this.map.hi || this.map.lo).features) {
        const v = vals.get(f.id);
        fills.set(f.id, v == null ? P.landMuted : scale.color(v));
      }
    }
    this.map.setFills(fills);

    // ---- flows
    let flows = [];
    const highlight = new Set();
    if (s.lens === "flows") {
      flows = topFlows(db, s.commodity, selCountry ? 400 : s.topN, { country: selCountry });
      if (selCountry) flows = flows.filter((f) => f.f === selCountry || f.t === selCountry);
      if (partner) flows = flows.filter((f) => f.f === partner || f.t === partner);
      if (sel?.type === "flow") {
        const f0 = db.flowById.get(sel.id);
        if (f0) {
          const pair = db.flows.filter((f) => f.f === f0.f && f.t === f0.t && f.c === f0.c);
          const ids = new Set(flows.map((f) => f.id));
          pair.forEach((f) => { if (!ids.has(f.id)) flows.push(f); });
          highlight.add(f0.f).add(f0.t);
        }
      }
    } else if (s.lens === "chokepoints") {
      const cpId = sel?.type === "chokepoint" ? sel.id : "hormuz";
      flows = db.flows.filter((f) => f.cp?.includes(cpId) && matchesCommodity(f, "all")).sort((a, b) => flowValue(b, "all") - flowValue(a, "all")).slice(0, 160);
      for (const f of flows) highlight.add(f.t);
    }
    if (selCountry) {
      highlight.add(selCountry);
      if (partner) highlight.add(partner);
      for (const f of flows) {
        highlight.add(f.f);
        highlight.add(f.t);
      }
    }
    const commodity = s.lens === "flows" ? s.commodity : "all";
    const selFlow = sel?.type === "flow" ? db.flowById.get(sel.id) : null;
    this.map.setFlows(flows, {
      valueOf: (f) => flowValue(f, commodity),
      maxWidth: s.lens === "chokepoints" ? 8 : 10,
      styleOf: (f) => {
        const st = { disrupted: disrupted(f) };
        if (this.highlightIds) {
          if (this.highlightIds.has(f.id)) st.emphasis = true;
          else st.dim = true;
        } else if (selFlow) {
          if (f.f === selFlow.f && f.t === selFlow.t && f.c === selFlow.c) st.emphasis = true;
          else st.dim = true;
        }
        return st;
      },
    });
    this.map.setHighlight({ selectedIso: selCountry, highlight: [...highlight], dimOthers: !!selCountry && s.lens === "flows" });
    const showCp = s.lens !== "balances";
    this.map.setChokepoints(db.chokepoints, {
      visible: showCp, selected: sel?.type === "chokepoint" ? sel.id : s.lens === "chokepoints" ? "hormuz" : null,
      labels: s.lens === "chokepoints",
    });
  }

  syncYearControl() {
    const range = document.querySelector('#rail input[aria-label="Year"]');
    if (range && Number(range.value) !== this.state.year) range.value = this.state.year;
    const out = range?.parentElement.querySelector("output");
    if (out) out.textContent = String(this.state.year);
  }

  flowWidthSamples() {
    const m = this.map;
    if (!m?.vmax || !m.flows.length) return [];
    const c = this.state.lens === "flows" ? this.state.commodity : "all";
    const unit = COMMODITY_META[c].unit;
    const nice = (v) => {
      const p = 10 ** Math.floor(Math.log10(v));
      return [1, 2, 5, 10].map((k) => k * p).reverse().find((x) => x <= v) || p;
    };
    const top = nice(m.vmax);
    return [top / 10, top / 2, top].map((v) => ({
      px: Math.max(1, (0.7 + (m.maxWidth - 0.7) * Math.sqrt(v / m.vmax))),
      label: unit === "EJ" ? `${v} EJ` : fmt(v, unit).replace(" bcm", "").replace(" Mt", ""),
    }));
  }

  // -------------------------------------------------------------- actions
  select(target, extra = {}) {
    const patch = { selected: target, ...extra };
    if (!target) patch.compare = null;
    if (target?.type === "flow" && this.state.lens !== "flows") patch.lens = "flows";
    if (target?.type === "flow") {
      const f = this.db.flowById.get(target.id);
      if (f && this.state.commodity !== "all" && this.state.commodity !== f.c) patch.commodity = f.c;
    }
    if (target?.type === "country" && this.state.selected?.type === "country" && this.state.selected.id !== target.id) patch.compare = null;
    this.highlightIds = null;
    this.store.set(patch);
    if (target) this.focusSelection(target);
    if (this.isMobile()) this.syncPanelVisibility();
  }

  focusSelection(target, animate = true) {
    const { db } = this;
    if (target.type === "country") {
      const c = db.byIso.get(target.id);
      if (!c?.lp) return;
      if (this.state.lens === "flows") {
        const pts = [c.lp];
        for (const f of topFlows(db, this.state.commodity, 30, { country: target.id })) {
          const other = db.byIso.get(f.f === target.id ? f.t : f.f);
          if (other?.lp) pts.push(other.lp);
        }
        if (pts.length > 1 && this.map.mode === "flat") this.map.fitPoints(pts);
        else this.map.flyTo(c.lp);
      } else this.map.flyTo(c.lp);
    } else if (target.type === "chokepoint") {
      const cp = db.cpById.get(target.id);
      if (cp) this.map.flyTo(cp.coords, this.map.mode === "flat" ? 2.2 : null);
    } else if (target.type === "flow") {
      const f = db.flowById.get(target.id);
      if (f) {
        const coords = this.map.flowCoords(f);
        if (coords.length) this.map.fitPoints([coords[0], coords[Math.floor(coords.length / 2)], coords[coords.length - 1]]);
      }
    }
    if (!animate) return;
  }

  /** Show what the selected country trades with one of its partners, without leaving it. */
  openPartner(iso) {
    const sel = this.state.selected;
    if (sel?.type !== "country" || iso === sel.id || !this.db.byIso.has(iso)) return;
    this.highlightIds = null;
    this.store.set({ partner: iso, compare: null });
    this.focusPartner();
  }

  closePartner() {
    this.store.set({ partner: null });
    if (this.state.selected) this.focusSelection(this.state.selected);
  }

  focusPartner() {
    const { db, state } = this;
    const a = db.byIso.get(state.selected?.id);
    const b = db.byIso.get(state.partner);
    if (!a?.lp || !b?.lp) return;
    if (this.map.mode === "globe") {
      this.map.flyTo(d3.geoInterpolate(a.lp, b.lp)(0.5));
      return;
    }
    const pts = [a.lp, b.lp];
    for (const f of this.map.flows) {
      const coords = this.map.flowCoords(f);
      if (coords.length) pts.push(coords[0], coords[Math.floor(coords.length / 2)], coords[coords.length - 1]);
    }
    this.map.fitPoints(pts);
  }

  highlightFlows(ids) {
    this.highlightIds = ids ? new Set(ids) : null;
    this.updateMap();
  }

  setYear(y) {
    this.ensureHistory().then(() => this.store.set({ year: y }));
  }

  togglePlay(force) {
    const next = force ?? !this.playing;
    this.playing = next;
    clearInterval(this.playTimer);
    if (next) {
      this.ensureHistory().then(() => {
        let y = this.state.year >= 2025 ? 2000 : this.state.year;
        this.store.set({ year: y });
        this.playTimer = setInterval(() => {
          y += 1;
          if (y > 2025) {
            this.togglePlay(false);
            return;
          }
          this.store.set({ year: y });
        }, 650);
      });
    }
    renderRail($("#rail"), this);
  }

  ensureHistory() {
    if (this.db.history) return Promise.resolve(this.db.history);
    if (!this.historyPromise) {
      this.historyPromise = loadHistory().then((h) => {
        this.db.history = h;
        return h;
      }).catch((e) => {
        console.warn("history unavailable", e);
        return null;
      });
    }
    return this.historyPromise;
  }

  toggleProjection() {
    this.store.set({ projection: this.state.projection === "globe" ? "flat" : "globe" });
  }

  toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("te-theme", next); } catch (e) { /* ignore */ }
    refreshPalette();
    this.map.setTheme();
    this.updateMap();
    renderRail($("#rail"), this);
    renderLegend($("#legend"), this, this.scaleInfo);
    this.panel.render();
    $("#btn-theme").innerHTML = icon(next === "light" ? "moon" : "sun");
  }

  openPalette(opts) {
    openPalette(this, opts);
  }

  openAbout() {
    openAbout(this);
  }

  openTrade(a = null, b = null) {
    const selected = this.state.selected;
    const flow = selected?.type === "flow" ? this.db.flowById.get(selected.id) : null;
    a ||= flow?.f || (selected?.type === "country" ? selected.id : "CHN");
    b ||= flow?.t || this.state.compare || (a === "USA" ? "CHN" : "USA");
    if (a === b) b = a === "USA" ? "CHN" : "USA";
    this.store.set({ trade: { a, b, frequency: "A" } });
  }

  suggestedCompare() {
    const sel = this.state.selected?.id;
    return ["USA", "CHN", "IND", "JPN", "DEU", "SAU", "RUS", "KOR", "GBR", "BRA"].filter((i) => i !== sel)
      .map((iso) => ({ kind: "country", id: iso, label: countryName(this.db, iso), icon: this.db.byIso.get(iso)?.flag }));
  }

  downloadPng() {
    const a = document.createElement("a");
    a.href = this.map.snapshot();
    a.download = `terraenergy-${this.state.lens}-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }

  downloadCsv() {
    const rows = [["exporter", "importer", "commodity", "value", "unit", "year", "mode", "chokepoints", "source"]];
    const seen = new Set();
    for (const f of this.map.flows) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      rows.push([countryName(this.db, f.f), countryName(this.db, f.t), f.c, f.v, this.db.units[f.c], flowYears([f]), f.mode, (f.cp || []).join(" "), f.s]);
    }
    const csv = rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `terraenergy-flows-${this.state.commodity}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // -------------------------------------------------------------- events
  onHover(target, ev) {
    const tip = $("#tooltip");
    const html = target ? tooltipHtml(this, target) : null;
    if (!html || this.isMobile()) {
      tip.classList.remove("show");
      return;
    }
    tip.innerHTML = html;
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.classList.add("show");
  }

  onMapClick(target) {
    $("#tooltip").classList.remove("show");
    if (!target) {
      if (this.state.selected) this.select(null);
      return;
    }
    const cur = this.state.selected;
    if (cur && cur.type === target.type && cur.id === target.id) {
      if (this.state.partner) this.closePartner(); // clicking the selected country again leaves its partner view
      return;
    }
    this.select(target);
  }

  bindChrome() {
    document.querySelectorAll(".lens-tab").forEach((b) => b.addEventListener("click", () => {
      const lens = b.dataset.lens;
      const patch = { lens };
      if (lens !== "chokepoints" && this.state.selected?.type === "chokepoint") patch.selected = null;
      this.store.set(patch);
    }));
    $("#search-trigger").addEventListener("click", () => this.openPalette());
    $("#btn-trade").addEventListener("click", () => this.openTrade());
    $("#btn-projection").addEventListener("click", () => this.toggleProjection());
    $("#btn-theme").addEventListener("click", () => this.toggleTheme());
    $("#btn-theme").innerHTML = icon(document.documentElement.dataset.theme === "light" ? "moon" : "sun");
    $("#btn-about").addEventListener("click", () => this.openAbout());
    $("#btn-about-2").addEventListener("click", () => this.openAbout());
    $("#btn-share").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast("Link copied");
      } catch (e) {
        toast("Copy the address bar to share this view");
      }
    });
    $("#btn-zoom-in").addEventListener("click", () => this.map.zoomBy(1.6));
    $("#btn-zoom-out").addEventListener("click", () => this.map.zoomBy(1 / 1.6));
    $("#btn-reset").addEventListener("click", () => this.map.reset());
    $("#btn-panel").addEventListener("click", () => this.store.set({ panelOpen: true }));
    $("#btn-layers").addEventListener("click", () => {
      const open = $("#rail").classList.toggle("open");
      $("#btn-layers").setAttribute("aria-pressed", String(open));
    });
    const toggleSheet = () => {
      if (!this.isMobile() || this.state.selected) return;
      this.sheetExpanded = !this.sheetExpanded;
      this.syncPanelVisibility();
    };
    document.querySelector(".sheet-handle").addEventListener("click", toggleSheet);
    $("#panel-head").addEventListener("click", (e) => {
      if (!e.target.closest("button")) toggleSheet();
    });
    window.addEventListener("resize", () => this.syncPanelVisibility());
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.querySelector(".overlay");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.openPalette();
        return;
      }
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); this.openPalette(); }
      else if (e.key === "Escape") this.select(null);
      else if (e.key === "1") this.store.set({ lens: "flows" });
      else if (e.key === "2") this.store.set({ lens: "balances" });
      else if (e.key === "3") this.store.set({ lens: "chokepoints" });
      else if (e.key.toLowerCase() === "g") this.toggleProjection();
      else if (e.key.toLowerCase() === "t") this.toggleTheme();
      else if (e.key === "+" || e.key === "=") this.map.zoomBy(1.6);
      else if (e.key === "-") this.map.zoomBy(1 / 1.6);
    });
    matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", (ev) => {
      try { if (localStorage.getItem("te-theme")) return; } catch (e) { /* ignore */ }
      document.documentElement.dataset.theme = ev.matches ? "light" : "dark";
      this.toggleTheme();
      this.toggleTheme();
    });
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  const loading = $("#loading");
  try {
    if (!window.d3 || !window.topojson) throw new Error("Map libraries failed to load (vendor/ folder missing?).");
    const db = await loadCore();
    const app = new App(db);
    window.terra = app; // handy for debugging in the console
    app.start();
    loading.classList.add("done");
    setTimeout(() => loading.remove(), 500);
  } catch (err) {
    console.error(err);
    const local = location.protocol === "file:";
    $("#loading-text").innerHTML = `<div class="error-box"><b>Couldn't load the data.</b><br>${local
      ? "Open the app through a local web server: run <code>npm start</code> and visit http://localhost:3000."
      : String(err.message || err)}</div>`;
    loading.querySelector(".loading-bar")?.remove();
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
