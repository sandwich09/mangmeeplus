import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  GetCompanyPlanTermUseCase,
  GetPlanTermNoticeUseCase,
  RenewCompanyPlanTermUseCase,
  SetCompanyPlanTermUseCase,
  applyPlanTermPreset,
} from './company-plan-term.use-cases';
import { DAY_MS, isPlanTierKey } from '../../domain/logic/plan-term.logic';
import {planAdjustmentDetails} from '../partner-plan-adjustment-history';
import { planTermSourceVersion } from '../plan-term-adjustment';
import { RECORDED_SIGNUP_OFFER_KEYS } from '../../../external-signup/domain/company-signup.logic';

const COMPANY = 'co-1';
const NOW_ISH = () => new Date();

function termRow(overrides: Record<string, unknown> = {}) {
  return {
    companyId: COMPANY,
    tierKey: 'STARTER_249',
    branchLimit: 1,
    employeeLimit: 2,
    monthlySlipLimit: 30,
    termStartAt: new Date('2026-08-01T07:00:00.000Z'),
    termEndsAt: new Date('2026-08-31T07:00:00.000Z'),
    warningDays: 7,
    renewCount: 0,
    lastRenewedAt: null,
    termDisabledAt: null,
    ...overrides,
  };
}

/**
 * Fake prisma in the partner-member-console style: real enough that a wrong `where` clause shows
 * up as a wrong answer, small enough to read.
 */
