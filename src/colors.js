// Colour system: theme-aware commodity/status colours and choropleth scales.
/* global d3 */

const css = () => getComputedStyle(document.documentElement);
let cache = null;

export function refreshPalette() {
  const s = css();
  const v = (name) => s.getPropertyValue(name).trim();
  cache = {
    theme: document.documentElement.dataset.theme,
    commodity: {
      crude: v("--c-crude"), products: v("--c-products"), lng: v("--c-lng"),
      pipeline_gas: v("--c-pipeline_gas"), coal: v("--c-coal"), rare_earths: v("--c-rare_earths"), oil: v("--c-oil"), gas: v("--c-gas"),
    },
    status: { closed: v("--s-closed"), high_risk: v("--s-high_risk"), restricted: v("--s-restricted"), open: v("--s-open") },
    ocean: v("--ocean"), land: v("--land"), landHover: v("--land-hover"), landMuted: v("--land-muted"),
    border: v("--border-land"), graticule: v("--graticule"), text: v("--text"), text2: v("--text-2"),
    text3: v("--text-3"), bg: v("--bg"), accent: v("--accent"), panel: v("--panel-solid"),
  };
  return cache;
}
export const palette = () => cache || refreshPalette();

// Colour ramps per metric group. Chosen for perceptual ordering and colour-vision safety.
const RAMPS = {
  supply: () => d3.interpolateYlOrBr,
  demand: () => d3.interpolatePuBu,
  security: () => d3.interpolateOrRd,
  power: () => d3.interpolateYlGn,
  emissions: () => d3.interpolateYlOrRd,
};
const SPECIAL = {
  coal_share_elec: () => d3.interpolateOrRd,
  carbon_intensity: () => d3.interpolateYlOrRd,
  hormuz_oil_share: () => d3.interpolateOrRd,
  hormuz_lng_share: () => d3.interpolateOrRd,
};

function trimRamp(interp, dark) {
  // Skip the palest end on light backgrounds (white land) and the darkest on dark ones.
  return dark ? (t) => interp(0.12 + 0.88 * t) : (t) => interp(0.18 + 0.82 * t);
}

/**
 * Build a scale for a metric given the values currently shown.
 * Returns { color(v), legend: { type, stops, ticks, labels } }.
 */
export function metricScale(meta, values) {
  const dark = palette().theme !== "light";
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  if (meta.scale === "div") {
    const ext = d3.max(vals, (v) => Math.abs(v)) || 1;
    const interp = d3.interpolateBrBG;
    const scale = d3.scaleDivergingSymlog([-ext, 0, ext], (t) => interp(dark ? 0.06 + 0.88 * t : 0.04 + 0.92 * t))
      .constant(Math.max(1, ext / 200));
    const ticks = [-ext, -ext / 10, 0, ext / 10, ext];
    return {
      color: (v) => (v == null ? null : scale(v)),
      legend: { type: "ramp", stops: d3.range(0, 1.001, 0.1).map((t) => scale.interpolator()(t)), ticks,
                left: "Net importer", right: "Net exporter" },
    };
  }
  const interp = trimRamp((SPECIAL[meta.key] || RAMPS[meta.group] || RAMPS.demand)(), dark);
  if (meta.unit === "%") {
    const scale = d3.scaleSequential([0, 100], interp);
    return {
      color: (v) => (v == null ? null : scale(v)),
      legend: { type: "ramp", stops: d3.range(0, 1.001, 0.1).map(interp), ticks: [0, 25, 50, 75, 100] },
    };
  }
  // Skewed volumes: quantile classes on positive values (7 bins) read far better than linear.
  const pos = vals.filter((v) => v > 0).sort(d3.ascending);
  const n = 7;
  const thresholds = d3.range(1, n).map((i) => d3.quantileSorted(pos, i / n)).filter((v, i, a) => i === 0 || v > a[i - 1]);
  const colors = d3.range(thresholds.length + 1).map((i) => interp(i / thresholds.length));
  const scale = d3.scaleThreshold(thresholds, colors);
  return {
    color: (v) => (v == null ? null : v <= 0 ? interp(0) : scale(v)),
    legend: { type: "steps", colors, thresholds, max: pos[pos.length - 1] },
  };
}

export function withAlpha(color, a) {
  const c = d3.color(color);
  if (!c) return color;
  c.opacity = a;
  return c.formatRgb();
}
