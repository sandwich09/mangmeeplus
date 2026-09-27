import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
import {
  EXPLICIT_COHORT,
  LEGACY_COHORT,
  LEGACY_GRANT_ORIGIN,
  NORMALIZER_VERSION,
  SYSTEM_ACTOR,
} from '../../../employee-access/application/normalize-entitlements';
import { SetPartnerFeaturesUseCase } from './set-partner-features.use-case';

function makeCmd(
  features: Array<{ featureKey: string; enabled: boolean }>,
  overrides: Partial<{ commandId: string; expectedSetVersion: number; confirmCascade: boolean; requestId: string }> = {},
) {
  return {
    companyId: 'co-1',
    features,
    requestingAdminUserId: 'admin-1',
    requestId: 'req-1',
    commandId: 'req-1',
    expectedSetVersion: 0,
    ...overrides,
  };
}

type ExistingRow = {
  featureKey: string;
  enabled: boolean;
  epoch?: number;
  lastSeq?: number;
  /** CC7 (spec:235) grandfather marker. `'LEGACY'` = this access predates explicit entitlements. */
  grantOrigin?: string | null;
};

function makePrisma(opts: {
  companyFound?: boolean;
  status?: string;
  existing?: ExistingRow[];
  setVersion?: number;
  storedCommand?: { payloadFingerprint: string; resultJson: unknown } | null;
  /** Simulates a duplicate command that commits while this caller waits on the advisory lock. */
  storedCommandAfterLock?: { payloadFingerprint: string; resultJson: unknown } | null;
  casCount?: number;
  /** `null` = no CompanyEntitlementNormalization row at all (the legacy company shape). */
  normalizationStatus?: string | null;
  /** Defaults to a CURRENT marker; below `NORMALIZER_VERSION` is a company awaiting repair. */
  normalizerVersion?: number;
  /** `null` = a marker written before the cohort column existed — never a cohort (UAT r7). */
  cohortKind?: string | null;
  /** Transitions already on the append-only log. `SYSTEM` = a machine pass, never a human decision. */
  priorTransitions?: Array<{ featureKey: string; actorUserId: string }>;
} = {}) {
  const companyFound = opts.companyFound ?? true;
  const status = opts.status ?? 'ACTIVE';
  const normalizationStatus = opts.normalizationStatus === undefined ? 'COMPLETED' : opts.normalizationStatus;
  const normalizerVersion = opts.normalizerVersion ?? NORMALIZER_VERSION;
  const cohortKind = opts.cohortKind === undefined ? LEGACY_COHORT : opts.cohortKind;
  const rows: ExistingRow[] = (opts.existing ?? []).map((row) => ({ epoch: 0, lastSeq: 0, grantOrigin: null, ...row }));
  let setVersion = opts.setVersion ?? 0;

  let upsertCalled = 0;
  const upsertedKeys: string[] = [];
  const upserts: any[] = [];
  const transitions: any[] = [];
  const commands: any[] = [];
  const audits: any[] = [];
  const casCalls: any[] = [];
  const raws: any[] = [];
  const snapshots: any[] = [];
  let txCalled = 0;
  const statementOf = (sql: any) => String(sql.strings?.join('?') ?? '');

  const tx = {
    aiConversation: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    // Every raw statement the command issues: the exclusive half of the CC1 claim protocol
    // (spec:60), the provenance UPDATE, and the runoff completer's fence bump — the last two must
    // NOT restamp `updatedAt`, which is why they are raw at all.
    $executeRaw: async (sql: any) => {
      raws.push(sql);
      const statement = statementOf(sql);
      // Apply the `lastSeq`-only UPDATEs so the fake's rows track the real fence. Without this the
      // runoff completer re-reads a `lastSeq` that never moved and reports the lifecycle as still
      // DRAINING after it just completed it.
      if (statement.includes('"lastSeq"')) {
        const [seq, , featureKey] = sql.values ?? [];
        const row = rows.find((candidate) => candidate.featureKey === featureKey);
        if (row) {
          row.lastSeq = seq;
          if (statement.includes('grantOrigin')) row.grantOrigin = null;
        }
      }
      return 1;
    },
    companyEntitlementSet: {
      updateMany: async (args: any) => {
        casCalls.push(args);
        const count = opts.casCount ?? (args.where.setVersion === setVersion ? 1 : 0);
        if (count === 1) setVersion = args.data.setVersion;
        return { count };
      },
    },
    companyFeatureEntitlement: {
      upsert: async (args: any) => {
        upsertCalled++;
        const featureKey = args.where.companyId_featureKey.featureKey;
        upsertedKeys.push(featureKey);
        upserts.push(args);
        // WRITE-THROUGH. The runoff completion that runs after this transaction re-reads the fence
        // it just advanced, so a fake that discards writes would report NOT_DRAINING for a drain it
        // had itself recorded. It also makes the `saved` read below return post-write values, which
        // is what the real command result carries.
        const existingRow = rows.find((row) => row.featureKey === featureKey);
        if (existingRow) Object.assign(existingRow, args.update);
        else rows.push({ grantOrigin: null, ...args.create });
        return {};
      },
      // Serves BOTH reads inside the transaction: the before-state read taken under the advisory
      // lock (featureKey/enabled/epoch/lastSeq/grantOrigin) and the post-write `saved` read (adds
      // updatedAt). `updatedAt` is FIXED: the only writer allowed to move it is a Prisma upsert, so
      // a test that sees it unchanged has proved nothing moved it.
      findMany: async () => rows.map((row) => ({
        ...row,
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
      })),
      findUnique: async (args: any) => {
        const featureKey = args.where.companyId_featureKey.featureKey;
        const row = rows.find((candidate) => candidate.featureKey === featureKey);
        return row ? { ...row, updatedAt: new Date('2026-07-31T00:00:00.000Z') } : null;
      },
    },
    entitlementTransition: {
      create: async (args: any) => { transitions.push(args.data); return {}; },
      // The runoff completer's reads: the latest DISABLE_REQUESTED for a key, and the
      // commandId-unique replay check that makes completion idempotent.
      //
      // `createdAt` is supplied HERE, not on create: it is a `@default(now())` column the command
      // never writes, so stamping it on the stored object would corrupt `transitions()` — the
      // surface every other test in this file deep-equals against. A read must still return it,
      // because the completer ages the drain from it (and a fake that omitted it made the
      // completion throw into its own swallow, which is invisible by design).
      findFirst: async (args: any) => {
        const match = [...transitions]
          .filter((transition) => transition.featureKey === args.where.featureKey
            && transition.action === args.where.action)
          .sort((a, b) => b.seq - a.seq)[0];
        return match ? { createdAt: new Date(), ...match } : null;
      },
      findUnique: async (args: any) => transitions
        .find((transition) => transition.featureKey === args.where.companyId_featureKey_commandId.featureKey
          && transition.commandId === args.where.companyId_featureKey_commandId.commandId) ?? null,
      // What `humanDecidedKeys` (employee-access) reads: the append-only log, filtered to the
      // transitions a REAL user id wrote. That filter is the whole contract — a machine pass must
      // never read as a human decision — so the fake applies it instead of returning everything.
      findMany: async (args: any) => [...(opts.priorTransitions ?? []), ...transitions]
        .filter((transition) => transition.actorUserId !== args.where.actorUserId.not)
        .map((transition) => ({ featureKey: transition.featureKey })),
    },
    entitlementCommand: {
      findUnique: async () => opts.storedCommandAfterLock ?? null,
      create: async (args: any) => { commands.push(args.data); return {}; },
    },
    auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
    // spec:60 — written in the SAME transaction as the DISABLE_REQUESTED transition it is keyed by.
    runoffSnapshot: {
      create: async (args: any) => { snapshots.push(args.data); return {}; },
      findUnique: async (args: any) => {
        const key = args.where.companyId_featureKey_disableSeq;
        return snapshots.find((snapshot) => snapshot.featureKey === key.featureKey
          && snapshot.disableSeq === key.disableSeq) ?? null;
      },
    },
  };

  return {
    upsertCalled: () => upsertCalled,
    upsertedKeys: () => upsertedKeys,
    upserts: () => upserts,
    transitions: () => transitions,
    commands: () => commands,
    audits: () => audits,
    snapshots: () => snapshots,
    casCalls: () => casCalls,
    advisoryLocks: () => raws
      .filter((sql) => statementOf(sql).includes('pg_advisory_xact_lock'))
      .map((sql) => String(sql.values?.[0] ?? '')),
    /** Every raw statement that is NOT the advisory lock, as `[statement, ...values]`. */
    rawWrites: () => raws
      .filter((sql) => !statementOf(sql).includes('pg_advisory_xact_lock'))
      .map((sql) => [statementOf(sql), ...(sql.values ?? [])]),
    txCalled: () => txCalled,
    setVersion: () => setVersion,
    client: {
      company: {
        findUnique: async () => companyFound ? { id: 'co-1', status } : null,
      },
      companyEntitlementNormalization: {
        findUnique: async () => (normalizationStatus === null
          ? null
          : { status: normalizationStatus, normalizerVersion, cohortKind }),
      },
      companyEntitlementSet: {
        upsert: async () => ({ setVersion }),
      },
      entitlementCommand: {
        findUnique: async () => opts.storedCommand ?? null,
      },
      // Deliberately NO `companyFeatureEntitlement` here: the before-state must be read inside the
      // transaction, under the advisory lock. A read from the non-transactional client throws.
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
        txCalled++;
        return fn(tx);
      },
    },
  } as any;
}

