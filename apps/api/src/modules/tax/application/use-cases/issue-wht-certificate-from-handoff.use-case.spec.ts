import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { IssueWhtCertificateFromHandoffUseCase } from './issue-wht-certificate-from-handoff.use-case';

const ctx = { companyId: 'company-1', userId: 'user-1', requestId: 'request-1' } as any;

function prefill(overrides: Record<string, unknown> = {}) {
  return {
    payerSnapshot: { companyName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', branchCode: '00002', address: null },
    payeeSnapshot: { name: 'บริษัท ผู้รับเงิน จำกัด', taxId: '1111111111111', address: null, branchCode: null },
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
    id: 'handoff-1', companyId: 'company-1', status: 'REQUIRED', certificateId: null,
    prefillSnapshotJson: prefill(),
    ...options.handoff,
  };
  const expense = { status: 'CONFIRMED' };
  const certificates: any[] = [];
  const commits: any[] = [];
  const audits: any[] = [];
  const renders: any[] = [];
  const client: any = {
    $executeRaw: async () => 0,
    expenseRecord: { findFirst: async () => expense },
    whtCertificateHandoff: {
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
      create: async ({ data }: any) => {
        const row = { id: `cert-${certificates.length + 1}`, createdAt: new Date(), issuedAt: data.issuedAt, ...data };
        certificates.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => certificates.find((c) => c.id === where.id) ?? null,
    },
    // §3.4: BLANK (no profile row) unless a test opts in — resolveSignature short-circuits before
    // ever touching attachments/storage, so those stay unused stubs in every case here.
    companyTaxProfile: { findUnique: async () => null },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
  };
  const taxRepo: any = {
    prisma: { client },
    upsertPeriod: async (input: any) => ({ id: 'period-1', ...input }),
    findPeriodById: async () => ({ id: 'period-1', formType: 'PND53' }),
  };
  const reserveNumber: any = {
    execute: async (input: any) => {
      if (options.onReserve) {
        // Simulates a concurrent identical request finishing its ENTIRE mint (reserve, create,
        // commit, handoff update) between our own initial REQUIRED read and our reserve attempt.
        options.onReserve();
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      }
      return { id: 'docnum-1', documentNumber: 'WT2026090001', companyId: input.companyId, status: 'RESERVED' };
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
    handoff, expense, certificates, commits, audits, renders, client,
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
    assert.equal(typed.handoff.prefillSnapshotJson.payeeSnapshot.address, null, 'the hashed prefill is never rewritten');

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
