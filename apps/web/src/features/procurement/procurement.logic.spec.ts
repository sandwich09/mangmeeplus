import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseProcurementTab, visibleProcurementTabs } from './procurement.logic';

describe('visibleProcurementTabs', () => {
  it('keeps the page order for every readable procurement panel', () => {
    assert.deepEqual(
      visibleProcurementTabs([
        'procurement.goods_receipt.read',
        'procurement.purchase_order.read',
        'procurement.purchase_request.read',
        'procurement.supplier.read',
      ]),
      ['suppliers', 'pr', 'po', 'gr'],
    );
  });

  it('shows only panels whose list endpoint the session can read', () => {
    assert.deepEqual(visibleProcurementTabs(['procurement.purchase_request.read']), ['pr']);
    assert.deepEqual(visibleProcurementTabs(['procurement.goods_receipt.read']), ['gr']);
    assert.deepEqual(visibleProcurementTabs(['procurement.purchase_order.issue']), []);
    assert.deepEqual(visibleProcurementTabs([]), []);
  });

  it('shows only related document panels without exposing supplier master', () => {
    assert.deepEqual(visibleProcurementTabs([
      'procurement.purchase_request.read_related',
      'procurement.purchase_order.read_related',
      'procurement.goods_receipt.read_related',
    ]), ['pr', 'po', 'gr']);
  });
});

describe('parseProcurementTab', () => {
  it('honours a visible deep link', () => {
    assert.equal(parseProcurementTab('gr', ['pr', 'gr']), 'gr');
  });

  it('falls back to the first visible panel for hidden or unknown values', () => {
    assert.equal(parseProcurementTab('suppliers', ['pr', 'gr']), 'pr');
    assert.equal(parseProcurementTab('__unknown__', ['po', 'gr']), 'po');
    assert.equal(parseProcurementTab(null, ['gr']), 'gr');
  });

  it('keeps a typed fallback when no panel is visible', () => {
    assert.equal(parseProcurementTab('pr', []), 'suppliers');
  });
});
