/**
 * Write-only verification brief. Run explicitly against a seeded local PostgreSQL database
 * with DEMO_SAMPLE_TEST_DATABASE_URL. The controller owns registration and execution.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { it } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { TIER_FEATURE_PRESETS, civilDate } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { AppConfigService } from '../../../common/config/app-config.service';
import { createLogger } from '../../../common/logger/logger.service';
import { LegalAcceptanceService } from '../../auth/application/legal-acceptance.service';
import { AuditService } from '../../audit/application/audit.service';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import { CreateCompanyOnboardingUseCase } from '../../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';
import { PrismaReimbursementRepository } from '../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { claimSnapshotFields, computeSnapshotHash } from '../../reimbursements/domain/logic/reimbursement.logic';
import { populateDemoCompany, demoSampleRows } from './demo-sample-data';
import { demoId, documentDate, type DemoInput } from './demo-data/expense-writes';

const databaseUrl = process.env.DEMO_SAMPLE_TEST_DATABASE_URL;

it('onboards two copies with isolated sample rows, rollback and retry safety', {
  skip: !databaseUrl, timeout: 120_000,
}, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.pathname, '/watchdog_bms', 'Use the seeded disposable local database');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const service = { client } as PrismaService;
  const audit = new AuditService(new PrismaAuditRepository(service), createLogger({
    level: 'error', redactionEnabled: true, serviceName: 'demo-sample-data-pg',
  }));
  const config = { credentialEncryptionKey: Buffer.alloc(32, 7), lineLiffId: '' } as AppConfigService;
  const onboarding = new CreateCompanyOnboardingUseCase(service, config, new LegalAcceptanceService(service, audit));
  const runKey = `demo-sample-${randomUUID()}`;
  const operatorId = `${runKey}-operator`;
  const companies: DemoInput[] = [];
  const now = new Date('2026-03-02T00:05:00+07:00');
  try {
    for (const role of ['OWNER', 'MANAGER', 'FINANCE', 'STAFF']) {
      await client.role.findUniqueOrThrow({ where: { scopeKey_key: { scopeKey: 'system', key: role } } });
    }
    await client.whtIncomeCategory.findUniqueOrThrow({ where: { code: 'WHT_SERVICE_3' } });
    await client.user.create({ data: { id: operatorId, displayName: runKey, status: 'ACTIVE' } });
    for (const suffix of ['A', 'B']) {
      const created = await onboarding.execute({
        companyName: 'ครัวมั่งมี (ร้านตัวอย่าง)', ownerDisplayName: 'คุณมั่งมี (ตัวอย่าง)',
        ownerAuth: { kind: 'line-link-later' }, allowDuplicateCompanyName: true,
        vatRegistration: { status: 'NOT_REGISTERED', effectiveFrom: '2020-01-01' },
        modulePackage: 'enterprise', planTier: 'ENTERPRISE_1999',
        requestingAdminUserId: operatorId, requestId: `${runKey}-${suffix}`,
        webBaseUrl: 'https://example.test', apiBaseUrl: 'https://api.example.test/v1',
      });
      const branch = await client.branch.findFirstOrThrow({ where: { companyId: created.companyId, code: 'HO' } });
      companies.push({ companyId: created.companyId, ownerUserId: created.ownerId, branchId: branch.id, now });
      // These caller-owned preconditions mirror the API lane's DEMO company provisioning.
      await client.company.update({ where: { id: created.companyId }, data: { reportClassification: 'DEMO' } });
      const features = new Set(TIER_FEATURE_PRESETS.ENTERPRISE_1999);
      const entitlements = await client.companyFeatureEntitlement.findMany({ where: { companyId: created.companyId } });
      for (const entitlement of entitlements) {
        await client.companyFeatureEntitlement.update({ where: { id: entitlement.id }, data: { enabled: features.has(entitlement.featureKey) } });
      }
    }
    const [a, b] = companies as [DemoInput, DemoInput];
    await t.test('rolls every seeded row back with a caller-owned transaction', async () => {
      await assert.rejects(client.$transaction(async tx => {
        await populateDemoCompany(tx, a);
        throw new Error('intentional demo rollback');
      }, { timeout: 30_000 }), /intentional demo rollback/);
      assert.equal(await client.expenseRecord.count({ where: { companyId: a.companyId } }), 0);
      assert.equal(await client.user.count({ where: { id: { in: ['MANAGER', 'FINANCE', 'STAFF'].map(role => demoId(a.companyId, `user-${role}`)) } } }), 0);
      assert.equal(await client.reimbursementRequest.count({ where: { companyId: a.companyId } }), 0);
      assert.equal(await client.accountingCounterparty.count({ where: { companyId: a.companyId } }), 0);
    });
    const started = performance.now();
    await populateDemoCompany(client, a);
    t.diagnostic(`PrismaClient population took ${(performance.now() - started).toFixed(0)} ms (target < 3000 ms)`);
    await client.$transaction(tx => populateDemoCompany(tx, b), { timeout: 30_000 });

    for (const company of companies) {
      await t.test(`checks complete rows and references for ${company.companyId}`, async () => {
        const where = { companyId: company.companyId };
        const [members, profiles, counterparties, expenses, lines, claims, claimLines, steps, payments, expensePayments, certificates, history] = await Promise.all([
          client.companyMembership.findMany({ where, include: { user: { include: { credential: true, externalIdentities: true } }, roles: { include: { role: true } } } }),
          client.employeeAccessProfile.findMany({ where }), client.accountingCounterparty.findMany({ where }),
          client.expenseRecord.findMany({ where }), client.expenseLine.findMany({ where }),
          client.reimbursementRequest.findMany({ where }), client.reimbursementLine.findMany({ where }),
          client.reimbursementApprovalStep.findMany({ where }), client.reimbursementPayment.findMany({ where }),
          client.expensePayment.findMany({ where }), client.whtCertificate.findMany({ where }),
          client.whtCertificateHistory.findMany({ where }),
        ]);
        assert.equal(members.length, 4);
        assert.equal(profiles.length, 3);
        assert.equal(counterparties.length, 5);
        assert.equal(expenses.length, 32);
        assert.equal(lines.length, 32);
        assert.equal(claims.length, 3);
        assert.equal(claimLines.length, 3);
        assert.equal(steps.length, 3);
        assert.equal(payments.length, 1);
        assert.equal(expensePayments.length, 28);
        assert.equal(certificates.length, 1);
        assert.equal(history.filter(event => event.eventType === 'ISSUED').length, 1);
        const memberIds = new Set(members.map(member => member.userId));
        const membershipIds = new Set(members.map(member => member.id));
        const expenseIds = new Set(expenses.map(expense => expense.id));
        const claimIds = new Set(claims.map(claim => claim.id));
        const claimLineIds = new Set(claimLines.map(line => line.id));
        const counterpartyIds = new Set(counterparties.map(row => row.id));
        const categories = await client.expenseCategory.findMany({ where });
        const categoryIds = new Set(categories.map(category => category.id));
        for (const member of members) {
          assert.equal(member.user.email, null);
          assert.equal(member.user.phoneNumber, null);
          assert.equal(member.user.username, null);
          assert.equal(member.user.credential, null);
          assert.equal(member.user.externalIdentities.length, 0);
        }
        for (const profile of profiles) {
          assert.ok(memberIds.has(profile.userId));
          assert.ok(membershipIds.has(profile.membershipId));
          const role = members.find(member => member.id === profile.membershipId)!.roles[0]!.role.key;
          const index = ['MANAGER', 'FINANCE', 'STAFF'].indexOf(role);
          assert.equal(profile.phoneNumber, String(index + 1).padStart(10, '0'));
        }
        for (const expense of expenses) {
          assert.equal(expense.branchId, company.branchId);
          assert.ok(memberIds.has(expense.createdByUserId));
          assert.ok(categoryIds.has(expense.expenseCategoryId!));
          if (expense.vendorCounterpartyId) assert.ok(counterpartyIds.has(expense.vendorCounterpartyId));
          if (expense.sourceReimbursementRequestId) assert.ok(claimIds.has(expense.sourceReimbursementRequestId));
          if (expense.sourceReimbursementLineId) assert.ok(claimLineIds.has(expense.sourceReimbursementLineId));
          assert.ok(expense.expenseDate.toISOString().slice(0, 10) <= civilDate(now));
        }
        for (const line of lines) {
          assert.ok(expenseIds.has(line.expenseId));
          assert.ok(categoryIds.has(line.expenseCategoryId!));
        }
        for (const claim of claims) {
          assert.equal(claim.requesterUserId, demoId(company.companyId, 'user-STAFF'));
          assert.equal(claim.branchId, company.branchId);
          const repo = new PrismaReimbursementRepository(service, new PrismaDocumentSequenceRepository(service));
          const loaded = (await repo.findRequestById(company.companyId, claim.id))!;
          assert.equal(loaded.approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields(loaded, loaded.approvalPolicySnapshotJson)));
          assert.equal(await repo.areClaimProjectionsReady(loaded), claim.status !== 'PENDING_APPROVAL');
        }
        assert.deepEqual(claims.map(row => row.status).sort(), ['PAID', 'PENDING_APPROVAL', 'READY_FOR_PAYMENT']);
        for (const line of claimLines) assert.ok(claimIds.has(line.reimbursementRequestId));
        for (const step of steps) {
          assert.ok(claimIds.has(step.reimbursementRequestId));
          assert.ok(memberIds.has(step.approverUserId!));
        }
        for (const payment of payments) {
          assert.ok(claimIds.has(payment.reimbursementRequestId));
          assert.ok(memberIds.has(payment.paidByUserId));
        }
        for (const payment of expensePayments) assert.ok(expenseIds.has(payment.expenseId));
        const current = expenses.filter(row => row.expenseDate.toISOString().startsWith('2026-03'));
        const recorded = current.filter(row => row.status === 'CONFIRMED');
        const sum = (selected: typeof expenses) => selected.reduce((amount, row) => amount + Math.round(Number(row.grandTotalAmount) * 100), 0) / 100;
        assert.equal(sum(recorded), 26310);
        assert.equal(sum(recorded.filter(row => row.accountHintKey === 'expense.rent')), 18000);
        assert.equal(sum(recorded.filter(row => row.accountHintKey === 'expense.meals')), 6670);
        assert.equal(sum(recorded.filter(row => row.accountHintKey === 'expense.utilities')), 1640);
        assert.equal(current.filter(row => row.status === 'READY_FOR_CONFIRMATION').length, 2);
        assert.equal(sum(current.filter(row => row.status === 'READY_FOR_CONFIRMATION')), 8297.5);
        const expected = demoSampleRows(now);
        for (const row of expected.expenses.filter(row => !row.sourceClaimKey)) {
          const persisted = expenses.find(expense => expense.id === demoId(company.companyId, row.key))!;
          assert.equal(persisted.expenseDate.toISOString(), documentDate(row.date).toISOString());
          assert.equal(persisted.grandTotalAmount.toFixed(2), row.amount);
          assert.equal(persisted.status, row.status);
        }
        assert.equal(certificates[0]!.grossAmount.toFixed(2), '3500.00');
        assert.equal(certificates[0]!.withheldAmount.toFixed(2), '105.00');
        await client.taxPeriod.findFirstOrThrow({ where: { ...where, id: certificates[0]!.taxPeriodId } });
        const handoff = await client.whtCertificateHandoff.findFirstOrThrow({ where: { ...where, certificateId: certificates[0]!.id } });
        assert.equal(handoff.sourcePaymentId, demoId(company.companyId, expected.certificate.expenseKey));
        assert.equal(handoff.sourceBranchId, company.branchId);
        assert.equal(handoff.status, 'SYSTEM_ISSUED');
        for (const event of history) {
          assert.equal(event.handoffId, handoff.id);
          assert.equal(event.certificateId, certificates[0]!.id);
          assert.ok(expenseIds.has(event.expenseId!));
        }
        const prefill = handoff.prefillSnapshotJson as { expensePaymentId: string };
        assert.ok(expensePayments.some(payment => payment.id === prefill.expensePaymentId));
        const audits = await client.auditLog.findMany({ where });
        assert.ok(audits.length > 0);
        for (const entry of audits) {
          assert.equal(entry.actorUserId, company.ownerUserId);
          assert.equal((entry.metadataJson as { reason: string }).reason, 'demo_seed');
        }
      });
    }
    await t.test('replays concurrent retries without adding rows or audits', async () => {
      const auditCount = await client.auditLog.count({ where: { companyId: a.companyId } });
      await client.expenseRecord.update({ where: { id: demoId(a.companyId, 'expense-2-6') }, data: { note: 'customer reviewed this draft' } });
      await Promise.all([populateDemoCompany(client, a), populateDemoCompany(client, a)]);
      assert.equal(await client.expenseRecord.count({ where: { companyId: a.companyId } }), 32);
      assert.equal(await client.auditLog.count({ where: { companyId: a.companyId } }), auditCount);
      assert.equal((await client.expenseRecord.findUniqueOrThrow({ where: { id: demoId(a.companyId, 'expense-2-6') } })).note, 'customer reviewed this draft');
    });
    await t.test('rejects owner and branch references from the other company', async () => {
      await assert.rejects(populateDemoCompany(client, { ...a, ownerUserId: b.ownerUserId }));
      await assert.rejects(populateDemoCompany(client, { ...a, branchId: b.branchId }));
    });
    await t.test('refuses a company whose classification is not DEMO', async () => {
      await assert.rejects(client.$transaction(async tx => {
        await tx.company.update({ where: { id: a.companyId }, data: { reportClassification: 'CUSTOMER' } });
        await populateDemoCompany(tx, a);
      }), /requires a DEMO company/);
    });
  } finally {
    const companyIds = companies.map(company => company.companyId);
    const userIds = [operatorId, ...companies.flatMap(company => [company.ownerUserId,
      ...['MANAGER', 'FINANCE', 'STAFF'].map(role => demoId(company.companyId, `user-${role}`))])];
    await client.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await client.companyOnboardingRun.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.whtCertificateHistory.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.whtCertificateHandoff.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.whtCertificate.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.outboxEvent.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.expensePayment.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.expenseRecord.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.reimbursementRequest.deleteMany({ where: { companyId: { in: companyIds } } });
    await client.companyMembership.updateMany({ where: { companyId: { in: companyIds } }, data: { defaultBranchId: null } });
    await client.company.deleteMany({ where: { id: { in: companyIds } } });
    await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.$disconnect();
  }
});
