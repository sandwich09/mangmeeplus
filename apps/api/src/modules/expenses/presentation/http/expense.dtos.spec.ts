import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import { CreateDisbursementVoucherDraftDto, UpdateDisbursementVoucherDraftDto, DisbursementVoucherCommandDto, SubmitDisbursementVoucherDto, EndDisbursementVoucherDto, PayDisbursementVoucherDto, IssueDisbursementVoucherDto, ReissueDisbursementVoucherDto,
  InitDisbursementVoucherSlipUploadDto, CompleteDisbursementVoucherSlipUploadDto, AttachDisbursementVoucherSlipDto } from './disbursement-voucher.dtos';
import {
  AccountantEvidenceBundleDto,
  SubstituteReceiptListQueryDto,
  DecideExpenseInputVatDto,
  AmendSubstituteReceiptDto,
  CorrectSubstituteDocumentDto,
  SubmitSubstituteReceiptPaperDto,
  AcceptSubstituteReceiptPaperDto,
  ConfirmExpenseDto,
  ExpenseTotalsPreviewDto,
  CreateSignatureAssetDto,
  ReasonOptionalDto,
  ReasonRequiredDto,
  VoidExpenseDto,
  ReceiptUploadCompletionDto,
  ReceiptUploadIntentDto,
  RecordExpensePaymentDto,
  SetSignatureDerivedAssetDto,
  UploadIntentDto,
} from './expense.dtos';
import * as expenseDtos from './expense.dtos';

// The exact global-pipe configuration main.ts registers, so this exercises the gate production
// runs rather than a lookalike.
const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
const run = (metatype: unknown, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: metatype as never });

it('validates the three document slip steps and accepts only the slip id on payment', async () => {
  assert.ok(await run(InitDisbursementVoucherSlipUploadDto, { originalFileName: 'slip.png', mimeType: 'image/png', byteSize: 1 }));
  assert.ok(await run(CompleteDisbursementVoucherSlipUploadDto, { checksumSha256: 'a'.repeat(64), byteSize: 1 }));
  assert.ok(await run(AttachDisbursementVoucherSlipDto, { attachmentId: 'slip' }));
  assert.equal((await run(PayDisbursementVoucherDto, { commandId: 'pay', expectedVersion: 1, slipAttachmentId: 'slip' })).slipAttachmentId, 'slip');
  for (const slipAttachmentId of ['', null, 1, 'x'.repeat(65)]) await assert.rejects(() => run(PayDisbursementVoucherDto, { commandId: 'pay', expectedVersion: 1, slipAttachmentId }), BadRequestException);
  for (const [dto, input] of [[InitDisbursementVoucherSlipUploadDto, { originalFileName: 'a.png', mimeType: 'image/png', byteSize: 1, metadataJson: { generatedFor: 'forged' } }],
    [CompleteDisbursementVoucherSlipUploadDto, { checksumSha256: 'invalid' }], [AttachDisbursementVoucherSlipDto, { attachmentId: 'slip', attachedByUserId: 'forged' }]]) {
    await assert.rejects(() => run(dto, input), BadRequestException);
  }
});

describe('accountant-v2 request DTO', () => {
  it('accountant package validates selection and explicit pages', async () => {
    const dtos: any = await import('./expense.dtos'); assert.equal(typeof dtos.AccountantPackageDto, 'function');
    const dto = dtos.AccountantPackageDto;
    for (const body of [{ expenseIds: 'x' }, { pageSize: 501 }, { page: 0 }, { page: 1.5 }, { columnSet: 'unknown' }]) await assert.rejects(() => run(dto, body), BadRequestException);
    for (const body of [{ page: 2, pageSize: 100 }, { dateField: 'expenseDate', fromDate: '2026-10-01', toDate: '2026-10-31', columnSet: 'summary' },
      { yearMonth: '2026-10', dateField: 'uploadedAt', expenseIds: ['A'], columnSet: 'full' }, { format: 'csv', expenseIds: [] }]) assert.ok(await run(dto, body));
  });
});

