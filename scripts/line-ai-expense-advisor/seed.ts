/**
 * Starter-realistic (company A) / Pro-realistic (company B) seed builder for the expense-advisor
 * eval, per spec §10. Roles, permissions and feature entitlements are resolved from the SAME
 * production registries the real app uses (`ROLE_GRANTS`, `SYSTEM_ROLES`, `PERMISSIONS`,
 * `TIER_FEATURE_PRESETS`, `ALL_FEATURE_ENTITLEMENT_KEYS`) — never a hand-written permission union,
 * matching the pattern the prior agent's reference runner used for its Starter/OWNER fixture.
 *
 * Rows are plain `{model, data}` objects — the same shape `RuntimeSourceSnapshot.rows` uses in
 * scripts/line-ai-reliability-runtime.ts — so this one builder feeds BOTH the preflight seeder
 * (apply once, no reset) and the real-mode manifest (apply fresh per fixture/repeat).
 *
 * All dates are relative to `now` (Asia/Bangkok), never a fixed calendar month: an eval run must
 * produce the same shape of data regardless of which day it runs on.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// Relative source imports (see period.ts) — these scripts run with `tsx` before any workspace
// package is necessarily built.
import { PERMISSIONS, ROLE_GRANTS, SYSTEM_ROLES } from '../../apps/api/src/modules/auth/permission-registry';
import { TIER_FEATURE_PRESETS } from '../../packages/contracts/src/menu-entitlements';
import { ALL_FEATURE_ENTITLEMENT_KEYS } from '../../packages/contracts/src/feature-entitlements';
import { civilPeriodKey, todayCivilDate, DEFAULT_COMPANY_TIME_ZONE } from '../../packages/contracts/src/civil-date';
import { CURRENT_LEGAL_DOCUMENTS, LEGAL_ACCEPTANCE_STATEMENT_VERSION, legalAcceptanceStatements } from '../../packages/contracts/src/legal-acceptance';
import { claimSnapshotFields, computeSnapshotHash } from '../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic';
import { ROLES, type EvalRole, type EvalCompany } from './types';

export type SeedRow = { model: string; data: Record<string, unknown> };

export type CompanyUser = { userId: string; lineUserId: string; membershipId: string };

export type CompanySeed = {
  companyKey: EvalCompany;
  companyId: string;
  tierKey: 'STARTER_249' | 'PRO_999' | 'ENTERPRISE_1999';
  branchIds: string[];
  messagingChannelId: string;
  users: Record<EvalRole, CompanyUser>;
  /** Self-contained: shared permission/role rows + this company's own rows, in create order. */
  rows: SeedRow[];
  /** Ids of the seeded expense categories, in the fixed order categories were created. */
  categoryIds: string[];
};

const CATEGORIES = [
  { key: 'fuel', name: 'ค่าน้ำมัน' },
  { key: 'office', name: 'ค่าออฟฟิศ' },
  { key: 'travel', name: 'ค่าเดินทาง' },
  { key: 'service', name: 'ค่าบริการ' },
  { key: 'other', name: 'ค่าใช้จ่ายอื่นๆ' },
] as const;

// Two deliberately similar vendor names (spec §10) so name-matching/disambiguation is exercisable.
// `null` (the 7th slot below) stands for "no vendor recorded".
const VENDOR_NAMES: Array<string | null> = ['ร้านสมใจ', 'ร้านสมใจการค้า', 'ปั๊มน้ำมัน ปตท.', 'หจก. ออฟฟิศ ซัพพลาย', 'ร้านอาหารทะเลชายทะเล', 'Grab', null];

// Production auto-links a vendor counterparty on every receipt save, and the vendorName filter
// resolves ONLY linked counterparties. Every named vendor gets a seeded, linked
// `accountingCounterparty` EXCEPT this one, which stays snapshot-only so `get_breakdown`'s
// byVendor has an unlinked vendor to exercise (`linked: false`).
const UNLINKED_VENDOR_NAME = 'หจก. ออฟฟิศ ซัพพลาย';

const DOCUMENT_STATUS_CYCLE = ['CONFIRMED', 'NEEDS_REVIEW', 'DRAFT', 'REJECTED', 'VOIDED'] as const;
const PAYMENT_STATUS_CYCLE = ['PAID', 'PARTIALLY_PAID', 'UNPAID'] as const;

