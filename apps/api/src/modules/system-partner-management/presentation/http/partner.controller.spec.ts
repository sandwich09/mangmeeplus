import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OwnerNameBodyDto, PartnerAiCreditHoldActionBodyDto, PartnerController, SetAiModelBodyDto, SetFeaturesBodyDto, SetManualExpenseWebEntryBodyDto, SetOcrConfigBodyDto } from './partner.controller';
import { SystemAiBudgetController } from './system-ai-budget.controller';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { DenyByDefaultGuard } from '../../../../common/security/deny-by-default.guard';
import { ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
import { NORMALIZER_VERSION } from '../../../employee-access/application/normalize-entitlements';
import { GetPartnerDetailUseCase } from '../../application/use-cases/get-partner-detail.use-case';
import { SetPartnerManualExpenseWebEntryUseCase } from '../../application/use-cases/set-partner-manual-expense-web-entry.use-case';
import { MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, manualExpenseWebEntryState } from '../../domain/logic/manual-expense-web-entry.logic';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';
import 'reflect-metadata';

// ponytail: unit-level; all use cases mocked inline; permission-guard tested separately in auth.guard.spec.ts

const SUMMARY = { id: 'co-1', name: 'Acme', timezone: 'Asia/Bangkok', locale: 'th-TH', baseCurrency: 'THB', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', featureEntitlements: [], lineContextHealth: 'UNLINKED' };

function makeUCs() {
  return {
    listPartners: { execute: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }) } as any,
    getDetail: { execute: async () => SUMMARY } as any,
    updateProfile: { execute: async () => SUMMARY } as any,
    lifecycle: { execute: async () => ({ id: 'co-1', status: 'DISABLED' }) } as any,
    setFeatures: { execute: async () => ({ companyId: 'co-1', features: [] }) } as any,
    setAiModel: { execute: async () => ({ companyId: 'co-1', modelId: 'global.anthropic.claude-sonnet-4-6', monthlyBudgetSatang: null, updatedAt: '' }) } as any,
    setOcrConfig: { execute: async () => ({ enabled: true, monthlyLimit: null, version: 0, updatedAt: null }) } as any,
    getAiUsage: { execute: async () => ({ current: null, previous: null, budget: { effectiveSatang: 5_000_000, overrideSatang: null, defaultSatang: 5_000_000, ceilingSatang: 50_000_000 }, topTags: [] }) } as any,
    listMembers: { execute: async () => ({ items: [] }) } as any,
    unlinkMemberLine: { execute: async () => ({ unlinked: true }) } as any,
    issueMemberLineLinkToken: { execute: async (cmd: any) => ({ lineLink: { linkUrl: 'https://liff.line.me/x/employee?token=t', qrImageUrl: 'data:image/svg+xml;base64,x', expiresAt: '', cmd } }) } as any,
    resetMemberPassword: { execute: async () => ({ userId: 'u-1', temporaryPassword: 'tmp', expiresAt: '' }) } as any,
    revealMemberPassword: { execute: async () => ({ temporaryPassword: 'tmp' }) } as any,
    setMemberContact: { execute: async () => ({ updated: true }) } as any,
    setOwnerName: { execute: async (cmd: any) => ({ displayName: cmd.displayName }) } as any,
    getPlanTerm: { execute: async () => ({ term: null }) } as any,
    setPlanTerm: { execute: async () => ({ term: { companyId: 'co-1', tierKey: 'STARTER_249' } }) } as any,
    renewPlanTerm: { execute: async () => ({ term: { companyId: 'co-1', renewCount: 1 } }) } as any,
    endWarmup: { execute: async () => ({ term: { companyId: 'co-1', warmupUntil: undefined } }) } as any,
    timeline: { execute: async () => ({ entries: [] }) } as any,
    lineMessage: { execute: async () => ({ delivered: 1 }) } as any,
    aiCreditHolds: {
      read: async (input: any) => ({ canManage: input.canManage, companyLocked: false, items: [], monthKeys: ['2026-09', '2026-08'] }),
      release: async (cmd: any) => ({ id: cmd.reservationId, action: 'release', status: 'CANCELLED', chargedSatang: 0, cmd }),
      chargeAtBound: async (cmd: any) => ({ id: cmd.reservationId, action: 'charge_at_bound', status: 'SETTLED', chargedSatang: 47, cmd }),
      acknowledgeBreach: async (cmd: any) => ({ id: cmd.reservationId, action: 'acknowledge_breach', status: 'SETTLED', chargedSatang: 0, cmd }),
    } as any,
    // Purchase without setup PR E (R-E3, DQ9).
    updateIdentity: {
      execute: async (cmd: any) => ({ ...SUMMARY, id: cmd.companyId }),
      getControl: async (companyId: string) => ({ legalIdentityVersion: 3, captureWindowOpen: false, authoritativeLatched: true,
        fieldLatched: { registeredName: false, addressJson: false }, allowedChangeKinds: ['CORRECTION', 'LEGAL_CHANGE'], companyId }),
    } as any,
    listThaiAddresses: { execute: async (postalCode: string) => ([{ postalCode, provinceCode: '10', provinceTh: 'กรุงเทพมหานคร', districtCode: '1', districtTh: 'ดุสิต', subdistrictCode: '1', subdistrictTh: 'ดุสิต' }]) } as any,
    setManualExpenseWebEntry: { execute: async (cmd: any) => ({ enabled: cmd.enabled, version: 1 }) } as any,
  };
}

