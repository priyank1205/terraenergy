import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from pipeline.sources import bilateral as BT


def row(**changes):
    return dict(cmdCode="284690", flowCode="M", period="2025", freqCode="A", netWgt=1234.567,
                primaryValue=5000, **changes)


class Bilateral(unittest.TestCase):
    def test_normalization_preserves_direction_precision_flags_and_value_only_trade(self):
        raw = row(isNetWgtEstimated=True, isAggregate=True, classificationCode="H6", cifvalue=5000)
        rec = BT.normalize(raw, "USA", "CHN", "checked", "released", "source")
        self.assertEqual((rec["exporter"], rec["importer"]), ("CHN", "USA"))
        self.assertEqual(rec["tonnes"], 1.234567)
        self.assertTrue(rec["weight_estimated"])
        raw.update(netWgt=None, qty=20, qtyUnitCode=5)
        rec = BT.normalize(raw, "USA", "CHN")
        self.assertIsNone(rec["tonnes"])
        self.assertEqual(rec["usd"], 5000)
        raw.update(flowCode="X", qtyUnitCode=8, isQtyEstimated=False)
        rec = BT.normalize(raw, "USA", "CHN")
        self.assertEqual((rec["exporter"], rec["importer"]), ("USA", "CHN"))
        self.assertEqual(rec["tonnes"], .02)
        self.assertFalse(rec["weight_estimated"])

    def test_total_transport_and_customs_only(self):
        self.assertIsNone(BT.normalize(row(motCode=1), "USA", "CHN"))
        self.assertIsNone(BT.normalize(row(customsCode="C01"), "USA", "CHN"))
        self.assertIsNone(BT.normalize(row(), "USA", "USA"))

    def test_latest_month_comes_from_publication_catalog_not_nonzero_bilateral_rows(self):
        rows = [{"period": 202606, "reporterCode": 842}, {"period": 202607, "reporterCode": 842},
                {"period": 202608, "reporterCode": 156}]
        with patch.object(BT, "api", return_value=(rows, "catalog")) as api:
            dataset, _ = BT.latest_dataset(842, "M", date(2026, 9, 27))
        self.assertEqual(dataset["period"], 202607)
        requested = api.call_args.args[1]["period"].split(",")
        self.assertEqual(requested[0], "202608")
        self.assertNotIn("202609", requested)

    def test_current_us_partner_code_and_empty_latest_report_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(BT, "CACHE", Path(tmp)), \
             patch.object(BT, "comtrade_reporter_codes", return_value={"CHN": 156, "USA": 842}), \
             patch.object(BT, "_code_maps", return_value=({840: "USA", 842: "USA", 841: "USA", 156: "CHN"}, {})), \
             patch.object(BT, "latest_dataset", return_value=({"period": 2025, "lastReleased": "2026-09-22"}, "catalog")), \
             patch.object(BT, "api", return_value=([], "query")) as api:
            result = BT.reporter_snapshot("CHN", "USA", "A")
        self.assertEqual(api.call_args.args[1]["partnerCode"], 842)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["period"], "2025")
        self.assertEqual(result["records"], [])

    def test_source_failure_keeps_last_success_and_marks_it_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / "CHN-USA-A.json").write_text(json.dumps({"reporter": "CHN", "period": "2024", "records": ["preserved"]}))
            with patch.object(BT, "CACHE", path), \
                 patch.object(BT, "comtrade_reporter_codes", return_value={"CHN": 156, "USA": 842}), \
                 patch.object(BT, "_code_maps", return_value=({842: "USA", 156: "CHN"}, {})), \
                 patch.object(BT, "latest_dataset", side_effect=ValueError("source failed")):
                result = BT.reporter_snapshot("CHN", "USA", "A", refresh=True)
            self.assertEqual(result["status"], "stale")
            self.assertEqual(result["period"], "2024")
            self.assertEqual(result["records"], ["preserved"])
            self.assertNotIn("status", json.loads((path / "CHN-USA-A.json").read_text()))

    def test_historical_partner_cache_is_rejected_even_when_source_is_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / "CHN-USA-A.json").write_text(json.dumps({"reporter": "CHN", "period": "2025", "records": [],
                "source_url": "https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=156&partnerCode=841"}))
            with patch.object(BT, "CACHE", path), \
                 patch.object(BT, "comtrade_reporter_codes", return_value={"CHN": 156, "USA": 842}), \
                 patch.object(BT, "_code_maps", return_value=({841: "USA", 842: "USA", 156: "CHN"}, {})), \
                 patch.object(BT, "latest_dataset", side_effect=ValueError("source failed")) as lookup:
                result = BT.reporter_snapshot("CHN", "USA", "A")
            self.assertEqual(lookup.call_count, 1)
            self.assertEqual(result["status"], "error")
            self.assertNotIn("period", result)


if __name__ == "__main__":
    unittest.main()
