/**
 * Facts assembly and the human correction on top of it (appendix §4.4/§9).
 *
 * Table-driven where the rule is a table; one test per acceptance row where the rule is a story.
 * Nothing here mocks a clock or a database — the whole file under test is pure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import type { ExpenseCaptureObservations } from '@watchdog-bms/contracts';
import {
  applyCaptureFactsPatch,
  assembleCaptureFacts,
  captureFactsKey,
  CaptureFactsPatchError,
  capturePaidTotal,
  distributeCaptureAmounts,
  selectCaptureObservations,
  shareByBasis,
  type CaptureObservationRow,
} from './expense-capture-facts.logic';

// ─── builders ─────────────────────────────────────────────────────────────────

const classification = {
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
  confidence: 1, evidenceSignals: [], amountSignals: [], settlementSignals: [],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
} as ExpenseCaptureObservations['documents'][number]['classification'];

const document = (over: Partial<ExpenseCaptureObservations['documents'][number]> = {}) => ({
  ref: 'D1', pageIndexes: [0], kind: 'RECEIPT' as const, family: 'EXPENSE_EVIDENCE' as const,
  issuer: { name: 'ร้านเอ' }, currency: 'THB', classification, ...over,
});

const item = (over: Partial<ExpenseCaptureObservations['items'][number]> = {}) => ({
  id: '1:1', documentRef: 'D1', description: 'สินค้า', event: 'sale' as const, evidenceSpan: 'สินค้า', ...over,
});

const component = (over: Partial<ExpenseCaptureObservations['components'][number]> = {}) => ({
  id: 'c1', documentRef: 'D1', label: 'ส่วนลด', role: 'applied_discount' as const,
  scope: 'order' as const, appliedStatus: 'applied' as const, evidenceSpan: 'ส่วนลด', ...over,
});

const payload = (over: Partial<ExpenseCaptureObservations> = {}): ExpenseCaptureObservations => ({
  documents: [], items: [], components: [], totals: [], payments: [], refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
  ...over,
});

const row = (over: Partial<CaptureObservationRow> & { payloadJson: unknown }): CaptureObservationRow => ({
  id: 'o1', fileId: 'f1', version: 1, source: 'AI', ...over,
});

// ─── which observation is current ─────────────────────────────────────────────

describe('selectCaptureObservations', () => {
  it('prefers a HUMAN correction over a later AI read of the same file (A12/A48)', () => {
    const selected = selectCaptureObservations([
      row({ id: 'ai-1', version: 1, source: 'AI', payloadJson: payload() }),
      row({ id: 'human', version: 2, source: 'HUMAN', basedOnVersion: 1, payloadJson: payload() }),
      row({ id: 'ai-late', version: 3, source: 'AI', payloadJson: payload() }),
    ]);
    assert.equal(selected.get('f1')?.id, 'human');
  });

  it('ignores a stale read entirely', () => {
    const selected = selectCaptureObservations([
      row({ id: 'ai-1', version: 1, source: 'AI', payloadJson: payload() }),
      row({ id: 'ai-stale', version: 9, source: 'AI', stale: true, payloadJson: payload() }),
    ]);
    assert.equal(selected.get('f1')?.id, 'ai-1');
  });

  it('takes the newest version within one source', () => {
    const selected = selectCaptureObservations([
      row({ id: 'h1', version: 2, source: 'HUMAN', payloadJson: payload() }),
      row({ id: 'h2', version: 5, source: 'HUMAN', payloadJson: payload() }),
    ]);
    assert.equal(selected.get('f1')?.id, 'h2');
  });

  it('keys a converted expense (§3.1) by its expense, because it has no file', () => {
    const converted = row({ id: 'o9', fileId: null, expenseId: 'exp-1', source: 'EXPENSE_FACTS', payloadJson: payload() });
    assert.equal(captureFactsKey(converted), 'expense:exp-1');
    assert.equal(selectCaptureObservations([converted]).get('expense:exp-1')?.id, 'o9');
  });

  it('never collides two files that both numbered their first row 1:1', () => {
    const facts = assembleCaptureFacts([
      row({ id: 'a', fileId: 'f1', payloadJson: payload({ documents: [document()], items: [item()] }) }),
      row({ id: 'b', fileId: 'f2', payloadJson: payload({ documents: [document()], items: [item()] }) }),
    ]);
    assert.deepEqual(facts.items.map((entry) => entry.id), ['f1:1:1', 'f2:1:1']);
    assert.deepEqual(facts.documents.map((entry) => entry.ref), ['f1:D1', 'f2:D1']);
    assert.deepEqual(facts.items.map((entry) => entry.fileId), ['f1', 'f2']);
  });
});

// ─── scope keys ───────────────────────────────────────────────────────────────

describe('issuer scope keys', () => {
  for (const [label, issuer, expected] of [
    ['a tax id wins', { name: 'ร้านเอ', taxId: '0-1055-43000-19-1' }, 'issuer:0105543000191'],
    ['a normalised name when there is none', { name: '  ร้าน   เอ ' }, 'issuer:ร้าน เอ'],
    ['the document ref when the issuer is nameless', {}, 'issuer:f1:D1'],
  ] as const) {
    it(label, () => {
      const facts = assembleCaptureFacts([row({ payloadJson: payload({ documents: [document({ issuer })] }) })]);
      assert.equal(facts.documents[0]!.scopeKey, expected);
    });
  }
});

// ─── largest remainder ────────────────────────────────────────────────────────

describe('shareByBasis (spec §6 rule 7)', () => {
  const weights = (values: number[]) => values.map((value, index) => ({ id: `i${index}`, weight: new Decimal(value) }));

  for (const [label, amount, basis] of [
    ['three equal items and 100.00', '100.00', [1, 1, 1]],
    ['three equal items and one satang', '0.01', [1, 1, 1]],
    ['uneven weights', '140.00', [900, 500, 1]],
    ['a negative share', '-10.00', [3, 7]],
  ] as const) {
    it(`sums back to the source: ${label}`, () => {
      const shares = shareByBasis(new Decimal(amount), weights([...basis]));
      const total = [...shares.values()].reduce((sum, share) => sum.plus(share.share), new Decimal(0));
      assert.equal(total.toFixed(2), new Decimal(amount).toFixed(2));
    });
  }

  it('hands the leftover satang to the largest remainder, ties by id', () => {
    const shares = shareByBasis(new Decimal('0.01'), weights([1, 1, 1]));
    assert.equal(shares.get('i0')!.share.toFixed(2), '0.01');
    assert.equal(shares.get('i0')!.remainderAdjust, true);
    assert.equal(shares.get('i1')!.share.toFixed(2), '0.00');
    assert.equal(shares.get('i2')!.remainderAdjust, false);
  });

  it('shares nothing rather than dividing by a zero basis', () => {
    assert.equal(shareByBasis(new Decimal('10'), weights([0, 0])).size, 0);
  });
});

// ─── reconciliation ───────────────────────────────────────────────────────────

describe('per-document reconciliation (§4.4)', () => {
  const build = (over: Partial<ExpenseCaptureObservations>) =>
    assembleCaptureFacts([row({ payloadJson: payload({ documents: [document()], ...over }) })]).documents[0]!.state;

  it('reconciles items minus discount plus charge against the printed total', () => {
    const state = build({
      items: [item({ id: '1:1', amount: '1000.00' })],
      components: [component({ id: 'c1', amount: '100.00' }), component({ id: 'c2', label: 'ค่าส่ง', role: 'charge', scope: 'shipping', amount: '50.00' })],
      totals: [{ documentRef: 'D1', kind: 'document_total', amount: '950.00', evidenceSpan: '950' }],
    });
    assert.equal(state.reconciliation, 'reconciled');
    assert.equal(state.documentTotal, '950.00');
  });

  it('keeps a mismatch instead of inventing a balancing row (A24/A34/A58)', () => {
    const state = build({
      items: [item({ amount: '1000.00' })],
      totals: [{ documentRef: 'D1', kind: 'document_total', amount: '1200.00', evidenceSpan: '1200' }],
    });
    assert.equal(state.reconciliation, 'mismatch');
  });

  it('says insufficient, not mismatch, when an amount was never read (rule 9)', () => {
    const state = build({
      items: [item({ amount: '1000.00' }), item({ id: '1:2' })],
      totals: [{ documentRef: 'D1', kind: 'document_total', amount: '1200.00', evidenceSpan: '1200' }],
    });
    assert.equal(state.reconciliation, 'insufficient');
    assert.deepEqual(state.unknownAmounts, ['f1:1:2']);
  });

  it('forgives half a satang of transcription residue but not a real one', () => {
    const near = build({
      items: [item({ amount: '100.00' })],
      totals: [{ documentRef: 'D1', kind: 'document_total', amount: '100.04', evidenceSpan: '100.04' }],
    });
    const real = build({
      items: [item({ amount: '100.00' })],
      totals: [{ documentRef: 'D1', kind: 'document_total', amount: '100.06', evidenceSpan: '100.06' }],
    });
    assert.equal(near.reconciliation, 'reconciled');
    assert.equal(real.reconciliation, 'mismatch');
  });

  it('A49 — cash 500 change 432 is a 68 purchase, not a 500 one', () => {
    const facts = assembleCaptureFacts([row({
      payloadJson: payload({
        documents: [document()],
        items: [item({ amount: '68.00' })],
        components: [
          component({ id: 'c1', label: 'เงินสด', role: 'tender', scope: 'document', amount: '500.00' }),
          component({ id: 'c2', label: 'เงินทอน', role: 'change', scope: 'document', amount: '432.00' }),
        ],
        totals: [{ documentRef: 'D1', kind: 'document_total', amount: '68.00', evidenceSpan: '68' }],
      }),
    })]);
    assert.equal(facts.documents[0]!.state.reconciliation, 'reconciled');
    assert.equal(capturePaidTotal(facts, 'f1:D1'), '68.00');
  });

  it('A29/A06 — a coupon the buyer will receive reduces nothing', () => {
    const facts = assembleCaptureFacts([row({
      payloadJson: payload({
        documents: [document()],
        items: [item({ amount: '1290.00' })],
        components: [component({ id: 'c1', label: 'Coins to be earned', role: 'future_reward', scope: 'document', amount: '50.00' })],
        totals: [{ documentRef: 'D1', kind: 'document_total', amount: '1290.00', evidenceSpan: '1290' }],
      }),
    })]);
    assert.equal(facts.documents[0]!.state.reconciliation, 'reconciled');
  });

  it('A52 — a linked void cancels its sale, leaving the replacement row', () => {
    const facts = assembleCaptureFacts([row({
      payloadJson: payload({
        documents: [document()],
        items: [
          item({ id: '1:1', amount: '59.00' }),
          item({ id: '1:2', amount: '-59.00', event: 'void', linkedItemId: '1:1' }),
          item({ id: '1:3', amount: '53.00' }),
        ],
        totals: [{ documentRef: 'D1', kind: 'document_total', amount: '53.00', evidenceSpan: '53' }],
      }),
    })]);
    assert.equal(facts.documents[0]!.state.reconciliation, 'reconciled');
    const distribution = distributeCaptureAmounts(facts);
    assert.equal(distribution.items.get('f1:1:1')!.base!.toFixed(2), '0.00');
    assert.equal(distribution.items.get('f1:1:1')!.selectable, false);
    assert.equal(distribution.items.get('f1:1:3')!.base!.toFixed(2), '53.00');
  });

  it('A27 — a gift row is 0 and does not add to the bill', () => {
    const facts = assembleCaptureFacts([row({
      payloadJson: payload({
        documents: [document()],
        items: [item({ id: '1:1', amount: '100.00' }), item({ id: '1:2', event: 'zero_price_promo', description: 'แถม' })],
        totals: [{ documentRef: 'D1', kind: 'document_total', amount: '100.00', evidenceSpan: '100' }],
      }),
    })]);
    assert.equal(facts.documents[0]!.state.reconciliation, 'reconciled');
    assert.equal(distributeCaptureAmounts(facts).items.get('f1:1:2')!.base!.toFixed(2), '0.00');
  });

  it('A56 — coupon 0, discount −10, queue 21 comes to 35 and the queue number is not money', () => {
    const facts = assembleCaptureFacts([row({
      payloadJson: payload({
        documents: [document()],
        items: [item({ id: '1:1', amount: '45.00' }), item({ id: '1:2', description: 'คูปอง', amount: '0.00' })],
        components: [
          component({ id: 'c1', label: 'ส่วนลด', amount: '-10.00', scope: 'document' }),
          component({ id: 'c2', label: 'คิวที่ 21', role: 'summary', scope: 'document', amount: '21.00' }),
        ],
        totals: [{ documentRef: 'D1', kind: 'document_total', amount: '35.00', evidenceSpan: '35' }],
      }),
    })]);
    assert.equal(facts.documents[0]!.state.reconciliation, 'reconciled');
  });

  it('A57 — points balances are not converted to money', () => {
    const facts = assembleCaptureFacts([row({
      payloadJson: payload({
        documents: [document()],
        items: [item({ amount: '222.00' })],
        components: [
          component({ id: 'c1', label: 'แต้มคงเหลือ', role: 'balance', scope: 'document', amount: '1500' }),
          component({ id: 'c2', label: 'แต้มที่จะหมดอายุ', role: 'balance', scope: 'document', amount: '200' }),
        ],
        totals: [{ documentRef: 'D1', kind: 'document_total', amount: '222.00', evidenceSpan: '222' }],
      }),
    })]);
    assert.equal(facts.documents[0]!.state.reconciliation, 'reconciled');
  });
});

describe('paid total precedence (§7)', () => {
  it('prefers reported paid, then buyer payable, then the document total', () => {
    const totals = (kinds: Array<[string, string]>) => assembleCaptureFacts([row({
      payloadJson: payload({
        documents: [document()],
        totals: kinds.map(([kind, amount]) => ({ documentRef: 'D1', kind: kind as 'document_total', amount, evidenceSpan: amount })),
      }),
    })]);
    assert.equal(capturePaidTotal(totals([['document_total', '100.00']]), 'f1:D1'), '100.00');
    assert.equal(capturePaidTotal(totals([['document_total', '100.00'], ['buyer_payable', '90.00']]), 'f1:D1'), '90.00');
    assert.equal(capturePaidTotal(totals([['document_total', '100.00'], ['buyer_payable', '90.00'], ['reported_paid', '80.00']]), 'f1:D1'), '80.00');
  });
});

describe('summary counts', () => {
  it('counts documents, items, files read and the rows nobody could read', () => {
    const facts = assembleCaptureFacts([
      row({
        id: 'a', fileId: 'f1',
        payloadJson: payload({ documents: [document()], items: [item(), item({ id: '1:2' })] }),
      }),
      row({
        id: 'b', fileId: 'f2',
        payloadJson: {
          ...payload({ documents: [document({ ref: 'D9' })], items: [item({ documentRef: 'D9', amount: '5.00' })] }),
          completeness: { itemsTruncated: true, unreadableRows: 2, pagesCovered: [1], notes: ['truncated'] },
        },
      }),
    ]);
    assert.deepEqual(facts.summary, { documents: 2, items: 3, filesRead: 2, filesPartial: 1, unknownItems: 2 });
    assert.deepEqual(facts.completeness.pagesCovered, [0, 1]);
    assert.equal(facts.completeness.itemsTruncated, true);
    assert.equal(facts.completeness.unreadableRows, 2);
  });
});

// ─── human patch ──────────────────────────────────────────────────────────────

const actor = { userId: 'user-1', at: '2026-09-18T10:00:00.000Z', fileId: 'f1' };

const base = () => payload({
  documents: [document()],
  items: [item({ id: '1:1', amount: '100.00' }), item({ id: '1:2' })],
  components: [component({ id: 'c1', amount: '10.00' })],
  totals: [{ documentRef: 'D1', kind: 'document_total', amount: '90.00', evidenceSpan: '90' }],
  payments: [{ documentRef: 'D1', status: 'unknown', evidenceSpan: 'จ่ายแล้ว' }],
});

describe('applyCaptureFactsPatch', () => {
  it('turns an unknown into a value and records what it replaced', () => {
    const next = applyCaptureFactsPatch(base(), { items: [{ id: '1:2', amount: '25.00' }] }, actor);
    assert.equal(next.items[1]!.amount, '25.00');
    assert.deepEqual(next.provenance, [{
      target: 'item', id: '1:2', field: 'amount', source: 'HUMAN',
      userId: 'user-1', at: actor.at, previous: null,
    }]);
  });

  it('turns a value back into an unknown, never into 0 (spec §6 rule 9)', () => {
    const next = applyCaptureFactsPatch(base(), { items: [{ id: '1:1', amount: null }] }, actor);
    assert.equal('amount' in next.items[0]!, false);
    assert.equal(next.provenance[0]!.previous, '100.00');
  });

  it('accepts the namespaced id the facts view hands the client', () => {
    const next = applyCaptureFactsPatch(base(), { items: [{ id: 'f1:1:1', quantity: '3' }] }, actor);
    assert.equal(next.items[0]!.quantity, '3');
  });

  it('edits the fields §9 allows and nothing else', () => {
    const next = applyCaptureFactsPatch(base(), {
      items: [{ id: '1:1', description: 'สินค้าใหม่', quantity: '2', unitPrice: '50.00', event: 'void' }],
      components: [{ id: 'c1', amount: '12.00', role: 'charge' }],
      totals: [{ documentRef: 'D1', kind: 'reported_paid', amount: '88.00' }],
      documents: [{ ref: 'D1', issuerName: 'ร้านบี', documentNumber: 'INV-1', documentDate: '2026-09-01', currency: 'THB' }],
      payments: [{ index: 0, status: 'paid' }],
    }, actor);
    assert.equal(next.items[0]!.description, 'สินค้าใหม่');
    assert.equal(next.items[0]!.event, 'void');
    assert.equal(next.components[0]!.role, 'charge');
    assert.equal(next.totals.find((total) => total.kind === 'reported_paid')!.amount, '88.00');
    assert.equal(next.documents[0]!.issuer.name, 'ร้านบี');
    assert.equal(next.documents[0]!.documentNumber, 'INV-1');
    assert.equal(next.payments[0]!.status, 'paid');
    // Four item fields, two component fields, one total, four document fields, one payment.
    assert.equal(next.provenance.length, 12);
  });

  it('removes a total the reviewer says was never there', () => {
    const next = applyCaptureFactsPatch(base(), { totals: [{ documentRef: 'D1', kind: 'document_total', amount: null }] }, actor);
    assert.deepEqual(next.totals, []);
    assert.equal(next.provenance[0]!.previous, '90.00');
  });

  it('leaves the original observation untouched', () => {
    const current = base();
    applyCaptureFactsPatch(current, { items: [{ id: '1:1', amount: '1.00' }] }, actor);
    assert.equal(current.items[0]!.amount, '100.00');
  });

  for (const [label, patch, code] of [
    ['an empty patch', {}, 'expense_capture_facts_patch_empty'],
    ['a row that is not in this file', { items: [{ id: '9:9', amount: '1.00' }] }, 'expense_capture_facts_patch_unknown_target'],
    ['a component that is not in this file', { components: [{ id: 'zz', amount: '1.00' }] }, 'expense_capture_facts_patch_unknown_target'],
    ['a document that is not in this file', { documents: [{ ref: 'DX', currency: 'THB' }] }, 'expense_capture_facts_patch_unknown_target'],
    ['a payment index past the end', { payments: [{ index: 4, status: 'paid' }] }, 'expense_capture_facts_patch_unknown_target'],
    ['a field §9 does not allow', { items: [{ id: '1:1', taxMarker: 'VAT' }] }, 'expense_capture_facts_patch_unsupported'],
    ['a section that is not a section', { sellers: [{ id: 'x' }] }, 'expense_capture_facts_patch_unsupported'],
    ['an event outside the enum', { items: [{ id: '1:1', event: 'refund' }] }, 'expense_capture_facts_patch_unsupported'],
    ['a role outside the enum', { components: [{ id: 'c1', role: 'coupon' }] }, 'expense_capture_facts_patch_unsupported'],
    ['a total kind outside the enum', { totals: [{ documentRef: 'D1', kind: 'grand', amount: '1' }] }, 'expense_capture_facts_patch_unsupported'],
    ['an amount that is not a number', { items: [{ id: '1:1', amount: '1,000 บาท' }] }, 'expense_capture_facts_patch_invalid_amount'],
    ['more decimals than the money columns hold', { items: [{ id: '1:1', amount: '1.00001' }] }, 'expense_capture_facts_patch_invalid_amount'],
  ] as const) {
    it(`refuses ${label}`, () => {
      assert.throws(
        () => applyCaptureFactsPatch(base(), patch as never, actor),
        (error: unknown) => error instanceof CaptureFactsPatchError && error.code === code,
        label,
      );
    });
  }

  it('refuses a patch bigger than one screen of corrections', () => {
    const items = Array.from({ length: 201 }, (_, index) => ({ id: '1:1', amount: `${index}.00` }));
    assert.throws(
      () => applyCaptureFactsPatch(base(), { items }, actor),
      (error: unknown) => error instanceof CaptureFactsPatchError && error.code === 'expense_capture_facts_patch_too_large',
    );
  });
});
