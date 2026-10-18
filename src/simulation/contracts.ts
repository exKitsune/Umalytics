/**
 * Frontend contract for the optional GlobalSim bridge.
 *
 * SimulationReport is the diagnostic runtime's report. AnalysisGateReport is
 * the production authorization wrapper from analysis_gate.py. Normal job and
 * view types carry the wrapper; a diagnostic match alone cannot authorize UI
 * analysis. These types describe proposed local routes, not installed routes.
 *
 * A matching replay validates the stated recorded observations. It does not
 * turn model output into observed game state, validate unsampled intervals,
 * or provide a trace of private variables/condition evaluations.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export const SIMULATION_SCHEMA_VERSION = 1 as const;
export const SIMULATION_VERIFICATION_SCOPE = 'recorded_observations_v1' as const;
export const ANALYSIS_GATE_VERSION = 'versioned-analysis-gate-v1' as const;

export type SimulationStatus =
  | 'verified'
  | 'mismatch'
  | 'needs_input'
  | 'unsupported'
  | 'engine_error';

export type CapabilityStatus = 'verified' | 'mismatch' | 'unavailable';
export type ComparedCapability =
  | 'recordedResults'
  | 'sampledMovement'
  | 'sampledRunnerState'
  | 'skillEvents'
  | 'competitionEvents';

export interface SimulationCapabilities {
  /** Raw finish time/order, start delay, last-spurt distance, style, guts/wisdom orders.
   *  Displayed finishTime, finishGap and defeatFlags are outside this capability. */
  recordedResults: CapabilityStatus;
  /** Position, speed, HP and lane at available official pre-finish sample times. */
  sampledMovement: CapabilityStatus;
  /** Temptation mode and front-blocker index at the same official sample times. */
  sampledRunnerState: CapabilityStatus;
  /** Compared starts, recorded durations, detail indices and first visual recipient masks.
   *  This is not every gameplay effect recipient or a failed-condition explanation. */
  skillEvents: CapabilityStatus;
  /** Compared observed event starts for the supported competition/conserve-power types. */
  competitionEvents: CapabilityStatus;
  /** Instrumented model decisions are distinct from captured original private state. */
  hiddenState: 'not_provided' | 'simulated_trace';
}

export interface SimulationIdentities {
  engine: JsonValue;
  code: JsonValue;
  data: JsonValue;
  profile: JsonValue;
  worker: JsonValue;
}

export interface SimulationError {
  code: string;
  message: string;
  details?: JsonValue;
}

/** Diagnostic fixture verification only. Use AnalysisGateReport in product flows. */
export interface SimulationReport {
  schemaVersion: typeof SIMULATION_SCHEMA_VERSION;
  status: SimulationStatus;
  verificationScope: typeof SIMULATION_VERIFICATION_SCOPE;
  /** SHA-256 of the runtime's canonical capture JSON. Not the service file-byte hash. */
  captureSha256: string | null;
  /** SHA-256 of the exact captured base64 text; never substitute a decoded replay hash. */
  raceScenarioSha256: string | null;
  inputSha256: string | null;
  cacheKey: string | null;
  cacheHit: boolean;
  /** Early input/reference failures may occur before any executable identity is read. */
  identities: Partial<SimulationIdentities>;
  inputAudit: JsonObject | null;
  /** Decoded replay, kept separate from the existing app Race and from the model. */
  observed: JsonObject | null;
  /** Raw engine output, always labeled simulated even when status is verified. */
  modeled: JsonObject | null;
  /** Detailed field metrics, first divergence and explicit comparison limits. */
  comparison: JsonObject | null;
  error: SimulationError | null;
  warnings: string[];
  timing: { totalSeconds: number; engineSeconds?: number };
  capabilities: SimulationCapabilities;
}

export interface ImmutableEngineIdentity {
  engineId: string;
  version: string;
  profile: string;
  identity: { artifactSha256: string; dataSha256: string };
}

export interface CompatibilityEngineChoice {
  eligible: boolean;
  provisional: boolean;
  engineId: string | null;
  version: string | null;
  profile: string | null;
  identity: ImmutableEngineIdentity['identity'] | null;
  reasonCodes: string[];
}

/** Eligibility comes from independently evidenced original time/rules.
 *  A collector/download timestamp is not original occurrence evidence. */
