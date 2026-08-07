import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  ApplyChartTemplateDto,
  CreateChartOfAccountDto,
  CreateManualJournalDto,
  GenerateJournalFromSourceDto,
  UpdateChartOfAccountDto,
} from './ledger.dtos';

// The exact global-pipe configuration main.ts registers — this is the runtime
// gate that closes H-02 (mass assignment on chart-of-account create/update).
const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const validCreate = {
  code: '1110-99',
  nameTh: 'เงินสดสาขาย่อย',
  accountClass: 'ASSET',
  normalBalance: 'DEBIT',
};

async function rejects(metatype: any, body: Record<string, unknown>) {
  await assert.rejects(
    () => pipe.transform(body, { type: 'body', metatype }),
    BadRequestException,
    `expected rejection for ${JSON.stringify(body)}`,
  );
}

describe('CreateChartOfAccountDto (H-02)', () => {
  it('accepts a valid create payload', async () => {
    const out = await pipe.transform(
      { ...validCreate, nameEn: 'Petty cash', reportGroup: 'cash', isPosting: true, taxCategory: 'none', cashFlowCategory: 'operating', parentAccountId: 'acc_1' },
      { type: 'body', metatype: CreateChartOfAccountDto },
    );
    assert.equal(out.code, '1110-99');
    assert.equal(out.isPosting, true);
  });

  it('rejects every tenant/system field outside the allowlist', async () => {
    for (const poison of [
      { companyId: 'other-tenant' },
      { isSystem: true },
      { isControlled: true },
      { id: 'acc_hijack' },
      { status: 'INACTIVE' },
      { createdByUserId: 'someone-else' },
    ]) {
      await rejects(CreateChartOfAccountDto, { ...validCreate, ...poison });
    }
  });

  it('rejects invalid enum values and missing required fields', async () => {
    await rejects(CreateChartOfAccountDto, { ...validCreate, accountClass: 'GLOBAL' });
    await rejects(CreateChartOfAccountDto, { ...validCreate, normalBalance: 'BOTH' });
    await rejects(CreateChartOfAccountDto, { nameTh: 'ไม่มีรหัส', accountClass: 'ASSET', normalBalance: 'DEBIT' });
  });
});

describe('UpdateChartOfAccountDto (H-02)', () => {
  it('accepts a valid update payload', async () => {
    const out = await pipe.transform(
      { nameTh: 'ชื่อใหม่', status: 'INACTIVE' },
      { type: 'body', metatype: UpdateChartOfAccountDto },
    );
    assert.equal(out.status, 'INACTIVE');
  });

  it('rejects immutable identity/tenant/system fields on update', async () => {
    for (const poison of [
      { companyId: 'other-tenant' },
      { isSystem: true },
      { isControlled: true },
      { code: '9999-99' },
      { accountClass: 'LIABILITY' },
      { normalBalance: 'CREDIT' },
      { isPosting: false },
      { parentAccountId: 'acc_x' },
      { updatedByUserId: 'someone-else' },
    ]) {
      await rejects(UpdateChartOfAccountDto, { nameTh: 'x', ...poison });
    }
  });

  it('rejects unknown status values', async () => {
    await rejects(UpdateChartOfAccountDto, { status: 'ARCHIVED' });
  });

  it('rejects explicit null on NOT NULL columns but allows null to clear nullable ones', async () => {
    await rejects(UpdateChartOfAccountDto, { nameTh: null });
    await rejects(UpdateChartOfAccountDto, { status: null });
    const out = await pipe.transform({ nameEn: null, taxCategory: null }, { type: 'body', metatype: UpdateChartOfAccountDto });
    assert.equal(out.nameEn, null);
    assert.equal(out.taxCategory, null);
  });
});