function slug(key: string): string {
  return key.replace(/[^a-zA-Z0-9]+/g, '_');
}

/** UTC mid-day on a Bangkok calendar day is always read back as that same civil day. */
function bangkokNoonUtc(year: number, month1to12: number, day: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day, 4, 0, 0));
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function round2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Union of every permission key the 5 eval roles are granted, resolved from ROLE_GRANTS. */
function grantedPermissionKeys(): string[] {
  const keys = new Set<string>();
  for (const role of ROLES) for (const key of ROLE_GRANTS[role] ?? []) keys.add(key);
  return [...keys];
}

/** Shared, company-independent rows: every Permission/Role/RolePermission the 5 roles need.
 * Built once and reused verbatim by each company's self-contained row list (real-mode fixtures
 * reset the whole database between conversations, so each one needs its own copy). */
function buildSharedAccessRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  const permissionByKey = new Map(PERMISSIONS.map((permission) => [permission.key, permission]));
  for (const key of grantedPermissionKeys()) {
    const def = permissionByKey.get(key);
    if (!def) throw new Error(`permission-registry drift: granted key "${key}" is not in PERMISSIONS`);
    rows.push({ model: 'permission', data: { id: `perm-${slug(key)}`, key: def.key, description: def.description, riskLevel: def.riskLevel } });
  }
  for (const role of ROLES) {
    const meta = SYSTEM_ROLES.find((candidate) => candidate.key === role);
    if (!meta) throw new Error(`permission-registry drift: SYSTEM_ROLES is missing role "${role}"`);
    rows.push({ model: 'role', data: { id: `role-${role}`, scopeKey: 'system', key: role, name: meta.name, description: meta.description, isSystem: true, status: 'ACTIVE' } });
    for (const key of ROLE_GRANTS[role] ?? []) {
      rows.push({ model: 'rolePermission', data: { roleId: `role-${role}`, permissionId: `perm-${slug(key)}` } });
    }
  }
  return rows;
}

const SHARED_ACCESS_ROWS = buildSharedAccessRows();

/** One user + LINE identity + membership + role grant for `role` inside `companyId`. Scoped to
 * EVERY branch of the company via explicit `SELECTED_BRANCHES` (rather than `ALL_BRANCHES`), so
 * `resolveAccess().scopes.branchIds` is always a concrete array — real-mode replay asserts it
 * deep-equals the fixture's declared `branches` list, which an unrestricted `undefined` cannot. */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A coherent terms+privacy acceptance pair for `userId`/`membershipId`, matching every field
 * `LegalAcceptanceService.isCoherentCurrentPair` cross-checks (same batchId/acceptedAt/locale/
 * capacity/displayChallenge across the pair; per-row statementSha256 = sha256(statementText);
 * documentVersion/artifactUrl taken straight from CURRENT_LEGAL_DOCUMENTS so the release-fingerprint
 * check matches). Without this, `LineWebhookController` gates every seeded user behind the
 * "accept terms" flex card and the AI Gateway never sees a request — see
 * scripts/line-ai-reliability-corpus.ts's own `w14-synthetic-legal-*` rows for the pattern this
 * mirrors. `acceptedAt` is yesterday relative to `now` so it is always in the past. */
