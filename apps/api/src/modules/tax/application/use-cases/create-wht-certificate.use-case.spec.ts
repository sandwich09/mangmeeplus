import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LaunchGateGuardService } from '../../../feature-launch/application/launch-gate.guard';
import {
  CreateWhtCertificateUseCase,
  WHT_EXTERNAL_FALLBACK,
  WHT_SYSTEM_ISSUANCE_UNAVAILABLE,
} from './create-wht-certificate.use-case';

const ctx = { companyId: 'company-1', userId: 'user-1', requestId: 'request-1' } as any;
const input = {
  taxPeriodId: 'period-1',
  taxEventIds: ['event-1'],
  incomeCategoryCode: '3',
  whtRate: '3.00',
  grossAmount: '1000.0000',
  withheldAmount: '30.0000',
  paymentDate: '2026-07-15',
  payeeSnapshot: { name: 'ผู้รับเงิน', taxId: '1234567890123' },
} as any;

/** Every write seam of the use case, plus every repository read, counted. */
function makeSpy() {
  const calls: string[] = [];
  const record = (name: string) => calls.push(name);
  const taxRepo = {
    findPeriodById: async () => (record('read:period'), { id: 'period-1', companyId: 'company-1', periodKey: '2026-07', formType: 'PND3' }),
    findEventsByPeriod: async () => (record('read:events'), [
      { id: 'event-1', eventType: 'WHT_PND3', grossAmount: '1000.0000', withheldAmount: '30.0000', taxAmount: '30.0000' },
    ]),
    prisma: { client: {
      company: { findUnique: async () => (record('read:company'), { id: 'company-1', name: 'บริษัท', taxId: '9999999999999', addressJson: null }) },
      companyTaxProfile: { findUnique: async () => (record('read:profile'), null) },
      whtIncomeCategory: { findUnique: async () => (record('read:category'), { code: '3', nameTh: 'ค่าบริการ' }) },
      whtCertificate: { create: async ({ data }: any) => (record('write:certificate'), {
        ...data, id: 'cert-1', createdAt: new Date(), paymentDate: new Date(data.paymentDate), issuedAt: new Date(),
      }) },
    } },
  } as any;
  const reserveNumber = { execute: async () => (record('write:reserve-number'), { id: 'reservation-1', documentNumber: 'WHT-2026-0001' }) } as any;
  const commitNumber = { execute: async () => { record('write:commit-number'); } } as any;
  const audit = { log: async () => { record('write:audit'); } } as any;
  return { calls, taxRepo, reserveNumber, commitNumber, audit };
}

/**
 * The real guard over a stubbed gate table — the closed-route behaviour must be the real one.
 * The admitting transition is stubbed present so this spec pins the TAX seam, not the guard's own
 * build/environment binding (`launch-gate.guard.spec.ts` owns that).
 */
function guard(row: { state: 'OPEN' | 'CLOSED' } | null) {
  return new LaunchGateGuardService({ client: {
    featureLaunchGate: { findUnique: async ({ where }: any) => {
      assert.deepEqual(where.gateKey_routeKey, { gateKey: 'cap.wht50bis', routeKey: 'SYSTEM_INITIAL_ISSUE' });
      return row && { ...row, generation: 1 };
    } },
    // The authority rule reads every marker of this (route, generation, environment, build) and
    // takes the newest; one OPEN is the "this build is attested" shape.
    featureLaunchGateTransition: { findMany: async ({ where }: any) => [{ ...where, action: 'OPEN', seq: 1 }] },
  } } as any);
}

/**
 * The writes a CLOSED route must never perform. Asserted by name rather than with a blanket
 * "nothing was written": H4 lets the closed path write its handoff, and a blanket check would have
 * had to be deleted — taking the real protection with it.
 */
const CERTIFICATE_WRITES = ['write:reserve-number', 'render:pdf', 'write:certificate', 'write:commit-number'];

/** Injectable seam so "the closed route rendered no statutory PDF" is observable, not assumed. */
function makeRenderer(calls: string[]) {
  return { render: (...args: any[]) => { calls.push('render:pdf'); return { mimeType: 'application/pdf', fileName: String(args[1]), contentBase64: '', checksum: 'sum', byteLength: 0 }; } } as any;
}

function makeHandoffs() {
  const created: any[] = [];
  return {
    created,
    value: {
      createOrReplay: async (input: any) => {
        created.push(input);
        const first = created.filter((c) => c.creationCommandId === input.creationCommandId).length === 1;
        return { id: `handoff-${input.creationCommandId}`, status: 'REQUIRED', replayed: !first };
      },
    } as any,
  };
}

function useCase(gate: LaunchGateGuardService, spy = makeSpy(), handoffs = makeHandoffs()) {
  return {
    spy,
    handoffs,
    value: new CreateWhtCertificateUseCase(spy.taxRepo, spy.reserveNumber, spy.commitNumber, spy.audit, gate, handoffs.value, makeRenderer(spy.calls)),
  };
}

