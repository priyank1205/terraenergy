#!/usr/bin/env python3
"""
Download every raw source the data build needs into pipeline/cache/.

    python3 pipeline/fetch_sources.py            # fetch anything missing
    python3 pipeline/fetch_sources.py --refresh  # re-fetch API sources (Comtrade, PortWatch)
    python3 pipeline/fetch_sources.py --refresh --max-age 28 --budget 120
        # rolling refresh (the scheduled job): only Comtrade files retrieved more than 28 days ago,
        # at most 120 Comtrade calls, stopping quietly at the public API quota

Sources
-------
* Energy Institute, Statistical Review of World Energy 2026 (all-data workbook),
  via Our World in Data's public mirror of the EI file. md5-verified.
* U.S. EIA International Energy Statistics bulk file (INTL.zip).
* Our World in Data energy dataset (owid-energy-data.csv).
* Natural Earth country geometry via the world-atlas npm package.
* UN Comtrade public API: annual bilateral imports by reporter for
  HS 2709 (crude), 2710 (oil products), 2701 (coal), 271121 (pipeline gas).
* IMF PortWatch daily chokepoint transit counts (ArcGIS REST service).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
CACHE = ROOT / "pipeline" / "cache"
UA = {"User-Agent": "TerraEnergy-data-build/2.0"}

STATIC_FILES = [
    {
        "name": "ei_statistical_review_2026.xlsx",
        "url": "https://snapshots.owid.io/8c/eed4d558ceeb045fd90c499d2c4d8c",
        "md5": "8ceed4d558ceeb045fd90c499d2c4d8c",
    },
    {"name": "eia_INTL.zip", "url": "https://api.eia.gov/bulk/INTL.zip"},
    {
        "name": "owid-energy-data.csv",
        "url": "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv",
    },
    {"name": "countries-50m.json", "url": "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json"},
    {"name": "countries-110m.json", "url": "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"},
]

COMTRADE_URL = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
COMTRADE_REPORTERS_URL = "https://comtradeapi.un.org/files/v1/app/reference/Reporters.json"
COMTRADE_CODES = "2709,2710,2701,271121"
COMTRADE_YEARS = (2025, 2024)  # latest first; older year is only used as a fallback

# Importers queried (ISO3). Covers effectively all significant crude, product, coal and
# pipeline-gas importers. Non-reporting economies (e.g. Taiwan, Iran, Venezuela) are
# picked up from their partners' reports at build time.
COMTRADE_IMPORTERS = """
CHN IND JPN KOR SGP THA MYS IDN PHL VNM PAK BGD LKA HKG MMR KHM LAO NPL MNG KAZ UZB KGZ TJK
AUS NZL PNG FJI
ARE SAU KWT QAT BHR OMN JOR LBN ISR TUR IRQ YEM
DEU NLD BEL FRA ITA ESP PRT GBR IRL SWE DNK FIN NOR POL CZE SVK HUN AUT CHE SVN HRV SRB BIH
MKD ALB MNE GRC CYP MLT BGR ROU MDA UKR BLR LTU LVA EST ISL LUX GEO ARM AZE
USA CAN MEX BRA ARG CHL PER COL ECU URY PRY BOL PAN CRI GTM HND SLV NIC DOM JAM TTO BHS GUY SUR
EGY MAR TUN DZA ZAF NGA GHA CIV SEN KEN TZA UGA MOZ ZMB ZWE BWA NAM ETH AGO CMR MDG MUS SDN
RWA MWI BEN TGO MLI BFA
""".split()

PORTWATCH_URL = (
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/"
    "Daily_Chokepoints_Data/FeatureServer/0/query"
)
PORTWATCH_START_YEAR = 2019


def log(msg: str) -> None:
    print(msg, flush=True)


def md5sum(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path, expected_md5: str | None = None) -> None:
    log(f"  downloading {url}")
    with requests.get(url, headers=UA, stream=True, timeout=300) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with tmp.open("wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    if expected_md5 and md5sum(tmp) != expected_md5:
        tmp.unlink()
        raise RuntimeError(f"md5 mismatch for {dest.name}")
    tmp.replace(dest)


def fetch_static(refresh: bool = False) -> None:
    log("Static files")
    for spec in STATIC_FILES:
        dest = CACHE / spec["name"]
        mutable = spec["name"] in ("eia_INTL.zip", "owid-energy-data.csv")
        if dest.exists() and not (refresh and mutable) and (not spec.get("md5") or md5sum(dest) == spec["md5"]):
            log(f"  ok   {spec['name']}")
            continue
        download(spec["url"], dest, spec.get("md5"))
        log(f"  got  {spec['name']} ({dest.stat().st_size / 1e6:.1f} MB)")


def get_json(url: str, params: dict | None = None, retries: int = 6) -> dict:
    delay = 2.0
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=120)
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            payload = r.json()
            if isinstance(payload, dict) and payload.get("error"):
                raise ValueError(f"Source returned an error: {payload['error']}")
            if isinstance(payload, dict) and "comtradeapi.un.org" in url:
                payload["retrieved_at"] = datetime.now(timezone.utc).isoformat()
                payload["source_url"] = r.url
            return payload
        except (requests.RequestException, ValueError) as exc:
            if attempt == retries - 1:
                raise
            log(f"    retry in {delay:.0f}s ({exc})")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


class QuotaReached(RuntimeError):
    """This run's Comtrade call budget is spent, or the public API refused on quota grounds."""


