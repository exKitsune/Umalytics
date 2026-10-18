"""Select versioned simulation/inference engines from original-race evidence.

This module does not inspect captures or guess timestamp field aliases. A trusted
caller must extract independently original race occurrence/rules evidence and
bind it to the canonical capture SHA-256. Capture/import/file timestamps are not
substitutes. Eligibility is a compatibility claim, never replay verification.

Registry windows are [from, until), with explicit timezone offsets. Exact
originalRules objects are conjunctions, not guesses from version ordering.
Sequence is an explicitly registered chronology within a region/mode; neither
release dates nor lexical/numeric comparisons of build names establish an era.
All registry/evidence failures return a recorded_only decision.
Future exceptions apply only beyond the latest registered inference coverage for
the same region/mode. Adding a later inference version automatically prevents a
stale future policy from authorizing an unsupported historical gap. Simulator
coverage does not move that inference frontier.

policySha256 hashes the declared POLICY_VERSION identity, not this source file.
Bump POLICY_VERSION whenever selection semantics change. The packaging/cache
layer must also bind actual application/selector artifact identities; a declared
semantic version is not an attestation of the code executing this function.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any


POLICY_VERSION = "umalytics-original-race-selection-v3"
ORIGINAL_RULE_FIELDS = frozenset({"rulesetId", "gameBuild", "masterSha256"})
EVIDENCE_FIELDS = frozenset({"region", "mode", "occurredAt"}) | ORIGINAL_RULE_FIELDS
PROVENANCE_SOURCES = frozenset({"upstream-original-race", "independently-confirmed-original-race"})
_HEX = re.compile(r"[0-9a-f]{64}\Z")
_STAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z")
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,159}\Z")


class CompatibilityError(ValueError):
    """Internal validation error; select_compatibility converts it to a notice."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")


def _digest(value: Any) -> str | None:
    try:
        return hashlib.sha256(canonical(value)).hexdigest()
    except (TypeError, ValueError, OverflowError, RecursionError):
        return None


def _require(condition: bool, message: str, code: str = "INVALID_REGISTRY") -> None:
    if not condition:
        raise CompatibilityError(code, message)


def _shape(value: Any, required: set | frozenset, optional: set | frozenset,
           label: str, code: str = "INVALID_REGISTRY") -> dict:
    _require(isinstance(value, dict), f"{label} must be an object", code)
    _require(required <= value.keys() and not value.keys() - required - optional,
             f"{label} has missing or unsupported fields", code)
    return value


def _name(value: Any, label: str, code: str = "INVALID_REGISTRY") -> str:
    _require(isinstance(value, str) and _NAME.fullmatch(value) is not None,
             f"{label} must be a bounded identifier", code)
    return value


def _text(value: Any, label: str, code: str = "INVALID_REGISTRY") -> str:
    _require(isinstance(value, str) and 0 < len(value.strip()) <= 4000,
             f"{label} requires a nonempty evidence reference/notice", code)
    return value


def _sha(value: Any, label: str, code: str = "INVALID_REGISTRY") -> str:
    _require(isinstance(value, str) and _HEX.fullmatch(value) is not None,
             f"{label} requires a lowercase SHA-256", code)
    return value


def _names(value: Any, label: str) -> list[str]:
    _require(isinstance(value, list) and 0 < len(value) <= 1000,
             f"{label} must be a nonempty bounded list")
    result = [_name(item, label) for item in value]
    _require(len(result) == len(set(result)), f"{label} contains duplicates")
    return result


def _time(value: Any, label: str, code: str = "INVALID_REGISTRY") -> datetime:
    _require(isinstance(value, str) and _STAMP.fullmatch(value) is not None,
             f"{label} requires an occurrence timestamp with seconds and an explicit offset", code)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        _require(parsed.utcoffset() is not None, f"{label} requires a timezone", code)
        return parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError) as error:
        raise CompatibilityError(code, f"{label} is not a valid timestamp") from error


