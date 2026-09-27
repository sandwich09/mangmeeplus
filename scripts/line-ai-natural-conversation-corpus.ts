/** NAT diagnostic: exact owner-approved questions, real synthetic ERP seeds, no answer oracle in execution. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_DIR, AUTHORED_ARTIFACT, AUTHORED_CORPUS,
  AUTHORED_SOURCE_SNAPSHOT_MANIFEST, type CorpusSourceSnapshotManifest, type RuntimeSourceSnapshot,
} from './line-ai-reliability-corpus';
import { reliabilityDigest, validateReliabilityCorpus, type ReliabilityCorpus, type ReliabilityFixture } from './line-ai-reliability-fixtures';
import type { ReliabilityRuntimeManifest } from './line-ai-reliability-runtime';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NATURAL_SOURCE_PATH = join(ROOT, 'docs/research/mangmee-ai-human-review-2026-09-27-th.md');
export const NATURAL_MODEL_ID = 'global.anthropic.claude-sonnet-4-6';
export const NATURAL_CLOCK = '2026-09-27T03:00:00.000Z';
const source = readFileSync(NATURAL_SOURCE_PATH, 'utf8');
const cases = [...source.matchAll(/^### (NAT-\d{2}) — (.+)\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)].map(match => ({
  id: match[1]!, title: match[2]!, prerequisite: match[3]!.match(/^เงื่อนไขก่อนเริ่ม: (.+)$/m)![1]!,
  turns: match[3]!.split('\n').filter(line => /^\| [1-5] \|/.test(line)).map(line => {
    const cells = line.split('|').map(cell => cell.trim());
    return { ordinal: Number(cells[1]), user: cells[2]!, behavior: cells[3]!, limitation: cells[4]! };
  }),
}));
assert.equal(cases.length, 12, 'NAT_SOURCE_CASE_COUNT');
assert.ok(cases.every(row => row.turns.length === 5), 'NAT_SOURCE_TURN_COUNT');

/** These are review instructions, NEVER system/user prompts or mocked tool results. */
export const NATURAL_DIAGNOSTIC_POLICY = {
  mode: 'natural_diagnostic', status: 'draft', acceptanceEligible: false,
  approvalScope: 'Owner approved these 60 questions in the current conversation; ERP fixture, asset labels, answers and behavior remain unreviewed.',
  sourceDocumentStatus: 'UNREVIEWED', exactToolGoldens: false, aggregateQualityScore: false,
  semanticReview: 'Review actual accepted LINE wire, actual tools and durable state; old exact-tool/fact/effect scorer is not NAT correctness.',
  publicLookup: false, fabricatedAssistantHistory: false,
  limitations: {
    'NAT-04': 'MISSING_PRIOR_RECEIPTS: two earlier stationery uploads are not available. Run truthfulness/missing-evidence diagnostic only; full source-selection/reimbursement path is NOT_RUN_FIXTURE_REQUIRED.',
    'NAT-05': 'Existing synthetic PNG and draft label only; owner has not certified visual labels or OCR answers.',
    'NAT-06': 'Existing two-page PDF assets and draft labels only; requested page readability and replacement must be verified from actual reader evidence.',
    'NAT-03': 'Turn 3 ordinal must resolve only if the preceding accepted answer actually supplied that choice; no choices are seeded.',
    'NAT-08': 'Turn 3 refers to an actual preceding accepted choice, if any; two Somchai vendors and two repair bills exist in ERP.',
    'NAT-12': 'Edit/cancel coverage depends on an actual preview produced in preceding turns; none is fabricated and no button click substitutes for user text.',
  },
} as const;
export const NATURAL_REVIEW_CRITERIA = cases.map(row => ({ ...row, semanticStatus: 'PENDING_HUMAN_REVIEW' as const }));

const baseFixture = AUTHORED_CORPUS.fixtures.find(row => row.fixture.membership && row.assets.length === 0)!;
const companyId = baseFixture.fixture.company, actor = baseFixture.fixture.actor;
const privateBranches = ['branch-bkk', 'branch-ramintra', 'branch-ramkhamhaeng'];
// Real registered permissions used by capture, attachment and reimbursement routes; role grants are seeded normally.
const writerPermissions = ['attachment.create', 'expense.create', 'expense.update', 'expense.receipt.upload',
  'expense.receipt.line_upload', 'reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.read_own'];
const permissions = [...new Set([...baseFixture.fixture.permissions, ...writerPermissions])].sort();
const expense = (id: string, date: string, branchId: string, category: string, amount: string,
  extra: Record<string, unknown> = {}): RuntimeSourceSnapshot['rows'][number] => ({ model: 'expenseRecord', data: {
  id, companyId, branchId, expenseDate: `${date}T05:00:00.000Z`, createdByUserId: actor,
  status: 'CONFIRMED', expenseCategoryId: category, vendorNameSnapshot: 'คู่ค้าข้อมูลสังเคราะห์ NAT',
  currency: 'THB', grandTotalAmount: amount, ...extra,
} });

