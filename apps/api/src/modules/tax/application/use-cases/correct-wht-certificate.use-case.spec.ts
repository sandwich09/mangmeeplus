import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import { CorrectWhtCertificateUseCase } from './correct-wht-certificate.use-case';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { CorrectWhtCertificateDto } from '../../presentation/http/tax.dtos';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';

const ctx = { companyId: 'company-1', userId: 'user-1', requestId: 'request-1', permissions: ['expense.read'], scopes: {} } as any;

function currentCertificate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert-1', companyId: 'company-1', certificateNumber: 'WT2026090001', status: 'ISSUED',
    taxPeriodId: 'period-1', periodKey: '2026-09',
    payerSnapshotJson: { companyName: 'บริษัท ผู้จ่าย จำกัด', taxId: '9999999999999', branchCode: '00002', address: 'ที่อยู่กิจการ' },
    payeeSnapshotJson: { name: 'บริษัท ผู้รับเงิน จำกัด', taxId: '1111111111111', address: 'ที่อยู่ผู้รับเงิน', branchCode: null },
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
  filedPayment?: boolean;
  legacyFiled?: boolean;
  onReserve?: () => void;
} = {}) {
  const handoff: any = { id: 'handoff-1', companyId: 'company-1', status: 'SYSTEM_ISSUED', certificateId: 'cert-1', ...options.handoff };
  const certificates: any[] = [currentCertificate(options.certificate)];
  const period = { id: 'period-1', companyId: 'company-1', formType: 'PND53', periodKey: '2026-09', status: 'OPEN', ...options.period };
  const history: any[] = [];
  const expense = { status: 'CONFIRMED' };
  const commits: any[] = [];
  const audits: any[] = [];
  const renders: any[] = [];
  const reservations: any[] = [], cancellations: any[] = [];
  const periodWrites: any[] = [];
  const client: any = {
    taxPeriod: { findMany: async ({ where }: any) => options.filedPayment ? [period] : options.legacyFiled && !where.whtFilings ? [{ ...period, whtFilings: [] }] : [] },
    $executeRaw: async () => 0,
    expenseRecord: { findFirst: async () => ({ ...expense }), updateMany: async ({ where }: any) => ({ count: expense.status === where.status ? 1 : 0 }) },
    whtCertificateHistory: { create: async () => { throw new Error('history must use the transaction client'); } },
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
        const row = { id: `cert-${certificates.length + 1}`, createdAt: new Date(), issuedAt: data.issuedAt, supersededByCertificateId: null, ...data };
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
    company: { findUnique: async () => ({ registeredName: 'บริษัท ผู้จ่าย จำกัด' }) },
    companyTaxProfile: { findUnique: async () => null },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      ...client, whtCertificateHistory: { create: async ({ data }: any) => { history.push(data); return data; } },
    }),
  };
  const taxRepo: any = {
    prisma: { client },
    upsertPeriod: async (input: any) => { periodWrites.push(input); return { ...period, ...input }; },
    findPeriodById: async (_companyId: string, id: string) => (id === period.id ? period : null),
  };
  const reserveNumber: any = {
    execute: async (input: any) => {
      if (options.onReserve) {
        options.onReserve();
        throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      }
      const number = reservations.length + 2;
      const row = { ...input, id: `docnum-${number}`, documentNumber: `WT202609000${number}`, status: 'RESERVED' };
      reservations.push(row); return row;
    },
  };
  const documentSequences: any = {
    commitNumberInTransaction: async (_tx: unknown, input: any) => { commits.push(input); return { ...input, status: 'COMMITTED' }; },
    cancelReservation: async (input: any) => { cancellations.push(input); return { ...input, status: 'CANCELLED' }; },
  };
  const audit: any = { log: async (entry: any) => { audits.push(entry); } };
  const renderer: any = {
    renderWhtCertificate: async (fields: any) => {
      renders.push(fields);
      return { mimeType: 'application/pdf', fileName: `wht-certificate-${fields.certificateNumber}`, contentBase64: '', checksum: 'sum', byteLength: 0 };
    },
  };
  return {
    handoff, expense, certificates, history, commits, audits, renders, client, renderer, documentSequences, reservations, cancellations, periodWrites,
    execute: (gate: LaunchGateGuardService) =>
      new CorrectWhtCertificateUseCase(taxRepo, reserveNumber, documentSequences, audit, gate, renderer, {} as any, {} as any),
  };
}

