import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExpenseSourceDraft } from '@watchdog-bms/contracts';
import {
  expenseSourceDraftChanges,
  expenseSourceDraftFormValues,
  expenseSourceDraftIssues,
} from './expense-source-draft.model';

function sourceDraft(itemCount = 2): ExpenseSourceDraft {
  return {
    status: 'PAUSED',
    canEdit: true,
    header: { expenseDate: null, vendorName: 'ร้านเดิม', businessPurpose: null },
    items: Array.from({ length: itemCount }, (_, index) => ({
      itemRef: `item-${index + 1}`,
      lineId: index === 0 ? 'line-financial-kept' : null,
      description: index === 0 ? 'กาแฟ' : null,
      quantity: index === 0 ? '2' : null,
      unitPrice: index === 0 ? '0' : null,
      totalAmount: index === 0 ? '0' : null,
      expenseCategoryId: null,
    })),
    missingFields: [
      { id: 'D-PURPOSE', scope: 'DOCUMENT', field: 'businessPurpose', prompt: 'ใช้ทำอะไร' },
      { id: 'I-item-2-PRICE', scope: 'ITEM', itemRef: 'item-2', field: 'price', prompt: 'item-2 ราคาเท่าไร' },
    ],
  };
}

describe('expense source draft form model', () => {
  it('patches only changed source facts and preserves zero without materializing blank rows', () => {
    const initial = expenseSourceDraftFormValues(sourceDraft());
    const current = structuredClone(initial);
    current.businessPurpose = 'ประชุมลูกค้า';
    current.items[1]!.description = 'ขนม';
    current.items[1]!.quantity = '';

    assert.deepEqual(expenseSourceDraftChanges(initial, current), {
      businessPurpose: 'ประชุมลูกค้า',
      items: [{ itemRef: 'item-2', description: 'ขนม' }],
    });
    assert.equal(initial.items[0]!.unitPrice, '0', 'a printed zero remains a known zero');
    assert.equal(initial.items[1]!.unitPrice, '', 'unknown price stays blank, not a placeholder zero');
  });

  it('uses null only for fields the person explicitly clears and never sends omitted items', () => {
    const initial = expenseSourceDraftFormValues(sourceDraft(40));
    const current = structuredClone(initial);
    current.vendorName = '';
    current.items[20]!.quantity = '3.5';

    assert.deepEqual(expenseSourceDraftChanges(initial, current), {
      vendorName: null,
      items: [{ itemRef: 'item-21', quantity: '3.5' }],
    });
    assert.equal(initial.items.length, 40, 'all accepted staged items remain available to the form');
  });

  it('appends a web-added item without sending its temporary rendering reference', () => {
    const initial = expenseSourceDraftFormValues(sourceDraft(0));
    const current = structuredClone(initial);
    current.items.push({
      itemRef: '__web-new-1', description: 'กระดาษ', quantity: '', unitPrice: '', totalAmount: '', expenseCategoryId: '',
    });

    assert.deepEqual(expenseSourceDraftChanges(initial, current), {
      items: [{ description: 'กระดาษ' }],
    });
    current.items.push({
      itemRef: '__web-new-2', description: '', quantity: '', unitPrice: '', totalAmount: '', expenseCategoryId: '',
    });
    assert.deepEqual(expenseSourceDraftChanges(initial, current)?.items, [{ description: 'กระดาษ' }], 'a completely blank added row is not persisted');
  });

  it('allows incomplete values but catches malformed supplied numbers before save', () => {
    const values = expenseSourceDraftFormValues(sourceDraft());
    values.items[0]!.quantity = '';
    values.items[0]!.unitPrice = 'free';
    values.items[1]!.totalAmount = '-1';

    assert.deepEqual(expenseSourceDraftIssues(values), [
      { itemRef: 'item-1', field: 'unitPrice' },
      { itemRef: 'item-2', field: 'totalAmount' },
    ]);
    values.items[0]!.quantity = '0';
    assert.deepEqual(expenseSourceDraftIssues(values)[0], { itemRef: 'item-1', field: 'quantity' });
  });

});
