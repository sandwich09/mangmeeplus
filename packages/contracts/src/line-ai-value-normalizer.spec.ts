import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractValueCandidates,
  formatDateClarifyQuestion,
  formatThaiDate,
  isAmbiguousDateCandidate,
  formatThaiPeriodRange,
  isAmbiguousPeriodCandidate,
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

  it('English month-first and day-first dates resolve a named two-digit year as CE', () => {
    for (const text of ['Aug 23 26', '23 Aug. ’26', 'August 23rd, 2026', '23 August 2026']) {
      const { dates } = extractValueCandidates(text, TODAY);
      assert.ok(dates.some((d) => d.isoDate === '2026-08-23'), text);
      assert.ok(dates.every((d) => !isAmbiguousDateCandidate(d)), text);
    }
    const shortYear = extractValueCandidates('Aug 23 26', TODAY).dates[0];
    assert.ok(shortYear?.assumptions.includes(VALUE_ASSUMPTIONS.twoDigitYearResolvedEnglishMonth));
  });

  it('accepts every punctuation-stripped Thai month abbreviation and anchors yy to BE', () => {
    const aliases = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];
    aliases.forEach((alias, index) => {
      const { dates } = extractValueCandidates(`วันที่ 15 ${alias} 69`, TODAY);
      const hit = dates.find((d) => d.isoDate === `2026-${String(index + 1).padStart(2, '0')}-15`);
      assert.ok(hit, alias);
      assert.ok(hit.assumptions.includes(VALUE_ASSUMPTIONS.twoDigitYearResolvedThaiMonth), alias);
      assert.equal(isAmbiguousDateCandidate(hit), false, alias);
    });
  });

  it('numeric two-digit date has no calendar-language anchor, but a receipt still cannot be from 1983', () => {
    // Owner decision 2026-08-28: the day here is 23, so the วัน/เดือน order is not in question and the
    // only thing left to settle is the era — which a receipt settles by existing. พ.ศ. 2526 reads as
    // 1983, four decades before this document could have been issued, so the reading that survives is
    // the one an expense could actually carry. A date whose ORDER is unknowable stays ambiguous; see
    // the "7-6-69" suite below.
    const { dates } = extractValueCandidates('23/08/26', TODAY);
    assert.deepEqual(dates.map((d) => d.isoDate).sort(), ['2026-08-23']);
    assert.ok(dates.every((d) => !isAmbiguousDateCandidate(d)));
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
      'Aug 23 26 / วันที่ 15 สค 69 / VAT 21.79',
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

// Owner decision 2026-08-28, from a handwritten vegetable bill dated "7-6-69". Two different things
// were being called ambiguous and both were discarded: which part is the day, and which era the
// two-digit year belongs to. Only the first is genuinely unknowable — the owner's own words, "7-6
// could be 7 June or 6 July, leave it blank and let the user type it". The era is not: a receipt
// records something that already happened, so "69" can only be พ.ศ. 2569 and "24" only ค.ศ. 2024.
describe('a two-digit year resolves by era only when the day/month order is already certain', () => {
  const read = (text: string) => extractValueCandidates(text, '2026-08-28').dates
    .filter((d) => !isAmbiguousDateCandidate(d)).map((d) => d.isoDate);

  it('leaves the owner case blank, because nobody can tell 7 June from 6 July', () => {
    assert.deepEqual(read('วันที่ 7-6-69'), [], 'no usable reading — the review form asks the person who was there');
  });

  it('keeps a Thai bill whose day cannot be a month', () => {
    assert.deepEqual(read('วันที่ 25-6-69'), ['2026-06-25']);
    assert.deepEqual(read('วันที่ 13/08/69'), ['2026-08-13']);
  });

  it('reads a western two-digit year as ค.ศ., because พ.ศ. would date it to 1981', () => {
    assert.deepEqual(read('25/6/24'), ['2024-06-25']);
    assert.deepEqual(read('25-6-11'), ['2011-06-25']);
  });

  it('stays blank when neither era could be a receipt', () => {
    assert.deepEqual(read('25-6-99'), [], 'พ.ศ. 2599 and ค.ศ. 2099 are both ahead of today');
  });

  it('does not disturb the dates that were already unambiguous', () => {
    assert.deepEqual(read('วันที่ 15-08-2569'), ['2026-08-15']);
    assert.deepEqual(read('Date: 14/08/2026'), ['2026-08-14']);
    assert.deepEqual(read('วันที่ 23 สค 69'), ['2026-08-23']);
  });
});

// Spec `line-ai-draft-control-spec-th.md` §5.2/§11, from UAT 2026-09-03: a BHC bill printing
// "03/09/69" recorded no date at all, because chat's 2026-08-28 rule (never guess the วัน/เดือน
// order) also blocked the era. A receipt has nobody to ask and Thai receipts print DD/MM, so
// `documentContext: 'receipt'` resolves both — and says so with an assumption on every candidate.
describe('receipt mode reads a printed Thai DD/MM date, with the assumption recorded', () => {
  const TODAY = '2026-09-30';
  const receipt = (text: string) => extractValueCandidates(text, TODAY, { documentContext: 'receipt' }).dates
    .filter((d) => !isAmbiguousDateCandidate(d));
  const iso = (text: string) => receipt(text).map((d) => d.isoDate);
  const chat = (text: string) => extractValueCandidates(text, TODAY).dates
    .filter((d) => !isAmbiguousDateCandidate(d)).map((d) => d.isoDate);

  const table: Array<[string, string[], string[]]> = [
    // printed span            expected ISO      expected assumptions on the single reading
    ['03/09/69', ['2026-09-03'], ['order_assumed_day_month', 'two_digit_year_resolved_plausible_era']],
    ['3/9/69', ['2026-09-03'], ['order_assumed_day_month', 'two_digit_year_resolved_plausible_era']],
    ['12/09/69', ['2026-09-12'], ['order_assumed_day_month', 'two_digit_year_resolved_plausible_era']],
    // 13 cannot be a month, so the order was never in doubt and no order assumption is recorded.
    ['13/09/69', ['2026-09-13'], ['two_digit_year_resolved_plausible_era']],
    ['9/3/2569', ['2026-03-09'], ['order_assumed_day_month', 'era_read_be']],
    ['2026-09-03', ['2026-09-03'], ['era_resolved_ce']],
    ['03-09-2569', ['2026-09-03'], ['order_assumed_day_month', 'era_read_be']],
    ['', [], []],
    // 31 ก.พ. is not a day the calendar has; an invalid date is no date, in either mode.
    ['31/02/69', [], []],
  ];

  for (const [text, expected, assumptions] of table) {
    it(`reads ${text === '' ? '(empty)' : text} as ${expected.join(',') || '(no date)'}`, () => {
      assert.deepEqual(iso(text), expected);
      if (expected.length > 0) assert.deepEqual(receipt(text)[0]!.assumptions, assumptions);
    });
  }

  it('picks the era nearest today when the plausibility window leaves both', () => {
    // พ.ศ. 2599 → 2056 and ค.ศ. 2099 are both ahead of today, so the window narrows nothing.
    // Chat leaves it blank; a receipt takes the nearer reading and flags it, and the resolved date
    // still trips the caller's future-date guard rather than passing as read-off-the-page fact.
    assert.deepEqual(iso('25-6-99'), ['2056-06-25']);
    assert.ok(receipt('25-6-99')[0]!.assumptions.includes('future_date'));
    assert.deepEqual(chat('25-6-99'), []);
  });

  it('leaves chat mode byte-for-byte as it was', () => {
    assert.deepEqual(chat('03/09/69'), [], 'chat still refuses the order it cannot tell apart');
    assert.deepEqual(chat('วันที่ 7-6-69'), []);
    assert.deepEqual(chat('13/09/69'), ['2026-09-13']);
    assert.deepEqual(
      extractValueCandidates('จ่าย 250 บาท วันที่ 7-6-69', TODAY),
      extractValueCandidates('จ่าย 250 บาท วันที่ 7-6-69', TODAY, { documentContext: 'chat' }),
    );
  });
});

// ── period resolution (period-resolution spec §3.1, P-01) ────────────────────
//
// Table-driven: one row per vocabulary case the spec's §3.1 table requires, plus the turnover,
// leap-day, era and future/fuzzy edges. `today` is INJECTED in every row — nothing here reads the
// clock — and every row also proves the candidate's span is an exact substring of the source text
// (ADR 0011: the user's message is annotated, never rewritten).

type PeriodRow = {
  text: string;
  today: string;
  /** Expected first candidate, or null when the text must produce none. */
  expect: null | {
    kind: string;
    fromDate: string;
    toDate: string;
    monthKey?: string;
    source?: string;
    label?: string;
    assumptions?: string[];
  };
};

const FRIDAY = '2026-09-18';

const PERIOD_TABLE: PeriodRow[] = [
  // days
  { text: 'วันนี้ขายได้เท่าไหร่', today: FRIDAY, expect: { kind: 'day', fromDate: FRIDAY, toDate: FRIDAY, source: 'relative', label: 'วันนี้ (18 ก.ย. 2569)' } },
  { text: 'how much did we sell today', today: FRIDAY, expect: { kind: 'day', fromDate: FRIDAY, toDate: FRIDAY } },
  { text: 'ยอดขายเมื่อวาน', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-17', toDate: '2026-09-17', label: 'เมื่อวาน (17 ก.ย. 2569)' } },
  { text: 'เมื่อวานนี้ใช้เงินเท่าไหร่', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-17', toDate: '2026-09-17' } },
  { text: 'yesterday sales', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-17', toDate: '2026-09-17' } },
  { text: 'ยอดขายวันก่อน', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-17', toDate: '2026-09-17', assumptions: ['day_before_read_as_yesterday'] } },
  { text: 'ปิดยอดเมื่อวานซืน', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-16', toDate: '2026-09-16' } },
  { text: 'sales the day before yesterday', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-16', toDate: '2026-09-16' } },
  { text: 'ยอดขาย 3 วันก่อน', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-15', toDate: '2026-09-15' } },
  { text: 'ยอดขาย ๓ วันก่อน', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-15', toDate: '2026-09-15' } },
  { text: 'sales 5 days ago', today: FRIDAY, expect: { kind: 'day', fromDate: '2026-09-13', toDate: '2026-09-13' } },
  // several days back
  { text: 'ค่าใช้จ่าย 7 วันล่าสุด', today: FRIDAY, expect: { kind: 'last_n_days', fromDate: '2026-09-12', toDate: FRIDAY, assumptions: ['last_n_days_include_today'] } },
  { text: 'ยอดขาย 3 วันที่ผ่านมา', today: FRIDAY, expect: { kind: 'last_n_days', fromDate: '2026-09-16', toDate: FRIDAY } },
  { text: 'expenses last 7 days', today: FRIDAY, expect: { kind: 'last_n_days', fromDate: '2026-09-12', toDate: FRIDAY } },
  { text: 'ยอดขาย 30 วันย้อนหลัง', today: FRIDAY, expect: { kind: 'last_n_days', fromDate: '2026-08-20', toDate: FRIDAY } },
  // weeks — Monday to Sunday, Bangkok
  { text: 'สัปดาห์นี้ขายได้เท่าไหร่', today: FRIDAY, expect: { kind: 'week', fromDate: '2026-09-14', toDate: FRIDAY, assumptions: ['week_monday_sunday', 'period_clamped_to_today'] } },
  { text: 'อาทิตย์นี้ขายได้เท่าไหร่', today: FRIDAY, expect: { kind: 'week', fromDate: '2026-09-14', toDate: FRIDAY } },
  { text: 'sales this week', today: FRIDAY, expect: { kind: 'week', fromDate: '2026-09-14', toDate: FRIDAY } },
  { text: 'ค่าใช้จ่ายสัปดาห์ที่แล้ว', today: FRIDAY, expect: { kind: 'week', fromDate: '2026-09-07', toDate: '2026-09-13', label: 'สัปดาห์ที่แล้ว (7–13 ก.ย. 2569)' } },
  { text: 'ค่าใช้จ่ายอาทิตย์ที่แล้ว', today: FRIDAY, expect: { kind: 'week', fromDate: '2026-09-07', toDate: '2026-09-13' } },
  { text: 'ค่าใช้จ่ายสัปดาห์ก่อน', today: FRIDAY, expect: { kind: 'week', fromDate: '2026-09-07', toDate: '2026-09-13' } },
  { text: 'expenses last week', today: FRIDAY, expect: { kind: 'week', fromDate: '2026-09-07', toDate: '2026-09-13' } },
  { text: 'ยอดขาย 2 สัปดาห์ที่แล้ว', today: FRIDAY, expect: { kind: 'week', fromDate: '2026-08-31', toDate: '2026-09-06' } },
  // a week that starts on a Monday and one that ends on a Sunday
  { text: 'สัปดาห์นี้', today: '2026-09-14', expect: { kind: 'week', fromDate: '2026-09-14', toDate: '2026-09-14' } },
  { text: 'สัปดาห์นี้', today: '2026-09-20', expect: { kind: 'week', fromDate: '2026-09-14', toDate: '2026-09-20' } },
  // months
  { text: 'เดือนนี้ใช้เงินไปเท่าไหร่แล้ว', today: FRIDAY, expect: { kind: 'month', fromDate: '2026-09-01', toDate: FRIDAY, monthKey: '2026-09', assumptions: ['period_clamped_to_today'] } },
  { text: 'expenses this month', today: FRIDAY, expect: { kind: 'month', fromDate: '2026-09-01', toDate: FRIDAY, monthKey: '2026-09' } },
  { text: 'ค่าใช้จ่ายเดือนที่แล้ว', today: FRIDAY, expect: { kind: 'month', fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08', label: 'เดือนที่แล้ว (1–31 ส.ค. 2569)' } },
  { text: 'ค่าใช้จ่ายเดือนก่อน', today: FRIDAY, expect: { kind: 'month', fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08' } },
  { text: 'expenses last month', today: FRIDAY, expect: { kind: 'month', fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08' } },
  // turnover: last month across the year boundary, and the leap February
  { text: 'ค่าใช้จ่ายเดือนที่แล้ว', today: '2026-01-15', expect: { kind: 'month', fromDate: '2025-12-01', toDate: '2025-12-31', monthKey: '2025-12' } },
  { text: 'ค่าใช้จ่ายเดือนที่แล้ว', today: '2024-03-10', expect: { kind: 'month', fromDate: '2024-02-01', toDate: '2024-02-29', monthKey: '2024-02' } },
  { text: 'ยอดขายเมื่อวาน', today: '2024-03-01', expect: { kind: 'day', fromDate: '2024-02-29', toDate: '2024-02-29' } },
  { text: 'ยอดขายเมื่อวาน', today: '2026-01-01', expect: { kind: 'day', fromDate: '2025-12-31', toDate: '2025-12-31' } },
  { text: 'ยอดขาย 3 เดือนที่แล้ว', today: '2026-01-15', expect: { kind: 'month', fromDate: '2025-10-01', toDate: '2025-10-31', monthKey: '2025-10' } },
  { text: 'ยอดขาย 13 เดือนที่แล้ว', today: FRIDAY, expect: { kind: 'month', fromDate: '2025-08-01', toDate: '2025-08-31', monthKey: '2025-08' } },
  // past the N ceiling: recognised but not pinned down → no candidate, the tool uses its default
  { text: 'ยอดขาย 25 เดือนที่แล้ว', today: FRIDAY, expect: null },
  // month names ± year (พ.ศ. / ค.ศ. / two digits by the normalizer's existing era rules)
  { text: 'ยอดขาย ส.ค. 68', today: FRIDAY, expect: { kind: 'month', fromDate: '2025-08-01', toDate: '2025-08-31', monthKey: '2025-08', source: 'named_month', assumptions: ['two_digit_year_resolved_thai_month'] } },
  { text: 'ยอดขายสิงหาคม 2568', today: FRIDAY, expect: { kind: 'month', fromDate: '2025-08-01', toDate: '2025-08-31', monthKey: '2025-08', assumptions: ['era_read_be', 'year_read_be'] } },
  { text: 'sales in August 2025', today: FRIDAY, expect: { kind: 'month', fromDate: '2025-08-01', toDate: '2025-08-31', monthKey: '2025-08' } },
  { text: 'ยอดขาย ส.ค.', today: FRIDAY, expect: { kind: 'month', fromDate: '2026-08-01', toDate: '2026-08-31', monthKey: '2026-08', assumptions: ['year_assumed_latest_past'] } },
  { text: 'ยอดขาย ธ.ค.', today: FRIDAY, expect: { kind: 'month', fromDate: '2025-12-01', toDate: '2025-12-31', monthKey: '2025-12', assumptions: ['year_assumed_latest_past'] } },
  // quarters (calendar)
  { text: 'ไตรมาสนี้ขายได้เท่าไหร่', today: FRIDAY, expect: { kind: 'quarter', fromDate: '2026-07-01', toDate: FRIDAY } },
  { text: 'ไตรมาสที่แล้วขายได้เท่าไหร่', today: FRIDAY, expect: { kind: 'quarter', fromDate: '2026-04-01', toDate: '2026-06-30' } },
  { text: 'ยอดขาย Q2 2568', today: FRIDAY, expect: { kind: 'quarter', fromDate: '2025-04-01', toDate: '2025-06-30', source: 'explicit' } },
  { text: 'ยอดขายไตรมาส 1', today: FRIDAY, expect: { kind: 'quarter', fromDate: '2026-01-01', toDate: '2026-03-31' } },
  // years (calendar, never fiscal)
  { text: 'ยอดขายปีนี้', today: FRIDAY, expect: { kind: 'year', fromDate: '2026-01-01', toDate: FRIDAY, assumptions: ['period_clamped_to_today'] } },
  { text: 'ยอดขายปีที่แล้ว', today: FRIDAY, expect: { kind: 'year', fromDate: '2025-01-01', toDate: '2025-12-31', label: 'ปีที่แล้ว (1 ม.ค. – 31 ธ.ค. 2568)' } },
  { text: 'ยอดขายปีก่อน', today: FRIDAY, expect: { kind: 'year', fromDate: '2025-01-01', toDate: '2025-12-31' } },
  { text: 'sales last year', today: FRIDAY, expect: { kind: 'year', fromDate: '2025-01-01', toDate: '2025-12-31' } },
  { text: 'ยอดขายปี 2568', today: FRIDAY, expect: { kind: 'year', fromDate: '2025-01-01', toDate: '2025-12-31', source: 'explicit', assumptions: ['era_read_be', 'year_read_be'] } },
  { text: 'sales in year 2025', today: FRIDAY, expect: { kind: 'year', fromDate: '2025-01-01', toDate: '2025-12-31' } },
  // explicit ranges
  { text: 'ค่าใช้จ่าย 1-15 ก.ย.', today: FRIDAY, expect: { kind: 'range', fromDate: '2026-09-01', toDate: '2026-09-15', source: 'explicit', label: '1–15 ก.ย. 2569' } },
  { text: 'ตั้งแต่ 1 ถึง 15 กันยายน', today: FRIDAY, expect: { kind: 'range', fromDate: '2026-09-01', toDate: '2026-09-15' } },
  { text: 'from 1 to 15 Sep', today: FRIDAY, expect: { kind: 'range', fromDate: '2026-09-01', toDate: '2026-09-15' } },
  { text: 'ยอดขาย 1/9–15/9/68', today: FRIDAY, expect: { kind: 'range', fromDate: '2025-09-01', toDate: '2025-09-15' } },
  { text: 'ยอดขาย 2026-09-01 ถึง 2026-09-15', today: FRIDAY, expect: { kind: 'range', fromDate: '2026-09-01', toDate: '2026-09-15' } },
  // future periods carry no candidate: there is no data to read
  { text: 'ยอดขายพรุ่งนี้', today: FRIDAY, expect: null },
  { text: 'ยอดขายเดือนหน้า', today: FRIDAY, expect: null },
  { text: 'ยอดขายปีหน้า', today: FRIDAY, expect: null },
  { text: 'sales next week', today: FRIDAY, expect: null },
  // words nobody can pin down stay out (the tool then uses its default and the answer says so)
  { text: 'ต้นเดือนนี้ขายได้เท่าไหร่', today: FRIDAY, expect: null },
  { text: 'ปลายเดือนขายได้เท่าไหร่', today: FRIDAY, expect: null },
  { text: 'ช่วงนี้ขายได้เท่าไหร่', today: FRIDAY, expect: null },
  { text: 'เร็ว ๆ นี้ขายดีไหม', today: FRIDAY, expect: null },
  // a question that merely CONTAINS a month-abbreviation substring is not a month question:
  // `มีค` (มี.ค. without its dots) is inside the extremely common `มีค่าใช้จ่าย`
  { text: 'เดือนนี้มีค่าใช้จ่ายเท่าไหร่', today: FRIDAY, expect: { kind: 'month', fromDate: '2026-09-01', toDate: FRIDAY, monthKey: '2026-09' } },
];

describe('resolvePeriodCandidates (spec §3.1)', () => {
  for (const row of PERIOD_TABLE) {
    it(`${row.text} @ ${row.today} → ${row.expect ? `${row.expect.kind} ${row.expect.fromDate}..${row.expect.toDate}` : 'no period'}`, () => {
      const periods = extractValueCandidates(row.text, row.today).periods ?? [];
      if (!row.expect) {
        assert.deepEqual(periods, [], `expected no period for "${row.text}"`);
        return;
      }
      const hit = periods[0];
      assert.ok(hit, `expected a period candidate for "${row.text}"`);
      assert.equal(hit.kind, row.expect.kind);
      assert.equal(hit.fromDate, row.expect.fromDate);
      assert.equal(hit.toDate, row.expect.toDate);
      assert.equal(hit.monthKey, row.expect.monthKey);
      if (row.expect.source) assert.equal(hit.source, row.expect.source);
      if (row.expect.label) assert.equal(hit.label, row.expect.label);
      for (const assumption of row.expect.assumptions ?? []) {
        assert.ok(hit.assumptions.includes(assumption), `missing assumption ${assumption} on "${row.text}"`);
      }
      // ADR 0011: annotation only — the span must be a literal slice of what the user typed.
      assert.ok(row.text.includes(hit.span), `span "${hit.span}" is not a substring of the message`);
    });
  }

  it('resolves several periods in one message and keeps them in reading order', () => {
    const periods = extractValueCandidates('เมื่อวานกับเดือนที่แล้วต่างกันเท่าไหร่', FRIDAY).periods ?? [];
    assert.deepEqual(periods.map((p) => `${p.kind}:${p.fromDate}`), ['day:2026-09-17', 'month:2026-08-01']);
  });

  it('keeps both months from the Production wording, including the common July spelling', () => {
    const message = 'มั่งมี ช่วยสรุปค่าใช้จ่าย ของเดือนกรกฏาคม และ สิงหาคม ให้หน่อย';
    const periods = extractValueCandidates(message, '2026-09-25').periods ?? [];
    assert.deepEqual(periods.map((period) => [period.fromDate, period.toDate]), [
      ['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'],
    ]);
    assert.ok(periods.every((period) => message.includes(period.span)));
  });

  it('emits no periods at all without an injected today (the resolver never reads the clock)', () => {
    assert.equal(extractValueCandidates('ยอดขายเดือนที่แล้ว').periods, undefined);
    assert.equal(extractValueCandidates('สวัสดีค่ะ', FRIDAY).periods, undefined);
  });

  it('a two-digit year with no month name stays ambiguous and may not back an input', () => {
    const [hit] = extractValueCandidates('ยอดขายปี 68', FRIDAY).periods ?? [];
    assert.ok(hit);
    assert.ok(hit.assumptions.includes(VALUE_ASSUMPTIONS.ambiguousTwoDigitYear));
    assert.equal(isAmbiguousPeriodCandidate(hit), true);
    assert.equal(isAmbiguousPeriodCandidate({ assumptions: ['week_monday_sunday'] }), false);
  });

  it('formats Thai period ranges for a day, a month, a cross-month and a cross-year window', () => {
    assert.equal(formatThaiPeriodRange('2026-09-17', '2026-09-17'), '17 ก.ย. 2569');
    assert.equal(formatThaiPeriodRange('2026-08-01', '2026-08-31'), '1–31 ส.ค. 2569');
    assert.equal(formatThaiPeriodRange('2026-08-31', '2026-09-06'), '31 ส.ค. – 6 ก.ย. 2569');
    assert.equal(formatThaiPeriodRange('2025-01-01', '2026-12-31'), '1 ม.ค. 2568 – 31 ธ.ค. 2569');
  });

  it('leaves the amount and date candidates of an existing turn untouched', () => {
    const before = extractValueCandidates('จ่ายค่าวิน 60 บาท วันที่ 9/11/2537', TODAY);
    assert.equal(before.amounts.some((a) => a.value === '60'), true);
    assert.equal(before.dates.some((d) => d.isoDate === '1994-11-09'), true);
  });
});