def _window(value: Any, label: str) -> tuple[datetime, datetime]:
    row = _shape(value, {"from", "until"}, set(), label)
    start, end = _time(row["from"], label + ".from"), _time(row["until"], label + ".until")
    _require(start < end, f"{label} must be a nonempty bounded half-open window")
    return start, end


def _in_window(moment: datetime, window: tuple[datetime, datetime] | None) -> bool:
    return window is not None and window[0] <= moment < window[1]


def _overlap(left, right) -> bool:
    return left is not None and right is not None and max(left[0], right[0]) < min(left[1], right[1])


def _shares_scope(left: dict, right: dict) -> bool:
    return left["region"] == right["region"] and bool(set(left["modes"]) & set(right["modes"]))


def _scope(row: dict, evidence: dict) -> bool:
    return row["region"] == evidence.get("region") and evidence.get("mode") in row["modes"]


def _registry(value: Any) -> dict:
    if value is None:
        raise CompatibilityError("REGISTRY_UNAVAILABLE", "No engine compatibility registry is available")
    raw = _shape(value, {"schemaVersion", "registryId", "eras", "engines", "futureInferencePolicies"}, {"allowUnknownVersionSimulation", "unknownVersionSimulators", "allowReplayInference", "replayInference"}, "registry")
    _require(type(raw["schemaVersion"]) is int and raw["schemaVersion"] == 1, "Unsupported registry schema")
    _name(raw["registryId"], "registryId")
    for key in ("eras", "engines", "futureInferencePolicies"):
        _require(isinstance(raw[key], list) and len(raw[key]) <= 1000, f"{key} must be a bounded list")
    _require(type(raw.get("allowUnknownVersionSimulation", False)) is bool, "Unknown simulation policy must be boolean")
    _require(type(raw.get("allowReplayInference", False)) is bool, "Replay inference policy must be boolean")
    replay = raw.get("replayInference")
    if replay is not None:
        _shape(replay, {"engineId", "version", "profile", "identity"}, set(), "replayInference")
        for key in ("engineId", "version", "profile"): _name(replay[key], "replayInference." + key)
        _shape(replay["identity"], {"artifactSha256", "dataSha256"}, set(), "replayInference.identity")
        for key, value in replay["identity"].items(): _sha(value, "replayInference." + key)
    trials = raw.get("unknownVersionSimulators", [])
    _require(isinstance(trials, list) and len(trials) <= 1, "Configure at most one preferred unknown-version simulator")
    for trial in trials:
        _shape(trial, {"engineId", "version", "profile", "identity", "region", "modes", "reference"}, set(), "trial")
        for key in ("engineId", "version", "profile", "region"): _name(trial[key], "trial." + key)
        _names(trial["modes"], "trial.modes")
        _text(trial["reference"], "trial.reference")
        _shape(trial["identity"], {"artifactSha256", "dataSha256"}, set(), "trial.identity")
        for key, value in trial["identity"].items(): _sha(value, "trial." + key)
    eras, engines, policies = {}, {}, []
    for source in raw["eras"]:
        row = _shape(source, {"eraId", "sequence", "region", "modes", "reference"},
                     {"window", "originalRules"}, "era")
        ident = _name(row["eraId"], "eraId")
        _require(ident not in eras, "Duplicate eraId")
        _require(type(row["sequence"]) is int and 0 <= row["sequence"] < 2**31, "Era sequence must be an explicitly registered nonnegative integer")
        _name(row["region"], "era.region")
        _names(row["modes"], "era.modes")
        _text(row["reference"], "era.reference")
        _require("window" in row or "originalRules" in row, "Era needs bounded occurrence coverage or exact original rules")
        parsed = {**deepcopy(row), "_window": _window(row["window"], "era.window") if "window" in row else None}
        if "originalRules" in row:
            rules = _shape(row["originalRules"], set(), ORIGINAL_RULE_FIELDS, "era.originalRules")
            _require(bool(rules), "Exact originalRules cannot be empty")
            for field, entry in rules.items():
                (_sha if field == "masterSha256" else _name)(entry, "era.originalRules." + field)
        eras[ident] = parsed
    entries = list(eras.values())
    for index, left in enumerate(entries):
        for right in entries[index + 1:]:
            if not _shares_scope(left, right):
                continue
            _require(left["sequence"] != right["sequence"], "Era chronology overlaps within region/mode")
            _require(not _overlap(left["_window"], right["_window"]), "Era occurrence windows overlap")
            if left["_window"] and right["_window"]:
                earlier, later = sorted((left, right), key=lambda era: era["sequence"])
                _require(earlier["_window"][1] <= later["_window"][0], "Era sequence contradicts occurrence windows")
            a, b = left.get("originalRules"), right.get("originalRules")
            if a and b:
                _require(any(a[field] != b[field] for field in a.keys() & b.keys()),
                         "Exact original-rule selectors overlap or do not distinguish eras")
    for source in raw["engines"]:
        row = _shape(source, {"engineId", "kind", "version", "profile", "region", "modes", "eraIds", "identity", "reference"}, set(), "engine")
        ident = _name(row["engineId"], "engineId")
        _require(ident not in engines, "An engineId must identify one immutable registered build")
        _require(row["kind"] in ("simulation", "inference"), "Unsupported engine kind")
        for field in ("version", "profile", "region"):
            _name(row[field], "engine." + field)
        modes, ids = _names(row["modes"], "engine.modes"), _names(row["eraIds"], "engine.eraIds")
        identity = _shape(row["identity"], {"artifactSha256", "dataSha256"}, set(), "engine.identity")
        for field in identity:
            _sha(identity[field], "engine.identity." + field)
        _text(row["reference"], "engine.reference")
        _require(all(key in eras for key in ids), "Engine references an unregistered era")
        _require(all(eras[key]["region"] == row["region"] and set(modes) & set(eras[key]["modes"]) for key in ids),
                 "Engine coverage contradicts era region/mode")
        _require(all(any(mode in eras[key]["modes"] for key in ids) for mode in modes), "Engine mode lacks registered era coverage")
        engines[ident] = deepcopy(row)
    for trial in trials:
        registered = engines.get(trial["engineId"])
        if registered is not None:
            _require(registered["kind"] == "simulation" and all(
                trial[key] == registered[key] for key in ("version", "profile", "identity", "region")),
                "A trial engineId must identify the same immutable registered simulator")
    entries = list(engines.values())
    for index, left in enumerate(entries):
        for right in entries[index + 1:]:
            if left["kind"] == right["kind"] and _shares_scope(left, right):
                shared_modes = set(left["modes"]) & set(right["modes"])
                _require(not any(shared_modes & set(eras[key]["modes"]) for key in set(left["eraIds"]) & set(right["eraIds"])),
                         "Multiple engine versions claim the same kind/era/region/mode")
    seen_policies = set()
    for source in raw["futureInferencePolicies"]:
        row = _shape(source, {"policyId", "region", "modes", "inferenceEngineId", "afterEraId", "notice", "reference"},
                     {"eraIds", "window"}, "futureInferencePolicy")
        ident = _name(row["policyId"], "policyId")
        _require(ident not in seen_policies, "Duplicate future policyId")
        seen_policies.add(ident)
        _name(row["region"], "futureInferencePolicy.region")
        modes = _names(row["modes"], "futureInferencePolicy.modes")
        _text(row["notice"], "futureInferencePolicy.notice")
        _text(row["reference"], "futureInferencePolicy.reference")
        _require(("window" in row) != ("eraIds" in row), "Future policy requires exactly one bounded window or later-era list")
        _require(row["inferenceEngineId"] in engines and row["afterEraId"] in eras,
                 "Future policy references an unregistered engine or era")
        engine, after = engines[row["inferenceEngineId"]], eras[row["afterEraId"]]
        _require(engine["kind"] == "inference", "Future extrapolation can only authorize inference")
        _require(row["region"] == engine["region"] == after["region"] and set(modes) <= set(engine["modes"]) & set(after["modes"]),
                 "Future inference must preserve region and mode")
        _require(row["afterEraId"] in engine["eraIds"], "Future baseline must be covered by the selected inference version")
        _require(all(eras[key]["sequence"] <= after["sequence"] for key in engine["eraIds"] if set(eras[key]["modes"]) & set(modes)),
                 "Future baseline must be the last registered coverage of that inference engine")
        parsed = {**deepcopy(row), "_window": None}
        if "eraIds" in row:
            targets = _names(row["eraIds"], "futureInferencePolicy.eraIds")
            _require(all(key in eras and eras[key]["region"] == row["region"] and set(modes) <= set(eras[key]["modes"])
                         and eras[key]["sequence"] > after["sequence"] for key in targets),
                     "Future policy must name explicitly later eras of the same region/mode")
        else:
            parsed["_window"] = _window(row["window"], "futureInferencePolicy.window")
            _require(after["_window"] is not None and parsed["_window"][0] >= after["_window"][1],
                     "A future time window must start after a bounded original-race baseline")
            _require(not any(_shares_scope(row, era) and era["sequence"] <= after["sequence"] and _overlap(parsed["_window"], era["_window"])
                             for era in eras.values()), "Future window overlaps a known older era")
        policies.append(parsed)
    for index, left in enumerate(policies):
        for right in policies[index + 1:]:
            if not _shares_scope(left, right):
                continue
            if left["_window"] and right["_window"]:
                overlaps = _overlap(left["_window"], right["_window"])
            elif not left["_window"] and not right["_window"]:
                overlaps = bool(set(left["eraIds"]) & set(right["eraIds"]))
            else:
                timed, named = (left, right) if left["_window"] else (right, left)
                overlaps = any(eras[key]["_window"] is None or _overlap(timed["_window"], eras[key]["_window"])
                               for key in named["eraIds"])
            _require(not overlaps, "Future inference policies overlap")
    return {"registryId": raw["registryId"], "eras": eras, "engines": engines, "policies": policies, "trials": trials if raw.get("allowUnknownVersionSimulation") else [], "replayInference": replay if raw.get("allowReplayInference") else None}


