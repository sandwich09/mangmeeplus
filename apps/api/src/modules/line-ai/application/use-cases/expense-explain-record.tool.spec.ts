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
import { ExpenseExplainRecordTool, explainAssumptions, explainTotalsIdentity, readExplainRecordRef } from './erp-core-detail-tools.use-case';
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

  it('passes slice B\'s totals-identity verdict through, and reports none when the detail has none', async () => {
    const { repo } = makeRepo();
    const clean = await new ExpenseExplainRecordTool(getExpense(), repo).execute(ctx as any, {});
    assert.equal((clean.data as any).totalsIdentity, undefined, 'no verdict is invented');
    const broken = await new ExpenseExplainRecordTool(
      getExpense({ ...BHC, totalsIdentity: { ok: false, gapAmount: '12.00' } }), repo,
    ).execute(ctx as any, {});
    assert.deepEqual((broken.data as any).totalsIdentity, { ok: false, gapAmount: '12.00' });
    // Shape guard: only a real boolean verdict is forwarded.
    assert.equal(explainTotalsIdentity({ totalsIdentity: { ok: 'no' } }), undefined);
    assert.deepEqual(explainTotalsIdentity({ totalsIdentity: { ok: false } }), { ok: false, gapAmount: '0.00' });
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