# Comtrade's public API has a call quota. A refresh can be limited to files older than `max_age_days` and to
# `calls_left` calls; fresh files are skipped, so successive scheduled runs work through the rest of the cache.
COMTRADE_LIMITS: dict = {"max_age_days": None, "calls_left": None}


def comtrade_get(params: dict) -> dict:
    """One Comtrade data call, counted against the run's budget. Raises QuotaReached instead of failing."""
    if COMTRADE_LIMITS["calls_left"] is not None:
        if COMTRADE_LIMITS["calls_left"] <= 0:
            raise QuotaReached("this run's call budget is spent")
        COMTRADE_LIMITS["calls_left"] -= 1
    try:
        return get_json(COMTRADE_URL, params)
    except requests.HTTPError as exc:
        # The API gateway answers 429 when throttling and 403 when the call-volume quota is used up.
        if re.search(r"\b(403|429)\b", str(exc)):
            raise QuotaReached(f"the public API refused further calls ({exc})") from exc
        raise


def needs_fetch(dest: Path, refresh: bool) -> bool:
    """Whether a cached Comtrade response should be downloaded (again)."""
    if not dest.exists():
        return True
    if not refresh:
        return False
    max_age = COMTRADE_LIMITS["max_age_days"]
    if max_age is None:
        return True
    retrieved = json.loads(dest.read_text()).get("retrieved_at")
    # Files saved before retrieval times were recorded count as oldest.
    return not retrieved or datetime.fromisoformat(retrieved) < datetime.now(timezone.utc) - timedelta(days=max_age)


def stamped(rows: list) -> dict:
    """A payload assembled from per-commodity calls, with the retrieval metadata single calls carry."""
    return {"data": rows, "split": True, "retrieved_at": datetime.now(timezone.utc).isoformat(), "source_url": COMTRADE_URL}


def save_response(dest: Path, payload: dict) -> list:
    """Cache a Comtrade response and return its rows. An empty response never replaces earlier rows: that is far
    more often a transient gap in the API than withdrawn data, and it would silently drop the importer to its
    fallback year. The file keeps its old retrieval time, so the next refresh tries again."""
    rows = payload.get("data") or []
    if not rows and dest.exists():
        earlier = json.loads(dest.read_text()).get("data") or []
        if earlier:
            log(f"  kept earlier {dest.name}: the new response was empty")
            return earlier
    dest.write_text(json.dumps(payload))
    return rows


def comtrade_reporter_codes() -> dict[str, int]:
    ref_path = CACHE / "comtrade" / "reporters.json"
    if not ref_path.exists():
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        ref_path.write_text(json.dumps(get_json(COMTRADE_REPORTERS_URL)))
    ref = json.loads(ref_path.read_text())
    codes: dict[str, int] = {}
    for row in ref.get("results", []):
        iso = row.get("reporterCodeIsoAlpha3")
        # Prefer current (non-historical) entries.
        if iso and not row.get("isGroup") and (row.get("entryExpiredDate") in (None, "")):
            codes.setdefault(iso, int(row["id"]))
    codes.setdefault("TWN", 490)
    return codes


