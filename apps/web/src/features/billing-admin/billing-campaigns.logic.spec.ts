import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BILLING_PROMOTION_STARTER_TEMPLATE, type BillingConfigurationOperation, type BillingPromotionCampaign, type BillingPromotionCampaignAction, type BillingPromotionCampaignStatus,
  type BillingPromotionCampaignView, type BillingPromotionDraftError, type BillingPromotionPreviewRow, type BillingPromotionReportCompany } from '@watchdog-bms/contracts';
import {
  bahtText, blockerText, campaignButtons, campaignDraftInput, campaignError, campaignFormFromTerms, campaignFormProblems, campaignLoadFailure,
  campaignModeMarker, campaignOfferOptions, campaignRequest, campaignStatusMeta, campaignTitle, campaignUsageText, campaignWindowText, CAMPAIGN_CLOSE_COPY,
  CAMPAIGN_ERROR_TEXT, CAMPAIGN_OPERATION_STEP_TEXT, CAMPAIGN_SAVED_NOTICE, CAMPAIGN_STATUS_META, CAMPAIGN_STATUSES, countText, DETAIL_NEEDS, DRAFT_STALE_TEXT, draftErrorsByField, draftErrorText, draftLockedText,
  emptyCampaignForm, filterCampaigns, isRequestOpen, LIST_NEEDS, NO_CAMPAIGN_FILTERS, operationStateText, operationSteps, pendingCheckoutsText, permissionNote, previewBlockedText, previewRowView,
  publishedTermsCopy, reportCountItems, reportMoneyView, reportRowView, requestKey, resumeBlockedText, reuseIntent, safeAdminHref, templateRuleSummary, termsFacts, type CampaignFormValues,
} from './billing-campaigns.logic';

/** Text an Admin reads must never carry an enum key, a code, an id or a hash. */
const MACHINE_TOKEN = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[0-9a-f]{8}-[0-9a-f]{4}-|\b[0-9a-f]{32,}\b|\b(?:internalName|displayName|startsAt|endsAt|campaignId)\b/;

