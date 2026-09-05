import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateCompanyOnboardingUseCase } from '../../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { ProvisionSignupUseCase } from './provision-signup.use-case';

/**
 * Review B-01 pre-flight. Every other provisioning spec mocks the onboarding service away, which
 * is exactly why the bug hid: onboarding writes a plan term of its own AFTER its transaction
 * commits, and `applyPlanTermPreset` upserts with `update: {}`. Only a test that runs BOTH real
 * use-cases over one store with real upsert semantics can see which tier survives.
 *
 * The store below is the only thing standing in for PostgreSQL, so `companyPlanTerm.upsert`
 * implements the real create-or-leave-alone contract; every other model is an auto-stub, because
 * nothing else in this composition decides the tier.
 */
function fakePrisma() {
  const planTerms = new Map<string, any>();
  const chartRows: any[] = [];
  const autoModel = (name: string, overrides: Record<string, any> = {}): any => new Proxy({}, {
    get: (_target, method: string) => overrides[method] ?? (async (args: any) => {
      if (method.startsWith('count')) return 0;
      if (method === 'findMany' || method === 'groupBy') return [];
      if (method === 'findFirst' || method === 'findUnique') return null;
      if (method === 'findUniqueOrThrow') throw new Error(`${name}.findUniqueOrThrow not stubbed`);
      if (method === 'createMany') return { count: args?.data?.length ?? 0 };
      if (method === 'updateMany' || method === 'deleteMany') return { count: 0 };
      if (method === 'aggregate') return {};
      return { id: `${name}-1`, ...(args?.data ?? args?.create ?? {}) };
    }),
  });
  const models: Record<string, any> = {
    // Real upsert semantics: create when absent, apply `update` when present.
    companyPlanTerm: autoModel('companyPlanTerm', {
      upsert: async (args: any) => {
        const key = args.where.companyId;
        const existing = planTerms.get(key);
        if (!existing) {
          planTerms.set(key, { ...args.create });
          return planTerms.get(key);
        }
        Object.assign(existing, args.update ?? {});
        return existing;
      },
      findUnique: async (args: any) => planTerms.get(args.where.companyId) ?? null,
    }),
    // The chart bootstrap re-reads what it wrote and refuses to commit unless the rows match the
    // template, so this one needs to remember rows rather than answer empty.
    chartOfAccount: autoModel('chartOfAccount', {
      createMany: async (args: any) => {
        for (const row of args.data) chartRows.push({ id: `coa-${chartRows.length}`, ...row });
        return { count: args.data.length };
      },
      findMany: async (args: any) => chartRows.filter((row) => row.companyId === (args?.where?.companyId ?? null)),
      count: async (args: any) => chartRows.filter((row) => row.companyId === (args?.where?.companyId ?? null)).length,
    }),
    // The conditional link stamp inside the onboarding transaction (review MEDIUM-1): unlinked
    // here, so it takes the row. A generic 0-rows stub would make onboarding think it lost a race.
    companySignupRequest: autoModel('companySignupRequest', {
      updateMany: async ({ where }: any) => ({ count: where?.companyId === null ? 1 : 0 }),
    }),
    role: autoModel('role', { findUnique: async () => ({ id: 'role-owner' }) }),
    company: autoModel('company', { create: async () => ({ id: 'co-1' }) }),
    companyMembership: autoModel('companyMembership', { create: async () => ({ id: 'mem-1' }) }),
  };
  const client: any = new Proxy({}, {
    get: (_target, prop: string) => {
      if (prop === '$transaction') {
        return async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
      }
      if (prop === '$executeRaw') return async () => 0;
      models[prop] ??= autoModel(prop);
      return models[prop];
    },
  });
  return { prisma: { client } as any, planTerms };
}

const CONFIG = { credentialEncryptionKey: Buffer.alloc(32, 7), lineLiffId: undefined } as any;

