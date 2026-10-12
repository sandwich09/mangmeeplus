import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { IssueWhtReplacementCopyUseCase } from './issue-wht-replacement-copy.use-case';

const ctx = { companyId: 'company-1', userId: 'user-1', requestId: 'request-1', permissions: ['expense.read'], scopes: {} } as any;

function certificate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert-1', companyId: 'company-1', certificateNumber: 'WT2026090001', status: 'ISSUED',
    taxPeriodId: 'period-1', periodKey: '2026-09',
    payerSnapshotJson: { companyName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', branchCode: '00002', address: null },
    payeeSnapshotJson: { name: 'บริษัท ผู้รับเงิน จำกัด', taxId: '1111111111111', address: null, branchCode: null },
    incomeCategoryCode: 'CAT1', incomeCategoryName: 'ค่าเช่า', whtRate: '5', grossAmount: '1000.0000', withheldAmount: '50.0000',
    paymentDate: new Date('2026-09-12T00:00:00.000Z'), taxEventIdsJson: [],
    issuedAt: new Date('2026-09-12T01:00:00.000Z'), issuedByUserId: 'user-0', createdAt: new Date('2026-09-12T01:00:00.000Z'),
    supersededByCertificateId: null, supersedesCertificateId: null, correctionReason: null,
    replacementCopyCount: 0, lastReplacementCopyAt: null, lastReplacementCopyByUserId: null,
    ...overrides,
  };
}

function guard(row: { state: 'OPEN' | 'CLOSED' } | null) {
  return new LaunchGateGuardService({ client: {
    featureLaunchGate: { findUnique: async ({ where }: any) => {
      assert.deepEqual(where.gateKey_routeKey, { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_REPLACEMENT_COPY' });
      return row && { ...row, generation: 1 };
    } },
    featureLaunchGateTransition: { findMany: async ({ where }: any) => [{ ...where, action: 'OPEN', seq: 1 }] },
  } } as any);
}

function harness(options: { handoff?: Record<string, unknown>; certificates?: any[] } = {}) {
  const handoff: any = { id: 'handoff-1', companyId: 'company-1', status: 'SYSTEM_ISSUED', certificateId: 'cert-1', ...options.handoff };
  const certificates: any[] = options.certificates ?? [certificate()];
  const expense = { status: 'CONFIRMED' };
  const audits: any[] = [];
  const renders: any[] = [];
  const client: any = {
    $executeRaw: async () => 0,
    expenseRecord: { findFirst: async () => ({ ...expense }) },
    whtCertificateHandoff: {
      findUnique: async ({ where }: any) => (where.id === handoff.id ? { ...handoff } : null),
    },
    whtCertificate: {
      findUnique: async ({ where }: any) => certificates.find((c) => c.id === where.id) ?? null,
      updateMany: async ({ where, data }: any) => {
        const row = certificates.find((c) => c.id === where.id && c.status === where.status);
        if (!row) return { count: 0 };
        row.replacementCopyCount += data.replacementCopyCount.increment;
        Object.assign(row, { ...data, replacementCopyCount: row.replacementCopyCount });
        return { count: 1 };
      },
      update: async ({ where, data }: any) => {
        const row = certificates.find((c) => c.id === where.id);
        if (data.replacementCopyCount?.increment) row.replacementCopyCount += data.replacementCopyCount.increment;
        Object.assign(row, { ...data, replacementCopyCount: row.replacementCopyCount });
        return { ...row };
      },
    },
    companyTaxProfile: { findUnique: async () => null },
  };
  client.$transaction = async (work: any) => work(client);
  const taxRepo: any = {
    prisma: { client },
    findPeriodById: async () => ({ id: 'period-1', formType: 'PND53' }),
  };
  const audit: any = { log: async (entry: any) => { audits.push(entry); } };
  const renderer: any = {
    renderWhtCertificate: async (fields: any, _payer: any, _payee: any, _signature: any, replacementCopy: any) => {
      renders.push({ fields, replacementCopy });
      return { mimeType: 'application/pdf', fileName: `wht-certificate-${fields.certificateNumber}`, contentBase64: '', checksum: 'sum', byteLength: 0 };
    },
  };
  return {
    handoff, expense, client, certificates, audits, renders,
    execute: (gate: LaunchGateGuardService) =>
      new IssueWhtReplacementCopyUseCase(taxRepo, audit, gate, renderer, {} as any, {} as any),
  };
}

describe('IssueWhtReplacementCopyUseCase', () => {
  it('reissues an identical, same-numbered copy and increments the counter', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'OPEN' }));
    const result: any = await useCase.execute(ctx, 'handoff-1');

    assert.equal(result.certificateNumber, 'WT2026090001', 'same number as the original — never a new reservation');
    assert.equal(h.certificates[0].replacementCopyCount, 1);
    assert.ok(h.certificates[0].lastReplacementCopyAt);
    assert.equal(h.certificates[0].lastReplacementCopyByUserId, 'user-1');
    assert.ok(h.renders[0].replacementCopy?.issuedAt, 'the "ใบแทน" label param is passed to the renderer');
    // Content fields carried over verbatim, never re-derived.
    assert.equal(h.renders[0].fields.incomeCategoryCode, 'CAT1');
    assert.equal(h.renders[0].fields.grossAmount, '1000.0000');
    assert.ok(h.audits.some((entry) => entry.action === 'tax.wht_certificate.replacement_copy' && entry.metadataJson.copySeq === 1));
  });

  it('two replacement requests in a row both succeed and both increment the counter', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await useCase.execute(ctx, 'handoff-1');
    const second: any = await useCase.execute(ctx, 'handoff-1');
    assert.equal(h.certificates[0].replacementCopyCount, 2);
    assert.equal(second.certificateNumber, 'WT2026090001');
  });

  it('refuses a handoff whose status is not SYSTEM_ISSUED', async () => {
    const h = harness({ handoff: { status: 'REQUIRED', certificateId: null } });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1'),
      (err: any) => err.getResponse().code === 'wht_certificate_not_correctable');
  });

  it('refuses to reissue while the route-readiness gate is CLOSED', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'CLOSED' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1'),
      (err: any) => err.getResponse().code === 'wht_system_replacement_unavailable');
    assert.equal(h.certificates[0].replacementCopyCount, 0);
  });

  it('resolves through the supersession chain when the handoff still points at a corrected-away certificate', async () => {
    const superseded = certificate({ id: 'cert-1', status: 'VOIDED', supersededByCertificateId: 'cert-2' });
    const active = certificate({ id: 'cert-2', certificateNumber: 'WT2026090002', supersedesCertificateId: 'cert-1' });
    const h = harness({ certificates: [superseded, active] });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    const result: any = await useCase.execute(ctx, 'handoff-1');
    assert.equal(result.certificateNumber, 'WT2026090002', 'replaces the ACTIVE certificate, never the superseded one');
    assert.equal(active.replacementCopyCount, 1);
    assert.equal(superseded.replacementCopyCount, 0);
  });
});


