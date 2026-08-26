import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t, getDefaultLocale } from './workspace-i18n.logic';

describe('workspace-i18n', () => {
  it('returns Thai string for th locale', () => {
    assert.strictEqual(t('dashboard.title', 'th'), 'แดชบอร์ด');
  });

  it('returns English string for en locale', () => {
    assert.strictEqual(t('dashboard.title', 'en'), 'Dashboard');
  });

  it('getDefaultLocale returns th', () => {
    assert.strictEqual(getDefaultLocale(), 'th');
  });

  // WEB-05: the receipt upload form writes `expenseDate`, so the label must name the date printed
  // on the paper. It used to read "วันที่อัพโหลดใบเสร็จ", which invited today's date instead.
  it('names the receipt date field after the date on the receipt, with an example', () => {
    assert.strictEqual(t('expenses.upload_receipt_date', 'th'), 'วันที่ในใบเสร็จ');
    assert.doesNotMatch(t('expenses.upload_receipt_date', 'th'), /อัพโหลด|อัปโหลด/);
    assert.match(t('expenses.upload_receipt_date_hint', 'th'), /ไม่ใช่วันนี้/);
  });

  it('falls back to key for unknown key (cast as any)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual(t('not.a.real.key' as any, 'th'), 'not.a.real.key');
  });
});