export interface CompatibilityDecision {
  schemaVersion: 1;
  policyVersion: string;
  policySha256: string | null;
  policyIdentityKind: string;
  captureSha256: string | null;
  registrySha256: string | null;
  evidenceSha256: string | null;
  selectionSha256: string | null;
  registryId: string | null;
  mode: 'recorded_only' | 'compatible' | 'provisional_future_inference' | 'simulation_trial';
  evidenceStatus: string;
  compatibilityClass: string;
  matchedEraId: string | null;
  simulation: CompatibilityEngineChoice;
  inference: CompatibilityEngineChoice;
  provisionalPolicy: JsonObject | null;
  noticeCodes: string[];
  notices: { code: string; message: string }[];
  engineEligibility: {
    engineId: string; kind: 'simulation' | 'inference'; eligible: boolean;
    provisional: boolean; reasonCodes: string[];
  }[];
  meaning: string;
}

export interface AnalysisNotice {
  code: string;
  message: string;
  severity: 'info' | 'warning';
  /** Restore this notice with every cached result and selection. */
  persistent: true;
}

/** Fresh service-owned selection identity, never copied out of the cache being
 *  validated. Recompute compatibility before foreground/warm/cache/worker use. */
export interface CurrentAnalysisSelection {
  captureSha256: string;
  registrySha256: string;
  evidenceSha256: string;
  selectionSha256: string;
  contextSha256: string;
  authorizationSha256: string;
}

export interface AnalysisBinding extends CurrentAnalysisSelection {
  gateVersion: typeof ANALYSIS_GATE_VERSION;
  simulation: ImmutableEngineIdentity | null;
  inference: ImmutableEngineIdentity | null;
  simulationArgumentsSha256?: string;
}

/** An unexecuted authorization plan, not an inferred analysis result. */
export interface InferencePlan {
  schemaVersion: 1;
  gateVersion: typeof ANALYSIS_GATE_VERSION;
  captureSha256: string;
  registrySha256: string;
  evidenceSha256: string;
  selectionSha256: string;
  contextSha256: string;
  engine: ImmutableEngineIdentity;
  provisional: boolean;
  provisionalPolicy: JsonObject | null;
  fallbackReason: string | null;
  notices: AnalysisNotice[];
  executionStatus: 'not_executed';
  requiresWorkerReauthorization: true;
  /** Hash includes the full immutable engine identity and persistent notices. */
  authorizationSha256: string;
}

export interface InferencePlanRevalidation {
  schemaVersion: 1;
  authorized: boolean;
  executionPerformed: false;
  reasonCodes: string[];
  /** Present only after fresh compatibility and actual bundle/data measurements. */
  plan: InferencePlan | null;
}

export interface AnalysisGateReport {
  schemaVersion: 1;
  gateVersion: typeof ANALYSIS_GATE_VERSION;
  mode: 'recorded_only' | 'verified_simulation' | 'inference_plan';
  binding: AnalysisBinding | null;
  compatibility: CompatibilityDecision | null;
  observed: JsonObject | null;
  replayStatus: 'available' | 'unavailable';
  /** Diagnostics can include mismatched model data. Mode/permissions govern UI use. */
  simulation: SimulationReport | null;
  inferencePlan: InferencePlan | null;
  notices: AnalysisNotice[];
  error: SimulationError | null;
  permissions: {
    recordedReplay: boolean;
    simulatedRecordedCapabilities: boolean;
    inferenceExecutionPlan: boolean;
    unversionedInference: false;
  };
}

/** Preserve the gate and notices while omitting the large replay/model payloads. */
export type AnalysisGateReportSummary = Omit<AnalysisGateReport, 'observed' | 'simulation'> & {
  simulation: SimulationReportSummary | null;
};

export type SimulationContextField = 'raceInstanceId' | 'courseId' | 'grade' | 'time';
export interface ContextEvidence {
  /** Independent evidence, e.g. user-selected setup or a captured setup response.
   *  The backend validates the adapter's accepted source names and rejects outcomes. */
  source: 'user-confirmed' | 'upstream-recorded';
  /** A concrete, bounded reference identifying the evidence for this capture. */
  reference: string;
}

/** Numerical values use the adapter's explicit domain, not UI labels or guessed enums.
 *  Every supplied field needs its own provenance entry; the Python adapter checks this.
 *  Do not translate raw start_time_type into time without independent enum evidence. */
