/**
 * The confirm card and its replies (draft-control spec §5.4, P10-L SEC-04).
 *
 * The load-bearing assertion in this file is the smallest one: the two buttons carry an intent and
 * NOTHING else. Every id that is not in `data` is an id a forged postback cannot choose, which is
 * what makes "re-derive the preview from the chat" a security property rather than a convenience.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LineDraftUpdatePreview } from '@watchdog-bms/contracts';
import { linePostbackCommandText, staffMenuCommand } from './line-staff-menu.logic';
import {
  DRAFT_UPDATE_CANCEL_COMMAND,
  DRAFT_UPDATE_CONFIRM_COMMAND,
  buildDraftUpdatePreviewCard,
  draftUpdateAppliedReply,
  draftUpdateBlockedReply,
  draftUpdateMutationBlockedReply,
} from './line-draft-update-card.logic';

const preview: LineDraftUpdatePreview = {
  previewId: 'p-1',
  recordType: 'expense',
  expenseId: 'exp-1',
  recordLabel: 'BHC · 2026-09-03 · รอตรวจสอบ',
  tool: 'expense.draft.add_charge',
  diff: [{ field: 'charge.SERVICE_CHARGE', label: 'ค่าบริการ', before: null, after: '152.00' }],
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
  it('carries an intent and no ids in either postback (SEC-04)', () => {
    const card = buildDraftUpdatePreviewCard(preview) as any;
    const buttons = card.contents.footer.contents;
    assert.deepEqual(buttons.map((button: any) => button.action.data), [
      'action=draft-update-confirm',
      'action=draft-update-cancel',
    ]);
    for (const id of [preview.previewId, preview.expenseId]) {
      assert.ok(!allText(card).some((text) => text.includes(id)), `${id} must never ride in the card`);
    }
  });

  it('routes both postbacks through the SAME lane a typed message takes', () => {
    assert.equal(linePostbackCommandText('action=draft-update-confirm'), DRAFT_UPDATE_CONFIRM_COMMAND);
    assert.equal(linePostbackCommandText('action=draft-update-cancel'), DRAFT_UPDATE_CANCEL_COMMAND);
    assert.equal(staffMenuCommand(DRAFT_UPDATE_CONFIRM_COMMAND), 'draft_update_confirm');
    assert.equal(staffMenuCommand(DRAFT_UPDATE_CANCEL_COMMAND), 'draft_update_cancel');
    // An unknown action answers null and the event is dropped, not guessed.
    assert.equal(linePostbackCommandText('action=draft-update-confirm-2&previewId=p-1'), null);
  });

  it('states the new total and keeps the fallback text carrying it too', () => {
    const card = buildDraftUpdatePreviewCard(preview) as any;
    assert.match(card.altText, /ยอดรวมใหม่ 1,789\.04/);
    assert.ok(allText(card.contents.body).includes('1,789.04'));
    assert.ok(allText(card.contents.body).some((text) => text.includes('เดิม 1,626.40')));
  });

  it('scrubs a money- or link-shaped record label, but keeps the server figures', () => {
    const hostile = { ...preview, recordLabel: 'จ่ายไปที่ 9,999.00 http://evil.example' };
    const text = allText(buildDraftUpdatePreviewCard(hostile)).join('\n');
    assert.ok(!text.includes('9,999.00'));
    assert.ok(!text.includes('evil.example'));
    assert.ok(text.includes('1,789.04'));
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

  it("never puts a '+' in customer copy (spec §3)", () => {
    const strings = [
      ...allText(buildDraftUpdatePreviewCard(preview)),
      draftUpdateAppliedReply('https://app.example', 'co-1', 'exp-1', preview),
    ];
    assert.ok(!strings.some((text) => text.includes('+')));
  });
});
