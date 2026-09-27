import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ALL_FEATURE_ENTITLEMENT_KEYS, LINE_TOOL_REGISTRY } from '../packages/contracts/src/index';
import {
  ACTIVE_CAPABILITIES,
  ASSET_DIR,
  AUTHORED_ARTIFACT,
  AUTHORED_ARTIFACT_DIGEST,
  AUTHORED_CORPUS,
  AUTHORED_SOURCE_SNAPSHOT_MANIFEST,
  CORPUS_JSON_PATH,
  GROUPS,
  assertFrozenArtifact,
  validateCorpusToolInputs,
} from './line-ai-reliability-corpus';
import { reliabilityDigest, validateReliabilityCorpus, type ReliabilityCorpus } from './line-ai-reliability-fixtures';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const base = AUTHORED_CORPUS.fixtures.filter(row => !row.paraphrase);
const variants = AUTHORED_CORPUS.fixtures.filter(row => row.paraphrase);

test('W14 authored corpus has the exact family, split, group, language, and regression shape', () => {
  assert.equal(AUTHORED_CORPUS.status, 'draft');
  assert.equal(base.length, 150);
  assert.equal(variants.length, 75);
  assert.equal(new Set(base.map(row => row.familyId)).size, 150);
  assert.equal(new Set(base.map(row => row.turns[0]!.user)).size, 150, 'base requests must be authored-distinct');
  assert.ok(base.every(row => AUTHORED_SOURCE_SNAPSHOT_MANIFEST.snapshots[row.fixture.sourceSnapshot]));
  assert.equal(base.filter(row => row.split === 'development').length, 100);
  assert.equal(base.filter(row => row.split === 'held_out').length, 50);
  assert.deepEqual(Object.fromEntries(GROUPS.map(group => [group, base.filter(row => row.group === group).length])), {
    single_turn: 35, multi_turn: 30, general_help: 25, mixed_current_denied: 30, receipt_document: 30,
  });
  for (const group of GROUPS) assert.equal(base.filter(row => row.group === group && row.split === 'held_out').length, 10, group);
  assert.ok(variants.every(row => row.language === 'th'));
  assert.equal(new Set(variants.map(row => row.familyId)).size, 75);
  for (const variant of variants) assert.ok(base.some(row => row.familyId === variant.familyId && row.split === variant.split && row.group === variant.group));

  const multiTurn = base.filter(row => row.group === 'multi_turn');
  assert.ok(multiTurn.every(row => row.turns.length >= 2));
  assert.ok(multiTurn.some(row => row.turns[0]!.expect.outcomes.includes('needs_input') && row.turns[1]!.expect.sameTask));
  for (const id of ['multi-preference-request', 'multi-ho-procurement-search', 'multi-ho-tax-documents',
    'multi-ho-crm-bookings', 'multi-report-filter-correction', 'di06-full-catalog-render', 'ci16-release-scope']) {
    const first = multiTurn.find(row => row.id === id)!.turns[0]!.expect;
    assert.deepEqual(first.outcomes, ['answered'], `${id}: complete input must not require an invented clarification`);
    assert.equal(first.missingSlot, undefined);
  }
  for (const row of multiTurn) if (!row.turns[0]!.expect.outcomes.includes('needs_input')) {
    assert.ok(!row.turns[1]!.expect.sameTask, `${row.id}: a completed/denied turn is not a pending task`);
  }
  assert.ok(AUTHORED_CORPUS.fixtures.every(row => row.provenance.reviewedBy === null && row.provenance.reviewedAt === null));

  const splitByFamily = new Map<string, string>();
  for (const row of AUTHORED_CORPUS.fixtures) {
    assert.ok(!splitByFamily.has(row.familyId) || splitByFamily.get(row.familyId) === row.split);
    splitByFamily.set(row.familyId, row.split);
  }
  const regressionIds = new Set([...Array.from({ length: 16 }, (_, i) => `CI${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 14 }, (_, i) => `DI${String(i + 1).padStart(2, '0')}`)]);
  for (const id of regressionIds) assert.ok(base.some(row => row.id.startsWith(id.toLowerCase()) && row.fixedRegression), id);
});

test('all active capabilities are covered and deferred voice is absent', () => {
  const covered = new Set(AUTHORED_CORPUS.fixtures.flatMap(row => row.capabilities));
  assert.deepEqual([...covered].sort(), [...ACTIVE_CAPABILITIES].sort());
  assert.ok(!covered.has('C13'));
});

test('every emitted expected tool uses a registered name and only real required/optional fields', () => {
  validateCorpusToolInputs(AUTHORED_CORPUS);
  const meta = new Map(LINE_TOOL_REGISTRY.map(item => [item.name, item]));
  for (const row of AUTHORED_CORPUS.fixtures) for (const turn of row.turns) for (const call of turn.expect.toolInputs) {
    const registered = meta.get(call.tool);
    assert.ok(registered, `${row.id}:${call.tool}`);
    for (const required of registered?.requiredInputFields ?? []) assert.ok(Object.hasOwn(call.input, required), `${row.id}:${call.tool}:${required}`);
  }
});

test('tool validator rejects unregistered, unknown, and missing required arguments', () => {
  const unknownTool = structuredClone(AUTHORED_CORPUS) as ReliabilityCorpus;
  unknownTool.fixtures[0]!.turns[0]!.expect.toolInputs[0]!.tool = 'not.a.real.tool';
  assert.throws(() => validateCorpusToolInputs(unknownTool), /UNREGISTERED_TOOL/);

  const unknownField = structuredClone(AUTHORED_CORPUS) as ReliabilityCorpus;
  unknownField.fixtures[0]!.turns[0]!.expect.toolInputs[0]!.input.notARegistryField = true;
  assert.throws(() => validateCorpusToolInputs(unknownField), /UNKNOWN_TOOL_INPUT/);

  const missingRequired = structuredClone(AUTHORED_CORPUS) as ReliabilityCorpus;
  const publicCall = missingRequired.fixtures.flatMap(row => row.turns).flatMap(turn => turn.expect.toolInputs).find(call => call.tool === 'public.lookup');
  assert.ok(publicCall);
  delete publicCall!.input.publicQuestion;
  assert.throws(() => validateCorpusToolInputs(missingRequired), /MISSING_REQUIRED_INPUT/);
});

test('source snapshot manifest contains real ordered Prisma creates for every actual guard', () => {
  assert.equal(AUTHORED_SOURCE_SNAPSHOT_MANIFEST.version, 1);
  assert.ok(Object.keys(AUTHORED_SOURCE_SNAPSHOT_MANIFEST.snapshots).length >= 2);
  for (const [key, source] of Object.entries(AUTHORED_SOURCE_SNAPSHOT_MANIFEST.snapshots)) {
    assert.equal(AUTHORED_SOURCE_SNAPSHOT_MANIFEST.snapshotDigests[key], reliabilityDigest(source));
    assert.ok(source.rows.every(row => /^[a-z][A-Za-z0-9]*$/.test(row.model) && row.data.id));
    const models = source.rows.map(row => row.model);
    for (const required of ['user', 'company', 'lineChannelBinding', 'companyMembership', 'externalIdentity', 'lineCompanyContext']) assert.ok(models.includes(required), `${key}:${required}`);
    for (const required of ['accountingPeriod', 'journalEntry', 'journalLine', 'crmCustomer', 'crmFollowUpTask', 'crmBooking', 'supplierProfile', 'purchaseOrder', 'purchaseOrderLine', 'workflowRun', 'workflowTask']) {
      assert.ok(models.includes(required), `${key}:${required}`);
    }
    for (const id of ['CUST-81', 'PO-771', 'RUN-442']) assert.ok(source.rows.some(row => row.data.id === id), `${key}:${id}`);
    assert.equal(models.filter(model => model === 'legalDocumentActionRecord').length, 2, key);
    const featureRows = source.rows.filter(row => row.model === 'companyFeatureEntitlement').map(row => row.data.featureKey);
    assert.deepEqual(featureRows, [...ALL_FEATURE_ENTITLEMENT_KEYS].sort(), key);
    const membership = source.rows.find(row => row.model === 'companyMembership')!.data;
    assert.equal(membership.status, key.includes('-revoked-') ? 'DISABLED' : 'ACTIVE');
  }
  assert.ok(AUTHORED_CORPUS.fixtures.filter(row => row.fixture.membership).every(row =>
    reliabilityDigest(row.fixture.enabledFeatures) === reliabilityDigest([...ALL_FEATURE_ENTITLEMENT_KEYS].sort())));
});

test('source-derived canonical facts cover actual expense, sales, accounting, report, and bank SourceFacts', () => {
  const factBearingBase = base.filter(row => row.turns.some(turn => turn.expect.requiredFacts.length));
  const factBearingAll = AUTHORED_CORPUS.fixtures.filter(row => row.turns.some(turn => turn.expect.requiredFacts.length));
  assert.equal(factBearingBase.length, 28);
  assert.equal(factBearingAll.length, 45);
  assert.equal(AUTHORED_CORPUS.fixtures.flatMap(row => row.turns).reduce((sum, turn) => sum + turn.expect.requiredFacts.length, 0), 95);
  for (const row of AUTHORED_CORPUS.fixtures) for (const turn of row.turns) {
    const reason = (turn.expect as typeof turn.expect & { noFactReason?: string }).noFactReason;
    assert.ok(turn.expect.requiredFacts.length > 0 !== Boolean(reason), `${row.id}: facts xor noFactReason`);
    assert.ok(turn.expect.requiredFacts.every(fact => fact.asOf === 'read_time'));
  }
  const facts = (id: string, turn = 0) => base.find(row => row.id === id)!.turns[turn]!.expect.requiredFacts;
  assert.deepEqual(facts('ci01-period-preserved').map(fact => [fact.metric, fact.value, fact.basis, fact.sourceRef]), [
    ['expense_total', '11720.75', 'expense_incurred_date|CONFIRMED', 'expenses:expense_summary:summary'],
  ]);
  assert.equal(facts('ci05-exact-decimal-boundary')[0]!.value, '1000000000000.01');
  assert.equal(facts('ci06-sales-not-profit')[0]!.value, '745800');
  assert.equal(facts('single-ho-receivable')[0]!.value, '118900.00');
  assert.equal(facts('single-bank-balance')[0]!.value, '70210.35');
  assert.deepEqual(facts('multi-ho-bank-reconcile', 1).map(fact => [fact.metric, fact.value]), [
    ['unmatched_statement_line_count', '1'], ['pending_bank_adjustment_count', '1'],
  ]);
  assert.equal(facts('di07-long-canonical-answer', 1).length, 8, 'four report facts bind to both real source refs');
  assert.equal(facts('mixed-current-no-data')[0]!.value, '0', 'complete empty source is an explicit zero fact');
  assert.deepEqual(base.find(row => row.id === 'mixed-current-no-data')!.turns[0]!.expect.outcomes, ['answered']);
  assert.ok(!AUTHORED_CORPUS.fixtures.some(row => row.turns.some(turn => turn.expect.outcomes.some(outcome => ['no_data', 'insufficient_data'].includes(outcome)))));
  assert.deepEqual(base.find(row => row.id === 'ci09-owner-revocation-block')!.turns[0]!.expect.toolInputs, []);
  assert.deepEqual(base.find(row => row.id === 'mixed-owner-revoke-after-queue')!.turns[0]!.expect.toolInputs, []);
});

test('actual asset bytes and draft labels match frozen hashes', () => {
  for (const [id, manifest] of Object.entries(AUTHORED_ARTIFACT.assetManifest)) {
    const fileBytes = readFileSync(join(ASSET_DIR, manifest.fileName));
    const labelBytes = readFileSync(join(ASSET_DIR, manifest.labelFile));
    assert.equal(sha256(fileBytes), manifest.sha256, `${id}:file`);
    assert.equal(sha256(labelBytes), manifest.labelDigest, `${id}:label`);
    const label = JSON.parse(labelBytes.toString()) as { status: string; labelledBy: unknown; expectedZeroQaFinancialWrites: boolean; provenance: { reviewedBy: unknown; reviewedAt: unknown } };
    assert.equal(label.status, 'draft');
    assert.equal(label.labelledBy, null);
    assert.equal(label.provenance.reviewedBy, null);
    assert.equal(label.provenance.reviewedAt, null);
    assert.equal(label.expectedZeroQaFinancialWrites, true);
  }
});

test('frozen artifact is deterministic and draft corpus cannot pass acceptance', () => {
  const frozen = JSON.parse(readFileSync(CORPUS_JSON_PATH, 'utf8')) as unknown;
  assertFrozenArtifact(frozen);
  assert.equal((frozen as typeof AUTHORED_ARTIFACT).artifactDigest, AUTHORED_ARTIFACT_DIGEST);
  assert.equal(reliabilityDigest(frozen), reliabilityDigest(AUTHORED_ARTIFACT));
  assert.equal((frozen as typeof AUTHORED_ARTIFACT).activationEligible, false);
  assert.equal('semanticOracleStatus' in (frozen as object), false);
  assert.doesNotMatch(JSON.stringify(frozen), /pending_unsupported|dynamic-asOf/);
  assert.throws(() => validateReliabilityCorpus(AUTHORED_CORPUS, true), /CORPUS_NOT_REVIEWED/);

  const labelledButUnreviewed = structuredClone(AUTHORED_CORPUS) as ReliabilityCorpus;
  labelledButUnreviewed.status = 'reviewed';
  const labelledRow = labelledButUnreviewed.fixtures.find(row => row.assets.length > 0)!;
  labelledRow.assets[0]!.labelledBy = 'reviewer-not-real';
  assert.throws(() => validateReliabilityCorpus(labelledButUnreviewed, true), /CORPUS_REVIEW_REQUIRED|CORPUS_HUMAN_LABEL_REQUIRED/);
});
