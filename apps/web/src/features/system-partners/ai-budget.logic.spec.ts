import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_BUDGET_BUCKET_LABELS,
  AI_REQUEST_KIND_LABELS,
  AI_USAGE_BASIS_LABELS,
  aiAverageCostLabel,
  aiCacheCostLabel,
  aiCoverageNotice,
  hasAiUsageBreakdown,
  aiUsageBasisNote,
  budgetBarClass,
  budgetBarWidth,
  budgetPercent,
  budgetTextClass,
  isOcrConfigVersionConflict,
  OCR_CONFIG_STALE_MESSAGE,
  ocrUsageTrackingNote,
  ocrUnsavedToggleMessage,
  parseBudgetBahtInput,
  parseOcrMonthlyLimitInput,
  reloadAfterOcrConfigConflict,
  ocrRemaining,
  satangToBaht,
  satangToBahtInput,
} from './ai-budget.logic';

describe('satangToBaht', () => {
  it('renders satang as baht with exactly two decimals', () => {
    assert.equal(satangToBaht(0), '฿0.00');
    assert.equal(satangToBaht(1), '฿0.01');
    assert.equal(satangToBaht(123_456), '฿1,234.56');
  });

  it('explains the one partial rollout month and disappears afterward', () => {
    assert.match(ocrUsageTrackingNote('2026-08')!, /27 ส\.ค\. 2569/);
    assert.equal(ocrUsageTrackingNote('2026-09'), null);
  });

  it('gives the input field plain baht without separators', () => {
    assert.equal(satangToBahtInput(500_000), '5000');
    // Satang are shown, never rounded away, so an override round-trips through the field intact.
    assert.equal(satangToBahtInput(150), '1.50');
    assert.equal(satangToBahtInput(200_050), '2000.50');
  });
});

describe('parseBudgetBahtInput', () => {
  it('treats an empty field as "clear the override"', () => {
    for (const raw of ['', '   ']) {
      assert.deepEqual(parseBudgetBahtInput(raw), { ok: true, monthlyBudgetSatang: null });
    }
  });

  it('converts whole baht to satang', () => {
    assert.deepEqual(parseBudgetBahtInput('5000'), { ok: true, monthlyBudgetSatang: 500_000 });
    assert.deepEqual(parseBudgetBahtInput(' 1 '), { ok: true, monthlyBudgetSatang: 100 });
  });

  it('accepts up to two decimals, exactly — no float drift on the way to satang', () => {
    assert.deepEqual(parseBudgetBahtInput('2000.50'), { ok: true, monthlyBudgetSatang: 200_050 });
    assert.deepEqual(parseBudgetBahtInput('2000.5'), { ok: true, monthlyBudgetSatang: 200_050 });
    assert.deepEqual(parseBudgetBahtInput('1.01'), { ok: true, monthlyBudgetSatang: 101 });
    assert.deepEqual(parseBudgetBahtInput('1.10'), { ok: true, monthlyBudgetSatang: 110 });
    // The classic binary-float traps: 1.005*100 = 100.49999999999999, 8.2*100 = 819.9999999999999.
    assert.deepEqual(parseBudgetBahtInput('1.99'), { ok: true, monthlyBudgetSatang: 199 });
    assert.deepEqual(parseBudgetBahtInput('8.20'), { ok: true, monthlyBudgetSatang: 820 });
    assert.deepEqual(parseBudgetBahtInput('10000.07'), { ok: true, monthlyBudgetSatang: 1_000_007 });
  });

  it('rejects a third decimal rather than rounding it away silently', () => {
    const parsed = parseBudgetBahtInput('2000.505');
    assert.equal(parsed.ok, false);
    assert.match((parsed as { message: string }).message, /ทศนิยมไม่เกิน 2 ตำแหน่ง/);
  });

  it('rejects zero without pretending AI can be switched off here', () => {
    const parsed = parseBudgetBahtInput('0');
    assert.equal(parsed.ok, false);
    assert.match((parsed as { message: string }).message, /ปิดสิทธิ์ผู้ช่วย AI/);
  });

  it('rejects anything that is not a plain baht amount', () => {
    for (const raw of ['-1', 'abc', '1e', '1e3', '1,000', '๑๐๐', '0.5', '.5', '5.']) {
      assert.equal(parseBudgetBahtInput(raw).ok, false, `expected "${raw}" to be rejected`);
    }
  });

  it('rejects nonempty amounts that cannot survive JSON as an exact satang value', () => {
    for (const raw of ['9'.repeat(400), '90071992547409.92', '90071992547409.93']) {
      assert.equal(parseBudgetBahtInput(raw).ok, false, 'an invalid amount must not become a null override');
    }
    const valid = parseBudgetBahtInput('2000.50');
    assert.deepEqual(JSON.parse(JSON.stringify(valid)), { ok: true, monthlyBudgetSatang: 200050 });
  });
});