function buildLegalAcceptanceRows(userId: string, companyId: string, membershipId: string, role: EvalRole, now: Date): SeedRow[] {
  const statements = legalAcceptanceStatements('th');
  const privacyStatement = `${statements.privacy}\n${statements.deletion}`;
  const acceptedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const common = {
    batchId: `legal-batch-${userId}`, statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
    acceptedByUserId: userId, companyId, membershipId, actorCapacity: 'INVITED_MEMBER' as const, rolesJson: [role],
    authProvider: 'line', sessionTokenId: null, requestId: `legal-request-${userId}`, locale: 'th',
    displayChallenge: `legal-challenge-${userId}`, surface: 'FIRST_ACCEPTANCE' as const, userAgent: 'eval-harness-seed', acceptedAt,
  };
  return [
    { model: 'legalDocumentActionRecord', data: {
      id: `legal-terms-${userId}`, scopeRef: `user:${userId}:eval-current-release`, ...common,
      documentType: 'TERMS_OF_USE', action: 'ACCEPTED', documentVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
      artifactUrl: CURRENT_LEGAL_DOCUMENTS.terms.href, releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
      statementText: statements.terms, statementSha256: sha256Hex(statements.terms),
    } },
    { model: 'legalDocumentActionRecord', data: {
      id: `legal-privacy-${userId}`, scopeRef: `user:${userId}:eval-current-release-privacy`, ...common,
      documentType: 'PRIVACY_NOTICE', action: 'ACKNOWLEDGED', documentVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
      artifactUrl: CURRENT_LEGAL_DOCUMENTS.privacy.href, releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
      statementText: privacyStatement, statementSha256: sha256Hex(privacyStatement),
    } },
  ];
}

function buildUserRows(companyKey: EvalCompany, companyId: string, role: EvalRole, branchIds: string[], messagingChannelId: string, now: Date): { rows: SeedRow[]; user: CompanyUser } {
  const userId = `user-${companyKey.toLowerCase()}-${role.toLowerCase()}`;
  // Synthetic but LINE-shaped (U + 32 hex): deterministic per (company, role), never a real id.
  const lineUserId = `U${createHash('sha1').update(`eval:${companyKey}:${role}`).digest('hex').slice(0, 32)}`;
  const membershipId = `membership-${companyKey.toLowerCase()}-${role.toLowerCase()}`;
  const displayNames: Record<EvalRole, string> = {
    OWNER: 'เจ้าของร้าน', MANAGER: 'ผู้จัดการ', STAFF: 'พนักงาน', ACCOUNTANT: 'นักบัญชี', AUDITOR_READONLY: 'ผู้ตรวจสอบ',
  };
  const rows: SeedRow[] = [
    { model: 'user', data: { id: userId, displayName: `${displayNames[role]} (${companyKey})`, status: 'ACTIVE' } },
    { model: 'externalIdentity', data: { id: `identity-${userId}`, userId, provider: 'LINE', providerUserId: lineUserId, providerChannelId: messagingChannelId, status: 'ACTIVE' } },
    { model: 'companyMembership', data: { id: membershipId, companyId, userId, status: 'ACTIVE', branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: branchIds[0] } },
    { model: 'membershipRole', data: { membershipId, roleId: `role-${role}` } },
    ...branchIds.map((branchId): SeedRow => ({ model: 'membershipBranchScope', data: { id: `scope-${membershipId}-${branchId}`, membershipId, branchId } })),
    ...buildLegalAcceptanceRows(userId, companyId, membershipId, role, now),
  ];
  return { rows, user: { userId, lineUserId, membershipId } };
}

/** One linked `accountingCounterparty` per named vendor except `UNLINKED_VENDOR_NAME` (bug 2:
 * production auto-links a vendor counterparty on every receipt save, so an expense whose vendor
 * name was never seen as a registry row is unrealistic). Owner-created, and `type: 'VENDOR'` to
 * match the production auto-link path (ensure-vendor-counterparty-from-expense.use-case.ts). */
function buildVendorCounterpartyRows(companyId: string, ownerUserId: string): { rows: SeedRow[]; counterpartyIdByVendorName: Map<string, string> } {
  const rows: SeedRow[] = [];
  const counterpartyIdByVendorName = new Map<string, string>();
  // Indexed by position, not `slug(name)`: these vendor names are Thai, and slug()'s
  // a-zA-Z0-9-only pattern collapses any all-Thai string to the same single "_" — every Thai
  // name would otherwise collide on one id.
  VENDOR_NAMES.forEach((name, index) => {
    if (!name || name === UNLINKED_VENDOR_NAME) return;
    const id = `counterparty-${companyId}-${index}`;
    rows.push({ model: 'accountingCounterparty', data: { id, companyId, type: 'VENDOR', displayName: name, createdByUserId: ownerUserId } });
    counterpartyIdByVendorName.set(name, id);
  });
  return { rows, counterpartyIdByVendorName };
}

