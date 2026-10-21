"""Strict, initial-condition-only adapter for the audited GlobalSim v74 profile.

Supported documents are Umalytics observed-response captures and its exact
schemaVersion=1 portable format when the original raceHorse/responseHorseData
graph survives. Normalized runners, inferred course IDs, trajectories, events,
and wrapper finish fields are never used as simulation inputs.

ReferenceData.load raises ReferenceDataError (a ValueError) or OSError.
normalize_capture raises InputError (a ValueError). prepare_capture returns a
status audit instead of throwing for invalid/incomplete/unsupported input.
Loading and preparation do not run an engine, contact a service, or write files.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any
from .skill_additions import definitions as skill_additions, SOURCE as SKILL_ADDITIONS_SOURCE


ADAPTER_VERSION = "umalytics-globalsim-initial-v2"
GLOBALSIM_COMMIT = "efc2decdfeaff227ada0e9847f5deceb42c3b97f"
# The public master projections are byte-identical at the newer collector
# commit. Keep the original data audit identity separate from collector code.
UMALYTICS_BASELINE_COMMIT = "7ebf0f82723b11a49e1676753960b90de7ef9095"
UMALYTICS_ROOM_BINDING_COMMIT = "67443a667998c48cd20685b34bfefc356bd1064f"
ENGINE_FILE_PINS = {
    "data/course_data.json": "6a61cec5958cbc7f47effff59edcdd3f623456353c98d3baa9110e83b9b9cc9b",
    "data/v70-skill-data.json": "e1a713c38d4cfb1478144b9e641e82e5c996dd777af0b375351fa6bd21bc5a84",
    "examples/v74-settings.json": "793d74406f14dcf1f4720bdd4378a1ef52287e39105a76724da037c1398eeecb",
    "data/global_parameters.json": "4655bd004ad7a9a46104283fd42e9afb1c0e9835ccb1b86be47940c100fe99e1",
}
GEOMETRY_MANIFEST_SHA256 = "d7fee9e2f0d1ec9d6e8d667eb8134ade5a767f49e9d7e6e338e38f75ee05bc90"
APP_BASELINE_PINS = {
    "public/data/metadata.json": "86b99c0bea54940df337ccf2e2191c39c0a13a9c41fca0fcf56773700a6d7114",
    "src/data/course-identities.json": "616a3dc953b3cdb98684f8e071b261866c69c6be9ca21b3142b9036806e57879",
    "public/data/courses.json": "4a4174bf07193db72a0345897aa41144e045b314dd1dbbf221081ad792834a20",
}
WEATHER = {1: "Sunny", 2: "Cloudy", 3: "Rainy", 4: "Snowy"}
GROUND = {1: "Good", 2: "Yielding", 3: "Soft", 4: "Heavy"}
SEASON = {1: "Spring", 2: "Summer", 3: "Autumn", 4: "Winter", 5: "Sakura"}
TIME = {0: "none", 1: "morning", 2: "midday", 3: "evening", 4: "night"}
GRADE = {0: "grade_0", 100: "g1", 200: "g2", 300: "g3", 400: "op",
         700: "preop", 800: "maiden", 900: "debut", 999: "daily", 1000: "grade_1000"}
STYLE = {1: ("Nige", "nige"), 2: ("Senkou", "senko"),
         3: ("Sasi", "sashi"), 4: ("Oikomi", "oikomi"), 5: ("Oonige", "nige")}
DISTANCE = {1: "short", 2: "mile", 3: "middle", 4: "long"}
SURFACE = {1: "turf", 2: "dirt"}
STATS = {"speed": "speed", "stamina": "stamina", "power": "pow", "guts": "guts", "wisdom": "wiz"}
SUPPORTED_CATEGORIES = {"practice", "team-trials", "champions-meeting"}
PORTABLE_RACE_TYPES = {"RoomMatch": "practice", "TeamStadium": "team-trials",
                       "Champions": "champions-meeting", "Single": "career"}
CONTEXT_FIELDS = {"raceInstanceId", "courseId", "grade", "time"}
CONTEXT_SOURCES = {"user-confirmed", "upstream-recorded"}
COURSE_ID_ALIASES = ("id", "Id", "course_id", "courseId", "<Id>k__BackingField")
COURSE_DISTANCE_ALIASES = ("distance", "Distance", "race_distance", "raceDistance", "<Distance>k__BackingField")


class ReferenceDataError(ValueError):
    """Reference data failed a pin or structural check."""


class InputError(ValueError):
    def __init__(self, message: str, status: str = "invalid", fields: tuple[str, ...] = ()):
        super().__init__(message)
        self.status = status
        self.fields = fields


def canonical(value: Any) -> bytes:
    """Stable request/capture hashing; the caller hashes original file bytes separately."""
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _hash(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json(raw: bytes) -> dict:
    def pairs(values):
        obj = {}
        for key, value in values:
            if key in obj:
                raise ReferenceDataError("Duplicate reference JSON key")
            obj[key] = value
        return obj

    def invalid_constant(_):
        raise ReferenceDataError("Nonfinite reference JSON value")

    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)
    if not isinstance(value, dict):
        raise ReferenceDataError("Reference JSON must contain an object")
    return value


@dataclass(frozen=True)
class ReferenceData:
    metadata: dict
    course_identities: dict
    app_courses: dict
    course_data: dict
    skill_data: dict
    settings: dict
    parameters: dict
    geometry_hashes: dict[str, str]
    source_files: dict

    @classmethod
    def load(cls, umalytics_root: Path, globalsim_root: Path) -> "ReferenceData":
        """Hash current app projections; verify exact engine data pins without git.

        App metadata may change independently of app source. Its exact content
        identity follows each audit/cache key. Engine source and binary identity
        must ALSO be verified by the runtime; matching data does not attest a
        particular executable. No absolute installation paths enter the audit.
        """
        documents, sources = {}, {}
        for relative, expected in APP_BASELINE_PINS.items():
            raw = (Path(umalytics_root) / relative).read_bytes()
            if len(raw) > 32 * 1024 * 1024:
                raise ReferenceDataError("App reference file exceeds 32 MiB")
            digest = _hash(raw)
            documents[relative] = _json(raw)
            sources[f"app/{relative}"] = {"sha256": digest,
                "matchesAuditedBaseline": digest == expected,
                "baselineCommit": UMALYTICS_BASELINE_COMMIT}
        for relative, expected in ENGINE_FILE_PINS.items():
            raw = (Path(globalsim_root) / relative).read_bytes()
            if _hash(raw) != expected:
                raise ReferenceDataError(f"GlobalSim data pin mismatch: {relative}")
            documents[relative] = _json(raw)
            sources[f"engine/{relative}"] = {"sha256": expected, "pinVerified": True,
                "url": f"https://github.com/daftuyda/GlobalSim/blob/{GLOBALSIM_COMMIT}/{relative}"}
        metadata = documents["public/data/metadata.json"]
        identities = documents["src/data/course-identities.json"]
        for name, doc in [("metadata", metadata), ("course-identities", identities)]:
            for key in ["raceInstances", "raceInstanceConditions"]:
                if not isinstance(doc.get(key), dict):
                    raise ReferenceDataError(f"{name}.{key} must be an object")
        geometry_hashes = {}
        geometry_dir = Path(globalsim_root) / "data/course_geometry"
        for path in sorted(geometry_dir.glob("*.json")):
            if path.stem.isdigit():
                geometry_hashes[path.stem] = _hash(path.read_bytes())
        geometry_digest = _hash(canonical(geometry_hashes))
        if geometry_digest != GEOMETRY_MANIFEST_SHA256:
            raise ReferenceDataError("GlobalSim geometry manifest pin mismatch")
        sources["engine/data/course_geometry"] = {
            "sha256": geometry_digest, "fileCount": len(geometry_hashes), "pinVerified": True,
            "note": "Runtime must additionally verify the compiled engine's source/binary pin."}
        additions = skill_additions()
        sources['integration/skill-additions'] = {
            'sha256': _hash(canonical(additions)), 'source': SKILL_ADDITIONS_SOURCE,
            'skillIds': sorted(additions), 'policy': 'missing definitions only; replay match required',
        }
        skills = {**additions, **documents['data/v70-skill-data.json']}
        return cls(metadata, identities, documents["public/data/courses.json"],
                   documents["data/course_data.json"], skills,
                   documents["examples/v74-settings.json"], documents["data/global_parameters.json"],
                   geometry_hashes, sources)

    @property
    def identity(self) -> dict:
        return {"schemaVersion": 1, "expectedEngineCommit": GLOBALSIM_COMMIT,
                "profile": "v74", "sourceFiles": deepcopy(self.source_files),
                "masterProjectionSource": deepcopy(self.metadata.get("source")),
                "engineParameterSource": deepcopy(self.parameters.get("source"))}

    @property
    def fingerprint(self) -> str:
        return _hash(canonical(self.identity))


def _integer(value: Any, field: str, low: int, high: int) -> int:
    if value is None:
        raise InputError(f"Missing initial field: {field}", "needs_input", (field,))
    if type(value) is not int or not low <= value <= high:
        raise InputError(f"{field}: expected integer in [{low}, {high}]")
    return value


def _number(value: Any, field: str, low: float, high: float) -> int | float:
    if value is None:
        raise InputError(f"Missing initial field: {field}", "needs_input", (field,))
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise InputError(f"{field}: expected finite number in [{low}, {high}]")
    return value


def _enum(value: Any, field: str, choices: dict) -> Any:
    if value is None:
        raise InputError(f"Missing initial field: {field}", "needs_input", (field,))
    if type(value) is not int or value not in choices:
        raise InputError(f"{field}: unknown or unsupported source enum")
    return choices[value]


def _portable_number(value: Any) -> Any:
    # raw-export.ts copies numerical condition codes as strings. Text labels
    # from other exporters can use different enum conventions and are rejected.
    return int(value) if isinstance(value, str) and re.fullmatch(r"-?[0-9]{1,16}", value) else value


def normalize_capture(capture: dict) -> dict:
    """Project raw-preserving captures for preparation AND independent decoding.

    race_scenario is passed through solely for the runtime's observation decoder.
    prepare_capture never reads it. Original hashes must use the original input,
    not this projection. This does not accept arbitrary horseACT schemas.
    """
    if not isinstance(capture, dict):
        raise InputError("Capture must be an object")
    if "race_horse_data_array" in capture:
        if "raceHorse" in capture:
            raise InputError("Ambiguous raw and portable capture shapes")
        return {key: deepcopy(capture[key]) for key in (
            "race_horse_data_array", "race_scenario", "race_instance_id", "race_course_id", "course_id",
            "race_course_set", "random_seed", "race_grade", "start_time_type", "season", "weather",
            "ground_condition", "race_category", "metadata", "distance", "race_distance") if key in capture}
    if capture.get("schemaVersion") == 1 and "raceHorse" in capture:
        horses = capture["raceHorse"]
        if not isinstance(horses, list):
            raise InputError("Portable raceHorse must be an array")
        projected = []
        for index, wrapper in enumerate(horses):
            if not isinstance(wrapper, dict) or not isinstance(wrapper.get("responseHorseData"), dict):
                raise InputError(f"Portable horse {index} lacks original responseHorseData",
                                 "needs_input", (f"raceHorse[{index}].responseHorseData",))
            projected.append(deepcopy(wrapper["responseHorseData"]))
        raw_type = capture.get("raceType")
        raw_category = PORTABLE_RACE_TYPES.get(raw_type)
        category = capture.get("category")
        if raw_type is not None and raw_category is None:
            raise InputError("Portable raceType is unsupported", "unsupported")
        if raw_category is not None and category is not None and category != raw_category:
            raise InputError("Portable category conflicts with preserved raw raceType")
        out = {"race_horse_data_array": projected, "race_category": raw_category or category}
        # Only preserved RAW fields are mapped. In particular, top-level
        # courseId/distance/conditions/runners/frames/events are not consulted.
        # raceDistance is a distinct additive raw-field contract. The app must
        # preserve original response distance there, never normalized distance.
        for source, target in {"simDataBase64": "race_scenario", "raceInstanceId": "race_instance_id",
                "raceCourseSet": "race_course_set", "randomSeed": "random_seed", "raceGrade": "race_grade",
                "startTimeType": "start_time_type", "raceDistance": "race_distance", "season": "season", "weather": "weather",
                "groundCondition": "ground_condition"}.items():
            if source in capture:
                value = capture[source]
                out[target] = _portable_number(value) if source in {"season", "weather", "groundCondition"} else deepcopy(value)
        for name, allowed in (("raceCourseAliases", {"race_course_id", "course_id"}),
                              ("raceDistanceAliases", {"distance", "race_distance"})):
            aliases = capture.get(name, {})
            if not isinstance(aliases, dict) or set(aliases) - allowed:
                raise InputError("Invalid preserved raw aliases: " + name)
            for key, value in aliases.items():
                if key in out and out[key] != value:
                    raise InputError("Conflicting preserved raw field: " + key)
                out[key] = deepcopy(value)
        # parseNormalized -> extractSanitizedRaw can copy the normalized
        # distance back into raceCourseSet. An explicit finish-derived marker
        # therefore disqualifies these distance aliases too; IDs stay raw.
        if capture.get("distanceEvidence") == "finish-derived" and isinstance(out.get("race_course_set"), dict):
            for key in COURSE_DISTANCE_ALIASES:
                out["race_course_set"].pop(key, None)
        if "capture" in capture:
            provenance = capture["capture"]
            if not isinstance(provenance, dict):
                raise InputError("Portable capture provenance must be an object")
            # Current app exports retain endpointGroup/categorySource only.
            # courseSource is an additive integration contract: import/share
            # must preserve this finite marker before it can survive a roundtrip.
            out["metadata"] = {"umaTrace": {key: deepcopy(provenance[key]) for key in
                ("endpointGroup", "categorySource", "courseSource") if key in provenance}}
        return out
    raise InputError("Original race_horse_data_array or portable raceHorse.responseHorseData is required",
                     "needs_input", ("originalRunnerData",))


def _external_context(context: dict | None) -> dict:
    if context is None or context == {}:
        return {}
    if not isinstance(context, dict) or set(context) - (CONTEXT_FIELDS | {"provenance"}):
        raise InputError("Unknown explicit-context field")
    fields = set(context) & CONTEXT_FIELDS
    provenance = context.get("provenance")
    if not fields or not isinstance(provenance, dict) or set(provenance) != fields:
        raise InputError("Every supplied context field requires matching provenance")
    for field in fields:
        row = provenance[field]
        if not isinstance(row, dict) or set(row) != {"source", "reference"}:
            raise InputError(f"context.{field}: provenance requires source and reference only")
        if row["source"] not in CONTEXT_SOURCES:
            raise InputError(f"context.{field}: source must be independently recorded or user-confirmed")
        if not isinstance(row["reference"], str) or not 1 <= len(row["reference"].strip()) <= 2000:
            raise InputError(f"context.{field}: a nonempty source reference is required")
        _integer(context[field], f"context.{field}", 0 if field in {"time", "grade"} else 1, 2**31 - 1)
        if field in {"grade", "time"}:
            _enum(context[field], f"context.{field}", GRADE if field == "grade" else TIME)
    return deepcopy(context)


def _capture_context_source(field: str, audit: dict) -> str | dict:
    source = f"capture.{field}"
    if audit["captureCourseProvenance"]["source"] == "room-response":
        # The collector does not retain a per-field copied list or join IDs.
        # This labels the enriched context without claiming the adapter rejoined
        # requests or independently verified the origin of this particular field.
        return {"field": source, "contextSource": "room-response",
                "joinEvidence": "collector-marker-only"}
    return source


def _capture_context_provenance(raw: dict, audit: dict) -> None:
    trace = raw.get("metadata", {}).get("umaTrace", {})
    portable = audit["captureFormat"] == "portable-raw-v1"
    source = trace.get("courseSource")
    if "courseSource" in trace and source != "room-response":
        raise InputError("Unsupported captured courseSource provenance marker", "unsupported")
    if source is None:
        audit["captureCourseProvenance"] = {
            "source": "portable-preserved" if portable else "raw-preserved",
            "roomJoinEvidence": "not-retained-or-not-applicable"}
        return
    audit["captureCourseProvenance"] = {
        "source": "room-response",
        "markerPath": "capture.courseSource" if portable else "metadata.umaTrace.courseSource",
        "collectorContractCommit": UMALYTICS_ROOM_BINDING_COMMIT,
        "collectorContractUrl": f"https://github.com/exKitsune/Umalytics/blob/{UMALYTICS_ROOM_BINDING_COMMIT}/scripts/proxy/race_extract.py",
        "roomJoinEvidence": "collector-marker-only; public join keys are not persisted",
        "note": "Collector declares an independently joined room context; the adapter cannot replay that join or identify each copied field."}


def _captured_distances(raw: dict, audit: dict) -> list[dict]:
    facts = []

    def add(value, field):
        if value is None:
            return
        distance = _integer(value, field, 1, 10000)
        facts.append({"value": distance, "source": _capture_context_source(field, audit)})
        if facts[0]["value"] != distance:
            raise InputError("Conflicting captured distance fields")

    for field in ("distance", "race_distance"):
        add(raw.get(field), field)
    course = raw.get("race_course_set")
    if isinstance(course, dict):
        for key in COURSE_DISTANCE_ALIASES:
            add(course.get(key), f"race_course_set.{key}")
    audit["capturedDistanceChecks"] = {"evidence": facts, "status": "not-compared",
        "purpose": "Consistency with independently identified course only; distance never selects a course."}
    return facts


def _resolve_context(raw: dict, refs: ReferenceData, supplied: dict, audit: dict) -> dict:
    facts: dict[str, list[dict]] = {name: [] for name in CONTEXT_FIELDS}

    def add(name, value, source):
        if value is None:
            return
        _integer(value, name, 0 if name in {"grade", "time"} else 1, 2**31 - 1)
        if facts[name] and facts[name][0]["value"] != value:
            raise InputError(f"Conflicting independently sourced {name}")
        facts[name].append({"value": value, "source": source})

    add("raceInstanceId", raw.get("race_instance_id"), _capture_context_source("race_instance_id", audit))
    add("courseId", raw.get("race_course_id"), _capture_context_source("race_course_id", audit))
    add("courseId", raw.get("course_id"), _capture_context_source("course_id", audit))
    course_set = raw.get("race_course_set")
    if course_set is not None:
        if type(course_set) is int:
            # apply_room_bindings copies a scalar from _course_fields directly;
            # same-response extract_races normally wraps it as {id: ...}.
            add("courseId", course_set, _capture_context_source("race_course_set", audit))
        elif isinstance(course_set, dict):
            for key in COURSE_ID_ALIASES:
                add("courseId", course_set.get(key), _capture_context_source(f"race_course_set.{key}", audit))
        else:
            raise InputError("Preserved race_course_set must be an object or positive integer")
    add("grade", raw.get("race_grade"), _capture_context_source("race_grade", audit))
    # Route-native start_time_type semantics have not been independently
    # established. Preserve its raw code; it does not fill a missing time.
    if "start_time_type" in raw:
        audit["uninterpretedFields"]["start_time_type"] = deepcopy(raw["start_time_type"])
    for field in CONTEXT_FIELDS & supplied.keys():
        add(field, supplied[field], {"external": supplied["provenance"][field]})
    if facts["raceInstanceId"]:
        key = str(facts["raceInstanceId"][0]["value"])
        for source, document in [("app.metadata", refs.metadata), ("app.course-identities", refs.course_identities)]:
            add("courseId", document.get("raceInstances", {}).get(key), f"{source}.raceInstances[{key}]")
            conditions = document.get("raceInstanceConditions", {}).get(key, {})
            if not isinstance(conditions, dict):
                raise InputError("Race-instance master conditions are malformed")
            for field in ["grade", "time"]:
                add(field, conditions.get(field), f"{source}.raceInstanceConditions[{key}].{field}")
    audit["contextProvenance"] = facts
    missing = tuple(field for field in ["courseId", "grade", "time"] if not facts[field])
    if missing:
        raise InputError("Independently confirmed race context is incomplete", "needs_input", missing)
    answer = {field: entries[0]["value"] for field, entries in facts.items() if entries}
    _enum(answer["grade"], "grade", GRADE)
    _enum(answer["time"], "time", TIME)
    return answer


def prepare_capture(capture: dict, references: ReferenceData,
                    context: dict | None = None) -> tuple[dict | None, dict]:
    """Return (spec, audit). Only audit.status == 'ready' permits an engine run.

    Caller-supplied context is a declared independent source, not evidence that
    this module verified a screenshot or matched two network responses. The
    service must bind it to this capture, show its provenance, and never supply
    an inferred UI course assignment or a value selected to improve parity.
    """
    audit: dict[str, Any] = {
        "schemaVersion": 1, "adapterVersion": ADAPTER_VERSION, "status": "invalid",
        "errors": [], "missingInputs": [], "missingSkills": [], "runnerMapping": [],
        "contextProvenance": {}, "uninterpretedFields": {}, "assumptions": [],
        "captureCourseProvenance": {}, "capturedDistanceChecks": {},
        "sourceFiles": deepcopy(references.source_files), "referenceIdentity": references.identity,
        "referenceFingerprint": references.fingerprint, "observedOutcomesUsedAsInputs": False,
        "limitations": [
            "Captured game/master build identity is not established by initial-input completeness.",
            "GlobalSim has no explicit NPC-class request field; captured team_id=0 stays ungrouped.",
            "Matching observable outputs does not independently validate hidden state between samples.",
        ],
    }
    try:
        audit["captureSha256"] = _hash(canonical(capture))
        audit["captureHashKind"] = "canonical-json; service retains original-file hash separately"
        supplied = _external_context(context)
        audit["explicitContext"] = deepcopy(supplied)
        raw = normalize_capture(capture)
        audit["captureFormat"] = "portable-raw-v1" if "raceHorse" in capture else "observed-response"
        category = raw.get("race_category")
        if category is None:
            raise InputError("Captured race category is required", "needs_input", ("race_category",))
        if category not in SUPPORTED_CATEGORIES:
            raise InputError("Race mode is unsupported by this integration profile (career is not enabled)", "unsupported")
        metadata = raw.get("metadata", {})
        if not isinstance(metadata, dict) or not isinstance(metadata.get("umaTrace", {}), dict):
            raise InputError("Capture category metadata is malformed")
        endpoint = metadata.get("umaTrace", {}).get("endpointGroup")
        if endpoint is not None and endpoint != category:
            raise InputError("Captured category conflicts with endpoint category")
        _capture_context_provenance(raw, audit)
        distance_facts = _captured_distances(raw, audit)
        resolved = _resolve_context(raw, references, supplied, audit)
        course_id = resolved["courseId"]
        course = references.course_data.get(str(course_id))
        if not isinstance(course, dict) or str(course_id) not in references.geometry_hashes:
            raise InputError("Exact course or retail geometry is unsupported by the pinned engine", "unsupported")
        app_course = references.app_courses.get(str(course_id))
        if not isinstance(app_course, dict):
            raise InputError("Exact course missing from the app reference", "needs_input", ("courseReference",))
        for field in ["distance", "surface"]:
            if app_course.get(field) != course.get(field):
                raise InputError(f"App and engine course data conflict on {field}", "unsupported")
        compiled_distance = references.course_identities.get("distances", {}).get(str(course_id))
        if compiled_distance is not None and compiled_distance != course.get("distance"):
            raise InputError("Compiled and engine course distances conflict", "unsupported")
        if distance_facts and distance_facts[0]["value"] != course.get("distance"):
            audit["capturedDistanceChecks"].update(status="conflict", courseDistance=course.get("distance"))
            raise InputError("Captured distance conflicts with the independently identified course")
        audit["capturedDistanceChecks"].update(
            status="matched" if distance_facts else "not-recorded", courseDistance=course.get("distance"))
        distance_key = _enum(course.get("distanceType"), "course.distanceType", DISTANCE)
        surface_key = _enum(course.get("surface"), "course.surface", SURFACE)
        seed = _integer(raw.get("random_seed"), "random_seed", -(2**31), 2**31 - 1)
        runners = raw.get("race_horse_data_array")
        if not isinstance(runners, list) or not runners:
            raise InputError("Original runner roster is missing", "needs_input", ("race_horse_data_array",))
        if len(runners) > 20:
            raise InputError("Roster exceeds the audited standard grid interface", "unsupported")
        ordered = []
        for source_index, runner in enumerate(runners):
            if not isinstance(runner, dict):
                raise InputError("Original runner must be an object")
            frame = _integer(runner.get("frame_order"), f"horse[{source_index}].frame_order", 1, len(runners))
            ordered.append((frame, source_index, runner))
        if sorted(frame for frame, _, _ in ordered) != list(range(1, len(runners) + 1)):
            raise InputError("Runner frame_order is not a complete unique 1..N mapping")
        ordered.sort(key=lambda row: row[0])
        horses = []
        for input_index, (frame, source_index, horse) in enumerate(ordered):
            prefix = f"race_horse_data_array[{source_index}]"
            strategy, style_key = _enum(horse.get("running_style"), f"{prefix}.running_style", STYLE)
            rank = _integer(horse.get("team_rank"), f"{prefix}.team_rank", 0, 2**31 - 1)
            if rank:
                raise InputError("Nonzero team-rank bonuses are unsupported", "unsupported")
            if "item_id_array" not in horse:
                raise InputError("Captured item state is missing", "needs_input", (f"{prefix}.item_id_array",))
            if horse["item_id_array"] != []:
                raise InputError("Race items are unsupported by this integration profile", "unsupported")
            inventory = horse.get("skill_array")
            if not isinstance(inventory, list):
                raise InputError("Complete owned skill inventory is required", "needs_input", (f"{prefix}.skill_array",))
            skills, seen = [], set()
            for entry in inventory:
                if not isinstance(entry, dict):
                    raise InputError("Captured skill entry must be an object")
                sid = str(_integer(entry.get("skill_id"), f"{prefix}.skill_id", 1, 2**31 - 1))
                level = _integer(entry.get("level"), f"{prefix}.skill[{sid}].level", 1, 99)
                if sid in seen:
                    raise InputError("Duplicate owned skill ID")
                seen.add(sid)
                definition = references.skill_data.get(sid)
                if not isinstance(definition, dict):
                    audit["missingSkills"].append({"frameOrder": frame, "skillId": sid})
                    continue
                skills.append({"skillId": sid, "level": level,
                               "isUnique": definition.get("rarity") in {3, 4, 5}})
            prepared = {key: _number(horse.get(raw_key), f"{prefix}.{raw_key}", 1, 2000)
                        for key, raw_key in STATS.items()}
            for key, raw_key in {
                    "distanceAptitude": f"proper_distance_{distance_key}",
                    "surfaceAptitude": f"proper_ground_{surface_key}",
                    "strategyAptitude": f"proper_running_style_{style_key}"}.items():
                prepared[key] = "GFEDCBAS"[_integer(horse.get(raw_key), f"{prefix}.{raw_key}", 1, 8) - 1]
            prepared.update({
                "strategy": strategy, "gateIndex": frame - 1, "teamRank": rank,
                "mood": _integer(horse.get("motivation"), f"{prefix}.motivation", 1, 5) - 3,
                "teamId": _integer(horse.get("team_id"), f"{prefix}.team_id", 0, 2**31 - 1),
                "popularity": _integer(horse.get("popularity"), f"{prefix}.popularity", 1, len(runners)),
                "charaId": _integer(horse.get("chara_id"), f"{prefix}.chara_id", 0, 2**31 - 1),
                "fans": _integer(horse.get("fan_count"), f"{prefix}.fan_count", 0, 2**53 - 1),
                "careerWins": _integer(horse.get("single_mode_win_count"), f"{prefix}.single_mode_win_count", 0, 2**31 - 1),
                "skills": skills,
            })
            horses.append(prepared)
            audit["runnerMapping"].append({"inputIndex": input_index, "frameOrder": frame,
                "sourceHorseArrayIndex": source_index, "teamId": prepared["teamId"],
                "capturedNpcType": horse.get("npc_type"), "skillCount": len(skills)})
        if audit["missingSkills"]:
            raise InputError("Equipped skill definitions are missing from the pinned engine table", "unsupported")
        dirt_skills = sorted({s["skillId"] for h in horses for s in h["skills"]
            if any("is_dirtgrade" in (branch.get("condition") or "") or
                   "is_dirtgrade" in (branch.get("precondition") or "")
                   for branch in references.skill_data[s["skillId"]].get("alternatives", []))})
        if dirt_skills:
            audit["dirtGradeRelevantSkills"] = dirt_skills
            raise InputError("Equipped skills require an unsupported isDirtGrade context mapping", "unsupported")
        spec = deepcopy(references.settings)
        spec.update({"seed": seed, "courseId": course_id,
            "weather": _enum(raw.get("weather"), "weather", WEATHER),
            "groundCondition": _enum(raw.get("ground_condition"), "ground_condition", GROUND),
            "season": _enum(raw.get("season"), "season", SEASON),
            "grade": GRADE[resolved["grade"]], "time": TIME[resolved["time"]],
            "singleMode": False, "wisdomChecks": True, "playerHorseIndex": 0,
            "experimentalRetailStartup": False, "experimentalLaterStaminaMechanics": False,
            "horses": horses, "skillData": deepcopy(references.skill_data)})
        audit.update({"status": "ready", "strictInitialInputComplete": True,
            "recordedSeed": seed, "courseId": course_id, "raceInstanceId": resolved.get("raceInstanceId"),
            "category": category, "runnerCount": len(horses),
            "inputCanonicalSha256": _hash(canonical(spec)),
            "geometrySha256": references.geometry_hashes[str(course_id)],
            "teamCounts": dict(sorted(Counter(str(h["teamId"]) for h in horses).items())),
            "skillInventoryCount": sum(len(h["skills"]) for h in horses),
            "normalizations": {
                "runnerOrder": "ascending captured frame_order; source array indices retained",
                "stats": deepcopy(STATS), "aptitudes": "captured 1..8 -> GFEDCBAS",
                "mood": "captured motivation - 3", "skills": "owned array order, IDs and levels retained",
                "isUnique": "pinned skill rarity 3..5; output metadata only",
                "teamId": "captured team_id; zero stays ungrouped",
                "fansAndWins": "captured fan_count and single_mode_win_count; no trained-history derivation",
            },
            "explicitNonCaptureSettings": {
                "profile": "pinned v74; startup/later-stamina additions disabled",
                "playerHorseIndex": "0 selects gate-one output telemetry only, not account ownership",
                "isDirtGrade": "upstream track default; no equipped skill depends on it",
            }})
        return spec, audit
    except InputError as error:
        audit.update(status=error.status, strictInitialInputComplete=False)
        audit["errors"].append(str(error))
        audit["missingInputs"].extend(error.fields)
        return None, audit
    except (TypeError, ValueError, OverflowError) as error:
        audit.update(status="invalid", strictInitialInputComplete=False)
        audit["errors"].append(f"Invalid capture/context JSON: {type(error).__name__}")
        return None, audit
