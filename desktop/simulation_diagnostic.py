"""Explicit offline diagnostic CLI. No HTTP route or product authorization."""
from dataclasses import replace
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from globalsim_bridge import evaluate_capture_diagnostic
from reference_data import strict_json
from simulation_service import SimulationService


def diagnose_installed_capture(root, capture_path, output_path, engine_id=None):
    capture_path, output_path = Path(capture_path).resolve(), Path(output_path).resolve()
    if capture_path == output_path or output_path.exists():
        raise ValueError('Diagnostic output must be a new file, separate from the original capture.')
    if capture_path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('Capture exceeds the diagnostic input limit.')
    capture = strict_json(capture_path.read_bytes())
    if not isinstance(capture, dict):
        raise ValueError('Select one diagnostic capture object.')
    with tempfile.TemporaryDirectory(prefix='umalytics-diagnostic-') as work:
        service = SimulationService(SimpleNamespace(data_dir=Path(work)), root)
        try:
            _, manifest = service.config()
            simulators, _ = service.bindings(manifest, 'diagnostic')
            candidates = [binding for key, binding in simulators.items() if engine_id is None or key == engine_id]
            if len(candidates) != 1:
                raise ValueError('Select one installed simulator using --diagnose-engine.')
            config = replace(candidates[0].config, cache_root=None)
            report = evaluate_capture_diagnostic(capture, config)
            report.update(diagnosticOnly=True, productAuthorization=False)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with output_path.open('x', encoding='utf-8') as stream:
                json.dump(report, stream, ensure_ascii=False, allow_nan=False)
            return {'verified': 0, 'mismatch': 1, 'needs_input': 2, 'unsupported': 2}.get(report['status'], 3)
        finally:
            service.close()
