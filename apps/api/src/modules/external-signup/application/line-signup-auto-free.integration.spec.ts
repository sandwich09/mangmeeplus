import { describe, it } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import assert from 'node:assert/strict';
import { CreateCompanyOnboardingUseCase } from '../../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { LegalAcceptanceService } from '../../auth/application/legal-acceptance.service';
import { currentLegalRelease } from '../../auth/application/legal-acceptance.service';
import { LINE_OPEN_APPLICATION_STATES, STALE_PROVISIONING_MS } from '../domain/company-signup.logic';
import { CompanySignupCoreService } from './company-signup-core.service';
import { ProvisionSignupUseCase } from './provision-signup.use-case';
import { SubmitLineSignupUseCase } from './submit-line-signup.use-case';

/**
 * AUTO_FREE end to end over one store: real submit → real core state machine → real provisioning →
 * real onboarding. Every use-case spec above this one mocks its neighbour, which is exactly how a
 * 100%-failing path stayed green — the id provisioning passed as the operator was a signup-request
 * cuid, and only a store that enforces the foreign keys can notice.
 */
function fakePrisma(options: { systemAdmins?: string[] } = {}) {
  const users = new Set<string>(options.systemAdmins ?? []);
  const requests = new Map<string, any>();
  const planTerms = new Map<string, any>();
  const chartRows: any[] = [];
  const audits: any[] = [];
  const identities: any[] = [];
  const legalRows: any[] = [];
  const aiConfigs = new Map<string, any>();
  const onboardingRuns: any[] = [];
  const memberships: any[] = [];
  const lineContexts = new Map<string, any>();
  let seq = 0;

  /**
   * Per-transaction undo. A global snapshot was wrong: with two transactions interleaved, restoring
   * one rolls back the OTHER's committed writes too, and the race test then passed only because it
   * asserted on a detached object. `AsyncLocalStorage` attributes each write to the transaction
   * that made it, across awaits, so a rollback touches only that transaction's own keys.
   */
  const txUndo = new AsyncLocalStorage<Array<() => void>>();
  /** Call BEFORE mutating `map[key]`, so the prior value can be put back exactly. */
  const willWrite = (map: Map<string, any>, key: string) => {
    const log = txUndo.getStore();
    if (!log) return;
    const had = map.has(key);
    const prior = had ? { ...map.get(key) } : null;
    log.push(() => {
      if (!had) { map.delete(key); return; }
      const current = map.get(key);
      if (!current) { map.set(key, prior); return; }
      // Restored in place: a caller still holding the row sees the rollback, as it would in Prisma.
      for (const field of Object.keys(current)) delete current[field];
      Object.assign(current, prior);
    });
  };
  /** Append-only lists: undo removes the exact item, never a concurrent transaction's. */
  const trackedPush = <T>(list: T[], item: T): T => {
    list.push(item);
    txUndo.getStore()?.push(() => {
      const at = list.indexOf(item);
      if (at >= 0) list.splice(at, 1);
    });
    return item;
  };

  /** The two columns onboarding writes an operator id into are both FKs to User. */
  const assertUser = (id: unknown, column: string) => {
    if (id === undefined || id === null) return;
    if (!users.has(String(id))) {
      throw Object.assign(new Error(`Foreign key constraint violated on ${column}`), { code: 'P2003' });
    }
  };

  const auto = (name: string, overrides: Record<string, any> = {}): any => new Proxy({}, {
    // Assignment has to land in `overrides`, or a test that swaps one method out gets the original
    // back from `get` and passes for the wrong reason.
    set: (_t, method: string, value: any) => { overrides[method] = value; return true; },
    get: (_t, method: string) => overrides[method] ?? (async (args: any) => {
      if (method.startsWith('count')) return 0;
      if (method === 'findMany' || method === 'groupBy') return [];
      if (method === 'findFirst' || method === 'findUnique') return null;
      if (method === 'findUniqueOrThrow') throw new Error(`${name}.findUniqueOrThrow not stubbed`);
      if (method === 'createMany') return { count: args?.data?.length ?? 0 };
      if (method === 'updateMany' || method === 'deleteMany') return { count: 0 };
      return { id: `${name}-${(seq += 1)}`, ...(args?.data ?? args?.create ?? {}) };
    }),
  });

  const models: Record<string, any> = {
    companySignupRequest: auto('companySignupRequest', {
      create: async ({ data }: any) => {
        const row = { id: `signup-${(seq += 1)}`, state: 'RECEIVED', version: 0, ...data };
        willWrite(requests, row.id);
        requests.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }: any) => requests.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => requests.get(where.id),
      findFirst: async () => [...requests.values()][0] ?? null,
      count: async ({ where }: any) => [...requests.values()].filter((row) =>
        row.autoApproved === where.autoApproved && row.source === where.source
        && row.createdAt >= where.createdAt.gte).length,
      update: async ({ where, data }: any) => {
        willWrite(requests, where.id);
        return Object.assign(requests.get(where.id), data);
      },
      // Two conditional updates share this: the state/version CAS the fence uses, and the
      // `companyId: null` stamp that decides which of two overlapping runs keeps its company.
      // Both are "update only if the row still looks like this", so both are matched here.
      updateMany: async ({ where, data }: any) => {
        const row = requests.get(where.id);
        if (!row) return { count: 0 };
        if (where.state !== undefined && row.state !== where.state) return { count: 0 };
        if (where.version !== undefined && row.version !== where.version) return { count: 0 };
        if (where.companyId === null && row.companyId != null) return { count: 0 };
        willWrite(requests, where.id);
        Object.assign(row, data);
        if (where.version !== undefined) row.version = where.version + 1;
        return { count: 1 };
      },
    }),
    user: auto('user', {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const row = { id: `user-${(seq += 1)}`, ...data };
        users.add(row.id);
        return row;
      },
    }),
    role: auto('role', { findUnique: async () => ({ id: 'role-owner' }) }),
    company: auto('company', { create: async () => ({ id: 'co-1' }) }),
    companyMembership: auto('companyMembership', {
      create: async ({ data }: any) => {
        const row = trackedPush(memberships, { id: `mem-${(seq += 1)}`, ...data });
        return row;
      },
      // The recovery path reads the owner back from the membership onboarding created, so the
      // fake has to remember it — otherwise a passing retry test would prove nothing.
      findFirst: async ({ where }: any) => memberships.find((m) => m.companyId === where.companyId) ?? null,
      // The repeat-trial read: any membership in any status, because a closed shop still counts.
      count: async ({ where }: any) => memberships.filter((m) => m.userId === where.userId).length,
    }),
    /**
     * Modelled as the unique `(provider, channel, providerUserId)` slot it really is. A fake that
     * always answered null could not tell "free" from "stale", which is exactly the difference
     * UAT cmto4xtrx002r4o5tf7o38dls turned into a P2002 nobody could retry past.
     */
    externalIdentity: auto('externalIdentity', {
      findFirst: async ({ where }: any) => {
        const row = identities.find((r: any) => r.providerUserId === where.providerUserId
          && (where.providerChannelId === undefined || r.providerChannelId === where.providerChannelId));
        // Users this flow creates are ACTIVE; the seed can override by setting `user` on the row.
        return row ? { user: { status: 'ACTIVE' }, ...row } : null;
      },
      findUnique: async ({ where }: any) => {
        const key = where.provider_providerChannelId_providerUserId;
        const row = identities.find((r: any) => r.providerUserId === key.providerUserId
          && r.providerChannelId === key.providerChannelId);
        // A COPY, like Prisma: a caller holding the pre-update row must keep reading the old values
        // after the update — that is how the re-point audit knows which account it moved off.
        return row ? { ...row } : null;
      },
      create: async ({ data }: any) => trackedPush(identities, { id: `ext-${(seq += 1)}`, status: 'ACTIVE', ...data }),
      update: async ({ where, data }: any) => {
        const row = identities.find((r: any) => r.id === where.id);
        const prior = { ...row };
        txUndo.getStore()?.push(() => Object.assign(row, prior));
        Object.assign(row, data);
        return row;
      },
    }),
    legalDocumentActionRecord: auto('legalDocumentActionRecord', {
      count: async () => legalRows.length,
      createMany: async ({ data }: any) => { for (const row of data) trackedPush(legalRows, row); return { count: data.length }; },
    }),
    companyOnboardingRun: auto('companyOnboardingRun', {
      create: async ({ data }: any) => {
        assertUser(data.createdBySystemAdminUserId, 'CompanyOnboardingRun_createdBySystemAdminUserId_fkey');
        trackedPush(onboardingRuns, data);
        return { id: 'run-1', ...data };
      },
    }),
    auditLog: auto('auditLog', {
      create: async ({ data }: any) => {
        assertUser(data.actorUserId, 'AuditLog_actorUserId_fkey');
        trackedPush(audits, data);
        return { id: `audit-${(seq += 1)}` };
      },
    }),
    companyPlanTerm: auto('companyPlanTerm', {
      upsert: async ({ where, create, update }: any) => {
        willWrite(planTerms, where.companyId);
        const existing = planTerms.get(where.companyId);
        if (!existing) { planTerms.set(where.companyId, { ...create }); return planTerms.get(where.companyId); }
        Object.assign(existing, update ?? {});
        return existing;
      },
      update: async ({ where, data }: any) => {
        const existing = planTerms.get(where.companyId);
        if (!existing) throw Object.assign(new Error('record not found'), { code: 'P2025' });
        return Object.assign(existing, data);
      },
    }),
    companyAiConfiguration: auto('companyAiConfiguration', {
      upsert: async ({ where, create }: any) => { willWrite(aiConfigs, where.companyId); aiConfigs.set(where.companyId, create); return create; },
    }),
    lineCompanyContext: auto('lineCompanyContext', {
      upsert: async ({ where, create }: any) => { willWrite(lineContexts, where.lineUserId); lineContexts.set(where.lineUserId, create); return create; },
    }),
    chartOfAccount: auto('chartOfAccount', {
      createMany: async ({ data }: any) => {
        for (const row of data) trackedPush(chartRows, { id: `coa-${chartRows.length}`, ...row });
        return { count: data.length };
      },
      findMany: async (args: any) => chartRows.filter((r) => r.companyId === (args?.where?.companyId ?? null)),
      count: async (args: any) => chartRows.filter((r) => r.companyId === (args?.where?.companyId ?? null)).length,
    }),
  };

  const client: any = new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop === '$transaction') {
        return async (arg: any) => {
          if (typeof arg !== 'function') return Promise.all(arg);
          // Only THIS transaction's writes are undone, so an interleaved winner keeps its own.
          const undo: Array<() => void> = [];
          return txUndo.run(undo, async () => {
            try {
              return await arg(client);
            } catch (error) {
              for (const step of undo.reverse()) step();
              throw error;
            }
          });
        };
      }
      if (prop === '$executeRaw') return async () => 0;
      models[prop] ??= auto(prop);
      return models[prop];
    },
  });

  return {
    prisma: { client } as any,
    requests, planTerms, audits, identities, legalRows, aiConfigs, onboardingRuns, lineContexts, memberships,
  };
}

