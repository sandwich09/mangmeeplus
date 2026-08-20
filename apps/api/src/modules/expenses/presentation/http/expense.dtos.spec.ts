import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
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
  });

  describe('RecordExpensePaymentDto', () => {
    it('accepts an ordinary payment', async () => {
      const result = await run(RecordExpensePaymentDto, { paidAmount: '1070.25', paymentMethod: 'TRANSFER' });
      assert.equal(result.paidAmount, '1070.25');
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
