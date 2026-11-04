import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isKnownPlaceholder, referencedPlaceholders, renderUserText, TEMPLATE_PLACEHOLDERS } from './template';

// 2026-09-27T06:00Z = 13:00 Bangkok, 27 Sep 2026 (Thai year 2569).
const SEPTEMBER = new Date('2026-09-27T06:00:00.000Z');
// 2027-01-05T06:00Z = 13:00 Bangkok, 5 Jan 2027 (Thai year 2570) — last month crosses into
// December 2026 (Thai year 2569), the case that must NOT just subtract 1 from the current month.
const JANUARY = new Date('2027-01-05T06:00:00.000Z');

describe('renderUserText', () => {
  it('renders this/last month names and abbreviations', () => {
    assert.equal(renderUserText('{{this_month_th}}', SEPTEMBER), 'กันยายน');
    assert.equal(renderUserText('{{last_month_th}}', SEPTEMBER), 'สิงหาคม');
    assert.equal(renderUserText('{{this_month_abbr_th}}', SEPTEMBER), 'ก.ย.');
    assert.equal(renderUserText('{{last_month_abbr_th}}', SEPTEMBER), 'ส.ค.');
  });

  it('renders Buddhist and Gregorian years', () => {
    assert.equal(renderUserText('{{this_be_year}}', SEPTEMBER), '2569');
    assert.equal(renderUserText('{{this_be_year_short}}', SEPTEMBER), '69');
    assert.equal(renderUserText('{{this_ce_year}}', SEPTEMBER), '2026');
  });

  it('renders today_day without zero-padding', () => {
    assert.equal(renderUserText('{{today_day}}', SEPTEMBER), '27');
  });

  it('crosses the year boundary correctly in January: last month is December of the PREVIOUS CE/BE year', () => {
    assert.equal(renderUserText('{{this_month_th}}', JANUARY), 'มกราคม');
    assert.equal(renderUserText('{{last_month_th}}', JANUARY), 'ธันวาคม');
    assert.equal(renderUserText('{{last_month_abbr_th}}', JANUARY), 'ธ.ค.');
    assert.equal(renderUserText('{{this_be_year}}', JANUARY), '2570');
    assert.equal(renderUserText('{{last_month_be_year}}', JANUARY), '2569');
    assert.equal(renderUserText('{{this_ce_year}}', JANUARY), '2027');
  });

  it('fills several placeholders in one sentence', () => {
    assert.equal(
      renderUserText('เดือน{{last_month_th}} ปี {{last_month_be_year}} จ่ายไปเท่าไหร่คะ', SEPTEMBER),
      'เดือนสิงหาคม ปี 2569 จ่ายไปเท่าไหร่คะ',
    );
  });

  it('passes text with no placeholders through unchanged', () => {
    assert.equal(renderUserText('เดือนนี้จ่ายไปเท่าไหร่คะ', SEPTEMBER), 'เดือนนี้จ่ายไปเท่าไหร่คะ');
  });

  it('throws on an unknown placeholder', () => {
    assert.throws(() => renderUserText('{{next_month_th}}', SEPTEMBER), /unknown placeholder/);
  });
});

describe('referencedPlaceholders / isKnownPlaceholder', () => {
  it('lists every {{...}} key found, known or not', () => {
    assert.deepEqual(referencedPlaceholders('{{this_month_th}} {{bogus}} {{this_be_year}}'), ['this_month_th', 'bogus', 'this_be_year']);
    assert.deepEqual(referencedPlaceholders('no placeholders here'), []);
  });

  it('recognizes exactly the documented placeholder set', () => {
    for (const key of TEMPLATE_PLACEHOLDERS) assert.equal(isKnownPlaceholder(key), true);
    assert.equal(isKnownPlaceholder('next_month_th'), false);
  });
});

it('M3 uses Bangkok month offsets across years and renders payment gold from the same clock', async () => {
  const { workflowMonthKey } = await import('./template');
  assert.equal(workflowMonthKey(JANUARY, -1), '2026-12');
  assert.equal(workflowMonthKey(new Date('2026-12-31T17:30:00Z'), 0), '2027-01');
  assert.equal(workflowMonthKey(new Date('2026-12-04T04:00:00Z'), 1), '2027-01');
  assert.equal(renderUserText('{{today_iso}}', JANUARY), '2027-01-05');
});