describe('CorrectWhtCertificateUseCase', () => {
  for (const [field, corrected] of Object.entries({ grossAmount: { grossAmount: '2000' }, withheldAmount: { withheldAmount: '100' }, whtRate: { whtRate: '10' },
    formType: { formType: 'PND3' }, incomeCategoryCode: { incomeCategoryCode: 'CAT2' }, incomeCategoryName: { incomeCategoryName: 'ค่าบริการ' },
    payeeTaxId: { payeeSnapshot: { taxId: '2222222222222' } } })) {
    it(`refuses changing locked ${field} before every write`, async () => {
      const h = harness();
      await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', corrected as any, 'แก้ข้อมูล'), (error: any) => {
        assert.equal(error.getStatus(), 409); assert.equal(error.getResponse().code, 'wht_correction_field_locked');
        assert.equal(error.getResponse().message, 'แก้ยอด อัตรา รายการที่จ่าย หรือเลขผู้เสียภาษีที่รายจ่ายด้วย “แก้ไขเอกสาร”'); return true;
      });
      assert.equal(h.periodWrites.length + h.reservations.length + h.history.length + h.commits.length + h.audits.length + h.renders.length, 0);
      assert.equal(h.certificates.length, 1); assert.equal(h.certificates[0].status, 'ISSUED'); assert.equal(h.handoff.certificateId, 'cert-1');
    });
  }
  it('accepts a legacy whole form with equal decimals, rate and tax digits and changed allowed fields', async () => {
    const h = harness(); const old = h.certificates[0];
    const result = await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { formType: 'PND53', incomeCategoryCode: 'CAT1', incomeCategoryName: 'ค่าเช่า',
      grossAmount: '1000', withheldAmount: '50', whtRate: '5.0000', paymentDate: '2026-09-13',
      payeeSnapshot: { taxId: '1-1111-11111-11-1', name: 'ชื่อใหม่', address: 'ที่อยู่ใหม่', branchCode: '00002' } }, 'แก้ชื่อ ที่อยู่ สาขาและวันที่');
    assert.deepEqual(result.payeeSnapshot, { ...old.payeeSnapshotJson, name: 'ชื่อใหม่', address: 'ที่อยู่ใหม่', branchCode: '00002' });
    assert.equal(result.paymentDate.slice(0, 10), '2026-09-13'); assert.equal(result.grossAmount, old.grossAmount); assert.equal(result.withheldAmount, old.withheldAmount); assert.equal(result.whtRate, old.whtRate);
    assert.equal(h.reservations.length, 1);
  });
  it('equivalent tax digits alone are still a no-change refusal', async () => {
    const h = harness();
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { taxId: '1-1111-11111-11-1' } }, 'ตรวจเลข'),
      (error: any) => error.getResponse().code === 'wht_certificate_correction_no_changes');
    assert.equal(h.periodWrites.length + h.reservations.length + h.history.length, 0);
  });
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
  const body = (corrected: unknown) => pipe.transform({ corrected, reason: 'พิมพ์ผิด' }, { type: 'body', metatype: CorrectWhtCertificateDto });
  it('refuses the same partial real DTO sent twice without reserving another number or adding history or audits (A7c)', async () => {
    const h = harness(); const uc = h.execute(guard({ state: 'OPEN' }));
    const request = { payeeSnapshot: { name: 'ชื่อที่แก้ไข' } };
    const first = await body(request);
    const certificate = await uc.execute(ctx, 'handoff-1', first.corrected, first.reason);
    const historyCount = h.history.length; const auditCount = h.audits.length;
    const second = await body(request);
    await assert.rejects(uc.execute(ctx, 'handoff-1', second.corrected, second.reason), (error: any) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(error.getStatus(), 409);
      const response = error.getResponse() as { code: string; message: string };
      assert.equal(response.code, 'wht_certificate_correction_no_changes');
      assert.equal(response.message, 'ข้อมูลตรงกับหนังสือรับรองใบปัจจุบันอยู่แล้ว จึงไม่มีอะไรต้องแก้ไข ถ้าเพิ่งกดแก้ไขไป การแก้ไขครั้งนั้นอาจบันทึกแล้ว เปิดหน้านี้ใหม่'); return true;
    });
    assert.equal(h.reservations.length, 1); assert.equal(h.certificates.length, 2);
    assert.equal(h.handoff.certificateId, certificate.id);
    assert.equal(h.history.length, historyCount); assert.equal(h.audits.length, auditCount);
  });
  it('refuses identical values with equivalent decimals and lowercase timestamp z before the period lock (A7c)', async () => {
    const h = harness({ filedPayment: true, period: { status: 'FILED' }, certificate: { paymentDate: new Date('2026-09-12T10:25:00.000Z') } });
    const current = h.certificates[0];
    const input = await body({ formType: 'PND53', incomeCategoryCode: current.incomeCategoryCode, incomeCategoryName: current.incomeCategoryName,
      whtRate: '5.0000', grossAmount: '1000', withheldAmount: '50', paymentDate: '2026-09-12T00:00:00.000z',
      payerSnapshot: current.payerSnapshotJson, payeeSnapshot: current.payeeSnapshotJson });
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', input.corrected, input.reason),
      (error: any) => error.getStatus?.() === 409 && error.getResponse().code === 'wht_certificate_correction_no_changes');
    assert.equal(h.reservations.length, 0); assert.equal(h.history.length, 0); assert.equal(h.audits.length, 0);
  });
  it('still corrects one address field through the real DTO (A7c)', async () => {
    const h = harness(); const input = await body({ payerSnapshot: { address: 'ที่อยู่ผู้จ่ายที่แก้ไข' } });
    const result = await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', input.corrected, input.reason);
    assert.equal(result.payerSnapshot.address, 'ที่อยู่ผู้จ่ายที่แก้ไข');
    assert.deepEqual(result.payeeSnapshot, h.certificates[0].payeeSnapshotJson);
    assert.equal(h.reservations.length, 1);
  });
  it('preserves omitted payer, payee and top-level fields through two real validated partial DTOs', async () => {
    const h = harness({ certificate: {
      payeeSnapshotJson: { name: 'ผู้รับเงินเดิม', taxId: '1111111111111', address: 'ที่อยู่เดิม', branchCode: '00003' },
    } });
    const original = structuredClone(h.certificates[0]);
    const uc = h.execute(guard({ state: 'OPEN' }));
    const name = await body({ payeeSnapshot: { name: 'ชื่อที่แก้ไข' }, payerSnapshot: { companyName: 'ผู้จ่ายที่แก้ไข' } });
    assert.ok(Object.hasOwn(name.corrected.payeeSnapshot, 'taxId'), 'the real DTO emits omitted properties');
    const second = await uc.execute(ctx, 'handoff-1', name.corrected, name.reason);
    assert.deepEqual(second.payeeSnapshot, { ...original.payeeSnapshotJson, name: 'ชื่อที่แก้ไข' });
    assert.deepEqual(second.payerSnapshot, { ...original.payerSnapshotJson, companyName: 'บริษัท ผู้จ่าย จำกัด' });
    const address = await body({ payeeSnapshot: { address: 'ที่อยู่ที่แก้ไข' }, payerSnapshot: { address: 'ที่อยู่ผู้จ่าย' } });
    const third = await uc.execute(ctx, 'handoff-1', address.corrected, address.reason);
    assert.deepEqual(third.payeeSnapshot, { ...original.payeeSnapshotJson, name: 'ชื่อที่แก้ไข', address: 'ที่อยู่ที่แก้ไข' });
    assert.deepEqual(third.payerSnapshot, { ...original.payerSnapshotJson, companyName: 'บริษัท ผู้จ่าย จำกัด', address: 'ที่อยู่ผู้จ่าย' });
    for (const key of ['incomeCategoryCode', 'incomeCategoryName', 'whtRate', 'grossAmount', 'withheldAmount']) assert.equal((third as any)[key], original[key]);
    assert.equal(third.paymentDate, original.paymentDate.toISOString());
    assert.deepEqual(h.reservations.map(row => row.documentNumber), ['WT2026090002', 'WT2026090003']);
  });
  for (const name of ['', '   ', null]) it(`refuses an empty merged payee name before reserving (${JSON.stringify(name)})`, async () => {
    const h = harness(); const input = await body({ payeeSnapshot: { name } });
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', input.corrected, input.reason), (error: any) => {
      assert.ok(error instanceof BadRequestException);
      const response = error.getResponse() as { code: string; message: string };
      assert.equal(response.code, 'wht_certificate_payee_name_required');
      assert.equal(response.message, 'ชื่อผู้รับเงินบนหนังสือรับรองว่างไม่ได้ ใส่ชื่อผู้รับเงิน'); return true;
    });
    assert.equal(h.reservations.length, 0); assert.equal(h.certificates.length, 1);
  });
  for (const step of ['rendering', 'transaction']) it(`releases its reservation when ${step} fails and retries with a new reservation key`, async () => {
    const h = harness(); const uc = h.execute(guard({ state: 'OPEN' }));
    const failure = new Error(`${step} unavailable`);
    const target = step === 'rendering' ? h.renderer : h.client;
    const method = step === 'rendering' ? 'renderWhtCertificate' : '$transaction'; const original = target[method];
    target[method] = async () => { throw failure; };
    await assert.rejects(uc.execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'พิมพ์ผิด'), error => error === failure);
    assert.deepEqual(h.cancellations, [{ id: 'docnum-2', companyId: ctx.companyId }]);
    assert.equal(h.certificates.length, 1); assert.equal(h.certificates[0].status, 'ISSUED');
    target[method] = original;
    await uc.execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'พิมพ์ผิด');
    assert.notEqual(h.reservations[0].idempotencyKey, h.reservations[1].idempotencyKey);
    assert.ok(h.audits.some(entry => entry.action === 'document.number.cancel'));
  });
  it('keeps the rendering error when reservation cleanup also fails', async () => {
    const h = harness(); const failure = new Error('render unavailable');
    h.renderer.renderWhtCertificate = async () => { throw failure; };
    let cleanupAttempts = 0;
    h.documentSequences.cancelReservation = async () => { cleanupAttempts++; throw new Error('cancel unavailable'); };
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'พิมพ์ผิด'), error => error === failure);
    assert.equal(cleanupAttempts, 1);
  });
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

  it('refuses a locked amount even when the tax period is still OPEN', async () => {
    const h = harness();
    const useCase = h.execute(guard({ state: 'OPEN' }));
    await assert.rejects(useCase.execute(ctx, 'handoff-1', { grossAmount: '2000.0000' }, 'แก้ยอดเงิน'), (error: any) => error.getResponse().code === 'wht_correction_field_locked');
    assert.equal(h.periodWrites.length + h.reservations.length + h.history.length, 0);
  });

  it('filed amount, rate, income type and taxpayer number corrections direct the person to cancel and re-record', async () => {
    for (const change of [{ grossAmount: '2000' }, { whtRate: '10' }, { incomeCategoryCode: 'OTHER' }, { payeeSnapshot: { taxId: '9999999999999' } }]) {
      const h = harness({ filedPayment: true, period: { status: 'EXPORTED' } });
      await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', change, 'ข้อมูลผิด'), (e: any) => {
        assert.equal(e.getResponse().code, 'wht_certificate_correction_tax_period_locked');
        assert.equal(e.getResponse().message, 'รายการนี้ยื่นภาษีแล้ว แก้ข้อเท็จจริงไม่ได้ ให้ยกเลิกเอกสารแล้วบันทึกใหม่ ให้ผู้ทำบัญชีแจ้งกรมสรรพากรเรื่องแบบเดิม');
        return true;
      });
      assert.equal(h.certificates.length, 1);
    }
  });
  it('blocks a payment-date correction when the source has a filed line, regardless of roll-up status', async () => {
    for (const status of ['EXPORTED', 'FILED', 'PAID', 'CLOSED']) {
      const h = harness({ filedPayment: true, period: { status } });
      const useCase = h.execute(guard({ state: 'OPEN' }));
      await assert.rejects(() => useCase.execute(ctx, 'handoff-1', { paymentDate: '2026-09-13' }, 'แก้วันที่'),
        (err: any) => err.getResponse().code === 'wht_certificate_correction_tax_period_locked');
      assert.equal(h.certificates.length, 1, `no new certificate for period status ${status}`);
    }
  });

  it('legacy filed month locks the certificate date until its paper is backfilled', async () => {
    for (const formType of ['PND3', 'PND53']) {
      const h = harness({ legacyFiled: true, period: { status: 'FILED', formType } });
      await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { paymentDate: '2026-09-13' }, 'แก้วันที่'),
        (e: any) => e.getResponse().code === 'wht_certificate_correction_tax_period_locked');
      assert.equal(h.certificates.length, 1);
    }
  });

  it('does NOT block a nonfinancial correction even when the tax period is locked', async () => {
    const h = harness({ filedPayment: true, period: { status: 'FILED' } });
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
    const result: any = await useCase.execute(ctx, 'handoff-1', { payeeSnapshot: { name: 'ชื่อใหม่' } }, 'แก้ชื่อ');
    assert.equal(h.history.length, 0, 'recovery must not append either correction event again');
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


describe('certificate history on correction', () => {
  it('appends CORRECTED for the old paper and ISSUED for the replacement with their own dates', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
    const result = await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'แก้ที่อยู่');
    assert.equal(h.history.length, 2);
    assert.deepEqual(h.history[0], {
      companyId: ctx.companyId, expenseId: 'exp-1', handoffId: 'handoff-1', eventType: 'CORRECTED',
      certificateId: 'cert-1', certificateNumber: 'WT2026090001', isExternal: false,
      certificateDate: h.certificates[0].issuedAt, relatedCertificateId: result.id,
      relatedCertificateNumber: result.certificateNumber, reason: 'แก้ที่อยู่', actorUserId: ctx.userId,
    });
    assert.equal(h.history[1].eventType, 'ISSUED');
    assert.equal(h.history[1].certificateId, result.id);
    assert.equal(h.history[1].certificateDate, h.certificates[1].issuedAt);
    assert.equal(h.history[1].relatedCertificateId, 'cert-1');
    assert.equal(h.history[1].relatedCertificateNumber, 'WT2026090001');
  });
});