def _evidence(value: Any, capture_sha256: str) -> dict:
    code = "INVALID_ORIGINAL_RACE_EVIDENCE"
    raw = _shape(value, {"schemaVersion", "captureSha256", "provenance"}, EVIDENCE_FIELDS, "evidence", code)
    _require(type(raw["schemaVersion"]) is int and raw["schemaVersion"] == 1, "Unsupported evidence schema", code)
    _sha(raw["captureSha256"], "evidence.captureSha256", code)
    _require(raw["captureSha256"] == capture_sha256, "Original-race evidence belongs to a different capture", "CAPTURE_EVIDENCE_MISMATCH")
    supplied = EVIDENCE_FIELDS & raw.keys()
    provenance = _shape(raw["provenance"], supplied, set(), "evidence.provenance", code)
    for field in supplied:
        proof = _shape(provenance[field], {"source", "reference"}, set(), "evidence.provenance." + field, code)
        _require(isinstance(proof["source"], str) and proof["source"] in PROVENANCE_SOURCES,
                 "Evidence must explicitly identify the original race, not capture/import time or the currently installed client", code)
        _text(proof["reference"], "evidence.provenance." + field + ".reference", code)
        if field == "occurredAt":
            _time(raw[field], "evidence.occurredAt", code)
        elif field == "masterSha256":
            _sha(raw[field], "evidence.masterSha256", code)
        else:
            _name(raw[field], "evidence." + field, code)
    return {**deepcopy(raw), "_occurredAt": _time(raw["occurredAt"], "evidence.occurredAt", code) if "occurredAt" in raw else None}


