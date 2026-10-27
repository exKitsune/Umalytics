"""Bounded local execution with explicit provenance and observed-field gates.

Only application configuration selects an executable or reference directories.
Capture data cannot select commands, paths, runtime flags, or cached verdicts.
Cached modeled output is decoded and compared again on every evaluation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import signal
import struct
import subprocess
import tempfile
import threading
import time
from typing import Any

from . import adapter
from .comparator import COMPARATOR_VERSION, compare_observations, decode_scenario
from .cache_storage import SHARED, read_blob, write_shared

RUNTIME_VERSION = "bounded-local-runtime-v1"
UPSTREAM_REVISION = "efc2decdfeaff227ada0e9847f5deceb42c3b97f"
VERIFICATION_SCOPE = "recorded_observations_v1"
CACHE_SCHEMA = 1
REQUIRED_PROFILE = {
    "experimentalRetailInitialization": True,
    "experimentalRetailSections": True,
    "experimentalRetailRuntime": True,
    "experimentalRetailGeometry": True,
    "retainAllFrames": True,
}
DISALLOWED_EXPERIMENTS = (
    "experimentalRetailStartup", "experimentalLaterStaminaMechanics", "experimentalGrid",
)
SUPPORTED_REPLAY_HEADERS = {100000002}


@dataclass(frozen=True)
class RuntimeConfig:
    engine_path: Path
    umalytics_root: Path
    globalsim_root: Path
    work_root: Path | None = None
    cache_root: Path | None = None
    timeout_seconds: float = 60.0
    max_capture_bytes: int = 16 * 1024 * 1024
    max_input_bytes: int = 8 * 1024 * 1024
    max_output_bytes: int = 64 * 1024 * 1024
    max_stderr_bytes: int = 256 * 1024
    # Trusted application configuration only. The shipped worker needs no args.
    engine_args: tuple[str, ...] = ()
    # Supply from the trusted bundle build manifest in production. A measured
    # hash alone is not an attestation that an arbitrary binary came from Git.
    expected_engine_sha256: str | None = None
    decision_trace_schema: str | None = None
    # Service-owned installation secret; never supplied by a capture or browser.
    cache_auth_key: bytes | None = field(default=None, repr=False)
    worker_pool: Any = field(default=None, repr=False, compare=False)
    worker_protocol: str = 'json'
    low_priority: bool = False
    skill_catalog: dict | None = field(default=None, repr=False, compare=False)
    decode_frames: bool = True
    # Internal analysis IPC: the consumer validates and decodes retained frames.
    retain_binary_frames: bool = False

    def __post_init__(self):
        if self.worker_protocol not in ('json', 'binary-v1'):
            raise ValueError('Unsupported worker protocol')
        for name in ("engine_path", "umalytics_root", "globalsim_root", "work_root", "cache_root"):
            value = getattr(self, name)
            if value is not None:
                object.__setattr__(self, name, Path(value).expanduser().resolve())
        if self.decision_trace_schema not in (None, "umalytics-decisions-v1"):
            raise ValueError("Unsupported decision trace schema")
        if self.cache_auth_key is not None and (not isinstance(self.cache_auth_key, bytes) or len(self.cache_auth_key) != 32):
            raise ValueError("cache_auth_key must be a 32-byte installation secret")
        if not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be finite and positive")
        for name in ("max_capture_bytes", "max_input_bytes", "max_output_bytes", "max_stderr_bytes"):
            value = getattr(self, name)
            if type(value) is not int or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        if not all(isinstance(arg, str) and "\0" not in arg for arg in self.engine_args):
            raise ValueError("engine_args must contain trusted argument strings")
        object.__setattr__(self, "engine_args", tuple(self.engine_args))
        if self.expected_engine_sha256 is not None:
            pin = self.expected_engine_sha256.lower()
            if len(pin) != 64 or any(c not in "0123456789abcdef" for c in pin):
                raise ValueError("expected_engine_sha256 must be a SHA-256 hex digest")
            object.__setattr__(self, "expected_engine_sha256", pin)


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _code_identities() -> tuple[dict, bool]:
    paths = {
        "runtime": Path(__file__),
        "adapter": Path(adapter.__file__),
        "comparator": Path(__file__).with_name("comparator.py"),
        "decisionTrace": Path(__file__).with_name("decision_trace.py"),
        "transport": Path(__file__).with_name("worker_pool.py"),
        "cacheStorage": Path(__file__).with_name("cache_storage.py"),
    }
    hashes = {}
    complete = True
    for name, path in paths.items():
        if path.suffix == '.pyc':
            path = path.with_suffix('.py')  # Explicit packaged source identity resources.
        try:
            hashes[name] = _file_digest(path)
        except OSError:
            hashes[name] = None
            complete = False
    return {"runtimeVersion": RUNTIME_VERSION, "comparatorVersion": COMPARATOR_VERSION,
            "sourceSha256": hashes}, complete


def _profile_identity(initial: dict) -> dict:
    fields = set(REQUIRED_PROFILE) | set(DISALLOWED_EXPERIMENTS)
    fields.update(key for key in initial if key.endswith("Version"))
    fields.update(("wisdomChecks", "singleMode"))
    values = {key: initial.get(key) for key in sorted(fields)}
    return {"values": values, "sha256": _digest(_canonical(values))}


def _require_profile(initial: dict):
    for key, value in REQUIRED_PROFILE.items():
        if initial.get(key) is not value:
            raise ValueError(f"Required verified retail profile flag {key}={value!r} is absent or different")
    for key in DISALLOWED_EXPERIMENTS:
        if initial.get(key, False) is not False:
            raise ValueError(f"Unvalidated runtime experiment enabled: {key}")


def _strict_json(raw: bytes):
    def pairs(entries):
        result = {}
        for key, value in entries:
            if key in result:
                raise ValueError(f"duplicate output key: {key}")
            result[key] = value
        return result

    def invalid(value):
        raise ValueError(f"non-finite output constant: {value}")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


class _WorkerFailure(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code, self.details = code, details or {}


def _kill_worker(process: subprocess.Popen):
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        elif process.poll() is None:
            process.kill()
    except (ProcessLookupError, OSError):
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass


def _run_worker(config: RuntimeConfig, payload: bytes) -> tuple[dict, float, str]:
    """One request per fresh child; concurrent pipe drainage avoids deadlock.

    The child has a private working directory and no shell. Reader limits
    terminate it before unbounded captured output accumulates. The optional
    upstream helper is disabled; the shipped worker creates no child workers.
    """
    if config.worker_pool is not None:
        return config.worker_pool.run(config, payload)
    if len(payload) > config.max_input_bytes:
        raise _WorkerFailure("INPUT_LIMIT", "Prepared engine request exceeds the configured byte limit")
    if not config.engine_path.is_file():
        raise _WorkerFailure("ENGINE_NOT_FOUND", "Configured simulator executable does not exist")
    if config.work_root is not None:
        config.work_root.mkdir(parents=True, exist_ok=True)
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GLOBALSIM_")}
    environment["GLOBALSIM_OUTPUT"] = "json"
    kwargs = {"start_new_session": True} if os.name == "posix" else {
        "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)
                         | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    }
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="globalsim-", dir=config.work_root) as workdir:
        try:
            process = subprocess.Popen([str(config.engine_path), *config.engine_args],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       cwd=workdir, env=environment, shell=False, **kwargs)
        except OSError as error:
            raise _WorkerFailure("ENGINE_START_FAILED", "Could not start configured simulator",
                                 {"reason": str(error)}) from error
        output, errors = bytearray(), bytearray()
        overflow = threading.Event()
        failures = []
        limits = []

        def reader(pipe, limit, destination, name):
            try:
                while True:
                    chunk = pipe.read(min(65536, max(1, limit-len(destination)+1)))
                    if not chunk:
                        break
                    remaining = limit-len(destination)
                    destination.extend(chunk[:remaining])
                    if len(chunk) > remaining:
                        limits.append(name)
                        overflow.set()
                        break
            except (OSError, ValueError) as error:
                failures.append(str(error))

        def writer():
            try:
                process.stdin.write(payload)
                process.stdin.flush()
            except (BrokenPipeError, OSError, ValueError) as error:
                failures.append(str(error))
            finally:
                try:
                    process.stdin.close()
                except OSError:
                    pass

        threads = [threading.Thread(target=reader, args=(process.stdout, config.max_output_bytes, output, "stdout"), daemon=True),
                   threading.Thread(target=reader, args=(process.stderr, config.max_stderr_bytes, errors, "stderr"), daemon=True),
                   threading.Thread(target=writer, daemon=True)]
        for thread in threads:
            thread.start()
        failure = None
        deadline = started + config.timeout_seconds
        try:
            while True:
                if overflow.is_set():
                    failure = _WorkerFailure("OUTPUT_LIMIT", "Simulator exceeded a configured output limit",
                                             {"streams": list(limits)})
                    break
                if process.poll() is not None and not any(thread.is_alive() for thread in threads):
                    break
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    failure = _WorkerFailure("TIMEOUT", "Simulator exceeded its configured time limit",
                                             {"timeoutSeconds": config.timeout_seconds})
                    break
                overflow.wait(min(remaining, 0.025))
        finally:
            if failure is not None:
                _kill_worker(process)
            for thread in threads:
                thread.join(timeout=1)
            for pipe in (process.stdout, process.stderr):
                try:
                    pipe.close()
                except OSError:
                    pass
        elapsed = time.monotonic()-started
        stderr = errors.decode("utf-8", errors="replace")
        if failure is not None:
            failure.details["stderr"] = stderr[:4000]
            raise failure
        if process.returncode != 0:
            raise _WorkerFailure("ENGINE_EXIT", "Simulator exited unsuccessfully",
                                 {"exitCode": process.returncode, "stderr": stderr[:4000]})
        if failures:
            raise _WorkerFailure("PIPE_ERROR", "Simulator pipe transport failed", {"errors": failures[:3]})
        lines = bytes(output).splitlines()
        if len(lines) != 1:
            raise _WorkerFailure("INVALID_OUTPUT", "Expected exactly one JSONL simulator reply",
                                 {"lineCount": len(lines), "stderr": stderr[:4000]})
        try:
            modeled = _strict_json(lines[0])
            if not isinstance(modeled, dict):
                raise ValueError("simulator reply is not an object")
        except (ValueError, UnicodeError, RecursionError) as error:
            raise _WorkerFailure("INVALID_OUTPUT", "Simulator returned invalid JSON",
                                 {"reason": str(error)}) from error
        return modeled, elapsed, stderr


def _cache_path(config: RuntimeConfig, key: str) -> Path | None:
    return config.cache_root / "globalsim-modeled-v1" / f"{key}.json" if config.cache_root else None


def _cache_mac(secret: bytes, key: str, modeled_hash: str) -> str:
    return hmac.new(secret, _canonical([CACHE_SCHEMA, key, modeled_hash]), hashlib.sha256).hexdigest()


def _read_cache(path: Path | None, key: str, byte_limit: int, auth_key: bytes | None = None) -> dict | None:
    if path is None:
        return None
    try:
        if path.stat().st_size > byte_limit+8192:
            return None
        with path.open("rb") as stream:
            raw = stream.read(byte_limit+8193)
        if len(raw) > byte_limit+8192:
            return None
        entry = _strict_json(raw)
        if entry.get("schemaVersion") != CACHE_SCHEMA or entry.get("cacheKey") != key:
            return None
        if auth_key is not None and not hmac.compare_digest(str(entry.get("authentication", "")),
                _cache_mac(auth_key, key, entry["modeledSha256"])):
            return None
        if entry.get('storage') == SHARED:
            if 'modeled' in entry:
                return None
            modeled = _strict_json(read_blob(path, entry, byte_limit))
        else:
            modeled = entry['modeled']
            if entry.get('modeledSha256') != _digest(_canonical(modeled)):
                return None
        if not isinstance(modeled, dict):
            return None
        return modeled
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError, EOFError):
        return None


def _write_cache(path: Path | None, key: str, modeled: dict, byte_limit: int, auth_key: bytes | None = None):
    if path is None:
        return
    model_bytes = _canonical(modeled)
    if len(model_bytes) > byte_limit:
        return
    metadata = {"schemaVersion": CACHE_SCHEMA, "cacheKey": key,
                "modeledSha256": _digest(model_bytes), "modeled": modeled}
    if auth_key is not None:
        metadata["authentication"] = _cache_mac(auth_key, key, metadata["modeledSha256"])
    write_shared(path, metadata, model_bytes)


def _metric_status(metrics: list[dict]) -> str:
    if not metrics or any(m.get("capability") != "compared" or m.get("unavailable", 0) for m in metrics):
        return "unavailable"
    return "mismatch" if any(m.get("mismatches", 0) for m in metrics) else "verified"


def _event_status(metrics: list[dict]) -> str:
    if not metrics or any(m.get("capability") != "compared" for m in metrics):
        return "unavailable"
    return "verified" if all(m.get("exact") is True for m in metrics) else "mismatch"


def _capabilities(comparison: dict) -> dict:
    results = comparison.get("results", {})
    frames = comparison.get("frames", {})
    fields = frames.get("fields", {})
    events = comparison.get("events", {})
    answer = {
        "recordedResults": _metric_status([results.get(k, {}) for k in (
            "finishTimeRaw", "finishOrder", "startDelayTime", "lastSpurtStartDistance",
            "runningStyle", "gutsOrder", "wizOrder")]),
        "sampledMovement": _metric_status([fields.get(k, {}) for k in ("pos", "speed", "hp", "lane")]),
        "sampledRunnerState": _metric_status([fields.get(k, {}) for k in ("temptationMode", "blockFrontHorseIndex")]),
        "skillEvents": _event_status([events.get(k, {}) for k in (
            "skillStarts", "skillRecordedDurations", "skillDetails", "skillVisualRecipients")]),
        "competitionEvents": _event_status([events.get("competitionStarts", {})]),
        "hiddenState": "not_provided",
    }
    if frames.get("unavailableRunnerSamples", 0) or frames.get("missingTimestampCount", 0):
        answer["sampledMovement"] = answer["sampledRunnerState"] = "unavailable"
    return answer


def evaluate_capture(capture: dict, config: RuntimeConfig, *, context: dict | None = None) -> dict:
    """Evaluate one immutable capture without altering it or its recorded data.

    `verified` covers the named recorded fields only. `modeled` remains a
    simulator result even when those observations match. Missing setup returns
    `needs_input` before an engine child can start. Configuration and optional
    context provenance must be supplied by the trusted application layer.
    """
    started = time.monotonic()
    report = {
        "schemaVersion": 1, "status": "engine_error", "verificationScope": VERIFICATION_SCOPE,
        "captureSha256": None, "raceScenarioSha256": None, "inputSha256": None,
        "cacheKey": None, "cacheHit": False, "identities": {}, "inputAudit": None,
        "observed": None, "modeled": None, "comparison": None, "error": None,
        "warnings": [], "timing": {"totalSeconds": 0.0},
        "capabilities": {key: "unavailable" for key in (
            "recordedResults", "sampledMovement", "sampledRunnerState", "skillEvents", "competitionEvents")},
    }
    report["capabilities"]["hiddenState"] = "not_provided"

    def finish(status, code=None, message=None, details=None):
        report["status"] = status
        report["error"] = {"code": code, "message": message, **({"details": details} if details else {})} if code else None
        report["timing"]["totalSeconds"] = time.monotonic()-started
        return report

    try:
        if not isinstance(capture, dict):
            raise ValueError("Capture must be an object")
        capture_bytes = _canonical(capture)
        if len(capture_bytes) > config.max_capture_bytes:
            return finish("unsupported", "CAPTURE_LIMIT", "Capture exceeds configured byte limit")
        report["captureSha256"] = _digest(capture_bytes)
        normalized = adapter.normalize_capture(capture)
        scenario = normalized.get("race_scenario")
        if not isinstance(scenario, str) or not scenario:
            return finish("needs_input", "MISSING_REPLAY", "Original compressed race replay is required")
        report["raceScenarioSha256"] = _digest(scenario.encode("utf-8"))
        report["observed"] = decode_scenario(scenario)
        report["warnings"].extend(report["observed"].get("warnings", []))
        layout = report["observed"]["layout"]
        if (layout["headerVersion"] not in SUPPORTED_REPLAY_HEADERS
                or layout["headerSize"] != 4 or layout["horseFrameSize"] != 12
                or layout["horseResultSize"] != 31
                or layout["frameSize"] != 4+12*report["observed"]["runnerCount"]
                or report["observed"]["warnings"]):
            return finish("unsupported", "UNSUPPORTED_REPLAY_LAYOUT", "Replay layout is outside the validated layout profile",
                          {"layout": layout})
    except adapter.InputError as error:
        status = "needs_input" if error.status == "needs_input" else "unsupported"
        return finish(status, "CAPTURE_PROJECTION_UNAVAILABLE", "Original captured fields are missing or unsupported",
                      {"reason": str(error), "missingInputs": list(error.fields)})
    except (ValueError, TypeError, KeyError, AttributeError, IndexError, struct.error, RecursionError, UnicodeError) as error:
        return finish("unsupported", "INVALID_CAPTURE", "Capture cannot be decoded safely", {"reason": str(error)})

    try:
        references = adapter.ReferenceData.load(config.umalytics_root, config.globalsim_root)
        if config.skill_catalog:
            references = references.with_skill_catalog(config.skill_catalog)
        initial, audit = adapter.prepare_capture(capture, references, context=context)
        report["inputAudit"] = audit
    except ValueError as error:
        return finish("unsupported", "REFERENCE_DATA_UNSUPPORTED", "Configured reference data cannot be used",
                      {"reason": str(error)})
    except OSError as error:
        return finish("engine_error", "REFERENCE_DATA_IO", "Could not read configured reference data",
                      {"reason": str(error)})
    if initial is None or audit.get("status") != "ready":
        status = "needs_input" if audit.get("status") == "needs_input" else "unsupported"
        return finish(status, "INITIAL_INPUT_UNAVAILABLE", "Initial race setup is incomplete or unsupported",
                      {"missingInputs": audit.get("missingInputs", []), "errors": audit.get("errors", [])})

    try:
        _require_profile(initial)
        payload = _canonical(initial)+b"\n"
        if len(payload) > config.max_input_bytes:
            return finish("unsupported", "INPUT_LIMIT", "Prepared input exceeds configured byte limit")
        report["inputSha256"] = _digest(payload[:-1])
        # Keep the prepared-input audit hash independent of observation options.
        if config.decision_trace_schema:
            payload = _canonical({**initial, "decisionTrace": True, "traceConservePower": True}) + b"\n"
        code_identity, cache_eligible = _code_identities()
        engine_hash = _file_digest(config.engine_path)
        report["identities"] = {
            "engine": {"sha256": engine_hash, "expectedSha256": config.expected_engine_sha256,
                       "binaryPinVerified": config.expected_engine_sha256 == engine_hash,
                       "sourceRevision": "expected/not attested",
                       "argumentsSha256": _digest(_canonical(config.engine_args))},
            "code": code_identity, "data": references.identity,
            "profile": _profile_identity(initial),
            "worker": {"expectedUpstreamRevision": UPSTREAM_REVISION, "sourceRevision": "expected/not attested",
                       "api": "globalsim::run_worker",
                       "defaultProfileReliedOn": False, "decisionTraceSchema": config.decision_trace_schema},
        }
        if config.expected_engine_sha256 is not None and config.expected_engine_sha256 != engine_hash:
            return finish("engine_error", "ENGINE_PIN_MISMATCH", "Configured executable does not match its trusted checksum",
                          {"expectedSha256": config.expected_engine_sha256, "actualSha256": engine_hash})
        if config.expected_engine_sha256 is None:
            report["warnings"].append("Executable checksum is not pinned. Source revision is expected, not attested; verification covers recorded observations only.")
        key_material = {"schemaVersion": CACHE_SCHEMA, "captureSha256": report["captureSha256"],
                        "raceScenarioSha256": report["raceScenarioSha256"], "inputSha256": report["inputSha256"],
                        "contextSha256": _digest(_canonical(context)), "identities": report["identities"]}
        report["cacheKey"] = _digest(_canonical(key_material))
        if not cache_eligible:
            report["warnings"].append("Code source identities unavailable; simulation cache is disabled.")
        # Hidden decisions are not observable in replay samples. Authenticate saved
        # traces with the installation secret as well as comparing observations
        # afresh below. Unsigned legacy traces cannot authorize hidden state.
        trace_cache_allowed = config.cache_auth_key is not None and config.expected_engine_sha256 == engine_hash
        cache_path = _cache_path(config, report["cacheKey"]) if cache_eligible and (
            not config.decision_trace_schema or trace_cache_allowed) else None
        modeled = _read_cache(cache_path, report["cacheKey"], config.max_output_bytes, config.cache_auth_key)
        report["cacheHit"] = modeled is not None
        if modeled is None:
            modeled, elapsed, stderr = _run_worker(config, payload)
            report["timing"]["engineSeconds"] = elapsed
            if stderr:
                report["warnings"].append("Simulator wrote diagnostic stderr: "+stderr[:1000])
        if _file_digest(config.engine_path) != engine_hash:
            return finish("engine_error", "ENGINE_CHANGED", "Configured executable changed during evaluation")
        report["modeled"] = modeled
        if "error" in modeled:
            return finish("unsupported", "ENGINE_UNSUPPORTED_INPUT", "Simulator rejected the prepared initial setup",
                          {"engineError": modeled["error"]})
        comparison = compare_observations(report["observed"], modeled, initial, normalized)
        report["comparison"] = comparison
        report["capabilities"] = _capabilities(comparison)
        if comparison.get("status") == "incomplete_comparison":
            return finish("unsupported", "MISSING_ENGINE_CAPABILITY", "Simulator output lacks a required comparison capability",
                          {"missingRequiredCapabilities": comparison.get("missingRequiredCapabilities", [])})
        status = "verified" if comparison.get("allComparedChecksPass") is True else "mismatch"
        if config.decision_trace_schema:
            from .decision_trace import validate_trace
            trace_error = validate_trace(modeled.get("decisionTrace"), len(initial.get("horses", [])))
            report["traceValidation"] = {"schema": config.decision_trace_schema, "valid": trace_error is None,
                                         "error": trace_error}
            if trace_error is None and status == "verified" and config.expected_engine_sha256 == engine_hash:
                report["capabilities"]["hiddenState"] = "simulated_trace"
            elif trace_error:
                report["warnings"].append("Decision trace unavailable: " + trace_error)
        if not report["cacheHit"]:
            try:
                _write_cache(cache_path, report["cacheKey"], modeled, config.max_output_bytes, config.cache_auth_key)
            except (OSError, ValueError) as error:
                report["warnings"].append("Simulation result could not be cached: "+str(error))
        return finish(status)
    except _WorkerFailure as error:
        return finish("engine_error", error.code, str(error), error.details)
    except OSError as error:
        return finish("engine_error", "ENGINE_IO", "Configured simulator could not be read or executed",
                      {"reason": str(error)})
    except (ValueError, TypeError, KeyError, AttributeError, IndexError, struct.error, OverflowError, RecursionError) as error:
        return finish("unsupported", "PROFILE_OR_OUTPUT_UNSUPPORTED", "Prepared profile or simulator output is unsupported",
                      {"reason": str(error)})
