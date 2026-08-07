import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractValueCandidates,
  formatDateClarifyQuestion,
  formatThaiDate,
  isAmbiguousDateCandidate,
  mapThaiDigits,
  toIsoDate,
  VALUE_ASSUMPTIONS,
} from './line-ai-value-normalizer.js';

const TODAY = '2026-07-07';

describe('mapThaiDigits', () => {
  it('maps ๐-๙ one-to-one preserving indices', () => {
    assert.equal(mapThaiDigits('บิล ๖๐.๕๐'), 'บิล 60.50');
    assert.equal(mapThaiDigits('abc').length, 3);
  });
});

describe('toIsoDate', () => {
  it('validates the calendar', () => {
    assert.equal(toIsoDate(9, 12, 1994), '1994-12-09');
    assert.equal(toIsoDate(31, 2, 2024), null);
    assert.equal(toIsoDate(29, 2, 2024), '2024-02-29');
    assert.equal(toIsoDate(29, 2, 2023), null);
  });
});

describe('extractValueCandidates – amounts (golden set)', () => {
  it('บันทึกเงินหกสิบบาท → 60 THB from Thai number words', () => {
    const { amounts } = extractValueCandidates('บันทึกเงินหกสิบบาท', TODAY);
    const hit = amounts.find((a) => a.value === '60');
    assert.ok(hit, 'expected a 60 candidate');
    assert.equal(hit.span, 'หกสิบ');
    assert.equal(hit.currencyToken, 'บาท');
  });

  it('บิล ๖๐ → 60 from Thai digits, no currency', () => {
    const { amounts } = extractValueCandidates('บิล ๖๐', TODAY);
    const hit = amounts.find((a) => a.value === '60');
    assert.ok(hit);
    assert.equal(hit.span, '๖๐');
    assert.equal(hit.currencyToken, undefined);
  });

  it('bill sixty $b → 60 with unknown currency token recorded', () => {
    // normalizeLineText lowercases upstream, so the normalizer sees lowercase input.
    const { amounts } = extractValueCandidates('bill sixty $b', TODAY);
    const hit = amounts.find((a) => a.value === '60');
    assert.ok(hit);
    assert.equal(hit.span, 'sixty');
    assert.equal(hit.currencyToken, '$b');
    assert.ok(hit.assumptions?.includes(VALUE_ASSUMPTIONS.unknownCurrencyToken));
  });

  it('composed Thai words: ห้าร้อยหกสิบเอ็ดบาท → 561', () => {
    const { amounts } = extractValueCandidates('จ่ายห้าร้อยหกสิบเอ็ดบาท', TODAY);
    assert.ok(amounts.some((a) => a.value === '561' && a.currencyToken === 'บาท'));
  });

  it('digits with separators and decimals: 1,234.50 บาท', () => {
    const { amounts } = extractValueCandidates('ยอด 1,234.50 บาท', TODAY);
    const hit = amounts.find((a) => a.value === '1234.5');
    assert.ok(hit);
    assert.equal(hit.span, '1,234.50');
    assert.equal(hit.currencyToken, 'บาท');
  });

  it('numbers inside a date span are NOT amount candidates', () => {
    const { amounts } = extractValueCandidates('บันทึกบิล 9/12/2537 หกสิบบาท', TODAY);
    assert.ok(!amounts.some((a) => a.value === '2537'), 'year must not leak into amounts');
    assert.ok(!amounts.some((a) => a.value === '9'));
    assert.ok(amounts.some((a) => a.value === '60'));
  });
});