const STATUSES: BillingPromotionCampaignStatus[] = ['DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'CATALOG_STALE'];
const ACTIONS: BillingPromotionCampaignAction[] = ['EDIT', 'DISCARD_DRAFT', 'PREVIEW', 'SUBMIT', 'APPROVE', 'CANCEL', 'PAUSE', 'RESUME', 'END'];

const published: BillingPromotionCampaign = {
  campaignId: 'cmp-1', type: 'BONUS_MONTHS', revision: 1, internalName: 'โปรแถมเดือน ต.ค.', description: null, displayName: 'ซื้อ Starter แถม 1 เดือน',
  rules: [
    { offerKey: 'STARTER_249', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30, offerSignature: 'a'.repeat(64) },
    { offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30, offerSignature: 'b'.repeat(64) },
  ],
  startsAt: '2026-10-12T02:00:00.000Z', endsAt: '2026-10-31T17:00:00.000Z', cap: 100, paused: false, endedAt: null,
};
function view(overrides: Partial<BillingPromotionCampaignView> = {}): BillingPromotionCampaignView {
  return { campaignId: 'cmp-1', status: 'ACTIVE', published, draft: null, pendingOperationId: null, usage: { reserved: 2, consumed: 10, taken: 12, cap: 100 },
    allowedActions: ['EDIT', 'PAUSE', 'END'], pendingCheckouts: 2, ...overrides };
}
function form(overrides: Partial<CampaignFormValues> = {}): CampaignFormValues {
  return { ...emptyCampaignForm(), internalName: ' โปรแถมเดือน ต.ค. ', description: '', displayName: 'ซื้อ Starter แถม 1 เดือน',
    startsAt: '2026-10-12T09:00', endsAt: '2026-11-01T00:00', capChoice: 'LIMITED', cap: '100', reason: ' เปิดแคมเปญเดือนตุลาคม ', ...overrides };
}
function row(overrides: Partial<BillingPromotionPreviewRow> = {}): BillingPromotionPreviewRow {
  return { offerKey: 'STARTER_249', interval: 'month', offerSignature: 'a'.repeat(64), priceSatang: 24900, subtotalSatang: 24900, taxSatang: 0, totalSatang: 24900,
    paidMonths: 1, bonusMonths: 1, totalMonths: 2, baseReceiptUnits: 30, bonusReceiptUnits: 30, totalReceiptUnits: 60,
    exampleStartsAt: '2026-10-05T03:00:00.000Z', paidEnd: '2026-11-05T03:00:00.000Z', benefitEnd: '2026-12-05T03:00:00.000Z', renewalTotalSatang: 24900, blockers: [], ...overrides };
}

const source = (page: string) => readFileSync(join(__dirname, page), 'utf8');

describe('words an Admin reads', () => {
  it('has a Thai label, help and tone for every campaign status, and a safe fallback for an unknown one', () => {
    for (const status of STATUSES) {
      const meta = campaignStatusMeta(status);
      assert.ok(meta.label && meta.help, status);
      assert.doesNotMatch(`${meta.label}${meta.help}`, MACHINE_TOKEN, status);
      assert.equal(CAMPAIGN_STATUS_META[status].label, meta.label);
    }
    assert.deepEqual(STATUSES.map(status => campaignStatusMeta(status).label), ['ร่าง', 'รออนุมัติ', 'ตั้งเวลาแล้ว', 'กำลังใช้งาน', 'พัก', 'จบแล้ว', 'ต้องตรวจแพ็กเกจใหม่']);
    assert.deepEqual(CAMPAIGN_STATUSES, STATUSES);
    assert.equal(campaignStatusMeta('constructor').label, 'ต้องตรวจสอบสถานะ');
    assert.equal(campaignStatusMeta('SOMETHING_NEW').label, 'ต้องตรวจสอบสถานะ');
  });

  it('marks TEST and LIVE with different words and tones', () => {
    assert.equal(campaignModeMarker('TEST').label, 'โหมดทดสอบ');
    assert.equal(campaignModeMarker('LIVE').label, 'ใช้งานจริง');
    assert.notEqual(campaignModeMarker('TEST').tone, campaignModeMarker('LIVE').tone);
    assert.equal(campaignModeMarker('DISABLED').label, 'ยังไม่เปิดการชำระเงิน');
  });

  it('writes money in baht from satang and counts with separators', () => {
    assert.equal(bahtText(24900), '249 บาท');
    assert.equal(bahtText(249000), '2,490 บาท');
    assert.equal(bahtText(26643), '266.43 บาท');
    assert.equal(bahtText(0), '0 บาท');
    assert.equal(countText(1234), '1,234');
  });

  it('shows the window in Thai time and the usage as used / cap, with an explicit unlimited', () => {
    assert.equal(campaignWindowText('2026-10-12T02:00:00.000Z', '2026-10-31T17:00:00.000Z'), '12 ต.ค. 2569 09:00 น. ถึง 1 พ.ย. 2569 00:00 น.');
    assert.equal(campaignWindowText(undefined, undefined), 'ยังไม่ได้ตั้งเวลา');
    assert.equal(campaignWindowText('2026-10-12T02:00:00.000Z', undefined), '12 ต.ค. 2569 09:00 น. ถึง ยังไม่ได้กรอก');
    assert.equal(campaignUsageText(view()), '12 / 100');
    assert.equal(campaignUsageText(view({ published: { ...published, cap: null } })), '12 / ไม่จำกัด');
    assert.equal(campaignUsageText(view({ published: null, status: 'DRAFT' })), 'ยังไม่เปิดให้ใช้สิทธิ์');
  });

  it('lists the facts of a published campaign and of a half-typed draft without inventing values', () => {
    const facts = termsFacts(published);
    assert.deepEqual(facts.map(fact => fact.label), ['ชื่อภายใน', 'ชื่อที่ลูกค้าเห็น', 'คำอธิบาย', 'เริ่มต้น (STARTER) · รายเดือน', 'เริ่มต้น (STARTER) · รายปี', 'เริ่ม', 'สิ้นสุด', 'จำนวนสิทธิ์สูงสุด']);
    assert.equal(facts.find(fact => fact.label.endsWith('รายเดือน'))!.value, 'แถม 1 เดือน + ใบเสร็จ 30 ใบ');
    assert.equal(facts.at(-1)!.value, '100 สิทธิ์');
    const draft = termsFacts({ internalName: 'ร่าง' });
    assert.equal(draft.find(fact => fact.label === 'แพ็กเกจและรอบ')!.value, 'ยังไม่ได้เลือก');
    assert.equal(draft.find(fact => fact.label === 'ชื่อที่ลูกค้าเห็น')!.value, 'ยังไม่ได้กรอก');
    assert.equal(draft.at(-1)!.value, 'ยังไม่ได้เลือก');
    assert.equal(termsFacts({ cap: null }).at(-1)!.value, 'ไม่จำกัด');
    assert.equal(campaignTitle(view({ published: null, draft: { operationId: 'op', version: 1, values: { campaignId: 'cmp-1' }, validationErrors: [] } })), 'แคมเปญที่ยังไม่ได้ตั้งชื่อ');
  });
});

describe('the form and the draft request', () => {
  it('starts from the template: every cycle ticked, nothing else decided', () => {
    const empty = emptyCampaignForm();
    assert.deepEqual(empty.intervals, ['month', 'year']);
    assert.equal(empty.capChoice, '');
    assert.equal(empty.startsAt, '');
  });

  it('sends Thai time as UTC, a limited cap as a number, trimmed text, and exactly the template rules', () => {
    const input = campaignDraftInput(form(), { campaignId: 'cmp-1', draftVersion: 3 });
    assert.deepEqual(input, {
      campaignId: 'cmp-1', draftVersion: 3, reason: 'เปิดแคมเปญเดือนตุลาคม',
      values: {
        type: 'BONUS_MONTHS', internalName: 'โปรแถมเดือน ต.ค.', description: null, displayName: 'ซื้อ Starter แถม 1 เดือน',
        rules: [
          { offerKey: 'STARTER_249', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30 },
          { offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30 },
        ],
        startsAt: '2026-10-12T02:00:00.000Z', endsAt: '2026-10-31T17:00:00.000Z', cap: 100,
      },
    });
    for (const rule of input.values.rules!) assert.equal(Object.keys(rule).length, 4, 'the server refuses any other key');
  });

  it('leaves out a new campaign\'s ids, and sends the unlimited choice as null', () => {
    const input = campaignDraftInput(form({ capChoice: 'UNLIMITED', cap: '999' }), {});
    assert.ok(!('campaignId' in input) && !('draftVersion' in input));
    assert.equal(input.values.cap, null);
  });

  it('sends an unticked cycle out of the rules', () => {
    const input = campaignDraftInput(form({ intervals: ['year'] }), {});
    assert.deepEqual(input.values.rules!.map(rule => rule.interval), ['year']);
    assert.equal(BILLING_PROMOTION_STARTER_TEMPLATE.rules.length, 2);
  });

  it('saves an incomplete draft: what is not decided is left out so the server lists it as missing', () => {
    const input = campaignDraftInput({ ...emptyCampaignForm(), intervals: [], description: '  ', internalName: '  ', reason: 'เริ่มร่าง' }, {});
    assert.deepEqual(input, { values: { type: 'BONUS_MONTHS', description: null }, reason: 'เริ่มร่าง' });
    assert.deepEqual(campaignFormProblems({ ...emptyCampaignForm(), reason: 'เริ่มร่าง' }), {});
    // a cap that was chosen as limited but not typed yet is "not chosen", not an error
    assert.ok(!('cap' in campaignDraftInput(form({ cap: '' }), {}).values));
    assert.deepEqual(campaignFormProblems(form({ cap: '' })), {});
  });

  it('refuses only what cannot be sent: half a date, a cap that is not a whole number, a missing reason', () => {
    assert.deepEqual(campaignFormProblems(form()), {});
    assert.deepEqual(Object.keys(campaignFormProblems(form({ startsAt: '2026-10-12T', endsAt: 'T09:00' }))), ['startsAt', 'endsAt']);
    assert.deepEqual(Object.keys(campaignFormProblems(form({ startsAt: '2026-02-30T09:00' }))), ['startsAt']);
    for (const cap of ['12.5', '0', '-3', 'abc', '99999999999']) assert.deepEqual(Object.keys(campaignFormProblems(form({ cap }))), ['cap'], cap);
    assert.deepEqual(campaignFormProblems(form({ cap: '1,500' })), {});
    assert.deepEqual(Object.keys(campaignFormProblems(form({ reason: '   ' }))), ['reason']);
    // a bare "T" is how the date box looks after both parts were cleared
    assert.deepEqual(campaignFormProblems(form({ startsAt: 'T' })), {});
    for (const text of Object.values(campaignFormProblems(form({ startsAt: 'x', cap: '0', reason: '' })))) assert.doesNotMatch(text, MACHINE_TOKEN);
  });

  it('reads a saved draft and the published terms back into the form', () => {
    const fromPublished = campaignFormFromTerms(published);
    assert.deepEqual(fromPublished, { internalName: 'โปรแถมเดือน ต.ค.', description: '', displayName: 'ซื้อ Starter แถม 1 เดือน', intervals: ['month', 'year'],
      startsAt: '2026-10-12T09:00', endsAt: '2026-11-01T00:00', capChoice: 'LIMITED', cap: '100', reason: '' });
    assert.equal(campaignFormFromTerms({ cap: null }).capChoice, 'UNLIMITED');
    assert.equal(campaignFormFromTerms({}).capChoice, '');
    assert.deepEqual(campaignFormFromTerms({ rules: [] }).intervals, []);
    assert.deepEqual(campaignFormFromTerms(null), emptyCampaignForm());
  });

  it('round-trips: what the form sends is what it shows again', () => {
    const sent = campaignDraftInput(form(), {});
    assert.deepEqual({ ...campaignFormFromTerms(sent.values), reason: sent.reason }, { ...form(), internalName: 'โปรแถมเดือน ต.ค.', reason: 'เปิดแคมเปญเดือนตุลาคม' });
  });

  it('summarises each template cycle as 2 months / 60 receipts and 13 months / 390 receipts', () => {
    const [month, year] = BILLING_PROMOTION_STARTER_TEMPLATE.rules.map(templateRuleSummary);
    assert.equal(month!.label, 'เริ่มต้น (STARTER) · รายเดือน');
    assert.equal(month!.months, 'ซื้อ 1 เดือน แถม 1 เดือน = 2 เดือน');
    assert.equal(month!.receipts, 'ใบเสร็จ 30 + 30 = 60 ใบ');
    assert.equal(year!.months, 'ซื้อ 12 เดือน แถม 1 เดือน = 13 เดือน');
    assert.equal(year!.receipts, 'ใบเสร็จ 360 + 30 = 390 ใบ');
  });
});

describe('what the server says is missing', () => {
  const fields = ['type', 'internalName', 'description', 'displayName', 'rules', 'startsAt', 'endsAt', 'cap'] as const;
  const codes = ['REQUIRED', 'INVALID', 'END_NOT_AFTER_START'] as const;

  it('has a Thai sentence for every field and code, with no key or code on screen', () => {
    for (const field of fields) for (const code of codes) {
      const text = draftErrorText({ field, code });
      assert.ok(text.length > 5, `${field}/${code}`);
      assert.doesNotMatch(text, MACHINE_TOKEN, `${field}/${code}`);
    }
    assert.equal(draftErrorText({ field: 'endsAt', code: 'END_NOT_AFTER_START' }), 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
    assert.equal(draftErrorText({ field: 'internalName', code: 'REQUIRED' }), 'ยังไม่ได้กรอกชื่อภายใน');
    // a code that does not belong to a field reads as that field's invalid sentence
    assert.equal(draftErrorText({ field: 'cap', code: 'END_NOT_AFTER_START' }), draftErrorText({ field: 'cap', code: 'INVALID' }));
  });

  it('keeps the first message per field', () => {
    const errors: BillingPromotionDraftError[] = [{ field: 'cap', code: 'REQUIRED' }, { field: 'cap', code: 'INVALID' }, { field: 'endsAt', code: 'END_NOT_AFTER_START' }];
    assert.deepEqual(draftErrorsByField(errors), { cap: draftErrorText(errors[0]!), endsAt: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' });
  });
});

describe('what a failed request says', () => {
  const api = (code: string | undefined, status: number | undefined) => Object.assign(new Error('English diagnostic from the API'), { ...(code ? { code } : {}), ...(status ? { status } : {}) });

  it('answers every code the campaign API raises with its own Thai sentence', () => {
    const codes = ['CONTROL_PREVIEW_STALE', 'CONTROL_REAUTH_REQUIRED', 'CONTROL_PROMOTION_INVALID', 'CONTROL_PROMOTION_NOT_FOUND', 'CONTROL_PROMOTION_ENDED',
      'CONTROL_PROMOTION_OVERLAP', 'CONTROL_PROMOTION_CAP_BELOW_USED', 'CONTROL_PROMOTION_CATALOG_STALE'];
    const seen = new Set<string>();
    for (const code of codes) {
      const { text } = campaignError(api(code, 409));
      assert.equal(text, CAMPAIGN_ERROR_TEXT[code], code);
      assert.match(text, /[ก-๙]/, code);
      assert.doesNotMatch(text, MACHINE_TOKEN, code);
      assert.ok(!seen.has(text), `${code} shares a sentence`);
      seen.add(text);
    }
  });

  it('tells the screen what to do: reload on stale, ask for the password, drop the buttons on 403', () => {
    assert.equal(campaignError(api('CONTROL_PREVIEW_STALE', 409)).kind, 'stale');
    assert.equal(campaignError(api('CONTROL_REAUTH_REQUIRED', 403)).kind, 'reauth');
    assert.equal(campaignError(api('CONTROL_PROMOTION_NOT_FOUND', 404)).kind, 'not-found');
    assert.equal(campaignError(api(undefined, 404)).kind, 'not-found');
    assert.equal(campaignError(api(undefined, 401)).kind, 'signed-out');
    assert.equal(campaignError(api(undefined, 403)).kind, 'forbidden');
    assert.equal(campaignError(api('CONTROL_PROMOTION_ENDED', 409)).kind, 'other');
    // a wrong password is a 403 too, but it must not read as "you lost the permission"
    assert.equal(campaignError(api('CONTROL_REAUTH_FAILED', 403)).kind, 'other');
  });

  it('says 401, 403 and a lost response in plain Thai, never the English diagnostic', () => {
    for (const cause of [api(undefined, 401), api(undefined, 403), api(undefined, 502), new TypeError('Failed to fetch'), api(undefined, 422)]) {
      const { text } = campaignError(cause);
      assert.match(text, /[ก-๙]/);
      assert.doesNotMatch(text, /English diagnostic|Failed to fetch/);
    }
    assert.equal(campaignError(api(undefined, 401)).text, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
    assert.equal(campaignError(new TypeError('Failed to fetch')).kind, 'unconfirmed');
    assert.equal(campaignError(api(undefined, 503)).kind, 'unconfirmed');
    assert.match(campaignError(api(undefined, 403)).text, /ไม่มีสิทธิ์/);
  });

  it('falls back to the shared dictionary for a code that is not ours', () => {
    assert.match(campaignError(api('CONTROL_REAUTH_FAILED', 403)).text, /รหัสผ่าน/);
  });

  it('classifies a failed read: no permission, not found, or a retryable failure', () => {
    assert.equal(campaignLoadFailure(api(undefined, 403)).kind, 'forbidden');
    assert.equal(campaignLoadFailure(api(undefined, 404)).kind, 'not-found');
    assert.equal(campaignLoadFailure(api(undefined, 500)).kind, 'failed');
    assert.equal(campaignLoadFailure(new TypeError('Failed to fetch')).kind, 'failed');
    assert.match(campaignLoadFailure(api(undefined, 403)).text, /ไม่มีสิทธิ์ดู/);
  });

  it('words a preview blocker in Thai, and an unknown blocker too', () => {
    assert.equal(blockerText('CONTROL_PROMOTION_CATALOG_STALE'), CAMPAIGN_ERROR_TEXT.CONTROL_PROMOTION_CATALOG_STALE);
    assert.equal(blockerText('SOMETHING_NEW'), 'ตรวจเงื่อนไขของรอบนี้ก่อนเปิดแคมเปญ');
    assert.equal(blockerText('constructor'), 'ตรวจเงื่อนไขของรอบนี้ก่อนเปิดแคมเปญ');
  });

  it('keeps the idempotency key for a retried command and issues a new one when the payload changes', () => {
    let issued = 0;
    const make = () => `key-${++issued}`;
    const first = reuseIntent(null, 'save:{"a":1}', make);
    assert.equal(reuseIntent(first, 'save:{"a":1}', make).key, first.key);
    assert.equal(issued, 1);
    assert.notEqual(reuseIntent(first, 'save:{"a":2}', make).key, first.key);
    assert.equal(issued, 2);
  });
});

describe('the two fixed notices', () => {
  it('says a saved draft is not live, and that a stale draft was reloaded, in plain Thai', () => {
    assert.match(CAMPAIGN_SAVED_NOTICE, /ยังไม่เปิดแคมเปญให้ลูกค้า/);
    assert.match(DRAFT_STALE_TEXT, /โหลดร่างล่าสุด/);
    for (const text of [CAMPAIGN_SAVED_NOTICE, DRAFT_STALE_TEXT]) assert.doesNotMatch(text, MACHINE_TOKEN);
  });
});

describe('which buttons show', () => {
  it('shows a campaign button only when its action is listed', () => {
    assert.deepEqual(campaignButtons([]), { edit: false, discard: false, preview: false, resume: false, pause: false, end: false });
    assert.deepEqual(campaignButtons(['EDIT', 'PAUSE', 'END']), { edit: true, discard: false, preview: false, resume: false, pause: true, end: true });
    assert.deepEqual(campaignButtons(['EDIT', 'DISCARD_DRAFT', 'PREVIEW']), { edit: true, discard: true, preview: true, resume: false, pause: false, end: false });
    assert.deepEqual(campaignButtons(['RESUME', 'END']), { edit: false, discard: false, preview: false, resume: true, pause: false, end: true });
    // the workflow actions belong to the open publication, not to a campaign-level button
    assert.deepEqual(campaignButtons(['SUBMIT', 'APPROVE', 'CANCEL']), campaignButtons([]));
    for (const action of ACTIONS) assert.ok(Object.values(campaignButtons([action])).filter(Boolean).length <= 1, action);
  });

  it('drives the publication buttons from the open operation, in a fixed order', () => {
    assert.deepEqual(operationSteps(null), []);
    assert.deepEqual(operationSteps({ allowedActions: ['cancel', 'submit'] }), ['submit', 'cancel']);
    assert.deepEqual(operationSteps({ allowedActions: ['cancel', 'approve'] }), ['approve', 'cancel']);
    // "apply" belongs to scheduled configuration changes, which campaigns never use
    assert.deepEqual(operationSteps({ allowedActions: ['apply'] }), []);
  });

  it('explains why preview cannot be pressed yet', () => {
    assert.equal(previewBlockedText([], []), null);
    assert.equal(previewBlockedText(undefined, [row()]), null);
    assert.match(previewBlockedText([{ field: 'cap', code: 'REQUIRED' }], [])!, /ร่างยังไม่ครบ/);
    assert.match(previewBlockedText([], [row({ blockers: ['CONTROL_PROMOTION_CATALOG_STALE'] })])!, /ต้องแก้ก่อนเปิด/);
  });

  it('words the open operation in Thai for every state it can be in', () => {
    for (const state of ['PREVIEW', 'AWAITING_APPROVAL', 'SUCCEEDED', 'CANCELLED', 'BLOCKED', 'FAILED']) {
      assert.match(operationStateText(state), /[ก-๙]/, state);
      assert.doesNotMatch(operationStateText(state), MACHINE_TOKEN, state);
    }
  });
});

describe('pause and end', () => {
  it('names the checkouts that keep their right, as the spec words it', () => {
    assert.equal(pendingCheckoutsText(3), 'มีรายการชำระค้าง 3 รายการที่จะยังได้รับสิทธิ์ตามเดิม');
    assert.equal(pendingCheckoutsText(1200), 'มีรายการชำระค้าง 1,200 รายการที่จะยังได้รับสิทธิ์ตามเดิม');
    assert.doesNotMatch(pendingCheckoutsText(0), /ที่จะยังได้รับสิทธิ์/);
  });

  it('warns that ending is final and pausing is not', () => {
    assert.equal(CAMPAIGN_CLOSE_COPY.pause.final, null);
    assert.match(CAMPAIGN_CLOSE_COPY.end.final, /ไม่ได้/);
    assert.match(CAMPAIGN_CLOSE_COPY.pause.effect, /กลับมาเปิดได้/);
  });
});

describe('the preview table', () => {
  it('shows 2 months / 60 receipts for the month and 13 months / 390 receipts for the year (A23)', () => {
    const month = previewRowView(row());
    assert.equal(month.title, 'เริ่มต้น (STARTER) · รายเดือน');
    assert.equal(month.price, '249 บาท');
    assert.equal(month.priceNote, null);
    assert.equal(month.time, 'จ่าย 1 เดือน + แถม 1 เดือน = 2 เดือน');
    assert.equal(month.receipts, 'ใบเสร็จ 30 + 30 = 60 ใบ');
    assert.equal(month.dates, 'ถ้าจ่ายวันที่ 5 ต.ค. 2569 10:00 น. จ่ายถึง 5 พ.ย. 2569 10:00 น. และแถมถึง 5 ธ.ค. 2569 10:00 น.');
    assert.equal(month.next, '249 บาท เมื่อครบ 5 ธ.ค. 2569 10:00 น. (เฉพาะแบบต่ออายุอัตโนมัติ)');
    const year = previewRowView(row({ interval: 'year', totalSatang: 266430, taxSatang: 17430, paidMonths: 12, bonusMonths: 1, totalMonths: 13,
      baseReceiptUnits: 360, bonusReceiptUnits: 30, totalReceiptUnits: 390, renewalTotalSatang: 266430 }));
    assert.equal(year.title, 'เริ่มต้น (STARTER) · รายปี');
    assert.equal(year.time, 'จ่าย 12 เดือน + แถม 1 เดือน = 13 เดือน');
    assert.equal(year.receipts, 'ใบเสร็จ 360 + 30 = 390 ใบ');
    assert.equal(year.price, '2,664.30 บาท');
    assert.equal(year.priceNote, 'รวมภาษี 174.30 บาท');
  });

  it('turns each blocker into a Thai sentence', () => {
    const { blockers } = previewRowView(row({ blockers: ['CONTROL_PROMOTION_CATALOG_STALE', 'UNKNOWN_BLOCKER'] }));
    assert.equal(blockers.length, 2);
    for (const text of blockers) { assert.match(text, /[ก-๙]/); assert.doesNotMatch(text, MACHINE_TOKEN); }
  });
});

describe('the list filters', () => {
  const draftOnly = view({ campaignId: 'cmp-2', status: 'DRAFT', published: null, usage: { reserved: 0, consumed: 0, taken: 0, cap: null },
    draft: { operationId: 'op-2', version: 1, validationErrors: [], values: { campaignId: 'cmp-2', internalName: 'โปรปลายปี', displayName: 'ปีใหม่แถมเดือน',
      rules: [{ offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30 }] } } });
  const ended = view({ campaignId: 'cmp-3', status: 'ENDED', published: { ...published, internalName: 'โปรเก่า', rules: [published.rules[0]!] } });
  const all = [view(), draftOnly, ended];

  it('searches the internal and the customer-facing name, case-insensitively, in the published terms and the draft', () => {
    assert.deepEqual(filterCampaigns(all, { ...NO_CAMPAIGN_FILTERS, search: 'ปลายปี' }).map(item => item.campaignId), ['cmp-2']);
    assert.deepEqual(filterCampaigns(all, { ...NO_CAMPAIGN_FILTERS, search: '  ปีใหม่ ' }).map(item => item.campaignId), ['cmp-2']);
    assert.deepEqual(filterCampaigns(all, { ...NO_CAMPAIGN_FILTERS, search: 'starter' }).map(item => item.campaignId), ['cmp-1', 'cmp-3']);
    assert.deepEqual(filterCampaigns(all, { ...NO_CAMPAIGN_FILTERS, search: 'ไม่มีชื่อนี้' }), []);
  });

  it('filters by status and by package and cycle', () => {
    assert.deepEqual(filterCampaigns(all, { ...NO_CAMPAIGN_FILTERS, status: 'ENDED' }).map(item => item.campaignId), ['cmp-3']);
    assert.deepEqual(filterCampaigns(all, { ...NO_CAMPAIGN_FILTERS, offer: 'STARTER_249:year' }).map(item => item.campaignId), ['cmp-1', 'cmp-2']);
    assert.deepEqual(filterCampaigns(all, { search: '', status: 'ACTIVE', offer: 'STARTER_249:month' }).map(item => item.campaignId), ['cmp-1']);
    assert.equal(filterCampaigns(all, NO_CAMPAIGN_FILTERS).length, 3);
  });

  it('offers the packages and cycles that exist, labelled in Thai', () => {
    assert.deepEqual(campaignOfferOptions(all), [
      { value: 'STARTER_249:month', label: 'เริ่มต้น (STARTER) · รายเดือน' },
      { value: 'STARTER_249:year', label: 'เริ่มต้น (STARTER) · รายปี' },
    ]);
    assert.deepEqual(campaignOfferOptions([]), []);
  });
});

describe('the usage report', () => {
  const counts = { reserved: 2, paidAwaitingApply: 1, applied: 7, releasedBeforePay: 3, refunded: 2, fullyRefunded: 1, rightsActive: 6 };
  const company: BillingPromotionReportCompany = { companyId: 'co-1', companyName: 'ร้านตัวอย่าง', state: 'CONSUMED', offerKey: 'STARTER_249', interval: 'month',
    acceptedAt: '2026-10-12T03:00:00.000Z', consumedAt: '2026-10-12T03:05:00.000Z', benefitAppliedAt: '2026-10-12T03:06:00.000Z', releasedAt: null,
    paidEnd: '2026-11-12T03:05:00.000Z', benefitEnd: '2026-12-12T03:05:00.000Z', refund: 'PARTIAL', entitlementAdjustmentState: 'NOT_REQUIRED',
    attemptHref: '/system/billing/companies/co-1?view=payments', invoiceHref: 'https://evil.example/invoice' };

  it('keeps "rights used" apart from "rights still active" and counts a refunded right as used', () => {
    const items = reportCountItems(counts);
    assert.deepEqual(items.slice(0, 2), [{ label: 'สิทธิ์ที่ใช้แล้ว (รวมที่คืนเงิน)', value: '8' }, { label: 'สิทธิ์ที่ยังใช้งานอยู่', value: '6' }]);
    assert.equal(items.length, 8);
    for (const item of items) assert.doesNotMatch(item.label, MACHINE_TOKEN);
  });

  it('shows money only when the caller may see it', () => {
    assert.equal(reportMoneyView({ moneyReceivedSatang: null, refundedSatang: null }), null);
    assert.deepEqual(reportMoneyView({ moneyReceivedSatang: 249000, refundedSatang: 0 }), { received: '2,490 บาท', refunded: '0 บาท' });
  });

  it('words a company row in Thai and drops what is empty', () => {
    const shown = reportRowView(company);
    assert.equal(shown.title, 'ร้านตัวอย่าง');
    assert.equal(shown.stateLabel, 'ใช้สิทธิ์แล้ว');
    assert.deepEqual(shown.facts.map(fact => fact.label), ['แพ็กเกจและรอบ', 'ขอใช้สิทธิ์เมื่อ', 'ชำระเงินเมื่อ', 'เปิดสิทธิ์เมื่อ', 'ช่วงที่จ่ายสิ้นสุด', 'ใช้ได้ถึง (รวมเดือนฟรี)']);
    assert.deepEqual(shown.notes, ['คืนเงินบางส่วน เวลาและใบเสร็จคงเดิม']);
    const released = reportRowView({ ...company, state: 'RELEASED', consumedAt: null, benefitAppliedAt: null, releasedAt: '2026-10-12T03:30:00.000Z', paidEnd: null, benefitEnd: null,
      refund: 'NONE', entitlementAdjustmentState: 'NOT_REQUIRED' });
    assert.deepEqual(released.facts.map(fact => fact.label), ['แพ็กเกจและรอบ', 'ขอใช้สิทธิ์เมื่อ', 'ยกเลิกเมื่อ']);
    assert.deepEqual(released.notes, []);
    assert.deepEqual(reportRowView({ ...company, refund: 'FULL', entitlementAdjustmentState: 'PENDING' }).notes, ['คืนเงินเต็มจำนวน', 'รอยุติสิทธิ์ที่ยังไม่ใช้']);
    for (const text of [shown.stateLabel, ...shown.facts.flatMap(fact => [fact.label, fact.value]), ...shown.notes]) assert.doesNotMatch(text, MACHINE_TOKEN);
  });

  it('follows a link only when it stays inside the Admin console', () => {
    const shown = reportRowView(company);
    assert.equal(shown.attemptHref, '/system/billing/companies/co-1?view=payments');
    assert.equal(shown.invoiceHref, null);
    for (const bad of ['https://evil.example/system/x', '//evil.example', 'javascript:alert(1)', '/billing/x', '', null, undefined]) assert.equal(safeAdminHref(bad), null, String(bad));
    assert.equal(safeAdminHref('/system/billing/issues/abc'), '/system/billing/issues/abc');
  });
});

describe('a publication request that is open (spec §4 "รออนุมัติ")', () => {
  const NOW = Date.parse('2026-10-09T03:00:00.000Z');
  const op = (over: Partial<BillingConfigurationOperation> = {}) => ({ id: 'op-1', state: 'PREVIEW', version: 2, sourceVersion: 7, expiresAt: '2026-10-09T03:10:00.000Z',
    allowedActions: ['submit', 'cancel'], ...over }) as Pick<BillingConfigurationOperation, 'id' | 'state' | 'version' | 'sourceVersion' | 'expiresAt' | 'allowedActions'>;
  const ask = (operation: ReturnType<typeof op> | null, over: { settingsVersion?: number; refused?: string | null } = {}) =>
    campaignRequest(operation, { settingsVersion: 7, refused: null, now: NOW, ...over });

  it('is open only while it waits on someone', () => {
    for (const state of ['PREVIEW', 'AWAITING_APPROVAL']) assert.equal(isRequestOpen(op({ state } as never)), true, state);
    for (const state of ['DRAFT', 'CANCELLED', 'SUCCEEDED', 'BLOCKED', 'FAILED', 'UNKNOWN', 'SCHEDULED']) assert.equal(isRequestOpen(op({ state } as never)), false, state);
    assert.equal(isRequestOpen(null), false);
    assert.deepEqual(ask(null), { open: false, usable: false, note: null });
    assert.deepEqual(ask(op({ state: 'CANCELLED' } as never)), { open: false, usable: false, note: null });
  });

  it('can still be submitted or approved only while it is fresh, on the settings it was checked against, and not already refused', () => {
    assert.deepEqual(ask(op()), { open: true, usable: true, note: null });
    assert.deepEqual(ask(op({ state: 'AWAITING_APPROVAL', allowedActions: ['approve'] } as never)), { open: true, usable: true, note: null });
    const moved = ask(op(), { settingsVersion: 8 }), expired = ask(op({ expiresAt: '2026-10-09T02:59:59.000Z' })), refused = ask(op(), { refused: requestKey(op()) });
    for (const dead of [moved, expired, refused]) { assert.equal(dead.open, true); assert.equal(dead.usable, false); assert.ok(dead.note); }
    // The expiry instant itself is over, like the server's `expiresAt <= now`.
    assert.equal(ask(op({ expiresAt: '2026-10-09T03:00:00.000Z' })).usable, false);
    // An answer about one version of the request says nothing about the next one (somebody else moved it).
    assert.equal(ask(op({ version: 3 }), { refused: requestKey(op()) }).usable, true);
    assert.equal(ask(op({ id: 'op-2' }), { refused: requestKey(op()) }).usable, true);
    assert.equal(requestKey(op()), 'op-1:2');
  });

  it('leads out of a dead request in one sentence: cancel it, then check before opening again', () => {
    assert.equal(ask(op(), { settingsVersion: 8 }).note, 'คำขอนี้ใช้ต่อไม่ได้แล้ว เพราะข้อมูลเปลี่ยนไปหลังตรวจสอบก่อนเปิด ยกเลิกคำขอนี้แล้วตรวจสอบก่อนเปิดอีกครั้ง');
    assert.equal(ask(op({ expiresAt: '2026-10-09T02:00:00.000Z' })).note, 'คำขอนี้หมดอายุเมื่อ 9 ต.ค. 2569 09:00 น. ยกเลิกคำขอนี้แล้วตรวจสอบก่อนเปิดอีกครั้ง');
    // A reviewer who cannot cancel is told who can; nobody is told to press a button that is not there.
    const reviewer = ask(op({ state: 'AWAITING_APPROVAL', allowedActions: ['approve'] } as never), { settingsVersion: 8 });
    assert.match(reviewer.note!, /ให้ผู้ส่งคำขอยกเลิกคำขอนี้แล้วตรวจสอบก่อนเปิดอีกครั้ง$/);
    for (const note of [reviewer.note!, ask(op(), { settingsVersion: 8 }).note!]) { assert.match(note, /[ก-๙]/); assert.doesNotMatch(note, MACHINE_TOKEN); assert.doesNotMatch(note, /\n/); }
  });

  it('offers only "ยกเลิกคำขอ" once the request cannot go on; the other buttons are the server\'s answer as before', () => {
    const both = op({ allowedActions: ['submit', 'cancel'] });
    assert.deepEqual(operationSteps(both), ['submit', 'cancel']);
    assert.deepEqual(operationSteps(both, true), ['submit', 'cancel']);
    assert.deepEqual(operationSteps(both, false), ['cancel']);
    assert.deepEqual(operationSteps(op({ allowedActions: ['approve'] } as never), false), [], 'a reviewer without cancel is left with no button to loop on');
    assert.deepEqual(operationSteps(null, false), []);
  });

  it('freezes the draft behind an open request, with one sentence that says what to press first', () => {
    const cancel = CAMPAIGN_OPERATION_STEP_TEXT.cancel;
    assert.equal(draftLockedText(true), `มีคำขอเปิดแคมเปญค้างอยู่ จึงแก้หรือยกเลิกร่างไม่ได้ ต้องกด “${cancel}” ก่อน`);
    assert.equal(draftLockedText(false), `มีคำขอเปิดแคมเปญค้างอยู่ จึงแก้หรือยกเลิกร่างไม่ได้ ต้องให้ผู้ส่งคำขอกด “${cancel}” ก่อน`);
    for (const text of [draftLockedText(true), draftLockedText(false)]) { assert.doesNotMatch(text, MACHINE_TOKEN); assert.doesNotMatch(text, /\n/); }
    // Wired: both draft buttons are disabled while a request is open, the confirmation of a discard cannot stay on screen, and the sentence stands in their place.
    const text = source('BillingCampaignDetailPage.tsx');
    assert.match(text, /\{request\.open && \(buttons\.edit \|\| buttons\.discard\) && <p role="note"[^>]*>\{draftLockedText\(operation!\.allowedActions\.includes\('cancel'\)\)\}<\/p>\}/);
    assert.match(text, /disabled=\{busy \|\| request\.open\} onClick=\{\(\) => setEditing\(true\)\}/);
    assert.match(text, /discarding && !request\.open \? <>/);
    assert.match(text, /disabled=\{busy \|\| request\.open\} onClick=\{\(\) => setDiscarding\(true\)\}/);
  });

  it('remembers which version of the request answered stale, reloads, and offers only cancel until it changes', () => {
    const text = source('BillingCampaignDetailPage.tsx');
    assert.match(text, /if \(problem\.kind === 'stale'\) \{\s*if \(isRequestOpen\(operation\)\) setRefusedRequest\(requestKey\(operation!\)\);\s*setReload\(value => value \+ 1\);\s*\}/);
    assert.match(text, /campaignRequest\(operation, \{ settingsVersion: detail\.settingsVersion, refused: refusedRequest \}\)/);
    assert.match(text, /\{request\.open && !request\.usable \? <p role="alert"[^>]*>\{request\.note\}<\/p>/);
    assert.match(text, /disabled=\{busy \|\| \(item !== 'cancel' && !reauthenticated\)\}/);
    assert.doesNotMatch(text, /operationExpired/, 'one rule for expiry and staleness');
  });
});

describe('"กลับมาเปิด" ignores the draft', () => {
  it('is blocked by nothing from a draft: not its gaps, not the rows that belong to it', () => {
    const gaps: BillingPromotionDraftError[] = [{ field: 'cap', code: 'REQUIRED' }];
    const blocked = [row({ blockers: ['CONTROL_PROMOTION_CATALOG_STALE'] })];
    assert.equal(resumeBlockedText(true, []), null);
    assert.equal(resumeBlockedText(true, blocked), null, 'while a draft exists the rows are the draft\'s');
    assert.ok(previewBlockedText(gaps, []), 'the preview of that same draft is still blocked');
    // With no draft the rows are the published terms being reopened: their blockers are real.
    assert.equal(resumeBlockedText(false, [row()]), null);
    assert.match(resumeBlockedText(false, blocked)!, /ต้องแก้ก่อนเปิด/);
    const text = source('BillingCampaignDetailPage.tsx');
    assert.match(text, /disabled=\{busy \|\| !publishReason\.trim\(\) \|\| Boolean\(resumeBlocked\)\} aria-busy=\{busy\} onClick=\{\(\) => void preview\('RESUME'\)\}/);
    assert.match(text, /disabled=\{busy \|\| !publishReason\.trim\(\) \|\| Boolean\(previewBlocked\)\} aria-busy=\{busy\} onClick=\{\(\) => void preview\('PUBLISH'\)\}/);
    assert.match(text, /const blocked = buttons\.preview \? previewBlocked : resumeBlocked;/);
  });
});

describe('the published terms are worded for the status the campaign is in', () => {
  it('calls only an active campaign\'s terms "in use", and never says a customer uses terms that are scheduled, paused, ended or stale', () => {
    assert.deepEqual(publishedTermsCopy('ACTIVE'), { title: 'เงื่อนไขที่ใช้อยู่', note: 'ลูกค้าเห็นและใช้สิทธิ์ตามเงื่อนไขนี้ เวลาแสดงเป็นเวลาประเทศไทย' });
    for (const status of ['SCHEDULED', 'PAUSED', 'ENDED', 'CATALOG_STALE']) {
      const { title, note } = publishedTermsCopy(status);
      assert.doesNotMatch(title, /ที่ใช้อยู่/, status);
      assert.doesNotMatch(note, /ลูกค้าเห็นและใช้สิทธิ์ตามเงื่อนไขนี้/, status);
      assert.match(note, /เวลาแสดงเป็นเวลาประเทศไทย$/, status);
    }
    assert.match(publishedTermsCopy('SCHEDULED').note, /ยังใช้สิทธิ์.*ไม่ได้/);
    assert.match(publishedTermsCopy('PAUSED').note, /ใช้สิทธิ์ใหม่.*ไม่ได้/);
    assert.match(publishedTermsCopy('ENDED').note, /ปิดรับสิทธิ์แล้ว/);
    assert.match(publishedTermsCopy('CATALOG_STALE').note, /หยุดรับสิทธิ์ใหม่/);
    const titles = ['ACTIVE', 'SCHEDULED', 'PAUSED', 'ENDED', 'CATALOG_STALE'].map(status => publishedTermsCopy(status).title);
    assert.equal(new Set(titles).size, titles.length, 'one heading per status');
    // A status we do not know claims nothing; neither does the one a campaign has only before it is published.
    for (const status of ['DRAFT', 'AWAITING_APPROVAL', 'SOMETHING_NEW', 'constructor']) assert.deepEqual(publishedTermsCopy(status), { title: 'เงื่อนไขที่เผยแพร่แล้ว', note: 'เวลาแสดงเป็นเวลาประเทศไทย' }, status);
    for (const status of STATUSES) for (const text of Object.values(publishedTermsCopy(status))) assert.doesNotMatch(text, MACHINE_TOKEN, status);
    const text = source('BillingCampaignDetailPage.tsx');
    assert.match(text, /<TermsCard title=\{termsCopy\.title\} terms=\{published\} endedAt=\{published\.endedAt\} note=\{termsCopy\.note\} \/>/);
    assert.doesNotMatch(text, /title="เงื่อนไขที่ใช้อยู่"/);
  });
});

describe('the sentence for CONTROL_PROMOTION_INVALID is true for both of its causes', () => {
  it('names the campaign\'s own fields and the package price and quota the template needs, and says the second cannot be fixed on the campaign', () => {
    const text = CAMPAIGN_ERROR_TEXT.CONTROL_PROMOTION_INVALID!;
    // Cause 1, editable: the campaign's own fields.
    assert.match(text, /ชื่อ ช่วงเวลา และรอบที่เลือก/);
    // Cause 2, not editable: the catalog must be the template's price and quota — read from the template, never typed here.
    const template = BILLING_PROMOTION_STARTER_TEMPLATE;
    assert.ok(text.includes(`ราคารายเดือน ${bahtText(template.monthlyPriceSatang)}`), 'the monthly price');
    for (const rule of template.rules) assert.ok(text.includes(`${rule.baseReceiptUnits} ใบต่อ${rule.interval === 'year' ? 'ปี' : 'เดือน'}`), `base receipts ${rule.interval}`);
    assert.match(text, /แก้ที่แคมเปญไม่ได้/);
    assert.doesNotMatch(text, MACHINE_TOKEN);
    // The preview rows print the same sentence for the same code.
    assert.equal(blockerText('CONTROL_PROMOTION_INVALID'), text);
    assert.equal(previewRowView(row({ blockers: ['CONTROL_PROMOTION_INVALID'] })).blockers[0], text);
  });
});

describe('who is told they can only look', () => {
  it('tells an account that may approve the open request so, and only then drops "ดูได้อย่างเดียว"', () => {
    const cannot = 'บัญชีนี้ดูแคมเปญได้อย่างเดียว การแก้ไข เปิด พัก และจบแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”';
    assert.equal(permissionNote({ canManage: true, canApprove: false, needs: DETAIL_NEEDS }), null);
    assert.equal(permissionNote({ canManage: true, canApprove: true, needs: DETAIL_NEEDS }), null);
    assert.equal(permissionNote({ canManage: false, canApprove: false, needs: DETAIL_NEEDS }), cannot);
    const approver = permissionNote({ canManage: false, canApprove: true, needs: DETAIL_NEEDS })!;
    assert.equal(approver, 'บัญชีนี้อนุมัติคำขอเปิดแคมเปญที่ส่งมาแล้วได้ แต่การแก้ไข เปิด พัก และจบแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”');
    assert.doesNotMatch(approver, /ดูแคมเปญได้อย่างเดียว/);
    assert.equal(permissionNote({ canManage: false, canApprove: false, needs: LIST_NEEDS }), 'บัญชีนี้ดูแคมเปญได้อย่างเดียว การสร้างแคมเปญต้องมีสิทธิ์ “ตั้งนโยบาย”');
    for (const text of [cannot, approver]) assert.doesNotMatch(text, MACHINE_TOKEN);
    // The detail page asks whether the request it offers can be approved (a dead request offers no approve); the list asks whether any campaign lists APPROVE for the caller.
    const detail = source('BillingCampaignDetailPage.tsx'), list = source('BillingCampaignsPage.tsx');
    assert.match(detail, /permissionNote\(\{ canManage, canApprove: steps\.includes\('approve'\), needs: DETAIL_NEEDS \}\)/);
    assert.match(list, /permissionNote\(\{ canManage: false, canApprove: list\.campaigns\.some\(item => item\.allowedActions\.includes\('APPROVE'\)\), needs: LIST_NEEDS \}\)/);
    for (const page of [detail, list]) assert.doesNotMatch(page, /ดูแคมเปญได้อย่างเดียว/, 'the sentence lives in one place');
  });
});

describe('the issue panel knows the promotion review', () => {
  const panel = source('BillingIssueResolutionPanel.tsx');
  const branch = panel.slice(panel.indexOf('issue.kind === BILLING_PROMOTION_REVIEW_ISSUE'), panel.indexOf("issue.kind === 'PROVIDER_EVENT_FAILED'"));
  const discount = panel.slice(panel.indexOf('issue.kind === BILLING_EVENT_DISCOUNT_REVIEW_ISSUE'), panel.indexOf('issue.kind === BILLING_PROMOTION_REVIEW_ISSUE'));
  it('has its own branch with the event-discount branch\'s link logic: the bill for those who may read money, the company otherwise', () => {
    assert.ok(branch.length > 200, 'a branch exists');
    assert.match(panel, /import \{ BILLING_EVENT_DISCOUNT_REVIEW_ISSUE, BILLING_PROMOTION_REVIEW_ISSUE,/);
    const link = /href = company && financial \? `\$\{company\}\/invoices\/\$\{ref\}` : company;/;
    assert.match(discount, link);
    assert.match(branch, link);
    assert.match(branch, /action = financial \? 'ตรวจบิลที่ใช้โปรโมชั่น' : 'เปิดข้อมูลบริษัทเพื่อตรวจโปรโมชั่น';/);
  });
  it('says both causes in plain Thai and what the operator decides from', () => {
    const description = /description = '([^']+)'/.exec(branch)?.[1] ?? '';
    assert.match(description, /เลือกใช้โปรโมชั่น/);
    assert.match(description, /ไม่มีเดือนแถมและใบเสร็จแถม/, 'the shop kept a normal purchase, without the bonus');
    assert.match(description, /คืนเงินเต็มจำนวน.*ยุติสิทธิ์ที่ยังไม่ใช้/, 'a fully refunded promotion purchase that could not be ended');
    assert.match(description, /ตรวจบิลกับรายชื่อร้านที่ใช้สิทธิ์ในรายงานของแคมเปญ/);
    assert.doesNotMatch(description, MACHINE_TOKEN);
  });
});

// Source-text guards (same idea as sales-console.qa.spec.ts): the pages are client components behind useEffect, so nothing here
// renders them; these hold the decisions a reviewer would otherwise re-check by eye on every diff.
const PAGES = ['BillingCampaignsPage.tsx', 'BillingCampaignFormPage.tsx', 'BillingCampaignDetailPage.tsx', 'BillingCampaignReportSection.tsx'];

describe('campaign screens print no machine token', () => {
  it('scans every campaign page component in the feature', () => {
    const present = readdirSync(__dirname).filter(name => /^BillingCampaign.*\.tsx$/.test(name));
    assert.deepEqual([...PAGES].sort(), present.sort());
  });

  for (const page of PAGES) {
    it(`${page} renders no raw status, enum, id or hash as text`, () => {
      const text = source(page);
      // {x.status} / {x.state} / {x.mode} / {x.interval} / {x.offerKey} / {x.code} between tags is an enum key on screen.
      assert.doesNotMatch(text, />\s*\{[^{}]*\.(?:status|state|mode|interval|offerKey|code|errorCode|type|field|action)\s*\}\s*</, `${page} renders a raw key`);
      // An id or a hash between tags is a machine token on screen.
      assert.doesNotMatch(text, />\s*\{[^{}]*(?:campaignId|operationId|companyId|previewHash|offerSignature|\.id)\b[^{}]*\}\s*</, `${page} renders an id or a hash`);
      // A bare enum word as a text node.
      assert.doesNotMatch(text, />\s*(?:DRAFT|AWAITING_APPROVAL|SCHEDULED|ACTIVE|PAUSED|ENDED|CATALOG_STALE|RESERVED|CONSUMED|RELEASED|TEST|LIVE|DISABLED|STARTER_249|CONTROL_[A-Z_]+)\s*</, `${page} prints an enum word`);
    });

    it(`${page} uses มั่งมี tokens, never a raw colour, and shows no raw API diagnostic`, () => {
      const text = source(page);
      assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, `${page} hardcodes a colour`);
      assert.doesNotMatch(text, /(?:bg|text|border|ring|fill|stroke|from|via|to)-\[(?:#|rgb|hsl|color)/, `${page} uses an arbitrary colour utility`);
      assert.doesNotMatch(text, /\bcatch\s*\([A-Za-z_$][\w$]*\)\s*\{[^}]*\.message\b/, `${page} displays a caught message`);
    });
  }

  it('every button the detail page shows is tied to a server action or an open operation', () => {
    const text = source('BillingCampaignDetailPage.tsx');
    for (const key of ['edit', 'discard', 'preview', 'resume', 'pause', 'end']) assert.match(text, new RegExp(`buttons\\.${key}\\b`), key);
    assert.match(text, /operationSteps\(operation, request\.usable\)/);
  });
});
