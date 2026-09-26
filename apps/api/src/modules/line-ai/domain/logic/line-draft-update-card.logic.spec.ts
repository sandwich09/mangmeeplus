/**
 * The confirm card and its replies (draft-control spec §5.4, P10-L SEC-04).
 * The opaque previewId binds each visible button to exactly the preview it rendered; the card never
 * carries an expense or company id.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineDraftUpdatePreview } from '@watchdog-bms/contracts';
import { lineDraftUpdatePostbackPreviewId, linePostbackCommandText, staffMenuCommand } from './line-staff-menu.logic';
import {
  DRAFT_UPDATE_CANCEL_COMMAND,
  DRAFT_UPDATE_CONFIRM_COMMAND,
  buildDraftUpdatePreviewCard,
  draftUpdateAppliedReply,
  draftUpdateBlockedReply,
  draftProposalAckReason,
  draftUpdateMutationBlockedReply,
} from './line-draft-update-card.logic';

const preview: LineDraftUpdatePreview = {
  previewId: '550e8400-e29b-41d4-a716-446655440000',
  recordType: 'expense',
  expenseId: 'exp-1',
  record: { vendorName: 'BHC', expenseDate: '2026-09-03', statusLabel: 'รอตรวจสอบ' },
  tool: 'expense.draft.add_charge',
  diff: [{ field: 'charge.SERVICE_CHARGE', label: 'ค่าบริการ', kind: 'money', before: null, after: '152.00' }],
  totalsBefore: { subtotalAmount: '1520', discountAmount: '0', chargesAmount: '0.00', taxableAmount: '1520', vatAmount: '106.40', grandTotalAmount: '1626.40' },
  totalsAfter: { subtotalAmount: '1520', discountAmount: '0', chargesAmount: '152.00', taxableAmount: '1672', vatAmount: '117.04', grandTotalAmount: '1789.04' },
  warnings: [],
  expiresAt: '2026-09-05T10:10:00.000Z',
};

/** Every string anywhere in the built message, so a leak cannot hide inside a nested box. */
function allText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) allText(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) allText(item, out);
  return out;
}