export interface SimulationContext {
  raceInstanceId?: number;
  courseId?: number;
  grade?: number;
  time?: number;
  provenance: Partial<Record<SimulationContextField, ContextEvidence>>;
}

/** POST /api/simulation/races/{encodeURIComponent(entry.remoteId)}.
 *  The service loads the capture by ID. No browser-supplied path or engine settings. */
export interface SimulationRequest {
  /** Existing /api/races entry sha256, used only to reject a changed selection. */
  expectedEntrySha256: string;
  context?: SimulationContext;
}

interface SimulationJobIdentity {
  schemaVersion: typeof SIMULATION_SCHEMA_VERSION;
  /** Opaque ID owned by the service. Poll it; never treat it as a filename. */
  jobId: string;
  /** Exact backend ID, including ~index if present; not the frontend capture- prefix. */
  raceId: string;
  entrySha256: string;
}

/** Normal polling omits full replay/model frames. This is a service projection of
 *  the diagnostic runtime report, not product authorization. */
export type SimulationReportSummary = Omit<SimulationReport, 'observed' | 'modeled'>;

/** Proposed HTTP lifecycle, separate from the runtime's final evaluation status.
 *  Fetch full telemetry only through the explicit same-job detail request. */
export type SimulationJob = SimulationJobIdentity & (
  | { phase: 'queued' | 'running'; report: null }
  | { phase: 'complete'; report: AnalysisGateReportSummary }
);

/** GET the same race/job endpoint with include=payloads after the job completes. */
export type SimulationJobDetails = SimulationJobIdentity & {
  phase: 'complete';
  report: AnalysisGateReport;
};

/** Proposed GET /api/simulation/status response. Static/browser-only viewers can
 *  retain recorded replay/import support. Analysis still requires the per-race
 *  gate, even when an engine is installed or an older result is cached. */
export type SimulationAvailability =
  | { schemaVersion: 1; available: true; identities: SimulationIdentities }
  | { schemaVersion: 1; available: false; reason: string };

/** Local UI lifecycle only. Pending/unavailable are not runtime verification results. */
export type SimulationViewState =
  | { phase: 'idle' }
  | { phase: 'unavailable'; message: string }
  | { phase: 'pending'; raceId: string; entrySha256: string; jobId?: string }
  | { phase: 'complete'; raceId: string; entrySha256: string; report: AnalysisGateReportSummary };

export const SIMULATION_STATUS_LABELS: Readonly<Record<SimulationStatus, string>> = {
  verified: 'Recorded values match',
  mismatch: 'Simulation differs from this replay',
  needs_input: 'Simulation needs race setup details',
  unsupported: 'Simulation is unavailable for this capture',
  engine_error: 'Simulation could not complete',
};

/** Use these labels at the value/chart/tooltip, not only in an About dialog. */
export const ANALYSIS_SOURCE_LABELS = {
  recorded: 'Recorded',
  simulated: 'Simulated',
  inferred: 'Inferred',
  provisional_inference: 'Provisional inference',
} as const;
export type AnalysisValueSource = keyof typeof ANALYSIS_SOURCE_LABELS;

const SELECTION_HASH_FIELDS = [
  'captureSha256', 'registrySha256', 'evidenceSha256', 'selectionSha256',
  'contextSha256', 'authorizationSha256',
] as const;

/** This checks a validated service response against a FRESH selection. It is
 *  not a substitute for backend/worker compatibility and artifact checks. */
export function matchesCurrentAnalysisSelection(
  report: AnalysisGateReportSummary | null | undefined,
  selection: CurrentAnalysisSelection | null | undefined,
): boolean {
  const binding = report?.binding;
  const compatibility = report?.compatibility;
  return report?.schemaVersion === 1 && report.gateVersion === ANALYSIS_GATE_VERSION
    && binding?.gateVersion === ANALYSIS_GATE_VERSION && compatibility?.schemaVersion === 1
    && selection != null
    && SELECTION_HASH_FIELDS.every(key => typeof binding[key] === 'string'
      && /^[a-f0-9]{64}$/.test(binding[key]) && binding[key] === selection[key])
    && (['captureSha256', 'registrySha256', 'evidenceSha256', 'selectionSha256'] as const)
      .every(key => compatibility[key] === binding[key]);
}

