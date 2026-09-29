/**
 * Add-on plan PR B, B4–B5 (spec §16, §18.2, C03, C04, F-21): the shared add-on grant seam and the reviewed
 * team grant/revoke that writes through it. In-memory tables; the real PostgreSQL proof of the ledger and
 * the seam's locks is `receipt-addon-ledger.pg.spec.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { appendPackageInterval } from '../domain/billing-package';
import { BillingAddOnAdminGrantsService } from './billing-addon-admin-grants.service';
import { applyAddOnGrant } from './billing-addon-grants';

const ALL = ['system.billing.read', 'system.billing.financial.read', 'system.billing.override.manage', 'system.billing.approval.approve'];
const hash = 'a'.repeat(64);
const ctx = { userId: 'admin-1', membershipId: 'm-1', companyId: 'platform', requestId: 'req-1', permissions: ALL } as never;

function world(opts: { caps?: string[]; receiptAccountId?: string | null; status?: string; activeAttemptId?: string | null } = {}) {
  const companyId = 'co-1', accountId = 'acct-1';
  const ops: any[] = [], grants: any[] = [], entries: any[] = [], audits: any[] = [], termWrites: unknown[] = [];
  const is = (value: unknown, rule: any) => rule === undefined || (rule && typeof rule === 'object' && !(rule instanceof Date)
    ? ('in' in rule ? rule.in.includes(value) : 'lte' in rule ? (value as Date) <= rule.lte : 'gt' in rule ? (value as Date) > rule.gt : false)
    : value === rule);
  const match = (row: any, where: any): boolean => Object.entries(where).every(([key, rule]) =>
    key === 'OR' ? (rule as any[]).some((part) => match(row, part)) : is(row[key], rule));
  const receiptAccountId = opts.receiptAccountId === undefined ? accountId : opts.receiptAccountId;
  const tx: any = {
    $executeRaw: async () => 0, $queryRaw: async () => [],
    billingOperation: {
      create: async ({ data }: any) => { const row = { ...data, state: 'PREVIEW', version: 0, approverUserId: null, idempotencyKey: null, errorCode: null,
        resultJson: null, observedAt: null, createdAt: new Date() }; ops.push(row); return row; },
      findFirst: async ({ where }: any) => ops.find((row) => row.id === where.id && where.type.in.includes(row.type)) ?? null,
      findUnique: async ({ where }: any) => ops.find((row) => row.idempotencyKey === where.stripeAccountId_livemode_idempotencyKey.idempotencyKey) ?? null,
      findMany: async () => [...ops].reverse(),
      update: async ({ where, data }: any) => { const row = ops.find((item) => item.id === where.id); Object.assign(row, { ...data, version: row.version + 1 }); return row; },
    },
    billingAccount: { findUnique: async ({ where }: any) => (where.id === accountId ? { companyId } : null) },
    companyPlanTerm: { findUnique: async () => ({ billingReceiptAccountId: receiptAccountId }),
      update: async (args: unknown) => { termWrites.push(args); }, updateMany: async (args: unknown) => { termWrites.push(args); return { count: 1 }; } },
    billingReceiptGrant: {
      findUnique: async ({ where }: any) => grants.find((g) => g.billingAccountId === where.billingAccountId_sourceKey.billingAccountId
        && g.sourceKey === where.billingAccountId_sourceKey.sourceKey) ?? null,
      findFirst: async ({ where }: any) => grants.find((g) => match(g, where)) ?? null,
      findMany: async ({ where }: any) => grants.filter((g) => match(g, where)).map((g) => ({ ...g, _count: { admissions: 0 } })),
      create: async ({ data }: any) => { const g = { id: randomUUID(), createdAt: new Date(), revokedAt: null, ...data }; grants.push(g); return g; },
      update: async ({ where, data }: any) => Object.assign(grants.find((g) => g.id === where.id), data),
    },
    receiptUnitEntry: {
      groupBy: async ({ where }: any) => [...new Set(entries.filter((e) => where.grantId.in.includes(e.grantId)).map((e) => `${e.grantId}|${e.kind}`))]
        .map((key) => { const [grantId, kind] = key.split('|'); return { grantId, kind, _sum: { units: entries
          .filter((e) => e.grantId === grantId && e.kind === kind).reduce((total, e) => total + e.units, 0) } }; }),
      create: async ({ data }: any) => { entries.push(data); return data; },
    },
    userCredential: { findUniqueOrThrow: async () => ({ updatedAt: new Date(0) }),
      findUnique: async () => ({ status: 'ACTIVE', mustChangePassword: false, expiresAt: null, updatedAt: new Date(0) }) },
    user: { findMany: async () => [] },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
  };
  const caps = opts.caps ?? ALL;
  const company = { id: companyId, name: 'ร้านทดสอบ', status: opts.status ?? 'ACTIVE', planTerm: { billingReceiptAccountId: receiptAccountId, termDisabledAt: null } };
  const account = { id: accountId, stripeAccountId: 'acct_stripe', livemode: false, version: 3, activeAttemptId: opts.activeAttemptId ?? null, activeCollectionOperationId: null };
  const admin = { scopedCompany: async () => ({ access: { capabilities: caps, platformScope: true }, company, account }),
    access: async (_context: unknown, permission: string) => { if (!caps.includes(permission)) throw new ForbiddenException(); } };
  const configuration = { requireProof: async () => undefined, requireApprovalActor: async () => undefined, operationActor: async () => undefined };
  const prisma = { client: { ...tx, $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  const service = new BillingAddOnAdminGrantsService(prisma as never, { stripe: { accountId: 'acct_stripe', livemode: false } } as never, admin as never, configuration as never);
  return { service, tx, ops, grants, entries, audits, termWrites, companyId, accountId, account };
}
const approve = async (w: ReturnType<typeof world>, id: string) => {
  const submitted = await w.service.command(ctx, id, 'submit', 0, w.ops.find((row) => row.id === id).requestHash, `key-${randomUUID()}`);
  return w.service.command(ctx, id, 'approve', submitted.version, submitted.previewHash);
};

describe('add-on grant seam and team grant (add-on plan PR B)', () => {
  it('adds a team lot through the seam for 12 months from approval — no expiry is typed (C03, D8)', async () => {
    const w = world();
    const credits = await w.service.list(ctx, w.companyId);
    assert.equal(credits.canCreate, true);
    await assert.rejects(w.service.preview(ctx, w.companyId, { type: 'ADDON_ADMIN_GRANT', productKind: 'RECEIPT_IMAGE', units: 20,
      expiresAt: '2030-01-01T00:00:00.000Z', sourceHash: credits.sourceHash, reason: 'ชดเชย' } as never), /Invalid billing fields/);
    const before = Date.now();
    const preview = await w.service.preview(ctx, w.companyId, { type: 'ADDON_ADMIN_GRANT', productKind: 'RECEIPT_IMAGE', units: 20,
      sourceHash: credits.sourceHash, reason: 'ชดเชยรูปที่อ่านไม่สำเร็จ' });
    assert.equal(preview.state, 'PREVIEW');
    assert.ok(Math.abs(Date.parse(preview.grantExpiresAt) - appendPackageInterval(new Date(before), 'year').getTime()) < 60_000, 'shown read-only: 12 months');
    const done = await approve(w, preview.id);
    assert.equal(done.state, 'SUCCEEDED');
    assert.equal(w.grants.length, 1);
    const [lot] = w.grants;
    assert.deepEqual([lot.kind, lot.units, lot.sourceKey, lot.billingAccountId], ['ADD_ON_ADMIN', 20, `addon-admin:${preview.id}`, w.accountId]);
    assert.equal(lot.expiresAt.toISOString(), appendPackageInterval(lot.availableAt, 'year').toISOString());
    assert.equal(done.grantExpiresAt, lot.expiresAt.toISOString(), 'after approval the real expiry is shown');
    assert.equal(done.lot?.remaining, 20);
    assert.deepEqual(w.termWrites, [], 'adding units never writes CompanyPlanTerm (F-19)');
    assert.deepEqual(w.audits.map((row) => row.action), ['billing.addon_grant.submit', 'billing.addon_grant.approve']);
    assert.equal(w.audits[1].metadataJson.afterAdditional, 20);
    // An approval replayed by the same approver returns the first result and adds nothing.
    await w.service.command(ctx, preview.id, 'approve', done.version - 1, done.previewHash);
    assert.equal(w.grants.length, 1);
  });

  it('does not let an open package checkout or collection block adding units (C04)', async () => {
    const open = world({ activeAttemptId: 'attempt-open' }), idle = world();
    const [a, b] = await Promise.all([open.service.list(ctx, open.companyId), idle.service.list(ctx, idle.companyId)]);
    assert.equal(a.sourceHash, b.sourceHash, 'the source never includes the checkout slot');
    const preview = await open.service.preview(ctx, open.companyId, { type: 'ADDON_ADMIN_GRANT', productKind: 'RECEIPT_IMAGE', units: 1, sourceHash: a.sourceHash, reason: 'แถม' });
    assert.equal((await approve(open, preview.id)).state, 'SUCCEEDED');
  });

  it('refuses a shop whose receipts are not lots yet, and AI credit until its ledger exists', async () => {
    const legacy = world({ receiptAccountId: null });
    const credits = await legacy.service.list(ctx, legacy.companyId);
    assert.deepEqual([credits.blockedReason, credits.canCreate, credits.images.packageRemaining], ['CONTROL_ADDON_NOT_READY', false, null]);
    const refused = (w: ReturnType<typeof world>, productKind: 'RECEIPT_IMAGE' | 'CHAT_CREDIT', sourceHash: string) => assert.rejects(
      w.service.preview(ctx, w.companyId, { type: 'ADDON_ADMIN_GRANT', productKind, units: 1, sourceHash, reason: 'แถม' }),
      (error: unknown) => error instanceof ConflictException && (error.getResponse() as { code: string }).code === 'CONTROL_ADDON_NOT_READY');
    await refused(legacy, 'RECEIPT_IMAGE', credits.sourceHash);
    const paid = world();
    await refused(paid, 'CHAT_CREDIT', (await paid.service.list(ctx, paid.companyId)).sourceHash);
    const held = world({ status: 'DISABLED' });
    assert.equal((await held.service.list(ctx, held.companyId)).blockedReason, 'CONTROL_COMPANY_HELD');
  });

  it('takes back only the unused units of a team lot; a running read keeps its unit, a paid lot is not the team\'s', async () => {
    const w = world();
    const at = new Date(Date.now() - 1000), sourceHash = (await w.service.list(ctx, w.companyId)).sourceHash;
    const team = await applyAddOnGrant(w.tx, { companyId: w.companyId, billingAccountId: w.accountId, productKind: 'RECEIPT_IMAGE',
      sourceKind: 'SALES_EVENT', sourceKey: 'sales-event:ticket-1:RECEIPT_IMAGE', sourceHash: hash, units: 5, at });
    const paid = await applyAddOnGrant(w.tx, { companyId: w.companyId, billingAccountId: w.accountId, productKind: 'RECEIPT_IMAGE',
      sourceKind: 'ADD_ON_PAID', sourceKey: 'addon:in_1', sourceHash: hash, units: 20, at });
    // One read used a unit, one is still running.
    w.entries.push({ grantId: team.lotId, kind: 'RESERVE', units: 1 }, { grantId: team.lotId, kind: 'RESERVE', units: 1 }, { grantId: team.lotId, kind: 'CONSUME', units: 1 });
    await assert.rejects(w.service.preview(ctx, w.companyId, { type: 'ADDON_ADMIN_REVOKE', productKind: 'RECEIPT_IMAGE', grantId: paid.lotId, sourceHash, reason: 'ผิดร้าน' }), /Not Found/);
    const preview = await w.service.preview(ctx, w.companyId, { type: 'ADDON_ADMIN_REVOKE', productKind: 'RECEIPT_IMAGE', grantId: team.lotId, sourceHash, reason: 'ผิดร้าน' });
    assert.equal(preview.units, 3);
    const done = await approve(w, preview.id);
    assert.equal(done.units, 3);
    assert.deepEqual(w.entries.at(-1), { companyId: w.companyId, grantId: team.lotId, operationKey: `addon-revoke:${preview.id}`, generation: 1, kind: 'REVOKE', units: 3 });
    assert.ok(w.grants.find((g) => g.id === team.lotId).revokedAt);
    assert.equal(w.grants.find((g) => g.id === paid.lotId).revokedAt, null);
    assert.equal(done.lot?.state, 'REVOKED');
  });

  it('keeps the receipt adjustment permission set (F-21)', async () => {
    const reader = world({ caps: ['system.billing.read', 'system.billing.financial.read'] });
    const sourceHash = (await reader.service.list(ctx, reader.companyId)).sourceHash;
    await assert.rejects(reader.service.preview(ctx, reader.companyId, { type: 'ADDON_ADMIN_GRANT', productKind: 'RECEIPT_IMAGE', units: 1, sourceHash, reason: 'แถม' }), ForbiddenException);
    const maker = world({ caps: ['system.billing.read', 'system.billing.financial.read', 'system.billing.override.manage'] });
    const preview = await maker.service.preview(ctx, maker.companyId, { type: 'ADDON_ADMIN_GRANT', productKind: 'RECEIPT_IMAGE', units: 1,
      sourceHash: (await maker.service.list(ctx, maker.companyId)).sourceHash, reason: 'แถม' });
    await assert.rejects(approve(maker, preview.id), ForbiddenException);
    assert.equal(maker.grants.length, 0);
  });

  it('the seam is idempotent per source, pins the expiry and checks account and consumer', async () => {
    const w = world(), leap = new Date('2028-02-29T05:00:00.000Z');
    const input = { companyId: w.companyId, billingAccountId: w.accountId, productKind: 'RECEIPT_IMAGE' as const, sourceKind: 'ADD_ON_PAID' as const,
      sourceKey: 'addon:in_leap', sourceHash: hash, units: 50, at: leap };
    const first = await applyAddOnGrant(w.tx, input), again = await applyAddOnGrant(w.tx, { ...input, at: new Date() });
    assert.deepEqual([first.replayed, again.replayed, again.lotId], [false, true, first.lotId]);
    assert.equal(again.expiresAt.toISOString(), '2029-02-28T05:00:00.000Z', 'a retry keeps the first dates; 29 Feb clamps like billing');
    await assert.rejects(applyAddOnGrant(w.tx, { ...input, units: 51 }), /addon_source_changed/);
    await assert.rejects(applyAddOnGrant(w.tx, { ...input, sourceKey: 'x', billingAccountId: 'acct-other' }), /addon_account_mismatch/);
    await assert.rejects(applyAddOnGrant(w.tx, { ...input, sourceKey: 'y', units: 0 }), /addon_grant_invalid/);
    await assert.rejects(applyAddOnGrant(w.tx, { ...input, sourceKey: 'z', productKind: 'CHAT_CREDIT' }), /addon_consumer_not_ready/);
    const legacy = world({ receiptAccountId: null });
    await assert.rejects(applyAddOnGrant(legacy.tx, { ...input, companyId: legacy.companyId, billingAccountId: legacy.accountId }), /addon_consumer_not_ready/);
    assert.equal(w.grants.length, 1);
    assert.deepEqual(w.termWrites, []);
  });
});