describe('draft update confirm card', () => {
  it('binds both buttons to this preview while preserving their visible labels (SEC-04)', () => {
    const card = buildDraftUpdatePreviewCard(preview) as any;
    const buttons = card.contents.footer.contents;
    assert.deepEqual(buttons.map((button: any) => button.action.data), [
      'action=draft-update-confirm&previewId=' + preview.previewId,
      'action=draft-update-cancel&previewId=' + preview.previewId,
    ]);
    assert.deepEqual(buttons.map((button: any) => button.action.label), ['ยืนยัน', 'ยกเลิก']);
    assert.ok(!allText(card).some((text) => text.includes(preview.expenseId)), 'expense id must never ride in the card');
  });

  it('routes both postbacks through the SAME lane a typed message takes — when the flag is on', () => {
    const confirm = 'action=draft-update-confirm&previewId=' + preview.previewId;
    const cancel = 'action=draft-update-cancel&previewId=' + preview.previewId;
    assert.equal(linePostbackCommandText(confirm, true), DRAFT_UPDATE_CONFIRM_COMMAND);
    assert.equal(linePostbackCommandText(cancel, true), DRAFT_UPDATE_CANCEL_COMMAND);
    assert.equal(lineDraftUpdatePostbackPreviewId(confirm, DRAFT_UPDATE_CONFIRM_COMMAND), preview.previewId);
    assert.equal(lineDraftUpdatePostbackPreviewId(cancel, DRAFT_UPDATE_CANCEL_COMMAND), preview.previewId);
    assert.equal(lineDraftUpdatePostbackPreviewId('action=draft-update-confirm', DRAFT_UPDATE_CONFIRM_COMMAND), undefined);
    assert.equal(lineDraftUpdatePostbackPreviewId(confirm + '&extra=1', DRAFT_UPDATE_CONFIRM_COMMAND), undefined);
    assert.equal(lineDraftUpdatePostbackPreviewId(confirm + '&previewId=' + preview.previewId, DRAFT_UPDATE_CONFIRM_COMMAND), undefined);
    assert.equal(lineDraftUpdatePostbackPreviewId(cancel, DRAFT_UPDATE_CONFIRM_COMMAND), undefined);
    assert.equal(staffMenuCommand(DRAFT_UPDATE_CONFIRM_COMMAND), 'draft_update_confirm');
    assert.equal(staffMenuCommand(DRAFT_UPDATE_CANCEL_COMMAND), 'draft_update_cancel');
    // An unknown action answers null and the event is dropped, not guessed.
    assert.equal(linePostbackCommandText('action=draft-update-confirm-2&previewId=' + preview.previewId, true), null);
  });

  // With S-4 off no card carries these buttons, so the only thing that can send one is a forgery.
  // Resolving it to a command anyway put the event down the text lane and into a PAID AI turn;
  // before S-4 it resolved to null and was dropped. Flag off must mean dropped again.
  it('drops a forged draft postback while the flag is off, and defaults to dropping', () => {
    for (const data of ['action=draft-update-confirm', 'action=draft-update-cancel']) {
      assert.equal(linePostbackCommandText(data, false), null, data);
      assert.equal(linePostbackCommandText(data), null, `${data} (default)`);
    }
    // Every non-draft action is unaffected in BOTH positions — the gate is narrow.
    for (const enabled of [false, true]) {
      assert.equal(linePostbackCommandText('action=package-change', enabled), 'ขอเปลี่ยนแพ็กเกจ');
      assert.equal(linePostbackCommandText('action=line-rich-talk', enabled), 'คุยกับน้องมั่งมี');
    }
    // And typing the words is unchanged: the text lane never consulted the flag, and the webhook
    // is where an off deployment declines to act on them.
    assert.equal(staffMenuCommand(DRAFT_UPDATE_CONFIRM_COMMAND), 'draft_update_confirm');
    assert.equal(staffMenuCommand(DRAFT_UPDATE_CANCEL_COMMAND), 'draft_update_cancel');
  });

  it('states the new total and keeps the fallback text carrying it too', () => {
    const card = buildDraftUpdatePreviewCard(preview) as any;
    assert.match(card.altText, /ยอดรวมใหม่ 1,789\.04/);
    assert.match(card.altText, /ส่งคำขอแก้ไขใหม่/);
    assert.doesNotMatch(card.altText, /ยืนยันการแก้ไข|ยกเลิกการแก้ไข/);
    assert.ok(allText(card.contents.body).includes('1,789.04'));
    assert.ok(allText(card.contents.body).some((text) => text.includes('เดิม 1,626.40')));
  });

  it('scrubs a money- or link-shaped vendor name, but keeps the server figures', () => {
    const hostile = { ...preview, record: { ...preview.record, vendorName: 'จ่ายไปที่ 9,999.00 http://evil.example' } };
    const text = allText(buildDraftUpdatePreviewCard(hostile)).join('\n');
    assert.ok(!text.includes('9,999.00'));
    assert.ok(!text.includes('evil.example'));
    assert.ok(text.includes('1,789.04'));
  });

  // H2: the card exists to STATE the change. Scrubbing the server's own values turned
  // "วันที่เอกสาร: 3 ก.ย. 2569" into "…-…-…", which is worse than saying nothing.
  it('prints a real date on a set_header card (spec J3.1)', () => {
    const card = buildDraftUpdatePreviewCard({
      ...preview,
      tool: 'expense.draft.set_header',
      diff: [{ field: 'expenseDate', label: 'วันที่เอกสาร', kind: 'date', before: '2026-09-01', after: '2026-09-03' }],
    }) as any;
    const text = allText(card).join('\n');
    assert.match(text, /1 ก\.ย\. 2569/, 'the date it holds today');
    assert.match(text, /3 ก\.ย\. 2569/, 'and the date it would hold');
    assert.ok(!text.includes('…-…'), 'never a masked date');
    // The record line names the bill in Buddhist-era Thai too, not an ISO string.
    assert.match(text, /BHC · 3 ก\.ย\. 2569 · รอตรวจสอบ/);
  });

  it('prints the real line number and amount on a remove_line card', () => {
    const card = buildDraftUpdatePreviewCard({
      ...preview,
      tool: 'expense.draft.remove_line',
      diff: [
        { field: 'line.12.description', label: 'ลบบรรทัด 12', kind: 'text', before: 'อาหาร', after: null },
        { field: 'line.12.amount', label: 'ยอดบรรทัด 12 ที่จะหายไป', kind: 'money', before: '152.00', after: null },
      ],
    }) as any;
    const text = allText(card).join('\n');
    assert.match(text, /ลบบรรทัด 12/, 'a two-digit line number survives in the label');
    assert.match(text, /152\.00/, 'and the amount that would disappear is stated');
  });

  it('prints a VAT rate and mode without masking them', () => {
    const card = buildDraftUpdatePreviewCard({
      ...preview,
      tool: 'expense.draft.set_vat_mode',
      diff: [
        { field: 'vatMode', label: 'โหมด VAT', kind: 'plain', before: 'NO_VAT', after: 'VAT_EXCLUDED' },
        { field: 'vatRate', label: 'อัตรา VAT', kind: 'plain', before: null, after: '7%' },
      ],
    }) as any;
    const text = allText(card).join('\n');
    assert.match(text, /7%/);
    assert.match(text, /VAT_EXCLUDED/);
  });

  it('keeps a document number\'s digits, which ARE its value', () => {
    const card = buildDraftUpdatePreviewCard({
      ...preview,
      tool: 'expense.draft.set_header',
      diff: [{ field: 'documentNumber', label: 'เลขที่เอกสาร', kind: 'identifier', before: null, after: 'ใบกำกับ-12' }],
    }) as any;
    assert.match(allText(card).join('\n'), /ใบกำกับ-12/);
  });

  it('says what changed, then links the record', () => {
    const reply = draftUpdateAppliedReply('https://app.example', 'co-1', 'exp-1', preview);
    assert.match(reply, /แก้ให้แล้วค่ะ: ค่าบริการ 152\.00 · ยอดรวม 1,789\.04/);
    assert.match(reply, /https:\/\/app\.example\/companies\/co-1\/expenses\/exp-1/);
  });

  it('answers a confirmed record with mutation_blocked copy, not "out of scope"', () => {
    const reply = draftUpdateMutationBlockedReply('https://app.example', 'co-1', 'exp-1');
    assert.match(reply, /ยืนยันไปแล้ว แก้ผ่าน LINE ไม่ได้/);
    assert.match(reply, /expenses\/exp-1/);
    assert.equal(draftUpdateBlockedReply('mutation_blocked', 'https://app.example', 'co-1', 'exp-1'), reply);
    assert.match(draftUpdateBlockedReply('ambiguous_line', 'https://app.example', 'co-1'), /บรรทัดไหน/);
    assert.match(draftUpdateBlockedReply('forbidden', 'https://app.example', 'co-1'), /ยังไม่มีสิทธิ์/);
  });

  // M7: the inline ternary labelled an unanswered proposal `correction_apply`, which is exactly
  // what its own comment said it must not do.
  it('never records a draft-lane turn as an applied correction — neither outcome writes', () => {
    assert.equal(draftProposalAckReason('proposed'), 'correction_guidance');
    assert.equal(draftProposalAckReason('answered'), 'correction_guidance');
    assert.equal(draftProposalAckReason('not_handled'), 'correction_guidance');
  });

  // Not named in the review, but the card's `cell()` has the identical identifier branch and
  // would regress the same way. One assertion is cheaper than finding out later.
  it('never prints a document number carrying a total or a host', () => {
    const card = buildDraftUpdatePreviewCard({
      ...preview,
      tool: 'expense.draft.set_header',
      diff: [{ field: 'documentNumber', label: 'เลขที่เอกสาร', kind: 'identifier', before: null, after: 'A0042 ยอดจริง 88,888.00 โอนที่ evil.example.com' }],
    }) as any;
    const text = allText(card).join('\n');
    assert.ok(!text.includes('88,888.00'));
    assert.ok(!text.includes('evil.example.com'));
  });

  it("never puts a '+' in customer copy (spec §3)", () => {
    const strings = [
      ...allText(buildDraftUpdatePreviewCard(preview)),
      draftUpdateAppliedReply('https://app.example', 'co-1', 'exp-1', preview),
    ];
    assert.ok(!strings.some((text) => text.includes('+')));
  });
});
