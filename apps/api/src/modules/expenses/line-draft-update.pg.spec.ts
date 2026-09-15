/**
 * The S-4 preview→confirm round trip against real PostgreSQL (draft-control spec §5.4/§11).
 *
 * Four things no in-memory fake can answer:
 *
 * 1. **The dry run really is dry.** The preview runs the actual `UpdateExpenseDraftUseCase` inside
 *    a transaction it then throws out of. Only a real database proves the rollback: a fake would
 *    happily "roll back" a write it never performed, and the bug this guards against — a preview
 *    that silently saves — is invisible without one.
 * 2. **The totals it promises are the totals it stores.** Same rows, same reconciliation, same
 *    §5.1 identity, compared before and after the apply.
 * 3. **The `updatedAt` CAS.** A web edit landing between the card and the button moves the row
 *    revision; the confirm must refuse, and must leave the web's edit intact.
 * 4. **The audit rows.** `expense.line_ai.draft_preview` at preview and
 *    `expense.line_ai.draft_update` inside the apply transaction — the latter is the durable
 *    provenance of a LINE-made change, so a rollback must take it with it.
 *
 * Run with (the local docker database, or a scratch copy of it):
 *   LINE_DRAFT_EDIT_TEST_DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/expenses/line-draft-update.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import type { RequestContext } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { UpdateExpenseDraftUseCase } from './application/use-cases/expense-draft.use-case';
import { LineDraftUpdateUseCase } from './application/use-cases/line-draft-update.use-case';
import { LineDraftPreviewStore } from './application/services/line-draft-preview.store';
import { ExpenseTransactionTaxService } from './application/services/expense-transaction-tax.service';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import { ReceiptOcrApplyService } from './application/services/receipt-ocr-apply.service';

const databaseUrl = process.env['LINE_DRAFT_EDIT_TEST_DATABASE_URL'];
const CHAT = 'chat-hash-abc';

describe('LINE draft edit preview→confirm on real PostgreSQL', { skip: !databaseUrl }, () => {
  it('keeps equal-time draft choices stable and filters creator, chat and branch before the bounded window', async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(/^\/watchdog_bms(_[a-z0-9_]+)?$/.test(url.pathname)
      || url.port === '15432' && url.pathname === '/mangmee_billing_20260912');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `draft-order-${randomUUID()}`, companyId = `${tag}-co`, userId = `${tag}-user`, foreign = `${tag}-other`;
    const repo = new PrismaExpenseRepository({ client } as never);
    const at = new Date('2026-09-15T00:00:00Z');
    try {
      await client.company.create({ data: { id: companyId, name: 'Draft routing fixture' } });
      await client.user.createMany({ data: [userId, foreign].map(id => ({ id, displayName: 'Draft routing fixture' })) });
      const branch = await client.branch.create({ data: { companyId, code: 'ROUTE', name: 'Scoped branch', type: 'BRANCH' } });
      const otherBranch = await client.branch.create({ data: { companyId, code: 'OTHER', name: 'Outside branch', type: 'BRANCH' } });
      for (const suffix of ['z', 'y', 'x', 'c', 'b', 'a', '0-other-user', '0-other-chat', '0-other-branch']) {
        const creator = suffix === '0-other-user' ? foreign : userId;
        const chat = suffix === '0-other-chat' ? 'another-chat' : CHAT;
        await client.expenseRecord.create({ data: { id: `${tag}-${suffix}`, companyId, createdByUserId: creator,
          branchId: suffix === '0-other-branch' ? otherBranch.id : branch.id, expenseDate: at, updatedAt: at,
          status: 'DRAFT', captureSource: 'LINE_UPLOAD', sourceChannelMetadataJson: { chatKeyHash: chat,
            lineExpenseDraftContinuation: { userId: creator, chatKeyHash: chat, status: 'OPEN' } } } });
      }
      const input = { companyId, userId, chatKeyHash: CHAT, scopes: { branchIds: [branch.id] }, take: 5 };
      const expected = ['a', 'b', 'c', 'x', 'y'].map(id => `${tag}-${id}`);
      assert.deepEqual((await repo.listLineExpenseDraftContinuationRows(input)).map(row => row.id), expected);
      assert.deepEqual((await repo.listLineExpenseDraftContinuationRows(input)).map(row => row.id), expected);
      assert.deepEqual(await repo.listLineExpenseDraftContinuationRows({ ...input, scopes: { branchIds: [] } }), []);
    } finally {
      await client.expenseRecord.deleteMany({ where: { companyId } });
      await client.branch.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: { in: [userId, foreign] } } });
      await client.$disconnect();
    }
  });

  it('commits OCR and duplicates together and refuses stale follow-up summaries without losing human edits', async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(/^\/watchdog_bms(_[a-z0-9_]+)?$/.test(url.pathname)
      || url.port === '15432' && url.pathname === '/mangmee_billing_20260912');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `ocr-source-${randomUUID()}`, companyId = `${tag}-co`, userId = `${tag}-user`;
    const repo = new PrismaExpenseRepository({ client } as never);
    const service = new ReceiptOcrApplyService({ client } as never, repo);
    try {
      await client.company.create({ data: { id: companyId, name: 'OCR source fixture' } });
      await client.user.create({ data: { id: userId, displayName: 'OCR source fixture' } });
      const initial = await client.expenseRecord.create({ data: { companyId, createdByUserId: userId,
        expenseDate: new Date('2026-09-15'), status: 'DRAFT', captureSource: 'LINE_UPLOAD' } });
      const ctx = { companyId, userId }, fields = { vendorName: 'OCR shop', grandTotalAmount: '120', expenseDate: '2026-09-15' };
      const read = () => client.expenseRecord.findUniqueOrThrow({ where: { id: initial.id }, include: { lines: true } });
      const edited = await client.expenseRecord.update({ where: { id: initial.id }, data: {
        vendorNameSnapshot: 'Owner edit before OCR', updatedAt: new Date(initial.updatedAt.getTime() + 1) } });
      const beforeStale = await read();
      assert.equal((await service.apply(ctx, initial.id, fields, { expectedUpdatedAt: initial.updatedAt })).staleSkipped, true);
      assert.deepEqual(await read(), beforeStale, 'stale apply writes no header, line or duplicate state');
      const applied = await service.apply(ctx, initial.id, fields, { expectedUpdatedAt: edited.updatedAt });
      const committed = await read();
      assert.equal(committed.grandTotalAmount.toString(), '120'); assert.equal(committed.lines.length, 1);
      assert.deepEqual(applied.committedUpdatedAt, committed.updatedAt);
      const human = await repo.updateExpense({ id: initial.id, companyId, expectedUpdatedAt: committed.updatedAt,
        updatedByUserId: userId, vendorNameSnapshot: 'Owner edit after OCR',
        updatedAt: new Date(committed.updatedAt.getTime() + 1), aiVerificationSummaryJson: { humanReview: true } });
      const beforeSummary = await read();
      await assert.rejects(() => repo.updateExpense({ id: initial.id, companyId, expectedUpdatedAt: applied.committedUpdatedAt,
        updatedByUserId: userId, aiVerificationSummaryJson: { recognizedFields: fields } }), /changed by another user/);
      assert.deepEqual(await read(), beforeSummary, 'late summary cannot replace the human review');
      await repo.updateExpense({ id: initial.id, companyId, expectedUpdatedAt: human.updatedAt,
        updatedByUserId: userId, note: 'User resumes the same record' });

      const beforeFailure = await read();
      const originalDuplicate = repo.runDuplicateCheck.bind(repo);
      repo.runDuplicateCheck = async (...args: Parameters<typeof repo.runDuplicateCheck>) => {
        await originalDuplicate(...args); throw new Error('synthetic duplicate-stage failure');
      };
      await assert.rejects(() => service.apply(ctx, initial.id, { ...fields, grandTotalAmount: '999' },
        { expectedUpdatedAt: beforeFailure.updatedAt }), /synthetic duplicate-stage failure/);
      assert.deepEqual(await read(), beforeFailure, 'duplicate-stage failure rolls back the header and lines too');
    } finally {
      await client.expenseDuplicateCandidate.deleteMany({ where: { companyId } });
      await client.expenseLine.deleteMany({ where: { companyId } });
      await client.expenseRecord.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    }
  });

  it('previews without writing, applies on confirm, and refuses a stale or non-editable record', async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
    // Localhost alone is NOT proof of a local database: the production access recipe port-forwards
    // prod to 127.0.0.1 through SSM. This spec writes rows, so the name must say local docker too.
    assert.ok(/^\/watchdog_bms(_[a-z0-9_]+)?$/.test(url.pathname)
      || url.port === '15432' && url.pathname === '/mangmee_billing_20260912', 'refusing to write outside an explicit local fixture database');

    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `draftedit-${randomUUID().slice(0, 8)}`;
    const company = `${tag}-co`;
    const otherCompany = `${tag}-co2`;
    const user = `${tag}-user`;
    const audits: Array<{ action: string; targetId?: string; metadataJson?: Record<string, unknown> }> = [];
    const audit = {
      log: async (entry: any) => { audits.push(entry); },
      logOrThrow: async (entry: any) => { audits.push(entry); },
    } as never;

    const repo = new PrismaExpenseRepository({ client } as never);
    // No tax codes on these lines, so `resolveLines` returns them untouched and never reaches the
    // tax config use case — the stub can be empty without weakening what this proves.
    const update = new UpdateExpenseDraftUseCase(repo, audit, new ExpenseTransactionTaxService({} as never));
    const store = new LineDraftPreviewStore();
    const draft = new LineDraftUpdateUseCase(
      { client } as never, repo, update, audit, store,
      { lineAiDraftEditEnabled: true } as never,
    );

    const ctx: RequestContext = {
      requestId: 'req-1', authSubject: user, userId: user, companyId: company,
      membershipId: 'm-1', roles: ['ACCOUNTANT'], permissions: ['expense.update'],
      scopes: {}, authProvider: 'line',
    };
    // "เพิ่มค่าบริการ 10%" — the exact J3 turn. 10 grounds the percent; nothing else is quoted.
    const request = {
      tool: 'expense.draft.add_charge' as const,
      input: { kind: 'SERVICE_CHARGE', percentOfSubtotal: '10' },
      chatKeyHash: CHAT,
      requestId: 'req-1',
      evidence: [{ text: 'จากบิลเมื่อกี้มี service charge 10% นะ', todayIso: '2026-09-05' }],
    };

    try {
      await client.company.createMany({ data: [{ id: company, name: 'Draft Edit Test' }, { id: otherCompany, name: 'Other Co' }] });
      await client.user.create({ data: { id: user, displayName: 'Draft Edit Test' } });
      const expense = await client.expenseRecord.create({
        data: {
          id: `${tag}-exp`, companyId: company, createdByUserId: user, status: 'NEEDS_REVIEW',
          captureSource: 'LINE_UPLOAD', expenseDate: new Date('2026-09-03T00:00:00.000Z'),
          vatMode: 'VAT_EXCLUDED', vendorNameSnapshot: 'BHC',
          subtotalAmount: '1520.0000', discountAmount: '0.0000', taxableAmount: '1520.0000',
          vatAmount: '106.4000', whtAmount: '0.0000', grandTotalAmount: '1626.4000', netPayableAmount: '1626.4000',
          lines: {
            create: [{
              companyId: company, lineNumber: 1, description: 'อาหาร', quantity: '1', unitPrice: '1520',
              discountAmount: '0', taxableAmount: '1520', vatRate: '0.07', vatAmount: '106.4',
              lineSubtotalAmount: '1520', lineTotalAmount: '1626.4',
            }],
          },
        },
      });

      // ── 1. PREVIEW writes nothing ──────────────────────────────────────────────
      const previewed = await draft.preview(ctx, { ...request, expenseId: expense.id });
      assert.equal(previewed.status, 'preview');
      const preview = (previewed as { preview: any }).preview;
      // Prisma Decimal stringifies without trailing zeros, exactly as `mapExpense` does.
      assert.equal(preview.totalsAfter.grandTotalAmount, '1789.04', '1520 + 152 charge + 7% VAT');
      assert.equal(preview.totalsAfter.chargesAmount, '152.00');
      assert.deepEqual(preview.diff.map((entry: any) => [entry.field, entry.after]), [['charge.SERVICE_CHARGE', '152.00']]);

      const afterPreview = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id }, include: { lines: true } });
      assert.equal(afterPreview.lines.length, 1, 'the dry run must not leave a charge row behind');
      assert.equal(afterPreview.grandTotalAmount.toString(), '1626.4', 'the dry run must not move the stored total');
      assert.equal(afterPreview.updatedAt.getTime(), expense.updatedAt.getTime(), 'the dry run must not bump the row revision');
      assert.ok(audits.some((entry) => entry.action === 'expense.line_ai.draft_preview'), 'preview audits at LOW');
      assert.ok(!audits.some((entry) => entry.action === 'expense.line_ai.draft_update'), 'and never as an applied edit');
      assert.equal(await draft.pendingPreview({ ...ctx, permissions: [] }, CHAT), null, 'stored facts still require current permission');
      assert.ok(await draft.pendingPreview(ctx, CHAT), 'an unchanged authorized preview remains available');

      // ── 2. A web edit between the card and the button ──────────────────────────
      await client.expenseRecord.update({ where: { id: expense.id }, data: { vendorNameSnapshot: 'BHC (web edit)' } });
      assert.equal(await draft.pendingPreview(ctx, CHAT), null, 'stale source facts cannot return from the preview reader');
      const raced = await draft.apply(ctx, CHAT, 'evt-race');
      assert.equal(raced.status, 'changed', 'a moved record is refused, never re-based');
      const afterRace = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id }, include: { lines: true } });
      assert.equal(afterRace.lines.length, 1, 'and nothing is written');
      assert.equal(afterRace.vendorNameSnapshot, 'BHC (web edit)', "the web's edit survives untouched");
      assert.equal(await draft.pendingPreview(ctx, CHAT), null, 'the stale proposal is dropped');

      // ── 3. PREVIEW → CONFIRM applies exactly what it promised ──────────────────
      const fresh = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } });
      const second = await draft.preview({ ...ctx, requestId: 'req-2' }, { ...request, requestId: 'req-2', expenseId: expense.id });
      assert.equal(second.status, 'preview');
      const promised = (second as { preview: any }).preview.totalsAfter;
      const applied = await draft.apply({ ...ctx, requestId: 'req-2' }, CHAT, 'evt-confirm');
      assert.equal(applied.status, 'applied');

      const saved = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
      assert.equal(saved.lines.length, 2);
      assert.equal(saved.lines[1]!.chargeKind, 'SERVICE_CHARGE');
      assert.equal(saved.lines[1]!.lineSubtotalAmount.toString(), '152');
      // The promise and the stored fact, compared: subtotal stays goods-only, the charge lands in
      // the tax base exactly once, and the identity still holds (§5.1).
      assert.equal(saved.subtotalAmount.toString(), '1520');
      assert.equal(saved.taxableAmount.toString(), '1672');
      assert.equal(saved.grandTotalAmount.toString(), '1789.04');
      assert.equal(Number(promised.grandTotalAmount), Number(saved.grandTotalAmount.toString()));
      assert.equal(
        Number(saved.taxableAmount.toString()) + Number(saved.vatAmount.toString()),
        Number(saved.grandTotalAmount.toString()),
      );
      assert.ok(saved.updatedAt.getTime() > fresh.updatedAt.getTime(), 'the apply moves the row revision');

      const applyAudit = audits.find((entry) => entry.action === 'expense.line_ai.draft_update');
      assert.ok(applyAudit, 'the apply writes its durable provenance row');
      assert.equal(applyAudit!.targetId, expense.id);
      assert.equal((applyAudit!.metadataJson as any).webhookEventId, 'evt-confirm');
      assert.equal((applyAudit!.metadataJson as any).previewId, (second as { preview: any }).preview.previewId);
      // PDPA §9: ids, hashes and figures only — no image, no raw LINE id, no message text.
      assert.deepEqual(
        Object.keys(applyAudit!.metadataJson as object).sort(),
        ['after', 'before', 'diff', 'previewId', 'tool', 'webhookEventId'],
      );
      assert.equal(await draft.pendingPreview(ctx, CHAT), null, 'the preview is consumed');
      const same = await draft.apply(ctx, CHAT, 'evt-confirm-repeat');
      assert.equal(same.status, 'applied');assert.equal((same as any).replayed, true);
      const revoked = await draft.apply({ ...ctx, permissions: [] }, CHAT, 'evt-confirm-revoked');
      assert.equal(revoked.status, 'blocked');assert.doesNotMatch(JSON.stringify(revoked), /BHC|1789/);
      const outside = await client.branch.create({ data: { companyId: company, code: 'OUTSIDE', name: 'Other scope', type: 'BRANCH' } });
      await client.expenseRecord.update({ where: { id: expense.id }, data: { branchId: outside.id } });
      const moved = await draft.apply({ ...ctx, scopes: { branchIds: [] } }, CHAT, 'evt-confirm-moved');
      assert.equal(moved.status, 'blocked');assert.doesNotMatch(JSON.stringify(moved), /BHC|1789/);
      const changed = await draft.apply(ctx, CHAT, 'evt-confirm-changed');assert.equal(changed.status, 'changed');
      assert.equal(audits.filter(entry => entry.action === 'expense.line_ai.draft_update').length, 1, 'history reads and double taps never rerun the edit');

      // ── 4. Status guard, and cross-company ─────────────────────────────────────
      await client.expenseRecord.update({ where: { id: expense.id }, data: { status: 'CONFIRMED' } });
      const confirmed = await draft.preview({ ...ctx, requestId: 'req-3' }, { ...request, requestId: 'req-3', expenseId: expense.id });
      assert.equal(confirmed.status, 'blocked');
      assert.equal((confirmed as any).reason, 'mutation_blocked');
      const afterBlocked = await client.expenseRecord.findUniqueOrThrow({ where: { id: expense.id }, include: { lines: true } });
      assert.equal(afterBlocked.lines.length, 2, 'a confirmed record is never touched');

      // Another tenant asking for the SAME expense id gets the "no such record" answer, never a
      // different one — the repository's company filter is the boundary, re-checked at preview.
      const foreign = await draft.preview(
        { ...ctx, companyId: otherCompany, requestId: 'req-4' },
        { ...request, requestId: 'req-4', expenseId: expense.id },
      );
      assert.equal(foreign.status, 'blocked');
      assert.equal((foreign as any).reason, 'no_recent_record');
    } finally {
      await client.expenseLine.deleteMany({ where: { companyId: { in: [company, otherCompany] } } });
      await client.expenseRecord.deleteMany({ where: { companyId: { in: [company, otherCompany] } } });
      await client.branch.deleteMany({ where: { companyId: { in: [company, otherCompany] } } });
      await client.company.deleteMany({ where: { id: { in: [company, otherCompany] } } });
      await client.user.deleteMany({ where: { id: user } });
      await client.$disconnect();
    }
  });
});
