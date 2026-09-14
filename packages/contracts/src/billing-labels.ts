import { PLAN_TIER_PRESETS, type PlanTierKey } from './plan-term.js';
import type { BillingTimelineEntry } from './billing.js';

const labels: Record<'mode'|'channel'|'company'|'payment'|'apply'|'access'|'subscription'|'delivery'|'event'|'issue'|'operation'|'document'|'priority'|'scope'|'tax'|'attempt'|'quote', Record<string,string>> = {
  priority: { NORMAL:'ปกติ', HIGH:'เร่งด่วน', CRITICAL:'เร่งด่วนมาก' },
  scope: { ACTIVE:'ดูแลบริษัทนี้ได้', EXPIRED:'สิทธิ์ดูแลบริษัทหมดอายุ', REVOKED:'ถอนสิทธิ์ดูแลบริษัทแล้ว' },
  tax: { NOT_VAT_REGISTERED:'ยังไม่จด VAT', INCLUSIVE_VAT_7:'รวม VAT 7% ในราคา', EXCLUSIVE_VAT_7:'บวก VAT 7% จากราคา' },
  attempt: { CREATING:'กำลังสร้างรายการชำระ', REQUESTING:'กำลังขอรายการชำระ', OPEN:'รอชำระเงิน', PAID:'ชำระแล้ว รอตรวจการเปิดสิทธิ์', APPLYING:'กำลังเปิดสิทธิ์', COMPLETED:'ทำรายการครบแล้ว ต้องตรวจผลจ่าย', EXPIRED:'รายการซื้อหมดอายุ', FAILED:'สร้างรายการซื้อไม่สำเร็จ', UNKNOWN:'ยังยืนยันผลซื้อไม่ได้' },
  quote: { UNUSED:'ยังไม่ได้ใช้ชำระเงิน' },
  mode: { TEST:'โหมดทดสอบ · ไม่มีการรับเงินจริง', LIVE:'โหมดรับเงินจริง', DISABLED:'ยังไม่เปิดการชำระเงิน' },
  channel: { WEB:'เว็บ', LINE:'LINE', EMAIL:'อีเมล', ERP:'ระบบมั่งมี' },
  company: { ACTIVE:'บริษัทเปิดใช้งาน', DISABLED:'บริษัทพักใช้งาน', PENDING:'รอตรวจบริษัท' },
  payment: { PAID:'ชำระแล้ว', PENDING:'รอยืนยันการชำระ', UNKNOWN:'ยังยืนยันผลชำระไม่ได้', FAILED:'เรียกเก็บเงินไม่สำเร็จ', NONE:'ยังไม่มีรายการชำระ',
    OPEN:'รอชำระเงิน', DRAFT:'ใบแจ้งหนี้ฉบับร่าง', VOID:'ยกเลิกใบแจ้งหนี้แล้ว', UNCOLLECTIBLE:'ใบแจ้งหนี้ที่ต้องตรวจหนี้ค้าง' },
  apply: { APPLIED:'เปิดสิทธิ์แล้ว', PENDING:'รอเปิดสิทธิ์', HELD:'ต้องตรวจสอบก่อนเปิดสิทธิ์', FAILED:'เปิดสิทธิ์ไม่สำเร็จ', NONE:'ยังไม่มีรายการให้เปิดสิทธิ์' },
  access: { ACTIVE:'ใช้งานได้', EXPIRED:'ครบกำหนดใช้งานแล้ว', HELD:'พักใช้งานเพื่อตรวจสอบ', GRACE:'อยู่ในระยะผ่อนผัน' },
  subscription: { ACTIVE:'สถานะสมาชิกปกติ', TRIALING:'อยู่ในช่วงทดลอง', PAST_DUE:'ต่ออายุไม่สำเร็จ', UNPAID:'มีค่าต่ออายุค้างชำระ',
    CANCELED:'หยุดต่ออายุแล้ว', INCOMPLETE:'รอชำระเพื่อเริ่มสมาชิก', INCOMPLETE_EXPIRED:'รายการเริ่มสมาชิกหมดอายุ', PAUSED:'พักสมาชิก', NONE:'ยังไม่มีสมาชิก Stripe' },
  delivery: { PENDING:'รอส่ง', READY:'พร้อมส่ง', QUEUED:'รอส่ง', PROCESSING:'กำลังส่ง', SENDING:'กำลังส่ง', SENT:'ผู้ให้บริการรับคำขอแล้ว',
    ACCEPTED:'ผู้ให้บริการรับคำขอแล้ว', UNKNOWN:'ยังยืนยันผลส่งไม่ได้', RETRY:'รอลองส่งอีกครั้ง', FAILED:'ส่งไม่สำเร็จ', DEAD:'หยุดรอเจ้าหน้าที่ตรวจ',
    SKIPPED:'ยังไม่ส่งตามเงื่อนไข', SUPPRESSED:'พักส่งถึงผู้รับนี้', CONFIG:'ต้องแก้การเชื่อมต่อ', PERMANENT:'ต้องแก้ข้อมูลก่อนส่งใหม่', OBSERVED:'ตรวจผลเดิมก่อนส่งใหม่' },
  event: { PENDING:'รอตรวจเหตุการณ์', PROCESSING:'กำลังตรวจเหตุการณ์', PROCESSED:'ตรวจเหตุการณ์แล้ว', FAILED:'ตรวจเหตุการณ์ไม่สำเร็จ',
    RETRY:'รอตรวจเหตุการณ์อีกครั้ง', DEAD:'หยุดรอเจ้าหน้าที่ตรวจ', IGNORED:'ข้ามตามเงื่อนไข', RECEIVED:'รับเหตุการณ์แล้ว', UNKNOWN:'ยังยืนยันผลตรวจไม่ได้' },
  issue: { OPEN:'รอรับงาน', ASSIGNED:'รับงานแล้ว', IN_PROGRESS:'กำลังดำเนินการ', WAITING_PROVIDER:'รอผู้ให้บริการ', WAITING_APPROVAL:'รออนุมัติ',
    WAITING_CUSTOMER:'รอลูกค้า', VERIFYING:'กำลังตรวจผล', RESOLVED:'แก้ไขแล้ว' },
  operation: { DRAFT:'ฉบับร่าง', PREVIEW:'รอยืนยัน', QUEUED:'รอระบบดำเนินการ', RUNNING:'กำลังดำเนินการ', SUCCEEDED:'ดำเนินคำสั่งแล้ว',
    UNKNOWN:'ยังยืนยันผลไม่ได้', FAILED:'ดำเนินการไม่สำเร็จ', BLOCKED:'ต้องตรวจเงื่อนไขก่อนทำต่อ', CANCELLED:'ยกเลิกคำสั่งแล้ว',
    AWAITING_APPROVAL:'รออนุมัติ', WAITING_APPROVAL:'รออนุมัติ', APPROVED:'อนุมัติแล้ว', SCHEDULED:'รอวันเริ่มใช้', SUCCESS:'บันทึกสำเร็จ', FAILURE:'บันทึกไม่สำเร็จ', DENIED:'ไม่ผ่านสิทธิ์', MISSING:'ไม่พบคำสั่งเดิม ต้องตรวจสอบ' },
  document: { PENDING:'ตรวจเอกสารเมื่อขอเปิด', AVAILABLE:'พร้อมเปิดเอกสาร', NONE:'ยังไม่มีเอกสาร' },
};
export function billingLabel(kind: keyof typeof labels, value: string | null | undefined): string {
  return value ? labels[kind][value.toUpperCase()] ?? 'ต้องตรวจสอบสถานะ' : 'ยังไม่มีข้อมูล';
}
export function billingPlanLabel(value: string | null | undefined): string {
  return value && Object.hasOwn(PLAN_TIER_PRESETS,value) ? PLAN_TIER_PRESETS[value as PlanTierKey].labelTh : 'ยังไม่ได้กำหนดแพ็กเกจ';
}
export function billingOfferLabel(value:string):string {
  const [tier,interval]=value.split(':');
  return billingPlanLabel(tier)+(interval==='year'?' · รายปี':interval==='month'?' · รายเดือน':'');
}
const permissionNames:Record<string,string>={read:'ดูข้อมูลการชำระเงิน','financial.read':'ดูยอดเงิน','document.read':'เปิดเอกสารการชำระเงิน','issue.manage':'ดูแลเคส',
  'reconcile.run':'ตรวจสถานะกับผู้ให้บริการ','apply.retry':'ตรวจการเปิดสิทธิ์จากยอดชำระเดิม','policy.manage':'ตั้งนโยบาย','gate.manage':'เปิด–ปิดบริการ',
  'approval.approve':'อนุมัติคำขอ','notification.retry':'กู้คืนการส่งข้อความ','collection.manage':'จัดการต่ออายุ','refund.manage':'จัดการคำขอคืนเงิน',
  'override.manage':'จัดการสิทธิ์ชั่วคราว','audit.read':'ดูประวัติการดำเนินการ',export:'ส่งออกข้อมูล'};