function makeUseCase(
  prisma: any,
  readiness: Record<string, unknown> = {},
): SetPartnerFeaturesUseCase {
  return new SetPartnerFeaturesUseCase(prisma, {
    load: async () => ({
      chartTemplateApplied: true,
      chartTemplateKey: 'TH_SME_COA_V1',
      chartTemplateVersion: 1,
      chartTemplateChecksum: 'checksum',
      chartTemplateAppliedAt: '2026-07-29T00:00:00.000Z',
      chartAccountCount: 175,
      chartConflicts: 0,
      requiredPostingRolesMissing: [],
      requiredTaxAccountRolesMissing: [],
      taxProfilesNeedingReview: 0,
      bankLedgerLinksInvalid: 0,
      legacyTaxHeaderMismatches: 0,
      sourcePostingErrors: 0,
      taxConfigurationRequired: false,
      readyForManualLedger: true,
      readyForAutomaticPosting: true,
      ...readiness,
    }),
  } as any);
}

/** Runs one command and returns the fingerprint the use case computed for it. */
async function fingerprintOf(cmd: ReturnType<typeof makeCmd>): Promise<string> {
  const prisma = makePrisma({ existing: [{ featureKey: 'inventory', enabled: false }] });
  const useCase = makeUseCase(prisma);
  await useCase.execute(cmd);
  return prisma.commands()[0].payloadFingerprint;
}

describe('SetPartnerFeaturesUseCase', () => {
  it('rejects empty, malformed, over-catalog and duplicate inputs at the application boundary', async () => {
    const cases: Array<[string, unknown]> = [
      ['entitlement_features_required', []],
      ['entitlement_features_required', null],
      ['entitlement_feature_invalid', [{ featureKey: 'inventory', enabled: 'yes' }]],
      ['entitlement_feature_batch_too_large', Array.from(
        { length: ALL_FEATURE_ENTITLEMENT_KEYS.length + 1 },
        (_, index) => ({ featureKey: `unknown-${index}`, enabled: true }),
      )],
      ['entitlement_feature_duplicate', [
        { featureKey: 'inventory', enabled: true },
        { featureKey: 'inventory', enabled: false },
      ]],
    ];

    for (const [code, features] of cases) {
      const prisma = makePrisma();
      await assert.rejects(
        () => makeUseCase(prisma).execute({ ...makeCmd([]), features } as any),
        (error: any) => {
          assert.ok(error instanceof UnprocessableEntityException);
          assert.equal((error.getResponse() as any).code, code);
          return true;
        },
      );
      assert.equal(prisma.txCalled(), 0);
      assert.equal(prisma.upsertCalled(), 0);
    }
  });

  it('throws NotFoundException when company not found', async () => {
    const prisma = makePrisma({ companyFound: false });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'inventory', enabled: true }])),
      (err: unknown) => { assert.ok(err instanceof NotFoundException); return true; },
    );
  });

  for (const lockedStatus of ['DISABLED', 'ARCHIVED']) {
    it(`throws UnprocessableEntityException when company is ${lockedStatus} — metadata is frozen`, async () => {
      const prisma = makePrisma({ status: lockedStatus });
      const useCase = makeUseCase(prisma);
      await assert.rejects(
        () => useCase.execute(makeCmd([{ featureKey: 'inventory', enabled: true }])),
        (err: unknown) => {
          assert.ok(err instanceof UnprocessableEntityException);
          assert.ok((err as Error).message.includes('lifecycle'));
          return true;
        },
      );
      assert.equal(prisma.txCalled(), 0, 'Transaction must not be called when company is locked');
    });
  }

  it('throws UnprocessableEntityException for unknown feature key — no partial save', async () => {
    const prisma = makePrisma();
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'inventory', enabled: true }, { featureKey: 'unknown_module_xyz', enabled: false }])),
      (err: unknown) => { assert.ok(err instanceof UnprocessableEntityException); return true; },
    );
    assert.equal(prisma.txCalled(), 0, 'Transaction must not be called when validation fails');
  });

  it('rejects multiple unknown keys listing all of them', async () => {
    const prisma = makePrisma();
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'bad_key_1', enabled: true }, { featureKey: 'bad_key_2', enabled: false }])),
      (err: unknown) => {
        assert.ok(err instanceof UnprocessableEntityException);
        assert.deepEqual((err as any).getResponse().featureKeys, ['bad_key_1', 'bad_key_2']);
        return true;
      },
    );
  });

  it('accepts the three new feature keys in one multi-key request', async () => {
    // A normalized company, so the before-state is real rows and not the fail-open sentinel.
    const prisma = makePrisma({ existing: [{ featureKey: 'expenses', enabled: false }] });
    const useCase = makeUseCase(prisma);

    await useCase.execute(makeCmd([
      { featureKey: 'reimbursement', enabled: true },
      { featureKey: 'product_catalog', enabled: false },
      { featureKey: 'line_oa', enabled: true },
    ]));

    // Canonical feature-key order, not payload order (spec:52).
    assert.deepEqual(prisma.upsertedKeys(), ['line_oa', 'product_catalog', 'reimbursement']);
  });

  it('rejects enabling expense Auto-post without the ledger', async () => {
    const prisma = makePrisma({
      existing: [{ featureKey: 'double_entry_ledger', enabled: false }],
    });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'expense_auto_post', enabled: true }])),
      (err: unknown) => {
        assert.ok(err instanceof UnprocessableEntityException);
        assert.match((err as Error).message, /requires double_entry_ledger/);
        return true;
      },
    );
    assert.equal(prisma.upsertCalled(), 0);
  });

  it('rejects enabling expense Auto-post until computed readiness passes', async () => {
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: true },
        { featureKey: 'expense_auto_post', enabled: false },
      ],
    });
    const useCase = makeUseCase(prisma, {
      requiredPostingRolesMissing: ['EXPENSE_CONFIRMED'],
      requiredTaxAccountRolesMissing: ['INPUT_VAT_CLAIMABLE'],
      sourcePostingErrors: 2,
      readyForAutomaticPosting: false,
    });
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'expense_auto_post', enabled: true }])),
      (error: any) => {
        const response = error.getResponse?.();
        return response?.code === 'coa_posting_readiness_incomplete'
          && response?.missingRoleKeys.includes('EXPENSE_CONFIRMED')
          && response?.missingRoleKeys.includes('INPUT_VAT_CLAIMABLE');
      },
    );
    assert.equal(prisma.upsertCalled(), 0);
  });

  it('allows enabling the dependent features together', async () => {
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: false },
        { featureKey: 'expense_auto_post', enabled: false },
      ],
    });
    const useCase = makeUseCase(prisma);
    await useCase.execute(makeCmd([
      { featureKey: 'double_entry_ledger', enabled: true },
      { featureKey: 'expense_auto_post', enabled: true },
    ]));
    assert.equal(prisma.upsertCalled(), 2);
  });

  it('disables them together, freezing both in place', async () => {
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: true },
        { featureKey: 'expense_auto_post', enabled: true },
      ],
    });
    const result = await makeUseCase(prisma).execute(makeCmd([
      { featureKey: 'double_entry_ledger', enabled: false },
      { featureKey: 'expense_auto_post', enabled: false },
    ]));
    assert.equal(prisma.upsertCalled(), 2);
    assert.deepEqual(
      result.features.filter((f) => f.featureKey.startsWith('double') || f.featureKey.startsWith('expense'))
        .map((f) => [f.featureKey, f.enabled]),
      [['double_entry_ledger', false], ['expense_auto_post', false]],
    );
  });

  it('does not move the Auto-post activation boundary when an unrelated feature changes', async () => {
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: true },
        { featureKey: 'expense_auto_post', enabled: true },
        { featureKey: 'inventory', enabled: false },
      ],
    });
    const useCase = makeUseCase(prisma);
    await useCase.execute(makeCmd([
      { featureKey: 'double_entry_ledger', enabled: true },
      { featureKey: 'expense_auto_post', enabled: true },
      { featureKey: 'inventory', enabled: true },
    ]));
    assert.deepEqual(prisma.upsertedKeys(), ['inventory']);
  });

  it('accepts approved parent and child feature keys', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'crm', enabled: false }] });
    const useCase = makeUseCase(prisma);
    const result = await useCase.execute(makeCmd([
      { featureKey: 'inventory', enabled: true },
      { featureKey: 'expenses', enabled: false },
      { featureKey: 'expenses.categories', enabled: false },
      { featureKey: 'bank_reconciliation.matching', enabled: false },
      { featureKey: 'employee_access', enabled: true },
      { featureKey: 'company_settings', enabled: true },
    ]));

    assert.equal(prisma.txCalled(), 1, 'every write commits in ONE transaction');
    assert.equal(result.companyId, 'co-1');
  });

  it('takes the exclusive company entitlement lock the CC1 claim shares (spec:60)', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'inventory', enabled: false }] });
    await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'inventory', enabled: true }]));
    assert.deepEqual(prisma.advisoryLocks(), ['entitlement:co-1']);
  });
});

