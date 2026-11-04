import 'reflect-metadata';
import Decimal from 'decimal.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateSync } from 'class-validator';
import { LinkExternalWhtCertificateDto, WhtCertificateHandoffListQueryDto } from '../../presentation/http/tax.dtos';
import { fingerprint, isLaunchRouteOpen, WhtCertificateHandoffUseCase } from './wht-certificate-handoff.use-case';
import { normalizeWhtLinkEvidence } from '../../domain/logic/wht-link-evidence.logic';

const ctx = { companyId: 'company-1', userId: 'user-1', requestId: 'request-1', permissions: ['expense.read'], scopes: {} } as any;

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

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((clause: any) => matches(row, clause));
    if (key === 'OR') return value.some((clause: any) => matches(row, clause));
    if (key === 'NOT') return !matches(row, value);
    const actual = row[key] ?? null;
    if (value === null || typeof value !== 'object') return actual === value;
    if (value.some) return Array.isArray(actual) && actual.some((item: any) => matches(item, value.some));
    if (value.is) return actual !== null && matches(actual, value.is);
    if (value.path) {
      const text = value.path.reduce((node: any, part: string) => node?.[part], actual);
      return value.equals !== undefined ? text === value.equals : value.string_starts_with !== undefined ? String(text ?? '').startsWith(value.string_starts_with) : String(text ?? '').toLowerCase().includes(value.string_contains.toLowerCase());
    }
    if (value.in) return value.in.includes(actual);
    if (value.not !== undefined) return actual !== value.not;
    if (value.contains !== undefined) return String(actual ?? '').toLowerCase().includes(value.contains.toLowerCase());
    if (value.equals !== undefined) return actual === value.equals;
    throw new Error(`Unsupported fixture predicate: ${JSON.stringify({ key, value })}`);
  });
}

/**
 * In-memory stand-in for the table. It enforces the REAL constraints — both uniques and the
 * status-conditional updateMany — because these tests exist to prove concurrency behaviour, and a
 * fake that always succeeds would prove nothing.
 */
