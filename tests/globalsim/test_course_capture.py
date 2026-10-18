"""Scoped SYNTHETIC room-course mapping regression against an actual app checkout.

This exercises the checkout's Python capture functions and its unmodified
raw-export.ts/share.ts through Node's built-in TypeScript stripping. It does not
run GlobalSim, authenticate a room response, or turn a synthetic course choice
into evidence about any real race. The optional original-capture audit only
compares initial-input hashes with a previously saved validation report.

Run explicitly with --umalytics-root, --globalsim-root, and --output. Normal
unittest discovery skips this external-checkout test class unless configured by
this module's CLI. No app dependency installation or source edits are needed.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "desktop"))
from globalsim_bridge import adapter


APP_COMMIT = "67443a667998c48cd20685b34bfefc356bd1064f"
ENDPOINT = "/\x75mamusume/room_match/result"
INSTANCE = 800018
COURSE = 10805
DISTANCE = 1600
SEED = 73123
EXPECTED_ORIGINAL_FIXTURE_COUNT = 7

NODE_PORTABLE = r"""
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const root = process.argv[1];
const modules = new Map();
for (const name of ['raw-export', 'share']) {
  const filename = path.join(root, 'src', 'data', `${name}.ts`);
  const source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), {mode:'strip'});
  modules.set(name, new vm.SourceTextModule(source, {identifier:filename}));
}
await modules.get('raw-export').link(() => {throw new Error('Unexpected raw-export import');});
await modules.get('share').link(name => {
  if (name === './raw-export') return modules.get('raw-export');
  throw new Error(`Unexpected share import: ${name}`);
});
await modules.get('share').evaluate();
const capture = request.capture;
const normalized = request.normalized === true;
const sourceHorses = normalized ? capture.raceHorse : capture.race_horse_data_array;
// This options.course argument is the literal raw courseValue used by
// parseExport in the audited checkout, not its normalized recordedCourse.
// The normalized variant follows parseNormalized's source/options mapping.
const raw = modules.get('raw-export').namespace.extractSanitizedRaw(
  capture, normalized ? capture.simDataBase64 : capture.race_scenario, {
    normalized, horseact:normalized, horses:sourceHorses,
    course:normalized ? capture.raceCourseSet : capture.race_course_set,
    category:normalized ? capture.category : capture.race_category,
  });
