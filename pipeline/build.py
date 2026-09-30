#!/usr/bin/env python3
"""
Build every JSON file the app reads (public/data/) from the cached raw sources.

    python3 pipeline/fetch_sources.py   # once, or to refresh
    python3 pipeline/build.py

Outputs
  meta.json            sources, vintages, metric catalogue
  countries.json       country list, regions, label points
  latest.json          latest value per metric per country (+ source & year)
  history.json         2000–2025 annual series per country, world and regions
  flows.json           2025 bilateral trade flows with sea/overland routes
  chokepoints.json     curated chokepoints + routed 2025 volumes + PortWatch series
  context.json         2025–26 timeline, market snapshot, monthly supply, infrastructure
  world-50m.json / world-110m.json   TopoJSON keyed by ISO3
  build_report.txt     reconciliation and validation checks
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.curated import context as C  # noqa: E402
from pipeline.fetch_sources import (  # noqa: E402
    COMTRADE_IMPORTERS, COMTRADE_LNG_IMPORTERS, COMTRADE_MIRROR_IMPORTERS,
)
from pipeline.lib import overland as L  # noqa: E402
from pipeline.lib import sealanes as S  # noqa: E402
from pipeline.lib.countries import (  # noqa: E402
    ALIASES, COUNTRIES, EI_NAMES, NATURAL_EARTH_UNCODED, NUM_TO_ISO3, REGION_NAMES, flag_emoji,
)
from pipeline.lib.topo import decode_arcs, geometry_polygons, ring_area_centroid  # noqa: E402
from pipeline.sources import comtrade as CT  # noqa: E402
from pipeline.sources import ei as EI  # noqa: E402
from pipeline.sources import eia as EIA  # noqa: E402
from pipeline.sources import owid as OWID  # noqa: E402
from pipeline.sources import rare_earths as REE  # noqa: E402
from pipeline.sources import bilateral as BT  # noqa: E402

CACHE = ROOT / "pipeline" / "cache"
OUT = ROOT / "public" / "data"
YEARS = list(range(2000, 2026))
REPORT: list[str] = []


def log(msg: str = "") -> None:
    print(msg, flush=True)
    REPORT.append(msg)


def r4(x):
    """Round to 4 significant digits (keeps JSON small without visible loss)."""
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return None
    if x == 0:
        return 0
    digits = 3 - int(math.floor(math.log10(abs(x))))
    v = round(x, max(0, digits))
    return int(v) if float(v).is_integer() else v


def write(name: str, payload) -> None:
    path = OUT / name
    path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    log(f"  wrote {name:22s} {path.stat().st_size / 1024:8.1f} KB")


# ==========================================================================================
# Geometry
# ==========================================================================================
def build_geometry() -> tuple[dict, dict, dict]:
    """Re-key world-atlas TopoJSON by ISO3; derive label points, land neighbours and shared-border points."""
    label_points, neighbours, borders = {}, defaultdict(set), defaultdict(list)
    for res in ("50m", "110m"):
        topo = json.loads((CACHE / f"countries-{res}.json").read_text())
        arcs = decode_arcs(topo)
        arc_owner = defaultdict(set)
        geoms = []
        for g in topo["objects"]["countries"]["geometries"]:
            name = g["properties"].get("name")
            iso = NUM_TO_ISO3.get(g.get("id")) if g.get("id") else NATURAL_EARTH_UNCODED.get(name)
            g = dict(g)
            g["id"] = iso or f"_{name}"
            g["properties"] = {"name": name}
            geoms.append(g)
            if res == "50m" and iso:
                stack = [g.get("arcs", [])]
                while stack:
                    a = stack.pop()
                    if isinstance(a, int):
                        arc_owner[a if a >= 0 else ~a].add(iso)
                    else:
                        stack.extend(a)
                # label point: centroid of the largest polygon
                best = None
                for rings in geometry_polygons(g, arcs):
                    area, cx, cy = ring_area_centroid(rings[0])
                    if best is None or abs(area) > best[0]:
                        best = (abs(area), cx, cy)
                if best and (iso not in label_points or best[0] > label_points[iso][2]):
                    label_points[iso] = (round(best[1], 2), round(best[2], 2), best[0])
        topo["objects"]["countries"]["geometries"] = geoms
        if res == "50m":
            for arc, owners in arc_owner.items():
                for a in owners:
                    neighbours[a] |= owners - {a}
                if len(owners) == 2:
                    pts = arcs[arc]
                    borders[frozenset(owners)].extend(pts[:: max(1, len(pts) // 20)])
        write(f"world-{res}.json", topo)
    # Hand-tuned label points where the polygon centroid falls awkwardly.
    overrides = {
        "USA": (-98.5, 39.5), "CAN": (-106.0, 57.0), "RUS": (95.0, 61.0), "NOR": (9.0, 61.0),
        "FRA": (2.4, 46.6), "CHL": (-71.0, -33.0), "IDN": (114.0, -1.0), "MYS": (102.0, 4.0),
        "HRV": (16.0, 45.3), "GRC": (22.0, 39.3), "JPN": (138.3, 36.5), "PHL": (122.0, 12.5),
        "NZL": (174.5, -40.5), "ITA": (12.5, 42.8), "GBR": (-1.8, 52.8), "DNK": (9.3, 56.1),
        "VNM": (106.0, 16.0), "ARE": (54.2, 23.9), "SAU": (45.0, 24.0), "KOR": (127.8, 36.3),
    }
    lp = {iso: [v[0], v[1]] for iso, v in label_points.items()}
    for iso, (x, y) in overrides.items():
        lp[iso] = [x, y]
    return lp, {k: sorted(v) for k, v in neighbours.items()}, dict(borders)


# ==========================================================================================
# Country balances
# ==========================================================================================
METRICS = {
    # key: (label, unit, group, scale, decimals, description)
    "oil_prod_kbd": ("Oil production", "kb/d", "supply", "seq", 0, "Crude oil, condensate and natural gas liquids."),
    "oil_cons_kbd": ("Oil consumption", "kb/d", "demand", "seq", 0, "Inland demand plus bunkers and refinery fuel; excludes biofuels."),
    "net_oil_kbd": ("Net oil balance", "kb/d", "security", "div", 0, "Production minus consumption. Positive = net exporter."),
    "oil_import_dep": ("Oil import dependence", "%", "security", "seq", 0, "Share of oil consumption not covered by domestic production."),
    "gas_prod_bcm": ("Gas production", "bcm", "supply", "seq", 1, "Natural gas, standardized at 40 MJ/m³ (GCV)."),
    "gas_cons_bcm": ("Gas consumption", "bcm", "demand", "seq", 1, ""),
    "net_gas_bcm": ("Net gas balance", "bcm", "security", "div", 1, "Production minus consumption. Positive = net exporter."),
    "gas_import_dep": ("Gas import dependence", "%", "security", "seq", 0, "Share of gas consumption not covered by domestic production."),
    "coal_prod_mt": ("Coal production", "Mt", "supply", "seq", 0, "Hard coal and lignite, in physical tonnes."),
    "coal_cons_ej": ("Coal consumption", "EJ", "demand", "seq", 2, "Energy content of coal consumed."),
    "tes_ej": ("Total energy supply", "EJ", "demand", "seq", 2, "All commercially traded fuels and modern renewables."),
    "tes_pc_gj": ("Energy use per person", "GJ", "demand", "seq", 0, "Total energy supply per capita."),
    "elec_twh": ("Electricity generation", "TWh", "power", "seq", 0, ""),
    "low_carbon_share_elec": ("Low-carbon electricity", "%", "power", "seq", 0, "Nuclear plus renewables, share of generation."),
    "solar_wind_share_elec": ("Solar + wind electricity", "%", "power", "seq", 0, "Share of generation."),
    "coal_share_elec": ("Coal-fired electricity", "%", "power", "seq", 0, "Share of generation."),
    "carbon_intensity": ("Carbon intensity of power", "gCO₂/kWh", "power", "seq", 0, "Lifecycle emissions per kWh generated (Ember)."),
    "co2_mt": ("CO₂ from energy", "Mt", "emissions", "seq", 0, ""),
    "co2_pc_t": ("CO₂ per person", "t", "emissions", "seq", 1, ""),
    "hormuz_oil_share": ("Oil imports via Hormuz", "%", "security", "seq", 0,
                         "Share of 2025 crude and product imports shipped through the Strait of Hormuz (routed customs data)."),
    "hormuz_lng_share": ("LNG imports via Hormuz", "%", "security", "seq", 0,
                         "Share of 2025 LNG imports shipped through the Strait of Hormuz (Qatar and UAE cargoes)."),
    "refining_cap_kbd": ("Refining capacity", "kb/d", "supply", "seq", 0, ""),
    "solar_cap_gw": ("Solar capacity", "GW", "power", "seq", 1, ""),
    "wind_cap_gw": ("Wind capacity", "GW", "power", "seq", 1, ""),
}
# Raw series kept for charts but not offered as map layers.
AUX = ["hormuz_oil_cons_share", "hormuz_lng_cons_share", "oil_cons_ej", "gas_cons_ej", "nuclear_ej", "hydro_ej", "renew_ej", "coal_prod_ej", "population",
       "gdp_ppp_busd", "nuclear_twh", "hydro_twh", "solar_twh", "wind_twh", "other_ren_twh", "lng_imp_bcm",
       "lng_exp_bcm", "refining_thru_kbd"]
ELEC_MIX = ["coal", "gas", "oil", "nuclear", "hydro", "solar", "wind", "bioenergy", "other_renewables"]


def build_balances(ei, eia, owid, isos):
    """Return history[metric][iso] = {year: value}, source[metric][iso] = 'EI'|'EIA'|'Ember'."""
    hist: dict[str, dict[str, dict[int, float]]] = defaultdict(dict)
    src: dict[str, dict[str, str]] = defaultdict(dict)

    def take(metric, iso, series, label):
        vals = {y: v for y, v in series.items() if y in YEARS and v is not None}
        if vals:
            hist[metric][iso] = vals
            src[metric][iso] = label

    ea = eia["annual"]
    for iso in isos:
        # Energy Institute first (2025 vintage), EIA fallback for everyone else.
        for metric in ("oil_prod_kbd", "oil_cons_kbd", "gas_prod_bcm", "gas_cons_bcm", "coal_prod_mt",
                       "coal_cons_ej", "tes_ej", "co2_mt", "elec_twh", "oil_cons_ej", "gas_cons_ej"):
            if iso in ei.countries.get(metric, {}):
                take(metric, iso, ei.countries[metric][iso], "EI")
            elif iso in ea.get(metric, {}):
                take(metric, iso, ea[metric][iso], "EIA")
        for metric in ("nuclear_ej", "hydro_ej", "renew_ej", "coal_prod_ej", "refining_cap_kbd", "refining_thru_kbd",
                       "nuclear_twh", "hydro_twh", "solar_twh", "wind_twh", "other_ren_twh", "lng_imp_bcm", "lng_exp_bcm"):
            if iso in ei.countries.get(metric, {}):
                take(metric, iso, ei.countries[metric][iso], "EI")
        for metric, out in (("solar_cap_mw", "solar_cap_gw"), ("wind_cap_mw", "wind_cap_gw")):
            if iso in ei.countries.get(metric, {}):
                take(out, iso, {y: v / 1000 for y, v in ei.countries[metric][iso].items()}, "EI")
        for metric in ("population", "gdp_ppp_busd"):
            if iso in ea.get(metric, {}):
                take(metric, iso, ea[metric][iso], "EIA")
        if iso not in hist["population"] and iso in owid["population"]:
            take("population", iso, owid["population"][iso], "OWID")
        # Electricity mix (Ember via OWID)
        e = owid["electricity"].get(iso)
        if e:
            for year, rec in e.items():
                if year not in YEARS:
                    continue
                total = rec.get("elec_twh")
                if not total:
                    continue
                for k in ELEC_MIX:
                    if k in rec:
                        hist[f"elec_{k}_twh"].setdefault(iso, {})[year] = rec[k]
                low = sum(rec.get(k, 0) for k in ("nuclear", "hydro", "solar", "wind", "bioenergy", "other_renewables"))
                hist["low_carbon_share_elec"].setdefault(iso, {})[year] = 100 * low / total
                hist["solar_wind_share_elec"].setdefault(iso, {})[year] = 100 * (rec.get("solar", 0) + rec.get("wind", 0)) / total
                hist["coal_share_elec"].setdefault(iso, {})[year] = 100 * rec.get("coal", 0) / total
                if rec.get("carbon_intensity") is not None:
                    hist["carbon_intensity"].setdefault(iso, {})[year] = rec["carbon_intensity"]
                if iso not in hist["elec_twh"]:
                    hist["elec_twh"].setdefault(iso, {})[year] = total
            for k in ["low_carbon_share_elec", "solar_wind_share_elec", "coal_share_elec", "carbon_intensity",
                      *[f"elec_{m}_twh" for m in ELEC_MIX]]:
                if iso in hist[k]:
                    src[k][iso] = "Ember"
            if src["elec_twh"].get(iso) is None and iso in hist["elec_twh"]:
                src["elec_twh"][iso] = "Ember"

    # Derived metrics
    for iso in isos:
        prod, cons = hist["oil_prod_kbd"].get(iso, {}), hist["oil_cons_kbd"].get(iso, {})
        if cons:
            hist["net_oil_kbd"][iso] = {y: prod.get(y, 0.0) - c for y, c in cons.items()}
            hist["oil_import_dep"][iso] = {y: max(0.0, min(100.0, 100 * (c - prod.get(y, 0.0)) / c))
                                           for y, c in cons.items() if c > 0}
            src["net_oil_kbd"][iso] = src["oil_import_dep"][iso] = src["oil_cons_kbd"][iso]
        gp, gc = hist["gas_prod_bcm"].get(iso, {}), hist["gas_cons_bcm"].get(iso, {})
        if gc:
            hist["net_gas_bcm"][iso] = {y: gp.get(y, 0.0) - c for y, c in gc.items()}
            hist["gas_import_dep"][iso] = {y: max(0.0, min(100.0, 100 * (c - gp.get(y, 0.0)) / c))
                                           for y, c in gc.items() if c > 0.05}
            src["net_gas_bcm"][iso] = src["gas_import_dep"][iso] = src["gas_cons_bcm"][iso]
        pop = hist["population"].get(iso, {})
        for metric, out, scale in (("tes_ej", "tes_pc_gj", 1e9), ("co2_mt", "co2_pc_t", 1e6)):
            vals = {y: v * scale / pop[y] for y, v in hist[metric].get(iso, {}).items() if pop.get(y)}
            if vals:
                hist[out][iso] = vals
                src[out][iso] = src[metric].get(iso)
    return hist, src


# ==========================================================================================
# Trade flows
# ==========================================================================================
LNG_EXPORTER_GROUPS = {
    "Other Americas*": ["CAN", "MEX", "DOM", "ARG", "COL", "JAM"],
    "Other Europe*": ["NLD", "BEL", "FRA", "ESP", "PRT", "GBR", "LTU"],
    "Other Africa": ["MOZ", "CMR", "GNQ", "COG", "SEN", "MRT"],
    "Other Asia Pacific*": ["SGP", "CHN", "KOR", "JPN", "IND", "MYS", "THA"],
}
LNG_IMPORTER_GROUPS = {
    "Other EU": ["NLD", "DEU", "POL", "PRT", "GRC", "LTU", "HRV", "FIN", "SWE", "MLT", "IRL", "CYP", "EST", "LVA"],
    "Rest of Europe": ["NOR", "GIB"],
    "Other S. & Cent. America": ["COL", "DOM", "JAM", "PAN", "PRI", "SLV", "URY", "NIC", "CUB", "GTM", "HND", "BHS"],
    "Other Middle East & Africa": ["JOR", "ISR", "BHR", "GHA", "ZAF", "MAR", "SEN", "CIV"],
    "Other Asia Pacific": ["BGD", "PHL", "VNM", "HKG", "IDN", "MMR", "LKA", "AUS", "NZL"],
}
PIPE_IMPORTER_GROUPS = {
    "EU": ["DEU", "NLD", "BEL", "FRA", "POL", "DNK", "ITA", "ESP", "GRC", "BGR", "HUN", "SVK", "AUT", "CZE", "ROU",
           "SVN", "HRV", "LTU", "LVA", "FIN", "PRT", "LUX", "IRL", "EST", "SWE"],
    "Non-EU Europe": ["GBR", "TUR", "SRB", "BIH", "MKD", "GEO", "CHE", "MDA", "UKR", "ALB"],
    "Other CIS": ["UZB", "ARM", "KGZ", "TJK", "AZE"],
    "Other Middle East": ["IRQ", "OMN", "JOR", "SYR", "LBN", "ISR"],
    "Other Africa": ["EGY", "TUN", "MAR"],
}
PIPE_EXPORTER_GROUPS = {
    "Other Europe": ["ESP", "TUR", "DEU", "NLD", "GBR"],
    "Other Middle East": ["ISR"],
    "Other Africa": ["MOZ", "EGY"],
    "Other Asia Pacific": ["MYS"],
    "Other S. & Cent. America": ["CHL", "ARG", "COL"],
}
# Known single-destination cells where Comtrade gives no guidance.
PIPE_DEFAULTS = {
    # Physical landing points (Gassco): Europipe I/II & Norpipe → Germany, Franpipe → France,
    # Zeepipe → Belgium, Baltic Pipe → Denmark/Poland. Comtrade records commercial origin, not flow.
    ("NOR", "EU"): {"DEU": 0.55, "FRA": 0.18, "BEL": 0.17, "POL": 0.08, "DNK": 0.02},
    # TurkStream / Blue Stream deliveries by end market (2025 reported flows).
    ("RUS", "Non-EU Europe"): {"TUR": 0.66, "HUN": 0.17, "SRB": 0.09, "GRC": 0.04, "MKD": 0.02, "BIH": 0.02},
    ("RUS", "EU"): {"HUN": 0.5, "SVK": 0.3, "GRC": 0.2},
    ("AZE", "Non-EU Europe"): {"TUR": 0.8, "GEO": 0.2},
    ("RUS", "Other CIS"): {"UZB": 0.58, "ARM": 0.25, "AZE": 0.11, "KGZ": 0.06},
    ("NOR", "Non-EU Europe"): {"GBR": 1.0}, ("IRN", "Non-EU Europe"): {"TUR": 1.0},
    ("TKM", "Non-EU Europe"): {"TUR": 1.0}, ("IRN", "Other Middle East"): {"IRQ": 1.0},
    ("QAT", "Other Middle East"): {"OMN": 1.0}, ("AZE", "Other Middle East"): {"SYR": 1.0},
    ("Other Europe", "Other Middle East"): {("TUR", "SYR"): 1.0},
    ("Other Africa", "Other Middle East"): {("EGY", "JOR"): 1.0},
    ("Other Middle East", "Other Africa"): {("ISR", "EGY"): 1.0},
    ("Other Europe", "Other Africa"): {("ESP", "MAR"): 1.0},
    ("DZA", "Other Africa"): {"TUN": 1.0},
    ("Other Africa", "ZAF"): {"MOZ": 1.0}, ("Other Asia Pacific", "SGP"): {"MYS": 1.0},
    ("Other S. & Cent. America", "ARG"): {"CHL": 1.0}, ("IRN", "Other CIS"): {"ARM": 1.0},
    ("UZB", "Other CIS"): {"KGZ": 0.6, "TJK": 0.4},
}

# Physical corridors for overland/pipeline trade: (corridor name, schematic line lon/lat).
# Lines start inside the exporter and end inside the importer.
SGC = [[49.5, 40.2], [44.8, 41.7], [42.0, 40.6], [37.0, 39.7], [32.0, 40.2], [28.0, 41.0], [26.3, 41.0]]
TURKSTREAM = [[37.3, 44.9], [33.5, 43.3], [30.0, 42.2], [28.1, 41.6]]
DRUZHBA_S = [[52.3, 54.9], [44.0, 54.2], [36.0, 53.2], [29.3, 52.0], [25.0, 50.5], [22.3, 48.6]]
NORWAY_N_SEA = [[3.0, 60.0], [3.2, 57.5]]
CAGP = [[61.7, 37.3], [64.4, 39.8], [69.3, 41.3], [72.0, 43.3], [80.4, 44.2], [87.6, 43.8], [104.0, 36.0]]
CORRIDORS = {
    ("CAN", "USA", "crude"): ("Keystone & Enbridge systems", [[-113.5, 53.5], [-111.4, 52.7], [-104.0, 49.0], [-97.4, 42.7], [-96.8, 36.0], [-95.4, 29.7]]),
    ("USA", "CAN", "crude"): ("Enbridge Lines 5/9", [[-95.4, 29.7], [-90.0, 38.6], [-87.6, 41.8], [-84.5, 45.8], [-82.4, 43.0], [-79.4, 43.7], [-73.6, 45.5]]),
    ("RUS", "CHN", "pipeline_gas"): ("Power of Siberia", [[111.0, 60.5], [119.0, 56.5], [127.5, 50.3], [126.5, 45.8], [121.5, 41.0], [117.0, 38.0]]),
    ("TKM", "CHN", "pipeline_gas"): ("Central Asia–China gas pipeline", CAGP),
    ("UZB", "CHN", "pipeline_gas"): ("Central Asia–China gas pipeline", CAGP[1:]),
    ("KAZ", "CHN", "pipeline_gas"): ("Central Asia–China gas pipeline", CAGP[3:]),
    ("RUS", "TUR", "pipeline_gas"): ("TurkStream & Blue Stream", TURKSTREAM + [[29.0, 41.0], [32.8, 39.9]]),
    ("RUS", "HUN", "pipeline_gas"): ("TurkStream (European string)", TURKSTREAM + [[26.9, 42.3], [23.6, 43.7], [21.0, 45.3], [19.9, 46.2], [19.0, 47.5]]),
    ("RUS", "SRB", "pipeline_gas"): ("TurkStream (Balkan Stream)", TURKSTREAM + [[26.9, 42.3], [23.6, 43.7], [20.9, 44.3]]),
    ("RUS", "GRC", "pipeline_gas"): ("TurkStream via Bulgaria", TURKSTREAM + [[26.5, 41.6], [23.3, 40.9]]),
    ("RUS", "SVK", "pipeline_gas"): ("TurkStream via Hungary", TURKSTREAM + [[26.9, 42.3], [23.6, 43.7], [21.0, 45.3], [19.9, 46.2], [18.6, 48.3]]),
    ("RUS", "BIH", "pipeline_gas"): ("TurkStream via Serbia", TURKSTREAM + [[26.9, 42.3], [23.6, 43.7], [20.9, 44.3], [18.4, 44.0]]),
    ("RUS", "MKD", "pipeline_gas"): ("TurkStream via Bulgaria", TURKSTREAM + [[26.9, 42.3], [23.0, 42.4], [21.4, 42.0]]),
    ("AZE", "TUR", "pipeline_gas"): ("South Caucasus / TANAP", SGC[:5]),
    ("AZE", "GEO", "pipeline_gas"): ("South Caucasus Pipeline", SGC[:2]),
    ("AZE", "GRC", "pipeline_gas"): ("Southern Gas Corridor (TAP)", SGC + [[23.0, 40.9]]),
    ("AZE", "BGR", "pipeline_gas"): ("Southern Gas Corridor (IGB)", SGC + [[25.4, 41.1], [25.5, 42.6]]),
    ("AZE", "ITA", "pipeline_gas"): ("Southern Gas Corridor (TAP)", SGC + [[23.0, 40.9], [20.5, 40.9], [18.5, 40.27], [16.0, 41.0]]),
    ("NOR", "GBR", "pipeline_gas"): ("Langeled / Vesterled", [[6.9, 62.8], [3.0, 60.5], [0.5, 56.5], [-1.0, 53.7]]),
    ("NOR", "DEU", "pipeline_gas"): ("Europipe I & II / Norpipe", NORWAY_N_SEA + [[4.5, 55.5], [6.2, 54.2], [7.3, 53.6], [9.0, 52.5]]),
    ("NOR", "BEL", "pipeline_gas"): ("Zeepipe", NORWAY_N_SEA + [[2.8, 54.0], [3.2, 51.33], [4.4, 50.9]]),
    ("NOR", "FRA", "pipeline_gas"): ("Franpipe", NORWAY_N_SEA + [[2.6, 54.0], [2.2, 51.05], [2.5, 49.5]]),
    ("NOR", "POL", "pipeline_gas"): ("Baltic Pipe", NORWAY_N_SEA + [[8.2, 55.9], [12.0, 55.3], [15.1, 54.1], [18.0, 52.5]]),
    ("NOR", "DNK", "pipeline_gas"): ("Baltic Pipe (Danish section)", NORWAY_N_SEA + [[8.2, 55.9], [9.5, 55.8]]),
    ("DZA", "ITA", "pipeline_gas"): ("TransMed (Enrico Mattei)", [[3.3, 32.9], [8.3, 34.5], [10.9, 36.9], [12.6, 37.65], [14.5, 40.5], [12.5, 42.5]]),
    ("DZA", "TUN", "pipeline_gas"): ("TransMed (Tunisian section)", [[3.3, 32.9], [8.3, 34.5], [10.2, 36.0]]),
    ("DZA", "ESP", "pipeline_gas"): ("Medgaz", [[3.3, 32.9], [0.6, 34.6], [-1.4, 35.3], [-2.4, 36.8], [-3.7, 40.4]]),
    ("LBY", "ITA", "pipeline_gas"): ("Greenstream", [[12.2, 32.87], [13.5, 35.0], [14.25, 37.07], [14.5, 40.5]]),
    ("QAT", "ARE", "pipeline_gas"): ("Dolphin", [[51.55, 25.9], [53.0, 25.2], [54.7, 24.7]]),
    ("QAT", "OMN", "pipeline_gas"): ("Dolphin (Oman extension)", [[51.55, 25.9], [53.0, 25.2], [54.7, 24.7], [56.3, 24.2]]),
    ("ISR", "EGY", "pipeline_gas"): ("EMG / Arab Gas Pipeline", [[34.55, 31.67], [33.8, 31.13], [32.3, 30.6], [31.2, 30.0]]),
    ("USA", "MEX", "pipeline_gas"): ("Cross-border pipelines (Sur de Texas, …)", [[-98.5, 29.4], [-99.5, 27.5], [-100.3, 25.7], [-101.0, 22.0], [-99.1, 19.4]]),
    ("CAN", "USA", "pipeline_gas"): ("NGTL / Alliance / TC systems", [[-114.0, 51.0], [-110.0, 49.0], [-104.0, 45.0], [-94.0, 42.0], [-88.0, 41.8]]),
    ("USA", "CAN", "pipeline_gas"): ("Vector / Great Lakes / Maritimes", [[-88.0, 41.8], [-83.0, 42.3], [-79.4, 43.7], [-73.6, 45.5]]),
    ("BOL", "BRA", "pipeline_gas"): ("Gasbol", [[-63.2, -17.8], [-57.7, -19.0], [-52.0, -21.5], [-46.6, -23.5]]),
    ("MOZ", "ZAF", "pipeline_gas"): ("ROMPCO", [[35.3, -21.7], [32.6, -25.9], [29.2, -26.5]]),
    ("MMR", "THA", "pipeline_gas"): ("Yadana / Yetagun", [[97.3, 14.9], [98.5, 14.3], [99.8, 13.5]]),
    ("MMR", "CHN", "pipeline_gas"): ("Myanmar–China gas pipeline", [[93.55, 19.43], [96.1, 21.9], [98.0, 24.0], [102.7, 25.0]]),
    ("RUS", "BLR", "pipeline_gas"): ("Yamal–Europe (Belarus section)", [[40.0, 55.0], [33.0, 54.5], [27.6, 53.9]]),
    ("RUS", "KAZ", "pipeline_gas"): ("Central Asia–Center", [[55.0, 52.0], [60.0, 50.0], [66.9, 48.0]]),
    ("IRN", "TUR", "pipeline_gas"): ("Tabriz–Ankara", [[46.3, 38.1], [44.0, 39.5], [39.0, 39.8], [32.8, 39.9]]),
    ("IRN", "IRQ", "pipeline_gas"): ("Iran–Iraq gas pipeline", [[48.5, 32.0], [46.0, 33.5], [44.4, 33.3]]),
    ("IRQ", "TUR", "crude"): ("Kirkuk–Ceyhan pipeline", [[44.4, 35.5], [42.0, 37.0], [37.5, 37.0], [35.9, 36.9]]),
    ("MMR", "CHN", "crude"): ("Myanmar–China oil pipeline", [[93.55, 19.43], [96.1, 21.9], [98.0, 24.0], [102.7, 25.0]]),
    ("IDN", "SGP", "pipeline_gas"): ("Grissik–Singapore pipeline", [[103.9, -2.4], [104.2, -0.6], [104.0, 1.0], [103.8, 1.33]]),
    ("MYS", "SGP", "pipeline_gas"): ("Peninsular Gas Utilisation – Singapore", [[103.4, 4.5], [103.5, 2.3], [103.75, 1.5], [103.8, 1.35]]),
    ("ESP", "MAR", "pipeline_gas"): ("Maghreb–Europe pipeline (reverse flow)", [[-4.8, 37.9], [-5.6, 36.0], [-5.8, 35.6], [-4.4, 34.7], [-2.0, 34.0]]),
    ("EGY", "JOR", "pipeline_gas"): ("Arab Gas Pipeline (Taba–Aqaba)", [[31.2, 30.0], [32.3, 30.6], [33.8, 30.4], [34.9, 29.5], [35.0, 29.5], [35.9, 31.9]]),
    ("AZE", "SYR", "pipeline_gas"): ("South Caucasus pipeline & Kilis–Aleppo", SGC[:4] + [[37.1, 36.7], [37.15, 36.2]]),
    ("DZA", "SVN", "pipeline_gas"): ("TransMed via Italy", [[3.3, 32.9], [8.3, 34.5], [10.9, 36.9], [12.6, 37.65], [14.5, 40.5], [12.5, 42.5], [12.2, 44.4], [13.6, 45.9], [14.5, 46.05]]),
    ("KAZ", "DEU", "crude"): ("Druzhba via Russia, Belarus and Poland to Schwedt",
                              [[51.9, 47.1], [50.1, 53.2], [44.0, 54.2], [32.7, 52.85], [29.25, 52.05], [23.7, 52.1], [19.7, 52.55], [14.28, 53.06]]),
    ("RUS", "AZE", "crude"): ("Baku–Novorossiysk pipeline (reverse flow)",
                              [[37.8, 44.7], [40.1, 45.85], [45.7, 43.3], [47.5, 42.98], [48.5, 41.85], [49.9, 40.4]]),
    ("KAZ", "CHN", "crude"): ("Kazakhstan–China oil pipeline", [[57.1, 50.3], [66.9, 48.0], [71.6, 48.7], [78.0, 46.5], [82.6, 45.2], [84.9, 44.3]]),
    ("RUS", "HUN", "crude"): ("Druzhba (southern leg)", DRUZHBA_S + [[18.9, 47.3]]),
    ("RUS", "SVK", "crude"): ("Druzhba (southern leg)", DRUZHBA_S + [[18.9, 48.4], [17.1, 48.1]]),
    ("RUS", "CZE", "crude"): ("Druzhba (southern leg)", DRUZHBA_S + [[18.9, 48.4], [17.1, 48.1], [14.4, 50.1]]),
    ("RUS", "BLR", "crude"): ("Druzhba", DRUZHBA_S[:4] + [[27.6, 53.9]]),
}
SPLITS = {
    # Russia→China crude: ~40 Mt/yr moves by pipeline (ESPO spur 30 Mt + Kazakh transit 10 Mt).
    ("RUS", "CHN", "crude"): {"pipeline_kbd": 40e6 * 7.22 / 365 / 1000, "corridor": "ESPO spur (Skovorodino–Daqing)",
                             "line": [[108.0, 56.8], [116.0, 56.0], [123.9, 54.0], [122.5, 53.0], [124.2, 49.5], [125.0, 46.6], [123.4, 41.8]],
                             "label": "ESPO spur (Skovorodino–Daqing) & Atasu–Alashankou"},
}
ANNOTATIONS = {
    ("MYS", "CHN", "crude"): {
        "note": "Declared origin Malaysia. Tanker-tracking firms attribute most of this to Iranian crude "
                "relabelled after ship-to-ship transfers off Malaysia; it is routed here from Kharg Island.",
        "route_from": ("IRN", "PG_KHARG"),
    },
}
EAST_ASIA = {"CHN", "JPN", "KOR", "TWN", "HKG", "PRK", "MNG", "PHL", "VNM"}
AMERICAS = {iso for iso, c in COUNTRIES.items() if c["region"] in ("NAM", "SCA")}
BLACK_SEA_MED = {"MDA", "ARM", "TUR", "BGR", "ROU", "GEO", "UKR", "GRC", "CYP", "EGY", "SYR", "LBN", "ISR", "ITA", "HRV", "SVN",
                 "MLT", "TUN", "LBY", "DZA", "MAR", "ALB", "MNE"}
WEST = ({iso for iso, c in COUNTRIES.items() if c["region"] in ("EUR", "NAM", "SCA")} | BLACK_SEA_MED) - {"TUR"}
# Share of an exporter's cargoes loading at each terminal, by destination set (first match wins).
# Calibrated to 2025 port data reported by EIA, Kpler/Reuters: e.g. UAE's ADCOP line to Fujairah carries
# ~1.5 of ~3.9 mb/d of crude; Russia ships roughly 60% of seaborne crude from the Baltic.
TERMINAL_RULES = {
    ("RUS", "crude"): [(EAST_ASIA, {"KOZMINO": 1.0}), (BLACK_SEA_MED, {"NOVOROSSIYSK": 1.0}),
                       (None, {"PRIMORSK": 0.6, "NOVOROSSIYSK": 0.28, "MURMANSK": 0.12})],
    ("RUS", "products"): [(EAST_ASIA, {"KOZMINO": 1.0}), (BLACK_SEA_MED, {"NOVOROSSIYSK": 1.0}),
                          (None, {"PRIMORSK": 0.55, "NOVOROSSIYSK": 0.45})],
    ("RUS", "coal"): [(EAST_ASIA, {"KOZMINO": 1.0}), (BLACK_SEA_MED, {"NOVOROSSIYSK": 1.0}),
                      (None, {"PRIMORSK": 0.4, "NOVOROSSIYSK": 0.45, "MURMANSK": 0.15})],
    ("SAU", "crude"): [(WEST, {"YANBU": 0.65, "PG_RAS_TANURA": 0.35}), (None, {"PG_RAS_TANURA": 0.92, "YANBU": 0.08})],
    ("SAU", "products"): [(WEST, {"YANBU": 0.6, "PG_RAS_TANURA": 0.4}), (None, {"PG_RAS_TANURA": 0.8, "YANBU": 0.2})],
    ("ARE", "crude"): [(None, {"PG_DAS": 0.62, "FUJAIRAH": 0.38})],
    ("ARE", "products"): [(None, {"PG_DAS": 0.75, "FUJAIRAH": 0.25})],
    ("AUS", "lng"): [(None, {"DAMPIER": 0.57, "DARWIN": 0.13, "GLADSTONE": 0.30})],
    ("AUS", "coal"): [(None, {"NEWCASTLE_AU": 0.45, "HAY_POINT": 0.30, "GLADSTONE": 0.25})],
    ("IRQ", "crude"): [({"TUR"}, {"CEYHAN": 0.5, "PG_BASRA": 0.5}), (None, {"PG_BASRA": 1.0})],
}
SEA_SPLITS = {("RUS", "CHN", "coal"): 0.5}  # remaining share moves overland by rail

MIN_FLOW = {"crude": 1.0, "products": 1.0, "coal": 0.05, "lng": 0.01, "pipeline_gas": 0.01}
UNIT = {"crude": "kb/d", "products": "kb/d", "coal": "Mt", "lng": "bcm", "pipeline_gas": "bcm", "rare_earths": "t"}
SPEED_KN = {"crude": 13.0, "products": 13.5, "coal": 12.5, "lng": 17.0, "rare_earths": 16.0}  # rare earths: container ships


def ei_iso(name: str) -> str | None:
    return EI_NAMES.get(name.strip().rstrip("*").strip()) or EI_NAMES.get(name.strip())


def build_comtrade_flows(records, hist):
    """Aggregate Comtrade records into {(exp, imp, commodity): value} (native units)."""
    # Plausibility bounds for mirror rows (native units)
    bounds = {}
    for iso in COMTRADE_MIRROR_IMPORTERS:
        cons = (hist["oil_cons_kbd"].get(iso) or {})
        thru = (hist.get("refining_thru_kbd", {}).get(iso) or {})
        c = max(cons.values()) if cons else None
        t = max(thru.values()) if thru else None
        if t or c:
            bounds[(iso, "crude")] = 1.25 * (t or c)
        if c:
            bounds[(iso, "products")] = 1.25 * c
        coal = hist["coal_cons_ej"].get(iso) or {}
        if coal:
            bounds[(iso, "coal")] = 1.4 * max(coal.values()) / 0.0245  # EJ → Mt at ~24.5 GJ/t
    records = CT.apply_plausibility(records, bounds, log)
    flows = defaultdict(lambda: {"v": 0.0, "usd": 0.0, "year": 0, "src": set(), "est": False})
    for r in records:
        if r["commodity"] not in ("crude", "products", "coal"):
            continue
        key = (r["exporter"], r["importer"], r["commodity"])
        f = flows[key]
        f["v"] += CT.to_native(r)
        f["usd"] += r["usd"]
        f["year"] = max(f["year"], r["year"])
        f["src"].add(r["source"])
        f["est"] = f["est"] or r["estimated"]
    return flows, records


def _weights_for(pairs_weight, candidates_from, candidates_to):
    w = {}
    for x in candidates_from:
        for m in candidates_to:
            v = pairs_weight.get((x, m), 0.0)
            if v > 0:
                w[(x, m)] = v
    return w


def build_gas_flows(ei, records, eia):
    """EI 2025 LNG & pipeline matrices → country pairs, splitting EI aggregates with Comtrade shares."""
    lng_w, pipe_w = defaultdict(float), defaultdict(float)
    for r in records:
        if r["commodity"] == "lng":
            lng_w[(r["exporter"], r["importer"])] += r["tonnes"]
        elif r["commodity"] == "pipeline_gas":
            pipe_w[(r["exporter"], r["importer"])] += r["tonnes"]
    imp_total_lng = defaultdict(float)
    exp_total_lng = defaultdict(float)
    for (x, m), v in lng_w.items():
        imp_total_lng[m] += v
        exp_total_lng[x] += v
    eia_gas_imp = {}  # fallback weights for importers without Comtrade
    for iso, ys in eia["annual"].get("gas_cons_bcm", {}).items():
        eia_gas_imp[iso] = ys.get(2024) or 0.0

    out = defaultdict(float)
    unallocated = []

    def split(cell, commodity, exp_groups, imp_groups, pair_w, defaults):
        f_name, t_name, bcm = cell["from"], cell["to"], cell["bcm"]
        fx = ei_iso(f_name)
        tm = ei_iso(t_name)
        froms = [fx] if fx else exp_groups.get(f_name, [])
        tos = [tm] if tm else imp_groups.get(t_name, [])
        key_f = fx or f_name
        key_t = tm or t_name
        d = defaults.get((key_f, key_t))
        if d:
            total = sum(d.values())
            for k, share in d.items():
                if isinstance(k, tuple):
                    x, m = k
                elif fx:  # named exporter → keys are importers
                    x, m = fx, k
                else:  # aggregate exporter → keys are exporters
                    x, m = k, tm
                out[(x, m, commodity)] += bcm * share / total
            return
        if not froms or not tos:
            unallocated.append((f_name, t_name, bcm))
            return
        w = _weights_for(pair_w, froms, tos)
        if not w and commodity == "lng":
            # marginal fallback: exporter's global LNG sales × importer's LNG purchases
            for x in froms:
                for m in tos:
                    a = exp_total_lng.get(x, 0.0) if len(froms) > 1 else 1.0
                    b = imp_total_lng.get(m, 0.0) or eia_gas_imp.get(m, 0.0) * 0.1
                    if a > 0 and b > 0:
                        w[(x, m)] = a * b
        if not w and commodity == "pipeline_gas":
            for x in froms[:1]:
                for m in tos:
                    b = eia_gas_imp.get(m, 0.0)
                    if b > 0:
                        w[(x, m)] = b
        if not w:
            unallocated.append((f_name, t_name, bcm))
            return
        total = sum(w.values())
        for (x, m), v in w.items():
            if x != m:
                out[(x, m, commodity)] += bcm * v / total

    for cell in ei.lng_matrix["cells"]:
        split(cell, "lng", LNG_EXPORTER_GROUPS, LNG_IMPORTER_GROUPS, lng_w, {})
    for cell in ei.pipe_matrix["cells"]:
        split(cell, "pipeline_gas", PIPE_EXPORTER_GROUPS, PIPE_IMPORTER_GROUPS, pipe_w, PIPE_DEFAULTS)
    for f, t, v in unallocated:
        log(f"    unallocated gas cell {f} → {t}: {v:.2f} bcm")
    return out


class RouteError(RuntimeError):
    pass


class Router:
    """Chooses sea, pipeline or overland transport for each trade (rules in pipeline/lib/overland.py)."""

    def __init__(self, label_points, neighbours, borders):
        self.lp = label_points
        self.nb = neighbours
        self.borders = borders
        self.node_ids = {n: i for i, n in enumerate(S.NODES)}
        self.cache = {}

    def terminals(self, iso, commodity, side):
        """Ports where trade enters or leaves the sea network. A country listed only in the other table
        (a landlocked importer's gateway, or an exporter's own port used for imports) uses those ports
        with any overland leg reversed: export legs run inland → port, import legs port → inland."""
        own, other = (S.IMPORT_TERMINALS, S.EXPORT_TERMINALS) if side == "imp" else (S.EXPORT_TERMINALS, S.IMPORT_TERMINALS)
        ts = own.get(iso) or [{**t, "overland": list(reversed(t["overland"]))} if t.get("overland") else t
                              for t in other.get(iso, []) if not (side == "exp" and t.get("import_only"))]
        return [t for t in ts if not t.get("only") or commodity in t["only"]]

    def sea_path(self, a, b, profile_key, profile):
        k = (a, b, profile_key)
        if k not in self.cache:
            self.cache[k] = S.shortest_path(a, b, profile)
        return self.cache[k]

    def routes(self, exp, imp, commodity, route_from=None):
        """List of (share, route). Splits cargoes across an exporter's terminals when rules apply."""
        rules = TERMINAL_RULES.get((exp, commodity))
        if (not rules or route_from or commodity == "pipeline_gas" or (exp, imp, commodity) in CORRIDORS
                or L.land_plan(exp, imp, commodity, self.nb, self.lp)):
            return [(1.0, self.route(exp, imp, commodity, route_from))]
        shares = next(sh for dest, sh in rules if dest is None or imp in dest)
        out = [(share, self.route(exp, imp, commodity, only_node=node)) for node, share in shares.items()]
        total = sum(sh for sh, _ in out)
        return [(sh / total, r) for sh, r in out]

    def route(self, exp, imp, commodity, route_from=None, only_node=None, force_sea=False):
        if (exp, imp, commodity) in CORRIDORS and not force_sea:
            return self.corridor(exp, imp, commodity)
        plan = None if force_sea else L.land_plan(exp, imp, commodity, self.nb, self.lp)
        if plan:
            return self.land(exp, imp, commodity, *plan)
        if commodity == "pipeline_gas":
            raise RouteError(f"{exp}→{imp} pipeline gas: no corridor and no chain of land borders")
        exps = self.terminals(route_from[0] if route_from else exp, commodity, "exp")
        if route_from:
            exps = [t for t in exps if t["node"] == route_from[1]] or exps
        if only_node:
            exps = [t for t in S.EXPORT_TERMINALS.get(exp, []) if t["node"] == only_node] or exps
        imps = self.terminals(imp, commodity, "imp")
        if not exps or not imps:
            missing = " and ".join(iso for iso, ts in ((exp, exps), (imp, imps)) if not ts)
            raise RouteError(f"{exp}→{imp} {commodity}: no port or gateway for {missing}")
        origin = route_from[0] if route_from else exp
        profile = {"avoid_red_sea": origin not in S.RED_SEA_TOLERANT, "commodity": commodity,
                   "avoid_panama": origin not in AMERICAS and imp not in AMERICAS}
        pkey = (profile["avoid_red_sea"], commodity, profile["avoid_panama"])
        best = None
        for te in exps:
            for ti in imps:
                d, path = self.sea_path(te["node"], ti["node"], pkey, profile)
                if not path:
                    continue
                legs = S.polyline_nm(te.get("overland", [])) + S.polyline_nm(ti.get("overland", []))
                penalty = 0.0
                if profile["avoid_red_sea"] and "BAB_EL_MANDEB" in path:
                    penalty += S.RED_SEA_PENALTY_NM
                if commodity == "lng" and "PANAMA_PAC" in path and "PANAMA_ATL" in path:
                    penalty += S.PANAMA_LNG_PENALTY_NM
                if profile["avoid_panama"] and "PANAMA_PAC" in path and "PANAMA_ATL" in path:
                    penalty += S.PANAMA_OUTSIDE_AMERICAS_PENALTY_NM
                total = d + legs + penalty
                if best is None or total < best[0]:
                    best = (total, d + legs, path, te, ti)
        if best is None:
            raise RouteError(f"{exp}→{imp} {commodity}: ports are not connected by sea")
        _, dist, path, te, ti = best
        if len(path) == 1 and not te.get("overland") and not ti.get("overland"):
            raise RouteError(f"{exp}→{imp} {commodity}: both use the port node {path[0]}; give one a closer terminal")
        r = {
            "mode": "sea", "path": [self.node_ids[n] for n in path], "cp": S.path_chokepoints(path),
            "nm": round(dist), "days": round(dist / (SPEED_KN.get(commodity, 13.0) * 24), 1),
            "via": [te["label"], ti["label"]],
        }
        if te.get("overland"):
            r["legA"] = [list(p) for p in te["overland"]]
        if ti.get("overland"):
            r["legB"] = [list(p) for p in ti["overland"]]
        return r

    def corridor(self, exp, imp, commodity):
        name, line = CORRIDORS[(exp, imp, commodity)]
        return {"mode": "pipeline", "line": [[round(x, 2), round(y, 2)] for x, y in line], "corridor": name,
                "nm": round(S.polyline_nm([tuple(p) for p in line])), "cp": []}

    def land(self, exp, imp, commodity, mode, path):
        if mode == "caspian":
            name, line = L.CASPIAN_ROUTES[(exp, imp)]
            nm = round(S.polyline_nm(line))
            return {"mode": "sea", "line": [list(p) for p in line], "corridor": name, "nm": nm, "cp": [],
                    "days": round(nm / (SPEED_KN.get(commodity, 13.0) * 24), 1)}
        named = L.LAND_ROUTES.get((exp, imp, commodity)) or L.LAND_ROUTES.get((exp, imp, None))
        if named and len(path) == 2:
            name, line = named
            line = [[round(x, 2), round(y, 2)] for x, y in line]
        else:
            name, line = None, L.land_line(path, self.lp, self.borders)
        r = {"mode": mode, "line": line, "nm": round(S.polyline_nm([tuple(p) for p in line])), "cp": []}
        if name:
            r["corridor"] = name
        if len(path) > 2:
            r["transit"] = path[1:-1]
        return r