describe('SetPartnerFeaturesUseCase — CC1 platform invariants (spec:262)', () => {
  for (const featureKey of ['employee_access', 'company_settings']) {
    it(`rejects an explicit false on ${featureKey}`, async () => {
      const prisma = makePrisma();
      const useCase = makeUseCase(prisma);
      await assert.rejects(
        () => useCase.execute(makeCmd([{ featureKey, enabled: false }])),
        (error: any) => {
          assert.ok(error instanceof UnprocessableEntityException);
          assert.equal((error.getResponse() as any).code, 'platform_feature_not_disableable');
          assert.deepEqual((error.getResponse() as any).featureKeys, [featureKey]);
          return true;
        },
      );
      assert.equal(prisma.txCalled(), 0);
    });
  }

  // The deleted runoff preflight refused these by inheriting the parent's verdict; this refusal is
  // now the ONLY thing standing between an operator and a tenant that cannot change its passwords
  // (`company_settings.security`) or manage its employees (`employee_access.employees`).
  for (const featureKey of [
    'employee_access.employees',
    'employee_access.roles',
    'employee_access.overview',
    'company_settings.branches',
    'company_settings.security',
  ]) {
    it(`rejects an explicit false on the platform submenu ${featureKey}`, async () => {
      const prisma = makePrisma({ existing: [{ featureKey, enabled: true }] });
      await assert.rejects(
        () => makeUseCase(prisma).execute(makeCmd([{ featureKey, enabled: false }])),
        (error: any) => {
          assert.equal((error.getResponse() as any).code, 'platform_feature_not_disableable');
          assert.deepEqual((error.getResponse() as any).featureKeys, [featureKey]);
          return true;
        },
      );
      assert.equal(prisma.txCalled(), 0);
    });
  }

  it('still accepts an explicit true on a platform key', async () => {
    const prisma = makePrisma();
    const useCase = makeUseCase(prisma);
    await useCase.execute(makeCmd([{ featureKey: 'employee_access', enabled: true }]));
    assert.deepEqual(prisma.upsertedKeys(), ['employee_access']);
  });
});

describe('SetPartnerFeaturesUseCase — CC1 dependency validation (spec:264)', () => {
  it('validates the proposed FINAL set, not the payload alone', async () => {
    // Payload only turns the ledger off; auto-post is ON in the stored rows.
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: true },
        { featureKey: 'expense_auto_post', enabled: true },
      ],
    });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'double_entry_ledger', enabled: false }])),
      UnprocessableEntityException,
    );
    assert.equal(prisma.upsertCalled(), 0);
  });

  it('answers a parent disable with a truthful impact preview instead of stranding the child', async () => {
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: true },
        { featureKey: 'expense_auto_post', enabled: true },
      ],
      setVersion: 4,
    });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd(
        [{ featureKey: 'double_entry_ledger', enabled: false }],
        { expectedSetVersion: 4 },
      )),
      (error: any) => {
        const body = (error.getResponse() as any);
        assert.equal(body.code, 'feature_cascade_confirmation_required');
        assert.equal(body.setVersion, 4);
        assert.deepEqual(body.impact, [
          { featureKey: 'expense_auto_post', requiresFeatureKey: 'double_entry_ledger' },
        ]);
        return true;
      },
    );
    // The before-state is read under the advisory lock, so the preview opens a transaction — but
    // it writes nothing and rolls the (never-bumped) set version back untouched.
    assert.equal(prisma.upsertCalled(), 0, 'the preview writes nothing');
    assert.equal(prisma.casCalls().length, 0);
    assert.equal(prisma.commands().length, 0);
    assert.equal(prisma.setVersion(), 4);
  });

  // The confirmed cascade switches the stranded child off in the SAME transaction as its
  // prerequisite, so the dependency matrix stays satisfied on a disable too.
  it('performs the confirmed cascade atomically and records who it dragged off', async () => {
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: true },
        { featureKey: 'expense_auto_post', enabled: true },
      ],
    });
    const result = await makeUseCase(prisma).execute(
      makeCmd([{ featureKey: 'double_entry_ledger', enabled: false }], { confirmCascade: true }),
    );

    assert.deepEqual(result.cascadedOffKeys, ['expense_auto_post']);
    assert.deepEqual(prisma.upsertedKeys(), ['double_entry_ledger', 'expense_auto_post']);
    assert.equal(prisma.commands().length, 1, 'parent and child commit under ONE command result');
    const audit = prisma.audits()[0].metadataJson;
    assert.deepEqual(audit.cascadedOffKeys, ['expense_auto_post']);
    assert.deepEqual(audit.changedKeys, [
      { featureKey: 'double_entry_ledger', fromEnabled: true, toEnabled: false },
      { featureKey: 'expense_auto_post', fromEnabled: true, toEnabled: false },
    ]);
    // The child's transition names the prerequisite that dragged it off.
    const child = prisma.transitions().find((t: any) => t.featureKey === 'expense_auto_post');
    assert.equal(child.reasonJson.cascadedFrom, 'double_entry_ledger');
  });

  it('rejects a structural procurement child enabled without its parent', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'procurement.vendor_bills', enabled: false }] });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'procurement.supplier_payments', enabled: true }])),
      (err: unknown) => {
        assert.match((err as Error).message, /requires procurement\.vendor_bills/);
        return true;
      },
    );
  });
});

