import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AUTHORED_CORPUS, CORPUS_JSON_PATH, assertFrozenArtifact } from './line-ai-reliability-corpus';
import { reliabilityDigest, validateReliabilityCorpus } from './line-ai-reliability-fixtures';
import {
  NATURAL_ARTIFACT_DIGEST, NATURAL_CLOCK, NATURAL_CORPUS, NATURAL_DIAGNOSTIC_POLICY,
  NATURAL_MODEL_ID, NATURAL_REFERENCE_FACTS, NATURAL_REVIEW_CRITERIA, NATURAL_SOURCE_PATH,
  NATURAL_SOURCE_SNAPSHOT_MANIFEST, buildNaturalConversationRuntimeManifest,
} from './line-ai-natural-conversation-corpus';

const snapshot = NATURAL_SOURCE_SNAPSHOT_MANIFEST.snapshots['nat-NAT-01']!;
const expenses = snapshot.rows.filter(row => row.model === 'expenseRecord').map(row => row.data);
const cents = (value: unknown): bigint => {
  const match = String(value).match(/^(\d+)\.(\d{2})(?:00)?$/);
  assert.ok(match, `expected exact two-decimal money: ${value}`);
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
};
const money = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
const sumExpenses = (month: string, confirmed = false, category?: string) => expenses.filter(row =>
  NATURAL_REFERENCE_FACTS.authorizedBranchIds.includes(String(row.branchId))
  && String(row.expenseDate).startsWith(month) && row.status !== 'VOIDED'
  && (!confirmed || row.status === 'CONFIRMED') && (!category || row.expenseCategoryId === category))
  .reduce((sum, row) => sum + cents(row.grandTotalAmount), 0n);

test('NAT imports all 60 exact approved questions, preserving the 225 frozen corpus', () => {
  assert.equal(NATURAL_CORPUS.fixtures.length, 12);
  const docQuestions = readFileSync(NATURAL_SOURCE_PATH, 'utf8').slice(readFileSync(NATURAL_SOURCE_PATH, 'utf8').indexOf('### NAT-01'))
    .split('\n').filter(line => /^\| [1-5] \|/.test(line)).map(line => line.split('|')[2]!.trim());
  assert.equal(docQuestions.length, 60);
  assert.deepEqual(NATURAL_CORPUS.fixtures.flatMap(row => row.turns.map(turn => turn.user)), docQuestions);
  assert.equal(NATURAL_REVIEW_CRITERIA.length, 12);
  assert.ok(NATURAL_REVIEW_CRITERIA.every(row => row.turns.length === 5 && row.prerequisite));
  validateReliabilityCorpus(NATURAL_CORPUS);
  assert.equal(AUTHORED_CORPUS.fixtures.length, 225);
  assertFrozenArtifact(JSON.parse(readFileSync(CORPUS_JSON_PATH, 'utf8')));
});

test('NAT is diagnostic, not asset certification or exact-tool acceptance', () => {
  assert.equal(NATURAL_CORPUS.status, 'draft');
  assert.equal(NATURAL_DIAGNOSTIC_POLICY.acceptanceEligible, false);
  assert.equal(NATURAL_DIAGNOSTIC_POLICY.exactToolGoldens, false);
  assert.equal(NATURAL_DIAGNOSTIC_POLICY.aggregateQualityScore, false);
  assert.ok(NATURAL_CORPUS.fixtures.every(row => !row.capabilities.includes('C09') && !row.capabilities.includes('C13')));
  assert.ok(NATURAL_DIAGNOSTIC_POLICY.limitations['NAT-04'].includes('NOT_RUN_FIXTURE_REQUIRED'));
  assert.ok(NATURAL_CORPUS.fixtures.every(row => row.provenance.reviewedBy === null && row.assets.every(asset => asset.labelledBy === null)));
  assert.throws(() => validateReliabilityCorpus(NATURAL_CORPUS, true), /CORPUS_NOT_REVIEWED/);
  assert.match(NATURAL_ARTIFACT_DIGEST, /^[a-f0-9]{64}$/);
});

test('assets are attached only at the three actual upload turns; no seeded assistant choices or preview', () => {
  assert.deepEqual(NATURAL_CORPUS.fixtures.flatMap(row => row.turns.flatMap((turn, index) => turn.attachmentIds.length
    ? [{ scenario: row.id, turn: index + 1, ids: turn.attachmentIds }] : [])), [
    { scenario: 'NAT-05', turn: 1, ids: ['receipt-clear'] },
    { scenario: 'NAT-06', turn: 1, ids: ['receipt-partial'] },
    { scenario: 'NAT-06', turn: 2, ids: ['document-unreadable'] },
  ]);
  for (const fixture of NATURAL_CORPUS.fixtures) {
    const seeded = NATURAL_SOURCE_SNAPSHOT_MANIFEST.snapshots[fixture.fixture.sourceSnapshot]!;
    assert.equal(seeded.postbackLabels, undefined);
    assert.deepEqual(Object.keys(seeded.assets).sort(), fixture.assets.map(asset => asset.id).sort());
    assert.ok(!seeded.rows.some(row => /aiConversation|reimbursementDraftAction|lineDocumentQaJob|pendingAction/i.test(row.model)));
    assert.equal(reliabilityDigest(seeded), NATURAL_SOURCE_SNAPSHOT_MANIFEST.snapshotDigests[fixture.fixture.sourceSnapshot]);
  }
});

