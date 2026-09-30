// Right-hand detail panel: overview, country, flow, chokepoint and comparison views.
/* global d3 */

import { barList, lineChart, mixBar } from "../charts.js";
import { palette } from "../colors.js";
import {
  bilateral, chokepointCoverage, COMMODITY_META, countryName, exposureByImporter, flag, flowYears, latestValue, matchesCommodity, mergeParts, partners,
  ranking, tradeTotals,
} from "../data.js";
import { bcmToBcfd, dateLabel, escapeHtml, fmt, int, num, oil, pct, signed, toEJ } from "../format.js";
import { el, icon, section, tabs } from "./dom.js";

const STATUS_LABEL = { closed: "Closed", high_risk: "High risk", restricted: "Reduced", open: "Open" };
const GULF = ["SAU", "IRQ", "KWT", "ARE", "QAT", "BHR", "IRN"];
const SRC_LABEL = { EI: "Energy Institute", EIA: "U.S. EIA", Ember: "Ember", Derived: "Derived", OWID: "OWID" };

export class Panel {
  constructor({ root, head, body, app }) {
    this.root = root;
    this.head = head;
    this.body = body;
    this.app = app;
    this.tab = { country: "crude" };
  }

  render() {
    const { state } = this.app;
    const sel = state.selected;
    this.body.scrollTop = 0;
    this.head.replaceChildren();
    this.body.replaceChildren();
    if (state.compare && sel?.type === "country") return this.compare(sel.id, state.compare);
    if (state.partner && sel?.type === "country") return this.pairTrade(sel.id, state.partner);
    if (!sel) return this.overview();
    if (sel.type === "country") return this.country(sel.id);
    if (sel.type === "flow") return this.flow(sel.id);
    if (sel.type === "chokepoint") return this.chokepoint(sel.id);
    return this.overview();
  }

  // ------------------------------------------------------------------ shared bits
  headBlock({ kicker, title, sub, actions = [] }) {
    const titles = el("div", { class: "titles" },
      el("div", { class: "panel-kicker", html: kicker }),
      el("div", { class: "panel-title", html: title }),
      sub ? el("div", { class: "panel-sub", html: sub }) : null);
    const nav = el("div", { class: "panel-nav" }, ...actions);
    this.head.append(titles, nav);
  }

  closeBtn() {
    return el("button", { class: "icon-btn", "aria-label": "Close details", title: "Close (Esc)", html: icon("x"),
      onclick: () => this.app.select(null) });
  }

  hideBtn() {
    return el("button", { class: "icon-btn", "aria-label": "Hide panel", title: "Hide panel — full-width map", html: icon("collapse"),
      onclick: () => this.app.store.set({ panelOpen: false }) });
  }

  kpi(label, value, unit = "", foot = "") {
    return el("div", { class: "kpi" },
      el("div", { class: "k-label", html: label }),
      el("div", { class: "k-value", html: `${value}${unit ? `<span class="k-unit">${unit}</span>` : ""}` }),
      foot ? el("div", { class: "k-foot", html: foot }) : null);
  }

  sourceNote(html) {
    return el("p", { class: "note", html });
  }

