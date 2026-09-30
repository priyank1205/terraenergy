// Number and unit formatting. Pure functions — unit-tested in tests/format.test.js.

const nf = (digits) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const NF = [0, 1, 2, 3].map(nf);

/** Format with a sensible number of decimals for the magnitude. */
export function num(v, maxDigits = 3) {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  let d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  if (a > 0 && a < 0.1) d = 3;
  d = Math.min(d, maxDigits);
  const out = NF[d].format(v);
  return /^-0(\.0+)?$/.test(out) ? out.slice(1) : out; // no "negative zero"
}

/** Integer with thousands separators. */
export const int = (v) => (v == null || !Number.isFinite(v) ? "–" : NF[0].format(Math.round(v)));

export function pct(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return "–";
  if (v > 0 && v < 1 && digits === 0) return "<1%";
  return `${NF[digits].format(v)}%`;
}

export function signed(v, fmtFn = num) {
  if (v == null || !Number.isFinite(v)) return "–";
  const s = fmtFn(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/** Oil volumes arrive in thousand barrels a day; switch to million b/d when large. */
export function oil(kbd, { unit = true } = {}) {
  if (kbd == null || !Number.isFinite(kbd)) return "–";
  const a = Math.abs(kbd);
  if (a >= 1000) return `${num(kbd / 1000, a >= 10000 ? 1 : 2)}${unit ? " mb/d" : ""}`;
  return `${a >= 10 ? int(kbd) : num(kbd, 1)}${unit ? " kb/d" : ""}`;
}

const UNIT_FORMATTERS = {
  "kb/d": (v) => oil(v),
  bcm: (v) => `${num(v, 2)} bcm`,
  Mt: (v) => `${num(v, 1)} Mt`,
  EJ: (v) => `${num(v, 2)} EJ`,
  TWh: (v) => `${Math.abs(v) >= 100 ? int(v) : num(v, 1)} TWh`,
  GW: (v) => `${num(v, 1)} GW`,
  GJ: (v) => `${int(v)} GJ`,
  t: (v) => `${num(v, 1)} t`,
  "%": (v) => pct(v),
  "gCO₂/kWh": (v) => `${int(v)} g/kWh`,
};

/** Format a value with its unit string, e.g. fmt(1609, "kb/d") → "1.61 mb/d". */
export function fmt(v, unit) {
  if (v == null || !Number.isFinite(v)) return "–";
  const f = UNIT_FORMATTERS[unit];
  return f ? f(v) : `${num(v)} ${unit || ""}`.trim();
}

/** Compact axis ticks: 12,500 → 12.5k. */
export function compact(v) {
  if (v == null || !Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${num(v / 1e9, 1)}B`;
  if (a >= 1e6) return `${num(v / 1e6, 1)}M`;
  if (a >= 1e3) return `${num(v / 1e3, a >= 1e4 ? 0 : 1)}k`;
  return num(v, a < 10 ? 1 : 0);
}

// ---------------------------------------------------------------------------------------
// Energy-equivalent conversions so different commodities can share one scale.
// Sources: Energy Institute "Approximate conversion factors".
// ---------------------------------------------------------------------------------------
export const TO_EJ = {
  crude: 365e3 * 5.73e-9, // kb/d → EJ/yr (1 bbl ≈ 5.73 GJ)
  products: 365e3 * 5.6e-9,
  lng: 0.036, // bcm → EJ (≈36 PJ per bcm, net calorific)
  pipeline_gas: 0.036,
  coal: 0.0245, // Mt → EJ (world-average hard coal ≈ 24.5 GJ/t)
};
export const toEJ = (value, commodity) => value * (TO_EJ[commodity] ?? 0);

/** bcm per year → billion cubic feet per day. */
export const bcmToBcfd = (bcm) => (bcm * 35.3147) / 365;

export function dateLabel(iso, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}


export function daysBetween(aIso, bIso) {
  return Math.round((Date.parse(`${bIso}T00:00:00Z`) - Date.parse(`${aIso}T00:00:00Z`)) / 864e5);
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
