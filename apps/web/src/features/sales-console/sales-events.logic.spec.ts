import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SALES_ERROR_CODES, type SalesEventBatchView } from '@watchdog-bms/contracts';
import { translateApiError } from '@/common/api/api-error-message';
import {
  actionNeedsReason, bangkokInputValue, batchActions, batchRewardLines, batchScopeText, batchStatusMeta, countdownText,
  discountTooHighMessage, emptyEventBatchForm, eventBatchFormFromView, eventBatchInputFromForm, firstEventBatchErrorField,
  isoFromBangkokInput, qrSecondsLeft, ticketStatusMeta, ticketUsableUntil, toggleValue, validateEventBatchForm,
  type SalesEventBatchFormValues,
} from './sales-events.logic';

const NOW = new Date('2026-10-01T02:00:00.000Z'); // 09:00 Bangkok

function form(overrides: Partial<SalesEventBatchFormValues> = {}): SalesEventBatchFormValues {
  return {
    ...emptyEventBatchForm(NOW), eventName: 'งานแฟร์ร้านค้า', batchName: 'บูธ A', discountBaht: '100', issueCap: '50',
    agentUserIds: ['agent-1'], ...overrides,
  };
}

function view(overrides: Partial<SalesEventBatchView> = {}): SalesEventBatchView {
  return {
    id: 'batch-1', eventName: 'งานแฟร์ร้านค้า', batchName: 'บูธ A', discountSatang: 10000,
    rewardChatCreditUnits: 5000, rewardReceiptImageUnits: 20, issueCap: 50, issuedCount: 12,
    claimStartsAt: '2026-10-01T02:00:00.000Z', claimEndsAt: '2026-10-03T11:00:00.000Z',
    scope: { tiers: ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'], intervals: ['month', 'year'] },
    state: 'OPEN', claimOpen: true, revision: 2, version: 5, createdByUserId: 'lead-1', createdByDisplayName: 'หัวหน้า',
    agents: [{ userId: 'agent-1', displayName: 'เซลล์หนึ่ง', active: true }, { userId: 'agent-2', displayName: 'เซลล์สอง', active: false }],
    isDistributor: false, canManage: true,
    counts: { issued: 12, available: 8, inPayment: 1, usedAsDiscount: 2, usedAsCredit: 1, expired: 0, revoked: 0 },
    createdAt: '2026-09-30T02:00:00.000Z', updatedAt: '2026-09-30T02:00:00.000Z', ...overrides,
  };
}

describe('Thai time boxes (spec §3.1)', () => {
  it('shows an instant as Bangkok time and reads a Bangkok box back as +07:00', () => {
    assert.equal(bangkokInputValue('2026-10-01T02:00:00.000Z'), '2026-10-01T09:00');
    assert.equal(isoFromBangkokInput('2026-10-01T09:00'), '2026-10-01T02:00:00.000Z');
    assert.equal(isoFromBangkokInput('2026-10-01T09:00:30'), '2026-10-01T02:00:30.000Z');
    assert.equal(isoFromBangkokInput('1 ต.ค.'), null);
    assert.equal(isoFromBangkokInput(''), null);
  });

  it('opens a new form now for one day, every package and cycle ticked', () => {
    const empty = emptyEventBatchForm(NOW);
    assert.equal(empty.claimStartsAt, '2026-10-01T09:00');
    assert.equal(empty.claimEndsAt, '2026-10-02T09:00');
    assert.deepEqual(empty.tiers, ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999']);
    assert.deepEqual(empty.intervals, ['month', 'year']);
  });
});

describe('batch form', () => {
  it('accepts a complete form and sends satang, UTC instants and the chosen scope in catalog order', () => {
    const values = form({ tiers: ['PRO_999', 'STARTER_249'], intervals: ['year'] });
    assert.deepEqual(validateEventBatchForm(values, { now: NOW }), {});
    const input = eventBatchInputFromForm(values);
    assert.equal(input.discountSatang, 10000);
    assert.equal(input.issueCap, 50);
    assert.equal(input.claimStartsAt, '2026-10-01T02:00:00.000Z');
    assert.deepEqual(input.scope, { tiers: ['STARTER_249', 'PRO_999'], intervals: ['year'] });
    assert.equal(input.rewardChatCreditUnits, 0);
  });

  it('takes whole baht only and needs a discount while the credit inputs are not on the form', () => {
    assert.ok(validateEventBatchForm(form({ discountBaht: '99.50' }), { now: NOW }).discountBaht);
    assert.ok(validateEventBatchForm(form({ discountBaht: '0' }), { now: NOW }).discountBaht);
    // A batch that already carries credit (set up before, or by SD-F) may drop its discount to zero.
    assert.equal(validateEventBatchForm(form({ discountBaht: '0', rewardReceiptImageUnits: 20 }), { now: NOW }).discountBaht, undefined);
  });

  it('keeps names, cap, window, scope and sellers honest, and points at the first bad box', () => {
    const errors = validateEventBatchForm(form({
      eventName: ' ', issueCap: '0', claimEndsAt: '2026-10-01T08:00', tiers: [], agentUserIds: [],
    }), { now: NOW });
    assert.deepEqual(Object.keys(errors).sort(), ['agentUserIds', 'claimEndsAt', 'eventName', 'issueCap', 'tiers']);
    assert.equal(firstEventBatchErrorField(errors), 'eventName');
    assert.ok(validateEventBatchForm(form({ claimEndsAt: '2026-10-01T08:59', claimStartsAt: '2026-09-30T09:00' }), { now: NOW }).claimEndsAt,
      'a closing time already past is refused');
  });

  it('on an edit, keeps the cap at or above what went out and lets a closed batch keep its end', () => {
    const stored = view({ claimEndsAt: '2026-09-30T11:00:00.000Z', claimStartsAt: '2026-09-29T02:00:00.000Z' });
    const values = eventBatchFormFromView(stored);
    assert.deepEqual(values.agentUserIds, ['agent-1'], 'a seller already taken off is not ticked again');
    assert.equal(values.discountBaht, '100');
    assert.equal(values.rewardChatCreditUnits, 5000, 'credit is carried through untouched');
    assert.deepEqual(validateEventBatchForm(values, { now: NOW, issuedCount: 12, storedClaimEndsAt: stored.claimEndsAt }), {});
    assert.ok(validateEventBatchForm({ ...values, issueCap: '11' }, { now: NOW, issuedCount: 12, storedClaimEndsAt: stored.claimEndsAt }).issueCap);
  });

  it('toggles a value without duplicating it', () => {
    assert.deepEqual(toggleValue(['a'], 'a', true), ['a']);
    assert.deepEqual(toggleValue(['a'], 'b', true), ['a', 'b']);
    assert.deepEqual(toggleValue(['a', 'b'], 'a', false), ['b']);
  });
});

describe('words on screen (spec §8)', () => {
  it('reads an OPEN batch by the clock, and every state in Thai', () => {
    assert.equal(batchStatusMeta(view(), NOW).label, 'เปิดแจก');
    assert.equal(batchStatusMeta(view({ claimStartsAt: '2026-10-02T02:00:00.000Z' }), NOW).label, 'ยังไม่ถึงเวลาเปิดรับ');
    assert.equal(batchStatusMeta(view({ claimEndsAt: '2026-10-01T02:00:00.000Z' }), NOW).label, 'ปิดรับแล้ว');
    assert.equal(batchStatusMeta(view({ state: 'PAUSED' }), NOW).label, 'พักแจก');
    assert.equal(batchStatusMeta(view({ state: 'SUSPENDED' }), NOW).label, 'ระงับการใช้');
  });

  it('offers exactly the commands a state allows, with a reason for suspend and lift', () => {
    assert.deepEqual(batchActions('OPEN'), ['PAUSE', 'SUSPEND']);
    assert.deepEqual(batchActions('PAUSED'), ['RESUME', 'SUSPEND']);
    assert.deepEqual(batchActions('SUSPENDED'), ['LIFT']);
    assert.equal(actionNeedsReason('SUSPEND'), true);
    assert.equal(actionNeedsReason('LIFT'), true);
    assert.equal(actionNeedsReason('PAUSE'), false);
  });

  it('says what the batch gives in the LIFF page wording, only the parts above zero', () => {
    assert.deepEqual(batchRewardLines(view()), [
      'ร้านใหม่: ลด 100 บาทจากบิลแรกเมื่อซื้อแพ็กเกจ',
      'ร้านที่มีแพ็กเกจอยู่แล้ว: รับเครดิต AI 50 เครดิต และจำนวนอ่านรูปใบเสร็จ 20 รูป',
    ]);
    assert.deepEqual(batchRewardLines(view({ rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0 })), ['ร้านใหม่: ลด 100 บาทจากบิลแรกเมื่อซื้อแพ็กเกจ']);
    assert.equal(batchScopeText(view().scope), 'ทุกแพ็กเกจ · รายเดือนและรายปี');
    assert.equal(batchScopeText({ tiers: ['PRO_999'], intervals: ['year'] }), 'มืออาชีพ (PRO) · รายปี');
  });

  it('names each ticket state, splitting a discount from a credit', () => {
    assert.equal(ticketStatusMeta({ state: 'AVAILABLE', redeemedAs: null }).label, 'ยังไม่ได้ใช้');
    assert.equal(ticketStatusMeta({ state: 'IN_PAYMENT', redeemedAs: 'DISCOUNT' }).label, 'กำลังชำระ');
    assert.equal(ticketStatusMeta({ state: 'USED', redeemedAs: 'DISCOUNT' }).label, 'ใช้เป็นส่วนลดแล้ว');
    assert.equal(ticketStatusMeta({ state: 'USED', redeemedAs: 'CREDIT' }).label, 'ใช้เป็นเครดิตแล้ว');
    assert.equal(ticketStatusMeta({ state: 'EXPIRED', redeemedAs: null }).label, 'หมดอายุ');
    assert.equal(ticketStatusMeta({ state: 'REVOKED', redeemedAs: null }).label, 'เพิกถอนแล้ว');
  });

  it('dates a ticket to the claim end plus 30 days and counts the QR down', () => {
    assert.equal(ticketUsableUntil('2026-10-03T11:00:00.000Z').toISOString(), '2026-11-02T11:00:00.000Z');
    assert.equal(qrSecondsLeft('2026-10-01T02:05:00.000Z', NOW), 300);
    assert.equal(qrSecondsLeft('2026-10-01T01:59:00.000Z', NOW), 0);
    assert.equal(countdownText(300), '5:00');
    assert.equal(countdownText(9), '0:09');
  });

  it('names the package a too-large discount trips on, and leaves other errors to the shared map', () => {
    const tooHigh = { code: 'SALES_EVENT_DISCOUNT_TOO_HIGH', details: { code: 'SALES_EVENT_DISCOUNT_TOO_HIGH', offerKey: 'STARTER_249', interval: 'month' } };
    assert.match(discountTooHighMessage(tooHigh)!, /^ส่วนลดสูงเกินราคาของ เริ่มต้น \(STARTER\) · รายเดือน/);
    assert.equal(discountTooHighMessage({ code: 'SALES_EVENT_DISCOUNT_TOO_HIGH', details: { offerKey: 'X', interval: 'month' } }), null);
    assert.equal(discountTooHighMessage({ code: 'SALES_EVENT_BATCH_STALE' }), null);
  });

  it('gives every sales-event error code Thai text', () => {
    for (const code of SALES_ERROR_CODES.filter((item) => item.startsWith('SALES_EVENT_'))) {
      const text = translateApiError(code);
      assert.ok(text && /[ก-๙]/.test(text), `${code} has no Thai text`);
    }
  });
});

describe('console screens (source guards)', () => {
  const source = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it('never says ตั๋ว and never shows a raw state key', () => {
    for (const file of ['SalesEventsPage.tsx', 'SalesEventBatchPage.tsx', 'SalesEventBatchForm.tsx', 'sales-events.logic.ts']) {
      assert.doesNotMatch(source(file), /ตั๋ว/, file);
      // State keys only ever go through a label map; a JSX text node holding one is a leak.
      assert.doesNotMatch(source(file), />\s*\{?[^<]*\b(?:batch|ticket)\.state\}\s*</, file);
      // Nor an id, a version counter or an action key (owner rule: no machine tokens on screen).
      // (`key={batch.id}` and `${batch.id}` in a URL are attributes, not text: the lookbehind skips them.)
      assert.doesNotMatch(source(file), /(?<![=$])\{(?:batch|ticket|agent)\.(?:id|userId|version|revision|salesUserId|createdByUserId)\}/, file);
      assert.doesNotMatch(source(file), /(?<![=$])\{(?:action|decision)\}/, file);
    }
  });

  it('shows the QR only to an active distributor, and manage commands only when the API says so', () => {
    const page = source('SalesEventBatchPage.tsx');
    assert.match(page, /\{batch\.isDistributor && <QrPanel/);
    assert.match(page, /\{batch\.canManage && !editing && \(/);
    assert.match(page, /canRevoke=\{batch\.canManage\}/);
  });

  it('fences every command with the version it read', () => {
    assert.match(source('SalesEventBatchPage.tsx'), /expectedVersion: batch\.version/);
    assert.match(source('SalesEventBatchPage.tsx'), /expectedVersion: revoking\.version/);
    assert.match(source('SalesEventBatchForm.tsx'), /expectedVersion: batch\.version/);
  });
});
