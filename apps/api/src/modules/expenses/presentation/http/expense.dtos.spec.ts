import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  AmendSubstituteReceiptDto,
  CorrectSubstituteDocumentDto,
  SubmitSubstituteReceiptPaperDto,
  AcceptSubstituteReceiptPaperDto,
  ConfirmExpenseDto,
  ExpenseTotalsPreviewDto,
  CreateSignatureAssetDto,
  ReasonOptionalDto,
  ReasonRequiredDto,
  ReceiptUploadCompletionDto,
  ReceiptUploadIntentDto,
  RecordExpensePaymentDto,
  SetSignatureDerivedAssetDto,
  UploadIntentDto,
} from './expense.dtos';

// The exact global-pipe configuration main.ts registers, so this exercises the gate production
// runs rather than a lookalike.
const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
const run = (metatype: unknown, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: metatype as never });

describe('expense body DTOs (audit H-23)', () => {
  it('validates editable certificate facts and rejects server-owned identities and state', async () => {
    const body = { reasonCode: 'OTHER', missingReceiptReason: 'ไม่มีใบเสร็จ', businessPurpose: 'ใช้งานบริษัท',
      payeeName: 'ผู้รับเงิน', payeeAddress: '', payeeTaxId: '', paymentEvidenceAttachmentIds: [], supportingAttachmentIds: ['attachment-1'],
      paymentDate: '2026-08-14', paymentMethod: 'CASH', expectedExpenseUpdatedAt: '2026-09-10T00:00:00.000Z', expectedEvidenceUpdatedAt: '2026-09-10T00:00:00.000Z' };
    assert.deepEqual(JSON.parse(JSON.stringify(await run(AmendSubstituteReceiptDto, body))), body);
    for (const patch of [{ companyId: 'other' }, { payerUserId: 'forged' }, { fundingSource: 'COMPANY' },
      { documentNumber: 'SRC-202609-00001' }, { status: 'ISSUED' }, { signatureMode: 'PAPER' },
      { keepDocumentNumberConfirmed: 'true' }, { keepDocumentNumberConfirmed: null }, { expectedEvidenceUpdatedAt: null }, { expectedExpenseUpdatedAt: '' }, { paymentDate: '2026-02-30' },
      { paymentMethod: 'CRYPTO' }, { businessPurpose: {} }, { payeeName: null }, { supportingAttachmentIds: [123] }]) {
      await assert.rejects(() => run(AmendSubstituteReceiptDto, { ...body, ...patch }), BadRequestException);
    }
  });

  it('validates paper signer identities while allowing an omitted or blank position', async () => {
    const body = { payer: { name: 'ผู้จ่ายจริง', signedOn: '2026-09-09' },
      approver: { name: 'ผู้อนุมัติ', position: '', signedOn: '2026-09-09' }, samePerson: false,
      attachmentId: 'scan-1', checksumSha256: 'a'.repeat(64), byteSize: 100,
      formMatchesAcknowledged: true, expectedEvidenceUpdatedAt: '2026-09-09T12:00:00.000Z' };
    assert.deepEqual(JSON.parse(JSON.stringify(await run(SubmitSubstituteReceiptPaperDto, body))), body);
    for (const invalid of [{ ...body, payer: null }, { ...body, payer: {} },
      { ...body, payer: { ...body.payer, name: {} } },
      { ...body, approver: { ...body.approver, position: 123 } },
      { ...body, payer: { ...body.payer, signedOn: '2026-02-30' } },
      { ...body, payer: { ...body.payer, userId: 'forged' } },
      { ...body, uploadedByUserId: 'forged' }, { ...body, byteSize: '100' },
      { ...body, checksumSha256: 'invalid' }, { ...body, samePerson: 'false' },
      { ...body, formMatchesAcknowledged: false }, { ...body, expectedEvidenceUpdatedAt: '' }]) {
      await assert.rejects(() => run(SubmitSubstituteReceiptPaperDto, invalid), BadRequestException);
    }
  });

  it('requires the reviewed paper checksum, source version and explicit acceptance declarations', async () => {
    const body = { previewChecksumSha256: 'a'.repeat(64), expectedEvidenceUpdatedAt: '2026-09-09T12:00:00.000Z',
      factsAndSignaturesAcknowledged: true, approverAuthorityAcknowledged: true, originalRetainedAcknowledged: true };
    assert.deepEqual(JSON.parse(JSON.stringify(await run(AcceptSubstituteReceiptPaperDto, body))), body);
    for (const key of Object.keys(body)) {
      const missing = { ...body } as Record<string, unknown>;
      delete missing[key];
      await assert.rejects(() => run(AcceptSubstituteReceiptPaperDto, missing), BadRequestException);
      await assert.rejects(() => run(AcceptSubstituteReceiptPaperDto, { ...body, [key]: false }), BadRequestException);
    }
    await assert.rejects(() => run(AcceptSubstituteReceiptPaperDto, { ...body, reviewerUserId: 'forged' }), BadRequestException);
  });

  it('validates correction reasons and concurrency tokens without accepting financial overrides', async () => {
    const body = { reason: 'แก้ชื่อบริษัท', expectedEvidenceUpdatedAt: '2026-09-09T12:00:00.000Z' };
    assert.equal((await run(CorrectSubstituteDocumentDto, body)).reason, body.reason);
    for (const invalid of [{ reason: body.reason }, { ...body, reason: {} },
      { ...body, expectedEvidenceUpdatedAt: 'yesterday' }, { ...body, paidAmount: '999' }]) {
      await assert.rejects(() => run(CorrectSubstituteDocumentDto, invalid), BadRequestException);
    }
  });

  it('accepts the complete review-preview payload, including blank optional purpose, source refs and independent VAT/WHT', async () => {
    const body = { expectedUpdatedAt: '2026-09-09T00:00:00.000Z', vendorNameSnapshot: 'ร้านทดสอบ',
      vendorTaxIdSnapshot: '', vendorEntityKindSnapshot: 'JURISTIC', vendorDocumentNumber: '', expenseDate: '2026-09-07',
      note: '', vatMode: 'VAT_INCLUDED', inputVatClaimStatus: 'NON_CLAIMABLE', removedSourceItemRefs: ['I02'],
      vatSource: { inputType: 'BOTH', vatRatePercent: '7', vatAmount: '157.64' }, whtInput: { inputType: 'RATE', value: '0' },
      lines: [{ id: 'line-1', sourceItemRef: 'I01', lineNumber: 1, description: 'Fuel', chargeKind: null,
        quantity: '61.488', unitPrice: '39.19', discountAmount: '0', vatRate: '0.07', vatTreatment: null, whtRate: '0',
        expenseCategoryId: 'category', accountHintKey: 'expense.travel', taxCategory: 'tax', taxCodeDefinitionId: 'code',
        externalTaxCode: 'V7', transactionContext: 'DOMESTIC_PURCHASE' }] };
    const result = await run(ExpenseTotalsPreviewDto, body);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), body);
    // Preview must not impose a line-count limit absent from draft save (e.g. multi-page retail bills).
    assert.equal((await run(ExpenseTotalsPreviewDto, { ...body, lines: Array.from({ length: 60 }, (_, i) => ({ ...body.lines[0], lineNumber: i + 1 })) })).lines.length, 60);
  });

  it('rejects malformed preview bodies and injected server fields before the calculator runs', async () => {
    const body = { expectedUpdatedAt: '2026-09-09T00:00:00.000Z', lines: [{ lineNumber: 1, description: 'Fuel', quantity: '1', unitPrice: '100' }] };
    for (const invalid of [{}, { ...body, previewOnly: false }, { ...body, vendorNameSnapshot: null },
      { ...body, lines: [] }, { ...body, vatSource: [] },
      { ...body, lines: [{ ...body.lines[0], quantity: {} }] },
      { ...body, lines: [{ ...body.lines[0], sourceLineText: 'forged evidence' }] }]) {
      await assert.rejects(() => run(ExpenseTotalsPreviewDto, invalid), BadRequestException);
    }
  });

  it('binds document VAT acceptance to a reviewed version without changing ordinary confirmation', async () => {
    assert.equal((await run(ConfirmExpenseDto, {})).vatSourceOverride, undefined);
    const vatSourceOverride = { reason: 'Checked printed VAT', vatLineNumber: 1, expectedUpdatedAt: '2026-08-27T01:00:00.000Z' };
    assert.equal((await run(ConfirmExpenseDto, { vatSourceOverride })).vatSourceOverride.expectedUpdatedAt, vatSourceOverride.expectedUpdatedAt);
    for (const invalid of [
      { reason: 'Checked', vatLineNumber: 1 },
      { ...vatSourceOverride, expectedUpdatedAt: 'yesterday' },
      { ...vatSourceOverride, acceptedVatAmount: '999' },
      { ...vatSourceOverride, status: 'REVIEWER_ACCEPTED' },
    ]) await assert.rejects(() => run(ConfirmExpenseDto, { vatSourceOverride: invalid }), BadRequestException);
  });

  // The sharpest case in the whole finding: several handlers call `reason.trim()`. An object in
  // that field was a 500, the same type-confusion the audit found in reimbursement.
  describe('ReasonRequiredDto', () => {
    it('accepts a reason', async () => {
      assert.equal((await run(ReasonRequiredDto, { reason: 'ซ้ำกับใบเดิม' })).reason, 'ซ้ำกับใบเดิม');
    });

    it('rejects a JSON object where a string is trimmed', async () => {
      await assert.rejects(() => run(ReasonRequiredDto, { reason: {} }), BadRequestException);
      await assert.rejects(() => run(ReasonRequiredDto, { reason: ['a'] }), BadRequestException);
      await assert.rejects(() => run(ReasonRequiredDto, { reason: 42 }), BadRequestException);
    });

    it('rejects an empty or missing reason on an action that records why', async () => {
      await assert.rejects(() => run(ReasonRequiredDto, { reason: '' }), BadRequestException);
      await assert.rejects(() => run(ReasonRequiredDto, {}), BadRequestException);
    });
  });

  describe('ReasonOptionalDto', () => {
    it('allows an omitted reason, matching the literal it replaced', async () => {
      // transform:true builds an instance, so declared-but-absent keys read as undefined rather
      // than being missing — the field is optional either way.
      assert.equal((await run(ReasonOptionalDto, {})).reason, undefined);
    });

    it('still refuses a non-string once one is given', async () => {
      await assert.rejects(() => run(ReasonOptionalDto, { reason: {} }), BadRequestException);
    });
  });

  describe('UploadIntentDto', () => {
    it('coerces a numeric string, since a form body sends numbers as text', async () => {
      const result = await run(UploadIntentDto, { originalFileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: '1024' });
      assert.equal(result.byteSize, 1024);
    });

    it('refuses a size that cannot describe a file', async () => {
      const base = { originalFileName: 'a.jpg', mimeType: 'image/jpeg' };
      for (const byteSize of [-1, 1.5, 'big', null]) {
        await assert.rejects(() => run(UploadIntentDto, { ...base, byteSize }), BadRequestException, String(byteSize));
      }
    });

    it('strips nothing and rejects an unknown key rather than passing it inward', async () => {
      await assert.rejects(
        () => run(UploadIntentDto, { originalFileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 1, companyId: 'co-2' }),
        BadRequestException,
      );
    });
  });

  describe('ReceiptUploadIntentDto', () => {
    it('inherits the base fields and adds its own', async () => {
      const result = await run(ReceiptUploadIntentDto, {
        originalFileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10,
        expenseDate: '2026-08-09', branchId: 'br-1', note: 'ค่าน้ำมัน',
      });
      assert.equal(result.expenseDate, '2026-08-09');
      assert.equal(result.byteSize, 10);
    });

    // Shares the domain's civil-date definition rather than a copy, so a boundary cannot drift
    // from what the domain accepts.
    it('rejects a date that is not a calendar day', async () => {
      const base = { originalFileName: 'a.jpg', mimeType: 'image/jpeg', byteSize: 10 };
      for (const expenseDate of ['09/08/2026', '2026-8-9', '2026-08-09T00:00:00Z', '2569-08-09', '9999-12-31']) {
        await assert.rejects(() => run(ReceiptUploadIntentDto, { ...base, expenseDate }), BadRequestException, expenseDate);
      }
    });
  });

  describe('ReceiptUploadCompletionDto', () => {
    it('accepts a report with nothing filled in, as the literal did', async () => {
      const result = await run(ReceiptUploadCompletionDto, {});
      assert.equal(result.checksumSha256, undefined);
      assert.equal(result.byteSize, undefined);
    });

    it('refuses a negative uploaded size', async () => {
      await assert.rejects(() => run(ReceiptUploadCompletionDto, { byteSize: -5 }), BadRequestException);
    });

    // Spec §16.4. The four new fields are optional together: the legacy call must keep working, and
    // a malformed intent, revision or operation id must never reach the state matrix.
    it('accepts a full replace intent and refuses every malformed shape of it', async () => {
      const body = {
        byteSize: 10, purpose: 'expense.receipt.primary', intent: 'replace',
        expectedUpdatedAt: '2026-09-18T10:00:00.000Z', expectedPrimaryAttachmentId: 'att-old',
        operationId: '11111111-2222-4333-8444-555555555555',
      };
      assert.deepEqual(JSON.parse(JSON.stringify(await run(ReceiptUploadCompletionDto, body))), body);
      assert.equal((await run(ReceiptUploadCompletionDto, { intent: 'append' })).intent, 'append');
      for (const patch of [
        { intent: 'REPLACE' }, { intent: 'delete' }, { intent: 123 },
        // A date-only value passes `IsISO8601` here as it does on every sibling revision field;
        // it simply cannot equal a stored instant, so the use case answers a revision conflict.
        { expectedUpdatedAt: '' }, { expectedUpdatedAt: 5 }, { expectedUpdatedAt: 'yesterday' },
        { expectedPrimaryAttachmentId: 42 }, { expectedPrimaryAttachmentId: 'a'.repeat(65) },
        { operationId: 'not-a-uuid' }, { operationId: '' },
      ]) {
        await assert.rejects(() => run(ReceiptUploadCompletionDto, { ...body, ...patch }), BadRequestException, JSON.stringify(patch));
      }
    });
  });

  describe('RecordExpensePaymentDto', () => {
    it('normalizes leading zeros before the existing money validation', async () => {
      const result = await run(RecordExpensePaymentDto, { paidAmount: '0500.00' });
      assert.equal(result.paidAmount, '500.00');
      for (const paidAmount of ['000', '00.0001']) await assert.rejects(() => run(RecordExpensePaymentDto, { paidAmount }), BadRequestException);
    });

    it('accepts an ordinary payment', async () => {
      const result = await run(RecordExpensePaymentDto, { paidAmount: '1070.25', paymentMethod: 'BANK_TRANSFER', idempotencyKey: 'payment-intent-1', paidAt: '2026-07-31' });
      assert.equal(result.paidAmount, '1070.25');
      assert.equal(result.idempotencyKey, 'payment-intent-1');
      assert.equal(result.paidAt, '2026-07-31');
    });

    it('allows legacy omission but fails closed for any malformed supplied intent key', async () => {
      assert.equal((await run(RecordExpensePaymentDto, { paidAmount: '1' })).idempotencyKey, undefined);
      for (const idempotencyKey of [null, '', 'short', 'a'.repeat(65), 'bad key 123', 12345678, ['valid-key'], {}]) {
        await assert.rejects(() => run(RecordExpensePaymentDto, { paidAmount: '1', idempotencyKey }), BadRequestException);
      }
    });

    it('rejects unknown methods before they can become a database enum error', async () => {
      await assert.rejects(() => run(RecordExpensePaymentDto, { paidAmount: '1', paymentMethod: 'TRANSFER' }), BadRequestException);
    });

    // Same money pattern the accounting documents use, so the two boundaries cannot disagree.
    it('refuses amounts a ledger cannot hold', async () => {
      for (const paidAmount of ['-100', '1e5', '0', '1.234', 'abc', '']) {
        await assert.rejects(() => run(RecordExpensePaymentDto, { paidAmount }), BadRequestException, paidAmount);
      }
    });

    it('refuses a payment date that is not a calendar day', async () => {
      for (const paidAt of ['yesterday', '2569-08-09', '9999-12-31']) {
        await assert.rejects(
          () => run(RecordExpensePaymentDto, { paidAmount: '10.00', paidAt }),
          BadRequestException,
          paidAt,
        );
      }
    });
  });

  describe('SetSignatureDerivedAssetDto', () => {
    it('requires the attachment it is pointing at', async () => {
      await assert.rejects(() => run(SetSignatureDerivedAssetDto, { checksumSha256: 'abc' }), BadRequestException);
      assert.equal((await run(SetSignatureDerivedAssetDto, { attachmentId: 'att-1' })).attachmentId, 'att-1');
    });
  });

  describe('CreateSignatureAssetDto', () => {
    it('accepts the web fields a legit create sends', async () => {
      const result = await run(CreateSignatureAssetDto, { attachmentId: 'att-1', label: 'ลายเซ็นของฉัน' });
      assert.equal(result.attachmentId, 'att-1');
      assert.equal(result.label, 'ลายเซ็นของฉัน');
    });

    it('requires an attachmentId', async () => {
      await assert.rejects(() => run(CreateSignatureAssetDto, { label: 'x' }), BadRequestException);
    });

    // The mass-assignment defence: the use case honours `attachmentAlreadyActive` (skips the
    // PENDING_UPLOAD/ownership gate) and `lineMessageId`, so a web caller who could smuggle either in
    // would point a signature asset at any ACTIVE attachment. forbidNonWhitelisted rejects them here.
    for (const attack of [
      { attachmentId: 'att-1', attachmentAlreadyActive: true },
      { attachmentId: 'att-1', lineMessageId: 'm-1' },
      { attachmentId: 'att-1', submittedFromChannel: 'LINE' },
    ]) {
      it(`rejects the internal-only key in ${JSON.stringify(attack)}`, async () => {
        await assert.rejects(() => run(CreateSignatureAssetDto, attack), BadRequestException);
      });
    }
  });
});
