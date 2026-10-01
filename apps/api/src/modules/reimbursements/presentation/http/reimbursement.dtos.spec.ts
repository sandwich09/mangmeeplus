import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  ApproveReimbursementDto, AttachPaymentSlipDto, CancelReimbursementDto, CompletePaymentSlipUploadDto, CreateReimbursementRequestDto, InitPaymentSlipUploadDto,
  LinkReimbursementSignedCopyDto, RecordReimbursementPaymentDto,
  ReimbursementInternalNoteDto, SetMemberPayoutAccountDto, SubmitReimbursementDto, UpdateReimbursementDraftDto,
  RequestPayoutCorrectionDto, SubmitPayoutCorrectionDto, RejectReimbursementDto, VoidReimbursementPaymentDto,
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

describe('ReimbursementInternalNoteDto', () => {
  it('accepts bounded text and rejects forged fields', async () => {
    await pipe.transform({ body: 'ตรวจเอกสารแล้ว' }, { type: 'body', metatype: ReimbursementInternalNoteDto });
    await rejects(ReimbursementInternalNoteDto, { body: 'x'.repeat(2001) });
    await rejects(ReimbursementInternalNoteDto, { body: 'x', authorUserId: 'other' });
    await rejects(ReimbursementInternalNoteDto, { body: 42 });
  });
});

// Audit B3: the cancel body reached the use case unvalidated (`@Body() body: { reason?: string }`).
describe('CancelReimbursementDto', () => {
  it('takes a reason or none, and refuses a forged field, a non-string and an oversized reason', async () => {
    assert.equal((await pipe.transform({ reason: 'ซื้อซ้ำ' }, { type: 'body', metatype: CancelReimbursementDto })).reason, 'ซื้อซ้ำ');
    await pipe.transform({}, { type: 'body', metatype: CancelReimbursementDto });
    await rejects(CancelReimbursementDto, { reason: 'ซื้อซ้ำ', status: 'CANCELLED' });
    await rejects(CancelReimbursementDto, { reason: 42 });
    await rejects(CancelReimbursementDto, { reason: 'x'.repeat(501) });
  });
});