const CONFIG = {
  credentialEncryptionKey: Buffer.alloc(32, 7),
  lineLiffId: undefined,
  lineSignupApprovalMode: 'AUTO_FREE',
  lineSignupAutoDailyCap: 20,
  lineSignupWarmupSlips: 10,
  lineFreeAiBudgetSatang: 8000,
  lineSignupBusinessDays: 'MON-SAT',
  lineSignupBusinessHours: '09:00-18:00',
} as any;

const CMD = {
  idToken: 'aaaa.bbbb.cccc',
  companyName: 'ร้านมั่งมี',
  legal: { ...currentLegalRelease('th'), locale: 'th' },
  correlationRequestId: 'req-1',
  webBaseUrl: 'https://app.example.com',
  apiBaseUrl: 'https://api.example.com/v1',
};

const NOW = new Date('2026-09-03T10:00:00+07:00');

function harness(options: { systemAdmins?: string[]; config?: Record<string, unknown> } = {}) {
  const store = fakePrisma({ systemAdmins: options.systemAdmins ?? ['sysadmin-1'] });
  const config = { ...CONFIG, ...(options.config ?? {}) } as any;
  const core = new CompanySignupCoreService(store.prisma);
  const legal = new LegalAcceptanceService(store.prisma, { log: async () => undefined } as any);
  const onboarding = new CreateCompanyOnboardingUseCase(store.prisma, config, legal);
  const notified: string[] = [];
  const adminNotify = {
    activeSystemAdmins: async () => (options.systemAdmins ?? ['sysadmin-1']).map((userId) => ({ companyId: 'sys', userId })),
    enqueue: async (id: string) => { notified.push(id); },
  } as any;
  // P10-L: the ready push is enqueued, so the AUTO_FREE path can be asserted end to end without LINE.
  const linePushes: Array<{ id: string; kind: string }> = [];
  // §15.6: the ops rail is a fake here — the alert conditions have their own spec.
  const alerts: string[] = [];
  const lineNotify = { enqueue: async (id: string, kind: string) => { linePushes.push({ id, kind }); } } as any;
  const opsAlerts = { raise: async (kind: string) => { alerts.push(kind); } } as any;
  const provision = new ProvisionSignupUseCase(store.prisma, core, onboarding, config, adminNotify, lineNotify, opsAlerts);
  const rateLimit = {
    assertLineSignupAttemptAllowed: async () => undefined,
    assertLineSignupUserAllowed: async () => undefined,
    recordLineSignupUser: async () => undefined,
  } as any;
  const lineIdToken = {
    verify: async () => ({ providerUserId: 'Uline-1', channelId: 'channel-1', displayName: 'นิด' }),
  } as any;

  return {
    submit: new SubmitLineSignupUseCase(store.prisma, config, core, lineIdToken, rateLimit, adminNotify, provision, opsAlerts),
    provision,
    core,
    store,
    notified,
    alerts,
  };
}

