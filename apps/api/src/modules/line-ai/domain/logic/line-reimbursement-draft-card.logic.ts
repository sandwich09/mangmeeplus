import type { LineReimbursementDraftResult, LineReimbursementDraftPreview } from '../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { splitLineDeliveryText } from './line-delivery-plan.logic';

/** Domain snapshots are already authorized and calculated. Preserve every line/diff/decimal. */
export function reimbursementPreviewText(preview: LineReimbursementDraftPreview): string {
  const after = preview.after;
  return [preview.operation === 'CREATE' ? 'ตรวจร่างใบเบิกใหม่ (ยังไม่ได้บันทึก)' : 'ตรวจการแก้ร่างใบเบิก (ยังไม่ได้บันทึก)',
    `ผู้เบิก: ${after.requesterDisplayName}`, `สาขา: ${after.branchId}`, `สถานะหลังบันทึก: DRAFT`,
    `หัวเรื่อง: ${after.title ?? '-'}`, `เหตุผล: ${after.reason}`, `เหตุผลที่ไม่มีใบเสร็จ: ${after.missingReceiptReason ?? '-'}`,
    ...after.lines.map(line => [`รายการ ${line.lineNo}: ${line.description}`, `วันที่: ${line.incurredDate} | หมวด: ${line.categoryLabel ?? line.categoryKey}`,
      `วัตถุประสงค์: ${line.purpose ?? '-'}`, `จำนวน: ${line.amount} ${after.currency}`, `หลักฐาน: ${line.attachmentId ?? '-'} | รายจ่ายต้นทาง: ${line.linkedExpenseId ?? '-'}`].join('\n')),
    `ยอดรวมที่ระบบคำนวณ: ${after.amount} ${after.currency}`, `หลักฐาน: ${after.receiptRequirementStatus}`,
    ...(preview.before ? ['การเปลี่ยนแปลงทั้งหมด:', ...preview.diff.map(change => `${change.fieldPath}: ${JSON.stringify(change.before ?? null)} → ${JSON.stringify(change.after ?? null)}`)] : []),
    ...preview.warnings.map(warning => `ข้อควรตรวจ: ${warning}`),
    ...(after.signatureImpact === 'INVALIDATED' ? ['ลายเซ็นเดิมจะใช้ไม่ได้หลังแก้ไข ต้องลงนามใหม่ในเว็บ'] : []),
    'ปุ่มนี้บันทึกเฉพาะ DRAFT ยังไม่ได้ยื่น อนุมัติ จ่ายเงิน หรือลงบัญชี'].join('\n');
}

export function buildReimbursementDraftMessages(result: LineReimbursementDraftResult, webBaseUrl: string, companyId: string): LineReplyMessage[] {
  if (result.status === 'preview') {
    const preview = result.preview, text = reimbursementPreviewText(preview);
    const parts = splitLineDeliveryText(text, 4500);
    const web = `${webBaseUrl.replace(/\/$/u, '')}/companies/${encodeURIComponent(companyId)}/reimbursements/draft-actions/${encodeURIComponent(preview.actionId)}`;
    if (parts.length > 4) return [{ type: 'text', text: `รายละเอียดร่างยาวเกินปุ่มยืนยัน LINE กรุณาตรวจทั้งหมดและยืนยันในเว็บ\n${web}` }];
    const data = (action: string) => new URLSearchParams({ action, actionId: preview.actionId,
      previewRevision: String(preview.previewRevision), confirmationDigest: preview.confirmationDigest }).toString();
    return [...parts.map(part => ({ type: 'text' as const, text: part.text })), { type: 'flex', altText: 'ยืนยันบันทึกร่างใบเบิก', canonicalText: 'ยืนยันบันทึกเฉพาะร่างใบเบิก หรือยกเลิกร่างที่กำลังตรวจ',
      contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'ตรวจครบแล้วจึงยืนยัน', wrap: true }] },
        footer: { type: 'box', layout: 'vertical', contents: [
          { type: 'button', action: { type: 'postback', label: 'บันทึก DRAFT', data: data('reimbursement_draft_confirm') } },
          { type: 'button', action: { type: 'postback', label: 'ยกเลิกร่างนี้', data: data('reimbursement_draft_cancel') } },
        ] } } }];
  }
  if (result.status === 'applied') {
    const r = result.receipt;
    return [{ type: 'text', text: `บันทึกร่างใบเบิกแล้ว\nรหัส: ${String(r.requestId)}\nยอด: ${String(r.amount)} ${String(r.currency)}\nสถานะปัจจุบัน: ${String(r.currentState ?? r.committedState ?? 'DRAFT')}\nยังไม่ได้ยื่น อนุมัติ หรือจ่ายเงินโดยคำสั่งนี้` }];
  }
  const text = result.status === 'needs_fields' ? `ข้อมูลร่างยังไม่ครบ กรุณาระบุ: ${result.fieldPaths.join(', ')}`
    : result.status === 'needs_target' ? 'กรุณาเลือกใบเบิกที่ต้องการแก้ ระบบยังไม่ได้เลือกใบล่าสุดให้อัตโนมัติ'
      : result.status === 'cancelled' ? 'ยกเลิกการเก็บข้อมูลหรือการยืนยันร่างนี้แล้ว ไม่ได้ยกเลิกใบเบิกที่บันทึกไว้'
        : result.status === 'expired' ? 'ร่างที่รอยืนยันหมดอายุแล้ว กรุณาระบุคำขอใหม่'
          : result.status === 'stale' ? 'ข้อมูลหรือสถานะใบเบิกเปลี่ยนแล้ว กรุณาตรวจร่างฉบับปัจจุบันใหม่'
            : result.status === 'result_unknown' ? 'ยังตรวจสอบผลบันทึกไม่ได้ กรุณาตรวจใบเดิมในเว็บ ยังไม่ควรสร้างซ้ำ'
              : `ยังทำรายการใบเบิกไม่ได้ (${result.errorCode})${result.fieldPaths?.length ? `: ${result.fieldPaths.join(', ')}` : ''}`;
  return [{ type: 'text', text }];
}

/** Bounded server choices keep labels visible without turning them into final-mutation controls. */
export function buildReimbursementOptionsMessages(options: { choices: Array<{ kind: string; label: string }>; pages: Partial<Record<string, { hasMore: boolean }>> }): LineReplyMessage[] {
  const names: Record<string, string> = { BRANCH: 'สาขา', REQUESTER: 'ผู้ขอเบิก', CATEGORY: 'หมวดค่าใช้จ่าย', SOURCE: 'รายจ่ายต้นทาง', ATTACHMENT: 'ไฟล์หลักฐาน', TARGET: 'ใบเบิกที่แก้ไขได้', LINE: 'รายการในใบเบิก' };
  const lines = ['ตัวเลือกที่ตรวจสิทธิ์แล้ว กรุณาระบุชื่อที่ต้องการ หากชื่อซ้ำให้ระบุรายละเอียดเพิ่ม'];
  for (const [kind, name] of Object.entries(names)) {
    const choices = options.choices.filter(choice => choice.kind === kind);
    if (!choices.length) continue;
    lines.push(`${name}:`, ...choices.map((choice, index) => `${index + 1}) ${choice.label}`));
    if (options.pages[kind.toLowerCase()]?.hasMore) lines.push('ยังมีตัวเลือกเพิ่มเติม กรุณาระบุคำค้นหรือขอหน้าถัดไป');
  }
  return splitLineDeliveryText(lines.join('\n'), 4500).map(part => ({ type: 'text', text: part.text }));
}