describe('extractValueCandidates – dates (golden set)', () => {
  it('9/12/2537 → 1994-12-09 with พ.ศ. read + order assumption', () => {
    const { dates } = extractValueCandidates('บันทึกบิล 9/12/2537', TODAY);
    assert.equal(dates.length, 1);
    const d = dates[0];
    assert.equal(d.isoDate, '1994-12-09');
    assert.equal(d.yearBe, 2537);
    assert.equal(d.day, 9);
    assert.equal(d.month, 12);
    assert.ok(d.assumptions.includes(VALUE_ASSUMPTIONS.eraReadBe));
    assert.ok(d.assumptions.includes(VALUE_ASSUMPTIONS.orderAssumedDayMonth));
    assert.equal(isAmbiguousDateCandidate(d), false);
  });

  it('09/11/1994 → CE resolved (implausible as พ.ศ.), canonical D/M order', () => {
    const { dates } = extractValueCandidates('เอกสาร 09/11/1994', TODAY);
    assert.equal(dates.length, 1);
    const d = dates[0];
    assert.equal(d.isoDate, '1994-11-09');
    assert.equal(d.yearBe, 2537);
    assert.ok(d.assumptions.includes(VALUE_ASSUMPTIONS.eraResolvedCe));
    assert.ok(d.assumptions.includes(VALUE_ASSUMPTIONS.orderAssumedDayMonth));
  });

  it('วันที่เก้า เดือน11ปี2537 → labels lock day/month, no order assumption', () => {
    const { dates } = extractValueCandidates('วันที่เก้า เดือน11ปี2537', TODAY);
    assert.equal(dates.length, 1);
    const d = dates[0];
    assert.equal(d.isoDate, '1994-11-09');
    assert.equal(d.day, 9);
    assert.equal(d.month, 11);
    assert.ok(!d.assumptions.includes(VALUE_ASSUMPTIONS.orderAssumedDayMonth));
  });

  it('9/11/37 → two materially different readings, both ambiguous (discovery)', () => {
    const { dates } = extractValueCandidates('บิล 9/11/37', TODAY);
    assert.equal(dates.length, 2);
    const years = dates.map((d) => d.yearBe).sort();
    assert.deepEqual(years, [2537, 2580]);
    assert.ok(dates.every(isAmbiguousDateCandidate));
    assert.deepEqual(dates.map((d) => d.isoDate).sort(), ['1994-11-09', '2037-11-09']);
  });

  it('day > 12 locks the reading deterministically', () => {
    const { dates } = extractValueCandidates('25/3/2568', TODAY);
    assert.equal(dates.length, 1);
    assert.equal(dates[0].isoDate, '2025-03-25');
    assert.ok(!dates[0].assumptions.includes(VALUE_ASSUMPTIONS.orderAssumedDayMonth));
  });

  it('second part > 12 means the first part is the month', () => {
    const { dates } = extractValueCandidates('3/25/2025', TODAY);
    assert.equal(dates.length, 1);
    assert.equal(dates[0].isoDate, '2025-03-25');
  });

  it('Thai month name: 9 ธ.ค. 2537', () => {
    const { dates } = extractValueCandidates('เอกสารวันที่ 9 ธ.ค. 2537', TODAY);
    assert.ok(dates.some((d) => d.isoDate === '1994-12-09'));
  });

  it('month-year period: ธันวาคม 2537 → boundary candidates, never a day date', () => {
    const { dates } = extractValueCandidates('ค่าใช้จ่ายเดือนธันวาคม 2537', TODAY);
    const boundaries = dates.filter((d) => d.assumptions.includes(VALUE_ASSUMPTIONS.monthPeriodBoundary));
    assert.deepEqual(boundaries.map((d) => d.isoDate).sort(), ['1994-12-01', '1994-12-31']);
  });

  it('BE-written ISO 2537-12-09 resolves to CE wire date', () => {
    const { dates } = extractValueCandidates('วันที่ 2537-12-09', TODAY);
    assert.ok(dates.some((d) => d.isoDate === '1994-12-09' && d.yearBe === 2537));
  });

  it('invalid calendar dates are dropped', () => {
    const { dates } = extractValueCandidates('31/2/2568', TODAY);
    assert.equal(dates.length, 0);
  });

  it('future dates are flagged against injected today', () => {
    const { dates } = extractValueCandidates('9/12/2570', TODAY);
    assert.equal(dates[0]?.isoDate, '2027-12-09');
    assert.ok(dates[0].assumptions.includes(VALUE_ASSUMPTIONS.futureDate));
  });
});

describe('extractValueCandidates – span property', () => {
  it('every candidate span occurs verbatim in the source text', () => {
    const samples = [
      'บันทึกเงินหกสิบบาท',
      'บิล ๖๐',
      'bill sixty $b',
      'บันทึกบิล 9/12/2537 หกสิบบาท แล้วยอดขายวันนี้',
      'ค่าใช้จ่าย 09/11/1994 รวม 1,234.50 บาท และวันที่เก้า เดือน11ปี2537',
      'เทียบ ธันวาคม 2537 กับ 9/11/37',
    ];
    for (const text of samples) {
      const { amounts, dates } = extractValueCandidates(text, TODAY);
      for (const c of [...amounts, ...dates]) {
        assert.ok(text.includes(c.span), `span "${c.span}" not found in "${text}"`);
      }
    }
  });

  it('multi-command sentence yields both kinds', () => {
    const { amounts, dates } = extractValueCandidates('บันทึกบิล 9/12/2537 หกสิบบาท แล้วยอดขายเดือนนี้เท่าไหร่', TODAY);
    assert.ok(amounts.some((a) => a.value === '60'));
    assert.ok(dates.some((d) => d.isoDate === '1994-12-09'));
  });
});

describe('formatThaiDate / formatDateClarifyQuestion', () => {
  it('formats canonical Thai display', () => {
    assert.equal(formatThaiDate({ day: 9, month: 12, yearBe: 2537 }), '9 ธ.ค. 2537');
  });

  it('builds a bounded clarify naming the concrete choices', () => {
    const { dates } = extractValueCandidates('บิล 9/11/37', TODAY);
    const question = formatDateClarifyQuestion(dates);
    assert.ok(question);
    assert.ok(question.includes('9/11/37'));
    assert.ok(question.includes('9 พ.ย. 2537'));
    assert.ok(question.includes('9 พ.ย. 2580'));
    assert.ok(question.length <= 200);
  });

  it('returns null when nothing is ambiguous', () => {
    const { dates } = extractValueCandidates('9/12/2537', TODAY);
    assert.equal(formatDateClarifyQuestion(dates), null);
  });
});
