import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SpecialistOutput } from '@watchdog-bms/contracts';
import { activePreparedFamilies, COMPILED_PREPARED_FAMILY_KEYS, formatPreparedSimpleRead } from './prepared-simple-read-formatter';

const SALES = 'sales.get_sales_summary::single_metric';

function salesOutput(data: Record<string, unknown>): SpecialistOutput {
  return {
    agent: 'accounting', status: 'SUCCEEDED', summary: '',
    facts: [{ label: 'ยอดขาย', value: `${String(data['totalSales'])} บาท`, sourceRef: { label: 'ยอดขายรวม', module: 'sales', entityType: 'summary', permissionChecked: true, webPath: '/sales' } }],
    suggestions: [], toolCalls: [{ name: 'sales.get_sales_summary', status: 'ok', durationMs: 1 }], requiresHumanReview: false,
    toolData: [{ tool: 'sales.get_sales_summary', data }], asOf: '2026-07-15T00:00:00Z',
  };
}

describe('prepared-simple-read compiled formatter registry', () => {
  it('exposes exactly the compiled families (sales single_metric to date)', () => {
    assert.deepEqual([...COMPILED_PREPARED_FAMILY_KEYS], [SALES]);
  });

  it('narrows by the operator allowlist: only a listed compiled key is active; unknown strings are ignored', () => {
    assert.deepEqual([...activePreparedFamilies([])], []);
    assert.deepEqual([...activePreparedFamilies(['evil::family', 'inventory.list_low_stock::single_metric'])], []);
    assert.deepEqual([...activePreparedFamilies([SALES, 'evil::family'])], [SALES]);
  });

  it('formats a sales single_metric answer with grounded number, source, as-of, and link', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '12,345', transactionCount: 42, basis: 'accrual' }), { language: 'th', locale: 'th-TH' });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /ยอดขาย: 12,345 บาท \(42 รายการ\)/);
      assert.match(r.replyText, /ที่มา: ยอดขายรวม/);
      assert.match(r.replyText, /ข้อมูล ณ 2026-07-15/);
      assert.equal(r.webLinks[0]?.path, '/sales');
    }
  });

  it('states the REQUESTED single date from the validated proposed input (Thai)', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '5,000', period: { fromDate: '2026-07-01', toDate: '2026-07-31' } }),
      { language: 'th', locale: 'th-TH', proposedInput: { fromDate: '2026-07-15', toDate: '2026-07-15' } });
    assert.equal(r.kind, 'answer');
    // The proposed input WINS over the echoed range: the answer names the requested single day.
    if (r.kind === 'answer') assert.match(r.replyText, /\nช่วง: 2026-07-15/);
  });

  it('states the REQUESTED date range from the validated proposed input (English)', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '9,000' }),
      { language: 'en', locale: 'en-US', proposedInput: { fromDate: '2026-07-01', toDate: '2026-07-31' } });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nPeriod: 2026-07-01 – 2026-07-31/);
  });

  it('falls back to the tool-echoed effective period when the proposed input names none (default period)', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '3,000', period: 'เดือนนี้' }),
      { language: 'th', locale: 'th-TH', proposedInput: {} });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /\nช่วง: เดือนนี้/);
  });

  it('never fabricates a period: omits the line when neither the input nor the tool names one', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '1,000' }), { language: 'th', locale: 'th-TH' });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') {
      assert.match(r.replyText, /ยอดขาย: 1,000 บาท/);
      assert.doesNotMatch(r.replyText, /ช่วง:/, 'no fabricated period line');
    }
  });

  it('honestly renders an explicit-empty (zero) period, not a fabricated non-zero', () => {
    const r = formatPreparedSimpleRead(SALES, salesOutput({ totalSales: '0', transactionCount: 0 }), { language: 'th', locale: 'th-TH' });
    assert.equal(r.kind, 'answer');
    if (r.kind === 'answer') assert.match(r.replyText, /ยอดขาย: 0 บาท/);
  });

  it('returns unverified when the total is absent (caller falls back to an honest terminal)', () => {
    assert.equal(formatPreparedSimpleRead(SALES, salesOutput({ transactionCount: 5 }), { language: 'th', locale: 'th-TH' }).kind, 'unverified');
  });

  it('returns unverified for a family key with no compiled formatter', () => {
    assert.equal(formatPreparedSimpleRead('inventory.list_low_stock::single_metric', salesOutput({ totalSales: '1' }), { language: 'th', locale: 'th-TH' }).kind, 'unverified');
  });
});
