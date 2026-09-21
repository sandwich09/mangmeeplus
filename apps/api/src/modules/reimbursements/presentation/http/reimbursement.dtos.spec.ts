import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  CreateReimbursementRequestDto, LinkReimbursementSignedCopyDto, RecordReimbursementPaymentDto, UpdateReimbursementDraftDto,
} from './reimbursement.dtos';

// The exact global-pipe configuration main.ts registers: this is the runtime gate
// that stops a client from posting its own claim total (lane C rollup rule) and
// the first runtime validation these endpoints have ever had.
const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const validLine = {
  lineNo: 1,
  incurredDate: '2026-01-05',
  description: 'แท็กซี่ไปหาลูกค้า',
  categoryKey: 'travel',
  amount: '120.50',
};
const validCreate = { reason: 'ไปพบลูกค้า', currency: 'THB', lines: [validLine] };

async function rejects(metatype: any, body: Record<string, unknown>) {
  await assert.rejects(
    () => pipe.transform(body, { type: 'body', metatype }),
    BadRequestException,
    `expected rejection for ${JSON.stringify(body)}`,
  );
}

describe('CreateReimbursementRequestDto', () => {
  it('accepts a multi-line claim', async () => {
    const out = await pipe.transform({
      ...validCreate,
      title: 'ใบเบิกเดือนมกราคม',
      missingReceiptReason: 'ใบเสร็จหาย',
      lines: [
        { ...validLine, purpose: 'พบลูกค้า', categoryLabel: 'เดินทาง', attachmentId: 'att-1' },
        { ...validLine, lineNo: 2, amount: '80', linkedExpenseId: 'exp-1' },
      ],
    }, { type: 'body', metatype: CreateReimbursementRequestDto });
    assert.equal(out.lines.length, 2);
    assert.equal(out.lines[1].linkedExpenseId, 'exp-1');
  });

  it('rejects server-owned header fields, above all a client-sent total', async () => {
    for (const poison of [
      { amount: '999.00' }, { categoryKey: 'travel' }, { incurredDate: '2026-01-05' },
      { companyId: 'other-tenant' }, { status: 'APPROVED' }, { createdByUserId: 'someone-else' },
      { primaryAttachmentId: 'att-1' }, { receiptRequirementStatus: 'WAIVED_BY_POLICY' },
    ]) {
      await rejects(CreateReimbursementRequestDto, { ...validCreate, ...poison });
    }
  });

  it('accepts a recipient identifier for use-case authorization while rejecting forged source facts', async () => {
    const out = await pipe.transform({ ...validCreate, requesterUserId: 'employee-1' }, { type: 'body', metatype: CreateReimbursementRequestDto });
    assert.equal(out.requesterUserId, 'employee-1');
    for (const requesterUserId of ['', 123, 'x'.repeat(65)]) {
      await rejects(CreateReimbursementRequestDto, { ...validCreate, requesterUserId });
    }
    for (const field of ['sourceExpenseSnapshot', 'sourceExpenseSnapshotJson', 'attachmentSnapshot', 'attachmentSnapshotJson']) {
      await rejects(CreateReimbursementRequestDto, { ...validCreate, lines: [{ ...validLine, [field]: { id: 'forged' } }] });
    }
    await rejects(UpdateReimbursementDraftDto, { requesterUserId: 'other-employee' });
  });

  it('requires at least one line and caps the claim at 50', async () => {
    await rejects(CreateReimbursementRequestDto, { ...validCreate, lines: [] });
    await rejects(CreateReimbursementRequestDto, { reason: 'r' });
    await rejects(CreateReimbursementRequestDto, {
      ...validCreate,
      lines: Array.from({ length: 51 }, (_v, i) => ({ ...validLine, lineNo: i + 1 })),
    });
  });

  it('rejects malformed lines', async () => {
    for (const badLine of [
      { ...validLine, amount: '-5' },
      { ...validLine, amount: '1e6' },
      { ...validLine, amount: 120.5 as any },
      { ...validLine, description: '' },
      { ...validLine, incurredDate: '2026-02-30' },
      { ...validLine, lineNo: 0 },
      { ...validLine, currency: 'THB' }, // one currency per claim: never per line
      { ...validLine, companyId: 'other-tenant' },
    ]) {
      await rejects(CreateReimbursementRequestDto, { ...validCreate, lines: [badLine] });
    }
  });
});

