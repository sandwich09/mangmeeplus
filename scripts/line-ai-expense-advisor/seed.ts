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
import { createHash } from 'node:crypto';
// Relative source imports (see period.ts) — these scripts run with `tsx` before any workspace
// package is necessarily built.
import { PERMISSIONS, ROLE_GRANTS, SYSTEM_ROLES } from '../../apps/api/src/modules/auth/permission-registry';
import { TIER_FEATURE_PRESETS } from '../../packages/contracts/src/menu-entitlements';
import { ALL_FEATURE_ENTITLEMENT_KEYS } from '../../packages/contracts/src/feature-entitlements';
import { civilPeriodKey, todayCivilDate, DEFAULT_COMPANY_TIME_ZONE } from '../../packages/contracts/src/civil-date';
import { ROLES, type EvalRole, type EvalCompany } from './types';

export type SeedRow = { model: string; data: Record<string, unknown> };

export type CompanyUser = { userId: string; lineUserId: string; membershipId: string };

export type CompanySeed = {
  companyKey: EvalCompany;
  companyId: string;
  tierKey: 'STARTER_249' | 'PRO_999';
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
function buildUserRows(companyKey: EvalCompany, companyId: string, role: EvalRole, branchIds: string[], messagingChannelId: string): { rows: SeedRow[]; user: CompanyUser } {
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
  ];
  return { rows, user: { userId, lineUserId, membershipId } };
}

function buildExpenseRows(companyId: string, branchIds: string[], categoryIds: string[], users: Record<EvalRole, CompanyUser>, now: Date, count: number): SeedRow[] {
  const today = todayCivilDate(DEFAULT_COMPANY_TIME_ZONE, now);
  const [thisYear, thisMonth] = civilPeriodKey(today).split('-').map(Number) as [number, number];
  const todayDay = Number(today.slice(8, 10));
  const prevMonth = thisMonth === 1 ? 12 : thisMonth - 1;
  const prevYear = thisMonth === 1 ? thisYear - 1 : thisYear;
  const prevMonthLength = daysInMonth(prevYear, prevMonth);
  const creators: EvalRole[] = ['OWNER', 'STAFF', 'MANAGER', 'ACCOUNTANT'];
  // Grouped by model, not interleaved: expenseRecord rows must all exist before any expenseLine/
  // expensePayment row is inserted (immediate FK checks, and real-mode replays rows one at a time).
  const records: SeedRow[] = [];
  const lines: SeedRow[] = [];
  const payments: SeedRow[] = [];
  for (let i = 0; i < count; i++) {
    const inThisMonth = i % 2 === 0;
    const bucketIndex = Math.floor(i / 2);
    const day = inThisMonth
      ? 1 + (bucketIndex % Math.max(todayDay, 1)) // never in the future
      : 1 + (bucketIndex % prevMonthLength);
    const expenseDate = inThisMonth ? bangkokNoonUtc(thisYear, thisMonth, day) : bangkokNoonUtc(prevYear, prevMonth, day);
    const category = CATEGORIES[i % CATEGORIES.length]!;
    const categoryId = categoryIds[i % categoryIds.length]!;
    const vendorNameSnapshot = VENDOR_NAMES[i % VENDOR_NAMES.length] ?? null;
    const status = DOCUMENT_STATUS_CYCLE[i % DOCUMENT_STATUS_CYCLE.length]!;
    // A rejected/voided/unconfirmed document is never paid in practice.
    const paymentStatus = status === 'CONFIRMED' ? PAYMENT_STATUS_CYCLE[i % PAYMENT_STATUS_CYCLE.length]! : 'UNPAID';
    const branchId = branchIds[i % branchIds.length]!;
    const createdBy = users[creators[i % creators.length]!]!.userId;
    const grandTotal = 300 + ((i * 137) % 4000) + (i % 4 === 0 ? 0.5 : 0);
    const paidAmount = paymentStatus === 'PAID' ? grandTotal : paymentStatus === 'PARTIALLY_PAID' ? grandTotal / 2 : 0;
    const outstandingAmount = grandTotal - paidAmount;
    const expenseId = `expense-${companyId}-${i}`;
    records.push({
      model: 'expenseRecord',
      data: {
        id: expenseId, companyId, branchId, status, paymentStatus,
        vendorNameSnapshot, expenseDate,
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
  }
  return [...records, ...lines, ...payments];
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
    if (status !== 'DRAFT') { data['submittedAt'] = incurredDate; data['submittedByUserId'] = requester.userId; }
    if (status === 'PENDING_APPROVAL') {
      const stepId = `${requestId}-step1`;
      data['currentApprovalStepId'] = stepId;
      approvalSteps.push({ model: 'reimbursementApprovalStep', data: {
        id: stepId, companyId, reimbursementRequestId: requestId, sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER', status: 'PENDING', requestSnapshotHash: `seed-${requestId}`,
      } });
    }
    if (status === 'APPROVED' || status === 'PAID') {
      data['approvedAt'] = incurredDate;
      approvalSteps.push({ model: 'reimbursementApprovalStep', data: {
        id: `${requestId}-step1`, companyId, reimbursementRequestId: requestId, sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER', status: 'APPROVED', decidedAt: incurredDate,
        decisionByUserId: users.MANAGER!.userId, requestSnapshotHash: `seed-${requestId}`,
      } });
    }
    if (status === 'REJECTED') {
      data['rejectedAt'] = incurredDate; data['rejectionReason'] = 'ไม่มีหลักฐานแนบ';
      approvalSteps.push({ model: 'reimbursementApprovalStep', data: {
        id: `${requestId}-step1`, companyId, reimbursementRequestId: requestId, sequenceNo: 1,
        approverRoleSnapshot: 'MANAGER', status: 'REJECTED', decidedAt: incurredDate,
        decisionByUserId: users.MANAGER!.userId, rejectionReason: 'ไม่มีหลักฐานแนบ', requestSnapshotHash: `seed-${requestId}`,
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

const COMPANY_DEFS: Record<EvalCompany, { tierKey: 'STARTER_249' | 'PRO_999'; branchCount: number; name: string }> = {
  A: { tierKey: 'STARTER_249', branchCount: 1, name: 'ร้านตัวอย่าง A (Starter)' },
  B: { tierKey: 'PRO_999', branchCount: 2, name: 'ร้านตัวอย่าง B (Pro)' },
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
    const built = buildUserRows(companyKey, companyId, role, branchIds, messagingChannelId);
    rows.push(...built.rows);
    users[role] = built.user;
  }

  rows.push(...buildExpenseRows(companyId, branchIds, categoryIds, users, now, 36));
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