describe('ApplyChartTemplateDto', () => {
  const valid = {
    expectedTemplateChecksum: 'a'.repeat(64),
    expectedPreviewChecksum: 'b'.repeat(64),
  };

  it('accepts checksum-guarded modes and acknowledgement', async () => {
    const out = await pipe.transform(
      { ...valid, mode: 'REPLACE_UNUSED', acknowledgeConflicts: true },
      { type: 'body', metatype: ApplyChartTemplateDto },
    );
    assert.equal(out.mode, 'REPLACE_UNUSED');
    assert.equal(out.acknowledgeConflicts, true);
  });

  it('rejects malformed checksums, modes, and unknown fields', async () => {
    await rejects(ApplyChartTemplateDto, { ...valid, expectedPreviewChecksum: 'short' });
    await rejects(ApplyChartTemplateDto, { ...valid, mode: 'REPLACE_ALL' });
    await rejects(ApplyChartTemplateDto, { ...valid, companyId: 'other-tenant' });
  });
});

describe('CreateManualJournalDto (H-03)', () => {
  const valid = {
    entryDate: '2026-07-18',
    memo: 'ปรับปรุงบัญชี',
    lines: [
      { accountId: 'acc_debit', branchId: 'branch_1', description: 'เดบิต', debitAmount: '100.00', currency: 'THB' },
      { accountId: 'acc_credit', branchId: 'branch_1', description: 'เครดิต', creditAmount: '100.00', currency: 'THB' },
    ],
  };

  it('accepts only the manual journal business fields', async () => {
    const out = await pipe.transform(valid, { type: 'body', metatype: CreateManualJournalDto });
    assert.equal(out.lines.length, 2);
    assert.equal(out.lines[0].branchId, 'branch_1');
  });

  it('rejects caller-owned tenant, status, provenance, tax, and report metadata', async () => {
    for (const poison of [
      { companyId: 'other-company' }, { sourceType: 'expense.record' }, { sourceId: 'source-1' },
      { taxCode: 'VAT7' }, { taxSnapshot: {} }, { taxComponentKey: 'OUTPUT_VAT' },
      { reportContributions: [] }, { status: 'POSTED' }, { createdByUserId: 'other-user' },
    ]) {
      await rejects(CreateManualJournalDto, { ...valid, lines: [{ ...valid.lines[0], ...poison }, valid.lines[1]] });
    }
    await rejects(CreateManualJournalDto, { ...valid, companyId: 'other-company' });
    await rejects(CreateManualJournalDto, { ...valid, sourceType: 'expense.record' });
  });

  it('rejects malformed dates, amounts, and undersized journals', async () => {
    await rejects(CreateManualJournalDto, { ...valid, entryDate: '2026-02-30' });
    await rejects(CreateManualJournalDto, { ...valid, lines: [{ ...valid.lines[0], debitAmount: '1e6' }, valid.lines[1]] });
    await rejects(CreateManualJournalDto, { ...valid, lines: [valid.lines[0]] });
  });
});

describe('GenerateJournalFromSourceDto (G1)', () => {
  it('accepts the two shapes apps/web posts to /posting/generate', async () => {
    // ledger.api.ts sends {sourceType, sourceId}; accounts-payable.api.ts adds sourceEventType.
    const short = await pipe.transform({ sourceType: 'expense.record', sourceId: 'exp_1' }, { type: 'body', metatype: GenerateJournalFromSourceDto });
    assert.equal(short.sourceId, 'exp_1');
    const full = await pipe.transform(
      { sourceType: 'procurement.vendor_bill', sourceId: 'vb_1', sourceEventType: 'procurement.vendor_bill.pp36_payment' },
      { type: 'body', metatype: GenerateJournalFromSourceDto },
    );
    assert.equal(full.sourceEventType, 'procurement.vendor_bill.pp36_payment');
  });

  it('rejects a caller-authored posting body — the source is rebuilt from the database', async () => {
    for (const poison of [
      { lines: [{ accountId: 'acc_1', debitAmount: '1000000.00' }] },
      { periodKey: '2020-01' },
      { companyId: 'other-tenant' },
      { idempotencyKey: 'forged' },
      { grossAmount: '999999.00' },
    ]) {
      await rejects(GenerateJournalFromSourceDto, { sourceType: 'expense.record', sourceId: 'exp_1', ...poison });
    }
  });

  it('requires both source identifiers', async () => {
    await rejects(GenerateJournalFromSourceDto, { sourceType: 'expense.record' });
    await rejects(GenerateJournalFromSourceDto, { sourceId: 'exp_1' });
    await rejects(GenerateJournalFromSourceDto, { sourceType: '', sourceId: 'exp_1' });
  });
});
