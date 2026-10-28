import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { assertFreeExpenseSourceActor, isFreeExpenseDraftCompany } from './free-expense-access';
import { CreateUploadIntentUseCase } from '../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CreateDownloadUrlUseCase } from '../../data-model-core/application/use-cases/create-download-url.use-case';
import { PrismaAttachmentRepository } from '../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { InitReceiptUploadUseCase } from '../../expenses/application/use-cases/expense-upload.use-case';
import { ReceiptOcrApplyService } from '../../expenses/application/services/receipt-ocr-apply.service';
import { completeCompanyOcrAdmissionWithinTransaction, readFreeExpenseAllowance, FREE_EXPENSE_QUOTA_SOURCE } from '../../line-ai/application/free-expense-quota';
import { bangkokMonthKey } from '../../line-ai/application/company-ai-usage-meter';
import { PrismaExpenseRepository } from '../../expenses/infrastructure/prisma-expense.repository';
import { UpdateExpenseDraftUseCase, GetExpenseUseCase, MarkExpenseReadyUseCase, ConfirmExpenseUseCase } from '../../expenses/application/use-cases/expense-draft.use-case';
import { PartnerLifecycleTransitionUseCase } from './use-cases/partner-lifecycle-transition.use-case';

const databaseUrl = process.env.FREE_EXPENSE_ACCESS_TEST_DATABASE_URL;
describe('free expense historical purchase and lifecycle policy on PostgreSQL', { skip: !databaseUrl }, () => {
  const tag = `free-access-${randomUUID()}`, companyId = `${tag}-company`, adminId = `${tag}-admin`;
  let client: PrismaClient;
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'local disposable database only');
    assert.ok(url.pathname.startsWith('/free_expense_') || ['/watchdog_bms', '/substitute_receipt_only_review'].includes(url.pathname)
      || url.port === '15432' && url.pathname === '/mangmee_billing_20260912');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await client.user.create({ data: { id: adminId, displayName: tag, status: 'ACTIVE' } });
    await client.company.create({ data: { id: companyId, name: tag, status: 'DISABLED', disabledAt: new Date(0) } });
    await client.companyPlanTerm.create({ data: { companyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2,
      monthlySlipLimit: 15, termStartAt: new Date(0), termEndsAt: new Date(0), termDisabledAt: new Date(0) } });
    await client.auditLog.create({ data: { companyId, targetType: 'company', targetId: companyId,
      action: 'system.partner_company.lifecycle.transition', requestId: tag, result: 'SUCCESS',
      metadataJson: { fromStatus: 'ACTIVE', toStatus: 'DISABLED', reason: 'no_package' }, createdAt: new Date(0) } });
  });
  after(async () => {
    if (!client) return;
    try {
      await client.companyOcrUsageEvent.deleteMany({ where: { companyId } });
      await client.billingInvoice.deleteMany({ where: { billingAccountId: { startsWith: tag } } });
      await client.billingReceiptGrant.deleteMany({ where: { companyId } });
      await client.packageChangeRequest.deleteMany({ where: { companyId } });
      await client.salesAttribution.deleteMany({ where: { companyId } });
      await client.billingAccount.deleteMany({ where: { companyId } });
      await client.attachmentLink.deleteMany({ where: { companyId } });
      await client.expenseLine.deleteMany({ where: { companyId } });
      await client.expenseRecord.deleteMany({ where: { companyId } });
      await client.attachmentObject.deleteMany({ where: { companyId } });
      await client.companyMembership.deleteMany({ where: { companyId } });
      await client.role.deleteMany({ where: { companyId } });
      await client.branch.deleteMany({ where: { companyId } });
      await client.companyFeatureEntitlement.deleteMany({ where: { companyId } });
      await client.companyPlanTerm.deleteMany({ where: { companyId } });
      await client.auditLog.deleteMany({ where: { targetId: companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: adminId } });
    } finally { await client.$disconnect(); }
  });

  it('queries all historical account modes, including fully refunded paid evidence after current mapping disappeared', async () => {
    assert.equal(await isFreeExpenseDraftCompany(client, companyId), true);
    const oldAccountId = `${tag}-old-mode`;
    await client.billingAccount.create({ data: { id: oldAccountId, companyId, stripeAccountId: `${tag}-old-stripe`, livemode: false } });
    await client.billingAccount.create({ data: { id: `${tag}-new-mode`, companyId, stripeAccountId: `${tag}-new-stripe`, livemode: true } });
    assert.equal(await isFreeExpenseDraftCompany(client, companyId), true, 'unused accounts do not count as purchases');
    await client.billingInvoice.create({ data: { billingAccountId: oldAccountId, providerInvoiceId: tag, offerSnapshot: {},
      policyRevisionId: tag, currency: 'THB', totalSatang: 24900, paidSatang: 24900, refundedSatang: 24900,
      periodStart: new Date(0), periodEnd: new Date(1), providerStatus: 'paid', evidenceHash: tag, applyStatus: 'APPLIED', appliedAt: new Date(0) } });
    assert.equal(await isFreeExpenseDraftCompany(client, companyId), false);
    await client.billingInvoice.deleteMany({ where: { billingAccountId: oldAccountId } });
    await client.packageChangeRequest.create({ data: { companyId, requestedByUserId: adminId, requestedTierKey: 'STARTER_249', kind: 'SALES_DEAL', status: 'APPLIED', paymentState: 'STRIPE_ONE_TIME', verifiedAt: new Date(0) } });
    assert.equal(await isFreeExpenseDraftCompany(client, companyId), false, 'historical sales deal independently blocks eligibility');
    await client.packageChangeRequest.deleteMany({ where: { companyId } });
    assert.equal(await isFreeExpenseDraftCompany(client, companyId), true);
  });

  it('persists free WEB source facts and bounds concurrent source uploads without financial/master side effects', async () => {
    await client.companyMembership.create({ data: { companyId, userId: adminId, status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES' } });
    const expense = await client.expenseRecord.create({ data: { companyId, createdByUserId: adminId, captureSource: 'WEB_UPLOAD',
      status: 'DRAFT', expenseDate: new Date('2026-10-01'), vendorNameSnapshot: 'ร้านเดิม' } });
    const ctx = { companyId, userId: adminId, membershipId: 'unused', requestId: randomUUID(), roles: [], scopes: {}, authProvider: 'watchdog',
      permissions: ['expense.update', 'expense.review', 'expense.confirm', 'expense.receipt.upload', 'attachment.create', 'attachment.read'] } as any;
    const repo = new PrismaExpenseRepository({ client } as any), audit = { log: async () => undefined } as any;
    const update = new UpdateExpenseDraftUseCase(repo, audit, {} as any, { execute: async () => { throw new Error('free save called vendor master'); } } as any);
    await update.execute(ctx, expense.id, { expectedUpdatedAt: expense.updatedAt.toISOString(), sourceDraft: { vendorName: 'ร้านใหม่' } });
    const saved = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(saved.vendorNameSnapshot, 'ร้านใหม่'); assert.equal(saved.reviewedAt, null);
    const details = await new GetExpenseUseCase(repo).execute(ctx, expense.id);
    assert.equal((await new GetExpenseUseCase(repo).sourceDraft(ctx, details))?.canEdit, true);
    await assert.rejects(() => new MarkExpenseReadyUseCase(repo).execute(ctx, expense.id), (error: any) => error.getResponse().code === 'FREE_EXPENSE_DRAFTS_ONLY');
    await assert.rejects(() => new ConfirmExpenseUseCase(repo, audit, {} as any, {} as any).execute(ctx, expense.id), (error: any) => error.getResponse().code === 'FREE_EXPENSE_DRAFTS_ONLY');
    const attachments = new PrismaAttachmentRepository({ client } as any);
    const storage = { createUploadIntent: async (input: any) => ({ ...input, bucket: tag, storageProvider: 'local', uploadUrl: 'fixture', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date() }),
      createDownloadUrl: async () => ({ url: 'fixture', expiresAt: new Date() }) } as any;
    const upload = new CreateUploadIntentUseCase(attachments, storage, audit, { uploadMaxBytes: 100000, uploadPendingMaxBytesPerCompany: 100000, signedUrlTtlSeconds: 300 } as any);
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => upload.execute(ctx, {
      originalFileName: 'receipt.pdf', mimeType: 'application/pdf', byteSize: 100, metadataJson: { expenseReceiptExpenseId: expense.id } })));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 3);
    assert.equal(await client.attachmentObject.count({ where: { companyId } }), 3);
    const successful = attempts.find((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')!;
    assert.equal((await new CreateDownloadUrlUseCase(attachments, storage, audit).execute(ctx, { attachmentId: successful.value.attachmentId })).downloadUrl, 'fixture');
    const unrelated = await client.attachmentObject.create({ data: { companyId, uploadedByUserId: adminId, storageProvider: 'local', bucket: tag,
      objectKey: randomUUID(), originalFileName: 'unrelated.pdf', mimeType: 'application/pdf', byteSize: 100, status: 'ACTIVE' } });
    await assert.rejects(() => new CreateDownloadUrlUseCase(attachments, storage, audit).execute(ctx, { attachmentId: unrelated.id }));
    assert.equal(await client.accountingCounterparty.count({ where: { companyId } }), 0);
    assert.equal(await client.expensePayment.count({ where: { companyId } }), 0);
    assert.equal(await client.accountingDocument.count({ where: { companyId } }), 0);
    assert.equal(await client.journalEntry.count({ where: { companyId } }), 0);
  });

  it('revalidates branch, OCR rights and revoked membership before source-result persistence, including upgrade/archive', async () => {
    const member = await client.companyMembership.findFirstOrThrow({ where: { companyId, userId: adminId } });
    const permission = await client.permission.upsert({ where: { key: 'expense.receipt.upload' }, create: { key: 'expense.receipt.upload', description: 'Shared source-upload catalog permission for disposable tests' }, update: {} });
    const role = await client.role.create({ data: { companyId, scopeKey: companyId, key: tag, name: tag,
      permissions: { create: { permissionId: permission.id } }, memberships: { create: { membershipId: member.id } } } });
    const branch = await client.branch.create({ data: { companyId, code: 'HO', name: tag, type: 'HEAD_OFFICE', status: 'ACTIVE', createdByUserId: adminId } });
    const actor = { companyId, userId: adminId, branchId: branch.id };
    await assertFreeExpenseSourceActor(client, actor);
    await client.companyMembership.update({ where: { id: member.id }, data: { branchScopeMode: 'SELECTED_BRANCHES' } });
    await assert.rejects(() => assertFreeExpenseSourceActor(client, { ...actor, branchId: null }), 'branchless record must not rescue a member with no active scope');
    await client.membershipBranchScope.create({ data: { membershipId: member.id, branchId: branch.id } });
    await assertFreeExpenseSourceActor(client, actor);
    await client.branch.update({ where: { id: branch.id }, data: { status: 'DISABLED' } });
    await assert.rejects(() => assertFreeExpenseSourceActor(client, actor));
    await client.branch.update({ where: { id: branch.id }, data: { status: 'ACTIVE' } });
    await client.companyMembership.update({ where: { id: member.id }, data: { status: 'SUSPENDED' } });
    await assert.rejects(() => assertFreeExpenseSourceActor(client, actor));
    await client.companyMembership.update({ where: { id: member.id }, data: { status: 'ACTIVE' } });
    await client.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
    await assert.rejects(() => assertFreeExpenseSourceActor(client, actor));
    await client.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    await client.companyFeatureEntitlement.create({ data: { companyId, featureKey: 'expenses', enabled: false } });
    await assert.rejects(() => assertFreeExpenseSourceActor(client, actor));
    await client.companyFeatureEntitlement.deleteMany({ where: { companyId } });
    await client.company.update({ where: { id: companyId }, data: { status: 'ACTIVE' } });
    await client.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'STARTER_249', termDisabledAt: null, termEndsAt: new Date(Date.now() + 60000) } });
    await assertFreeExpenseSourceActor(client, actor);
    await client.company.update({ where: { id: companyId }, data: { archivedAt: new Date() } });
    await assert.rejects(() => assertFreeExpenseSourceActor(client, actor));
    await client.company.update({ where: { id: companyId }, data: { status: 'DISABLED', archivedAt: null } });
    await client.companyPlanTerm.update({ where: { companyId }, data: { tierKey: 'FREE_TRIAL_15', termDisabledAt: new Date(0), termEndsAt: new Date(0) } });
  });

  it('commits usable OCR facts with the frozen success event and rolls both back on completion failure', async () => {
    const branch = await client.branch.findFirstOrThrow({ where: { companyId, status: 'ACTIVE' } });
    const repo = new PrismaExpenseRepository({ client } as any);
    const apply = new ReceiptOcrApplyService({ client } as any, repo,
      { execute: async () => { throw new Error('source OCR must not create vendor master'); } } as any);
    const fields = { vendorName: 'ร้าน OCR ต้นทาง', description: 'กระดาษ', grandTotalAmount: '100', quantity: '1', unitPrice: '100',
      expenseDate: '2026-10-28', currency: 'THB', vatMode: 'NO_VAT', confidence: 0.99,
      lines: [{ description: 'กระดาษ', quantity: '1', unitPrice: '100', amount: '100' }] } as any;
    const monthKey = bangkokMonthKey();
    for (const fail of [false, true]) {
      const record = await client.expenseRecord.create({ data: { companyId, branchId: branch.id, createdByUserId: adminId,
        captureSource: 'WEB_UPLOAD', status: 'NEEDS_REVIEW', expenseDate: new Date('2026-10-28') } });
      const event = await client.companyOcrUsageEvent.create({ data: { companyId, monthKey, sourceRoute: 'receipt-ocr-web',
        requestId: randomUUID(), quotaSource: FREE_EXPENSE_QUOTA_SOURCE } });
      const action = () => apply.apply({ companyId, userId: adminId, scopes: {} }, record.id, fields, {
        sourceOnly: true, expectedUpdatedAt: record.updatedAt, todayIso: '2026-10-28',
        onUsablePersisted: async tx => {
          const completed = await completeCompanyOcrAdmissionWithinTransaction(tx, { companyId, sourceRoute: event.sourceRoute, requestId: event.requestId, eventId: event.id });
          assert.equal(completed.completed, true);
          if (fail) throw new Error('injected completion failure');
        },
      });
      if (fail) await assert.rejects(action, /injected completion failure/); else await action();
      const saved = await client.expenseRecord.findUniqueOrThrow({ where: { id: record.id }, include: { lines: true } });
      const completed = await client.companyOcrUsageEvent.findUniqueOrThrow({ where: { id: event.id } });
      assert.equal(saved.vendorNameSnapshot, fail ? null : fields.vendorName);
      assert.equal(saved.lines.length > 0, !fail);
      assert.equal(completed.succeededAt !== null, !fail);
      assert.equal(saved.reviewedAt, null);
      assert.equal((await readFreeExpenseAllowance(client, companyId, monthKey)).usedCount, 1);
    }
    assert.equal(await client.accountingCounterparty.count({ where: { companyId } }), 0);
    assert.equal(await client.expensePayment.count({ where: { companyId } }), 0);
    assert.equal(await client.accountingDocument.count({ where: { companyId } }), 0);
    assert.equal(await client.journalEntry.count({ where: { companyId } }), 0);
  });

  it('finishes its exact admitted third LINE upload across Init and storage without granting a fourth or another month', async () => {
    const intakeCompanyId = `${tag}-intake`;
    await client.company.create({ data: { id: intakeCompanyId, name: tag, status: 'DISABLED', disabledAt: new Date(0) } });
    try {
      await client.companyPlanTerm.create({ data: { companyId: intakeCompanyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2,
        monthlySlipLimit: 15, termStartAt: new Date(0), termEndsAt: new Date(0), termDisabledAt: new Date(0) } });
      await client.auditLog.create({ data: { companyId: intakeCompanyId, targetType: 'company', targetId: intakeCompanyId,
        action: 'system.partner_company.lifecycle.transition', requestId: tag, result: 'SUCCESS', metadataJson: { toStatus: 'DISABLED', reason: 'no_package' } } });
      await client.companyMembership.create({ data: { companyId: intakeCompanyId, userId: adminId, status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES' } });
      const branch = await client.branch.create({ data: { companyId: intakeCompanyId, code: 'HO', name: tag, type: 'HEAD_OFFICE', createdByUserId: adminId } });
      const monthKey = bangkokMonthKey();
      const oldMonth = monthKey === '2026-01' ? '2025-12' : `${monthKey.slice(0, 4)}-${String(Number(monthKey.slice(5)) - 1).padStart(2, '0')}`;
      const seed = async (month: string, request: string, succeeded = false) => client.companyOcrUsageEvent.create({ data: {
        companyId: intakeCompanyId, monthKey: month, sourceRoute: 'receipt-ocr-line', requestId: request,
        quotaSource: FREE_EXPENSE_QUOTA_SOURCE, ...(succeeded ? { succeededAt: new Date() } : {}),
      } });
      const done = await seed(monthKey, randomUUID(), true);
      await seed(monthKey, randomUUID(), true);
      const ownMessage = randomUUID(), own = await seed(monthKey, ownMessage);
      for (let index = 0; index < 2; index++) await client.attachmentObject.create({ data: { companyId: intakeCompanyId, branchId: branch.id,
        uploadedByUserId: adminId, storageProvider: 'local', bucket: tag, objectKey: randomUUID(), originalFileName: 'prior.pdf', mimeType: 'application/pdf', byteSize: 100,
        status: 'ACTIVE', metadataJson: { freeExpenseUploadMonth: monthKey } } });
      const ctx = { companyId: intakeCompanyId, userId: adminId, membershipId: 'unused', requestId: randomUUID(), roles: [], scopes: {}, authProvider: 'line',
        permissions: ['expense.receipt.line_upload', 'attachment.create', 'attachment.read'] } as any;
      const prisma = { client } as any, repo = new PrismaExpenseRepository(prisma), attachmentRepo = new PrismaAttachmentRepository(prisma);
      const storage = { createUploadIntent: async (input: any) => ({ ...input, bucket: tag, storageProvider: 'local', uploadUrl: 'fixture', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date() }),
        getObjectMetadata: async () => ({ exists: false }) } as any;
      const audit = { log: async () => undefined } as any;
      const intent = new CreateUploadIntentUseCase(attachmentRepo, storage, audit, { uploadMaxBytes: 100000, uploadPendingMaxBytesPerCompany: 100000, signedUrlTtlSeconds: 300 } as any);
      const intake = new InitReceiptUploadUseCase(repo, intent, audit, { execute: async () => ({ mode: 'SIMPLE' }) } as any,
        { assertLaunchRouteOpen: async () => undefined } as any, prisma);
      const command = (message: string) => ({ originalFileName: 'receipt.pdf', mimeType: 'application/pdf', byteSize: 100, branchId: branch.id, captureSource: 'LINE_UPLOAD' as const,
        lineCapture: { lineMessageId: message, lineEventId: randomUUID(), chatKeyHash: 'chat' } });
      const reservation = (event: typeof own) => ({ eventId: event.id, monthKey: event.monthKey, sourceRoute: 'receipt-ocr-line' as const, requestId: event.requestId });
      const uploaded = await intake.execute(ctx, command(ownMessage), { freeOcrReservation: reservation(own) });
      assert.ok(uploaded.attachmentId);
      const bound = await client.attachmentObject.findUniqueOrThrow({ where: { id: uploaded.attachmentId } });
      assert.equal((bound.metadataJson as any).freeExpenseUploadMonth, monthKey);
      assert.equal((await repo.findById(intakeCompanyId, uploaded.expenseId))?.lineMessageId, ownMessage);
      assert.equal(await client.attachmentObject.count({ where: { companyId: intakeCompanyId } }), 3);
      await assert.rejects(() => intake.execute(ctx, command(randomUUID())), (error: any) => error.getResponse().code === 'FREE_DOCUMENTS_IN_FLIGHT');
      await assert.rejects(() => intake.execute(ctx, command(randomUUID()), { freeOcrReservation: reservation(own) }));
      await assert.rejects(() => intake.execute(ctx, command(done.requestId), { freeOcrReservation: reservation(done) }));
      await assert.rejects(() => intake.execute(ctx, command(ownMessage), { freeOcrReservation: { ...reservation(own), eventId: 'fake-event' } }));
      await assert.rejects(() => intent.execute(ctx, { originalFileName: 'receipt.pdf', mimeType: 'application/pdf', byteSize: 100 },
        { expenseId: uploaded.expenseId, freeOcrReservation: { ...reservation(own), requestId: 'unrelated-message' } }));
      const oldMessage = randomUUID();
      await seed(oldMonth, randomUUID(), true); await seed(oldMonth, randomUUID(), true);
      const old = await seed(oldMonth, oldMessage);
      const rolled = await intake.execute(ctx, command(oldMessage), { freeOcrReservation: reservation(old) });
      const oldFile = await client.attachmentObject.findUniqueOrThrow({ where: { id: rolled.attachmentId } });
      assert.equal((oldFile.metadataJson as any).freeExpenseUploadMonth, oldMonth);
      await assert.rejects(() => intake.execute(ctx, command(randomUUID())));
      await client.companyOcrUsageEvent.update({ where: { id: own.id }, data: { succeededAt: new Date() } });
      await assert.rejects(() => intake.execute(ctx, command(ownMessage), { freeOcrReservation: reservation(own) }));
      assert.equal(await client.expenseRecord.count({ where: { companyId: intakeCompanyId } }), 2, 'rejected identities create no orphan drafts');
    } finally {
      await client.companyOcrUsageEvent.deleteMany({ where: { companyId: intakeCompanyId } });
      await client.expenseLine.deleteMany({ where: { companyId: intakeCompanyId } });
      await client.expenseRecord.deleteMany({ where: { companyId: intakeCompanyId } });
      await client.attachmentObject.deleteMany({ where: { companyId: intakeCompanyId } });
      await client.companyMembership.deleteMany({ where: { companyId: intakeCompanyId } });
      await client.branch.deleteMany({ where: { companyId: intakeCompanyId } });
      await client.companyPlanTerm.deleteMany({ where: { companyId: intakeCompanyId } });
      await client.auditLog.deleteMany({ where: { targetId: intakeCompanyId } });
      await client.company.deleteMany({ where: { id: intakeCompanyId } });
    }
  });

  it('keeps a later human disable authoritative, including DISABLED to DISABLED', async () => {
    await new PartnerLifecycleTransitionUseCase({ client } as any).execute({ companyId, targetStatus: 'DISABLED',
      requestingAdminUserId: adminId, requestId: tag, reason: 'security hold' });
    assert.equal((await client.companyPlanTerm.findUnique({ where: { companyId } }))?.termDisabledAt, null);
    assert.equal(await isFreeExpenseDraftCompany(client, companyId), false);
    assert.equal((await client.company.findUnique({ where: { id: companyId } }))?.status, 'DISABLED');
  });
});
