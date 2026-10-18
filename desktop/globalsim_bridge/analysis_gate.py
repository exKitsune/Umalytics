"""Production analysis authorization; the low-level runtime is diagnostic only.

Compatibility is selected before simulator references, executable files, cache,
or workers are touched. Recorded replay decoding is independent of simulator
installation. Engine bindings come from trusted application configuration, never
browser-supplied paths or profile overrides. This module does not implement an
app route, UI, inference engine, or an inference-result cache.

The SHA bindings detect stale selections; they are not authentication tokens.
The service must own its jobs and registry and reject browser engine settings.
An inference worker must revalidate the plan and measure its own bundle/data
before cache lookup or execution. A historical engine requires a distinct,
validated implementation/data bundle, not a new label on today's engine.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import struct
from typing import Mapping

from . import adapter, runtime, versioning
from .comparator import decode_scenario


ANALYSIS_GATE_VERSION = "versioned-analysis-gate-v1"
MAX_CAPTURE_BYTES = 16 * 1024 * 1024
COMPARED_CAPABILITIES = ("recordedResults", "sampledMovement", "sampledRunnerState",
                         "skillEvents", "competitionEvents")
FALLBACK_NOTICES = {
    "SIMULATOR_NOT_INSTALLED": "The simulator registered for this race is not installed.",
    "SIMULATOR_IDENTITY_MISMATCH": "The installed simulator or its data does not match the registered version.",
    "SIMULATION_MISMATCH": "The simulator did not reproduce the recorded race.",
    "SIMULATION_ERROR": "The registered simulator could not complete this race.",
    "SIMULATION_NEEDS_INPUT": "The registered simulator needs more original race setup data.",
    "SIMULATION_UNSUPPORTED": "The registered simulator does not support this race's inputs or observations.",
    "SIMULATION_REPORT_INVALID": "The simulator report did not satisfy the required identity and observation checks.",
}
FUTURE_NOTICE = "This race is newer than this inference engine's registered coverage. Provisional inference may give inaccurate mechanics-dependent results."


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode('utf-8')


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _snapshot(value):
    encoded = _canonical(value)
    return json.loads(encoded), _sha(encoded)


def _digest_value(value: str, name: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value.lower()):
        raise ValueError(f'{name} must be a SHA-256 hex digest')
    return value.lower()


def _file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class InferenceBinding:
    """An app-installed inference bundle; its worker must measure these pins."""
    engine_id: str
    version: str
    profile: str
    artifact_sha256: str
    data_sha256: str

    def __post_init__(self):
        for name in ('engine_id', 'version', 'profile'):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip() or len(value) > 512:
                raise ValueError(f'{name} must be a bounded nonempty identifier')
        for name in ('artifact_sha256', 'data_sha256'):
            object.__setattr__(self, name, _digest_value(getattr(self, name), name))

    def as_identity(self) -> dict:
        return {'engineId': self.engine_id, 'version': self.version, 'profile': self.profile,
                'identity': {'artifactSha256': self.artifact_sha256, 'dataSha256': self.data_sha256}}


@dataclass(frozen=True)
class SimulatorBinding(InferenceBinding):
    """App-controlled executable/data roots for one immutable registry entry.

    data_sha256 is ReferenceData.fingerprint (canonical ReferenceData.identity).
    RuntimeConfig currently implements only the pinned, audited v74 adapter.
    Registering another era does not add a historical adapter implementation.
    """
    config: runtime.RuntimeConfig

    def __post_init__(self):
        super().__post_init__()
        if not isinstance(self.config, runtime.RuntimeConfig):
            raise ValueError('SimulatorBinding requires app-controlled RuntimeConfig')
        if self.config.expected_engine_sha256 != self.artifact_sha256:
            raise ValueError('Production simulator config must pin the registered executable SHA-256')


def _notice(code: str, message: str, severity: str = 'warning') -> dict:
    return {'code': code, 'message': message, 'severity': severity, 'persistent': True}


def _add_notice(report: dict, value: dict):
    if not any(item['code'] == value['code'] for item in report['notices']):
        report['notices'].append(value)


def _recorded_scenario(capture: dict) -> tuple[object, dict | None]:
    """Only explicit singleton data/races wrappers, never an arbitrary search.

    A multi-race document requires the service to select its exact entry first.
    This projection is observational only; the canonical hash stays the whole
    supplied document and does not imply the simulator adapter supports it.
    """
    node = capture
    for _ in range(8):
        fields = [key for key in ('race_scenario', 'simDataBase64') if key in node]
        wrappers = [key for key in ('data', 'races') if key in node]
        if len(fields) > 1 or len(wrappers) > 1 or fields and wrappers:
            return None, {'code':'RECORDED_REPLAY_AMBIGUOUS',
                          'message':'Select one explicit replay entry before viewing this document.'}
        if fields:
            key = fields[0]
            if key == 'simDataBase64' and node.get('schemaVersion') != 1:
                return None, None
            return node[key], None
        if not wrappers:
            return None, None
        child = node[wrappers[0]]
        if isinstance(child, list):
            if len(child) != 1:
                return None, {'code':'RECORDED_REPLAY_AMBIGUOUS',
                              'message':'A multi-entry replay document requires an explicit race selection.'}
            child = child[0]
        if not isinstance(child, dict):
            return None, None
        node = child
    return None, {'code':'RECORDED_REPLAY_WRAPPER_LIMIT', 'message':'Replay wrapper depth exceeds the supported limit.'}


def _recorded_replay(capture: dict) -> tuple[dict | None, str, dict | None]:
    # Original replay decoding does not require runner inputs or simulator refs.
    scenario, selection_error = _recorded_scenario(capture)
    if selection_error:
        return None, 'unavailable', selection_error
    if not isinstance(scenario, str) or not scenario:
        return None, 'unavailable', {'code': 'RECORDED_REPLAY_MISSING', 'message': 'Original replay bytes are unavailable.'}
    try:
        if len(scenario.encode('utf-8')) > MAX_CAPTURE_BYTES:
            return None, 'unavailable', {'code': 'RECORDED_REPLAY_LIMIT', 'message': 'Original replay exceeds the decoder limit.'}
        return decode_scenario(scenario), 'available', None
    except (ValueError, TypeError, KeyError, IndexError, struct.error, UnicodeError) as error:
        return None, 'unavailable', {'code': 'RECORDED_REPLAY_UNSUPPORTED',
                                   'message': 'Original replay cannot be decoded by this kit.',
                                   'details': {'type': type(error).__name__}}


def _bound_inputs(capture, registry, evidence, context):
    if not isinstance(capture, dict):
        raise ValueError('Capture must be an object')
    encoded = _canonical(capture)
    if len(encoded) > MAX_CAPTURE_BYTES:
        raise ValueError('Capture exceeds the production gate limit')
    frozen_capture = json.loads(encoded)
    frozen_registry, _ = _snapshot(registry)
    # Absence is unknown original identity, not a malformed supplied schema.
    # Only binding/schema metadata are filled; no original-race facts are guessed.
    unknown_evidence = {'schemaVersion': 1, 'captureSha256': _sha(encoded), 'provenance': {}}
    frozen_evidence, _ = _snapshot(unknown_evidence if evidence is None else evidence)
    frozen_context, context_sha = _snapshot(context)
    decision = versioning.select_compatibility(_sha(encoded), frozen_evidence, frozen_registry)
    return frozen_capture, frozen_context, context_sha, decision


def _engine_binding(candidate, bindings, kind):
    if not isinstance(candidate, dict) or candidate.get('eligible') is not True:
        return None
    if not isinstance(bindings, Mapping):
        return None
    binding = bindings.get(candidate.get('engineId'))
    expected_type = SimulatorBinding if kind == 'simulation' else InferenceBinding
    if type(binding) is not expected_type:
        return None
    identity = binding.as_identity()
    if any(identity[key] != candidate.get(key) for key in ('engineId', 'version', 'profile', 'identity')):
        return None
    return binding


def _selection_binding(decision: dict, context_sha: str,
                       simulator: SimulatorBinding | None, inference: InferenceBinding | None) -> dict:
    material = {'gateVersion': ANALYSIS_GATE_VERSION, 'captureSha256': decision.get('captureSha256'),
                'registrySha256': decision.get('registrySha256'), 'evidenceSha256': decision.get('evidenceSha256'),
                'selectionSha256': decision.get('selectionSha256'), 'contextSha256': context_sha,
                'simulation': simulator.as_identity() if simulator else None,
                'inference': inference.as_identity() if inference else None}
    if simulator:
        material['simulationArgumentsSha256'] = _sha(_canonical(simulator.config.engine_args))
    return {**material, 'authorizationSha256': _sha(_canonical(material))}


def _inference_is_eligible(decision: dict) -> bool:
    candidate = decision.get('inference', {})
    if (decision.get('mode') not in ('compatible', 'provisional_future_inference')
            or candidate.get('eligible') is not True):
        return False
    if candidate.get('provisional') is False:
        return True
    return (candidate.get('provisional') is True
            and isinstance(decision.get('provisionalPolicy'), dict))


def _inference_plan(decision: dict, context_sha: str, binding: InferenceBinding,
                    fallback_reason: str | None) -> dict:
    if fallback_reason is not None and fallback_reason not in FALLBACK_NOTICES:
        raise ValueError('Unknown inference fallback reason')
    provisional = decision['inference']['provisional'] is True
    notices = [_notice('VERSIONED_INFERENCE', 'Analysis is authorized for the registered inference model.', 'info')]
    if fallback_reason:
        notices.append(_notice(fallback_reason, FALLBACK_NOTICES[fallback_reason]))
    policy = decision.get('provisionalPolicy') if provisional else None
    if provisional:
        notices.append(_notice('PROVISIONAL_FUTURE_INFERENCE', FUTURE_NOTICE))
        if isinstance(policy.get('notice'), str) and policy['notice'].strip():
            notices.append(_notice('FUTURE_POLICY_NOTICE', policy['notice']))
    material = {'schemaVersion': 1, 'gateVersion': ANALYSIS_GATE_VERSION,
                'captureSha256': decision['captureSha256'], 'registrySha256': decision['registrySha256'],
                'evidenceSha256': decision['evidenceSha256'], 'selectionSha256': decision['selectionSha256'],
                'contextSha256': context_sha, 'engine': binding.as_identity(),
                'provisional': provisional, 'provisionalPolicy': policy,
                'fallbackReason': fallback_reason, 'notices': notices,
                'executionStatus': 'not_executed', 'requiresWorkerReauthorization': True}
    return {**material, 'authorizationSha256': _sha(_canonical(material))}


def _simulator_report_matches(report: dict, capture_sha: str, binding: SimulatorBinding) -> bool:
    if not isinstance(report, dict) or report.get('captureSha256') != capture_sha:
        return False
    identities = report.get('identities', {})
    engine = identities.get('engine', {})
    return (report.get('schemaVersion') == 1
            and report.get('verificationScope') == runtime.VERIFICATION_SCOPE
            and engine.get('sha256') == binding.artifact_sha256
            and engine.get('expectedSha256') == binding.artifact_sha256
            and engine.get('binaryPinVerified') is True
            and engine.get('argumentsSha256') == _sha(_canonical(binding.config.engine_args))
            and _sha(_canonical(identities.get('data'))) == binding.data_sha256)


def evaluate_for_analysis(capture: dict, registry: dict,
                         simulator_bindings: Mapping[str, SimulatorBinding], *,
                         evidence: dict | None = None, context: dict | None = None,
                         inference_bindings: Mapping[str, InferenceBinding] | None = None) -> dict:
    """Select product analysis before reading any model cache or runtime data.

    `recorded_only` authorizes no mechanical inference. `verified_simulation`
    authorizes only the compared recorded capabilities. `inference_plan`
    returns an unexecuted plan for an independently gated app worker. Unknown
    era/time and unapproved future rules cannot fall back to today's inference.

    Never restore a cached product verdict instead of calling this function.
    Diagnostic fixture tools may call runtime.evaluate_capture separately;
    their reports alone are not product analysis authorization.
    """
    report = {'schemaVersion': 1, 'gateVersion': ANALYSIS_GATE_VERSION, 'mode': 'recorded_only',
              'binding': None, 'compatibility': None, 'observed': None, 'replayStatus': 'unavailable',
              'simulation': None, 'inferencePlan': None, 'notices': [], 'error': None,
              'permissions': {'recordedReplay': False, 'simulatedRecordedCapabilities': False,
                              'inferenceExecutionPlan': False, 'unversionedInference': False}}

    def recorded_only():
        _add_notice(report, _notice('RECORDED_ONLY',
            'No compatible analysis is authorized for this race. Only recorded replay data may be shown.'))
        return report

    try:
        # Freeze the bytes used by both playback and the compatibility binding.
        # The supplied wrapper's hash is retained; observation projection does
        # not silently replace the caller's selected document with a child.
        frozen_for_replay, _ = _snapshot(capture)
        if isinstance(frozen_for_replay, dict):
            report['observed'], report['replayStatus'], replay_error = _recorded_replay(frozen_for_replay)
            report['permissions']['recordedReplay'] = report['replayStatus'] == 'available'
            if replay_error:
                report['error'] = replay_error
        frozen_capture, frozen_context, context_sha, decision = _bound_inputs(frozen_for_replay, registry, evidence, context)
        report['compatibility'] = decision
        for notice in decision.get('notices', []):
            if (isinstance(notice, dict) and isinstance(notice.get('code'), str)
                    and notice['code'] not in ('PROVISIONAL_FUTURE_INFERENCE', 'FUTURE_POLICY_NOTICE')
                    and isinstance(notice.get('message'), str)):
                _add_notice(report, _notice(notice['code'], notice['message']))
        # This return precedes binding lookup, reference loading, file hashing,
        # low-level evaluation, and every model cache/worker access.
        if decision.get('mode') not in ('compatible', 'provisional_future_inference'):
            report['binding'] = _selection_binding(decision, context_sha, None, None)
            return recorded_only()
        simulation_eligible = (decision.get('simulation', {}).get('eligible') is True
                               and decision['simulation'].get('provisional') is False)
        simulator = (_engine_binding(decision.get('simulation'), simulator_bindings, 'simulation')
                     if simulation_eligible else None)
        inference = (_engine_binding(decision.get('inference'), inference_bindings, 'inference')
                     if _inference_is_eligible(decision) else None)
        report['binding'] = _selection_binding(decision, context_sha, simulator, inference)
        fallback = None
        if simulation_eligible:
            if simulator is None:
                fallback = ('SIMULATOR_IDENTITY_MISMATCH' if simulator_bindings.get(decision['simulation'].get('engineId'))
                            else 'SIMULATOR_NOT_INSTALLED')
            else:
                try:
                    # Compatibility has already passed. Measure immutable
                    # executable/data identity before runtime cache access.
                    if _file_sha(simulator.config.engine_path) != simulator.artifact_sha256:
                        raise ValueError('Registered simulator artifact differs')
                    references = adapter.ReferenceData.load(simulator.config.umalytics_root,
                                                             simulator.config.globalsim_root)
                    if _sha(_canonical(references.identity)) != simulator.data_sha256:
                        raise ValueError('Registered simulator data differs')
                    diagnostic = runtime.evaluate_capture(frozen_capture, simulator.config, context=frozen_context)
                    report['simulation'] = diagnostic
                    if not _simulator_report_matches(diagnostic, decision['captureSha256'], simulator):
                        # Early runtime input failures legitimately have no
                        # executable identity; they still never authorize data.
                        fallback = {'needs_input': 'SIMULATION_NEEDS_INPUT', 'unsupported': 'SIMULATION_UNSUPPORTED',
                                    'engine_error': 'SIMULATION_ERROR'}.get(diagnostic.get('status'), 'SIMULATION_REPORT_INVALID')
                    elif (diagnostic.get('status') == 'verified'
                          and diagnostic.get('comparison', {}).get('allComparedChecksPass') is True
                          and all(diagnostic.get('capabilities', {}).get(key) == 'verified' for key in COMPARED_CAPABILITIES)):
                        report['mode'] = 'verified_simulation'
                        report['permissions']['simulatedRecordedCapabilities'] = True
                        return report
                    else:
                        fallback = {'mismatch': 'SIMULATION_MISMATCH', 'engine_error': 'SIMULATION_ERROR',
                                    'needs_input': 'SIMULATION_NEEDS_INPUT', 'unsupported': 'SIMULATION_UNSUPPORTED'}.get(
                                        diagnostic.get('status'), 'SIMULATION_REPORT_INVALID')
                except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
                    fallback = 'SIMULATOR_IDENTITY_MISMATCH'
                    report['error'] = {'code': fallback, 'message': FALLBACK_NOTICES[fallback],
                                       'details': {'type': type(error).__name__}}
        if fallback:
            _add_notice(report, _notice(fallback, FALLBACK_NOTICES[fallback]))
        if inference is not None:
            plan = _inference_plan(decision, context_sha, inference, fallback)
            report['mode'], report['inferencePlan'] = 'inference_plan', plan
            report['permissions']['inferenceExecutionPlan'] = True
            for notice in plan['notices']:
                # The wrapper's fixed future warning takes precedence over a
                # selector notice bearing the same machine-readable code.
                report['notices'] = [item for item in report['notices'] if item['code'] != notice['code']]
                _add_notice(report, notice)
            return report
        return recorded_only()
    except (ValueError, TypeError, KeyError, AttributeError, RecursionError, UnicodeError) as error:
        report['error'] = {'code': 'ANALYSIS_GATE_INVALID_INPUT',
                           'message': 'Race/version evidence could not be bound safely.',
                           'details': {'type': type(error).__name__}}
        return recorded_only()


def revalidate_inference_plan(plan: dict, capture: dict, registry: dict,
                              inference_bindings: Mapping[str, InferenceBinding], *,
                              evidence: dict | None = None, context: dict | None = None,
                              measured_artifact_sha256: str | None = None,
                              measured_data_sha256: str | None = None) -> dict:
    """Mandatory app-worker gate BEFORE inference cache lookup or execution.

    Measurements must come from the actual app-owned worker bundle and data,
    never from browser claims. A successful result reissues the complete plan
    including persistent notices. This does not execute or validate inference,
    and the worker still must validate its required race inputs and outputs.
    """
    result = {'schemaVersion': 1, 'authorized': False, 'executionPerformed': False,
              'reasonCodes': [], 'plan': None}
    try:
        _, _, context_sha, decision = _bound_inputs(capture, registry, evidence, context)
        if not _inference_is_eligible(decision):
            result['reasonCodes'] = ['INFERENCE_VERSION_NOT_ELIGIBLE']
            return result
        binding = _engine_binding(decision.get('inference'), inference_bindings, 'inference')
        if binding is None:
            result['reasonCodes'] = ['INFERENCE_BINDING_MISMATCH']
            return result
        if (measured_artifact_sha256 != binding.artifact_sha256 or measured_data_sha256 != binding.data_sha256):
            result['reasonCodes'] = ['INFERENCE_IDENTITY_NOT_VERIFIED']
            return result
        if not isinstance(plan, dict):
            raise ValueError('Inference plan must be an object')
        expected = _inference_plan(decision, context_sha, binding, plan.get('fallbackReason'))
        if _canonical(plan) != _canonical(expected):
            result['reasonCodes'] = ['INFERENCE_PLAN_STALE_OR_CHANGED']
            return result
        result.update(authorized=True, plan=expected)
        return result
    except (ValueError, TypeError, KeyError, AttributeError, RecursionError, UnicodeError):
        result['reasonCodes'] = ['INFERENCE_PLAN_INVALID']
        return result