describe('budgetPercent', () => {
  it('rounds the month-to-date share and never clamps the number itself', () => {
    assert.equal(budgetPercent(0, 500_000), 0);
    assert.equal(budgetPercent(250_000, 500_000), 50);
    assert.equal(budgetPercent(700_000, 500_000), 140);
  });

  it('returns 0 rather than Infinity/NaN for a non-positive budget', () => {
    assert.equal(budgetPercent(100, 0), 0);
    assert.equal(budgetPercent(100, Number.NaN), 0);
  });

  it('clamps only the bar width', () => {
    assert.equal(budgetBarWidth(140), 100);
    assert.equal(budgetBarWidth(-5), 0);
    assert.equal(budgetBarWidth(42), 42);
  });
});

describe('budget colour thresholds', () => {
  it('goes amber above 80% and red at the cap', () => {
    assert.equal(budgetBarClass(80), 'bg-brand-600');
    assert.equal(budgetBarClass(81), 'bg-yellow-500');
    assert.equal(budgetBarClass(99), 'bg-yellow-500');
    assert.equal(budgetBarClass(100), 'bg-red-500');
    assert.equal(budgetTextClass(50), 'text-gray-500');
    assert.equal(budgetTextClass(90), 'text-yellow-600');
    assert.equal(budgetTextClass(120), 'text-red-600');
  });
});

describe('OCR monthly limit', () => {
  it('uses an empty field for unlimited and accepts whole counts', () => {
    assert.deepEqual(parseOcrMonthlyLimitInput(''), { ok: true, monthlyLimit: null });
    assert.deepEqual(parseOcrMonthlyLimitInput(' 250 '), { ok: true, monthlyLimit: 250 });
  });

  it('rejects zero, decimals, notation and values above the operator safety bound', () => {
    for (const value of ['0', '-1', '1.5', '1e3', '1000001', 'หนึ่งร้อย']) {
      assert.equal(parseOcrMonthlyLimitInput(value).ok, false, value);
    }
  });

  it('computes remaining without going below zero and keeps unlimited explicit', () => {
    assert.equal(ocrRemaining(8, 10), 2);
    assert.equal(ocrRemaining(12, 10), 0);
    assert.equal(ocrRemaining(12, null), null);
  });

  it('distinguishes the saved OCR state from an unsaved switch draft', () => {
    assert.equal(ocrUnsavedToggleMessage(true, true), null);
    assert.match(ocrUnsavedToggleMessage(true, false)!, /ยังไม่ได้ปิด/);
    assert.match(ocrUnsavedToggleMessage(false, true)!, /ยังไม่เปิดใช้งาน/);
    assert.match(ocrUnsavedToggleMessage(false, true)!, /บันทึก OCR/);
  });

  it('recognizes the stale-write response that requires loading the latest OCR config', () => {
    assert.equal(isOcrConfigVersionConflict({ status: 409, code: 'ocr_config_version_conflict' }), true);
    assert.equal(isOcrConfigVersionConflict({ status: 422 }), false);
    assert.equal(isOcrConfigVersionConflict(new Error('offline')), false);
  });

  it('reloads latest state on 409 and keeps the operator message in Thai', async () => {
    let reloads = 0;
    assert.equal(await reloadAfterOcrConfigConflict({ status: 409 }, async () => { reloads += 1; }), true);
    assert.equal(await reloadAfterOcrConfigConflict({ status: 422 }, async () => { reloads += 1; }), false);
    assert.equal(reloads, 1);
    assert.match(OCR_CONFIG_STALE_MESSAGE, /ผู้ดูแลอีกคน/);
    assert.match(OCR_CONFIG_STALE_MESSAGE, /โหลดค่าล่าสุด/);
  });
});

