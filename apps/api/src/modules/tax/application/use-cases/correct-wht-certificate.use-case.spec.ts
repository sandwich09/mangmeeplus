import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { CorrectWhtCertificateUseCase } from './correct-wht-certificate.use-case';

const ctx = { companyId: 'company-1', userId: 'user-1', requestId: 'request-1' } as any;

function currentCertificate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert-1', companyId: 'company-1', certificateNumber: 'WT2026090001', status: 'ISSUED',
    taxPeriodId: 'period-1', periodKey: '2026-09',
    payerSnapshotJson: { companyName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', branchCode: '00002', address: null },
    payeeSnapshotJson: { name: 'บริษัท ผู้รับเงิน จำกัด', taxId: '1111111111111', address: null, branchCode: null },
    incomeCategoryCode: 'CAT1', incomeCategoryName: 'ค่าเช่า', whtRate: '5', grossAmount: '1000.0000', withheldAmount: '50.0000',
    paymentDate: new Date('2026-09-12T00:00:00.000Z'), taxEventIdsJson: [],
    issuedAt: new Date('2026-09-12T01:00:00.000Z'), issuedByUserId: 'user-0', createdAt: new Date('2026-09-12T01:00:00.000Z'),
    supersededByCertificateId: null, supersedesCertificateId: null, correctionReason: null,
    replacementCopyCount: 0,
    ...overrides,
  };
}

