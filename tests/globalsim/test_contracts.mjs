/** Executable contract gates against actual Python gateway responses.
 * Node 24+ supplies TypeScript stripping; this is not a TypeScript typecheck
 * or app build. All engine/date fixtures are synthetic and engines are stubbed.
 * Usage: node tests/test_contracts.mjs --python python3 --output report.json
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

const { values } = parseArgs({ options: {
  python: { type: 'string', default: process.platform === 'win32' ? 'python' : 'python3' },
  fixtures: { type: 'string' },
  output: { type: 'string' },
} });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = await readFile(resolve(root, 'src/simulation/contracts.ts'), 'utf8');
const javascript = stripTypeScriptTypes(source, { mode: 'strip' });
const api = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

// Reuse the Python suite's synthetic capture and bound registry. Each result is
// produced by the real gateway; only simulator/reference execution is stubbed.
let fixtureText;
if (values.fixtures) {
  // A separate fixture-export command supports runtimes forbidding Node children.
  fixtureText = await readFile(resolve(values.fixtures), 'utf8');
} else {
  const generation = spawnSync(values.python, ['-B', resolve(root, 'tests/globalsim/export_contract_fixtures.py')],
    { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
  if (generation.error || generation.status !== 0) {
    throw new Error(`Synthetic gateway fixture generation failed: ${generation.error ?? generation.stderr}`);
  }
  fixtureText = generation.stdout;
}
const fixtures = JSON.parse(fixtureText);
const copy = value => structuredClone(value);
const selection = report => copy(report.binding);
const capabilities = ['recordedResults', 'sampledMovement', 'sampledRunnerState', 'skillEvents', 'competitionEvents'];
const changedHash = hash => (hash === '0'.repeat(64) ? '1' : '0').repeat(64);
const checks = [];
function check(name, run) {
  try { run(); checks.push({ name, status: 'passed' }); }
  catch (error) { checks.push({ name, status: 'failed', error: String(error.message) }); }
}

check('actual-gateway-verified-capabilities-match-current-selection', () => {
  const report = fixtures.verified;
  assert.equal(api.matchesCurrentAnalysisSelection(report, selection(report)), true);
  for (const capability of capabilities) {
    assert.equal(api.canUseSimulatedCapability(report, capability, selection(report)), true);
  }
});
check('bare-diagnostic-verified-report-cannot-authorize-product-values', () => {
  assert.equal(api.canUseSimulatedCapability(fixtures.verified.simulation, 'recordedResults', selection(fixtures.verified)), false);
  assert.equal(api.canUseSimulatedCapability(fixtures.verified, 'recordedResults', null), false);
});
check('old-unknown-future-unsupported-remain-recorded-only', () => {
  for (const key of ['old', 'unknown', 'future_unsupported']) {
    const report = fixtures[key];
    assert.equal(report.mode, 'recorded_only');
    assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', selection(report)), false);
    assert.equal(api.canUseInferencePlan(report, selection(report)), false);
  }
});
check('each-fresh-selection-identity-rejects-stale-cached-report', () => {
  for (const key of ['captureSha256', 'registrySha256', 'evidenceSha256', 'selectionSha256', 'contextSha256', 'authorizationSha256']) {
    for (const report of [fixtures.verified, fixtures.inference]) {
      const current = selection(report); current[key] = changedHash(current[key]);
      assert.equal(api.matchesCurrentAnalysisSelection(report, current), false);
      assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', current), false);
      assert.equal(api.canUseInferencePlan(report, current), false);
    }
  }
});
check('internally-mixed-compatibility-hashes-are-rejected', () => {
  for (const key of ['captureSha256', 'registrySha256', 'evidenceSha256', 'selectionSha256']) {
    const report = copy(fixtures.verified);
    report.compatibility[key] = changedHash(report.compatibility[key]);
    assert.equal(api.matchesCurrentAnalysisSelection(report, selection(fixtures.verified)), false);
  }
});
check('recorded-only-compatibility-cannot-retain-analysis-permission', () => {
  for (const fixture of [fixtures.verified, fixtures.inference]) {
    const report = copy(fixture); report.compatibility.mode = 'recorded_only';
    assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', selection(fixture)), false);
    assert.equal(api.canUseInferencePlan(report, selection(fixture)), false);
  }
});
check('recorded-only-product-mode-cannot-show-cached-model', () => {
  const report = copy(fixtures.verified); report.mode = 'recorded_only';
  assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', selection(fixtures.verified)), false);
});
check('missing-compared-capability-prevents-any-simulated-capability', () => {
  for (const capability of capabilities) {
    const report = copy(fixtures.verified); delete report.simulation.capabilities[capability];
    assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', selection(fixtures.verified)), false);
  }
});
check('comparison-failure-or-diagnostic-mismatch-cannot-show-model', () => {
  const comparison = copy(fixtures.verified); comparison.simulation.comparison.allComparedChecksPass = false;
  const mismatch = copy(fixtures.verified); mismatch.simulation.status = 'mismatch';
  for (const report of [comparison, mismatch]) {
    assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', selection(fixtures.verified)), false);
  }
});
check('registered-simulator-identity-and-provisional-status-are-enforced', () => {
  for (const mutation of [
    report => { report.compatibility.simulation.profile = 'stale-profile'; },
    report => { report.compatibility.simulation.identity.dataSha256 = '0'.repeat(64); },
    report => { report.compatibility.simulation.provisional = true; },
  ]) {
    const report = copy(fixtures.verified); mutation(report);
    assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', selection(fixtures.verified)), false);
  }
});
check('compatible-inference-is-an-unexecuted-plan-only', () => {
  const report = fixtures.inference;
  assert.equal(api.canUseInferencePlan(report, selection(report)), true);
  assert.equal(report.inferencePlan.executionStatus, 'not_executed');
  assert.equal(report.inferencePlan.requiresWorkerReauthorization, true);
  assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', selection(report)), false);
});
check('explicit-future-inference-plan-retains-persistent-warning', () => {
  const report = fixtures.future_inference;
  assert.equal(api.canUseInferencePlan(report, selection(report)), true);
  assert.equal(report.inferencePlan.provisional, true);
  assert.ok(report.notices.some(notice => notice.code === 'PROVISIONAL_FUTURE_INFERENCE' && notice.persistent));
});
check('stripped-or-suppressed-future-warning-rejects-plan-display', () => {
  for (const target of ['report', 'plan']) {
    for (const defect of ['remove', 'notPersistent', 'notWarning', 'empty']) {
      const report = copy(fixtures.future_inference);
      const holder = target === 'report' ? report : report.inferencePlan;
      const warning = holder.notices.find(notice => notice.code === 'PROVISIONAL_FUTURE_INFERENCE');
      if (defect === 'remove') holder.notices = holder.notices.filter(notice => notice !== warning);
      if (defect === 'notPersistent') warning.persistent = false;
      if (defect === 'notWarning') warning.severity = 'info';
      if (defect === 'empty') warning.message = ' ';
      assert.equal(api.canUseInferencePlan(report, selection(fixtures.future_inference)), false);
    }
  }
});
check('stale-inference-context-or-engine-identity-rejects-plan', () => {
  for (const mutation of [
    report => { report.inferencePlan.contextSha256 = '0'.repeat(64); },
    report => { report.inferencePlan.engine.identity.artifactSha256 = '0'.repeat(64); },
    report => { report.inferencePlan.provisional = true; },
  ]) {
    const report = copy(fixtures.inference); mutation(report);
    assert.equal(api.canUseInferencePlan(report, selection(fixtures.inference)), false);
  }
});
check('new-compatible-simulator-remains-usable-alongside-provisional-inference-option', () => {
  const report = fixtures.mixed_verified;
  assert.equal(report.compatibility.mode, 'provisional_future_inference');
  assert.equal(api.canUseSimulatedCapability(report, 'recordedResults', selection(report)), true);
  assert.equal(api.canUseInferencePlan(report, selection(report)), false);
  assert.equal(report.notices.some(notice => notice.code === 'PROVISIONAL_FUTURE_INFERENCE'), false);
});
check('stock-worker-never-claims-hidden-state-capability', () => {
  for (const report of [...Object.values(fixtures), null]) assert.equal(api.providesHiddenState(report), false);
});

const report = {
  schemaVersion: 1, updatedAtUtc: new Date().toISOString(),
  command: ['node', 'tests/globalsim/test_contracts.mjs', ...process.argv.slice(2)].join(' '),
  fixtureGeneration: values.fixtures ? 'separate-export_contract_fixtures.py-command' : 'spawned-export_contract_fixtures.py',
  actualArguments: process.argv.slice(2),
  node: process.version, pythonExecutable: values.python,
  source: 'src/simulation/contracts.ts', syntaxCheckPassed: true,
  typescriptCompilerRun: false, applicationBuildRun: false,
  actualPythonGatewayResponses: true, simulatorExecuted: false, inferenceExecuted: false,
  fixtureScope: 'Synthetic dates/engine identities and stubbed simulation; no actual release/version support claimed.',
  testsRun: checks.length, passed: checks.filter(check => check.status === 'passed').length,
  failed: checks.filter(check => check.status === 'failed').length, checks,
};
report.success = report.failed === 0;
if (values.output) await writeFile(resolve(values.output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, checks: report.failed ? checks : undefined }, null, 2));
if (!report.success) process.exitCode = 1;