function hasEligibleCompatibility(report: AnalysisGateReportSummary | null | undefined): boolean {
  const mode = report?.compatibility?.mode;
  return mode === 'compatible' || mode === 'provisional_future_inference';
}

function sameEngine(left: ImmutableEngineIdentity | null | undefined,
                    right: ImmutableEngineIdentity | null | undefined): boolean {
  return left != null && right != null
    && left.engineId === right.engineId && left.version === right.version && left.profile === right.profile
    && left.identity.artifactSha256 === right.identity.artifactSha256
    && left.identity.dataSha256 === right.identity.dataSha256;
}

function registeredChoiceMatches(binding: ImmutableEngineIdentity | null | undefined,
                                 choice: CompatibilityEngineChoice | null | undefined): boolean {
  return binding != null && choice?.eligible === true && choice.identity != null
    && binding.engineId === choice.engineId && binding.version === choice.version
    && binding.profile === choice.profile
    && binding.identity.artifactSha256 === choice.identity.artifactSha256
    && binding.identity.dataSha256 === choice.identity.dataSha256;
}

/** A bare diagnostic verified report fails this gate. Only the currently bound
 *  production result can authorize the named compared capability. This does
 *  not authorize today's inference code or any hidden-state interpretation. */
export function canUseSimulatedCapability(
  report: AnalysisGateReportSummary | null | undefined,
  capability: ComparedCapability,
  selection: CurrentAnalysisSelection | null | undefined,
): boolean {
  const diagnostic = report?.simulation;
  return matchesCurrentAnalysisSelection(report, selection)
    && (hasEligibleCompatibility(report) || report?.compatibility?.mode === 'simulation_trial')
    && report?.mode === 'verified_simulation'
    && report.permissions.simulatedRecordedCapabilities === true
    && report.permissions.unversionedInference === false
    && report.binding?.simulation != null
    && registeredChoiceMatches(report.binding.simulation, report.compatibility?.simulation)
    && report.compatibility?.simulation.provisional === false
    && diagnostic?.verificationScope === SIMULATION_VERIFICATION_SCOPE
    && diagnostic.captureSha256 === report.binding.captureSha256
    && diagnostic.status === 'verified'
    && diagnostic.comparison?.allComparedChecksPass === true
    && (['recordedResults', 'sampledMovement', 'sampledRunnerState', 'skillEvents', 'competitionEvents'] as const)
      .every(key => diagnostic.capabilities[key] === 'verified')
    && diagnostic.capabilities[capability] === 'verified';
}

/** Authorizes submitting this plan to the separately gated app inference
 *  worker. It does not mean inference ran or that inferred outputs are valid. */
export function canUseInferencePlan(
  report: AnalysisGateReportSummary | null | undefined,
  selection: CurrentAnalysisSelection | null | undefined,
): boolean {
  const plan = report?.inferencePlan;
  if (!matchesCurrentAnalysisSelection(report, selection)
      || !hasEligibleCompatibility(report)
      || report?.mode !== 'inference_plan' || report.permissions.inferenceExecutionPlan !== true
      || report.permissions.unversionedInference !== false || !plan
      || plan.schemaVersion !== 1 || plan.gateVersion !== ANALYSIS_GATE_VERSION
      || plan.executionStatus !== 'not_executed' || plan.requiresWorkerReauthorization !== true
      || !/^[a-f0-9]{64}$/.test(plan.authorizationSha256)
      || !sameEngine(plan.engine, report.binding?.inference)
      || !registeredChoiceMatches(plan.engine, report.compatibility?.inference)
      || report.compatibility?.inference.provisional !== plan.provisional) return false;
  const binding = report.binding!;
  if (!SELECTION_HASH_FIELDS.filter(key => key !== 'authorizationSha256')
      .every(key => plan[key] === binding[key])) return false;
  if (plan.provisional) {
    const hasWarning = (notices: AnalysisNotice[]) => notices.some(notice =>
      notice.code === 'PROVISIONAL_FUTURE_INFERENCE' && notice.severity === 'warning'
      && notice.persistent === true && notice.message.trim().length > 0);
    if (!plan.provisionalPolicy || !hasWarning(plan.notices) || !hasWarning(report.notices)) return false;
  }
  return true;
}

/** No implicit casting of a modeled result into a captured game-state variable. */
export function providesHiddenState(_report: AnalysisGateReportSummary | null | undefined): false {
  return false;
}
