import json, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/ux-review/dupes.py"


class DupesTest(unittest.TestCase):
    def test_repeats_found_chrome_and_figures_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            nav = "Home\nMoney\nData\n"
            card = "Cash on hand is the sum of every account balance"
            files = {
                "empty-Home": nav + "Backup is two weeks old\nBackup is two weeks old\n1,234.50 EUR\n1,234.50 EUR\n" + card,
                "empty-Money-Overview": nav + card,
                "empty-Data": nav + "Import a statement",
            }
            for name, text in files.items():
                (Path(d) / f"390-{name}.txt").write_text(json.dumps(text))
            (Path(d) / "390-empty-Data.snap.txt").write_text("Backup is two weeks old\n" * 3)
            out = json.loads(subprocess.run([sys.executable, str(SCRIPT), d, "390"],
                                            capture_output=True, text=True, check=True).stdout)
        self.assertEqual(out["within_view"], {"empty-Home": {"Backup is two weeks old": 2}})
        self.assertEqual(sorted(out["across_views"]["empty"][card]), ["Home", "Money-Overview"])
        self.assertNotIn("Money", json.dumps(out["within_view"]))


if __name__ == "__main__":
    unittest.main()