def _resolve(evidence: dict, eras: dict) -> tuple[dict | None, str, str]:
    scoped = {key: era for key, era in eras.items() if _scope(era, evidence)}
    if not evidence.get("region") or not evidence.get("mode"):
        return None, "unknown", "ORIGINAL_RACE_SCOPE_UNKNOWN"
    moment = evidence["_occurredAt"]
    fields = ORIGINAL_RULE_FIELDS & evidence.keys()
    if moment is None and not fields:
        return None, "unknown", "ORIGINAL_RACE_IDENTITY_UNKNOWN"
    if not scoped:
        return None, "unmapped", "ORIGINAL_RACE_SCOPE_NOT_COVERED"
    constraints, unmapped = [], []
    for field in sorted(fields):
        matching = {key for key, era in scoped.items() if era.get("originalRules", {}).get(field) == evidence[field]}
        if matching:
            constraints.append(matching)
        else:
            unmapped.append(field)
    rule_candidates = set.intersection(*constraints) if constraints else set()
    if constraints and not rule_candidates:
        return None, "conflicting", "ORIGINAL_RULE_IDENTIFIERS_CONFLICT"
    timed = {key for key, era in scoped.items() if moment is not None and _in_window(moment, era["_window"])}
    if rule_candidates and moment is not None:
        if timed and not timed & rule_candidates:
            return None, "conflicting", "ORIGINAL_TIME_RULESET_CONFLICT"

        def chronology_agrees(candidate):
            if candidate["_window"] and not _in_window(moment, candidate["_window"]):
                return False
            for neighbor in scoped.values():
                if neighbor["_window"] is None:
                    continue
                # Exact-only mappings do not acquire an invented time window.
                # Their declared order must still agree with independently
                # bounded earlier/later eras, including outside all windows.
                if neighbor["sequence"] < candidate["sequence"] and moment < neighbor["_window"][1]:
                    return False
                if neighbor["sequence"] > candidate["sequence"] and moment >= neighbor["_window"][0]:
                    return False
            return True

        rule_candidates = {key for key in rule_candidates if chronology_agrees(scoped[key])}
        if not rule_candidates:
            return None, "conflicting", "ORIGINAL_TIME_RULESET_CONFLICT"
    if unmapped:
        return None, "unknown", "ORIGINAL_RULE_IDENTIFIER_UNMAPPED"
    candidates = timed & rule_candidates if timed and rule_candidates else timed or rule_candidates
    if len(candidates) > 1:
        return None, "unknown", "ORIGINAL_RULE_EVIDENCE_INCOMPLETE"
    if candidates:
        era = scoped[next(iter(candidates))]
        if not timed and not set(era.get("originalRules", {})) <= fields:
            return None, "unknown", "ORIGINAL_RULE_EVIDENCE_INCOMPLETE"
        return era, "identified_era", "ORIGINAL_ERA_IDENTIFIED"
    if moment is not None:
        windows = [era["_window"] for era in scoped.values() if era["_window"]]
        if windows and moment < min(window[0] for window in windows):
            return None, "known_time_uncovered", "ORIGINAL_RACE_BEFORE_REGISTERED_WINDOWS"
        if windows and moment >= max(window[1] for window in windows):
            return None, "known_time_uncovered", "ORIGINAL_RACE_AFTER_REGISTERED_WINDOWS"
        return None, "known_time_uncovered", "ORIGINAL_RACE_TIME_NOT_COVERED"
    return None, "unknown", "ORIGINAL_RACE_IDENTITY_UNKNOWN"


