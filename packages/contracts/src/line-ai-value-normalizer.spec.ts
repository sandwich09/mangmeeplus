import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as normalizer from './line-ai-value-normalizer.js';
import {
  extractValueCandidates,
  formatDateClarifyQuestion,
  formatThaiDate,
  isAmbiguousDateCandidate,
  formatThaiPeriodRange,
  isAmbiguousPeriodCandidate,
  mapThaiDigits,
  parseLineAiValueCandidates,
  PERIOD_ASSUMPTIONS,
  toIsoDate,
  unresolvedMonthName,
  VALUE_ASSUMPTIONS,
} from './line-ai-value-normalizer.js';

const TODAY = '2026-07-07';

describe('bank-slip date headers (OCR-A benchmark)', () => {
  for (const [text, span, isoDate] of [
    ['16 ก.ย. 69 14:10 น.', '16 ก.ย. 69', '2026-09-16'],
    ['13 ต.ค. 69 - 18:45', '13 ต.ค. 69', '2026-10-13'],
    ['15 ส.ค. 69 - 17:59', '15 ส.ค. 69', '2026-08-15'],
    ['28 Sep 2026 19:26', '28 Sep 2026', '2026-09-28'],
    ['28 Sep 26 19:26', '28 Sep 26', '2026-09-28'],
    ['Total 60 Aug 23 26', 'Aug 23 26', '2026-08-23'],
  ]) {
    it(`preserves the printed date before the time: ${text}`, () => {
      const candidates = extractValueCandidates(text!, '2026-10-15', { documentContext: 'receipt' }).dates;
      assert.deepEqual([...new Set(candidates.map((candidate) => candidate.isoDate))], [isoDate]);
      assert.ok(candidates.every((candidate) => candidate.span.trim() === span));
      assert.ok(candidates.every((candidate) => !isAmbiguousDateCandidate(candidate)));
    });
  }
});

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

describe('R23 spoken Thai amounts', () => {
  for (const [text, value] of [
    ['พันแปด', '1800'], ['สองพันห้า', '2500'], ['หมื่นสอง', '12000'],
    ['แสนห้า', '150000'], ['พันสอง', '1200'], ['สามพันกว่า', '3000'],
    ['พันแปดร้อย', '1800'], ['สองพันห้าร้อย', '2500'], ['ร้อยห้า', '105'],
    ['ห้าร้อยหกสิบเอ็ด', '561'], ['one thousand five', '1005'],
  ]) {
    it(`R23.2 ${text} selects ${value} in legacy and exact candidates`, () => {
      assert.deepEqual(extractValueCandidates(text!, TODAY).amounts.map(item => item.value), [value]);
      assert.deepEqual(extractValueCandidates(text!, TODAY, { scan: { observe() {}, datePositions: new WeakMap() } }).amounts.map(item => item.value), [value]);
    });
  }
});