/**
 * OWNER DECISION 2026-08-04 — FREEZE IN PLACE.
 * "ควรปิดได้และหยุดทำงาน แต่ถ้ามีข้อมูลเดิมค้างก็แค่ปิดไว้ไม่บล็อค": a post-onboarding disable of a sellable
 * family must SUCCEED, the family stops working, and residual data neither moves nor blocks. The
 * RUNOFF_MATRIX disable preflight that used to refuse every family except `reports` with
 * `feature_disable_pending_runoff` is deleted; `crm` (11 BLOCKED rows) and `inventory` (5) are used
 * here precisely because the old rule refused them.
 */
describe('SetPartnerFeaturesUseCase — disable freezes the family in place', () => {
  it('switches a matrix-BLOCKED family off and records the transition, snapshot and audit', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'crm', enabled: true, epoch: 3, lastSeq: 3 }] });
    const result = await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'crm', enabled: false }]));

    assert.equal(result.features.find((feature) => feature.featureKey === 'crm')?.enabled, false);
    assert.deepEqual(prisma.upsertedKeys(), ['crm']);
    // A real ON→OFF transition: the lifecycle runs, and freeze-in-place makes its snapshot empty, so
    // the drain completes on the first pass instead of parking.
    assert.deepEqual(prisma.transitions().map((t: any) => [t.featureKey, t.action]), [['crm', 'DISABLE_REQUESTED'], ['crm', 'OFF']]);
    assert.deepEqual(prisma.snapshots()[0].rootsJson.roots, []);
    // WHO disabled WHAT, and WHEN (the audit row the runbook triages from).
    const audit = prisma.audits()[0];
    assert.equal(audit.actorUserId, 'admin-1');
    assert.equal(audit.action, 'system.partner_feature.update');
    assert.deepEqual(audit.metadataJson.changedKeys, [
      { featureKey: 'crm', fromEnabled: true, toEnabled: false },
    ]);
    assert.equal(typeof audit.metadataJson.cutoffAt, 'string');
  });

  it('leaves enables, mixed commands and no-ops working', async () => {
    // A mixed command saves both halves in one transaction.
    const mixed = makePrisma({
      existing: [{ featureKey: 'crm', enabled: true }, { featureKey: 'inventory', enabled: false }],
    });
    await makeUseCase(mixed).execute(makeCmd([
      { featureKey: 'inventory', enabled: true },
      { featureKey: 'crm', enabled: false },
    ]));
    assert.deepEqual(mixed.upsertedKeys(), ['crm', 'inventory']);
    assert.equal(mixed.commands().length, 1, 'one command result covers both halves');

    // Pure enable: untouched.
    const enable = makePrisma({ existing: [{ featureKey: 'crm', enabled: false }] });
    const result = await makeUseCase(enable).execute(makeCmd([{ featureKey: 'crm', enabled: true }]));
    assert.equal(result.setVersion, 1);
    assert.deepEqual(enable.upsertedKeys(), ['crm']);

    // Already-off key resubmitted as false: a no-op, not a transition.
    const noop = makePrisma({ existing: [{ featureKey: 'crm', enabled: false }] });
    await makeUseCase(noop).execute(makeCmd([{ featureKey: 'crm', enabled: false }]));
    assert.equal(noop.upsertCalled(), 0);
  });

  it('still answers the cascade impact preview first, so the operator sees WHY before confirming', async () => {
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: true },
        { featureKey: 'expense_auto_post', enabled: true },
      ],
    });
    await assert.rejects(
      () => makeUseCase(prisma).execute(makeCmd([{ featureKey: 'double_entry_ledger', enabled: false }])),
      (error: any) => (error.getResponse() as any).code === 'feature_cascade_confirmation_required',
    );
    assert.equal(prisma.upsertCalled(), 0, 'the preview writes nothing');
  });
});

/**
 * F1.5.1 item 1 — the legacy-company command bypass. A company whose entitlement rows have not
 * been normalized has no trustworthy before-state, so EVERY command shape is refused with a
 * structured no-write 409 before anything can be written.
 */
describe('SetPartnerFeaturesUseCase — normalization gate (F1.5.1)', () => {
  const PENDING_COPY = 'ระบบกำลังเตรียมสิทธิ์ให้ ไม่ต้องดำเนินการ';

  // Every command SHAPE: a plain enable, a plain disable, the cascade confirm, and the payload
  // that would otherwise come back as the cascade impact preview.
  const shapes: Array<[string, ReturnType<typeof makeCmd>]> = [
    ['enable', makeCmd([{ featureKey: 'inventory', enabled: true }])],
    ['disable', makeCmd([{ featureKey: 'crm', enabled: false }])],
    ['cascade confirm', makeCmd([{ featureKey: 'double_entry_ledger', enabled: false }], { confirmCascade: true })],
    ['cascade preview', makeCmd([{ featureKey: 'double_entry_ledger', enabled: false }])],
  ];

  for (const [shape, cmd] of shapes) {
    for (const normalizationStatus of [null, 'STARTED', 'FAILED']) {
      it(`refuses a ${shape} command when normalization is ${normalizationStatus ?? 'absent'} — zero writes`, async () => {
        const prisma = makePrisma({
          normalizationStatus,
          setVersion: 6,
          existing: [
            { featureKey: 'double_entry_ledger', enabled: true },
            { featureKey: 'expense_auto_post', enabled: true },
            { featureKey: 'crm', enabled: true },
          ],
        });
        await assert.rejects(
          () => makeUseCase(prisma).execute(cmd),
          (error: any) => {
            assert.ok(error instanceof ConflictException);
            const body = error.getResponse() as any;
            assert.equal(body.code, 'company_entitlement_normalization_pending');
            assert.equal(body.message, PENDING_COPY);
            assert.equal(body.normalizationStatus, normalizationStatus);
            return true;
          },
        );
        assert.equal(prisma.txCalled(), 0);
        assert.equal(prisma.upsertCalled(), 0);
        assert.equal(prisma.casCalls().length, 0);
        assert.equal(prisma.transitions().length, 0);
        assert.equal(prisma.commands().length, 0);
        assert.equal(prisma.audits().length, 0);
        assert.equal(prisma.setVersion(), 6, 'setVersion is untouched');
      });
    }
  }

  it('replays a committed command before a later normalization-state change', async () => {
    const features = [{ featureKey: 'crm', enabled: true }];
    const fingerprint = await fingerprintOf(makeCmd(features, { commandId: 'cmd-1' }));
    const stored = { companyId: 'co-1', setVersion: 3, features: [], cascadedOffKeys: [] };
    const prisma = makePrisma({
      normalizationStatus: null,
      storedCommand: { payloadFingerprint: fingerprint, resultJson: stored },
    });
    const result = await makeUseCase(prisma).execute(makeCmd(features, { commandId: 'cmd-1' }));
    assert.deepEqual(result, stored);
    assert.equal(prisma.txCalled(), 0);
    assert.equal(prisma.upsertCalled(), 0);
  });

  /**
   * UAT r8 — COMPLETED alone is NOT the gate. `normalizeCompanyEntitlements` re-opens a COMPLETED
   * company whose marker is below `NORMALIZER_VERSION`, and `verifyCompanyNormalizations` reports a
   * null `cohortKind` as INCOMPLETE, because a marker written before the column existed never had
   * its grandfather claim verified. Both are companies whose repair pass has not run yet, and a
   * partner command accepted against either one compounds the misclassification the repair fixes.
   */
  const staleMarkers = [
    ['a version below the current normalizer', { normalizerVersion: NORMALIZER_VERSION - 1, cohortKind: LEGACY_COHORT }],
    ['no cohort recorded at all', { normalizerVersion: NORMALIZER_VERSION, cohortKind: null }],
    ['a cohort no normalizer ever writes', { normalizerVersion: NORMALIZER_VERSION, cohortKind: 'GRANDFATHERED' }],
  ] as const;

  for (const [label, marker] of staleMarkers) {
    it(`refuses a COMPLETED company with ${label} — zero writes`, async () => {
      const prisma = makePrisma({
        ...marker,
        setVersion: 6,
        existing: [{ featureKey: 'inventory', enabled: false }],
      });
      await assert.rejects(
        () => makeUseCase(prisma).execute(makeCmd([{ featureKey: 'inventory', enabled: true }])),
        (error: any) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as any;
          assert.equal(body.code, 'company_entitlement_normalization_pending');
          assert.equal(body.message, PENDING_COPY);
          assert.equal(body.normalizationStatus, 'COMPLETED');
          // WHICH condition failed: a stale COMPLETED is otherwise indistinguishable from a company
          // that never started, and the operator answer differs.
          assert.equal(body.normalizerVersion, marker.normalizerVersion);
          assert.equal(body.cohortKind, marker.cohortKind);
          return true;
        },
      );
      assert.equal(prisma.txCalled(), 0);
      assert.equal(prisma.upsertCalled(), 0);
      assert.equal(prisma.transitions().length, 0);
      assert.equal(prisma.setVersion(), 6, 'setVersion is untouched');
    });
  }

  for (const cohortKind of [LEGACY_COHORT, EXPLICIT_COHORT]) {
    it(`lets a COMPLETED ${cohortKind} company at the current version through`, async () => {
      const prisma = makePrisma({
        normalizationStatus: 'COMPLETED',
        cohortKind,
        existing: [{ featureKey: 'inventory', enabled: false }],
      });
      const result = await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'inventory', enabled: true }]));
      assert.equal(result.setVersion, 1);
      assert.deepEqual(prisma.upsertedKeys(), ['inventory']);
    });
  }
});

