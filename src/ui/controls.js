// Left rail, legend, banner, tooltip, command palette and the about modal.
/* global d3 */

import { palette } from "../colors.js";
import { chokepointCoverage, COMMODITY_META, countryName, flag, flowYears, latestValue, matchesCommodity, search, tradeTotals, valueAt } from "../data.js";
import { COMMODITIES, ENERGY_COMMODITIES } from "../store.js";
import { dateLabel, escapeHtml, fmt, num, pct, signed } from "../format.js";
import { el, icon } from "./dom.js";
import { portwatchStats } from "./panel.js";

const GROUP_LABEL = { security: "Energy security", supply: "Supply", demand: "Demand", power: "Electricity", emissions: "Emissions" };

// ------------------------------------------------------------------------------------ rail
export function renderRail(root, app) {
  const { state, db } = app;
  root.replaceChildren(el("button", { class: "icon-btn rail-hide", "aria-label": "Hide map controls", title: "Hide controls — wider map",
    html: icon("collapse"), onclick: () => app.setRailOpen(false) }));
  const P = palette();
  if (state.lens === "flows") {
    const chips = el("div", { class: "chips" });
    for (const c of [...COMMODITIES, "all"]) {
      const meta = COMMODITY_META[c];
      const col = c === "all" ? P.text2 : P.commodity[c];
      chips.append(el("button", {
        class: "chip", "aria-pressed": String(state.commodity === c), style: `--chip-c:${col}`,
        onclick: () => app.store.set({ commodity: c }),
        html: `<span class="swatch" style="background:${col}"></span>${meta.short}`,
      }));
    }
    const out = el("output", {}, String(state.topN));
    const range = el("input", { type: "range", min: 10, max: 200, step: 5, value: state.topN, "aria-label": "Number of flows shown" });
    range.addEventListener("input", () => {
      out.textContent = range.value;
      app.store.set({ topN: Number(range.value) });
    });
    const toggle = (label, checked, onchange, title = "") => {
      const input = el("input", { type: "checkbox" });
      input.checked = checked;
      input.addEventListener("change", () => onchange(input.checked));
      return el("label", { class: "toggle", title }, input, label);
    };
    root.append(
      el("div", {}, el("div", { class: "label" }, "Commodity"), chips),
      el("button", { class: "btn", onclick: () => app.openTrade() }, "Explore trade between two countries"),
      el("div", {}, el("div", { class: "label" }, state.selected?.type === "country" ? "Largest flows (selected country)" : "Largest flows worldwide"),
        el("div", { class: "range-row" }, range, out)),
      el("div", {},
        el("div", { class: "label" }, "Layers"),
        toggle("Animate flow direction", state.layers.particles, (v) => app.store.set({ layers: { particles: v } })),
        toggle("Mark routes disrupted in 2026", state.scenario === "hormuz", (v) => app.store.set({ scenario: v ? "hormuz" : null }),
          "Dash flows that pass through a closed chokepoint"),
        toggle("Major pipelines", state.layers.pipelines, (v) => app.store.set({ layers: { pipelines: v } })),
        toggle("LNG export terminals", state.layers.terminals, (v) => app.store.set({ layers: { terminals: v } }))),
      el("p", { class: "note" }, state.commodity === "rare_earths"
        ? `${flowYears(db.flows.filter((f) => f.c === "rare_earths"))} customs trade in tonnes of metals and compounds. Routes are modelled from each country's ports and border crossings. Click a country to explore its trade.`
        : "2025 bilateral trade (2024 fallback). Line width scales with the square root of volume. Click a country to see only its trade."),
    );
  } else if (state.lens === "balances") {
    const select = el("select", { class: "select", "aria-label": "Map metric" });
    const groups = {};
    for (const [key, m] of Object.entries(db.meta.metrics)) (groups[m.group] ||= []).push([key, m]);
    for (const g of ["security", "supply", "demand", "power", "emissions"]) {
      if (!groups[g]) continue;
      const og = el("optgroup", { label: GROUP_LABEL[g] });
      for (const [key, m] of groups[g]) {
        const o = el("option", { value: key }, `${m.label} (${m.unit})`);
        if (key === state.metric) o.selected = true;
        og.append(o);
      }
      select.append(og);
    }
    select.addEventListener("change", () => app.store.set({ metric: select.value }));
    const meta = db.meta.metrics[state.metric];
    const derived = state.metric.startsWith("hormuz_");
    const year = el("output", {}, String(state.year));
    const range = el("input", { type: "range", min: 2000, max: 2025, step: 1, value: state.year, disabled: derived, "aria-label": "Year" });
    range.addEventListener("input", () => {
      year.textContent = range.value;
      app.setYear(Number(range.value));
    });
    const play = el("button", { class: "icon-btn", "aria-label": "Play 2000–2025", title: "Play 2000–2025", disabled: derived, html: icon(app.playing ? "pause" : "play") });
    play.addEventListener("click", () => app.togglePlay());
    const quick = el("div", { class: "chips" });
    for (const [k, label] of [["hormuz_oil_share", "Hormuz exposure"], ["oil_import_dep", "Oil import dependence"],
      ["net_gas_bcm", "Gas balance"], ["low_carbon_share_elec", "Low-carbon power"], ["co2_pc_t", "CO₂ per person"], ["oil_prod_kbd", "Oil production"]]) {
      quick.append(el("button", { class: "chip", "aria-pressed": String(state.metric === k), onclick: () => app.store.set({ metric: k }) }, label));
    }
    root.append(
      el("div", {}, el("div", { class: "label" }, "Colour countries by"), select),
      el("p", { class: "note", style: "margin:-6px 0 0" }, meta?.desc || ""),
      el("div", {}, el("div", { class: "label" }, derived ? "Year · 2025 trade only" : "Year"),
        el("div", { class: "range-row" }, play, range, year)),
      el("div", {}, el("div", { class: "label" }, "Quick views"), quick),
    );
  } else {
    const list = el("div", { class: "bars" });
    for (const cp of db.chokepoints) {
      const pw = db.portwatch[cp.portwatch];
      const st = pw ? portwatchStats(pw) : null;
      const ch = st?.avg2025 ? (100 * (st.last7 - st.avg2025)) / st.avg2025 : null;
      const row = el("button", { class: "bar-row", style: "grid-template-columns:14px minmax(0,1fr) auto" },
        el("span", { class: "swatch", style: `background:${P.status[cp.status]};border-radius:50%;width:9px;height:9px` }),
        el("span", { class: "name" }, cp.name),
        el("span", { class: "val", html: ch == null ? "" : `<b class="${ch < -15 ? "delta-down" : ""}">${signed(ch, (v) => num(v, 0))}%</b>` }));
      row.setAttribute("aria-pressed", String(state.selected?.type === "chokepoint" && state.selected.id === cp.id));
      if (state.selected?.type === "chokepoint" && state.selected.id === cp.id) row.style.background = "var(--panel-3)";
      row.addEventListener("click", () => app.select({ type: "chokepoint", id: cp.id }));
      list.append(row);
    }
    root.append(
      el("div", {}, el("div", { class: "label" }, "Tanker traffic, last 7 days vs 2025"), list),
      el("p", { class: "note", html: `Daily vessel counts from IMF PortWatch (satellite AIS), to ${dateLabel(db.portwatch.chokepoint6?.end)}${db.portwatchLive ? ` <span class="badge open" style="padding:0 6px"><span class="dot"></span>live</span>` : ""}. Select a chokepoint to see the flows that depend on it.` }),
    );
  }
}