/** Per-role status plan (bug 1). Explicit rather than cyclic: "OWNER and STAFF each need >=3
 * CONFIRMED and >=1 DRAFT per month" can't fall out of one modulo cycle without inflating the row
 * count far past a realistic ~30-40, so each role gets a fixed list that is reused IDENTICALLY for
 * both months (see the loop below) — every role therefore has the same guaranteed shape this month
 * and last month. The old bug was `createdBy` reusing the same index as the this-month/prev-month
 * split (`i % 4` vs `i % 2`): with 4 creators and a 2-way month split, STAFF/ACCOUNTANT (odd i)
 * landed only in one month and OWNER/MANAGER (even i) only in the other. */
const EXPENSE_STATUS_PLAN: Record<'OWNER' | 'STAFF' | 'MANAGER' | 'ACCOUNTANT', readonly (typeof DOCUMENT_STATUS_CYCLE)[number][]> = {
  OWNER: ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'DRAFT', 'NEEDS_REVIEW'],
  STAFF: ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'DRAFT', 'NEEDS_REVIEW'],
  MANAGER: ['REJECTED', 'VOIDED', 'CONFIRMED'],
  ACCOUNTANT: ['CONFIRMED', 'DRAFT', 'NEEDS_REVIEW'],
};
const EXPENSE_CREATOR_ORDER = ['OWNER', 'STAFF', 'MANAGER', 'ACCOUNTANT'] as const;

function buildExpenseRows(companyId: string, branchIds: string[], categoryIds: string[], users: Record<EvalRole, CompanyUser>, now: Date): SeedRow[] {
  const today = todayCivilDate(DEFAULT_COMPANY_TIME_ZONE, now);
  const [thisYear, thisMonth] = civilPeriodKey(today).split('-').map(Number) as [number, number];
  const todayDay = Number(today.slice(8, 10));
  const prevMonth = thisMonth === 1 ? 12 : thisMonth - 1;
  const prevYear = thisMonth === 1 ? thisYear - 1 : thisYear;
  const prevMonthLength = daysInMonth(prevYear, prevMonth);
  const { rows: counterpartyRows, counterpartyIdByVendorName } = buildVendorCounterpartyRows(companyId, users.OWNER!.userId);
  // Grouped by model, not interleaved: counterparty rows must exist before any expenseRecord that
  // links one, and expenseRecord rows must all exist before any expenseLine/expensePayment row
  // (immediate FK checks, and real-mode replays rows one at a time).
  const records: SeedRow[] = [];
  const lines: SeedRow[] = [];
  const payments: SeedRow[] = [];
  let globalIndex = 0;
  for (const inThisMonth of [true, false]) {
    const maxDay = inThisMonth ? Math.max(todayDay, 1) : prevMonthLength; // this month: never in the future
    // Resets every month so category/vendor/payment cycling — and therefore per-month coverage of
    // all 5 categories and all 7 vendor slots (16 rows/month is enough for both) — doesn't depend
    // on which month started first.
    let monthSlot = 0;
    for (const creator of EXPENSE_CREATOR_ORDER) {
      for (const status of EXPENSE_STATUS_PLAN[creator]) {
        const day = 1 + (monthSlot % maxDay);
        const expenseDate = inThisMonth ? bangkokNoonUtc(thisYear, thisMonth, day) : bangkokNoonUtc(prevYear, prevMonth, day);
        const category = CATEGORIES[monthSlot % CATEGORIES.length]!;
        const categoryId = categoryIds[monthSlot % categoryIds.length]!;
        const vendorNameSnapshot = VENDOR_NAMES[monthSlot % VENDOR_NAMES.length] ?? null;
        const vendorCounterpartyId = vendorNameSnapshot ? counterpartyIdByVendorName.get(vendorNameSnapshot) ?? null : null;
        // A rejected/voided/unconfirmed document is never paid in practice.
        const paymentStatus = status === 'CONFIRMED' ? PAYMENT_STATUS_CYCLE[monthSlot % PAYMENT_STATUS_CYCLE.length]! : 'UNPAID';
        const branchId = branchIds[globalIndex % branchIds.length]!;
        const createdBy = users[creator]!.userId;
        const grandTotal = 300 + ((globalIndex * 137) % 4000) + (globalIndex % 4 === 0 ? 0.5 : 0);
        const paidAmount = paymentStatus === 'PAID' ? grandTotal : paymentStatus === 'PARTIALLY_PAID' ? grandTotal / 2 : 0;
        const outstandingAmount = grandTotal - paidAmount;
        const expenseId = `expense-${companyId}-${globalIndex}`;
        records.push({
          model: 'expenseRecord',
          data: {
            id: expenseId, companyId, branchId, status, paymentStatus,
            vendorNameSnapshot, vendorCounterpartyId, expenseDate,
            subtotalAmount: round2(grandTotal), taxableAmount: round2(grandTotal), grandTotalAmount: round2(grandTotal), netPayableAmount: round2(grandTotal),
            paidAmount: round2(paidAmount), outstandingAmount: round2(outstandingAmount),
            expenseCategoryId: categoryId, createdByUserId: createdBy,
          },
        });
        lines.push({
          model: 'expenseLine',
          data: { id: `${expenseId}-line1`, companyId, expenseId, lineNumber: 1, description: category.name, quantity: '1', unitPrice: round2(grandTotal), lineSubtotalAmount: round2(grandTotal), lineTotalAmount: round2(grandTotal), expenseCategoryId: categoryId },
        });
        if (paidAmount > 0) {
          payments.push({
            model: 'expensePayment',
            data: { id: `${expenseId}-payment1`, companyId, expenseId, amount: round2(paidAmount), paidAt: expenseDate, createdByUserId: createdBy },
          });
        }
        globalIndex++;
        monthSlot++;
      }
    }
  }
  return [...counterpartyRows, ...records, ...lines, ...payments];
}