/**
 * The bypass itself: a COMPLETED company whose rows still read as fail-open (zero rows) or as
 * legacy inheritance is EFFECTIVELY ON at runtime. Deciding from raw stored rows called that
 * `false`, so a live feature went dark recorded as a bare `OFF` materialization — no
 * DISABLE_REQUESTED, no cutoff, and no epoch fence for the re-enable to move past.
 *
 * Freeze-in-place does not soften this: the disable is admitted, but WHICH transition it is must
 * still come from the canonical evaluator.
 */
describe('SetPartnerFeaturesUseCase — before-state is the canonical evaluator (F1.5.1)', () => {
  it('records a fail-open (zero-row) feature going off as a REAL disable', async () => {
    const prisma = makePrisma({ setVersion: 2 });
    await makeUseCase(prisma).execute(makeCmd(
      [{ featureKey: 'crm', enabled: false }],
      { expectedSetVersion: 2 },
    ));
    const [requested] = prisma.transitions();
    assert.equal(requested.action, 'DISABLE_REQUESTED', 'it was effectively ON at runtime');
    assert.equal(requested.reasonJson.fromEnabled, true);
    assert.equal(prisma.snapshots().length, 1, 'and the cutoff is recorded');
    assert.equal(prisma.setVersion(), 3);
  });

  it('picks the one real disable out of the full-snapshot first click', async () => {
    // The web materializes the whole set on the first write; every absent key rides along as an
    // explicit row. Exactly one of them is a disable — and only that one takes the lifecycle.
    const prisma = makePrisma();
    const features = ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({
      featureKey,
      enabled: featureKey !== 'crm.leads',
    }));
    await makeUseCase(prisma).execute(makeCmd(features));
    assert.deepEqual(
      prisma.transitions().filter((t: any) => t.action === 'DISABLE_REQUESTED').map((t: any) => t.featureKey),
      ['crm.leads'],
    );
    assert.deepEqual(prisma.snapshots().map((snapshot: any) => snapshot.featureKey), ['crm.leads']);
  });

  it('records a feature that is ON only through legacy inheritance as a REAL disable', async () => {
    // `line_oa` has no row of its own; the evaluator infers it from `crm` (LEGACY_FEATURE_INHERITANCE).
    const prisma = makePrisma({ existing: [{ featureKey: 'crm', enabled: true }] });
    await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'line_oa', enabled: false }]));
    assert.deepEqual(prisma.upsertedKeys(), ['line_oa']);
    assert.equal(prisma.transitions()[0].action, 'DISABLE_REQUESTED');
  });

  it('does not bump the epoch when a row is materialized for a feature that was already ON', async () => {
    // `crm.leads` is effectively ON (parent `crm` is on, no explicit row). Writing the explicit
    // `true` row is a materialization, not an OFF→ON transition, so live claims stay valid.
    const prisma = makePrisma({ existing: [{ featureKey: 'crm', enabled: true, epoch: 4, lastSeq: 4 }] });
    await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'crm.leads', enabled: true }]));
    assert.deepEqual(prisma.upsertedKeys(), ['crm.leads']);
    const [transition] = prisma.transitions();
    assert.equal(transition.epoch, 0, 'no epoch bump: it was already ON at runtime');
    assert.equal(transition.seq, 1);
    assert.equal(transition.reasonJson.fromEnabled, true, 'the audit trail records the EFFECTIVE before-state');
  });

  it('reads the before-state under the advisory lock, not before it', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'inventory', enabled: false }] });
    await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'inventory', enabled: true }]));
    assert.deepEqual(prisma.advisoryLocks(), ['entitlement:co-1']);
    assert.deepEqual(prisma.audits()[0].metadataJson.changedKeys, [
      { featureKey: 'inventory', fromEnabled: false, toEnabled: true },
    ]);
  });
});

