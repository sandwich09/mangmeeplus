import type { ReportExportRequestDto, ReportExportStatus, ReportFieldType, ReportQueryStatus } from '@watchdog-bms/contracts';
import { formatThaiDate, formatThaiDateTime, formatThaiMonth } from '@/common/i18n/thai-date';

const STATUS_LABELS: Record<ReportExportStatus, string> = {
  QUEUED: 'รอดำเนินการ',
  RUNNING: 'กำลังสร้างไฟล์',
  READY: 'พร้อมดาวน์โหลด',
  FAILED: 'สร้างไฟล์ไม่สำเร็จ',
  EXPIRED: 'หมดอายุแล้ว',
  CANCELLED: 'ยกเลิกแล้ว',
};

export function reportExportStatusText(status: ReportExportStatus): string {
  return STATUS_LABELS[status];
}

export function reportExportErrorText(item: Pick<ReportExportRequestDto, 'errorCode'>, reportsOff = false): string | undefined {
  if (!item.errorCode) return undefined;
  if (item.errorCode === 'legacy_export_not_materialized') {
    return reportsOff
      ? 'ไฟล์เดิมไม่ได้เก็บเนื้อหาไว้ กรุณาติดต่อผู้ดูแลให้เปิดฟีเจอร์รายงานเพื่อสร้างไฟล์ใหม่'
      : 'ไฟล์เดิมไม่ได้เก็บเนื้อหาไว้ กรุณาสร้างไฟล์ CSV ใหม่';
  }
  if (item.errorCode === 'export_format_unavailable') {
    return 'รูปแบบนี้ยังไม่พร้อม กรุณาใช้ CSV';
  }
  if (item.errorCode === 'report_export_expired') {
    return reportsOff
      ? 'ไฟล์หมดอายุแล้ว กรุณาติดต่อผู้ดูแลให้เปิดฟีเจอร์รายงานเพื่อสร้างไฟล์ใหม่'
      : 'ไฟล์หมดอายุแล้ว กรุณาสร้างไฟล์ CSV ใหม่';
  }
  return 'สร้างไฟล์ไม่สำเร็จ กรุณาลองใหม่';
}

const RUN_STATUS_LABELS: Record<ReportQueryStatus, string> = {
  READY: 'พร้อมใช้งาน',
  PARTIAL: 'ข้อมูลบางส่วน',
  EMPTY: 'ไม่มีข้อมูล',
  FORBIDDEN: 'ไม่มีสิทธิ์',
  UNAVAILABLE: 'ยังไม่พร้อม',
  STALE: 'ข้อมูลอาจไม่ล่าสุด',
  INVALID_FILTER: 'ตัวกรองไม่ถูกต้อง',
  FAILED: 'ไม่สำเร็จ',
};

export function reportRunStatusText(status: ReportQueryStatus): string {
  return RUN_STATUS_LABELS[status] ?? 'สถานะอื่น';
}

export function defaultReportViewName(title: string, date = new Date()): string {
  return `${title} ${formatThaiDate(date)}`;
}

export function reportChartKindText(kind: string): string {
  return ({ table: 'ตาราง', kpi: 'ตัวเลขสรุป', bar: 'กราฟแท่ง', line: 'กราฟเส้น', aging_bucket: 'ช่วงอายุหนี้' } as Record<string, string>)[kind] ?? 'รูปแบบอื่น';
}

export function reportFilterOptionText(option: string): string {
  return ({ own: 'รายการของฉัน', all: 'ทุกรายการ' } as Record<string, string>)[option] ?? 'ตัวเลือกอื่น';
}

export function reportViewVisibilityText(visibility: string): string {
  return ({ PRIVATE: 'เฉพาะฉัน', COMPANY: 'ทั้งบริษัท' } as Record<string, string>)[visibility] ?? 'ขอบเขตอื่น';
}

export function reportValueText(value: unknown, type?: ReportFieldType, key?: string): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'periodKey') return formatThaiMonth(value as string, '-');
  if (type === 'date') return formatThaiDate(value as string, '-');
  if (type === 'datetime') return formatThaiDateTime(value as string, '-');
  if (type === 'boolean' && typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
  if (type === 'money') {
    const amount = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(amount)) return `${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
  }
  if (type === 'number') {
    const amount = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(amount)) return amount.toLocaleString('th-TH');
  }
  if (typeof value === 'number') return value.toLocaleString('th-TH');
  return String(value);
}

export function reportFreshnessText(status: 'fresh' | 'stale' | 'unknown'): string {
  return status === 'fresh' ? 'ข้อมูลล่าสุด' : status === 'stale' ? 'ข้อมูลอาจไม่ล่าสุด' : 'ยังตรวจเวลาอัปเดตไม่ได้';
}

export function isReportsFeatureDisabled(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'feature_not_enabled';
}

const WARNING_LABELS: Record<string, string> = {
  source_query_port_not_ready: 'แหล่งข้อมูลนี้ยังไม่พร้อมใช้งาน',
  dataset_adapter_not_registered: 'รายงานนี้ยังไม่พร้อมใช้งาน',
  ledger_control_permission_missing: 'ไม่ได้รวมยอดคุมบัญชี เพราะคุณไม่มีสิทธิ์ดูบัญชีแยกประเภท',
  ledger_control_account_not_found_or_unposted: 'ยังไม่พบบัญชียอดคุมหรือรายการที่ลงบัญชีแล้วสำหรับช่วงนี้',
  ledger_control_mismatch: 'ยอดรายงานต่างจากยอดคุมบัญชี กรุณาให้นักบัญชีตรวจสอบ',
  accounting_documents_scope_forbidden: 'สรุปนี้ไม่รวมเอกสารขาย เพราะคุณไม่มีสิทธิ์ดูส่วนนั้น',
  crm_scope_forbidden: 'สรุปนี้ไม่รวม CRM เพราะคุณไม่มีสิทธิ์ดูส่วนนั้น',
  inventory_valuation_not_available: 'รายงานนี้แสดงจำนวนสินค้า ยังไม่รวมมูลค่าสินค้า',
  workflow_run_scope_forbidden: 'สรุปนี้ไม่รวมประวัติการทำงาน เพราะคุณไม่มีสิทธิ์ดูส่วนนั้น',
  workflow_task_scope_forbidden: 'สรุปนี้ไม่รวมงานค้าง เพราะคุณไม่มีสิทธิ์ดูส่วนนั้น',
  workflow_rule_scope_forbidden: 'สรุปนี้ไม่รวมกฎอัตโนมัติ เพราะคุณไม่มีสิทธิ์ดูส่วนนั้น',
  workflow_dead_letter_scope_forbidden: 'สรุปนี้ไม่รวมรายการที่ทำงานไม่สำเร็จ เพราะคุณไม่มีสิทธิ์ดูส่วนนั้น',
};

export function reportWarningText(warning: string): string {
  if (WARNING_LABELS[warning]) return WARNING_LABELS[warning];
  return /[ก-๙]/.test(warning)
    ? warning
    : 'รายงานนี้มีข้อมูลบางส่วน กรุณาตรวจสอบขอบเขตข้อมูลและสิทธิ์ของคุณ';
}
