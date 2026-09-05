/**
 * Two rules on one class, kept in one file because they are one class:
 *
 *  1. (slice A) the note is APPENDED, never overwritten, and the reply says what happened;
 *  2. (slice D) `amount` belongs to this lane only while `LINE_AI_DRAFT_EDIT_ENABLED` is OFF.
 *
 * The second exists because S-4 first removed `amount` unconditionally, which would have made
 * the flag a one-way door rather than a rollback: switching it off would have left a lane that
 * silently stopped applying a correction it used to apply. Only a test that runs BOTH positions
 * can say otherwise.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { CorrectLineCapturedExpenseUseCase } from './line-correction.use-case';

const OWNER_TURN = 'จากบิลเมื่อกี้มี service charge 10% นะ แก้ไขได้ใช่ไหม';
const TODAY = '2026-09-03';

const ctx = (): RequestContext => ({
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'm-1', roles: ['OWNER'], permissions: ['expense.update'], scopes: {}, authProvider: 'line',
} as unknown as RequestContext);

function harness(recordOverrides: Record<string, unknown> = {}) {
  const draftUpdates: any[] = [];
  const audits: any[] = [];
  const record = {
    id: 'expense-1', companyId: 'company-1', createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
    branchId: 'branch-1', updatedAt: new Date('2026-09-03T04:00:00.000Z'),
    note: 'LINE receipt upload', expenseDate: new Date('2026-09-03T00:00:00.000Z'),
    grandTotalAmount: '1789.04', vendorNameSnapshot: 'BHC', vendorDocumentNumber: 'A-1',
    sourceDocumentType: 'RECEIPT', aiVerificationSummaryJson: null,
    lines: [{ description: 'ข้าวผัด', vatAmount: '117.04', whtAmount: '0' }],
    ...recordOverrides,
  };
  const tx = {
    $executeRaw: async () => 0,
    outboxEvent: { findFirst: async () => null, create: async () => undefined },
    expenseRecord: { findFirst: async () => record },
  };
  const useCase = new CorrectLineCapturedExpenseUseCase(
    { client: { $transaction: async (fn: any) => fn(tx) } } as any,
    { updateExpense: async () => undefined } as any,
    { execute: async (_c: unknown, _id: string, input: any) => { draftUpdates.push(input); } } as any,
    { log: async (entry: any) => { audits.push(entry); } } as any,
  );
  return { useCase, draftUpdates, audits, record };
}

const noteTurn = (text = OWNER_TURN) => ({
  lineMessageIdHash: 'hash-1',
  candidates: [{ id: 'expense-1', label: 'BHC 1,789.04' }] as never,
  hints: { note: { to: text } } as never,
  evidence: [{ text, todayIso: TODAY }],
});

describe('LINE correction: the note is appended, never overwritten (spec §5.3)', () => {
  it('keeps the capture provenance in front of what the user said', async () => {
    const { useCase, draftUpdates } = harness();

    const outcome = await useCase.execute(ctx(), noteTurn());

    assert.equal(outcome.status, 'applied');
    const written: string = draftUpdates[0].note;
    assert.ok(written.startsWith('LINE receipt upload'), `provenance must survive, got: ${written}`);
    assert.ok(written.includes(`ผู้ใช้แจ้ง: ${OWNER_TURN}`), 'and what the user said must be there too');
  });

  it('records in the audit that the write was an append, not a replacement', async () => {
    const { useCase, audits } = harness();

    await useCase.execute(ctx(), noteTurn());

    const applied = audits.find((entry) => entry.action === 'expense.line_correction.apply');
    assert.equal(applied.metadataJson.noteAppend, 'appended', 'and WHICH append — a truncated one is not the same event');
  });

  it('changes no money at all — that is the whole point of the honest reply', async () => {
    const { useCase, draftUpdates } = harness();

    await useCase.execute(ctx(), noteTurn());

    assert.deepEqual(Object.keys(draftUpdates[0]).sort(), ['expectedUpdatedAt', 'note']);
  });

  it('stays inside 500 characters however long the chat runs', async () => {
    const { useCase, draftUpdates } = harness({ note: 'LINE receipt upload'.padEnd(480, '!') });

    await useCase.execute(ctx(), noteTurn());

    assert.ok(draftUpdates[0].note.length <= 500);
    assert.ok(draftUpdates[0].note.startsWith('LINE receipt upload'));
  });

  // The cap, the repeat check and the empty case are each a way the reply's "บันทึกหมายเหตุไว้"
  // could be false while the code reported success.
  it('records as much of a note as fits and says it was cut', async () => {
    const { useCase, draftUpdates } = harness({ note: 'LINE receipt upload'.padEnd(460, '!') });

    const outcome = await useCase.execute(ctx(), noteTurn());

    assert.equal(outcome.status, 'applied');
    assert.equal((outcome as { noteOutcome?: string }).noteOutcome, 'truncated');
    assert.ok(draftUpdates[0].note.length <= 500);
    assert.ok(draftUpdates[0].note.includes('ผู้ใช้แจ้ง: จากบิลเมื่อกี้'), 'the beginning of what he said is kept');
    assert.ok(draftUpdates[0].note.endsWith('…'), 'and the cut is visible');
  });

  it('appends a sentence that merely appears earlier in the note', async () => {
    const { useCase, draftUpdates } = harness({ note: `LINE receipt upload · ผู้ใช้แจ้ง: ${OWNER_TURN} · ผู้ใช้แจ้ง: ร้าน BHC` });

    const outcome = await useCase.execute(ctx(), noteTurn());

    assert.equal((outcome as { noteOutcome?: string }).noteOutcome, undefined, 'not a repeat — it is not the newest segment');
    assert.equal(draftUpdates[0].note.split(' · ').length, 4);
  });

  it('reports a redelivered sentence as already recorded instead of stacking it', async () => {
    const { useCase, draftUpdates } = harness({ note: `LINE receipt upload · ผู้ใช้แจ้ง: ${OWNER_TURN}` });

    const outcome = await useCase.execute(ctx(), noteTurn());

    assert.equal((outcome as { noteOutcome?: string }).noteOutcome, 'duplicate');
    assert.equal(draftUpdates[0].note.split('ผู้ใช้แจ้ง:').length - 1, 1, 'exactly one copy');
  });

  it('records nothing, and says so, when the message carried no note text', async () => {
    const { useCase, draftUpdates } = harness();

    const outcome = await useCase.execute(ctx(), {
      ...noteTurn(),
      hints: { note: { to: '   ' } } as never,
      evidence: [{ text: '   ', todayIso: TODAY }],
    });

    assert.equal(outcome.status, 'guidance');
    assert.deepEqual(draftUpdates, [], 'nothing was written');

const NOW = new Date('2026-09-05T10:00:00.000Z');

function buildFlagLane(options: { draftEditEnabled?: boolean; lines?: unknown[]; sourceDocumentType?: string } = {}) {
  const record = {
    id: 'exp-1',
    companyId: 'co-1',
    branchId: null,
    status: 'DRAFT',
    createdByUserId: 'u-1',
    updatedAt: NOW,
    sourceDocumentType: options.sourceDocumentType ?? 'EXPENSE_NOTE_TEXT',
    expenseDate: new Date('2026-09-03T00:00:00.000Z'),
    grandTotalAmount: '59',
    vendorNameSnapshot: 'ร้านกาแฟ',
    vendorDocumentNumber: null,
    note: 'LINE receipt upload',
    aiVerificationSummaryJson: {},
    lines: options.lines ?? [{ description: 'กาแฟ', vatRate: null, vatTreatment: null, vatAmount: '0', whtAmount: '0' }],
  };
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: async () => 0,
    outboxEvent: { findFirst: async () => null, create: async () => ({}) },
    expenseRecord: { findFirst: async () => record },
  };
  const prisma = { client: { $transaction: async (run: (t: unknown) => Promise<unknown>) => run(tx) } };
  const useCase = new CorrectLineCapturedExpenseUseCase(
    prisma as never,
    // Duplicate reconciliation runs inside the apply transaction for value-changing fields.
    { updateExpense: async () => record, runDuplicateCheck: async () => [], listOpenDuplicateCandidates: async () => [] } as never,
    { execute: async (_ctx: unknown, _id: string, input: Record<string, unknown>) => { updates.push(input); return record; } } as never,
    { log: async () => {} } as never,
    { lineAiDraftEditEnabled: options.draftEditEnabled ?? false } as never,
  );
  return { useCase, updates };
}

const flagCtx = {
  requestId: 'r-1', authSubject: 'u-1', userId: 'u-1', companyId: 'co-1',
  membershipId: 'm-1', roles: ['ACCOUNTANT'], permissions: ['expense.update'],
  scopes: {}, authProvider: 'line' as const,
};

const input = (hints: Record<string, unknown>) => ({
  lineMessageIdHash: 'hash-1',
  candidates: [{ id: 'exp-1', label: 'บิลเงินสด · 59.00', createdAt: NOW.toISOString() }],
  hints,
  evidence: [{ text: 'ยอดจริง ๆ 590', todayIso: '2026-09-05' }],
});

describe('LINE correction lane — the amount field across the S-4 flag', () => {
  it('with the draft lane OFF, still applies a single-line amount correction (pre-S-4 behaviour)', async () => {
    const harness = buildFlagLane({ draftEditEnabled: false });
    const outcome = await harness.useCase.execute(flagCtx as never, input({ amount: { to: '590' } }) as never);
    assert.equal(outcome.status, 'applied');
    assert.deepEqual((outcome as any).fields.amount, { from: '59', to: '590' });
    // It writes through the whole-line-set replacement `canCorrectAmount` makes safe.
    assert.equal((harness.updates[0]!['lines'] as any[])[0].unitPrice, '590');
  });

  it('with the draft lane OFF, still refuses an amount on a record canCorrectAmount rejects', async () => {
    // An OCR receipt: a blind line-set replacement would erase itemisation and tax data.
    const harness = buildFlagLane({ draftEditEnabled: false, sourceDocumentType: 'RECEIPT' });
    const outcome = await harness.useCase.execute(flagCtx as never, input({ amount: { to: '590' } }) as never);
    assert.equal(outcome.status, 'guidance');
    assert.equal(harness.updates.length, 0);
  });

  it('with the draft lane ON, amount leaves this lane entirely — the draft tools own it', async () => {
    const harness = buildFlagLane({ draftEditEnabled: true });
    const outcome = await harness.useCase.execute(flagCtx as never, input({ amount: { to: '590' } }) as never);
    assert.equal(outcome.status, 'guidance');
    assert.equal((outcome as any).reason, 'no_correctable_field');
    assert.equal(harness.updates.length, 0, 'and nothing is written on the way out');
  });

  it('applies a header field in either position — the flag only ever moves money', async () => {
    for (const draftEditEnabled of [false, true]) {
      const harness = buildFlagLane({ draftEditEnabled });
      const outcome = await harness.useCase.execute(flagCtx as never, {
        // A vendor unrelated to the stored one, so the direction guard has nothing to be unsure
        // about — that guard has its own coverage in `line-correction.logic.spec.ts`.
        ...input({ vendorName: { to: 'บริษัท เอบีซี' } }),
        evidence: [{ text: 'ร้านชื่อ บริษัท เอบีซี นะ', todayIso: '2026-09-05' }],
      } as never);
      assert.equal(outcome.status, 'applied', `draftEditEnabled=${draftEditEnabled}`);
      assert.equal(harness.updates[0]!['vendorNameSnapshot'], 'บริษัท เอบีซี');
      assert.equal(harness.updates[0]!['lines'], undefined, 'a header correction never touches the lines');
    }
  });

  it('refuses a caller with neither expense.update nor expense.review, in both positions', async () => {
    for (const draftEditEnabled of [false, true]) {
      const harness = buildFlagLane({ draftEditEnabled });
      const outcome = await harness.useCase.execute(
        { ...flagCtx, permissions: ['expense.receipt.line_upload'] } as never,
        input({ vendorName: { to: 'บริษัท เอบีซี' } }) as never,
      );
      assert.equal(outcome.status, 'guidance');
      assert.equal((outcome as any).reason, 'missing_update_permission');
    }