const race = {
  id:'synthetic-course-mapping', title:'SYNTHETIC course mapping fixture',
  synthetic:true, category:'practice', courseId:10805,
  distance:normalized ? capture.distance : 1600, distanceEvidence:capture.distanceEvidence,
  randomSeed:normalized ? capture.randomSeed : capture.random_seed,
  conditions:{weather:'1', ground:'1', season:'4'},
  courseIdentity:{source:'race-instance', raceInstanceId:normalized ? capture.raceInstanceId : capture.race_instance_id},
  capture:{...(normalized ? capture.capture : capture.metadata?.umaTrace)},
  runners:sourceHorses.map((horse,index) => ({
    id:`runner-${index+1}`, gate:normalized ? horse.responseHorseData.frame_order : horse.frame_order,
    name:'Synthetic runner',
  })), frames:[], events:[], warnings:[], raw,
  ...(request.uiUpdates ?? {}),
};
const portable = modules.get('share').namespace.toPortableRace(race);
process.stdout.write(JSON.stringify({raw,portable}));
"""


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def synthetic_scenario() -> str:
    """Complete synthetic two-runner wire layout, never an official capture."""
    pieces = [struct.pack('<ii', 4, 100000002), struct.pack('<fiii', 0., 2, 12, 31),
              struct.pack('<i', 0), struct.pack('<ii', 2, 28)]
    for time in (0., .0666):
        pieces.append(struct.pack('<f', time))
        for index in range(2):
            pieces.append(struct.pack('<fHHHbb', time * (index + 1), 1000, 300, 1000, 0, -1))
    pieces.append(struct.pack('<i', 0))
    for index in range(2):
        pieces.append(struct.pack('<ifffBBfBif', index, 100. + index, 0., .03,
                                  index, index, 1000., 2, 0, 100. + index))
    pieces.extend((struct.pack('<i', 0), struct.pack('<i', 0)))
    return base64.b64encode(zlib.compress(b''.join(pieces))).decode('ascii')


def synthetic_runner(gate: int) -> dict:
    raw = {"frame_order": gate, "speed": 1000, "stamina": 900, "pow": 800,
           "guts": 700, "wiz": 600, "running_style": 2, "motivation": 3,
           "team_rank": 0, "team_id": 1, "item_id_array": [], "popularity": gate,
           "chara_id": 1001, "fan_count": 12345, "single_mode_win_count": 5,
           "skill_array": [], "npc_type": 11}
    for name in ("short", "mile", "middle", "long"):
        raw[f"proper_distance_{name}"] = 7
    for name in ("turf", "dirt"):
        raw[f"proper_ground_{name}"] = 7
    for name in ("nige", "senko", "sashi", "oikomi"):
        raw[f"proper_running_style_{name}"] = 7
    return raw


def synthetic_replay(**changes) -> dict:
    return {"race_scenario": synthetic_scenario(), "random_seed": SEED,
            "season": 4, "weather": 1, "ground_condition": 1, "start_time_type": 1,
            "race_horse_data_array": [synthetic_runner(2), synthetic_runner(1)], **changes}


def independent_context(**fields) -> dict:
    return {**fields, "provenance": {field: {
        "source": "upstream-recorded",
        "reference": "SYNTHETIC fixture: independently specified initial room setting",
    } for field in fields}}


class CourseCaptureTests(unittest.TestCase):
    app_root: Path | None = None
    globalsim_root: Path | None = None
    evidence: list[dict] = []

    @classmethod
    def setUpClass(cls):
        if cls.app_root is None or cls.globalsim_root is None:
            raise unittest.SkipTest("Explicit app and GlobalSim checkouts are required; use this test file's CLI")
        cls.node = shutil.which('node')
        if cls.node is None:
            raise RuntimeError("Node with stripTypeScriptTypes is required for the actual portable exporter")
        spec = importlib.util.spec_from_file_location(
            'umalytics_scoped_course_capture', cls.app_root / 'scripts/proxy/race_extract.py')
        cls.extractor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.extractor)
        cls.references = adapter.ReferenceData.load(cls.app_root, cls.globalsim_root)
        cls.evidence = []

    def record(self, name: str, **details):
        self.evidence.append({"name": name, "fixtureKind": "synthetic-mapping-regression",
                              "simulationExecuted": False, "observedOutcomesUsedAsInputs": False,
                              **details})

    def extracted(self, replay=None, rooms=()):
        payload = {"data": synthetic_replay() if replay is None else deepcopy(replay)}
        memory = []
        for room in rooms:
            self.extractor.remember_room_bindings(memory, self.extractor.collect_room_bindings(room))
        races = self.extractor.extract_races(payload, ENDPOINT)
        self.extractor.apply_room_bindings(races, memory)
        self.assertEqual(len(races), 1)
        return races[0]

    def room(self, **values):
        return {"data": {"room_info": {"race_instance_id": INSTANCE, "random_seed": SEED,
                         "weather": 1, "season": 4, "ground_condition": 1, **values},
                         "auth": {"token": "SYNTHETIC_PRIVATE_TOKEN"}}}

    def prepare(self, raw, status, context=None):
        spec, audit = adapter.prepare_capture(raw, self.references, context)
        self.assertEqual(audit['status'], status, audit['errors'])
        self.assertEqual(spec is not None, status == 'ready')
        self.assertFalse(audit['observedOutcomesUsedAsInputs'])
        return spec, audit

    def portable(self, raw, *, normalized=False, **ui_updates):
        result = subprocess.run(
            [self.node, '--experimental-vm-modules', '--input-type=module', '-e', NODE_PORTABLE,
             str(self.app_root)], input=json.dumps({'capture': raw, 'uiUpdates': ui_updates,
                                                    'normalized': normalized}),
            capture_output=True, text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_upstream_room_course_workflow(self):
        result = subprocess.run([sys.executable, '-B', str(self.app_root / 'tests/room-course-workflow.py')],
                                capture_output=True, text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        checks = json.loads(result.stdout)
        self.assertTrue(checks and all(value == 'passed' for value in checks.values()))
        self.record('upstream-room-course-workflow', checks=checks, status='passed')

    def test_seed_join_exact_instance_and_portable_roundtrip(self):
        raw = self.extracted(rooms=[self.room(distance=DISTANCE)])
        self.assertEqual(raw['race_instance_id'], INSTANCE)
        self.assertEqual(raw['metadata']['umaTrace']['courseSource'], 'room-response')
        self.assertNotIn('_room_join', raw)
        self.assertNotIn('SYNTHETIC_PRIVATE_TOKEN', json.dumps(raw))
        expected, audit = self.prepare(raw, 'ready')
        self.assertEqual((expected['courseId'], expected['grade'], expected['time']),
                         (COURSE, 'g1', 'midday'))
        exported = self.portable(raw)
        self.assertEqual(exported['portable']['raceInstanceId'], INSTANCE)
        actual, portable_audit = self.prepare(exported['portable'], 'ready')
        self.assertEqual(adapter.canonical(expected), adapter.canonical(actual))
        self.record('seed-join-exact-instance-portable-roundtrip', status='passed',
                    instanceId=INSTANCE, courseId=COURSE, distance=DISTANCE, grade='g1', time='midday',
                    inputHashEqual=True, inputCanonicalSha256=audit['inputCanonicalSha256'],
                    rawContextProvenance=audit['contextProvenance'],
                    rawUninterpretedStartTimeType=audit['uninterpretedFields']['start_time_type'],
                    portableInitialInputStatus=portable_audit['status'])

    def test_room_id_join_and_identity_redaction(self):
        room = {'data': {'saved_room_id': 55, 'race_instance_id': INSTANCE, 'weather': 1}}
        raw = self.extracted(synthetic_replay(saved_room_id=55), [room])
        self.assertEqual(raw['race_instance_id'], INSTANCE)
        self.assertNotIn('saved_room_id', raw)
        self.assertNotIn('_room_join', raw)
        _, audit = self.prepare(raw, 'ready')
        self.record('shared-room-id-join', status='passed', initialInputStatus=audit['status'],
                    joinIdentifierRetained=False)

    def test_conflicting_identifiers_or_conditions_withhold_join(self):
        cases = {
            'different-seed-same-room': (synthetic_replay(saved_room_id=55),
                [self.room(saved_room_id=55, random_seed=SEED+1)]),
            'different-room-same-seed': (synthetic_replay(saved_room_id=55),
                [self.room(saved_room_id=56)]),
            'different-weather': (synthetic_replay(weather=2), [self.room()]),
            'ambiguous-instance-same-seed': (synthetic_replay(),
                [self.room(), self.room(race_instance_id=800019)]),
        }
        rows = []
        for name, (replay, rooms) in cases.items():
            with self.subTest(case=name):
                raw = self.extracted(replay, rooms)
                self.assertNotIn('race_instance_id', raw)
                _, audit = self.prepare(raw, 'needs_input')
                self.assertEqual(audit['missingInputs'], ['courseId', 'grade', 'time'])
                rows.append({'case': name, 'status': audit['status'], 'missingInputs': audit['missingInputs']})
        self.record('conflicting-identifiers-and-conditions', status='passed', cases=rows)

    def test_current_captured_course_and_master_instance_conflict_is_rejected(self):
        raw = self.extracted(synthetic_replay(race_instance_id=INSTANCE, race_course_set={'id': 10801}))
        _, audit = self.prepare(raw, 'invalid')
        self.assertTrue(any('Conflicting' in error for error in audit['errors']))
        self.record('captured-course-versus-instance-master-conflict', status='passed',
                    initialInputStatus=audit['status'], errors=audit['errors'])

    def test_course_only_requires_independent_grade_and_time(self):
        rows = []
        for form in ({'id': COURSE}, COURSE):
            with self.subTest(form=form):
                room = {'data': {'random_seed': SEED, 'race_course_set': form,
                                 'distance': DISTANCE, 'weather': 1}}
                raw = self.extracted(rooms=[room])
                self.assertNotIn('race_instance_id', raw)
                _, incomplete = self.prepare(raw, 'needs_input')
                self.assertEqual(incomplete['missingInputs'], ['grade', 'time'])
                context = independent_context(grade=100, time=2)
                expected, ready = self.prepare(raw, 'ready', context)
                portable = self.portable(raw)['portable']
                _, portable_incomplete = self.prepare(portable, 'needs_input')
                self.assertEqual(portable_incomplete['missingInputs'], ['grade', 'time'])
                actual, _ = self.prepare(portable, 'ready', context)
                self.assertEqual(adapter.canonical(expected), adapter.canonical(actual))
                rows.append({'rawCourseForm': 'scalar' if type(form) is int else 'object',
                             'withoutContext': incomplete['status'],
                             'missingInputs': incomplete['missingInputs'],
                             'withIndependentContext': ready['status'], 'portableInputHashEqual': True})
        self.record('course-only-residual-context', status='passed', cases=rows)

    def test_recorded_distance_is_consistency_check_not_course_inference(self):
        raw = self.extracted(synthetic_replay(race_instance_id=INSTANCE, distance=DISTANCE + 200))
        _, conflict = self.prepare(raw, 'invalid')
        self.assertTrue(any('distance' in error.lower() for error in conflict['errors']))
        only_distance = self.extracted(synthetic_replay(distance=DISTANCE))
        _, missing = self.prepare(only_distance, 'needs_input')
        self.assertEqual(missing['missingInputs'], ['courseId', 'grade', 'time'])
        self.record('recorded-distance-consistency-and-non-inference', status='passed',
                    conflictingDistanceStatus=conflict['status'], distanceOnlyStatus=missing['status'])

    def test_portable_ui_fields_do_not_override_preserved_raw_context(self):
        raw = self.extracted(rooms=[self.room()])
        expected, _ = self.prepare(raw, 'ready')
        exported = self.portable(raw, courseId=10801, distance=9999, grade=200,
            conditions={'weather':'4', 'ground':'4', 'season':'1', 'timeOfDay':'4'},
            courseIdentity={'source':'manual', 'raceInstanceId':999999})['portable']
        exported['runners'] = [{'speed': 1, 'finishTimeRaw': .001}]
        exported['events'] = [{'time':0, 'type':3, 'params':[0,999999]}]
        actual, audit = self.prepare(exported, 'ready')
        self.assertEqual(adapter.canonical(expected), adapter.canonical(actual))
        self.record('portable-normalized-ui-isolation', status='passed',
                    inputHashEqual=True, initialInputStatus=audit['status'])

    def test_portable_flat_course_and_provenance_are_preserved(self):
        raw = self.extracted(synthetic_replay(race_course_id=COURSE, distance=DISTANCE))
        context = independent_context(grade=100, time=2)
        expected, _ = self.prepare(raw, 'ready', context)
        portable = self.portable(raw)['portable']
        self.assertEqual(portable['raceCourseSet']['id'], COURSE)
        actual, _ = self.prepare(portable, 'ready', context)
        self.assertEqual(adapter.canonical(expected), adapter.canonical(actual))
        joined = self.extracted(rooms=[self.room()])
        self.assertEqual(self.portable(joined)['portable']['capture']['courseSource'], 'room-response')

    def test_normalized_distance_does_not_enter_raw(self):
        raw = self.extracted(synthetic_replay(race_instance_id=INSTANCE, race_course_set={'id': COURSE}))
        expected, _ = self.prepare(raw, 'ready')
        document = self.portable(raw)['portable']
        document.update(distance=9999, distanceEvidence='finish-derived')
        projected = self.portable(document, normalized=True)
        self.assertNotIn('distance', projected['raw']['raceCourseSet'])
        self.assertNotIn('raceDistance', projected['raw'])
        actual, _ = self.prepare(projected['portable'], 'ready')
        self.assertEqual(adapter.canonical(expected), adapter.canonical(actual))

    def test_course_only_conflicts_withhold_join(self):
        memory = []
        for course_id in (COURSE, 10801):
            payload = {'data': {'random_seed': SEED, 'race_course_set': {'id': course_id}}}
            self.extractor.remember_room_bindings(memory, self.extractor.collect_room_bindings(payload))
        self.assertEqual(len(memory), 2)
        races = self.extractor.extract_races(synthetic_replay(), ENDPOINT)
        self.extractor.apply_room_bindings(races, memory)
        self.assertNotIn('race_course_set', races[0])


def audit_original_inputs(capture_dir: Path, baseline_report: Path,
                          refs: adapter.ReferenceData) -> dict:
    """Fail-closed gate for the seven original fixtures in the saved report.

    Stable bytes during this read are insufficient: each file must also match
    the saved original-file hash. A ready input must have a consistent returned
    spec, completeness flag, status, and canonical hash matching the prior run.
    """
    result = {'kind': 'original-capture-initial-input-audit-only',
              'simulationExecuted': False, 'priorReportSha256': None,
              'priorObservedComparisonStatusesAreHistorical': True,
              'expectedFixtureCount': EXPECTED_ORIGINAL_FIXTURE_COUNT,
              'allExpectedFixturesPresent': False, 'manifestValid': False,
              'preparedInputHashesUnchanged': False, 'originalFilesUnchanged': False,
              'preparationStatusesConsistent': False, 'completenessConsistent': False,
              'allChecksPassed': False, 'errors': [], 'cases': []}

    def digest(value):
        return isinstance(value, str) and len(value) == 64 and all(char in '0123456789abcdef' for char in value)

    try:
        baseline_bytes = baseline_report.read_bytes()
        result['priorReportSha256'] = sha256(baseline_bytes)
        prior = json.loads(baseline_bytes)
        cases = prior.get('cases') if isinstance(prior, dict) else None
        if not isinstance(cases, list):
            raise ValueError('Prior report must contain a cases array')
    except (OSError, ValueError) as error:
        result['errors'].append(f'Prior report unavailable or malformed: {type(error).__name__}')
        return result
    if prior.get('fixtureCount') != EXPECTED_ORIGINAL_FIXTURE_COUNT or len(cases) != EXPECTED_ORIGINAL_FIXTURE_COUNT:
        result['errors'].append('Prior report must retain exactly the seven expected fixture rows')
    seen = set()
    for previous in cases:
        if not isinstance(previous, dict):
            result['errors'].append('Prior fixture row is not an object')
            continue
        name = previous.get('capture')
        if (not isinstance(name, str) or Path(name).name != name or '/' in name or '\\' in name
                or not name.endswith('.json') or name in seen):
            result['errors'].append('Prior fixture name is missing, unsafe, or duplicated')
            continue
        seen.add(name)
        path = capture_dir / name
        previous_input = previous.get('preparedInputSha256')
        previous_audit = previous.get('initialInputAudit', {})
        expected_status = {'verified': 'ready', 'mismatch': 'ready',
                           'needs_input': 'needs_input', 'unsupported': 'unsupported'}.get(previous.get('expectedStatus'))
        expected_ready = expected_status == 'ready'
        prior_consistent = (isinstance(previous_audit, dict) and expected_status is not None
            and previous_audit.get('status') == expected_status
            and previous_audit.get('strictInitialInputComplete') is expected_ready
            and isinstance(previous_audit.get('missingInputs'), list)
            and (digest(previous_input) if expected_ready else previous_input is None)
            and digest(previous.get('captureSha256')))
        if not prior_consistent:
            result['errors'].append(f'Prior fixture preparation metadata is incomplete or inconsistent: {name}')
        row = {'capture': name, 'captureFileSha256': None, 'filePresent': False,
               'fileUnchangedDuringAudit': False, 'matchesPriorCaptureFileSha256': False,
               'expectedInitialInputStatus': expected_status, 'initialInputStatus': 'audit_error',
               'missingInputs': [], 'errors': [], 'inputCanonicalSha256': None,
               'previousInputCanonicalSha256': previous_input, 'inputHashUnchanged': False,
               'statusConsistent': False, 'missingInputsConsistent': False,
               'completenessConsistent': False, 'allChecksPassed': False,
               'recordedSeed': None, 'strictInitialInputComplete': False,
               'priorObservedComparisonStatus': previous.get('expectedStatus'),
               'simulationExecuted': False, 'observedOutcomesUsedAsInputs': False}
        result['cases'].append(row)
        try:
            original_bytes = path.read_bytes()
            row['filePresent'] = True
            original_sha = sha256(original_bytes)
            row['captureFileSha256'] = original_sha
            row['matchesPriorCaptureFileSha256'] = original_sha == previous.get('captureSha256')
            capture = json.loads(original_bytes)
            # Preserve the initial seed even when context preparation stops
            # before the adapter creates its ready-only recordedSeed field.
            row['recordedSeed'] = adapter.normalize_capture(capture).get('random_seed')
            spec, audit = adapter.prepare_capture(capture, refs)
            row['fileUnchangedDuringAudit'] = original_sha == sha256(path.read_bytes())
            actual_input = audit.get('inputCanonicalSha256')
            current_ready = audit.get('status') == 'ready'
            current_consistent = (audit.get('strictInitialInputComplete') is current_ready
                and (spec is not None) == current_ready
                and isinstance(audit.get('errors'), list)
                and isinstance(audit.get('missingInputs'), list)
                and (digest(actual_input) and actual_input == sha256(adapter.canonical(spec))
                     and not audit['errors'] and not audit['missingInputs']
                     if current_ready else actual_input is None))
            row.update({'initialInputStatus': audit.get('status'), 'missingInputs': audit.get('missingInputs'),
                        'errors': audit.get('errors'), 'inputCanonicalSha256': actual_input,
                        'inputHashUnchanged': actual_input == previous_input,
                        'statusConsistent': audit.get('status') == expected_status,
                        'missingInputsConsistent': isinstance(previous_audit, dict)
                            and audit.get('missingInputs') == previous_audit.get('missingInputs'),
                        'completenessConsistent': bool(current_consistent),
                        'courseId': audit.get('courseId'), 'raceInstanceId': audit.get('raceInstanceId'),
                        'strictInitialInputComplete': audit.get('strictInitialInputComplete'),
                        'observedOutcomesUsedAsInputs': audit.get('observedOutcomesUsedAsInputs')})
            row['allChecksPassed'] = bool(prior_consistent and all(row[key] for key in (
                'fileUnchangedDuringAudit', 'matchesPriorCaptureFileSha256', 'inputHashUnchanged',
                'statusConsistent', 'missingInputsConsistent', 'completenessConsistent'))
                and row['observedOutcomesUsedAsInputs'] is False)
        except (OSError, ValueError, TypeError, KeyError) as error:
            row['errors'] = [f'Original fixture audit failed: {type(error).__name__}']
    rows = result['cases']
    complete_rows = len(rows) == EXPECTED_ORIGINAL_FIXTURE_COUNT
    result.update({'manifestValid': not result['errors'],
        'allExpectedFixturesPresent': complete_rows and all(row['filePresent'] for row in rows),
        'statuses': dict(Counter(row['initialInputStatus'] for row in rows)),
        'preparedInputHashesUnchanged': complete_rows and all(row['inputHashUnchanged'] for row in rows),
        'readyInputHashCount': sum(row['initialInputStatus'] == 'ready' and row['inputHashUnchanged'] for row in rows),
        'originalFilesUnchanged': complete_rows and all(row['fileUnchangedDuringAudit']
                                                      and row['matchesPriorCaptureFileSha256'] for row in rows),
        'preparationStatusesConsistent': complete_rows and all(row['statusConsistent'] for row in rows),
        'completenessConsistent': complete_rows and all(row['completenessConsistent'] for row in rows)})
    result['allChecksPassed'] = bool(result['manifestValid'] and result['allExpectedFixturesPresent']
                                     and all(row['allChecksPassed'] for row in rows))
    return result


def validation_exit_code(tests_passed: bool, original_audit: dict | None) -> int:
    """The CLI verdict includes the optional original-fixture gate."""
    return 0 if tests_passed and (original_audit is None or original_audit.get('allChecksPassed') is True) else 1


class OriginalAuditGateTests(unittest.TestCase):
    """Small synthetic file/audit boundary tests; no external checkout or engine."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.baseline = self.root / 'prior.json'
        self.prior = {'fixtureCount': 7, 'cases': []}
        self.mode = None
        for index in range(7):
            capture = {'synthetic_index': index, 'random_seed': 1780329953 if index == 6 else 100 + index,
                       'race_horse_data_array': []}
            path = self.root / f'synthetic-{index}.json'
            path.write_bytes(adapter.canonical(capture))
            spec, audit = self.prepared(capture, None)
            self.prior['cases'].append({'capture': path.name, 'captureSha256': sha256(path.read_bytes()),
                'preparedInputSha256': audit.get('inputCanonicalSha256'), 'initialInputAudit': audit,
                'expectedStatus': 'needs_input' if index == 6 else 'mismatch' if index == 5 else 'verified'})
        self.save_prior()

    def save_prior(self):
        self.baseline.write_bytes(adapter.canonical(self.prior))

    def prepared(self, capture, _references):
        index = capture['synthetic_index']
        ready = index != 6 and not (index == 0 and self.mode == 'changed-status')
        spec = {'seed': capture['random_seed'], 'synthetic': True} if ready else None
        if index == 0 and self.mode == 'changed-input':
            spec['seed'] += 1
        audit = {'status': 'ready' if ready else 'needs_input', 'strictInitialInputComplete': ready,
                 'missingInputs': [] if ready else ['courseId', 'grade', 'time'], 'errors': [],
                 'observedOutcomesUsedAsInputs': False}
        if ready:
            audit['inputCanonicalSha256'] = sha256(adapter.canonical(spec))
        if index == 0 and self.mode == 'inconsistent-completeness':
            audit['strictInitialInputComplete'] = False
        return spec, audit

    def run_audit(self):
        with patch.object(adapter, 'prepare_capture', side_effect=self.prepared):
            return audit_original_inputs(self.root, self.baseline, None)

    def test_matching_originals_pass_and_incomplete_input_retains_seed(self):
        audit = self.run_audit()
        self.assertTrue(audit['allChecksPassed'])
        self.assertEqual(audit['readyInputHashCount'], 6)
        self.assertEqual(audit['cases'][-1]['recordedSeed'], 1780329953)
        self.assertEqual(validation_exit_code(True, audit), 0)

    def test_changed_original_fails_even_if_stable_during_read_and_spec_unchanged(self):
        path = self.root / 'synthetic-0.json'
        changed = json.loads(path.read_bytes())
        changed['unused_note'] = 'Original bytes were changed before this audit'
        path.write_bytes(adapter.canonical(changed))
        audit = self.run_audit()
        self.assertTrue(audit['cases'][0]['fileUnchangedDuringAudit'])
        self.assertTrue(audit['preparedInputHashesUnchanged'])
        self.assertFalse(audit['originalFilesUnchanged'])
        self.assertFalse(audit['allChecksPassed'])
        self.assertEqual(validation_exit_code(True, audit), 1)

    def test_missing_or_duplicated_prior_fixture_rows_and_missing_files_fail(self):
        original = deepcopy(self.prior)
        for mode in ('missing-row', 'duplicate-row', 'missing-file'):
            with self.subTest(mode=mode):
                self.prior = deepcopy(original)
                if mode == 'missing-row':
                    self.prior['cases'].pop()
                elif mode == 'duplicate-row':
                    self.prior['cases'][-1] = deepcopy(self.prior['cases'][0])
                else:
                    (self.root / 'synthetic-6.json').unlink()
                self.save_prior()
                audit = self.run_audit()
                self.assertFalse(audit['allExpectedFixturesPresent'])
                self.assertFalse(audit['allChecksPassed'])
                self.assertEqual(validation_exit_code(True, audit), 1)

    def test_changed_input_status_or_completeness_fails(self):
        for mode in ('changed-input', 'changed-status', 'inconsistent-completeness'):
            with self.subTest(mode=mode):
                self.mode = mode
                audit = self.run_audit()
                self.assertTrue(audit['originalFilesUnchanged'])
                self.assertFalse(audit['allChecksPassed'])
                self.assertEqual(validation_exit_code(True, audit), 1)

    def test_overall_cli_gate_cannot_ignore_failed_or_incomplete_optional_audit(self):
        self.assertEqual(validation_exit_code(True, None), 0)
        self.assertEqual(validation_exit_code(True, {'allChecksPassed': True}), 0)
        for value in ({}, {'allChecksPassed': False}, {'allChecksPassed': 1}):
            with self.subTest(audit=value):
                self.assertEqual(validation_exit_code(True, value), 1)
        self.assertEqual(validation_exit_code(False, {'allChecksPassed': True}), 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--umalytics-root', type=Path, required=True)
    parser.add_argument('--globalsim-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--capture-dir', type=Path)
    parser.add_argument('--baseline-report', type=Path)
    args = parser.parse_args()
    if bool(args.capture_dir) != bool(args.baseline_report):
        parser.error('--capture-dir and --baseline-report must be supplied together')
    CourseCaptureTests.app_root = args.umalytics_root.resolve()
    CourseCaptureTests.globalsim_root = args.globalsim_root.resolve()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromTestCase(OriginalAuditGateTests),
        unittest.defaultTestLoader.loadTestsFromTestCase(CourseCaptureTests)]))
    paths = ['scripts/proxy/race_extract.py', 'src/data/import.ts', 'src/data/raw-export.ts',
             'src/data/share.ts', 'tests/room-course-workflow.py']
    evidence = {'schemaVersion': 1, 'scope': 'synthetic room-course mapping and initial-input readiness',
        'expectedAppCommit': APP_COMMIT, 'expectedEngineCommit': adapter.GLOBALSIM_COMMIT,
        'sourceHashes': {path: sha256((args.umalytics_root / path).read_bytes()) for path in paths},
        'adapterVersion': adapter.ADAPTER_VERSION,
        'adapterSha256': sha256(Path(adapter.__file__).read_bytes()),
        'testSourceSha256': sha256(Path(__file__).read_bytes()),
        'simulationExecuted': False, 'observedOutcomesUsedAsInputs': False,
        'completeImporterEntryPointExecuted': False,
        'executedAppModules': ['scripts/proxy/race_extract.py', 'tests/room-course-workflow.py',
                               'src/data/raw-export.ts', 'src/data/share.ts'],
        'importerCoverage': 'import.ts was read to reproduce its raw-export options; parseRaceJson, parseExport, and parseNormalized entry points were not executed.',
        'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
        'skipped': len(result.skipped), 'allTestsPassed': result.wasSuccessful(),
        'checks': CourseCaptureTests.evidence,
        'limitations': [
            'Synthetic matching metadata proves software behavior, not the true course of an existing room capture.',
            'This focused course audit executes no engine. See the separate simulator regression and new-capture reports.',
            'A complete input still requires supported runner data, skills, rules, course geometry, and a compatible game version.',
            'Room definitions must arrive in the same capture session before replay extraction; in-memory history is bounded to 64 bindings.',
            'Positive integer seed/room joins can withhold unmatched or conflicting inputs; they do not authenticate upstream data.',
            'Portable export preserves collector provenance, direct course aliases and raw distance; normalized UI fields are never a substitute.',
            'Conflicting course-only candidates are retained and the join is withheld.',
            'Full parseRaceJson/service import round trips are covered separately by tests/versioned-capture-workflow.ts.',
            'Raw RoomMatch start_time_type remains uninterpreted; exact instance master or independently confirmed time is required.',
        ]}
    original_audit = None
    if args.capture_dir:
        original_audit = evidence['originalCaptureInputAudit'] = audit_original_inputs(
            args.capture_dir, args.baseline_report, CourseCaptureTests.references)
    exit_code = validation_exit_code(result.wasSuccessful(), original_audit)
    evidence['overallSuccess'] = exit_code == 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'testsRun': result.testsRun, 'allTestsPassed': result.wasSuccessful(),
                      'overallSuccess': evidence['overallSuccess'],
                      'originalInputAuditPassed': original_audit.get('allChecksPassed') if original_audit else None,
                      'simulationExecuted': False, 'output': str(args.output.resolve())}))
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