describe('AUTO_FREE end to end (review HIGH-1)', () => {
  it('names a real SYSTEM_ADMIN as the operator, so the onboarding foreign keys hold', async () => {
    const h = harness();
    const result = await h.submit.execute(CMD, NOW);

    // Before the fix this threw P2003 from the onboarding run insert and every AUTO_FREE
    // application landed in PROVISIONING_FAILED instead of opening a shop.
    assert.equal(result.state, 'COMPLETED');
    assert.equal(h.store.onboardingRuns[0].createdBySystemAdminUserId, 'sysadmin-1');
    const request = [...h.store.requests.values()][0];
    assert.equal(request.state, 'COMPLETED');
    // Spec §5: the row still records that no admin decided this.
    assert.equal(request.approvedByUserId, undefined);
    assert.equal(request.autoApproved, true);
    // The machine, not the operator, is the audit actor of the approval itself.
    const approved = h.store.audits.find((a) => a.action === 'signup.line.auto_approved');
    assert.equal(approved.actorRefId, 'line-signup-auto-approve');
    assert.equal(approved.actorUserId, undefined);

    // Review LOW-1: both audit rows must say the named human did not decide this. Asserted through
    // the REAL submit path, which passes an actor explicitly — the shape production actually makes,
    // and the one under which the previous derivation silently answered false.
    const provisioned = h.store.audits.find((a) => a.action === 'signup.request.provisioned');
    assert.equal(provisioned.metadataJson.operatorResolvedFromDirectory, true);
    assert.equal(provisioned.metadataJson.autoApproved, true);
    // Review LOW-4: this used to read `approvedByUserId ?? undefined`, which on an AUTO row is
    // null — leaving the one HIGH-risk audit of the whole flow with no actor at all.
    assert.equal(provisioned.actorUserId, 'sysadmin-1');
    const onboarded = h.store.audits.find((a) => a.action === 'system.company_onboarding.create');
    assert.equal(onboarded.metadataJson.operatorResolvedFromDirectory, true);
    assert.equal(onboarded.metadataJson.source, 'line-oa');
  });

  it('opens the shop with no credential and the clickwrap already recorded', async () => {
    const h = harness();
    await h.submit.execute(CMD, NOW);

    assert.equal(h.store.identities[0].providerUserId, 'Uline-1');
    assert.equal(h.store.legalRows.length, 2, 'terms and privacy, or the in-app gate stays shut');
    assert.equal(h.store.legalRows[0].authProvider, 'LINE_LIFF_SIGNUP');
    assert.equal(h.store.planTerms.get('co-1').tierKey, 'FREE_TRIAL_15');
    assert.equal(h.store.aiConfigs.get('co-1').monthlyBudgetSatang, 8000);
    assert.equal(h.store.lineContexts.get('Uline-1').companyId, 'co-1');
  });

  it('falls back to the admin queue when no SYSTEM_ADMIN exists to act as operator', async () => {
    const h = harness({ systemAdmins: [] });
    const result = await h.submit.execute(CMD, NOW);

    assert.equal(result.state, 'PENDING_REVIEW');
    assert.deepEqual(h.notified, [[...h.store.requests.values()][0].id]);
    assert.deepEqual(h.store.onboardingRuns, [], 'nothing may be provisioned with no operator');
    // The slot is not burned either: nothing was auto-approved.
    assert.equal([...h.store.requests.values()][0].autoApproved, undefined);
    assert.ok(h.store.audits.some((a) => a.action === 'signup.line.auto_approve_no_actor'));
  });

  it('falls back to the admin queue once the daily cap is reached', async () => {
    const h = harness({ config: { lineSignupAutoDailyCap: 0 } });
    const result = await h.submit.execute(CMD, NOW);

    assert.equal(result.state, 'PENDING_REVIEW');
    assert.deepEqual(h.store.onboardingRuns, []);
    assert.ok(h.store.audits.some((a) => a.action === 'signup.line.auto_approve_capped'));
    // §15.6 (a), driven end to end through submit rather than from a stubbed decision.
    assert.deepEqual(h.alerts, ['auto_cap_reached']);
  });

  it('tells nobody about a cap that was never reached', async () => {
    const h = harness({ config: { lineSignupAutoDailyCap: 20 } });
    await h.submit.execute(CMD, NOW);
    assert.deepEqual(h.alerts, []);
  });
});

