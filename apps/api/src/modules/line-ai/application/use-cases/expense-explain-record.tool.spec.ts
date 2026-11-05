/**
 * `expense.explain_record` at the API boundary (spec §5.5, evidence E4).
 *
 * The BHC receipt from the UAT evidence is the fixture, so the totals identity the answer states is
 * the one the Owner actually saw: สินค้า 1,520.00 + ค่าบริการ 152.00 = ฐานภาษี 1,672.00, + VAT 117.04
 * = 1,789.04.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpenseExplainRecordTool, explainAssumptions, readExplainRecordRef } from './erp-core-detail-tools.use-case';
import { LINE_RECENT_CAPTURE_WINDOW_MS } from '../../../expenses/application/services/line-recent-capture';

const ctx = {
  requestId: 'r1', companyId: 'c1', userId: 'u1', membershipId: 'm1',
  permissions: ['expense.read_own'], roles: [], branchIds: ['b1'], locale: 'th-TH',
  chatKeyHash: 'chat-a',
};

const BHC = {
  id: 'exp-bhc', expenseNumber: 'EXP-1', status: 'NEEDS_REVIEW', currency: 'THB',
  vendorNameSnapshot: 'BHC', vendorDocumentNumber: 'A0042', expenseDate: new Date('2026-09-03T00:00:00Z'),
  subtotalAmount: '1520.00', discountAmount: '0.00', taxableAmount: '1672.00',
  vatAmount: '117.04', grandTotalAmount: '1789.04',
  aiVerifiedFieldsJson: { expenseDate: '2026-09-03', missingFields: [] },
  aiVerificationSummaryJson: {},
  lines: [
    { description: 'ไก่ทอด', chargeKind: null, quantity: '2', unitPrice: '400.00', lineSubtotalAmount: '800.00', vatAmount: '56.00' },
    { description: 'เครื่องดื่ม', chargeKind: null, quantity: '3', unitPrice: '240.00', lineSubtotalAmount: '720.00', vatAmount: '50.40' },
    { description: 'ค่าบริการ 10%', chargeKind: 'SERVICE_CHARGE', quantity: '1', unitPrice: '152.00', lineSubtotalAmount: '152.00', vatAmount: '10.64' },
  ],
  charges: [{ kind: 'SERVICE_CHARGE', label: 'ค่าบริการ', amount: '152.00', vatAmount: '10.64' }],
  // Slice B computes this for every record from the stored header against the stored lines.
  totalsIdentity: { ok: true, gapAmount: '0.00' },
  attachments: [],
};

/** Records the query the shared provenance rule issued, so the rule itself can be asserted. */
function makeRepo(rows: any[] = [{ id: 'exp-bhc', expenseDate: null, grandTotalAmount: null, vendorDocumentNumber: 'A0042', sourceDocumentType: 'RECEIPT', createdAt: new Date() }]) {
  const queries: any[] = [];
  return {
    queries,
    repo: { listRecentLineCaptures: async (input: any) => { queries.push(input); return rows; } } as any,
  };
}

const getExpense = (record: unknown = BHC) => ({ execute: async () => record }) as any;

