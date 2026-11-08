import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_BUDGET_STEP_BOUNDS } from '@watchdog-bms/contracts';
import {
  AI_BUDGET_BUCKET_LABELS,
  AI_CREDIT_HOLD_ACTION_LABELS,
  AI_CREDIT_HOLD_EMPTY_NOTE,
  AI_CREDIT_HOLD_HELP_NOTE,
  aiCreditHoldAgeLabel,
  aiCreditHoldConsequence,
  aiCreditHoldKindLabel,
  aiCreditHoldStepLabel,
  isAiCreditHoldConflict,
  AI_BUDGET_MODE_LABELS,
  AI_BUDGET_RESERVED_NOTE,
  AI_BUDGET_STALE_MESSAGE,
  aiBudgetAvailableLabel,
  aiBudgetCapLabel,
  aiBudgetCurrentMonthKey,
  aiBudgetDraftChanged,
  aiBudgetDraftFromPolicy,
  aiBudgetInvalidNotice,
  aiBudgetMonthOptions,
  aiBudgetPendingText,
  aiBudgetScopeRows,
  canManageAiBudget,
  hasAiBudgetPolicy,
  isAiBudgetPolicyConflict,
  nextAiBudgetMonthKey,
  parseAiBudgetCapInput,
  reloadAfterAiBudgetConflict,
  validateAiBudgetDraft,
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
  aiChatCreditSourceText,
  aiTabStatusRows,
  bahtText,
  chatCreditConfirmMessage,
  chatCreditDraftChanged,
  chatCreditInputFromUsage,
  chatCreditPolicyRequest,
  parseChatCreditInput,
  receiptImagesSourceText,
  receiptImageTiles,
  receiptQuotaControlVisible,
  safetyCeilingConfirmMessage,
} from './ai-budget.logic';
import type { PartnerAiUsageDto, PartnerReceiptImagesDto } from '@watchdog-bms/contracts';

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

// ── Split CHAT/OCR budget policy (remediation spec §11.3, §12.4, §12.5) ──────

