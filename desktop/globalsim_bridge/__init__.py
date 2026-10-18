"""Version-gated product analysis, plus explicitly diagnostic fixture tools.

Normal application routes must call evaluate_for_analysis. A diagnostic replay
match does not authorize production simulation details or current inference.
The old evaluate_capture import remains a diagnostic compatibility alias.
"""

from . import runtime as _runtime
from .runtime import RuntimeConfig
from .analysis_gate import (
    InferenceBinding, SimulatorBinding, evaluate_for_analysis, revalidate_inference_plan,
)
from .versioning import select_compatibility


def evaluate_capture_diagnostic(capture: dict, config: RuntimeConfig, *, context: dict | None = None) -> dict:
    """Diagnostic fixture comparison only; never product analysis authorization.

    Use evaluate_for_analysis for user-facing analysis. This deliberately keeps
    historical investigation/reproduction possible without weakening that gate.
    """
    return _runtime.evaluate_capture(capture, config, context=context)


evaluate_capture = evaluate_capture_diagnostic

__all__ = ["evaluate_for_analysis", "revalidate_inference_plan", "SimulatorBinding",
           "InferenceBinding", "RuntimeConfig", "select_compatibility",
           "evaluate_capture_diagnostic", "evaluate_capture"]
