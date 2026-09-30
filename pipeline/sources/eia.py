"""
U.S. EIA International Energy Statistics (bulk INTL.zip).

Used for (1) countries the Energy Institute does not list individually, (2) population and
GDP, and (3) *monthly* liquids production through mid-2026 — the only open, country-level
series that already shows the 2026 Gulf supply shock.
"""

from __future__ import annotations

import json
import zipfile

QBTU_TO_EJ = 1.055056

# (product, activity, unit) -> (metric, scale)
ANNUAL = {
    ("57", "1", "TBPD"): ("crude_prod_kbd", 1.0),
    ("58", "1", "TBPD"): ("ngl_prod_kbd", 1.0),
    ("5", "2", "TBPD"): ("oil_cons_kbd", 1.0),
    ("26", "1", "BCM"): ("gas_prod_bcm", 1.0),
    ("26", "2", "BCM"): ("gas_cons_bcm", 1.0),
    ("7", "1", "MT"): ("coal_prod_mt", 1e-3),
    ("7", "2", "MT"): ("coal_cons_mt", 1e-3),
    ("7", "2", "QBTU"): ("coal_cons_ej", QBTU_TO_EJ),
    ("5", "2", "QBTU"): ("oil_cons_ej", QBTU_TO_EJ),
    ("26", "2", "QBTU"): ("gas_cons_ej", QBTU_TO_EJ),
    ("44", "2", "QBTU"): ("tes_ej", QBTU_TO_EJ),
    ("4008", "8", "MMTCD"): ("co2_mt", 1.0),
    ("2", "12", "BKWH"): ("elec_twh", 1.0),
    ("4702", "33", "THP"): ("population", 1e3),
    ("4701", "34", "BDOLPPP"): ("gdp_ppp_busd", 1.0),
}
MONTHLY = {("57", "1", "TBPD"): "crude_prod_kbd", ("53", "1", "TBPD"): "liquids_prod_kbd"}
MONTHLY_FROM = "202301"

# EIA geography codes that differ from ISO3.
GEO_FIX = {"WORL": "WORLD", "XKS": "XKX", "KOS": "XKX"}


def _to_float(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def load(zip_path, first_year: int = 2000) -> dict:
    annual: dict[str, dict[str, dict[int, float]]] = {}
    monthly: dict[str, dict[str, dict[str, float]]] = {}
    updated = None
    with zipfile.ZipFile(zip_path) as zf, zf.open(zf.namelist()[0]) as fh:
        for raw in fh:
            try:
                s = json.loads(raw)
            except ValueError:
                continue
            sid = s.get("series_id", "")
            if not sid.startswith("INTL."):
                continue
            try:
                prod, act, geo, unit = sid.split(".")[1].split("-")
            except ValueError:
                continue
            geo = GEO_FIX.get(geo, geo)
            key = (prod, act, unit)
            freq = s.get("f")
            if freq == "A" and key in ANNUAL:
                metric, scale = ANNUAL[key]
                series = annual.setdefault(metric, {}).setdefault(geo, {})
                for period, value in s.get("data", []):
                    y = int(period)
                    v = _to_float(value)
                    if y >= first_year and v is not None:
                        series[y] = v * scale
            elif freq == "M" and key in MONTHLY:
                metric = MONTHLY[key]
                series = monthly.setdefault(metric, {}).setdefault(geo, {})
                for period, value in s.get("data", []):
                    v = _to_float(value)
                    if period >= MONTHLY_FROM and v is not None:
                        series[f"{period[:4]}-{period[4:]}"] = v
                if geo == "WORLD":
                    updated = s.get("last_updated", updated)
    # Oil production on the EI definition: crude + condensate + NGLs.
    crude, ngl = annual.get("crude_prod_kbd", {}), annual.get("ngl_prod_kbd", {})
    annual["oil_prod_kbd"] = {
        geo: {y: v + ngl.get(geo, {}).get(y, 0.0) for y, v in ys.items()} for geo, ys in crude.items()
    }
    return {"annual": annual, "monthly": monthly, "last_updated": updated}