/** The real guard over a stubbed gate table — mirrors issue-wht-certificate-from-handoff.use-case.spec.ts. */
function guard(row: { state: 'OPEN' | 'CLOSED' } | null) {
  return new LaunchGateGuardService({ client: {
    featureLaunchGate: { findUnique: async ({ where }: any) => {
      assert.deepEqual(where.gateKey_routeKey, { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_CONTENT_CORRECTION' });
      return row && { ...row, generation: 1 };
    } },
    featureLaunchGateTransition: { findMany: async ({ where }: any) => [{ ...where, action: 'OPEN', seq: 1 }] },
  } } as any);
}

function harness(options: {
  handoff?: Record<string, unknown>;
  certificate?: Record<string, unknown>;
  period?: Record<string, unknown>;
  onReserve?: () => void;
} = {}) {
  const handoff: any = { id: 'handoff-1', companyId: 'company-1', status: 'SYSTEM_ISSUED', certificateId: 'cert-1', ...options.handoff };
  const certificates: any[] = [currentCertificate(options.certificate)];
  const period = { id: 'period-1', companyId: 'company-1', formType: 'PND53', periodKey: '2026-09', status: 'OPEN', ...options.period };
  const commits: any[] = [];
  const audits: any[] = [];
  const renders: any[] = [];
  const client: any = {
    whtCertificateHandoff: {
      findUnique: async ({ where }: any) => (where.id === handoff.id ? { ...handoff } : null),
      updateMany: async ({ where, data }: any) => {
        if (handoff.id === where.id && handoff.certificateId === where.certificateId) {
          Object.assign(handoff, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    whtCertificate: {
      findUnique: async ({ where }: any) => certificates.find((c) => c.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `cert-${certificates.length + 1}`, createdAt: new Date(), issuedAt: data.issuedAt, ...data };
        certificates.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const found = certificates.find((c) => c.id === where.id && c.supersededByCertificateId === (where.supersededByCertificateId ?? null));
        if (!found) return { count: 0 };
        Object.assign(found, data);
        return { count: 1 };
      },
    },
    companyTaxProfile: { findUnique: async () => null },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(client),
  };
  const taxRepo: any = {
    prisma: { client },
    upsertPeriod: async (input: any) => ({ ...period, ...input }),
    findPeriodById: async (_companyId: string, id: string) => (id === period.id ? period : null),
  };
  const reserveNumber: any = {
    execute: async (input: any) => {
      if (options.onReserve) {
        options.onReserve();
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      }
      return { id: 'docnum-2', documentNumber: 'WT2026090002', companyId: input.companyId, status: 'RESERVED' };
    },
  };
  const documentSequences: any = {
    commitNumberInTransaction: async (_tx: unknown, input: any) => { commits.push(input); return { ...input, status: 'COMMITTED' }; },
  };
  const audit: any = { log: async (entry: any) => { audits.push(entry); } };
  const renderer: any = {
    renderWhtCertificate: async (fields: any) => {
      renders.push(fields);
      return { mimeType: 'application/pdf', fileName: `wht-certificate-${fields.certificateNumber}`, contentBase64: '', checksum: 'sum', byteLength: 0 };
    },
  };
  return {
    handoff, certificates, commits, audits, renders, client,
    execute: (gate: LaunchGateGuardService) =>
      new CorrectWhtCertificateUseCase(taxRepo, reserveNumber, documentSequences, audit, gate, renderer, {} as any, {} as any),
  };
}

describe('CorrectWhtCertificateUseCase', () => {
  it('corrects a nonfinancial field (payee address) — new number, old certificate superseded', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'OPEN' }));
    const result: any = await useCase.execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'แก้ที่อยู่ผู้รับเงิน');

    assert.equal(result.certificateNumber, 'WT2026090002');
    assert.equal(result.status, 'ISSUED');
    assert.equal(result.payeeSnapshot.address, 'ที่อยู่ใหม่');
    // Unchanged fields carried over from the old certificate, not re-derived.
    assert.equal(result.incomeCategoryCode, 'CAT1');
    assert.equal(result.grossAmount, '1000.0000');

    const oldCert = h.certificates.find((c: any) => c.id === 'cert-1');
    assert.equal(oldCert.status, 'VOIDED');
    assert.equal(oldCert.voidReason, 'SUPERSEDED_BY_CORRECTION');
    assert.equal(oldCert.supersededByCertificateId, result.id);
    assert.equal(oldCert.correctionReason, 'แก้ที่อยู่ผู้รับเงิน');
    assert.equal(h.handoff.certificateId, result.id);
    assert.equal(h.handoff.status, 'SYSTEM_ISSUED', 'handoff status stays SYSTEM_ISSUED, only certificateId moves');
    assert.ok(h.audits.some((entry) => entry.action === 'tax.wht_certificate.correct' && entry.metadataJson.financial === false));
  });

  it('corrects a financial field (gross amount) when the tax period is still OPEN', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'OPEN' }));
    const result: any = await useCase.execute(ctx, 'handoff-1', { grossAmount: '2000.0000' }, 'แก้ยอดเงิน');
    assert.equal(result.grossAmount, '2000.0000');
    assert.ok(h.audits.some((entry) => entry.action === 'tax.wht_certificate.correct' && entry.metadataJson.financial === true));
  });

  it('blocks a financial correction once the tax period is FILED/PAID/CLOSED', async () => {
    for (const status of ['FILED', 'PAID', 'CLOSED']) {
      const h = harness({ period: { status } });
      const useCase = h.execute(guard({ state: 'OPEN' }));
      await assert.rejects(() => useCase.execute(ctx, 'handoff-1', { grossAmount: '2000.0000' }, 'แก้ยอดเงิน'),
        (err: any) => err.getResponse().code === 'wht_certificate_correction_tax_period_locked');
      assert.equal(h.certificates.length, 1, `no new certificate for period status ${status}`);
    }
  });

  it('does NOT block a nonfinancial correction even when the tax period is locked', async () => {
    const h = harness({ period: { status: 'FILED' } });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    const result: any = await useCase.execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'แก้ที่อยู่' } }, 'พิมพ์ผิด');
    assert.equal(result.payeeSnapshot.address, 'แก้ที่อยู่');
  });

  it('replays the winner instead of leaking a raw P2002 when two corrections race', async () => {
    const h = harness({
      onReserve: () => {
        h.handoff.certificateId = 'cert-winner';
        const winnerCert = currentCertificate({ id: 'cert-winner', certificateNumber: 'WT2026090002', supersedesCertificateId: 'cert-1' });
        h.certificates.push(winnerCert);
        const old = h.certificates.find((c: any) => c.id === 'cert-1');
        Object.assign(old, { status: 'VOIDED', supersededByCertificateId: 'cert-winner' });
      },
    });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    const result: any = await useCase.execute(ctx, 'handoff-1', { grossAmount: '2000.0000' }, 'แก้ยอดเงิน');
    assert.equal(result.id, 'cert-winner');
    assert.equal(result.certificateNumber, 'WT2026090002');
    assert.equal(h.certificates.length, 2, 'the loser never created a second row');
  });

  it('refuses a handoff whose status is not SYSTEM_ISSUED', async () => {
    const h = harness({ handoff: { status: 'EXTERNAL_LINKED' } });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1', {}, 'แก้ไข'),
      (err: any) => err.getResponse().code === 'wht_certificate_not_correctable');
    assert.equal(h.certificates.length, 1);
  });

  it('refuses to correct while the route-readiness gate is CLOSED', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'CLOSED' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1', { grossAmount: '2000' }, 'แก้ไข'),
      (err: any) => err.getResponse().code === 'wht_system_correction_unavailable');
    assert.equal(h.certificates.length, 1);
  });

  it('refuses to correct an already-superseded certificate (defense-in-depth)', async () => {
    const h = harness({ certificate: { supersededByCertificateId: 'cert-other' } });
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(() => useCase.execute(ctx, 'handoff-1', { grossAmount: '2000' }, 'แก้ไข'),
      (err: any) => err.getResponse().code === 'wht_certificate_already_superseded');
  });
});