describe('issue-wht-replacement-copy source guards (A3)', () => {
  for (const status of ['NEEDS_REVIEW', 'VOIDED']) it(`refuses an expense source in ${status} without writing`, async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    h.expense.status = status;
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (error: any) => error.getResponse?.().code === 'expense_wht_source_changed' && error.getResponse().message === 'รายจ่ายของหนังสือรับรองนี้ถูกแก้ไขหรือยกเลิกไปแล้ว กรุณาเปิดหน้ารายจ่ายใหม่');
    assert.equal(h.certificates.length, 1); assert.equal(h.certificates[0].replacementCopyCount, 0);
  });
  it('preserves the expense revision and last editor when issuing a certificate artifact', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    h.client.expenseRecord.updateMany = async () => { throw new Error('certificate command must not edit the expense'); };
    await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
  });
  it('refuses a VOIDED certificate without a successor inside the transaction', async () => {
    const h = harness();
    const transact = h.client.$transaction;
    h.client.$transaction = async (work: any) => { h.certificates[0].status = 'VOIDED'; return transact(work); };
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (error: any) => error.getResponse?.().message === 'รายจ่ายของหนังสือรับรองนี้ถูกแก้ไขหรือยกเลิกไปแล้ว กรุณาเปิดหน้ารายจ่ายใหม่');
    assert.equal(h.certificates.length, 1); assert.equal(h.certificates[0].replacementCopyCount, 0);
  });
});


describe('C1 handoff scope boundary', () => {
  it('execute hides branch and unreadable expense ids exactly like a missing handoff', async () => {
    const h = harness({ handoff: { sourceBranchId: 'branch-2', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    h.client.expenseRecord.findFirst = async ({ where }: any) => JSON.stringify(where).includes('createdByUserId') || JSON.stringify(where).includes('\"in\":[]') ? null : { status: 'CONFIRMED' };
    const useCase = h.execute(guard({ state: 'OPEN' }));

    const call = (actor: any, id: string) => useCase.execute(actor, id);
    let missing: any;
    await assert.rejects(call(ctx, 'missing'), (error: any) => { missing = error.getResponse(); return error.getStatus() === 404; });
    const before = [h.audits.length, h.renders.length, h.certificates.length];
    for (const actor of [{ ...ctx, scopes: { branchIds: ['branch-1'] } }, { ...ctx, permissions: ['expense.read_own'] }, { ...ctx, permissions: [] }]) {
      await assert.rejects(call(actor, 'handoff-1'), (error: any) => { assert.equal(error.getStatus?.(), 404); assert.deepEqual(error.getResponse(), missing); return true; });
    }
    assert.deepEqual([h.audits.length, h.renders.length, h.certificates.length], before);
    assert.ok(await call(ctx, 'handoff-1'));
  });
});