function seedRows(): RuntimeSourceSnapshot['rows'] {
  const rows = structuredClone(AUTHORED_SOURCE_SNAPSHOT_MANIFEST.snapshots[baseFixture.fixture.sourceSnapshot]!.rows);
  const insertBefore = (model: string, additions: RuntimeSourceSnapshot['rows']) => rows.splice(rows.findIndex(row => row.model === model), 0, ...additions);
  insertBefore('lineChannelBinding', [{ model: 'companyAiConfiguration', data: {
    id: 'nat-ai-configuration', companyId, modelId: NATURAL_MODEL_ID, monthlyBudgetSatang: 200_000,
    budgetMode: 'SHARED', ocrEnabled: true,
  } }]);
  insertBefore('permission', [{ model: 'branch', data: { id: 'branch-ramkhamhaeng', companyId, code: 'RAMK',
    name: 'สาขารามคำแหง', type: 'BRANCH', status: 'ACTIVE', createdByUserId: actor } }]);
  const missing = permissions.filter(key => !rows.some(row => row.model === 'permission' && row.data.key === key));
  const addedPermissions = missing.map((key, index) => ({ model: 'permission', data: { id: `nat-permission-${index}`, key, description: `NAT synthetic permission ${key}` } }));
  insertBefore('role', addedPermissions);
  const grants = rows.find(row => row.model === 'role')!.data.permissions as { create: Array<{ permissionId: string }> };
  grants.create.push(...addedPermissions.map(row => ({ permissionId: row.data.id })));
  const scopes = rows.find(row => row.model === 'companyMembership')!.data.branchScopes as { create: Array<{ id: string; branchId: string }> };
  scopes.create.push({ id: 'nat-scope-ramkhamhaeng', branchId: 'branch-ramkhamhaeng' });
  insertBefore('expenseRecord', [
    ...['office', 'service', 'utilities'].map((key, index) => ({ model: 'expenseCategory', data: {
      id: `nat-category-${key}`, companyId, name: ['ค่าอุปกรณ์สำนักงาน', 'ค่าบริการ', 'ค่าน้ำค่าไฟ'][index],
      status: 'ACTIVE', sortOrder: 30 + index,
    } })),
    ...[['repair', 'สมชายการช่าง'], ['office', 'สมชายเครื่องเขียน']].map(([key, displayName]) => ({ model: 'accountingCounterparty', data: {
      id: `nat-vendor-somchai-${key}`, companyId, type: 'VENDOR', displayName, status: 'ACTIVE', createdByUserId: actor,
    } })),
  ]);
  rows.find(row => row.model === 'expenseRecord' && row.data.id === 'EXP-303')!.data.grandTotalAmount = '9200.0000';
  rows.push(
    expense('NAT-AUG-FUEL', '2026-08-18', 'branch-bkk', 'category-fuel', '1800.0000'),
    expense('NAT-AUG-OFFICE', '2026-08-19', 'branch-bkk', 'nat-category-office', '2200.0000'),
    expense('NAT-AUG-SERVICE', '2026-08-22', 'branch-ramkhamhaeng', 'nat-category-service', '1500.0000'),
    expense('NAT-SEP-OFFICE', '2026-09-10', 'branch-bkk', 'nat-category-office', '7600.0000'),
    expense('NAT-SEP-SERVICE', '2026-09-12', 'branch-ramintra', 'nat-category-service', '3600.0000'),
    expense('NAT-SEP-DRAFT', '2026-09-23', 'branch-bkk', 'nat-category-office', '900.0000', { status: 'DRAFT' }),
    expense('NAT-SOMCHAI-850', '2026-09-15', 'branch-bkk', 'nat-category-service', '850.0000', { vendorCounterpartyId: 'nat-vendor-somchai-repair', vendorNameSnapshot: 'สมชายการช่าง' }),
    expense('NAT-SOMCHAI-1750', '2026-09-18', 'branch-bkk', 'nat-category-service', '1750.0000', { vendorCounterpartyId: 'nat-vendor-somchai-repair', vendorNameSnapshot: 'สมชายการช่าง' }),
    expense('NAT-SOMCHAI-OFFICE', '2026-09-17', 'branch-ramintra', 'nat-category-service', '1100.0000', { vendorCounterpartyId: 'nat-vendor-somchai-office', vendorNameSnapshot: 'สมชายเครื่องเขียน' }),
    expense('NAT-SEP-RAMK', '2026-09-19', 'branch-ramkhamhaeng', 'category-travel', '950.0000'),
    expense('NAT-SECRET-UTILITIES', '2026-09-15', 'branch-secret', 'nat-category-utilities', '9999.0000'),
  );
  // Amount/status is internally consistent. Paid status has actual payment evidence, not a label alone.
  for (const row of rows.filter(row => row.model === 'expenseRecord')) {
    const paid = ['EXP-AUG-BKK', 'EXP-744', 'NAT-SOMCHAI-850'].includes(String(row.data.id));
    Object.assign(row.data, { subtotalAmount: row.data.grandTotalAmount, taxableAmount: row.data.grandTotalAmount,
      netPayableAmount: row.data.grandTotalAmount, paidAmount: paid ? row.data.grandTotalAmount : '0.0000',
      outstandingAmount: paid || row.data.status === 'VOIDED' ? '0.0000' : row.data.grandTotalAmount,
      paymentStatus: row.data.status === 'VOIDED' ? 'VOIDED' : paid ? 'PAID' : 'UNPAID',
    });
    if (paid) {
      Object.assign(row.data, { paymentMethod: 'CASH', paidAt: row.data.expenseDate });
      rows.push({ model: 'expensePayment', data: { id: `NAT-PAY-${row.data.id}`, companyId,
        expenseId: row.data.id, amount: row.data.grandTotalAmount, currency: 'THB', paymentMethod: 'CASH',
        paidAt: row.data.expenseDate, status: 'RECORDED', createdByUserId: actor,
      } });
    }
  }
  return rows;
}
const rows = seedRows();
// Declared subjects for review, not a claim that each capability passed or was exercised.
const sharedSubjects = ['C01', 'C02', 'C04', 'C06', 'C14', 'C15', 'C16', 'C18'];
const extraSubjects: Record<string, string[]> = {
  'NAT-01': ['C03', 'C07', 'C10', 'C11'], 'NAT-02': ['C03', 'C10', 'C11'],
  'NAT-03': ['C10', 'C11'], 'NAT-04': ['C10', 'C11', 'C12'],
  'NAT-05': ['C03', 'C11', 'C12'], 'NAT-06': ['C03', 'C12'],
  'NAT-07': ['C11'], 'NAT-08': ['C10', 'C11'], 'NAT-09': ['C03', 'C07', 'C10', 'C11'],
  'NAT-10': ['C10', 'C11'], 'NAT-11': ['C03', 'C05', 'C11'], 'NAT-12': ['C11'],
};
const attachmentTurns: Record<string, Record<number, string[]>> = {
  'NAT-05': { 1: ['receipt-clear'] }, 'NAT-06': { 1: ['receipt-partial'], 2: ['document-unreadable'] },
};
export const NATURAL_CORPUS: ReliabilityCorpus = {
  version: 2, seed: 'mangmee-natural-owner-questions-2026-09-27-v1', status: 'draft', fixtures: cases.map(row => {
    const assetIds = [...new Set(Object.values(attachmentTurns[row.id] ?? {}).flat())];
    return {
      id: row.id, familyId: row.id, split: 'development', language: 'th', paraphrase: false, fixedRegression: false,
      group: assetIds.length ? 'receipt_document' : 'multi_turn', capabilities: [...sharedSubjects, ...extraSubjects[row.id]!].sort(),
      provenance: { kind: 'synthetic', sourceId: `nat-${row.id}`, consentRef: null, reviewedBy: null, reviewedAt: null },
      fixture: { ...structuredClone(baseFixture.fixture), clock: NATURAL_CLOCK, permissions: [...permissions],
        branches: [...privateBranches], sourceSnapshot: `nat-${row.id}`, taskRevision: null, previewRevision: null },
      assets: assetIds.map(id => { const asset = AUTHORED_ARTIFACT.assetManifest[id]!;
        return { id, sha256: asset.sha256, mimeType: asset.mimeType as ReliabilityFixture['assets'][number]['mimeType'],
          pages: asset.pages, labelDigest: asset.labelDigest, labelledBy: null };
      }),
      turns: row.turns.map(turn => ({ user: turn.user, attachmentIds: attachmentTurns[row.id]?.[turn.ordinal] ?? [],
        // Adapter transport scaffolding only. Exact-tool scores MUST NOT be reported as NAT quality.
        expect: { outcomes: ['answered', 'needs_input', 'preview', 'cancelled', 'access_denied', 'partial_answer'],
          toolInputs: [], requiredFacts: [], requiredEffects: [],
          forbiddenEffects: ['cross_scope_read', 'duplicate_delivery', 'unconfirmed_write', 'final_mutation'],
          requiredDelivery: 'ACCEPTED', maxModelCalls: 4, deadlineMs: assetIds.length ? 120_000 : 40_000 },
      })),
    };
  }),
};
validateReliabilityCorpus(NATURAL_CORPUS);
export const NATURAL_SOURCE_SNAPSHOT_MANIFEST: CorpusSourceSnapshotManifest = {
  version: 1, snapshots: Object.fromEntries(NATURAL_CORPUS.fixtures.map(fixture => [fixture.fixture.sourceSnapshot, {
    rows: structuredClone(rows), lineUserId: AUTHORED_SOURCE_SNAPSHOT_MANIFEST.snapshots[baseFixture.fixture.sourceSnapshot]!.lineUserId,
    assets: Object.fromEntries(fixture.assets.map(asset => [asset.id, { path: join(ASSET_DIR, AUTHORED_ARTIFACT.assetManifest[asset.id]!.fileName),
      sha256: asset.sha256, mimeType: asset.mimeType }])),
  }])), snapshotDigests: {},
};
NATURAL_SOURCE_SNAPSHOT_MANIFEST.snapshotDigests = Object.fromEntries(Object.entries(NATURAL_SOURCE_SNAPSHOT_MANIFEST.snapshots).map(([key, snapshot]) => [key, reliabilityDigest(snapshot)]));

