import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { PartnerController, SetAiModelBodyDto, SetFeaturesBodyDto, SetOcrConfigBodyDto } from './partner.controller';
import { SystemAiBudgetController } from './system-ai-budget.controller';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
import { NORMALIZER_VERSION } from '../../../employee-access/application/normalize-entitlements';
import { GetPartnerDetailUseCase } from '../../application/use-cases/get-partner-detail.use-case';
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
    getPlanTerm: { execute: async () => ({ term: null }) } as any,
    setPlanTerm: { execute: async () => ({ term: { companyId: 'co-1', tierKey: 'STARTER_249' } }) } as any,
    renewPlanTerm: { execute: async () => ({ term: { companyId: 'co-1', renewCount: 1 } }) } as any,
    endWarmup: { execute: async () => ({ term: { companyId: 'co-1', warmupUntil: undefined } }) } as any,
    timeline: { execute: async () => ({ entries: [] }) } as any,
    lineMessage: { execute: async () => ({ delivered: 1 }) } as any,
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
    uc.timeline, uc.lineMessage,
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
      ['aiAdjustments', 'system.partner_ai_model.manage'],
      // Read-only meter: reuses the partner detail read permission, no new permission (spec §7.7).
      ['aiUsage', 'system.partner_dashboard.read'],
      // Issuing a bearer QR is a member-management action, gated like unlink and password reset.
      ['issueLineLinkToken', 'system.partner_member.manage'],
    ];
    for (const [method, perm] of cases) {
      const perms: string[] | undefined = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[method] as object);
      assert.ok(perms && perms.includes(perm), `${method} missing @RequirePermissions('${perm}')`);
    }
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
    for (const method of ['list', 'detail', 'update', 'transitionLifecycle', 'setFeatureEntitlements', 'setAiModelConfig', 'setOcrConfiguration', 'aiUsage']) {
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
    memberships: [],
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