describe('split AI budget policy helpers', () => {
  const month = (monthKey: string) => `เดือน ${monthKey}`;
  const shared = { mode: 'SHARED', chatCapSatang: null, ocrCapSatang: null, pending: null };
  const split = { mode: 'SPLIT', chatCapSatang: 3000, ocrCapSatang: 7000, pending: null };

  it('parses a cap in baht, where 0 closes the bucket and empty is not "unlimited"', () => {
    assert.deepEqual(parseAiBudgetCapInput('30'), { ok: true, satang: 3000 });
    // Satang survive exactly: '30.50' must not drift to 3049.999.
    assert.deepEqual(parseAiBudgetCapInput('30.50'), { ok: true, satang: 3050 });
    assert.deepEqual(parseAiBudgetCapInput(' 0 '), { ok: true, satang: 0 });
    for (const bad of ['', '  ', '-5', '30.505', 'abc', '1e3']) {
      assert.equal(parseAiBudgetCapInput(bad).ok, false, bad);
    }
    assert.match((parseAiBudgetCapInput('') as { notice: string }).notice, /ใส่ 0/);
  });

  it('offers this Bangkok month and the next, from the month the SERVER pinned', () => {
    // Never the browser clock: it disagrees with the server around midnight and across time zones.
    assert.equal(aiBudgetCurrentMonthKey({ breakdown: { monthKey: '2026-09' }, ocr: { current: { monthKey: '2026-08' } } }), '2026-09');
    assert.equal(aiBudgetCurrentMonthKey({ ocr: { current: { monthKey: '2026-08' } } }), '2026-08');
    assert.deepEqual(aiBudgetMonthOptions('2026-09'), [
      { monthKey: '2026-09', current: true }, { monthKey: '2026-10', current: false },
    ]);
    // December rolls the year.
    assert.equal(nextAiBudgetMonthKey('2026-12'), '2027-01');
    assert.equal(nextAiBudgetMonthKey('2026-01'), '2026-02');
  });

  it('prefills the form from the SAVED policy, in baht, satang included', () => {
    assert.deepEqual(aiBudgetDraftFromPolicy(shared, '2026-09'),
      { mode: 'SHARED', chat: '', ocr: '', effectiveMonthKey: '2026-09' });
    assert.equal(aiBudgetDraftFromPolicy({ ...shared, chatCapSatang: 8_000 }, '2026-09').chat, '',
      'the SHARED default is displayed as a cap, not copied into editable SPLIT settings');
    assert.deepEqual(aiBudgetDraftFromPolicy({ ...split, chatCapSatang: 3050 }, '2026-09'),
      { mode: 'SPLIT', chat: '30.50', ocr: '70', effectiveMonthKey: '2026-09' });
    // A cap of 0 is a real saved value, not an empty field.
    assert.equal(aiBudgetDraftFromPolicy({ ...split, ocrCapSatang: 0 }, '2026-09').ocr, '0');
  });

  it('mirrors the server: SPLIT needs both caps, and C + O <= the SAVED total', () => {
    const saved = { totalSatang: 10000, monthOptions: ['2026-09', '2026-10'] };
    const draft = { mode: 'SPLIT' as const, chat: '30', ocr: '70', effectiveMonthKey: '2026-09' };

    assert.deepEqual(validateAiBudgetDraft(draft, saved), {
      ok: true,
      policy: { mode: 'SPLIT', chatMonthlyBudgetSatang: 3000, ocrMonthlyBudgetSatang: 7000, effectiveMonthKey: '2026-09' },
    });
    // Exactly the total still fits; one satang more does not.
    assert.equal(validateAiBudgetDraft({ ...draft, ocr: '70.01' }, saved).ok, false);
    assert.match((validateAiBudgetDraft({ ...draft, ocr: '80' }, saved) as { notice: string }).notice, /เกินเพดานความปลอดภัยที่บันทึกไว้/);
    // Both caps are required — an empty one is never read as "no cap on that bucket".
    assert.match((validateAiBudgetDraft({ ...draft, ocr: '' }, saved) as { notice: string }).notice, /เพดานอ่านเอกสาร/);
    assert.match((validateAiBudgetDraft({ ...draft, chat: '' }, saved) as { notice: string }).notice, /เพดานแชต/);
    // Only this month or the next.
    assert.equal(validateAiBudgetDraft({ ...draft, effectiveMonthKey: '2026-11' }, saved).ok, false);
    // SHARED clears both caps rather than sending whatever is still typed in the boxes.
    assert.deepEqual(validateAiBudgetDraft({ ...draft, mode: 'SHARED' }, saved), {
      ok: true,
      policy: { mode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null, effectiveMonthKey: '2026-09' },
    });
  });

  it('keeps Save disabled until something actually changes, per target month', () => {
    const current = { mode: 'SPLIT' as const, chat: '30', ocr: '70', effectiveMonthKey: '2026-09' };
    assert.equal(aiBudgetDraftChanged(current, split, '2026-09'), false);
    assert.equal(aiBudgetDraftChanged({ ...current, ocr: '69' }, split, '2026-09'), true);
    assert.equal(aiBudgetDraftChanged({ ...current, mode: 'SHARED' }, split, '2026-09'), true);

    // A draft aimed at NEXT month is compared with the pending policy, exactly as the writer does.
    const scheduled = { ...current, effectiveMonthKey: '2026-10' };
    assert.equal(aiBudgetDraftChanged(scheduled, split, '2026-09'), true);
    const pending = { ...split, pending: { mode: 'SPLIT', chatMonthlyBudgetSatang: 3000, ocrMonthlyBudgetSatang: 7000, effectiveMonthKey: '2026-10' } };
    assert.equal(aiBudgetDraftChanged(scheduled, pending, '2026-09'), false);
    assert.equal(aiBudgetDraftChanged({ ...scheduled, ocr: '69' }, pending, '2026-09'), true);
    // An unparseable draft is not "unchanged": the operator must be able to press Save and hear why.
    assert.equal(aiBudgetDraftChanged({ ...current, ocr: 'x' }, split, '2026-09'), true);
  });

  it('builds the saved money position per scope, with SHARED buckets left unset', () => {
    const position = {
      total: { spentSatang: 4000, reservedSatang: 500, availableSatang: 5500 },
      chat: { spentSatang: 1000, reservedSatang: 0, availableSatang: 2000 },
      ocr: { spentSatang: 3000, reservedSatang: 500, availableSatang: 3500 },
    };
    const rows = aiBudgetScopeRows({ effectiveSatang: 10000, policy: split, position });
    assert.deepEqual(rows.map((row) => row.capSatang), [10000, 3000, 7000]);
    assert.deepEqual(rows.map((row) => row.key), ['total', 'chat', 'ocr']);
    assert.equal(rows[2]!.reservedSatang, 500);

    // Older API data can still carry null; the current API supplies an 80-credit CHAT cap.
    const sharedRows = aiBudgetScopeRows({ effectiveSatang: 10000, policy: shared, position });
    assert.deepEqual(sharedRows.map((row) => row.capSatang), [10000, null, null]);
    assert.deepEqual(aiBudgetScopeRows({ effectiveSatang: 10000,
      policy: { ...shared, chatCapSatang: 8_000 }, position }).map((row) => row.capSatang), [10000, 8_000, null]);
    assert.equal(aiBudgetCapLabel(null), 'ยังไม่ตั้ง');
    assert.match(aiBudgetCapLabel(0), /ปิดส่วนนี้/);
    assert.equal(aiBudgetCapLabel(3000), '฿30.00');
  });

  it('shows money left as a number even at zero, and never as a missing setting', () => {
    // An exhausted bucket has ฿0.00 LEFT. Rendering that through the CAP label read
    // "ปิดส่วนนี้ (0 บาท)", which is a different fact (an admin's cap of 0).
    assert.equal(aiBudgetAvailableLabel(0), '฿0.00');
    assert.equal(aiBudgetAvailableLabel(3000), '฿30.00');
    // A SHARED bucket has no separate cap, so what is left there IS the shared total.
    assert.equal(aiBudgetAvailableLabel(null), 'ตามเพดานความปลอดภัย');
    assert.notEqual(aiBudgetAvailableLabel(null), aiBudgetCapLabel(null));
    assert.notEqual(aiBudgetAvailableLabel(0), aiBudgetCapLabel(0));
  });

  it('drops the panel instead of throwing when a pre-E1a API serves the page', () => {
    const position = { total: {}, chat: {}, ocr: {} };
    assert.equal(hasAiBudgetPolicy({ budget: { policy: { mode: 'SHARED' }, position } }), true);
    // A rolling deploy can serve this card from an API that predates the split policy entirely.
    assert.equal(hasAiBudgetPolicy({ budget: {} }), false);
    assert.equal(hasAiBudgetPolicy({ budget: { policy: { mode: 'SHARED' } } }), false);
    assert.equal(hasAiBudgetPolicy({ budget: { position } }), false);
    assert.equal(hasAiBudgetPolicy({ budget: { policy: null, position } }), false);
    assert.equal(hasAiBudgetPolicy({}), false);
    assert.equal(hasAiBudgetPolicy(null), false);
  });

  it('says what to fix for every invalid policy, and nothing when the policy is fine', () => {
    assert.equal(aiBudgetInvalidNotice(undefined), null);
    for (const reason of ['SPLIT_CAPS_MISSING', 'SPLIT_EXCEEDS_TOTAL', 'POLICY_MALFORMED']) {
      const notice = aiBudgetInvalidNotice(reason)!;
      assert.match(notice, /ปฏิเสธการเรียก AI/);
      assert.match(notice, /บันทึก/);
    }
    // An unknown future reason still tells the operator what to do rather than rendering a code.
    assert.doesNotMatch(aiBudgetInvalidNotice('SOMETHING_NEW')!, /SOMETHING_NEW/);
  });

  it('shows a scheduled policy as "เริ่มเดือน …", apart from what is in force', () => {
    assert.equal(aiBudgetPendingText(null, month), null);
    const scheduled = aiBudgetPendingText(
      { mode: 'SPLIT', chatMonthlyBudgetSatang: 3000, ocrMonthlyBudgetSatang: 0, effectiveMonthKey: '2026-10' }, month)!;
    assert.match(scheduled, /^เริ่มเดือน เดือน 2026-10/);
    assert.match(scheduled, /฿30\.00/);
    assert.match(scheduled, /ปิดส่วนนี้/);
    const reverting = aiBudgetPendingText(
      { mode: 'SHARED', chatMonthlyBudgetSatang: null, ocrMonthlyBudgetSatang: null, effectiveMonthKey: '2026-10' }, month)!;
    assert.match(reverting, /กลับไปไม่แยกเพดาน/);
  });

  it('treats only the two 409 fences as "reload and re-check"', async () => {
    assert.equal(isAiBudgetPolicyConflict('partner_ai_budget_revision_conflict'), true);
    assert.equal(isAiBudgetPolicyConflict('partner_ai_configuration_changed'), true);
    for (const code of ['partner_ai_budget_split_exceeds_total', 'ocr_config_version_conflict', null, undefined]) {
      assert.equal(isAiBudgetPolicyConflict(code), false, String(code));
    }
    let reloads = 0;
    const reload = async () => { reloads += 1; };
    assert.equal(await reloadAfterAiBudgetConflict('partner_ai_budget_revision_conflict', reload), true);
    assert.equal(reloads, 1);
    // A refusal that is not a conflict must NOT silently reload and discard the operator's draft.
    assert.equal(await reloadAfterAiBudgetConflict('partner_ai_budget_split_exceeds_total', reload), false);
    assert.equal(reloads, 1);
  });

  it('keeps the form visible for a manager and hidden for a read-only operator', () => {
    assert.equal(canManageAiBudget({ canManage: true }), true);
    assert.equal(canManageAiBudget({ canManage: false }), false);
    // A pre-D2 API omits the field: keep today's behaviour rather than hiding the form from everyone.
    assert.equal(canManageAiBudget({}), true);
    assert.equal(canManageAiBudget(null), true);
  });

  it('labels the two modes and the reserved column in Thai', () => {
    assert.equal(AI_BUDGET_MODE_LABELS.SHARED, 'ไม่แยกเพดาน');
    assert.equal(AI_BUDGET_MODE_LABELS.SPLIT, 'แยกเพดานแชตและอ่านเอกสาร');
    // Reserved money is not spend and adds no provider call; the label has to say so.
    assert.equal(AI_BUDGET_RESERVED_NOTE, 'กันไว้ระหว่างเรียก AI');
    assert.match(AI_BUDGET_STALE_MESSAGE, /โหลดค่าล่าสุด/);
  });
});