describe('expense.explain_record', () => {
  // NAT-12 (2026-09-29): a text-note draft keeps "สามร้อย", then "350", in its collection until the item has a
  // quantity; the record read as 0 and every answer quoting the user's amount failed grounding.
  it('shows a text-note draft\'s items that are not on the document yet, and what it still asks', async () => {
    const note = { ...BHC, id: 'exp-note', status: 'DRAFT', lines: [], charges: [], subtotalAmount: '0', taxableAmount: '0', vatAmount: '0', grandTotalAmount: '0',
      sourceChannelMetadataJson: { lineExpenseDraftContinuation: {
        schemaVersion: 1, workflowId: 'wf', kind: 'EXPENSE_DRAFT_COLLECTION', companyId: 'c1', userId: 'u1', expenseId: 'exp-note',
        chatKeyHash: 'chat-a', status: 'OPEN', version: 2, targetRevision: '2026-09-29T00:00:00.000Z',
        header: { provisionalExpenseDate: '2026-09-29' }, provenance: {}, lastActivityAt: '2026-09-29T00:00:00.000Z',
        items: [{ itemRef: 'I01', sourceText: 'ค่าส่งของ', description: 'ค่าส่งของ', totalAmount: '350' }],
        unresolvedQuestions: [{ id: 'I01-QTY', scope: 'ITEM', itemRef: 'I01', field: 'quantity', prompt: 'จำนวน?' }],
      } } };
    const { repo } = makeRepo([{ id: 'exp-note', expenseDate: null, grandTotalAmount: null, vendorDocumentNumber: null, sourceDocumentType: 'EXPENSE_NOTE_TEXT', createdAt: new Date() }]);
    const data = (await new ExpenseExplainRecordTool(getExpense(note), repo).execute(ctx as any, {})).data as any;
    assert.deepEqual(data.lineDraftItemsNotYetOnDocument, [{ description: 'ค่าส่งของ', quantity: null, unitPrice: null, totalAmount: '350' }]);
    assert.deepEqual(data.lineDraftStillAsks, ['quantity']);
    assert.equal(data.lineDraftCollectionStopped, undefined);
    // After "เดี๋ยว ๆ ยกเลิกก่อน" the collection stops, but what the user said is still what the draft holds.
    note.sourceChannelMetadataJson.lineExpenseDraftContinuation.status = 'CANCELLED';
    const stopped = (await new ExpenseExplainRecordTool(getExpense(note), repo).execute(ctx as any, {})).data as any;
    assert.equal(stopped.lineDraftItemsNotYetOnDocument[0].totalAmount, '350');
    assert.equal(stopped.lineDraftCollectionStopped, true);
    assert.equal((await new ExpenseExplainRecordTool(getExpense(), makeRepo().repo).execute(ctx as any, {})).data?.['lineDraftItemsNotYetOnDocument' as never], undefined);
    note.sourceChannelMetadataJson.lineExpenseDraftContinuation.items = Array.from({ length: 30 }, (_, i) => ({
      itemRef: `I${String(i + 1).padStart(2, '0')}`, sourceText: `รายการ ${i + 1}`, description: `รายการ ${i + 1}`, totalAmount: '350',
    }));
    const allItems = (await new ExpenseExplainRecordTool(getExpense(note), repo).execute(ctx as any, {})).data as any;
    assert.equal(allItems.lineDraftItemsNotYetOnDocument.length, 30);
    assert.equal(allItems.lineDraftItemsNotYetOnDocument[29].description, 'รายการ 30');
  });

  it('returns all 30 product rows rather than silently keeping the first ten', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({ ...BHC.lines[0]!, description: `รายการ ${i + 1}` }));
    const data = (await new ExpenseExplainRecordTool(getExpense({ ...BHC, lines }), makeRepo().repo).execute(ctx as any, {})).data as any;
    assert.equal(data.lineGroups.productCount, 30);
    assert.equal(data.lineGroups.products.length, 30);
    assert.equal(data.lineGroups.products[29].description, 'รายการ 30');
  });

  it('explains the newest record of THIS chat with the totals identity as real numbers', async () => {
    const { repo, queries } = makeRepo();
    const result = await new ExpenseExplainRecordTool(getExpense(), repo).execute(ctx as any, {});
    assert.equal(result.status, 'ok');
    const data = result.data as any;
    assert.equal(data.found, true);
    assert.equal(data.header.vendorName, 'BHC');
    assert.equal(data.header.documentNumber, 'A0042');
    assert.equal(data.header.statusLabel, 'รอตรวจสอบ');
    assert.deepEqual(data.totals, {
      subtotalAmount: '1520.00', discountAmount: '0.00', chargesAmount: '152.00',
      taxableAmount: '1672.00', vatAmount: '117.04', grandTotalAmount: '1789.04',
    });
    // The charge is its OWN group, not a third product line — the whole point of E1/E4.
    assert.equal(data.lineGroups.productCount, 2);
    assert.deepEqual(data.lineGroups.charges, BHC.charges);
    assert.equal(data.amountEditableOverLine, false, 'money is not editable over LINE before S-4');
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/expenses/exp-bhc');
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);

    // The ONE shared rule: this user, this chat, this branch scope, inside the recency window.
    assert.equal(queries.length, 1);
    assert.equal(queries[0].companyId, 'c1');
    assert.equal(queries[0].createdByUserId, 'u1');
    assert.equal(queries[0].chatKeyHash, 'chat-a');
    assert.deepEqual(queries[0].scopes, { branchIds: ['b1'] });
    const ageMs = Date.now() - queries[0].since.getTime();
    assert.ok(Math.abs(ageMs - LINE_RECENT_CAPTURE_WINDOW_MS) < 5_000, 'recency window is the shared one');
  });

  it('advertises preview edits only for an authorized, current chat candidate in an editable state', async () => {
    const { repo } = makeRepo();
    const tool = new ExpenseExplainRecordTool(getExpense(), repo, { enabled: true } as any);
    const authorized = await tool.execute({ ...ctx, permissions: ['expense.read_own', 'expense.update'] } as any, {});
    assert.deepEqual((authorized.data as any).editableOverLine,
      ['expenseDate', 'vendorName', 'documentNumber', 'note', 'amount', 'charges', 'vat']);
    assert.equal((authorized.data as any).amountEditableOverLine, true);

    const explicitId = await tool.execute({ ...ctx, permissions: ['expense.read_own', 'expense.update'] } as any,
      { recordRefKind: 'id', recordRefValue: 'exp-bhc' });
    assert.deepEqual((explicitId.data as any).editableOverLine, [], 'an id-only read has no LINE provenance proof');
    assert.equal((explicitId.data as any).amountEditableOverLine, false);

    const confirmed = await new ExpenseExplainRecordTool(
      getExpense({ ...BHC, status: 'CONFIRMED' }), repo, { enabled: true } as any,
    ).execute({ ...ctx, permissions: ['expense.read_own', 'expense.update'] } as any, {});
    assert.deepEqual((confirmed.data as any).editableOverLine, [], 'confirmed records cannot be advertised');

    const ready = await new ExpenseExplainRecordTool(
      getExpense({ ...BHC, status: 'READY_FOR_CONFIRMATION' }), repo, { enabled: true } as any,
    ).execute({ ...ctx, permissions: ['expense.read_own', 'expense.update'] } as any, {});
    assert.ok((ready.data as any).editableOverLine.length > 0, 'READY_FOR_CONFIRMATION is still editable but not confirmed');
  });

  it('resolves a documentNumber inside the same chat-provenance set, and refuses one outside it', async () => {
    const { repo } = makeRepo();
    const tool = new ExpenseExplainRecordTool(getExpense(), repo);
    const hit = await tool.execute(ctx as any, { recordRefKind: 'documentNumber', recordRefValue: 'A0042' });
    assert.equal((hit.data as any).found, true);
    const miss = await tool.execute(ctx as any, { recordRefKind: 'documentNumber', recordRefValue: 'OTHER-COMPANY-99' });
    assert.deepEqual(miss.data, { found: false });
    assert.equal(miss.errorCode, 'EXPENSE_NOT_FOUND');
  });

  it('answers "not found" — never a different answer — for another company\'s record id', async () => {
    const { repo } = makeRepo();
    // The tenant filter lives in the use case; a foreign id simply does not resolve.
    const tool = new ExpenseExplainRecordTool({ execute: async () => { throw new NotFoundException(); } } as any, repo);
    const result = await tool.execute(ctx as any, { recordRefKind: 'id', recordRefValue: 'exp-of-another-company' });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, { found: false }, 'existence is never leaked');
    assert.equal(result.errorCode, 'EXPENSE_NOT_FOUND');
  });

  it('reports a permission failure as forbidden and reads nothing', async () => {
    const { repo } = makeRepo();
    const tool = new ExpenseExplainRecordTool({ execute: async () => { throw new ForbiddenException(); } } as any, repo);
    const result = await tool.execute(ctx as any, { recordRefKind: 'id', recordRefValue: 'exp-bhc' });
    assert.equal(result.status, 'forbidden');
    assert.deepEqual(result.sourceRefs, []);
  });

  it('has nothing to explain without chat provenance, and refuses a reserved record type', async () => {
    const { repo, queries } = makeRepo();
    const tool = new ExpenseExplainRecordTool(getExpense(), repo);
    const noChat = await tool.execute({ ...ctx, chatKeyHash: undefined } as any, {});
    assert.deepEqual(noChat.data, { found: false });
    assert.equal(queries.length, 0, 'no chat means no query at all');
    const wrongType = await tool.execute(ctx as any, { recordType: 'income' });
    assert.equal(wrongType.status, 'unavailable');
    assert.equal(wrongType.errorCode, 'RECORD_TYPE_NOT_SUPPORTED');
  });

  it('reads the record reference from either the nested contract shape or the flat model-wire pair', () => {
    assert.deepEqual(readExplainRecordRef({}), { kind: 'recent' });
    assert.deepEqual(readExplainRecordRef({ recordRef: { kind: 'id', value: ' e1 ' } }), { kind: 'id', value: 'e1' });
    assert.deepEqual(readExplainRecordRef({ recordRefKind: 'documentNumber', recordRefValue: 'A1' }), { kind: 'documentNumber', value: 'A1' });
    assert.deepEqual(readExplainRecordRef({ recordRefKind: 'anything-else' }), { kind: 'recent' });
  });

  it('carries slice B\'s totals-identity verdict through, both ways', async () => {
    const { repo } = makeRepo();
    const clean = await new ExpenseExplainRecordTool(getExpense(), repo).execute(ctx as any, {});
    assert.deepEqual((clean.data as any).totalsIdentity, { ok: true, gapAmount: '0.00' });
    const broken = await new ExpenseExplainRecordTool(
      getExpense({ ...BHC, totalsIdentity: { ok: false, gapAmount: '12.00' } }), repo,
    ).execute(ctx as any, {});
    assert.deepEqual((broken.data as any).totalsIdentity, { ok: false, gapAmount: '12.00' },
      'a record that does not add up says so, verbatim from the detail mapper');
  });

  it('explains a derived source from a capture group exactly like any other record (W07-int)', async () => {
    // W05 stamps `captureSource: 'LINE_UPLOAD'` + `sourceChannelMetadataJson.chatKeyHash` on every
    // source it hands off from a LINE group, which is precisely what the shared provenance rule
    // selects on — so "บิลเมื่อกี้" reaches the expense the group became, with no second rule.
    const { repo, queries } = makeRepo([{
      id: 'exp-derived', expenseDate: new Date('2026-09-18T00:00:00Z'), grandTotalAmount: '810.00',
      vendorDocumentNumber: 'G-77', sourceDocumentType: 'RECEIPT', createdAt: new Date(),
    }]);
    const derived = {
      ...BHC, id: 'exp-derived', vendorNameSnapshot: 'ร้านเอ', vendorDocumentNumber: 'G-77',
      aiVerificationSummaryJson: { dateStatus: 'verified', captureGroupId: 'grp-1', scopeKey: 'issuer:a' },
    };
    const result = await new ExpenseExplainRecordTool(getExpense(derived), repo).execute(ctx as any, {});
    assert.equal((result.data as any).found, true);
    assert.equal((result.data as any).header.vendorName, 'ร้านเอ');
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/expenses/exp-derived');
    assert.equal(queries[0].chatKeyHash, 'chat-a', 'the same chat-provenance window, unchanged');
  });

  it('names the values the reader assumed, and stays silent for a hand-typed record', () => {
    assert.deepEqual(explainAssumptions({ aiVerifiedFieldsJson: null, aiVerificationSummaryJson: null }), []);
    assert.deepEqual(
      explainAssumptions({ aiVerifiedFieldsJson: { vendorName: 'BHC' }, aiVerificationSummaryJson: {} }),
      [{ field: 'expenseDate', reason: 'missing' }],
      'an AI-read record with no date read is a date nobody verified',
    );
    assert.deepEqual(
      explainAssumptions({ aiVerifiedFieldsJson: { expenseDate: '2026-09-03', missingFields: ['vatRate'] }, aiVerificationSummaryJson: { dateUnverified: true } }),
      [{ field: 'expenseDate', reason: 'unverified' }, { field: 'vatRate', reason: 'missing' }],
    );
  });
});