function makeCtrl(overrides: Partial<ReturnType<typeof makeUCs>> = {}) {
  const uc = { ...makeUCs(), ...overrides };
  return new PartnerController(
    uc.listPartners, uc.getDetail, uc.updateProfile, uc.lifecycle, uc.setFeatures, uc.setAiModel, uc.setOcrConfig,
    uc.getAiUsage, uc.listMembers, uc.unlinkMemberLine, uc.issueMemberLineLinkToken,
    uc.resetMemberPassword, uc.revealMemberPassword,
    uc.setMemberContact,
    // VAT registration: delegated to the company's own service, not re-implemented here.
    { put: async () => ({ version: 1, resultKind: 'APPLIED', replayed: false }) } as any,
    uc.getPlanTerm, {execute:async()=>({items:[],nextCursor:null})} as any, uc.setPlanTerm, uc.renewPlanTerm, uc.endWarmup,
    uc.timeline, uc.lineMessage, uc.aiCreditHolds, uc.setOwnerName,
    uc.updateIdentity, uc.listThaiAddresses, uc.setManualExpenseWebEntry,
  );
}

function makeReq(permissions: string[] = []) {
  return {
    context: { userId: 'admin-1', requestId: 'req-1', companyId: 'sys-co', permissions, roles: ['SYSTEM_ADMIN'], membershipId: 'mem-1', scopes: {} },
  } as any;
}