/**
 * Review HIGH-A/HIGH-C, and the reason the earlier retry spec was green while the bug was real: it
 * mocked `provision`. These drive submit → core → provisioning → onboarding for real and kill the
 * process at each point AFTER the company has committed.
 */
describe('a provisioning that dies in its tail is recoverable (review HIGH-A / HIGH-C)', () => {
  /**
   * Fails the first call that matches, then behaves normally — a transient tail failure. The
   * predicate matters: `updateMany` backs EVERY state transition, so an untargeted break fires at
   * RECEIVED → VALIDATED and never reaches the tail this is about.
   */
  function breakOnce(store: any, model: string, method: string, when: (args: any) => boolean, message = 'connection reset') {
    const original = store.prisma.client[model][method];
    let fired = false;
    store.prisma.client[model][method] = async (args: any) => {
      if (!fired && when(args)) { fired = true; throw new Error(message); }
      return original(args);
    };
  }

  /** The audit transaction, which runs after the fence has already moved the row to READY. */
  const isAuditTailWrite = (args: any) => args?.data?.pendingPasswordHash === null;

  it('retries to COMPLETED with one company and one identity after completeProvisioning dies', async () => {
    const h = harness();
    // The CAS that moves PROVISIONING → READY: the first write after the company transaction.
    breakOnce(h.store, 'companySignupRequest', 'updateMany', (args) => args?.data?.state === 'READY');

    await assert.rejects(() => h.submit.execute(CMD, NOW), /connection reset/);
    const request = [...h.store.requests.values()][0];
    assert.equal(request.state, 'PROVISIONING_FAILED');
    // The company exists and the row already knows which one — that is what makes recovery possible.
    assert.equal(request.companyId, 'co-1');
    assert.equal(h.store.identities.length, 1);

    // The admin retry. Before the fix this re-ran onboarding and died on the identity unique index.
    await h.provision.execute({
      requestId: request.id,
      actorUserId: 'sysadmin-1',
      correlationRequestId: 'req-2',
      webBaseUrl: CMD.webBaseUrl,
      apiBaseUrl: CMD.apiBaseUrl,
    });

    assert.equal(request.state, 'COMPLETED');
    assert.equal(h.store.onboardingRuns.length, 1, 'exactly one company was ever built');
    assert.equal(h.store.identities.length, 1, 'and exactly one LINE identity');
  });

  it('finishes a row stranded at READY instead of parking it there forever', async () => {
    const h = harness();
    // Dies in the audit tail, so the fence has already recorded READY. `failProvisioning` then
    // cannot move it (the attempt no longer holds PROVISIONING), and the row stops there.
    breakOnce(h.store, 'companySignupRequest', 'update', isAuditTailWrite);

    await assert.rejects(() => h.submit.execute(CMD, NOW), /connection reset/);
    const request = [...h.store.requests.values()][0];
    assert.equal(request.state, 'READY');
    assert.equal(request.companyId, 'co-1');
    // Review HIGH-C: READY is an OPEN state, so this customer's LINE account is still fenced —
    // which is the only reason the stranding is safe rather than a second-company bug.
    assert.ok(LINE_OPEN_APPLICATION_STATES.includes('READY'));

    await h.provision.execute({
      requestId: request.id,
      actorUserId: 'sysadmin-1',
      correlationRequestId: 'req-2',
      webBaseUrl: CMD.webBaseUrl,
      apiBaseUrl: CMD.apiBaseUrl,
    });

    assert.equal(request.state, 'COMPLETED');
    assert.equal(h.store.onboardingRuns.length, 1, 'the shop is finished, not rebuilt');
    assert.equal(h.store.identities.length, 1);
  });

  it('reports the real failure rather than the fence release that could not run', async () => {
    const h = harness();
    // Same shape as above: by the time this throws the row is READY, so the `failProvisioning` in
    // the catch raises `provisioning_attempt_mismatch` — which used to be all the caller ever saw.
    breakOnce(h.store, 'companySignupRequest', 'update', isAuditTailWrite, 'the original cause');

    await assert.rejects(() => h.submit.execute(CMD, NOW), (error: Error) => {
      assert.match(error.message, /the original cause/);
      assert.doesNotMatch(error.message, /provisioning_attempt_mismatch/);
      return true;
    });
  });
});

