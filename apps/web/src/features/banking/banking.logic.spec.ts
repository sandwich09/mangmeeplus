import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyStatementFile,
  parseDelimitedStatement,
  rankCandidatesForLine,
  suggestedAllocation,
  confirmedMatchedTotal,
  sha256Hex,
  visibleBankingTabs,
  parseBankingTab,
} from './banking.logic';

describe('banking tab access', () => {
  it('shows only the cash tab to a cash-only session', () => {
    assert.deepEqual(visibleBankingTabs(['bank.cash.read']), ['cash']);
  });

  it('uses the tab-owned read permission rather than a mutation permission', () => {
    assert.deepEqual(
      visibleBankingTabs(['bank.account.read', 'bank.statement.import', 'bank.match.confirm']),
      ['accounts'],
    );
  });

  it('falls back hidden and unknown deep links to the first visible tab', () => {
    assert.equal(parseBankingTab('accounts', ['cash']), 'cash');
    assert.equal(parseBankingTab('unknown', ['matching', 'adjustments']), 'matching');
    assert.equal(parseBankingTab('adjustments', ['matching', 'adjustments']), 'adjustments');
  });

  it('returns no tabs when no tab-owned read permission exists', () => {
    assert.deepEqual(visibleBankingTabs([]), []);
  });
});

describe('classifyStatementFile', () => {
  it('accepts every explicitly supported extension/MIME pair', () => {
    for (const [name, mime, expected] of [
      ['statement.csv', 'text/csv', 'delimited'],
      ['statement.tsv', 'text/tab-separated-values', 'delimited'],
      ['statement.txt', 'text/plain', 'delimited'],
      ['statement.pdf', 'application/pdf', 'extractable'],
      ['statement.png', 'image/png', 'extractable'],
      ['statement.jpg', 'image/jpeg', 'extractable'],
      ['statement.jpeg', 'image/jpeg', 'extractable'],
    ] as const) {
      assert.equal(classifyStatementFile(name, mime), expected);
    }
  });

  it('never falls back to text for unknown or mismatched files', () => {
    for (const [name, mime] of [
      ['statement.exe', 'text/plain'],
      ['statement.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['statement.pdf', 'text/plain'],
      ['statement.csv', 'application/pdf'],
      ['statement.svg', 'image/svg+xml'],
    ]) {
      assert.equal(classifyStatementFile(name, mime), 'unsupported');
    }
  });
});

describe('parseDelimitedStatement', () => {
  it('parses comma-separated rows keyed by header', () => {
    const { headers, rows } = parseDelimitedStatement('วันที่,รายการ,ถอน,ฝาก\n2026-07-01,โอนเข้า,,1500.00\n');
    assert.deepEqual(headers, ['วันที่', 'รายการ', 'ถอน', 'ฝาก']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['วันที่'], '2026-07-01');
    assert.equal(rows[0]['ฝาก'], '1500.00');
    assert.equal(rows[0]['ถอน'], '');
  });

  it('parses tab-separated rows pasted from Excel', () => {
    const { rows } = parseDelimitedStatement('date\tdescription\tamount\n2026-07-02\tค่าบริการ\t-350.25');
    assert.equal(rows[0].amount, '-350.25');
    assert.equal(rows[0].description, 'ค่าบริการ');
  });

  it('handles quoted CSV fields containing commas and escaped quotes', () => {
    const { rows } = parseDelimitedStatement('date,description,amount\n2026-07-03,"โอน, บริษัท ""เอ"" จำกัด",100.00');
    assert.equal(rows[0].description, 'โอน, บริษัท "เอ" จำกัด');
  });

  it('strips BOM and skips blank lines', () => {
    const { headers, rows } = parseDelimitedStatement('﻿date,amount\n\n2026-07-04,50.00\n\n');
    assert.deepEqual(headers, ['date', 'amount']);
    assert.equal(rows.length, 1);
  });

  it('returns empty result for empty input', () => {
    assert.deepEqual(parseDelimitedStatement(''), { headers: [], rows: [] });
  });
});

describe('rankCandidatesForLine', () => {
  const line = { direction: 'DEPOSIT', signedAmount: '1500.00', postedDate: '2026-07-01', currency: 'THB' };
  const cand = (over: Record<string, string>) => ({
    direction: 'DEPOSIT', currency: 'THB', paymentDate: '2026-07-01', remainingUnmatchedAmount: '1500.00', ...over,
  });

  it('filters out wrong-direction and wrong-currency candidates', () => {
    const out = rankCandidatesForLine(line, [
      cand({ id: 'ok' }),
      cand({ id: 'wrong-dir', direction: 'WITHDRAWAL' }),
      cand({ id: 'wrong-ccy', currency: 'USD' }),
    ] as any[]);
    assert.deepEqual(out.map((c: any) => c.id), ['ok']);
  });

  it('sorts by closest amount then closest date', () => {
    const out = rankCandidatesForLine(line, [
      cand({ id: 'far-amount', remainingUnmatchedAmount: '900.00' }),
      cand({ id: 'exact-far-date', paymentDate: '2026-06-25' }),
      cand({ id: 'exact-same-date' }),
    ] as any[]);
    assert.deepEqual(out.map((c: any) => c.id), ['exact-same-date', 'exact-far-date', 'far-amount']);
  });
});

describe('suggestedAllocation', () => {
  it('prefills the full line amount when nothing is matched yet', () => {
    assert.equal(suggestedAllocation('-1500.00', '0.00', '2000.00'), '1500.00');
  });

  it('caps at the candidate remaining amount', () => {
    assert.equal(suggestedAllocation('1500.00', '0.00', '900.00'), '900.00');
  });

  it('subtracts already matched allocations', () => {
    assert.equal(suggestedAllocation('1500.00', '600.00', '2000.00'), '900.00');
  });

  it('never suggests below zero', () => {
    assert.equal(suggestedAllocation('100.00', '150.00', '2000.00'), '0.00');
  });
});

describe('confirmedMatchedTotal', () => {
  it('sums only confirmed allocations', () => {
    assert.equal(
      confirmedMatchedTotal([
        { status: 'CONFIRMED', allocatedAmount: '10.50' },
        { status: 'CONFIRMED', allocatedAmount: '0.25' },
        { status: 'VOIDED', allocatedAmount: '99.00' },
      ]),
      '10.75',
    );
  });
});

describe('sha256Hex', () => {
  it('produces the well-known hash for "abc"', async () => {
    assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
