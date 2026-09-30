"""Trade integrity checks independent of downloaded data."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.sources import rare_earths as REE


class RareEarths(unittest.TestCase):
    def test_weights_are_not_inferred_from_value_or_non_mass_quantities(self):
        self.assertEqual(REE.weight_tonnes({"netWgt": 12500}), 12.5)
        self.assertEqual(REE.weight_tonnes({"qtyUnitCode": 8, "qty": 500}), 0.5)
        for row in ({"primaryValue": 1e6}, {"qtyUnitCode": 5, "qty": 100},
                    {"netWgt": -1}, {"netWgt": 0}, {"netWgt": float("nan")}):
            self.assertIsNone(REE.weight_tonnes(row))

    def test_importer_precedence_mirror_fallback_and_product_aggregation(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            def save(name, rows):
                (cache / name).write_text(json.dumps({"data": rows}))
            def row(code, partner, kg):
                return {"cmdCode": code, "partnerCode": partner, "netWgt": kg}
            save("rare_M_JPN_2025.json", [])
            save("rare_M_JPN_2024.json", [row("280530", 156, 1000), row("280530", 0, 1000),
                                        row("284610", 0, 50), row("284610", 156, None)])
            save("rare_X_CHN_2025.json", [row("280530", 392, 9000), row("284610", 392, 500),
                                        row("284690", 392, 2000), row("280530", 0, 99999),
                                        row("280530", 156, 99999), row("2846", 392, 99999)])
            with patch.object(REE, "_code_maps", return_value=({156: "CHN", 392: "JPN"}, {})):
                data = REE.load(cache, importers=["JPN"], exporters=["CHN"])
            self.assertEqual(list(data), [("CHN", "JPN")])
            rec = data[("CHN", "JPN")]
            self.assertEqual(rec["v"], 3)  # importer metals + mirror other compounds; no double count
            self.assertEqual(rec["hs"], {"280530", "284690"})
            self.assertEqual(rec["years"], {2024, 2025})
            self.assertTrue(rec["mirror"])


if __name__ == "__main__":
    unittest.main()