function buildReimbursementRows(companyId: string, branchIds: string[], users: Record<EvalRole, CompanyUser>, now: Date, count: number): SeedRow[] {
  const today = todayCivilDate(DEFAULT_COMPANY_TIME_ZONE, now);
  const [thisYear, thisMonth] = civilPeriodKey(today).split('-').map(Number) as [number, number];
  const todayDay = Number(today.slice(8, 10));
  // A requester roster weighted toward STAFF, the typical claimant; MANAGER/ACCOUNTANT can also
  // file their own claims for a different approver to see.
  const requesters: EvalRole[] = ['STAFF', 'STAFF', 'ACCOUNTANT', 'STAFF', 'MANAGER', 'STAFF'];
  const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'PENDING_APPROVAL'] as const;
  // Grouped by model: a request must exist before its own approval-step/payment row does
  // (immediate FK checks, and real-mode replays rows one at a time in array order). No line row
  // here on purpose: migration 20260804150000's `ReimbursementRequest_fallback_line` trigger
  // already inserts one (id `rbl_<requestId>`, lineNo 1) straight from the header's own
  // reason/categoryKey/amount/incurredDate the instant a request is inserted — a manual row here
  // would collide with it on the (reimbursementRequestId, lineNo) unique index.
  const requests: SeedRow[] = [];
  const approvalSteps: SeedRow[] = [];
  const payments: SeedRow[] = [];
  for (let i = 0; i < count; i++) {
    const requesterRole = requesters[i % requesters.length]!;
    const requester = users[requesterRole]!;
    const status = statuses[i % statuses.length]!;
    const category = CATEGORIES[i % CATEGORIES.length]!;
    const day = 1 + (i % Math.max(todayDay, 1));
    const incurredDate = bangkokNoonUtc(thisYear, thisMonth, day);
    const amount = round2(400 + ((i * 211) % 3000));
    const requestId = `reimbursement-${companyId}-${i}`;
    const branchId = branchIds[i % branchIds.length]!;
    const data: Record<string, unknown> = {
      id: requestId, companyId, branchId, requesterUserId: requester.userId,
      requesterDisplayNameSnapshot: `ผู้เบิก ${requesterRole}`, reason: `${category.name} รอบ ${i + 1}`,
      categoryKey: category.key, categoryLabelSnapshot: category.name, amount, incurredDate,
      status, createdByUserId: requester.userId,
    };
    if (status !== 'DRAFT') {
      data['submittedAt'] = incurredDate; data['submittedByUserId'] = requester.userId;
      // Match the fallback line inserted by the production trigger, including its approval hash.
      data['approvalSnapshotHash'] = computeSnapshotHash(claimSnapshotFields({ amount, currency: 'THB',
        categoryKey: category.key, incurredDate, reason: String(data['reason']),
        lines: [{ lineNo: 1, incurredDate, description: String(data['reason']), categoryKey: category.key, amount }] }));
    }
    if (status === 'PENDING_APPROVAL') {
      const stepId = `${requestId}-step1`;
      data['currentApprovalStepId'] = stepId;
      approvalSteps.push({ model: 'reimbursementApprovalStep', data: {
        id: stepId, companyId, reimbursementRequestId: requestId, sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER', status: 'PENDING', requestSnapshotHash: data['approvalSnapshotHash'],
      } });
    }
    if (status === 'APPROVED' || status === 'PAID') {
      data['approvedAt'] = incurredDate;
      approvalSteps.push({ model: 'reimbursementApprovalStep', data: {
        id: `${requestId}-step1`, companyId, reimbursementRequestId: requestId, sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER', status: 'APPROVED', decidedAt: incurredDate,
        decisionByUserId: users.MANAGER!.userId, requestSnapshotHash: data['approvalSnapshotHash'],
      } });
    }
    if (status === 'REJECTED') {
      data['rejectedAt'] = incurredDate; data['rejectionReason'] = 'ไม่มีหลักฐานแนบ';
      approvalSteps.push({ model: 'reimbursementApprovalStep', data: {
        id: `${requestId}-step1`, companyId, reimbursementRequestId: requestId, sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER', status: 'REJECTED', decidedAt: incurredDate,
        decisionByUserId: users.MANAGER!.userId, rejectionReason: 'ไม่มีหลักฐานแนบ', requestSnapshotHash: data['approvalSnapshotHash'],
      } });
    }
    if (status === 'PAID') {
      data['paymentStatus'] = 'PAID'; data['paymentTotalAmount'] = amount; data['outstandingAmount'] = '0.00';
      payments.push({ model: 'reimbursementPayment', data: {
        id: `${requestId}-payment1`, companyId, reimbursementRequestId: requestId, idempotencyKey: `seed-${requestId}-pay`,
        paidAmount: amount, paymentMethod: 'BANK_TRANSFER', paidAt: incurredDate,
        sourcePaymentRef: `seed-${requestId}-ref`, paidByUserId: users.MANAGER!.userId,
      } });
    } else if (status !== 'DRAFT') {
      data['outstandingAmount'] = amount;
    }
    requests.push({ model: 'reimbursementRequest', data });
  }
  return [...requests, ...approvalSteps, ...payments];
}