// Final review W1: the reject and void bodies reached their use cases unvalidated (`@Body() body: <a contracts type>`).
describe('RejectReimbursementDto and VoidReimbursementPaymentDto', () => {
  it('take a bounded reason, and refuse a forged field, a non-string and an oversized reason', async () => {
    const rejected = await pipe.transform({ reason: 'ใบเสร็จไม่ชัด', approvalSnapshotHash: 'a'.repeat(32), payoutCorrectionReasonCode: 'ACCOUNT_NAME_MISMATCH' },
      { type: 'body', metatype: RejectReimbursementDto });
    assert.deepEqual([rejected.reason, rejected.payoutCorrectionReasonCode], ['ใบเสร็จไม่ชัด', 'ACCOUNT_NAME_MISMATCH']);
    assert.equal((await pipe.transform({ reason: 'โอนผิดบัญชี' }, { type: 'body', metatype: VoidReimbursementPaymentDto })).reason, 'โอนผิดบัญชี');
    // That a reason is given at all stays the use case's refusal, with the code each screen has words for.
    await pipe.transform({}, { type: 'body', metatype: RejectReimbursementDto });
    await pipe.transform({}, { type: 'body', metatype: VoidReimbursementPaymentDto });
    for (const metatype of [RejectReimbursementDto, VoidReimbursementPaymentDto]) {
      await rejects(metatype, { reason: 'x'.repeat(501) });
      await rejects(metatype, { reason: 42 });
      await rejects(metatype, { reason: ['ก', 'ข'] });
      await rejects(metatype, { reason: 'ซ้ำ', status: 'REJECTED' });
      await rejects(metatype, { reason: 'ซ้ำ', voidedByUserId: 'someone-else' });
    }
    await rejects(RejectReimbursementDto, { reason: 'ซ้ำ', payoutCorrectionReasonCode: 'x'.repeat(41) });
    await rejects(VoidReimbursementPaymentDto, { reason: 'ซ้ำ', payoutCorrectionReasonCode: 'OTHER' });
  });
});

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

  it('carries the slip as an attachment id, and nothing a client could use to place the slip itself', async () => {
    const out = await pipe.transform(
      { ...validPayment, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1', slipAttachmentId: 'att-slip-1' },
      { type: 'body', metatype: RecordReimbursementPaymentDto },
    );
    assert.equal(out.slipAttachmentId, 'att-slip-1');
    // The method is the payer's to state: there is no default to fall back on.
    await rejects(RecordReimbursementPaymentDto, { paidAmount: '500.00', paidAt: validPayment.paidAt });
    await rejects(RecordReimbursementPaymentDto, { ...validPayment, paymentMethod: '' });
    for (const slipAttachmentId of ['', 42, 'x'.repeat(65), ['att-1']]) {
      await rejects(RecordReimbursementPaymentDto, { ...validPayment, slipAttachmentId });
    }
    for (const forged of [{ slipChecksumSha256: 'a'.repeat(64) }, { slipUrl: 'https://example.com/slip.jpg' }, { slips: ['att-1'] }]) {
      await rejects(RecordReimbursementPaymentDto, { ...validPayment, ...forged });
    }
  });

  // Payout Phase 1 part B: what the payer says about the account. Shapes only; whether it is enough
  // for the claim is decided under the payment lock.
  it('takes the account version the payer was shown, the confirmation, a default-account token and a reason', async () => {
    const transfer = { ...validPayment, paymentMethod: 'BANK_TRANSFER', paymentReference: 'TXN-1', slipAttachmentId: 'att-slip-1' };
    const out = await pipe.transform({ ...transfer, payoutDestinationVersion: 2, payoutConfirmed: true }, { type: 'body', metatype: RecordReimbursementPaymentDto });
    assert.deepEqual([out.payoutDestinationVersion, out.payoutConfirmed], [2, true]);
    const legacy = await pipe.transform({ ...transfer, payoutConfirmed: true, payoutDefaultToken: 'a'.repeat(32) }, { type: 'body', metatype: RecordReimbursementPaymentDto });
    assert.equal(legacy.payoutDefaultToken, 'a'.repeat(32));
    const cash = await pipe.transform({ ...validPayment, methodMismatchReason: 'ผู้เบิกขอรับเป็นเงินสดแทน' }, { type: 'body', metatype: RecordReimbursementPaymentDto });
    assert.equal(cash.methodMismatchReason, 'ผู้เบิกขอรับเป็นเงินสดแทน');

    // A version is a whole number, a confirmation is a boolean: nothing that merely looks like one.
    // (An explicit null passes as "not sent", and the rule under the payment lock then reads it as absent.)
    for (const payoutDestinationVersion of ['2', 0, -1, 2.5, true, [2]]) await rejects(RecordReimbursementPaymentDto, { ...transfer, payoutDestinationVersion, payoutConfirmed: true });
    for (const payoutConfirmed of ['true', 1, 'yes']) await rejects(RecordReimbursementPaymentDto, { ...transfer, payoutDestinationVersion: 2, payoutConfirmed });
    for (const payoutDefaultToken of ['', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(64), 42]) await rejects(RecordReimbursementPaymentDto, { ...transfer, payoutConfirmed: true, payoutDefaultToken });
    for (const methodMismatchReason of [42, 'x'.repeat(501), ['เหตุผล']]) await rejects(RecordReimbursementPaymentDto, { ...validPayment, methodMismatchReason });
    // The account itself never comes from the payer: not its number, not its fingerprint, not when it was confirmed.
    for (const forged of [{ accountNumber: '0123456789' }, { payoutFingerprint: 'f'.repeat(64) }, { payoutConfirmedAt: validPayment.paidAt }, { payoutDestination: { version: 2 } }, { payout: { payoutConfirmed: true } }]) {
      await rejects(RecordReimbursementPaymentDto, { ...transfer, ...forged });
    }
  });
});