// ------------------------------------------------------------------------------------ legend
export function renderLegend(root, app, scaleInfo) {
  const { state, db } = app;
  const P = palette();
  root.replaceChildren();
  if (state.lens === "balances" && scaleInfo) {
    const meta = db.meta.metrics[state.metric];
    const { legend } = scaleInfo;
    root.append(el("div", { class: "legend-title", html: `<span>${escapeHtml(meta.label)}</span><span class="dim">${escapeHtml(meta.unit)}</span>` }));
    const hz = state.metric.startsWith("hormuz_") ? chokepointCoverage(db.cpById.get("hormuz")) : null;
    const hzCov = hz?.[state.metric === "hormuz_lng_share" ? "lng" : "oil"];
    root.append(el("div", { class: "legend-sub" }, state.metric.startsWith("hormuz_")
      ? `2025, routed customs data${hzCov ? ` · covers ${pct(hzCov.pct)} of EIA's Hormuz ${state.metric === "hormuz_lng_share" ? "LNG" : "oil"}` : ""}`
      : `${state.year < 2025 ? state.year : "Latest year"} · EI / EIA / Ember`));
    if (legend.type === "ramp") {
      root.append(el("div", { class: "legend-ramp", style: `background:linear-gradient(90deg,${legend.stops.join(",")})` }));
      const ticks = legend.left
        ? [`◂ ${legend.left}`, `${legend.right} ▸`]
        : legend.ticks.map((t) => (meta.unit === "%" ? `${t}%` : num(t, 0)));
      root.append(el("div", { class: "legend-ticks", html: ticks.map((t) => `<span>${t}</span>`).join("") }));
    } else {
      root.append(el("div", { class: "legend-ramp", style: `display:flex;overflow:hidden`, html: legend.colors.map((c) => `<i style="flex:1;background:${c}"></i>`).join("") }));
      const labels = [0, ...legend.thresholds].map((t) => fmtShort(t, meta.unit));
      root.append(el("div", { class: "legend-ticks", html: labels.map((t) => `<span>${t}</span>`).join("") }));
    }
    root.append(el("div", { class: "legend-nodata", html: `<span class="swatch" style="background:${P.landMuted};border:1px solid ${P.border}"></span>No data` }));
    return;
  }
  if (state.lens === "chokepoints") {
    root.append(el("div", { class: "legend-title" }, "Chokepoint status"));
    root.append(el("div", { class: "legend-sub" }, `as of ${dateLabel(db.asOf)}`));
    root.append(el("div", { class: "legend-items", html: ["closed", "high_risk", "restricted", "open"].map((s) =>
      `<div><span class="swatch" style="background:${P.status[s]};border-radius:50%"></span>${{ closed: "Closed", high_risk: "High risk", restricted: "Reduced traffic", open: "Open" }[s]}</div>`).join("") }));
    return;
  }
  const c = state.commodity;
  const meta = COMMODITY_META[c];
  root.append(el("div", { class: "legend-title", html: `<span>${meta.label}</span><span class="dim">${c === "all" ? "EJ/yr" : meta.unit === "kb/d" ? "kb/d" : `${meta.unit}/yr`}</span>` }));
  root.append(el("div", { class: "legend-sub" }, `${flowYears(db.flows.filter((f) => matchesCommodity(f, c)))} · ${c === "rare_earths" ? "product weight · UN Comtrade" : "annual trade"}`));
  const items = [];
  if (c === "all") {
    for (const k of ENERGY_COMMODITIES) items.push(`<div><span class="swatch line" style="background:${P.commodity[k]}"></span>${COMMODITY_META[k].label}</div>`);
  }
  const w = app.flowWidthSamples();
  if (w.length) {
    items.push(`<div style="gap:10px;align-items:flex-end">${w.map((s) => `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:3px"><span style="width:28px;height:${Math.max(1, s.px)}px;border-radius:4px;background:${c === "all" ? P.text2 : P.commodity[c]}"></span><span class="dim" style="font-size:10.5px">${s.label}</span></span>`).join("")}</div>`);
  }
  const railRoad = `<span class="swatch line" style="margin-left:8px;background:repeating-linear-gradient(90deg,${P.text2} 0 2px,transparent 2px 6px)"></span>Rail / road`;
  if (c === "rare_earths") items.push(`<div><span class="swatch line" style="background:${P.text2}"></span>Container shipping ${railRoad}</div>`);
  else items.push(`<div><span class="swatch line" style="background:repeating-linear-gradient(90deg,${P.text2} 0 6px,transparent 6px 9px)"></span>Pipeline ${railRoad}</div>`);
  if (state.scenario === "hormuz") items.push(`<div><span class="swatch line" style="background:repeating-linear-gradient(90deg,${P.status.closed} 0 4px,transparent 4px 8px)"></span>Disrupted in 2026 (via Hormuz)</div>`);
  root.append(el("div", { class: "legend-items", html: items.join("") }));
}

function fmtShort(v, unit) {
  if (unit === "kb/d") return v >= 1000 ? `${num(v / 1000, 1)}m` : `${num(v, 0)}`;
  if (v >= 1000) return `${num(v / 1000, 1)}k`;
  return num(v, v < 10 ? 1 : 0);
}

// ------------------------------------------------------------------------------------ banner
export function renderBanner(root, app) {
  const { db } = app;
  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem("te-banner") === db.asOf;
  } catch (e) { /* storage unavailable */ }
  if (dismissed) {
    root.classList.add("hidden");
    return;
  }
  const hz = db.cpById.get("hormuz");
  const pw = db.portwatch[hz.portwatch];
  const st = portwatchStats(pw);
  const ch = st.avg2025 ? Math.round((100 * (st.last7 - st.avg2025)) / st.avg2025) : null;
  root.innerHTML = `<span class="pulse" aria-hidden="true"></span>
    <span class="banner-text"><strong>Hormuz report · ${dateLabel(db.asOf)}</strong> · tanker transits ${ch}% vs 2025 (to ${dateLabel(pw.end)}) · Brent $${num(db.context.market[0].value, 2)} (${dateLabel(db.context.market[0].date)})</span>`;
  root.append(
    el("button", { class: "btn small", onclick: () => app.select({ type: "chokepoint", id: "hormuz" }, { lens: "chokepoints" }) }, "Briefing"),
    el("button", { class: "icon-btn", style: "width:26px;height:26px", "aria-label": "Dismiss", html: icon("x"),
      onclick: () => {
        root.classList.add("hidden");
        try { sessionStorage.setItem("te-banner", db.asOf); } catch (e) { /* ignore */ }
        app.syncPanelVisibility();
      } }));
  root.classList.remove("hidden");
}