# ==========================================================================================
# Main
# ==========================================================================================
def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    log(f"TerraEnergy data build — {date.today().isoformat()}")
    log("Loading sources")
    ei = EI.load(CACHE / "ei_statistical_review_2026.xlsx")
    eia = EIA.load(CACHE / "eia_INTL.zip")
    owid = OWID.load(CACHE / "owid-energy-data.csv")
    log(f"  EI 2026: {len(ei.countries['tes_ej'])} countries; EIA updated {eia['last_updated']}")

    log("Geometry")
    label_points, neighbours, borders = build_geometry()

    isos = sorted(iso for iso, c in COUNTRIES.items() if c["region"] != "ANT")
    log("Balances")
    hist, src = build_balances(ei, eia, owid, isos)

    log("Trade")
    records = CT.load(CACHE / "comtrade", COMTRADE_IMPORTERS, COMTRADE_MIRROR_IMPORTERS, COMTRADE_LNG_IMPORTERS)
    log(f"  Comtrade records: {len(records)}")
    ct_flows, records = build_comtrade_flows(records, hist)
    gas = build_gas_flows(ei, records, eia)

    # Russia → Belarus crude (neither side reports to Comtrade): EI inter-area 2025, Russia → Other CIS.
    ot = ei.oil_trade["kbd"]
    rus_cis = 14.3 * 7.33 / 365 * 1000  # EI: 14.3 Mt, almost entirely Belarus
    ct_flows[("RUS", "BLR", "crude")] = {"v": rus_cis, "usd": 0.0, "year": 2025, "src": {"ei"}, "est": True}

    router = Router(label_points, neighbours, borders)
    unroutable = []
    flows = []
    fid = 0

    def add_flow(exp, imp, commodity, value, year, source, est=False, note=None, route_from=None, forced=None):
        nonlocal fid
        if value < MIN_FLOW[commodity] or exp == imp:
            return
        try:
            parts = [(1.0, forced)] if forced else router.routes(exp, imp, commodity, route_from)
            sea_share = SEA_SPLITS.get((exp, imp, commodity))
            if sea_share is not None and not forced:
                land = router.land(exp, imp, commodity, "overland", [exp, imp])
                sea = router.route(exp, imp, commodity, only_node="KOZMINO", force_sea=True) if commodity == "coal" else None
                parts = [(1 - sea_share, land)] + ([(sea_share, sea)] if sea else [])
        except RouteError as e:
            unroutable.append(str(e))
            return
        for share, route in parts:
            if route is None or value * share < MIN_FLOW[commodity] * 0.5:
                continue
            fid += 1
            f = {"id": fid, "c": commodity, "f": exp, "t": imp, "v": r4(value * share), "y": year, "s": source, **route}
            if len(parts) > 1:
                f["part"] = round(share, 3)
            if est:
                f["est"] = 1
            if note:
                f["note"] = note
            flows.append(f)

    for (exp, imp, commodity), f in sorted(ct_flows.items(), key=lambda kv: -kv[1]["v"]):
        src_label = "EI" if "ei" in f["src"] else ("Comtrade (partner-reported)" if f["src"] == {"mirror"} else "Comtrade")
        key = (exp, imp, commodity)
        ann = ANNOTATIONS.get(key, {})
        if key in SPLITS:
            sp = SPLITS[key]
            pipe_v = min(sp["pipeline_kbd"], f["v"])
            corridor_line = sp["line"]
            pipe_route = {"mode": "pipeline", "corridor": sp["corridor"], "cp": [], "line": corridor_line,
                          "nm": round(S.polyline_nm([tuple(p) for p in corridor_line]))}
            add_flow(exp, imp, commodity, pipe_v, f["year"], src_label, f["est"], sp["label"], forced=pipe_route)
            sea_route = router.route(exp, imp, commodity, only_node="KOZMINO", force_sea=True)
            add_flow(exp, imp, commodity, f["v"] - pipe_v, f["year"], src_label, f["est"],
                     "Seaborne share (ESPO blend from Kozmino and Urals via Suez)", forced=sea_route)
            continue
        add_flow(exp, imp, commodity, f["v"], f["year"], src_label, f["est"], ann.get("note"), ann.get("route_from"))
    for (exp, imp, commodity), v in sorted(gas.items(), key=lambda kv: -kv[1]):
        add_flow(exp, imp, commodity, v, 2025, "EI")
    # Append to preserve every existing energy-flow ID / shared URL.
    def route_rare_earths(exp, imp):
        try:
            return router.route(exp, imp, "rare_earths")
        except RouteError as e:
            unroutable.append(str(e))
            return None

    flows.extend(REE.build_flows(CACHE / "comtrade", label_points, fid + 1, route_rare_earths))
    if unroutable:
        raise RouteError("Trade with no plausible route — add a port, gateway or corridor:\n  " + "\n  ".join(sorted(set(unroutable))))
    source_estimated_pairs = {(r["exporter"], r["importer"], r["commodity"]) for r in records if r.get("weight_estimated")}
    for f in flows:
        if f["s"].startswith("Comtrade") and (f["f"], f["t"], f["c"]) in source_estimated_pairs:
            f["weight_estimated"] = True
    by_c = defaultdict(int)
    for f in flows:
        by_c[f["c"]] += 1
    log(f"  flows: {len(flows)} {dict(by_c)}")

    # ---------------- validation against EI regional totals -----------------
    log("Validation: crude imports 2025, Comtrade-derived vs EI (kb/d)")
    ei_names = {"China": "CHN", "India": "IND", "Japan": "JPN", "US": "USA", "Singapore": "SGP", "Canada": "CAN"}
    imp_tot = defaultdict(float)
    for f in flows:
        if f["c"] == "crude":
            imp_tot[f["t"]] += f["v"]
    for name, iso in ei_names.items():
        e = ot.get(name, {}).get(2025, {}).get("crude_imp")
        log(f"  {iso}: flows {imp_tot[iso]:8,.0f}   EI {e or 0:8,.0f}   ratio {imp_tot[iso] / e if e else float('nan'):.2f}")
    lng_sum = sum(f["v"] for f in flows if f["c"] == "lng")
    pipe_sum = sum(f["v"] for f in flows if f["c"] == "pipeline_gas")
    log(f"  LNG flows total {lng_sum:.1f} bcm (EI 578.5); pipeline {pipe_sum:.1f} bcm (EI 567.6)")

    # ---------------- chokepoint throughput from routed flows -----------------
    log("Validation: routed 2025 flows through chokepoints vs EIA 1H25 (mb/d, Bcf/d)")
    cp_tot = defaultdict(lambda: defaultdict(float))
    cp_imp = defaultdict(lambda: defaultdict(float))
    for f in flows:
        for cp in f.get("cp", []):
            cp_tot[cp][f["c"]] += f["v"]
            cp_imp[cp][(f["t"], f["c"])] += f["v"]
    eia_cp = {c["id"]: c for c in C.CHOKEPOINTS}
    for cid, c in eia_cp.items():
        t = cp_tot.get(cid, {})
        oil = (t.get("crude", 0) + t.get("products", 0)) / 1000
        lng_bcfd = t.get("lng", 0) * 35.3147 / 365
        ref = (c.get("oil") or {}).get("2025h1") or (c.get("oil") or {}).get("2025")
        lref = (c.get("lng") or {}).get("2025h1")
        log(f"  {cid:15s} oil {oil:5.1f} (EIA {ref})   LNG {lng_bcfd:4.1f} (EIA {lref})   coal {t.get('coal', 0):6.0f} Mt")

    # ---------------- Hormuz exposure per importer -----------------
    hz = defaultdict(float)
    imports = defaultdict(float)
    for f in flows:
        group = "oil" if f["c"] in ("crude", "products") else f["c"]
        imports[(f["t"], group)] += f["v"]
        if "hormuz" in f.get("cp", []):
            hz[(f["t"], group)] += f["v"]

    def latest_val(metric, iso):
        s_ = hist[metric].get(iso, {})
        return s_[max(s_)] if s_ else None

    for (iso, group), total in imports.items():
        if group not in ("oil", "lng") or total <= 0:
            continue
        share_key, cons_key, cons_metric, net_metric = (
            ("hormuz_oil_share", "hormuz_oil_cons_share", "oil_cons_kbd", "net_oil_kbd") if group == "oil"
            else ("hormuz_lng_share", "hormuz_lng_cons_share", "gas_cons_bcm", "net_gas_bcm"))
        net = latest_val(net_metric, iso)
        if net is None or net >= 0:
            continue  # exposure metric only meaningful for net importers
        v = hz.get((iso, group), 0.0)
        hist[share_key][iso] = {2025: 100 * v / total}
        src[share_key][iso] = "Derived"
        cons = latest_val(cons_metric, iso)
        if cons:
            hist[cons_key][iso] = {2025: min(100.0, 100 * v / cons)}
            src[cons_key][iso] = "Derived"
    for key in ("hormuz_oil_share", "hormuz_oil_cons_share", "hormuz_lng_share"):
        top = sorted(((iso, s_[2025]) for iso, s_ in hist[key].items()), key=lambda x: -x[1])[:14]
        log(f"  {key}: " + ", ".join(f"{i} {v:.0f}%" for i, v in top))

    # ---------------- write: countries -----------------
    log("Writing outputs")
    detail_snapshot = BT.build_snapshot(CACHE / "comtrade", OUT / "trade_details.json")
    log(f"  original customs declarations: {len(detail_snapshot['records'])}")
    have_data = {iso for m in ("tes_ej", "oil_cons_kbd", "elec_twh", "population") for iso in hist[m]}
    countries = []
    for iso in isos:
        if iso not in have_data and iso not in label_points:
            continue
        c = COUNTRIES[iso]
        countries.append({"iso": iso, "name": c["name"], "region": c["region"], "flag": flag_emoji(iso),
                          "lp": label_points.get(iso), "ei": iso in ei.countries["tes_ej"],
                          "aliases": ALIASES.get(iso, [])})
    write("countries.json", {"countries": countries, "regions": REGION_NAMES, "neighbours": neighbours})

    # latest.json
    latest = {}
    for metric in list(METRICS) + AUX + [f"elec_{m}_twh" for m in ELEC_MIX]:
        vals = {}
        for iso, series in hist.get(metric, {}).items():
            if not series:
                continue
            y = max(series)
            vals[iso] = [r4(series[y]), y, src[metric].get(iso)]
        latest[metric] = vals
    write("latest.json", latest)

    # history.json
    series_out = {}
    for metric in list(METRICS) + AUX + [f"elec_{m}_twh" for m in ELEC_MIX]:
        if metric.startswith("hormuz_"):
            continue
        per = {}
        for iso, s in hist.get(metric, {}).items():
            if len(s) < 2:
                continue
            per[iso] = [r4(s.get(y)) for y in YEARS]
        series_out[metric] = per
    world, regions = {}, {}
    for metric in EI.SERIES_SHEETS:
        w = ei.regions.get(metric, {}).get("WORLD")
        if w:
            world[metric] = [r4(w.get(y)) for y in YEARS]
        regions[metric] = {rc: [r4(v.get(y)) for y in YEARS] for rc, v in ei.regions.get(metric, {}).items() if rc != "WORLD"}
    write("history.json", {"years": YEARS, "series": series_out, "world": world, "regions": regions,
                           "groups": {m: {g: [r4(v.get(y)) for y in YEARS] for g, v in ei.groups.get(m, {}).items()}
                                      for m in ("oil_prod_kbd", "oil_cons_kbd", "gas_prod_bcm")}})

    # flows.json
    node_list = [[r4(x), r4(y)] for x, y in S.NODES.values()]
    write("flows.json", {"year": 2025, "units": UNIT, "nodes": node_list, "node_names": list(S.NODES),
                         "coverage": {"rare_earths": {"scope": REE.SCOPE, "min_tonnes": 1,
                            "importers": REE.IMPORTERS, "mirror_exporters": REE.EXPORTERS}},
                         "flows": flows})

    # chokepoints.json (+ PortWatch)
    pw = json.loads((CACHE / "portwatch_chokepoints_daily.json").read_text())
    pw_ids = {c["portwatch"] for c in C.CHOKEPOINTS if c.get("portwatch")} | set(C.PORTWATCH_EXTRA)
    by_port = defaultdict(dict)
    for rec in pw:
        if rec["portid"] in pw_ids and rec["date"] >= "2023-01-01":
            by_port[rec["portid"]][rec["date"]] = (rec["n_tanker"], rec["n_total"], rec["capacity_tanker"])
    series = {}
    for pid, days in by_port.items():
        ds = sorted(days)
        series[pid] = {"start": ds[0], "end": ds[-1],
                       "tanker": [days[d][0] for d in ds], "total": [days[d][1] for d in ds],
                       "tanker_dwt": [round(days[d][2] / 1000) for d in ds]}
    cps = []
    for c in C.CHOKEPOINTS:
        t = cp_tot.get(c["id"], {})
        exposed = sorted(cp_imp.get(c["id"], {}).items(), key=lambda kv: -kv[1])
        top_imp = defaultdict(float)
        for (iso, com), v in exposed:
            if com in ("crude", "products"):
                top_imp[iso] += v
        cps.append({**c, "routed": {k: r4(v) for k, v in t.items()},
                    "top_importers": [[iso, r4(v)] for iso, v in sorted(top_imp.items(), key=lambda kv: -kv[1])[:12]]})
    write("chokepoints.json", {"as_of": C.AS_OF, "chokepoints": cps, "portwatch": series,
                               "portwatch_names": {**{c["portwatch"]: c["name"] for c in C.CHOKEPOINTS if c.get("portwatch")},
                                                   **C.PORTWATCH_EXTRA}})

    # context.json
    monthly = {}
    key_producers = ["WORLD", "USA", "SAU", "RUS", "CAN", "IRQ", "ARE", "IRN", "CHN", "BRA", "KWT", "KAZ", "NOR",
                     "QAT", "MEX", "NGA", "LBY", "DZA", "GUY", "OMN", "AGO", "VEN", "BHR", "ARG"]
    for iso in key_producers:
        s = eia["monthly"].get("crude_prod_kbd", {}).get(iso)
        if s:
            months = sorted(s)
            monthly[iso] = {"start": months[0], "values": [r4(s[m]) for m in months]}
    prices_annual = {k: {str(y): r4(v) for y, v in ser.items() if y >= 2000} for k, ser in ei.prices.items()}
    write("context.json", {
        "as_of": C.AS_OF, "events": C.EVENTS, "market": C.MARKET, "market_sources": C.MARKET_SOURCE,
        "prices_annual": prices_annual, "monthly_crude": monthly,
        "monthly_source": {"label": "U.S. EIA International Energy Statistics (monthly)",
                           "url": "https://www.eia.gov/international/data/world", "updated": eia["last_updated"]},
        "pipelines": C.PIPELINES, "lng_terminals": C.LNG_TERMINALS,
        "world_2025": {
            "oil_prod_kbd": r4(ei.regions["oil_prod_kbd"]["WORLD"][2025]),
            "oil_cons_kbd": r4(ei.regions["oil_cons_kbd"]["WORLD"][2025]),
            "gas_prod_bcm": r4(ei.regions["gas_prod_bcm"]["WORLD"][2025]),
            "gas_cons_bcm": r4(ei.regions["gas_cons_bcm"]["WORLD"][2025]),
            "coal_prod_mt": r4(ei.regions["coal_prod_mt"]["WORLD"][2025]),
            "coal_cons_ej": r4(ei.regions["coal_cons_ej"]["WORLD"][2025]),
            "tes_ej": r4(ei.regions["tes_ej"]["WORLD"][2025]),
            "co2_mt": r4(ei.regions["co2_mt"]["WORLD"][2025]),
            "elec_twh": r4(ei.regions["elec_twh"]["WORLD"][2025]),
            "solar_twh": r4(ei.regions["solar_twh"]["WORLD"][2025]),
            "wind_twh": r4(ei.regions["wind_twh"]["WORLD"][2025]),
            "lng_trade_bcm": r4(sum(c["bcm"] for c in ei.lng_matrix["cells"])),
            "pipeline_trade_bcm": r4(sum(c["bcm"] for c in ei.pipe_matrix["cells"])),
            "crude_trade_kbd": r4(ot["Total World"][2025]["crude_imp"]),
            "product_trade_kbd": r4(ot["Total World"][2025]["prod_imp"]),
        },
        "world_2024": {m: r4(ei.regions[m]["WORLD"][2024]) for m in (
            "oil_prod_kbd", "oil_cons_kbd", "gas_prod_bcm", "gas_cons_bcm", "coal_prod_mt", "coal_cons_ej", "tes_ej",
            "co2_mt", "elec_twh", "solar_twh", "wind_twh", "lng_imp_bcm")},
        "coal_ej_per_mt": r4(ei.regions["coal_prod_ej"]["WORLD"][2025] / ei.regions["coal_prod_mt"]["WORLD"][2025]),
    })

    # meta.json
    write("meta.json", {
        "generated": date.today().isoformat(), "as_of": C.AS_OF, "data_year": 2025,
        "trade_retrieval_range": detail_snapshot["retrieval_range"],
        "trade_undated_source_files": detail_snapshot["undated_source_files"],
        "metrics": {k: {"label": v[0], "unit": v[1], "group": v[2], "scale": v[3], "decimals": v[4], "desc": v[5]}
                    for k, v in METRICS.items()},
        "sources": [
            REE.SOURCE,
            {"id": "EI", "label": "Energy Institute — Statistical Review of World Energy 2026", "vintage": "2025 data, published 30 Jun 2026",
             "url": "https://www.energyinst.org/statistical-review"},
            {"id": "EIA", "label": "U.S. EIA — International Energy Statistics", "vintage": f"updated {eia['last_updated'][:10]}",
             "url": "https://www.eia.gov/international/data/world"},
            {"id": "Ember", "label": "Ember — Yearly electricity data (via Our World in Data)", "vintage": "through 2025",
             "url": "https://ourworldindata.org/energy"},
            {"id": "Comtrade", "label": "UN Comtrade — bilateral trade (HS 2709, 2710, 2701, 2711)", "vintage": "2025 (2024 where 2025 not yet reported)",
             "url": "https://comtradeplus.un.org/"},
            {"id": "PortWatch", "label": "IMF PortWatch — daily chokepoint transits", "vintage": f"through {max(s['end'] for s in series.values())}",
             "url": "https://portwatch.imf.org/"},
            {"id": "EIA-WOTC", "label": "EIA — World Oil Transit Chokepoints", "vintage": "updated 3 Mar 2026",
             "url": "https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints"},
            {"id": "NE", "label": "Natural Earth boundaries (world-atlas 2.0)", "vintage": "1:50m and 1:110m",
             "url": "https://github.com/topojson/world-atlas"},
        ],
    })
    (OUT / "build_report.txt").write_text("\n".join(REPORT) + "\n")
    log("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
