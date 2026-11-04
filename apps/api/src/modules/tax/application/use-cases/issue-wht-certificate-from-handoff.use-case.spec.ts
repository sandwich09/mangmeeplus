import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { IssueWhtCertificateFromHandoffUseCase } from './issue-wht-certificate-from-handoff.use-case';

const ctx = { companyId: 'company-1', userId: 'user-1', requestId: 'request-1', permissions: ['expense.read'], scopes: {} } as any;

function prefill(overrides: Record<string, unknown> = {}) {
  return {
    payerSnapshot: { companyName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', branchCode: '00002', address: 'ที่อยู่กิจการ' },
    payeeSnapshot: { name: 'บริษัท ผู้รับเงิน จำกัด', taxId: '1111111111111', address: 'ที่อยู่จากต้นทาง', branchCode: null },
    formType: 'PND53',
    incomeCategoryCode: 'CAT1',
    incomeCategoryName: 'ค่าเช่า',
    whtRate: '5',
    grossAmount: '1000.0000',
    withheldAmount: '50.0000',
    paymentDate: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

/** The real guard over a stubbed gate table — mirrors create-wht-certificate.use-case.spec.ts. */
function guard(row: { state: 'OPEN' | 'CLOSED' } | null) {
  return new LaunchGateGuardService({ client: {
    featureLaunchGate: { findUnique: async ({ where }: any) => {
      assert.deepEqual(where.gateKey_routeKey, { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE' });
      return row && { ...row, generation: 1 };
    } },
    featureLaunchGateTransition: { findMany: async ({ where }: any) => [{ ...where, action: 'OPEN', seq: 1 }] },
  } } as any);
}

function harness(options: { handoff?: Record<string, unknown>; onReserve?: () => void } = {}) {
  const handoff: any = {
    sourcePaymentType: 'procurement.supplier_payment', sourcePaymentId: 'pay-1', id: 'handoff-1', companyId: 'company-1', status: 'REQUIRED', certificateId: null, certificateRound: 0,
    prefillSnapshotJson: prefill(),
    ...options.handoff,
  };
  const expense = { status: 'CONFIRMED', netPayableAmount: '950' };
  const certificates: any[] = [];
  const history: any[] = [];
  const reservations: any[] = [], periods: any[] = [];
  const commits: any[] = [];
  const audits: any[] = [];
  const renders: any[] = [];
  const client: any = {
    whtCertificateHistory: { create: async () => { throw new Error('history must use the transaction client'); } },
    $executeRaw: async () => 0,
    expenseRecord: { findFirst: async () => expense },
    expensePayment: { findMany: async () => [{ id: 'p1', amount: '950', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-09-12'), createdAt: new Date('2026-09-12') }] },
    whtCertificateHandoff: {
      findFirst: async () => null,
      findUnique: async ({ where }: any) => (where.id === handoff.id ? { ...handoff } : null),
      updateMany: async ({ where, data }: any) => {
        if (handoff.id === where.id && handoff.companyId === where.companyId && handoff.status === where.status) {
          Object.assign(handoff, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    whtCertificate: {
      findMany: async ({ where }: any) => certificates.filter(c => c.companyId === where.companyId && where.id.in.includes(c.id) && c.status === where.status && c.voidReason === where.voidReason && (where.supersededByCertificateId === null ? !c.supersededByCertificateId : true)),
      updateMany: async ({ where, data }: any) => {
        const found = certificates.find(c => c.companyId === where.companyId && c.id === where.id && c.status === where.status && !c.supersededByCertificateId);
        if (!found) return { count: 0 };
        Object.assign(found, data); return { count: 1 };
      },
      create: async ({ data }: any) => {
        const row = { supersedesCertificateId: null, supersededByCertificateId: null, id: `cert-${certificates.length + 1}`, createdAt: new Date(), issuedAt: data.issuedAt, ...data };
        certificates.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => certificates.find((c) => c.id === where.id) ?? null,
    },
    // §3.4: BLANK (no profile row) unless a test opts in — resolveSignature short-circuits before
    // ever touching attachments/storage, so those stay unused stubs in every case here.
    company: { findUnique: async () => ({ registeredName: 'บริษัท ผู้จ่าย จำกัด' }) },
    supplierPayment: { findFirst: async () => ({ status: 'RECORDED', paymentDate: new Date('2026-09-12') }) },
    companyTaxProfile: { findUnique: async () => null },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      ...client, whtCertificateHistory: {
        findMany: async ({ where }: any) => history.filter(row => row.companyId === where.companyId && row.handoffId === where.handoffId && row.eventType === where.eventType && row.certificateId).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
        create: async ({ data }: any) => { history.push(data); return data; } },
    }),
  };
  const taxRepo: any = {
    prisma: { client },
    upsertPeriod: async (input: any) => { periods.push(input); return { id: 'period-1', ...input }; },
    findPeriodById: async () => ({ id: 'period-1', formType: 'PND53' }),
  };
  const reserveNumber: any = {
    execute: async (input: any) => {
      reservations.push(input);
      if (options.onReserve) {
        // Simulates a concurrent identical request finishing its ENTIRE mint (reserve, create,
        // commit, handoff update) between our own initial REQUIRED read and our reserve attempt.
        options.onReserve();
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      }
      return { id: `docnum-${reservations.length}`, documentNumber: `WT202609000${reservations.length}`, companyId: input.companyId, status: 'RESERVED' };
    },
  };
  const documentSequences: any = {
    commitNumberInTransaction: async (_tx: unknown, input: any) => { commits.push(input); return { ...input, status: 'COMMITTED' }; },
  };
  const audit: any = { log: async (entry: any) => { audits.push(entry); } };
  const renderer: any = {
    renderWhtCertificate: async (fields: any, _payer: any, payee: any) => {
      renders.push({ ...fields, payee });
      return { mimeType: 'application/pdf', fileName: `wht-certificate-${fields.certificateNumber}`, contentBase64: '', checksum: 'sum', byteLength: 0 };
    },
  };
  return {
    handoff, expense, certificates, history, periods, reservations, reserveNumber, commits, audits, renders, client,
    execute: (gate: LaunchGateGuardService) =>
      new IssueWhtCertificateFromHandoffUseCase(taxRepo, reserveNumber, documentSequences, audit, gate, renderer, {} as any, {} as any),
  };
}

describe('IssueWhtCertificateFromHandoffUseCase', () => {
  it('mints a certificate straight off the handoff, with no prior TaxPeriod/TaxEventIds', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'OPEN' }));
    const result = await useCase.execute(ctx, 'handoff-1');

    assert.equal(result.certificateNumber, 'WT2026090001');
    assert.equal(result.status, 'ISSUED');
    assert.equal(result.incomeCategoryCode, 'CAT1');
    assert.equal(result.pdfArtifact.mimeType, 'application/pdf');
    assert.equal(h.certificates.length, 1);
    assert.equal(h.certificates[0].taxPeriodId, 'period-1');
    assert.deepEqual(h.certificates[0].taxEventIdsJson, [], 'minted from facts, not from synced tax events');
    assert.equal(h.commits.length, 1, 'the reserved number is committed in the same transaction');
    assert.equal(h.handoff.status, 'SYSTEM_ISSUED');
    assert.equal(h.handoff.certificateId, h.certificates[0].id);
    assert.ok(h.audits.some((entry) => entry.action === 'tax.wht_certificate.issue' && entry.metadataJson.source === 'handoff'));
  });

  it('prints the operator-typed payee address over the frozen prefill, leaving the prefill untouched', async () => {
    const typed = harness({ handoff: { payeeAddress: '99 ถนนสุขุมวิท กรุงเทพฯ 10110' } });
    await typed.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
    assert.equal(typed.renders[0].payee.address, '99 ถนนสุขุมวิท กรุงเทพฯ 10110');
    assert.equal(typed.certificates[0].payeeSnapshotJson.address, '99 ถนนสุขุมวิท กรุงเทพฯ 10110', 'replacement/correction re-renders read this');
    assert.equal(typed.renders[0].payee.name, 'บริษัท ผู้รับเงิน จำกัด');
    assert.equal(typed.handoff.prefillSnapshotJson.payeeSnapshot.address, 'ที่อยู่จากต้นทาง', 'the hashed prefill is never rewritten');

    const fallback = harness({ handoff: { payeeAddress: null,
      prefillSnapshotJson: prefill({ payeeSnapshot: { name: 'ผู้รับ', taxId: null, address: 'ที่อยู่จากต้นทาง', branchCode: null } }) } });
    await fallback.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
    assert.equal(fallback.renders[0].payee.address, 'ที่อยู่จากต้นทาง');
  });

  it('replays the winner instead of a raw P2002 when two identical mints race', async () => {
    const h = harness({
      onReserve: () => {
        // The concurrent winner finishes its whole mint right as our reserve call collides with it.
        h.handoff.status = 'SYSTEM_ISSUED';
        h.handoff.certificateId = 'cert-winner';
        h.certificates.push({ id: 'cert-winner', companyId: 'company-1', certificateNumber: 'WT2026090001', status: 'ISSUED',
          taxPeriodId: 'period-1', periodKey: '2026-09', payeeSnapshotJson: {}, payerSnapshotJson: {},
          incomeCategoryCode: 'CAT1', incomeCategoryName: 'ค่าเช่า', whtRate: '5', grossAmount: '1000', withheldAmount: '50',
          paymentDate: new Date('2026-09-12'), taxEventIdsJson: [], issuedAt: new Date(), createdAt: new Date() });
      },
    });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    const result: any = await useCase.execute(ctx, 'handoff-1');
    assert.equal(h.history.length, 0, 'recovery must not append history for the winner again');
    assert.equal(result.id, 'cert-winner');
    assert.equal(result.certificateNumber, 'WT2026090001');
    assert.equal(h.certificates.length, 1, 'the loser never created a second row');
    // The loser must still be able to download the certificate — nothing ever populates
    // `pdfAttachmentId`, so a response without `pdfArtifact` would leave them stuck.
    assert.equal(result.pdfArtifact.mimeType, 'application/pdf');
  });

  it('refuses a handoff that is not REQUIRED (mutually exclusive with EXTERNAL_LINKED)', async () => {
    const h = harness({ handoff: { status: 'EXTERNAL_LINKED' } });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1'),
      (err: any) => err.getResponse().code === 'wht_handoff_not_issuable');
    assert.equal(h.certificates.length, 0);
  });

  it('refuses to mint while the route-readiness gate is CLOSED', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'CLOSED' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1'),
      (err: any) => err.getResponse().code === 'wht_system_issuance_unavailable');
    assert.equal(h.certificates.length, 0);
    assert.equal(h.handoff.status, 'REQUIRED');
  });

  it('refuses a handoff whose payee taxpayer class never resolved to a form', async () => {
    const h = harness({ handoff: { prefillSnapshotJson: prefill({ formType: null }) } });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1'),
      (err: any) => err.getResponse().code === 'wht_handoff_form_type_unresolved');
    assert.equal(h.certificates.length, 0);
  });

  it('refuses a handoff with no income category/rate rather than hit the NOT NULL constraint raw', async () => {
    const h = harness({ handoff: { prefillSnapshotJson: prefill({ incomeCategoryCode: null, incomeCategoryName: null, whtRate: null }) } });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1'),
      (err: any) => err.getResponse().code === 'wht_handoff_income_category_missing');
    assert.equal(h.certificates.length, 0);
  });

  it('rejects a handoff from another company as not found', async () => {
    const h = harness({ handoff: { companyId: 'company-2' } });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1'), /not found/i);
  });
});


describe('persistent expense certificate action', () => {
  it('refuses issuance after the source reopened or its unissued handoff changed while rendering', async () => {
    for (const mode of ['reopened', 'changed handoff']) {
      const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1', prefillSnapshotHash: 'original' } });
      const render = h.client.$transaction;
      h.client.$transaction = async (work: any) => {
        if (mode === 'reopened') h.expense.status = 'NEEDS_REVIEW';
        else h.handoff.prefillSnapshotHash = 'corrected';
        return render(work);
      };
      await assert.rejects(() => h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (e: any) => ['expense_wht_source_changed', 'wht_handoff_not_issuable'].includes(e.getResponse?.().code));
      assert.equal(h.certificates.length, 0); assert.equal(h.commits.length, 0);
    }
  });

  it('re-downloads the latest issued certificate without reserving another number or issuing a replacement', async () => {
    const h = harness(); const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(() => useCase.download(ctx, 'handoff-1'), (error: any) => /ยังไม่มีหนังสือรับรอง/.test(error.getResponse?.().message));
    await useCase.execute(ctx, 'handoff-1');
    const result = await (useCase as any).download(ctx, 'handoff-1');
    assert.equal(result.pdfArtifact.mimeType, 'application/pdf'); assert.equal(result.id, h.handoff.certificateId);
    assert.equal(h.certificates.length, 1); assert.equal(h.commits.length, 1);
    await assert.rejects(() => (useCase as any).download({ ...ctx, companyId: 'other' }, 'handoff-1'), /not found/i);
  });
});


describe('certificate history on system issue', () => {
  it('appends one ISSUED event in the transaction with the expense and paper date', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
    const result = await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
    await assert.rejects(() => h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'));
    assert.equal(h.history.length, 1, 'retry of an issued handoff never appends again');
    assert.deepEqual(h.history[0], {
      companyId: ctx.companyId, expenseId: 'exp-1', handoffId: 'handoff-1', eventType: 'ISSUED',
      certificateId: result.id, certificateNumber: result.certificateNumber, isExternal: false,
      certificateDate: h.certificates[0].issuedAt, actorUserId: ctx.userId,
    });
  });

  it('does not attribute another payment type to an expense', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'procurement.supplier_payment', sourcePaymentId: 'pay-1' } });
    await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
    assert.equal(h.history.length, 1);
    assert.equal(h.history[0].expenseId, null);
  });
});


