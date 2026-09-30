"""Auditable bilateral customs records. No price-imputed weights or mirror averaging.

The map is an annual overview. This module retains the original units, values,
flags and each reporter's publication date for its separate product explorer.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from pipeline.sources.comtrade import _code_maps
from pipeline.fetch_sources import comtrade_reporter_codes

PRODUCTS = {
    "2701": ("coal", "Coal — aggregate category"),
    "270111": ("coal", "Anthracite coal"),
    "270112": ("coal", "Bituminous coal"),
    "270119": ("coal", "Other coal, not agglomerated"),
    "270120": ("coal", "Coal briquettes and similar solid fuels"),
    "2709": ("crude", "Crude petroleum — aggregate category"),
    "270900": ("crude", "Crude petroleum oils and oils from bituminous minerals"),
    "2710": ("products", "Petroleum oils and preparations — aggregate category"),
    "271000": ("products", "Petroleum oils and preparations — legacy classification"),
    "271011": ("products", "Light petroleum oils and preparations — legacy classification"),
    "271012": ("products", "Light petroleum oils and preparations"),
    "271019": ("products", "Other petroleum oils and preparations"),
    "271020": ("products", "Petroleum oils and preparations containing biodiesel"),
    "271091": ("products", "Waste oils containing PCBs, PCTs or PBBs"),
    "271099": ("products", "Other waste petroleum oils"),
    "271111": ("lng", "Liquefied natural gas (LNG)"),
    "271121": ("pipeline_gas", "Natural gas in gaseous state"),
    "280530": ("rare_earths", "Rare earth metals, scandium and yttrium, including mixtures and alloys"),
    "284610": ("rare_earths", "Cerium compounds"),
    "284690": ("rare_earths", "Other rare earth, yttrium and scandium compounds"),
}
DETAIL_CODES = [c for c in PRODUCTS if len(c) == 6]
BASE = "https://comtradeapi.un.org/public/v1"
CACHE = ROOT / "pipeline/cache/bilateral"
TTL = 6 * 3600
_request_lock = threading.Lock()
_last_request = 0.0


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def number(value):
    return value if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 else None


def normalize(row, reporter, partner, retrieved_at=None, released=None, source_url=None):
    code = str(row.get("cmdCode", ""))
    flow = row.get("flowCode")
    if code not in PRODUCTS or flow not in ("M", "X") or reporter == partner:
        return None
    if row.get("partner2Code", 0) != 0 or row.get("motCode", 0) != 0 or row.get("customsCode", "C00") != "C00":
        return None
    exp, imp = (reporter, partner) if flow == "X" else (partner, reporter)
    weight = number(row.get("netWgt"))
    weight_kind = "net weight"
    estimated = bool(row.get("isNetWgtEstimated"))
    if not weight:
        weight = None
        if row.get("qtyUnitCode") == 8 and number(row.get("qty")):
            weight = row["qty"]
            estimated = bool(row.get("isQtyEstimated"))
            weight_kind = "reported quantity in kg"
    return {
        "exporter": exp, "importer": imp, "reporter": reporter, "flow": flow,
        "hs": code, "category": PRODUCTS[code][0], "product": PRODUCTS[code][1],
        "period": str(row.get("period") or row.get("refYear", "")), "frequency": row.get("freqCode", "A"),
        "classification": row.get("classificationCode"), "original_classification": row.get("isOriginalClassification"),
        "tonnes": weight / 1000 if weight is not None else None, "weight_basis": weight_kind,
        "weight_estimated": estimated if weight is not None else False,
        "usd": number(row.get("primaryValue")), "cif_usd": number(row.get("cifvalue")),
        "fob_usd": number(row.get("fobvalue")), "reported": row.get("isReported"),
        "aggregate": row.get("isAggregate"), "quantity": number(row.get("qty")),
        "quantity_unit_code": row.get("qtyUnitCode"), "quantity_estimated": row.get("isQtyEstimated"),
        "retrieved_at": retrieved_at, "released": released, "source_url": source_url,
    }


def api(path, params):
    import requests
    global _last_request
    for attempt in range(3):
        # Bound public API traffic across simultaneous local browser requests.
        with _request_lock:
            time.sleep(max(0, 1.3 - (time.monotonic() - _last_request)))
            _last_request = time.monotonic()
        response = requests.get(f"{BASE}/{path}", params=params, timeout=(10, 35))
        if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            time.sleep(2 ** (attempt + 1))
            continue
        response.raise_for_status()
        payload = response.json()
        if payload.get("error"):
            raise ValueError(str(payload["error"]))
        if not isinstance(payload.get("data"), list):
            raise ValueError("UN Comtrade returned no data array")
        if len(payload["data"]) >= 500:
            raise ValueError("UN Comtrade preview limit reached; incomplete results were rejected")
        return payload["data"], response.url
    raise RuntimeError("UN Comtrade unavailable")


def latest_dataset(reporter_code, frequency, today=None):
    today = today or date.today()
    if frequency == "A":
        chunks = [[str(y) for y in range(today.year - 1, today.year - 6, -1)]]
    else:
        end = today.year * 12 + today.month - 2  # latest completed calendar month
        periods = [f"{n // 12:04d}{n % 12 + 1:02d}" for n in range(end, end - 36, -1)]
        chunks = [periods[i:i + 12] for i in range(0, len(periods), 12)]
    for periods in chunks:
        rows, url = api(f"getDA/C/{frequency}/HS", {"reporterCode": reporter_code, "period": ",".join(periods)})
        rows = [r for r in rows if str(r.get("period")) in periods
                and r.get("reporterCode") == reporter_code and r.get("isOriginalClassification") is not False]
        if rows:
            return max(rows, key=lambda r: (int(r["period"]), r.get("lastReleased") or "")), url
    return None, url


def reporter_snapshot(reporter, partner, frequency, refresh=False):
    codes = comtrade_reporter_codes()
    partners, _ = _code_maps(ROOT / "pipeline/cache/comtrade")
    partner_codes = {iso: code for code, iso in partners.items()}
    # Prefer current codes over historical aliases (USA has 840, 841 and 842).
    for iso, code in codes.items():
        if partners.get(code) == iso:
            partner_codes[iso] = code
    if reporter not in codes or partner not in partner_codes:
        return {"reporter": reporter, "partner": partner, "frequency": frequency, "status": "unavailable", "records": [],
                "message": "No current UN Comtrade reporter or partner code."}
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{reporter}-{partner}-{frequency}.json"
    saved = json.loads(path.read_text()) if path.exists() else None
    if saved and saved.get("source_url"):
        query = parse_qs(urlparse(saved["source_url"]).query)
        if query.get("reporterCode") != [str(codes[reporter])] or query.get("partnerCode") != [str(partner_codes[partner])]:
            saved = None  # never reuse a snapshot queried under a historical country code
    if saved and not refresh and time.time() - path.stat().st_mtime < TTL:
        return {**saved, "cached": True}
    try:
        dataset, availability_url = latest_dataset(codes[reporter], frequency)
        result = {"reporter": reporter, "partner": partner, "frequency": frequency,
                  "checked_at": utc_now(), "availability_url": availability_url, "cached": False, "records": []}
        if dataset is None:
            result.update(status="unavailable", message="No published monthly dataset in the last 36 months." if frequency == "M"
                          else "No published annual dataset in the last five completed years.")
        else:
            period = str(dataset["period"])
            params = dict(reporterCode=codes[reporter], partnerCode=partner_codes[partner], period=period,
                          cmdCode=",".join(DETAIL_CODES), flowCode="M,X", customsCode="C00", motCode=0, partner2Code=0)
            rows, source_url = api(f"preview/C/{frequency}/HS", params)
            records = []
            seen = set()
            for row in rows:
                if row.get("reporterCode") != codes[reporter] or row.get("partnerCode") != partner_codes[partner] or str(row.get("period")) != period:
                    raise ValueError("Unexpected reporter, partner or period in the response")
                record = normalize(row, reporter, partner, utc_now(), dataset.get("lastReleased"), source_url)
                if record:
                    key = (record["hs"], record["flow"])
                    if key in seen:
                        raise ValueError("Duplicate product declaration; results were not summed")
                    seen.add(key)
                    records.append(record)
            result.update(status="ok", period=period, released=dataset.get("lastReleased"),
                          classification=dataset.get("classificationCode"), source_url=source_url, records=records)
        # Only verified responses replace the last successful snapshot.
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        tmp.replace(path)
        return result
    except Exception as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        reason = "UN Comtrade request quota/rate limit reached" if status_code in (403, 429) else f"UN Comtrade unavailable ({type(exc).__name__})"
        if saved:
            return {**saved, "status": "stale", "cached": True,
                    "warning": f"{reason}; showing the last successful retrieval."}
        return {"reporter": reporter, "partner": partner, "frequency": frequency, "status": "error", "records": [],
                "warning": f"{reason}. Retry later; missing data is not zero trade."}


_lock_guard = threading.Lock()
_pair_locks = {}


def fetch_pair(a, b, frequency="A", refresh=False):
    from pipeline.lib.countries import COUNTRIES
    if a not in COUNTRIES or b not in COUNTRIES or a == b or frequency not in ("A", "M"):
        raise ValueError("Choose two different countries and annual or monthly reports")
    # Serialize only requests for the same pair/frequency, preventing cache races.
    with _lock_guard:
        lock = _pair_locks.setdefault((*sorted((a, b)), frequency), threading.Lock())
    with lock, ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(reporter_snapshot, x, y, frequency, refresh) for x, y in ((a, b), (b, a))]
        snapshots = [job.result() for job in jobs]
    return {"a": a, "b": b, "frequency": frequency, "snapshots": snapshots,
            "products": PRODUCTS, "scope": "Energy and rare earth product groups only; not total merchandise trade."}


def build_snapshot(cache_dir, output):
    """Expose original cached declarations, including value-only and tiny trades."""
    cache = Path(cache_dir)
    partners, reporters = _code_maps(cache)
    records = {}
    coverage = []
    undated = 0
    for path in sorted(cache.glob("*.json")):
        if not path.name.startswith(("imports_", "mirror_", "lng_", "rare_")):
            continue
        payload = json.loads(path.read_text())
        if payload.get("data") and not payload.get("retrieved_at"):
            undated += 1
        for row in payload.get("data") or []:
            reporter = reporters.get(row.get("reporterCode"))
            partner = partners.get(row.get("partnerCode"))
            if not reporter or not partner:
                continue
            rec = normalize(row, reporter, partner, payload.get("retrieved_at"), source_url=payload.get("source_url"))
            if rec:
                key = (reporter, partner, rec["period"], rec["hs"], rec["flow"])
                previous = records.get(key)
                if previous is None or (rec["retrieved_at"] or "") > (previous["retrieved_at"] or ""):
                    records[key] = rec
        if payload.get("retrieved_at"):
            coverage.append(payload["retrieved_at"])
    result = {"generated_at": utc_now(), "retrieval_range": [min(coverage), max(coverage)] if coverage else None,
              "undated_source_files": undated,
              "products": PRODUCTS, "records": list(records.values())}
    Path(output).write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair", nargs=2)
    parser.add_argument("--frequency", choices=["A", "M"], default="A")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.pair:
        result = fetch_pair(*args.pair, frequency=args.frequency, refresh=args.refresh)
        out = Path(args.output or f"public/data/bilateral/{'-'.join(sorted(args.pair))}-{args.frequency}.json")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        print(json.dumps({"file": str(out), "snapshots": [{k: s.get(k) for k in ("reporter", "status", "period", "released", "warning")} for s in result["snapshots"]]}))
    else:
        result = build_snapshot(ROOT / "pipeline/cache/comtrade", args.output or ROOT / "public/data/trade_details.json")
        print(f"Wrote {len(result['records'])} original trade declarations")
