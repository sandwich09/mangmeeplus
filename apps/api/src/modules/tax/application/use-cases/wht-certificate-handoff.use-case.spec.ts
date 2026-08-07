import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprint, isLaunchRouteOpen, WhtCertificateHandoffUseCase } from './wht-certificate-handoff.use-case';
import { normalizeWhtLinkEvidence } from '../../domain/logic/wht-link-evidence.logic';

const ctx = { companyId: 'company-1', userId: 'user-1', requestId: 'request-1' } as any;

const prefill = {
  payerSnapshot: { companyName: 'บริษัท', taxId: '9999999999999', branchCode: null, address: null },
  payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1234567890123', address: null, branchCode: null },
  formType: 'PND53' as const,
  incomeCategoryCode: null,
  incomeCategoryName: null,
  whtRate: null,
  grossAmount: '1000.0000',
  withheldAmount: '30.0000',
  paymentDate: '2026-07-15T00:00:00.000Z',
};

/**
 * In-memory stand-in for the table. It enforces the REAL constraints — both uniques and the
 * status-conditional updateMany — because these tests exist to prove concurrency behaviour, and a
 * fake that always succeeds would prove nothing.
 */
function makeStore(seed: any[] = []) {
  const rows: any[] = [...seed];
  const audits: any[] = [];
  const uniqueViolation = () => Object.assign(new Error('unique constraint'), { code: 'P2002' });
  const table = {
    findUnique: async ({ where }: any) => {
      if (where.id) return rows.find((r) => r.id === where.id) ?? null;
      if (where.companyId_linkCommandId) {
        const { companyId, linkCommandId } = where.companyId_linkCommandId;
        return rows.find((r) => r.companyId === companyId && r.linkCommandId === linkCommandId) ?? null;
      }
      const { companyId, creationCommandId } = where.companyId_creationCommandId;
      return rows.find((r) => r.companyId === companyId && r.creationCommandId === creationCommandId) ?? null;
    },
    findMany: async ({ where }: any) => rows.filter((r) => r.companyId === where.companyId
      && (!where.status || r.status === where.status)
      && (!where.sourceBranchId || r.sourceBranchId === where.sourceBranchId)),
    create: async ({ data }: any) => {
      if (rows.some((r) => r.companyId === data.companyId && r.creationCommandId === data.creationCommandId)) throw uniqueViolation();
      const row = { id: `handoff-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    // Conditional by design: only rows matching EVERY predicate field are updated, and the caller
    // learns how many that was. This is what makes the link a CAS instead of a blind overwrite.
    updateMany: async ({ where, data }: any) => {
      const matched = rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      if (data.linkCommandId && rows.some((r) => r.companyId === where.companyId && r.linkCommandId === data.linkCommandId)) {
        throw uniqueViolation();
      }
      for (const row of matched) Object.assign(row, data, { updatedAt: new Date() });
      return { count: matched.length };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  };
  const taxRepo = { prisma: { client: { whtCertificateHandoff: table } } } as any;
  const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
  const gate = {} as any;
  return { rows, audits, table, value: new WhtCertificateHandoffUseCase(taxRepo, audit, gate) };
}

const baseInput = {
  companyId: 'company-1',
  creationCommandId: 'wht-cert:company-1:procurement.supplier_payment:pay-1:supplier-1',
  sourceFeatureKey: 'procurement',
  prefill,
  availabilityVector: { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE', state: 'CLOSED' },
};

describe('WhtCertificateHandoffUseCase — durable prefilled handoff (H4)', () => {
  it('creates one handoff and replays it for the same command id', async () => {
    const store = makeStore();
    const first = await store.value.createOrReplay(baseInput);
    const second = await store.value.createOrReplay(baseInput);
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.id, first.id);
    assert.equal(store.rows.length, 1, 'a retry must not create a second obligation');
  });

  it('stores the prefill verbatim so the operator never re-keys statutory facts', async () => {
    const store = makeStore();
    await store.value.createOrReplay(baseInput);
    assert.deepEqual(store.rows[0].prefillSnapshotJson, prefill);
    assert.equal(store.rows[0].prefillSnapshotHash, fingerprint(prefill));
    assert.equal(store.rows[0].status, 'REQUIRED');
  });

  it('writes companyId as a flat scalar (Prisma-7 compound-FK trap)', async () => {
    const store = makeStore();
    await store.value.createOrReplay(baseInput);
    assert.equal(store.rows[0].companyId, 'company-1');
    assert.equal((store.rows[0] as any).company, undefined, 'must not route companyId through a nested relation create');
  });

  it('links an external certificate and records a high-risk audit', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const linked = await store.value.linkExternal(ctx, created.id, {
      commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20',
    });
    assert.equal(linked.status, 'EXTERNAL_LINKED');
    assert.equal(linked.externalCertificateNumber, 'EXT-001');
    assert.equal(linked.linkedByUserId, 'user-1');
    assert.equal(store.audits[0].action, 'tax.wht_certificate.external_link');
    assert.equal(store.audits[0].riskLevel, 'HIGH');
  });

  it('never writes certificate state when linking (CC5 owns WhtCertificate)', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    await store.value.linkExternal(ctx, created.id, {
      commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20',
    });
    assert.equal(store.rows[0].certificateId, undefined, 'linking must not mint or point at a certificate row');
  });

  it('replays the same link instead of erroring on a retried command', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const dto = { commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20' };
    await store.value.linkExternal(ctx, created.id, dto);
    const replay = await store.value.linkExternal(ctx, created.id, dto);
    assert.equal(replay.status, 'EXTERNAL_LINKED');
    assert.equal(replay.externalCertificateNumber, 'EXT-001');
  });

  it('rejects a different certificate against an already-linked handoff', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    await store.value.linkExternal(ctx, created.id, {
      commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20',
    });
    await assert.rejects(
      () => store.value.linkExternal(ctx, created.id, {
        commandId: 'cmd-2', externalCertificateNumber: 'EXT-999', externalEvidenceRef: 'file-2', issuedDate: '2026-07-21',
      }),
      (err: any) => err.getResponse().code === 'wht_handoff_already_linked',
    );
  });

  it('refuses to read or link another company\'s handoff', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay({ ...baseInput, companyId: 'company-2' });
    const otherCtx = { ...ctx, companyId: 'company-1' };
    await assert.rejects(() => store.value.get(otherCtx, created.id), /not found/i);
    await assert.rejects(
      () => store.value.linkExternal(otherCtx, created.id, {
        commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'f', issuedDate: '2026-07-20',
      }),
      /not found/i,
    );
  });

  it('lists only the caller company\'s handoffs', async () => {
    const store = makeStore();
    await store.value.createOrReplay(baseInput);
    await store.value.createOrReplay({ ...baseInput, companyId: 'company-2', creationCommandId: 'other' });
    const listed = await store.value.list(ctx);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].companyId, 'company-1');
  });

  it('fingerprints stably regardless of key order', () => {
    assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
    assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  });

  it('treats a closed route as false but never swallows an unreadable guard', async () => {
    const closed = { assertLaunchRouteOpen: async () => { throw { getResponse: () => ({ code: 'feature_temporarily_unavailable' }) }; } } as any;
    const open = { assertLaunchRouteOpen: async () => undefined } as any;
    const broken = { assertLaunchRouteOpen: async () => { throw new Error('connection terminated'); } } as any;
    assert.equal(await isLaunchRouteOpen(closed, 'cap.wht50bis', 'SYSTEM_INITIAL_ISSUE'), false);
    assert.equal(await isLaunchRouteOpen(open, 'cap.wht50bis', 'SYSTEM_INITIAL_ISSUE'), true);
    await assert.rejects(() => isLaunchRouteOpen(broken, 'cap.wht50bis', 'SYSTEM_INITIAL_ISSUE'), /connection terminated/);
  });

  // ── r11 F3: concurrent links must not overwrite each other's legal evidence ──────────────────
  it('lets exactly one of two concurrent links win, and tells the loser what happened', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const first = store.value.linkExternal(ctx, created.id, { commandId: 'cmd-A', externalCertificateNumber: 'EXT-A', externalEvidenceRef: 'file-A', issuedDate: '2026-07-20' });
    const second = store.value.linkExternal(ctx, created.id, { commandId: 'cmd-B', externalCertificateNumber: 'EXT-B', externalEvidenceRef: 'file-B', issuedDate: '2026-07-21' });
    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one link may win');
    assert.equal(rejected.length, 1, 'the loser must be told, not silently dropped');
    const err: any = (rejected[0] as PromiseRejectedResult).reason;
    assert.equal(err.getResponse().code, 'wht_handoff_already_linked');
    // The winner's evidence survives intact — this is the whole point.
    assert.equal(store.rows[0].status, 'EXTERNAL_LINKED');
    assert.ok(['EXT-A', 'EXT-B'].includes(store.rows[0].externalCertificateNumber));
    assert.equal(store.rows[0].externalCertificateNumber, (fulfilled[0] as PromiseFulfilledResult<any>).value.externalCertificateNumber);
  });

  it('persists issued date and note as real evidence, not audit-only metadata', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const linked = await store.value.linkExternal(ctx, created.id, {
      commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1',
      issuedDate: '2026-07-20', note: 'ออกโดยสำนักงานบัญชี',
    });
    assert.equal(store.rows[0].externalIssuedDate.toISOString().slice(0, 10), '2026-07-20');
    assert.equal(store.rows[0].linkNote, 'ออกโดยสำนักงานบัญชี');
    assert.equal(linked.externalIssuedDate?.slice(0, 10), '2026-07-20');
    assert.equal(linked.linkNote, 'ออกโดยสำนักงานบัญชี');
  });

  it('replays on the LINK command id, not the creation command id', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    await store.value.linkExternal(ctx, created.id, { commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20' });
    // Same link command + same payload = replay.
    const replay = await store.value.linkExternal(ctx, created.id, { commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20' });
    assert.equal(replay.externalCertificateNumber, 'EXT-001');
    // Same link command, DIFFERENT payload = the caller reused an id for other content.
    await assert.rejects(
      () => store.value.linkExternal(ctx, created.id, { commandId: 'cmd-1', externalCertificateNumber: 'EXT-999', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20' }),
      (e: any) => e.getResponse().code === 'wht_handoff_link_command_reused',
    );
  });

  // ── r11 F2: empty strings must never become the record of a legal document ───────────────────
  it('refuses blank or whitespace-only evidence at the mutation boundary', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const bad = [
      { commandId: 'c', externalCertificateNumber: '', externalEvidenceRef: 'f', issuedDate: '2026-07-20' },
      { commandId: 'c', externalCertificateNumber: '   ', externalEvidenceRef: 'f', issuedDate: '2026-07-20' },
      { commandId: 'c', externalCertificateNumber: 'EXT-1', externalEvidenceRef: '', issuedDate: '2026-07-20' },
      { commandId: '', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: '2026-07-20' },
      { commandId: 'c', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: 'not-a-date' },
    ];
    for (const dto of bad) await assert.rejects(() => store.value.linkExternal(ctx, created.id, dto as any));
    assert.equal(store.rows[0].status, 'REQUIRED', 'nothing invalid may flip the status');
  });

  // ── r11 F5: concurrent identical creates ────────────────────────────────────────────────────
  it('returns the winning row instead of a raw P2002 when two identical creates race', async () => {
    const store = makeStore();
    // Both calls observe an empty table, so both attempt the insert and one loses the unique.
    const [a, b] = await Promise.all([store.value.createOrReplay(baseInput), store.value.createOrReplay(baseInput)]);
    assert.equal(store.rows.length, 1, 'only one obligation may exist');
    assert.equal(a.id, b.id, 'the loser must still receive the winning handoff');
    assert.ok(a.replayed !== b.replayed, 'exactly one of them created it');
  });

  it('does NOT swallow a unique violation inside a caller transaction (25P02 would follow)', async () => {
    const store = makeStore();
    await store.value.createOrReplay(baseInput);
    const tx = { whtCertificateHandoff: { ...store.table, findUnique: async () => null } };
    await assert.rejects(
      () => store.value.createOrReplay({ ...baseInput, tx }),
      (e: any) => e.code === 'P2002',
    );
  });

  it('filters the list by source branch without making it an authorization boundary', async () => {
    const store = makeStore();
    await store.value.createOrReplay({ ...baseInput, sourceBranchId: 'branch-1' });
    await store.value.createOrReplay({ ...baseInput, creationCommandId: 'other', sourceBranchId: 'branch-2' });
    assert.equal((await store.value.list(ctx, { branchId: 'branch-1' })).length, 1);
    assert.equal((await store.value.list(ctx, {})).length, 2, 'no branch filter still returns the whole company');
  });

  // ── r12 #1: the link fence is company-wide, so the handoff must be part of the replay decision ──
  it('refuses a command id reused against a DIFFERENT handoff, even with identical evidence', async () => {
    const store = makeStore();
    const a = await store.value.createOrReplay(baseInput);
    const b = await store.value.createOrReplay({ ...baseInput, creationCommandId: 'second-payment' });
    const evidence = { commandId: 'cmd-shared', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20' };

    await store.value.linkExternal(ctx, a.id, evidence);
    // Byte-identical evidence, different handoff: this is NOT a replay. Treating it as one would
    // report success while leaving B unlinked and its payee without a certificate.
    await assert.rejects(
      () => store.value.linkExternal(ctx, b.id, evidence),
      (e: any) => e.getResponse().code === 'wht_handoff_link_command_reused',
    );
    const rowB = store.rows.find((r) => r.id === b.id);
    assert.equal(rowB.status, 'REQUIRED', 'B must remain visibly unfinished');
    assert.equal(rowB.externalCertificateNumber, undefined);
  });

  it('returns a stable 409 (never a raw P2002) when cross-row command reuse races the lookup', async () => {
    const store = makeStore();
    const a = await store.value.createOrReplay(baseInput);
    const b = await store.value.createOrReplay({ ...baseInput, creationCommandId: 'second-payment' });
    await store.value.linkExternal(ctx, a.id, { commandId: 'cmd-shared', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20' });

    // Simulate the window the pre-check cannot close: the lookup misses, the unique still fires.
    const realFindUnique = store.table.findUnique;
    let firstLookup = true;
    store.table.findUnique = async (args: any) => {
      if (args.where?.companyId_linkCommandId && firstLookup) { firstLookup = false; return null; }
      return realFindUnique(args);
    };
    await assert.rejects(
      () => store.value.linkExternal(ctx, b.id, { commandId: 'cmd-shared', externalCertificateNumber: 'EXT-9', externalEvidenceRef: 'f', issuedDate: '2026-07-20' }),
      (e: any) => {
        assert.equal(e.getResponse?.().code, 'wht_handoff_link_command_reused', 'must be the typed conflict');
        assert.notEqual((e as any).code, 'P2002', 'a raw driver error must never escape');
        return true;
      },
    );
    store.table.findUnique = realFindUnique;
  });

  it('still replays a genuine retry against the SAME handoff', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const evidence = { commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20' };
    const first = await store.value.linkExternal(ctx, created.id, evidence);
    const retry = await store.value.linkExternal(ctx, created.id, evidence);
    assert.equal(retry.id, first.id);
    assert.equal(retry.externalCertificateNumber, 'EXT-001');
  });

  // ── r12 #3: one strict rule set, shared by the DTO layer and the mutation boundary ────────────
  it('rejects over-long evidence instead of silently truncating it', () => {
    const base = { commandId: 'c', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: '2026-07-20' };
    const long = (n: number) => 'x'.repeat(n);
    assert.equal(normalizeWhtLinkEvidence({ ...base, note: long(1001) }).ok, false);
    assert.equal(normalizeWhtLinkEvidence({ ...base, externalCertificateNumber: long(101) }).ok, false);
    assert.equal(normalizeWhtLinkEvidence({ ...base, externalEvidenceRef: long(501) }).ok, false);
    assert.equal(normalizeWhtLinkEvidence({ ...base, commandId: long(201) }).ok, false);
    // The boundary previously kept the first 1000 chars and reported success.
    const ok = normalizeWhtLinkEvidence({ ...base, note: long(1000) });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.value.note?.length, 1000);
  });

  it('requires a calendar date and real calendar days, and never TypeErrors on a bad note', () => {
    const base = { commandId: 'c', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f' };
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: '2026-07-20' }).ok, true);
    // Date-parsable but not a calendar date — the boundary used to accept these.
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: 'July 20, 2026' }).ok, false);
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: '20/07/2026' }).ok, false);
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: '2026-02-31' }).ok, false, 'not a real calendar day');
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: 123 as any }).ok, false);
    // An issued date is a day on a paper document; a time component only creates ways to store the
    // wrong one, so every date-time form is refused outright.
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: '2026-07-20T10:30:00Z' }).ok, false);
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: '2026-07-20 10:30' }).ok, false);
    // A non-string note used to throw TypeError from `.trim()`.
    const bad = normalizeWhtLinkEvidence({ ...base, issuedDate: '2026-07-20', note: { nope: true } as any });
    assert.equal(bad.ok, false);
    assert.match(bad.ok === false ? bad.error : '', /note must be a string/);
  });

  it('rejects the same shapes at the use-case boundary, not just in the DTO', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const bad = [
      { commandId: 'c', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: 'July 20, 2026' },
      { commandId: 'c', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: '2026-07-20', note: 'x'.repeat(1001) },
      { commandId: 'c', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: '2026-07-20', note: 42 },
    ];
    for (const dto of bad) await assert.rejects(() => store.value.linkExternal(ctx, created.id, dto as any));
    assert.equal(store.rows[0].status, 'REQUIRED');
  });

  // ── r13-1: ISO-8601 hour 24 is midnight of the NEXT day ───────────────────────────────────────
  it('refuses the hour-24 form that would silently store the following day', () => {
    const base = { commandId: 'c', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f' };
    // Proof of what was at stake: Date rolls this to 1 March for a document dated 28 February.
    assert.equal(new Date('2026-02-28T24:00:00Z').toISOString(), '2026-03-01T00:00:00.000Z');
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: '2026-02-28T24:00:00Z' }).ok, false);
    assert.equal(normalizeWhtLinkEvidence({ ...base, issuedDate: '2026-02-31' }).ok, false);

    const ok = normalizeWhtLinkEvidence({ ...base, issuedDate: '2026-02-28' });
    assert.equal(ok.ok, true);
    // Built from the validated components, so the stored instant is exactly the day written.
    assert.equal(ok.ok && ok.value.issuedDate.toISOString(), '2026-02-28T00:00:00.000Z');
  });

  it('persists the exact calendar day through the link, with no drift', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    await assert.rejects(
      () => store.value.linkExternal(ctx, created.id, { commandId: 'c1', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: '2026-02-28T24:00:00Z' }),
      /calendar date/,
    );
    assert.equal(store.rows[0].status, 'REQUIRED');
    const linked = await store.value.linkExternal(ctx, created.id, { commandId: 'c2', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: '2026-02-28' });
    assert.equal(store.rows[0].externalIssuedDate.toISOString(), '2026-02-28T00:00:00.000Z');
    assert.equal(linked.externalIssuedDate, '2026-02-28T00:00:00.000Z');
  });
});
