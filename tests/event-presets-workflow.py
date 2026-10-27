"""Validate event completeness, course resolution and source-preserving refreshes."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("event_presets", ROOT / "scripts/fetch-event-presets.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
evidence = json.loads(module.FACTS.read_text(encoding="utf-8"))
courses = json.loads((ROOT / "public/data/courses.json").read_text(encoding="utf-8"))
tracks = json.loads((ROOT / "public/data/metadata.json").read_text(encoding="utf-8"))["trackNames"]


class EventPresetsTests(unittest.TestCase):
    def test_bundled_snapshot_reproduces_and_covers_full_timeline(self):
        result = module.build_presets(evidence, courses, tracks)
        self.assertEqual(result, json.loads(module.OUTPUT.read_text(encoding="utf-8")))
        self.assertEqual(len(result["events"]), 64)
        for kind, total in [("cm", 49), ("loh", 15)]:
            rows = sorted((e for e in result["events"] if e["kind"] == kind), key=lambda e: e["date"])
            self.assertEqual([e["number"] for e in rows], list(range(1, total + 1)))
        for event in result["events"]:
            self.assertRegex(event["date"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertIn(event["sourceEventId"], {e["id"] for e in evidence["events"]})
            self.assertEqual(event["fieldSources"]["date"], module.SOURCE)
            self.assertNotIn("predicted", event["name"].lower() + event["note"].lower())

    def test_loh_random_conditions_and_time_of_day_are_distinct(self):
        events = module.build_presets(evidence, courses, tracks)["events"]
        loh = {e["number"]: e for e in events if e["kind"] == "loh"}
        self.assertTrue(all(e["weather"] is None and e["ground"] is None for e in loh.values()))
        self.assertTrue(all(e["variableConditions"] for e in loh.values()))
        self.assertEqual((loh[1]["time"], loh[5]["time"], loh[11]["time"]), (2, 3, 4))
        self.assertEqual(loh[4]["courseId"], 10805, "Kyoto 1600 outer must not select the inner course")

    def test_unavailable_courses_are_retained_and_numbered(self):
        events = module.build_presets(evidence, courses, tracks)["events"]
        unknown = sorted((e for e in events if e["courseId"] is None), key=lambda e: e["number"])
        self.assertEqual([e["number"] for e in unknown], [44, 45])
        self.assertEqual([e["course"]["track"] for e in unknown], ["Del Mar", "Del Mar"])
        self.assertEqual([e["course"]["surface"] for e in unknown], [1, 2])
        self.assertTrue(all(e["season"] == 1 and e["ground"] == 1 for e in unknown))
        self.assertEqual(max(e["number"] for e in events if e["kind"] == "cm"), 49)

    def test_japanese_tokens_do_not_conflate_heavy_and_firm(self):
        result = module.parse_conditions("ロンシャン 芝 2400m（中距離） 右 秋 晴 不良 昼", True)
        self.assertEqual((result["ground"], result["weather"], result["time"]), (4, 1, 2))
        result = module.parse_conditions("中山 芝 2500m（長距離） 右・内 冬 曇 稍重 昼", True)
        self.assertEqual((result["ground"], result["layout"]), (2, 2))

    def test_missing_conditions_and_ambiguous_layout_do_not_guess(self):
        facts = module.parse_conditions("Kyoto · Turf1600m · Mile · ClockwiseFirm · Autumn · Sunny")
        self.assertIsNone(module.resolve_course(facts, courses, tracks))
        self.assertIsNone(facts["time"], "Daytime must not be invented from weather")
        source = deepcopy(evidence)
        source["events"].append({"id": "missing-future", "kind": "champions_meeting", "name": "Champions Meeting",
                                 "time": "May 1, 2029 – May 7, 2029", "predicted": True})
        event = module.build_presets(source, courses, tracks)["events"][0]
        self.assertEqual(event["number"], 50)
        self.assertIsNone(event["courseId"])
        self.assertTrue(all(event[k] is None for k in ["season", "weather", "ground", "time"]))

    def test_partial_refresh_is_rejected_without_overwriting(self):
        with tempfile.TemporaryDirectory(prefix="umalytics-event-presets-") as directory:
            partial, output = Path(directory) / "partial.json", Path(directory) / "output.json"
            partial.write_text(json.dumps(evidence["events"][:3]), encoding="utf-8")
            output.write_text("retained", encoding="utf-8")
            process = subprocess.run([sys.executable, str(ROOT / "scripts/fetch-event-presets.py"),
                                      "--timeline", str(partial), "--checked-at", "2026-10-26",
                                      "--output", str(output)], capture_output=True, text=True)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn("Refusing partial timeline", process.stderr)
            self.assertEqual(output.read_text(encoding="utf-8"), "retained")


if __name__ == "__main__":
    unittest.main()