describe('A2 correction cannot issue over an expense reopen', () => {
  it('refuses when the expense reopened while the corrected paper was rendering', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1' } });
    const transact = h.client.$transaction;
    h.client.$transaction = async (work: any) => { h.expense.status = 'NEEDS_REVIEW'; return transact(work); };
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'แก้ที่อยู่'),
      (error: any) => error.getResponse?.().code === 'expense_wht_source_changed');
    assert.equal(h.certificates.length, 1); assert.equal(h.history.length, 0);
  });
});


describe('correct-wht-certificate source guards (A3)', () => {
  for (const status of ['NEEDS_REVIEW', 'VOIDED']) it(`refuses an expense source in ${status} without writing`, async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    h.expense.status = status;
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ใหม่' } }, 'แก้ชื่อผู้รับ'), (error: any) => error.getResponse?.().code === 'expense_wht_source_changed' && error.getResponse().message === 'รายจ่ายของหนังสือรับรองนี้ถูกแก้ไขหรือยกเลิกไปแล้ว เปิดหน้ารายจ่ายใหม่');
    assert.equal(h.certificates.length, 1); assert.equal(h.certificates[0].replacementCopyCount, 0);
  });
  it('preserves the expense revision and last editor when issuing a certificate artifact', async () => {
    const h = harness({ handoff: { sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    h.client.expenseRecord.updateMany = async () => { throw new Error('certificate command must not edit the expense'); };
    await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ใหม่' } }, 'แก้ชื่อผู้รับ');
  });
  it('refuses a VOIDED certificate without a successor inside the transaction', async () => {
    const h = harness();
    const transact = h.client.$transaction;
    h.client.$transaction = async (work: any) => { h.certificates[0].status = 'VOIDED'; return transact(work); };
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { address: 'ใหม่' } }, 'แก้ชื่อผู้รับ'), (error: any) => error.getResponse?.().message === 'รายจ่ายของหนังสือรับรองนี้ถูกแก้ไขหรือยกเลิกไปแล้ว เปิดหน้ารายจ่ายใหม่');
    assert.equal(h.certificates.length, 1); assert.equal(h.certificates[0].replacementCopyCount, 0);
  });
});