describe('UpdateReimbursementDraftDto', () => {
  it('accepts a lines-only replacement and a lines-free patch', async () => {
    const replaced = await pipe.transform({ lines: [validLine] }, { type: 'body', metatype: UpdateReimbursementDraftDto });
    assert.equal(replaced.lines?.length, 1);
    const renamed = await pipe.transform({ title: 'ชื่อใหม่' }, { type: 'body', metatype: UpdateReimbursementDraftDto });
    assert.equal(renamed.lines, undefined);
  });

  it('lets a line clear its receipt with an explicit null', async () => {
    const out = await pipe.transform(
      { lines: [{ ...validLine, attachmentId: null, linkedExpenseId: null }] },
      { type: 'body', metatype: UpdateReimbursementDraftDto },
    );
    assert.equal(out.lines?.[0].attachmentId, null);
  });

  it('rejects header rollup fields and an empty lines array', async () => {
    await rejects(UpdateReimbursementDraftDto, { amount: '10.00' });
    await rejects(UpdateReimbursementDraftDto, { incurredDate: '2026-01-05' });
    await rejects(UpdateReimbursementDraftDto, { lines: [] });
  });
});

describe('RecordReimbursementPaymentDto', () => {
  const validPayment = { paidAmount: '500.00', paymentMethod: 'CASH', paidAt: '2026-02-01T00:00:00.000Z' };

  it('accepts a full payment body', async () => {
    const out = await pipe.transform(
      { ...validPayment, currency: 'THB', paymentReference: 'TXN-1', idempotencyKey: 'key-1' },
      { type: 'body', metatype: RecordReimbursementPaymentDto },
    );
    assert.equal(out.paidAmount, '500.00');
  });

  it('rejects bad amounts, methods, dates and caller-owned fields', async () => {
    await rejects(RecordReimbursementPaymentDto, { ...validPayment, paidAmount: '-1' });
    await rejects(RecordReimbursementPaymentDto, { ...validPayment, paymentMethod: 'CRYPTO' });
    await rejects(RecordReimbursementPaymentDto, { ...validPayment, paidAt: 'yesterday' });
    await rejects(RecordReimbursementPaymentDto, { ...validPayment, paidByUserId: 'someone-else' });
    await rejects(RecordReimbursementPaymentDto, { ...validPayment, status: 'VOIDED' });
  });
});

describe('LinkReimbursementSignedCopyDto', () => {
  it('accepts the archive-only body and the A4 declaration', async () => {
    const archived = await pipe.transform({ attachmentId: 'att-1' }, { type: 'body', metatype: LinkReimbursementSignedCopyDto });
    assert.equal(archived.acknowledgedComplete, undefined);
    const declared = await pipe.transform(
      { attachmentId: 'att-1', acknowledgedComplete: true, confirmedRequestNo: 'RB-202609-00001' },
      { type: 'body', metatype: LinkReimbursementSignedCopyDto },
    );
    assert.equal(declared.acknowledgedComplete, true);
    assert.equal(declared.confirmedRequestNo, 'RB-202609-00001');
  });

  it('rejects a declaration without its claim number or with a non-true flag', async () => {
    await rejects(LinkReimbursementSignedCopyDto, { attachmentId: 'att-1', acknowledgedComplete: true });
    await rejects(LinkReimbursementSignedCopyDto, { attachmentId: 'att-1', acknowledgedComplete: true, confirmedRequestNo: '' });
    await rejects(LinkReimbursementSignedCopyDto, { attachmentId: 'att-1', acknowledgedComplete: false, confirmedRequestNo: 'RB-1' });
    await rejects(LinkReimbursementSignedCopyDto, { attachmentId: 'att-1', acknowledgedComplete: 'yes', confirmedRequestNo: 'RB-1' });
  });
});
