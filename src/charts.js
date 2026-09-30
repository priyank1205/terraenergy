// Small, dependency-light SVG charts rendered with d3 scales. Each returns a DOM node.
/* global d3 */

import { escapeHtml } from "./format.js";

let uid = 0;

/**
 * Multi-series line (or area) chart with hover readout.
 * series: [{ key, label, color, values: [{x: Date|number, y}] , dash?, area? }]
 */
export function lineChart({ series, height = 150, yFormat = String, xType = "year", annotations = [], yMin = null,
                            title = "", zeroLine = false, readout = true }) {
  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  const width = 360;
  const m = { t: 10, r: 8, b: 20, l: 38 };
  const all = series.flatMap((s) => s.values.filter((d) => d.y != null));
  if (!all.length) {
    wrap.innerHTML = `<div class="note">No data available.</div>`;
    return wrap;
  }
  const x = (xType === "date" ? d3.scaleUtc() : d3.scaleLinear())
    .domain(d3.extent(all, (d) => d.x))
    .range([m.l, width - m.r]);
  const [lo, hi] = d3.extent(all, (d) => d.y);
  const y = d3.scaleLinear()
    .domain([yMin ?? Math.min(0, lo), hi === lo ? hi + 1 : hi])
    .nice(4)
    .range([height - m.b, m.t]);
  const id = `c${++uid}`;
  const line = d3.line().defined((d) => d.y != null).x((d) => x(d.x)).y((d) => y(d.y)).curve(d3.curveMonotoneX);
  const area = d3.area().defined((d) => d.y != null).x((d) => x(d.x)).y0(y(Math.max(0, y.domain()[0]))).y1((d) => y(d.y)).curve(d3.curveMonotoneX);
  const xticks = xType === "date" ? x.ticks(5) : x.ticks(Math.min(6, all.length)).filter(Number.isInteger);
  const xfmt = xType === "date" ? d3.utcFormat("%b %y") : d3.format("d");
  let svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">`;
  svg += `<g class="grid">${y.ticks(4).map((t) => `<line x1="${m.l}" x2="${width - m.r}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>`;
  svg += `<g class="axis">${y.ticks(4).map((t) => `<text x="${m.l - 6}" y="${y(t) + 3.5}" text-anchor="end">${yFormat(t)}</text>`).join("")}`;
  svg += xticks.map((t) => `<text x="${x(t)}" y="${height - 5}" text-anchor="middle">${xfmt(t)}</text>`).join("");
  svg += `</g>`;
  if (zeroLine && y.domain()[0] < 0) svg += `<line class="zero" x1="${m.l}" x2="${width - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  for (const a of annotations) {
    const ax = x(a.x);
    if (ax < m.l || ax > width - m.r) continue;
    svg += `<line x1="${ax}" x2="${ax}" y1="${m.t}" y2="${height - m.b}" stroke="${a.color || "var(--text-3)"}" stroke-dasharray="3 3" stroke-width="1"/>`;
    svg += `<text x="${ax + 3}" y="${m.t + 9}" style="fill:${a.color || "var(--text-3)"};font-weight:600">${escapeHtml(a.label)}</text>`;
  }
  series.forEach((s, i) => {
    if (s.area) {
      svg += `<defs><linearGradient id="${id}g${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0.02"/></linearGradient></defs>`;
      svg += `<path d="${area(s.values)}" fill="url(#${id}g${i})"/>`;
    }
    svg += `<path d="${line(s.values)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.8}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  svg += `<line class="hover-rule" x1="0" x2="0" y1="${m.t}" y2="${height - m.b}" stroke="var(--text-3)" stroke-width="1" opacity="0"/>`;
  svg += series.map((s, i) => `<circle class="hover-dot" data-i="${i}" r="3" fill="${s.color}" stroke="var(--panel-solid)" stroke-width="1.5" opacity="0"/>`).join("");
  svg += `<rect class="hit" x="${m.l}" y="0" width="${width - m.l - m.r}" height="${height}" fill="transparent"/>`;
  svg += `</svg>`;
  wrap.innerHTML = svg + (readout ? `<div class="chart-legend"></div>` : "");
  const legend = wrap.querySelector(".chart-legend");
  const baseLegend = series.map((s) => `<span><i class="swatch line" style="background:${s.color}"></i>${escapeHtml(s.label)}</span>`).join("");
  if (legend) legend.innerHTML = baseLegend;
  const el = wrap.querySelector("svg");
  const rule = el.querySelector(".hover-rule");
  const dots = el.querySelectorAll(".hover-dot");
  el.querySelector(".hit").addEventListener("pointermove", (ev) => {
    const pt = el.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const loc = pt.matrixTransform(el.getScreenCTM().inverse());
    const xv = x.invert(loc.x);
    const parts = [];
    series.forEach((s, i) => {
      const vals = s.values.filter((d) => d.y != null);
      if (!vals.length) return;
      const idx = d3.bisector((d) => d.x).center(vals, xv);
      const d = vals[idx];
      dots[i].setAttribute("cx", x(d.x));
      dots[i].setAttribute("cy", y(d.y));
      dots[i].setAttribute("opacity", 1);
      parts.push({ s, d });
    });
    if (!parts.length) return;
    rule.setAttribute("x1", x(parts[0].d.x));
    rule.setAttribute("x2", x(parts[0].d.x));
    rule.setAttribute("opacity", 0.6);
    if (legend) {
      const when = xType === "date" ? d3.utcFormat("%d %b %Y")(parts[0].d.x) : parts[0].d.x;
      legend.innerHTML = `<span class="dim">${when}</span>` + parts.map(({ s, d }) =>
        `<span><i class="swatch line" style="background:${s.color}"></i>${escapeHtml(s.label)} <b class="num">${yFormat(d.y)}</b></span>`).join("");
    }
  });
  el.querySelector(".hit").addEventListener("pointerleave", () => {
    rule.setAttribute("opacity", 0);
    dots.forEach((d) => d.setAttribute("opacity", 0));
    if (legend) legend.innerHTML = baseLegend;
  });
  return wrap;
}