describe('decimal financial correction classification (E2)', () => {
  it('treats the same civil payment day as nonfinancial despite a stored time part', async () => {
    const h = harness({ filedPayment: true, period: { status: 'FILED' }, certificate: { paymentDate: new Date('2026-09-12T10:25:00.000Z') } });
    await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { paymentDate: '2026-09-12T00:00:00.000Z', payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'แก้ที่อยู่');
    assert.equal(h.audits.find(row => row.action === 'tax.wht_certificate.correct').metadataJson.financial, false);
  });
  it('still refuses a different civil payment day in a filed period', async () => {
    const h = harness({ filedPayment: true, period: { status: 'FILED' }, certificate: { paymentDate: new Date('2026-09-12T10:25:00.000Z') } });
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { paymentDate: '2026-09-13T00:00:00.000Z' }, 'แก้วันที่'), (error: any) => error.getResponse().code === 'wht_certificate_correction_tax_period_locked');
    assert.equal(h.certificates.length, 1);
  });
  it('treats equivalent decimal strings as nonfinancial in a filed period', async () => {
    const h = harness({ filedPayment: true, period: { status: 'FILED' }, certificate: { grossAmount: '1402.0000', withheldAmount: '42.0600', whtRate: '3.0000' } });
    await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { grossAmount: '1402', withheldAmount: '42.06', whtRate: '3', payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'แก้ที่อยู่');
    assert.equal(h.audits.find(row => row.action === 'tax.wht_certificate.correct').metadataJson.financial, false);
  });
  it('still refuses a real amount change in a filed period', async () => {
    const h = harness({ filedPayment: true, period: { status: 'FILED' }, certificate: { grossAmount: '1402.0000' } });
    await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { grossAmount: '1402.01' }, 'แก้ยอด'), (error: any) => error.getResponse().code === 'wht_certificate_correction_tax_period_locked');
    assert.equal(h.certificates.length, 1);
  });
});