function makePrisma(opts: {
  term?: Record<string, unknown> | null;
  companyStatus?: string | null;
  actorActive?: boolean;
  activeBillingAttempt?: boolean;
  /** R-C6: records call order across the term-row write and the (fake) lifecycle transition. */
  sequence?: string[];
} = {}) {
  const audits: any[] = [];
  let upsertArgs: any = null;
  let updateArgs: any = null;
  let stored = opts.term === undefined ? null : opts.term;

  const client = {
    $queryRaw: async () => [],
    branch: {count:async()=>1},
    companyMembership: {count:async()=>2,findFirst:async()=>opts.actorActive===false?null:({id:'admin-membership'})},
    billingAccount: {findFirst:async()=>opts.activeBillingAttempt?{id:'pending-account'}:null},
    company: {
      findUnique: async () => (opts.companyStatus === null ? null : { id: COMPANY, status: opts.companyStatus ?? 'ACTIVE' }),
    },
    companyPlanTerm: {
      findUnique: async () => (stored ? { ...stored } : null),
      upsert: async (args: any) => {
        upsertArgs = args;
        stored = stored ? { ...stored, ...args.update } : { ...termRow(), ...args.create };
        return { ...stored };
      },
      update: async (args: any) => {
        updateArgs = args;
        opts.sequence?.push('term-update');
        const data = { ...args.data };
        if (data.renewCount?.increment !== undefined) {
          data.renewCount = (stored as any).renewCount + data.renewCount.increment;
        }
        stored = { ...stored, ...data };
        return { ...stored };
      },
    },
    auditLog: {
      create: async (args: any) => { audits.push(args.data); return args.data; },
      findFirst: async (args:any) => audits.find(a=>a.metadataJson.commandId===args.where.metadataJson.equals)??null,
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(client),
  };

  return { client, audits: () => audits, upsertArgs: () => upsertArgs, updateArgs: () => updateArgs, stored: () => stored } as any;
}

const makeLifecycle = (sequence?: string[]) => {
  const calls: any[] = [];
  return { calls, execute: async (cmd: any) => { sequence?.push('lifecycle-execute'); calls.push(cmd); return { id: COMPANY, status: cmd.targetStatus }; } } as any;
};

describe('GetCompanyPlanTermUseCase', () => {
  it('returns { term: null } for a grandfathered company instead of 404', async () => {
    const result = await new GetCompanyPlanTermUseCase(makePrisma({ term: null })).execute(COMPANY);
    assert.equal(result.term,null);
    assert.equal(result.sourceVersion,planTermSourceVersion(COMPANY,null));
    assert.equal(result.activeMembers,2);
  });

  it('computes derivedState and daysLeft on read', async () => {
    const endsAt = new Date(Date.now() + 2 * DAY_MS);
    const result = await new GetCompanyPlanTermUseCase(makePrisma({ term: termRow({ termEndsAt: endsAt }) })).execute(COMPANY);
    assert.equal(result.term?.derivedState, 'WARNING');
    assert.equal(result.term?.daysLeft, 2);
  });
});

describe('SetCompanyPlanTermUseCase', () => {
  const baseBody = { tierKey: 'BASIC_499' as const, branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50 };
  const cmd = (extra: Record<string, unknown> = {}) => ({
    companyId: COMPANY, ...baseBody, requestingAdminUserId: 'admin-1', requestId: 'req-1', commandId:'manual-command-req-1',reason:'ตรวจร้านและปรับสิทธิ์',expectedVersion:planTermSourceVersion(COMPANY,null), ...extra,
  }) as any;

  it('404s on an unknown company', async () => {
    const uc = new SetCompanyPlanTermUseCase(makePrisma({ companyStatus: null }));
    await assert.rejects(() => uc.execute(cmd()), NotFoundException);
  });

  it('rejects an unknown tierKey', async () => {
    const uc = new SetCompanyPlanTermUseCase(makePrisma({ term: null }));
    await assert.rejects(() => uc.execute(cmd({ tierKey: 'FREE_0' })), UnprocessableEntityException);
  });

  it('rejects non-positive and fractional limits', async () => {
    const uc = new SetCompanyPlanTermUseCase(makePrisma({ term: null }));
    await assert.rejects(() => uc.execute(cmd({ branchLimit: 0 })), UnprocessableEntityException);
    await assert.rejects(() => uc.execute(cmd({ employeeLimit: 1.5 })), UnprocessableEntityException);
    await assert.rejects(() => uc.execute(cmd({ monthlySlipLimit: -1 })), UnprocessableEntityException);
  });

  it('creating computes termEndsAt as start plus exactly N x 24h, hour preserved', async () => {
    const prisma = makePrisma({ term: null });
    await new SetCompanyPlanTermUseCase(prisma).execute(cmd({...({ termStartAt: '2026-08-30T07:00:00.000Z', termDays: 30 }),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    const created = prisma.upsertArgs().create;
    assert.equal(created.termStartAt.toISOString(), '2026-08-30T07:00:00.000Z');
    assert.equal(created.termEndsAt.toISOString(), '2026-09-29T07:00:00.000Z');
    assert.equal(created.warningDays, 7);
  });

  it('creating defaults to 30 days from now when no dates are given', async () => {
    const prisma = makePrisma({ term: null });
    const before = Date.now();
    await new SetCompanyPlanTermUseCase(prisma).execute(cmd({...({}),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    const created = prisma.upsertArgs().create;
    const span = created.termEndsAt.getTime() - created.termStartAt.getTime();
    assert.equal(span, 30 * DAY_MS);
    assert.ok(created.termStartAt.getTime() >= before);
  });

  it('updating limits NEVER moves the dates', async () => {
    const prisma = makePrisma({ term: termRow() });
    await new SetCompanyPlanTermUseCase(prisma).execute(cmd({...({ termStartAt: '2030-01-01T00:00:00.000Z', termDays: 999 }),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    const update = prisma.upsertArgs().update;
    assert.equal('termStartAt' in update, false);
    assert.equal('termEndsAt' in update, false);
    assert.equal(update.branchLimit, 2);
  });

  it('audits CRITICAL with before/after values', async () => {
    const prisma = makePrisma({ term: termRow() });
    await new SetCompanyPlanTermUseCase(prisma).execute(cmd({...({}),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    const audit = prisma.audits()[0];
    assert.equal(audit.action, 'system.company_plan_term.set');
    assert.equal(audit.riskLevel, 'CRITICAL');
    assert.equal(audit.created, undefined);
    assert.equal(audit.metadataJson.created, false);
    assert.equal(audit.metadataJson.from.branchLimit, 1);
    assert.equal(audit.metadataJson.to.branchLimit, 2);
    assert.equal(audit.metadataJson.from.termEndsAt, audit.metadataJson.to.termEndsAt);
  });

  it('records `from: null` when the row is created', async () => {
    const prisma = makePrisma({ term: null });
    await new SetCompanyPlanTermUseCase(prisma).execute(cmd({...({}),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    assert.equal(prisma.audits()[0].metadataJson.created, true);
    assert.equal(prisma.audits()[0].metadataJson.from, null);
  });

  it('keeps an active Checkout from racing an Admin term edit', async () => {
    const prisma = makePrisma({ term: termRow(), activeBillingAttempt: true });
    await assert.rejects(new SetCompanyPlanTermUseCase(prisma).execute(cmd({expectedVersion: planTermSourceVersion(COMPANY, prisma.stored())})),
      (error: any) => error.getResponse().code === 'paid_plan_review_required');
    assert.equal(prisma.upsertArgs(), null);
  });
});

describe('applyPlanTermPreset', () => {
  it('fills the row from the frozen catalog and is a no-op on an existing row', async () => {
    const prisma = makePrisma({ term: null });
    await applyPlanTermPreset(prisma, COMPANY, 'STARTER_249', 30, 'admin-1');
    const args = prisma.upsertArgs();
    assert.equal(args.create.tierKey, 'STARTER_249');
    assert.equal(args.create.branchLimit, 1);
    assert.equal(args.create.employeeLimit, 2);
    assert.equal(args.create.monthlySlipLimit, 30);
    assert.equal(args.create.termEndsAt.getTime() - args.create.termStartAt.getTime(), 30 * DAY_MS);
    // Empty update = an already-provisioned company keeps the term it has.
    assert.deepEqual(args.update, {});
  });

  // Review B-08, both sides: the admin preset dropdown derives from PLAN_TIER_PRESETS, so the LINE
  // trial appears there automatically (an admin may hand it out), while the public web form pins
  // its own offer keys and therefore cannot sell it.
  it('carries the LINE-first trial preset without opening it to the public form', async () => {
    const prisma = makePrisma({ term: null });
    await applyPlanTermPreset(prisma, COMPANY, 'FREE_TRIAL_15', 30, null);
    const args = prisma.upsertArgs();
    assert.equal(args.create.branchLimit, 1);
    assert.equal(args.create.employeeLimit, 2);
    assert.equal(args.create.monthlySlipLimit, 15);
    assert.ok(isPlanTierKey('FREE_TRIAL_15'));
    // R02: the offer key and the plan tier stay different vocabularies. The form's one offer is
    // `FREE_TRIAL`; the tier it provisions is `FREE_TRIAL_15`, which no applicant can name.
    assert.equal(RECORDED_SIGNUP_OFFER_KEYS.includes('FREE_TRIAL_15'), false);
    assert.equal(RECORDED_SIGNUP_OFFER_KEYS.includes('FREE_TRIAL'), true);
  });
});

describe('RenewCompanyPlanTermUseCase', () => {
  const cmd = (extra: Record<string, unknown> = {}) => ({
    companyId: COMPANY, requestingAdminUserId: 'admin-1', requestId: 'req-9', commandId:'manual-command-req-9',reason:'ตรวจร้านและปรับสิทธิ์',expectedVersion:planTermSourceVersion(COMPANY,null), ...extra,
  }) as any;

  it('404s when there is no term to renew', async () => {
    const uc = new RenewCompanyPlanTermUseCase(makePrisma({ term: null }), makeLifecycle());
    await assert.rejects(() => uc.execute(cmd()), NotFoundException);
  });

  it('cannot manually extend a paid term or a term with active Checkout', async () => {
    for (const opts of [{term: termRow({billingReceiptAccountId:'paid-account'})}, {term: termRow(), activeBillingAttempt:true}]) {
      const prisma = makePrisma(opts);
      await assert.rejects(new RenewCompanyPlanTermUseCase(prisma, makeLifecycle()).execute(cmd({expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())})),
        (error: any) => error.getResponse().code === 'paid_plan_review_required');
      assert.equal(prisma.updateArgs(), null);
    }
  });

  it('BEFORE expiry: extends from the existing end date, not from now', async () => {
    const endsAt = new Date(Date.now() + 10 * DAY_MS);
    const prisma = makePrisma({ term: termRow({ termEndsAt: endsAt }) });
    await new RenewCompanyPlanTermUseCase(prisma, makeLifecycle()).execute(cmd({...({ days: 30 }),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    assert.equal(prisma.updateArgs().data.termEndsAt.getTime(), endsAt.getTime() + 30 * DAY_MS);
  });

  it('AFTER expiry: extends from now, never back-dated into the past', async () => {
    const endsAt = new Date(Date.now() - 10 * DAY_MS);
    const prisma = makePrisma({ term: termRow({ termEndsAt: endsAt }), companyStatus: 'ACTIVE' });
    const before = Date.now();
    await new RenewCompanyPlanTermUseCase(prisma, makeLifecycle()).execute(cmd({...({ days: 30 }),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    const next = prisma.updateArgs().data.termEndsAt.getTime();
    assert.ok(next >= before + 30 * DAY_MS, 'new end must be 30 days from now');
    assert.ok(next < before + 31 * DAY_MS);
  });

  it('re-activates a company the SWEEP disabled and clears termDisabledAt', async () => {
    const sequence: string[] = [];
    const before = Date.now();
    const prisma = makePrisma({
      term: termRow({ termEndsAt: new Date(Date.now() - DAY_MS), termDisabledAt: new Date() }),
      companyStatus: 'DISABLED',
      sequence,
    });
    const lifecycle = makeLifecycle(sequence);
    await new RenewCompanyPlanTermUseCase(prisma, lifecycle).execute(cmd({...({}),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    assert.equal(prisma.updateArgs().data.termDisabledAt, null);
    assert.equal(lifecycle.calls.length, 1);
    assert.equal(lifecycle.calls[0].targetStatus, 'ACTIVE');
    assert.equal(lifecycle.calls[0].reason, 'term_renewed');
    // R-C6 (purchase-without-setup §18.2): PartnerLifecycleTransitionUseCase's new term-lock guard
    // reads the term row inside this same transaction — it must see the RENEWED end date, never the
    // stale expired one, or a legitimate renew-and-reactivate would refuse itself.
    assert.ok(prisma.updateArgs().data.termEndsAt.getTime() > before, 'renew must move termEndsAt into the future');
    assert.deepEqual(sequence, ['term-update', 'lifecycle-execute'], 'the term row updates before the lifecycle transition runs');
  });

  it('an ADMIN-disabled company (no termDisabledAt) gets new dates but stays DISABLED', async () => {
    const prisma = makePrisma({
      term: termRow({ termEndsAt: new Date(Date.now() - DAY_MS), termDisabledAt: null }),
      companyStatus: 'DISABLED',
    });
    const lifecycle = makeLifecycle();
    await new RenewCompanyPlanTermUseCase(prisma, lifecycle).execute(cmd({...({}),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    assert.ok(prisma.updateArgs().data.termEndsAt instanceof Date);
    assert.equal('termDisabledAt' in prisma.updateArgs().data, false);
    assert.equal(lifecycle.calls.length, 0, 'renew must never re-enable an admin-disabled company');
  });

  it('never touches a SUSPENDED company status', async () => {
    const prisma = makePrisma({
      term: termRow({ termEndsAt: new Date(Date.now() - DAY_MS), termDisabledAt: new Date() }),
      companyStatus: 'SUSPENDED',
    });
    const lifecycle = makeLifecycle();
    await new RenewCompanyPlanTermUseCase(prisma, lifecycle).execute(cmd({...({}),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    assert.equal(lifecycle.calls.length, 0);
  });

  it('resets the whole ladder so the next term can warn again', async () => {
    const prisma = makePrisma({ term: termRow() });
    await new RenewCompanyPlanTermUseCase(prisma, makeLifecycle()).execute(cmd({...({}),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    const data = prisma.updateArgs().data;
    assert.equal(data.warn7SentAt, null);
    assert.equal(data.warn3SentAt, null);
    assert.equal(data.warn1SentAt, null);
    assert.equal(data.expiredNotifiedAt, null);
    assert.deepEqual(data.renewCount, { increment: 1 });
    assert.ok(data.lastRenewedAt instanceof Date);
  });

  it('audits CRITICAL with the date move and the renew count', async () => {
    const prisma = makePrisma({ term: termRow() });
    await new RenewCompanyPlanTermUseCase(prisma, makeLifecycle()).execute(cmd({...({ days: 14 }),expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}));
    const audit = prisma.audits()[0];
    assert.equal(audit.action, 'system.company_plan_term.renew');
    assert.equal(audit.riskLevel, 'CRITICAL');
    assert.equal(audit.metadataJson.days, 14);
    assert.notEqual(audit.metadataJson.fromTermEndsAt, audit.metadataJson.toTermEndsAt);
    assert.equal(audit.metadataJson.toRenewCount, 1);
  });

  it('replays one actor/body/source-bound command across fresh HTTP request IDs', async () => {
    const prisma=makePrisma({term:termRow()}),uc=new RenewCompanyPlanTermUseCase(prisma,makeLifecycle());
    const original=cmd({expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())});
    const first=await uc.execute(original),replayed=await uc.execute({...original,requestId:'another-http-request'});
    assert.equal(replayed.replayed,true);assert.equal(replayed.term?.termEndsAt,first.term?.termEndsAt);assert.equal(prisma.audits().length,1);
    for(const change of [{days:31},{reason:'อีกเหตุผล'},{requestingAdminUserId:'other-admin'},{expectedVersion:planTermSourceVersion(COMPANY,prisma.stored())}])
      await assert.rejects(uc.execute({...original,...change}),(e:any)=>e.getResponse().code==='partner_plan_term_command_conflict');
    await assert.rejects(uc.execute({...original,commandId:'another-command-001'}),(e:any)=>e.getResponse().code==='partner_plan_term_changed');
    assert.equal(prisma.audits().length,1);
  });

  it('rejects a non-positive day count', async () => {
    const uc = new RenewCompanyPlanTermUseCase(makePrisma({ term: termRow() }), makeLifecycle());
    await assert.rejects(() => uc.execute(cmd({ days: 0 })), UnprocessableEntityException);
  });
});

describe('GetPlanTermNoticeUseCase', () => {
  it('returns null for a company with no term row', async () => {
    assert.equal(await new GetPlanTermNoticeUseCase(makePrisma({ term: null })).execute(COMPANY, ['OWNER']), null);
  });

  it('marks the OWNER, and only the OWNER', async () => {
    const prisma = makePrisma({ term: termRow({ termEndsAt: new Date(Date.now() + 3 * DAY_MS) }) });
    assert.equal((await new GetPlanTermNoticeUseCase(prisma).execute(COMPANY, ['OWNER']))?.isOwner, true);
    assert.equal((await new GetPlanTermNoticeUseCase(prisma).execute(COMPANY, ['SALES']))?.isOwner, false);
  });

  it('reports package authority from permission, independent of role name and ownership', async () => {
    const prisma = makePrisma({ term: termRow({ termEndsAt: new Date(Date.now() + 3 * DAY_MS) }) });
    const notice = await new GetPlanTermNoticeUseCase(prisma).execute(COMPANY, ['CHIEF_OPERATING_OFFICER'], ['company.plan.manage']);
    assert.equal(notice?.isOwner, false);
    assert.equal(notice?.canManagePlan, true);
  });

  it('carries state and deadline but never limits or tier', async () => {
    const prisma = makePrisma({ term: termRow({ termEndsAt: new Date(NOW_ISH().getTime() - DAY_MS) }) });
    const notice = await new GetPlanTermNoticeUseCase(prisma).execute(COMPANY, ['STAFF']);
    assert.deepEqual(Object.keys(notice ?? {}).sort(),
      ['canManagePlan', 'daysLeft', 'derivedState', 'isOwner', 'lockReason', 'termEndsAt']);
    assert.equal(notice?.derivedState, 'EXPIRED');
    assert.equal(notice?.daysLeft, 0);
  });

  // R2: the locked shell has to know whether to invite a PURCHASE or a RENEWAL, and only the term
  // row can tell the two apart.
  it('says no_package for a shop provisioned with a zero-day term it never renewed', async () => {
    const start = new Date(NOW_ISH().getTime() - DAY_MS);
    const prisma = makePrisma({ term: termRow({ termStartAt: start, termEndsAt: start, renewCount: 0 }) });
    assert.equal((await new GetPlanTermNoticeUseCase(prisma).execute(COMPANY, ['OWNER']))?.lockReason, 'no_package');
  });

  it('says trial_ended for a term that actually ran, and for one that was renewed', async () => {
    const ended = makePrisma({ term: termRow({ termEndsAt: new Date(NOW_ISH().getTime() - DAY_MS) }) });
    assert.equal((await new GetPlanTermNoticeUseCase(ended).execute(COMPANY, ['OWNER']))?.lockReason, 'trial_ended');
    // A renewed shop can still end up with `termEndsAt === termStartAt` after an admin edit; the
    // renew count is what says it was once a real customer.
    const at = new Date(NOW_ISH().getTime() - DAY_MS);
    const renewed = makePrisma({ term: termRow({ termStartAt: at, termEndsAt: at, renewCount: 1 }) });
    assert.equal((await new GetPlanTermNoticeUseCase(renewed).execute(COMPANY, ['OWNER']))?.lockReason, 'trial_ended');
  });

  it('leaves lockReason off a term that is still running', async () => {
    const prisma = makePrisma({ term: termRow({ termEndsAt: new Date(Date.now() + 3 * DAY_MS) }) });
    const notice = await new GetPlanTermNoticeUseCase(prisma).execute(COMPANY, ['OWNER']);
    assert.equal(notice?.derivedState, 'WARNING');
    assert.equal('lockReason' in (notice ?? {}), false);
  });
});

it('withdrawn current operator cannot replay or create a renewal', async()=>{
  const options={term:termRow(),actorActive:true},prisma=makePrisma(options),uc=new RenewCompanyPlanTermUseCase(prisma,makeLifecycle());
  const cmd={companyId:COMPANY,requestingAdminUserId:'admin-1',requestId:'http-1',commandId:'manual-current-actor',expectedVersion:planTermSourceVersion(COMPANY,prisma.stored()),reason:'ทดสอบสิทธิ์ปัจจุบัน'};
  await uc.execute(cmd);options.actorActive=false;
  await assert.rejects(uc.execute(cmd),(e:any)=>e.getStatus()===403);assert.equal(prisma.audits().length,1);
});
it('manual history allowlists scalar changes and supports legacy renewal dates without exposing raw metadata',()=>{
  const value=planAdjustmentDetails({source:'ADMIN_ADJUSTMENT',entryPoint:'LINE_PACKAGE_REQUEST',reason:'ตามคำขอร้าน',packageChangeRequestId:'line-request-1',password:'private',
    from:{tierKey:'FREE_TRIAL_15',branchLimit:1},to:{tierKey:'STARTER_249',branchLimit:2,nativeToken:'private'}});
  assert.equal(value.source,'LINE_PACKAGE_REQUEST');assert.equal(value.requestId,'line-request-1');assert.equal(value.changes.length,2);assert.doesNotMatch(JSON.stringify(value),/private|password|nativeToken/);
  assert.deepEqual(planAdjustmentDetails({fromTermEndsAt:'2026-01-01',toTermEndsAt:'2026-02-01',reason:'x'.repeat(501)}).changes,[{field:'termEndsAt',before:'2026-01-01',after:'2026-02-01'}]);
});
