#!/usr/bin/env python3
"""Reproduce the seven capture verdicts; report missing fixtures explicitly."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from desktop.globalsim_bridge.adapter import ReferenceData, prepare_capture
from desktop.globalsim_bridge.runtime import RuntimeConfig, evaluate_capture
from verify_capture import load_object


def canonical_digest(value: dict) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"),
                     ensure_ascii=False, allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--umalytics", type=Path, required=True)
    parser.add_argument("--globalsim", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path,
                        default=Path(__file__).parent / "evidence" / "fixture-manifest.json")
    parser.add_argument("--engine-sha256", help="Expected executable SHA-256 from a trusted build manifest")
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args(argv)
    if not 0 < args.timeout <= 600:
        parser.error("--timeout must be greater than zero and at most 600 seconds")
    manifest = load_object(args.manifest, 1024 * 1024)
    config = RuntimeConfig(engine_path=args.engine.resolve(),
                           umalytics_root=args.umalytics.resolve(),
                           globalsim_root=args.globalsim.resolve(),
                           timeout_seconds=args.timeout,
                           expected_engine_sha256=args.engine_sha256)
    references = ReferenceData.load(args.umalytics.resolve(), args.globalsim.resolve())
    rows = []
    for expected in manifest["cases"]:
        name = expected["captureFile"]
        if Path(name).name != name:
            raise ValueError("Fixture manifest must use filenames, not paths")
        path = args.captures / name
        row = {"capture": name, "expectedStatus": expected["expectedStatus"]}
        if not path.is_file():
            row.update(status="missing_fixture", expectationMet=False)
        elif hashlib.sha256(path.read_bytes()).hexdigest() != expected["captureSha256"]:
            row.update(status="changed_fixture", expectationMet=False)
        else:
            capture = load_object(path, config.max_capture_bytes)
            spec, audit = prepare_capture(capture, references)
            previous = expected.get("previousCanonicalInputSha256")
            actual = canonical_digest(spec) if spec is not None else None
            row.update(captureSha256=expected["captureSha256"],
                       preparedInputSha256=actual,
                       previousPreparedInputSha256=previous,
                       initialInputAudit=audit)
            if previous is not None and actual != previous:
                row.update(status="changed_initial_input", expectationMet=False)
            else:
                result = evaluate_capture(capture, config)
                status = result.get("status", "engine_error")
                row.update(status=status,
                           expectationMet=status == expected["expectedStatus"],
                           canonicalInputMatchesEarlierVerifier=(actual == previous if previous is not None else None),
                           comparison=result.get("comparison"),
                           capabilities=result.get("capabilities"),
                           identities=result.get("identities"),
                           error=result.get("error"))
        rows.append(row)
        print(json.dumps({key: row[key] for key in
                          ("capture", "expectedStatus", "status", "expectationMet")}), flush=True)
    report = {"schemaVersion": 1,
              "fixtureCount": len(rows),
              "statuses": dict(Counter(row["status"] for row in rows)),
              "allExpectedVerdictsReproduced": bool(rows) and all(row["expectationMet"] for row in rows),
              "note": "An expected mismatch remains a rejected simulation. Missing or changed fixtures are never counted as successful validation.",
              "engineSha256": hashlib.sha256(args.engine.read_bytes()).hexdigest() if args.engine.is_file() else None,
              "cases": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, allow_nan=False,
                                     indent=2) + "\n", encoding="utf-8")
    return 0 if report["allExpectedVerdictsReproduced"] else 1


if __name__ == "__main__":
    sys.exit(main())
