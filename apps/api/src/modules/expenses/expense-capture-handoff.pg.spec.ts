/**
 * Real-PostgreSQL proof for the handoff (contract appendix §5/§9, W05).
 *
 * A fake cannot prove any of this. "Two callers, one batch" is a property of a real unique index
 * under real concurrency; "the payer may claim this and a colleague may not" is a property of the
 * real resolver reading real rows; "a claim DRAFT stops the regenerate" is a property of the real
 * `ReimbursementLine`/`ReimbursementRequest` relation; and "the §2.4 lock order does not deadlock
 * against the AI budget" is only a statement about real lock ordering under real contention.
 *
 * Gated like every other `*.pg.spec.ts`: skipped without the URL, failing when CI names a database,
 * and refusing to run against anything but an explicit local host.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';
import type { PrismaService } from '../../common/database/prisma.service';
import { ExpenseCaptureAutoSplitService } from './application/services/expense-capture-auto-split.service';
import { PrismaExpenseCaptureRepository } from './infrastructure/prisma-expense-capture.repository';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import { lockFundingEvidence } from './infrastructure/substitute-funding.guard';
import { readReimbursementSource, resolveReimbursementSourceLines } from '../reimbursements/infrastructure/reimbursement-source';

const databaseUrl = process.env.EXPENSE_CAPTURE_HANDOFF_TEST_DATABASE_URL;
const MONTH = '2026-09';

describe('expense capture handoff on PostgreSQL', { skip: !databaseUrl }, () => {
  const tag = `handoff-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`;
  const userId = `${tag}-user`;
  const payerId = `${tag}-payer`;
  let client: PrismaClient;
  let prisma: PrismaService;
  let capture: PrismaExpenseCaptureRepository;
  let expenses: PrismaExpenseRepository;
  let branchId: string;
  let unreachable: string | null = null;

  const group = async (suffix: string) => (await capture.createGroup(client as never, {
    companyId, branchId, createdByUserId: userId, intakeChannel: 'WEB', note: suffix,
  })).id;

  async function attachment(id: string) {
    await client.attachmentObject.create({
      data: {
        id: `${tag}-${id}`, companyId, branchId, uploadedByUserId: userId, storageProvider: 'local',
        bucket: 'synthetic-local-test', objectKey: `${tag}-${id}`, originalFileName: 'bill.pdf',
        mimeType: 'application/pdf', byteSize: 1_000, checksumSha256: `sha-${id}`, status: 'ACTIVE',
      },
    });
    return `${tag}-${id}`;
  }

  /**
   * A derived source exactly as the handoff writes one: one line, totals that satisfy the identity,
   * the tax review already decided and the payer recorded on the row (§5/§7).
   */
  async function derivedSource(id: string, over: Record<string, unknown> = {}) {
    const expenseId = `${tag}-${id}`;
    await client.expenseRecord.create({
      data: {
        id: expenseId, companyId, branchId, createdByUserId: userId, status: 'NEEDS_REVIEW',
        captureSource: 'WEB_UPLOAD',
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
    expenses = new PrismaExpenseRepository(prisma);
    unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'EXPENSE_CAPTURE_HANDOFF_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.company.create({ data: { id: companyId, name: 'Synthetic handoff company' } });
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
        await client.attachmentLink.deleteMany({ where });
        await client.reimbursementLine.deleteMany({ where });
        await client.reimbursementRequest.deleteMany({ where });
        await client.receiptExtraction.deleteMany({ where });
        await client.expenseLine.deleteMany({ where });
        await client.expenseRecord.deleteMany({ where });
        await client.attachmentObject.deleteMany({ where });
        await client.aiBudgetReservation.deleteMany({ where });
        await client.branch.deleteMany({ where });
        await client.company.delete({ where: { id: companyId } });
        await client.user.deleteMany({ where: { id: { in: [userId, payerId] } } });
      }
    } finally {
      await client.$disconnect();
    }
  });

  /**
   * (a) A10: two tabs press "สร้างรายการค่าใช้จ่าย" at the same instant. The group lock serialises
   * them and the loser sees the winner's batch key, so both callers walk away with the SAME
   * expense ids and the company owes the money once.
   */
  it('gives two concurrent handoffs one batch and the same expense ids', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('concurrent');
    const attachmentId = await attachment('concurrent');
    const batchKey = `${groupId}:alloc-1`;

    // The use case's write, minus the HTTP layer and the allocation maths: lock, replay-or-create.
    const handoff = () => prisma.client.$transaction(async (tx) => {
      await lockFundingEvidence(tx, companyId, { attachmentIds: [attachmentId], expenseIds: [] });
      await capture.lockGroup(tx, companyId, groupId);
      const current = await capture.findGroup(tx, companyId, groupId);
      if (current!.handoffBatchKey === batchKey) {
        return { replayed: true, ids: (await capture.listDerivedSourceStates(tx, companyId, groupId)).map((row) => row.id) };
      }
      const created = await tx.expenseRecord.create({
        data: {
          companyId, branchId, createdByUserId: userId, status: 'NEEDS_REVIEW', captureSource: 'WEB_UPLOAD',
          expenseDate: new Date('2026-09-18T00:00:00.000Z'), currency: 'THB',
          grandTotalAmount: '100', netPayableAmount: '100', outstandingAmount: '100',
          captureGroupId: groupId, captureScopeKey: 'issuer:0105560012345', captureAllocationId: 'alloc-1',
        },
        select: { id: true },
      });
      await capture.bumpRevision(tx, {
        companyId, groupId, expectedRevision: current!.revision,
        data: { status: 'HANDED_OFF', handoffState: 'ACTIVE', handoffBatchKey: batchKey },
      });
      return { replayed: false, ids: [created.id] };
    });

    const [first, second] = await Promise.all([handoff(), handoff()]);
    assert.deepEqual([first!.replayed, second!.replayed].sort(), [false, true], 'one writer, one replay');
    assert.deepEqual(first!.ids, second!.ids, 'both callers are told about the same expense');
    assert.equal(await client.expenseRecord.count({ where: { companyId, captureGroupId: groupId } }), 1);
    assert.equal((await client.expenseCaptureGroup.findUniqueOrThrow({ where: { id: groupId } })).handoffBatchKey, batchKey);
  });

  /**
   * (d) The index, not the application, is what stops a duplicate scope — including after a crash
   * that left the group's own state behind but the row written.
   */
  it('refuses a second source for the same scope even when the group state says otherwise', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('unique');
    await derivedSource('unique-a', { captureGroupId: groupId, captureScopeKey: 'issuer:0105560012345' });
    await assert.rejects(
      () => derivedSource('unique-b', { captureGroupId: groupId, captureScopeKey: 'issuer:0105560012345' }),
      (error: { code?: string }) => error.code === 'P2002',
    );
    // And the batch key is unique company-wide, so a crashed batch cannot be claimed twice.
    const other = await group('unique-2');
    await client.expenseCaptureGroup.update({ where: { id: groupId }, data: { handoffBatchKey: `${groupId}:alloc-1` } });
    await assert.rejects(
      () => client.expenseCaptureGroup.update({ where: { id: other }, data: { handoffBatchKey: `${groupId}:alloc-1` } }),
      (error: { code?: string }) => error.code === 'P2002',
    );
  });

  /**
   * (b) §5/A09/A16: the derived source is a document the reimbursement resolver already accepts —
   * for the recorded payer, and for nobody else. Its sibling in the same group is not a rival
   * reading of the shared file once the claim names which one it means; an expense OUTSIDE the
   * group that uses the same file still is.
   */
  it('passes the resolver for the recorded payer and refuses everybody else', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('resolver');
    const shared = await attachment('resolver');
    const source = await derivedSource('resolver-a', {
      captureGroupId: groupId, captureScopeKey: 'issuer:a', payerUserId: payerId,
    });
    const sibling = await derivedSource('resolver-b', { captureGroupId: groupId, captureScopeKey: 'issuer:b' });
    await link(shared, 'expense.record', source, 'expense.receipt.primary');
    await link(shared, 'expense.record', sibling, 'expense.receipt.primary');
    await link(shared, 'expense.capture_group', groupId, 'expense.capture.evidence');

    const snapshot = await prisma.client.$transaction((tx) =>
      readReimbursementSource(tx, companyId, payerId, branchId, 'THB', source));
    assert.equal(snapshot.payerUserId, payerId);
    assert.equal(snapshot.totals.netPayableAmount, '100.0000');

    // The uploader is not the payer, so the uploader cannot claim it (§5 payer order).
    await assert.rejects(
      () => prisma.client.$transaction((tx) => readReimbursementSource(tx, companyId, userId, branchId, 'THB', source)),
      (error: any) => error.getResponse().code === 'reimbursement_source_wrong_payer',
    );

    const resolve = (linkedExpenseId?: string) => prisma.client.$transaction((tx) =>
      resolveReimbursementSourceLines(tx, companyId, payerId, branchId, 'THB', [{
        lineNo: 1, incurredDate: '2026-09-18', amount: '100', attachmentId: shared,
        ...(linkedExpenseId ? { linkedExpenseId } : {}),
      }]));
    const [named] = await resolve(source);
    assert.equal(named!.linkedExpenseId, source, 'a named sibling is not ambiguous');
    await assert.rejects(() => resolve(), (error: any) => error.getResponse().code === 'reimbursement_source_ambiguous');

    const outsider = await derivedSource('resolver-outsider');
    await link(shared, 'expense.record', outsider, 'expense.receipt.primary');
    await assert.rejects(() => resolve(source), (error: any) => error.getResponse().code === 'reimbursement_source_ambiguous');
  });

  /**
   * (c) §9 regenerate: a DRAFT claim that references a derived source is a live consumption, so the
   * group may not rebuild its batch until that claim is gone.
   */
  it('refuses a regenerate while a claim references a source, and allows it once cancelled', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('consumed');
    const source = await derivedSource('consumed-a', {
      captureGroupId: groupId, captureScopeKey: 'issuer:consumed', payerUserId: payerId,
    });
    assert.deepEqual(await capture.findHandoffConsumers(client as never, companyId, groupId), []);
    assert.equal(await capture.isReopenableAfterHandoff(client as never, companyId, groupId), true);

    const request = await client.reimbursementRequest.create({
      data: {
        companyId, branchId, requesterUserId: payerId, createdByUserId: payerId,
        requesterDisplayNameSnapshot: 'Synthetic payer',
        reason: 'ค่าวัสดุ', categoryKey: 'OTHER', amount: '100', currency: 'THB',
        incurredDate: new Date('2026-09-18T00:00:00.000Z'), status: 'DRAFT',
      },
      select: { id: true },
    });
    // `ReimbursementRequest_fallback_line` already wrote line 1 for this request; point it at the
    // derived source, which is exactly what the claim picker does.
    const linked = await client.reimbursementLine.updateMany({
      where: { companyId, reimbursementRequestId: request.id, lineNo: 1 },
      data: { linkedExpenseId: source },
    });
    assert.equal(linked.count, 1);

    assert.deepEqual(await capture.findHandoffConsumers(client as never, companyId, groupId), [{ expenseId: source, reason: 'claim' }]);
    assert.equal(await capture.isReopenableAfterHandoff(client as never, companyId, groupId), false);

    await client.reimbursementRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED' } });
    assert.deepEqual(await capture.findHandoffConsumers(client as never, companyId, groupId), []);
    assert.equal(await capture.isReopenableAfterHandoff(client as never, companyId, groupId), true);
  });

  it('sees a paid, posted, confirmed or certified source as consumed too', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('consumed-kinds');
    const paid = await derivedSource('kind-paid', {
      captureGroupId: groupId, captureScopeKey: 'issuer:paid', paidAmount: '100', paymentStatus: 'PAID',
    });
    const posted = await derivedSource('kind-posted', {
      captureGroupId: groupId, captureScopeKey: 'issuer:posted', postingStatus: 'posted',
    });
    const confirmed = await derivedSource('kind-confirmed', {
      captureGroupId: groupId, captureScopeKey: 'issuer:confirmed', status: 'CONFIRMED',
    });

    const consumers = await capture.findHandoffConsumers(client as never, companyId, groupId);
    assert.deepEqual(
      consumers.map((row) => [row.expenseId, row.reason]).sort(),
      [[confirmed, 'status'], [paid, 'paid'], [posted, 'posted']].sort(),
    );
  });

  /**
   * (f) §3.1: the converted expense is rewritten in place. Its id survives, and so do the
   * `ReceiptExtraction` rows that record what was read off its file — the allocation replaced the
   * amounts, not the reading history.
   */
  it('keeps the id and the extraction rows when a converted expense is rewritten', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('rewrite');
    const attachmentId = await attachment('rewrite');
    const expenseId = await derivedSource('rewrite-a', {
      captureGroupId: groupId, captureScopeKey: 'issuer:rewrite',
    });
    await link(attachmentId, 'expense.record', expenseId, 'expense.receipt.primary');
    const extraction = await client.receiptExtraction.create({
      data: { companyId, expenseId, attachmentId, status: 'SUCCEEDED', provider: 'synthetic' },
      select: { id: true },
    });

    const before = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    await prisma.client.$transaction(async (tx) => {
      await lockFundingEvidence(tx, companyId, { attachmentIds: [attachmentId], expenseIds: [expenseId] });
      await capture.lockGroup(tx, companyId, groupId);
      const changed = await tx.expenseRecord.updateMany({
        where: { companyId, id: expenseId, updatedAt: before.updatedAt },
        data: { grandTotalAmount: '81', netPayableAmount: '81', outstandingAmount: '81', captureAllocationId: 'alloc-2' },
      });
      assert.equal(changed.count, 1, 'the CAS on updatedAt is what makes a concurrent edit a conflict');
      await tx.expenseLine.deleteMany({ where: { companyId, expenseId } });
      await tx.expenseLine.create({
        data: {
          companyId, expenseId, lineNumber: 1, description: 'ปูน (ส่วนของบริษัท)', quantity: '1',
          unitPrice: '81', taxableAmount: '81', lineSubtotalAmount: '81', lineTotalAmount: '81',
        },
      });
    });

    const after = await client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId } });
    assert.equal(after.id, expenseId);
    assert.equal(after.grandTotalAmount.toString(), '81');
    assert.equal(after.captureAllocationId, 'alloc-2');
    assert.equal(await client.receiptExtraction.count({ where: { companyId, id: extraction.id } }), 1,
      'the reading history belongs to the file, not to the amounts');

    // The release path is the opposite: the row and its lines go, the attachment OBJECT stays
    // because the group still claims the bytes (§2.3).
    const released = await derivedSource('rewrite-b', { captureGroupId: groupId, captureScopeKey: 'issuer:released' });
    await link(attachmentId, 'expense.record', released, 'expense.receipt.supporting');
    const releasedRow = await client.expenseRecord.findUniqueOrThrow({ where: { id: released } });
    assert.equal(await capture.deleteDerivedSource(client as never, companyId, released, releasedRow.updatedAt), true);
    assert.equal(await client.expenseRecord.count({ where: { companyId, id: released } }), 0);
    assert.equal(await client.expenseLine.count({ where: { companyId, expenseId: released } }), 0);
    assert.equal((await client.attachmentObject.findUniqueOrThrow({ where: { id: attachmentId } })).status, 'ACTIVE');
    // A stale CAS token releases nothing.
    assert.equal(await capture.deleteDerivedSource(client as never, companyId, expenseId, new Date(0)), false);
  });

  /**
   * (e) §2.4: `reimbursement-evidence:*` → `expense-capture:<group>` → the AI budget key. Both
   * lanes take their keys in that order, on the same rows, at the same time, twenty times: a cycle
   * would surface here as a Postgres deadlock error.
   */
  it('does not deadlock against the funding-evidence and AI-budget locks under contention', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const groupId = await group('locks');
    const attachmentId = await attachment('locks');
    const expenseId = await derivedSource('locks-a', { captureGroupId: groupId, captureScopeKey: 'issuer:locks' });
    await link(attachmentId, 'expense.record', expenseId, 'expense.receipt.primary');
    await link(attachmentId, 'expense.capture_group', groupId, 'expense.capture.evidence');

    const handoffLane = () => prisma.client.$transaction(async (tx) => {
      await lockFundingEvidence(tx, companyId, { attachmentIds: [attachmentId], expenseIds: [expenseId] });
      await capture.lockGroup(tx, companyId, groupId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${expenseId}:substitute-receipt`}))`;
      await tx.expenseRecord.updateMany({ where: { companyId, id: expenseId }, data: { updatedByUserId: userId } });
    });
    const budgetLane = () => prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${companyId}:${MONTH}`}))`;
      await tx.aiBudgetReservation.count({ where: { companyId } });
    });
    const evidenceLane = () => prisma.client.$transaction(async (tx) => {
      await lockFundingEvidence(tx, companyId, { expenseIds: [expenseId], attachmentIds: [] });
      await capture.listDerivedSourceStates(tx, companyId, groupId);
    });

    for (let round = 0; round < 20; round += 1) {
      await Promise.all([handoffLane(), evidenceLane(), budgetLane(), handoffLane()]);
    }
    assert.equal(await client.expenseRecord.count({ where: { companyId, captureGroupId: groupId } }), 1,
      'the lock order proof changes no business state');
  });

  /**
   * A39: a derived source is an ordinary expense — it appears ONCE in the list, once in the
   * dashboard's pending count and once in the LINE recent-capture lane, and the GROUP appears in
   * none of them. This is run through the real queries rather than argued from the schema, because
   * "no double counting" is a claim about what the consumers return.
   */
  it('counts a derived source once everywhere the money is read, and the group never', async (t) => {
    if (unreachable) return t.skip(unreachable);
    // The dashboard's "ใบเสร็จรอตรวจ" count, verbatim from `expense-summary.provider.ts`.
    const pendingReview = () => client.expenseRecord.count({
      where: {
        companyId, status: { in: ['DRAFT', 'EXTRACTING', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'] },
        substituteReceiptEvidences: { none: { status: 'ISSUED', fundingSource: 'PERSONAL_ADVANCE' } },
      },
    });
    const pendingBefore = await pendingReview();

    const groupId = await group('listing');
    const chatKeyHash = `${tag}-chat`;
    const source = await derivedSource('listing-a', {
      captureGroupId: groupId, captureScopeKey: 'issuer:listing', captureSource: 'LINE_UPLOAD',
      sourceChannelMetadataJson: { channel: 'LINE', kind: 'capture_group', captureGroupId: groupId, chatKeyHash },
    });

    const listed = await expenses.listExpenses({ companyId, page: 1, pageSize: 50 });
    assert.deepEqual(listed.data.filter((row) => row.captureGroupId === groupId).map((row) => row.id), [source],
      'one money row per scope, and the list carries the badge the web renders from');
    assert.equal(listed.data.some((row) => row.id === groupId), false, 'the group is never a list row');

    // One source, one pending row — the group adds nothing to the number beside it.
    assert.equal(await pendingReview(), pendingBefore + 1);

    const recent = await expenses.listRecentLineCaptures({
      companyId, createdByUserId: userId, chatKeyHash, since: new Date('2026-01-01T00:00:00.000Z'),
      scopes: {}, take: 5,
    });
    assert.deepEqual(recent.map((row) => row.id), [source], 'the LINE lane sees the derived source, once');

    // The group lives in its own table, so nothing that reads `ExpenseRecord` can double-count it.
    assert.equal(await client.expenseRecord.count({ where: { companyId, id: groupId } }), 0);
    assert.equal(await client.expenseCaptureGroup.count({ where: { companyId, id: groupId } }), 1);

    // And the detail read model carries the lineage (§5). Appendix §25 withdrew the group page, so
    // the path it carries is the expense list — nothing in the web renders it any more.
    const detail = await expenses.findByIdWithRelations(companyId, source);
    assert.equal(detail!.captureGroup!.groupId, groupId);
    assert.equal(detail!.captureGroup!.webPath, `/companies/${companyId}/expenses`);
    assert.equal((await expenses.findByIdWithRelations(companyId, await derivedSource('listing-plain')))!.captureGroup, null);
  });

  /**
   * Appendix §25 auto-split, against real rows: two documents in one file become two ordinary
   * drafts that share one HANDED_OFF group and one file, are keyed by document ref so a retried
   * drain creates nothing, and — because they share `captureGroupId` — are siblings the W01 rules
   * exempt from each other. The unique `(companyId, captureGroupId, captureScopeKey)` index is the
   * reason the scope keys must be the document refs; only Postgres can prove that.
   */
  it('auto-split writes one sibling draft per further document, exactly once', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const owner = await derivedSource('split-owner', { status: 'DRAFT', grandTotalAmount: '0', netPayableAmount: '0', outstandingAmount: '0', subtotalAmount: '0', taxableAmount: '0' });
    const attachmentId = await attachment('split-file');
    await link(attachmentId, 'expense.record', owner, 'expense.receipt.primary');
    await client.expenseRecord.update({ where: { id: owner }, data: { primaryAttachmentId: attachmentId } });

    const applied: Array<{ expenseId: string; vendor?: string }> = [];
    const service = new ExpenseCaptureAutoSplitService(
      capture, expenses,
      { apply: async (_ctx: unknown, expenseId: string, fields: { vendorName?: string }) => {
        applied.push({ expenseId, ...(fields.vendorName ? { vendor: fields.vendorName } : {}) });
        return { candidatesCreated: 0, committedUpdatedAt: new Date() };
      } } as never,
      { log: async () => undefined } as never,
    );
    const job = { id: `${tag}-split-job`, companyId, ownerType: 'EXPENSE', expenseId: owner, attachmentId };
    const assembled = twoDocumentObservation();

    const first = await service.split({ job, assembled });
    assert.equal(first.applied, true, 'the first document lands on the expense that owns the file');
    assert.equal(Object.keys(first.splitByRef).length, 1, 'one further document, one further draft');
    const siblingId = first.splitByRef['d2']!;
    assert.deepEqual(applied.map((row) => row.vendor), ['ร้าน ก', 'ร้าน ข']);

    const rows = await client.expenseRecord.findMany({
      where: { companyId, id: { in: [owner, siblingId] } },
      select: { id: true, captureGroupId: true, captureScopeKey: true, status: true, createdByUserId: true, captureAllocationId: true },
      orderBy: { captureScopeKey: 'asc' },
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.captureGroupId, rows[1]!.captureGroupId, 'siblings share one group');
    assert.deepEqual(rows.map((row) => row.captureScopeKey), ['doc-1', 'doc-2']);
    assert.equal(rows.find((row) => row.id === siblingId)!.status, 'NEEDS_REVIEW');
    assert.equal(rows.find((row) => row.id === siblingId)!.createdByUserId, userId, 'the original creator owns it');
    assert.equal(rows.find((row) => row.id === siblingId)!.captureAllocationId, null, 'no allocation');

    // The group is HANDED_OFF from the start, so the retention sweep cannot purge a group that live
    // expenses point at, and its batch key is the job — no second batch for one file.
    const created = await client.expenseCaptureGroup.findFirstOrThrow({ where: { companyId, id: rows[0]!.captureGroupId! } });
    assert.equal(created.status, 'HANDED_OFF');
    assert.equal(created.handoffState, 'ACTIVE');
    assert.equal(created.handoffBatchKey, `auto-split:${job.id}`);

    // The SAME bytes are the sibling's receipt too — primary link AND `primaryAttachmentId` —
    // because `validateConfirm` refuses an expense with no primary receipt: a sibling holding the
    // file only as "supporting" evidence could never be confirmed.
    const links = await client.attachmentLink.findMany({
      where: { companyId, attachmentId, targetType: 'expense.record' },
      select: { targetId: true, purpose: true },
    });
    assert.deepEqual(
      links.map((row) => [row.targetId, row.purpose]).sort(),
      [[owner, 'expense.receipt.primary'], [siblingId, 'expense.receipt.primary']].sort(),
    );
    const siblingRow = await client.expenseRecord.findUniqueOrThrow({ where: { id: siblingId }, select: { primaryAttachmentId: true } });
    assert.equal(siblingRow.primaryAttachmentId, attachmentId, 'the sibling owns the file as its primary receipt');

    // A retried drain carries the record it wrote, and creates nothing.
    const replay = await service.split({ job, assembled, alreadySplit: first.splitByRef });
    assert.deepEqual(replay.splitByRef, first.splitByRef);
    assert.equal(await client.expenseRecord.count({ where: { companyId, captureGroupId: created.id } }), 2, 'still two records');
  });
});