describe('CreateWhtCertificateUseCase — cap.wht50bis/SYSTEM_INITIAL_ISSUE fence (F1.5.2)', () => {
  it('CLOSED route: writes the durable handoff, no certificate state, and returns the fallback', async () => {
    const { spy, handoffs, value } = useCase(guard({ state: 'CLOSED' }));
    await assert.rejects(() => value.execute(ctx, input), (err: any) => {
      const body = err.getResponse();
      assert.equal(err.getStatus(), 409);
      assert.equal(body.code, WHT_SYSTEM_ISSUANCE_UNAVAILABLE);
      assert.equal(body.fallback, WHT_EXTERNAL_FALLBACK);
      assert.match(body.message, /ระบบยังไม่เปิดการออกหนังสือรับรองอัตโนมัติ/);
      assert.match(body.message, /ออกเอกสารภายนอกแล้วแนบกลับได้/);
      // The message promises "บันทึกข้อมูลไว้แล้ว" — the handoff id is what makes that true.
      assert.equal(body.handoffId, 'handoff-tax.wht_certificate:period-1:event-1');
      assert.equal(body.handoffStatus, 'REQUIRED');
      return true;
    });
    // No number reserved, no PDF rendered, no certificate row — the launch gate is still authority
    // over whether a SYSTEM certificate may exist.
    for (const write of CERTIFICATE_WRITES) assert.ok(!spy.calls.includes(write), `closed route must not ${write}`);
    assert.equal(handoffs.created.length, 1);
  });

  it('CLOSED route: the handoff carries the stored facts so nothing is re-keyed', async () => {
    const { handoffs, value } = useCase(guard({ state: 'CLOSED' }));
    await assert.rejects(() => value.execute(ctx, input));
    const { prefill, taxPeriodId, taxEventIds } = handoffs.created[0];
    assert.equal(prefill.payeeSnapshot.name, 'ผู้รับเงิน');
    assert.equal(prefill.payerSnapshot.companyName, 'บริษัท');
    assert.equal(prefill.grossAmount, '1000.0000');
    assert.equal(prefill.withheldAmount, '30.0000');
    assert.equal(prefill.whtRate, '3.00');
    assert.equal(prefill.incomeCategoryName, 'ค่าบริการ');
    assert.equal(taxPeriodId, 'period-1');
    assert.deepEqual(taxEventIds, ['event-1']);
  });

  it('CLOSED route: a retry replays one handoff instead of creating a second', async () => {
    const handoffs = makeHandoffs();
    const first = useCase(guard({ state: 'CLOSED' }), makeSpy(), handoffs);
    const second = useCase(guard({ state: 'CLOSED' }), makeSpy(), handoffs);
    await assert.rejects(() => first.value.execute(ctx, input));
    await assert.rejects(() => second.value.execute(ctx, input));
    assert.equal(handoffs.created.length, 2, 'both attempts reach the handoff seam');
    assert.equal(handoffs.created[0].creationCommandId, handoffs.created[1].creationCommandId,
      'the same payment/period facts must resolve to one command id, so the store replays');
  });

  it('CLOSED route: invalid facts create no handoff at all', async () => {
    const { handoffs, value } = useCase(guard({ state: 'CLOSED' }));
    // Withheld amount contradicts the underlying events: not a qualifying certificate, so there is
    // nothing to hand off (spec:204).
    await assert.rejects(() => value.execute(ctx, { ...input, withheldAmount: '999.0000' }), /withheld/i);
    assert.equal(handoffs.created.length, 0);
  });

  it('fails closed when the gate row is missing entirely', async () => {
    const { spy, handoffs, value } = useCase(guard(null));
    await assert.rejects(() => value.execute(ctx, input), (err: any) => err.getResponse().code === WHT_SYSTEM_ISSUANCE_UNAVAILABLE);
    for (const write of CERTIFICATE_WRITES) assert.ok(!spy.calls.includes(write), `missing gate row must not ${write}`);
    assert.equal(handoffs.created.length, 1);
  });

  it('does not disguise a guard read failure as the external fallback', async () => {
    const broken = new LaunchGateGuardService({ client: {
      featureLaunchGate: { findUnique: async () => { throw new Error('connection terminated'); } },
    } } as any);
    const { spy, handoffs, value } = useCase(broken);
    await assert.rejects(() => value.execute(ctx, input), /connection terminated/);
    assert.deepEqual(spy.calls, []);
    // "We could not tell" is not "the route is closed": an unreadable guard must not manufacture
    // a handoff either.
    assert.equal(handoffs.created.length, 0);
  });

  it('OPEN route: issuance proceeds unchanged and reserves the number before the PDF', async () => {
    const { spy, handoffs, value } = useCase(guard({ state: 'OPEN' }));
    const issued = await value.execute(ctx, input);
    assert.equal(issued.certificateNumber, 'WHT-2026-0001');
    assert.equal(issued.status, 'ISSUED');
    assert.equal(issued.pdfArtifact.mimeType, 'application/pdf');
    assert.ok(spy.calls.includes('render:pdf'), 'the open route DOES render the statutory PDF');
    assert.ok(spy.calls.indexOf('write:reserve-number') < spy.calls.indexOf('render:pdf'), 'number is reserved before the PDF is rendered');
    assert.ok(spy.calls.includes('write:reserve-number'));
    assert.ok(spy.calls.includes('write:certificate'));
    assert.ok(spy.calls.includes('write:commit-number'));
    assert.ok(spy.calls.includes('write:audit'));
    // The system issued the certificate itself — there is nothing to hand off.
    assert.equal(handoffs.created.length, 0);
  });
});