describe('the company link is written inside the company transaction', () => {
  // The discriminating probe. A rollback test alone cannot tell "inside" from "just after": when
  // the transaction throws, a post-transaction stamp is skipped too, so both look identical. This
  // reads the row from INSIDE the still-open transaction, where only an in-tx write is visible.
  it('has already linked the request by the time the rest of the transaction runs', async () => {
    const h = harness();
    let linkedDuringTransaction: string | undefined;
    const realCreate = h.store.prisma.client.companyOnboardingRun.create;
    h.store.prisma.client.companyOnboardingRun.create = async (args: any) => {
      linkedDuringTransaction = [...h.store.requests.values()][0]?.companyId;
      return realCreate(args);
    };

    await h.submit.execute(CMD, NOW);
    assert.equal(linkedDuringTransaction, 'co-1', 'the stamp must commit WITH the company, not after it');
  });

  it('leaves no company and no link when onboarding rolls back after the stamp', async () => {
    const h = harness();
    // The stamp happens early in the transaction; this dies later in the same one. If the write
    // were ever moved outside the tx, the request would keep a companyId for a company that does
    // not exist — and the retry would adopt a ghost.
    h.store.prisma.client.companyOnboardingRun.create = async () => {
      throw new Error('task replaced mid-transaction');
    };

    await assert.rejects(() => h.submit.execute(CMD, NOW), /task replaced/);
    const request = [...h.store.requests.values()][0];
    assert.equal(request.companyId, undefined, 'the link rolled back with the company');
    assert.deepEqual(h.store.onboardingRuns, []);
    assert.deepEqual(h.store.identities, [], 'and so did the owner identity');
  });
});