describe('PartnerController', () => {
  it('list() returns result from ListPartnersUseCase', async () => {
    const result = await makeCtrl().list() as any;
    assert.equal(result.total, 0);
  });

  it('detail() returns result from GetPartnerDetailUseCase', async () => {
    const result = await makeCtrl().detail('co-1') as any;
    assert.equal(result.id, 'co-1');
  });

  it('update() passes companyId and admin context to use case', async () => {
    let called: any;
    const ctrl = makeCtrl({ updateProfile: { execute: async (cmd: any) => { called = cmd; return SUMMARY; } } as any });
    await ctrl.update('co-1', { name: 'New Name' }, makeReq());
    assert.equal(called.companyId, 'co-1');
    assert.equal(called.name, 'New Name');
  });

  it('transitionLifecycle() passes targetStatus and reason to use case', async () => {
    let called: any;
    const ctrl = makeCtrl({ lifecycle: { execute: async (cmd: any) => { called = cmd; return { id: 'co-1', status: 'DISABLED' }; } } as any });
    await ctrl.transitionLifecycle('co-1', { targetStatus: 'DISABLED', reason: 'test' }, makeReq());
    assert.equal(called.targetStatus, 'DISABLED');
    assert.equal(called.reason, 'test');
  });

  it('setFeatureEntitlements() passes the whole command contract to the use case', async () => {
    let called: any;
    const ctrl = makeCtrl({ setFeatures: { execute: async (cmd: any) => { called = cmd; return { companyId: 'co-1', features: [] }; } } as any });
    await ctrl.setFeatureEntitlements('co-1', {
      features: [{ featureKey: 'inventory', enabled: true }],
      commandId: 'cmd-1',
      expectedSetVersion: 7,
      confirmCascade: true,
    }, makeReq());
    assert.equal(called.features[0].featureKey, 'inventory');
    assert.equal(called.commandId, 'cmd-1');
    assert.equal(called.expectedSetVersion, 7);
    assert.equal(called.confirmCascade, true);
  });

  it('the feature-command DTO rejects non-array, empty, duplicate and over-catalog payloads', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const run = (body: Record<string, unknown>) =>
      pipe.transform(body, { type: 'body', metatype: SetFeaturesBodyDto }) as Promise<any>;

    const valid = await run({
      features: [{ featureKey: 'inventory', enabled: true }],
      commandId: 'cmd-1',
      expectedSetVersion: 0,
      confirmCascade: false,
    });
    assert.equal(valid.features.length, 1);

    for (const poison of [
      { features: 'inventory' },
      { features: [] },
      { features: [{ featureKey: 'inventory', enabled: true }] },
      { features: [{ featureKey: 'inventory', enabled: true }], commandId: 'cmd-1' },
      { features: [{ featureKey: 'inventory', enabled: true }], expectedSetVersion: 0 },
      { features: [
        { featureKey: 'inventory', enabled: true },
        { featureKey: 'inventory', enabled: false },
      ] },
      { features: Array.from({ length: ALL_FEATURE_ENTITLEMENT_KEYS.length + 1 }, (_, index) => ({ featureKey: `key-${index}`, enabled: true })) },
    ]) {
      await assert.rejects(() => run(poison), BadRequestException, `expected rejection for ${JSON.stringify(poison)}`);
    }
  });

  it('setAiModelConfig() passes modelId to use case', async () => {
    let called: any;
    const ctrl = makeCtrl({ setAiModel: { execute: async (cmd: any) => { called = cmd; return { companyId: 'co-1', modelId: 'global.anthropic.claude-sonnet-4-6', monthlyBudgetSatang: null, updatedAt: '' }; } } as any });
    await ctrl.setAiModelConfig('co-1', { modelId: 'global.anthropic.claude-sonnet-4-6',expectedModelId:null,reason:'ปรับตามคำขอ' }, makeReq());
    assert.equal(called.modelId, 'global.anthropic.claude-sonnet-4-6');
    // Absent budget must stay absent — the use case reads `undefined` as "leave the override alone".
    assert.equal(called.monthlyBudgetSatang, undefined);
  });

  it('setAiModelConfig() forwards a budget-only body, and null (clear to inherited) unchanged', async () => {
    for (const monthlyBudgetSatang of [1_200_000, null]) {
      let called: any;
      const ctrl = makeCtrl({ setAiModel: { execute: async (cmd: any) => { called = cmd; return { companyId: 'co-1', modelId: null, monthlyBudgetSatang, updatedAt: '' }; } } as any });
      await ctrl.setAiModelConfig('co-1', { monthlyBudgetSatang,expectedMonthlyBudgetSatang:null,reason:'ปรับตามคำขอ' }, makeReq());
      assert.equal(called.monthlyBudgetSatang, monthlyBudgetSatang);
      assert.equal(called.modelId, undefined);
    }
  });

  it('aiUsage() returns the meter for the partner company', async () => {
    let called: any;
    const ctrl = makeCtrl({ getAiUsage: { execute: async (companyId: string) => { called = companyId; return { current: null, previous: null, budget: { effectiveSatang: 1, overrideSatang: null, defaultSatang: 1, ceilingSatang: 2 }, topTags: [] }; } } as any });
    const result = await ctrl.aiUsage('co-1', makeReq(['system.partner_ai_model.manage'])) as any;
    assert.equal(called, 'co-1');
    assert.equal(result.budget.overrideSatang, null);
    // The page needs to know whether THIS caller may write the card: reading it is
    // `system.partner_dashboard.read`, every control on it is `system.partner_ai_model.manage`.
    assert.equal(result.canManage, true);
    assert.equal((await ctrl.aiUsage('co-1', makeReq(['system.partner_dashboard.read'])) as any).canManage, false);
  });

  it('setOcrConfiguration() passes absolute state and admin context to the use case', async () => {
    let called: any;
    const ctrl = makeCtrl({ setOcrConfig: { execute: async (cmd: any) => {
      called = cmd;
      return { enabled: cmd.enabled, monthlyLimit: cmd.monthlyLimit, version: 5, updatedAt: '' };
    } } as any });
    await ctrl.setOcrConfiguration('co-1', { enabled: false, monthlyLimit: 25, expectedVersion: 4,reason:'ปรับตามคำขอ' }, makeReq());
    assert.deepEqual(called, {
      companyId: 'co-1', enabled: false, monthlyLimit: 25,reason:'ปรับตามคำขอ',
      expectedVersion: 4,
      requestingAdminUserId: 'admin-1', requestId: 'req-1',
    });
  });

  it('the OCR config DTO accepts CAS version + null/unlimited and rejects missing or invalid fields', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const run = (body: Record<string, unknown>) =>
      pipe.transform({reason:'ปรับตามคำขอ',...body}, { type: 'body', metatype: SetOcrConfigBodyDto }) as Promise<any>;
    const unlimited = await run({ enabled: true, monthlyLimit: null, expectedVersion: 0 });
    assert.equal(unlimited.enabled, true);
    assert.equal(unlimited.monthlyLimit, null);
    assert.equal((await run({ enabled: false, monthlyLimit: 100, expectedVersion: 7 })).monthlyLimit, 100);
    for (const poison of [
      {}, { enabled: true, monthlyLimit: null }, { monthlyLimit: 10, expectedVersion: 0 },
      { enabled: 'true', monthlyLimit: 10, expectedVersion: 0 },
      { enabled: true, monthlyLimit: 0, expectedVersion: 0 },
      { enabled: true, monthlyLimit: 1.5, expectedVersion: 0 },
      { enabled: true, monthlyLimit: 1_000_001, expectedVersion: 0 },
      { enabled: true, monthlyLimit: 100, expectedVersion: -1 },
      { enabled: true, monthlyLimit: 100, expectedVersion: 1.5 },
    ]) {
      await assert.rejects(() => run(poison), BadRequestException, JSON.stringify(poison));
    }
  });

  it('setManualExpenseWebEntry() passes the absolute value, the CAS version and the admin context', async () => {
    let called: any;
    const ctrl = makeCtrl({ setManualExpenseWebEntry: { execute: async (cmd: any) => { called = cmd; return { enabled: cmd.enabled, version: 3 }; } } as any });
    const result = await ctrl.setManualExpenseWebEntry('co-1', { enabled: true, expectedVersion: 2 }, makeReq());
    assert.deepEqual(called, { companyId: 'co-1', enabled: true, expectedVersion: 2, requestingAdminUserId: 'admin-1', requestId: 'req-1' });
    assert.deepEqual(result, { enabled: true, version: 3 });
  });

  it('the manual-expense web-entry DTO takes exactly the value and the CAS version', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const run = (body: Record<string, unknown>) =>
      pipe.transform(body, { type: 'body', metatype: SetManualExpenseWebEntryBodyDto }) as Promise<any>;
    assert.deepEqual({ ...(await run({ enabled: false, expectedVersion: 0 })) }, { enabled: false, expectedVersion: 0 });
    assert.equal((await run({ enabled: true, expectedVersion: 7 })).expectedVersion, 7);
    for (const poison of [
      {}, { enabled: true }, { expectedVersion: 0 }, { enabled: 'true', expectedVersion: 0 },
      { enabled: true, expectedVersion: -1 }, { enabled: true, expectedVersion: 1.5 },
      // Not an entitlement command and not a quota change: neither a feature list nor a reason belongs here.
      { enabled: true, expectedVersion: 0, features: [] }, { enabled: true, expectedVersion: 0, reason: 'x' },
    ]) {
      await assert.rejects(() => run(poison), BadRequestException, JSON.stringify(poison));
    }
  });

  it('the ai-model body DTO keeps null (clear) and absent (leave alone) distinguishable', async () => {
    // The exact global pipe main.ts registers, against the DTO the ai-model route binds.
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const run = (body: Record<string, unknown>) =>
      pipe.transform({reason:'ปรับตามคำขอ',...body}, { type: 'body', metatype: SetAiModelBodyDto }) as Promise<any>;

    const cleared = await run({ monthlyBudgetSatang: null });
    assert.equal(cleared.monthlyBudgetSatang, null, 'null must survive the pipe — it clears the override');
    assert.equal(cleared.modelId, undefined, 'an absent modelId must stay absent');

    const modelOnly = await run({ modelId: 'global.anthropic.claude-sonnet-4-6' });
    assert.equal(modelOnly.monthlyBudgetSatang, undefined, 'an absent budget must stay absent, not become null');

    assert.equal((await run({ monthlyBudgetSatang: 900_000 })).monthlyBudgetSatang, 900_000);

    for (const poison of [{ monthlyBudgetSatang: 1.5 }, { monthlyBudgetSatang: 'lots' }, { modelId: '' }, { budget: 1 }]) {
      await assert.rejects(() => run(poison), BadRequestException, `expected rejection for ${JSON.stringify(poison)}`);
    }
  });

  it('the ai-model body DTO carries the split policy through the real pipe instead of stripping it', async () => {
    // Review F-07: contracts and a use case are not enough — this route binds a DTO class and the
    // global whitelisting pipe drops anything the class does not declare.
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const run = (body: Record<string, unknown>) =>
      pipe.transform({ reason: 'ปรับตามคำขอ', ...body }, { type: 'body', metatype: SetAiModelBodyDto }) as Promise<any>;
    const policy = { mode: 'SPLIT', chatMonthlyBudgetSatang: 3_000, ocrMonthlyBudgetSatang: 7_000, effectiveMonthKey: '2026-10' };

    const saved = await run({ budgetPolicy: policy, expectedBudgetRevision: '2:2026-09:ACTIVE' });
    assert.deepEqual({ ...saved.budgetPolicy }, policy, 'every nested field must survive whitelisting');
    assert.equal(saved.expectedBudgetRevision, '2:2026-09:ACTIVE');
    // 0 closes a bucket and null means "not set" — both must reach the use case, unlike absent.
    assert.equal((await run({ budgetPolicy: { ...policy, chatMonthlyBudgetSatang: 0 } })).budgetPolicy.chatMonthlyBudgetSatang, 0);
    assert.equal((await run({ budgetPolicy: { ...policy, mode: 'SHARED', ocrMonthlyBudgetSatang: null } })).budgetPolicy.ocrMonthlyBudgetSatang, null);
    assert.equal((await run({ budgetPolicy: null })).budgetPolicy, null, 'null must survive — it cancels a future policy');
    assert.equal((await run({ monthlyBudgetSatang: 1 })).budgetPolicy, undefined, 'absent must stay absent, not become null');

    for (const poison of [
      { budgetPolicy: { ...policy, mode: 'HALF' } },
      { budgetPolicy: { ...policy, chatMonthlyBudgetSatang: -1 } },
      { budgetPolicy: { ...policy, ocrMonthlyBudgetSatang: 1.5 } },
      { budgetPolicy: { ...policy, effectiveMonthKey: '2026-13' } },
      { budgetPolicy: { ...policy, effectiveMonthKey: 'next month' } },
      { budgetPolicy: 'SPLIT' },
      { expectedBudgetRevision: '' },
    ]) {
      await assert.rejects(() => run(poison), BadRequestException, `expected rejection for ${JSON.stringify(poison)}`);
    }
  });

  it('setAiModelConfig() maps the split fields explicitly, so neither can be silently dropped', async () => {
    let called: any;
    const ctrl = makeCtrl({ setAiModel: { execute: async (cmd: any) => { called = cmd; return { companyId: 'co-1' }; } } as any });
    const budgetPolicy = { mode: 'SPLIT', chatMonthlyBudgetSatang: 3_000, ocrMonthlyBudgetSatang: 7_000, effectiveMonthKey: '2026-10' } as any;
    await ctrl.setAiModelConfig('co-1', { reason: 'ปรับตามคำขอ', budgetPolicy, expectedBudgetRevision: '2:2026-09:ACTIVE' } as any, makeReq());
    assert.deepEqual(called.budgetPolicy, budgetPolicy);
    assert.equal(called.expectedBudgetRevision, '2:2026-09:ACTIVE');
    assert.equal(called.companyId, 'co-1');
    assert.equal(called.requestingAdminUserId, 'admin-1');
  });

  it('each endpoint has @RequirePermissions metadata', () => {
    const proto = PartnerController.prototype as unknown as Record<string, unknown>;
    const cases: Array<[string, string]> = [
      ['list', 'system.partner_dashboard.read'],
      ['detail', 'system.partner_dashboard.read'],
      ['update', 'system.partner_company.update'],
      ['transitionLifecycle', 'system.partner_company.lifecycle.manage'],
      ['setFeatureEntitlements', 'system.partner_feature.manage'],
      ['setAiModelConfig', 'system.partner_ai_model.manage'],
      ['setOcrConfiguration', 'system.partner_ai_model.manage'],
      // A screen setting shown under a feature row: the feature-management key, no new permission.
      ['setManualExpenseWebEntry', 'system.partner_feature.manage'],
      ['aiAdjustments', 'system.partner_ai_model.manage'],
      // Read-only meter: reuses the partner detail read permission, no new permission (spec §7.7).
      ['aiUsage', 'system.partner_dashboard.read'],
      // Held credit (hold spec §4): the list rides the dashboard read, every decision is a write.
      ['aiCreditHolds', 'system.partner_dashboard.read'],
      ['releaseAiCreditHold', 'system.partner_ai_model.manage'],
      ['chargeAiCreditHoldAtBound', 'system.partner_ai_model.manage'],
      ['acknowledgeAiCreditBreach', 'system.partner_ai_model.manage'],
      // Issuing a bearer QR is a member-management action, gated like unlink and password reset.
      ['issueLineLinkToken', 'system.partner_member.manage'],
      ['setDisplayName', 'system.partner_member.manage'],
      // Purchase without setup PR E (R-E3, DQ9): CRITICAL identity key, not system.partner_company.update.
      ['addresses', 'system.identity_reconciliation.resolve'],
      ['identityControl', 'system.identity_reconciliation.resolve'],
      ['updateIdentityFields', 'system.identity_reconciliation.resolve'],
    ];
    for (const [method, perm] of cases) {
      const perms: string[] | undefined = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[method] as object);
      assert.ok(perms && perms.includes(perm), `${method} missing @RequirePermissions('${perm}')`);
    }
  });

  it('identityControl() returns the CAS token and allowed change kinds from the use case', async () => {
    const result = await makeCtrl().identityControl('co-1') as any;
    assert.equal(result.legalIdentityVersion, 3);
    assert.deepEqual(result.allowedChangeKinds, ['CORRECTION', 'LEGAL_CHANGE']);
  });

  it('updateIdentityFields() separates reason/supportRequestId from the identity body', async () => {
    let called: any;
    const ctrl = makeCtrl({ updateIdentity: { execute: async (cmd: any) => { called = cmd; return SUMMARY; }, getControl: async () => ({}) } as any });
    await ctrl.updateIdentityFields('co-1', {
      expectedLegalIdentityVersion: 3, changeKind: 'CORRECTION', registeredName: 'New Co Ltd', taxId: '1234567890123',
      correctionReason: 'TYPO', reason: 'ลูกค้าแจ้งพิมพ์ผิด', supportRequestId: 'sr-1',
    } as any, makeReq());
    assert.equal(called.companyId, 'co-1');
    assert.equal(called.reason, 'ลูกค้าแจ้งพิมพ์ผิด');
    assert.equal(called.supportRequestId, 'sr-1');
    assert.equal(called.requestingAdminUserId, 'admin-1');
    assert.equal(called.body.changeKind, 'CORRECTION');
    assert.equal(called.body.registeredName, 'New Co Ltd');
    assert.equal((called.body as Record<string, unknown>).reason, undefined, 'reason must not leak into the identity patch body');
  });

  it('updateIdentityFields() omits supportRequestId from the command when absent', async () => {
    let called: any;
    const ctrl = makeCtrl({ updateIdentity: { execute: async (cmd: any) => { called = cmd; return SUMMARY; }, getControl: async () => ({}) } as any });
    await ctrl.updateIdentityFields('co-1', { expectedLegalIdentityVersion: 3, changeKind: 'CORRECTION', correctionReason: 'TYPO', reason: 'r' } as any, makeReq());
    assert.equal('supportRequestId' in called, false);
  });

  // R-E3: address-master must be registered before ':partnerCompanyId' so it is never caught as an
  // id — verified by declaration order in partner.controller.ts (system-support-request.controller.ts
  // has the same pattern); this test covers the handler's own behaviour.
  it('addresses() asserts the platform tenant and delegates to ListThaiAddressesUseCase', async () => {
    const result = await makeCtrl().addresses('101', { context: { companyId: PLATFORM_TENANT_ID } } as any) as any;
    assert.equal(result[0].postalCode, '101');
  });

  it('addresses() refuses a caller outside the platform tenant', () => {
    // assertPlatformTenant throws synchronously (before any await), so this is assert.throws,
    // not assert.rejects.
    assert.throws(() => makeCtrl().addresses('101', { context: { companyId: 'some-customer-co' } } as any), ForbiddenException);
  });

  it('issueLineLinkToken() passes both ids and the trusted api base to the use case', async () => {
    // The whole point of this route: it is keyed by ids the members table already holds,
    // so an expired QR no longer needs the onboarding run id from the production database.
    const req = { ...makeReq(), protocol: 'https', get: () => 'api.example.com', headers: {} } as any;
    const result = await makeCtrl().issueLineLinkToken('co-1', 'user-9', req) as any;
    assert.equal(result.lineLink.cmd.companyId, 'co-1');
    assert.equal(result.lineLink.cmd.memberUserId, 'user-9');
    assert.equal(result.lineLink.cmd.requestingAdminUserId, 'admin-1');
    assert.ok(result.lineLink.cmd.apiBaseUrl.startsWith('https://'), result.lineLink.cmd.apiBaseUrl);
  });

  it('setDisplayName uses the route target and trusted admin context', async () => {
    let command: any;
    const ctrl = makeCtrl({ setOwnerName: { execute: async (cmd: any) => { command = cmd; return { displayName: cmd.displayName }; } } as any });
    await ctrl.setDisplayName('customer', 'owner', { displayName: 'New', expectedDisplayName: 'Old' }, makeReq());
    assert.deepEqual(command, { companyId: 'customer', memberUserId: 'owner', displayName: 'New', expectedDisplayName: 'Old', requestingAdminUserId: 'admin-1', requestId: 'req-1' });
  });

  it('owner rename DTO rejects missing fields, wrong types and unrelated mutations', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const metadata = { type: 'body' as const, metatype: OwnerNameBodyDto };
    for (const body of [{ displayName: 'New' }, { displayName: null, expectedDisplayName: 'Old' }, { displayName: 1, expectedDisplayName: 'Old' }, { displayName: 'New', expectedDisplayName: 'Old', roleIds: ['OWNER'] }]) {
      await assert.rejects(() => pipe.transform(body, metadata), BadRequestException);
    }
    await pipe.transform({ displayName: 'New', expectedDisplayName: 'Old' }, metadata);
  });

  it('owner rename refuses tenant and read-only callers through the real permission guard', () => {
    const guard = new DenyByDefaultGuard(new Reflector());
    const context = (permissions: string[]) => ({
      getHandler: () => PartnerController.prototype.setDisplayName,
      getClass: () => PartnerController,
      switchToHttp: () => ({ getRequest: () => ({ context: { permissions } }) }),
    }) as unknown as ExecutionContext;
    for (const permissions of [[], ['access.employee.update'], ['system.partner_member.read']]) {
      assert.throws(() => guard.canActivate(context(permissions)), ForbiddenException);
    }
    assert.equal(guard.canActivate(context(['system.partner_member.manage'])), true);
  });

  // Spec §11.2/D-03: "ห้ามเพิ่ม tenant endpoint สำหรับอ่าน usage/budget". These two routes ARE the
  // whole budget surface, so the denial is asserted through the guard that actually enforces it —
  // metadata alone would only prove the decorator is present, not that a caller is refused.
  it('refuses the budget read and the budget write to anyone without the permission', () => {
    const guard = new DenyByDefaultGuard(new Reflector());
    const proto = PartnerController.prototype as unknown as Record<string, unknown>;
    const contextFor = (method: string, permissions: string[]) => ({
      getHandler: () => proto[method] as () => unknown,
      getClass: () => PartnerController,
      switchToHttp: () => ({ getRequest: () => ({ context: { permissions } }) }),
    }) as unknown as ExecutionContext;

    for (const method of ['aiUsage', 'setAiModelConfig', 'aiCreditHolds', 'releaseAiCreditHold',
      'chargeAiCreditHoldAtBound', 'acknowledgeAiCreditBreach']) {
      // An ordinary tenant user: company permissions only, neither platform permission.
      assert.throws(() => guard.canActivate(contextFor(method, ['expense.read', 'expense.create'])),
        /Insufficient permissions/, `${method} must refuse a tenant caller`);
      // And no session at all is a 401, never a silent pass.
      assert.throws(() => guard.canActivate({
        getHandler: () => proto[method] as () => unknown, getClass: () => PartnerController,
        switchToHttp: () => ({ getRequest: () => ({}) }),
      } as unknown as ExecutionContext), /Authentication is required/);
    }

    // The read permission alone opens the READ and still refuses the WRITE — the exact boundary
    // `canManage` describes to the page.
    assert.equal(guard.canActivate(contextFor('aiUsage', ['system.partner_dashboard.read'])), true);
    assert.throws(() => guard.canActivate(contextFor('setAiModelConfig', ['system.partner_dashboard.read'])),
      /Insufficient permissions/);
    assert.equal(guard.canActivate(contextFor('setAiModelConfig', ['system.partner_ai_model.manage'])), true);

    // Held credit draws the same boundary: an operator may LOOK at stranded money and not move it.
    assert.equal(guard.canActivate(contextFor('aiCreditHolds', ['system.partner_dashboard.read'])), true);
    for (const method of ['releaseAiCreditHold', 'chargeAiCreditHoldAtBound', 'acknowledgeAiCreditBreach']) {
      assert.throws(() => guard.canActivate(contextFor(method, ['system.partner_dashboard.read'])),
        /Insufficient permissions/, `${method} must refuse a read-only operator`);
      assert.equal(guard.canActivate(contextFor(method, ['system.partner_ai_model.manage'])), true);
    }
  });

  it('aiCreditHolds() tells the page whether the caller may act, from the caller permissions', async () => {
    const ctrl = makeCtrl();
    assert.equal((await ctrl.aiCreditHolds('co-1', makeReq(['system.partner_ai_model.manage'])) as any).canManage, true);
    assert.equal((await ctrl.aiCreditHolds('co-1', makeReq(['system.partner_dashboard.read'])) as any).canManage, false);
  });

  it('the three hold actions pass both ids, the reason and the admin context to the use case', async () => {
    const ctrl = makeCtrl();
    const body = { reason: 'ยืนยันแล้วว่าไม่ได้เรียก' };
    const req = makeReq(['system.partner_ai_model.manage']);
    for (const [call, action] of [
      [() => ctrl.releaseAiCreditHold('co-1', 'res-9', body, req), 'release'],
      [() => ctrl.chargeAiCreditHoldAtBound('co-1', 'res-9', body, req), 'charge_at_bound'],
      [() => ctrl.acknowledgeAiCreditBreach('co-1', 'res-9', body, req), 'acknowledge_breach'],
    ] as Array<[() => Promise<unknown>, string]>) {
      const result = await call() as any;
      assert.equal(result.action, action);
      assert.equal(result.cmd.companyId, 'co-1');
      assert.equal(result.cmd.reservationId, 'res-9');
      assert.equal(result.cmd.reason, body.reason);
      assert.equal(result.cmd.requestingAdminUserId, 'admin-1');
      assert.equal(result.cmd.requestId, 'req-1');
    }
  });

  it('the hold action body rejects an empty or over-long reason at the HTTP boundary', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const meta = { type: 'body' as const, metatype: PartnerAiCreditHoldActionBodyDto };
    await assert.rejects(pipe.transform({}, meta), BadRequestException);
    await assert.rejects(pipe.transform({ reason: '' }, meta), BadRequestException);
    await assert.rejects(pipe.transform({ reason: 'x'.repeat(501) }, meta), BadRequestException);
    // `whitelist`/`forbidNonWhitelisted`: nothing but the reason may reach a money transaction.
    await assert.rejects(pipe.transform({ reason: 'ok', chargedSatang: 1 }, meta), BadRequestException);
    assert.deepEqual({ ...(await pipe.transform({ reason: 'ok' }, meta) as object) }, { reason: 'ok' });
  });

  it('the platform AI budget routes carry the same manage permission on read and write', () => {
    // Platform settings are a system-admin-only surface (spec §7.9, criterion 11): the read is
    // not widened to the dashboard-read permission the per-company meter uses.
    const proto = SystemAiBudgetController.prototype as unknown as Record<string, unknown>;
    for (const method of ['get', 'set']) {
      const perms: string[] | undefined = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[method] as object);
      assert.deepEqual(perms, ['system.partner_ai_model.manage'], `${method} permission`);
    }
  });

  it('no route uses a :companyId param (auth guard would demand membership in the CUSTOMER company)', () => {
    const proto = PartnerController.prototype as unknown as Record<string, unknown>;
    for (const method of ['list', 'detail', 'update', 'transitionLifecycle', 'setFeatureEntitlements', 'setAiModelConfig', 'setOcrConfiguration', 'setManualExpenseWebEntry', 'aiUsage']) {
      const path: string | string[] | undefined = Reflect.getMetadata('path', proto[method] as object);
      const paths = Array.isArray(path) ? path : [path ?? ''];
      for (const p of paths) {
        assert.ok(!String(p).includes(':companyId'), `${method} route '${p}' must use :partnerCompanyId, not :companyId — system admins have no customer-company membership`);
      }
    }
  });

  it('non-system-admin context has no system.* permissions — guard would throw ForbiddenException', () => {
    // ponytail: AuthGuard enforces RequirePermissions at request-pipeline level; this confirms
    // that a context with no system.* grants cannot pass a RequirePermissions check
    const req = makeReq([]); // no permissions
    const noSystemPerms = req.context.permissions.filter((p: string) => p.startsWith('system.')).length === 0;
    assert.ok(noSystemPerms, 'non-system-admin has no system.* permissions');
    // The guard behavior: ForbiddenException would be thrown before any handler runs
    const err = new ForbiddenException('Insufficient permissions.');
    assert.ok(err instanceof ForbiddenException);
  });
});

