#!/usr/bin/env python3
"""Run the handoff bridge on one original capture without launching Umalytics."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from desktop.globalsim_bridge.runtime import RuntimeConfig, evaluate_capture


def load_object(path: Path, maximum: int) -> dict:
    if path.stat().st_size > maximum:
        raise ValueError(f"{path.name} exceeds the {maximum}-byte input limit")

    def unique_keys(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError(f"Duplicate JSON key: {key}")
            value[key] = item
        return value

    def reject_constant(value):
        raise ValueError(f"Non-finite JSON value: {value}")

    data = json.loads(path.read_text(encoding="utf-8-sig"),
                      object_pairs_hook=unique_keys, parse_constant=reject_constant)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} must contain one capture object")
    return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True,
                        help="Trusted compiled worker executable; not a game executable")
    parser.add_argument("--umalytics", type=Path, required=True,
                        help="Umalytics root containing public data and compiled course identities")
    parser.add_argument("--globalsim", type=Path, required=True,
                        help="Pinned GlobalSim checkout/resource root containing data and examples")
    parser.add_argument("--context", type=Path,
                        help="Optional independently confirmed context with per-field provenance")
    parser.add_argument("--output", type=Path, required=True,
                        help="Write the complete structured result here")
    parser.add_argument("--engine-sha256", help="Expected executable SHA-256 from a trusted build manifest")
    parser.add_argument("--cache-root", type=Path)
    parser.add_argument("--work-root", type=Path)
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args(argv)
    if not 0 < args.timeout <= 600:
        parser.error("--timeout must be greater than zero and at most 600 seconds")

    try:
        capture = load_object(args.capture, 16 * 1024 * 1024)
        context = load_object(args.context, 64 * 1024) if args.context else None
        config = RuntimeConfig(
            engine_path=args.engine.resolve(),
            umalytics_root=args.umalytics.resolve(),
            globalsim_root=args.globalsim.resolve(),
            cache_root=args.cache_root.resolve() if args.cache_root else None,
            work_root=args.work_root.resolve() if args.work_root else None,
            timeout_seconds=args.timeout,
            expected_engine_sha256=args.engine_sha256,
        )
        result = evaluate_capture(capture, config, context=context)
    except (OSError, ValueError) as error:
        result = {"status": "engine_error", "reason": str(error),
                  "modeled": None, "comparison": None}

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False,
                                     indent=2) + "\n", encoding="utf-8")
    status = result.get("status", "engine_error")
    summary = {"capture": args.capture.name, "status": status,
               "output": str(args.output.resolve())}
    if result.get("error"):
        summary["error"] = result["error"]
    elif result.get("reason"):
        summary["reason"] = result["reason"]
    print(json.dumps(summary, ensure_ascii=False))
    return {"verified": 0, "mismatch": 1, "needs_input": 2,
            "unsupported": 2, "engine_error": 3}.get(status, 3)


if __name__ == "__main__":
    sys.exit(main())
