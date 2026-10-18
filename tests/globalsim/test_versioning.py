"""Synthetic compatibility policy tests. No dates here describe real game eras.

The fictional region, rules, hashes, and year-2000 calendar are deliberate test
data. The production registry template contains no asserted compatibility eras.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "desktop"))
from globalsim_bridge import versioning


CAPTURE_SHA = "c" * 64
REGION = "synthetic-global"
ERA_IDS = ["synthetic-old", "synthetic-current", "synthetic-future"]


def era(index: int) -> dict:
    return {"eraId": ERA_IDS[index], "sequence": (index + 1) * 10,
            "region": REGION, "modes": ["practice", "team-trials"],
            "window": {"from": f"2000-0{index + 1}-01T00:00:00Z",
                       "until": f"2000-0{index + 2}-01T00:00:00Z"},
            "originalRules": {"rulesetId": f"synthetic-rules-{index}",
                              "gameBuild": f"synthetic-build-{index}",
                              "masterSha256": str(index + 1) * 64},
            "reference": "Synthetic test registration only; not a real game compatibility claim"}


def engine(kind: str, era_index: int = 1) -> dict:
    return {"engineId": f"synthetic-{kind}-{era_index}", "kind": kind,
            "version": f"test-version-{era_index}", "profile": "synthetic-profile",
            "region": REGION, "modes": ["practice", "team-trials"],
            "eraIds": [ERA_IDS[era_index]],
            "identity": {"artifactSha256": ("a" if kind == "simulation" else "b") * 64,
                         "dataSha256": "d" * 64},
            "reference": "Synthetic pinned build and compatibility experiment"}


def registry() -> dict:
    return {"schemaVersion": 1, "registryId": "synthetic-test-registry",
            "eras": [era(i) for i in range(3)],
            "engines": [engine("simulation"), engine("inference")],
            "futureInferencePolicies": []}


def evidence(occurred_at="2000-02-15T12:00:00Z", **values) -> dict:
    row = {"schemaVersion": 1, "captureSha256": CAPTURE_SHA,
           "region": REGION, "mode": "practice", **values}
    if occurred_at is not None:
        row["occurredAt"] = occurred_at
    row["provenance"] = {key: {"source": "upstream-original-race",
        "reference": "Synthetic protocol fixture identifying the original race"}
        for key in row if key not in {"schemaVersion", "captureSha256"}}
    return row


def future_policy(timed=False) -> dict:
    row = {"policyId": "synthetic-explicit-future-inference",
           "region": REGION, "modes": ["practice"],
           "inferenceEngineId": "synthetic-inference-1", "afterEraId": "synthetic-current",
           "notice": "Synthetic opt-in: use the bounded older inference as a provisional estimate",
           "reference": "Synthetic policy approval; not approval for any actual race"}
    row.update({"window": {"from": "2000-03-01T00:00:00Z", "until": "2000-04-01T00:00:00Z"}}
               if timed else {"eraIds": ["synthetic-future"]})
    return row


class CompatibilitySelectionTests(unittest.TestCase):
    def setUp(self):
        self.registry = registry()
        self.evidence = evidence()

    def select(self, ev=None, reg=None):
        result = versioning.select_compatibility(CAPTURE_SHA,
            self.evidence if ev is None else ev, self.registry if reg is None else reg)
        # Every success or failure is safe to serialize and bind to a cache key.
        json.dumps(result, allow_nan=False)
        self.assertEqual(len(result["selectionSha256"]), 64)
        self.assertEqual(result["selectionSha256"], versioning._digest(
            {key: value for key, value in result.items() if key != "selectionSha256"}))
        return result

    def assert_recorded_only(self, result, code=None):
        self.assertEqual(result["mode"], "recorded_only", result)
        self.assertFalse(result["simulation"]["eligible"])
        self.assertFalse(result["inference"]["eligible"])
        self.assertFalse(any(row["eligible"] for row in result["engineEligibility"]))
        if code:
            self.assertIn(code, result["noticeCodes"])

    def test_original_occurrence_selects_two_separate_immutable_versions(self):
        result = self.select()
        self.assertEqual(result["mode"], "compatible")
        self.assertEqual(result["evidenceStatus"], "identified_era")
        self.assertEqual(result["matchedEraId"], "synthetic-current")
        for kind in ("simulation", "inference"):
            self.assertTrue(result[kind]["eligible"])
            self.assertFalse(result[kind]["provisional"])
            self.assertEqual(result[kind]["engineId"], f"synthetic-{kind}-1")
            self.assertEqual(result[kind]["version"], "test-version-1")
            self.assertEqual(result[kind]["profile"], "synthetic-profile")
        self.assertNotEqual(result["simulation"]["identity"]["artifactSha256"],
                            result["inference"]["identity"]["artifactSha256"])
        self.assertIn("not replay verification", result["meaning"])

    def test_known_old_race_without_historical_engines_has_no_inference_fallback(self):
        self.registry["futureInferencePolicies"] = [future_policy()]
        result = self.select(evidence("2000-01-15T00:00:00Z"))
        self.assert_recorded_only(result, "HISTORICAL_ENGINE_UNAVAILABLE")
        self.assertEqual(result["matchedEraId"], "synthetic-old")
        self.assertEqual(result["compatibilityClass"], "unsupported_old")
        self.assertIn("older game-version", next(row["message"] for row in result["notices"]
            if row["code"] == "HISTORICAL_ENGINE_UNAVAILABLE"))

    def test_registered_historical_versions_are_selected_instead_of_current_ones(self):
        self.registry["engines"] += [engine("simulation", 0), engine("inference", 0)]
        result = self.select(evidence("2000-01-15T00:00:00Z"))
        self.assertEqual(result["mode"], "compatible")
        self.assertEqual(result["simulation"]["engineId"], "synthetic-simulation-0")
        self.assertEqual(result["inference"]["engineId"], "synthetic-inference-0")
        self.assertEqual(sum(row["eligible"] for row in result["engineEligibility"]), 2)

    def test_simulation_and_inference_coverage_are_independent(self):
        self.registry["engines"] = [engine("inference", 0), engine("simulation", 1)]
        old = self.select(evidence("2000-01-15T00:00:00Z"))
        self.assertEqual(old["mode"], "compatible")
        self.assertFalse(old["simulation"]["eligible"])
        self.assertTrue(old["inference"]["eligible"])
        current = self.select()
        self.assertTrue(current["simulation"]["eligible"])
        self.assertFalse(current["inference"]["eligible"])

    def test_unknown_occurrence_and_rules_are_not_labeled_old(self):
        result = self.select(evidence(None))
        self.assert_recorded_only(result, "ORIGINAL_RACE_IDENTITY_UNKNOWN")
        self.assertEqual(result["evidenceStatus"], "unknown")
        self.assertEqual(result["compatibilityClass"], "unknown")
        self.assertNotIn("HISTORICAL_ENGINE_UNAVAILABLE", result["noticeCodes"])

    def test_missing_scope_and_other_region_mode_never_use_current_engine(self):
        ev = evidence()
        del ev["region"]
        del ev["provenance"]["region"]
        self.assert_recorded_only(self.select(ev), "ORIGINAL_RACE_SCOPE_UNKNOWN")
        for values in [{"region": "synthetic-jp"}, {"mode": "career"}]:
            with self.subTest(values=values):
                self.assert_recorded_only(self.select(evidence(**values)), "ORIGINAL_RACE_SCOPE_NOT_COVERED")

    def test_empty_production_template_claims_no_real_era(self):
        path = Path(__file__).resolve().parents[2] / "simulation/engine-registry.json"
        template = json.loads(path.read_bytes())
        self.assertEqual(template["eras"], [])
        self.assertEqual(template["engines"], [])
        self.assertEqual(template["futureInferencePolicies"], [])
        result = self.select(reg=template)
        self.assert_recorded_only(result, "NO_COMPATIBILITY_COVERAGE_REGISTERED")
        self.assertNotIn("HISTORICAL_ENGINE_UNAVAILABLE", result["noticeCodes"])

    def test_missing_or_invalid_registry_returns_a_safe_explicit_decision(self):
        for reg in [None, {}, {**registry(), "defaultEngine": "current"},
                    {**registry(), "engines": "current"}]:
            with self.subTest(reg=reg):
                result = versioning.select_compatibility(CAPTURE_SHA, self.evidence, reg)
                self.assert_recorded_only(result)
                self.assertEqual(result["evidenceStatus"], "invalid")

    def test_window_boundaries_are_half_open_and_offsets_are_respected(self):
        just_before = self.select(evidence("2000-01-31T23:59:59.999999Z"))
        self.assert_recorded_only(just_before)
        beginning = self.select(evidence("2000-02-01T09:00:00+09:00"))
        self.assertTrue(beginning["simulation"]["eligible"])
        end = self.select(evidence("2000-03-01T09:00:00+09:00"))
        self.assert_recorded_only(end, "FUTURE_RULES_NOT_COVERED")
        self.assertEqual(end["matchedEraId"], "synthetic-future")

    def test_naive_ambiguous_or_invalid_occurrence_time_is_rejected(self):
        for stamp in ["2000-02-15T12:00:00", "2000-02-15", "2000-02-30T00:00:00Z",
                      "2000-02-15T12:00:00+25:00", "2000-02-15T12:00:00.1234567Z"]:
            with self.subTest(stamp=stamp):
                self.assert_recorded_only(self.select(evidence(stamp)), "INVALID_ORIGINAL_RACE_EVIDENCE")

    def test_occurrence_time_can_be_original_even_when_captured_much_later(self):
        # The selector receives no current clock or acquisition time at all.
        old = evidence("2000-01-15T00:00:00Z")
        old["provenance"]["occurredAt"]["reference"] = "Synthetic original race read from a much later saved-replay response"
        self.assert_recorded_only(self.select(old), "HISTORICAL_ENGINE_UNAVAILABLE")
        for alias in ["captured_at", "capturedAt", "receivedAt", "fileMtime", "trainedCreateTime"]:
            with self.subTest(alias=alias):
                ev = evidence(None)
                ev[alias] = "2000-02-15T00:00:00Z"
                self.assert_recorded_only(self.select(ev), "INVALID_ORIGINAL_RACE_EVIDENCE")

    def test_untrusted_time_or_current_client_provenance_is_not_original_evidence(self):
        for source in ["capture-time", "filesystem-mtime", "current-installed-client", "inferred", "upstream-recorded"]:
            with self.subTest(source=source):
                ev = evidence()
                ev["provenance"]["occurredAt"]["source"] = source
                self.assert_recorded_only(self.select(ev), "INVALID_ORIGINAL_RACE_EVIDENCE")
        ev = evidence()
        del ev["provenance"]["occurredAt"]
        self.assert_recorded_only(self.select(ev), "INVALID_ORIGINAL_RACE_EVIDENCE")

    def test_evidence_must_bind_the_exact_capture(self):
        ev = evidence()
        ev["captureSha256"] = "f" * 64
        self.assert_recorded_only(self.select(ev), "CAPTURE_EVIDENCE_MISMATCH")

    def test_exact_original_rules_can_select_without_a_timestamp(self):
        for field in ["rulesetId", "gameBuild", "masterSha256"]:
            with self.subTest(field=field):
                reg = registry()
                for row in reg["eras"]:
                    del row["window"]
                    row["originalRules"] = {field: row["originalRules"][field]}
                result = self.select(evidence(None, **reg["eras"][1]["originalRules"]), reg)
                self.assertEqual(result["mode"], "compatible")
                self.assertEqual(result["matchedEraId"], "synthetic-current")

    def test_exact_tuple_requires_complete_evidence_or_independent_covered_time(self):
        partial = evidence(None, gameBuild="synthetic-build-1")
        self.assert_recorded_only(self.select(partial), "ORIGINAL_RULE_EVIDENCE_INCOMPLETE")
        full = evidence(None, **self.registry["eras"][1]["originalRules"])
        self.assertEqual(self.select(full)["mode"], "compatible")
        covered_time = evidence(gameBuild="synthetic-build-1")
        self.assertEqual(self.select(covered_time)["mode"], "compatible")

    def test_same_build_with_different_master_needs_disambiguating_original_evidence(self):
        for row in self.registry["eras"]:
            row["originalRules"] = {"gameBuild": "synthetic-shared-build",
                                    "masterSha256": row["originalRules"]["masterSha256"]}
        self.assert_recorded_only(self.select(evidence(None, gameBuild="synthetic-shared-build")),
                                  "ORIGINAL_RULE_EVIDENCE_INCOMPLETE")
        result = self.select(evidence(None, gameBuild="synthetic-shared-build", masterSha256="2" * 64))
        self.assertEqual(result["mode"], "compatible")

    def test_rules_identifiers_cannot_be_ordered_lexicographically_as_build_versions(self):
        names = ["synthetic-99-new-looking", "synthetic-01-old-looking", "synthetic-00"]
        for row, name in zip(self.registry["eras"], names):
            del row["window"]
            row["originalRules"] = {"gameBuild": name}
        old = self.select(evidence(None, gameBuild=names[0]))
        self.assert_recorded_only(old, "HISTORICAL_ENGINE_UNAVAILABLE")
        self.assertEqual(self.select(evidence(None, gameBuild=names[1]))["mode"], "compatible")
        self.assert_recorded_only(self.select(evidence(None, gameBuild="synthetic-1000")),
                                  "ORIGINAL_RULE_IDENTIFIER_UNMAPPED")

    def test_exact_rule_and_occurrence_disagreement_is_a_conflict(self):
        ev = evidence("2000-03-15T00:00:00Z", **self.registry["eras"][0]["originalRules"])
        self.registry["futureInferencePolicies"] = [future_policy(timed=True)]
        result = self.select(ev)
        self.assert_recorded_only(result, "ORIGINAL_TIME_RULESET_CONFLICT")
        self.assertEqual(result["evidenceStatus"], "conflicting")
        outside = evidence("1999-12-15T00:00:00Z", **self.registry["eras"][1]["originalRules"])
        self.assert_recorded_only(self.select(outside), "ORIGINAL_TIME_RULESET_CONFLICT")

    def test_exact_only_later_rules_cannot_occur_before_an_earlier_registered_window(self):
        del self.registry["eras"][2]["window"]
        self.registry["futureInferencePolicies"] = [future_policy()]
        ev = evidence("1999-12-01T00:00:00Z", **self.registry["eras"][2]["originalRules"])
        result = self.select(ev)
        self.assert_recorded_only(result, "ORIGINAL_TIME_RULESET_CONFLICT")
        self.assertEqual(result["evidenceStatus"], "conflicting")
        # A complete exact rule mapping can still identify a consistent later
        # era without inventing any further chronological coverage window.
        boundary = evidence("2000-03-01T00:00:00Z", **self.registry["eras"][2]["originalRules"])
        self.assertEqual(self.select(boundary)["mode"], "provisional_future_inference")

    def test_exact_only_earlier_rules_cannot_occur_after_a_later_registered_window(self):
        del self.registry["eras"][0]["window"]
        self.registry["engines"] += [engine("simulation", 0), engine("inference", 0)]
        ev = evidence("2000-05-01T00:00:00Z", **self.registry["eras"][0]["originalRules"])
        result = self.select(ev)
        self.assert_recorded_only(result, "ORIGINAL_TIME_RULESET_CONFLICT")
        self.assertEqual(result["evidenceStatus"], "conflicting")

    def test_disagreeing_original_build_and_master_are_conflicting(self):
        result = self.select(evidence(None, gameBuild="synthetic-build-0", masterSha256="2" * 64))
        self.assert_recorded_only(result, "ORIGINAL_RULE_IDENTIFIERS_CONFLICT")
        self.assertEqual(result["evidenceStatus"], "conflicting")

    def test_unmapped_original_rules_are_not_silently_ignored_despite_a_covered_date(self):
        result = self.select(evidence(gameBuild="unregistered-original-build"))
        self.assert_recorded_only(result, "ORIGINAL_RULE_IDENTIFIER_UNMAPPED")
        self.assertEqual(result["evidenceStatus"], "unknown")

    def test_future_race_without_explicit_policy_keeps_both_engines_unavailable(self):
        result = self.select(evidence("2000-03-15T00:00:00Z"))
        self.assert_recorded_only(result, "FUTURE_RULES_NOT_COVERED")
        self.assertIn("newer game update", next(row["message"] for row in result["notices"]
            if row["code"] == "FUTURE_RULES_NOT_COVERED"))
        self.assert_recorded_only(self.select(evidence("2099-01-01T00:00:00Z")), "FUTURE_RULES_NOT_COVERED")

    def test_explicit_future_policy_only_authorizes_provisional_inference_with_persistent_notice(self):
        policy = future_policy()
        self.registry["futureInferencePolicies"] = [policy]
        result = self.select(evidence("2000-03-15T00:00:00Z"))
        self.assertEqual(result["mode"], "provisional_future_inference")
        self.assertFalse(result["simulation"]["eligible"])
        self.assertTrue(result["inference"]["eligible"])
        self.assertTrue(result["inference"]["provisional"])
        self.assertEqual(result["inference"]["engineId"], "synthetic-inference-1")
        self.assertEqual(result["provisionalPolicy"], policy)
        self.assertIn("PROVISIONAL_FUTURE_INFERENCE", result["noticeCodes"])
        fixed = next(row["message"] for row in result["notices"] if row["code"] == "PROVISIONAL_FUTURE_INFERENCE")
        self.assertIn("older inference engine may be inaccurate", fixed)
        self.assertIn("not a verified simulation", fixed)

    def test_future_policy_can_target_exact_later_rules_without_a_timestamp(self):
        self.registry["futureInferencePolicies"] = [future_policy()]
        result = self.select(evidence(None, **self.registry["eras"][2]["originalRules"]))
        self.assertEqual(result["mode"], "provisional_future_inference")
        self.assert_recorded_only(self.select(evidence(None)), "ORIGINAL_RACE_IDENTITY_UNKNOWN")

    def test_future_time_policy_is_bounded_and_does_not_extend_simulation(self):
        self.registry["futureInferencePolicies"] = [future_policy(timed=True)]
        self.assertEqual(self.select(evidence("2000-03-01T00:00:00Z"))["mode"], "provisional_future_inference")
        self.assertEqual(self.select(evidence("2000-03-31T23:59:59.999999Z"))["mode"], "provisional_future_inference")
        self.assert_recorded_only(self.select(evidence("2000-04-01T00:00:00Z")), "FUTURE_RULES_NOT_COVERED")
        self.assert_recorded_only(self.select(evidence("2000-01-31T00:00:00Z")), "HISTORICAL_ENGINE_UNAVAILABLE")

    def test_future_policy_does_not_cross_region_mode_or_unknown_original_rules(self):
        self.registry["futureInferencePolicies"] = [future_policy(timed=True)]
        for values in [{"region": "synthetic-jp"}, {"mode": "team-trials"},
                       {"gameBuild": "unmapped-new-looking-build"}]:
            with self.subTest(values=values):
                self.assert_recorded_only(self.select(evidence("2000-03-15T00:00:00Z", **values)))

    def test_compatible_future_inference_version_takes_priority_over_provisional_policy(self):
        self.registry["futureInferencePolicies"] = [future_policy()]
        self.registry["engines"].append(engine("inference", 2))
        result = self.select(evidence("2000-03-15T00:00:00Z"))
        self.assertEqual(result["mode"], "compatible")
        self.assertFalse(result["inference"]["provisional"])
        self.assertEqual(result["inference"]["engineId"], "synthetic-inference-2")
        self.assertIsNone(result["provisionalPolicy"])

    def test_compatible_simulation_remains_eligible_alongside_provisional_inference(self):
        self.registry["futureInferencePolicies"] = [future_policy()]
        self.registry["engines"].append(engine("simulation", 2))
        result = self.select(evidence("2000-03-15T00:00:00Z"))
        self.assertEqual(result["mode"], "provisional_future_inference")
        self.assertTrue(result["simulation"]["eligible"])
        self.assertFalse(result["simulation"]["provisional"])
        self.assertEqual(result["simulation"]["engineId"], "synthetic-simulation-2")
        self.assertTrue(result["inference"]["eligible"])
        self.assertTrue(result["inference"]["provisional"])
        self.assertEqual(result["inference"]["engineId"], "synthetic-inference-1")

    def test_newer_inference_registration_retires_a_stale_future_policy_for_a_historical_gap(self):
        self.registry["engines"] = [engine("inference", 0), engine("inference", 2)]
        policy = future_policy()
        policy.update(inferenceEngineId="synthetic-inference-0", afterEraId="synthetic-old",
                      eraIds=["synthetic-current"])
        self.registry["futureInferencePolicies"] = [policy]
        result = self.select()
        self.assert_recorded_only(result, "HISTORICAL_ENGINE_UNAVAILABLE")
        self.assertEqual(result["matchedEraId"], "synthetic-current")
        self.assertNotIn("PROVISIONAL_FUTURE_INFERENCE", result["noticeCodes"])
        self.assertIsNone(result["provisionalPolicy"])

    def test_stale_future_time_window_cannot_authorize_a_gap_before_later_inference_coverage(self):
        self.registry["engines"] = [engine("inference", 0), engine("inference", 2)]
        del self.registry["eras"][1]["window"]
        policy = future_policy(timed=True)
        policy.update(inferenceEngineId="synthetic-inference-0", afterEraId="synthetic-old",
                      window={"from": "2000-02-01T00:00:00Z", "until": "2000-03-01T00:00:00Z"})
        self.registry["futureInferencePolicies"] = [policy]
        result = self.select()
        self.assert_recorded_only(result)
        self.assertEqual(result["evidenceStatus"], "known_time_uncovered")
        self.assertNotIn("PROVISIONAL_FUTURE_INFERENCE", result["noticeCodes"])

    def test_inference_frontier_is_scoped_to_the_original_mode(self):
        newer = engine("inference", 2)
        newer["modes"] = ["team-trials"]
        self.registry["engines"].append(newer)
        self.registry["futureInferencePolicies"] = [future_policy()]
        result = self.select(evidence("2000-03-15T00:00:00Z"))
        self.assertEqual(result["mode"], "provisional_future_inference")
        self.assertEqual(result["inference"]["engineId"], "synthetic-inference-1")
        team_trials = self.select(evidence("2000-03-15T00:00:00Z", mode="team-trials"))
        self.assertEqual(team_trials["mode"], "compatible")
        self.assertEqual(team_trials["inference"]["engineId"], "synthetic-inference-2")

    def test_era_windows_overlapping_or_reversed_chronology_invalidate_registry(self):
        for change in ["overlap", "sequence", "unbounded", "naive"]:
            with self.subTest(change=change):
                reg = registry()
                if change == "overlap":
                    reg["eras"][1]["window"]["from"] = "2000-01-31T00:00:00Z"
                elif change == "sequence":
                    reg["eras"][0]["sequence"] = 99
                elif change == "unbounded":
                    del reg["eras"][1]["window"]["until"]
                else:
                    reg["eras"][1]["window"]["from"] = "2000-02-01T00:00:00"
                self.assert_recorded_only(self.select(reg=reg), "INVALID_REGISTRY")

    def test_overlapping_exact_selectors_and_duplicate_engine_versions_are_rejected(self):
        reg = registry()
        reg["eras"][1]["originalRules"] = deepcopy(reg["eras"][0]["originalRules"])
        self.assert_recorded_only(self.select(reg=reg), "INVALID_REGISTRY")
        for same_id in (False, True):
            with self.subTest(same_id=same_id):
                reg = registry()
                duplicate = deepcopy(reg["engines"][0])
                if not same_id:
                    duplicate["engineId"] = "another-build-with-overlapping-coverage"
                duplicate["version"] = "different-version"
                reg["engines"].append(duplicate)
                self.assert_recorded_only(self.select(reg=reg), "INVALID_REGISTRY")

    def test_future_policy_cannot_authorize_older_eras_or_simulators(self):
        for change in ["old-era", "simulation", "before-baseline", "other-region", "unbounded"]:
            with self.subTest(change=change):
                reg = registry()
                policy = future_policy(timed=change in {"before-baseline", "unbounded"})
                if change == "old-era":
                    policy["eraIds"] = ["synthetic-old"]
                elif change == "simulation":
                    policy["inferenceEngineId"] = "synthetic-simulation-1"
                elif change == "before-baseline":
                    policy["window"]["from"] = "2000-02-01T00:00:00Z"
                elif change == "other-region":
                    policy["region"] = "synthetic-jp"
                else:
                    del policy["window"]["until"]
                reg["futureInferencePolicies"] = [policy]
                self.assert_recorded_only(self.select(reg=reg), "INVALID_REGISTRY")

    def test_overlapping_future_policies_are_rejected(self):
        for policies in [[future_policy(), future_policy()], [future_policy(), future_policy(timed=True)]]:
            with self.subTest(policies=policies):
                policies[1]["policyId"] = "synthetic-conflicting-policy"
                self.registry["futureInferencePolicies"] = policies
                self.assert_recorded_only(self.select(), "INVALID_REGISTRY")

    def test_engine_pins_and_scope_cannot_be_omitted_or_silently_extended(self):
        for change in ["missing-pin", "invalid-pin", "wrong-era", "wrong-region", "age-threshold"]:
            with self.subTest(change=change):
                reg = registry()
                row = reg["engines"][0]
                if change == "missing-pin":
                    del row["identity"]["artifactSha256"]
                elif change == "invalid-pin":
                    row["identity"]["dataSha256"] = "current"
                elif change == "wrong-era":
                    row["eraIds"] = ["nonexistent-era"]
                elif change == "wrong-region":
                    row["region"] = "synthetic-jp"
                else:
                    row["maximumRaceAgeDays"] = 30
                self.assert_recorded_only(self.select(reg=reg), "INVALID_REGISTRY")

    def test_capture_registry_evidence_policy_and_selection_identities_are_cache_bound(self):
        base = self.select()
        for field in ("captureSha256", "registrySha256", "evidenceSha256", "policySha256", "selectionSha256"):
            self.assertEqual(len(base[field]), 64)
        self.assertIn("declared-semantic-version", base["policyIdentityKind"])
        reordered = {key: self.registry[key] for key in reversed(list(self.registry))}
        self.assertEqual(self.select(reg=reordered)["selectionSha256"], base["selectionSha256"])
        changed = registry()
        changed["engines"][0]["identity"]["artifactSha256"] = "e" * 64
        after = self.select(reg=changed)
        self.assertNotEqual(base["registrySha256"], after["registrySha256"])
        self.assertNotEqual(base["selectionSha256"], after["selectionSha256"])
        ev = evidence()
        ev["provenance"]["occurredAt"]["reference"] = "Another independent synthetic original-race evidence source"
        self.assertNotEqual(base["selectionSha256"], self.select(ev)["selectionSha256"])
        with patch.object(versioning, "POLICY_VERSION", "synthetic-policy-revision"):
            revised = self.select()
        self.assertNotEqual(base["policySha256"], revised["policySha256"])
        self.assertNotEqual(base["selectionSha256"], revised["selectionSha256"])

    def test_selection_is_pure_and_returned_structures_do_not_mutate_inputs(self):
        before_registry, before_evidence = deepcopy(self.registry), deepcopy(self.evidence)
        result = self.select()
        result["simulation"]["identity"]["artifactSha256"] = "changed"
        self.assertEqual(self.registry, before_registry)
        self.assertEqual(self.evidence, before_evidence)
        self.registry["futureInferencePolicies"] = [future_policy()]
        result = self.select(evidence("2000-03-15T00:00:00Z"))
        result["provisionalPolicy"]["notice"] = "changed returned notice"
        self.assertEqual(self.registry["futureInferencePolicies"][0]["notice"], future_policy()["notice"])


if __name__ == "__main__":
    unittest.main()