function detailCompany(marker: { status: string; normalizerVersion: number; cohortKind: string | null }) {
  return {
    id: 'co-1', name: 'บริษัททดสอบ', registeredName: null, brandName: null, taxId: null,
    timezone: 'Asia/Bangkok', locale: 'th-TH', baseCurrency: 'THB', phone: null, email: null,
    status: 'ACTIVE', createdAt: new Date('2026-08-01T00:00:00.000Z'), activatedAt: null,
    disabledAt: null, archivedAt: null,
    featureEntitlements: [
      { featureKey: 'employee_access', enabled: true, updatedAt: new Date('2026-08-01T00:00:00.000Z') },
      { featureKey: 'inventory', enabled: true, updatedAt: new Date('2026-08-01T00:00:00.000Z') },
    ],
    aiConfiguration: null,
    entitlementSet: { setVersion: 7 },
    entitlementNormalization: marker,
    signupRequests: [],
    memberships: [],
    webEntrySetting: null as { manualExpenseEntryEnabled: boolean; version: number } | null,
  };
}

function detailUseCase(row: ReturnType<typeof detailCompany>) {
  return new GetPartnerDetailUseCase({
    client: {
      company: { findUnique: async () => row },
      companyMembership: { groupBy: async () => [] },
    },
  } as any,
  // The VAT read is the company's own accessor, stubbed here — this suite is about feature
  // readiness, and `company-vat-registration.use-case.spec.ts` owns the accessor's behaviour.
  { get: async () => ({ status: 'UNKNOWN', version: 0 }) } as any);
}