def _slot() -> dict:
    return {"eligible": False, "provisional": False, "engineId": None, "version": None,
            "profile": None, "identity": None, "reasonCodes": []}


def _selected(engine: dict, provisional: bool = False) -> dict:
    return {"eligible": True, "provisional": provisional,
            **{key: deepcopy(engine[key]) for key in ("engineId", "version", "profile", "identity")},
            "reasonCodes": ["PROVISIONAL_FUTURE_INFERENCE" if provisional else "REGISTERED_ERA_COMPATIBLE"]}


def _notice(decision: dict, code: str, message: str) -> None:
    if code not in decision["noticeCodes"]:
        decision["noticeCodes"].append(code)
        decision["notices"].append({"code": code, "message": message})


def _finish(decision: dict) -> dict:
    decision["selectionSha256"] = _digest(decision)
    return decision


def _coverage_class(era: dict | None, evidence: dict, registry: dict, resolution: str) -> str:
    scoped_engines = [engine for engine in registry["engines"].values() if _scope(engine, evidence)]
    covered = [registry["eras"][key] for engine in scoped_engines for key in engine["eraIds"]
               if evidence.get("mode") in registry["eras"][key]["modes"]]
    if era and covered:
        if era["sequence"] < max(item["sequence"] for item in covered):
            return "unsupported_old"
        if era["sequence"] > max(item["sequence"] for item in covered):
            return "unsupported_future"
        return "unsupported_era"
    if resolution == "ORIGINAL_RACE_BEFORE_REGISTERED_WINDOWS":
        return "unsupported_old"
    if resolution == "ORIGINAL_RACE_AFTER_REGISTERED_WINDOWS":
        return "unsupported_future"
    return "unsupported_era" if era else "unmapped"