describe('payment slip DTOs', () => {
  it('accept a slip upload, its completion and a later attachment, and reject forged fields', async () => {
    const upload = { originalFileName: 'slip.jpg', mimeType: 'image/jpeg', byteSize: 250_000 };
    assert.equal((await pipe.transform(upload, { type: 'body', metatype: InitPaymentSlipUploadDto })).byteSize, 250_000);
    await pipe.transform({}, { type: 'body', metatype: CompletePaymentSlipUploadDto });
    await pipe.transform({ checksumSha256: 'a'.repeat(64), byteSize: 250_000 }, { type: 'body', metatype: CompletePaymentSlipUploadDto });
    assert.equal((await pipe.transform({ attachmentId: 'att-1' }, { type: 'body', metatype: AttachPaymentSlipDto })).attachmentId, 'att-1');

    // The claim and the uploader come from the route and the session, never from the body.
    await rejects(InitPaymentSlipUploadDto, { ...upload, metadataJson: { generatedFor: 'reimbursement_payment_slip', requestId: 'rb-9' } });
    await rejects(InitPaymentSlipUploadDto, { ...upload, branchId: 'branch-9' });
    await rejects(InitPaymentSlipUploadDto, { ...upload, byteSize: 0 });
    await rejects(InitPaymentSlipUploadDto, { ...upload, originalFileName: '' });
    await rejects(CompletePaymentSlipUploadDto, { checksumSha256: 'not-a-checksum' });
    await rejects(AttachPaymentSlipDto, {});
    await rejects(AttachPaymentSlipDto, { attachmentId: 'att-1', paymentId: 'pay-9' });
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

describe('payout account bodies', () => {
  const account = { payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789' };

  it('carries the account number as text, so leading zeros survive the pipe', async () => {
    const created = await pipe.transform({ ...validCreate, payout: { mode: 'SPECIFIED', saveAsDefault: true, ...account } }, { type: 'body', metatype: CreateReimbursementRequestDto });
    assert.deepEqual({ ...created.payout }, { mode: 'SPECIFIED', saveAsDefault: true, ...account });
    const updated = await pipe.transform({ payout: { mode: 'CASH' } }, { type: 'body', metatype: UpdateReimbursementDraftDto });
    assert.equal(updated.payout?.mode, 'CASH');
    const own = await pipe.transform({ payoutMethod: 'BANK_TRANSFER', ...account }, { type: 'body', metatype: SetMemberPayoutAccountDto });
    assert.equal(own.accountNumber, '0123456789');
    await pipe.transform({ payoutMethod: 'CASH' }, { type: 'body', metatype: SetMemberPayoutAccountDto });
  });

  it('rejects a numeric account number, unknown modes and methods, and every server-owned field', async () => {
    for (const payout of [
      { mode: 'SPECIFIED', ...account, accountNumber: 123456789 },
      { mode: 'SPECIFIED', ...account, accountNumber: '1'.repeat(41) },
      { mode: 'SPECIFIED', ...account, payoutKind: 'CRYPTO_WALLET' },
      { mode: 'SPECIFIED', ...account, saveAsDefault: 'yes' },
      { mode: 'EMPLOYEE_DEFAULT' },
      { ...account },
      // What only the server may decide: whose account it is, its version, its last 4, who verified it.
      { mode: 'DEFAULT', userId: 'someone-else' },
      { mode: 'SPECIFIED', ...account, accountLast4: '0000' },
      { mode: 'SPECIFIED', ...account, version: 7 },
      { mode: 'SPECIFIED', ...account, verifiedByUserId: 'approver-1' },
      { mode: 'SPECIFIED', ...account, source: 'DEFAULT_ACCOUNT' },
    ]) {
      await rejects(CreateReimbursementRequestDto, { ...validCreate, payout });
      await rejects(UpdateReimbursementDraftDto, { payout });
    }
    for (const poison of [{ payoutMethod: 'CRYPTO' }, { accountNumber: 123456789 }, { userId: 'someone-else' }, { companyId: 'other-tenant' }, { accountLast4: '0000' }, { version: 3 }]) {
      await rejects(SetMemberPayoutAccountDto, { payoutMethod: 'BANK_TRANSFER', ...account, ...poison });
    }
    await rejects(SetMemberPayoutAccountDto, { ...account });
    // The claim header itself never takes the snapshot columns from a client.
    for (const poison of [{ payoutMethod: 'CASH' }, { payoutDestinationVersion: 2 }, { payoutFingerprint: 'forged' }]) {
      await rejects(CreateReimbursementRequestDto, { ...validCreate, ...poison });
      await rejects(UpdateReimbursementDraftDto, poison);
    }
  });
});

describe('submit and approve bodies', () => {
  it('takes the token of the account the page showed, an empty body, and no body at all', async () => {
    const token = 'a1b2c3d4'.repeat(4);
    const out = await pipe.transform({ payoutSubmitToken: token }, { type: 'body', metatype: SubmitReimbursementDto });
    assert.equal(out.payoutSubmitToken, token);
    await pipe.transform({}, { type: 'body', metatype: SubmitReimbursementDto });
    // A caller that posts nothing reaches the use case with no token, and is told to review the account there.
    assert.equal((await pipe.transform(undefined, { type: 'body', metatype: SubmitReimbursementDto }))?.payoutSubmitToken, undefined);
    for (const body of [{ payoutSubmitToken: 'not-a-token' }, { payoutSubmitToken: 1 }, { payoutSubmitToken: `${token}0` }, { payoutMethod: 'CASH' }, { payoutFingerprint: token }, { status: 'APPROVED' }]) {
      await rejects(SubmitReimbursementDto, body);
    }
  });

  it('takes the attested version as a whole number only, with the claim hash the approver saw', async () => {
    const out = await pipe.transform({ comment: 'ตรวจแล้ว', approvalSnapshotHash: 'a'.repeat(32), payoutVerifiedVersion: 2 }, { type: 'body', metatype: ApproveReimbursementDto });
    assert.deepEqual([out.comment, out.approvalSnapshotHash, out.payoutVerifiedVersion], ['ตรวจแล้ว', 'a'.repeat(32), 2]);
    // A browser tab from before the release sends neither; the use case answers it, not the pipe.
    await pipe.transform({ comment: 'ok' }, { type: 'body', metatype: ApproveReimbursementDto });
    for (const body of [{ payoutVerifiedVersion: '2' }, { payoutVerifiedVersion: 0 }, { payoutVerifiedVersion: 1.5 }, { payoutVerifiedVersion: true },
      { approvalSnapshotHash: 7 }, { comment: 'x'.repeat(2001) }, { verifiedByUserId: 'someone-else' }, { decisionByUserId: 'someone-else' }, { status: 'APPROVED' }]) {
      await rejects(ApproveReimbursementDto, body);
    }
  });
});

// Payout spec §14: the two calls of a payout account correction round.
describe('payout correction DTOs', () => {
  const body = (metatype: any, value: Record<string, unknown>) => pipe.transform(value, { type: 'body', metatype });

  it('takes a reason and a note for a send-back, and leaves which reasons exist to the use case', async () => {
    assert.deepEqual({ ...(await body(RequestPayoutCorrectionDto, { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าบัญชีปิด' })) },
      { reasonCode: 'ACCOUNT_NUMBER_WRONG', note: 'ธนาคารแจ้งว่าบัญชีปิด' });
    // Reaches the use case, which answers with a code the screen has words for (payout_correction_reason_required,
    // payout_correction_note_too_long), not with the validator's own English sentence.
    await body(RequestPayoutCorrectionDto, {});
    await body(RequestPayoutCorrectionDto, { reasonCode: 'NOT_A_REASON', note: 'x'.repeat(501) });
    // Nothing of the claim can be sent along, and nothing that is not text.
    await rejects(RequestPayoutCorrectionDto, { reasonCode: 'OTHER', status: 'PENDING_APPROVAL' });
    await rejects(RequestPayoutCorrectionDto, { reasonCode: 'OTHER', requestedByUserId: 'someone-else' });
    await rejects(RequestPayoutCorrectionDto, { reasonCode: 7 });
    await rejects(RequestPayoutCorrectionDto, { reasonCode: 'OTHER', note: ['x'] });
    await rejects(RequestPayoutCorrectionDto, { reasonCode: 'OTHER', note: 'x'.repeat(2001) });
  });

  it('takes the three choices a draft has for the account, the token of the default the form showed, and nothing of the snapshot', async () => {
    await body(SubmitPayoutCorrectionDto, { mode: 'CASH' });
    await body(SubmitPayoutCorrectionDto, { mode: 'DEFAULT', defaultToken: 'a'.repeat(32) });
    const typed = await body(SubmitPayoutCorrectionDto, {
      mode: 'SPECIFIED', saveAsDefault: true, payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789',
    });
    assert.equal(typed.accountNumber, '0123456789', 'a string: the leading zero survives');
    await rejects(SubmitPayoutCorrectionDto, {});
    await rejects(SubmitPayoutCorrectionDto, { mode: 'TRANSFER' });
    await rejects(SubmitPayoutCorrectionDto, { mode: 'DEFAULT', defaultToken: 'not-a-token' });
    await rejects(SubmitPayoutCorrectionDto, { mode: 'SPECIFIED', accountNumber: 123456789 });
    // The version, the fingerprint, the method column and the requester are the server's to write.
    for (const forged of [{ payoutDestinationVersion: 1 }, { payoutFingerprint: 'f'.repeat(64) }, { payoutMethod: 'CASH' }, { requesterUserId: 'someone-else' }, { status: 'READY_FOR_PAYMENT' }]) {
      await rejects(SubmitPayoutCorrectionDto, { mode: 'CASH', ...forged });
    }
  });
});