describe('expense body DTOs (audit H-23)', () => {
  it('accepts only payment facts for a disbursement voucher and never client amounts or payment keys', async () => {
    const body = { commandId: 'pay', expectedVersion: 1, paidDate: '2026-10-01', paymentMethod: 'CASH', paidFromRef: 'เงินสด' };
    assert.ok(await run(PayDisbursementVoucherDto, body));
    for (const patch of [{ amount: '1' }, { lines: [] }, { idempotencyKey: 'forged-key' }, { paidByUserId: 'forged' }, { paymentMethod: 'invalid' }, { paidFromRef: 'x'.repeat(129) }, { paidFromRef: null }]) await assert.rejects(() => run(PayDisbursementVoucherDto, { ...body, ...patch }), BadRequestException);
  });
  it('validates lifecycle command tokens and submit-only fields without accepting server state', async () => {
    const body = { commandId: 'submit', expectedVersion: 0 };
    assert.deepEqual(JSON.parse(JSON.stringify(await run(SubmitDisbursementVoucherDto, { ...body, approveNow: true, requestedApproverUserId: 'user-1' }))), { ...body, approveNow: true, requestedApproverUserId: 'user-1' });
    assert.equal((await run(EndDisbursementVoucherDto, { ...body, reason: 'ตรวจใหม่' })).reason, 'ตรวจใหม่');
    for (const type of [DisbursementVoucherCommandDto, SubmitDisbursementVoucherDto, EndDisbursementVoucherDto]) {
      for (const patch of [{ commandId: '' }, { expectedVersion: null }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: '0' },
        { status: 'APPROVED' }, { revision: 99 }, { submittedByUserId: 'forged' }, { reservedByDisbursementVoucherId: 'forged' }]) await assert.rejects(() => run(type, { ...body, ...patch }), BadRequestException);
    }
    for (const patch of [{ approveNow: 'true' }, { requestedApproverUserId: null }, { requestedApproverUserId: '' }, { reason: 'not allowed' }]) await assert.rejects(() => run(SubmitDisbursementVoucherDto, { ...body, ...patch }), BadRequestException);
    await assert.rejects(() => run(DisbursementVoucherCommandDto, { ...body, approveNow: true }), BadRequestException);
    await assert.rejects(() => run(EndDisbursementVoucherDto, { ...body, reason: null }), BadRequestException);
    assert.equal((await run(EndDisbursementVoucherDto, body)).reason, undefined);
  });
  it('accepts only editable disbursement draft fields and requires the update version', async () => {
    const body = { commandId: 'create-1', lines: [{ expenseId: 'expense-1', amount: '10.50' }],
      payeeName: 'ร้านทดสอบ', payeeConfirmed: true, plannedPayDate: '2026-10-15', plannedMethod: 'CASH', note: '',
      payeeBankName: 'ธนาคาร', payeeAccountName: 'ร้านทดสอบ', payeeAccountNumber: '123-456 7890' };
    assert.deepEqual(JSON.parse(JSON.stringify(await run(CreateDisbursementVoucherDraftDto, body))), body);
    assert.equal((await run(UpdateDisbursementVoucherDraftDto, { ...body, expectedVersion: 0 })).expectedVersion, 0);
    for (const patch of [{ companyId: 'other' }, { branchId: 'forged' }, { status: 'PAID' }, { documentNumber: 'forged' },
      { totalAmount: '999' }, { preparedByUserId: 'forged' }, { payeeTaxId: 'forged' }, { payeeAccountCiphertext: 'forged' },
      { commandId: '' }, { lines: null }, { lines: [{ ...body.lines[0], position: 99 }] }, { lines: [{ expenseId: null, amount: '10' }] },
      { payeeConfirmed: 'true' }, { payeeName: null }, { payeeBankName: null }, { payeeAccountName: 123 }, { payeeAccountNumber: 123456 }, { note: 123 }, { plannedMethod: 'CRYPTO' }]) {
      await assert.rejects(() => run(CreateDisbursementVoucherDraftDto, { ...body, ...patch }), BadRequestException);
    }
    for (const expectedVersion of [undefined, null, -1, 0.5, '0']) {
      await assert.rejects(() => run(UpdateDisbursementVoucherDraftDto, { ...body, expectedVersion }), BadRequestException);
    }
    // Contextual line-count and amount errors are answered by the use case with the expense number.
    assert.equal((await run(CreateDisbursementVoucherDraftDto, { commandId: 'empty', lines: [] })).lines.length, 0);
    assert.equal((await run(CreateDisbursementVoucherDraftDto, { ...body, lines: [{ expenseId: 'expense-1', amount: '0.001' }] })).lines[0].amount, '0.001');
  });
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
      vendorTaxIdSnapshot: '1234567890123', vendorEntityKindSnapshot: 'JURISTIC', vendorDocumentNumber: '', expenseDate: '2026-09-07',
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
    it('validates the optional payment slip identifier', async () => {
      assert.equal((await run(RecordExpensePaymentDto, { paidAmount: '1', slipAttachmentId: 'slip-1' })).slipAttachmentId, 'slip-1');
      for (const slipAttachmentId of ['', 12, {}, 'a'.repeat(65)]) await assert.rejects(run(RecordExpensePaymentDto, { paidAmount: '1', slipAttachmentId }), BadRequestException);
    });
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


it('reopen accepts only an optional boolean tax-filing attestation beside the reason', async () => {
  const { ReopenExpenseDto } = await import('./expense.dtos');
  assert.equal(typeof ReopenExpenseDto, 'function');
  for (const taxFilingAttested of [undefined, true, false]) {
    const body = { reason: 'แก้ข้อมูลผิด', ...(taxFilingAttested === undefined ? {} : { taxFilingAttested }) };
    assert.equal((await run(ReopenExpenseDto, body)).taxFilingAttested, taxFilingAttested);
  }
  for (const taxFilingAttested of [null, 'true', 1, {}, []]) await assert.rejects(() => run(ReopenExpenseDto, { reason: 'แก้ข้อมูลผิด', taxFilingAttested }), BadRequestException);
});


it('a draft save by a person without the review right goes to the draft update; only review-fields uses the certificate-only rule', async () => {
  const { ExpenseController } = await import('./expense.controller');
  const calls: string[] = [];
  const saved = { id: 'e1', sourceChannelMetadataJson: {}, lineMessageId: null, lineEventId: null };
  const controller = {
    update: { execute: async () => { calls.push('draft-update'); return saved; } },
    ownCertificateReview: { execute: async () => { calls.push('certificate-only'); return saved; } },
  };
  const staff = { companyId: 'c1', userId: 'u1', roles: [], permissions: ['expense.update', 'expense.read_own'], scopes: {} } as any;
  const reviewer = { ...staff, permissions: ['expense.update', 'expense.review'] };
  const body = { vendorNameSnapshot: 'ร้านตัวอย่าง', expectedUpdatedAt: '2026-10-13T00:00:00.000Z' } as any;
  assert.deepEqual(await ExpenseController.prototype.updateDraft.call(controller as any, staff, 'e1', body), { id: 'e1' });
  await ExpenseController.prototype.updateDraft.call(controller as any, reviewer, 'e1', body);
  assert.deepEqual(calls, ['draft-update', 'draft-update']);
  await ExpenseController.prototype.updateReviewFields.call(controller as any, staff, 'e1', body);
  await ExpenseController.prototype.updateReviewFields.call(controller as any, reviewer, 'e1', body);
  assert.deepEqual(calls.slice(2), ['certificate-only', 'draft-update']);
});

it('send-for-checking and certificate-evidence bodies are whitelisted (owner decisions ข8, ก4)', async () => {
  const { MarkExpenseReadyDto, SubstitutePreparationUploadIntentDto, SubstitutePreparationUploadCompletionDto } = await import('./expense.dtos');
  assert.equal((await run(MarkExpenseReadyDto, {})).requestedReviewerUserId, undefined);
  assert.equal((await run(MarkExpenseReadyDto, { requestedReviewerUserId: 'user-1' })).requestedReviewerUserId, 'user-1');
  for (const body of [{ requestedReviewerUserId: '' }, { requestedReviewerUserId: { $ne: null } }, { requestedReviewerUserId: 'user-1', submittedByUserId: 'someone-else' }]) {
    await assert.rejects(() => run(MarkExpenseReadyDto, body), BadRequestException);
  }
  const file = { originalFileName: 'slip.png', mimeType: 'image/png', byteSize: 1200 };
  assert.equal((await run(SubstitutePreparationUploadIntentDto, { ...file, purpose: 'expense.payment.evidence' })).purpose, 'expense.payment.evidence');
  assert.equal((await run(SubstitutePreparationUploadCompletionDto, { purpose: 'expense.receipt.supporting' })).purpose, 'expense.receipt.supporting');
  // The primary receipt and the reviewer's evidence are not this person's to attach through this door.
  for (const purpose of ['expense.receipt.primary', 'expense.review.evidence', undefined]) {
    await assert.rejects(() => run(SubstitutePreparationUploadIntentDto, { ...file, purpose }), BadRequestException);
    await assert.rejects(() => run(SubstitutePreparationUploadCompletionDto, { purpose }), BadRequestException);
  }
  await assert.rejects(() => run(SubstitutePreparationUploadIntentDto, { ...file, purpose: 'expense.payment.evidence', expenseId: 'other' }), BadRequestException);
});

it('accepts an optional strict boolean attestation on expense void', async () => {
  for (const taxFilingAttested of [true, false, undefined]) await run(VoidExpenseDto, { reason: 'บันทึกผิด', ...(taxFilingAttested === undefined ? {} : { taxFilingAttested }) });
  for (const taxFilingAttested of ['true', 1, null]) await assert.rejects(run(VoidExpenseDto, { reason: 'บันทึกผิด', taxFilingAttested }), BadRequestException);
});

it('validates issue and reissue intent without accepting amounts, paid facts or a fabricated origin', async () => {
  const body = { commandId: 'issue-command', expenseId: 'expense-1', paymentId: 'payment-1' };
  assert.deepEqual(JSON.parse(JSON.stringify(await run(IssueDisbursementVoucherDto, body))), body);
  assert.deepEqual(JSON.parse(JSON.stringify(await run(ReissueDisbursementVoucherDto, { commandId: 'reissue-command' }))), { commandId: 'reissue-command' });
  for (const patch of [{ commandId: '' }, { expenseId: '' }, { paymentId: null }, { amount: '1' }, { origin: 'DIRECT_PAYMENT' }, { paidDate: '2026-10-01' }]) await assert.rejects(() => run(IssueDisbursementVoucherDto, { ...body, ...patch }), BadRequestException);
  for (const patch of [{ commandId: '' }, { commandId: 'x'.repeat(129) }, { expectedVersion: 1 }, { paymentIds: [] }]) await assert.rejects(() => run(ReissueDisbursementVoucherDto, { commandId: 'reissue-command', ...patch }), BadRequestException);
});


it('validates evidence bundle selections and rejects forged scope, file ids and invalid filters', async () => {
  const body = { expenseIds: ['e1'], branchId: 'b1', yearMonth: '2026-10', dateField: 'expenseDate', status: 'CONFIRMED', taxEvidenceStatus: 'NOT_TAX_EVIDENCE' };
  assert.deepEqual(JSON.parse(JSON.stringify(await run(AccountantEvidenceBundleDto, body))), body);
  assert.ok(await run(AccountantEvidenceBundleDto, { expenseIds: [] }));
  for (const patch of [{ companyId: 'other' }, { attachmentIds: ['other'] }, { scopes: {} }, { yearMonth: '../file' }, { yearMonth: '2026-13' }, { dateField: 'createdAt' }, { status: 'bad' }, { expenseIds: [12] }, { expenseIds: Array(10001).fill('e') }]) {
    await assert.rejects(() => run(AccountantEvidenceBundleDto, { ...body, ...patch }), BadRequestException);
  }
});


it('validates VAT decision bodies and rejects forged actors or malformed conditions', async () => {
  const body = { toStatus: 'CLAIMABLE', reviewerConditions: ['BUSINESS_USE', 'NOT_PROHIBITED', 'ISSUER_ENTITLED'], buyerConfirmed: true };
  assert.ok(await run(DecideExpenseInputVatDto, body));
  for (const patch of [{ toStatus: 'NEEDS_REVIEW' }, { reason: 1 }, { reason: 'x'.repeat(501) }, { reviewerConditions: 'BUSINESS_USE' },
    { reviewerConditions: ['unknown'] }, { buyerConfirmed: 'true' }, { decidedByUserId: 'other' }, { conditionsJson: [] }])
    await assert.rejects(() => run(DecideExpenseInputVatDto, { ...body, ...patch }), BadRequestException);
});


it('validates substitute receipt list date order, status, month and paging at the query boundary', async () => {
  const query = (value: unknown) => pipe.transform(value, { type: 'query', metatype: SubstituteReceiptListQueryDto });
  const valid = await query({ order: 'oldest', status: 'ISSUED', yearMonth: '2026-10', page: '2', pageSize: '10' });
  assert.equal(valid.order, 'oldest'); assert.equal(valid.page, 2); assert.equal(valid.pageSize, 10);
  assert.equal((await query({})).order, undefined);
  for (const value of [{ order: 'ascending' }, { status: 'APPROVED' }, { yearMonth: '2026-13' }, { page: '1.5' }, { pageSize: '0' }]) {
    await assert.rejects(() => query(value), BadRequestException);
  }
});

it('office mapping trims values and rejects formula prefixes and controls anywhere in values', async () => {
  const dto = (expenseDtos as any).SetExpenseCategoryAccountantAccountDto;
  assert.equal(typeof dto, 'function');
  const saved = await run(dto, { accountCode: ' 52031 ', accountName: ' ค่าเช่า ' });
  assert.equal(saved.accountCode, '52031'); assert.equal(saved.accountName, 'ค่าเช่า');
  for (const key of ['accountCode', 'accountName']) {
    for (const value of ['', '   ', '=SUM(A1)', '+1', '-1', '@x', 'a\tb', 'a\nb', 'a\u0000b', 'a\u007fb', 'x'.repeat(key === 'accountCode' ? 21 : 121), 123, null]) {
      await assert.rejects(() => run(dto, { accountCode: '52031', accountName: 'ค่าเช่า', [key]: value }), BadRequestException);
    }
  }
});

it('software export DTO requires purchase_journal and preserves accountant filters and pagination', async () => {
  const dto = (expenseDtos as any).AccountingSoftwareExportDto; assert.equal(typeof dto, 'function');
  const result = await run(dto, { preset: 'purchase_journal', page: 2, pageSize: 100, status: '', yearMonth: '2026-09' });
  assert.equal(result.page, 2); assert.equal(result.status, undefined);
  for (const preset of [undefined, 'flowaccount', 'unknown']) await assert.rejects(() => run(dto, { preset }), BadRequestException);
});

it('R17 e-WHT setting requires a boolean DTO and rejects missing, null, string and forged fields', async () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
  const metadata = { type: 'body' as const, metatype: expenseDtos.UpdateExpenseEWhtSettingDto };
  for (const used of [true, false]) assert.equal((await pipe.transform({ used }, metadata)).used, used);
  for (const body of [{}, { used: null }, { used: 'true' }, { used: 1 }, { used: true, companyId: 'other-shop' }]) {
    await assert.rejects(() => pipe.transform(body, metadata), BadRequestException);
  }
});
