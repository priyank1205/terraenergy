"""
Pipeline tests. Run from the project root:

    python3 -m unittest discover -s pipeline/tests -t .

Tests that need downloaded sources or built outputs skip themselves when those are absent.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from pipeline.lib import overland as L
from pipeline.lib import sealanes as S
from pipeline.lib.countries import COUNTRIES, EI_NAMES, NUM_TO_ISO3, flag_emoji
from pipeline.sources import comtrade as CT

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "pipeline" / "cache"
OUT = ROOT / "public" / "data"


class SeaLaneGraph(unittest.TestCase):
    def test_edges_reference_known_nodes(self):
        for a, b, kind, _ in S.EDGES:
            self.assertIn(a, S.NODES, f"{a} in edge {a}-{b}")
            self.assertIn(b, S.NODES, f"{b} in edge {a}-{b}")
            self.assertIn(kind, {"sea", "strait", "canal"})

    def test_graph_is_connected(self):
        adj = S._adjacency()
        seen, stack = set(), ["HORMUZ"]
        while stack:
            n = stack.pop()
            if n not in seen:
                seen.add(n)
                stack.extend(v for v, *_ in adj[n])
        self.assertEqual(set(S.NODES) - seen, set())

    def test_terminals_point_at_nodes(self):
        for table in (S.EXPORT_TERMINALS, S.IMPORT_TERMINALS):
            for iso, terms in table.items():
                for t in terms:
                    self.assertIn(t["node"], S.NODES, f"{iso}: {t}")

    @unittest.skipUnless((CACHE / "countries-50m.json").exists(), "Natural Earth geometry not downloaded")
    def test_sea_lanes_do_not_cross_land(self):
        from pipeline.lib.topo import LandMask, great_circle_points
        mask = LandMask(json.loads((CACHE / "countries-50m.json").read_text()))
        bad = []
        for a, b, kind, _ in S.EDGES:
            if kind != "sea":
                continue
            pts = great_circle_points(S.NODES[a], S.NODES[b], 0.1)
            if any(mask.on_land(*p) for p in pts[1:-1]):
                bad.append(f"{a}-{b}")
        self.assertEqual(bad, [])


class Routing(unittest.TestCase):
    def cps(self, a, b, **profile):
        _, path = S.shortest_path(a, b, profile)
        return S.path_chokepoints(path)

    def test_gulf_to_china_via_hormuz_and_malacca(self):
        cps = self.cps("PG_RAS_TANURA", "NINGBO")
        self.assertIn("hormuz", cps)
        self.assertIn("malacca", cps)

    def test_red_sea_avoidance_sends_gulf_cargo_round_the_cape(self):
        cps = self.cps("PG_RAS_TANURA", "ROTTERDAM", avoid_red_sea=True)
        self.assertIn("cape_good_hope", cps)
        self.assertNotIn("suez", cps)

    def test_yanbu_reaches_europe_through_suez_without_bab_el_mandeb(self):
        cps = self.cps("YANBU", "ROTTERDAM", avoid_red_sea=True)
        self.assertIn("suez", cps)
        self.assertNotIn("bab_el_mandeb", cps)

    def test_vlcc_crude_and_lng_avoid_panama(self):
        self.assertNotIn("panama", self.cps("USG_HOUSTON", "TOKYO", commodity="crude", avoid_red_sea=True))
        self.assertNotIn("panama", self.cps("SABINE", "TOKYO", commodity="lng", avoid_red_sea=True))
        self.assertIn("panama", self.cps("USG_HOUSTON", "QUINTERO", commodity="products"))

    def test_distances_are_plausible(self):
        d, _ = S.shortest_path("PG_RAS_TANURA", "NINGBO")
        self.assertTrue(5200 < d < 6500, d)  # published sea distance ≈ 5,900 nm


class Countries(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(NUM_TO_ISO3["840"], "USA")
        self.assertEqual(NUM_TO_ISO3["156"], "CHN")
        self.assertEqual(flag_emoji("JPN"), "🇯🇵")
        for name, iso in EI_NAMES.items():
            self.assertIn(iso, COUNTRIES, name)


class Conversions(unittest.TestCase):
    def test_barrels_per_tonne_follow_density(self):
        heavy = CT.barrels_per_tonne("CAN")
        light = CT.barrels_per_tonne("KAZ")
        self.assertTrue(6.7 < heavy < 7.0, heavy)
        self.assertTrue(7.7 < light < 7.9, light)
        self.assertEqual(CT.barrels_per_tonne("XXX"), 7.33)

    def test_to_native_units(self):
        one_mt = 1_000_000.0
        crude = CT.to_native({"commodity": "crude", "hs": "2709", "exporter": "SAU", "tonnes": one_mt})
        self.assertAlmostEqual(crude, one_mt * CT.barrels_per_tonne("SAU") / 365 / 1000)
        self.assertAlmostEqual(CT.to_native({"commodity": "coal", "hs": "2701", "exporter": "AUS", "tonnes": one_mt}), 1.0)
        self.assertAlmostEqual(CT.to_native({"commodity": "lng", "hs": "271111", "exporter": "QAT", "tonnes": 0.73e6}), 1.0)

    def test_plausibility_drops_catch_all_mirror_rows(self):
        rows = [
            {"importer": "TWN", "exporter": "USA", "commodity": "crude", "hs": "2709", "tonnes": 12e6, "source": "mirror"},
            {"importer": "TWN", "exporter": "SAU", "commodity": "crude", "hs": "2709", "tonnes": 258e6, "source": "mirror"},
            {"importer": "JPN", "exporter": "SAU", "commodity": "crude", "hs": "2709", "tonnes": 40e6, "source": "importer"},
        ]
        kept = CT.apply_plausibility(rows, {("TWN", "crude"): 1300.0}, lambda *_: None)
        self.assertEqual(sorted((r["importer"], r["exporter"]) for r in kept), [("JPN", "SAU"), ("TWN", "USA")])


class OverlandRules(unittest.TestCase):
    NB = {
        "CHN": ["IND", "KAZ", "MNG", "RUS"], "IND": ["CHN", "NPL", "PAK"], "NPL": ["IND"], "PAK": ["IND"],
        "KAZ": ["CHN", "RUS", "UZB"], "UZB": ["KAZ"], "MNG": ["CHN", "RUS"], "RUS": ["CHN", "KAZ", "MNG", "POL"],
        "POL": ["RUS", "DEU"], "DEU": ["POL", "AUT"], "AUT": ["DEU"], "FRA": ["BRA"], "BRA": ["FRA"],
    }
    LP = {iso: [i * 5.0, 40.0] for i, iso in enumerate(NB)}

    def plan(self, a, b, c="products"):
        return L.land_plan(a, b, c, self.NB, self.LP)

    def test_closed_and_overseas_borders_go_by_sea(self):
        self.assertIsNone(self.plan("CHN", "IND"))
        self.assertIsNone(self.plan("BRA", "FRA"))
        self.assertIsNone(self.plan("IND", "PAK", "coal"))

    def test_open_borders_and_landlocked_partners_go_overland(self):
        self.assertEqual(self.plan("IND", "NPL"), ("overland", ["IND", "NPL"]))
        self.assertEqual(self.plan("MNG", "CHN", "coal"), ("overland", ["MNG", "CHN"]))
        self.assertEqual(self.plan("RUS", "UZB"), ("overland", ["RUS", "KAZ", "UZB"]))

    def test_kaliningrad_is_not_a_freight_corridor(self):
        self.assertIsNone(self.plan("RUS", "POL"))

    def test_crude_needs_a_real_pipeline_or_rail_link(self):
        self.assertEqual(self.plan("POL", "DEU", "crude"), ("pipeline", ["POL", "DEU"]))
        self.assertIsNone(self.plan("DEU", "POL", "crude"))
        self.assertEqual(self.plan("KAZ", "UZB", "crude"), ("overland", ["KAZ", "UZB"]))

    def test_lng_is_always_seaborne(self):
        self.assertIsNone(self.plan("RUS", "CHN", "lng"))

    def test_land_line_passes_a_border_crossing(self):
        line = L.land_line(["CHN", "RUS"], {"CHN": [104.0, 36.0], "RUS": [95.0, 61.0]}, {})
        crossings = [list(p) for p in L.CROSSINGS[frozenset(("CHN", "RUS"))]]  # Manzhouli, Suifenhe, …; never the Altai
        self.assertTrue(any(p in crossings for p in line), line)
        self.assertGreaterEqual(len(line), 3)


class RollingRefresh(unittest.TestCase):
    def setUp(self):
        from pipeline import fetch_sources as F
        self.F = F
        self.saved = dict(F.COMTRADE_LIMITS)

    def tearDown(self):
        self.F.COMTRADE_LIMITS.update(self.saved)

    def test_only_stale_or_undated_files_are_refetched_when_a_max_age_is_set(self):
        import tempfile
        from datetime import datetime, timedelta, timezone
        F = self.F
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            ago = lambda days: (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            files = {"fresh": {"retrieved_at": ago(3)}, "stale": {"retrieved_at": ago(40)}, "undated": {"data": []}}
            for name, payload in files.items():
                (tmp / name).write_text(json.dumps(payload))
            self.assertTrue(F.needs_fetch(tmp / "missing", refresh=False))
            self.assertFalse(F.needs_fetch(tmp / "stale", refresh=False))
            F.COMTRADE_LIMITS.update(max_age_days=None)
            self.assertTrue(F.needs_fetch(tmp / "fresh", refresh=True))  # a plain --refresh refetches everything
            F.COMTRADE_LIMITS.update(max_age_days=28)
            self.assertEqual([F.needs_fetch(tmp / n, refresh=True) for n in files], [False, True, True])

    def test_an_empty_response_never_replaces_earlier_rows(self):
        import tempfile
        F = self.F
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "imports_UGA_2025.json"
            dest.write_text(json.dumps({"data": [{"row": 1}], "retrieved_at": "2026-08-01T00:00:00+00:00"}))
            self.assertEqual(F.save_response(dest, {"data": [], "retrieved_at": "2026-09-30T00:00:00+00:00"}), [{"row": 1}])
            self.assertEqual(json.loads(dest.read_text())["retrieved_at"], "2026-08-01T00:00:00+00:00")
            self.assertEqual(F.save_response(dest, {"data": [{"row": 2}]}), [{"row": 2}])
            new = Path(tmp) / "imports_XXX_2025.json"
            self.assertEqual(F.save_response(new, {"data": []}), [])
            self.assertTrue(new.exists())  # a genuinely empty first answer is still cached

    def test_calls_stop_at_the_budget_or_the_api_quota(self):
        import requests
        from unittest import mock
        F = self.F
        F.COMTRADE_LIMITS.update(calls_left=2)
        with mock.patch.object(F, "get_json", return_value={"data": []}) as get:
            F.comtrade_get({})
            F.comtrade_get({})
            with self.assertRaises(F.QuotaReached):
                F.comtrade_get({})
            self.assertEqual(get.call_count, 2)
        F.COMTRADE_LIMITS.update(calls_left=None)
        for refusal in ("HTTP 429", "403 Client Error: Out of call volume quota"):
            with mock.patch.object(F, "get_json", side_effect=requests.HTTPError(refusal)):
                with self.assertRaises(F.QuotaReached):
                    F.comtrade_get({})
        with mock.patch.object(F, "get_json", side_effect=requests.HTTPError("HTTP 500")):
            with self.assertRaises(requests.HTTPError):
                F.comtrade_get({})


class RefreshGuard(unittest.TestCase):
    def files(self, crude_flows=100, crude_v=40000.0, lng_flows=50, metric_rows=90, pw_end="2026-09-27"):
        flows = [{"c": "crude", "v": crude_v / crude_flows} for _ in range(crude_flows)]
        flows += [{"c": "lng", "v": 10.0} for _ in range(lng_flows)]
        return {
            "flows.json": {"flows": flows},
            "latest.json": {"oil_prod_kbd": {f"C{i:02d}": [1.0, 2025, "EI"] for i in range(metric_rows)}},
            "countries.json": {"countries": [{}] * 200},
            "chokepoints.json": {"chokepoints": [{}] * 10, "portwatch": {"chokepoint6": {"end": pw_end}}},
        }

    def test_normal_week_to_week_changes_pass(self):
        from pipeline.check_data import problems, summarize
        old = summarize(self.files())
        new = summarize(self.files(crude_flows=97, crude_v=38500.0, metric_rows=89, pw_end="2026-10-04"))
        self.assertEqual(problems(old, new), [])

    def test_signs_of_a_broken_download_hold_the_build_back(self):
        from pipeline.check_data import problems, summarize
        old = summarize(self.files())
        new = summarize(self.files(crude_flows=60, crude_v=30000.0, lng_flows=0, metric_rows=70, pw_end="2026-09-20"))
        found = " | ".join(problems(old, new))
        for expected in ("crude: 100 → 60 flows", "crude: volume", "lng: 50 → 0 flows", "metric oil_prod_kbd", "PortWatch chokepoint6"):
            self.assertIn(expected, found)

    def test_build_timestamps_are_not_data_changes(self):
        from pipeline.check_data import load
        a = load("trade_details.json", json.dumps({"generated_at": "2026-09-30T10:00:00Z", "records": [1]}))
        b = load("trade_details.json", json.dumps({"generated_at": "2026-10-07T10:00:00Z", "records": [1]}))
        self.assertEqual(a, b)
        self.assertEqual(load("build_report.txt", "TerraEnergy data build — 2026-09-30\nsame"),
                         load("build_report.txt", "TerraEnergy data build — 2026-10-07\nsame"))


class StableFlowIds(unittest.TestCase):
    def test_flows_keep_their_ids_across_builds_and_ids_are_never_reused(self):
        from pipeline.build import assign_stable_ids, flow_key
        flow = lambda c, f, t, mode="sea", via=None: {"c": c, "f": f, "t": t, "mode": mode, **({"via": via} if via else {})}
        first = [flow("crude", "SAU", "IND", via=["Ras Tanura", "Sikka"]), flow("crude", "SAU", "IND", via=["Yanbu", "Sikka"]),
                 flow("lng", "QAT", "JPN")]
        reg = assign_stable_ids(first, {})
        self.assertEqual([f["id"] for f in first], [1, 2, 3])
        # Next week a bigger flow appears first and the Yanbu route disappears.
        second = [flow("crude", "USA", "IND"), flow("crude", "SAU", "IND", via=["Ras Tanura", "Sikka"]), flow("lng", "QAT", "JPN")]
        reg = assign_stable_ids(second, reg)
        self.assertEqual([f["id"] for f in second], [4, 1, 3])
        third = [flow("crude", "SAU", "IND", via=["Yanbu", "Sikka"]), flow("coal", "AUS", "JPN")]
        assign_stable_ids(third, reg)
        self.assertEqual([f["id"] for f in third], [2, 5])  # the Yanbu route gets its old ID back; 2 was never reused
        self.assertEqual(flow_key(first[0]), "crude|SAU|IND|sea|Ras Tanura/Sikka|")


class CrudeOrigins(unittest.TestCase):
    def test_crude_declared_from_non_producers_is_left_off_the_map_and_reported(self):
        from pipeline.build import drop_non_producer_crude
        hist = {"oil_prod_kbd": {"IRQ": {2024: 4300.0, 2025: 4400.0}, "CHE": {2025: 0.0}, "NLD": {2025: 23.0}}}
        flow = lambda v, src=("importer",): {"v": v, "usd": 0.0, "year": 2025, "src": set(src), "est": False}
        flows = {
            ("IRQ", "IND", "crude"): flow(980.0),
            ("CHE", "IND", "crude"): flow(3.5),     # trader domicile: produces no crude
            ("CAF", "IND", "crude"): flow(4.3),     # no production series at all
            ("NLD", "BEL", "crude"): flow(661.0),   # small producer re-exporting by pipeline: kept
            ("CHE", "IND", "products"): flow(2.0),  # products may come from anywhere
            ("XXX", "BLR", "crude"): flow(290.0, ("ei",)),  # Energy Institute estimates are not customs partners
        }
        kept, excluded = drop_non_producer_crude(flows, hist)
        self.assertEqual(set(kept), {("IRQ", "IND", "crude"), ("NLD", "BEL", "crude"), ("CHE", "IND", "products"),
                                     ("XXX", "BLR", "crude")})
        self.assertEqual(set(excluded), {"IND"})
        self.assertAlmostEqual(excluded["IND"]["kbd"], 7.8)
        self.assertEqual(excluded["IND"]["from"], {"CHE": 3.5, "CAF": 4.3})


@unittest.skipUnless((OUT / "flows.json").exists(), "run pipeline/build.py first")
class BuiltOutputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.flows = json.loads((OUT / "flows.json").read_text())
        cls.latest = json.loads((OUT / "latest.json").read_text())
        cls.countries = {c["iso"] for c in json.loads((OUT / "countries.json").read_text())["countries"]}
        cls.cps = json.loads((OUT / "chokepoints.json").read_text())

    def test_flow_records_are_well_formed(self):
        n_nodes = len(self.flows["nodes"])
        for f in self.flows["flows"]:
            self.assertIn(f["c"], {"crude", "products", "lng", "pipeline_gas", "coal", "rare_earths"})
            self.assertGreater(f["v"], 0)
            self.assertNotEqual(f["f"], f["t"])
            if f["mode"] == "sea" and "path" in f:
                self.assertTrue(f["path"])
                self.assertTrue(all(0 <= i < n_nodes for i in f["path"]))
            else:  # overland, pipeline, or a named Caspian crossing outside the ocean network
                self.assertGreaterEqual(len(f["line"]), 2)
                self.assertTrue(f["mode"] != "sea" or f.get("corridor"), f)

    def test_gas_trade_reconciles_with_energy_institute(self):
        lng = sum(f["v"] for f in self.flows["flows"] if f["c"] == "lng")
        pipe = sum(f["v"] for f in self.flows["flows"] if f["c"] == "pipeline_gas")
        self.assertAlmostEqual(lng, 578.5, delta=578.5 * 0.01)
        self.assertAlmostEqual(pipe, 567.6, delta=567.6 * 0.01)

    def test_rare_earth_flows_have_weights_sources_and_modelled_routes(self):
        rare = [f for f in self.flows["flows"] if f["c"] == "rare_earths"]
        self.assertGreater(len(rare), 100)
        self.assertEqual(self.flows["units"]["rare_earths"], "t")
        self.assertEqual(len({f["id"] for f in self.flows["flows"]}), len(self.flows["flows"]))
        for f in rare:
            self.assertIn(f["f"], self.countries)
            self.assertIn(f["t"], self.countries)
            self.assertGreaterEqual(f["v"], 1)
            self.assertTrue(set(f["hs"]) <= {"280530", "284610", "284690"})
            self.assertTrue(set(f["years"]) <= {2024, 2025})
            self.assertIn("Comtrade", f["s"])
            self.assertIn(f["mode"], {"sea", "overland"})

    def test_flow_ids_come_from_the_committed_registry(self):
        from pipeline.build import FLOW_IDS, flow_key
        registry = json.loads(FLOW_IDS.read_text())
        wrong = [(flow_key(f), f["id"]) for f in self.flows["flows"] if registry.get(flow_key(f)) != f["id"]]
        self.assertFalse(wrong[:5], "flows.json and pipeline/flow_ids.json disagree; rebuild and commit both")

    def test_every_crude_exporter_produces_crude(self):
        prod = self.latest["oil_prod_kbd"]
        bad = sorted({f["f"] for f in self.flows["flows"] if f["c"] == "crude" and f["s"] != "EI"
                      and (prod.get(f["f"]) or [0])[0] < 1})
        self.assertFalse(bad, f"crude routed from economies without crude production: {bad}")

    def test_lng_never_moves_overland(self):
        self.assertFalse([f for f in self.flows["flows"] if f["c"] == "lng" and f["mode"] != "sea"])

    def test_no_route_is_a_straight_line_between_countries_that_do_not_share_an_open_border(self):
        nb = json.loads((OUT / "countries.json").read_text())["neighbours"]
        bad = []
        for f in self.flows["flows"]:
            if f["mode"] == "sea" or f.get("corridor"):
                continue
            chain = [f["f"], *f.get("transit", []), f["t"]]
            for a, b in zip(chain, chain[1:]):
                if not L.neighbours_open(a, b, nb):
                    bad.append(f"{f['c']} {f['f']}→{f['t']} crosses {a}–{b}")
        self.assertEqual(bad, [])

    def test_overland_trade_uses_freight_borders(self):
        nb = json.loads((OUT / "countries.json").read_text())["neighbours"]
        bad = []
        for f in self.flows["flows"]:
            if f["mode"] != "overland" or f.get("corridor"):
                continue
            chain = [f["f"], *f.get("transit", []), f["t"]]
            if f["c"] == "crude" and len(chain) == 2:
                continue  # checked in test_crude_pipelines_and_rail_follow_known_links
            for a, b in zip(chain, chain[1:]):
                if not L.freight_edge(a, b, nb):
                    bad.append(f"{f['c']} {f['f']}→{f['t']} via {a}–{b}")
        self.assertEqual(bad, [])

    def test_crude_pipelines_and_rail_follow_known_links(self):
        for f in self.flows["flows"]:
            if f["c"] != "crude" or f["mode"] == "sea" or f.get("corridor") or f.get("transit"):
                continue
            pair = (f["f"], f["t"])
            if f["mode"] == "pipeline":
                self.assertIn(pair, L.CRUDE_PIPELINES)
            else:
                self.assertTrue(pair in L.CRUDE_BY_LAND or f["f"] in L.LANDLOCKED or f["t"] in L.LANDLOCKED, pair)

    def test_trade_across_the_himalayas_goes_by_sea(self):
        pairs = [f for f in self.flows["flows"] if {f["f"], f["t"]} in ({"CHN", "IND"}, {"CHN", "PAK"}, {"IND", "PAK"})]
        self.assertTrue(pairs)
        self.assertEqual({f["mode"] for f in pairs}, {"sea"})

    def test_overland_lines_are_multi_point(self):
        # A route through a border crossing has at least three points; two would be a centre-to-centre line.
        for f in self.flows["flows"]:
            if f["mode"] != "sea" and not f.get("corridor"):
                self.assertGreaterEqual(len(f["line"]), 3, (f["c"], f["f"], f["t"]))

    def test_asia_europe_trade_avoids_panama(self):
        americas = {iso for iso, c in COUNTRIES.items() if c["region"] in ("NAM", "SCA")}
        through = [f"{f['c']} {f['f']}→{f['t']}" for f in self.flows["flows"]
                   if "panama" in f.get("cp", []) and f["f"] not in americas and f["t"] not in americas]
        self.assertEqual(through, [])

    def test_major_crude_importers_match_ei_totals(self):
        imp = {}
        for f in self.flows["flows"]:
            if f["c"] == "crude":
                imp[f["t"]] = imp.get(f["t"], 0) + f["v"]
        for iso, ei in {"CHN": 11671, "IND": 5267, "JPN": 2316}.items():
            self.assertAlmostEqual(imp[iso] / ei, 1.0, delta=0.05, msg=iso)

    def test_hormuz_routed_volume_close_to_eia(self):
        hz = next(c for c in self.cps["chokepoints"] if c["id"] == "hormuz")
        oil = (hz["routed"].get("crude", 0) + hz["routed"].get("products", 0)) / 1000
        # EIA 1H25: 20.9 mb/d incl. flows customs data cannot see (e.g. unreported Iranian exports).
        self.assertTrue(14 < oil < 22, oil)

    def test_latest_values_are_finite_and_attributed(self):
        for metric, rows in self.latest.items():
            for iso, (v, year, src) in rows.items():
                self.assertTrue(v is None or math.isfinite(v), (metric, iso))
                self.assertTrue(2000 <= year <= 2025, (metric, iso, year))
                self.assertTrue(src, (metric, iso))

    def test_world_oil_matches_ei(self):
        ctx = json.loads((OUT / "context.json").read_text())
        self.assertAlmostEqual(ctx["world_2025"]["oil_cons_kbd"], 103039, delta=50)
        self.assertAlmostEqual(ctx["world_2025"]["tes_ej"], 600.3, delta=0.5)

    def test_portwatch_series_present(self):
        pw = self.cps["portwatch"]["chokepoint6"]
        self.assertEqual(len(pw["tanker"]), len(pw["total"]))
        self.assertGreater(len(pw["tanker"]), 900)


if __name__ == "__main__":
    unittest.main()