def fetch_comtrade(refresh: bool) -> None:
    log("UN Comtrade bilateral imports")
    out_dir = CACHE / "comtrade"
    out_dir.mkdir(parents=True, exist_ok=True)
    codes = comtrade_reporter_codes()
    missing = [iso for iso in COMTRADE_IMPORTERS if iso not in codes]
    if missing:
        log(f"  no Comtrade reporter code for: {' '.join(missing)}")

    for iso in COMTRADE_IMPORTERS:
        if iso not in codes:
            continue
        for year in COMTRADE_YEARS:
            dest = out_dir / f"imports_{iso}_{year}.json"
            if not needs_fetch(dest, refresh):
                rows = json.loads(dest.read_text()).get("data") or []
                if rows:
                    break
                continue
            params = dict(
                reporterCode=codes[iso], period=year, cmdCode=COMTRADE_CODES, flowCode="M",
                customsCode="C00", motCode=0, partner2Code=0,
            )
            payload = comtrade_get(params)
            rows = payload.get("data") or []
            if len(rows) >= 500:  # preview cap hit: split the request per commodity
                rows = []
                for code in COMTRADE_CODES.split(","):
                    part = comtrade_get({**params, "cmdCode": code})
                    subset = part.get("data") or []
                    if len(subset) >= 500:
                        raise RuntimeError(f"Truncated Comtrade imports: {iso} {year} {code}")
                    rows.extend(subset)
                    time.sleep(1.2)
                payload = stamped(rows)
            rows = save_response(dest, payload)
            log(f"  {iso} {year}: {len(rows)} rows")
            time.sleep(1.2)
            if rows:
                break  # latest year found; skip the fallback year


# Importers that do not report to Comtrade (or reported nothing recent): their imports are
# reconstructed from partners' export declarations ("mirror" data).
COMTRADE_MIRROR_IMPORTERS = """
TWN VNM ARE BGD BLR MNG NPL LAO ETH SDN PNG CMR MLI BWA RWA TJK IRN CUB VEN SYR LBY PRK AFG TKM
KGZ ARM AZE KHM IRQ QAT MMR
""".split()


def fetch_comtrade_mirror(refresh: bool) -> None:
    log("UN Comtrade mirror exports (partners of non-reporting importers)")
    out_dir = CACHE / "comtrade"
    out_dir.mkdir(parents=True, exist_ok=True)
    codes = comtrade_reporter_codes()
    for iso in COMTRADE_MIRROR_IMPORTERS:
        partner = 490 if iso == "TWN" else codes.get(iso)
        if partner is None:
            log(f"  no partner code for {iso}")
            continue
        for year in COMTRADE_YEARS:
            dest = out_dir / f"mirror_{iso}_{year}.json"
            if not needs_fetch(dest, refresh):
                if json.loads(dest.read_text()).get("data"):
                    break
                continue
            params = dict(
                period=year, partnerCode=partner, cmdCode=COMTRADE_CODES, flowCode="X",
                customsCode="C00", motCode=0, partner2Code=0,
            )
            payload = comtrade_get(params)
            rows = payload.get("data") or []
            if len(rows) >= 500:
                rows = []
                for code in COMTRADE_CODES.split(","):
                    part = comtrade_get({**params, "cmdCode": code})
                    subset = part.get("data") or []
                    if len(subset) >= 500:
                        raise RuntimeError(f"Truncated Comtrade mirror data: {iso} {year} {code}")
                    rows.extend(subset)
                    time.sleep(1.2)
                payload = stamped(rows)
            rows = save_response(dest, payload)
            log(f"  {iso} {year}: {len(rows)} rows")
            time.sleep(1.2)
            if rows:
                break


