import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GetSubstituteReceiptPolicyUseCase,
  UpdateSubstituteReceiptPolicyUseCase,
} from './substitute-receipt-policy.use-case';

const ctx = {
  companyId: 'co-1', userId: 'owner-1', requestId: 'req-1', roles: ['OWNER'], permissions: ['company.setup.manage'],
} as any;

/** F6: every preview mint writes an audit row; these cases only need it to exist. */
const audit = { log: async () => undefined } as any;

describe('substitute receipt company policy', () => {
  it('returns a ready owner-self permissive cash default without a policy row', async () => {
    let reusableSignature: unknown = null;
    const repo = {
      getSignerJobTitle: async () => null,
      getSubstituteCompanyContext: async () => ({ name: 'บริษัททดสอบ', nameSource: 'REGISTERED_NAME' }),
      getSubstituteReceiptPolicy: async () => null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      findReusableSignatureAsset: async () => reusableSignature,
    } as any;
    const result = await new GetSubstituteReceiptPolicyUseCase(repo, audit).execute(ctx);
    assert.equal(result.configured, false);
    assert.equal(result.ready, true);
    assert.equal(result.approvalMode, 'OWNER_SELF');
    // R6: the code default matches the schema default; an explicit row still wins.
    assert.equal(result.cashEvidencePolicy, 'ALLOW_SUPPORTING_EVIDENCE_ONLY');
    const runtime = await new GetSubstituteReceiptPolicyUseCase(repo, audit).executeRuntime(ctx);
    assert.equal(runtime.cashEvidencePolicy, 'ALLOW_SUPPORTING_EVIDENCE_ONLY');
    // R9: the signing UI asks for an upload only while this caller has no reusable signature.
    assert.equal(runtime.hasReusableSignature, false);
    // A8: with no signature there is nothing to show, and the field must not invent one.
    assert.equal(runtime.reusableSignaturePreviewUrl, null);
    reusableSignature = { id: 'att-library', bucket: 'b', objectKey: 'k', mimeType: 'image/png' };
    const withSignature = await new GetSubstituteReceiptPolicyUseCase(repo, audit).executeRuntime(ctx);
    assert.equal(withSignature.hasReusableSignature, true);
    // A8: “ใช้ลายเซ็นที่บันทึกไว้” now shows the image the certificate will carry — served
    // same-origin by this API, because a raw cross-origin storage URL in <img src> is what ORB
    // blocked, leaving the signer certifying blind.
    assert.equal(withSignature.reusableSignaturePreviewUrl, '/api/v1/companies/co-1/expense-signatures/images/att-library');
  });

  it('allows OWNER_SELF with no approvers and rejects an empty DESIGNATED_APPROVERS list', async () => {
    let saved: any;
    const repo = {
      getSignerJobTitle: async () => null,
      getSubstituteCompanyContext: async () => ({ name: 'บริษัททดสอบ', nameSource: 'REGISTERED_NAME' }),
      getSubstituteReceiptPolicy: async () => saved ? {
        id: 'policy-1', ...saved, createdByUserId: 'owner-1', updatedByUserId: 'owner-1',
        createdAt: new Date(), updatedAt: new Date(),
      } : null,
      listEligibleSubstituteReceiptApprovers: async () => [],
      upsertSubstituteReceiptPolicy: async (input: any) => {
        saved = input;
        return {
          id: 'policy-1', ...input, createdByUserId: 'owner-1', updatedByUserId: 'owner-1',
          createdAt: new Date(), updatedAt: new Date(),
        };
      },
    } as any;
    const get = new GetSubstituteReceiptPolicyUseCase(repo, audit);
    const useCase = new UpdateSubstituteReceiptPolicyUseCase(repo, get, { log: async () => undefined } as any);
    const result = await useCase.execute(ctx, {
      approvalMode: 'OWNER_SELF', approverUserIds: [], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
    });
    assert.equal(result.ready, true);
    assert.deepEqual(saved.approverUserIds, []);
    await assert.rejects(() => useCase.execute(ctx, {
      approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: [], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
    }), /Select between 1 and 20 authorized approvers/);
  });

  it('rejects ineligible approvers and audits a valid update', async () => {
    let saved: any;
    let audited: any;
    const policy = {
      id: 'policy-1', companyId: 'co-1', approverUserIds: ['approver-1'],
      approvalMode: 'DESIGNATED_APPROVERS',
      cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE', cashEvidenceInstructions: null,
      createdByUserId: 'owner-1', updatedByUserId: 'owner-1', createdAt: new Date(), updatedAt: new Date(),
    };
    const repo = {
      getSignerJobTitle: async () => null,
      getSubstituteCompanyContext: async () => ({ name: 'บริษัททดสอบ', nameSource: 'REGISTERED_NAME' }),
      getSubstituteReceiptPolicy: async () => saved ? policy : null,
      listEligibleSubstituteReceiptApprovers: async () => [{ userId: 'approver-1', displayName: 'ผู้จัดการ' }],
      upsertSubstituteReceiptPolicy: async (input: any) => { saved = input; return policy; },
    } as any;
    const get = new GetSubstituteReceiptPolicyUseCase(repo, audit);
    const useCase = new UpdateSubstituteReceiptPolicyUseCase(repo, get, { log: async (entry: any) => { audited = entry; } } as any);
    await assert.rejects(() => useCase.execute(ctx, {
      approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['staff-1'], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
    }), /active company member/);
    const result = await useCase.execute(ctx, {
      approvalMode: 'DESIGNATED_APPROVERS', approverUserIds: ['approver-1'], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
      cashEvidenceInstructions: 'แนบใบสำคัญจ่าย',
    });
    assert.deepEqual(saved.approverUserIds, ['approver-1']);
    assert.equal(audited.riskLevel, 'HIGH');
    assert.equal(result.configured, true);
  });
});


