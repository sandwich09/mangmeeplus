/**
 * The deterministic Thai answer for an S-4 draft-edit PREVIEW (draft-control spec §5.4).
 *
 * Same contract as `expense-explain-formatter`: the model never phrases this turn. Every figure is
 * copied from the tool result — which the API produced by running the real write path and rolling
 * it back — and every free-text fragment goes through the shared `scrubRecordText`, because a line
 * description is text an attacker printed on a receipt and this string ends up in a LINE bubble.
 *
 * It refuses (returns `undefined`) rather than half-answering: a payload missing the totals or the
 * diff falls through to the ordinary honest path instead of showing a change nobody can verify.
 *
 * The API attaches the [ยืนยัน]/[ยกเลิก] buttons to this turn separately, because only the API may
 * print buttons whose postbacks it must later re-derive (SEC-04). The text says what pressing them
 * means, so a Flex-less delivery still explains the choice.
 */
import { scrubRecordText } from '@watchdog-bms/contracts';

const MAX_ROWS = 5;

function money(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const raw = String(value).replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return undefined;
  return Number.parseFloat(raw).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return 'ยังไม่ระบุ';
  return scrubRecordText(String(value), 60) || '—';
}

/**
 * `{ found: true, preview }` → the confirm text. `{ found: true, moveSuggestion }` → the J3.3
 * "ย้ายเป็นช่องค่าบริการ" offer. `{ found: true, blocked }` → the honest one-liner. Anything else
 * returns undefined and the turn keeps its normal composed answer.
 */
export function formatDraftUpdateReply(data: unknown): string | undefined {
  const payload = record(data);
  if (!payload || payload['found'] !== true) return undefined;

  const move = record(payload['moveSuggestion']);
  if (move) {
    const line = move['lineNumber'];
    const label = scrubRecordText(String(move['chargeLabel'] ?? ''), 40);
    if (typeof line !== 'number' || !label) return undefined;
    return `บิลนี้มี "${label}" เป็นรายการสินค้าอยู่แล้ว (บรรทัด ${line}) ค่ะ จะไม่เพิ่มซ้ำนะคะ`
      + ` — พิมพ์ "ย้ายบรรทัด ${line} เป็นช่องค่าบริการ" ถ้าต้องการย้ายเป็นช่องค่าใช้จ่ายเพิ่มค่ะ`;
  }

  if (typeof payload['blocked'] === 'string') return blockedLine(payload['blocked']);

  const preview = record(payload['preview']);
  const totalsAfter = record(preview?.['totalsAfter']);
  const totalsBefore = record(preview?.['totalsBefore']);
  const diff = Array.isArray(preview?.['diff']) ? preview!['diff'] as unknown[] : undefined;
  if (!preview || !totalsAfter || !totalsBefore || !diff || diff.length === 0) return undefined;
  const after = money(totalsAfter['grandTotalAmount']);
  const before = money(totalsBefore['grandTotalAmount']);
  if (!after || !before) return undefined;

  const rows = diff.slice(0, MAX_ROWS).map((entry) => {
    const row = record(entry);
    if (!row) return undefined;
    return `• ${cell(row['label'])}: ${cell(row['before'])} → ${cell(row['after'])}`;
  });
  if (rows.some((row) => row === undefined)) return undefined;

  const warnings = Array.isArray(preview['warnings'])
    ? (preview['warnings'] as unknown[]).slice(0, 2).map((warning) => `⚠️ ${scrubRecordText(String(warning), 160)}`)
    : [];
  return [
    `จะแก้ ${cell(preview['recordLabel'])} ตามนี้นะคะ`,
    ...rows as string[],
    `ยอดรวมใหม่ ${after} (เดิม ${before})`,
    ...warnings,
    'กด [ยืนยัน] เพื่อบันทึก หรือ [ยกเลิก] ถ้ายังไม่แก้ค่ะ — ยังไม่ได้บันทึกอะไรจนกว่าจะกดยืนยันนะคะ',
  ].join('\n');
}

/** One honest sentence per refusal. Nothing here invents a number or a record name. */
function blockedLine(reason: string): string | undefined {
  switch (reason) {
    case 'mutation_blocked': return 'รายการนี้ยืนยันไปแล้ว แก้ผ่าน LINE ไม่ได้ค่ะ ต้องไปแก้หรือยกเลิกในเว็บนะคะ';
    case 'ambiguous_line': return 'บิลนี้มีหลายบรรทัดค่ะ ขอทราบว่าต้องการแก้บรรทัดไหนนะคะ (เช่น "บรรทัด 2 เป็น 500")';
    case 'ambiguous_record': return 'มีหลายรายการล่าสุดในแชทนี้ ขอให้ระบุรายการก่อนนะคะ';
    case 'no_recent_record': return 'ยังไม่พบรายการที่บันทึกไว้ล่าสุดในแชทนี้ที่แก้ไขได้ค่ะ';
    case 'ungrounded_value': return 'ยังไม่ได้แก้ยอดให้นะคะ เพราะยังไม่แน่ใจตัวเลขที่ต้องการ พิมพ์ตัวเลขให้ชัดอีกครั้งได้เลยค่ะ';
    case 'rate_limited': return 'ขอพักสักครู่นะคะ มีคำขอแก้ไขเข้ามาถี่เกินไป ลองใหม่อีกครั้งในอีกสักครู่ค่ะ';
    case 'invalid_patch': return 'ยังตีความคำสั่งแก้ไขไม่ได้ค่ะ ลองพิมพ์ใหม่ให้สั้นและชัดขึ้นนะคะ (เช่น "เพิ่มค่าบริการ 10%")';
    // `forbidden` and `feature_disabled` never arrive as `blocked` — the tool returns them as typed
    // tool statuses so the existing permission/unavailable copy answers them.
    default: return undefined;
  }
}