/**
 * Review MEDIUM-1. The advisory lock only covers the claim, so a stale re-claim can put two
 * provisioning runs in flight for one application. On the LINE ATTACH path nothing else would stop
 * a second Company: no ExternalIdentity is created and duplicate names are legal. The conditional
 * stamp inside the onboarding transaction is what makes the loser create nothing at all.
 */
describe('two overlapping provisioning runs still produce one company (review MEDIUM-1)', () => {
  /** Drives onboarding directly, which is where the stamp and the rollback both live. */
  const onboardingCmd = (requestId: string) => ({
    companyName: 'ร้านมั่งมี',
    businessCategory: 'RETAIL' as const,
    ownerDisplayName: 'นิด',
    ownerAuth: { kind: 'line' as const, providerUserId: 'Uline-1', channelId: 'channel-1' },
    allowDuplicateCompanyName: true,
    linkSignupRequestId: requestId,
    requestingAdminUserId: 'sysadmin-1',
    requestId: 'req-1',
    webBaseUrl: 'https://app.example.com',
    apiBaseUrl: 'https://api.example.com/v1',
  });

  // Which run reaches the stamp first is decided by a real head start, so the two cases are
  // genuinely different runs — the previous version mapped over ['A','B'] and ignored the element,
  // so both "orderings" executed the identical body and only one of them was ever exercised.
  const headStart = async (ticks: number, run: () => Promise<unknown>) => {
    for (let tick = 0; tick < ticks; tick += 1) await Promise.resolve();
    return run();
  };

  for (const [label, delays] of [['A stamps first', [0, 4]], ['B stamps first', [4, 0]]] as const) {
    it(`lets only one run keep its company when ${label}`, async () => {
      // A FRESH store: both runs race from the overlap window, with no company yet. (Racing after
      // a completed submit only proved the fake reuses one company id for every create.)
      const h = harness();
      const requestId = 'signup-race';
      h.store.requests.set(requestId, { id: requestId, state: 'PROVISIONING', version: 0, companyId: null });

      const legal = new LegalAcceptanceService(h.store.prisma, { log: async () => undefined } as any);
      const onboarding = new CreateCompanyOnboardingUseCase(h.store.prisma, CONFIG, legal);
      const results = await Promise.allSettled(
        delays.map((ticks) => headStart(ticks, () => onboarding.execute(onboardingCmd(requestId)))),
      );

      // The run with no head start is the one that reaches the stamp first.
      const expectedWinner = delays.indexOf(0);
      assert.equal(results[expectedWinner]!.status, 'fulfilled', `${label}: that run must keep its company`);
      const loser = results[1 - expectedWinner]!;
      assert.equal(loser.status, 'rejected');
      assert.match(String((loser as PromiseRejectedResult).reason), /signup_already_provisioned/);
      // Re-read from the store: asserting on a detached reference is how the global-snapshot
      // rollback bug hid — it wiped the winner's write while the local object still looked right.
      assert.equal(h.store.requests.get(requestId).companyId, 'co-1', 'and the row names the winner');
      // The loser threw at the stamp, before it wrote anything else: one onboarding run exists.
      assert.equal(h.store.onboardingRuns.length, 1);
      assert.equal(h.store.memberships.length, 1, 'and one owner membership, not two');
    });
  }
});