  // ------------------------------------------------------------------ overview
  overview() {
    const { db, state } = this.app;
    if (state.lens === "flows" && state.commodity === "rare_earths") return this.rareEarthOverview();
    const ctx = db.context;
    this.headBlock({
      kicker: "World · 2025 data",
      title: "Global energy at a glance",
      sub: `Energy Institute Statistical Review 2026 · context dated ${dateLabel(ctx.as_of)}`,
      actions: this.app.isMobile() ? [] : [this.hideBtn()],
    });
    this.body.append(this.situationCard());
    this.body.append(this.supplyShock());
    this.body.append(this.worldKpis());
    this.body.append(this.markets());
    this.body.append(this.leaders(state));
    this.body.append(this.timeline(6));
    this.body.append(section("", "", this.sourceNote(
      `Country balances: Energy Institute (2025) with U.S. EIA for countries EI groups together. Trade flows: UN Comtrade
       customs declarations (2025, 2024 where not yet reported) and EI 2025 gas trade matrices. See
       <a href="#" data-about>sources &amp; methods</a>.`)));
    this.body.querySelector("[data-about]")?.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.openAbout();
    });
  }

  rareEarthOverview() {
    const { db, state } = this.app;
    const flows = db.flows.filter((f) => f.c === "rare_earths");
    const total = flows.reduce((sum, f) => sum + f.v, 0);
    this.headBlock({
      kicker: `World · ${flowYears(flows)} customs data`, title: "Rare earth trade",
      sub: "Metals & compounds · UN Comtrade",
      actions: this.app.isMobile() ? [] : [this.hideBtn()],
    });
    this.body.append(section("Recorded trade", "annual product weight", el("div", { class: "kpis" },
      this.kpi("Recorded volume", fmt(total, "t")),
      this.kpi("Trade links", int(flows.length)),
      this.kpi("Exporting economies", int(new Set(flows.map((f) => f.f)).size)),
      this.kpi("Importing economies", int(new Set(flows.map((f) => f.t)).size)))),
      section("What is included", "HS 280530 · 284610 · 284690", this.sourceNote(
        escapeHtml(db.flowCoverage.rare_earths?.scope || "Rare earth metals and compounds, in tonnes of traded product.")),
        this.sourceNote("Reporting coverage is incomplete. Totals combine the latest available year per reporter (2025, or 2024). Re-exports can count the same material more than once; these are trade volumes, not mine production.")),
      this.leaders(state),
      section("Largest trade links", "tonnes per year", barList([...flows].sort((a, b) => b.v - a.v).slice(0, 8).map((f) => ({
        id: f.id, name: `${countryName(db, f.f)} → ${countryName(db, f.t)}`, value: f.v,
        label: fmt(f.v, "t"), color: palette().commodity.rare_earths,
      })), { onClick: (r) => this.app.select({ type: "flow", id: r.id }) })),
      section("Source", "", this.sourceNote('<a href="https://comtradeplus.un.org/" target="_blank" rel="noopener">UN Comtrade</a> · importer declarations, supplemented by partner-reported exports. Links below one tonne or without usable weights are omitted.')));
  }

  situationCard() {
    const { db } = this.app;
    const hz = db.cpById.get("hormuz");
    const pw = db.portwatch[hz.portwatch];
    const stats = portwatchStats(pw);
    const m = db.context.monthly_crude;
    const gulfAt = (ym) => GULF.reduce((s, iso) => s + (monthlyAt(m[iso], ym) ?? 0), 0);
    const last = lastMonth(m.SAU);
    const drop = gulfAt("2026-02") - gulfAt(last);
    const brent = db.context.market.find((x) => x.id === "brent");
    const brent25 = db.context.prices_annual.brent?.["2025"];
    const card = el("div", { class: "callout alert" },
      el("div", { class: "callout-title", html: `<span class="badge closed"><span class="dot"></span>Closed</span> Strait of Hormuz` }),
      el("p", { html: `Effectively shut to commercial shipping since <b>2 March 2026</b>, after US–Israeli strikes on Iran.
        About a fifth of the world's oil and LNG passed through it in 2025.` }),
      el("div", { style: "margin-top:8px" },
        statLine("Tanker transits, last 7 days", `${num(stats.last7, 1)}/day <span class="dim">vs ${num(stats.avg2025, 0)} in 2025</span>`),
        statLine(`Gulf crude output, Feb → ${monthName(last)} 2026`, `<span class="delta-down">−${oil(drop)}</span>`),
        statLine(`Brent, ${dateLabel(brent.date, { day: "numeric", month: "short" })}`, `$${num(brent.value, 2)} <span class="dim">vs $${num(brent25, 2)} avg 2025</span>`),
        statLine("Qatar LNG cargoes, Mar–Aug 2026", `18 <span class="dim">vs 509 a year earlier</span>`)),
      el("div", { style: "display:flex;gap:6px;margin-top:10px;flex-wrap:wrap" },
        el("button", { class: "btn small", html: `${icon("choke")} Hormuz briefing`, onclick: () => this.app.select({ type: "chokepoint", id: "hormuz" }, { lens: "chokepoints" }) }),
        el("button", { class: "btn small", html: "Who is most exposed?", onclick: () => this.app.store.set({ lens: "balances", metric: "hormuz_oil_share", selected: null }) })));
    return section("Situation", `as of ${dateLabel(db.context.as_of)}`, card);
  }

  supplyShock() {
    const { db } = this.app;
    const m = db.context.monthly_crude;
    const months = monthsFrom(m.WORLD);
    const gulf = months.map((ym) => ({ x: ymDate(ym), y: GULF.reduce((s, iso) => s + (monthlyAt(m[iso], ym) ?? 0), 0) / 1000 }));
    const rest = months.map((ym) => ({ x: ymDate(ym), y: ((monthlyAt(m.WORLD, ym) ?? 0) / 1000) - gulf.find((g) => +g.x === +ymDate(ym)).y }));
    const P = palette();
    const chart = lineChart({
      title: "Monthly crude oil production",
      series: [
        { key: "gulf", label: "Persian Gulf producers", color: P.status.closed, values: gulf, area: true },
        { key: "rest", label: "Rest of world", color: P.commodity.crude, values: rest, dash: "" },
      ],
      xType: "date", yFormat: (v) => `${num(v, 0)}`, yMin: 0, height: 150,
      annotations: [{ x: ymDate("2026-03"), label: "Hormuz closed", color: P.status.closed }],
    });
    return section("The 2026 supply shock", "crude + condensate, mb/d", chart,
      this.sourceNote(`Monthly data: U.S. EIA International Energy Statistics (to ${monthName(lastMonth(m.WORLD))} ${lastMonth(m.WORLD).slice(0, 4)}). Gulf = Saudi Arabia, Iraq, Kuwait, UAE, Qatar, Bahrain, Iran.`));
  }

  worldKpis() {
    const { db } = this.app;
    const w = db.context.world_2025;
    const p = db.context.world_2024;
    const yoy = (a, b) => (b ? (100 * (a - b)) / b : null);
    const d = (a, b) => {
      const v = yoy(a, b);
      if (v == null) return "";
      const cls = v > 0.05 ? "delta-up" : v < -0.05 ? "delta-down" : "delta-flat";
      return `<span class="${cls}">${signed(v, (x) => num(x, 1))}%</span> vs 2024`;
    };
    const grid = el("div", { class: "kpis" },
      this.kpi("Oil demand", num(w.oil_cons_kbd / 1000, 1), "mb/d", d(w.oil_cons_kbd, p.oil_cons_kbd)),
      this.kpi("Oil production", num(w.oil_prod_kbd / 1000, 1), "mb/d", d(w.oil_prod_kbd, p.oil_prod_kbd)),
      this.kpi("Gas demand", int(w.gas_cons_bcm), "bcm", d(w.gas_cons_bcm, p.gas_cons_bcm)),
      this.kpi("LNG trade", num(w.lng_trade_bcm, 0), "bcm", d(w.lng_trade_bcm, p.lng_imp_bcm)),
      this.kpi("Coal demand", num(w.coal_cons_ej, 0), "EJ", d(w.coal_cons_ej, p.coal_cons_ej)),
      this.kpi("Total energy supply", num(w.tes_ej, 0), "EJ", d(w.tes_ej, p.tes_ej)),
      this.kpi("Solar power", int(w.solar_twh), "TWh", d(w.solar_twh, p.solar_twh)),
      this.kpi("CO₂ from energy", num(w.co2_mt / 1000, 1), "Gt", d(w.co2_mt, p.co2_mt)));
    return section("World in 2025", "Energy Institute", grid);
  }

  markets() {
    const { db } = this.app;
    const rows = db.context.market.map((m) => {
      const annual = db.context.prices_annual[m.annual_key]?.["2025"];
      let cmp = "";
      if (annual && !m.annual_unit) {
        const ch = (100 * (m.value - annual)) / annual;
        cmp = `<span class="${ch >= 0 ? "delta-up" : "delta-down"}">${signed(ch, (x) => num(x, 0))}%</span> <span class="dim">vs 2025 avg</span>`;
      } else if (annual) {
        cmp = `<span class="dim">2025 avg ${num(annual, 2)} ${m.annual_unit}</span>`;
      }
      return el("div", { class: "stat-line" },
        el("span", { class: "k", html: `${escapeHtml(m.label)} <span class="dim">· ${dateLabel(m.date, { day: "numeric", month: "short" })}</span>` }),
        el("span", { class: "v", html: `${m.unit.startsWith("$") ? "$" : m.unit.startsWith("€") ? "€" : ""}${num(m.value, 2)}<span class="dim"> ${m.unit.replace(/^[$€]/, "")}</span><br><span style="font-weight:500;font-size:11px">${cmp}</span>` }));
    });
    return section("Markets", `<a href="${db.context.market_sources[0].url}" target="_blank" rel="noopener">quotes</a>`, ...rows);
  }

  leaders(state) {
    if (state.lens === "balances") return this.metricLeaders(state);
    const { db } = this.app;
    const c = state.commodity === "all" ? "crude" : state.commodity;
    const meta = COMMODITY_META[c];
    const exp = new Map();
    const imp = new Map();
    for (const f of db.flows) {
      if (f.c !== c) continue;
      exp.set(f.f, (exp.get(f.f) || 0) + f.v);
      imp.set(f.t, (imp.get(f.t) || 0) + f.v);
    }
    const P = palette();
    const rows = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([iso, v]) => ({
      iso, flag: flag(db, iso), name: countryName(db, iso), value: v, label: fmt(v, meta.unit), color: P.commodity[c],
    }));
    const wrap = el("div");
    const draw = (dir) => {
      wrap.replaceChildren(
        tabs([{ key: "exp", label: `Top exporters` }, { key: "imp", label: "Top importers" }], dir, draw),
        barList(rows(dir === "exp" ? exp : imp), { onClick: (r) => this.app.select({ type: "country", id: r.iso }) }));
    };
    draw("exp");
    return section(`${meta.label} trade leaders`, `${flowYears(db.flows.filter((f) => f.c === c))} recorded trade`, wrap);
  }

  metricLeaders(state) {
    const { db } = this.app;
    const meta = db.meta.metrics[state.metric];
    const P = palette();
    // Shares are only meaningful for sizeable energy users; skip micro-states at 100%.
    const big = (iso) => (latestValue(db, "tes_ej", iso)?.v ?? 0) >= 0.5;
    const filter = meta.unit === "%" ? big : null;
    const rows = (list) => list.map((r) => ({
      iso: r.iso, flag: flag(db, r.iso), name: countryName(db, r.iso), value: r.v,
      label: fmt(r.v, meta.unit), color: meta.scale === "div" ? (r.v >= 0 ? "#35978f" : "#bf812d") : P.accent,
    }));
    const wrap = el("div");
    const open = (r) => this.app.select({ type: "country", id: r.iso });
    if (meta.scale === "div") {
      const draw = (dir) => wrap.replaceChildren(
        tabs([{ key: "hi", label: "Largest net exporters" }, { key: "lo", label: "Largest net importers" }], dir, draw),
        barList(rows(ranking(db, state.metric, 10, { desc: dir === "hi" })), { onClick: open }));
      draw("hi");
    } else {
      wrap.append(barList(rows(ranking(db, state.metric, 10, { filter })), { onClick: open }));
    }
    return section(`Highest: ${escapeHtml(meta.label.toLowerCase())}`, meta.unit === "%" ? "countries using ≥0.5 EJ/yr" : "latest year", wrap);
  }

  timeline(limit = 6) {
    const { db } = this.app;
    const events = [...db.context.events].reverse();
    const wrap = el("div", { class: "timeline" });
    const tagColor = { conflict: "var(--s-closed)", lng: "var(--c-lng)", oil: "var(--c-crude)", gas: "var(--c-pipeline_gas)",
      opec: "var(--text-2)", price: "var(--s-restricted)", sanctions: "var(--s-high_risk)" };
    const draw = (n) => {
      wrap.replaceChildren(...events.slice(0, n).map((e) => el("div", { class: "tl-item" },
        el("div", { class: "tl-date", html: dateLabel(e.date, { day: "numeric", month: "short", year: "2-digit" }) }),
        el("div", { class: "tl-dot", style: `background:${tagColor[e.tag] || "var(--text-3)"}` }),
        el("div", {},
          el("div", { class: "tl-title", html: escapeHtml(e.title) }),
          el("div", { class: "tl-body", html: escapeHtml(e.body) }),
          el("div", { class: "tl-src", html: e.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>`).join(" · ") })))));
      if (n < events.length) {
        wrap.append(el("button", { class: "btn small", style: "margin-top:6px", onclick: () => draw(events.length) }, `Show all ${events.length} events`));
      }
    };
    draw(limit);
    return section("Timeline", "2025–26", wrap);
  }

  // ------------------------------------------------------------------ country
  country(iso) {
    const { db } = this.app;
    const c = db.byIso.get(iso);
    if (!c) return this.overview();
    const L = (m) => latestValue(db, m, iso);
    const pop = L("population");
    const netOil = L("net_oil_kbd");
    const netGas = L("net_gas_bcm");
    const badges = [];
    if (netOil) badges.push(`<span class="badge">${netOil.v >= 0 ? "Net oil exporter" : "Net oil importer"}</span>`);
    if (netGas && Math.abs(netGas.v) > 0.05) badges.push(`<span class="badge">${netGas.v >= 0 ? "Net gas exporter" : "Net gas importer"}</span>`);
    this.headBlock({
      kicker: `${escapeHtml(db.regions[c.region] || "")}${pop ? ` · ${num(pop.v / 1e6, 1)} m people` : ""}`,
      title: `<span class="flag">${c.flag || ""}</span>${escapeHtml(c.name)}`,
      sub: `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${badges.join("")}</div>`,
      actions: [
        el("button", { class: "icon-btn", title: "Compare with another country", "aria-label": "Compare", html: icon("compare"),
          onclick: () => this.app.openPalette({ mode: "compare" }) }),
        this.closeBtn(),
      ],
    });
    this.body.append(el("button", { class: "btn", onclick: () => this.app.openTrade(iso) }, "Products traded with another country"));
    const rareEarths = this.app.state.lens === "flows" && this.app.state.commodity === "rare_earths";
    if (rareEarths) this.body.append(this.countryTrade(iso));
    this.body.append(this.countryKpis(iso));
    const sec = this.countrySecurity(iso);
    if (sec) this.body.append(sec);
    if (!rareEarths) this.body.append(this.countryTrade(iso));
    this.body.append(this.countryMix(iso));
    const monthly = db.context.monthly_crude[iso];
    if (monthly) this.body.append(this.countryMonthly(iso, monthly));
    this.body.append(this.countryTrends(iso));
    this.body.append(section("", "", this.sourceNote(this.countrySources(iso))));
  }

  countryKpis(iso) {
    const { db } = this.app;
    const tile = (label, metric, unitOverride) => {
      const d = latestValue(db, metric, iso);
      const meta = db.meta.metrics[metric] || { unit: unitOverride };
      if (!d) return this.kpi(label, "–", "", "<span class='dim'>no data</span>");
      const unit = unitOverride || meta.unit;
      let value;
      let u = unit;
      if (unit === "kb/d") {
        value = Math.abs(d.v) >= 1000 ? num(d.v / 1000, 2) : int(d.v);
        u = Math.abs(d.v) >= 1000 ? "mb/d" : "kb/d";
      } else if (unit === "%") {
        value = num(d.v, 0);
      } else value = num(d.v, 2);
      return this.kpi(label, value, u, `${d.year} · ${SRC_LABEL[d.src] || d.src}`);
    };
    const grid = el("div", { class: "kpis" },
      tile("Oil production", "oil_prod_kbd"), tile("Oil consumption", "oil_cons_kbd"),
      tile("Gas production", "gas_prod_bcm"), tile("Gas consumption", "gas_cons_bcm"),
      tile("Coal production", "coal_prod_mt"), tile("Coal consumption", "coal_cons_ej"),
      tile("Electricity generated", "elec_twh"), tile("Low-carbon electricity", "low_carbon_share_elec"),
      tile("Energy per person", "tes_pc_gj"), tile("CO₂ per person", "co2_pc_t"));
    return section("At a glance", "latest year", grid);
  }

  countrySecurity(iso) {
    const { db } = this.app;
    const L = (m) => latestValue(db, m, iso);
    const oilDep = L("oil_import_dep");
    const gasDep = L("gas_import_dep");
    const hzOil = L("hormuz_oil_share");
    const hzLng = L("hormuz_lng_share");
    const hzOilCons = L("hormuz_oil_cons_share");
    const lines = [];
    if (oilDep) lines.push(statLine("Oil import dependence", pct(oilDep.v)));
    if (gasDep) lines.push(statLine("Gas import dependence", pct(gasDep.v)));
    const crude = partners(db, iso, "crude", "imp");
    if (crude.rows.length) {
      const top = crude.rows[0];
      lines.push(statLine("Largest crude supplier", `${flag(db, top.iso)} ${escapeHtml(countryName(db, top.iso))} <span class="dim">${Math.round(top.share)}%</span>`));
      const hhi = crude.rows.reduce((s, r) => s + (r.share / 100) ** 2, 0);
      lines.push(statLine("Supplier concentration (HHI)", `${num(hhi * 10000, 0)} <span class="dim">${hhi > 0.25 ? "high" : hhi > 0.15 ? "moderate" : "diverse"}</span>`));
    }
    if (hzOil) lines.push(statLine("Oil imports via Hormuz (2025)", `<b>${pct(hzOil.v)}</b>${hzOilCons ? ` <span class="dim">≈ ${pct(hzOilCons.v)} of demand</span>` : ""}`));
    if (hzLng) lines.push(statLine("LNG imports via Hormuz (2025)", `<b>${pct(hzLng.v)}</b>`));
    if (!lines.length) return null;
    const children = [el("div", {}, ...lines)];
    const maxHz = Math.max(hzOil?.v || 0, hzLng?.v || 0);
    if (maxHz >= 15) {
      const vol = (db.byCountry.get(iso)?.imp || []).filter((f) => f.cp?.includes("hormuz") && (f.c === "crude" || f.c === "products"))
        .reduce((s, f) => s + f.v, 0);
      children.unshift(el("div", { class: `callout ${maxHz >= 40 ? "alert" : "warn"}`, style: "margin-bottom:10px" },
        el("div", { class: "callout-title", html: `Highly exposed to the 2026 Hormuz closure` }),
        el("p", { html: `In 2025, ${vol ? `<b>${oil(vol)}</b> of this country's oil imports and ` : ""}${hzLng ? `<b>${pct(hzLng.v)}</b> of its LNG imports` : "its supplies"} came through the Strait of Hormuz, which has been effectively closed since March 2026.` })));
    }
    return section("Energy security", "", ...children);
  }

  countryTrade(iso) {
    const { db } = this.app;
    const totals = tradeTotals(db, iso);
    const available = Object.keys(totals).filter((k) => totals[k].imp > 0 || totals[k].exp > 0 || k === this.app.state.commodity);
    const wrap = el("div");
    if (!available.length) {
      wrap.append(el("p", { class: "note" }, "No significant bilateral trade recorded in the customs data for this country."));
      return section("Trade partners", "", wrap);
    }
    let active = available.includes(this.app.state.commodity) ? this.app.state.commodity : available.includes(this.tab.country) ? this.tab.country : available.sort((a, b) =>
      toEJ(totals[b].imp + totals[b].exp, b) - toEJ(totals[a].imp + totals[a].exp, a))[0];
    const P = palette();
    const draw = () => {
      const meta = COMMODITY_META[active];
      const t = totals[active];
      const list = (dir) => {
        const { rows } = partners(db, iso, active, dir);
        return barList(rows.slice(0, 10).map((r) => ({
          iso: r.iso, flag: flag(db, r.iso), name: countryName(db, r.iso), value: r.v, share: r.share,
          label: fmt(r.v, meta.unit), color: P.commodity[active], flows: r.flows,
        })), {
          onClick: (r) => this.app.openPartner(r.iso),
          onHover: (r) => this.app.highlightFlows(r ? r.flows.map((f) => f.id) : null),
          empty: dir === "imp" ? "No imports recorded." : "No exports recorded.",
        });
      };
      const net = t.exp - t.imp;
      wrap.replaceChildren(
        tabs(available.map((k) => ({ key: k, label: COMMODITY_META[k].short, color: P.commodity[k] })), active, (k) => {
          active = k;
          this.tab.country = k;
          this.app.store.set({ commodity: k });
          draw();
        }),
        el("div", { class: "kpis", style: "margin-bottom:10px" },
          this.kpi("Imports", fmt(t.imp, meta.unit), "", t.imp && meta.unit === "bcm" ? `${num(bcmToBcfd(t.imp), 2)} Bcf/d` : ""),
          this.kpi("Exports", fmt(t.exp, meta.unit), "", `net ${signed(net, (v) => fmt(v, meta.unit))}`)),
        el("div", { class: "label" }, "Sources (imports from)"), list("imp"),
        el("div", { class: "label", style: "margin-top:12px" }, "Destinations (exports to)"), list("exp"),
        this.sourceNote(`${flowYears([...(db.byCountry.get(iso)?.imp || []), ...(db.byCountry.get(iso)?.exp || [])].filter((f) => f.c === active))} · ${active === "rare_earths" ? "UN Comtrade · product weight; incomplete coverage, not contained rare earth oxide." : "Recorded bilateral trade."}`),
        ...[active === "crude" && this.unattributedCrudeNote(iso)].filter(Boolean));
    };
    draw();
    return section("Trade partners", "hover to trace · click for details", wrap);
  }

  /** Crude that customs records attribute to economies producing none: left off the map, disclosed here. */
  unattributedCrudeNote(iso) {
    const { db } = this.app;
    const e = db.flowCoverage.crude?.non_producer_origin?.[iso];
    if (!e || e.kbd < 0.5) return null;
    const names = Object.keys(e.from).slice(0, 4).map((x) => escapeHtml(countryName(db, x)));
    const more = Object.keys(e.from).length > names.length ? ", …" : "";
    return this.sourceNote(`Imports exclude <b>${oil(e.kbd)}</b> declared as coming from economies that produce no crude
      (${names.join(", ")}${more}). These are usually trading companies' home countries, ship registries or storage
      hubs, so the oil's true origin is unknown.`);
  }

  countryMix(iso) {
    const { db } = this.app;
    const P = palette();
    const L = (m) => latestValue(db, m, iso)?.v ?? 0;
    const tes = [
      { label: "Oil", value: L("oil_cons_ej"), color: P.commodity.crude },
      { label: "Gas", value: L("gas_cons_ej"), color: P.commodity.lng },
      { label: "Coal", value: L("coal_cons_ej"), color: P.commodity.coal },
      { label: "Nuclear", value: L("nuclear_ej"), color: "#b07cff" },
      { label: "Hydro", value: L("hydro_ej"), color: "#4f8ef7" },
      { label: "Renewables", value: L("renew_ej"), color: "#4cc38a" },
    ];
    const elecKeys = [["coal", "Coal", P.commodity.coal], ["gas", "Gas", P.commodity.lng], ["oil", "Oil", P.commodity.crude],
      ["nuclear", "Nuclear", "#b07cff"], ["hydro", "Hydro", "#4f8ef7"], ["wind", "Wind", "#7fd1c7"], ["solar", "Solar", "#f7d154"],
      ["bioenergy", "Bioenergy", "#8fbf5a"], ["other_renewables", "Other renewables", "#4cc38a"]];
    const elec = elecKeys.map(([k, label, color]) => ({ label, value: L(`elec_${k}_twh`), color }));
    const elecYear = latestValue(db, "elec_coal_twh", iso)?.year || latestValue(db, "elec_solar_twh", iso)?.year;
    const hasTes = tes.some((t) => t.value > 0);
    return section("Energy mix", "",
      hasTes ? el("div", { class: "label" }, `Primary energy · ${latestValue(db, "oil_cons_ej", iso)?.year || ""} · Energy Institute`) : null,
      hasTes ? mixBar(tes, { format: (v) => num(v, 2), unit: "EJ" }) : null,
      el("div", { class: "label", style: hasTes ? "margin-top:14px" : "" }, `Electricity generation${elecYear ? ` · ${elecYear}` : ""} · Ember`),
      mixBar(elec, { format: (v) => num(v, 1), unit: "TWh" }));
  }

  countryMonthly(iso, series) {
    const { db } = this.app;
    const P = palette();
    const months = monthsFrom(series);
    const vals = months.map((ym) => ({ x: ymDate(ym), y: monthlyAt(series, ym) }));
    const chart = lineChart({
      title: "Monthly crude production",
      series: [{ key: iso, label: `${countryName(db, iso)} crude + condensate (kb/d)`, color: GULF.includes(iso) ? P.status.closed : P.commodity.crude, values: vals, area: true }],
      xType: "date", yFormat: (v) => int(v), height: 130, yMin: 0,
      annotations: [{ x: ymDate("2026-03"), label: "Hormuz", color: P.status.closed }],
    });
    return section("Monthly production", "EIA · to " + monthName(lastMonth(series)) + " " + lastMonth(series).slice(0, 4), chart);
  }

  countryTrends(iso) {
    const wrap = el("div", { html: `<div class="note">Loading 2000–2025 history…</div>` });
    this.app.ensureHistory().then((history) => {
      if (!history) return;
      const P = palette();
      const years = history.years;
      const S = (m) => history.series[m]?.[iso];
      const toVals = (arr, scale = 1) => (arr ? arr.map((v, i) => ({ x: years[i], y: v == null ? null : v * scale })) : []);
      const charts = [];
      if (S("oil_cons_kbd") || S("oil_prod_kbd")) {
        charts.push(el("div", { class: "label" }, "Oil (mb/d)"), lineChart({
          series: [
            { key: "p", label: "Production", color: P.commodity.crude, values: toVals(S("oil_prod_kbd"), 1 / 1000) },
            { key: "c", label: "Consumption", color: P.text2, values: toVals(S("oil_cons_kbd"), 1 / 1000), dash: "4 3" },
          ], yFormat: (v) => num(v, 1), height: 120 }));
      }
      if (S("gas_cons_bcm") || S("gas_prod_bcm")) {
        charts.push(el("div", { class: "label", style: "margin-top:12px" }, "Natural gas (bcm)"), lineChart({
          series: [
            { key: "p", label: "Production", color: P.commodity.lng, values: toVals(S("gas_prod_bcm")) },
            { key: "c", label: "Consumption", color: P.text2, values: toVals(S("gas_cons_bcm")), dash: "4 3" },
          ], yFormat: (v) => num(v, 0), height: 120 }));
      }
      if (S("low_carbon_share_elec")) {
        charts.push(el("div", { class: "label", style: "margin-top:12px" }, "Electricity: low-carbon vs coal share (%)"), lineChart({
          series: [
            { key: "l", label: "Low-carbon", color: "#4cc38a", values: toVals(S("low_carbon_share_elec")) },
            { key: "c", label: "Coal", color: P.commodity.coal, values: toVals(S("coal_share_elec")) },
          ], yFormat: (v) => `${num(v, 0)}`, height: 120, yMin: 0 }));
      }
      if (S("co2_mt")) {
        charts.push(el("div", { class: "label", style: "margin-top:12px" }, "CO₂ from energy (Mt)"), lineChart({
          series: [{ key: "co2", label: "CO₂", color: P.status.high_risk, values: toVals(S("co2_mt")), area: true }],
          yFormat: (v) => int(v), height: 110 }));
      }
      wrap.replaceChildren(...(charts.length ? charts : [el("p", { class: "note" }, "No history available.")]));
    });
    return section("Trends", "2000–2025", wrap);
  }

  countrySources(iso) {
    const { db } = this.app;
    const srcs = new Set();
    for (const m of ["oil_cons_kbd", "gas_cons_bcm", "tes_ej", "elec_twh"]) {
      const d = latestValue(db, m, iso);
      if (d) srcs.add(`${SRC_LABEL[d.src] || d.src} (${d.year})`);
    }
    const flows = [...(db.byCountry.get(iso)?.imp || []), ...(db.byCountry.get(iso)?.exp || [])];
    const years = [...new Set(flows.map((f) => f.y))].sort();
    const mirror = flows.some((f) => f.s.includes("partner"));
    return `Balances: ${[...srcs].join(", ") || "n/a"}. Trade: UN Comtrade ${years.join("/") || ""}${mirror ? " (partly reconstructed from partners' declarations)" : ""}; gas from Energy Institute 2025 trade matrices.`;
  }

  // ------------------------------------------------------------------ trade partner
  pairTrade(iso, partner) {
    const { db, state } = this.app;
    if (!db.byIso.has(iso) || !db.byIso.has(partner) || iso === partner) return this.country(iso);
    const nameA = countryName(db, iso);
    const nameB = countryName(db, partner);
    this.headBlock({
      kicker: `Trade partner of ${escapeHtml(nameA)}`,
      title: `${flag(db, iso)} ${escapeHtml(nameA)} <span class="dim" style="font-weight:500">⇄</span> ${flag(db, partner)} ${escapeHtml(nameB)}`,
      sub: "Recorded energy & rare earth trade, both directions",
      actions: [
        el("button", { class: "icon-btn", title: `Back to ${nameA}`, "aria-label": `Back to ${nameA}`, html: icon("back"),
          onclick: () => this.app.closePartner() }),
        this.closeBtn(),
      ],
    });
    const trade = bilateral(db, iso, partner);
    const P = palette();
    const list = (dir) => barList(trade[dir].map((r) => ({
      ...r,
      flag: `<span class="swatch" style="background:${P.commodity[r.c]}"></span>`,
      name: COMMODITY_META[r.c].label, value: r.share, share: null, label: fmt(r.v, COMMODITY_META[r.c].unit), color: P.commodity[r.c],
      sub: dir === "imp" ? `${pct(r.share)} of ${possessive(nameA)} imports · ${pct(r.partnerShare)} of ${possessive(nameB)} exports`
        : `${pct(r.share)} of ${possessive(nameA)} exports · ${pct(r.partnerShare)} of ${possessive(nameB)} imports`,
      active: state.lens === "flows" && matchesCommodity(r, state.commodity),
    })), {
      max: 100,
      // Rows switch the map to that commodity, so the trade is drawn between the two countries.
      onClick: (r) => {
        this.app.highlightIds = null; // the hovered row is re-rendered, so its mouseleave never fires
        this.app.store.set({ lens: "flows", commodity: r.c });
        this.app.focusPartner();
      },
      onHover: (r) => this.app.highlightFlows(r?.active ? r.flows.map((f) => f.id) : null),
      empty: dir === "imp" ? `No recorded imports from ${nameB}.` : `No recorded exports to ${nameB}.`,
    });
    const years = (dir) => flowYears(trade[dir].flatMap((r) => r.flows));
    this.body.append(
      section(`${escapeHtml(nameA)} imports from ${escapeHtml(nameB)}`, trade.imp.length ? years("imp") : "", list("imp")),
      section(`${escapeHtml(nameA)} exports to ${escapeHtml(nameB)}`, trade.exp.length ? years("exp") : "", list("exp")),
      section("", "", el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
        el("button", { class: "btn", onclick: () => this.app.openTrade(iso, partner) }, "See exact products in both directions"),
        el("button", { class: "btn", onclick: () => this.app.select({ type: "country", id: partner }) }, `${flag(db, partner)} Go to ${nameB}`))),
      section("", "", this.sourceNote(`Click a commodity to show it on the map. Percentages compare this trade with each country's total recorded
        trade in that commodity. Sources: UN Comtrade customs declarations; gas from Energy Institute 2025 trade matrices.`)));
  }

  // ------------------------------------------------------------------ flow
  flow(id) {
    const { db } = this.app;
    const f = db.flowById.get(id);
    if (!f) return this.overview();
    const meta = COMMODITY_META[f.c];
    const siblings = db.flows.filter((g) => g.f === f.f && g.t === f.t && g.c === f.c);
    const total = siblings.reduce((s, g) => s + g.v, 0);
    const P = palette();
    this.headBlock({
      kicker: `<span class="swatch" style="background:${P.commodity[f.c]};margin-right:6px"></span>${meta.label} · ${flowYears(siblings)}`,
      title: `${flag(db, f.f)} ${escapeHtml(countryName(db, f.f))} <span class="dim" style="font-weight:500">→</span> ${flag(db, f.t)} ${escapeHtml(countryName(db, f.t))}`,
      sub: `${escapeHtml(sourceLabel(db, f))}${f.est ? " · partly estimated from trade value" : ""}${f.weight_estimated ? " · includes source-estimated weight" : ""}`,
      actions: [this.closeBtn()],
    });
    const expTot = (db.byCountry.get(f.f)?.exp || []).filter((g) => g.c === f.c).reduce((s, g) => s + g.v, 0);
    const impTot = (db.byCountry.get(f.t)?.imp || []).filter((g) => g.c === f.c).reduce((s, g) => s + g.v, 0);
    const alt = f.c === "rare_earths" ? "Product weight · not contained REO" : meta.unit === "bcm" ? `${num(bcmToBcfd(total), 2)} Bcf/d` : `${num(toEJ(total, f.c), 2)} EJ/yr`;
    this.body.append(section("Volume", "", el("div", { class: "kpis" },
      this.kpi("Annual flow", fmt(total, meta.unit), "", alt),
      this.kpi("Share of recorded exports", pct(expTot ? (100 * total) / expTot : null), "", `of ${fmt(expTot, meta.unit)}`),
      this.kpi("Share of recorded imports", pct(impTot ? (100 * total) / impTot : null), "", `of ${fmt(impTot, meta.unit)}`),
      this.kpi("Transport", f.mode === "sea" ? "Seaborne" : f.mode === "pipeline" ? "Pipeline" : "Overland", "", f.mode === "sea" ? `${int(f.nm)} nm · ~${days(f.days)}` : f.nm ? `~${int(f.nm * 1.852)} km` : ""))));
    this.body.append(section("Product detail", "latest official reports", el("button", { class: "btn", onclick: () => this.app.openTrade(f.f, f.t) }, "See exact products in both directions")));

    if (f.c === "rare_earths") {
      this.body.append(section("Trade coverage", `HS ${(f.hs || []).join(" · ")}`,
        this.sourceNote(escapeHtml(db.flowCoverage.rare_earths?.scope || "")),
        this.sourceNote("Shares use recorded trade only. Missing reports and missing weights mean coverage is incomplete.")));
    }

    const disrupted = siblings.filter((g) => g.cp?.some((cp) => db.cpById.get(cp)?.status === "closed"));
    if (disrupted.length) {
      const v = disrupted.reduce((s, g) => s + g.v, 0);
      this.body.append(section("", "", el("div", { class: "callout alert" },
        el("div", { class: "callout-title", html: `<span class="badge closed"><span class="dot"></span>Disrupted in 2026</span>` }),
        el("p", { html: `${disrupted.length === siblings.length ? "This route" : `${pct((100 * v) / total)} of this trade (${fmt(v, meta.unit)})`} passes through the Strait of Hormuz, effectively closed since March 2026.` }))));
    }
    const routeBlocks = siblings.map((g) => {
      const cps = (g.cp || []).map((cp) => {
        const c = db.cpById.get(cp);
        return c ? `<button class="badge ${c.status}" data-cp="${cp}"><span class="dot"></span>${escapeHtml(c.name)}</button>` : "";
      }).filter(Boolean).join(" ");
      const through = g.transit ? ` through ${g.transit.map((iso) => escapeHtml(countryName(db, iso))).join(" and ")}` : "";
      const via = g.via ? `${escapeHtml(g.via[0])} → ${escapeHtml(g.via[1])}` : g.corridor ? escapeHtml(g.corridor) : `${g.mode === "pipeline" ? "Pipeline" : "Rail, road or barge"}${through}`;
      return el("div", { class: "callout", style: "margin-bottom:8px" },
        el("div", { class: "callout-title", html: `${siblings.length > 1 ? `${pct(100 * (g.v / total))} · ` : ""}${via}` }),
        el("p", { html: `${g.mode === "sea" ? `${int(g.nm)} nautical miles · ~${days(g.days)} at sea` : g.mode === "pipeline" ? "Pipeline" : "Overland"}${cps ? `<br><span style="display:inline-flex;gap:4px;flex-wrap:wrap;margin-top:6px">${cps}</span>` : ""}` }));
    });
    const routeSec = section("Route", siblings.length > 1 ? "cargoes split by loading terminal" : "", ...routeBlocks);
    routeSec.querySelectorAll("[data-cp]").forEach((b) => b.addEventListener("click", () =>
      this.app.select({ type: "chokepoint", id: b.dataset.cp }, { lens: "chokepoints" })));
    this.body.append(routeSec);
    if (f.note) this.body.append(section("Note", "", el("p", { class: "note", style: "font-size:12.5px" }, f.note)));
    this.body.append(section("", "", el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
      el("button", { class: "btn", onclick: () => this.app.select({ type: "country", id: f.f }) }, `${flag(db, f.f)} ${countryName(db, f.f)}`),
      el("button", { class: "btn", onclick: () => this.app.select({ type: "country", id: f.t }) }, `${flag(db, f.t)} ${countryName(db, f.t)}`))),
      section("", "", this.sourceNote(`Customs records do not state how goods moved. Routes are modelled on a sea-lane network (shortest path with
        2025 Red Sea avoidance), with overland trade only across borders that carry freight, and are schematic.
        ${f.c === "rare_earths" ? "Rare earths are shown in tonnes of traded product." : "Volumes are converted from customs weights using grade-specific barrels per tonne."}
        <a href="#" data-about>Methods</a>.`)));
    this.body.querySelector("[data-about]")?.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.openAbout();
    });
  }

  // ------------------------------------------------------------------ chokepoint
  chokepoint(id) {
    const { db } = this.app;
    const cp = db.cpById.get(id);
    if (!cp) return this.overview();
    const P = palette();
    this.headBlock({
      kicker: "Maritime chokepoint",
      title: escapeHtml(cp.name),
      sub: `<span class="badge ${cp.status}"><span class="dot"></span>${escapeHtml(cp.status_label || STATUS_LABEL[cp.status])}</span> <span class="dim">as of ${dateLabel(db.asOf)}</span>`,
      actions: [this.closeBtn()],
    });
    this.body.append(section("Status", "", el("p", { style: "margin:0;color:var(--text-2)", html: escapeHtml(cp.status_note) })));

    const pw = db.portwatch[cp.portwatch];
    if (pw) {
      const stats = portwatchStats(pw);
      const start = new Date(`${pw.start}T00:00:00Z`);
      const roll = rolling(pw.tanker, 7);
      const rollAll = rolling(pw.total, 7);
      const vals = roll.map((v, i) => ({ x: new Date(+start + i * 864e5), y: v }));
      const valsAll = rollAll.map((v, i) => ({ x: new Date(+start + i * 864e5), y: v }));
      const ann = [];
      if (["bab_el_mandeb", "suez", "cape_good_hope"].includes(id)) ann.push({ x: new Date("2023-11-19T00:00:00Z"), label: "Houthi attacks", color: P.status.high_risk });
      if (["hormuz", "malacca"].includes(id)) ann.push({ x: new Date("2026-02-28T00:00:00Z"), label: "Iran war", color: P.status.closed });
      const change = stats.avg2025 ? (100 * (stats.last7 - stats.avg2025)) / stats.avg2025 : null;
      this.body.append(section("Daily transits", `IMF PortWatch · to ${dateLabel(pw.end)}`,
        el("div", { class: "kpis", style: "margin-bottom:10px" },
          this.kpi("Tankers, last 7 days", num(stats.last7, 1), "/day", change != null ? `<span class="${change < 0 ? "delta-down" : "delta-up"}">${signed(change, (v) => num(v, 0))}%</span> vs 2025 avg` : ""),
          this.kpi("2025 average", num(stats.avg2025, 1), "/day", `all vessels ${num(stats.avg2025All, 0)}/day`)),
        lineChart({
          title: "Tanker transits per day",
          series: [
            { key: "t", label: "Tankers (7-day avg)", color: P.status[cp.status] === P.status.open ? P.commodity.lng : P.status[cp.status], values: vals, area: true },
            { key: "a", label: "All vessels", color: P.text3, values: valsAll, width: 1.2 },
          ],
          xType: "date", yFormat: (v) => num(v, 0), height: 150, yMin: 0, annotations: ann,
        })));
    }

    if (cp.oil) {
      const years = Object.keys(cp.oil);
      const lab = (y) => (y === "2025h1" ? "1H25" : y);
      const rows = years.map((y) => el("div", { class: "stat-line" },
        el("span", { class: "k" }, lab(y)),
        el("span", { class: "v", html: `${num(cp.oil[y], 1)} mb/d oil${cp.lng?.[y] != null ? ` · <span class="dim">${num(cp.lng[y], 1)} Bcf/d LNG</span>` : ""}` })));
      this.body.append(section("Volumes before the crisis", "EIA", ...rows, el("p", { class: "note", style: "margin-top:8px" }, cp.share_note || "")));
    }

    const routed = cp.routed || {};
    const tot = (routed.crude || 0) + (routed.products || 0);
    if (tot || routed.lng) {
      const exposed = exposureByImporter(db, id).slice(0, 10);
      this.body.append(section("2025 trade through this route", "routed customs data",
        el("div", { class: "kpis", style: "margin-bottom:10px" },
          this.kpi("Crude + products", oil(tot), "", `crude ${oil(routed.crude || 0)}`),
          this.kpi("LNG", fmt(routed.lng || 0, "bcm"), "", routed.coal ? `coal ${fmt(routed.coal, "Mt")}` : "")),
        coverageNote(chokepointCoverage(cp)),
        el("div", { class: "label" }, "Most dependent importers (oil)"),
        barList(exposed.map((r) => ({ iso: r.iso, flag: flag(db, r.iso), name: countryName(db, r.iso), value: r.v, label: oil(r.v), color: P.commodity.crude })),
          { onClick: (r) => this.app.select({ type: "country", id: r.iso }) })));
    }
    if (cp.bypass) {
      this.body.append(section("Bypass options", "", ...cp.bypass.map((b) => el("div", { class: "stat-line" },
        el("span", { class: "k", html: `${escapeHtml(b.name)}<br><span class="dim" style="font-size:11px">${escapeHtml(b.note || "")}</span>` }),
        el("span", { class: "v" }, `${num(b.capacity_mbd, 1)} mb/d`))),
      el("p", { class: "note", style: "margin-top:8px" }, "Combined bypass capacity is roughly a third of pre-war Hormuz oil flows, and there is no pipeline alternative for Qatar's LNG.")));
    }
    this.body.append(section("Sources", "", el("div", { class: "note", html: cp.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>`).join("<br>") })));
  }

  // ------------------------------------------------------------------ compare
  compare(a, b) {
    const { db } = this.app;
    const A = db.byIso.get(a);
    const B = db.byIso.get(b);
    this.headBlock({
      kicker: "Compare",
      title: `${A.flag} ${escapeHtml(A.name)} <span class="dim" style="font-weight:500">vs</span> ${B.flag} ${escapeHtml(B.name)}`,
      sub: "Latest available year for each metric",
      actions: [el("button", { class: "icon-btn", title: "Stop comparing", html: icon("back"), onclick: () => this.app.store.set({ compare: null }) }), this.closeBtn()],
    });
    this.body.append(section("Bilateral trade", "energy & rare earths", el("button", { class: "btn", onclick: () => this.app.openTrade(a, b) }, "See products traded in both directions")));
    const metrics = ["oil_prod_kbd", "oil_cons_kbd", "net_oil_kbd", "gas_prod_bcm", "gas_cons_bcm", "coal_cons_ej", "tes_ej",
      "tes_pc_gj", "elec_twh", "low_carbon_share_elec", "solar_wind_share_elec", "co2_mt", "co2_pc_t", "oil_import_dep",
      "gas_import_dep", "hormuz_oil_share", "hormuz_lng_share"];
    const rows = metrics.map((m) => {
      const meta = db.meta.metrics[m];
      const va = latestValue(db, m, a)?.v;
      const vb = latestValue(db, m, b)?.v;
      if (va == null && vb == null) return null;
      const max = Math.max(Math.abs(va || 0), Math.abs(vb || 0)) || 1;
      return el("div", { class: "cmp-row" },
        el("div", { class: "l", html: `${fmt(va, meta.unit)}<div class="cmp-bar"><i style="width:${(100 * Math.abs(va || 0)) / max}%"></i></div>` }),
        el("div", { class: "m" }, meta.label),
        el("div", { class: "r", html: `${fmt(vb, meta.unit)}<div class="cmp-bar"><i style="width:${(100 * Math.abs(vb || 0)) / max}%;margin-left:auto"></i></div>` }));
    }).filter(Boolean);
    this.body.append(section("Side by side", "", ...rows));
    const trade = mergeParts(db.flows.filter((f) => matchesCommodity(f, "all") && ((f.f === a && f.t === b) || (f.f === b && f.t === a))));
    const P = palette();
    this.body.append(section("Direct trade between them", "2025", trade.length
      ? barList(trade.map((f) => ({ flag: flag(db, f.f), name: `${countryName(db, f.f)} → ${countryName(db, f.t)} · ${COMMODITY_META[f.c].short}`,
        value: toEJ(f.v, f.c), label: fmt(f.v, COMMODITY_META[f.c].unit), color: P.commodity[f.c] })))
      : el("p", { class: "note" }, "No direct energy trade recorded.")));
  }
}

// ---------------------------------------------------------------------------------------
function sourceLabel(db, f) {
  if (f.c === "rare_earths") return `UN Comtrade · ${flowYears([f])} · ${f.s.includes("partner") ? "includes partner-reported exports" : "importer declarations"}`;
  if (f.s === "EI") return "Energy Institute 2025 gas trade matrix";
  if (f.s.includes("partner")) return `UN Comtrade · ${countryName(db, f.f)}'s export declaration (${countryName(db, f.t)} does not report)`;
  if (f.s === "Comtrade") return `UN Comtrade · ${countryName(db, f.t)}'s ${f.y} import declaration`;
  return f.s;
}

/** How the routed customs flows compare with EIA's estimate for a chokepoint, or null without one. */
function coverageNote(cov) {
  if (!cov?.oil) return null;
  const period = cov.period === "2025h1" ? "1H25" : "2025";
  const part = (c, what, unit) => `<b>${pct(c.pct)}</b> of EIA's ${num(c.eia, 1)} ${unit} ${what} estimate`;
  const parts = [part(cov.oil, "oil", "mb/d"), cov.lng ? part(cov.lng, "LNG", "Bcf/d") : null].filter(Boolean);
  const short = cov.oil.pct < 95 || (cov.lng && cov.lng.pct < 95);
  return el("p", { class: "note", style: "margin:0 0 10px", html: `The routed flows below account for ${parts.join(" and ")} (${period}).
    ${short ? "The gap is trade that customs records miss, such as unreported or relabelled cargoes, or that the model routes another way." : ""}
    ${cov.oil.pct > 105 || cov.lng?.pct > 105 ? "Above 100% means the model routes some cargo this way that EIA counts elsewhere." : ""}` });
}

const days = (d) => (Math.round(d) <= 1 ? "1 day" : `${num(d, 0)} days`);
const possessive = (name) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

function statLine(k, v) {
  return el("div", { class: "stat-line" }, el("span", { class: "k", html: k }), el("span", { class: "v", html: v }));
}

export function portwatchStats(pw) {
  const start = Date.parse(`${pw.start}T00:00:00Z`);
  const idx2025 = pw.tanker.map((v, i) => [v, new Date(start + i * 864e5).getUTCFullYear(), pw.total[i]]).filter((d) => d[1] === 2025);
  const avg2025 = d3.mean(idx2025, (d) => d[0]) || 0;
  const avg2025All = d3.mean(idx2025, (d) => d[2]) || 0;
  const last7 = d3.mean(pw.tanker.slice(-7)) || 0;
  return { avg2025, avg2025All, last7 };
}

function rolling(arr, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i] || 0;
    if (i >= n) sum -= arr[i - n] || 0;
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

function monthsFrom(series) {
  const [y, m] = series.start.split("-").map(Number);
  return series.values.map((_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
function monthlyAt(series, ym) {
  if (!series) return null;
  const months = monthsFrom(series);
  const i = months.indexOf(ym);
  return i >= 0 ? series.values[i] : null;
}
function lastMonth(series) {
  const months = monthsFrom(series);
  return months[months.length - 1];
}
const ymDate = (ym) => new Date(`${ym}-01T00:00:00Z`);
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
