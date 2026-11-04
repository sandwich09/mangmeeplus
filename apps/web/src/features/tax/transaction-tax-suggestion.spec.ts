import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedLineTaxCode } from './transaction-tax.model';

const OFFERED = [{ externalCode: 'O7' }, { externalCode: 'OX' }];

describe('suggestedLineTaxCode (spec §7, §12)', () => {
  it('suggests the category default when the picker is already offering it', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: 'O7', lineHasTaxCode: false, available: OFFERED,
    }), 'O7');
  });

  // AC3. The reviewer's own choice is never replaced, cleared or overridden.
  it('leaves a line that already has a Tax Code alone', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: 'O7', lineHasTaxCode: true, available: OFFERED,
    }), null);
  });

  it('suggests nothing when the category has no default', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: null, lineHasTaxCode: false, available: OFFERED,
    }), null);
  });

  // E1/E2/E4 all reach this function the same way: the picker's filter already dropped the code,
  // so an unresolvable default is indistinguishable from an absent one — which is the point.
  // A stale suggestion must never become a wrong pre-fill.
  it('suggests nothing when the code is not among what the picker offers', () => {
    for (const available of [OFFERED, [] as Array<{ externalCode: string }>]) {
      assert.equal(suggestedLineTaxCode({
        categoryDefaultInputTaxCode: 'RETIRED_CODE', lineHasTaxCode: false, available,
      }), null);
    }
  });

  // E5: a company with no Tax Code profile offers nothing, so nothing is suggested.
  it('suggests nothing when the company offers no codes at all', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: 'O7', lineHasTaxCode: false, available: [],
    }), null);
  });

  it('matches on the exact code, not a prefix', () => {
    assert.equal(suggestedLineTaxCode({
      categoryDefaultInputTaxCode: 'O', lineHasTaxCode: false, available: OFFERED,
    }), null);
  });
});


import { mock } from 'node:test';
import { certificateHarness, h, mutable } from '../expenses/expense-certificate-test-harness';
const chooser = mutable('@/common/components/field/ThemedSelect');
const { TransactionTaxLineSelector } = require('./TransactionTaxLineSelector');
it('PWS-VAT-CHOICE renders expense labels and a safe guide exit while preserving non-expense copy', () => {
  const select = mock.method(chooser, 'ThemedSelect', (props: any) => h('select', props, props.children));
  const props = { companyId: 'co', sourceType: 'expense.record', sourceId: 'e1', sourceLineId: 'l1', transactionContext: 'DOMESTIC_PURCHASE', direction: 'INPUT', documentDate: '2026-11-04', netAmount: '100', grossAmount: '107', onChange() {}, canConfigureTax: true };
  const preview = { warnings: [], errors: ['tax_account_rule_missing'], components: [] };
  const view = certificateHarness(() => h(TransactionTaxLineSelector, props), [[], preview, false, '']);
  try {
    const html = view.render();
    assert.match(html, /aria-label="รูปแบบ VAT ของรายการ"/);
    assert.match(html, /เลือกตามใบกำกับภาษี โดยใช้ VAT ตอนยื่นภาษีได้ตามเงื่อนไขของรายการ/);
    assert.match(html, /ยังตรวจ VAT ของรายการนี้ไม่ได้ ให้ผู้ทำบัญชีตรวจการตั้งค่า/);
    assert.match(html, /href="\/companies\/co\/user-guide\/expenses"/);
    assert.doesNotMatch(html, /accounting-tax-setup|Tax Code|ขอคืนได้/);
    const other = certificateHarness(() => h(TransactionTaxLineSelector, { ...props, sourceType: 'procurement.vendor_bill' }), [[], preview, false, '']);
    assert.match(other.render(), /aria-label="เลือกประเภทภาษีของรายการ"/);
    assert.match(other.render(), /ผูกบัญชี/);
  } finally { view.cleanup(); select.mock.restore(); }
});