describe('reissue after source cancellation (A4)', () => {
  it('keeps the round 0 reservation key byte for byte and gives round 1 a new key', async () => {
    for (const round of [0, 1]) {
      const h = harness({ handoff: { certificateRound: round } });
      await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
      assert.equal(h.reservations[0].idempotencyKey, `wht_certificate_from_handoff:handoff-1${round ? ':r1' : ''}`);
    }
  });
  it('builds one successor chain over three rounds and records the replaced number', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    const command = h.execute(guard({ state: 'OPEN' }));
    for (let round = 0; round < 3; round++) {
      await command.execute(ctx, 'handoff-1');
      if (round < 2) {
        const old = h.certificates[round]; Object.assign(old, { status: 'VOIDED', voidReason: 'SOURCE_REOPENED' });
        h.history.push({ companyId: ctx.companyId, handoffId: h.handoff.id, eventType: 'CANCELLED_SOURCE_REOPENED', certificateId: old.id, certificateNumber: old.certificateNumber, occurredAt: new Date(`2026-09-${13 + round}`) });
        Object.assign(h.handoff, { status: 'REQUIRED', certificateId: null, certificateRound: round + 1 });
      }
    }
    assert.equal(new Set(h.reservations.map(r => r.idempotencyKey)).size, 3);
    assert.equal(new Set(h.certificates.map(c => c.certificateNumber)).size, 3);
    for (let i = 1; i < 3; i++) {
      assert.equal(h.certificates[i].supersedesCertificateId, h.certificates[i - 1].id);
      assert.equal(h.certificates[i - 1].supersededByCertificateId, h.certificates[i].id);
      const issued = h.history.find(row => row.eventType === 'ISSUED' && row.certificateId === h.certificates[i].id);
      assert.equal(issued.relatedCertificateId, h.certificates[i - 1].id);
      assert.equal(issued.relatedCertificateNumber, h.certificates[i - 1].certificateNumber);
    }
  });
  it('chooses the latest cancelled certificate which has no successor and leaves existing links alone', async () => {
    const h = harness({ handoff: { certificateRound: 2 } });
    for (const [id, day, successor] of [['oldest', 10, null], ['eligible', 11, null], ['already-linked', 12, 'previous-successor']] as const) {
      h.certificates.push({ id, companyId: ctx.companyId, certificateNumber: id.toUpperCase(), status: 'VOIDED', voidReason: 'SOURCE_REOPENED', supersededByCertificateId: successor });
      h.history.push({ companyId: ctx.companyId, handoffId: h.handoff.id, eventType: 'CANCELLED_SOURCE_REOPENED', certificateId: id, occurredAt: new Date(`2026-09-${day}`) });
    }
    const issued = await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
    assert.equal(h.certificates.find(c => c.id === issued.id).supersedesCertificateId, 'eligible');
    assert.equal(h.certificates.find(c => c.id === 'already-linked').supersededByCertificateId, 'previous-successor');
    assert.equal(h.certificates.find(c => c.id === 'oldest').supersededByCertificateId, null);
  });
  it('never links a certificate cancelled because its expense was voided', async () => {
    const h = harness({ handoff: { certificateRound: 1 } });
    h.certificates.push({ id: 'voided', companyId: ctx.companyId, status: 'VOIDED', voidReason: 'SOURCE_VOIDED', certificateNumber: 'OLD', supersededByCertificateId: null });
    h.history.push({ companyId: ctx.companyId, handoffId: h.handoff.id, eventType: 'CANCELLED_SOURCE_VOIDED', certificateId: 'voided', occurredAt: new Date() });
    const issued = await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
    assert.equal(h.certificates.find(c => c.id === issued.id).supersedesCertificateId, null); assert.equal(h.certificates[0].supersededByCertificateId, null);
  });
  it('refuses a stale round even when re-confirmation kept the same prefill hash', async () => {
    const h = harness();
    const reserve = h.reserveNumber.execute;
    h.reserveNumber.execute = async (input: any) => { const result = await reserve(input); h.handoff.certificateRound = 1; return result; };
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (error: any) => error.getResponse().code === 'wht_handoff_not_issuable');
    assert.equal(h.certificates.length, 0);
  });
});