test('the real seeded owner grants and branch scopes exactly match fixture admission', () => {
  const fixture = NATURAL_CORPUS.fixtures[0]!;
  const permissionMap = new Map(snapshot.rows.filter(row => row.model === 'permission').map(row => [row.data.id, row.data.key]));
  const role = snapshot.rows.find(row => row.model === 'role')!.data;
  const granted = (role.permissions as { create: Array<{ permissionId: string }> }).create.map(row => permissionMap.get(row.permissionId));
  assert.deepEqual(granted.sort(), [...fixture.fixture.permissions].sort());
  const membership = snapshot.rows.find(row => row.model === 'companyMembership')!.data;
  const scoped = (membership.branchScopes as { create: Array<{ branchId: string }> }).create.map(row => row.branchId);
  assert.deepEqual(scoped.sort(), [...fixture.fixture.branches].sort());
  assert.ok(!scoped.includes('branch-secret'));
  assert.ok(['reimbursement.create', 'reimbursement.update_own_draft', 'expense.create', 'attachment.create'].every(key => granted.includes(key)));
  assert.equal(snapshot.rows.find(row => row.model === 'companyAiConfiguration')!.data.modelId, NATURAL_MODEL_ID);
  assert.equal(fixture.fixture.clock, NATURAL_CLOCK);
  assert.ok(snapshot.rows.find(row => row.model === 'branch' && row.data.id === 'branch-ramkhamhaeng'));
});

test('SME amounts, comparison arithmetic, category increases and paid status come from ERP rows', () => {
  const expected = NATURAL_REFERENCE_FACTS.expense;
  assert.ok(expenses.every(row => cents(row.grandTotalAmount) < 10_000_000n));
  assert.equal(money(sumExpenses('2026-08')), expected.augustAll);
  assert.equal(money(sumExpenses('2026-09')), expected.septemberAll);
  assert.equal(money(sumExpenses('2026-09') - sumExpenses('2026-08')), expected.differenceAll);
  assert.equal(money(sumExpenses('2026-09', true)), expected.septemberConfirmed);
  assert.equal(money(sumExpenses('2026-09', true) - sumExpenses('2026-08', true)), expected.differenceConfirmed);
  for (const [category, facts] of Object.entries(expected.categories)) {
    const id = ['fuel', 'travel'].includes(category) ? `category-${category}` : `nat-category-${category}`;
    assert.equal(money(sumExpenses('2026-08', false, id)), facts.august);
    assert.equal(money(sumExpenses('2026-09', false, id)), facts.september);
    const delta = sumExpenses('2026-09', false, id) - sumExpenses('2026-08', false, id);
    assert.equal(delta.toString(), String(Math.round(Number(facts.difference) * 100)));
  }
  assert.equal(expenses.filter(row => row.expenseCategoryId === 'nat-category-utilities' && row.branchId !== 'branch-secret').length, 0);
  assert.equal(expenses.filter(row => row.expenseCategoryId === 'nat-category-utilities' && row.branchId === 'branch-secret').length, 1);
  assert.ok(expenses.some(row => row.status === 'CONFIRMED' && row.paymentStatus === 'UNPAID'));
  for (const row of expenses.filter(row => row.paymentStatus === 'PAID')) {
    const payments = snapshot.rows.filter(payment => payment.model === 'expensePayment' && payment.data.expenseId === row.id);
    assert.equal(payments.reduce((sum, payment) => sum + cents(payment.data.amount), 0n), cents(row.paidAmount));
  }
});

test('sales, received cash, bank and Somchai identity facts are separate real records', () => {
  const bases = NATURAL_REFERENCE_FACTS.moneyBases;
  const total = (model: string, field: string, predicate: (data: Record<string, unknown>) => boolean) => money(snapshot.rows
    .filter(row => row.model === model && predicate(row.data)).reduce((sum, row) => sum + cents(row.data[field]), 0n));
  assert.equal(total('accountingDocument', 'grandTotalAmount', row => row.documentType === 'INVOICE' && row.status === 'ISSUED'), bases.septemberIssuedInvoices);
  assert.equal(total('accountingPayment', 'amount', row => row.direction === 'RECEIVED' && row.status === 'RECORDED' && String(row.paidAt).startsWith('2026-09')), bases.septemberRecordedCustomerReceipts);
  assert.equal(total('bankReconciliationSession', 'closingStatementBalanceAmount', row => row.status === 'COMPLETED'), bases.lastCompletedBankStatementBalance);
  for (const bill of NATURAL_REFERENCE_FACTS.somchaiRepairBillsLastWeek) {
    const row = expenses.find(row => row.id === bill.id)!;
    assert.equal(row.vendorCounterpartyId, 'nat-vendor-somchai-repair');
    assert.equal(money(cents(row.grandTotalAmount)), bill.amount);
    assert.ok(String(row.expenseDate).startsWith(bill.date));
  }
});