function makeStore(seed: any[] = [], registry: { matched?: any; failSave?: boolean } = {}) {
  const rows: any[] = [...seed];
  const audits: any[] = [];
  const saves: any[] = [];
  const history: any[] = [];
  const uniqueViolation = () => Object.assign(new Error('unique constraint'), { code: 'P2002' });
  const table = {
    findFirst: async ({ where }: any) => rows.find(row => matches(row, where)) ?? null,
    findUnique: async ({ where }: any) => {
      if (where.id) return rows.find((r) => r.id === where.id) ?? null;
      if (where.companyId_linkCommandId) {
        const { companyId, linkCommandId } = where.companyId_linkCommandId;
        return rows.find((r) => r.companyId === companyId && r.linkCommandId === linkCommandId) ?? null;
      }
      const { companyId, creationCommandId } = where.companyId_creationCommandId;
      return rows.find((r) => r.companyId === companyId && r.creationCommandId === creationCommandId) ?? null;
    },
    findMany: async ({ where, skip = 0, take, select, orderBy }: any) => {
      let found = rows.filter((row) => matches(row, where));
      if (orderBy) found.sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * (orderBy[0].createdAt === 'asc' ? 1 : -1) || a.id.localeCompare(b.id) * (orderBy[1].id === 'asc' ? 1 : -1));
      found = found.slice(skip, take === undefined ? undefined : skip + take);
      return select ? found.map((row) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))) : found;
    },
    count: async ({ where }: any) => rows.filter((row) => matches(row, where)).length,
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
  const client: any = {
    whtCertificateHistory: {
      create: async () => { throw new Error('history must use the transaction client'); },
      findMany: async ({ where }: any) => history.filter(row => matches(row, where)),
    },
    whtCertificateHandoff: table,
    company: { findUnique: async () => null },
    supplierPayment: { findFirst: async () => ({ paymentDate: new Date('2026-07-15') }) },
    taxEvent: { findMany: async () => [{ sourceType: 'procurement.supplier_payment', sourceId: 'pay-1' }] },
    expensePayment: { findMany: async () => [{ id: 'p1', amount: '970', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-07-15'), createdAt: new Date('2026-07-15') }] },
    companyTaxProfile: { findUnique: async () => null },
    $queryRaw: async (sql: TemplateStringsArray, companyId: string, ids: string[]) => {
      assert.match(sql.join('?'), /SUM\(COALESCE\(c\."withheldAmount"/);
      const certificates = await client.whtCertificate?.findMany({ where: { companyId, id: { in: rows.filter(row => ids.includes(row.id)).map(row => row.certificateId) } } }) ?? [];
      const sum = rows.filter(row => row.companyId === companyId && ids.includes(row.id)).reduce((sum, row) =>
        sum.plus(certificates.find((c: any) => c.id === row.certificateId)?.withheldAmount ?? row.prefillSnapshotJson.withheldAmount ?? 0), new Decimal(0));
      return [{ withheld: sum.toFixed(2) }];
    },
    $executeRaw: async () => 0,
    $transaction: async (work: any) => work({
      ...client, whtCertificateHistory: { ...client.whtCertificateHistory, create: async ({ data }: any) => { history.push(data); return data; } },
    }),
    expenseRecord: {
      findFirst: async () => ({ status: 'CONFIRMED', netPayableAmount: '970' }),
      findMany: async ({ where }: any) => rows.filter(row => row.sourcePaymentType === 'expense.record').map(row => ({
        id: row.sourcePaymentId, companyId: row.companyId, branchId: row.sourceBranchId ?? null,
        status: 'CONFIRMED', createdByUserId: ctx.userId, expenseNumber: 'EXP-001', expenseDate: new Date(prefill.paymentDate),
      })).filter(row => matches(row, where)),
    },
  };
  const taxRepo = { prisma: { client } } as any;
  const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
  // §2.4: `.list`/`.get` now read the route gate for `systemIssuanceOpen`. Resolving (never
  // throwing) simulates OPEN, which is fine here — these fixtures do not assert on that field.
  const gate = { assertLaunchRouteOpen: async () => undefined } as any;
  // The counterparty registry seam of §10. `matched` stands for the row `vendorMatchKey` finds;
  // `failSave` is the §8 case where the registry write blows up and the address must survive it.
  const counterparties = {
    findCounterpartyByVendorKey: async () => registry.matched ?? null,
    saveCounterpartyVendorFields: async (input: any) => {
      if (registry.failSave) throw new Error('registry unavailable');
      saves.push(input);
    },
  } as any;
  return { rows, audits, saves, history, table, client, value: new WhtCertificateHandoffUseCase(taxRepo, audit, gate, counterparties) };
}

describe('PND2 handoff filtering and unsupported issuance', () => {
  it('PND2 handoff filtering preserves unsupported-issuance refusal', async () => {
    const h = makeStore();
    h.client.whtCertificate = { findMany: async () => [] };
    for (const formType of ['PND2', 'PND3', 'PND53']) await h.value.createOrReplay({ ...baseInput, creationCommandId: formType,
      sourcePaymentType: 'expense.record', sourcePaymentId: formType, prefill: { ...prefill, formType: formType as any,
        incomeCategoryCode: 'SYNTHETIC_SEPARATE', incomeCategoryName: 'เงินได้แยก ภ.ง.ด.2', whtRate: '1' } });
    const rows = await h.value.list(ctx, { formType: 'PND2' });
    assert.deepEqual(rows.map(row => row.prefill.formType), ['PND2']);
    assert.equal(rows[0]!.systemIssuanceOpen, false);
    const page = await h.value.listPaged(ctx, { formType: 'PND2' });
    assert.deepEqual(page.rows.map(row => row.formType), ['PND2']);
    assert.equal(page.total, 1);
    await assert.rejects(h.value.list(ctx, { formType: 'invalid' }), /เลือก ภ.ง.ด.2 ภ.ง.ด.3 หรือ ภ.ง.ด.53/);
  });
});

describe('one-time REQUIRED PND2 repair', () => {
  it('dry-runs and repairs only individual separate-PND2 expense handoffs, never issued rows', async () => {
    const { repairPnd2Handoffs } = await import('../../../../scripts/repair-pnd2-handoffs');
    const statuses = ['REQUIRED', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED'];
    const rows = statuses.map((status, index) => ({ id: `h${index}`, companyId: 'company-1', status, certificateId: null,
      sourcePaymentType: 'expense.record', sourcePaymentId: `e${index}`, externalCertificateNumber: null,
      updatedAt: new Date('2026-10-01'), prefillSnapshotHash: 'old', payloadFingerprint: 'old',
      prefillSnapshotJson: { ...prefill, formType: 'PND3', incomeCategoryCode: 'SEPARATE' } }));
    rows.push(...['juristic', 'normal', 'foreign-source', 'certificate-pointer', 'already-pnd2'].map(id => ({ ...structuredClone(rows[0]!), id, sourcePaymentId: id })));
    rows.find(row => row.id === 'normal')!.prefillSnapshotJson.incomeCategoryCode = 'NORMAL';
    rows.find(row => row.id === 'certificate-pointer')!.certificateId = 'issued' as any;
    rows.find(row => row.id === 'already-pnd2')!.prefillSnapshotJson.formType = 'PND2';
    const expenses = rows.map(row => ({ id: row.sourcePaymentId, companyId: row.id === 'foreign-source' ? 'company-2' : 'company-1',
      vendorEntityKindSnapshot: row.id === 'juristic' ? 'JURISTIC' : 'INDIVIDUAL' }));
    const writes: any[] = [];
    const db: any = {
      whtIncomeCategory: { findMany: async ({ where }: any) => [{ code: 'SEPARATE', filingRoute: 'SEPARATE_PND2' }, { code: 'NORMAL', filingRoute: 'SYSTEM_FILLS' }].filter(row => matches(row, where)) },
      expenseRecord: { findFirst: async ({ where }: any) => expenses.find(row => matches(row, where)) ?? null },
      whtCertificateHandoff: {
        findMany: async ({ where }: any) => rows.filter(row => matches(row, where)).map(row => structuredClone(row)),
        updateMany: async ({ where, data }: any) => {
          writes.push({ where, data });
          const row = rows.find(row => row.id === where.id && row.companyId === where.companyId && row.status === where.status && row.certificateId === null && row.updatedAt.getTime() === where.updatedAt.getTime());
          if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 };
        },
      },
    };
    const before = structuredClone(rows);
    assert.deepEqual(await repairPnd2Handoffs(db, true), { matched: 1, updated: 0 });
    assert.deepEqual(rows, before); assert.equal(writes.length, 0);
    assert.deepEqual(await repairPnd2Handoffs(db, false), { matched: 1, updated: 1 });
    assert.equal(rows[0]!.prefillSnapshotJson.formType, 'PND2');
    assert.deepEqual(rows.slice(1), before.slice(1));
    assert.notEqual(rows[0]!.prefillSnapshotHash, 'old');
    assert.deepEqual(await repairPnd2Handoffs(db, false), { matched: 0, updated: 0 });
    Object.assign(rows[0]!, structuredClone(before[0]!));
    const update = db.whtCertificateHandoff.updateMany;
    db.whtCertificateHandoff.updateMany = async (input: any) => { rows[0]!.status = 'SYSTEM_ISSUED'; return update(input); };
    assert.deepEqual(await repairPnd2Handoffs(db, false), { matched: 1, updated: 0 });
    assert.equal(rows[0]!.prefillSnapshotJson.formType, 'PND3', 'a handoff issued after the read cannot be repaired');

  });
});

/** A registry row with an address already on it, so cases c and d have something to compare to. */
function registryRow(billingAddressJson?: Record<string, unknown>) {
  return { id: 'counterparty-1', displayName: 'ร้านค้า', type: 'VENDOR', ...(billingAddressJson ? { billingAddressJson } : {}) };
}

const OLD_ADDRESS = {
  addressText: '1 ถนนเก่า แขวงเก่า เขตเก่า กรุงเทพมหานคร 10100',
  provenance: { source: 'EXPENSE_AUTO', expenseId: 'expense-9', userId: 'user-0', at: '2026-01-01T00:00:00.000Z' },
};
const TYPED_ADDRESS = '99/9 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110';

const addressAudits = (audits: any[]) => audits.filter((entry) => entry.action === 'tax.wht_certificate.payee_address_set');

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
    const dto = { commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20', note: 'บันทึกเดิม' };
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

  // Correction & replacement plan §2.4: `systemCorrectionOpen`/`systemReplacementOpen` are computed
  // independently of `systemIssuanceOpen` and of each other, on both `.list` and `.get`.
  it('computes systemCorrectionOpen/systemReplacementOpen independently on list and get', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const gate = {
      assertLaunchRouteOpen: async (_gateKey: string, routeKey: string) => {
        if (routeKey === 'SYSTEM_REPLACEMENT_COPY') {
          throw { getResponse: () => ({ code: 'feature_temporarily_unavailable' }) };
        }
      },
    } as any;
    const taxRepo = { prisma: { client: { ...store.client, whtCertificateHandoff: store.table } } } as any;
    const value = new WhtCertificateHandoffUseCase(taxRepo, { log: async () => undefined } as any, gate, { findCounterpartyByVendorKey: async () => null } as any);
    const got = await value.get(ctx, created.id);
    assert.equal(got.systemIssuanceOpen, true);
    assert.equal(got.systemCorrectionOpen, true);
    assert.equal(got.systemReplacementOpen, false);
    const [listed] = await value.list(ctx);
    assert.equal(listed.systemCorrectionOpen, true);
    assert.equal(listed.systemReplacementOpen, false);
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
    assert.equal(store.history.length, 1, 'only the successful conditional transition appends history');
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

  // ── r11 F2: certificate and command identifiers must not be blank ───────────────────
  it('refuses blank certificate numbers and command ids at the mutation boundary', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const bad = [
      { commandId: 'c', externalCertificateNumber: '', externalEvidenceRef: 'f', issuedDate: '2026-07-20' },
      { commandId: 'c', externalCertificateNumber: '   ', externalEvidenceRef: 'f', issuedDate: '2026-07-20' },
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

  // WHT certificate system issuance plan §4.2: Expenses finds the handoff its own confirm just
  // created (same transaction) by sourcePaymentId, with no new field on ConfirmExpenseDto.
  it('filters the list by sourcePaymentId', async () => {
    const store = makeStore();
    await store.value.createOrReplay({ ...baseInput, sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' });
    await store.value.createOrReplay({ ...baseInput, creationCommandId: 'other-payment', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-2' });
    const found = await store.value.list(ctx, { sourcePaymentId: 'expense-1' });
    assert.equal(found.length, 1);
    assert.equal(found[0]!.sourcePaymentId, 'expense-1');
  });

  // ── r12 #1: the link fence is company-wide, so the handoff must be part of the replay decision ──
  it('refuses a command id reused against a DIFFERENT handoff, even with identical evidence', async () => {
    const store = makeStore();
    const a = await store.value.createOrReplay(baseInput);
    const b = await store.value.createOrReplay({ ...baseInput, creationCommandId: 'second-payment' });
    const evidence = { commandId: 'cmd-shared', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20', note: 'บันทึกเดิม' };

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
    const evidence = { commandId: 'cmd-1', externalCertificateNumber: 'EXT-001', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20', note: 'บันทึกเดิม' };
    const first = await store.value.linkExternal(ctx, created.id, evidence);
    const retry = await store.value.linkExternal(ctx, created.id, evidence);
    assert.equal(retry.id, first.id);
    assert.equal(retry.externalCertificateNumber, 'EXT-001');
  });

  // ── r12 #3: one strict rule set, shared by the DTO layer and the mutation boundary ────────────
  it('records a self-issued certificate without an optional evidence reference', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const result = await store.value.linkExternal(ctx, created.id, {
      commandId: 'optional-reference', externalCertificateNumber: 'EXT-001', externalEvidenceRef: '', issuedDate: '2026-07-20',
    });
    assert.equal(result.status, 'EXTERNAL_LINKED');
    assert.equal(result.externalEvidenceRef, '');
    const dto = Object.assign(new LinkExternalWhtCertificateDto(), {
      commandId: 'optional-reference', externalCertificateNumber: 'EXT-001', externalEvidenceRef: '', issuedDate: '2026-07-20',
    });
    assert.deepEqual(validateSync(dto), []);
    dto.externalEvidenceRef = 'x'.repeat(501);
    assert.ok(validateSync(dto).some(error => error.property === 'externalEvidenceRef'));
  });

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

  // ── §10: the payee address the frozen prefill never had ─────────────────────

  it('refuses a payee address once the certificate is linked, and says where to go instead', async () => {
    const store = makeStore([], { matched: registryRow() });
    const created = await store.value.createOrReplay(baseInput);
    await store.value.linkExternal(ctx, created.id, {
      commandId: 'cmd-1', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20',
    });

    await assert.rejects(
      () => store.value.setPayeeAddress(ctx, created.id, { payeeAddress: TYPED_ADDRESS }),
      (error: any) => {
        const body = error.getResponse();
        assert.equal(body.code, 'wht_handoff_address_not_editable');
        assert.equal(body.status, 'EXTERNAL_LINKED');
        // D5: never a silent no-op — the refusal names the way forward.
        assert.match(body.message, /หน้าคู่ค้า/);
        return true;
      },
    );
    assert.equal(store.rows[0].payeeAddress ?? null, null, 'a refused write must leave the row alone');
    assert.equal(store.saves.length, 0, 'and must not touch the registry either');
  });

  it('stores the address beside the frozen prefill, never inside it (case b fills an empty registry)', async () => {
    const store = makeStore([], { matched: registryRow() });
    const created = await store.value.createOrReplay(baseInput);
    const dto = await store.value.setPayeeAddress(ctx, created.id, { payeeAddress: `  ${TYPED_ADDRESS}  ` });

    assert.equal(dto.payeeAddress, TYPED_ADDRESS);
    assert.equal(dto.payeeAddressByUserId, 'user-1');
    // The hash exists so the operator's copy cannot drift: both it and the snapshot stay as frozen.
    assert.deepEqual(store.rows[0].prefillSnapshotJson, prefill);
    assert.equal(store.rows[0].prefillSnapshotHash, fingerprint(prefill));
    assert.equal(store.rows[0].prefillSnapshotJson.payeeSnapshot.address, null);

    assert.equal(dto.counterpartyAutoSave?.case, 'FILL');
    assert.equal(dto.counterpartyAutoSave?.counterpartyId, 'counterparty-1');
    assert.equal(store.saves.length, 1);
    assert.equal(store.saves[0].billingAddressJson.addressText, TYPED_ADDRESS);
    // A person typed it on a screen, so MANUAL — never EXPENSE_AUTO, which would claim a document.
    assert.equal(store.saves[0].billingAddressJson.provenance.source, 'MANUAL');
    const registryAudit = store.audits.find((entry: any) => entry.action === 'accounting.counterparty.update');
    assert.equal(registryAudit.metadataJson.source, 'wht_handoff_payee_address');
    // CON-10: the sanitizer does not redact addresses, so no audit entry may carry the value.
    assert.equal(JSON.stringify(store.audits).includes(TYPED_ADDRESS), false);
  });

  it('case c unlocked: the typed address becomes primary and the registry remembers the old one', async () => {
    const store = makeStore([], { matched: registryRow(OLD_ADDRESS) });
    const created = await store.value.createOrReplay(baseInput);
    const dto = await store.value.setPayeeAddress(ctx, created.id, { payeeAddress: TYPED_ADDRESS });

    assert.equal(dto.counterpartyAutoSave?.case, 'HISTORY');
    assert.equal(dto.counterpartyAutoSave?.locked, undefined);
    const written = store.saves[0].billingAddressJson;
    assert.equal(written.addressText, TYPED_ADDRESS);
    assert.equal(written.seenOnDocuments[0].addressText, OLD_ADDRESS.addressText);
    // No expense behind a handoff address — the same empty marker the promote path writes.
    assert.equal(written.seenOnDocuments[0].expenseId, '');
  });

  it('case c locked: the registry keeps its primary and only remembers what was typed (A4)', async () => {
    const store = makeStore([], { matched: registryRow({ ...OLD_ADDRESS, locked: true }) });
    const created = await store.value.createOrReplay(baseInput);
    const dto = await store.value.setPayeeAddress(ctx, created.id, { payeeAddress: TYPED_ADDRESS });

    assert.equal(dto.counterpartyAutoSave?.case, 'HISTORY');
    assert.equal(dto.counterpartyAutoSave?.locked, true);
    const written = store.saves[0].billingAddressJson;
    assert.equal(written.addressText, OLD_ADDRESS.addressText, 'a locked primary is never displaced');
    assert.equal(written.locked, true, 'and the lock survives the rewrite');
    assert.equal(written.provenance.expenseId, 'expense-9', 'the kept primary keeps its own provenance');
    assert.equal(written.seenOnDocuments[0].addressText, TYPED_ADDRESS);
    // The handoff still carries what the operator typed, whatever the registry decided.
    assert.equal(store.rows[0].payeeAddress, TYPED_ADDRESS);
  });

  it('keeps the address when the registry write fails, and reports the failure (§8)', async () => {
    const store = makeStore([], { matched: registryRow(), failSave: true });
    const created = await store.value.createOrReplay(baseInput);
    const dto = await store.value.setPayeeAddress(ctx, created.id, { payeeAddress: TYPED_ADDRESS });

    assert.equal(dto.payeeAddress, TYPED_ADDRESS);
    assert.equal(store.rows[0].payeeAddress, TYPED_ADDRESS, 'the registry must never fail the address write');
    assert.equal(dto.counterpartyAutoSave?.case, 'FAILED');
    assert.equal(dto.counterpartyAutoSave?.failed, true);
  });

  it('a retry of the same address writes nothing a second time', async () => {
    const store = makeStore([], { matched: registryRow() });
    const created = await store.value.createOrReplay(baseInput);
    const first = await store.value.setPayeeAddress(ctx, created.id, { payeeAddress: TYPED_ADDRESS });
    const stampedAt = store.rows[0].payeeAddressAt;

    const retry = await store.value.setPayeeAddress(ctx, created.id, { payeeAddress: TYPED_ADDRESS });
    assert.equal(retry.payeeAddress, first.payeeAddress);
    assert.equal(store.rows[0].payeeAddressAt, stampedAt, 'a retry must not re-stamp the row');
    assert.equal(addressAudits(store.audits).length, 1, 'nor audit the same fact twice');
    assert.equal(store.saves.length, 1, 'nor write the registry twice');
    assert.equal(retry.counterpartyAutoSave, undefined);
  });

  it('skips the registry when the payee matches no counterparty (§10 covers cases b and c only)', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    const dto = await store.value.setPayeeAddress(ctx, created.id, { payeeAddress: TYPED_ADDRESS });

    assert.equal(dto.payeeAddress, TYPED_ADDRESS);
    assert.equal(dto.counterpartyAutoSave?.case, 'SKIPPED');
    assert.equal(store.saves.length, 0);
  });

  it('persists the exact calendar day through the link, with no drift', async () => {
    const store = makeStore();
    const created = await store.value.createOrReplay(baseInput);
    await assert.rejects(
      () => store.value.linkExternal(ctx, created.id, { commandId: 'c1', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: '2026-02-28T24:00:00Z' }),
      (error: any) => error.getResponse().code === 'wht_handoff_external_record_invalid' && error.getResponse().message === 'ข้อมูลที่บันทึกไม่ครบหรือไม่ถูกต้อง ตรวจเลขที่ วันที่ เลขอ้างอิง และหมายเหตุ แล้วบันทึกอีกครั้ง',
    );
    assert.equal(store.rows[0].status, 'REQUIRED');
    const linked = await store.value.linkExternal(ctx, created.id, { commandId: 'c2', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'f', issuedDate: '2026-02-28' });
    assert.equal(store.rows[0].externalIssuedDate.toISOString(), '2026-02-28T00:00:00.000Z');
    assert.equal(linked.externalIssuedDate, '2026-02-28T00:00:00.000Z');
  });
});


describe('expense correction versus external certificate linking', () => {
  it('refuses an external certificate link after reopening the expense', async () => {
    const h = makeStore();
    const created = await h.value.createOrReplay({ ...baseInput, creationCommandId: 'expense-handoff', sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' });
    h.client.expenseRecord.findFirst = async () => ({ status: 'NEEDS_REVIEW' });
    await assert.rejects(() => h.value.linkExternal(ctx, created.id, { commandId: 'external-link-1', externalCertificateNumber: '50-1', externalEvidenceRef: 'attachment-1', issuedDate: '2026-10-04' }), (e: any) => e.getResponse?.().code === 'expense_wht_source_changed');
    assert.equal(h.rows[0].status, 'REQUIRED'); assert.equal(h.audits.filter((a: any) => a.action === 'tax.wht_certificate.external_link').length, 0);
  });
});


describe('certificate history and handoff paper details', () => {
  it('appends EXTERNAL_RECORDED once and does not append on replay or a losing link', async () => {
    for (const sourcePaymentType of ['expense.record', 'procurement.supplier_payment']) {
      const h = makeStore();
      const created = await h.value.createOrReplay({ ...baseInput, sourcePaymentType, sourcePaymentId: 'source-1' });
      const dto = { commandId: 'link-1', externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'file-1', issuedDate: '2026-07-20', note: 'บันทึกเดิม' };
      await h.value.linkExternal(ctx, created.id, dto);
      await h.value.linkExternal(ctx, created.id, dto);
      await assert.rejects(() => h.value.linkExternal(ctx, created.id, { ...dto, commandId: 'link-2' }));
      assert.deepEqual(h.history, [{
        companyId: ctx.companyId, expenseId: sourcePaymentType === 'expense.record' ? 'source-1' : null,
        handoffId: created.id, eventType: 'EXTERNAL_RECORDED', isExternal: true,
        certificateNumber: 'EXT-1', certificateDate: new Date('2026-07-20'), actorUserId: ctx.userId,
        detailsJson: { externalEvidenceRef: 'file-1', linkNote: 'บันทึกเดิม', paymentDate: '2026-07-15' },
      }]);
    }
  });

  it('loads certificate numbers and issue dates for list and get with one tenant-scoped batch', async () => {
    const h = makeStore();
    const a = await h.value.createOrReplay(baseInput);
    const b = await h.value.createOrReplay({ ...baseInput, creationCommandId: 'second' });
    const empty = await h.value.createOrReplay({ ...baseInput, creationCommandId: 'empty' });
    h.rows[0].certificateId = 'cert-1'; h.rows[1].certificateId = 'cert-2';
    let queries = 0;
    const papers = [
      { id: 'cert-1', certificateNumber: 'WT-1', issuedAt: new Date('2026-07-20'), taxPeriod: { formType: 'PND3' }, incomeCategoryCode: 'SERVICE', incomeCategoryName: 'ค่าบริการ', whtRate: '3.0000', grossAmount: '1401.8700', withheldAmount: '42.0600', paymentDate: new Date('2026-07-19'), payeeSnapshotJson: { name: 'ชื่อที่แก้แล้ว', taxId: '1111111111111', address: 'ที่อยู่ที่แก้แล้ว', branchCode: '00000' } },
      { id: 'cert-2', certificateNumber: 'WT-2', issuedAt: new Date('2026-07-21'), taxPeriod: { formType: 'PND53' }, incomeCategoryCode: 'RENT', incomeCategoryName: 'ค่าเช่า', whtRate: '5', grossAmount: '1000', withheldAmount: '50', paymentDate: new Date('2026-07-20'), payeeSnapshotJson: { name: 'ผู้รับเงิน', taxId: null, address: null, branchCode: null } },
    ];
    h.client.whtCertificate = { findMany: async ({ where }: any) => {
      queries++;
      assert.equal(where.companyId, ctx.companyId);
      return papers.filter((p) => where.id.in.includes(p.id));
    } };
    const list = await h.value.list(ctx);
    assert.equal(queries, 1, 'no query per handoff');
    const current = { number: 'WT-1', issuedAt: '2026-07-20T00:00:00.000Z', formType: 'PND3', incomeCategoryCode: 'SERVICE', incomeCategoryName: 'ค่าบริการ', whtRate: '3.0000', grossAmount: '1401.8700', withheldAmount: '42.0600', paymentDate: '2026-07-19T00:00:00.000Z', payee: papers[0].payeeSnapshotJson };
    assert.deepEqual(list.find(row => row.id === a.id)?.currentCertificate, current);
    assert.equal(list.find(row => row.id === empty.id)?.currentCertificate, null);
    assert.deepEqual((await h.value.get(ctx, a.id)).currentCertificate, current);

    assert.equal(list.find((row) => row.id === a.id)?.certificateNumber, 'WT-1');
    assert.equal(list.find((row) => row.id === b.id)?.certificateIssuedAt, '2026-07-21T00:00:00.000Z');
    assert.equal(list.find((row) => row.id === empty.id)?.certificateNumber, null);
    assert.equal((await h.value.get(ctx, a.id)).certificateNumber, 'WT-1');
    assert.equal((await h.value.get(ctx, empty.id)).certificateIssuedAt, null);
  });

  it('returns only expense history for the company and scoped handoffs, newest first, with actor names', async () => {
    const h = makeStore();
    const handoffQueries: any[] = [];
    const historyQueries: any[] = [];
    h.table.findMany = async ({ where }: any) => {
      handoffQueries.push(where);
      return [{ id: 'allowed', sourceBranchId: 'branch-1' }, { id: 'blocked', sourceBranchId: 'branch-2' }];
    };
    h.client.whtCertificateHistory.findMany = async (query: any) => {
      historyQueries.push(query);
      return [{ eventType: 'CORRECTED', certificateNumber: 'WT-1', isExternal: false,
        certificateDate: new Date('2026-07-20'), reason: 'แก้ที่อยู่', relatedCertificateNumber: 'WT-2',
        actorUserId: 'user-1', occurredAt: new Date('2026-07-21'), taxFilingAttested: false }];
    };
    h.client.user = { findMany: async ({ where, select }: any) => {
      assert.deepEqual(where, { id: { in: ['user-1'] } });
      assert.deepEqual(select, { id: true, displayName: true });
      return [{ id: 'user-1', displayName: 'สมใจ' }];
    } };
    const result = await h.value.getExpenseHistory({ ...ctx, scopes: { branchIds: ['branch-1'] } }, 'exp-1');
    assert.deepEqual(handoffQueries, [{ companyId: ctx.companyId, sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' }]);
    assert.deepEqual(historyQueries[0].where, { companyId: ctx.companyId, expenseId: 'exp-1', handoffId: { in: ['allowed'] } });
    assert.deepEqual(historyQueries[0].orderBy, { occurredAt: 'desc' });
    assert.deepEqual(result, [{ eventType: 'CORRECTED', certificateNumber: 'WT-1', isExternal: false,
      certificateDate: '2026-07-20T00:00:00.000Z', reason: 'แก้ที่อยู่', relatedCertificateNumber: 'WT-2',
      actorDisplayName: 'สมใจ', occurredAt: '2026-07-21T00:00:00.000Z', taxFilingAttested: false, evidenceRef: null, note: null }]);
  });

  it('reads the removed external record evidence and note from history', async () => {
    const h = makeStore();
    h.table.findMany = async () => [{ id: 'handoff-1', sourceBranchId: null }];
    h.client.whtCertificateHistory.findMany = async () => [{
      eventType: 'EXTERNAL_RECORD_REMOVED', isExternal: true, certificateNumber: 'EXT-1', certificateDate: null,
      reason: 'ข้อมูลผิด', relatedCertificateNumber: null, actorUserId: 'user-1', occurredAt: new Date('2026-07-21'), taxFilingAttested: true,
      detailsJson: { externalEvidenceRef: 'file-1', linkNote: 'ข้อความบนบันทึกเดิม', linkedAt: '2026-07-20T00:00:00.000Z', linkedByUserId: 'issuer-1' },
    }];
    h.client.user = { findMany: async () => [] };
    const [row] = await h.value.getExpenseHistory(ctx, 'exp-1');
    assert.equal(row.evidenceRef, 'file-1');
    assert.equal(row.note, 'ข้อความบนบันทึกเดิม');
  });

  it('does not read history of another company or an out-of-scope branch', async () => {
    for (const foreign of [true, false]) {
      const h = makeStore();
      await h.value.createOrReplay({ ...baseInput, companyId: foreign ? 'company-2' : ctx.companyId,
        sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1', sourceBranchId: 'branch-2' });
      h.client.whtCertificateHistory.findMany = async () => { throw new Error('must not read forbidden history'); };
      assert.deepEqual(await h.value.getExpenseHistory({ ...ctx, scopes: { branchIds: ['branch-1'] } }, 'exp-1'), []);
    }
  });
});


describe('C1 handoff by-id boundary', () => {
  for (const entry of ['get', 'setPayeeAddress', 'linkExternal'] as const) {
    it(`${entry} hides branch and unreadable expense ids exactly like a missing handoff`, async () => {
      const h = makeStore();
      const created = await h.value.createOrReplay({ ...baseInput, sourceBranchId: 'branch-2', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' });
      h.client.expenseRecord.findFirst = async ({ where }: any) => JSON.stringify(where).includes('createdByUserId') || JSON.stringify(where).includes('\"in\":[]') ? null : { id: 'expense-1', status: 'CONFIRMED', netPayableAmount: '970' };
      const call = (actor: any, id: string) => entry === 'get' ? h.value.get(actor, id)
        : entry === 'setPayeeAddress' ? h.value.setPayeeAddress(actor, id, { payeeAddress: TYPED_ADDRESS })
        : h.value.linkExternal(actor, id, { commandId: 'C1-link', externalCertificateNumber: 'EXT-C1', externalEvidenceRef: 'paper', issuedDate: '2026-07-20' });
      let missing: any;
      await assert.rejects(call(ctx, 'missing'), (error: any) => { missing = error.getResponse(); return error.getStatus() === 404; });
      for (const actor of [{ ...ctx, scopes: { branchIds: ['branch-1'] } }, { ...ctx, permissions: ['expense.read_own'] }, { ...ctx, permissions: [] }]) {
        await assert.rejects(call(actor, created.id), (error: any) => { assert.equal(error.getStatus?.(), 404); assert.deepEqual(error.getResponse(), missing); return true; });
      }
      assert.equal(h.audits.length, 0);
      assert.ok(await call(ctx, created.id));
    });
  }
});


describe('C1 list and paged read', () => {
  async function fixture() {
    const h = makeStore();
    const expenses: any[] = [];
    for (let i = 0; i < 205; i++) {
      await h.value.createOrReplay({ ...baseInput, creationCommandId: `row-${i}`, sourcePaymentType: 'expense.record', sourcePaymentId: `exp-${i}`, sourceBranchId: 'branch-1',
        prefill: { ...prefill, incomeCategoryCode: 'SERVICE', incomeCategoryName: 'ค่าบริการ', whtRate: '3' } });
      h.rows[i].createdAt = new Date(2026, 0, 1, 0, i);
      expenses.push({ id: `exp-${i}`, companyId: ctx.companyId, branchId: 'branch-1', createdByUserId: ctx.userId,
        status: 'CONFIRMED', expenseNumber: `EXP-${i}`, expenseDate: new Date(prefill.paymentDate) });
    }
    for (const [id, status, branch, creator, expenseStatus] of [
      ['other-branch', 'REQUIRED', 'branch-2', ctx.userId, 'CONFIRMED'],
      ['other-owner', 'REQUIRED', 'branch-1', 'user-2', 'CONFIRMED'],
      ['old-void', 'REQUIRED', 'branch-1', ctx.userId, 'VOIDED'],
      ['draft', 'REQUIRED', 'branch-1', ctx.userId, 'NEEDS_REVIEW'],
      ['cancelled', 'CANCELLED', 'branch-1', ctx.userId, 'VOIDED'],
      ['system', 'SYSTEM_ISSUED', 'branch-1', ctx.userId, 'CONFIRMED'],
      ['external', 'EXTERNAL_LINKED', 'branch-1', ctx.userId, 'CONFIRMED'],
    ]) {
      await h.value.createOrReplay({ ...baseInput, creationCommandId: id, sourcePaymentType: 'expense.record', sourcePaymentId: id, sourceBranchId: branch });
      Object.assign(h.rows.at(-1), { status, externalCertificateNumber: status === 'EXTERNAL_LINKED' ? 'EXT-C1' : null,
        externalIssuedDate: status === 'EXTERNAL_LINKED' ? new Date('2026-07-20') : null });
      expenses.push({ id, companyId: ctx.companyId, branchId: branch, createdByUserId: creator, status: expenseStatus, expenseNumber: `EXP-${id}`, expenseDate: new Date(prefill.paymentDate) });
    }
    h.client.expenseRecord.findMany = async ({ where }: any) => expenses.filter(row => matches(row, where));
    h.client.whtCertificate = { findMany: async () => [] };
    return h;
  }
  const actor = { ...ctx, permissions: ['expense.read_own'], scopes: { branchIds: ['branch-1'] } };

  it('orders the full filtered set newest or oldest before paging, with stable id ties and unchanged totals', async () => {
    const h = await fixture();
    h.rows[1].createdAt = h.rows[0].createdAt;
    const read = (order?: 'newest' | 'oldest', page = 1) => h.value.listPaged(actor, { status: 'REQUIRED', pageSize: 10, page, order });
    const newest = await read();
    assert.equal(newest.rows[0].expenseId, 'exp-204');
    assert.deepEqual((await read('newest')).rows.map(row => row.id), newest.rows.map(row => row.id));
    const oldest = await read('oldest');
    const second = await read('oldest', 2);
    assert.deepEqual(oldest.rows.slice(0, 2).map(row => row.expenseId), ['exp-0', 'exp-1']);
    assert.equal(second.rows[0].expenseId, 'exp-10');
    assert.equal(new Set([...oldest.rows, ...second.rows].map(row => row.id)).size, 20);
    assert.deepEqual(oldest.counts, newest.counts); assert.deepEqual(oldest.sums, newest.sums);
    assert.equal(oldest.total, 205);
    assert.deepEqual((await read('newest', 21)).rows.slice(-2).map(row => row.expenseId), ['exp-1', 'exp-0']);
  });

  it('withheld sums cover all pages and share tab, month, form, search and branch scope with the rows', async () => {
    const h = await fixture();
    const read = (filters: any = {}) => h.value.listPaged(actor, { status: 'REQUIRED', pageSize: 1, ...filters });
    assert.deepEqual((await read()).sums, { withheld: '6150.00' });
    assert.deepEqual((await read({ page: 2 })).sums, { withheld: '6150.00' });
    for (const status of ['SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED']) assert.deepEqual((await read({ status })).sums, { withheld: '30.00' });
    assert.deepEqual((await read({ branchId: 'branch-2' })).sums, { withheld: '0.00' });
    assert.deepEqual((await read({ search: 'EXP-204' })).sums, { withheld: '30.00' });
    assert.deepEqual((await read({ search: 'no match' })).sums, { withheld: '0.00' });
    h.rows[0].prefillSnapshotJson = { ...prefill, formType: 'PND3', paymentDate: '2026-08-01', withheldAmount: '4.25' };
    assert.deepEqual((await read({ periodKey: '2026-08', formType: 'PND3' })).sums, { withheld: '4.25' });
    assert.deepEqual((await read({ periodKey: '2026-07', formType: 'PND53' })).sums, { withheld: '6120.00' });
    assert.deepEqual((await read({ periodKey: '2026-08', formType: 'PND53' })).sums, { withheld: '0.00' });
  });

  it('month choices include only readable list data, newest first, independent of month, form, status and page', async () => {
    const h = await fixture();
    for (const row of h.rows) {
      const month = ['other-branch', 'other-owner', 'old-void', 'draft'].includes(row.sourcePaymentId) ? '2026-12'
        : row.sourcePaymentId === 'system' ? '2026-09' : '2026-07';
      row.prefillSnapshotJson = { ...row.prefillSnapshotJson, paymentDate: `${month}-15`, formType: row.sourcePaymentId === 'system' ? 'PND3' : 'PND53' };
    }
    const result = await h.value.listPaged(actor, { periodKey: '2026-07', formType: 'PND53', status: 'REQUIRED', pageSize: 1 });
    assert.deepEqual(result.months, ['2026-09', '2026-07']);
    assert.equal(result.rows.length, 1);
    assert.deepEqual((await h.value.listPaged(actor, { branchId: 'branch-2' })).months, []);
  });

  it('applies branch and expense scope to both legacy arrays and pages, including an outside branch filter', async () => {
    const h = await fixture();
    const list = await h.value.list(actor);
    assert.ok(Array.isArray(list));
    assert.ok(list.every(row => row.sourceBranchId === 'branch-1' && row.sourcePaymentId !== 'other-owner'));
    assert.deepEqual(await h.value.list(actor, { branchId: 'branch-2' }), []);
    const page = await h.value.listPaged(actor, { branchId: 'branch-2' });
    assert.deepEqual(page.rows, []); assert.equal(page.total, 0);
    assert.deepEqual(page.counts, { REQUIRED: 0, SYSTEM_ISSUED: 0, EXTERNAL_LINKED: 0, CANCELLED: 0 });
    assert.equal((await h.value.list(actor, { sourcePaymentId: 'exp-1' })).length, 1, 'expense array caller');
  });

  it('pages beyond 200 newest first and keeps tab counts equal to all matching rows while hiding stale REQUIRED sources', async () => {
    const h = await fixture();
    const all: any[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await h.value.listPaged(actor, { status: 'REQUIRED', page, pageSize: 100 });
      assert.equal(result.total, 205); assert.equal(result.counts.REQUIRED, 205);
      assert.equal(result.page, page); assert.equal(result.pageSize, 100);
      all.push(...result.rows);
    }
    assert.equal(all.length, 205); assert.equal(new Set(all.map(row => row.id)).size, 205);
    assert.equal(all[0].expenseId, 'exp-204'); assert.equal(all.at(-1).expenseId, 'exp-0');
    for (const status of ['SYSTEM_ISSUED', 'EXTERNAL_LINKED', 'CANCELLED'] as const) {
      const result = await h.value.listPaged(actor, { status });
      assert.equal(result.total, 1); assert.equal(result.counts[status], result.rows.length);
      assert.equal(result.page, 1); assert.equal(result.pageSize, 20);
      if (status === 'CANCELLED') assert.equal(result.rows[0].expenseId, 'cancelled');
      if (status === 'EXTERNAL_LINKED') {
        assert.equal(result.rows[0].certificateNumber, 'EXT-C1'); assert.equal(result.rows[0].certificateIssuedAt, '2026-07-20T00:00:00.000Z');
      }
    }
    const defaultPage = await h.value.listPaged(actor, { pageSize: 999 });
    assert.equal(defaultPage.pageSize, 100); assert.equal(defaultPage.total, 208);
    assert.equal(Object.values(defaultPage.counts).reduce((a: number, b: any) => a + b, 0), defaultPage.total);
  });

  it('returns display fields and the same missing reasons as issuance, and searches payee, tax id, certificate and expense number', async () => {
    const h = await fixture();
    Object.assign(h.rows[0].prefillSnapshotJson, { formType: null, incomeCategoryCode: null, incomeCategoryName: null, whtRate: null });
    const result = await h.value.listPaged(actor, { search: 'EXP-0' });
    assert.equal(result.total, 1); assert.equal(result.counts.REQUIRED, 1);
    const row = result.rows[0];
    assert.equal(row.payeeName, prefill.payeeSnapshot.name); assert.equal(row.payeeTaxId, prefill.payeeSnapshot.taxId);
    assert.equal(row.expenseId, 'exp-0'); assert.equal(row.expenseNumber, 'EXP-0');
    assert.equal(row.documentDate, prefill.paymentDate); assert.equal(row.withheldAmount, prefill.withheldAmount);
    assert.deepEqual(row.missing, ['FORM_TYPE_UNRESOLVED', 'INCOME_CATEGORY_OR_RATE_MISSING']);
    assert.equal(row.systemIssuanceOpen, true); assert.equal(row.systemCorrectionOpen, true); assert.equal(row.systemReplacementOpen, true);
    const complete = await h.value.listPaged(actor, { search: 'EXP-204' });
    assert.deepEqual(complete.rows[0].missing, []);
    for (const search of ['ผู้รับเงิน', '1234567890123']) assert.equal((await h.value.listPaged(actor, { search })).total, 208);
    const external = await h.value.listPaged(actor, { search: 'EXT-C1' });
    assert.equal(external.total, 1); assert.equal(external.counts.EXTERNAL_LINKED, 1);
  });
});


describe('C1 expense list rule reuse and edge cases', () => {
  it('uses related before own, creator-only for own, and both handoff and source expense branch boundaries', async () => {
    const h = makeStore();
    const expenses = [
      { id: 'own', companyId: ctx.companyId, branchId: 'branch-1', createdByUserId: ctx.userId, status: 'CONFIRMED' },
      { id: 'reviewed', companyId: ctx.companyId, branchId: 'branch-1', createdByUserId: 'other', reviewedByUserId: ctx.userId, status: 'CONFIRMED' },
      { id: 'unrelated', companyId: ctx.companyId, branchId: 'branch-1', createdByUserId: 'other', status: 'CONFIRMED' },
      { id: 'payer', companyId: ctx.companyId, branchId: 'branch-1', createdByUserId: 'other', substituteReceiptEvidences: [{ payerUserId: ctx.userId }], status: 'CONFIRMED' },
      { id: 'outside-source', companyId: ctx.companyId, branchId: 'branch-2', createdByUserId: ctx.userId, status: 'CONFIRMED' },
    ];
    for (const expense of expenses) await h.value.createOrReplay({ ...baseInput, creationCommandId: expense.id,
      sourceBranchId: 'branch-1', sourcePaymentType: 'expense.record', sourcePaymentId: expense.id });
    h.client.expenseRecord.findFirst = async ({ where }: any) => expenses.find(row => matches(row, where)) ?? null;
    h.client.expenseRecord.findMany = async ({ where }: any) => expenses.filter(row => matches(row, where))
      .map(row => ({ ...row, expenseNumber: `EXP-${row.id}`, expenseDate: new Date(prefill.paymentDate) }));
    const branchCtx = { ...ctx, scopes: { branchIds: ['branch-1'] } };
    const own = { ...branchCtx, permissions: ['expense.read_own'] };
    const related = { ...branchCtx, permissions: ['expense.read_related', 'expense.read_own'] };
    assert.deepEqual((await h.value.list(own)).map(row => row.sourcePaymentId), ['own']);
    assert.deepEqual(new Set((await h.value.list(related)).map(row => row.sourcePaymentId)), new Set(['own', 'reviewed', 'payer']));
    assert.equal((await h.value.listPaged(related)).counts.REQUIRED, 3);
    assert.equal((await h.value.listPaged({ ...branchCtx, permissions: ['expense.review'] })).total, 4);
    for (const source of ['unrelated', 'outside-source']) {
      await assert.rejects(h.value.get(related, h.rows.find(row => row.sourcePaymentId === source).id), (error: any) => error.getStatus() === 404 && error.message === 'WHT handoff not found.');
    }
    assert.equal((await h.value.get(related, h.rows.find(row => row.sourcePaymentId === 'reviewed').id)).sourcePaymentId, 'reviewed');
    await assert.rejects(h.value.get(own, h.rows.find(row => row.sourcePaymentId === 'payer').id), /WHT handoff not found/);
    assert.equal((await h.value.listPaged({ ...branchCtx, permissions: [] })).total, 0);
  });

  it('keeps AP and company-central rows readable without expense permissions and refuses missing expense sources', async () => {
    const h = makeStore();
    const central = await h.value.createOrReplay(baseInput);
    const ap = await h.value.createOrReplay({ ...baseInput, creationCommandId: 'ap', sourcePaymentType: 'procurement.supplier_payment', sourceBranchId: 'branch-1' });
    const missing = await h.value.createOrReplay({ ...baseInput, creationCommandId: 'missing-source', sourcePaymentType: 'expense.record', sourcePaymentId: 'deleted' });
    const broken = await h.value.createOrReplay({ ...baseInput, creationCommandId: 'null-source', sourcePaymentType: 'expense.record', sourcePaymentId: null });
    h.client.expenseRecord.findFirst = async () => null;
    h.client.expenseRecord.findMany = async () => [];
    const actor = { ...ctx, scopes: { branchIds: ['branch-1'] }, permissions: [] };
    assert.equal((await h.value.get(actor, central.id)).id, central.id);
    assert.equal((await h.value.get(actor, ap.id)).id, ap.id);
    for (const id of [missing.id, broken.id]) await assert.rejects(h.value.get(actor, id), /WHT handoff not found/);
    assert.equal((await h.value.list(actor)).length, 2);
    assert.equal((await h.value.listPaged(actor)).total, 2);
    assert.equal((await h.value.listPaged(actor, { page: -1, pageSize: 0 })).pageSize, 1);
    await assert.rejects(h.value.listPaged(actor, { status: 'INVALID' }), (error: any) => error.getStatus() === 400);
  });

  it('reports each missing reason separately with its contract Thai wording and uses the issue command checks', async () => {
    const { WHT_HANDOFF_MISSING_LABELS } = await import('@watchdog-bms/contracts');
    assert.deepEqual(WHT_HANDOFF_MISSING_LABELS, {
      FORM_TYPE_UNRESOLVED: 'ยังไม่ทราบว่าผู้รับเงินเป็นบุคคลหรือนิติบุคคล',
      INCOME_CATEGORY_OR_RATE_MISSING: 'ยังไม่มีประเภทเงินได้หรืออัตราภาษี',
    });
    for (const [patch, expected] of [
      [{ formType: null }, ['FORM_TYPE_UNRESOLVED']],
      [{ incomeCategoryCode: null }, ['INCOME_CATEGORY_OR_RATE_MISSING']],
      [{ incomeCategoryName: '' }, ['INCOME_CATEGORY_OR_RATE_MISSING']],
      [{ whtRate: null }, ['INCOME_CATEGORY_OR_RATE_MISSING']],
      [{ whtRate: '0' }, []],
    ] as const) {
      const h = makeStore();
      await h.value.createOrReplay({ ...baseInput, prefill: { ...prefill, incomeCategoryCode: 'CAT', incomeCategoryName: 'ค่าบริการ', whtRate: '3', ...patch } });
      assert.deepEqual((await h.value.listPaged(ctx)).rows[0].missing, expected);
    }
  });

  it('searches current SYSTEM certificate number and corrected payee and keeps counts within branch and expense scope', async () => {
    const h = makeStore();
    await h.value.createOrReplay({ ...baseInput, sourceBranchId: 'branch-1' });
    Object.assign(h.rows[0], { status: 'SYSTEM_ISSUED', certificateId: 'cert-1' });
    const certificate = { id: 'cert-1', companyId: ctx.companyId, certificateNumber: 'WT-CURRENT', issuedAt: new Date('2026-07-20'),
      taxPeriod: { formType: 'PND53' }, incomeCategoryCode: 'CAT', incomeCategoryName: 'ค่าบริการ', whtRate: '3', grossAmount: '1000', withheldAmount: '7.25',
      paymentDate: new Date(prefill.paymentDate), payeeSnapshotJson: { name: 'Corrected Payee', taxId: '9876543210123', address: null, branchCode: null } };
    h.client.whtCertificate = { findMany: async ({ where }: any) => matches(certificate, where) ? [certificate] : [] };
    for (const search of ['wt-current', 'corrected payee', '9876543210123']) {
      const result = await h.value.listPaged(ctx, { search });
      assert.equal(result.total, 1); assert.equal(result.counts.SYSTEM_ISSUED, 1);
      assert.deepEqual(result.sums, { withheld: '7.25' });
      assert.equal(result.rows[0].certificateNumber, 'WT-CURRENT'); assert.equal(result.rows[0].payeeName, 'Corrected Payee');
    }
    const outside = await h.value.listPaged({ ...ctx, scopes: { branchIds: ['branch-2'] } }, { search: 'WT-CURRENT' });
    assert.equal(outside.total, 0);
    assert.equal((await h.value.listPaged(ctx, { search: 'no-match' })).total, 0);
  });

  it('reads counts and rows in one repeatable-read transaction', async () => {
    const h = makeStore();
    await h.value.createOrReplay(baseInput);
    let transactions = 0;
    h.client.$transaction = async (work: any, options: any) => {
      transactions++;
      assert.deepEqual(options, { isolationLevel: 'RepeatableRead' });
      return work(h.client);
    };
    assert.equal((await h.value.listPaged(ctx)).counts.REQUIRED, 1);
    assert.equal(transactions, 1);
  });
});


describe('C1 history and cancelled list source boundary', () => {
  it('does not expose expense certificate history to an own-only reader of somebody else’s expense', async () => {
    const h = makeStore();
    await h.value.createOrReplay({ ...baseInput, sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' });
    h.client.expenseRecord.findFirst = async ({ where }: any) => matches({ id: 'expense-1', companyId: ctx.companyId, createdByUserId: 'other' }, where) ? { id: 'expense-1' } : null;
    h.client.whtCertificateHistory.findMany = async () => { throw new Error('must not expose unreadable expense history'); };
    assert.deepEqual(await h.value.getExpenseHistory({ ...ctx, permissions: ['expense.read_own'] }, 'expense-1'), []);
  });

  it('carries and searches the last cancelled certificate number and issue date after delivery A clears the pointers', async () => {
    const h = makeStore();
    const created = await h.value.createOrReplay({ ...baseInput, sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' });
    Object.assign(h.rows[0], { status: 'CANCELLED', certificateId: null, externalCertificateNumber: null, externalIssuedDate: null });
    const events = [
      { companyId: ctx.companyId, handoffId: created.id, eventType: 'CANCELLED_SOURCE_VOIDED', reason: 'บันทึกผิดรายการ', certificateNumber: 'WT-LAST', certificateDate: new Date('2026-07-20'), occurredAt: new Date('2026-07-21') },
      { companyId: ctx.companyId, handoffId: created.id, eventType: 'CANCELLED_SOURCE_REOPENED', certificateNumber: 'WT-OLD', certificateDate: new Date('2026-07-10'), occurredAt: new Date('2026-07-11') },
    ];
    h.client.whtCertificateHistory.findMany = async ({ where }: any) => events.filter(row => matches(row, where));
    h.client.whtCertificate = { findMany: async () => [] };
    const all = await h.value.listPaged(ctx, { status: 'CANCELLED' });
    assert.equal(all.rows[0].certificateNumber, 'WT-LAST');
    assert.equal(all.rows[0].certificateIssuedAt, '2026-07-20T00:00:00.000Z');
    assert.deepEqual(all.rows[0].cancellation, { cancelledAt: '2026-07-21T00:00:00.000Z', eventType: 'CANCELLED_SOURCE_VOIDED', reason: 'บันทึกผิดรายการ' });
    const found = await h.value.listPaged(ctx, { search: 'wt-last' });
    assert.equal(found.total, 1); assert.equal(found.counts.CANCELLED, 1);
  });
});

describe('A9 external record history', () => {
  it('returns evidence and note on a standing legacy external record', async () => {
    const h = makeStore();
    h.table.findMany = async () => [{ id: 'handoff-1', sourceBranchId: null, status: 'EXTERNAL_LINKED',
      externalCertificateNumber: 'EXT-1', externalEvidenceRef: 'file-1', linkNote: 'บันทึกเดิม', certificateRound: 0 }];
    h.client.whtCertificateHistory.findMany = async () => [{ handoffId: 'handoff-1', eventType: 'EXTERNAL_RECORDED', isExternal: true,
      certificateNumber: 'EXT-1', certificateDate: null, reason: null, relatedCertificateNumber: null,
      actorUserId: 'user-1', occurredAt: new Date('2026-07-21'), taxFilingAttested: false, detailsJson: null }];
    h.client.user = { findMany: async () => [] };
    const [row] = await h.value.getExpenseHistory(ctx, 'exp-1');
    assert.equal(row.evidenceRef, 'file-1'); assert.equal(row.note, 'บันทึกเดิม');
  });
  it('returns the original record details from its removal after the handoff was reused', async () => {
    const h = makeStore();
    h.table.findMany = async () => [{ id: 'handoff-1', sourceBranchId: null, status: 'EXTERNAL_LINKED',
      externalCertificateNumber: 'EXT-2', externalEvidenceRef: 'new-file', linkNote: 'บันทึกใหม่' }];
    const base = { handoffId: 'handoff-1', isExternal: true, certificateNumber: 'EXT-1', certificateDate: null, reason: null,
      relatedCertificateNumber: null, actorUserId: 'user-1', taxFilingAttested: false };
    h.client.whtCertificateHistory.findMany = async () => [
      { ...base, eventType: 'EXTERNAL_RECORD_REMOVED', occurredAt: new Date('2026-07-22'), detailsJson: { externalEvidenceRef: 'old-file', linkNote: 'บันทึกเดิม' } },
      { ...base, eventType: 'EXTERNAL_RECORDED', occurredAt: new Date('2026-07-21'), detailsJson: null },
    ];
    h.client.user = { findMany: async () => [] };
    const [, recorded] = await h.value.getExpenseHistory(ctx, 'exp-1');
    assert.equal(recorded.evidenceRef, 'old-file'); assert.equal(recorded.note, 'บันทึกเดิม');
  });
  it('names source document changes consistently in history labels', async () => {
    const { WHT_CERTIFICATE_HISTORY_EVENT_LABELS } = await import('@watchdog-bms/contracts');
    assert.equal(WHT_CERTIFICATE_HISTORY_EVENT_LABELS.CANCELLED_SOURCE_VOIDED, 'ยกเลิก เพราะเอกสารถูกยกเลิก');
    assert.equal(WHT_CERTIFICATE_HISTORY_EVENT_LABELS.CANCELLED_SOURCE_REOPENED, 'ยกเลิก เพราะเอกสารถูกแก้ไข');
  });
});

describe('C5 self-issued record changes and list context', () => {
  const recorder = { ...ctx, permissions: ['expense.read', 'wht.external_certificate.link'] };
  const original = { commandId: 'record-original', externalCertificateNumber: 'EXT-OLD', externalEvidenceRef: 'old-ref', issuedDate: '2026-07-20', note: 'เดิม' };
  const changed = { commandId: 'change-one', externalCertificateNumber: 'EXT-NEW', externalEvidenceRef: 'new-ref', issuedDate: '2026-07-21', note: 'ใหม่' };
  const notLinkable = 'บันทึกไม่ได้ เพราะมีผู้ออกหรือบันทึกหนังสือรับรองของรายจ่ายนี้ไปก่อนแล้ว หรือเอกสารถูกแก้ไขหรือยกเลิก เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด';
  async function linked() {
    const h = makeStore();
    const created = await h.value.createOrReplay({ ...baseInput, sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1', sourceBranchId: 'branch-1' });
    await h.value.linkExternal(recorder, created.id, original);
    h.client.expenseRecord.findFirst = async ({ where }: any) => matches({ id: 'expense-1', companyId: ctx.companyId, branchId: 'branch-1', createdByUserId: ctx.userId }, where)
      ? { id: 'expense-1', companyId: ctx.companyId, status: 'CONFIRMED', netPayableAmount: '970', expenseDate: new Date(prefill.paymentDate), whtAmount: '30', vendorEntityKindSnapshot: 'JURISTIC_PERSON' } : null;
    h.client.taxPeriod = { findFirst: async () => null, findMany: async () => [] };
    h.client.accountingPeriod = { findUnique: async () => null };
    return { ...h, id: created.id, change: (actor: any = recorder, body: any = changed) => (h.value as any).changeExternal(actor, created.id, body) };
  }
  function refuses(code: string, message: string) {
    return (error: any) => { assert.equal(error.getResponse().code, code); assert.equal(error.getResponse().message, message); return true; };
  }
  const removeReason = 'บันทึกผิด ยังไม่ได้ออกให้ผู้รับเงิน';
  async function removable() {
    const h = await linked();
    const body = { commandId: 'remove-one', expectedUpdatedAt: h.rows[0].updatedAt.toISOString(), reason: removeReason };
    return { ...h, body, remove: (actor: any = recorder, input: any = body) => (h.value as any).removeExternal(actor, h.id, input) };
  }
  it('C15 removal returns to waiting, preserves prefill/address and appends the removed evidence with actor, reason and audit', async () => {
    const h = await removable(); h.rows[0].payeeAddress = 'ที่อยู่ที่กรอกไว้';
    const snapshot = h.rows[0].prefillSnapshotJson, hash = h.rows[0].prefillSnapshotHash;
    const result = await h.remove();
    assert.equal(result.status, 'REQUIRED'); assert.equal(result.systemIssuanceOpen, true);
    assert.equal(result.canChangeExternalRecord, false);
    for (const key of ['externalCertificateNumber', 'externalIssuedDate', 'externalEvidenceRef', 'linkNote', 'linkCommandId', 'linkPayloadFingerprint', 'linkedAt', 'linkedByUserId']) assert.equal(h.rows[0][key], null, key);
    assert.equal(h.rows[0].payeeAddress, 'ที่อยู่ที่กรอกไว้'); assert.equal(h.rows[0].prefillSnapshotJson, snapshot); assert.equal(h.rows[0].prefillSnapshotHash, hash);
    const event = h.history.find(row => row.eventType === 'EXTERNAL_RECORD_REMOVED');
    assert.equal(event.certificateNumber, 'EXT-OLD'); assert.equal(event.certificateDate.toISOString(), '2026-07-20T00:00:00.000Z');
    assert.equal(event.actorUserId, recorder.userId); assert.equal(event.reason, removeReason); assert.equal(event.detailsJson.removedManually, true);
    assert.equal(event.detailsJson.externalEvidenceRef, 'old-ref'); assert.equal(event.detailsJson.linkNote, 'เดิม');
    assert.equal(h.audits.filter(row => row.action === 'tax.wht_certificate.external_record_removed').length, 1);
    h.history.forEach((row, index) => { row.occurredAt = new Date(2026, 6, 20 + index); }); h.client.user = { findMany: async () => [] };
    assert.equal((await h.value.getExpenseHistory(recorder, h.rows[0].sourcePaymentId)).find(row => row.eventType === 'EXTERNAL_RECORD_REMOVED')?.removedManually, true);
    assert.equal((await h.value.get(recorder, h.id)).previousCertificate, undefined);
    assert.equal((await h.value.listPaged(recorder)).rows[0].previousCertificate, undefined);
  });
  it('C15 removal retry is durable after re-recording; a reused command or stale version cannot remove newer evidence', async () => {
    const h = await removable(); await h.remove(); await h.remove();
    await h.value.linkExternal(recorder, h.id, { ...original, commandId: 'record-again', externalCertificateNumber: 'NEWER' });
    assert.equal((await h.remove()).externalCertificateNumber, 'NEWER');
    assert.equal(h.history.filter(row => row.eventType === 'EXTERNAL_RECORD_REMOVED').length, 1);
    await assert.rejects(h.remove(recorder, { ...h.body, reason: 'different reason' }), refuses('wht_handoff_link_command_reused', 'คำขอนี้ถูกใช้บันทึกข้อมูลอื่นไปแล้ว เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'));
    await assert.rejects(h.remove(recorder, { ...h.body, commandId: 'stale-remove', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }), refuses('wht_handoff_not_linkable', notLinkable));
    assert.equal(h.rows[0].externalCertificateNumber, 'NEWER');
  });
  it('C15 removal refuses non-standing states, stale versions, invalid reasons and missing authority without writes', async () => {
    for (const status of ['REQUIRED', 'SYSTEM_ISSUED', 'CANCELLED']) {
      const h = await removable(); h.rows[0].status = status;
      await assert.rejects(h.remove(), refuses('wht_handoff_not_linkable', notLinkable)); assert.equal(h.history.length, 1);
    }
    const h = await removable();
    for (const over of [{ reason: '' }, { reason: ' ab ' }, { reason: 'x'.repeat(501) }, { reason: null }, { commandId: '' }, { commandId: 'x'.repeat(201) }, { expectedUpdatedAt: 'bad' }]) {
      await assert.rejects(h.remove(recorder, { ...h.body, ...over }), (error: any) => error.getStatus() === 400);
    }
    await assert.rejects(h.remove(ctx), refuses('wht_handoff_external_remove_permission_denied', 'คุณไม่มีสิทธิ์ลบการบันทึกนี้ ให้ผู้ที่บันทึกหนังสือรับรองที่ทำนอกระบบได้ลบให้'));
    assert.equal(h.history.length, 1); assert.equal(h.rows[0].status, 'EXTERNAL_LINKED');
  });
  it('C15 removal refuses a source no longer confirmed and hides handoffs outside company, branch or expense scope', async () => {
    for (const status of ['VOIDED', 'NEEDS_REVIEW']) {
      const h = await removable(); h.client.expenseRecord.findFirst = async () => ({ status });
      await assert.rejects(h.remove(), refuses('expense_wht_source_changed', 'สถานะเอกสารนี้เปิดแก้ไขเอกสารไม่ได้ กลับไปหน้ารายจ่าย')); assert.equal(h.history.length, 1);
    }
    const h = await removable(); let missing: any;
    try { await (h.value as any).removeExternal(recorder, 'missing', h.body); } catch (error) { missing = error; }
    for (const actor of [{ ...recorder, companyId: 'other' }, { ...recorder, scopes: { branchIds: ['branch-2'] } }, { ...recorder, userId: 'other', permissions: ['expense.read_own', 'wht.external_certificate.link'] }]) {
      await assert.rejects(h.remove(actor), (error: any) => { assert.equal(error.getStatus(), 404); assert.deepEqual(error.getResponse(), missing.getResponse()); return true; });
    }
  });
  it('C15 removal checks a filed payment even when the month is only partially filed', async () => {
    const { withholdingPeriodLockedMessage } = await import('@watchdog-bms/contracts');
    const h = await removable(); h.client.taxPeriod.findMany = async ({ where }: any) => { if (!where.whtFilings) return []; assert.equal(where.whtFilings.some.lines.some.sourceId, 'expense-1'); return [{ formType: 'PND53', periodKey: '2026-07', status: 'EXPORTED' }]; };
    await assert.rejects(h.remove(), refuses('tax_period_filed', withholdingPeriodLockedMessage('2026-07', 'แก้ไขเอกสารนี้', 'PND53', 'EXTERNAL')));
    assert.equal(h.history.length, 1); assert.equal(h.rows[0].status, 'EXTERNAL_LINKED');
  });
  it('C15 a conditional-write conflict writes no history, and valid reasons are trimmed at their bounds', async () => {
    const h = await removable(); const update = h.table.updateMany;
    h.table.updateMany = async () => ({ count: 0 });
    await assert.rejects(h.remove(), refuses('wht_handoff_not_linkable', notLinkable)); assert.equal(h.history.length, 1);
    h.table.updateMany = update;
    await h.remove(recorder, { ...h.body, reason: '  ' + 'ก'.repeat(500) + '  ' });
    assert.equal(h.history.at(-1).reason.length, 500);
  });
  it('C5 changes a standing record without expense confirmation rights and keeps old and new history plus one audit', async () => {
    const h = await linked();
    const result = await h.change();
    const { WHT_CERTIFICATE_HISTORY_EVENT_LABELS } = await import('@watchdog-bms/contracts');
    assert.equal(WHT_CERTIFICATE_HISTORY_EVENT_LABELS.EXTERNAL_RECORD_CHANGED, 'แก้ไขการบันทึกหนังสือรับรองที่ทำนอกระบบ');
    assert.equal(result.externalCertificateNumber, changed.externalCertificateNumber);
    assert.equal(result.externalIssuedDate, '2026-07-21T00:00:00.000Z');
    assert.equal(result.externalEvidenceRef, 'new-ref'); assert.equal(result.linkNote, 'ใหม่');
    assert.equal(result.canChangeExternalRecord, true);
    const events = h.history.filter(row => row.eventType === 'EXTERNAL_RECORD_CHANGED');
    assert.equal(events.length, 1); assert.equal(events[0].certificateNumber, 'EXT-NEW');
    assert.deepEqual(events[0].detailsJson.previousRecord, { number: 'EXT-OLD', paymentDate: '2026-07-15', issuedDate: '2026-07-20T00:00:00.000Z', externalEvidenceRef: 'old-ref', note: 'เดิม' });
    assert.equal(h.audits.filter(row => row.action === 'tax.wht_certificate.external_record_changed').length, 1);
    h.client.user = { findMany: async () => [] };
    h.history.forEach((row, index) => { row.occurredAt = new Date(2026, 6, 20 + index); });
    const history = await h.value.getExpenseHistory(recorder, 'expense-1');
    const event = history.find(row => row.eventType === 'EXTERNAL_RECORD_CHANGED');
    assert.deepEqual((event as any).previousExternalRecord, events[0].detailsJson.previousRecord);
    assert.equal(event?.certificateNumber, 'EXT-NEW'); assert.equal(event?.evidenceRef, 'new-ref');
  });
  it('C5 same command safely retries even after a later change; reused commands cannot overwrite another payload or handoff', async () => {
    const h = await linked();
    await h.change(); await h.change();
    await h.change(recorder, { ...changed, commandId: 'change-two', externalCertificateNumber: 'EXT-LATEST' });
    const retry = await h.change(); assert.equal(retry.externalCertificateNumber, 'EXT-LATEST');
    assert.equal(h.history.filter(row => row.eventType === 'EXTERNAL_RECORD_CHANGED').length, 2);
    await assert.rejects(h.change(recorder, { ...changed, externalCertificateNumber: 'WRONG' }), refuses('wht_handoff_link_command_reused', 'คำขอนี้ถูกใช้บันทึกข้อมูลอื่นไปแล้ว เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'));
    const other = await h.value.createOrReplay({ ...baseInput, creationCommandId: 'other-record' });
    await h.value.linkExternal(recorder, other.id, { ...original, commandId: 'record-other' });
    await assert.rejects(() => (h.value as any).changeExternal(recorder, other.id, changed), refuses('wht_handoff_link_command_reused', 'คำขอนี้ถูกใช้บันทึกข้อมูลอื่นไปแล้ว เปิดหน้านี้ใหม่แล้วลองอีกครั้ง'));
  });
  it('C5 every non-standing status refuses with the latest-state sentence and writes nothing', async () => {
    for (const status of ['REQUIRED', 'SYSTEM_ISSUED', 'CANCELLED']) {
      const h = await linked(); h.rows[0].status = status;
      await assert.rejects(h.change(), refuses('wht_handoff_not_linkable', notLinkable));
      assert.equal(h.history.length, 1);
    }
  });
  it('C5 non-confirmed sources and missing permission refuse with actionable Thai and no change', async () => {
    for (const status of ['VOIDED', 'NEEDS_REVIEW']) {
      const h = await linked(); h.client.expenseRecord.findFirst = async () => ({ status });
      await assert.rejects(h.change(), refuses('expense_wht_source_changed', 'สถานะเอกสารนี้เปิดแก้ไขเอกสารไม่ได้ กลับไปหน้ารายจ่าย'));
      assert.equal(h.rows[0].externalCertificateNumber, 'EXT-OLD');
    }
    const h = await linked();
    await assert.rejects(h.change(ctx), refuses('wht_handoff_external_change_permission_denied', 'คุณไม่มีสิทธิ์แก้ไขการบันทึกหนังสือรับรองนี้ ให้ผู้ที่มีสิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบแก้ไขให้'));
  });
  it('C5 no-op and invalid or future dates refuse with their sentences while keeping the standing record', async () => {
    const h = await linked();
    await assert.rejects(h.change(recorder, { ...original, commandId: 'no-change' }), refuses('wht_handoff_external_record_no_changes', 'ข้อมูลตรงกับที่บันทึกไว้อยู่แล้ว จึงไม่มีอะไรต้องแก้ไข'));
    const invalidMessage = 'ข้อมูลที่บันทึกไม่ครบหรือไม่ถูกต้อง ตรวจเลขที่ วันที่ เลขอ้างอิง และหมายเหตุ แล้วบันทึกอีกครั้ง';
    for (const over of [{ commandId: '' }, { commandId: 'x'.repeat(201) }, { note: {} }, { externalCertificateNumber: ' ' }, { externalCertificateNumber: 'x'.repeat(101) }, { externalEvidenceRef: 'x'.repeat(501) }, { note: 'x'.repeat(1001) }, { issuedDate: '2026-02-31' }, { issuedDate: '2026-07-21T00:00:00Z' }]) {
      await assert.rejects(h.change(recorder, { ...changed, ...over }), refuses('wht_handoff_external_record_invalid', invalidMessage));
    }
    await assert.rejects(h.change(recorder, { ...changed, issuedDate: '2099-01-01' }), refuses('wht_handoff_external_issued_date_future', 'วันที่ทำใบต้องไม่เกินวันนี้ เลือกวันที่แล้วบันทึกอีกครั้ง'));
    assert.equal(h.rows[0].externalCertificateNumber, 'EXT-OLD'); assert.equal(h.history.length, 1);
  });
  it('changing or removing an unfiled payment is allowed when another establishment is filed', async () => {
    for (const action of ['change', 'remove'] as const) {
      const h = await removable();
      h.client.taxPeriod.findMany = async ({ where }: any) => where.whtFilings ? [] : [{ formType: 'PND53', periodKey: '2026-07', status: 'FILED' }];
      await (action === 'change' ? h.change() : h.remove());
      assert.equal(h.history.length, 2);
    }
  });
  it('legacy filed forms lock both changing and removing external certificates', async () => {
    const { withholdingPeriodLockedMessage } = await import('@watchdog-bms/contracts');
    for (const action of ['change', 'remove'] as const) for (const formType of ['PND3', 'PND53']) {
      const h = await removable();
      h.client.taxPeriod.findMany = async ({ where }: any) => where.whtFilings ? [] : [{ formType, periodKey: '2026-07', status: 'FILED', whtFilings: [] }];
      await assert.rejects(action === 'change' ? h.change() : h.remove(), refuses('tax_period_filed', withholdingPeriodLockedMessage('2026-07', 'แก้ไขเอกสารนี้', formType, 'EXTERNAL')));
    }
  });
  it('C5 filed withholding month uses the existing self-issued edit sentence for either form', async () => {
    const { withholdingPeriodLockedMessage } = await import('@watchdog-bms/contracts');
    for (const formType of ['PND3', 'PND53']) for (const status of ['FILED', 'PAID', 'CLOSED']) {
      const h = await linked(); h.rows[0].prefillSnapshotJson = { ...prefill, formType };
      h.client.taxPeriod.findFirst = async () => ({ formType, periodKey: '2026-07', status });
      h.client.taxPeriod.findMany = async () => [{ formType, periodKey: '2026-07', status }];
      await assert.rejects(h.change(), refuses('tax_period_filed', withholdingPeriodLockedMessage('2026-07', 'แก้ไขเอกสารนี้', formType, 'EXTERNAL')));
      assert.equal(h.rows[0].externalCertificateNumber, 'EXT-OLD');
    }
  });
  it('C5 an unresolved prefill still respects the expense withholding month and its own form', async () => {
    const h = await linked(); h.rows[0].prefillSnapshotJson = { ...prefill, formType: null };
    h.client.taxPeriod.findMany = async () => [{ formType: 'PND53', periodKey: '2026-07', status: 'FILED' }];
    const { withholdingPeriodLockedMessage } = await import('@watchdog-bms/contracts');
    await assert.rejects(h.change(), refuses('tax_period_filed', withholdingPeriodLockedMessage('2026-07', 'แก้ไขเอกสารนี้', 'PND53', 'EXTERNAL')));
  });
  it('C5 legacy original history keeps its reference and note after the standing record changes', async () => {
    const h = await linked(); h.history[0].detailsJson = null;
    await h.change();
    h.history.forEach((row, index) => { row.occurredAt = new Date(2026, 6, 20 + index); });
    h.client.user = { findMany: async () => [] };
    const old = (await h.value.getExpenseHistory(recorder, 'expense-1')).find(row => row.eventType === 'EXTERNAL_RECORDED')!;
    assert.equal(old.certificateNumber, 'EXT-OLD'); assert.equal(old.evidenceRef, 'old-ref'); assert.equal(old.note, 'เดิม');
  });
  it('C5 changing another branch or unreadable expense answers exactly like a missing handoff', async () => {
    const h = await linked();
    let missing: any;
    try { await (h.value as any).changeExternal(recorder, 'missing', changed); } catch (error) { missing = error; }
    assert.equal(missing.getStatus(), 404);
    for (const actor of [{ ...recorder, scopes: { branchIds: ['branch-2'] } }, { ...recorder, userId: 'other', permissions: ['expense.read_own', 'wht.external_certificate.link'] }]) {
      await assert.rejects(h.change(actor), (error: any) => { assert.equal(error.getStatus(), missing.getStatus()); assert.deepEqual(error.getResponse(), missing.getResponse()); return true; });
    }
  });
  it('C5 change authority is per viewer and standing status on by-id, array and paged reads', async () => {
    const h = await linked();
    for (const status of ['REQUIRED', 'EXTERNAL_LINKED', 'SYSTEM_ISSUED', 'CANCELLED']) {
      h.rows[0].status = status;
      for (const actor of [ctx, { ...ctx, permissions: ['expense.read', 'wht.certificate.issue'] }, { ...ctx, permissions: ['expense.read', 'wht.certificate.correct'] }, recorder]) {
        const expected = status === 'EXTERNAL_LINKED' && actor.permissions.includes('wht.external_certificate.link');
        assert.equal((await h.value.get(actor, h.id)).canChangeExternalRecord, expected);
        assert.equal((await h.value.list(actor))[0].canChangeExternalRecord, expected);
        assert.equal((await h.value.listPaged(actor)).rows[0].canChangeExternalRecord, expected);
      }
    }
  });
  it('C5 pending list remembers the newest cancelled certificate for several expenses using one history query', async () => {
    const h = makeStore();
    for (let index = 0; index < 3; index++) {
      await h.value.createOrReplay({ ...baseInput, creationCommandId: `pending-${index}`, sourcePaymentType: 'expense.record', sourcePaymentId: `expense-${index}` });
      h.history.push({ companyId: ctx.companyId, expenseId: `expense-${index}`, handoffId: `old-${index}`, eventType: index === 1 ? 'EXTERNAL_RECORD_REMOVED' : 'CANCELLED_SOURCE_REOPENED', isExternal: index === 1,
        certificateNumber: `OLD-${index}`, certificateDate: new Date('2026-07-10'), occurredAt: new Date('2026-07-20') });
      h.history.push({ ...h.history.at(-1), certificateNumber: `NEWEST-${index}`, occurredAt: new Date('2026-07-21') });
    }
    let queries = 0;
    const find = h.client.whtCertificateHistory.findMany;
    h.client.whtCertificateHistory.findMany = async (args: any) => { queries++; return (await find(args)).sort((a: any, b: any) => b.occurredAt - a.occurredAt); };
    const page = await h.value.listPaged(ctx, { status: 'REQUIRED' });
    assert.equal(queries, 1);
    for (const row of page.rows) {
      const index = Number(row.sourcePaymentId!.split('-')[1]);
      assert.deepEqual(row.previousCertificate, { number: `NEWEST-${index}`, kind: index === 1 ? 'EXTERNAL' : 'SYSTEM', cancelledAt: '2026-07-21T00:00:00.000Z' });
      assert.deepEqual((await h.value.get(ctx, row.id)).previousCertificate, row.previousCertificate);
    }
    assert.equal((await h.value.list(ctx)).filter(row => row.previousCertificate).length, 3);
    h.rows[0].status = 'EXTERNAL_LINKED'; h.rows[0].externalCertificateNumber = 'CURRENT';
    assert.equal((await h.value.get(ctx, h.rows[0].id)).previousCertificate, undefined);
  });
  it('C6 pending reads separate the cancelled certificate from the current certificate', async () => {
    const h = makeStore();
    await h.value.createOrReplay({ ...baseInput, sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-pending' });
    h.history.push({ companyId: ctx.companyId, expenseId: 'expense-pending', handoffId: h.rows[0].id, eventType: 'CANCELLED_SOURCE_REOPENED', isExternal: false,
      certificateNumber: 'WHT-CANCELLED', certificateDate: new Date('2026-07-10'), occurredAt: new Date('2026-07-20') });
    const pending = (await h.value.listPaged(ctx, { status: 'REQUIRED' })).rows[0];
    for (const row of [pending, ...(await h.value.list(ctx)), await h.value.get(ctx, h.rows[0].id)]) {
      assert.equal(row.certificateId, null);
      assert.equal(row.certificateNumber, null);
      assert.equal(row.certificateIssuedAt, null);
      assert.equal(row.previousCertificate?.number, 'WHT-CANCELLED');
    }
  });
  it('C5 list address flag uses the handoff address first, then the vendor snapshot, and treats whitespace as missing', async () => {
    const h = makeStore();
    for (const [index, address, vendor, expected] of [[0, 'saved', null, true], [1, null, 'vendor', true], [2, ' ', ' vendor ', true], [3, null, ' ', false], [4, null, null, false]] as const) {
      await h.value.createOrReplay({ ...baseInput, creationCommandId: `address-${index}`, prefill: { ...prefill, payeeSnapshot: { ...prefill.payeeSnapshot, address: vendor } } });
      h.rows[index].payeeAddress = address; h.rows[index].expectedAddress = expected;
    }
    for (const row of (await h.value.listPaged(ctx)).rows) assert.equal(row.hasPayeeAddress, h.rows.find(db => db.id === row.id).expectedAddress);
  });
  it('C5 recording refusals describe recording instead of uploads without changing their codes', async () => {
    const h = await linked();
    await assert.rejects(h.value.linkExternal(recorder, h.id, { ...original, commandId: 'second-record' }), refuses('wht_handoff_already_linked', 'รายจ่ายนี้บันทึกหนังสือรับรองที่ทำนอกระบบไว้แล้ว ถ้าข้อมูลผิด ให้ใช้ "แก้ไขการบันทึก"'));
    h.rows[0].status = 'SYSTEM_ISSUED';
    await assert.rejects(h.value.linkExternal(recorder, h.id, changed), refuses('wht_handoff_not_linkable', notLinkable));
  });
});


it('C9 paged, array and single reads compute payerMissing with one company read per request', async () => {
  const h = makeStore();
  for (let index = 0; index < 3; index++) await h.value.createOrReplay({ ...baseInput, creationCommandId: `payer-${index}`, prefill: { ...prefill, payerSnapshot: { ...prefill.payerSnapshot, taxId: null, address: null } } });
  let reads = 0; h.client.company.findUnique = async () => { reads++; return { registeredName: 'ชื่อจดทะเบียน', taxId: '1234567890123', addressJson: { line1: 'ที่อยู่ปัจจุบัน' } }; };
  for (const action of [() => h.value.listPaged(ctx), () => h.value.list(ctx), () => h.value.get(ctx, h.rows[0].id)]) {
    const before = reads; const result = await action();
    const rows = Array.isArray(result) ? result : 'rows' in result ? result.rows : [result];
    for (const row of rows) assert.deepEqual(row.payerMissing, []); assert.equal(reads - before, 1);
  }
  h.client.company.findUnique = async () => ({ registeredName: null, taxId: '1234567890123', addressJson: { line1: 'ที่อยู่' } });
  for (const read of [() => h.value.list(ctx), async () => (await h.value.listPaged(ctx, {})).rows, async () => [await h.value.get(ctx, h.rows[0].id)]]) {
    for (const row of await read()) assert.deepEqual(row.payerMissing, ['REGISTERED_NAME']);
  }
  h.client.company.findUnique = async () => null;
  assert.deepEqual((await h.value.get(ctx, h.rows[0].id)).payerMissing, ['REGISTERED_NAME', 'TAX_ID', 'ADDRESS']);
});


describe('C17 historical search, descriptions and cleared addresses', () => {
  it('finds old numbers in every current tab with matching counts and preserves branch and own-expense scope', async () => {
    const h = makeStore();
    const statuses = ['SYSTEM_ISSUED', 'REQUIRED', 'CANCELLED', 'EXTERNAL_LINKED'] as const;
    for (const [index, status] of statuses.entries()) {
      await h.value.createOrReplay({ ...baseInput, creationCommandId: `history-${index}`, sourcePaymentType: 'expense.record', sourcePaymentId: `expense-${index}`, sourceBranchId: 'branch-1' });
      Object.assign(h.rows[index], { status, externalCertificateNumber: status === 'EXTERNAL_LINKED' ? 'EXT-CURRENT' : null });
      h.history.push({ companyId: ctx.companyId, expenseId: `expense-${index}`, handoffId: h.rows[index].id,
        eventType: index === 0 ? 'CORRECTED' : index === 1 ? 'EXTERNAL_RECORD_REMOVED' : index === 2 ? 'CANCELLED_SOURCE_VOIDED' : 'EXTERNAL_RECORD_CHANGED',
        certificateNumber: index === 3 ? 'EXT-CURRENT' : `OLD-${index}`, relatedCertificateNumber: index === 0 ? 'CURRENT' : null,
        detailsJson: index === 3 ? { previousRecord: { number: 'OLD-3' } } : index === 1 ? { removedManually: true } : null,
        isExternal: index === 1 || index === 3, occurredAt: new Date('2026-07-20') });
    }
    h.client.whtCertificate = { findMany: async () => [] };
    const actor = { ...ctx, permissions: ['expense.read_own'], scopes: { branchIds: ['branch-1'] } };
    const result = await h.value.listPaged(actor, { search: 'old-' });
    assert.equal(result.total, 4); assert.deepEqual(result.counts, { REQUIRED: 1, SYSTEM_ISSUED: 1, EXTERNAL_LINKED: 1, CANCELLED: 1 });
    for (const status of statuses) {
      const page = await h.value.listPaged(actor, { status, search: 'old-' });
      assert.equal(page.total, 1); assert.equal(page.rows[0].matchedPreviousNumber, `OLD-${statuses.indexOf(status)}`);
    }
    assert.equal((await h.value.listPaged({ ...actor, scopes: { branchIds: ['other'] } }, { search: 'old-' })).total, 0);
    assert.equal((await h.value.listPaged({ ...actor, userId: 'other' }, { search: 'old-' })).total, 0);
    assert.equal((await h.value.listPaged({ ...actor, companyId: 'other' }, { search: 'old-' })).total, 0);
    assert.equal((await h.value.listPaged(actor, { search: 'EXT-CURRENT' })).rows[0].matchedPreviousNumber, null);
    assert.ok((await h.value.listPaged(actor)).rows.every(row => row.matchedPreviousNumber === null));
  });

  it('returns the existing expense-picker description and null for absent or non-expense descriptions in one batch', async () => {
    const h = makeStore();
    for (const id of ['with-lines', 'empty', 'ap']) await h.value.createOrReplay({ ...baseInput, creationCommandId: id,
      sourcePaymentType: id === 'ap' ? 'procurement.supplier_payment' : 'expense.record', sourcePaymentId: id });
    let reads = 0;
    h.client.expenseRecord.findMany = async ({ select }: any) => {
      reads++; assert.deepEqual(select.lines, { orderBy: { lineNumber: 'asc' }, select: { description: true } });
      return ['with-lines', 'empty'].map(id => ({ id, status: 'CONFIRMED', expenseDate: new Date(prefill.paymentDate),
        lines: id === 'with-lines' ? [{ description: 'ค่าเดินทาง' }, { description: 'ค่าจอดรถ' }] : [] }));
    };
    const page = await h.value.listPaged(ctx);
    assert.equal(reads, 1);
    assert.equal(page.rows.find(row => row.sourcePaymentId === 'with-lines')?.expenseDescription, 'ค่าเดินทาง; ค่าจอดรถ');
    assert.equal(page.rows.find(row => row.sourcePaymentId === 'empty')?.expenseDescription, null);
    assert.equal(page.rows.find(row => row.sourcePaymentId === 'ap')?.expenseDescription, null);
  });

  it('reports a typed address cleared by a tax-number change on reads until an address is saved, without making it a previous certificate', async () => {
    const h = makeStore(); const created = await h.value.createOrReplay({ ...baseInput, sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' });
    h.history.push({ companyId: ctx.companyId, expenseId: 'expense-1', handoffId: created.id, eventType: 'PAYEE_ADDRESS_CLEARED',
      certificateNumber: null, isExternal: false, occurredAt: new Date('2026-07-20'), detailsJson: { reason: 'PAYEE_TAX_ID_CHANGED' } });
    for (const row of [await h.value.get(ctx, created.id), ...(await h.value.list(ctx)), ...(await h.value.listPaged(ctx)).rows]) {
      assert.equal(row.payeeAddressClearedByTaxIdChange, true); assert.equal(row.previousCertificate, undefined);
    }
    const saved = await h.value.setPayeeAddress(ctx, created.id, { payeeAddress: '99 ที่อยู่ใหม่' });
    assert.equal(saved.payeeAddressClearedByTaxIdChange, false);
    assert.equal((await h.value.get(ctx, created.id)).payeeAddressClearedByTaxIdChange, false);
  });
});


describe('withholding certificate month and form filters', () => {
  it('filters the frozen payment month and form before pagination and status counts', async () => {
    const h = makeStore();
    for (const [month, formType] of [['2026-07', 'PND3'], ['2026-07', 'PND53'], ['2026-08', 'PND3']]) {
      await h.value.createOrReplay({ companyId: ctx.companyId, creationCommandId: `${month}-${formType}`, sourceFeatureKey: 'wht_certificate',
        sourcePaymentType: 'procurement.supplier_payment', sourcePaymentId: `${month}-${formType}`,
        prefill: { ...prefill, formType: formType as any, paymentDate: `${month}-15T00:00:00.000Z` }, availabilityVector: {} });
    }
    const result = await h.value.listPaged(ctx, { periodKey: '2026-07', formType: 'PND3', pageSize: 1 });
    assert.equal(result.total, 1); assert.equal(result.counts.REQUIRED, 1);
    assert.equal(result.rows[0].formType, 'PND3');
    assert.equal(result.rows[0].prefill.paymentDate, '2026-07-15T00:00:00.000Z');
    assert.equal((await h.value.listPaged(ctx, { periodKey: '2026-07' })).total, 2);
    assert.equal((await h.value.list(ctx, { periodKey: '2026-08', formType: 'PND3' })).length, 1);
    await assert.rejects(h.value.listPaged(ctx, { periodKey: '2026-13' }), (e: any) => e.getStatus() === 400);
    await assert.rejects(h.value.listPaged(ctx, { formType: 'PP30' as any }), (e: any) => e.getStatus() === 400);
  });
});

it('W6 self-recorded paper keeps payment date, original issue date and entry time apart', async () => {
  const h = makeStore(); const created = await h.value.createOrReplay(baseInput);
  const linked = await h.value.linkExternal(ctx, created.id, { commandId: 'two-dates', externalCertificateNumber: 'EXT-1', externalEvidenceRef: '', paymentDate: '2026-07-15', issuedDate: '2026-08-19' } as any);
  assert.equal((linked as any).externalPaymentDate, '2026-07-15');
  assert.equal(linked.externalIssuedDate?.slice(0, 10), '2026-08-19');
  assert.ok(new Date(linked.linkedAt!).getTime() > new Date(linked.externalIssuedDate!).getTime());
  assert.equal(normalizeWhtLinkEvidence({ commandId: 'bad', externalCertificateNumber: 'X', externalEvidenceRef: '', paymentDate: '2026-02-31', issuedDate: '2026-08-19' } as any).ok, false);
});

it('W1 recording an external certificate also refuses an unpaid expense', async () => {
  const h = makeStore(); const created = await h.value.createOrReplay({ ...baseInput, sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' });
  h.client.expensePayment = { findMany: async () => [] };
  await assert.rejects(h.value.linkExternal(ctx, created.id, { commandId: 'unpaid', externalCertificateNumber: 'X', externalEvidenceRef: '', issuedDate: '2026-08-19' }), (e: any) => e.getResponse().code === 'wht_certificate_payment_required');
  assert.equal(h.rows[0].status, 'REQUIRED');
});

it('handoff list query accepts only newest or oldest order', () => {
  for (const order of [undefined, 'newest', 'oldest']) assert.equal(validateSync(Object.assign(new WhtCertificateHandoffListQueryDto(), { order })).length, 0);
  for (const order of ['', 'desc', 'invalid', ['newest']]) assert.ok(validateSync(Object.assign(new WhtCertificateHandoffListQueryDto(), { order })).some(error => error.property === 'order'));
});


describe('WHT-OUTSIDE-2 external certificate files', () => {
  it('attaches, replaces and removes the current file while retaining history links', async () => {
    const { retainExternalWhtFile, externalWhtFiles } = await import('../services/wht-external-file');
    const links: any[] = [];
    const db = { attachmentObject: { findFirst: async ({ where }: any) => ({ id: where.id, companyId: ctx.companyId, uploadedByUserId: ctx.userId, status: 'ACTIVE', mimeType: 'application/pdf', byteSize: 100, metadataJson: { generatedFor: 'wht.external_certificate', handoffId: 'handoff' }, links: [] }) }, attachmentLink: { upsert: async ({ create }: any) => { links.push(create); } } } as any;
    const writer = { ...ctx, permissions: ['wht.external_certificate.link'] };
    await retainExternalWhtFile(db, writer, 'handoff', 'file-1');
    await retainExternalWhtFile(db, writer, 'handoff', 'file-2');
    await retainExternalWhtFile(db, writer, 'handoff', null);
    assert.deepEqual(links.map(row => row.attachmentId), ['file-1', 'file-2']);
    const history = (id: string | null) => [{ handoffId: 'handoff', eventType: 'EXTERNAL_RECORD_CHANGED', detailsJson: { externalAttachmentId: id } }];
    assert.equal(externalWhtFiles(history('file-1')).get('handoff'), 'file-1');
    assert.equal(externalWhtFiles(history('file-2')).get('handoff'), 'file-2');
    assert.equal(externalWhtFiles(history(null)).get('handoff'), null);
  });
  it('refuses missing permission, another company, unscanned and non-certificate files', async () => {
    const { retainExternalWhtFile } = await import('../services/wht-external-file');
    let file: any = null;
    const db = { attachmentObject: { findFirst: async ({ where }: any) => file?.companyId === where.companyId ? file : null } } as any;
    await assert.rejects(() => retainExternalWhtFile(db, ctx, 'handoff', 'file'), (error: any) => error.getStatus() === 403);
    const writer = { ...ctx, permissions: ['wht.external_certificate.link'] };
    for (const over of [{ companyId: 'other' }, { status: 'QUARANTINED' }, { mimeType: 'text/plain' }, { byteSize: 10485761 }, { metadataJson: {} }]) {
      file = { companyId: ctx.companyId, uploadedByUserId: ctx.userId, status: 'ACTIVE', mimeType: 'image/png', byteSize: 100, metadataJson: { generatedFor: 'wht.external_certificate', handoffId: 'handoff' }, links: [], ...over };
      await assert.rejects(() => retainExternalWhtFile(db, writer, 'handoff', 'file'), (error: any) => error.getStatus() === 400);
    }
  });
});

it('WHT-OUTSIDE-2 real link/change/read paths keep the file pointer, retain prior files, and allow explicit removal', async () => {
  const h = makeStore();
  const created = await h.value.createOrReplay(baseInput);
  const recorder = { ...ctx, permissions: ['wht.external_certificate.link'] };
  const links: any[] = [];
  h.client.attachmentObject = { findFirst: async ({ where }: any) => ({ id: where.id, companyId: ctx.companyId, uploadedByUserId: ctx.userId, status: 'ACTIVE', mimeType: 'application/pdf', byteSize: 100,
    metadataJson: { generatedFor: 'wht.external_certificate', handoffId: created.id }, links: [] }) };
  h.client.attachmentLink = { upsert: async ({ create }: any) => { links.push(create); } };
  h.client.taxPeriod = { findMany: async () => [] };
  h.client.whtCertificateHistory.findMany = async ({ where }: any) => h.history.filter(row => matches(row, where)).reverse();
  const body = { commandId: 'external-file-record', externalCertificateNumber: 'OUT-1', externalEvidenceRef: '', issuedDate: '2026-07-20', externalAttachmentId: 'file-1' };
  const first = await h.value.linkExternal(recorder, created.id, body);
  assert.equal(first.externalAttachmentId, 'file-1');
  assert.equal((await h.value.listPaged(recorder)).rows[0].externalAttachmentId, 'file-1');
  const replaced = await h.value.changeExternal(recorder, created.id, { ...body, commandId: 'replace-file', externalAttachmentId: 'file-2' });
  assert.equal(replaced.externalAttachmentId, 'file-2');
  const removed = await h.value.changeExternal(recorder, created.id, { ...body, commandId: 'remove-file', externalAttachmentId: null });
  assert.equal(removed.externalAttachmentId, null);
  assert.equal(removed.externalCertificateNumber, 'OUT-1');
  assert.equal(removed.externalIssuedDate?.slice(0, 10), '2026-07-20');
  assert.deepEqual(links.map(link => link.attachmentId), ['file-1', 'file-2']);
  assert.deepEqual(h.history.map(event => event.detailsJson.externalAttachmentId), ['file-1', 'file-2', null]);
});

it('WHT-OUTSIDE-2 file reads share the handoff permission, company, branch and related-expense boundary', async () => {
  const h = makeStore();
  const created = await h.value.createOrReplay({ ...baseInput, sourceBranchId: 'branch-1' });
  let signed = 0;
  Object.assign(h.value, { storage: { createDownloadUrl: async () => { signed++; return { url: '/signed/file', expiresAt: new Date() }; } } });
  h.client.attachmentObject = { findFirst: async ({ where }: any) => {
    assert.equal(where.companyId, ctx.companyId); assert.equal(where.status, 'ACTIVE');
    assert.deepEqual(where.links.some, { companyId: ctx.companyId, targetType: 'wht.external_certificate', targetId: created.id, purpose: 'wht.external_certificate.evidence' });
    return where.id === 'file-1' ? { originalFileName: 'ใบ.pdf', mimeType: 'application/pdf', bucket: 'files', objectKey: 'file-1' } : null;
  } };
  const reader = { ...ctx, permissions: ['wht.certificate.read'] };
  assert.equal((await h.value.externalFile(reader, created.id, 'file-1')).downloadUrl, '/signed/file');
  for (const actor of [{ ...reader, companyId: 'other' }, { ...reader, scopes: { branchIds: ['branch-2'] } }, { ...reader, permissions: [] }]) {
    await assert.rejects(() => h.value.externalFile(actor, created.id, 'file-1'), (error: any) => [403, 404].includes(error.getStatus()));
  }
  await assert.rejects(() => h.value.externalFile(reader, created.id, 'foreign-file'), (error: any) => error.getStatus() === 404);
  h.rows[0].sourcePaymentType = 'expense.record'; h.rows[0].sourcePaymentId = 'unreadable-expense';
  h.client.expenseRecord.findFirst = async () => null;
  await assert.rejects(() => h.value.externalFile(reader, created.id, 'file-1'), (error: any) => error.getStatus() === 404);
  assert.equal(signed, 1);
});

it('WHT-OUTSIDE-2 upload delegates to the existing scanner only for the same scoped handoff and writer', async () => {
  const h = makeStore();
  const created = await h.value.createOrReplay({ ...baseInput, sourceBranchId: 'branch-1' });
  const recorder = { ...ctx, permissions: ['wht.external_certificate.link'] };
  const calls: any[] = [];
  Object.assign(h.value, { uploadIntent: { execute: async (...args: any[]) => { calls.push(args); return { attachmentId: 'file-1' }; } }, completeUpload: { execute: async (...args: any[]) => { calls.push(args); return { status: 'ACTIVE' }; } } });
  const file = { originalFileName: 'ใบ.pdf', mimeType: 'application/pdf', byteSize: 100 };
  await h.value.externalFileIntent(recorder, created.id, file);
  assert.deepEqual(calls[0][1], { ...file, branchId: 'branch-1', visibility: 'INTERNAL', metadataJson: { generatedFor: 'wht.external_certificate', handoffId: created.id } });
  h.client.attachmentObject = { findFirst: async ({ where }: any) => {
    assert.equal(where.companyId, ctx.companyId); assert.equal(where.uploadedByUserId, ctx.userId);
    return { metadataJson: { generatedFor: 'wht.external_certificate', handoffId: created.id } };
  } };
  await h.value.completeExternalFile(recorder, created.id, { attachmentId: 'file-1', byteSize: 100 });
  assert.deepEqual(calls[1][1], { attachmentId: 'file-1', byteSize: 100 });
  for (const actor of [{ ...recorder, companyId: 'other' }, { ...recorder, scopes: { branchIds: ['branch-2'] } }, { ...recorder, permissions: [] }]) {
    await assert.rejects(() => h.value.externalFileIntent(actor, created.id, file));
    await assert.rejects(() => h.value.completeExternalFile(actor, created.id, { attachmentId: 'file-1' }));
  }
  h.client.attachmentObject.findFirst = async () => ({ metadataJson: { generatedFor: 'wht.external_certificate', handoffId: 'other-handoff' } });
  await assert.rejects(() => h.value.completeExternalFile(recorder, created.id, { attachmentId: 'file-1' }));
  assert.equal(calls.length, 2);
});


it('WHT-OUTSIDE-2 an upload on the expense-wide handoff follows the first payment-specific external record', async () => {
  const h = makeStore();
  const created = await h.value.createOrReplay({ ...baseInput, sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' });
  h.rows[0].prefillSnapshotJson = { ...prefill, incomeCategoryCode: 'SERVICE' };
  h.client.whtCertificateHandoff.createMany = async ({ data }: any) => { for (const row of data) await h.table.create({ data: row }); };
  h.client.whtCertificateHandoff.findUniqueOrThrow = h.table.findUnique;
  const links: any[] = [];
  h.client.attachmentObject = { findFirst: async ({ where }: any) => ({ id: where.id, companyId: ctx.companyId, uploadedByUserId: ctx.userId, status: 'ACTIVE', mimeType: 'image/png', byteSize: 100,
    metadataJson: { generatedFor: 'wht.external_certificate', handoffId: created.id }, links: links.filter(link => link.attachmentId === where.id) }) };
  h.client.attachmentLink = { upsert: async ({ create }: any) => { links.push(create); } };
  const writer = { ...ctx, permissions: ['expense.read', 'wht.external_certificate.link'] };
  const result = await h.value.linkExternal(writer, created.id, { commandId: 'first-payment-file', externalCertificateNumber: 'OUT-1', externalEvidenceRef: '', issuedDate: '2026-07-20', paymentId: 'p1', externalAttachmentId: 'photo' });
  assert.notEqual(result.id, created.id);
  assert.equal(result.externalAttachmentId, 'photo');
  assert.equal(links[0].targetId, result.id);
});