/** Human-review facts from actual seeded rows, separate from prompts and tool implementation. */
export const NATURAL_REFERENCE_FACTS = {
  currency: 'THB', currentPeriod: '2026-09', previousPeriod: '2026-08', currentMonthIncomplete: true,
  authorizedBranchIds: privateBranches, excludedBranchId: 'branch-secret',
  expense: { basis: 'ExpenseRecord.grandTotalAmount; authorized branches; VOIDED excluded; DRAFT included unless confirmedOnly',
    augustAll: '23950.75', septemberAll: '27230.50', differenceAll: '3279.75',
    augustConfirmed: '23950.75', septemberConfirmed: '26330.50', differenceConfirmed: '2379.75',
    categories: { fuel: { august: '1800.00', september: '9200.00', difference: '7400.00' },
      travel: { august: '18450.75', september: '2230.50', difference: '-16220.25' },
      office: { august: '2200.00', september: '8500.00', difference: '6300.00', septemberConfirmed: '7600.00' },
      service: { august: '1500.00', september: '7300.00', difference: '5800.00' } },
    maximumCategoryIncrease: 'category-fuel', authorizedUtilityCount: 0,
  },
  moneyBases: { septemberIssuedInvoices: '118900.00', septemberRecordedCustomerReceipts: '374300.00',
    lastCompletedBankStatementBalance: '70210.35', lastCompletedBankStatementDate: '2026-09-20',
    draftBankStatementBalanceNotFinal: '99999.00', postedLedgerRevenue: '118900.00',
    profitCaveat: 'No complete posted costs. A ledger result is only the seeded ledger basis, not certified whole-business profit.' },
  somchaiRepairBillsLastWeek: [{ id: 'NAT-SOMCHAI-850', date: '2026-09-15', amount: '850.00' },
    { id: 'NAT-SOMCHAI-1750', date: '2026-09-18', amount: '1750.00' }],
  noCompletenessProof: 'No data establishes that all external files, banks, or business transactions have been imported.',
} as const;