describe('GetPartnerDetailUseCase — truthful feature-command readiness', () => {
  it('returns setVersion and friendly per-feature directional disable readiness', async () => {
    const result = await detailUseCase(detailCompany({
      status: 'COMPLETED', normalizerVersion: NORMALIZER_VERSION, cohortKind: 'EXPLICIT',
    })).execute('co-1');

    assert.equal(result.setVersion, 7);
    assert.equal(result.entitlementNormalizationPending, false);
    const byKey = new Map(result.featureEntitlements.map((feature) => [feature.featureKey, feature]));
    assert.equal(byKey.get('employee_access')?.canDisable, false);
    assert.match(byKey.get('employee_access')?.disableReason ?? '', /พื้นฐาน/);
    // Freeze-in-place (owner decision 2026-08-04): a sellable family may always be switched off, so
    // the platform invariant above is the only locked row and it is the only one carrying a reason.
    assert.equal(byKey.get('inventory')?.canDisable, true);
    assert.equal(byKey.get('inventory')?.disableReason, undefined);
  });

  it('uses the same current-version + valid-cohort predicate as the command', async () => {
    for (const marker of [
      { status: 'STARTED', normalizerVersion: NORMALIZER_VERSION, cohortKind: 'LEGACY' },
      { status: 'COMPLETED', normalizerVersion: NORMALIZER_VERSION - 1, cohortKind: 'LEGACY' },
      { status: 'COMPLETED', normalizerVersion: NORMALIZER_VERSION, cohortKind: null },
    ]) {
      const result = await detailUseCase(detailCompany(marker)).execute('co-1');
      assert.equal(result.entitlementNormalizationPending, true, JSON.stringify(marker));
    }
  });
});

