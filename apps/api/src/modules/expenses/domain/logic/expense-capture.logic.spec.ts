import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExpenseFactsObservation,
  captureGroupAllowedActions,
  captureGroupBlockers,
  deriveCaptureScopeKey,
  expenseCaptureWebPath,
} from './expense-capture.logic';
import { sanitizeAttemptFileName } from '../../infrastructure/prisma-expense-capture.repository';

const state = (over: Partial<Parameters<typeof captureGroupBlockers>[0]> = {}) => ({
  status: 'OPEN' as const,
  handoffState: 'NONE' as const,
  storedFiles: 1,
  readingFiles: 0,
  hasFacts: true,
  intakeEnabled: true,
  canMutate: true,
  ...over,
});

describe('capture scope key', () => {
  it('prefers the issuer tax id, digits only, so formatting never splits one issuer in two', () => {
    assert.equal(
      deriveCaptureScopeKey({ id: 'e1', vendorTaxIdSnapshot: '0-105-5600-1234-5', vendorNameSnapshot: 'ร้านค้า' }),
      'issuer:0105560012345',
    );
  });

  it('falls back to the normalised name, then to the expense id — never to a shared "unknown"', () => {
    assert.equal(
      deriveCaptureScopeKey({ id: 'e1', vendorNameSnapshot: '  ร้าน   ลุงหมี  ' }),
      'issuer:ร้าน ลุงหมี',
    );
    assert.equal(deriveCaptureScopeKey({ id: 'e1' }), 'issuer:e1');
    // Two nameless receipts must not collapse into one scope: that would make the handoff fence
    // refuse the second one as a duplicate of the first.
    assert.notEqual(deriveCaptureScopeKey({ id: 'e1' }), deriveCaptureScopeKey({ id: 'e2' }));
  });

  it('treats a tax id with different punctuation as the same issuer', () => {
    assert.equal(
      deriveCaptureScopeKey({ id: 'e1', vendorTaxIdSnapshot: '0105560012345' }),
      deriveCaptureScopeKey({ id: 'e2', vendorTaxIdSnapshot: '0-105-5600-1234-5' }),
    );
  });
});

describe('expense facts observation (§3.1 conversion)', () => {
  const expense = {
    id: 'e1', status: 'NEEDS_REVIEW', currency: 'THB', expenseDate: '2026-09-18T00:00:00.000Z',
    paymentStatus: 'UNPAID', vendorNameSnapshot: 'ร้านวัสดุ', vendorTaxIdSnapshot: '0105560012345',
    vendorDocumentNumber: 'INV-1', sourceDocumentType: 'RECEIPT', grandTotalAmount: '321.50',
    lines: [
      { lineNumber: 1, description: 'ปูน 1 ถุง', quantity: '1', unitPrice: '300', lineTotalAmount: '300' },
      { lineNumber: 2, description: 'ค่าส่ง', quantity: '1', unitPrice: '21.50', lineTotalAmount: '21.50', chargeKind: 'DELIVERY' },
    ],
  };

  it('copies the stored facts without inventing money and keeps charges out of the item base', () => {
    const facts = buildExpenseFactsObservation(expense);
    assert.equal(facts.documents.length, 1);
    assert.equal(facts.documents[0]!.issuer.taxId, '0105560012345');
    assert.equal(facts.documents[0]!.classification.documentKind, 'RECEIPT');
    // The charge row is a component, never a second item: the §7 discount/shipping base is items.
    assert.deepEqual(facts.items.map((item) => item.description), ['ปูน 1 ถุง']);
    assert.deepEqual(facts.components.map((component) => [component.label, component.role]), [['ค่าส่ง', 'charge']]);
    assert.deepEqual(facts.totals, [{ documentRef: 'expense:e1', kind: 'document_total', amount: '321.50', evidenceSpan: '321.50' }]);
    assert.deepEqual(facts.payments, []);
    assert.equal(facts.completeness.itemsTruncated, false);
  });

  it('maps an unknown document type to NEEDS_REVIEW instead of guessing a kind', () => {
    const facts = buildExpenseFactsObservation({ ...expense, sourceDocumentType: 'EXPENSE_NOTE_TEXT' });
    assert.equal(facts.documents[0]!.kind, 'NEEDS_REVIEW');
  });

  it('records a payment only when the expense says it is paid', () => {
    const facts = buildExpenseFactsObservation({ ...expense, paymentStatus: 'PAID', paidAt: '2026-09-18T03:00:00.000Z', paymentMethod: 'CASH' });
    assert.equal(facts.payments.length, 1);
    assert.equal(facts.payments[0]!.status, 'paid');
    assert.equal(facts.payments[0]!.occurredAt, '2026-09-18T03:00:00.000Z');
  });
});

describe('server-derived blockers and actions', () => {
  it('asks for evidence first, then says it is reading, and never invents a total', () => {
    assert.deepEqual(
      captureGroupBlockers(state({ storedFiles: 0, hasFacts: false })).map((blocker) => blocker.code),
      ['expense_capture_no_evidence'],
    );
    assert.deepEqual(
      captureGroupBlockers(state({ readingFiles: 1, hasFacts: false })).map((blocker) => blocker.code),
      ['expense_capture_read_pending'],
    );
    assert.deepEqual(
      captureGroupBlockers(state({ hasFacts: false })).map((blocker) => blocker.code),
      ['expense_capture_facts_unavailable'],
    );
    assert.deepEqual(captureGroupBlockers(state()), []);
  });

  it('a closed group blocks nothing and allows nothing', () => {
    assert.deepEqual(captureGroupBlockers(state({ status: 'CLOSED_NO_HANDOFF', storedFiles: 0 })), []);
    assert.deepEqual(captureGroupAllowedActions(state({ status: 'CANCELLED' })), []);
  });

  it('drops add_file with the intake flag off but keeps detach, review and close (A47)', () => {
    assert.deepEqual(captureGroupAllowedActions(state()), ['add_file', 'detach_file', 'review', 'close']);
    assert.deepEqual(captureGroupAllowedActions(state({ intakeEnabled: false })), ['detach_file', 'review', 'close']);
  });

  it('offers nothing but reading to a viewer who may not change the group', () => {
    assert.deepEqual(captureGroupAllowedActions(state({ canMutate: false })), []);
  });

  it('withholds close while a handoff is active, because derived expenses exist', () => {
    assert.equal(captureGroupAllowedActions(state({ handoffState: 'ACTIVE' })).includes('close'), false);
  });
});

describe('LINE intake attempt file label', () => {
  it('keeps a label, not a path, and caps the length', () => {
    assert.equal(sanitizeAttemptFileName('/tmp/../receipts/bill.pdf'), 'bill.pdf');
    assert.equal(sanitizeAttemptFileName('C:\\users\\me\\bill.pdf'), 'bill.pdf');
    assert.equal(sanitizeAttemptFileName(`${'ก'.repeat(200)}.pdf`)!.length, 80);
    assert.equal(sanitizeAttemptFileName(undefined), null);
    assert.equal(sanitizeAttemptFileName('   '), null);
  });

  it('strips control characters that would break a log line or a reply', () => {
    assert.equal(sanitizeAttemptFileName(`bill${String.fromCharCode(0)}${String.fromCharCode(10)}.pdf`), 'bill.pdf');
  });
});

describe('capture deep link', () => {
  it('is the path W04 renders and the §10 recovery button opens', () => {
    assert.equal(expenseCaptureWebPath('c1', 'g1'), '/companies/c1/expenses/capture/g1');
  });
});