describe('AI usage breakdown labels (remediation spec §11.1)', () => {
  it('shows the average per provider call, and "—" rather than ฿0.00 when nothing was called', () => {
    assert.equal(aiAverageCostLabel(1_000, 4), '฿2.50');
    assert.equal(aiAverageCostLabel(347, 3), '฿1.16', 'fractional satang round to the displayed baht');
    assert.equal(aiAverageCostLabel(0, 0), '—');
    // A month with only a correction has cost but no call — an average would be a lie, not 0.
    assert.equal(aiAverageCostLabel(-250, 0), '—');
  });

  it('labels buckets and kinds in Thai, including the honest UNKNOWN row', () => {
    assert.equal(AI_BUDGET_BUCKET_LABELS['CHAT'], 'แชตและ AI ทั่วไป');
    assert.equal(AI_BUDGET_BUCKET_LABELS['OCR'], 'AI อ่านเอกสาร');
    assert.equal(AI_BUDGET_BUCKET_LABELS['UNKNOWN'], 'ไม่ทราบประเภท');
    assert.equal(AI_REQUEST_KIND_LABELS['UNKNOWN'], 'ไม่ทราบประเภท');
    assert.match(AI_USAGE_BASIS_LABELS['CONSERVATIVE_ESTIMATE']!, /ประมาณ/);
  });

  it('reports missing cache pricing as unavailable, never as zero baht', () => {
    assert.equal(aiCacheCostLabel(null), 'ไม่มีข้อมูล');
    assert.equal(aiCacheCostLabel({ read: 5, write: 50 }), 'อ่าน ฿0.05 / เขียน ฿0.50');
    assert.equal(aiCacheCostLabel({ read: 0, write: 0 }), 'อ่าน ฿0.00 / เขียน ฿0.00', 'a priced zero is still evidence');
  });

  it('names partial metadata coverage with the date collection started', () => {
    const format = (value: string) => `วันที่ ${value.slice(0, 10)}`;
    assert.equal(aiCoverageNotice({ status: 'complete', calls: 9, callsWithMetadata: 9, firstMetadataAt: 'x' }, format), null);
    assert.equal(aiCoverageNotice({ status: 'none', calls: 0, callsWithMetadata: 0, firstMetadataAt: null }, format), null);
    const partial = aiCoverageNotice(
      { status: 'partial', calls: 10, callsWithMetadata: 4, firstMetadataAt: '2026-09-17T03:00:00.000Z' }, format)!;
    assert.match(partial, /4 จาก 10 ครั้ง/);
    assert.match(partial, /วันที่ 2026-09-17/);
    assert.match(aiCoverageNotice({ status: 'none', calls: 6, callsWithMetadata: 0, firstMetadataAt: null }, format)!, /ไม่ทราบประเภท/);
  });

  it('warns when part of the month rests on estimated or unknown counters', () => {
    const measured = [{ usageBasis: 'PROVIDER_REPORTED', costSatang: 900, calls: 3 }];
    assert.equal(aiUsageBasisNote(measured), null);
    const mixed = aiUsageBasisNote([
      ...measured,
      { usageBasis: 'CONSERVATIVE_ESTIMATE', costSatang: 200, calls: 2 },
      { usageBasis: 'UNKNOWN', costSatang: 400, calls: 5 },
    ])!;
    assert.match(mixed, /ค่าประมาณเมื่อหมดเวลา 2 ครั้ง \(฿2\.00\)/);
    assert.match(mixed, /ไม่ทราบที่มา 5 ครั้ง \(฿4\.00\)/);
    // An empty slice is present in every response; it must not raise a false alarm.
    assert.equal(aiUsageBasisNote([{ usageBasis: 'CONSERVATIVE_ESTIMATE', costSatang: 0, calls: 0 }]), null);
  });

  it('hides the whole section for a pre-D1 response instead of throwing mid-render', () => {
    // A rolling deploy can serve this page from an API that predates the breakdown fields.
    assert.equal(hasAiUsageBreakdown({ breakdown: { monthKey: '2026-09' } }), true);
    assert.equal(hasAiUsageBreakdown({}), false);
    assert.equal(hasAiUsageBreakdown({ breakdown: null }), false);
    assert.equal(hasAiUsageBreakdown(null), false);
  });
});
