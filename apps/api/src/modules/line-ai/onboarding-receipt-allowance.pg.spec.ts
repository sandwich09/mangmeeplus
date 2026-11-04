import { GetExpenseUseCase } from '../expenses/application/use-cases/expense-draft.use-case';
import { lineMessagingCredentialsFixture } from '../../common/config/line-messaging-credentials.fixture';
/** First-shop readiness through real signup, permissions, upload and OCR persistence. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaPg } from '@prisma/adapter-pg';
import type { ReceiptOcrResponse, RequestContext } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import type { PrismaService } from '../../common/database/prisma.service';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';
import { AppConfigService } from '../../common/config/app-config.service';
import { createLogger } from '../../common/logger/logger.service';
import { RedisRateLimitService } from '../../common/security/redis-rate-limit.service';
import { PermissionResolverService } from '../access-control/application/permission-resolver.service';
import { PrismaPermissionResolverRepository } from '../access-control/infrastructure/prisma-permission-resolver.repository';
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import { AuthRateLimitService } from '../auth/application/auth-rate-limit.service';
import { currentLegalRelease, LegalAcceptanceService } from '../auth/application/legal-acceptance.service';
import type { AttachmentStoragePort } from '../data-model-core/domain/ports/attachment-storage.port';
import { AttachmentMalwareScanner } from '../data-model-core/infrastructure/attachment-malware-scanner';
import { PrismaAttachmentRepository } from '../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaOutboxRepository } from '../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { ObjectVersionCleanupService } from '../data-model-core/application/services/object-version-cleanup.service';
import { OutboxAppendService } from '../data-model-core/application/services/outbox-append.service';
import { CompanyVatRegistrationUseCase } from '../data-model-core/application/use-cases/company-vat-registration.use-case';
import { CompleteAttachmentUploadUseCase } from '../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { CreateUploadIntentUseCase } from '../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompanySignupCoreService } from '../external-signup/application/company-signup-core.service';
import { ProvisionSignupUseCase } from '../external-signup/application/provision-signup.use-case';
import { PartnerLifecycleTransitionUseCase } from '../system-partner-management/application/use-cases/partner-lifecycle-transition.use-case';
import { SignupAdminNotifyService } from '../external-signup/application/signup-admin-notify.service';
import { SubmitLineSignupUseCase } from '../external-signup/application/submit-line-signup.use-case';
import { GetExpenseCapturePolicyUseCase } from '../expenses/application/use-cases/expense-capture-policy.use-case';
import { PrismaExpenseCaptureRepository } from '../expenses/infrastructure/prisma-expense-capture.repository';
import { RequestReceiptExtractionUseCase } from '../expenses/application/use-cases/expense-extraction.use-case';
import { CompleteReceiptUploadUseCase, InitReceiptUploadUseCase } from '../expenses/application/use-cases/expense-upload.use-case';
import { ReceiptOcrApplyService } from '../expenses/application/services/receipt-ocr-apply.service';
import { PrismaExpenseRepository } from '../expenses/infrastructure/prisma-expense.repository';
import { ReceiptOcrClient } from '../expenses/infrastructure/receipt-ocr.client';
import { LaunchGateGuardService } from '../feature-launch/application/launch-gate.guard';
import { CreateCompanyOnboardingUseCase } from '../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { receiptQuotaSnapshot } from './application/company-ocr-governance';

const databaseUrl = process.env.ONBOARDING_RECEIPT_TEST_DATABASE_URL;
if (process.env.ONBOARDING_RECEIPT_REQUIRE_POSTGRES === 'true') assert.ok(databaseUrl, 'ONBOARDING_RECEIPT_TEST_DATABASE_URL is required');

describe('first LINE shop receipt on PostgreSQL', { skip: !databaseUrl }, () => {
  it('reads a first receipt with printed zero before optional settings, under the effective 15 trial', async (t) => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only a local disposable database is allowed');
    assert.ok(url.pathname === '/watchdog_bms' || url.port === '15432' && url.pathname === '/mangmee_billing_20260912', 'requires an explicit local test database');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const prisma = { client } as PrismaService;
    const tag = `first-receipt-${randomUUID()}`, lineUserId = `U${tag}`;
    const operatorCompanyId = `${tag}-system`, operatorUserId = `000-${tag}-operator`;
    const overrides = {
      APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local', GIT_SHA: tag,
      SERVICE_NAME: tag, DATABASE_URL: databaseUrl!, S3_BUCKET: tag, REDIS_URL: '',
      CREDENTIAL_ENCRYPTION_KEY: '07'.repeat(32), LINE_SIGNUP_APPROVAL_MODE: 'AUTO_FREE',
      LINE_SIGNUP_AUTO_DAILY_CAP: '100', RECEIPT_QUOTA_ENFORCED: 'true',
      AI_GATEWAY_INTERNAL_SECRET: tag, AI_GATEWAY_INTERNAL_URL: 'https://first-receipt.example.test',
      EMAIL_PROVIDER: 'disabled', CLAMAV_HOST: undefined, LINE_SIGNUP_WARMUP_SLIPS: undefined,
    };
    const savedEnv = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
    const oldFetch = globalThis.fetch;
    let reachable = false, createdGate = false, transitionId: string | undefined;
    let rateLimits: RedisRateLimitService | undefined;
    try {
      const unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'ONBOARDING_RECEIPT_REQUIRE_POSTGRES');
      if (unreachable) { t.skip(unreachable); return; }
      reachable = true;
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      const config = new AppConfigService();
      assert.equal(config.lineSignupWarmupSlips, 15, 'new signup default agrees with the shared trial');
      const logger = createLogger({ level: 'silent', redactionEnabled: true, serviceName: tag });
      const audit = new AuditService(new PrismaAuditRepository(prisma), logger);
      const outboxRepo = new PrismaOutboxRepository(prisma);
      rateLimits = new RedisRateLimitService(config); // Real bounded local counters; no Redis required locally.
      const core = new CompanySignupCoreService(prisma);
      const legal = new LegalAcceptanceService(prisma, audit);
      const onboarding = new CreateCompanyOnboardingUseCase(prisma, config, legal);
      // CI migrates and syncs permission roles; it deliberately does not seed demo accounts.
      const operatorRole = await client.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } } });
      await client.company.create({ data: { id: operatorCompanyId, name: operatorCompanyId, status: 'ACTIVE' } });
      await client.user.create({ data: { id: operatorUserId, displayName: `${tag} operator`, status: 'ACTIVE' } });
      await client.companyMembership.create({ data: {
        companyId: operatorCompanyId, userId: operatorUserId, status: 'ACTIVE', roles: { create: { roleId: operatorRole.id } },
      } });
      // Notification delivery is not part of first receipt readiness. The real directory still
      // resolves this fixture's active operator, and the real outbox queues admin notices.
      const adminNotify = new SignupAdminNotifyService(lineMessagingCredentialsFixture(config), prisma, outboxRepo, undefined as never, config, logger);
      assert.ok((await adminNotify.activeSystemAdmins()).some((admin) => admin.userId === operatorUserId && admin.companyId === operatorCompanyId));
      const lineNotify = { enqueue: async () => undefined } as never;
      const opsAlerts = { raise: async () => undefined } as never;
      const provision = new ProvisionSignupUseCase(prisma, core, onboarding, config, adminNotify, lineNotify, opsAlerts,
        new PartnerLifecycleTransitionUseCase(prisma));
      const submit = new SubmitLineSignupUseCase(prisma, config, core, {
        verify: async () => ({ providerUserId: lineUserId, channelId: tag, displayName: 'ร้านแรก' }),
      } as never, new AuthRateLimitService(config, rateLimits), adminNotify, provision, opsAlerts, { resolveCode: async () => null } as never);
      await submit.execute({
        idToken: 'test.external.line.proof', companyName: tag, phoneNumber: '0812345678',
        submissionId: randomUUID(), intent: 'FIRST_SHOP',
        contactEmail: ' Shop.Contact@Example.test ', legal: { ...currentLegalRelease('th'), locale: 'th' },
        correlationRequestId: `${tag}-signup`, webBaseUrl: 'https://app.example.test', apiBaseUrl: 'https://api.example.test/v1',
      });
      const signup = await client.companySignupRequest.findFirstOrThrow({ where: { lineProviderUserId: lineUserId } });
      assert.equal(signup.state, 'COMPLETED');
      assert.ok(signup.companyId && signup.ownerUserId);
      const companyId = signup.companyId, userId = signup.ownerUserId;
      const company = await client.company.findUniqueOrThrow({ where: { id: companyId } });
      const user = await client.user.findUniqueOrThrow({ where: { id: userId }, include: { credential: true } });
      // J1 (Owner 2026-09-20): a new shop opens LOCKED — zero-day term, DISABLED, stamped so the
      // sweep never sends it an expiry notice it never earned.
      assert.equal(company.status, 'DISABLED');
      const openedTerm = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
      assert.equal(openedTerm.termEndsAt.getTime(), openedTerm.termStartAt.getTime());
      assert.ok(openedTerm.termDisabledAt);
      assert.ok(openedTerm.expiredNotifiedAt);
      // R1: nothing a trial used to need is set up — no warm-up ceiling, no trial AI budget row.
      assert.equal(openedTerm.warmupSlipLimit, null);
      assert.equal(await client.companyAiConfiguration.count({ where: { companyId } }), 0);
      assert.equal(company.email, 'shop.contact@example.test');
      assert.equal(company.taxId, null);
      assert.equal(company.addressJson, null);
      assert.equal(user.email, 'shop.contact@example.test');
      assert.equal(user.emailVerifiedAt, null);
      assert.equal(user.username, null);
      assert.equal(user.credential, null);
      assert.equal(await client.legalDocumentActionRecord.count({ where: { acceptedByUserId: userId } }), 2);
      const identity = await client.externalIdentity.findFirstOrThrow({ where: { providerUserId: lineUserId, providerChannelId: tag } });
      assert.equal(identity.userId, userId);
      assert.equal(identity.status, 'ACTIVE');
      assert.equal((await client.lineCompanyContext.findUniqueOrThrow({ where: { lineUserId } })).companyId, companyId);

      // Everything below is first-receipt readiness, which starts the moment the shop has a
      // package. Applied here the way buying one does: the company re-enabled, the term running.
      await client.company.update({ where: { id: companyId }, data: { status: 'ACTIVE' } });
      await client.companyPlanTerm.update({ where: { companyId }, data: {
        termEndsAt: new Date(Date.now() + 30 * 24 * 3600_000), termDisabledAt: null,
      } });
      await client.companyAiConfiguration.create({ data: {
        companyId, ocrEnabled: true, monthlyBudgetSatang: config.lineFreeAiBudgetSatang,
      } });

      const resolver = new PermissionResolverService(new PrismaPermissionResolverRepository(prisma));
      const access = await resolver.resolveAccess(userId, companyId);
      const membership = await client.companyMembership.findUniqueOrThrow({ where: { id: access.membershipId } });
      assert.equal(membership.status, 'ACTIVE');
      const branch = await client.branch.findFirstOrThrow({ where: { companyId, type: 'HEAD_OFFICE', status: 'ACTIVE' } });
      const branchId = branch.id;
      assert.equal(branch.addressJson, null);
      for (const permission of ['expense.receipt.line_upload', 'expense.ocr.request', 'attachment.create']) assert.ok(access.permissions.includes(permission), permission);
      const ctx: RequestContext = { ...access, requestId: `${tag}-receipt`, authSubject: lineUserId, userId, authProvider: 'line' };
      const term = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
      assert.equal(term.tierKey, 'FREE_TRIAL_15');
      assert.equal(term.monthlySlipLimit, 15);
      const ai = await client.companyAiConfiguration.findUniqueOrThrow({ where: { companyId } });
      assert.equal(ai.ocrEnabled, true);
      assert.equal(ai.monthlyBudgetSatang, config.lineFreeAiBudgetSatang);
      await client.companyPlanTerm.update({ where: { companyId }, data: { warmupSlipLimit: 10 } });
      const before = await receiptQuotaSnapshot(prisma, companyId);
      assert.equal(before.planLimit, 15, 'a persisted first-week ten cannot reduce the 15 trial');
      assert.equal(before.usedCount, 0);

      // A real OPEN attestation for this local test build, never a stubbed launch guard.
      let gate = await client.featureLaunchGate.findUnique({ where: { gateKey_routeKey: { gateKey: 'expenses', routeKey: 'DEFAULT' } } });
      if (!gate) {
        gate = await client.featureLaunchGate.create({ data: { gateKey: 'expenses', routeKey: 'DEFAULT', state: 'OPEN', generation: 1 } });
        createdGate = true;
      }
      assert.equal(gate.state, 'OPEN', 'the local fixture must not override a closed route');
      const transition = await client.featureLaunchGateTransition.create({ data: {
        gateKey: 'expenses', routeKey: 'DEFAULT', seq: gate.lastSeq + 1, generation: gate.generation,
        commandId: tag, action: 'OPEN', actorUserId: 'SYSTEM', payloadFingerprint: tag,
        targetEnvironment: 'local', buildReleaseId: tag, expectedGeneration: gate.generation, routeClass: 'ORDINARY',
      } });
      transitionId = transition.id;
      const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const objects = new Map<string, { bytes: Buffer; mimeType: string; version?: string }>();
      const storage: AttachmentStoragePort = {
        createUploadIntent: async (input) => ({ ...input, bucket: tag, storageProvider: 'test',
          uploadUrl: `https://storage.example.test/${input.objectKey}`, uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date(Date.now() + 60_000) }),
        getObjectMetadata: async ({ objectKey }) => { const row = objects.get(objectKey); return { exists: !!row, byteSize: row?.bytes.length ?? 0, mimeType: row?.mimeType, objectVersionId: row?.version }; },
        getObject: async ({ objectKey, objectVersionId }) => { const row = objects.get(objectKey); assert.ok(row); if (objectVersionId) assert.equal(objectVersionId, row.version); return row; },
        putObject: async (input) => { const version = randomUUID(); objects.set(input.objectKey, { ...input, version }); return {
          bucket: tag, objectKey: input.objectKey, storageProvider: 'test', byteSize: input.bytes.length,
          checksumSha256: createHash('sha256').update(input.bytes).digest('hex'), objectVersionId: version,
        }; },
        deleteObject: async ({ objectKey }) => { objects.delete(objectKey); },
        createDownloadUrl: async () => { throw new Error('unexpected download signing'); },
        getExactObjectVersionInventory: async () => { throw new Error('unexpected inventory'); },
      };
      const attachments = new PrismaAttachmentRepository(prisma), repo = new PrismaExpenseRepository(prisma);
      const init = new InitReceiptUploadUseCase(repo, new CreateUploadIntentUseCase(attachments, storage, audit, config), audit,
        new GetExpenseCapturePolicyUseCase(prisma, new CompanyVatRegistrationUseCase(prisma, audit)), new LaunchGateGuardService(prisma), prisma);
      const date = new Date().toISOString().slice(0, 10);
      const uploadCommand = { originalFileName: 'first.png', mimeType: 'image/png', byteSize: bytes.length, expenseDate: date,
        branchId, captureSource: 'LINE_UPLOAD' as const, lineCapture: { lineMessageId: `${tag}-image`, lineEventId: `${tag}-event`, chatKeyHash: tag } };
      await assert.rejects(init.execute({ ...ctx, scopes: { branchIds: ['outside-scope'] } }, uploadCommand), /branch scope/i);
      const intent = await init.execute(ctx, uploadCommand);
      const pending = await client.attachmentObject.findUniqueOrThrow({ where: { id: intent.attachmentId } });
      objects.set(pending.objectKey, { bytes, mimeType: 'image/png' });
      const complete = new CompleteReceiptUploadUseCase(repo,
        new CompleteAttachmentUploadUseCase(attachments, storage, audit, new AttachmentMalwareScanner(config), logger, new ObjectVersionCleanupService(outboxRepo, logger)),
        audit, new OutboxAppendService(outboxRepo, logger), attachments, prisma, {resolveAccess: async () => ctx} as any);
      await complete.execute(ctx, { expenseId: intent.expenseId, attachmentId: intent.attachmentId });
      let providerCalls = 0;
      globalThis.fetch = async (input, options) => {
        assert.equal(String(input), `${config.aiGatewayInternalUrl}/internal/ai/receipt-ocr`);
        const request = JSON.parse(String(options?.body));
        assert.equal(request.companyId, companyId);
        assert.equal(request.userId, userId);
        assert.equal(request.attachment.contentBase64, bytes.toString('base64'));
        providerCalls += 1;
        const firstLine = { description: 'กระดาษ', quantity: '1', unitPrice: '100.00', amount: '100.00', evidenceSignal: 'กระดาษ 1 100.00' };
        const secondLine = { description: 'ของแถม', quantity: '1', unitPrice: '0.00', amount: '0.00', evidenceSignal: 'ของแถม 1 0.00' };
        const fields = {
          vendorName: 'ร้านขายกระดาษ', expenseDate: date, vatMode: 'NO_VAT', subtotalAmount: '100.00', grandTotalAmount: '100.00',
          lines: [firstLine, secondLine],
        } satisfies NonNullable<ReceiptOcrResponse['fields']>;
        return Response.json({ status: 'ok', classification: {
          contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT', businessDirection: 'PURCHASE_EXPENSE',
          transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'], confidence: 0.99, evidenceSignals: ['receipt'],
          amountSignals: ['100.00'], settlementSignals: ['paid'], missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
        }, fields, usage: [{ tag: 'receipt-ocr', modelId: request.modelPolicy?.modelId ?? 'anthropic.claude-sonnet-4-6', ok: true,
          inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, durationMs: 1 }],
        } satisfies ReceiptOcrResponse);
      };
      const extract = new RequestReceiptExtractionUseCase(repo, storage, new ReceiptOcrClient(config, rateLimits, prisma), new ReceiptOcrApplyService(prisma, repo), audit, prisma,
        new PrismaExpenseCaptureRepository(prisma), { kick: () => undefined } as any, new GetExpenseUseCase(repo));
      await assert.rejects(extract.execute({ ...ctx, companyId: `${tag}-another-company` }, intent.expenseId));
      const result = await extract.execute(ctx, intent.expenseId);
      assert.equal(result.status, 'ok');
      assert.equal(providerCalls, 1);
      const expense = await client.expenseRecord.findUniqueOrThrow({ where: { id: intent.expenseId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      assert.equal(expense.companyId, companyId);
      assert.equal(expense.branchId, branchId);
      assert.equal(expense.status, 'NEEDS_REVIEW');
      assert.equal(expense.primaryAttachmentId, intent.attachmentId);
      assert.equal(expense.grandTotalAmount.toFixed(2), '100.00');
      assert.equal(expense.lines.length, 2);
      assert.equal(expense.lines[1]!.description, 'ของแถม');
      assert.equal(expense.lines[1]!.quantity.toFixed(2), '1.00');
      assert.equal(expense.lines[1]!.unitPrice.toFixed(2), '0.00');
      assert.equal(expense.lines[1]!.lineTotalAmount.toFixed(2), '0.00');
      const saved = await client.attachmentObject.findUniqueOrThrow({ where: { id: intent.attachmentId } });
      assert.equal(saved.status, 'ACTIVE');
      assert.ok(saved.objectVersionId);
      const after = await receiptQuotaSnapshot(prisma, companyId);
      assert.equal(after.planLimit, 15);
      assert.equal(after.usedCount, 1);
      assert.equal(after.planLimit! - after.usedCount, 14);
      assert.equal(await client.companyOcrUsageEvent.count({ where: { companyId } }), 1);
      assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } })).warmupSlipLimit, 10);
      await client.companyMembership.update({ where: { id: membership.id }, data: { status: 'DISABLED' } });
      await assert.rejects(resolver.resolveAccess(userId, companyId), 'disabled membership cannot acquire receipt permissions');
    } finally {
      globalThis.fetch = oldFetch;
      await rateLimits?.onModuleDestroy();
      for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      try {
        if (reachable) {
          const requests = await client.companySignupRequest.findMany({ where: { lineProviderUserId: lineUserId } });
          const companyIds = [operatorCompanyId, ...requests.flatMap((row) => row.companyId ? [row.companyId] : [])];
          const userIds = [operatorUserId, ...requests.flatMap((row) => row.ownerUserId ? [row.ownerUserId] : [])];
          await client.lineCompanyContext.deleteMany({ where: { lineUserId } });
          await client.companySignupRequest.deleteMany({ where: { lineProviderUserId: lineUserId } });
          await client.companyOnboardingRun.deleteMany({ where: { companyId: { in: companyIds } } });
          // Delete before Company: its relation otherwise sets outbox.companyId to null.
          await client.outboxEvent.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { aggregateId: { in: requests.map((row) => row.id) } }] } });
          await client.company.deleteMany({ where: { id: { in: companyIds } } });
          await client.user.deleteMany({ where: { id: { in: userIds } } });
          await client.auditLog.deleteMany({ where: { requestId: { startsWith: tag } } });
          if (transitionId) await client.featureLaunchGateTransition.delete({ where: { id: transitionId } });
          if (createdGate) await client.featureLaunchGate.delete({ where: { gateKey_routeKey: { gateKey: 'expenses', routeKey: 'DEFAULT' } } });
        }
      } finally { await client.$disconnect(); }
    }
  });
});