describe('held credit that needs an operator decision (hold spec §4.1–4.2)', () => {
  const hold = (over: Partial<{ upperBoundSatang: number; settledCostSatang: number | null; stepKind: string }> = {}) => ({
    upperBoundSatang: 4_700, settledCostSatang: null as number | null, stepKind: 'receipt-ocr', ...over,
  });

  it('labels every declared step kind in Thai, and falls back to the id for an unknown one', () => {
    // The table is the contract: a step kind that can be reserved must be readable in the console.
    for (const stepKind of Object.keys(AI_BUDGET_STEP_BOUNDS)) {
      const label = aiCreditHoldStepLabel(stepKind);
      assert.notEqual(label, stepKind, `${stepKind} has no Thai label`);
      assert.equal(/[a-z]-/.test(label), false, `${label} still reads like an id`);
    }
    assert.equal(aiCreditHoldStepLabel('something-new'), 'something-new');
  });

  it('says what the row is waiting for', () => {
    assert.equal(aiCreditHoldKindLabel('UNRESOLVED_HOLD'), 'ยังไม่ทราบผล');
    assert.equal(aiCreditHoldKindLabel('BREACH'), 'ใช้เกินที่กันไว้');
    assert.equal(aiCreditHoldKindLabel('WHAT'), 'WHAT');
  });

  it('ages a hold in the coarsest unit that is still true, rounded DOWN', () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    assert.equal(aiCreditHoldAgeLabel(ago(30_000), now), 'เมื่อสักครู่');
    assert.equal(aiCreditHoldAgeLabel(ago(90_000), now), '1 นาที');
    assert.equal(aiCreditHoldAgeLabel(ago(59 * 60_000), now), '59 นาที');
    assert.equal(aiCreditHoldAgeLabel(ago(60 * 60_000), now), '1 ชั่วโมง');
    assert.equal(aiCreditHoldAgeLabel(ago(23.9 * 60 * 60_000), now), '23 ชั่วโมง');
    assert.equal(aiCreditHoldAgeLabel(ago(50 * 60 * 60_000), now), '2 วัน');
    // A clock skew must never print a negative age, and a broken date must not print NaN.
    assert.equal(aiCreditHoldAgeLabel(new Date(now.getTime() + 60_000).toISOString(), now), 'เมื่อสักครู่');
    assert.equal(aiCreditHoldAgeLabel('not-a-date', now), 'เมื่อสักครู่');
  });

  it('spells out the money consequence of a RELEASE before the operator commits', () => {
    const text = aiCreditHoldConsequence('release', hold(), 'ไม่ได้เรียกจริง');
    assert.equal(text.confirmLabel, AI_CREDIT_HOLD_ACTION_LABELS.release);
    assert.match(text.message, /฿47\.00/);
    assert.match(text.message, /กลับมาให้ร้านใช้ได้ทันที/);
    assert.match(text.message, /ไม่มีการบันทึกค่าใช้จ่าย/);
    // The safety net the help line promises has to be in the dialog too.
    assert.match(text.message, new RegExp(AI_CREDIT_HOLD_HELP_NOTE));
    assert.match(text.message, /เหตุผล: ไม่ได้เรียกจริง/);
    assert.match(text.message, /อ่านใบเสร็จ/);
  });

  it('spells out the money consequence of a CHARGE, including that it is not a model call', () => {
    const text = aiCreditHoldConsequence('charge_at_bound', hold(), 'ผลไม่กลับมา');
    assert.equal(text.confirmLabel, AI_CREDIT_HOLD_ACTION_LABELS.charge_at_bound);
    assert.match(text.message, /บันทึก ฿47\.00 เป็นค่าใช้จ่ายจริงของเดือนนี้/);
    assert.match(text.message, /ไม่นับเป็นจำนวนครั้งที่เรียกโมเดล/);
    assert.match(text.message, /เหตุผล: ผลไม่กลับมา/);
  });

  it('says an ACKNOWLEDGEMENT clears only the alert and moves no money', () => {
    const text = aiCreditHoldConsequence('acknowledge_breach', hold({ settledCostSatang: 6_000 }), 'ตรวจแล้ว');
    assert.equal(text.confirmLabel, AI_CREDIT_HOLD_ACTION_LABELS.acknowledge_breach);
    assert.match(text.message, /ใช้จริง ฿60\.00 จากที่กันไว้ ฿47\.00/);
    assert.match(text.message, /ปิดการแจ้งเตือน/);
    assert.doesNotMatch(text.message, /เปิดรับงาน|หยุดรับงาน/);
    assert.match(text.message, /ไม่มีการคืนเครดิต/);
    // A breach row with no settled figure still reads as money, never as an empty string.
    assert.match(aiCreditHoldConsequence('acknowledge_breach', hold(), 'r').message, /ใช้จริง ฿47\.00/);
  });

  it('treats the three hold refusals as "your list is stale", and nothing else', () => {
    for (const code of ['partner_ai_credit_hold_already_resolved',
      'partner_ai_credit_breach_already_acknowledged', 'partner_ai_credit_hold_not_found']) {
      assert.equal(isAiCreditHoldConflict(code), true, code);
    }
    // A failed action changed nothing, so the list is NOT stale — the operator may simply retry.
    assert.equal(isAiCreditHoldConflict('partner_ai_credit_hold_action_failed'), false);
    assert.equal(isAiCreditHoldConflict(null), false);
  });

  it('labels the operator basis in the D1 breakdown without calling it a measurement', () => {
    const label = AI_USAGE_BASIS_LABELS['OPERATOR_CHARGED_AT_BOUND']!;
    assert.match(label, /operator/);
    assert.match(label, /ยอดที่กันไว้/);
    assert.notEqual(label, AI_USAGE_BASIS_LABELS['PROVIDER_REPORTED']);
  });

  it('keeps the empty state and the help line to one line each', () => {
    assert.equal(AI_CREDIT_HOLD_EMPTY_NOTE, 'ไม่มีรายการค้าง');
    assert.equal(AI_CREDIT_HOLD_HELP_NOTE.includes('\n'), false);
    assert.match(AI_CREDIT_HOLD_HELP_NOTE, /ระบบจะบันทึกยอดจริงเพิ่มเอง/);
  });
});