describe('extractValueCandidates – dates (golden set)', () => {
  it('grounds spoken months only between a day and year without duplicating full names (A1)', () => {
    for (const text of ['วันที่ 10 ตุลา 2569', '10 ตุลา 69', '10 ตุลาคม 2569', '10 ตุลาคม 69']) {
      const { dates, amounts } = extractValueCandidates(text, '2026-10-15');
      assert.deepEqual(dates.map(date => date.isoDate), ['2026-10-10'], text);
      assert.equal(isAmbiguousDateCandidate(dates[0]!), false, text);
      assert.deepEqual(amounts, [], 'date digits never become money');
    }
    for (const text of ['ให้มีนา 500 บาท', 'มีนา 2569', '10 มีนารัตน์ 2569', '10 ตุลาการ 2569', '10 ตุลา', '10 ตุลา 25690']) {
      assert.deepEqual(extractValueCandidates(text, '2026-10-15').dates, [], text);
    }
  });
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

  it('legacy dash dates still accept month/day order', () => {
    const { dates } = extractValueCandidates('3-25-2025', TODAY);
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

  it('reads bounded punctuation-free Thai month abbreviations without finding March inside มีค่าใช้จ่าย', () => {
    for (const message of ['สรุปค่าใช้จ่ายเดือน กค และ สค', 'สรุปค่าใช้จ่าย กค สค', 'ค่าใช้จ่ายเดือนกคและสค']) {
      assert.deepEqual(extractValueCandidates(message, '2026-09-25').periods?.map((period) => period.monthKey),
        ['2026-07', '2026-08']);
    }
    assert.deepEqual(extractValueCandidates('เดือนนี้มีค่าใช้จ่ายเท่าไหร่', '2026-09-25').periods?.map((period) => period.monthKey),
      ['2026-09']);
    assert.deepEqual(extractValueCandidates('ยอดค่าใช้จ่าย กค 2568', '2026-09-25').periods?.map((period) => period.monthKey),
      ['2025-07']);
  });

  it('corrects only a unique one-character full month typo and flags unclear month names', () => {
    const message = 'สรุปค่าใช้จ่ายเดือนกรกดาคม และ สิงหาคม';
    const periods = extractValueCandidates(message, '2026-09-25').periods ?? [];
    assert.deepEqual(periods.map((period) => period.monthKey), ['2026-07', '2026-08']);
    assert.ok(periods[0]?.assumptions.includes(PERIOD_ASSUMPTIONS.monthNameTypoCorrected));
    assert.match(periods[0]?.label ?? '', /ตีความ "กรกดาคม" เป็น/);
    assert.equal(unresolvedMonthName(message, periods), null);
    assert.deepEqual(extractValueCandidates('เดือนสิงหาคาม 2568', '2026-09-25').periods?.map((period) => period.monthKey), ['2025-08']);

    const unclear = 'สรุปค่าใช้จ่ายเดือนกรกดาคน และ สิงหาคม';
    assert.equal(unresolvedMonthName(unclear, extractValueCandidates(unclear, '2026-09-25').periods ?? []), 'กรกดาคน');
    const unclearSecond = 'สรุปค่าใช้จ่ายเดือนกรกฎาคม และ สิงหาตน';
    assert.equal(unresolvedMonthName(unclearSecond, extractValueCandidates(unclearSecond, '2026-09-25').periods ?? []), 'สิงหาตน');
    const unclearShort = 'สรุปค่าใช้จ่ายเดือนกคและสข';
    assert.equal(unresolvedMonthName(unclearShort, extractValueCandidates(unclearShort, '2026-09-25').periods ?? []), 'สข');
    const bareUnclear = 'สรุปค่าใช้จ่าย กรกดาคน และ สิงหาคม';
    assert.equal(unresolvedMonthName(bareUnclear, extractValueCandidates(bareUnclear, '2026-09-25').periods ?? []), 'กรกดาคน');
    assert.equal(unresolvedMonthName('ค่าใช้จ่ายเดือนกข', []), 'กข');
    const current = extractValueCandidates('เดือนนี้มีค่าใช้จ่ายเท่าไหร่', '2026-09-25').periods ?? [];
    assert.equal(unresolvedMonthName('เดือนนี้มีค่าใช้จ่ายเท่าไหร่', current), null);
    assert.equal(unresolvedMonthName('ปลายเดือนขายได้เท่าไหร่', []), null);
    assert.equal(unresolvedMonthName('ค่าใช้จ่ายเดือนละ 500 บาท', []), null);
  });

  // NAT-09 (regression slice 2026-09-30): "ช่วยสรุปรายจ่ายสิงหาให้หน่อย" named August with neither เดือน nor a
  // spaced boundary, so the router's correct dates were refused as ungrounded.
  it('reads a spoken month right after a money noun, and still never a name or a longer word', () => {
    const key = (text: string) => extractValueCandidates(text, '2026-09-30').periods?.map((period) => period.monthKey) ?? [];
    assert.deepEqual(key('ช่วยสรุปรายจ่ายสิงหาให้หน่อย'), ['2026-08']);
    assert.deepEqual(key('ยอดขายตุลาหน่อย'), ['2025-10']);
    for (const text of ['รายจ่ายตุลาการเท่าไหร่', 'ค่าจ้างคุณกันยาให้หน่อย', 'ส่งให้กันยาหน่อย']) assert.deepEqual(key(text), [], text);
  });

  // UAT 2026-09-29: "ของเดือนสิงหาละ" read no period, so the follow-up's August filter could not be grounded and
  // the customer got "ยังดึงข้อมูลไม่ได้". Every way people type a month must resolve through this one resolver.
  it('reads every spoken, dotted and full Thai month form a customer types, and nothing else', () => {
    const today = '2026-09-29';
    const key = (text: string) => extractValueCandidates(text, today).periods?.map((period) => period.monthKey);
    const spoken = ['มกรา', 'กุมภา', 'มีนา', 'เมษา', 'พฤษภา', 'มิถุนา', 'กรกฎา', 'สิงหา', 'กันยา', 'ตุลา', 'พฤศจิกา', 'ธันวา'];
    spoken.forEach((name, index) => {
      const month = String(index + 1).padStart(2, '0');
      const latest = `${index + 1 <= 9 ? '2026' : '2025'}-${month}`;
      assert.deepEqual(key(`ของเดือน${name}ละ`), [latest], `เดือน${name}ละ`);
      assert.deepEqual(key(`เดือน${name}จ่ายไปเท่าไหร่`), [latest], `เดือน${name}…`);
      assert.deepEqual(key(`แล้ว${name}ล่ะ`), [latest], `แล้ว${name}ล่ะ`);
      assert.deepEqual(key(`${name} 68`), [`2025-${month}`], `${name} 68`);
      assert.deepEqual(key(`เดือน${name}ปี 2568`), [`2025-${month}`], `เดือน${name}ปี 2568`);
    });
    assert.deepEqual(key('เดือนกรกฏาค่ะ'), ['2026-07']);
    for (const text of ['ส.ค.', 'ส.ค', 'ส. ค.', 'เดือน ส.ค 69', 'ยอด ส. ค. 2569', 'เดือนสค', 'เดือนสิงหาคม', 'สิงหาคม 2569', 'เดือน 8']) {
      assert.deepEqual(key(text), ['2026-08'], text);
    }
    assert.deepEqual(key('เดือนสิงหาคม 2568'), ['2025-08']);
    assert.deepEqual(key('เดือนสิงหาคาม 2568'), ['2025-08'], 'a typo of the full name keeps its written year');
    for (const text of ['น้องกันยาส่งบิลมาแล้ว', 'ตุลาการสั่งให้จ่าย', 'มีนายสมชายมาเบิก', 'เดือนนี้มีค่าใช้จ่ายเท่าไหร่']) {
      assert.ok(!(key(text) ?? []).some((monthKey) => monthKey !== '2026-09'), `no stray month in "${text}"`);
    }
    const followUp = 'ของเดือนสิงหาละ';
    assert.equal(unresolvedMonthName(followUp, extractValueCandidates(followUp, today).periods ?? []), null);
    for (const period of extractValueCandidates('แล้วสิงหาล่ะ ส.ค 69', today).periods ?? []) assert.ok('แล้วสิงหาล่ะ ส.ค 69'.includes(period.span));
  });

  it('resolves all twelve numbered months and English abbreviations without a current-month fallback', () => {
    const english = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    for (let month = 1; month <= 12; month += 1) {
      const key = `2025-${String(month).padStart(2, '0')}`;
      const latest = `${month <= 9 ? '2026' : '2025'}-${String(month).padStart(2, '0')}`;
      for (const message of [
        `ค่าใช้จ่ายเดือน ${month} ปี 2568`,
        `expenses month ${month} year 2025`,
        `expenses ${english[month - 1]} 2025`,
        `ค่าใช้จ่ายเดือน ${english[month - 1]} ปี 2568`,
      ]) {
        assert.deepEqual(extractValueCandidates(message, '2026-09-25').periods?.map((period) => period.monthKey), [key], message);
      }
      for (const message of [`ค่าใช้จ่ายเดือน ${month}`, `ค่าใช้จ่ายเดือน ${english[month - 1]}`,
        ...(month === 5 ? [] : [`expenses ${english[month - 1]}`])]) {
        assert.deepEqual(extractValueCandidates(message, '2026-09-25').periods?.map((period) => period.monthKey), [latest], message);
      }
    }
    assert.deepEqual(extractValueCandidates('ค่าใช้จ่ายเดือน 1 2 3', '2026-09-25').periods?.map((period) => period.monthKey),
      ['2026-01', '2026-02', '2026-03']);
    assert.deepEqual(extractValueCandidates('ค่าใช้จ่ายเดือน 1, 2 และ 3 ปี 2569', '2026-09-25').periods?.map((period) => period.monthKey),
      ['2026-01', '2026-02', '2026-03']);
    assert.deepEqual(extractValueCandidates('expenses month 1, 2, 3 2025', '2026-09-25').periods?.map((period) => period.monthKey),
      ['2025-01', '2025-02', '2025-03']);
    assert.deepEqual(extractValueCandidates(`ค่าใช้จ่ายเดือน ${Array.from({ length: 12 }, (_, index) => index + 1).join(' ')} ปี 2568`, '2026-09-25')
      .periods?.map((period) => period.monthKey),
      Array.from({ length: 12 }, (_, index) => `2025-${String(index + 1).padStart(2, '0')}`));
    assert.deepEqual(extractValueCandidates('ค่าใช้จ่ายเดือน 12', '2026-09-25').periods?.map((period) => period.monthKey), ['2025-12']);
    assert.deepEqual(extractValueCandidates('ค่าใช้จ่ายเดือน ๑๒', '2026-09-25').periods?.map((period) => period.monthKey), ['2025-12']);
    assert.deepEqual(extractValueCandidates('ค่าใช้จ่ายเดือน 1 ปี 69', '2026-09-25').periods?.map((period) => period.monthKey), ['2026-01']);
    assert.deepEqual(extractValueCandidates('expenses month 1 year 26', '2026-09-25').periods?.map((period) => period.monthKey), ['2026-01']);
    assert.deepEqual(extractValueCandidates('expenses jan jun jul', '2026-09-25').periods?.map((period) => period.monthKey),
      ['2026-01', '2026-06', '2026-07']);
    const invalid = 'ค่าใช้จ่ายเดือน 13';
    assert.equal(unresolvedMonthName(invalid, extractValueCandidates(invalid, '2026-09-25').periods ?? []), '13');
    assert.equal(unresolvedMonthName('ค่าใช้จ่ายเดือน 0', []), '0');
    assert.equal(unresolvedMonthName('expenses month 13', []), '13');
  });

  it('emits no periods at all without an injected today (the resolver never reads the clock)', () => {
    assert.equal(extractValueCandidates('ยอดขายเดือนที่แล้ว').periods, undefined);
    assert.equal(extractValueCandidates('สวัสดีค่ะ', FRIDAY).periods, undefined);
  });

  it('a two-digit period year resolves by plausibility and may back a read input', () => {
    const [hit] = extractValueCandidates('ยอดขายปี 68', FRIDAY).periods ?? [];
    assert.ok(hit);
    assert.ok(hit.assumptions.includes(VALUE_ASSUMPTIONS.twoDigitYearResolvedPlausibleEra));
    assert.equal(isAmbiguousPeriodCandidate(hit), false);
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


// Owner 2026-10-05, P1: table expectations exercise the public extractor and its wire contract.
const P1_TODAY = '2026-10-05';
const COMPLETE_UNITS = 'complete_units_exclude_current';
function checkPeriodRows(rows: PeriodRow[]): void {
  for (const { text, today, expect } of rows) {
    const values = extractValueCandidates(text, today);
    assert.deepEqual(parseLineAiValueCandidates(values, text), values, `wire: ${text}`);
    const periods = values.periods ?? [];
    assert.equal(periods.length, expect ? 1 : 0, `${text} @ ${today}: ${JSON.stringify(periods)}`);
    if (!expect) continue;
    const hit = periods[0]!;
    for (const [key, value] of Object.entries(expect)) {
      assert.deepEqual(hit[key as keyof typeof hit], value, `${text} @ ${today}: ${key}`);
    }
    assert.ok(text.includes(hit.span), text);
    assert.ok(hit.fromDate <= today, text);
    assert.ok(hit.label.includes(formatThaiPeriodRange(hit.fromDate, hit.toDate)), text);
    assert.doesNotMatch(hit.label, /[a-z_]/i, `Thai label: ${text}`);
  }
}
const p1Row = (text: string, fromDate: string, toDate: string, kind = 'range', assumptions?: string[], label?: string): PeriodRow => ({
  text, today: P1_TODAY, expect: { kind, fromDate, toDate, ...(assumptions ? { assumptions } : {}), ...(label ? { label } : {}) },
});
const p1None = (text: string): PeriodRow => ({ text, today: P1_TODAY, expect: null });

describe('everyday period language (owner 2026-10-05)', () => {
  it('R1: recent windows contain complete calendar units, except days which include today', () => {
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const rows: PeriodRow[] = [];
    const monthForms = ['N เดือนย้อนหลัง', 'N เดือนที่ผ่านมา', 'N เดือนล่าสุด', 'N เดือนหลัง', 'N เดือนหลังสุด',
      'N เดือนก่อนหน้า', 'N เดือนก่อนหน้านี้', 'ย้อนหลัง N เดือน', 'last N months', 'past N months', 'previous N months'];
    const units = [
      { kind: 'month', forms: monthForms, months: 1 },
      { kind: 'week', forms: ['สัปดาห์', 'อาทิตย์', 'วีค'].flatMap(unit => ['ที่ผ่านมา', 'ล่าสุด', 'ย้อนหลัง'].map(word => `N ${unit}${word}`)), months: 0 },
      { kind: 'quarter', forms: ['N ไตรมาสล่าสุด', 'N ไตรมาสที่ผ่านมา', 'N ไตรมาสย้อนหลัง'], months: 3 },
      { kind: 'year', forms: ['N ปีที่ผ่านมา', 'N ปีย้อนหลัง', 'N ปีล่าสุด'], months: 12 },
    ];
    for (const today of ['2026-10-05', '2026-10-01', '2026-10-31', '2026-01-01', '2024-02-29']) {
      const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)) - 1;
      for (const { kind, forms, months } of units) for (const n of [1, 3, 6, 12, 24, 25]) {
        const end = new Date(`${today}T00:00:00Z`);
        let start: Date;
        if (months) {
          const currentStart = kind === 'year' ? 0 : kind === 'quarter' ? Math.floor(month / 3) * 3 : month;
          start = new Date(Date.UTC(year, currentStart - months * n, 1));
          end.setTime(Date.UTC(year, currentStart, 0));
        } else {
          end.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7 - 1);
          start = new Date(end); start.setUTCDate(start.getUTCDate() - n * 7 + 1);
        }
        for (const form of forms) rows.push({ text: form.replace('N', String(n)), today, expect: n > 24 ? null : {
          kind: n === 1 ? kind : 'range', fromDate: iso(start), toDate: iso(end),
          assumptions: [...(kind === 'week' ? ['week_monday_sunday'] : []), COMPLETE_UNITS],
        } });
      }
    }
    rows.push(...['ครึ่งปีที่ผ่านมา', 'ครึ่งปีย้อนหลัง', 'ครึ่งปีล่าสุด'].map(text => p1Row(text, '2026-04-01', '2026-09-30', 'range', [COMPLETE_UNITS])));
    rows.push(...[
      ['เดือนที่ผ่านมา', '2026-09-01', '2026-09-30', 'month'],
      ['สัปดาห์ที่ผ่านมา', '2026-09-28', '2026-10-04', 'week'],
      ['ปีที่ผ่านมา', '2025-01-01', '2025-12-31', 'year'],
      ['ไตรมาสที่ผ่านมา', '2026-07-01', '2026-09-30', 'quarter'],
      ['ไตรมาสล่าสุด', '2026-07-01', '2026-09-30', 'quarter'],
      ['วีคนี้', '2026-10-05', '2026-10-05', 'week'], ['วีคที่แล้ว', '2026-09-28', '2026-10-04', 'week'],
      ['2 เดือนก่อน', '2026-08-01', '2026-08-31', 'month'],
    ].map(([text, from, to, kind]) => p1Row(text!, from!, to!, kind!)));
    rows.push(p1Row('3 เดือนล่าสุด', '2026-07-01', '2026-09-30', 'range', [COMPLETE_UNITS], '3 เดือนล่าสุด (1 ก.ค. – 30 ก.ย. 2569)'));
    for (const word of ['ล่าสุด', 'ที่ผ่านมา', 'ย้อนหลัง']) rows.push(p1Row(`7 วัน${word}`, '2026-09-29', P1_TODAY, 'last_n_days', ['last_n_days_include_today']));
    checkPeriodRows(rows);
  });

  it('R2: clean Thai number words are counts; compound estimates never become shorter periods', () => {
    checkPeriodRows([p1Row('สองเดือนที่แล้ว', '2026-08-01', '2026-08-31', 'month')]);
    const words = ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ', 'สิบเอ็ด', 'สิบสอง'];
    const rows: PeriodRow[] = [];
    for (const [index, word] of words.entries()) {
      for (const form of ['Nเดือนที่แล้ว', 'Nเดือนก่อน', 'Nเดือนที่ผ่านมา', 'Nเดือนล่าสุด', 'ย้อนหลังNเดือน', 'Nอาทิตย์ก่อน', 'Nวันที่ผ่านมา', 'Nวันก่อน', 'Nไตรมาสล่าสุด', 'Nปีที่ผ่านมา']) {
        const digits = extractValueCandidates(form.replace('N', String(index + 1)), P1_TODAY).periods?.[0];
        assert.ok(digits, form);
        rows.push(p1Row(form.replace('N', word), digits.fromDate, digits.toDate, digits.kind, digits.assumptions, digits.label));
      }
    }
    rows.push(...['สองสามเดือน', 'สองสามเดือนนี้', 'สองสามเดือนล่าสุด', 'ย้อนหลังสองสามเดือน', 'สิบสองสามเดือนที่ผ่านมา', '125 เดือนที่ผ่านมา', '-3 เดือนล่าสุด', '1.5 เดือนล่าสุด', 'สองสามเดือนที่แล้ว', 'สองสามอาทิตย์ก่อน'].map(p1None));
    checkPeriodRows(rows);
  });

  it('R3: a month range owns both endpoints, every intervening month, and the stated years', () => {
    const rows: PeriodRow[] = [];
    for (const connector of ['ถึง', 'จนถึง', 'ยัน', '-', '–', '—', '~', 'to', 'until', 'through']) {
      for (const [from, to] of [['สิงหาคม', 'ตุลาคม'], ['ส.ค.', 'ต.ค.'], ['สค', 'ตค'], ['สิงหา', 'ตุลา'], ['August', 'October'], ['เดือน 8', '10'], ['เดือน 8', 'เดือน 10']]) {
        rows.push(p1Row(`${from} ${connector} ${to}`, '2026-08-01', P1_TODAY, 'range', ['year_assumed_latest_past', 'period_clamped_to_today']));
      }
    }
    rows.push(...['สิงหา ถึง ตค', 'สรุปค่าใช้จ่าย ตั้งแต่เดือนสิงหาคม ถึง เดือนตุลาคม', 'ส.ค.-ต.ค. 69', 'สิงหาคมถึงตุลาคม', 'สิงหาคม ถึง ตุลาคม 2569',
      'ตั้งแต่สิงหาถึงตุลา', 'ค่าใช้จ่ายสิงหาคมถึงตุลาคม', 'ค่าใช้จ่ายสิงหาถึงตุลา', 'ของเดือนสิงหาถึงตุลา', 'เดือน 8-10', 'จากสิงหาถึงตุลา', 'ช่วงสิงหาถึงตุลา', 'ระหว่างสิงหากับตุลา', 'ระหว่าง ส.ค. และ ต.ค.', 'ระหว่าง ส.ค. ถึง ต.ค.',
      'from August to October 2026', 'ส.ค. 2569 ถึง ต.ค. 2569'].map(text => p1Row(text, '2026-08-01', P1_TODAY)));
    rows.push(...['พ.ย. ถึง ก.พ.', 'พ.ย. ถึง ก.พ. 2569', 'พ.ย. 2568 ถึง ก.พ.', 'พ.ย. 2568 ถึง ก.พ. 2569'].map(text => p1Row(text, '2025-11-01', '2026-02-28')));
    rows.push(p1Row('ธันวา ถึง กุมภา', '2025-12-01', '2026-02-28'), p1Row('ม.ค. ถึง มี.ค.', '2026-01-01', '2026-03-31'),
      p1Row('จากเดือนกรกฎาคมถึงกันยายน', '2026-07-01', '2026-09-30'), p1Row('ก.ค.–ก.ย. 2569', '2026-07-01', '2026-09-30'),
      p1Row('ม.ค. 2567 ถึง ธ.ค. 2568', '2024-01-01', '2025-12-31'), p1None('พ.ย. 2569 ถึง ก.พ. 2570'));
    const monthAliases = [
      ['มกราคม', 'ม.ค.', 'มค', 'มกรา', 'January', 'Jan'], ['กุมภาพันธ์', 'ก.พ.', 'กพ', 'กุมภา', 'February', 'Feb'],
      ['มีนาคม', 'มี.ค.', 'มีค', 'มีนา', 'March', 'Mar'], ['เมษายน', 'เม.ย.', 'เมย', 'เมษา', 'April', 'Apr'],
      ['พฤษภาคม', 'พ.ค.', 'พค', 'พฤษภา', 'May'], ['มิถุนายน', 'มิ.ย.', 'มิย', 'มิถุนา', 'June', 'Jun'],
      ['กรกฎาคม', 'กรกฏาคม', 'ก.ค.', 'กค', 'กรกฎา', 'กรกฏา', 'July', 'Jul'], ['สิงหาคม', 'ส.ค.', 'สค', 'สิงหา', 'August', 'Aug'],
      ['กันยายน', 'ก.ย.', 'กย', 'กันยา', 'September', 'Sep'], ['ตุลาคม', 'ต.ค.', 'ตค', 'ตุลา', 'October', 'Oct'],
      ['พฤศจิกายน', 'พ.ย.', 'พย', 'พฤศจิกา', 'November', 'Nov'], ['ธันวาคม', 'ธ.ค.', 'ธค', 'ธันวา', 'December', 'Dec'],
    ];
    for (const [index, aliases] of monthAliases.entries()) for (const alias of aliases) {
      const month = String(index + 1).padStart(2, '0');
      const last = new Date(Date.UTC(2025, index + 1, 0)).toISOString().slice(0, 10);
      rows.push(p1Row(`${alias} 2567 ถึง ${alias} 2568`, `2024-${month}-01`, last));
    }
    rows.push({ text: 'ม.ค. ถึง ก.พ. 2567', today: '2024-03-01', expect: { kind: 'range', fromDate: '2024-01-01', toDate: '2024-02-29' } });
    checkPeriodRows(rows);
    for (const [text, keys] of [
      ['ต.ค. 2568 ถึง ส.ค. 2568', ['2025-10', '2025-08']],
      ['ม.ค. 2566 ถึง ธ.ค. 2568', ['2023-01', '2025-12']],
      ['ส.ค. ก.ย. ต.ค.', ['2026-08', '2026-09', '2026-10']],
      ['ก.ค. ส.ค. และ ก.ย.', ['2026-07', '2026-08', '2026-09']],
      ['เทียบ ส.ค. กับ ก.ย.', ['2026-08', '2026-09']], ['เดือน 7 8 9', ['2026-07', '2026-08', '2026-09']],
    ] as const) assert.deepEqual(extractValueCandidates(text, P1_TODAY).periods?.map(p => p.monthKey), keys, text);
  });

  it('R4: period years resolve the single plausible era while record DATE ambiguity is unchanged', () => {
    checkPeriodRows([
      p1Row('ปี 69', '2026-01-01', P1_TODAY, 'year', ['two_digit_year_resolved_plausible_era', 'period_clamped_to_today']),
      p1Row('รายจ่ายปี 68', '2025-01-01', '2025-12-31', 'year', ['two_digit_year_resolved_plausible_era']),
      p1Row('ปี 25', '2025-01-01', '2025-12-31', 'year', ['two_digit_year_resolved_plausible_era']),
      p1Row('ปี 12', '2012-01-01', '2012-12-31', 'year', ['two_digit_year_resolved_plausible_era']), p1None('ปี 99'),
      p1Row('ส.ค. 25', '2025-08-01', '2025-08-31', 'month', ['two_digit_year_resolved_plausible_era']),
      p1Row('Aug 69', '2026-08-01', '2026-08-31', 'month', ['two_digit_year_resolved_plausible_era']),
      p1None('ส.ค. 99'), p1None('ไตรมาส 3/99'),
      p1Row('ไตรมาส 3/69', '2026-07-01', '2026-09-30', 'quarter', ['two_digit_year_resolved_plausible_era']),
      p1Row('ปี 2569', '2026-01-01', P1_TODAY, 'year', ['era_read_be', 'year_read_be', 'period_clamped_to_today']),
    ]);
    const dates = extractValueCandidates('1/9/69', P1_TODAY).dates;
    assert.equal(dates.length, 2);
    assert.ok(dates.every(isAmbiguousDateCandidate));
  });

  it('R5: ordinary Thai after เดือน never asks for a month; month-like typos and invalid numbers still do', () => {
    const rows: Array<[string, string | null]> = [
      ...['3 เดือนย้อนหลัง', '3 เดือนล่าสุด', 'เดือนที่ผ่านมา', 'ช่วง 6 เดือนหลัง', 'ครึ่งเดือนแรก', 'ค่าใช้จ่ายเดือนไหนมากสุด',
        'เดือนไหนจ่ายเยอะสุด', 'ทุกเดือนจ่ายค่าเช่าเท่าไหร่', 'เฉลี่ยต่อเดือนเท่าไหร่', 'เดือนหนึ่งจ่ายประมาณเท่าไหร่',
        'เดือนเดียวกันปีที่แล้ว', 'แต่ละเดือน', 'รายเดือน', 'เดือนละเท่าไหร่', 'เดือนกรกดาคม และ สิงหาคม', 'เดือนนี้มีค่าใช้จ่าย',
        'เดือน 8-10'].map(text => [text, null] as [string, null]),
      // Spec §4.3: a month number that has not come yet is named back, never read as the current month.
      ['เดือน 8 ปี 2570', '8'],
      ['เดือนกรกดาคน และ สิงหาคม', 'กรกดาคน'], ['เดือน 13', '13'], ['เดือน ๐', '๐'], ['month 13', '13'],
      ['เดือนกคและสข', 'สข'], ['เดือนกข', 'กข'], ['กรกดาคน และ สิงหาคม', 'กรกดาคน'],
    ];
    for (const [text, expected] of rows) assert.equal(unresolvedMonthName(text, extractValueCandidates(text, P1_TODAY).periods ?? []), expected, text);
  });

  it('R6: longer everyday phrases never degrade into an unrelated shorter period', () => {
    checkPeriodRows([
      p1Row('ขอดูยอดแยกเดือน 3 เดือนล่าสุด', '2026-07-01', '2026-09-30'),
      p1Row('วันที่ 1 ถึง 15 เดือนที่แล้ว', '2026-09-01', '2026-09-15'),
      p1Row('วันที่ 1 ถึง 15 เดือนที่แล้ว จ่ายไปเท่าไหร่', '2026-09-01', '2026-09-15'),
      ...['วันที่ 1 ถึง 15 เดือนที่ผ่านมา', 'วันที่ 1 ถึง 15 เดือนล่าสุด'].map(text => p1Row(text, '2026-09-01', '2026-09-15')),
      ...['วันที่ 1-5 เดือนนี้', 'วันที่ 1-5', 'วันที่ 1 ถึง 5'].map(text => p1Row(text, '2026-10-01', P1_TODAY)),
      ...['ตุลาปีที่แล้ว', 'เดือนตุลาปีที่แล้ว'].map(text => p1Row(text, '2025-10-01', '2025-10-31', 'month')),
      p1Row('ส.ค. ปีก่อน', '2025-08-01', '2025-08-31', 'month'),
      ...['กันยายนปีนี้', 'กันยาปีนี้', 'กันยาที่ผ่านมา'].map(text => p1Row(text, '2026-09-01', '2026-09-30', 'month')),
      p1None('พฤศจิกาปีนี้'),
      ...['ตั้งแต่ต้นเดือน', 'ต้นเดือนนี้ถึงวันนี้', 'ตั้งแต่ต้นเดือนถึงตอนนี้'].map(text => p1Row(text, '2026-10-01', P1_TODAY, 'month', ['period_clamped_to_today'], 'เดือนนี้ (1–5 ต.ค. 2569)')),
      ...['ตั้งแต่ต้นปี', 'ต้นปีถึงปัจจุบัน', 'ตั้งแต่ต้นปีถึงตอนนี้', 'year to date', 'ytd'].map(text => p1Row(text, '2026-01-01', P1_TODAY, 'year', ['period_clamped_to_today'], 'ปีนี้ (1 ม.ค. – 5 ต.ค. 2569)')),
      ...['ต้นเดือน', 'ปลายเดือนที่แล้ว', 'ตั้งแต่ต้นเดือนที่แล้ว', 'ตั้งแต่ต้นปีที่แล้ว', 'น้องกันยา', 'ตุลาการ', 'may', 'มีค่าใช้จ่าย'].map(p1None),
    ]);
  });

  it('calendarMonthsForPeriod returns every whole calendar month in order, and only a marked current partial month', () => {
    const helper = normalizer.calendarMonthsForPeriod;
    assert.equal(typeof helper, 'function');
    assert.deepEqual(helper({ fromDate: '2025-12-01', toDate: '2026-02-28', assumptions: [] }, P1_TODAY), [
      { monthKey: '2025-12', fromDate: '2025-12-01', toDate: '2025-12-31', label: '1–31 ธ.ค. 2568' },
      { monthKey: '2026-01', fromDate: '2026-01-01', toDate: '2026-01-31', label: '1–31 ม.ค. 2569' },
      { monthKey: '2026-02', fromDate: '2026-02-01', toDate: '2026-02-28', label: '1–28 ก.พ. 2569' },
    ]);
    assert.deepEqual(helper({ fromDate: '2026-09-01', toDate: P1_TODAY, assumptions: ['period_clamped_to_today'] }, P1_TODAY), [
      { monthKey: '2026-09', fromDate: '2026-09-01', toDate: '2026-09-30', label: '1–30 ก.ย. 2569' },
      { monthKey: '2026-10', fromDate: '2026-10-01', toDate: P1_TODAY, label: '1–5 ต.ค. 2569' },
    ]);
    assert.deepEqual(helper({ fromDate: '2024-02-01', toDate: '2024-02-29', assumptions: [] }, P1_TODAY), [
      { monthKey: '2024-02', fromDate: '2024-02-01', toDate: '2024-02-29', label: '1–29 ก.พ. 2567' },
    ]);
    for (const [fromDate, toDate, assumptions] of [
      ['2026-09-02', '2026-09-30', []], ['2026-09-01', '2026-09-15', []], ['2026-09-01', P1_TODAY, []],
      ['2026-09-01', '2026-10-04', ['period_clamped_to_today']], ['2026-10-01', '2026-09-30', []],
      ['2026-02-01', '2026-02-29', []], ['bad', '2026-09-30', []],
    ] as const) assert.equal(helper({ fromDate, toDate, assumptions: [...assumptions] }, P1_TODAY), null);
  });
});

// All 186 source rows from the controller's matrix.out and matrix2.out, retained in-repo for CI.
const EVERYDAY_PERIOD_MATRIX = [
  "สรุปค่าใช้จ่าย 3 เดือนย้อนหลัง",
  "สิงหา ถึง ตค",
  "สรุปค่าใช้จ่าย ตั้งแต่เดือนสิงหาคม ถึง เดือนตุลาคม",
  "ปี 2569",
  "ค่าใช้จ่าย 3 เดือนล่าสุด",
  "ค่าใช้จ่าย 3 เดือนที่ผ่านมา",
  "ย้อนหลัง 3 เดือน",
  "ย้อนหลังสามเดือน",
  "สามเดือนที่ผ่านมา",
  "ช่วง 6 เดือนหลัง",
  "หกเดือนล่าสุด",
  "ครึ่งปีที่ผ่านมา",
  "2 เดือนก่อน",
  "สองเดือนที่แล้ว",
  "เดือนที่ผ่านมา",
  "เดือนก่อนหน้า",
  "เดือนก่อนหน้านี้",
  "เมื่อเดือนก่อน",
  "last 3 months",
  "past 6 months",
  "ส.ค. - ต.ค.",
  "ส.ค.-ต.ค. 69",
  "สิงหาคมถึงตุลาคม",
  "สิงหาคม ถึง ตุลาคม 2569",
  "ตั้งแต่สิงหาถึงตุลา",
  "สค ถึง ตค",
  "เดือน 8 ถึง 10",
  "เดือน 8-10",
  "เดือน 8 ถึงเดือน 10",
  "ม.ค. ถึง มี.ค.",
  "พ.ย. ถึง ก.พ.",
  "ธันวา ถึง กุมภา",
  "จากเดือนกรกฎาคมถึงกันยายน",
  "ก.ค.–ก.ย. 2569",
  "Aug to Oct",
  "from August to October 2026",
  "ปีนี้",
  "ทั้งปีนี้",
  "ตั้งแต่ต้นปี",
  "ตั้งแต่ต้นปีถึงตอนนี้",
  "ต้นปีถึงปัจจุบัน",
  "ปี 69",
  "ปี 2568",
  "ปีที่แล้ว",
  "ปีก่อน",
  "ปีที่ผ่านมา",
  "ครึ่งปีแรก",
  "ครึ่งปีหลัง",
  "ครึ่งปีแรก 2569",
  "year to date",
  "ytd",
  "ไตรมาส 3",
  "ไตรมาสที่ 3 ปี 2569",
  "Q3",
  "ไตรมาสนี้",
  "ไตรมาสที่แล้ว",
  "ไตรมาสก่อน",
  "2 ไตรมาสล่าสุด",
  "ไตรมาสล่าสุด",
  "สัปดาห์นี้",
  "อาทิตย์ที่แล้ว",
  "2 สัปดาห์ที่ผ่านมา",
  "สองอาทิตย์ล่าสุด",
  "7 วันล่าสุด",
  "30 วันที่ผ่านมา",
  "เจ็ดวันที่ผ่านมา",
  "เมื่อวาน",
  "วันนี้",
  "เมื่อวานซืน",
  "สัปดาห์ที่ผ่านมา",
  "อาทิตย์ก่อน",
  "ต้นเดือน",
  "ปลายเดือนที่แล้ว",
  "สิ้นเดือนกันยา",
  "ครึ่งเดือนแรก",
  "ต้นเดือนนี้ถึงวันนี้",
  "ตั้งแต่ต้นเดือน",
  "เดือนนี้",
  "เดือนที่แล้ว",
  "เดือนก่อน",
  "เดือนสิงหา",
  "สิงหา",
  "ส.ค.",
  "สค",
  "สิงหาคม",
  "สิงหาคม 69",
  "ส.ค. 2569",
  "เดือน 8",
  "เดือน 8 ปี 69",
  "ของเดือนกันยา",
  "กันยาที่ผ่านมา",
  "ตุลา",
  "เดือนตุลาปีที่แล้ว",
  "พฤศจิกา",
  "ธันวา",
  "ธ.ค.",
  "ม.ค.",
  "มกรา 69",
  "1-15 ก.ย.",
  "1 ถึง 15 กันยายน",
  "1/9 - 15/9",
  "1/9/69 ถึง 30/9/69",
  "ตั้งแต่วันที่ 1 ส.ค. ถึง 31 ต.ค.",
  "1 ส.ค. ถึง 31 ต.ค. 2569",
  "วันที่ 1 สิงหา ถึง วันที่ 5 ตุลา",
  "ตั้งแต่ 15 ก.ย. ถึงวันนี้",
  "15 ก.ย. ถึงปัจจุบัน",
  "วันที่ 3",
  "วันที่ 3 ต.ค.",
  "3 ต.ค. 69",
  "เทียบเดือนนี้กับเดือนที่แล้ว",
  "เทียบ ส.ค. กับ ก.ย.",
  "เดือนนี้เทียบกับปีที่แล้ว",
  "เทียบกับช่วงเดียวกันของปีก่อน",
  "เดือนเดียวกันปีที่แล้ว",
  "ค่าใช้จ่ายเดือนไหนมากสุด",
  "เดือนไหนจ่ายเยอะสุด",
  "ค่าใช้จ่ายแต่ละเดือน",
  "สรุปรายเดือน",
  "ค่าใช้จ่ายรายเดือนปีนี้",
  "ทุกเดือนจ่ายค่าเช่าเท่าไหร่",
  "เฉลี่ยต่อเดือนเท่าไหร่",
  "เดือนละเท่าไหร่",
  "ค่าใช้จ่ายแยกตามเดือน",
  "ขอดูยอดแยกเดือน 3 เดือนล่าสุด",
  "เดือนหนึ่งจ่ายประมาณเท่าไหร่",
  "สองสามเดือนนี้",
  "ช่วงนี้",
  "ระยะหลัง",
  "พักนี้จ่ายอะไรไปบ้าง",
  "ล่าสุดจ่ายอะไรไป",
  "รายการล่าสุด",
  "ที่ผ่านมาจ่ายไปเท่าไหร่",
  "ทั้งหมด",
  "ตั้งแต่เปิดร้าน",
  "ทุกรายการ",
  "เดือนนี้กับเดือนที่แล้วต่างกันเท่าไหร่",
  "เดือนนี้เพิ่มขึ้นจากเดือนก่อนกี่เปอร์เซ็นต์",
  "ส.ค. ก.ย. ต.ค.",
  "ก.ค. ส.ค. และ ก.ย.",
  "เทียบ 3 เดือนล่าสุด",
  "เดือน 7 8 9",
  "ไตรมาส 3 เทียบไตรมาส 2",
  "วันนี้จ่ายอะไรไปบ้าง",
  "เมื่อวานจ่ายเท่าไหร่",
  "อาทิตย์นี้",
  "วีคนี้",
  "วีคที่แล้ว",
  "สัปดาห์ก่อนหน้า",
  "ต้นเดือนที่แล้ว",
  "สิ้นเดือนนี้",
  "ปลายปี",
  "ปีหน้า",
  "เดือนหน้า",
  "พรุ่งนี้",
  "ของเดือน ก.ย",
  "ของเดือนกย",
  "กย.",
  "ก.ย",
  "เดือนกันยา 69",
  "กันยา 2569",
  "กันยายนปีนี้",
  "กันยาปีนี้",
  "ก.ย. ปี 69",
  "sep",
  "Sep 2026",
  "September",
  "เดือน9",
  "เดือน 09",
  "เดือน ๙",
  "๙/๒๕๖๙",
  "9/2569",
  "09/69",
  "ก.ย.69",
  "ก.ย.'69",
  "วันที่ 1-5",
  "วันที่ 1 ถึง 5",
  "วันที่ 1-5 เดือนนี้",
  "วันที่ 1 ถึง 15 เดือนที่แล้ว",
  "1-5 ตุลา",
  "จันทร์ที่แล้ว",
  "วันจันทร์",
  "เสาร์อาทิตย์ที่ผ่านมา",
  "เมื่อเช้า",
  "เมื่อกี้",
  "คืนนี้"
] as const;

it('all controller matrix phrases keep bounded, non-future, exact-span wire candidates (V1 and V2)', async () => {
  const { createLineAiInputEvidence } = await import('./line-ai-input-evidence.js');
  for (const text of EVERYDAY_PERIOD_MATRIX) {
    const values = extractValueCandidates(text, P1_TODAY);
    assert.ok((values.periods?.length ?? 0) <= 12, text); // MAX_PERIOD_CANDIDATES remains 12.
    for (const item of [...values.amounts, ...values.dates, ...(values.periods ?? [])]) assert.ok(text.includes(item.span), text);
    for (const period of values.periods ?? []) {
      assert.ok(period.fromDate <= P1_TODAY, text);
      assert.equal(new Set(period.assumptions).size, period.assumptions.length, text);
    }
    assert.deepEqual(parseLineAiValueCandidates(values, text), values, text);
    const evidence = await createLineAiInputEvidence({ turnKey: 'period-p1', parts: [{ partId: 'p1', eventIdHash: 'a'.repeat(64), acceptedAtMs: 1, rawText: text }] });
    assert.ok(evidence, text);
    const v2 = await normalizer.extractValueCandidatesV2(evidence.inputEvidence, P1_TODAY);
    assert.ok(v2, text);
    assert.deepEqual(normalizer.parseLineAiValueCandidatesV2(v2, text, evidence.inputEvidence), v2, text);
  }
});


it('P3: a month abbreviation typed with only its final dot is that month (owner on LINE UAT 2026-10-05)', () => {
  const months = (text: string) => (extractValueCandidates(text, P1_TODAY).periods ?? []).map(p => [p.kind, p.fromDate, p.toDate]);
  const m = (from: string, to: string) => ['month', from, to];
  // His message, asked which period it meant: three months, as with every other way of writing them.
  const three = [m('2026-07-01', '2026-07-31'), m('2026-08-01', '2026-08-31'), m('2026-09-01', '2026-09-30')];
  for (const text of ['เทียบค่าใช้จ่าย กค. สค. กย.', 'กค. สค. กย.', 'กค.,สค.,กย.', 'เทียบค่าใช้จ่าย กค สค กย', 'เทียบค่าใช้จ่าย ก.ค. ส.ค. ก.ย.']) {
    assert.deepEqual(months(text), three, text);
    assert.equal(unresolvedMonthName(text, extractValueCandidates(text, P1_TODAY).periods ?? []), null, text);
  }
  // every month, alone and after เดือน, with a year, glued to a polite word, and beside กับ
  const all = ['มค.', 'กพ.', 'มีค.', 'เมย.', 'พค.', 'มิย.', 'กค.', 'สค.', 'กย.', 'ตค.', 'พย.', 'ธค.'];
  for (const [index, name] of all.entries()) {
    const key = `-${String(index + 1).padStart(2, '0')}-`;
    for (const text of [name, `เดือน ${name}`, `ค่าใช้จ่าย ${name}`, `ของเดือน${name}ค่ะ`]) {
      const found = extractValueCandidates(text, P1_TODAY).periods ?? [];
      assert.equal(found.length, 1, text); assert.ok(found[0]!.fromDate.includes(key), text); assert.equal(found[0]!.kind, 'month', text);
      assert.equal(unresolvedMonthName(text, found), null, text);
    }
  }
  assert.deepEqual(months('ค่าใช้จ่าย สค. 69'), [m('2026-08-01', '2026-08-31')]);
  assert.deepEqual(months('ธค. 68'), [m('2025-12-01', '2025-12-31')]);
  assert.deepEqual(months('เทียบ กค.กับสค.'), [m('2026-07-01', '2026-07-31'), m('2026-08-01', '2026-08-31')]);
  // the range, since and day-range forms take the same spelling
  for (const [text, from, to] of [['กค.-กย.', '2026-07-01', '2026-09-30'], ['กค. ถึง กย.', '2026-07-01', '2026-09-30'], ['ตั้งแต่ สค. ถึง ตค.', '2026-08-01', P1_TODAY],
    ['ตั้งแต่ สค.', '2026-08-01', P1_TODAY], ['1 สค. ถึง 15 กย.', '2026-08-01', '2026-09-15'], ['กค.ปีที่แล้ว', '2025-07-01', '2025-07-31']] as const) {
    assert.deepEqual((extractValueCandidates(text, P1_TODAY).periods ?? []).map(p => [p.fromDate, p.toDate]), [[from, to]], text);
  }
  // still not a month: the letters inside another word or name
  for (const text of ['มีค่าใช้จ่ายอะไรบ้าง', 'ร้านกค. จำกัด', 'สค.บ.']) assert.deepEqual(extractValueCandidates(text, P1_TODAY).periods ?? [], [], text);
});

it('P4: months and years as they are typed in a comparison or glued to the word before', () => {
  const read = (text: string) => (extractValueCandidates(text, P1_TODAY).periods ?? []).map(p => [p.fromDate, p.toDate]);
  const jul = ['2026-07-01', '2026-07-31'], aug = ['2026-08-01', '2026-08-31'], sep = ['2026-09-01', '2026-09-30'], oct = ['2026-10-01', P1_TODAY];
  const rows: Array<[string, string[][]]> = [
    // spoken names in a comparison: nothing was read before, so the assistant asked which period was meant
    ['เทียบกรกฎากับสิงหา', [jul, aug]], ['เทียบสิงหากับกันยา', [aug, sep]], ['เทียบ สิงหา กับ กันยา', [aug, sep]], ['สรุปกันยา', [sep]],
    // three months joined by a connector are a list, never a range plus a month
    ['เทียบ ก.ค.-ส.ค.-ก.ย.', [jul, aug, sep]], ['เทียบ กค-สค-กย', [jul, aug, sep]], ['กค.-สค.-กย.-ตค.', [jul, aug, sep, oct]],
    // two months joined by a connector stay one range
    ['ก.ค.-ก.ย.', [['2026-07-01', '2026-09-30']]], ['กค-กย', [['2026-07-01', '2026-09-30']]],
    // an abbreviation glued to the word before it, or followed by เทียบ / นี้
    ['ค่าใช้จ่ายกค.', [jul]], ['ยอดกย.', [sep]], ['สรุปกย.', [sep]], ['รายจ่ายสค', [aug]], ['ขอยอด ตค.นี้', [oct]], ['กย.เทียบกับสค.', [sep, aug]], ['กย เทียบ สค', [sep, aug]],
    ['กค./สค./กย.', [jul, aug, sep]],
    // a year with its era stated, the whole year, and a quarter counted in words
    ['พ.ศ. 2568', [['2025-01-01', '2025-12-31']]], ['ปี พ.ศ.2568', [['2025-01-01', '2025-12-31']]], ['ปี ค.ศ. 2025', [['2025-01-01', '2025-12-31']]], ['ค.ศ.2026', [['2026-01-01', P1_TODAY]]],
    ['ค่าใช้จ่ายทั้งปี', [['2026-01-01', P1_TODAY]]], ['ทั้งปี 68', [['2025-01-01', '2025-12-31']]], ['ปี 2568 ทั้งปี', [['2025-01-01', '2025-12-31']]], ['ปีนี้ทั้งปี', [['2026-01-01', P1_TODAY]]],
    ['ทั้งปีที่แล้ว', [['2025-01-01', '2025-12-31']]],
    ['ไตรมาสสาม', [['2026-07-01', '2026-09-30']]], ['ไตรมาสแรก', [['2026-01-01', '2026-03-31']]], ['ไตรมาสที่สอง ปี 68', [['2025-04-01', '2025-06-30']]],
  ];
  for (const [text, expected] of rows) {
    assert.deepEqual(read(text), expected, text);
    const found = extractValueCandidates(text, P1_TODAY);
    assert.equal(unresolvedMonthName(text, found.periods ?? []), null, text);
    for (const period of found.periods ?? []) assert.ok(text.includes(period.span), `${text}: span`);
    assert.deepEqual(parseLineAiValueCandidates(found, text), found, `${text}: wire`);
  }
  // still not months: a person's name after กับ, a longer word, the letters inside another word, a future era year
  for (const text of ['จ่ายให้กับกันยา 500 บาท', 'ไปกับตุลา', 'สรุปตุลาการ', 'ของมีค่า', 'ของพยาบาล', 'สคริปต์', 'ยอดมีค่ามาก', 'พ.ศ. 2599', 'ค.ศ. 1850']) {
    assert.deepEqual(read(text), [], text);
  }
});

it('out-of-scope half years, numeric months and weekdays still have no period', () => {
  for (const text of ['ครึ่งปีแรก', 'ครึ่งปีหลัง', 'ครึ่งปีแรก 2569', '9/2569',
    '๙/๒๕๖๙', '09/69', 'จันทร์ที่แล้ว', 'วันจันทร์', 'เสาร์อาทิตย์ที่ผ่านมา']) {
    assert.deepEqual(extractValueCandidates(text, P1_TODAY).periods ?? [], [], text);
  }

});


const P2_CONNECTORS = ['ถึง', 'จนถึง', 'ยัน', '-', '–', '—', '~', 'to', 'until', 'through'];

describe('P2: day ranges are one period (owner 2026-10-05)', () => {
  it('P2-1: named dates across months own both endpoints and follow the stated years', () => {
    const rows = [
      ...['ตั้งแต่วันที่ 1 ส.ค. ถึง 31 ต.ค.', '1 ส.ค. ถึง 31 ต.ค. 2569', 'วันที่ 1 สิงหา ถึง วันที่ 5 ตุลา',
        'ตั้งแต่1ส.ค.ถึง31ต.ค.', 'จากวันที่1สคถึงวันที่31ตค', 'ช่วง1เดือน8ถึง31เดือน10',
        'ระหว่าง1ส.ค.กับ31ต.ค.', 'ระหว่าง 1 ส.ค. และ 31 ต.ค.', 'ระหว่าง1ส.ค.ถึง31ต.ค.'].map(text => p1Row(text, '2026-08-01', P1_TODAY)),
      p1Row('15 ส.ค. ถึง 10 ก.ย.', '2026-08-15', '2026-09-10', 'range', ['year_assumed_latest_past'], '15 ส.ค. – 10 ก.ย. 2569'),
      ...['20 ธ.ค. ถึง 10 ม.ค.', '20 ธ.ค. ถึง 10 ม.ค. 2569', '20 ธ.ค. 2568 ถึง 10 ม.ค.', '20 ธ.ค. 2568 ถึง 10 ม.ค. 2569'].map(text => p1Row(text, '2025-12-20', '2026-01-10')),
      p1Row('1 ส.ค. 2569 ถึง 31 ต.ค. 2569', '2026-08-01', P1_TODAY, 'range', ['era_read_be', 'year_read_be', 'period_clamped_to_today']),
      p1Row('15 ต.ค. ถึง 31 ต.ค.', '2025-10-15', '2025-10-31'),
      p1Row('20 ก.ย. ถึง 10 ก.ย.', '2026-09-20', P1_TODAY),
      p1Row('20 ก.ย. ถึง 10 ก.ย. 2569', '2025-09-20', '2026-09-10'),
      p1None('15 ต.ค. 2569 ถึง 31 ต.ค. 2569'),
      p1Row('28 ก.พ. 2567 ถึง 29 ก.พ.', '2024-02-28', '2024-02-29'),
      p1Row('29 ก.พ. ถึง 28 ก.พ. 2568', '2024-02-29', '2025-02-28'),
      p1Row('29 ก.พ. ถึง 1 มี.ค.', '2024-02-29', '2024-03-01'),
      { text: '28 ก.พ. ถึง 29 ก.พ. 2567', today: '2024-03-01', expect: { kind: 'range', fromDate: '2024-02-28', toDate: '2024-02-29' } },
    ];
    for (const connector of P2_CONNECTORS) for (const [first, last] of [
      ['15 สิงหาคม', '10 กันยายน'], ['15 ส.ค.', '10 ก.ย.'], ['15 ส. ค', '10 ก. ย.'], ['15 สค', '10 กย'],
      ['15 สิงหา', '10 กันยา'], ['15 August', '10 September'], ['15 Aug.', '10 Sep.'], ['15 เดือน 8', '10 เดือน 9'],
    ]) rows.push(p1Row(`${first} ${connector} ${last}`, '2026-08-15', '2026-09-10'));
    checkPeriodRows(rows);
    for (const text of ['15 ส.ค. 2569 ถึง 10 ก.ย. 2568', '31 ก.ย. ถึง 5 ต.ค.', '29 ก.พ. 2569 ถึง 5 มี.ค. 2569']) {
      const values = extractValueCandidates(text, P1_TODAY);
      assert.ok(!values.periods?.some(period => period.kind === 'range'), text);
      assert.deepEqual(values.periods ?? [], [], `${text}: no fallback to an unrelated whole month`);
      assert.deepEqual(parseLineAiValueCandidates(values, text), values, text);
    }
  });

  it('P2-2: a named date ending today or now owns the whole range', () => {
    const rows: PeriodRow[] = [
      ...['ตั้งแต่ 15 ก.ย. ถึงวันนี้', '15 ก.ย. ถึงปัจจุบัน', '15 ก.ย. ถึงตอนนี้', '15 ก.ย. จนถึงวันนี้',
        'จากวันที่15กันยาถึงตอนนี้', '15 Sep to today', '15 September until now', '15 ก.ย. 2569 ถึงวันนี้'].map(text => p1Row(text, '2026-09-15', P1_TODAY)),
      p1Row('20 ธ.ค. ถึงวันนี้', '2025-12-20', P1_TODAY, 'range', ['year_assumed_latest_past']),
      p1Row('15 ต.ค. ถึงวันนี้', '2025-10-15', P1_TODAY),
      p1Row('5 ต.ค. ถึงวันนี้', P1_TODAY, P1_TODAY),
      p1None('15 ต.ค. 2569 ถึงวันนี้'),
      { text: '29 ก.พ. 2567 ถึงวันนี้', today: '2024-03-01', expect: { kind: 'range', fromDate: '2024-02-29', toDate: '2024-03-01' } },
    ];
    for (const connector of ['ถึง', 'จนถึง', 'ยัน']) for (const end of ['วันนี้', 'ตอนนี้', 'ปัจจุบัน']) {
      rows.push(p1Row(`ตั้งแต่วันที่ 15 ก.ย. ${connector}${end}`, '2026-09-15', P1_TODAY));
    }
    checkPeriodRows(rows);
    for (const text of ['ตั้งแต่ 31 ก.ย. ถึงวันนี้', '29 ก.พ. 2569 ถึงตอนนี้']) {
      assert.ok(!extractValueCandidates(text, P1_TODAY).periods?.some(p => p.kind === 'range'), text);
    }
    for (const text of ['15 ก.ย.', 'วันที่ 15 ก.ย.']) {
      const values = extractValueCandidates(text, P1_TODAY);
      assert.deepEqual(values.dates.map(date => date.isoDate), ['2026-09-15']);
      assert.deepEqual(values.periods ?? [], []);
    }
  });

  it('P2-4: "ตั้งแต่" a date or a month with no end named means up to today', () => {
    checkPeriodRows([
      // read as the whole of September before this rule: a different period, answered without a word
      ...['ตั้งแต่ 15 ก.ย.', 'ตั้งแต่วันที่ 15 ก.ย.', 'ตั้งแต่ 15 กันยายน', 'ตั้งแต่ 15 ก.ย. เป็นต้นมา', 'นับจาก 15 ก.ย.', 'since 15 Sep',
        'ค่าใช้จ่ายตั้งแต่ 15 ก.ย. มีอะไรบ้าง', 'ตั้งแต่ 15 ก.ย. 2569', 'ตั้งแต่ 15 ก.ย. ค่ะ'].map(text => p1Row(text, '2026-09-15', P1_TODAY)),
      ...['ตั้งแต่เดือนสิงหาคม', 'ตั้งแต่สิงหา', 'ตั้งแต่ ส.ค.', 'ตั้งแต่เดือนสิงหา เป็นต้นมา', 'since August', 'ตั้งแต่สิงหา ถึงวันนี้',
        'ตั้งแต่เดือนสิงหาคมถึงปัจจุบัน', 'ตั้งแต่สิงหาคม 2569'].map(text => p1Row(text, '2026-08-01', P1_TODAY)),
      p1Row('ตั้งแต่เดือนตุลา', '2026-10-01', P1_TODAY),
      p1Row('ตั้งแต่ธันวา', '2025-12-01', P1_TODAY, 'range', ['year_assumed_latest_past']),
      p1Row('ตั้งแต่ 20 ธ.ค.', '2025-12-20', P1_TODAY, 'range', ['year_assumed_latest_past']),
      // a range that names its end keeps its own reading
      p1Row('ตั้งแต่สิงหาถึงตุลา', '2026-08-01', P1_TODAY),
      p1Row('ตั้งแต่ 15 ส.ค. ถึง 10 ก.ย.', '2026-08-15', '2026-09-10'),
      p1Row('ตั้งแต่เดือนกรกฎาคมถึงกันยายน', '2026-07-01', '2026-09-30'),
    ]);
    // one period, and nothing beside it (not "today" as a second candidate)
    for (const text of ['ตั้งแต่ 15 ก.ย.', 'ตั้งแต่สิงหา ถึงวันนี้', 'ตั้งแต่เดือนสิงหาคม']) assert.equal(extractValueCandidates(text, P1_TODAY).periods?.length, 1, text);
    // not a start: an impossible day, a month that has not come, a word that only begins like a month, `may` alone
    for (const text of ['ตั้งแต่ 31 ก.ย.', 'ตั้งแต่ ธ.ค. 2569', 'ตั้งแต่มีค่าใช้จ่ายเข้ามา', 'since may']) {
      assert.ok(!extractValueCandidates(text, P1_TODAY).periods?.some(p => p.kind === 'range'), text);
    }
    // without "ตั้งแต่" a date or a month is what it was
    for (const text of ['15 ก.ย.', 'เดือนสิงหาคม', 'ของเดือนสิงหา']) assert.ok(!extractValueCandidates(text, P1_TODAY).periods?.some(p => p.kind === 'range'), text);
  });

  it('P2-3: full numeric dates reuse range order and period-era rules without changing DATE candidates', () => {
    const rows: PeriodRow[] = [
      ...['1/9/69 ถึง 30/9/69', '1/9/2569 - 30/9/2569', '01/09/2026 ถึง 30/09/2026',
        '๑/๙/๖๙ ถึง ๓๐/๙/๖๙', '1-9-69 ถึง 30-9-69', '1.9.69 ถึง 30.9.69'].map(text => p1Row(text, '2026-09-01', '2026-09-30')),
      p1Row('20/12/68 ถึง 10/1/69', '2025-12-20', '2026-01-10', 'range', ['two_digit_year_resolved_plausible_era']),
      p1Row('1/2/69 ถึง 3/4/69', '2026-02-01', '2026-04-03', 'range', ['order_assumed_day_month', 'two_digit_year_resolved_plausible_era']),
      p1Row('9/1/69 ถึง 9/30/69', '2026-09-01', '2026-09-30'),
      p1Row('1/8/25 ถึง 30/9/25', '2025-08-01', '2025-09-30'),
      p1Row('1/8/2569 ถึง 31/10/2569', '2026-08-01', P1_TODAY, 'range', ['era_read_be', 'year_read_be', 'period_clamped_to_today']),
      p1None('15/10/2569 ถึง 31/10/2569'), p1None('3/4/2569 ถึง 1/2/2569'), p1None('31/9/69 ถึง 5/10/69'),
      p1None('15/8/69 ถึง 9/30/69'), p1None('1/9/99 ถึง 30/9/99'),
      { text: '28/2/2024 ถึง 29/2/2024', today: '2024-03-01', expect: { kind: 'range', fromDate: '2024-02-28', toDate: '2024-02-29' } },
    ];
    for (const connector of P2_CONNECTORS) rows.push(p1Row(`1/9/69 ${connector} 30/9/69`, '2026-09-01', '2026-09-30'));
    checkPeriodRows(rows);
    for (const [first, connector, second] of [['1/9/69', 'ถึง', '30/9/69'], ['1/2/69', 'ถึง', '3/4/69'], ['20/12/2568', '-', '10/1/2569']]) {
      const values = extractValueCandidates(`${first} ${connector} ${second}`, P1_TODAY);
      assert.deepEqual(values.dates, [...extractValueCandidates(first!, P1_TODAY).dates, ...extractValueCandidates(second!, P1_TODAY).dates]);
    }
    assert.deepEqual(extractValueCandidates('1/9/69', P1_TODAY).periods ?? [], []);
    const dates = extractValueCandidates('1/2/69 ถึง 3/4/69', P1_TODAY).dates;
    assert.deepEqual(dates.map(date => date.isoDate), ['2026-02-01', '2069-02-01', '2026-04-03', '2069-04-03']);
    assert.ok(dates.every(isAmbiguousDateCandidate));
    assert.deepEqual(extractValueCandidates('เทียบ 1-15 ส.ค. กับ 1-15 ก.ย.', P1_TODAY).periods?.map(p => [p.kind, p.fromDate, p.toDate]),
      [['range', '2026-08-01', '2026-08-15'], ['range', '2026-09-01', '2026-09-15']]);
    for (const text of ['เทียบ 1 ส.ค. กับ 31 ต.ค.', '1 ส.ค. และ 31 ต.ค.']) {
      assert.deepEqual(extractValueCandidates(text, P1_TODAY).periods ?? [], [], `${text}: stated days must not turn into months`);
      assert.equal(extractValueCandidates(text, P1_TODAY).dates.length, 2, text);
    }
    checkPeriodRows([p1Row('1-15 ก.ย.', '2026-09-01', '2026-09-15'), p1Row('1 ถึง 15 กันยายน', '2026-09-01', '2026-09-15')]);
  });
});

describe('expense and claim relative day words (Bangkok civil date)', () => {
  const day = '2026-01-01';
  for (const [word, expected] of [
    ['เมื่อกลางวัน', day], ['เมื่อเช้า', day], ['ตะกี้', day], ['เมื่อกี้', day], ['เมื่อเย็น', day],
    ['วันนี้', day], ['วันนี่', day], ['วันนี้ตอนเย็น', day], ['คืนนี้', day],
    ['today', day], ['this morning', day], ['this afternoon', day], ['this evening', day], ['just now', day],
    ['เมื่อคืน', '2025-12-31'], ['เมื่อคืนนี้', '2025-12-31'], ['เมื่อวาน', '2025-12-31'],
    ['เมื่อวานตอนเช้า', '2025-12-31'], ['yesterday', '2025-12-31'], ['yesterday morning', '2025-12-31'], ['last night', '2025-12-31'],
    ['วานซืน', '2025-12-30'], ['เมื่อวานซืน', '2025-12-30'], ['day before yesterday', '2025-12-30'],
  ]) it(`${word} resolves once, including month/year rollover`, () => {
    const result = extractValueCandidates(`ค่าเดินทาง 275 บาท ${word}`, day);
    assert.deepEqual(result.periods?.map(value => [value.kind, value.fromDate, value.toDate]), [['day', expected, expected]]);
    assert.ok(result.periods?.[0]?.span.includes(word));
    assert.deepEqual(result.amounts.map(value => value.value), ['275']);
  });
  it('does not collapse two conflicting days or assume a day when none was given', () => {
    assert.equal(extractValueCandidates('ค่าเดินทาง 275 บาท เมื่อวาน วันนี้', day).periods?.length, 2);
    assert.deepEqual(extractValueCandidates('ค่าเดินทาง 275 บาท', day).periods ?? [], []);
    assert.deepEqual(extractValueCandidates('ค่าเดินทาง 275 บาท พรุ่งนี้เช้า', day).periods ?? [], []);
  });
});

it('Exam G4: abbreviated and continuing month words produce current deterministic periods', () => {
  for (const [text, month] of [['fuel ด.นี้', '2026-10'], ['แล้ว ด.ก่อน', '2026-09'], ['the month before', '2026-09'], ['the previous month', '2026-09']] as const) {
    const result = extractValueCandidates(text, '2026-10-17');
    assert.ok(result.periods?.some(period => period.monthKey === month), text);
  }
});


it('PWS-PND53-DUE calendar queries can retain an explicitly future named month without changing read defaults', () => {
  const text = 'ภงด.53 เดือนมกราคม 2570 ต้องยื่นเมื่อไหร่';
  assert.equal(normalizer.resolvePeriodCandidates(text, '2026-11-04').length, 0);
  assert.equal(normalizer.resolvePeriodCandidates(text, '2026-11-04', [], undefined, { allowFuture: true })[0]?.monthKey, '2027-01');
});

describe('A3c yearless Thai-order dates use the latest Bangkok occurrence', () => {
  for (const [span, isoDate] of [
    ['3/11', '2026-11-03'], ['28/12', '2025-12-28'], ['๓/๑๑', '2026-11-03'],
    ['3 พ.ย.', '2026-11-03'], ['3 พย', '2026-11-03'], ['3 พฤศจิกายน', '2026-11-03'],
    ['28 ธันวาคม', '2025-12-28'], ['29/2', '2024-02-29'], ['4/11', '2026-11-04'],
    ['3/11/2569', '2026-11-03'], ['25/3/69', '2026-03-25'], ['3 พ.ย', '2026-11-03'], ['3 พย.', '2026-11-03'], ['28/12/2027', '2027-12-28'], ['3 พ.ย. 69', '2026-11-03'],
    ['3 พฤศจิกายน 2569', '2026-11-03'],
  ]) it(`reads ${span} as one date and keeps the adjacent amount`, () => {
    const result = extractValueCandidates(`ค่าแท็กซี่ 250 บาท ${span}`, '2026-11-04');
    assert.deepEqual(result.dates.map(date => [date.span, date.isoDate]), [[span, isoDate]]);
    assert.deepEqual(result.amounts.map(amount => amount.value), ['250']);
    assert.deepEqual(result.periods ?? [], []);
  });
  it('supports all full and abbreviated Thai month names without swallowing a month read', () => {
    const full = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    for (const [index, month] of full.entries()) for (const name of [month, normalizer.THAI_MONTH_ABBREVIATIONS[index]!, normalizer.THAI_MONTH_ABBREVIATIONS[index]!.replaceAll('.', '')]) {
      const result = extractValueCandidates(`3 ${name}`, '2026-11-04');
      assert.deepEqual(result.dates.map(date => date.isoDate), [`${index === 11 ? 2025 : 2026}-${String(index + 1).padStart(2, '0')}-03`], name);
      assert.deepEqual(result.amounts, [], name);
      assert.deepEqual(result.periods ?? [], [], name);
    }
    const month = extractValueCandidates('สรุป พ.ย.', '2026-11-04');
    assert.deepEqual(month.dates, []);
    assert.deepEqual(month.periods?.map(period => period.monthKey), ['2026-11']);
  });
  it('rejects impossible day/month tokens without silently re-reading their digits or month', () => {
    for (const token of ['31/2', '0/5', '3/13', '3/13/2026', '3/25/2025', '31/2/2569', '31 ก.พ.', '0 พฤษภาคม']) {
      const result = extractValueCandidates(`ค่าแท็กซี่ 250 บาท ${token}`, '2026-11-04');
      assert.deepEqual(result.dates, [], token);
      assert.deepEqual(result.periods ?? [], [], token);
      assert.deepEqual(result.amounts.map(amount => amount.value), ['250'], token);
    }
  });
});

it('R13 a number after วัน with a currency token stays money', async () => {
  const { createLineAiInputEvidence } = await import('./line-ai-input-evidence.js');
  for (const [text, amounts] of [['ค่าจอดรถ 2 วัน 40 บาท', ['40']], ['ค่าเช่าเต็นท์ 3 วัน 90 บ.', ['90']], ['ค่าที่พัก 1 วัน 1500 บาท', ['1500']]] as const) {
    const evidence = (await createLineAiInputEvidence({ turnKey: 'r13m', parts: [{ partId: 'p', eventIdHash: 'b'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
    const candidates = (await normalizer.extractValueCandidatesV2(evidence, '2026-11-07'))!;
    assert.ok(amounts.every(value => candidates.amounts.some(a => a.value === value)), text);
    assert.deepEqual(candidates.dates, [], text);
  }
});

it('R13 spoken days in this month are verified dates rather than amounts', async () => {
  const { createLineAiInputEvidence } = await import('./line-ai-input-evidence.js');
  for (const date of ['วัน 5 เดือนนี้', 'วันที่ 5', '5 พ.ย.', '5/11']) {
    const text = `สร้างใบเบิกค่ารถ 260 บ. ${date}`;
    const evidence = (await createLineAiInputEvidence({ turnKey: 'r13', parts: [{ partId: 'p', eventIdHash: 'a'.repeat(64), acceptedAtMs: Date.now(), rawText: text }] }))!.inputEvidence;
    const candidates = (await normalizer.extractValueCandidatesV2(evidence, '2026-11-07'))!;
    assert.deepEqual(candidates.amounts.map(a => a.value), ['260']);
    assert.deepEqual(candidates.dates.map(d => d.isoDate), ['2026-11-05']);
    assert.ok(await normalizer.verifyLineAiValueCandidatesV2(candidates, evidence));
  }
});

it('R14 round and ordinal numbers are locators rather than money', () => {
  for (const text of ['ค่าเดินทาง รอบ 4 ค่ะ', 'ข้อ 2', 'ใบที่ 3', 'อันที่ 2']) assert.deepEqual(extractValueCandidates(text, '2026-11-07').amounts, [], text);
  assert.deepEqual(extractValueCandidates('ค่าขนของ210บาท', '2026-11-07').amounts.map(a => a.value), ['210']);
});

it('R14 particle trimming drops only whole particle words, never the end of a real word', async () => {
  const { stripLineFieldParticles } = await import('./line-ai.js');
  for (const [text, want] of [['ประกันภาคบังคับ', 'ประกันภาคบังคับ'], ['ซ่อมป้ายหน้า', 'ซ่อมป้ายหน้า'], ['ภาษีมูลค่า', 'ภาษีมูลค่า'], ['ค่าเจรจา', 'ค่าเจรจา'],
    ['ร้านชนะ', 'ร้านชนะ'], ['ค่าของไหว้เจ้า', 'ค่าของไหว้เจ้า'], ['หจก. สมใจ', 'หจก. สมใจ'], ['ร้านสมใจ หจก.', 'ร้านสมใจ หจก.'],
    ['ไปส่งของจ้ะ', 'ไปส่งของ'], ['ไปส่งของจ้า', 'ไปส่งของ'], ['ไปส่งของนะคะ', 'ไปส่งของ'], ['ค่าแท็กซี่ค่า', 'ค่าแท็กซี่'], ['รับของครับผม', 'รับของ'],
    ['ร้านป้านะ', 'ร้านป้า'], ['ค่าน้ำมันน้าา', 'ค่าน้ำมัน'], ['ไปส่งของ จ้ะ ', 'ไปส่งของ'], ['จ้ะจ้ะ', ''], ['จ้าาา', '']] as const) {
    assert.equal(stripLineFieldParticles(text), want, text);
  }
});

it('R15 spoken rounds and row ordinals never become claim amounts', () => {
  for (const text of ['รอบห้า', 'รอบที่หก', 'รอบแรก', 'ใบที่สอง', 'รอบสามสิบเอ็ด']) {
    assert.deepEqual(extractValueCandidates(`260 บาท ${text}`, '2026-11-07').amounts.map(a => a.value), ['260'], text);
  }
});