// ------------------------------------------------------------------------------------ tooltip
export function tooltipHtml(app, target) {
  const { db, state } = app;
  if (!target) return null;
  if (target.type === "country") {
    const iso = target.id;
    const c = db.byIso.get(iso);
    if (!c) return null;
    let rows = "";
    if (state.lens === "balances") {
      const meta = db.meta.metrics[state.metric];
      const d = valueAt(db, state.metric, iso, state.year);
      rows = `<div class="tt-row"><span>${escapeHtml(meta.label)}</span><b>${d ? fmt(d.v, meta.unit) : "no data"}</b></div>`
        + (d ? `<div class="tt-row"><span class="dim">${d.year} · ${escapeHtml(d.src || "")}</span></div>` : "");
    } else if (state.lens === "chokepoints") {
      const hz = latestValue(db, "hormuz_oil_share", iso);
      const hzl = latestValue(db, "hormuz_lng_share", iso);
      rows = `<div class="tt-row"><span>Oil imports via Hormuz</span><b>${hz ? pct(hz.v) : "–"}</b></div>`
        + `<div class="tt-row"><span>LNG imports via Hormuz</span><b>${hzl ? pct(hzl.v) : "–"}</b></div>`;
    } else {
      const t = tradeTotals(db, iso);
      const keys = state.commodity === "all" ? ENERGY_COMMODITIES : [state.commodity];
      for (const k of keys) {
        if (!t[k].imp && !t[k].exp) continue;
        const u = COMMODITY_META[k].unit;
        rows += `<div class="tt-row"><span>${COMMODITY_META[k].short}</span><b>${t[k].exp ? `↗ ${fmt(t[k].exp, u)}` : ""}${t[k].exp && t[k].imp ? " · " : ""}${t[k].imp ? `↘ ${fmt(t[k].imp, u)}` : ""}</b></div>`;
      }
      if (!rows) rows = `<div class="tt-row"><span class="dim">No recorded ${escapeHtml(COMMODITY_META[state.commodity].label.toLowerCase())} trade</span></div>`;
    }
    return `<div class="tt-title"><span>${c.flag || ""}</span>${escapeHtml(c.name)}</div>${rows}<div class="tt-hint">Click for country profile</div>`;
  }
  if (target.type === "flow") {
    const f = db.flowById.get(target.id);
    if (!f) return null;
    const meta = COMMODITY_META[f.c];
    const sib = db.flows.filter((g) => g.f === f.f && g.t === f.t && g.c === f.c);
    const total = sib.reduce((s, g) => s + g.v, 0);
    const cps = (f.cp || []).map((id) => db.cpById.get(id)).filter(Boolean);
    return `<div class="tt-title">${flag(db, f.f)} ${escapeHtml(countryName(db, f.f))} → ${flag(db, f.t)} ${escapeHtml(countryName(db, f.t))}</div>
      <div class="tt-row"><span>${meta.label}, ${flowYears(sib)}</span><b>${fmt(total, meta.unit)}</b></div>
      ${sib.length > 1 ? `<div class="tt-row"><span>This route</span><b>${fmt(f.v, meta.unit)}</b></div>` : ""}
      ${f.via ? `<div class="tt-row"><span class="dim">${escapeHtml(f.via[0])} → ${escapeHtml(f.via[1])}</span></div>` : ""}
      ${cps.length ? `<div class="tt-row"><span>Via</span><b>${cps.map((c) => `<span style="color:var(--s-${c.status})">${escapeHtml(c.name)}</span>`).join(", ")}</b></div>` : ""}
      <div class="tt-hint">Click for route details</div>`;
  }
  if (target.type === "chokepoint") {
    const cp = db.cpById.get(target.id);
    const pw = db.portwatch[cp.portwatch];
    const st = pw ? portwatchStats(pw) : null;
    return `<div class="tt-title"><span class="swatch" style="border-radius:50%;background:var(--s-${cp.status})"></span>${escapeHtml(cp.name)}</div>
      <div class="tt-row"><span>Status</span><b style="color:var(--s-${cp.status})">${escapeHtml(cp.status_label)}</b></div>
      ${st ? `<div class="tt-row"><span>Tankers/day, last 7 days</span><b>${num(st.last7, 1)}</b></div><div class="tt-row"><span>2025 average</span><b>${num(st.avg2025, 1)}</b></div>` : ""}
      ${cp.oil ? `<div class="tt-row"><span>Oil flow, 1H25 (EIA)</span><b>${num(cp.oil["2025h1"] ?? cp.oil["2025"], 1)} mb/d</b></div>` : ""}
      <div class="tt-hint">Click for briefing</div>`;
  }
  return null;
}