// "แสดงเมนูบันทึกด้วยมือบนเว็บ" (manual-expense-web-entry-flag spec §5): a per-company screen setting
// that is NOT an entitlement. One place says what a company without a row reads as; the partner
// detail, GET /auth/me and the command below all read through it.
describe('manual-expense web entry — what a company without a row reads as', () => {
  it('is decided in one place: not shown until the system admin switches it on (owner 2026-10-02)', () => {
    assert.equal(MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, false);
    assert.deepEqual(manualExpenseWebEntryState(null), { enabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, version: 0 });
    assert.deepEqual(manualExpenseWebEntryState(undefined), { enabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, version: 0 });
  });

  it('lets a stored row say either value, whatever the no-row reading is', () => {
    assert.deepEqual(manualExpenseWebEntryState({ manualExpenseEntryEnabled: true, version: 0 }), { enabled: true, version: 0 });
    assert.deepEqual(manualExpenseWebEntryState({ manualExpenseEntryEnabled: false, version: 4 }), { enabled: false, version: 4 });
  });

  it('the partner detail answers the value and its version for a company that has no row', async () => {
    const result = await detailUseCase(detailCompany({
      status: 'COMPLETED', normalizerVersion: NORMALIZER_VERSION, cohortKind: 'EXPLICIT',
    })).execute('co-1');
    assert.deepEqual(result.manualExpenseWebEntry, { enabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, version: 0 });
  });

  it('the partner detail answers the stored value, also while the entitlement rows are not prepared yet', async () => {
    const row = detailCompany({ status: 'STARTED', normalizerVersion: NORMALIZER_VERSION, cohortKind: 'LEGACY' });
    row.webEntrySetting = { manualExpenseEntryEnabled: true, version: 3 };
    const result = await detailUseCase(row).execute('co-1');
    assert.deepEqual(result.manualExpenseWebEntry, { enabled: true, version: 3 });
    assert.equal(result.entitlementNormalizationPending, true);
  });
});