const COMPANY_DEFS: Record<EvalCompany, { tierKey: 'STARTER_249' | 'PRO_999' | 'ENTERPRISE_1999'; branchCount: number; name: string }> = {
  A: { tierKey: 'STARTER_249', branchCount: 1, name: 'ร้านตัวอย่าง A (Starter)' },
  B: { tierKey: 'PRO_999', branchCount: 2, name: 'ร้านตัวอย่าง B (Pro)' },
  C: { tierKey: 'ENTERPRISE_1999', branchCount: 3, name: 'ร้านตัวอย่าง C (Enterprise)' },
};

/** Builds one company's full, self-contained row list: shared access rows + this company's own
 * company/branch/entitlement/plan-term/user/expense/reimbursement rows. `now` drives every
 * relative date — pass a fixed value in tests, omit it to seed against the real clock. */
export function buildCompanySeed(companyKey: EvalCompany, now = new Date()): CompanySeed {
  const def = COMPANY_DEFS[companyKey];
  const companyId = `company-${companyKey.toLowerCase()}`;
  const messagingChannelId = `channel-${companyKey.toLowerCase()}`;
  const branchIds = Array.from({ length: def.branchCount }, (_, index) => `branch-${companyKey.toLowerCase()}-${index + 1}`);
  const tierFeatures = new Set(TIER_FEATURE_PRESETS[def.tierKey]);

  const rows: SeedRow[] = [...SHARED_ACCESS_ROWS];
  rows.push({ model: 'company', data: { id: companyId, name: def.name, status: 'ACTIVE' } });
  branchIds.forEach((branchId, index) => rows.push({
    model: 'branch',
    data: { id: branchId, companyId, code: `BR${index + 1}`, name: index === 0 ? 'สำนักงานใหญ่' : `สาขา ${index + 1}`, type: index === 0 ? 'HEAD_OFFICE' : 'BRANCH', status: 'ACTIVE' },
  }));
  rows.push({ model: 'companyPlanTerm', data: {
    id: `plan-${companyKey.toLowerCase()}`, companyId, tierKey: def.tierKey,
    branchLimit: Math.max(def.branchCount, 1), employeeLimit: 20, monthlySlipLimit: 500,
    termStartAt: new Date('2026-01-01T00:00:00.000Z'), termEndsAt: new Date('2099-01-01T00:00:00.000Z'),
  } });
  for (const featureKey of ALL_FEATURE_ENTITLEMENT_KEYS) {
    rows.push({ model: 'companyFeatureEntitlement', data: {
      id: `entitlement-${companyKey.toLowerCase()}-${slug(featureKey)}`, companyId, featureKey, enabled: tierFeatures.has(featureKey),
    } });
  }

  const categoryIds = CATEGORIES.map((category) => `category-${companyKey.toLowerCase()}-${category.key}`);
  CATEGORIES.forEach((category, index) => rows.push({
    model: 'expenseCategory',
    data: { id: categoryIds[index], companyId, name: category.name, accountHintKey: category.key, status: 'ACTIVE' },
  }));

  const users = {} as Record<EvalRole, CompanyUser>;
  for (const role of ROLES) {
    const built = buildUserRows(companyKey, companyId, role, branchIds, messagingChannelId, now);
    rows.push(...built.rows);
    users[role] = built.user;
  }

  rows.push(...buildExpenseRows(companyId, branchIds, categoryIds, users, now));
  rows.push(...buildReimbursementRows(companyId, branchIds, users, now, 6));

  return { companyKey, companyId, tierKey: def.tierKey, branchIds, messagingChannelId, users, rows, categoryIds };
}