# LNG (HS 271111) importer detail, used only to split the Energy Institute's aggregate
# rows/columns ("Other EU", "Other Africa", …) into individual countries.
COMTRADE_LNG_IMPORTERS = """
NLD DEU POL PRT GRC LTU HRV FIN SWE MLT IRL CYP EST LVA COL DOM JAM PAN PRI SLV JOR ISR BHR GHA
BGD PHL HKG IDN MMR LKA JPN CHN KOR IND THA PAK SGP ESP FRA ITA BEL GBR TUR EGY KWT BRA ARG CHL
MEX CAN MYS
""".split()


def fetch_comtrade_lng(refresh: bool) -> None:
    log("UN Comtrade LNG imports (HS 271111)")
    out_dir = CACHE / "comtrade"
    codes = comtrade_reporter_codes()
    for iso in COMTRADE_LNG_IMPORTERS:
        if iso not in codes:
            continue
        for year in COMTRADE_YEARS:
            dest = out_dir / f"lng_{iso}_{year}.json"
            if not needs_fetch(dest, refresh):
                if json.loads(dest.read_text()).get("data"):
                    break
                continue
            params = dict(reporterCode=codes[iso], period=year, cmdCode="271111", flowCode="M",
                          customsCode="C00", motCode=0, partner2Code=0)
            payload = comtrade_get(params)
            rows = save_response(dest, payload)
            log(f"  {iso} {year}: {len(rows)} rows")
            time.sleep(1.2)
            if rows:
                break


def fetch_portwatch(refresh: bool) -> None:
    log("IMF PortWatch daily chokepoint transits")
    dest = CACHE / "portwatch_chokepoints_daily.json"
    if dest.exists() and not refresh:
        log("  ok   cached")
        return
    records: list[dict] = []
    for year in range(PORTWATCH_START_YEAR, time.gmtime().tm_year + 1):
        for half in ((f"{year}-01-01", f"{year}-07-01"), (f"{year}-07-01", f"{year + 1}-01-01")):
            offset = 0
            while True:
                params = {
                    "where": f"date >= timestamp '{half[0]} 00:00:00' AND date < timestamp '{half[1]} 00:00:00'",
                    "outFields": "*",
                    "orderByFields": "date,portid",
                    "resultOffset": offset,
                    "resultRecordCount": 2000,
                    "f": "json",
                }
                payload = get_json(PORTWATCH_URL, params)
                feats = payload.get("features") or []
                records.extend(f["attributes"] for f in feats)
                if not payload.get("exceededTransferLimit") or not feats:
                    break
                offset += len(feats)
                time.sleep(0.4)
        log(f"  {year}: {len(records)} records so far")
    dest.write_text(json.dumps(records))
    log(f"  saved {len(records)} records")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="re-download API sources")
    ap.add_argument("--only", choices=["static", "comtrade", "mirror", "lng", "rare-earths", "portwatch"], help="fetch a single source")
    ap.add_argument("--max-age", type=float, metavar="DAYS",
                    help="with --refresh: re-fetch only Comtrade files retrieved more than DAYS ago")
    ap.add_argument("--budget", type=int, metavar="CALLS", help="at most CALLS Comtrade data calls in this run")
    args = ap.parse_args()
    COMTRADE_LIMITS.update(max_age_days=args.max_age, calls_left=args.budget)
    CACHE.mkdir(parents=True, exist_ok=True)
    if args.only in (None, "static"):
        fetch_static(args.refresh)
    if args.only in (None, "portwatch"):
        fetch_portwatch(args.refresh)
    try:
        if args.only in (None, "comtrade"):
            fetch_comtrade(args.refresh)
        if args.only in (None, "mirror"):
            fetch_comtrade_mirror(args.refresh)
        if args.only in (None, "lng"):
            fetch_comtrade_lng(args.refresh)
        if args.only in (None, "rare-earths"):
            from pipeline.sources.rare_earths import fetch
            fetch(args.refresh)
    except QuotaReached as exc:
        # Every file is written only after a successful call, so the cache stays complete, just partly older.
        log(f"Stopped Comtrade updates: {exc}. Files not reached keep their earlier retrieval.")
    if args.budget is not None:
        log(f"Comtrade calls used: {args.budget - COMTRADE_LIMITS['calls_left']} of {args.budget}")
    log("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
