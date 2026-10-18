"""Synthetic boundary tests; no user captures, engine process, or network required.

Run from the kit root with: python -m unittest discover -s tests -v
The separate fixture regression command checks the user's original captures and
the exact previously validated request hashes when those files are available.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "desktop"))
from globalsim_bridge import adapter


def references() -> adapter.ReferenceData:
    course = {"distance": 1600, "surface": 1, "distanceType": 2}
    instances = {"raceInstances": {"901": 101},
                 "raceInstanceConditions": {"901": {"grade": 100, "time": 2}}}
    return adapter.ReferenceData(
        metadata={**deepcopy(instances), "source": {"kind": "synthetic-test-master"}},
        course_identities={**deepcopy(instances), "distances": {"101": 1600}},
        app_courses={"101": deepcopy(course)},
        course_data={"101": deepcopy(course)},
        skill_data={"11": {"rarity": 1, "alternatives": [{"condition": "phase==1"}]},
                    "22": {"rarity": 3, "alternatives": [{"condition": "phase==2"}]}},
        settings={"experimentalRetailInitialization": True,
                  "experimentalRetailSections": True,
                  "experimentalRetailRuntime": True,
                  "experimentalRetailGeometry": True, "retainAllFrames": True},
        parameters={"source": {"kind": "synthetic-test-parameters"}},
        geometry_hashes={"101": "synthetic-geometry-hash"},
        source_files={"synthetic": {"sha256": "synthetic-file-hash"}},
    )


def runner(gate: int) -> dict:
    return {
        "frame_order": gate, "speed": 1000 + gate, "stamina": 900,
        "pow": 800, "guts": 700, "wiz": 600,
        "running_style": 3 if gate == 1 else 5,
        "proper_distance_mile": 8, "proper_ground_turf": 7,
        "proper_running_style_sashi": 6, "proper_running_style_nige": 5,
        "motivation": 5 if gate == 1 else 1,
        "team_rank": 0, "team_id": 3 if gate == 1 else 0,
        "item_id_array": [], "popularity": gate, "chara_id": 1000 + gate,
        "fan_count": 456789 if gate == 1 else 0,
        "single_mode_win_count": 0 if gate == 1 else 12,
        "npc_type": 11 if gate == 1 else 0,
        "skill_array": [{"skill_id": 22, "level": 4}, {"skill_id": 11, "level": 1}],
    }


def capture() -> dict:
    return {"race_category": "practice", "race_instance_id": 901,
            "random_seed": 12345, "weather": 1, "ground_condition": 2, "season": 3,
            "race_horse_data_array": [runner(2), runner(1)],
            "race_scenario": "synthetic-observation-never-decoded-by-adapter",
            "metadata": {"umaTrace": {"endpointGroup": "practice"}}}


def context(**values) -> dict:
    return {**values, "provenance": {key: {"source": "user-confirmed",
            "reference": "Synthetic test context, not a real course confirmation"}
            for key in values}}


def portable(raw: dict) -> dict:
    document = {"schemaVersion": 1, "raceType": "RoomMatch", "category": "practice",
                "raceHorse": [{"responseHorseData": deepcopy(h), "finishTime": 9.0,
                               "rank": 99, "strategy": "wrong-observed-wrapper-value"}
                              for h in raw["race_horse_data_array"]]}
    mapping = {"race_scenario": "simDataBase64", "race_instance_id": "raceInstanceId",
               "race_course_set": "raceCourseSet", "random_seed": "randomSeed",
               "race_grade": "raceGrade", "start_time_type": "startTimeType",
               "season": "season", "weather": "weather", "ground_condition": "groundCondition"}
    for source, target in mapping.items():
        if source in raw:
            document[target] = str(raw[source]) if source in {"season", "weather", "ground_condition"} else deepcopy(raw[source])
    return document


class AdapterBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.refs = references()
        self.raw = capture()

    def prepare(self, raw=None, ctx=None):
        return adapter.prepare_capture(self.raw if raw is None else raw, self.refs, ctx)

    def assert_status(self, status, raw=None, ctx=None):
        spec, audit = self.prepare(raw, ctx)
        self.assertEqual(audit["status"], status, audit)
        if status == "ready":
            self.assertIsNotNone(spec)
        else:
            self.assertIsNone(spec)
            self.assertFalse(audit["strictInitialInputComplete"])
        self.assertFalse(audit["observedOutcomesUsedAsInputs"])
        return spec, audit

    def test_preserves_rng_relevant_initial_inputs_and_gate_identity(self):
        spec, audit = self.assert_status("ready")
        self.assertEqual([h["gateIndex"] for h in spec["horses"]], [0, 1])
        self.assertEqual([r["sourceHorseArrayIndex"] for r in audit["runnerMapping"]], [1, 0])
        self.assertEqual(spec["horses"][0], {
            "speed": 1001, "stamina": 900, "power": 800, "guts": 700, "wisdom": 600,
            "distanceAptitude": "S", "surfaceAptitude": "A", "strategyAptitude": "B",
            "strategy": "Sasi", "gateIndex": 0, "teamRank": 0, "mood": 2,
            "teamId": 3, "popularity": 1, "charaId": 1001, "fans": 456789,
            "careerWins": 0, "skills": [{"skillId": "22", "level": 4, "isUnique": True},
                                        {"skillId": "11", "level": 1, "isUnique": False}],
        })
        self.assertEqual(spec["horses"][1]["strategy"], "Oonige")
        self.assertEqual(spec["horses"][1]["strategyAptitude"], "C")
        self.assertEqual(spec["horses"][1]["mood"], -2)
        self.assertEqual(spec["horses"][1]["teamId"], 0)
        self.assertEqual(spec["horses"][1]["careerWins"], 12)
        self.assertEqual(spec["seed"], 12345)
        self.assertEqual((spec["courseId"], spec["grade"], spec["time"]), (101, "g1", "midday"))
        self.assertEqual((spec["season"], spec["weather"], spec["groundCondition"]),
                         ("Autumn", "Sunny", "Yielding"))
        self.assertFalse(spec["singleMode"])
        self.assertFalse(spec["experimentalRetailStartup"])
        self.assertFalse(spec["experimentalLaterStaminaMechanics"])

    def test_observations_histories_and_wrapper_results_cannot_change_spec(self):
        spec, audit = self.assert_status("ready")
        changed = deepcopy(self.raw)
        changed.update({"race_scenario": "completely-different-even-invalid-replay",
                        "frames": [{"distance": 99999}], "events": [{"skillId": "missing"}],
                        "race_result": {"seed": -9, "startDelay": 0},
                        "trained_chara_array": [{"race_result_list": [{"result_order": 1}]}],
                        "reported_finish_distance": 99999, "courseId": 99999})
        for h in changed["race_horse_data_array"]:
            h.update({"finish_time": 0.1, "result_order": 99, "start_delay": 0,
                      "result_running_style": 1, "viewer_id": 123,
                      "trained_chara": {"race_result_list": [{"result_order": 1}]}})
        actual, changed_audit = self.assert_status("ready", changed)
        self.assertEqual(adapter.canonical(spec), adapter.canonical(actual))
        self.assertNotEqual(audit["captureSha256"], changed_audit["captureSha256"])
        self.assertEqual(audit["inputCanonicalSha256"], changed_audit["inputCanonicalSha256"])
        changed["random_seed"] += 1
        seeded, _ = self.assert_status("ready", changed)
        self.assertNotEqual(adapter.canonical(spec), adapter.canonical(seeded))

    def test_portable_uses_original_inner_graph_and_raw_conditions_only(self):
        expected, _ = self.assert_status("ready")
        doc = portable(self.raw)
        doc.update({"courseId": 99999, "distance": 99999,
                    "conditions": {"weather": "Rainy", "courseId": 99999},
                    "runners": [{"speed": 1, "strategy": "Nige"}],
                    "frames": [{"time": 0}], "events": [{"type": "unknown"}]})
        actual, audit = self.assert_status("ready", doc)
        self.assertEqual(adapter.canonical(expected), adapter.canonical(actual))
        self.assertEqual(audit["captureFormat"], "portable-raw-v1")
        normalized = adapter.normalize_capture(doc)
        self.assertEqual(normalized["race_scenario"], self.raw["race_scenario"])
        self.assertNotIn("courseId", normalized)
        self.assertNotIn("finishTime", normalized["race_horse_data_array"][0])
        normalized["race_horse_data_array"][0]["speed"] = 1
        self.assertEqual(doc["raceHorse"][0]["responseHorseData"]["speed"], 1002)

    def test_portable_never_falls_back_to_normalized_runners_or_wrapper_stats(self):
        doc = portable(self.raw)
        del doc["raceHorse"][0]["responseHorseData"]
        doc["raceHorse"][0].update(runner(2))
        doc["runners"] = [runner(2), runner(1)]
        _, audit = self.assert_status("needs_input", doc)
        self.assertIn("raceHorse[0].responseHorseData", audit["missingInputs"])
        with self.assertRaises(adapter.InputError):
            adapter.normalize_capture({"schemaVersion": 1, "runners": [runner(1)]})

    def test_missing_context_stays_missing_despite_results_or_raw_start_type(self):
        del self.raw["race_instance_id"]
        self.raw.update({"start_time_type": 1, "courseId": 101,
                         "distance": 1600, "race_result": {"race_instance_id": 901}})
        _, audit = self.assert_status("needs_input")
        self.assertEqual(audit["missingInputs"], ["courseId", "grade", "time"])
        self.assertEqual(audit["uninterpretedFields"]["start_time_type"], 1)
        _, audit = self.assert_status("needs_input", ctx=context(courseId=101))
        self.assertEqual(audit["missingInputs"], ["grade", "time"])
        spec, audit = self.assert_status("ready", ctx=context(courseId=101, grade=100, time=1))
        self.assertEqual(spec["time"], "morning")
        self.assertIsNone(audit["raceInstanceId"])
        self.assertEqual(audit["contextProvenance"]["time"][0]["source"]["external"]["source"],
                         "user-confirmed")

    def test_explicit_instance_can_join_exact_master_context(self):
        del self.raw["race_instance_id"]
        spec, audit = self.assert_status("ready", ctx=context(raceInstanceId=901))
        self.assertEqual(spec["courseId"], 101)
        self.assertEqual(audit["raceInstanceId"], 901)
        self.assertEqual(len(audit["contextProvenance"]["courseId"]), 2)

    def test_preserved_portable_course_is_usable_with_independent_conditions(self):
        doc = portable(self.raw)
        del doc["raceInstanceId"]
        doc["raceCourseSet"] = {"id": 101}
        doc["raceGrade"] = 100
        self.assert_status("needs_input", doc)
        spec, _ = self.assert_status("ready", doc, context(time=2))
        self.assertEqual(spec["courseId"], 101)

    def test_conflicting_capture_master_or_external_facts_are_rejected(self):
        for field, value in [("courseId", 102), ("raceInstanceId", 902), ("grade", 200), ("time", 1)]:
            with self.subTest(field=field):
                _, audit = self.assert_status("invalid", ctx=context(**{field: value}))
                self.assertIn("Conflicting", audit["errors"][0])
        raw = deepcopy(self.raw)
        raw["race_course_set"] = {"id": 102}
        self.assert_status("invalid", raw)
        self.refs.course_identities["raceInstanceConditions"]["901"]["time"] = 1
        self.assert_status("invalid")

    def test_context_rejects_unknown_fields_missing_or_untrusted_provenance(self):
        cases = [
            {"seed": 12345}, {"courseId": 101}, {"provenance": {}},
            {**context(courseId=101), "experimentalRetailStartup": True},
            {"courseId": 101, "provenance": {"time": {"source": "user-confirmed", "reference": "test"}}},
        ]
        for source in ["inferred", "best-fit", "simulator-output", "recorded"]:
            bad = context(courseId=101)
            bad["provenance"]["courseId"]["source"] = source
            cases.append(bad)
        for field, value in [("courseId", True), ("time", 99), ("grade", 123), ("courseId", "101")]:
            cases.append(context(**{field: value}))
        blank = context(courseId=101)
        blank["provenance"]["courseId"]["reference"] = "   "
        cases.append(blank)
        extra = context(courseId=101)
        extra["provenance"]["courseId"]["confidence"] = 1
        cases.append(extra)
        for index, ctx in enumerate(cases):
            with self.subTest(index=index):
                self.assert_status("invalid", ctx=ctx)

    def test_source_metadata_conflicts_and_ambiguous_formats_are_rejected(self):
        raw = deepcopy(self.raw)
        raw["metadata"]["umaTrace"]["endpointGroup"] = "team-trials"
        self.assert_status("invalid", raw)
        doc = portable(self.raw)
        doc["category"] = "team-trials"
        self.assert_status("invalid", doc)
        raw = deepcopy(self.raw)
        raw["raceHorse"] = []
        self.assert_status("invalid", raw)
        doc = portable(self.raw)
        doc["weather"] = "Sunny"
        self.assert_status("invalid", doc)

    def test_initial_missing_fields_never_use_observation_defaults(self):
        for field in ["running_style", "speed", "fan_count", "single_mode_win_count",
                      "skill_array", "team_id", "team_rank", "item_id_array",
                      "proper_running_style_nige"]:
            with self.subTest(field=field):
                raw = deepcopy(self.raw)
                del raw["race_horse_data_array"][0][field]
                raw["race_horse_data_array"][0]["result_running_style"] = 5
                self.assert_status("needs_input", raw)
        raw = deepcopy(self.raw)
        del raw["race_horse_data_array"][0]["skill_array"][0]["level"]
        self.assert_status("needs_input", raw)
        raw = deepcopy(self.raw)
        del raw["random_seed"]
        raw["race_result"] = {"random_seed": 12345}
        self.assert_status("needs_input", raw)

    def test_invalid_gate_inventory_and_numeric_values_are_rejected(self):
        for field, value in [("frame_order", 1), ("frame_order", 0), ("speed", True),
                             ("speed", float("inf")), ("motivation", 0),
                             ("proper_distance_mile", 9), ("running_style", 0),
                             ("popularity", 3), ("fan_count", -1)]:
            with self.subTest(field=field, value=value):
                raw = deepcopy(self.raw)
                raw["race_horse_data_array"][0][field] = value
                self.assert_status("invalid", raw)
        raw = deepcopy(self.raw)
        raw["race_horse_data_array"][0]["skill_array"].append({"skill_id": 22, "level": 1})
        self.assert_status("invalid", raw)
        for seed in [True, "12345", 2**31, -(2**31) - 1]:
            with self.subTest(seed=seed):
                raw = deepcopy(self.raw)
                raw["random_seed"] = seed
                self.assert_status("invalid", raw)

    def test_unsupported_career_items_team_bonuses_and_missing_skill_fail_closed(self):
        raw = deepcopy(self.raw)
        raw["race_category"] = "career"
        self.assert_status("unsupported", raw)
        for field, value in [("item_id_array", [101]), ("team_rank", 1)]:
            with self.subTest(field=field):
                raw = deepcopy(self.raw)
                raw["race_horse_data_array"][0][field] = value
                self.assert_status("unsupported", raw)
        raw = deepcopy(self.raw)
        raw["race_horse_data_array"][0]["skill_array"].append({"skill_id": 999, "level": 1})
        _, audit = self.assert_status("unsupported", raw)
        self.assertEqual(audit["missingSkills"], [{"frameOrder": 2, "skillId": "999"}])

    def test_dirt_grade_dependent_skill_requires_supported_context_mapping(self):
        self.refs.skill_data["11"]["alternatives"][0]["condition"] = "is_dirtgrade==1"
        _, audit = self.assert_status("unsupported")
        self.assertEqual(audit["dirtGradeRelevantSkills"], ["11"])

    def test_conflicting_or_unavailable_course_references_prevent_execution(self):
        self.refs.app_courses["101"]["distance"] = 2000
        self.assert_status("unsupported")
        self.refs.app_courses["101"]["distance"] = 1600
        self.refs.geometry_hashes.clear()
        self.assert_status("unsupported")
        self.refs.geometry_hashes["101"] = "synthetic-geometry-hash"
        self.refs.app_courses.clear()
        self.assert_status("needs_input")

    def test_preparation_and_returned_values_do_not_mutate_capture_or_references(self):
        before_capture = deepcopy(self.raw)
        before_refs = deepcopy(self.refs)
        spec, audit = self.assert_status("ready")
        spec["skillData"]["11"]["rarity"] = 999
        spec["horses"][0]["speed"] = 1
        audit["sourceFiles"]["synthetic"]["sha256"] = "changed"
        audit["referenceIdentity"]["sourceFiles"].clear()
        audit["normalizations"]["stats"]["speed"] = "modified-returned-audit"
        self.assertEqual(self.raw, before_capture)
        self.assertEqual(self.refs, before_refs)
        next_spec, _ = self.assert_status("ready")
        self.assertEqual(next_spec["horses"][0]["speed"], 1001)
        self.assertEqual(next_spec["skillData"]["11"]["rarity"], 1)

    def test_room_enrichment_marker_retains_declared_provenance_without_changing_spec(self):
        expected, _ = self.assert_status("ready")
        self.raw["metadata"]["umaTrace"]["courseSource"] = "room-response"
        self.raw["distance"] = 1600
        actual, audit = self.assert_status("ready")
        self.assertEqual(adapter.canonical(expected), adapter.canonical(actual))
        origin = audit["captureCourseProvenance"]
        self.assertEqual(origin["source"], "room-response")
        self.assertEqual(origin["markerPath"], "metadata.umaTrace.courseSource")
        self.assertEqual(origin["collectorContractCommit"], adapter.UMALYTICS_ROOM_BINDING_COMMIT)
        self.assertIn("collector-marker-only", origin["roomJoinEvidence"])
        self.assertEqual(audit["contextProvenance"]["raceInstanceId"][0]["source"]["joinEvidence"],
                         "collector-marker-only")
        self.assertEqual(audit["capturedDistanceChecks"]["status"], "matched")

    def test_room_provenance_alone_never_supplies_missing_course_or_conditions(self):
        del self.raw["race_instance_id"]
        self.raw["start_time_type"] = 1
        self.raw["metadata"]["umaTrace"].update({"courseSource": "room-response",
            "race_instance_id": 901, "courseId": 101, "distance": 1600, "grade": 100, "time": 2})
        _, audit = self.assert_status("needs_input")
        self.assertEqual(audit["missingInputs"], ["courseId", "grade", "time"])
        self.assertEqual(audit["captureCourseProvenance"]["source"], "room-response")
        self.assertEqual(audit["uninterpretedFields"]["start_time_type"], 1)
        self.assertEqual(audit["capturedDistanceChecks"]["evidence"], [])

    def test_unrecognized_room_provenance_is_not_reclassified_as_recorded(self):
        for marker in ["skill-conditions", "manual", "same-distance", "inferred", None, 1, {}]:
            with self.subTest(marker=marker):
                raw = deepcopy(self.raw)
                raw["metadata"]["umaTrace"]["courseSource"] = marker
                self.assert_status("unsupported", raw)

    def test_joined_scalar_course_set_is_exact_context_but_does_not_imply_grade_time(self):
        del self.raw["race_instance_id"]
        self.raw["race_course_set"] = 101
        self.raw["metadata"]["umaTrace"]["courseSource"] = "room-response"
        self.raw["start_time_type"] = 1
        _, audit = self.assert_status("needs_input")
        self.assertEqual(audit["missingInputs"], ["grade", "time"])
        spec, audit = self.assert_status("ready", ctx=context(grade=100, time=2))
        self.assertEqual(spec["courseId"], 101)
        self.assertIsNone(audit["raceInstanceId"])
        self.raw["race_grade"] = 100
        _, audit = self.assert_status("needs_input")
        self.assertEqual(audit["missingInputs"], ["time"])
        for invalid in [True, "101", 101.0, 0, -1, []]:
            with self.subTest(invalid=invalid):
                raw = deepcopy(self.raw)
                raw["race_course_set"] = invalid
                self.assert_status("invalid", raw, context(time=2))

    def test_captured_course_id_aliases_and_conflicts_are_validated(self):
        for alias in ["id", "Id", "course_id", "courseId", "<Id>k__BackingField"]:
            with self.subTest(alias=alias):
                raw = deepcopy(self.raw)
                raw["race_course_set"] = {alias: 101}
                self.assert_status("ready", raw)
                raw["race_course_set"][alias] = 102
                self.assert_status("invalid", raw)
        self.raw["race_course_set"] = {"id": 101, "Id": 102}
        self.assert_status("invalid")

    def test_captured_distance_checks_exact_course_without_changing_request(self):
        expected, _ = self.assert_status("ready")
        for field in ["distance", "race_distance"]:
            with self.subTest(field=field):
                raw = deepcopy(self.raw)
                raw[field] = 1600
                actual, audit = self.assert_status("ready", raw)
                self.assertEqual(adapter.canonical(actual), adapter.canonical(expected))
                self.assertEqual(audit["capturedDistanceChecks"]["status"], "matched")
                self.assertEqual(audit["capturedDistanceChecks"]["courseDistance"], 1600)
                raw[field] = 1800
                _, audit = self.assert_status("invalid", raw)
                self.assertEqual(audit["capturedDistanceChecks"]["status"], "conflict")

    def test_distance_alone_never_resolves_an_unknown_course(self):
        del self.raw["race_instance_id"]
        self.raw["distance"] = 1600
        _, audit = self.assert_status("needs_input")
        self.assertEqual(audit["missingInputs"], ["courseId", "grade", "time"])
        self.assertEqual(audit["capturedDistanceChecks"]["status"], "not-compared")
        self.assertEqual(audit["capturedDistanceChecks"]["evidence"][0]["value"], 1600)

    def test_course_distance_aliases_values_and_cross_field_conflicts(self):
        for alias in ["distance", "Distance", "race_distance", "raceDistance", "<Distance>k__BackingField"]:
            with self.subTest(alias=alias):
                raw = deepcopy(self.raw)
                raw["race_course_set"] = {"id": 101, alias: 1600}
                self.assert_status("ready", raw)
                raw["distance"] = 1800
                _, audit = self.assert_status("invalid", raw)
                self.assertIn("Conflicting captured distance", audit["errors"][0])
        for invalid in [True, "1600", 1600.5, 0, -1, 10001, float("nan")]:
            with self.subTest(invalid=invalid):
                raw = deepcopy(self.raw)
                raw["race_distance"] = invalid
                self.assert_status("invalid", raw)

    def test_future_portable_room_provenance_and_raw_distance_contract(self):
        expected, _ = self.assert_status("ready")
        doc = portable(self.raw)
        doc["capture"] = {"endpointGroup": "practice", "categorySource": "endpoint",
                          "courseSource": "room-response", "ignoredField": "not projected"}
        # These two additive fields must be preserved by the app integration.
        # They are synthetic contract examples, not a claim about current exports.
        doc["raceDistance"] = 1600
        doc["distance"] = 99999
        doc["courseId"] = 99999
        actual, audit = self.assert_status("ready", doc)
        self.assertEqual(adapter.canonical(actual), adapter.canonical(expected))
        self.assertEqual(audit["captureCourseProvenance"]["markerPath"], "capture.courseSource")
        self.assertEqual(audit["capturedDistanceChecks"]["status"], "matched")
        normalized = adapter.normalize_capture(doc)
        self.assertEqual(normalized["race_distance"], 1600)
        self.assertNotIn("distance", normalized)
        self.assertNotIn("ignoredField", normalized["metadata"]["umaTrace"])
        doc["raceDistance"] = 1800
        self.assert_status("invalid", doc)

    def test_portable_distance_is_ignored_until_a_separate_raw_field_survives(self):
        for evidence in [None, "recorded", "course-reference", "finish-derived"]:
            with self.subTest(evidence=evidence):
                doc = portable(self.raw)
                doc["distance"] = 99999
                if evidence:
                    doc["distanceEvidence"] = evidence
                _, audit = self.assert_status("ready", doc)
                self.assertEqual(audit["capturedDistanceChecks"]["status"], "not-recorded")
        doc = portable(self.raw)
        doc["raceCourseSet"] = {"id": 101, "distance": 1800}
        self.assert_status("invalid", doc)
        # The current normalized importer can copy a derived distance into the
        # raw course object. An explicit derived label disqualifies that value.
        doc["distanceEvidence"] = "finish-derived"
        normalized = adapter.normalize_capture(doc)
        self.assertEqual(normalized["race_course_set"], {"id": 101})
        self.assert_status("ready", doc)
        self.assertEqual(doc["raceCourseSet"]["distance"], 1800)
        # A separate preserved raw value remains a consistency check even if the
        # normalized display distance came from telemetry.
        doc["raceDistance"] = 1800
        self.assert_status("invalid", doc)

    def test_room_instance_without_master_conditions_does_not_guess_grade_or_time(self):
        self.raw["metadata"]["umaTrace"]["courseSource"] = "room-response"
        self.raw["start_time_type"] = 1
        self.refs.metadata["raceInstanceConditions"]["901"] = {}
        self.refs.course_identities["raceInstanceConditions"]["901"] = {}
        _, audit = self.assert_status("needs_input")
        self.assertEqual(audit["missingInputs"], ["grade", "time"])
        self.raw["race_grade"] = 100
        _, audit = self.assert_status("needs_input")
        self.assertEqual(audit["missingInputs"], ["time"])
        self.assert_status("ready", ctx=context(time=2))


class ReferenceLoadingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / "app"
        self.engine = self.root / "engine"
        refs = references()
        app_documents = {"public/data/metadata.json": refs.metadata,
                         "src/data/course-identities.json": refs.course_identities,
                         "public/data/courses.json": refs.app_courses}
        engine_documents = {"data/course_data.json": refs.course_data,
                            "data/v70-skill-data.json": refs.skill_data,
                            "examples/v74-settings.json": refs.settings,
                            "data/global_parameters.json": refs.parameters}
        self.app_pins = self.write_documents(self.app, app_documents)
        self.engine_pins = self.write_documents(self.engine, engine_documents)
        geometry_pins = self.write_documents(self.engine / "data/course_geometry", {"101.json": {"synthetic": True}})
        geometry_hash = hashlib.sha256(adapter.canonical({"101": geometry_pins["101.json"]})).hexdigest()
        # Small synthetic data replaces only test-local expected pin constants.
        # Production loads always use the real fixed pin values in adapter.py.
        for key, value in {"APP_BASELINE_PINS": self.app_pins,
                           "ENGINE_FILE_PINS": self.engine_pins,
                           "GEOMETRY_MANIFEST_SHA256": geometry_hash}.items():
            patcher = patch.object(adapter, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def write_documents(root, documents):
        pins = {}
        for relative, value in documents.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            raw = adapter.canonical(value)
            path.write_bytes(raw)
            pins[relative] = hashlib.sha256(raw).hexdigest()
        return pins

    def test_loads_without_git_or_app_head_and_hashes_portable_identity(self):
        refs = adapter.ReferenceData.load(self.app, self.engine)
        self.assertFalse((self.app / ".git").exists())
        self.assertNotIn(str(self.root), json.dumps(refs.identity))
        self.assertEqual(refs.identity["expectedEngineCommit"], adapter.GLOBALSIM_COMMIT)
        for relative, digest in self.engine_pins.items():
            self.assertEqual(refs.source_files[f"engine/{relative}"]["sha256"], digest)
            self.assertTrue(refs.source_files[f"engine/{relative}"]["pinVerified"])
        self.assertEqual(len(refs.fingerprint), 64)
        self.assertEqual(refs.fingerprint, adapter.ReferenceData.load(self.app, self.engine).fingerprint)

    def test_changed_app_projection_gets_new_identity_without_requiring_app_head(self):
        before = adapter.ReferenceData.load(self.app, self.engine)
        path = self.app / "public/data/metadata.json"
        changed = json.loads(path.read_bytes())
        changed["source"]["revision"] = "updated-independent-metadata"
        path.write_bytes(adapter.canonical(changed))
        after = adapter.ReferenceData.load(self.app, self.engine)
        self.assertNotEqual(before.fingerprint, after.fingerprint)
        self.assertFalse(after.source_files["app/public/data/metadata.json"]["matchesAuditedBaseline"])

    def test_changed_engine_data_and_geometry_fail_pin_checks(self):
        path = self.engine / "data/course_data.json"
        original = path.read_bytes()
        path.write_bytes(original + b"\n")
        with self.assertRaisesRegex(adapter.ReferenceDataError, "data pin mismatch"):
            adapter.ReferenceData.load(self.app, self.engine)
        path.write_bytes(original)
        geometry = self.engine / "data/course_geometry/101.json"
        geometry.write_bytes(geometry.read_bytes() + b"\n")
        with self.assertRaisesRegex(adapter.ReferenceDataError, "geometry manifest pin mismatch"):
            adapter.ReferenceData.load(self.app, self.engine)

    def test_missing_reference_raises_io_error_and_ambiguous_json_is_rejected(self):
        path = self.app / "public/data/metadata.json"
        path.write_bytes(b'{"raceInstances":{},"raceInstances":{},"raceInstanceConditions":{}}')
        with self.assertRaisesRegex(adapter.ReferenceDataError, "Duplicate reference JSON key"):
            adapter.ReferenceData.load(self.app, self.engine)
        path.unlink()
        with self.assertRaises(OSError):
            adapter.ReferenceData.load(self.app, self.engine)


if __name__ == "__main__":
    unittest.main()