/** Fast path for preflight: group consecutive-by-model rows into `createMany` calls. Real-mode
 * fixtures use the flat `rows` array directly (runLineReliabilityRuntime applies it one row at a
 * time so a mid-seed failure is attributable) — this batched form is preflight-only. */
export async function applySeedRows(client: Record<string, { createMany(args: { data: Record<string, unknown>[] }): Promise<unknown> }>, rows: SeedRow[]): Promise<void> {
  let index = 0;
  while (index < rows.length) {
    const model = rows[index]!.model;
    const batch: Record<string, unknown>[] = [];
    while (index < rows.length && rows[index]!.model === model) { batch.push(rows[index]!.data); index++; }
    await client[model]!.createMany({ data: batch });
  }
}

/** The company-independent Permission/Role/RolePermission rows every `CompanySeed.rows` starts
 * with. Preflight seeds this ONCE (a shared, un-truncated database); real-mode fixtures keep it
 * inline in each company's own `rows` because each fixture gets a full truncate + reseed. */
export { SHARED_ACCESS_ROWS };
export { CATEGORIES, VENDOR_NAMES };

export type PgClientLike = { query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> };

/** Clears every table so a fresh `applySeedRows` pass starts from nothing — makes re-running the
 * same script against the same database idempotent. Shared by run-preflight.ts (before its one
 * seed) and run-real.ts's own oracle pass (before it re-seeds to resolve gold calls, ahead of
 * `runLineReliabilityRuntime`'s SEPARATE per-fixture reset). Mirrors the truncate step of
 * `resetRuntimeFixtureDatabase` in scripts/line-ai-reliability-runtime.ts, inlined rather than
 * imported so this stays free of that file's whole Nest/webhook replay machinery. */
export async function truncateAllTables(client: PgClientLike): Promise<void> {
  await client.query('BEGIN');
  try {
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'")).rows.map((row) => row['tablename'] as string);
    assert.ok(tables.length > 0, 'no tables found after migrate — refusing to seed an unmigrated database');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`TRUNCATE TABLE ${tables.map((name) => `"public"."${name}"`).join(',')} CASCADE`);
    await client.query('SET LOCAL session_replication_role = origin');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