describe('SetPartnerFeaturesUseCase — CC1 set CAS + command idempotency (spec:51)', () => {
  it('CASes on the expected set version and bumps it exactly once', async () => {
    const prisma = makePrisma({ setVersion: 7, existing: [{ featureKey: 'crm', enabled: false }] });
    const useCase = makeUseCase(prisma);
    const result = await useCase.execute(
      makeCmd([{ featureKey: 'crm', enabled: true }], { expectedSetVersion: 7 }),
    );

    assert.equal(prisma.casCalls().length, 1);
    assert.equal(prisma.casCalls()[0].where.setVersion, 7);
    assert.equal(prisma.casCalls()[0].data.setVersion, 8);
    assert.equal(result.setVersion, 8);
    assert.equal(prisma.commands()[0].expectedSetVersion, 7);
    assert.equal(prisma.commands()[0].resultSetVersion, 8);
  });

  it('rejects a stale expected set version and changes nothing', async () => {
    const prisma = makePrisma({ setVersion: 9, existing: [{ featureKey: 'crm', enabled: false }] });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'crm', enabled: true }], { expectedSetVersion: 3 })),
      (error: any) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error.getResponse() as any).code, 'entitlement_set_version_conflict');
        assert.equal((error.getResponse() as any).currentSetVersion, 9);
        return true;
      },
    );
    assert.equal(prisma.txCalled(), 0);
    assert.equal(prisma.upsertCalled(), 0);
  });

  it('aborts the whole transaction when the CAS loses a race inside it', async () => {
    const prisma = makePrisma({ setVersion: 2, existing: [{ featureKey: 'crm', enabled: false }], casCount: 0 });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'crm', enabled: true }], { expectedSetVersion: 2 })),
      (error: any) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error.getResponse() as any).code, 'entitlement_set_version_conflict');
        return true;
      },
    );
    assert.equal(prisma.upsertCalled(), 0, 'CAS is checked before any row write');
    assert.equal(prisma.commands().length, 0);
  });

  it('replays the stored result for the same commandId + same payload', async () => {
    const features = [{ featureKey: 'crm', enabled: true }];
    const fingerprint = await fingerprintOf(makeCmd(features, { commandId: 'cmd-1' }));

    const stored = { companyId: 'co-1', setVersion: 3, features: [], cascadedOffKeys: [] };
    const prisma = makePrisma({
      existing: [{ featureKey: 'crm', enabled: false }],
      storedCommand: { payloadFingerprint: fingerprint, resultJson: stored },
    });
    const useCase = makeUseCase(prisma);
    const result = await useCase.execute(makeCmd(features, { commandId: 'cmd-1' }));

    assert.deepEqual(result, stored);
    assert.equal(prisma.txCalled(), 0, 'a replay must not re-run the command');
    assert.equal(prisma.upsertCalled(), 0);
  });

  it('replays regardless of payload key order', async () => {
    const fingerprint = await fingerprintOf(makeCmd([
      { featureKey: 'crm', enabled: true },
      { featureKey: 'inventory', enabled: true },
    ], { commandId: 'cmd-1' }));

    const prisma = makePrisma({
      storedCommand: { payloadFingerprint: fingerprint, resultJson: { companyId: 'co-1' } },
    });
    const useCase = makeUseCase(prisma);
    await useCase.execute(makeCmd([
      { featureKey: 'inventory', enabled: true },
      { featureKey: 'crm', enabled: true },
    ], { commandId: 'cmd-1' }));
    assert.equal(prisma.txCalled(), 0);
  });

  it('replays a duplicate that commits while this caller waits on the company lock', async () => {
    const features = [{ featureKey: 'crm', enabled: true }];
    const fingerprint = await fingerprintOf(makeCmd(features, { commandId: 'cmd-race' }));
    const stored = { companyId: 'co-1', setVersion: 1, features: [], cascadedOffKeys: [] };
    const prisma = makePrisma({
      existing: [{ featureKey: 'crm', enabled: false }],
      storedCommandAfterLock: { payloadFingerprint: fingerprint, resultJson: stored },
    });

    const result = await makeUseCase(prisma).execute(makeCmd(features, { commandId: 'cmd-race' }));

    assert.deepEqual(result, stored);
    assert.equal(prisma.txCalled(), 1, 'the replay was discovered only after taking the lock');
    assert.equal(prisma.casCalls().length, 0, 'a committed duplicate never reaches the stale CAS');
    assert.equal(prisma.commands().length, 0, 'it does not append a second command result');
  });

  it('rejects commandId reuse with a different payload', async () => {
    const prisma = makePrisma({
      existing: [{ featureKey: 'crm', enabled: false }],
      storedCommand: { payloadFingerprint: 'a-different-fingerprint', resultJson: {} },
    });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute(makeCmd([{ featureKey: 'crm', enabled: true }], { commandId: 'cmd-1' })),
      (error: any) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error.getResponse() as any).code, 'entitlement_command_conflict');
        assert.equal((error.getResponse() as any).commandId, 'cmd-1');
        return true;
      },
    );
    assert.equal(prisma.txCalled(), 0);
  });

  it('treats confirmCascade as part of the fingerprint', async () => {
    const plain = await fingerprintOf(makeCmd([{ featureKey: 'crm', enabled: true }], { commandId: 'c' }));
    const confirmed = await fingerprintOf(
      makeCmd([{ featureKey: 'crm', enabled: true }], { commandId: 'c', confirmCascade: true }),
    );
    assert.notEqual(plain, confirmed);
  });

  it('rejects a missing stable command id before any write', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'crm', enabled: false }] });
    const useCase = makeUseCase(prisma);
    await assert.rejects(
      () => useCase.execute({
        ...makeCmd([{ featureKey: 'crm', enabled: true }]),
        commandId: undefined,
      } as any),
      (error: any) => (error.getResponse() as any).code === 'entitlement_command_id_required',
    );
    assert.equal(prisma.txCalled(), 0);
    assert.equal(prisma.commands().length, 0);
  });

  it('rejects a missing set-version fence before any write', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'crm', enabled: false }] });
    await assert.rejects(
      () => makeUseCase(prisma).execute({
        ...makeCmd([{ featureKey: 'crm', enabled: true }]),
        expectedSetVersion: undefined,
      } as any),
      (error: any) => (error.getResponse() as any).code === 'entitlement_set_version_required',
    );
    assert.equal(prisma.txCalled(), 0);
    assert.equal(prisma.commands().length, 0);
  });
});

describe('SetPartnerFeaturesUseCase — CC1 transitions and epochs (spec:51)', () => {
  it('appends one transition per changed key with seq = lastSeq + 1', async () => {
    // `inventory` has NO stored row: writing it as false is a first materialization, not an ON→OFF
    // transition, so P0-1 leaves it alone and the OFF action is still exercised here.
    const prisma = makePrisma({
      existing: [{ featureKey: 'crm', enabled: false, epoch: 2, lastSeq: 5 }],
    });
    const useCase = makeUseCase(prisma);
    await useCase.execute(makeCmd([
      { featureKey: 'crm', enabled: true },
      { featureKey: 'inventory', enabled: false },
    ]));

    const transitions = prisma.transitions();
    assert.equal(transitions.length, 2);
    const crm = transitions.find((t: any) => t.featureKey === 'crm');
    const inventory = transitions.find((t: any) => t.featureKey === 'inventory');
    assert.equal(crm.seq, 6);
    assert.equal(crm.action, 'ENABLE');
    assert.equal(crm.actorUserId, 'admin-1');
    assert.equal(inventory.seq, 1);
    assert.equal(inventory.action, 'OFF');
    // Every transition carries the same commandId as its command row.
    for (const transition of transitions) assert.equal(transition.commandId, 'req-1');
  });

  it('bumps epoch on OFF→ON only — never on an OFF write, never on a no-op key', async () => {
    const prisma = makePrisma({
      existing: [
        { featureKey: 'crm', enabled: false, epoch: 2, lastSeq: 5 },
        { featureKey: 'expenses', enabled: true, epoch: 9, lastSeq: 9 },
      ],
    });
    const useCase = makeUseCase(prisma);
    await useCase.execute(makeCmd([
      { featureKey: 'crm', enabled: true }, // OFF→ON: epoch bumps
      { featureKey: 'inventory', enabled: false }, // first row, written OFF: epoch stays 0 (spec:51)
      { featureKey: 'expenses', enabled: true }, // no value moves: the row itself is never written
    ]));

    const byKey = new Map<string, any>(prisma.transitions().map((t: any) => [t.featureKey, t]));
    assert.equal(byKey.get('crm').epoch, 3);
    assert.equal(byKey.get('inventory').epoch, 0);
    // The confirm of `expenses` records the operator's decision (r9), but it moved no value: the
    // epoch is CARRIED, so every live claim fenced on epoch 9 stays valid.
    assert.equal(byKey.get('expenses').epoch, 9, 'a no-op key bumps nothing');
    assert.equal(byKey.get('expenses').reasonJson.noopConfirm, true);
    assert.deepEqual(prisma.upsertedKeys(), ['crm', 'inventory']);

    const upserts = new Map<string, any>(prisma.upserts().map((u: any) => [u.where.companyId_featureKey.featureKey, u.update]));
    assert.equal(upserts.get('crm').epoch, 3);
    assert.equal(upserts.get('crm').lastSeq, 6);
    assert.equal(upserts.get('inventory').epoch, 0);
    assert.equal(upserts.get('inventory').lastSeq, 1);
  });

  it('starts a brand-new key at epoch 1 / seq 1 when it is enabled', async () => {
    // `crm` has no row of its own; the unrelated row keeps the company out of fail-open, so `crm`
    // really is OFF before the command and the enable is a real OFF→ON transition.
    const prisma = makePrisma({ existing: [{ featureKey: 'inventory', enabled: false }] });
    const useCase = makeUseCase(prisma);
    await useCase.execute(makeCmd([{ featureKey: 'crm', enabled: true }]));
    const [transition] = prisma.transitions();
    assert.equal(transition.epoch, 1);
    assert.equal(transition.seq, 1);
  });

  it('writes the command result, the audit row and every transition in the same transaction', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'crm', enabled: false }] });
    const useCase = makeUseCase(prisma);
    await useCase.execute(makeCmd([{ featureKey: 'crm', enabled: true }]));

    assert.equal(prisma.txCalled(), 1);
    assert.equal(prisma.commands().length, 1);
    assert.equal(prisma.transitions().length, 1);
    assert.equal(prisma.audits().length, 1);
    assert.equal(prisma.audits()[0].action, 'system.partner_feature.update');
    assert.equal(prisma.audits()[0].metadataJson.setVersion, 1);
    assert.deepEqual(prisma.audits()[0].metadataJson.changedKeys, [
      { featureKey: 'crm', fromEnabled: false, toEnabled: true },
    ]);
    // The stored result is exactly what a replay returns.
    assert.equal((prisma.commands()[0].resultJson as any).setVersion, 1);
  });
});