describe('C1 handoff scope boundary', () => {
  it('execute hides branch and unreadable expense ids exactly like a missing handoff', async () => {
    const h = harness({ handoff: { sourceBranchId: 'branch-2', sourcePaymentType: 'expense.record', sourcePaymentId: 'expense-1' } });
    h.client.expenseRecord.findFirst = async ({ where }: any) => JSON.stringify(where).includes('createdByUserId') || JSON.stringify(where).includes('\"in\":[]') ? null : { status: 'CONFIRMED' };
    const useCase = h.execute(guard({ state: 'OPEN' }));

    const call = (actor: any, id: string) => useCase.execute(actor, id, { payeeSnapshot: { address: 'ที่อยู่ใหม่' } }, 'แก้ที่อยู่');
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

it('A9 refuses a duplicate corrected certificate number with a coded Thai answer', async () => {
  const h = harness();
  h.client.whtCertificate.create = async () => { throw Object.assign(new Error('duplicate'), { code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { fields: ['companyId', 'certificateNumber'] } } } } }); };
  await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, h.handoff.id, { payeeSnapshot: { address: 'ใหม่' } }, 'แก้ที่อยู่'), (error: any) => {
    assert.equal(error.getResponse().code, 'wht_certificate_number_duplicate');
    assert.equal(error.getResponse().message, 'ออกหนังสือรับรองไม่สำเร็จเพราะเลขที่เอกสารซ้ำ ลองอีกครั้ง ถ้ายังไม่สำเร็จ ให้แจ้งทีมงานมั่งมีพร้อมเลขที่เอกสารรายจ่ายนี้'); return true;
  });
  assert.equal(h.cancellations.length, 1); assert.equal(h.history.length, 0);
});