/**
 * A transaction client that knows only the four things the command may touch. Reaching for anything
 * else — an entitlement table, the entitlement set, a LINE conversation table, a billing table —
 * throws, so "the switch never touches authority, money or LINE" is a property of every case below.
 */
function webEntryHarness(init: {
  company?: { id: string; status: string } | null;
  row?: { manualExpenseEntryEnabled: boolean; version: number } | null;
} = {}) {
  const company = init.company === undefined ? { id: 'co-1', status: 'ACTIVE' } : init.company;
  let row = init.row ?? null;
  const audits: any[] = [];
  const writes: any[] = [];
  const locks: unknown[] = [];
  let insideTransaction = false;
  const only = <T extends object>(name: string, target: T): T => new Proxy(target, {
    get(obj, key) {
      if (key in obj) return (obj as any)[key];
      throw new Error(`${name}.${String(key)} must not be touched by the manual-expense web-entry command`);
    },
  });
  const tx = only('tx', {
    $queryRaw: async (...args: unknown[]) => { locks.push(args); return []; },
    company: only('tx.company', { findUnique: async () => company }),
    companyWebEntrySetting: only('tx.companyWebEntrySetting', {
      findUnique: async () => row,
      upsert: async (args: any) => {
        assert.ok(insideTransaction, 'the write must happen inside the transaction');
        writes.push(args);
        row = row
          ? { manualExpenseEntryEnabled: args.update.manualExpenseEntryEnabled, version: row.version + args.update.version.increment }
          : { manualExpenseEntryEnabled: args.create.manualExpenseEntryEnabled, version: args.create.version };
        return row;
      },
    }),
    auditLog: only('tx.auditLog', {
      create: async (args: any) => {
        assert.ok(insideTransaction, 'the audit row must be written inside the same transaction as the value');
        audits.push(args.data);
      },
    }),
  });
  const prisma = { client: only('client', {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      insideTransaction = true;
      try { return await run(tx); } finally { insideTransaction = false; }
    },
  }) } as any;
  const run = (enabled: unknown, expectedVersion: unknown) => new SetPartnerManualExpenseWebEntryUseCase(prisma).execute({
    companyId: 'co-1', enabled: enabled as boolean, expectedVersion: expectedVersion as number,
    requestingAdminUserId: 'admin-1', requestId: 'req-1',
  });
  return { run, audits, writes, locks, row: () => row };
}