/**
 * CC7 ruling 5 (UAT r8) — `grantOrigin=LEGACY` means "this access predates explicit entitlements".
 * The moment an operator DECIDES a row that stops being true of it, and deciding includes
 * re-submitting an already-ON legacy feature at the value it already has. Those keys never reach
 * `changedFeatures` (nothing changed), so they used to keep the grandfather marker forever.
 *
 * The clear is raw SQL: a Prisma update stamps `@updatedAt`, and `expense_auto_post.updatedAt` is
 * the auto-post worker's activation cutoff, so a command that moved no value must not move it.
 */
describe('SetPartnerFeaturesUseCase — a re-submitted legacy grant becomes EXPLICIT (CC7 ruling 5)', () => {
  const legacyOn = (featureKey: string, over: Partial<ExistingRow> = {}): ExistingRow => ({
    featureKey,
    enabled: true,
    grantOrigin: LEGACY_GRANT_ORIGIN,
    epoch: 2,
    lastSeq: 5,
    ...over,
  });

  it('clears the marker with raw SQL that cannot restamp updatedAt, and records the decision', async () => {
    const prisma = makePrisma({ existing: [legacyOn('crm')] });

    const result = await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'crm', enabled: true }]));

    // A Prisma upsert is the ONLY writer that stamps `@updatedAt`, and the key is deliberately
    // absent from it. What replaces it names exactly two columns, neither of them a timestamp.
    assert.deepEqual(prisma.upsertedKeys(), [], 'a no-op key never goes through the Prisma writer');
    const [[statement, ...values], ...rest] = prisma.rawWrites();
    assert.deepEqual(rest, [], 'one statement per confirmed key');
    assert.match(statement, /UPDATE "CompanyFeatureEntitlement"/);
    assert.match(statement, /SET "grantOrigin" = NULL, "lastSeq" = \?/);
    assert.doesNotMatch(statement, /updatedAt/, 'the auto-post activation cutoff must survive byte-identical');
    assert.deepEqual(values, [6, 'co-1', 'crm'], 'lastSeq continues the row fence: 5 + 1');
    assert.equal(
      result.features.find((feature) => feature.featureKey === 'crm')!.updatedAt,
      '2026-07-31T00:00:00.000Z',
      'the reported row still carries the timestamp it had before the command',
    );

    // The durable evidence that an OPERATOR decided this key: the raw UPDATE leaves no timestamp
    // behind, so nothing else tells a cleared row apart from an unstamped provenance gap.
    assert.deepEqual(prisma.transitions(), [{
      companyId: 'co-1',
      featureKey: 'crm',
      seq: 6,
      epoch: 2,
      commandId: 'req-1',
      action: 'ENABLE',
      actorUserId: 'admin-1',
      reasonJson: { noopConfirm: true, clearedGrantOrigin: LEGACY_GRANT_ORIGIN },
    }]);
    // Without this the audit of a confirm-only command reads as "nothing happened".
    assert.deepEqual(prisma.audits()[0].metadataJson.changedKeys, []);
    assert.deepEqual(prisma.audits()[0].metadataJson.confirmedLegacyKeys, ['crm']);
  });

  /**
   * r9 finding 2 — a null `grantOrigin` used to end the story: no marker to clear, so nothing was
   * recorded. But an ON row on a LEGACY company whose provenance stamp never landed is exactly the
   * gap class the repair pass hunts, and it passes this command's own normalization gate. Recording
   * nothing there means a later pass stamps `grantOrigin=LEGACY` onto a row a human just decided —
   * grandfather evidence manufactured after the fact, which the permanence rule forbids — and the
   * decision never moves the PLAN/APPLY hash. What the cohort decides is what must be RECORDED.
   */
  describe('an unstamped row on a LEGACY company', () => {
    const unstampedOn = () => legacyOn('crm', { grantOrigin: null });

    it('records the decision exactly once — no marker to clear, but the fence still advances', async () => {
      const prisma = makePrisma({ existing: [unstampedOn()] });

      await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'crm', enabled: true }]));

      // Same statement shape as the clearing branch minus the column that is already null, and the
      // same forbidden column: `updatedAt` is the auto-post activation cutoff.
      const [[statement, ...values], ...rest] = prisma.rawWrites();
      assert.deepEqual(rest, [], 'one statement for the one confirmed key');
      assert.match(statement, /SET "lastSeq" = \?/);
      assert.doesNotMatch(statement, /grantOrigin/, 'nothing to clear — the row is already unstamped');
      assert.doesNotMatch(statement, /updatedAt/);
      assert.deepEqual(values, [6, 'co-1', 'crm']);
      assert.deepEqual(prisma.upsertedKeys(), [], 'no value moved, so no Prisma writer runs');

      assert.deepEqual(prisma.transitions(), [{
        companyId: 'co-1',
        featureKey: 'crm',
        seq: 6,
        epoch: 2,
        commandId: 'req-1',
        action: 'ENABLE',
        actorUserId: 'admin-1',
        // No `clearedGrantOrigin`: claiming a marker was removed when none existed would be the
        // same fabricated provenance in the other direction.
        reasonJson: { noopConfirm: true },
      }]);
      assert.deepEqual(prisma.audits()[0].metadataJson.confirmedLegacyKeys, ['crm']);
    });

    it('writes nothing on a SECOND confirm — the human decision is already permanent', async () => {
      const prisma = makePrisma({ existing: [unstampedOn()] });
      const useCase = makeUseCase(prisma);

      await useCase.execute(makeCmd([{ featureKey: 'crm', enabled: true }], { commandId: 'cmd-1' }));
      await useCase.execute(makeCmd(
        [{ featureKey: 'crm', enabled: true }],
        { commandId: 'cmd-2', expectedSetVersion: 1 },
      ));

      // A new commandId, so this is not the idempotency replay: the second command really ran and
      // found the key already decided. Re-recording it every time would spam the log and — because
      // the row fence advances with it — churn the entitlement rows on a command that decides
      // nothing new.
      assert.equal(prisma.txCalled(), 2);
      assert.equal(prisma.transitions().length, 1, 'the decision was recorded once, by the first command');
      assert.equal(prisma.rawWrites().length, 1);
      assert.equal(prisma.audits()[1].metadataJson.confirmedLegacyKeys, undefined);
    });

    it('does not count a SYSTEM pass as the human decision', async () => {
      // The normalizer writes `actorUserId: 'SYSTEM'` for every row it touches. If that suppressed
      // the record, a company the normalizer has visited could never have a decision recorded at
      // all — which is every company in the cohort.
      const prisma = makePrisma({
        existing: [unstampedOn()],
        priorTransitions: [{ featureKey: 'crm', actorUserId: SYSTEM_ACTOR }],
      });

      await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'crm', enabled: true }]));

      assert.equal(prisma.transitions().length, 1);
      assert.equal(prisma.rawWrites().length, 1);
    });

    it('leaves the marker-clearing branch exactly as it was', async () => {
      // Cohort LEGACY, marker present: the ORIGINAL path, and `humanDecidedKeys` must not gate it —
      // a stamped row is provenance that has to be removed whether or not a human decided before.
      const prisma = makePrisma({
        existing: [legacyOn('crm')],
        priorTransitions: [{ featureKey: 'crm', actorUserId: 'admin-1' }],
      });

      await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'crm', enabled: true }]));

      assert.match(prisma.rawWrites()[0][0], /SET "grantOrigin" = NULL, "lastSeq" = \?/);
      assert.deepEqual(prisma.transitions()[0].reasonJson, {
        noopConfirm: true,
        clearedGrantOrigin: LEGACY_GRANT_ORIGIN,
      });
    });
  });

  it('writes NOTHING for an unstamped key on an EXPLICIT company — a true no-op', async () => {
    // An EXPLICIT company was never grandfathered, so no pass can ever stamp this row: there is no
    // provenance to defend and nothing to record. Keeping it a no-op is what stops every partner
    // command from appending a transition per submitted key.
    const prisma = makePrisma({
      cohortKind: EXPLICIT_COHORT,
      existing: [legacyOn('crm', { grantOrigin: null })],
    });

    const result = await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'crm', enabled: true }]));

    assert.deepEqual(prisma.rawWrites(), []);
    assert.deepEqual(prisma.transitions(), []);
    assert.deepEqual(prisma.upsertedKeys(), []);
    assert.equal(prisma.audits()[0].metadataJson.confirmedLegacyKeys, undefined);
    assert.equal(
      result.features.find((feature) => feature.featureKey === 'crm')!.updatedAt,
      '2026-07-31T00:00:00.000Z',
      'the activation boundary is untouched in this branch too',
    );
  });

  it('leaves changed keys on the upsert path — exactly one transition per key', async () => {
    const prisma = makePrisma({
      existing: [legacyOn('crm'), { featureKey: 'inventory', enabled: false, epoch: 0, lastSeq: 1 }],
    });

    await makeUseCase(prisma).execute(makeCmd([
      { featureKey: 'crm', enabled: true }, // stored value already ON: confirmed, not changed
      { featureKey: 'inventory', enabled: true }, // a real OFF→ON transition
    ]));

    assert.deepEqual(prisma.upsertedKeys(), ['inventory']);
    assert.equal(prisma.upserts()[0].update.grantOrigin, null, 'a changed key clears the marker in its own update');
    assert.deepEqual(prisma.rawWrites().map((raw: any[]) => raw.at(-1)), ['crm'], 'only the no-op key needs raw SQL');
    // Disjoint by construction — which is what keeps `@@unique([companyId, featureKey, commandId])`
    // satisfiable when one command both changes and confirms keys.
    assert.deepEqual(
      prisma.transitions().map((t: any) => [t.featureKey, t.seq, t.action, t.reasonJson.noopConfirm === true]),
      [['inventory', 2, 'ENABLE', false], ['crm', 6, 'ENABLE', true]],
    );
  });

  it('does not clear a second time when the same commandId replays', async () => {
    const features = [{ featureKey: 'crm', enabled: true }];
    const fingerprint = await fingerprintOf(makeCmd(features, { commandId: 'cmd-1' }));
    const prisma = makePrisma({
      existing: [legacyOn('crm')],
      storedCommand: { payloadFingerprint: fingerprint, resultJson: { companyId: 'co-1' } },
    });

    await makeUseCase(prisma).execute(makeCmd(features, { commandId: 'cmd-1' }));

    assert.equal(prisma.txCalled(), 0, 'the stored result answers; the clear never runs twice');
    assert.deepEqual(prisma.rawWrites(), []);
    assert.deepEqual(prisma.transitions(), []);
  });
});