describe('C1 handoff scope boundary', () => {
  it('execute hides branch and unreadable expense ids exactly like a missing handoff', async () => {
    const h = harness({ handoff: { sourceBranchId: 'branch-2', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    h.client.expenseRecord.findFirst = async ({ where }: any) => JSON.stringify(where).includes('createdByUserId') || JSON.stringify(where).includes('\"in\":[]') ? null : { status: 'CONFIRMED', netPayableAmount: '950' };
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
  it('download hides branch and unreadable expense ids exactly like a missing handoff', async () => {
    const h = harness({ handoff: { sourceBranchId: 'branch-2', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    h.client.expenseRecord.findFirst = async ({ where }: any) => JSON.stringify(where).includes('createdByUserId') || JSON.stringify(where).includes('\"in\":[]') ? null : { status: 'CONFIRMED', netPayableAmount: '950' };
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await useCase.execute(ctx, 'handoff-1');
    const call = (actor: any, id: string) => useCase.download(actor, id);
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


describe('C1 list completeness matches issue refusals', () => {
  it('shares the form, income category name/code and rate checks, preserving refusal priority and zero-rate behavior', async () => {
    const { whtHandoffMissing } = await import('../../domain/logic/wht-handoff-missing.logic');
    for (const [patch, reasons, code] of [
      [{ formType: null }, ['FORM_TYPE_UNRESOLVED'], 'wht_handoff_form_type_unresolved'],
      [{ incomeCategoryCode: null }, ['INCOME_CATEGORY_OR_RATE_MISSING'], 'wht_handoff_income_category_missing'],
      [{ incomeCategoryName: '' }, ['INCOME_CATEGORY_OR_RATE_MISSING'], 'wht_handoff_income_category_missing'],
      [{ whtRate: null }, ['INCOME_CATEGORY_OR_RATE_MISSING'], 'wht_handoff_income_category_missing'],
      [{ formType: null, whtRate: null }, ['FORM_TYPE_UNRESOLVED', 'INCOME_CATEGORY_OR_RATE_MISSING'], 'wht_handoff_form_type_unresolved'],
    ] as const) {
      const h = harness({ handoff: { prefillSnapshotJson: prefill(patch) } });
      assert.deepEqual(whtHandoffMissing(h.handoff.prefillSnapshotJson), reasons);
      await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (error: any) => error.getResponse().code === code);
      assert.equal(h.reservations.length, 0); assert.equal(h.certificates.length, 0);
    }
    const zero = harness({ handoff: { prefillSnapshotJson: prefill({ whtRate: '0' }) } });
    assert.deepEqual(whtHandoffMissing(zero.handoff.prefillSnapshotJson), []);
    assert.equal((await zero.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1')).whtRate, '0');
  });
});

describe('A9 certificate number collisions', () => {
  for (const seam of ['reservation', 'certificate transaction']) it(`refuses a non-replay number collision at ${seam} with actionable Thai`, async () => {
    const h = harness();
    const collision = Object.assign(new Error('unique number'), { code: 'P2002', meta: { target: seam === 'reservation' ? 'DocumentNumber_companyId_documentType_documentNumber_key' : ['certificateNumber'] } });
    if (seam === 'reservation') h.reserveNumber.execute = async () => { throw collision; };
    else h.client.whtCertificate.create = async () => { throw collision; };
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, h.handoff.id), (error: any) => {
      assert.equal(error.getStatus(), 409); assert.equal(error.getResponse().code, 'wht_certificate_number_duplicate');
      assert.equal(error.getResponse().message, 'ออกหนังสือรับรองไม่สำเร็จเพราะเลขที่เอกสารซ้ำ ลองอีกครั้ง ถ้ายังไม่สำเร็จ ให้แจ้งทีมงานมั่งมีพร้อมเลขที่เอกสารรายจ่ายนี้'); return true;
    });
    assert.equal(h.history.length, 0);
  });
});


describe('C7 payee address before new issuance', () => {
  it('refuses a blank printed address before any period, number, certificate, history or audit write', async () => {
    for (const address of [null, undefined, '', '  \n ']) {
      const h = harness({ handoff: { payeeAddress: address, prefillSnapshotJson: prefill({ payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1111111111111', address, branchCode: null } }) } });
      await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, h.handoff.id), (error: any) => {
        assert.equal(error.getStatus(), 409);
        assert.deepEqual(error.getResponse(), { code: 'wht_handoff_payee_address_missing', message: 'ยังไม่มีที่อยู่ผู้รับเงิน เพิ่มที่อยู่ผู้รับเงินก่อน แล้วกด “ออกหนังสือรับรอง 50 ทวิ” อีกครั้ง' }); return true;
      });
      for (const rows of [h.periods, h.reservations, h.certificates, h.history, h.renders, h.audits]) assert.equal(rows.length, 0);
    }
  });
  it('uses a trimmed typed address or a trimmed snapshot address exactly as the list does', async () => {
    for (const typed of ['  ที่อยู่ที่พิมพ์  ', '   ']) {
      const h = harness({ handoff: { payeeAddress: typed, prefillSnapshotJson: prefill({ payeeSnapshot: { name: 'ผู้รับเงิน', address: '  ที่อยู่จากต้นทาง  ' } }) } });
      const result = await h.execute(guard({ state: 'OPEN' })).execute(ctx, h.handoff.id);
      assert.equal(result.payeeSnapshot.address, typed.trim() || 'ที่อยู่จากต้นทาง');
    }
  });
});


describe('C9 payer identity before issue', () => {
  it('refuses the shop before the payee with no period, number, paper or history writes', async () => {
    for (const missing of [['TAX_ID', 'ADDRESS'], ['TAX_ID'], ['ADDRESS']]) {
      const facts = prefill(); facts.payerSnapshot.taxId = missing.includes('TAX_ID') ? null as any : '9999999999999'; facts.payerSnapshot.address = missing.includes('ADDRESS') ? null as any : 'ที่อยู่กิจการ';
      facts.payeeSnapshot.address = null as any;
      const h = harness({ handoff: { prefillSnapshotJson: facts } });
      await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, h.handoff.id), (error: any) => {
        assert.equal(error.getStatus(), 409); assert.equal(error.getResponse().code, 'wht_payer_identity_missing');
        const words = missing.length === 2 ? 'เลขผู้เสียภาษีและที่อยู่ของร้าน' : missing[0] === 'TAX_ID' ? 'เลขผู้เสียภาษีของร้าน' : 'ที่อยู่ของร้าน';
        assert.equal(error.getResponse().message, `ยังไม่มี${words} กรอกในหน้าข้อมูลร้านก่อน แล้วกด “ออกหนังสือรับรอง 50 ทวิ” อีกครั้ง`); return true;
      });
      for (const rows of [h.periods, h.reservations, h.certificates, h.history, h.renders, h.audits]) assert.equal(rows.length, 0);
    }
  });
  it('fills a waiting frozen snapshot from current company and profile details without changing its hash', async () => {
    const facts = prefill(); facts.payerSnapshot.taxId = null as any; facts.payerSnapshot.address = null as any;
    const h = harness({ handoff: { prefillSnapshotJson: facts, prefillSnapshotHash: 'frozen' } });
    let reads = 0; h.client.company.findUnique = async () => { reads++; return { registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', addressJson: { line1: 'ที่อยู่ปัจจุบัน' } }; };
    h.client.companyTaxProfile.findUnique = async () => ({ taxId: '1234567890123' });
    const result = await h.execute(guard({ state: 'OPEN' })).execute(ctx, h.handoff.id);
    assert.equal(result.payerSnapshot.taxId, '1234567890123'); assert.equal(result.payerSnapshot.address, 'ที่อยู่ปัจจุบัน');
    assert.equal(h.handoff.prefillSnapshotJson.payerSnapshot.taxId, null); assert.equal(h.handoff.prefillSnapshotJson.payerSnapshot.address, null); assert.equal(h.handoff.prefillSnapshotHash, 'frozen'); assert.equal(reads, 1);
  });
  it('stores the shop address filled at issue time in its worded print form', async () => {
    const facts = prefill(); facts.payerSnapshot.address = null as any;
    const h = harness({ handoff: { prefillSnapshotJson: facts } });
    h.client.company.findUnique = async () => ({ registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '1234567890123', addressJson: { line1: '88 ถนนพระราม 4', line2: null, subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } });
    h.client.companyTaxProfile.findUnique = async () => null;
    const result = await h.execute(guard({ state: 'OPEN' })).execute(ctx, h.handoff.id);
    assert.equal(result.payerSnapshot.address, '88 ถนนพระราม 4 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110');
  });
});

it('refuses an explicit PND2 form with its outside-system way out and no issue writes', async () => {
  const h = harness({ handoff: { prefillSnapshotJson: prefill({ formType: 'PND2', incomeCategoryCode: 'SYNTHETIC_SEPARATE' }) } });
  await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (error: any) => {
    assert.equal(error.getResponse().code, 'wht_certificate_income_unsupported');
    assert.equal(error.getResponse().message, 'ประเภทนี้ยื่น ภ.ง.ด.2 ระบบยังออกหนังสือรับรอง 50 ทวิให้ไม่ได้ ให้ผู้ทำบัญชีทำนอกระบบแล้วจดเลขที่ไว้'); return true;
  });
  for (const rows of [h.periods, h.reservations, h.certificates, h.history, h.renders, h.audits]) assert.equal(rows.length, 0);
});

it('refuses PND2 and dividend system issuance before any number or certificate write', async () => {
  for (const incomeCategoryCode of ['WHT_INTEREST', 'WHT_DIVIDEND_IND', 'WHT_DIVIDEND']) {
    const h = harness({ handoff: { prefillSnapshotJson: prefill({ incomeCategoryCode }) } });
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (e: any) => e.getResponse().code === 'wht_certificate_income_unsupported');
    assert.deepEqual(h.reservations, []); assert.deepEqual(h.certificates, []);
  }
});

describe('W1 and W6 payment-backed certificates', () => {
  it('keeps an unpaid confirmed expense as an unnumbered draft', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
    h.client.expensePayment = { findMany: async () => [] };
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (e: any) => e.getResponse().code === 'wht_certificate_payment_required');
    assert.equal(h.reservations.length, 0); assert.equal(h.renders.length, 0); assert.equal(h.handoff.status, 'REQUIRED');
  });
  it('refuses an invented payment date before reserving a number', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
    h.client.expensePayment = { findMany: async () => [{ id: 'p1', amount: '950', status: 'RECORDED', paidAtConfirmed: false, paidAt: new Date(), createdAt: new Date() }] };
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (e: any) => e.getResponse().code === 'wht_certificate_payment_date_required');
    assert.equal(h.reservations.length, 0);
  });
  it('uses the real payment month and preserves it when issued later', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
    Object.assign(h.expense, { netPayableAmount: '950' });
    h.client.expensePayment = { findMany: async () => [{ id: 'p1', amount: '950', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-10-04T18:00:00Z'), createdAt: new Date() }] };
    const before = Date.now();
    await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
    assert.equal(h.renders[0].paymentDate.slice(0, 10), '2026-10-05');
    assert.equal(h.periods[0].periodKey, '2026-10');
    assert.ok(new Date(h.renders[0].issuedAt).getTime() >= before);
    assert.equal(h.certificates[0].paymentDate.toISOString().slice(0, 10), '2026-10-05');
  });
});

it('W1 partial payments have their own date and exact shares, and require a choice', async () => {
  const { certificatePayment } = await import('../services/wht-certificate-payment');
  const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
  h.client.expensePayment.findMany = async () => [
    { id: 'p1', amount: '316.67', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-09-12'), createdAt: new Date('2026-09-12') },
    { id: 'p2', amount: '633.33', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-10-05'), createdAt: new Date('2026-10-05') },
  ];
  await assert.rejects(certificatePayment(h.client, ctx.companyId, h.handoff), (e: any) => e.getResponse().code === 'wht_certificate_payment_selection_required');
  const first = await certificatePayment(h.client, ctx.companyId, h.handoff, 'p1');
  const last = await certificatePayment(h.client, ctx.companyId, h.handoff, 'p2');
  assert.deepEqual([first.grossAmount, first.withheldAmount, first.paymentDate], ['333.34', '16.67', '2026-09-12']);
  assert.deepEqual([last.grossAmount, last.withheldAmount, last.paymentDate], ['666.66', '33.33', '2026-10-05']);
});

it('W1 a second partial payment issues a separate certificate without replacing the first', async () => {
  const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
  const useCase = h.execute(guard({ state: 'OPEN' }));
  h.client.expensePayment.findMany = async () => [{ id: 'p1', amount: '475', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-09-12'), createdAt: new Date('2026-09-12') }];
  await useCase.execute(ctx, 'handoff-1');
  const first = structuredClone(h.certificates[0]);
  assert.equal(first.grossAmount, '500');
  h.client.expensePayment.findMany = async () => [
    { id: 'p1', amount: '475', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-09-12'), createdAt: new Date('2026-09-12') },
    { id: 'p2', amount: '475', status: 'RECORDED', paidAtConfirmed: true, paidAt: new Date('2026-10-05'), createdAt: new Date('2026-10-05') },
  ];
  const rows = [h.handoff];
  h.client.whtCertificateHandoff.createMany = async ({ data: [create] }: any) => {
    if (!rows.some(r => r.creationCommandId === create.creationCommandId)) rows.push({ id: 'handoff-p2', ...create });
  };
  h.client.whtCertificateHandoff.findUniqueOrThrow = async ({ where }: any) => rows.find(r => r.creationCommandId === where.companyId_creationCommandId.creationCommandId);
  h.client.whtCertificateHandoff.findUnique = async ({ where }: any) => rows.find(r => r.id === where.id);
  h.client.whtCertificateHandoff.updateMany = async ({ where, data }: any) => { const row = rows.find(r => r.id === where.id && r.status === where.status); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; };
  await useCase.execute(ctx, 'handoff-1', 'p2');
  assert.deepEqual(h.certificates[0], first);
  assert.equal(h.certificates[1].paymentDate.toISOString().slice(0, 10), '2026-10-05');
  assert.equal(h.certificates[1].grossAmount, '500');
  await assert.rejects(useCase.execute(ctx, 'handoff-1', 'p2'), (e: any) => e.getResponse().code === 'wht_handoff_not_issuable');
});

it('W1 refuses a second handoff for a payment already certified while holding the expense lock', async () => {
  const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
  h.client.whtCertificateHandoff.findFirst = async () => ({ id: 'other', status: 'SYSTEM_ISSUED' });
  await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1'), (e: any) => e.getResponse().code === 'wht_certificate_payment_already_issued');
  assert.equal(h.certificates.length, 0);
});


it('W6 issuing on the payment day prints the same civil day for both dates', async () => {
  const { civilDate } = await import('@watchdog-bms/contracts');
  const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
  const now = new Date();
  h.client.expensePayment.findMany = async () => [{ id: 'p1', amount: '950', status: 'RECORDED', paidAtConfirmed: true, paidAt: now, createdAt: now }];
  await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1');
  assert.equal(h.renders[0].paymentDate, civilDate(new Date(h.renders[0].issuedAt)));
});

it('handoff issue refuses a missing registered name and replaces an unproven display-name snapshot', async () => {
  const h = harness();
  h.client.company.findUnique = async () => ({ registeredName: null });
  const uc = h.execute(guard({ state: 'OPEN' }));
  await assert.rejects(() => uc.execute(ctx, 'handoff-1'), (error: any) => error.getResponse().code === 'wht_payer_identity_missing' && error.getResponse().payerMissing.includes('REGISTERED_NAME'));
  assert.equal(h.reservations.length, 0); assert.equal(h.certificates.length, 0);
  h.client.company.findUnique = async () => ({ registeredName: 'ชื่อจดทะเบียนจริง' });
  const result = await uc.execute(ctx, 'handoff-1');
  assert.equal(result.payerSnapshot.companyName, 'ชื่อจดทะเบียนจริง');
});

describe('Round 5 LINE certificate preview and revision fence', () => {
  it('previews the actual payment share and date, refusing unpaid or unknown-date sources without writes', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
    const uc = h.execute(guard({ state: 'OPEN' }));
    h.client.expensePayment.findMany = async () => [];
    await assert.rejects(() => uc.previewLineAction(ctx, 'handoff-1'), (e: any) => e.getResponse().code === 'wht_certificate_payment_required');
    const payment = { id: 'p1', amount: '475', status: 'RECORDED', paidAtConfirmed: false, paidAt: new Date('2026-10-04T18:00:00Z'), createdAt: new Date() };
    h.client.expensePayment.findMany = async () => [payment];
    await assert.rejects(() => uc.previewLineAction(ctx, 'handoff-1'), (e: any) => e.getResponse().code === 'wht_certificate_payment_date_required');
    payment.paidAtConfirmed = true;
    const preview = await uc.previewLineAction(ctx, 'handoff-1');
    assert.equal(preview.prefill.grossAmount, '500'); assert.equal(preview.prefill.withheldAmount, '25');
    assert.equal(preview.prefill.paymentDate, '2026-10-05');
    assert.deepEqual([h.periods.length, h.reservations.length, h.certificates.length, h.audits.length, h.renders.length], [0, 0, 0, 0, 0]);
  });
  it('reuses all issue preconditions without creating periods, numbers, documents or audit entries', async () => {
    for (const variant of ['valid', 'address', 'closed', 'status', 'income', 'payer']) {
      const h = harness({ handoff: { updatedAt: new Date('2026-10-15T01:00:00Z') } });
      if (variant === 'address') h.handoff.prefillSnapshotJson.payeeSnapshot.address = null;
      if (variant === 'status') h.handoff.status = 'EXTERNAL_LINKED';
      if (variant === 'income') h.handoff.prefillSnapshotJson.incomeCategoryCode = null;
      if (variant === 'payer') h.handoff.prefillSnapshotJson.payerSnapshot.taxId = null;
      const useCase = h.execute(guard({ state: variant === 'closed' ? 'CLOSED' : 'OPEN' }));
      if (variant === 'valid') await useCase.previewLineAction(ctx, 'handoff-1');
      else await assert.rejects(() => useCase.previewLineAction(ctx, 'handoff-1'));
      assert.deepEqual([h.periods.length, h.reservations.length, h.certificates.length, h.audits.length, h.renders.length], [0,0,0,0,0], variant);
      if (variant === 'address') { await useCase.previewLineAction(ctx, 'handoff-1', 'ที่อยู่ที่ผู้ใช้กำลังจะยืนยัน'); assert.equal(h.handoff.payeeAddress, undefined); }
    }
  });
  it('rejects an old card before reservation and checks revision again under the issue transaction lock', async () => {
    const revision = '2026-10-15T01:00:00.000Z';
    const stale = harness({ handoff: { updatedAt: new Date('2026-10-15T02:00:00Z') } });
    await assert.rejects(() => stale.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', undefined, revision), (error: any) => error.getResponse().code === 'wht_handoff_changed');
    assert.equal(stale.reservations.length, 0); assert.equal(stale.certificates.length, 0);
    const race = harness({ handoff: { updatedAt: new Date(revision) } });
    const reserve = race.reserveNumber.execute;
    race.reserveNumber.execute = async (input: any) => { const result = await reserve(input); race.handoff.updatedAt = new Date('2026-10-15T02:00:00Z'); return result; };
    await assert.rejects(() => race.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', undefined, revision), (error: any) => error.getResponse().code === 'wht_handoff_not_issuable');
    assert.equal(race.certificates.length, 0); assert.equal(race.commits.length, 0);
  });
});