export function billingPermissionLabel(value:string):string {
  const key=value.replace(/^system\.billing\./,'');
  return Object.hasOwn(permissionNames,key)?permissionNames[key]!:'สิทธิ์อื่นที่ต้องตรวจสอบ';
}
export function billingEventLabel(value:string):string {
  if(value.startsWith('checkout.session.'))return 'แจ้งสถานะหน้าชำระเงิน';
  if(value.startsWith('invoice.'))return 'แจ้งสถานะใบแจ้งหนี้';
  if(value.startsWith('customer.subscription.'))return 'แจ้งสถานะสมาชิก';
  if(value.startsWith('charge.dispute.'))return 'แจ้งสถานะข้อพิพาท';
  if(value==='charge.refunded'||value.startsWith('refund.'))return 'แจ้งสถานะคืนเงิน';
  return 'เหตุการณ์ที่ต้องตรวจสอบ';
}
export function billingDeliveryLabel(value: string, channel?: string, confirmed = false): string {
  if (channel === 'WEB' && value === 'SENT') return 'บันทึกบนเว็บแล้ว';
  if (channel === 'EMAIL' && confirmed && ['ACCEPTED','SENT'].includes(value)) return 'เซิร์ฟเวอร์ปลายทางรับอีเมลแล้ว';
  return billingLabel('delivery',value);
}
const issueKinds: Record<string,string> = {
  CONFIG_DRIFT:'การตั้งค่าหน้าแก้บัตรต้องตรวจสอบ', CONFIGURATION_DRIFT:'การตั้งค่า Stripe ต้องตรวจสอบ', CONFIGURATION_SCHEDULE_REVIEW:'คำขอตั้งค่าตามกำหนดต้องตรวจใหม่',
  PROVIDER_INVOICE_REVIEW:'ต้องตรวจความต่างของใบแจ้งหนี้ Stripe', PROVIDER_INVOICE_SCAN_FAILED:'งานตรวจใบแจ้งหนี้ยังไม่สำเร็จ',
  PROVIDER_SCAN_SCHEDULE_BLOCKED:'ต้องตรวจการตั้งค่ารอบตรวจ Stripe', PROVIDER_SCAN_COVERAGE_GAP:'มีช่วงเหตุการณ์ Stripe ที่ยังตรวจไม่ครบ',
  SETTLEMENT_REVIEW:'ยอด Stripe มีรายการที่ต้องตรวจแยก',SETTLEMENT_SCAN_FAILED:'งานตรวจยอด Stripe ยังไม่จบ',
  PROVIDER_SCAN_FAILED:'งานตรวจ Stripe ยังไม่สำเร็จ', PROVIDER_SCAN_VERSION_UNSUPPORTED:'เหตุการณ์ Stripe ใช้รุ่นข้อมูลที่ยังไม่รองรับ',
  CONTROL_OPERATION_REVIEW:'คำสั่งเดิมต้องตรวจสอบ', CUSTOMER_COLLECTION_REVIEW:'ต้องตรวจคำสั่งต่ออายุ', DUPLICATE_SUBSCRIPTION:'พบสมาชิก Stripe ซ้ำ',
  FINANCIAL_REVIEW:'ต้องตรวจยอดเงินหรือข้อพิพาท', GRACE_CANCELLATION_UNKNOWN:'ยังยืนยันการหยุดต่ออายุหลังผ่อนผันไม่ได้',
  NOTIFICATION_RECIPIENT_CHANGED:'ผู้รับแจ้งเตือนเปลี่ยน', NOTIFICATION_REVIEW:'ต้องตรวจการส่งแจ้งเตือน', PAID_HELD:'ชำระแล้วแต่ยังติดเงื่อนไขเปิดสิทธิ์',
  PAID_NOT_APPLIED:'ชำระแล้วแต่ยังไม่เปิดสิทธิ์', PROVIDER_EVENT_FAILED:'ตรวจเหตุการณ์ Stripe ไม่สำเร็จ', RECONCILIATION_FAILED:'ตรวจสถานะล่าสุดไม่สำเร็จ',
  REFUND_FAILED:'คืนเงินไม่สำเร็จ', RENEWAL_REVIEW:'ต้องตรวจรายการต่ออายุ', REPEAT_RECOVERY:'ต้องตรวจรายการซื้อซ้ำเดิม',
  UNKNOWN_ATTEMPT:'ยังยืนยันผลรายการซื้อเดิมไม่ได้', ZERO_INVOICE_REVIEW:'ต้องตรวจใบแจ้งหนี้ยอดศูนย์',
};
export const billingIssueLabel = (value:string) => Object.hasOwn(issueKinds,value)?issueKinds[value]!:'รายการที่ต้องตรวจสอบ';
const operationKinds: Record<string,string> = {
  EXPIRE_CHECKOUT:'ตรวจและยุติหน้าชำระเดิม', RECONCILE:'ตรวจสถานะล่าสุด', IMPORT_INVOICE:'บันทึกใบแจ้งหนี้เดิม', RETRY_APPLY:'ตรวจการเปิดสิทธิ์จากยอดชำระเดิม', RETRY_NOTIFICATION:'นำข้อความเดิมกลับเข้าคิว',
  RECONCILE_NOTIFICATION:'ตรวจผลส่งข้อความเดิม', RETRY_PROVIDER_EVENT:'ตรวจเหตุการณ์ Stripe เดิม', CHANGE_COLLECTION:'จัดการต่ออายุ',
  SCHEDULE_DOWNGRADE:'ตั้งเวลาลดแพ็กเกจ', CANCEL_DOWNGRADE:'ยกเลิกการลดแพ็กเกจ', CANCEL_COLLECTION:'หยุดต่ออายุ', RESUME_COLLECTION:'เปิดต่ออายุอีกครั้ง',
  SCAN_PROVIDER_INVOICES:'ตรวจประวัติใบแจ้งหนี้ Stripe', RECORD_SUPPORT_OUTCOME:'บันทึกผลติดต่อ', PUBLISH_POLICY:'เปลี่ยนนโยบายการชำระเงิน',
  SET_ACTION_GATE:'เปลี่ยนการเปิดบริการ', CHECK_PROVIDER_CONFIGURATION:'ตรวจการเชื่อมต่อ Stripe', REFUND:'คืนเงิน', GRANT_OVERRIDE:'ให้สิทธิ์ชั่วคราว', REVOKE_OVERRIDE:'ถอนสิทธิ์ชั่วคราว',
};
export function billingTimelineLabel(entry: BillingTimelineEntry): {title:string;state:string} {
  if (entry.kind === 'PLAN_TERM') return {title:'แพ็กเกจปัจจุบัน',state:billingPlanLabel(entry.state)};
  if (entry.kind === 'INVOICE') { const [paid,applied] = entry.state.split(' / '); return {title:'ใบแจ้งหนี้',state:billingLabel('payment',paid)+' · '+billingLabel('apply',applied)}; }
  if (entry.kind === 'DELIVERY') return {title:'แจ้งเตือนทาง'+billingLabel('channel',entry.type),state:billingDeliveryLabel(entry.state,entry.type)};
  if (entry.kind === 'ISSUE') return {title:billingIssueLabel(entry.type),state:billingLabel('issue',entry.state)};
  if (entry.kind === 'PROVIDER_EVENT') return {title:'เหตุการณ์จาก Stripe',state:billingLabel('event',entry.state)};
  if (entry.kind === 'ATTEMPT') return {title:'รายการซื้อแพ็กเกจ',state:billingLabel('attempt',entry.state)};
  if (entry.kind === 'AUDIT') return {title:'บันทึกการดำเนินการ',state:billingLabel('operation',entry.state)};
  return {title:Object.hasOwn(operationKinds,entry.type)?operationKinds[entry.type]!:'คำสั่งเกี่ยวกับการชำระเงิน',state:entry.type==='SCAN_PROVIDER_INVOICES'&&entry.state==='SUCCEEDED'?'ตรวจครบช่วงที่เลือก':entry.type==='RECORD_SUPPORT_OUTCOME'&&entry.state==='SUCCEEDED'?'บันทึกแล้ว':billingLabel('operation',entry.state)};
}
