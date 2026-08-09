import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  CreateTaxProfileFromTemplateDto,
  GenerateTaxReconciliationDto,
  ResolveTransactionTaxPreviewDto,
  ReviewTaxReconciliationDto,
  VerifyTradeTaxEvidenceDto,
} from './transaction-tax.dtos';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
const run = (metatype: unknown, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: metatype as never });

describe('transaction-tax body DTOs (audit H-23)', () => {
  describe('GenerateTaxReconciliationDto', () => {
    it('accepts a run for a real form and period', async () => {
      const result = await run(GenerateTaxReconciliationDto, { formType: 'PP30', periodKey: '2026-08' });
      assert.equal(result.formType, 'PP30');
      assert.equal(result.periodKey, '2026-08');
    });

    // The repository tests this same YYYY-MM shape and substitutes null when it fails, so a
    // malformed key used to produce a reconciliation over "no period" rather than an error.
    it('refuses a period key the repository would silently turn into null', async () => {
      for (const periodKey of ['2026-8', '2026-08-01', 'สิงหาคม', '', '2026']) {
        await assert.rejects(
          () => run(GenerateTaxReconciliationDto, { formType: 'PP30', periodKey }),
          BadRequestException,
          periodKey,
        );
      }
    });

    it('refuses a form the tax engine does not produce', async () => {
      await assert.rejects(
        () => run(GenerateTaxReconciliationDto, { formType: 'PP31', periodKey: '2026-08' }),
        BadRequestException,
      );
    });

    // This body is forwarded whole into the use case, so an unlisted key used to travel all the
    // way in rather than stopping at the edge.
    it('rejects an extra key instead of carrying it into the use case', async () => {
      await assert.rejects(
        () => run(GenerateTaxReconciliationDto, { formType: 'PP30', periodKey: '2026-08', companyId: 'co-2' }),
        BadRequestException,
      );
    });
  });

  describe('VerifyTradeTaxEvidenceDto', () => {
    it('allows the omitted status the handler defaults to VERIFIED', async () => {
      assert.equal((await run(VerifyTradeTaxEvidenceDto, {})).status, undefined);
    });

    it('refuses a third verdict that downstream comparisons would read as a rejection', async () => {
      for (const status of ['APPROVED', 'verified', true, 0]) {
        await assert.rejects(() => run(VerifyTradeTaxEvidenceDto, { status }), BadRequestException, String(status));
      }
    });

    // class-validator's @IsOptional() skips null as well as undefined, and the handler reads
    // `status ?? 'VERIFIED'`, so an explicit null lands on the same default an omitted field does.
    // Recorded rather than tightened: the two spellings already mean the same thing here.
    it('treats an explicit null exactly as an omitted status', async () => {
      assert.equal((await run(VerifyTradeTaxEvidenceDto, { status: null })).status ?? 'VERIFIED', 'VERIFIED');
    });
  });

  describe('CreateTaxProfileFromTemplateDto', () => {
    it('accepts a calendar day or nothing at all', async () => {
      assert.equal((await run(CreateTaxProfileFromTemplateDto, { effectiveFrom: '2026-01-01' })).effectiveFrom, '2026-01-01');
      assert.equal((await run(CreateTaxProfileFromTemplateDto, {})).effectiveFrom, undefined);
    });

    it('refuses a date that is not a calendar day', async () => {
      for (const effectiveFrom of ['01/01/2026', '2026-1-1', '2026-01-01T00:00:00Z']) {
        await assert.rejects(
          () => run(CreateTaxProfileFromTemplateDto, { effectiveFrom }),
          BadRequestException,
          effectiveFrom,
        );
      }
    });
  });

  describe('ResolveTransactionTaxPreviewDto', () => {
    it('accepts a line with an optional direction', async () => {
      const result = await run(ResolveTransactionTaxPreviewDto, { input: { amount: '100' }, direction: 'INPUT' });
      assert.equal(result.direction, 'INPUT');
    });

    // `input` stays a bounded object rather than a nested DTO — the resolver owns its fields — but
    // a string or array reaching that resolver was never meant to be possible.
    it('refuses an input that is not an object', async () => {
      for (const input of ['{"amount":"100"}', ['100'], 100, null]) {
        await assert.rejects(() => run(ResolveTransactionTaxPreviewDto, { input }), BadRequestException, String(input));
      }
    });

    it('refuses a direction outside the tax engine set', async () => {
      await assert.rejects(
        () => run(ResolveTransactionTaxPreviewDto, { input: {}, direction: 'SIDEWAYS' }),
        BadRequestException,
      );
    });
  });

  describe('ReviewTaxReconciliationDto', () => {
    it('takes an optional note and refuses a non-string one', async () => {
      assert.equal((await run(ReviewTaxReconciliationDto, { note: 'ตรวจแล้ว' })).note, 'ตรวจแล้ว');
      await assert.rejects(() => run(ReviewTaxReconciliationDto, { note: { text: 'x' } }), BadRequestException);
    });
  });
});