test('manifest selection is isolated, denies unknown IDs and forces no public search', () => {
  const options = { scenarioIds: ['NAT-01'], apiPort: 3107, gatewayUrl: 'http://127.0.0.1:3108',
    databaseUrl: 'postgresql://localhost/watchdog_ai_reliability_replay_nat', redisUrl: 'redis://127.0.0.1:6379/8',
    environment: { LINE_AI_PUBLIC_LOOKUP_ENABLED: 'true' }, repeats: 1, cohort: '1000' as const,
    versions: { sourceCommit: 'local', schema: 'local', prompt: 'local', registry: 'local', model: NATURAL_MODEL_ID, price: 'local' } };
  const manifest = buildNaturalConversationRuntimeManifest(options);
  assert.equal(manifest.corpus.fixtures.length, 1);
  assert.deepEqual(Object.keys(manifest.snapshots), ['nat-NAT-01']);
  assert.equal(manifest.environment.LINE_AI_PUBLIC_LOOKUP_ENABLED, 'false');
  assert.ok(!('criteria' in manifest) && !('referenceFacts' in manifest));
  manifest.snapshots['nat-NAT-01']!.rows[0]!.data.displayName = 'mutation test';
  assert.notEqual(snapshot.rows[0]!.data.displayName, 'mutation test');
  assert.throws(() => buildNaturalConversationRuntimeManifest({ ...options, scenarioIds: ['UNKNOWN'] }), /UNKNOWN_OR_DUPLICATE_NAT_SCENARIO/);
});


test('new NAT categories carry the required registered accounting hint without claiming reviewed posting authority', () => {
  const hints = { 'nat-category-office': 'expense.office_supplies', 'nat-category-service': 'expense.professional_fees',
    'nat-category-utilities': 'expense.utilities' };
  for (const [id, accountHintKey] of Object.entries(hints)) {
    const row = snapshot.rows.find(row => row.model === 'expenseCategory' && row.data.id === id)!;
    assert.equal(row.data.accountHintKey, accountHintKey);
    assert.equal(row.data.ledgerAccountCode, undefined);
    assert.equal(row.data.ledgerAccountReviewedByUserId, undefined);
  }
});

// Explicit opt-in, destructive only inside the same guarded isolated local replay database.
// Uses real generated Prisma validation and DB constraints before any paid model call.
test('all distinct NAT row sets seed through real Prisma and PostgreSQL', {
  skip: !process.env.NAT_SEED_DATABASE_URL && 'Set NAT_SEED_DATABASE_URL to the dedicated local replay DB for the seed-only check',
}, async () => {
  const { resetRuntimeFixtureDatabase, assertIsolatedReplayDatabase } = await import('./line-ai-reliability-runtime');
  const { PrismaClient } = await import('../apps/api/src/generated/prisma/client');
  const apiRequire = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api/package.json'));
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const { Client } = apiRequire('pg');
  const databaseUrl = process.env.NAT_SEED_DATABASE_URL!;
  assertIsolatedReplayDatabase(databaseUrl);
  const connection = new Client({ connectionString: databaseUrl });
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  await connection.connect();
  try {
    assert.equal((await connection.query("SELECT pg_try_advisory_lock(hashtext('line-reliability-runtime-reset')) AS locked")).rows[0]?.locked, true, 'REPLAY_DATABASE_ALREADY_IN_USE');
    const distinct = new Map(Object.values(NATURAL_SOURCE_SNAPSHOT_MANIFEST.snapshots).map(value => [reliabilityDigest(value.rows), value.rows]));
    assert.equal(distinct.size, 1, 'All twelve snapshots currently share the same real ERP rows');
    for (const rows of distinct.values()) {
      await resetRuntimeFixtureDatabase(connection, databaseUrl);
      for (const [index, seed] of rows.entries()) {
        try { await (client as unknown as Record<string, { create(input: unknown): Promise<unknown> }>)[seed.model]!.create({ data: seed.data }); }
        catch (error) { throw new Error(`NAT_SEED_FAILED:${index}:${seed.model}:${seed.data.id}`, { cause: error }); }
      }
      assert.equal(await client.expenseRecord.count(), expenses.length);
      assert.equal(await client.expensePayment.count(), 3);
      assert.equal(await client.companyMembership.count({ where: { status: 'ACTIVE' } }), 1);
    }
  } finally { await client.$disconnect(); await connection.end(); }
});