// ── Admin tab rework 2026-09-29: chat credit, receipt images, safety ceiling ─────────────────────

const date = (iso: string) => `วันที่ ${iso.slice(0, 10)}`;
const images = (over: Partial<PartnerReceiptImagesDto> = {}): PartnerReceiptImagesDto => ({
  basis: 'PACKAGE_LOTS', tierKey: 'BASIC_499', enforced: true, active: true,
  package: { limit: 50, used: 20, remaining: 30, expiresAt: '2026-10-29T08:10:55.000Z' },
  additional: { remaining: 0, expiresAt: null }, totalRemaining: 30, ...over,
});
/** A SHARED BASIC shop with the default 80 credit, 12.34 used, and a ฿2,000 platform ceiling. */
function usageFixture(over: { budget?: Partial<PartnerAiUsageDto['budget']>; policy?: Partial<PartnerAiUsageDto['budget']['policy']>;
  chat?: Partial<PartnerAiUsageDto['budget']['position']['chat']>; ocrConfig?: Partial<PartnerAiUsageDto['ocr']['config']>;
  usedCount?: number; receiptImages?: PartnerReceiptImagesDto | undefined; totalSpent?: number } = {}): PartnerAiUsageDto {
  const policy = { mode: 'SHARED' as const, chatCapSatang: 8_000, ocrCapSatang: null, source: 'ACTIVE' as const, revision: '0:2026-09:ACTIVE',
    pending: null, chatSource: 'DEFAULT' as const, ...over.policy };
  return {
    current: null, previous: null,
    budget: { effectiveSatang: 200_000, overrideSatang: null, defaultSatang: 200_000, ceilingSatang: 1_000_000, policy,
      position: {
        total: { spentSatang: over.totalSpent ?? 1_234, reservedSatang: 0, availableSatang: 200_000 - (over.totalSpent ?? 1_234) },
        chat: { spentSatang: 1_234, reservedSatang: 0, availableSatang: 6_766, ...over.chat },
        ocr: { spentSatang: 0, reservedSatang: 0, availableSatang: null }, unresolvedHolds: 0, breach: false,
      },
      chatCredit: { deal: null, cutoverAt: null }, ...over.budget },
    topTags: [], otherTags: { tags: 0, costSatang: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, cacheCostSatang: null },
    breakdown: undefined as never,
    ocr: { config: { enabled: true, monthlyLimit: null, version: 0, updatedAt: null, ...over.ocrConfig },
      planQuota: { enforced: true, source: 'PAID_GRANTS', defaultEnforced: true },
      receiptImages: 'receiptImages' in over ? over.receiptImages : images(),
      current: { monthKey: '2026-09', usedCount: over.usedCount ?? 20, uploadedReceiptDocumentCount: 0, sourceCounts: [] },
      previous: { monthKey: '2026-08', usedCount: 0, uploadedReceiptDocumentCount: 0, sourceCounts: [] } },
  };
}
const row = (rows: ReturnType<typeof aiTabStatusRows>, key: string) => rows.find((item) => item.key === key);