const REQUEST = {
  id: 'signup-1',
  state: 'EMAIL_VERIFIED',
  companyName: 'ร้านมั่งมี',
  ownerDisplayName: 'สมชาย ใจดี',
  contactEmail: 'somchai@example.com',
  phoneNumber: null,
  businessType: null,
  vatRegistered: null,
  taxId: null,
  source: 'official-site',
  pendingPasswordHash: 'scrypt$salt$hash',
  attachUserId: null,
  approvedByUserId: 'admin-1',
  companyId: null,
};

function harness(overrides: Record<string, unknown> = {}) {
  const { prisma, planTerms } = fakePrisma();
  const core = {
    claimProvisioning: async () => ({ request: { ...REQUEST, ...overrides }, claimed: true, attemptId: 'attempt-1' }),
    completeProvisioning: async () => ({}),
    failProvisioning: async () => ({}),
    advance: async () => ({}),
  } as any;
  const legal = { recordFromEvidence: async () => ({ written: false }) } as any;
  const onboarding = new CreateCompanyOnboardingUseCase(prisma, CONFIG, legal);
  const adminDirectory = { activeSystemAdmins: async () => [{ companyId: 'sys', userId: 'sysadmin-1' }] } as any;
  const lineNotify = { enqueue: async () => undefined } as any;
  const opsAlerts = { raise: async () => undefined } as any;
  return { useCase: new ProvisionSignupUseCase(prisma, core, onboarding, CONFIG, adminDirectory, lineNotify, opsAlerts), planTerms };
}

const PROVISION = {
  requestId: 'signup-1',
  username: 'somchai',
  correlationRequestId: 'req-1',
  webBaseUrl: 'https://app.example.com',
  apiBaseUrl: 'https://api.example.com/v1',
};

describe('B-01 pre-flight: the tier a signup provisioning actually writes', () => {
  it('gives the Flow B applicant the tier provisioning asked for, not the onboarding default', async () => {
    const h = harness();
    await h.useCase.execute(PROVISION);

    const term = h.planTerms.get('co-1');
    assert.ok(term, 'provisioning must leave a plan term behind');
    // R02 as first reported (STARTER retained because `applyPlanTermPreset` upserts with an empty
    // `update`) does NOT reproduce here: onboarding is TOLD the tier, so it writes it once.
    assert.notEqual(term.tierKey, 'STARTER_249');
    // Owner 2026-09-05: a self-signed-up shop starts on the SAME free trial the LINE-first flow
    // gives. There is no PRO grant at signup any more.
    assert.equal(term.tierKey, 'FREE_TRIAL_15');
    assert.equal(term.branchLimit, 1);
    assert.equal(term.employeeLimit, 2);
    assert.equal(term.monthlySlipLimit, 15);
    assert.equal(term.termEndsAt.getTime() - term.termStartAt.getTime(), 30 * 24 * 60 * 60 * 1000);
  });

  it('ignores what the applicant asked for — a PRO request still provisions the free trial', async () => {
    const h = harness({ requestedOfferKey: 'PRO_999' });
    await h.useCase.execute(PROVISION);

    assert.equal(h.planTerms.get('co-1')?.tierKey, 'FREE_TRIAL_15');
  });

  it('never overwrites a term an admin already set, and a retry never shortens it', async () => {
    const h = harness();
    const paidUntil = new Date('2027-01-01T00:00:00.000Z');
    h.planTerms.set('co-1', {
      companyId: 'co-1', tierKey: 'ENTERPRISE_1999', branchLimit: 10, employeeLimit: 30,
      monthlySlipLimit: 2000, termStartAt: new Date('2026-01-01T00:00:00.000Z'), termEndsAt: paidUntil,
    });

    await h.useCase.execute(PROVISION);

    const term = h.planTerms.get('co-1');
    assert.equal(term.tierKey, 'ENTERPRISE_1999', 'a paid term must survive a provisioning retry');
    assert.equal(term.termEndsAt.getTime(), paidUntil.getTime());
  });
});