/** Horizontal ranked bars. rows: [{ key, flag, name, value, label, share?, sub?, active?, color? }] */
export function barList(rows, { max = null, onClick = null, onHover = null, color = "var(--accent)", empty = "No data." } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "bars";
  if (!rows.length) {
    wrap.innerHTML = `<div class="note">${escapeHtml(empty)}</div>`;
    return wrap;
  }
  const top = max ?? Math.max(...rows.map((r) => Math.abs(r.value)));
  for (const r of rows) {
    const b = document.createElement(onClick ? "button" : "div");
    b.className = `bar-row${r.active ? " active" : ""}`;
    if (onClick && r.active != null) b.setAttribute("aria-pressed", String(!!r.active));
    b.style.setProperty("--bar-c", r.color || color);
    b.innerHTML = `<span class="flag">${r.flag || ""}</span><span class="name">${escapeHtml(r.name)}</span>`
      + `<span class="val"><b>${escapeHtml(r.label)}</b>${r.share != null ? ` · ${r.share < 1 ? "<1" : Math.round(r.share)}%` : ""}</span>`
      + `<span class="track"><i style="width:${Math.max(1.5, (100 * Math.abs(r.value)) / (top || 1))}%"></i></span>`
      + (r.sub ? `<span class="sub">${escapeHtml(r.sub)}</span>` : "");
    if (onClick) b.addEventListener("click", () => onClick(r));
    if (onHover) {
      b.addEventListener("mouseenter", () => onHover(r));
      b.addEventListener("mouseleave", () => onHover(null));
    }
    wrap.append(b);
  }
  return wrap;
}

/** 100% stacked bar with legend. parts: [{ label, value, color }] */
export function mixBar(parts, { format = (v) => v, unit = "" } = {}) {
  const wrap = document.createElement("div");
  const total = parts.reduce((s, p) => s + (p.value || 0), 0);
  if (!total) {
    wrap.innerHTML = `<div class="note">No data available.</div>`;
    return wrap;
  }
  const visible = parts.filter((p) => p.value > 0);
  wrap.innerHTML = `<div class="mix" role="img" aria-label="${visible.map((p) => `${p.label} ${Math.round((100 * p.value) / total)}%`).join(", ")}">`
    + visible.map((p) => `<i title="${escapeHtml(p.label)}: ${format(p.value)} ${unit}" style="width:${(100 * p.value) / total}%;background:${p.color}"></i>`).join("")
    + `</div><div class="mix-legend">`
    + visible.map((p) => `<span><i class="swatch" style="background:${p.color}"></i>${escapeHtml(p.label)} <b>${Math.round((100 * p.value) / total) || "<1"}%</b></span>`).join("")
    + `</div>`;
  return wrap;
}