describe('admin tab rework: chat credit, receipt images and the safety ceiling', () => {
  it('writes money in a sentence without a trailing .00', () => {
    assert.equal(bahtText(8_000), '80 บาท');
    assert.equal(bahtText(200_000), '2,000 บาท');
    assert.equal(bahtText(1_234), '12.34 บาท');
  });

  it('names where the chat credit comes from, in plain Thai', () => {
    assert.equal(aiChatCreditSourceText(usageFixture(), date), 'ค่าเริ่มต้น 50 บาท');
    assert.equal(aiChatCreditSourceText(usageFixture({ policy: { chatSource: 'ADMIN', chatCapSatang: 15_000 } }), date), 'ผู้ดูแลตั้งให้ร้านนี้ 150 บาท');
    assert.equal(aiChatCreditSourceText(usageFixture({ policy: { chatSource: 'SALES_DEAL', chatCapSatang: 30_000 },
      budget: { chatCredit: { deal: { satang: 30_000, endsAt: '2026-10-29T00:00:00.000Z' }, cutoverAt: null } } }), date), 'ดีลขาย 300 บาท ถึง วันที่ 2026-10-29');
    assert.equal(aiChatCreditSourceText(usageFixture({ policy: { chatSource: 'SALES_DEAL', chatCapSatang: 30_000 },
      budget: { chatCredit: { deal: { satang: 30_000, endsAt: null }, cutoverAt: null } } }), date), 'ดีลขาย 300 บาท ตลอดที่ดีลยังต่ออายุ');
    assert.match(aiChatCreditSourceText(usageFixture({ policy: { mode: 'SPLIT', chatSource: 'SPLIT', chatCapSatang: 3_000 } }), date), /^แยกเพดานแชต 30 บาท/);
    assert.match(aiChatCreditSourceText(usageFixture({ budget: { chatCredit: { deal: null, cutoverAt: '2026-09-01T00:00:00.000Z' } } }), date,
      Date.parse('2026-09-15T00:00:00.000Z')), /^รอบเครดิต AI ของแพ็กเกจ/);
  });

  it('names where the receipt images come from, per kind of shop', () => {
    assert.equal(receiptImagesSourceText(images({ tierKey: 'STARTER_249', package: { limit: 30, used: 0, remaining: 30, expiresAt: '2026-10-29T08:10:55.000Z' } }), date),
      'แพ็กเกจ เริ่มต้น (STARTER) 30 รูป หมดอายุ วันที่ 2026-10-29');
    assert.equal(receiptImagesSourceText(images({ basis: 'MONTHLY', tierKey: 'FREE_TRIAL_15', package: { limit: 15, used: 3, remaining: 12, expiresAt: null } }), date),
      'ช่วงทดลอง 15 รูปต่อเดือน');
    assert.equal(receiptImagesSourceText(images({ basis: 'MONTHLY', enforced: false, package: { limit: 100, used: 3, remaining: 97, expiresAt: null } }), date),
      'แพ็กเกจที่ทีมงานตั้งให้ (เติบโต (BASIC)) 100 รูปต่อเดือน — นับอย่างเดียว ไม่หยุดอ่านเมื่อครบ');
    assert.match(receiptImagesSourceText(images({ basis: 'NONE', tierKey: null, package: null, totalRemaining: null }), date), /^ยังไม่มีแพ็กเกจ/);
  });

  it('lists which rule is in force: all fine for a normal paid shop', () => {
    const rows = aiTabStatusRows(usageFixture(), date);
    assert.deepEqual(rows.map((item) => item.key), ['chat-source', 'chat-balance', 'images-source', 'images-balance', 'ocr-limit', 'ocr-enabled', 'safety']);
    assert.ok(rows.every((item) => item.tone === 'ok'), JSON.stringify(rows));
    assert.equal(row(rows, 'chat-balance')?.value, 'ใช้ 12.34 บาท เหลือ 67.66 บาท');
    assert.equal(row(rows, 'images-balance')?.value, 'เหลือ 30 รูป (จากแพ็กเกจ 30)');
    assert.equal(row(rows, 'ocr-limit')?.value, 'ไม่ได้ตั้ง', 'an unset OCR limit is "not set", never "unlimited"');
    assert.equal(row(rows, 'safety')?.value, 'ค่ากลางของระบบ 2,000 บาท (ใช้ไป 12.34 บาท)');
    assert.ok(rows.every((item) => !/ไม่จำกัด/.test(item.value)));
  });

  it('flags a stale OCR limit that stops a paid shop before its package runs out', () => {
    const warn = row(aiTabStatusRows(usageFixture({ ocrConfig: { monthlyLimit: 30 }, usedCount: 20 }), date), 'ocr-limit');
    assert.equal(warn?.tone, 'warn');
    assert.match(warn!.value, /ต่ำกว่ารูปที่ร้านยังเหลือ/);
    const stop = row(aiTabStatusRows(usageFixture({ ocrConfig: { monthlyLimit: 30 }, usedCount: 30 }), date), 'ocr-limit');
    assert.equal(stop?.tone, 'stop');
    assert.match(stop!.value, /แม้แพ็กเกจยังมีรูปเหลือ/);
  });

  it('says what is stopped now: chat used up, images used up, OCR off, ceiling reached, policy unreadable', () => {
    const rows = aiTabStatusRows(usageFixture({ chat: { spentSatang: 8_000, availableSatang: 0 }, ocrConfig: { enabled: false }, totalSpent: 200_000,
      receiptImages: images({ package: { limit: 30, used: 30, remaining: 0, expiresAt: null }, totalRemaining: 0 }),
      policy: { invalidReason: 'POLICY_MALFORMED' } }), date);
    for (const key of ['policy', 'chat-balance', 'images-balance', 'ocr-enabled', 'safety']) assert.equal(row(rows, key)?.tone, 'stop', key);
    assert.match(row(rows, 'images-balance')!.value, /จนกว่าจะต่อแพ็กเกจหรือเพิ่มยอด/);
    const inactive = row(aiTabStatusRows(usageFixture({ receiptImages: images({ active: false }) }), date), 'images-source');
    assert.equal(inactive?.tone, 'stop');
  });

  it('warns when a monthly allowance only counts, and when the ceiling is below the chat credit', () => {
    const rows = aiTabStatusRows(usageFixture({ receiptImages: images({ basis: 'MONTHLY', enforced: false, tierKey: 'FREE_TRIAL_15',
      package: { limit: 15, used: 18, remaining: 0, expiresAt: null }, totalRemaining: 0 }),
    budget: { effectiveSatang: 5_000, overrideSatang: 5_000 } }), date);
    assert.equal(row(rows, 'images-source')?.tone, 'warn');
    assert.equal(row(rows, 'images-balance')?.tone, 'warn');
    assert.equal(row(rows, 'safety')?.tone, 'warn');
    assert.match(row(rows, 'safety')!.value, /^ตั้งเฉพาะร้านนี้ 50 บาท/);
    // No package term: nothing about an image balance is claimed at all.
    const none = aiTabStatusRows(usageFixture({ receiptImages: images({ basis: 'NONE', tierKey: null, package: null, totalRemaining: null }) }), date);
    assert.equal(row(none, 'images-balance'), undefined);
  });

  it('edits the chat credit as its own value: empty = default or deal, 0 closes chat', () => {
    assert.deepEqual(parseChatCreditInput(''), { ok: true, satang: null });
    assert.deepEqual(parseChatCreditInput(' 150.5 '), { ok: true, satang: 15_050 });
    assert.deepEqual(parseChatCreditInput('0'), { ok: true, satang: 0 });
    assert.equal(parseChatCreditInput('1e').ok, false);
    assert.equal(parseChatCreditInput('150.555').ok, false);
    assert.equal(chatCreditInputFromUsage(usageFixture()), '', 'the default is not an admin setting to prefill');
    const admin = usageFixture({ policy: { chatSource: 'ADMIN', chatCapSatang: 15_000 } });
    assert.equal(chatCreditInputFromUsage(admin), '150');
    assert.equal(chatCreditDraftChanged(admin, '150'), false);
    assert.equal(chatCreditDraftChanged(admin, ''), true);
    assert.equal(chatCreditDraftChanged(usageFixture(), ''), false);
    assert.equal(chatCreditDraftChanged(usageFixture(), 'x'), true, 'an unparsable draft lets the operator press Save and hear why');
    assert.deepEqual(chatCreditPolicyRequest(15_000, '2026-09'),
      { mode: 'SHARED', chatMonthlyBudgetSatang: 15_000, ocrMonthlyBudgetSatang: null, effectiveMonthKey: '2026-09' });
  });

  it('confirms a chat credit and a ceiling change with what happens, and never ties the two', () => {
    const chat = chatCreditConfirmMessage(usageFixture(), 1_000, 'ทดสอบ', date);
    assert.match(chat, /ค่าเริ่มต้น 50 บาท → ผู้ดูแลตั้งให้ร้านนี้ 10 บาท/);
    assert.match(chat, /หลังบันทึกแชต AI จะหยุดจนขึ้นเดือนใหม่/);
    assert.match(chatCreditConfirmMessage(usageFixture(), 500_000, 'ทดสอบ', date), /สูงกว่าเพดานความปลอดภัย 2,000 บาท/);
    const ceiling = safetyCeilingConfirmMessage(usageFixture(), 500_000, 'ทดสอบ');
    assert.match(ceiling, /2,000 บาท → 5,000 บาท/);
    assert.match(ceiling, /เครดิตแชตของร้านไม่เปลี่ยน/);
  });

  it('shows the trial/staff-set enforcement choice only where it does something', () => {
    assert.equal(receiptQuotaControlVisible({ receiptImages: images() }), false, 'a paid package always enforces');
    assert.equal(receiptQuotaControlVisible({ receiptImages: images({ basis: 'MONTHLY' }) }), true);
    assert.equal(receiptQuotaControlVisible({ receiptImages: images({ basis: 'NONE' }) }), false, 'no allowance, nothing to enforce');
    assert.equal(receiptQuotaControlVisible({ planQuota: { enforced: true, source: 'PAID_GRANTS', defaultEnforced: true } }), false);
    assert.equal(receiptQuotaControlVisible({ planQuota: { enforced: false, source: 'DEFAULT', defaultEnforced: false } }), true);
  });

  it('shows images from the package, added, and in total — counts, never money', () => {
    const tiles = receiptImageTiles(images({ additional: { remaining: 5, expiresAt: '2027-09-29T00:00:00.000Z' }, totalRemaining: 35 }), date);
    assert.deepEqual(tiles.map((tile) => [tile.key, tile.value]), [['package', '30 รูป จาก 50'], ['additional', '5 รูป'], ['total', '35 รูป']]);
    assert.match(tiles[0]!.note, /หมดอายุ วันที่ 2026-10-29/);
    assert.deepEqual(receiptImageTiles(images({ basis: 'NONE', package: null, totalRemaining: null }), date), []);
  });
});


it('labels company-absorbed model cost separately from shop credit', () => {
  assert.match(AI_USAGE_BASIS_LABELS['COMPANY_ABSORBED']!, /บริษัทแบก/);
  assert.equal(aiUsageBasisNote([{ usageBasis: 'COMPANY_ABSORBED', costSatang: 123, calls: 2 }]),
    'บริษัทแบก ฿1.23 จาก 2 ครั้ง ไม่หักเครดิตร้านค่ะ');
});

 it('owner credit X1: an overrun is an operator warning, never a stopped-work status', () => {
  const usage = usageFixture();
  usage.budget.position.breach = true;
  const alert = aiTabStatusRows(usage, value => value).find(row => row.key === 'breach');
  assert.equal(alert?.tone, 'warn');
  assert.doesNotMatch(alert?.value ?? '', /หยุดรับงาน|เปิดรับงาน/);
 });
