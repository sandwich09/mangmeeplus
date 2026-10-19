// Run from the gateway package with node --import tsx (see the credit-levers spec).
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const C = require(root + '/packages/contracts/src/index.ts');
const { IntentRouterAgent } = require(root + '/apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts');
const { APPROVED_PREPARED_FAMILY_KEYS } = require(root + '/apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.ts');
const { ROLE_GRANTS } = require(root + '/apps/api/src/modules/auth/permission-registry.ts');
const { intakeConstantParts, scaleIntakeCalibration, INTAKE_CONSTANT_CALIBRATIONS, INTAKE_CALIBRATION_MODEL } = require(root + '/apps/ai-gateway/src/common/usage/intake-token-calibration.ts');
(async () => {
  const previous = INTAKE_CONSTANT_CALIBRATIONS.find(row => row.digest === process.argv[2]);
  if (!previous) throw new Error('Pass a previous calibrated constant digest. New model/mode or >10% growth requires paired live measurements.');
  let captured;
  const inputEvidence = (await C.createLineAiInputEvidence({ turnKey: 'calibrate', parts: [{ partId: 'part-0', eventIdHash: 'a'.repeat(64), acceptedAtMs: 1792397640000, rawText: 'ค่าอาหาร' }] })).inputEvidence;
  await new IntentRouterAgent({ generateText: async input => { captured = input; return { ok: false, error: { code: 'PROVIDER_DISABLED', message: 'offline', retryable: false } }; } }, true, { enabled: true }, false, [...APPROVED_PREPARED_FAMILY_KEYS]).routeIntake({
    requestId: 'calibrate', companyId: 'offline', userId: 'offline', locale: 'th', messageText: 'ค่าอาหาร', inputEvidence,
    valueCandidates: await C.extractValueCandidatesV2(inputEvidence, '2026-10-19'), permissions: ROLE_GRANTS.OWNER,
    enabledFeatures: [...C.TIER_FEATURE_PRESETS.STARTER_249], offeredToolNames: C.LINE_TOOL_REGISTRY.map(tool => tool.name),
    capabilities: { fusedPlan: true, substituteSemantic: true, reimbursementSemantic: true, advisor: true, responsePreference: true, approvedKnowledge: true }, attachments: [],
  });
  const next = intakeConstantParts(captured);
  if (!next) throw new Error('Unrecognized constant-part shape: live measurement required.');
  console.log(JSON.stringify({ model: INTAKE_CALIBRATION_MODEL, digest: next.digest, bytes: next.bytes,
    tokenBound: scaleIntakeCalibration(previous, next.bytes), previousDigest: previous.digest,
    reviewRequired: 'Suggestion only. Keep the same margin. Different character mix, model, catalogue vocabulary, prompt mode/semantics, or >10% growth requires paired live measurements; do not auto-accept this entry.' }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