it('combined signing is offered only to OWNER with confirm permission under OWNER_SELF', async () => {
  let approvalMode = 'OWNER_SELF';
  const repo = { getSubstituteReceiptPolicy: async () => ({ approvalMode, approverUserIds: [] }), findReusableSignatureAsset: async () => null,
    getSignerJobTitle: async () => null, getSubstituteCompanyContext: async () => ({ name: 'ร้าน', nameSource: 'REGISTERED_NAME' }) } as any;
  const useCase = new GetSubstituteReceiptPolicyUseCase(repo, audit);
  for (const roles of [['OWNER'], ['ADMIN'], ['MANAGER'], []]) {
    const result = await useCase.executeRuntime({ ...ctx, roles, permissions: ['expense.confirm'] });
    assert.equal(result.canCertifyAndApprove, roles.includes('OWNER'));
  }
  assert.equal((await useCase.executeRuntime({ ...ctx, roles: ['OWNER'], permissions: [] })).canCertifyAndApprove, false);
  approvalMode = 'DESIGNATED_APPROVERS';
  assert.equal((await useCase.executeRuntime({ ...ctx, roles: ['OWNER'], permissions: ['expense.confirm'] })).canCertifyAndApprove, false);
});

describe('R17 e-WHT setting (paid and never-paid free paths)', () => {
  async function settingHarness() {
    const { PrismaExpenseRepository } = await import('../../infrastructure/prisma-expense.repository');
    const { GetExpenseEWhtSettingUseCase, UpdateExpenseEWhtSettingUseCase } = await import('./expense-e-wht-setting.use-case');
    let row: any = null, writes = 0; const audits: any[] = [];
    const client: any = { company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) },
      $executeRaw: async () => 0, companyTaxProfile: {
        findUnique: async ({ where, select }: any) => { assert.deepEqual(where, { companyId: ctx.companyId }); assert.deepEqual(select, { eWhtUsed: true }); return row; },
        upsert: async ({ where, create, update }: any) => { assert.deepEqual(where, { companyId: ctx.companyId }); writes++; row = row ? { ...row, ...update } : create; return row; },
      }, $transaction: async (work: any) => work(client) };
    const repo = new PrismaExpenseRepository({ client } as any);
    const audit: any = { log: async (entry: any, tx: any) => { assert.equal(tx, client); audits.push(entry); } };
    return { client, audits, writes: () => writes, get: new GetExpenseEWhtSettingUseCase(repo), update: new UpdateExpenseEWhtSettingUseCase(repo, audit) };
  }
  it('defaults missing rows to false and upserts/audits only a real change', async () => {
    const h = await settingHarness();
    assert.deepEqual(await h.get.execute(ctx), { used: false });
    await h.update.execute(ctx, { used: false }); assert.equal(h.writes(), 0); assert.equal(h.audits.length, 0);
    assert.deepEqual(await h.update.execute(ctx, { used: true }), { used: true });
    await h.update.execute(ctx, { used: true }); assert.equal(h.writes(), 1); assert.equal(h.audits.length, 1);
    assert.equal(h.audits[0].action, 'company.e_wht_setting.updated'); assert.equal(h.audits[0].riskLevel, 'MEDIUM');
    assert.deepEqual(h.audits[0].metadataJson, { before: { used: false }, after: { used: true } });
    await h.update.execute(ctx, { used: false }); assert.equal(h.writes(), 2); assert.equal(h.audits.length, 2);
  });
  it('requires the specified read/manage authority and rejects malformed direct-tool input', async () => {
    const h = await settingHarness();
    await assert.rejects(() => h.get.execute({ ...ctx, permissions: [] }), (e: any) => e.getStatus() === 403);
    await h.get.execute({ ...ctx, permissions: ['expense.read_own'] });
    await assert.rejects(() => h.update.execute({ ...ctx, permissions: ['expense.review'] }, { used: true }), (e: any) => e.getStatus() === 403);
    for (const used of [null, undefined, 'true', 1]) await assert.rejects(() => h.update.execute(ctx, { used } as any), (e: any) => e.getStatus() === 400);
    assert.equal(h.writes(), 0);
  });
  it('keeps never-paid free shops outside the setting workflow even with stale grants', async () => {
    const h = await settingHarness();
    h.client.company.findUnique = async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0) } });
    h.client.billingAccount = { findMany: async () => [] }; h.client.billingInvoice = { findFirst: async () => null };
    h.client.billingReceiptGrant = { findFirst: async () => null }; h.client.packageChangeRequest = { findFirst: async () => null };
    h.client.salesAttribution = { findUnique: async () => null };
    const denied = (e: any) => e.getResponse().code === 'FREE_EXPENSE_DRAFTS_ONLY';
    await assert.rejects(() => h.get.execute(ctx), denied); await assert.rejects(() => h.update.execute(ctx, { used: true }), denied);
    assert.equal(h.writes(), 0);
  });
});

it('R17 e-WHT HTTP endpoints keep the section 7.6 permission guards', async () => {
  const { ExpenseSettingsController } = await import('../../presentation/http/expense.controller');
  const { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
  assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, ExpenseSettingsController.prototype.getEWht),
    ['company.setup.manage', 'expense.review', 'expense.confirm', 'expense.create', 'expense.update', 'expense.read', 'expense.read_related', 'expense.read_own']);
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ExpenseSettingsController.prototype.updateEWht), ['company.setup.manage']);
});