// ------------------------------------------------------------------------------------ palette
export function openPalette(app, { mode = "search" } = {}) {
  const { db } = app;
  const overlay = el("div", { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": mode === "compare" ? "Choose a country to compare" : "Search" });
  const input = el("input", { type: "text", placeholder: mode === "compare" ? "Compare with… (type a country)" : "Search countries, chokepoints, metrics or commands…", "aria-label": "Search" });
  const list = el("div", { class: "palette-list", role: "listbox" });
  const box = el("div", { class: "palette glass" },
    el("div", { class: "palette-input", html: icon("search") }), list,
    el("div", { class: "palette-foot", html: `<span><span class="kbd">↑↓</span> navigate</span><span><span class="kbd">↵</span> open</span><span><span class="kbd">esc</span> close</span>` }));
  box.querySelector(".palette-input").append(input);
  overlay.append(box);
  let items = [];
  let active = 0;
  const commands = () => [
    { kind: "command", label: "Show trade flows", sub: "Map view", icon: "↗", run: () => app.store.set({ lens: "flows" }) },
    { kind: "command", label: "Trade between two countries", sub: "Exact products · latest official reports", icon: "⇄", run: () => app.openTrade() },
    { kind: "command", label: "Colour countries by data", sub: "Map view", icon: "▦", run: () => app.store.set({ lens: "balances" }) },
    { kind: "command", label: "Chokepoints & live shipping", sub: "Map view", icon: "⌇", run: () => app.store.set({ lens: "chokepoints" }) },
    { kind: "command", label: "Strait of Hormuz briefing", sub: "Chokepoint", icon: "●", run: () => app.select({ type: "chokepoint", id: "hormuz" }, { lens: "chokepoints" }) },
    ...COMMODITIES.map((c) => ({ kind: "command", label: `Show ${COMMODITY_META[c].label} flows`, sub: "Commodity", icon: "◦", run: () => app.store.set({ lens: "flows", commodity: c }) })),
    { kind: "command", label: "Toggle globe / flat map", sub: "View · G", icon: "◍", run: () => app.toggleProjection() },
    { kind: "command", label: "Toggle light / dark theme", sub: "View · T", icon: "◐", run: () => app.toggleTheme() },
    { kind: "command", label: "Copy link to this view", sub: "Share", icon: "⧉", run: () => app.copyLink() },
    { kind: "command", label: "Download map as PNG", sub: "Export", icon: "⤓", run: () => app.downloadPng() },
    { kind: "command", label: "Download visible flows as CSV", sub: "Export", icon: "⤓", run: () => app.downloadCsv() },
    { kind: "command", label: "Sources & methods", sub: "About", icon: "ⓘ", run: () => app.openAbout() },
  ];
  const render = () => {
    const q = input.value;
    if (mode === "compare") {
      items = (q ? search(db, q, {}).filter((r) => r.kind === "country") : app.suggestedCompare()).map((r) => ({ ...r, run: () => app.store.set({ compare: r.id, partner: null }) }));
    } else if (!q) {
      items = commands();
    } else {
      items = search(db, q, db.meta.metrics).map((r) => ({
        ...r,
        run: r.kind === "country" ? () => app.select({ type: "country", id: r.id })
          : r.kind === "chokepoint" ? () => app.select({ type: "chokepoint", id: r.id }, { lens: "chokepoints" })
          : () => app.store.set({ lens: "balances", metric: r.id }),
      }));
      const qq = q.toLowerCase();
      items.push(...commands().filter((c) => c.label.toLowerCase().includes(qq)));
    }
    active = 0;
    list.replaceChildren();
    if (!items.length) {
      list.append(el("div", { class: "palette-empty" }, "No matches. Try a country name, “Hormuz”, or “LNG”."));
      return;
    }
    let lastGroup = null;
    items.forEach((it, i) => {
      const group = { country: "Countries", chokepoint: "Chokepoints", metric: "Map layers", command: "Commands" }[it.kind];
      if (group !== lastGroup) {
        list.append(el("div", { class: "palette-group" }, group));
        lastGroup = group;
      }
      let aside = "";
      if (it.kind === "country") {
        const v = latestValue(db, "tes_ej", it.id);
        aside = db.byIso.get(it.id) ? escapeHtml(db.regions[db.byIso.get(it.id).region] || "") : "";
        if (v) aside += ` · ${num(v.v, 1)} EJ`;
      }
      if (it.kind === "chokepoint") aside = `<span style="color:var(--s-${it.status})">${escapeHtml(db.cpById.get(it.id)?.status_label || "")}</span>`;
      const row = el("div", { class: "palette-item", role: "option", "aria-selected": String(i === active), html:
        `<span class="pi-icon">${it.icon || (it.kind === "chokepoint" ? "⌇" : it.kind === "metric" ? "▦" : "•")}</span>
         <span class="pi-main">${escapeHtml(it.label)}${it.sub ? `<div class="pi-sub">${escapeHtml(it.sub)}</div>` : ""}</span>
         <span class="pi-aside">${aside}</span>` });
      row.addEventListener("mousemove", () => setActive(i));
      row.addEventListener("click", () => choose(i));
      list.append(row);
    });
  };
  const setActive = (i) => {
    active = Math.max(0, Math.min(items.length - 1, i));
    list.querySelectorAll(".palette-item").forEach((r, j) => r.setAttribute("aria-selected", String(j === active)));
    list.querySelectorAll(".palette-item")[active]?.scrollIntoView({ block: "nearest" });
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    app.lastFocus?.focus?.();
  };
  const choose = (i) => {
    const it = items[i];
    close();
    it?.run();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
  };
  input.addEventListener("input", render);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  app.lastFocus = document.activeElement;
  render();
  input.focus();
}

// ------------------------------------------------------------------------------------ about
export function openAbout(app) {
  const { db } = app;
  const overlay = el("div", { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": "Sources and methods" });
  const rows = db.meta.sources.map((s) => `<tr><td>${escapeHtml(s.id)}</td><td><a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a><br><span class="dim">${escapeHtml(s.vintage)}</span></td></tr>`).join("");
  const body = el("div", { class: "modal-body", html: `
    <p>TerraEnergy maps who produces, consumes and trades the world's oil, gas and coal, alongside rare earth trade, using 2025 data with 2024 fallback,
    and puts it next to live shipping data for the 2026 Middle East supply crisis. Data built ${escapeHtml(db.meta.generated)}; curated context as of ${dateLabel(db.asOf)}.</p>
    <p><b>Freshness:</b> ${db.meta.trade_retrieval_range ? `dated customs snapshots retrieved ${dateLabel(db.meta.trade_retrieval_range[0].slice(0, 10))}–${dateLabel(db.meta.trade_retrieval_range[1].slice(0, 10))}.` : "Retrieval dates for older cached customs files were not recorded."} ${db.meta.trade_undated_source_files ? `${db.meta.trade_undated_source_files} older source files have no recorded retrieval timestamp.` : ""} A rebuild date is not a reporting period. The country-trade explorer checks the latest published annual or monthly dataset separately for each reporter and shows release dates, retrieval times and estimation flags. Live checks require the local server; saved reports remain usable offline.</p>
    <h3>Sources</h3><table class="src-table">${rows}</table>
    <h3>How the numbers are built</h3>
    <ul>
      <li><b>Country balances</b> come from the Energy Institute Statistical Review 2026 (data for 2025) in physical units (kb/d, bcm, Mt, EJ, TWh). About 80 countries are listed individually. For the rest, U.S. EIA International Energy Statistics fill in (mostly 2024). Every value shows its year and source.</li>
      <li><b>Oil</b> production is crude, condensate and NGLs. Consumption excludes biofuels (EI definitions).</li>
      <li><b>Crude, oil-product and coal trade</b> comes from importers' customs declarations in UN Comtrade (HS 2709, 2710, 2701) for 2025, or 2024 where 2025 is not yet reported. For countries that do not report (Taiwan, Vietnam, UAE, Bangladesh and others), partners' export declarations are used after implausible rows are removed. Tonnes are converted to barrels using each exporter's typical crude density (API gravity).</li>
      <li><b>Gas trade</b> uses the Energy Institute's 2025 LNG and pipeline matrices, which reconcile to world totals (578.5 bcm LNG, 567.6 bcm pipeline). Where EI reports regional aggregates, they are split across countries using UN Comtrade partner shares or physical pipeline landing points.</li>
      <li><b>Rare earth trade</b> uses UN Comtrade HS 280530 (metals, including scandium and yttrium), 284610 (cerium compounds) and 284690 (other compounds). Values are tonnes of traded product, not contained rare earth oxide; ores and finished magnets are excluded. Importer declarations take precedence, with partner exports used for unreported product groups. Missing weights are omitted, never inferred from prices. Links below one tonne are omitted. Coverage is a sample of reporting economies, not a complete world total. Customs records do not say how goods moved, so these routes are modelled like other trade: container shipping between main ports, or rail and road between neighbours with open borders. Some high-value lots travel by air. Rare earths are excluded from the energy-equivalent “All energy” view.</li>
      <li><b>Routes</b> follow a hand-built network of about 450 sea-lane waypoints, checked against coastlines. Each seaborne flow takes the shortest path between the exporter's and importer's main terminals. It reflects 2024–25 behaviour: Western-linked shipping avoided the Red Sea, VLCCs and most LNG carriers avoided Panama, and cargoes are split across Saudi, Emirati and Russian terminals by destination. Routed volumes reproduce EIA's Suez and Bab el-Mandeb figures and about 80% of its Hormuz and Malacca totals. The rest is trade missing from customs data, such as unreported Iranian exports.</li>
      <li><b>Hormuz exposure</b> is the share of a net importer's 2025 routed oil (or LNG) imports that passed through the strait.</li>
      <li><b>Chokepoint traffic</b> is IMF PortWatch's daily count of vessels transiting, derived from satellite AIS. Pre-crisis volumes are EIA estimates.</li>
    </ul>
    <h3>Known limitations</h3>
    <ul>
      <li>LPG and other petroleum gases (HS 2711) are not included in oil-product flows, so product trade from the US and the Gulf is understated.</li>
      <li>China declares a large volume of crude as Malaysian. Tanker-tracking firms attribute most of it to Iran, so that flow is routed from Kharg Island and flagged.</li>
      <li>Taiwan's crude import sources are incomplete: Saudi Arabia records exports to “Other Asia, nes” that cannot be allocated.</li>
      <li>Crude declared as coming from economies that produce none (for example Switzerland, Panama, Togo or Liberia) is left off the map, because the declared partner is a trading company's home country, a ship registry or a storage hub and the true origin is unknown. About 0.15 mb/d worldwide; each importer's profile states how much was excluded.</li>
      <li>Russian exports are seen only through importers' declarations. Russia–Belarus crude uses EI's inter-regional estimate.</li>
      <li>Transport modes are modelled, because customs records do not state them. Neighbours trade overland only across borders that carry freight; closed or impassable borders (China–India, India–Pakistan, Armenia–Azerbaijan) and neighbours that trade mainly by tanker are routed by sea. Landlocked countries ship through their usual gateway port. Crude is shown as a pipeline only where a cross-border pipeline exists.</li>
      <li>Pipeline routes, border crossings and terminal assignments are schematic, for orientation only.</li>
      <li>The 2026 situation layer is a dated editorial snapshot (${dateLabel(db.asOf)}), not a live news feed. <code>npm run data:refresh</code> updates the official source datasets; it does not update curated news or market quotes.</li>
    </ul>
    <h3>Keyboard</h3>
    <p><span class="kbd">⌘K</span> or <span class="kbd">/</span> search · <span class="kbd">1</span>–<span class="kbd">3</span> switch view · <span class="kbd">G</span> globe · <span class="kbd">T</span> theme · <span class="kbd">Esc</span> close</p>` });
  const modal = el("div", { class: "modal glass" },
    el("div", { class: "modal-head" }, el("h2", {}, "Sources & methods"),
      el("button", { class: "icon-btn", "aria-label": "Close", html: icon("x"), onclick: () => close() })), body);
  overlay.append(modal);
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  modal.querySelector("button").focus();
}

export function toast(text) {
  const t = el("div", { class: "tooltip glass show", style: "left:50%;top:auto;bottom:24px;transform:translateX(-50%);position:fixed" }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}
