"""
Our World in Data energy dataset — used for the electricity mix (Ember, through 2025)
and a few per-capita indicators for countries outside the Energy Institute coverage.
"""

from __future__ import annotations

import csv

ELECTRICITY = {
    "electricity_generation": "elec_twh",
    "coal_electricity": "coal",
    "gas_electricity": "gas",
    "oil_electricity": "oil",
    "nuclear_electricity": "nuclear",
    "hydro_electricity": "hydro",
    "solar_electricity": "solar",
    "wind_electricity": "wind",
    "biofuel_electricity": "bioenergy",
    "other_renewable_exc_biofuel_electricity": "other_renewables",
    "carbon_intensity_elec": "carbon_intensity",
    "electricity_demand": "demand_twh",
    "net_elec_imports": "net_imports_twh",
}
OTHER = {"population": "population", "energy_per_capita": "energy_pc_kwh"}


def _f(v):
    try:
        return float(v) if v not in ("", None) else None
    except ValueError:
        return None


def load(csv_path, first_year: int = 2000) -> dict:
    elec: dict[str, dict[int, dict[str, float]]] = {}
    other: dict[str, dict[str, dict[int, float]]] = {v: {} for v in OTHER.values()}
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            iso = row.get("iso_code", "")
            if len(iso) != 3 and iso != "OWID_WRL":
                continue
            iso = "WORLD" if iso == "OWID_WRL" else iso
            if iso.startswith("OWID"):
                continue
            year = int(row["year"])
            if year < first_year:
                continue
            rec = {out: _f(row.get(src)) for src, out in ELECTRICITY.items()}
            if rec["elec_twh"]:
                elec.setdefault(iso, {})[year] = {k: v for k, v in rec.items() if v is not None}
            for src, out in OTHER.items():
                v = _f(row.get(src))
                if v is not None:
                    other[out].setdefault(iso, {})[year] = v
    return {"electricity": elec, **other}