export type NaturalManifestOptions = Omit<ReliabilityRuntimeManifest, 'version' | 'corpus' | 'snapshots' | 'snapshotDigests'> & { scenarioIds?: string[] };
export function buildNaturalConversationRuntimeManifest(options: NaturalManifestOptions): ReliabilityRuntimeManifest {
  const { scenarioIds, ...runtime } = options;
  const corpus = structuredClone(NATURAL_CORPUS);
  if (scenarioIds) {
    assert.ok(scenarioIds.length && new Set(scenarioIds).size === scenarioIds.length && scenarioIds.every(id => corpus.fixtures.some(row => row.id === id)), 'UNKNOWN_OR_DUPLICATE_NAT_SCENARIO');
    corpus.fixtures = corpus.fixtures.filter(row => scenarioIds.includes(row.id));
  }
  const keys = corpus.fixtures.map(row => row.fixture.sourceSnapshot);
  return { ...runtime, version: 2, corpus,
    snapshots: Object.fromEntries(keys.map(key => [key, structuredClone(NATURAL_SOURCE_SNAPSHOT_MANIFEST.snapshots[key]!)])),
    snapshotDigests: Object.fromEntries(keys.map(key => [key, NATURAL_SOURCE_SNAPSHOT_MANIFEST.snapshotDigests[key]!])),
    environment: { ...runtime.environment, LINE_AI_PUBLIC_LOOKUP_ENABLED: 'false' },
  };
}
export const NATURAL_ARTIFACT_DIGEST = reliabilityDigest({ corpus: NATURAL_CORPUS,
  sourceSnapshotManifest: NATURAL_SOURCE_SNAPSHOT_MANIFEST, policy: NATURAL_DIAGNOSTIC_POLICY,
  criteria: NATURAL_REVIEW_CRITERIA, referenceFacts: NATURAL_REFERENCE_FACTS });