/** One file, two shops — each quoting its own printed amount so the eligibility gate lets it past. */
function twoDocumentObservation() {
  const classification = (amount: string) => ({
    contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.9, evidenceSignals: ['ร้าน'], amountSignals: [amount], settlementSignals: [`รวม ${amount}`],
    missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
  });
  return {
    documents: [
      { ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: { name: 'ร้าน ก' }, documentNumber: 'A-1', classification: classification('60.00') },
      { ref: 'd2', pageIndexes: [1], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: { name: 'ร้าน ข' }, documentNumber: 'B-1', classification: classification('40.00') },
    ],
    items: [
      { id: '0:1', documentRef: 'd1', description: 'ปูน', quantity: '1', amount: '60.00', event: 'sale', evidenceSpan: 'ปูน 60.00' },
      { id: '1:1', documentRef: 'd2', description: 'ทราย', quantity: '1', amount: '40.00', event: 'sale', evidenceSpan: 'ทราย 40.00' },
    ],
    components: [],
    totals: [
      { documentRef: 'd1', kind: 'document_total', amount: '60.00', evidenceSpan: 'รวม 60.00' },
      { documentRef: 'd2', kind: 'document_total', amount: '40.00', evidenceSpan: 'รวม 40.00' },
    ],
    payments: [], refunds: [],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0, 1], notes: [] },
    reconciliation: [],
    multiDocument: true,
  } as never;
}