describe('a fence nobody is holding can be taken (review MEDIUM-3)', () => {
  const claimAgain = (h: ReturnType<typeof harness>, id: string, now: Date) =>
    h.core.claimProvisioning(id, 'req-2', now);

  it('refuses while an attempt is plausibly still running', async () => {
    const h = harness();
    await h.submit.execute(CMD, NOW);
    const request = [...h.store.requests.values()][0];
    // Put it back mid-flight, one second old.
    Object.assign(request, { state: 'PROVISIONING', provisioningStartedAt: new Date(NOW.getTime() - 1_000) });

    const claim = await claimAgain(h, request.id, NOW);
    assert.equal(claim.claimed, false, 'a live attempt keeps the fence');
  });

  it('re-claims a row whose holder disappeared, and records that it did', async () => {
    const h = harness();
    await h.submit.execute(CMD, NOW);
    const request = [...h.store.requests.values()][0];
    // Nothing releases the fence when the process holding it dies, and there is no sweep.
    Object.assign(request, { state: 'PROVISIONING', provisioningStartedAt: new Date(NOW.getTime() - STALE_PROVISIONING_MS - 1_000) });
    const attemptBefore = request.provisioningAttemptId;

    const claim = await claimAgain(h, request.id, NOW);
    assert.equal(claim.claimed, true);
    assert.notEqual(claim.attemptId, attemptBefore, 'a new attempt owns it now');
    assert.ok(h.store.audits.some((a) => a.action === 'signup.provisioning.reclaimed_stale'));
  });

  it('adopts the company the dead attempt had already committed', async () => {
    const h = harness();
    await h.submit.execute(CMD, NOW);
    const request = [...h.store.requests.values()][0];
    // The crash shape MEDIUM-3 describes: mid-flight forever, but the company did commit.
    Object.assign(request, { state: 'PROVISIONING', provisioningStartedAt: new Date(NOW.getTime() - STALE_PROVISIONING_MS - 1_000) });

    await h.provision.execute({
      requestId: request.id,
      actorUserId: 'sysadmin-1',
      correlationRequestId: 'req-2',
      webBaseUrl: CMD.webBaseUrl,
      apiBaseUrl: CMD.apiBaseUrl,
    });

    assert.equal(request.state, 'COMPLETED');
    assert.equal(h.store.onboardingRuns.length, 1, 'no second company was built');
    assert.equal(h.store.identities.length, 1);
  });
});

/**
 * UAT cmto4xtrx002r4o5tf7o38dls, end to end over the real submit → core → provisioning → onboarding
 * chain. The tester had linked this LINE account and unlinked it, so the row sat UNLINKED while
 * still owning the unique slot: submit reported `existingAccount: false`, onboarding's `create`
 * raised P2002, the request parked at PROVISIONING_FAILED and every retry repeated it.
 */
