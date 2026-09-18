/**
 * Real-PostgreSQL proof for the capture foundation (contract appendix §2, W01).
 *
 * A fake cannot prove any of this. "One derived source per issuer scope per group" is a property
 * of a real unique index; "one STORED file and one read job under two concurrent completes" and
 * "exactly one winner between two mutations" are properties of a real advisory lock plus a fenced
 * `updateMany`; and "the capture lock does not deadlock against the funding-evidence and AI-budget
 * locks" is only a statement about real lock ordering under real contention.
 *
 * Gated like every other `*.pg.spec.ts`: skipped without the URL, failing when CI names a
 * database, and refusing to run against anything but an explicit local host.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';
import type { PrismaService } from '../../common/database/prisma.service';
import { PrismaExpenseCaptureRepository } from './infrastructure/prisma-expense-capture.repository';
import { lockFundingEvidence } from './infrastructure/substitute-funding.guard';
import { resolveReimbursementSourceLines } from '../reimbursements/infrastructure/reimbursement-source';

const databaseUrl = process.env.EXPENSE_CAPTURE_TEST_DATABASE_URL;
const MONTH = '2026-09';

describe('expense capture foundation on PostgreSQL', { skip: !databaseUrl }, () => {
  const tag = `capture-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`;
  const userId = `${tag}-user`;
  const payerId = `${tag}-payer`;
  let client: PrismaClient;
  let prisma: PrismaService;
  let capture: PrismaExpenseCaptureRepository;
  let branchId: string;
  let unreachable: string | null = null;

  const group = async (suffix: string) => (await capture.createGroup(client as never, {
    companyId, branchId, createdByUserId: userId, intakeChannel: 'WEB', note: suffix,
  })).id;

  async function attachment(id: string, status: 'PENDING_UPLOAD' | 'ACTIVE' = 'ACTIVE') {
    await client.attachmentObject.create({
      data: {
        id: `${tag}-${id}`, companyId, branchId, uploadedByUserId: userId, storageProvider: 'local',
        bucket: 'synthetic-local-test', objectKey: `${tag}-${id}`, originalFileName: 'bill.pdf',
        mimeType: 'application/pdf', byteSize: 1_000, checksumSha256: `sha-${id}`, status,
      },
    });
    return `${tag}-${id}`;
  }

  /** A claimable-shaped expense: one line, totals that satisfy the identity, no tax review owed. */
  async function expense(id: string, over: Record<string, unknown> = {}) {
    const expenseId = `${tag}-${id}`;
    await client.expenseRecord.create({
      data: {
        id: expenseId, companyId, branchId, createdByUserId: userId, status: 'NEEDS_REVIEW',
        expenseDate: new Date('2026-09-18T00:00:00.000Z'), currency: 'THB', vatMode: 'NO_VAT',
        inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY',
        subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', netPayableAmount: '100',
        outstandingAmount: '100', vendorNameSnapshot: 'ร้านวัสดุ',
        lines: {
          create: [{
            companyId, lineNumber: 1, description: 'ปูน', quantity: '1', unitPrice: '100',
            taxableAmount: '100', lineSubtotalAmount: '100', lineTotalAmount: '100',
          }],
        },
        ...over,
      },
    });
    return expenseId;
  }

  const link = (attachmentId: string, targetType: string, targetId: string, purpose: string) =>
    client.attachmentLink.create({ data: { companyId, attachmentId, targetType, targetId, purpose, linkedByUserId: userId } });

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'requires an explicit local test database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 25 }) });
    prisma = { client } as unknown as PrismaService;
    capture = new PrismaExpenseCaptureRepository(prisma);
    unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'EXPENSE_CAPTURE_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.company.create({ data: { id: companyId, name: 'Synthetic capture company' } });
    await client.user.createMany({ data: [
      { id: userId, displayName: 'Synthetic uploader', status: 'ACTIVE' },
      { id: payerId, displayName: 'Synthetic payer', status: 'ACTIVE' },
    ] });
    branchId = (await client.branch.create({ data: { companyId, code: 'HOME', name: 'Home', type: 'HEAD_OFFICE' } })).id;
  });

  after(async () => {
    if (!client) return;
    try {
      if (!unreachable) {
        const where = { companyId };
        await client.expenseCaptureReadJob.deleteMany({ where });
        await client.expenseCaptureObservation.deleteMany({ where });
        await client.expenseCaptureAllocation.deleteMany({ where });
        await client.expenseCaptureFile.deleteMany({ where });
        await client.expenseCaptureGroup.deleteMany({ where });
        await client.lineIntakeAttempt.deleteMany({ where });
        await client.attachmentLink.deleteMany({ where });
        await client.expenseLine.deleteMany({ where });
        await client.expenseRecord.deleteMany({ where });
        await client.attachmentObject.deleteMany({ where });
        await client.aiBudgetReservation.deleteMany({ where });
        await client.companyAiConfiguration.deleteMany({ where });
        await client.branch.deleteMany({ where });
        await client.company.delete({ where: { id: companyId } });
        await client.user.deleteMany({ where: { id: { in: [userId, payerId] } } });
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses a second derived source for the same issuer scope in one group (§2.3 handoff fence)', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('scope');
    const first = await expense('scope-a', { captureGroupId: groupId, captureScopeKey: 'issuer:0105560012345' });
    assert.ok(first);

    await assert.rejects(
      () => expense('scope-b', { captureGroupId: groupId, captureScopeKey: 'issuer:0105560012345' }),
      (error: { code?: string }) => error.code === 'P2002',
      'the unique index, not application code, is what stops a double handoff',
    );

    // Another scope in the same group, and the same scope in another group, are both fine.
    await expense('scope-c', { captureGroupId: groupId, captureScopeKey: 'issuer:9999999999999' });
    await expense('scope-d', { captureGroupId: await group('scope-2'), captureScopeKey: 'issuer:0105560012345' });
    // And the index leaves ordinary expenses alone: NULLs are distinct, so any number coexist.
    await expense('plain-a');
    await expense('plain-b');
  });

  it('holds one facts version per CONVERTED expense, where the file-keyed unique cannot (W07-int)', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('converted');
    const expenseId = await expense('converted');
    const write = (version: number) => capture.createObservation(client as never, {
      companyId, groupId, expenseId, fileId: null, version, source: 'HUMAN',
      payloadJson: { documents: [], items: [], components: [], totals: [], payments: [], refunds: [] },
      createdByUserId: userId,
    });

    await write(1);
    // `@@unique([companyId, fileId, version])` counts every NULL as distinct, so it allows this;
    // the partial index added with `linePushTargetId` is what refuses it.
    await assert.rejects(() => write(1), (error: { code?: string }) => error.code === 'P2002',
      'two corrections cannot both become version 1 of the same expense');

    // A different version of the same expense, and the same version of another expense, are fine.
    await write(2);
    await capture.createObservation(client as never, {
      companyId, groupId, expenseId: await expense('converted-2'), fileId: null, version: 1, source: 'HUMAN',
      payloadJson: { documents: [], items: [], components: [], totals: [], payments: [], refunds: [] },
      createdByUserId: userId,
    });
    // And a file-keyed observation is untouched by it (the index only covers `fileId IS NULL`).
    const fileRow = await capture.createFile(client as never, {
      companyId, groupId, attachmentId: await attachment('converted-file'), position: 9,
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 1_000, addedByUserId: userId,
    });
    await capture.createObservation(client as never, {
      companyId, groupId, fileId: fileRow.id, version: 1, source: 'AI',
      payloadJson: { documents: [], items: [], components: [], totals: [], payments: [], refunds: [] },
    });
  });

  it('keeps `handoffBatchKey` unique across the whole company (§9 idempotency)', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const first = await group('handoff-1');
    const second = await group('handoff-2');
    await client.expenseCaptureGroup.update({ where: { id: first }, data: { handoffBatchKey: `${first}:1` } });
    await assert.rejects(
      () => client.expenseCaptureGroup.update({ where: { id: second }, data: { handoffBatchKey: `${first}:1` } }),
      (error: { code?: string }) => error.code === 'P2002',
    );
  });

  it('stores a file once and queues one read job under two concurrent completions', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('complete');
    const attachmentId = await attachment('complete', 'PENDING_UPLOAD');
    const file = await capture.createFile(client as never, {
      companyId, groupId, attachmentId, position: 1, originalFileName: 'bill.pdf',
      mimeType: 'application/pdf', byteSize: 1_000, addedByUserId: userId,
    });

    // Exactly what the use case does, minus the HTTP layer: lock the group, CAS the file state,
    // and only the winner creates the job.
    const complete = () => prisma.client.$transaction(async (tx) => {
      await capture.lockGroup(tx, companyId, groupId);
      const stored = await capture.markFileStored(tx, { companyId, fileId: file.id, checksumSha256: 'sha-complete', byteSize: 1_000 });
      if (!stored) return 'replayed';
      await capture.createReadJob(tx, {
        companyId, ownerType: 'CAPTURE_GROUP', groupId, fileId: file.id, attachmentId,
        attachmentChecksum: 'sha-complete', ocrAdmissionRequestId: randomUUID(),
        manifestJson: { pageCount: null, pages: [], chunks: [], windows: [], electronicVerification: { status: 'NOT_CHECKED' } },
      });
      return 'stored';
    });

    const outcomes = await Promise.all([complete(), complete()]);
    assert.deepEqual(outcomes.sort(), ['replayed', 'stored']);
    assert.equal((await client.expenseCaptureFile.findUniqueOrThrow({ where: { id: file.id } })).uploadState, 'STORED');
    assert.equal(await client.expenseCaptureReadJob.count({ where: { companyId, fileId: file.id } }), 1,
      'one file, one admitted read — the OCR quota cannot be spent twice by a lost response');
  });

  it('gives exactly one winner when two mutations CAS the same revision', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('revision');
    const mutate = (reason: string) => prisma.client.$transaction(async (tx) => {
      await capture.lockGroup(tx, companyId, groupId);
      return capture.bumpRevision(tx, {
        companyId, groupId, expectedRevision: 1,
        data: { status: 'CANCELLED', closedReason: reason, closedAt: new Date() },
      });
    });

    const results = await Promise.all([mutate('CANCELLED'), mutate('NO_COMPANY_PORTION')]);
    assert.deepEqual(results.filter((revision) => revision !== null), [2], 'one winner, one conflict');
    const row = await client.expenseCaptureGroup.findUniqueOrThrow({ where: { id: groupId } });
    assert.equal(row.revision, 2);
  });

  /**
   * §2.4: `<company>:duplicate-reconciliation` → `<company>:reimbursement-evidence:*` →
   * `<company>:expense-capture:<group>` → `<company>:<expense>:substitute-receipt` →
   * `ai-budget:<company>:<month>`. Both lanes take their keys in that order, on the same rows, at
   * the same time, twenty times: a cycle would surface as a Postgres deadlock error here.
   */
  it('does not deadlock against the funding-evidence and AI-budget locks in the §2.4 order', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('locks');
    const attachmentId = await attachment('locks');
    const expenseId = await expense('locks');
    await link(attachmentId, 'expense.record', expenseId, 'expense.receipt.primary');
    await link(attachmentId, 'expense.capture_group', groupId, 'expense.capture.evidence');

    const captureThenBudget = () => prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:duplicate-reconciliation`}))`;
      await lockFundingEvidence(tx, companyId, { attachmentIds: [attachmentId], expenseIds: [expenseId] });
      await capture.lockGroup(tx, companyId, groupId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${companyId}:${MONTH}`}))`;
      await tx.expenseCaptureGroup.update({ where: { id: groupId }, data: { updatedAt: new Date() } });
    });
    const evidenceThenCapture = () => prisma.client.$transaction(async (tx) => {
      await lockFundingEvidence(tx, companyId, { attachmentIds: [attachmentId], expenseIds: [expenseId] });
      await capture.lockGroup(tx, companyId, groupId);
      await tx.expenseCaptureFile.count({ where: { companyId, groupId } });
    });
    const budgetOnly = () => prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${companyId}:${MONTH}`}))`;
      await tx.aiBudgetReservation.count({ where: { companyId } });
    });

    for (let round = 0; round < 20; round += 1) {
      await Promise.all([captureThenBudget(), evidenceThenCapture(), budgetOnly(), captureThenBudget()]);
    }
    assert.equal((await client.expenseCaptureGroup.findUniqueOrThrow({ where: { id: groupId } })).revision, 1,
      'the lock order proof changes no business state');
  });

  it('resolves a named sibling, still refuses an outsider, and accepts the recorded payer', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('resolver');
    const shared = await attachment('resolver');
    const sibling = await expense('resolver-a', { captureGroupId: groupId, captureScopeKey: 'issuer:a', payerUserId: payerId });
    const twin = await expense('resolver-b', { captureGroupId: groupId, captureScopeKey: 'issuer:b' });
    await link(shared, 'expense.record', sibling, 'expense.receipt.primary');
    await link(shared, 'expense.record', twin, 'expense.receipt.primary');
    await link(shared, 'expense.capture_group', groupId, 'expense.capture.evidence');

    const resolve = (requester: string, linkedExpenseId?: string) => prisma.client.$transaction((tx) =>
      resolveReimbursementSourceLines(tx, companyId, requester, branchId, 'THB', [{
        lineNo: 1, incurredDate: '2026-09-18', amount: '100', attachmentId: shared,
        ...(linkedExpenseId ? { linkedExpenseId } : {}),
      }]));

    // Named sibling: the group's other source is not a rival reading of the same file, and the
    // recorded payer claims it without any certificate.
    const [line] = await resolve(payerId, sibling);
    assert.equal(line!.linkedExpenseId, sibling);
    assert.equal(line!.sourceExpenseSnapshot!.payerUserId, payerId);
    assert.equal(line!.sourceExpenseSnapshot!.totals.netPayableAmount, '100.0000');

    // Nobody named: two sources still make the file ambiguous, exactly as before.
    await assert.rejects(() => resolve(payerId), (error: any) => error.getResponse().code === 'reimbursement_source_ambiguous');

    // An expense OUTSIDE the group sharing the file keeps the claim ambiguous even when named.
    const outsider = await expense('resolver-c');
    await link(shared, 'expense.record', outsider, 'expense.receipt.primary');
    await assert.rejects(() => resolve(payerId, sibling), (error: any) => error.getResponse().code === 'reimbursement_source_ambiguous');
  });

  it('records and reads back a LINE intake attempt without keeping the raw file name', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const created = await capture.recordLineIntakeAttempt({
      companyId, lineUserIdHash: `${tag}-hash`, chatKeyHash: `${tag}-chat`, messageType: 'file',
      fileNameSanitized: '/var/tmp/../ใบเสร็จ.pdf', declaredFileSize: 1_000,
      capabilityJson: { maxBytes: 10_485_760, allowedMimeTypes: ['application/pdf'], pdfAutomaticRead: true },
      stage: 'DOWNLOAD', reasonCode: 'LINE_MEDIA_DOWNLOAD_FAILED',
    });
    assert.equal(created.fileNameSanitized, 'ใบเสร็จ.pdf');
    assert.equal(created.outcome, 'UNKNOWN');

    assert.equal(await capture.updateLineIntakeAttemptOutcome({
      id: created.id, outcome: 'STORED_READING', stage: 'PERSIST', reasonCode: 'stored',
      targetType: 'capture_group', targetId: `${tag}-group`,
    }), true);

    const [row] = await capture.listLineIntakeAttempts({ companyId, lineUserIdHash: `${tag}-hash`, take: 5 });
    assert.equal(row!.outcome, 'STORED_READING');
    assert.equal(row!.targetType, 'capture_group');
    // Another chat's question must never read this one's attempts.
    assert.deepEqual(await capture.listLineIntakeAttempts({ companyId, lineUserIdHash: 'someone-else' }), []);
  });
});
