/**
 * Spec `line-ai-draft-control-spec-th.md` §5.3, replaying the owner's real UAT turn of 2026-09-03.
 *
 * He sent a BHC bill and then typed "จากบิลเมื่อกี้มี service charge 10% นะ แก้ไขได้ใช่ไหม". The lane
 * wrote that sentence OVER the note — destroying "LINE receipt upload", the only record that the
 * draft came from a photo in a chat — changed no money at all, and answered "แก้ไขรายการเดิมให้แล้ว".
 * These tests pin the two halves of the fix: the note is appended, and the reply says what happened.
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
    assert.equal(applied.metadataJson.noteAppend, true);
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
});