describe('a LINE account that was unlinked can open a new shop', () => {
  /** The stale row the old shop left behind, pointing at the account that has moved on. */
  const seedUnlinked = (h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) => {
    h.store.identities.push({
      id: 'ext-old', userId: 'user-old', provider: 'LINE',
      providerUserId: 'Uline-1', providerChannelId: 'channel-1', status: 'UNLINKED', ...overrides,
    });
  };

  it('re-points the stale identity instead of dying on the unique slot', async () => {
    const h = harness();
    seedUnlinked(h);

    const result = await h.submit.execute(CMD, NOW);

    assert.equal(result.state, 'COMPLETED', 'this used to be PROVISIONING_FAILED, forever');
    assert.equal(result.existingAccount, false, 'a new account, not the one that walked away');
    assert.equal(h.store.identities.length, 1, 'the slot holds ONE row, as its unique index says');
    const identity = h.store.identities[0];
    assert.equal(identity.id, 'ext-old', 'the same row, re-pointed');
    assert.equal(identity.status, 'ACTIVE');
    assert.notEqual(identity.userId, 'user-old', 'and it belongs to the new shop owner now');

    // Support has to be able to see the account this LINE moved off.
    const moved = h.store.audits.find((a) => a.action === 'auth.identity.repointed');
    assert.equal(moved.metadataJson.previousUserId, 'user-old');
    assert.equal(moved.metadataJson.ownerUserId, identity.userId);

    // Owner 2026-09-05: the chat has to land on the NEW shop, never on the one left behind.
    assert.equal(h.store.lineContexts.get('Uline-1').companyId, 'co-1');
  });

  it('touches nothing but the identity row on the way past', async () => {
    const h = harness();
    seedUnlinked(h);
    const writes: Array<{ model: string; where: any }> = [];
    for (const model of ['company', 'companyMembership', 'user'] as const) {
      const real = h.store.prisma.client[model].update;
      h.store.prisma.client[model].update = async (args: any) => {
        writes.push({ model, where: args?.where });
        return real(args);
      };
    }

    await h.submit.execute(CMD, NOW);

    // Owner 2026-09-05: re-pointing a LINE account must not reactivate the old shop, its
    // memberships, its plan term or the account that owned it. Every write this flow makes is
    // against the company it just created; the account that walked away is never touched.
    assert.deepEqual(
      [...new Set(writes.map((w) => `${w.model}:${w.where?.id}`))],
      ['company:co-1'],
      'only the new shop is written to',
    );
    assert.equal(h.store.memberships.length, 1, 'one membership, for the new shop');
    assert.equal(h.store.memberships[0].userId, h.store.identities[0].userId);
    assert.deepEqual([...h.store.planTerms.keys()], ['co-1'], 'and one plan term, for the new shop');
  });

  it('refuses at submit, before any row exists, when the identity is disabled', async () => {
    const h = harness();
    seedUnlinked(h, { status: 'DISABLED' });

    await assert.rejects(() => h.submit.execute(CMD, NOW), /line_signup_identity_disabled/);
    assert.equal(h.store.requests.size, 0, 'no application, so nothing for an admin to find');
    assert.deepEqual(h.store.onboardingRuns, []);
  });

  it('refuses at submit when the account behind an ACTIVE identity is suspended', async () => {
    const h = harness();
    seedUnlinked(h, { status: 'ACTIVE', user: { status: 'SUSPENDED' } });

    await assert.rejects(() => h.submit.execute(CMD, NOW), /line_signup_account_blocked/);
    assert.equal(h.store.requests.size, 0);
  });
});

describe('trial guards survive a missing plan term (review HIGH-3)', () => {
  it('still completes and writes the term when onboarding left none behind', async () => {
    const h = harness();
    // Onboarding writes the term AFTER its transaction, best-effort by design — so provisioning
    // must cope with it never having happened rather than raising P2025 on a finished company.
    h.store.prisma.client.companyPlanTerm.upsert = (() => {
      let onboardingWriteSkipped = false;
      const real = h.store.planTerms;
      return async ({ where, create, update }: any) => {
        if (!onboardingWriteSkipped) { onboardingWriteSkipped = true; return {}; }
        const existing = real.get(where.companyId);
        if (!existing) { real.set(where.companyId, { ...create }); return real.get(where.companyId); }
        Object.assign(existing, update ?? {});
        return existing;
      };
    })();

    const result = await h.submit.execute(CMD, NOW);

    assert.equal(result.state, 'COMPLETED');
    const term = h.store.planTerms.get('co-1');
    assert.equal(term.tierKey, 'FREE_TRIAL_15', 'the guard creates the term it could not find');
    assert.equal(term.monthlySlipLimit, 15);
    assert.equal(term.warmupSlipLimit, 10);
    assert.equal(h.store.aiConfigs.get('co-1').monthlyBudgetSatang, 8000, 'the money stop still lands');
  });

  it('never turns a finished shop into a failure when a guard write dies', async () => {
    const h = harness();
    h.store.prisma.client.companyAiConfiguration.upsert = async () => {
      throw new Error('connection reset');
    };

    const result = await h.submit.execute(CMD, NOW);

    assert.equal(result.state, 'COMPLETED', 'the company exists; a guard failure must not undo it');
    assert.ok(
      h.store.audits.some((a) => a.action === 'signup.line.trial_guards_failed' && a.metadataJson.step === 'ai_budget'),
      'and it is recorded as evidence an operator can act on',
    );
    // The other guards still ran: one failure must not skip the rest.
    assert.equal(h.store.lineContexts.get('Uline-1').companyId, 'co-1');
  });
});