/**
 * OWNER DECISION 2026-08-04 — the disable/re-enable cycle, for a family the old preflight refused.
 * Freeze in place: OFF stops the family and leaves its data alone, ON resumes where it froze.
 */
describe('SetPartnerFeaturesUseCase — safe OFF / runoff lifecycle', () => {
  it('takes any family through the real disable lifecycle', async () => {
    const prisma = makePrisma({ existing: [{ featureKey: 'reports', enabled: true, epoch: 2, lastSeq: 5 }] });
    const result = await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'reports', enabled: false }]));
    assert.equal(result.features.find((feature) => feature.featureKey === 'reports')?.enabled, false);
    assert.equal(prisma.upsertCalled(), 1);
    assert.equal(prisma.snapshots().length, 1);
    assert.equal(prisma.snapshots()[0].disableSeq, 6);
    assert.deepEqual(prisma.transitions().map((transition: any) => transition.action), ['DISABLE_REQUESTED', 'OFF']);
  });

  it('disables `expenses` — BLOCKED rows, runoff-root rows and stored data and all — then re-enables it', async () => {
    // `expenses` is the case the old rule refused twice over: 4 BLOCKED matrix rows AND 7
    // PRE_CUTOFF_RUNOFF_ONLY rows (no snapshot builder). The company also has expense data ON THE
    // BOOKS — mocked here as an existing `expenses.categories` child plus a `lastSeq` history — and
    // none of it may hold the disable up.
    const prisma = makePrisma({
      existing: [
        { featureKey: 'expenses', enabled: true, epoch: 2, lastSeq: 7 },
        { featureKey: 'expenses.categories', enabled: true, epoch: 2, lastSeq: 7 },
      ],
    });
    const useCase = makeUseCase(prisma);

    const off = await useCase.execute(makeCmd([{ featureKey: 'expenses', enabled: false }], { commandId: 'off-1' }));
    assert.equal(off.features.find((feature) => feature.featureKey === 'expenses')?.enabled, false);
    // Frozen, not deleted: the submenu row keeps the value it had — the evaluator masks it while the
    // parent is off, and a re-enable finds it exactly as it was.
    assert.equal(off.features.find((feature) => feature.featureKey === 'expenses.categories')?.enabled, true);
    assert.deepEqual(prisma.upsertedKeys(), ['expenses']);
    assert.deepEqual(prisma.snapshots()[0].rootsJson.roots, [], 'nothing runs off; nothing is stranded');

    // ...and back ON, resuming from the frozen state. Same fake, so this reads the rows the disable
    // actually wrote.
    const on = await useCase.execute(makeCmd(
      [{ featureKey: 'expenses', enabled: true }],
      { commandId: 'on-1', expectedSetVersion: 1 },
    ));
    assert.equal(on.setVersion, 2);
    assert.equal(on.features.find((feature) => feature.featureKey === 'expenses')?.enabled, true);
    assert.equal(on.features.find((feature) => feature.featureKey === 'expenses.categories')?.enabled, true);
    const enable = prisma.transitions().find((transition: any) => transition.commandId === 'on-1');
    assert.equal(enable.action, 'ENABLE');
    assert.equal(enable.epoch, 3, 'the epoch moves once on the way back up, invalidating stale claims');
  });

  it('cascades a blocked child off with its prerequisite instead of refusing', async () => {
    // `double_entry_ledger` drags `expense_auto_post` off with it; both were refused before.
    const prisma = makePrisma({
      existing: [
        { featureKey: 'double_entry_ledger', enabled: true },
        { featureKey: 'expense_auto_post', enabled: true },
      ],
    });
    const result = await makeUseCase(prisma).execute(
      makeCmd([{ featureKey: 'double_entry_ledger', enabled: false }], { confirmCascade: true }),
    );
    assert.deepEqual(result.cascadedOffKeys, ['expense_auto_post']);
    assert.deepEqual(
      prisma.snapshots().map((snapshot: any) => snapshot.featureKey).sort(),
      ['double_entry_ledger', 'expense_auto_post'],
    );
  });

  it('disables a submenu on its own, leaving the parent on', async () => {
    const prisma = makePrisma({
      existing: [{ featureKey: 'crm', enabled: true }, { featureKey: 'crm.bookings', enabled: true }],
    });
    const result = await makeUseCase(prisma).execute(makeCmd([{ featureKey: 'crm.bookings', enabled: false }]));
    assert.equal(result.features.find((feature) => feature.featureKey === 'crm.bookings')?.enabled, false);
    assert.equal(result.features.find((feature) => feature.featureKey === 'crm')?.enabled, true);
    assert.deepEqual(prisma.snapshots().map((snapshot: any) => snapshot.featureKey), ['crm.bookings']);
  });
});