describe('C7 corrected certificate address', () => {
  it('refuses clearing an address and refuses changing a legacy blank certificate without filling its address', async () => {
    for (const legacy of [false, true]) for (const address of [null, '', '  ']) {
      const h = harness(); if (legacy) h.certificates[0].payeeSnapshotJson.address = null;
      const corrected = legacy ? { payeeSnapshot: { name: 'ชื่อใหม่' } } : { payeeSnapshot: { address } };
      await assert.rejects(h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', corrected, 'แก้ข้อมูล'), (error: any) => {
        assert.equal(error.getResponse().code, 'wht_certificate_payee_address_required');
        assert.equal(error.getResponse().message, 'ยังไม่มีที่อยู่ผู้รับเงิน พิมพ์ที่อยู่ในแบบฟอร์มนี้ก่อนบันทึก'); return true;
      });
      assert.equal(h.reservations.length, 0); assert.equal(h.history.length, 0); assert.equal(h.certificates.length, 1); assert.equal(h.renders.length, 0); assert.equal(h.audits.length, 0);
    }
  });
  it('corrects a legacy blank certificate together with its address', async () => {
    const h = harness(); h.certificates[0].payeeSnapshotJson.address = null;
    const result = await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { name: 'ชื่อใหม่', address: 'ที่อยู่ใหม่' } }, 'เติมที่อยู่และแก้ชื่อ');
    assert.equal(result.payeeSnapshot.address, 'ที่อยู่ใหม่'); assert.equal(result.payeeSnapshot.name, 'ชื่อใหม่');
  });
});


