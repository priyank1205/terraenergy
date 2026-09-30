"""Rare earth metals and compounds: Comtrade product weight, not contained REO.

Keep this separate from fuels: neither calorific conversions nor fuel-terminal
routing applies. Links show trading partners; transport mode is not observed.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from pipeline.sources.comtrade import _code_maps, _latest_file

HS_CODES = ("280530", "284610", "284690")
IMPORTERS = """
CHN JPN KOR USA DEU FRA NLD BEL GBR ITA ESP AUT EST POL CZE HUN SWE FIN NOR CHE
IND MYS VNM THA IDN SGP HKG TWN AUS CAN MEX BRA RUS TUR ZAF ARE PHL NZL
MMR LAO KAZ UKR ISR SAU ARG
""".split()
EXPORTERS = "CHN MYS VNM AUS USA JPN FRA DEU EST RUS IND THA CAN ZAF".split()
SOURCE = {
    "id": "Comtrade-REE",
    "label": "UN Comtrade — rare earth metals and compounds (HS 280530, 284610, 284690)",
    "vintage": "2025, with 2024 fallback; importer reports plus partner-reported exports",
    "url": "https://comtradeplus.un.org/",
}
SCOPE = (
    "Rare earth metals (including scandium and yttrium), cerium compounds and other rare earth compounds. "
    "Tonnes of traded product, not contained rare earth oxide. Excludes ores and finished magnets. "
    "Customs records do not state the transport mode, so routes are modelled as container shipping between "
    "main ports, or rail and road between neighbours with open borders; some high-value lots travel by air."
)


def fetch(refresh=False):
    from pipeline.fetch_sources import CACHE, COMTRADE_URL, COMTRADE_YEARS, comtrade_reporter_codes, get_json, log
    import time

    cache = CACHE / "comtrade"
    cache.mkdir(parents=True, exist_ok=True)
    codes = comtrade_reporter_codes()
    for direction, reporters in (("M", IMPORTERS), ("X", EXPORTERS)):
        for iso in reporters:
            if iso not in codes:
                continue
            for year in COMTRADE_YEARS:
                dest = cache / f"rare_{direction}_{iso}_{year}.json"
                if dest.exists() and not refresh:
                    if json.loads(dest.read_text()).get("data"):
                        break
                    continue
                params = dict(reporterCode=codes[iso], period=year, cmdCode=",".join(HS_CODES),
                              flowCode=direction, customsCode="C00", motCode=0, partner2Code=0)
                payload = get_json(COMTRADE_URL, params)
                rows = payload.get("data") or []
                if len(rows) >= 500:
                    rows = []
                    for code in HS_CODES:
                        part = get_json(COMTRADE_URL, {**params, "cmdCode": code})
                        subset = part.get("data") or []
                        if len(subset) >= 500:
                            raise RuntimeError(f"Truncated rare earth data: {iso} {year} {code}")
                        rows.extend(subset)
                        time.sleep(1.2)
                    payload = {"data": rows, "split": True}
                dest.write_text(json.dumps(payload))
                log(f"  rare earths {direction} {iso} {year}: {len(rows)} rows")
                time.sleep(1.2)
                if rows:
                    break


def weight_tonnes(row):
    """Use weights only; heterogeneous compounds cannot be estimated from price."""
    weight = row.get("netWgt")
    if weight is None and row.get("qtyUnitCode") == 8:
        weight = row.get("qty")
    if not isinstance(weight, (float, int)) or not math.isfinite(weight) or weight <= 0:
        return None
    return weight / 1000


def load(cache_dir: Path, importers=IMPORTERS, exporters=EXPORTERS):
    cache = Path(cache_dir)
    partners, _ = _code_maps(cache)
    reported = set()
    records = {}
    for direction, reporters in (("M", importers), ("X", exporters)):
        for iso in reporters:
            path, year = _latest_file(cache, f"rare_{direction}", iso)
            if not path:
                continue
            for row in json.loads(path.read_text())["data"]:
                code = row.get("cmdCode")
                if code not in HS_CODES:
                    continue
                if direction == "M":
                    reported.add((iso, code))  # world/weightless rows also establish coverage
                partner = partners.get(row.get("partnerCode"))
                if not partner or partner == iso:
                    continue
                exp, imp = (partner, iso) if direction == "M" else (iso, partner)
                if direction == "X" and (imp, code) in reported:
                    continue
                tonnes = weight_tonnes(row)
                if tonnes is None:
                    continue
                # One total-customs/total-transport row per product and partner.
                records[(exp, imp, code)] = {
                    "v": tonnes, "year": year, "mirror": direction == "X",
                    "estimated_weight": bool(row.get("isNetWgtEstimated") or
                                             (row.get("netWgt") is None and row.get("isQtyEstimated"))),
                }
    grouped = defaultdict(lambda: {"v": 0, "years": set(), "hs": set(), "mirror": False, "estimated_weight": False})
    for (exp, imp, code), rec in records.items():
        group = grouped[(exp, imp)]
        group["v"] += rec["v"]
        group["years"].add(rec["year"])
        group["hs"].add(code)
        group["mirror"] |= rec["mirror"]
        group["estimated_weight"] |= rec["estimated_weight"]
    return dict(grouped)


def build_flows(cache_dir, label_points, first_id, route):
    """Rare earth flows, each routed by `route(exporter, importer)` (a route dict, or None if unroutable)."""
    flows = []
    for (exp, imp), rec in sorted(load(cache_dir).items(), key=lambda kv: (-kv[1]["v"], kv[0])):
        if rec["v"] < 1 or exp not in label_points or imp not in label_points:
            continue
        r = route(exp, imp)
        if r is None:
            continue
        years = sorted(rec["years"])
        flows.append({
            "id": first_id + len(flows), "c": "rare_earths", "f": exp, "t": imp,
            "v": round(rec["v"], 3), "y": max(years), "years": years,
            "s": "Comtrade (partner-reported)" if rec["mirror"] else "Comtrade",
            "hs": sorted(rec["hs"]), "weight_estimated": rec["estimated_weight"],
            **r,
        })
    if not flows:
        raise RuntimeError("No rare earth flows. Run python3 pipeline/fetch_sources.py --only rare-earths first.")
    return flows
