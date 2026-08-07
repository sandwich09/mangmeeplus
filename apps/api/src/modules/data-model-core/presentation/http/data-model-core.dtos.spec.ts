import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  CompleteAttachmentUploadDto, CreateBranchDto, CreateUploadIntentDto, LinkAttachmentDto,
  UpdateBranchDto, UpsertDocumentSequenceDto,
} from './data-model-core.dtos';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const accepts = (metatype: any, body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype });

async function rejects(metatype: any, body: Record<string, unknown>, label?: string) {
  await assert.rejects(
    () => pipe.transform(body, { type: 'body', metatype }),
    BadRequestException,
    label ?? `expected rejection for ${JSON.stringify(body)}`,
  );
}

describe('attachment upload DTOs', () => {
  // The identical shape posted by expenses.api.ts, reimbursements.api.ts, and
  // transaction-tax.api.ts.
  const valid = { originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 204_800, visibility: 'INTERNAL' };

  it('accepts the upload-intent payload every uploader sends', async () => {
    const out = await accepts(CreateUploadIntentDto, valid);
    assert.equal(out.byteSize, 204_800);
    assert.equal(out.visibility, 'INTERNAL');
  });

  it('accepts the branch-scoped variant expenses and tax evidence send', async () => {
    const out = await accepts(CreateUploadIntentDto, { ...valid, branchId: 'br_1' });
    assert.equal(out.branchId, 'br_1');
  });

  it('rejects an unknown visibility and a non-numeric byteSize', async () => {
    await rejects(CreateUploadIntentDto, { ...valid, visibility: 'PUBLIC' });
    await rejects(CreateUploadIntentDto, { ...valid, byteSize: '204800' });
    await rejects(CreateUploadIntentDto, { ...valid, byteSize: -1 });
    await rejects(CreateUploadIntentDto, { mimeType: 'image/jpeg', byteSize: 1 });
  });

  it('rejects storage fields the intent issues itself', async () => {
    for (const poison of [{ companyId: 'other' }, { storageKey: 'a/b' }, { status: 'ACTIVE' }, { attachmentId: 'att_1' }]) {
      await rejects(CreateUploadIntentDto, { ...valid, ...poison });
    }
  });

  it('accepts the {byteSize} completion body and a real sha256', async () => {
    assert.equal((await accepts(CompleteAttachmentUploadDto, { byteSize: 204_800 })).byteSize, 204_800);
    const sha = 'a'.repeat(64);
    assert.equal((await accepts(CompleteAttachmentUploadDto, { checksumSha256: sha })).checksumSha256, sha);
    assert.deepEqual({ ...(await accepts(CompleteAttachmentUploadDto, {})) }, { checksumSha256: undefined, byteSize: undefined });
  });

  it('rejects a checksum that is not hex sha256', async () => {
    await rejects(CompleteAttachmentUploadDto, { checksumSha256: 'not-a-hash' });
    await rejects(CompleteAttachmentUploadDto, { checksumSha256: 'a'.repeat(63) });
  });

  it('requires the full triple to link an attachment', async () => {
    const out = await accepts(LinkAttachmentDto, { targetType: 'expense_record', targetId: 'exp_1', purpose: 'RECEIPT' });
    assert.equal(out.purpose, 'RECEIPT');
    await rejects(LinkAttachmentDto, { targetType: 'expense_record', targetId: 'exp_1' });
    await rejects(LinkAttachmentDto, { targetType: 'expense_record', targetId: 'exp_1', purpose: 'RECEIPT', companyId: 'other' });
  });
});

describe('branch DTOs', () => {
  // BranchSettingsPage.tsx create/update forms
  const valid = { code: 'HQ', name: 'สำนักงานใหญ่', type: 'HEAD_OFFICE', taxBranchCode: '00000' };

  it('accepts the branch settings create payload', async () => {
    const out = await accepts(CreateBranchDto, valid);
    assert.equal(out.type, 'HEAD_OFFICE');
  });

  it('accepts the update payload including a status change', async () => {
    const out = await accepts(UpdateBranchDto, { name: 'สาขาใหม่', phone: '021234567', email: 'branch@example.com', status: 'DISABLED' });
    assert.equal(out.status, 'DISABLED');
  });

  it('accepts null as the explicit request to clear a tax branch code', async () => {
    const out = await accepts(UpdateBranchDto, { taxBranchCode: null });
    assert.equal(out.taxBranchCode, null);
  });

  it('rejects unknown branch types and statuses', async () => {
    await rejects(CreateBranchDto, { ...valid, type: 'FRANCHISE' });
    await rejects(UpdateBranchDto, { status: 'DELETED' });
  });

  it('rejects code changes and tenant fields on update', async () => {
    await rejects(UpdateBranchDto, { name: 'x', code: 'HQ2' });
    await rejects(UpdateBranchDto, { name: 'x', companyId: 'other' });
    await rejects(UpdateBranchDto, { name: 'x', type: 'BRANCH' });
  });
});

describe('UpsertDocumentSequenceDto', () => {
  const valid = { periodKey: '2026-07', prefixTemplate: 'INV-{YY}{MM}-', padding: 5, resetPolicy: 'MONTHLY' };

  it('accepts the uppercase reset policy the column actually stores', async () => {
    const out = await accepts(UpsertDocumentSequenceDto, valid);
    assert.equal(out.resetPolicy, 'MONTHLY');
  });

  it('rejects the lowercase values the stale contracts union used to advertise', async () => {
    // These would have reached Prisma as an invalid enum and answered 500.
    await rejects(UpsertDocumentSequenceDto, { ...valid, resetPolicy: 'monthly' });
    await rejects(UpsertDocumentSequenceDto, { ...valid, resetPolicy: 'none' });
  });

  it('rejects a caller-set counter or document type', async () => {
    await rejects(UpsertDocumentSequenceDto, { ...valid, nextNumber: 500 });
    await rejects(UpsertDocumentSequenceDto, { ...valid, documentType: 'other.type' });
    await rejects(UpsertDocumentSequenceDto, { ...valid, padding: 0 });
  });
});