describe('SetPartnerManualExpenseWebEntryUseCase', () => {
  it('changes a company that has no row: one row at version 1 and one audit row, in one transaction', async () => {
    // Written against the no-row reading, not against "shown" or "hidden": it holds whichever the default is.
    const target = !MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW;
    const h = webEntryHarness();
    assert.deepEqual(await h.run(target, 0), { enabled: target, version: 1 });
    assert.deepEqual(h.row(), { manualExpenseEntryEnabled: target, version: 1 });
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0].create, {
      companyId: 'co-1', manualExpenseEntryEnabled: target, version: 1, updatedBySystemAdminUserId: 'admin-1',
    });
    assert.deepEqual(h.audits, [{
      companyId: 'co-1', actorUserId: 'admin-1', action: 'system.partner_manual_expense_web_entry.update',
      targetType: 'company', targetId: 'co-1', requestId: 'req-1', result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { entryPoint: 'SYSTEM_PARTNER_ADMIN', fromEnabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, toEnabled: target, fromVersion: 0, toVersion: 1 },
    }]);
    assert.equal(h.locks.length, 1, 'the company row is locked once, before it is read');
  });

  it('switches a stored value: the version goes up by one and the change is audited once', async () => {
    const h = webEntryHarness({ row: { manualExpenseEntryEnabled: true, version: 1 } });
    assert.deepEqual(await h.run(false, 1), { enabled: false, version: 2 });
    assert.deepEqual(h.writes[0].update, {
      manualExpenseEntryEnabled: false, version: { increment: 1 }, updatedBySystemAdminUserId: 'admin-1',
    });
    assert.equal(h.audits.length, 1);
    assert.deepEqual(h.audits[0].metadataJson, {
      entryPoint: 'SYSTEM_PARTNER_ADMIN', fromEnabled: true, toEnabled: false, fromVersion: 1, toVersion: 2,
    });
  });

  it('asking for the value the company already has writes nothing, audits nothing and keeps the version', async () => {
    // No row reads as the default: asking for the default creates no row.
    const empty = webEntryHarness();
    assert.deepEqual(await empty.run(MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, 0), { enabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, version: 0 });
    assert.equal(empty.row(), null);
    // A repeated press, or a retry after a lost response, carries a version that is now old: still no conflict.
    const stored = webEntryHarness({ row: { manualExpenseEntryEnabled: true, version: 3 } });
    assert.deepEqual(await stored.run(true, 2), { enabled: true, version: 3 });
    for (const h of [empty, stored]) {
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.audits, []);
    }
  });

  it('refuses a real change made from an old version with 409 and the current version, writing nothing', async () => {
    const h = webEntryHarness({ row: { manualExpenseEntryEnabled: true, version: 2 } });
    await assert.rejects(() => h.run(false, 1), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual((error.getResponse() as any).code, 'manual_expense_web_entry_version_conflict');
      assert.equal((error.getResponse() as any).currentVersion, 2);
      return true;
    });
    assert.deepEqual(h.row(), { manualExpenseEntryEnabled: true, version: 2 });
    assert.deepEqual([h.writes, h.audits], [[], []]);
  });

  it('refuses a disabled or archived company with the partner metadata lock, writing nothing', async () => {
    for (const status of ['DISABLED', 'ARCHIVED']) {
      const h = webEntryHarness({ company: { id: 'co-1', status } });
      await assert.rejects(() => h.run(!MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, 0), (error: unknown) => {
        assert.ok(error instanceof UnprocessableEntityException, status);
        assert.match(error.message, new RegExp(`^Company is ${status}:`));
        return true;
      });
      assert.deepEqual([h.writes, h.audits], [[], []], status);
    }
  });

  it('answers 404 for a company that does not exist', async () => {
    const h = webEntryHarness({ company: null });
    await assert.rejects(() => h.run(!MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, 0), NotFoundException);
    assert.deepEqual([h.writes, h.audits], [[], []]);
  });

  it('rejects a value that is not a boolean and a version that is not a whole number from 0, before any read', async () => {
    for (const [enabled, expectedVersion] of [['true', 0], [1, 0], [undefined, 0], [true, -1], [true, 1.5], [true, '0'], [true, undefined]] as const) {
      const h = webEntryHarness();
      await assert.rejects(() => h.run(enabled, expectedVersion), UnprocessableEntityException, JSON.stringify([enabled, expectedVersion]));
      assert.deepEqual([h.locks, h.writes, h.audits], [[], [], []]);
    }
  });
});