def select_compatibility(capture_sha256: str, evidence: dict, registry: dict) -> dict:
    """Return a bound eligibility plan; never load references/cache or run engines.

    Engine dataSha256 is an immutable reference identity. For this kit's
    simulator, it equals ReferenceData.fingerprint. The caller must separately
    attest the actual artifact, data, version, and profile before execution.
    Re-evaluate this selector before restoring caches; do not trust an old plan.
    """
    decision = {"schemaVersion": 1, "policyVersion": POLICY_VERSION,
        "policySha256": _digest({"policyVersion": POLICY_VERSION}),
        "policyIdentityKind": "declared-semantic-version; not a source-code hash",
        "captureSha256": capture_sha256 if isinstance(capture_sha256, str) else None,
        "registrySha256": _digest(registry), "evidenceSha256": _digest(evidence),
        "registryId": None, "mode": "recorded_only", "evidenceStatus": "unknown",
        "compatibilityClass": "unmapped", "matchedEraId": None,
        "simulation": _slot(), "inference": _slot(), "engineEligibility": [],
        "provisionalPolicy": None, "noticeCodes": [], "notices": [],
        "meaning": "Original-rules compatibility eligibility; not replay verification."}
    try:
        _sha(capture_sha256, "capture_sha256", "INVALID_CAPTURE_BINDING")
        _require(decision["registrySha256"] is not None, "Registry is not canonical JSON", "INVALID_REGISTRY")
        parsed_registry = _registry(registry)
        decision["registryId"] = parsed_registry["registryId"]
        _require(decision["evidenceSha256"] is not None, "Evidence is not canonical JSON", "INVALID_ORIGINAL_RACE_EVIDENCE")
        parsed_evidence = _evidence(evidence, capture_sha256)
        era, status, resolution = _resolve(parsed_evidence, parsed_registry["eras"])
        decision["evidenceStatus"] = status
        decision["matchedEraId"] = era["eraId"] if era else None
        for engine in parsed_registry["engines"].values():
            scoped = _scope(engine, parsed_evidence)
            eligible = scoped and era is not None and era["eraId"] in engine["eraIds"]
            decision["engineEligibility"].append({"engineId": engine["engineId"], "kind": engine["kind"],
                "eligible": eligible, "provisional": False,
                "reasonCodes": ["REGISTERED_ERA_COMPATIBLE" if eligible else "REGION_MODE_NOT_COVERED" if not scoped else resolution if era is None else "ORIGINAL_ERA_NOT_COVERED"]})
            if eligible:
                decision[engine["kind"]] = _selected(engine)
        if not parsed_registry["eras"] or not parsed_registry["engines"]:
            _notice(decision, "NO_COMPATIBILITY_COVERAGE_REGISTERED",
                    "Only observed replay data is available: no proved engine compatibility coverage is registered.")
        if status in ("unknown", "conflicting", "unmapped"):
            decision["compatibilityClass"] = status
            message = ("Original race evidence conflicts; simulation and inference are unavailable until that conflict is resolved."
                       if status == "conflicting" else
                       "Original race time/rules and region/mode are unknown or unmapped. This is not evidence that the race is old; only observed replay data is available.")
            _notice(decision, resolution, message)
        else:
            decision["compatibilityClass"] = _coverage_class(era, parsed_evidence, parsed_registry, resolution)
            if not decision["inference"]["eligible"]:
                matching_policies = []
                inference_eras = [parsed_registry["eras"][key]
                    for engine in parsed_registry["engines"].values()
                    if engine["kind"] == "inference" and _scope(engine, parsed_evidence)
                    for key in engine["eraIds"]
                    if parsed_evidence.get("mode") in parsed_registry["eras"][key]["modes"]]
                frontier = max(inference_eras, key=lambda row: row["sequence"]) if inference_eras else None
                after_frontier = frontier is not None and (
                    era["sequence"] > frontier["sequence"] if era else
                    parsed_evidence["_occurredAt"] is not None and frontier["_window"] is not None
                    and parsed_evidence["_occurredAt"] >= frontier["_window"][1])
                for policy in parsed_registry["policies"]:
                    if not after_frontier or not _scope(policy, parsed_evidence):
                        continue
                    after = parsed_registry["eras"][policy["afterEraId"]]
                    if era and era["sequence"] <= after["sequence"]:
                        continue
                    if "eraIds" in policy:
                        qualifies = era is not None and era["eraId"] in policy["eraIds"]
                    else:
                        qualifies = parsed_evidence["_occurredAt"] is not None and _in_window(parsed_evidence["_occurredAt"], policy["_window"])
                    if qualifies:
                        matching_policies.append(policy)
                _require(len(matching_policies) <= 1, "Future inference policies ambiguously match this evidence")
                if matching_policies:
                    policy = matching_policies[0]
                    engine = parsed_registry["engines"][policy["inferenceEngineId"]]
                    decision["inference"] = _selected(engine, provisional=True)
                    decision["provisionalPolicy"] = {key: deepcopy(value) for key, value in policy.items() if not key.startswith("_")}
                    for row in decision["engineEligibility"]:
                        if row["engineId"] == engine["engineId"]:
                            row.update(eligible=True, provisional=True, reasonCodes=["PROVISIONAL_FUTURE_INFERENCE"])
                    decision["mode"] = "provisional_future_inference"
                    decision["compatibilityClass"] = "unsupported_future"
                    _notice(decision, "PROVISIONAL_FUTURE_INFERENCE",
                            "Warning: this race uses newer or uncovered rules. The explicitly permitted older inference engine may be inaccurate; its output is provisional and is not a verified simulation.")
            if not decision["inference"]["provisional"] and (decision["simulation"]["eligible"] or decision["inference"]["eligible"]):
                decision["mode"] = "compatible"
                decision["compatibilityClass"] = "covered"
            elif decision["mode"] == "recorded_only":
                code = {"unsupported_old": "HISTORICAL_ENGINE_UNAVAILABLE",
                        "unsupported_future": "FUTURE_RULES_NOT_COVERED"}.get(decision["compatibilityClass"], "ORIGINAL_ERA_ENGINE_UNAVAILABLE")
                message = {
                    "HISTORICAL_ENGINE_UNAVAILABLE":
                        "This race belongs to an older game-version period than the registered engines cover. No compatible historical simulation or inference engine is available; only observed replay data is shown, and newer inference is disabled.",
                    "FUTURE_RULES_NOT_COVERED":
                        "This race belongs to a newer game update or rules period than the registered engines cover. Only observed replay data is shown. Simulation must wait for compatible coverage; inference requires compatible coverage or an explicit policy permitting a warned provisional estimate.",
                }.get(code, "No compatible simulation or inference engine is registered for the original race rules. Only observed replay data is shown; no inference fallback is enabled.")
                _notice(decision, code, message)
        if status in ("unknown", "unmapped") and era is None and parsed_registry["trials"]:
            trial = parsed_registry["trials"][0]
            if (parsed_evidence.get("region") in (None, trial["region"])
                    and (parsed_evidence.get("mode") is None or parsed_evidence["mode"] in trial["modes"])):
                decision["simulation"] = _selected(trial)
                decision["simulation"]["reasonCodes"] = ["UNKNOWN_VERSION_REPLAY_TRIAL"]
                eligibility = {"engineId": trial["engineId"], "kind": "simulation", "eligible": True,
                               "provisional": False, "reasonCodes": ["UNKNOWN_VERSION_REPLAY_TRIAL"]}
                decision["engineEligibility"] = [row for row in decision["engineEligibility"]
                                                 if row["engineId"] != trial["engineId"]] + [eligibility]
                decision["mode"] = "simulation_trial"
                decision["notices"] = []
                decision["noticeCodes"] = []
                _notice(decision, "UNKNOWN_VERSION_REPLAY_TRIAL",
                    "Original game version is unknown. The installed simulator may explain this race only after all supported recorded fields match. Inference remains separately version-gated.")
        if not decision["inference"]["eligible"] and parsed_registry["replayInference"]:
            engine = parsed_registry["replayInference"]
            decision["inference"] = _selected(engine, provisional=True)
            decision["inference"]["reasonCodes"] = ["PROVISIONAL_REPLAY_INFERENCE"]
            decision["provisionalPolicy"] = {"kind": "replay-analysis", "inferenceEngineId": engine["engineId"],
                "notice": "Use the installed inference model when simulation cannot match. Original rules coverage is not asserted."}
            decision["engineEligibility"] = [r for r in decision["engineEligibility"] if r["engineId"] != engine["engineId"]] + [
                {"engineId": engine["engineId"], "kind": "inference", "eligible": True, "provisional": True, "reasonCodes": ["PROVISIONAL_REPLAY_INFERENCE"]}]
            if decision["mode"] == "recorded_only": decision["mode"] = "provisional_replay_inference"
            decision["notices"], decision["noticeCodes"] = [], []
            _notice(decision, "PROVISIONAL_REPLAY_INFERENCE", "Replay analysis uses the installed inference model when simulation is unavailable or does not match. Mechanics-dependent values are estimates; original version coverage is unconfirmed.")
        for kind in ("simulation", "inference"):
            if not decision[kind]["eligible"]:
                decision[kind]["reasonCodes"] = [resolution if era is None else "NO_COMPATIBLE_" + kind.upper() + "_ENGINE"]
        return _finish(decision)
    except CompatibilityError as error:
        decision.update(mode="recorded_only", evidenceStatus="invalid", compatibilityClass="invalid", matchedEraId=None,
                        simulation=_slot(), inference=_slot(), provisionalPolicy=None)
        for row in decision["engineEligibility"]:
            row.update(eligible=False, provisional=False, reasonCodes=[error.code])
        for kind in ("simulation", "inference"):
            decision[kind]["reasonCodes"] = [error.code]
        _notice(decision, error.code, str(error))
        return _finish(decision)
    except (TypeError, ValueError, KeyError, OverflowError, RecursionError) as error:
        decision.update(mode="recorded_only", evidenceStatus="invalid", compatibilityClass="invalid", matchedEraId=None,
                        simulation=_slot(), inference=_slot(), provisionalPolicy=None)
        for row in decision["engineEligibility"]:
            row.update(eligible=False, provisional=False, reasonCodes=["INVALID_COMPATIBILITY_INPUT"])
        _notice(decision, "INVALID_COMPATIBILITY_INPUT", "Malformed registry/evidence: " + type(error).__name__)
        return _finish(decision)
