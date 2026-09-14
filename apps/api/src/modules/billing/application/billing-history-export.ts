import { createHash } from 'node:crypto';
import { billingLabel, billingTimelineLabel, type BillingHistoryExport, type BillingMode, type BillingTimeline } from '@watchdog-bms/contracts';
import { safeCsvCell } from '../../../common/export/csv.logic';

/** A fresh, bounded timeline page; not a historical state snapshot or a tax document. */
export function billingHistoryExport(company: { id:string; name:string }, mode:BillingMode|'DISABLED', timeline:BillingTimeline): BillingHistoryExport {
  const exportedAt=new Date().toISOString();
  const headers=['บริษัท','เลขบริษัท','โหมด','เวลาส่งออก (UTC)','รายการ','สถานะล่าสุด','เลขอ้างอิงในระบบ','รหัสประเภทรายการ','รหัสสถานะ','บันทึกเมื่อ (UTC)','เกิดเหตุเมื่อ (UTC)','ปรับปรุงเมื่อ (UTC)','ตรวจผลเมื่อ (UTC)','ช่องทาง',...(timeline.financialIncluded?['ยอดเอกสาร (บาท)']:[])];
  const rows=timeline.items.map(entry=>{const label=billingTimelineLabel(entry);return [company.name,company.id,billingLabel('mode',mode),exportedAt,label.title,label.state,entry.reference,entry.type,entry.state,
    entry.recordedAt,entry.occurredAt,entry.updatedAt,entry.observedAt,entry.origin?billingLabel('channel',entry.origin):'',...(timeline.financialIncluded?[entry.amountSatang===null?'':(entry.amountSatang/100).toFixed(2)]:[])];});
  const csv='\uFEFF'+[headers,...rows].map(row=>row.map(safeCsvCell).join(',')).join('\r\n')+'\r\n';
  return {fileName:`mangmee-billing-history-${exportedAt.replace(/[:.Z]/g,'')}.csv`,csv,rowCount:rows.length,exportedAt,nextCursor:timeline.nextCursor,
    financialIncluded:timeline.financialIncluded,auditIncluded:timeline.auditIncluded,sha256:createHash('sha256').update(csv).digest('hex')};
}
