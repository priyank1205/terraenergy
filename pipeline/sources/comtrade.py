"""
UN Comtrade bilateral trade (annual, HS 2022) → physical energy flows.

Importer declarations are preferred. For economies that do not report (Taiwan, Vietnam,
UAE, Bangladesh, …) we fall back to their partners' export declarations ("mirror" data),
after dropping implausible rows (e.g. Saudi Arabia books very large volumes to
"Other Asia, nes", Comtrade's label for Taiwan).
"""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path

from pipeline.lib.countries import COMTRADE_ISO_FIX, COUNTRIES

# HS code -> commodity key and barrels per tonne (EI 2025 implied factors)
HS = {
    "2709": ("crude", 7.33),
    "2710": ("products", 7.63),
    "2701": ("coal", None),
    "271121": ("pipeline_gas", None),
    "271111": ("lng", None),
}
MT_LNG_PER_BCM = 0.73  # EI conversion: 1 bcm natural gas ≈ 0.73 Mt LNG

# Typical API gravity of each exporter's crude slate. Barrels per tonne depend strongly on
# density (heavy Canadian or Venezuelan barrels ≈ 6.6–6.9 bbl/t, light CPC or WTI ≈ 7.7), so
# a single world-average factor would misstate volumes by up to ±10%.
CRUDE_API = {
    "CAN": 23, "VEN": 16, "MEX": 22, "COL": 24, "ECU": 23, "BRA": 28, "GUY": 32, "USA": 41, "TTO": 32,
    "ARG": 36, "SAU": 32, "IRQ": 29, "KWT": 30, "ARE": 38, "IRN": 31, "OMN": 33, "QAT": 40, "BHR": 34,
    "RUS": 31, "KAZ": 44, "AZE": 36, "NOR": 30, "GBR": 39, "NGA": 35, "AGO": 32, "LBY": 38, "DZA": 44,
    "EGY": 30, "GAB": 31, "COG": 30, "GNQ": 33, "CMR": 29, "GHA": 36, "SEN": 36, "TCD": 22, "SSD": 26,
    "SDN": 26, "MYS": 33, "IDN": 34, "BRN": 38, "AUS": 45, "CHN": 30, "YEM": 32, "NLD": 33, "TUR": 30,
}


def barrels_per_tonne(exporter: str) -> float:
    api = CRUDE_API.get(exporter)
    if api is None:
        return HS["2709"][1]
    return (api + 131.5) / (141.5 * 0.158987)


def _code_maps(cache: Path) -> tuple[dict[int, str], dict[int, str]]:
    partners = {}
    for r in json.loads((cache / "partners.json").read_text())["results"]:
        iso = r.get("PartnerCodeIsoAlpha3")
        iso = COMTRADE_ISO_FIX.get(iso, iso)
        if iso and iso in COUNTRIES:
            partners[int(r["id"])] = iso
    reporters = {}
    for r in json.loads((cache / "reporters.json").read_text())["results"]:
        iso = r.get("reporterCodeIsoAlpha3")
        if iso and iso in COUNTRIES:
            reporters.setdefault(int(r["id"]), iso)
    return partners, reporters


def _latest_file(cache: Path, prefix: str, iso: str) -> tuple[Path | None, int | None]:
    for year in (2025, 2024):
        p = cache / f"{prefix}_{iso}_{year}.json"
        if p.exists() and json.loads(p.read_text()).get("data"):
            return p, year
    return None, None


def _tonnes(row: dict) -> float | None:
    w = row.get("netWgt")
    if w:
        return w / 1e3
    if row.get("qtyUnitCode") == 8 and row.get("qty"):
        return row["qty"] / 1e3
    return None


def _records(rows: list[dict], importer_of, exporter_of, year: int, source: str) -> list[dict]:
    out = []
    # Unit values ($/t) per commodity from rows that do carry a weight, to estimate the rest.
    unit_values: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        t = _tonnes(r)
        if t and r.get("primaryValue"):
            unit_values[r["cmdCode"]].append(r["primaryValue"] / t)
    median_uv = {k: statistics.median(v) for k, v in unit_values.items() if v}
    for r in rows:
        code = r["cmdCode"]
        if code not in HS:
            continue
        imp, exp = importer_of(r), exporter_of(r)
        if not imp or not exp or imp == exp:
            continue
        t = _tonnes(r)
        estimated = False
        if not t and r.get("primaryValue") and median_uv.get(code):
            t = r["primaryValue"] / median_uv[code]
            estimated = True
        if not t or t <= 0:
            continue
        out.append({
            "importer": imp, "exporter": exp, "hs": code, "commodity": HS[code][0], "year": year,
            "tonnes": t, "usd": r.get("primaryValue") or 0.0, "source": source, "estimated": estimated,
            "weight_estimated": bool(r.get("isNetWgtEstimated") or (not r.get("netWgt") and r.get("isQtyEstimated"))),
        })
    return out


def load(cache_dir, importers: list[str], mirror_importers: list[str], lng_importers: list[str]) -> list[dict]:
    cache = Path(cache_dir)
    partners, reporters = _code_maps(cache)
    records: list[dict] = []

    for iso in importers:
        path, year = _latest_file(cache, "imports", iso)
        if not path:
            continue
        rows = json.loads(path.read_text())["data"]
        records += _records(rows, lambda r, i=iso: i, lambda r: partners.get(r["partnerCode"]), year, "importer")

    for iso in lng_importers:
        path, year = _latest_file(cache, "lng", iso)
        if not path:
            continue
        rows = json.loads(path.read_text())["data"]
        records += _records(rows, lambda r, i=iso: i, lambda r: partners.get(r["partnerCode"]), year, "importer")

    reported = {(r["importer"], r["commodity"]) for r in records}
    for iso in mirror_importers:
        path, year = _latest_file(cache, "mirror", iso)
        if not path:
            continue
        rows = json.loads(path.read_text())["data"]
        mirror = _records(rows, lambda r, i=iso: i, lambda r: reporters.get(r["reporterCode"]), year, "mirror")
        records += [m for m in mirror if (m["importer"], m["commodity"]) not in reported]
    return records


def to_native(rec: dict) -> float:
    """Tonnes → the unit used on the map for that commodity."""
    commodity = rec["commodity"]
    t = rec["tonnes"]
    if commodity == "crude":
        return t * barrels_per_tonne(rec["exporter"]) / 365 / 1000  # kb/d
    if commodity == "products":
        return t * HS["2710"][1] / 365 / 1000  # kb/d
    if commodity == "coal":
        return t / 1e6  # Mt
    return t / 1e6 / MT_LNG_PER_BCM  # bcm


def apply_plausibility(records: list[dict], bounds: dict[tuple[str, str], float], log) -> list[dict]:
    """Drop mirror rows that would push an importer above a physical bound (native units)."""
    kept, by_key = [], defaultdict(list)
    for r in records:
        (by_key[(r["importer"], r["commodity"])] if r["source"] == "mirror" else kept).append(r)
    for key, rows in by_key.items():
        bound = bounds.get(key)
        rows.sort(key=to_native)
        total = 0.0
        for r in rows:
            v = to_native(r)
            if bound is not None and total + v > bound:
                if v < 0.05:
                    continue
                log(f"    dropped implausible mirror row {r['exporter']}→{r['importer']} {r['commodity']} "
                    f"{v:,.1f} (bound {bound:,.1f})")
                continue
            total += v
            kept.append(r)
    return kept