test('C9 correction cannot end with missing payer identity, but can fill a legacy blank from the company', async () => {
  const h = harness(); h.certificates[0].payerSnapshotJson.taxId = null as any; h.certificates[0].payerSnapshotJson.address = null as any;
  const uc = h.execute(guard({ state: 'OPEN' }));
  await assert.rejects(uc.execute(ctx, 'handoff-1', { payeeSnapshot: { name: 'ชื่อใหม่' } }, 'แก้ชื่อ'), (error: any) => error.getStatus() === 409 && error.getResponse().code === 'wht_payer_identity_missing');
  assert.equal(h.reservations.length, 0); assert.equal(h.history.length, 0); assert.equal(h.certificates.length, 1);
  h.client.company.findUnique = async () => ({ registeredName: 'บริษัท ผู้จ่าย จำกัด', taxId: '1234567890123', addressJson: { line1: 'ที่อยู่ปัจจุบัน' } });
  const result = await uc.execute(ctx, 'handoff-1', { payeeSnapshot: { name: 'ชื่อใหม่' } }, 'แก้ชื่อ');
  assert.equal(result.payerSnapshot.taxId, '1234567890123'); assert.equal(result.payerSnapshot.address, 'ที่อยู่ปัจจุบัน');
});

it('W6 corrections keep the first issue date and record the correction separately', async () => {
  const h = harness();
  const original = h.certificates[0].issuedAt.toISOString();
  await h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { name: 'แก้ชื่อ' } } as any, 'แก้ชื่อผู้รับเงิน');
  assert.equal(h.certificates[1].issuedAt.toISOString(), original);
  assert.equal(h.renders[0].issuedAt, original);
  assert.ok(h.certificates[0].voidedAt.getTime() > new Date(original).getTime());
});

it('correction requires the current registered name and leaves the issued certificate unchanged on refusal', async () => {
  const h = harness(); const original = structuredClone(h.certificates[0]);
  h.client.company.findUnique = async () => ({ registeredName: null });
  await assert.rejects(() => h.execute(guard({ state: 'OPEN' })).execute(ctx, 'handoff-1', { payeeSnapshot: { name: 'ชื่อใหม่' } }, 'แก้ชื่อ'), (error: any) => error.getResponse().code === 'wht_payer_identity_missing' && error.getResponse().payerMissing.includes('REGISTERED_NAME'));
  assert.deepEqual(h.certificates, [original]); assert.equal(h.reservations.length, 0);
});
