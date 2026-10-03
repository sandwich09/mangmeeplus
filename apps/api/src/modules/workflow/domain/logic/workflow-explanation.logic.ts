import type { WorkflowActionDefinition, WorkflowActionRunStatus, WorkflowConditionEvalResult, WorkflowTriggerType } from '@watchdog-bms/contracts';

const TRIGGER_LABEL: Record<WorkflowTriggerType, string> = {
  EVENT: 'เหตุการณ์จากส่วนงาน',
  SCHEDULE: 'เวลาที่กำหนด',
  THRESHOLD_SCAN: 'ค่าที่ถึงเกณฑ์',
  SLA_SCAN: 'รายการเกินกำหนด',
  MANUAL_TEST: 'การทดสอบด้วยตนเอง',
  MANUAL_REPLAY: 'การทำรายการซ้ำ',
};

export function summarizeTrigger(triggerType: WorkflowTriggerType, _sourceModule?: string, _sourceType?: string): string {
  return `เริ่มทำงานจาก${TRIGGER_LABEL[triggerType] ?? 'เหตุการณ์อื่น'}`;
}

export function summarizeCondition(result: WorkflowConditionEvalResult): string {
  return result.matched ? 'เงื่อนไขตรงตามที่กำหนด' : 'เงื่อนไขไม่ตรงตามที่กำหนด';
}

const ACTION_LABEL: Record<string, string> = {
  SEND_NOTIFICATION: 'ส่งการแจ้งเตือน',
  CREATE_WORKFLOW_TASK: 'สร้างงาน',
  CREATE_APPROVAL_REVIEW_REQUEST: 'สร้างงานขออนุมัติ',
  REQUEST_AI_DRAFT: 'ขอคำแนะนำจาก AI',
  CREATE_REPORT_EXPORT_DRAFT: 'ขอส่งออกรายงาน',
  CALL_WEBHOOK: 'ส่งข้อมูลไปยังระบบภายนอก',
  ADD_AUDIT_NOTE: 'เพิ่มหมายเหตุในประวัติ',
  NOOP_DISABLED_TEMPLATE: 'ข้ามรายการนี้',
};

const ACTION_STATUS_LABEL: Record<WorkflowActionRunStatus, string> = {
  QUEUED: 'รอดำเนินการ',
  RUNNING: 'กำลังทำงาน',
  SUCCEEDED: 'สำเร็จ',
  FAILED_RETRYABLE: 'ไม่สำเร็จ ระบบจะลองอีกครั้ง',
  FAILED_FINAL: 'ไม่สำเร็จ',
  DEAD_LETTERED: 'ค้างในรายการผิดพลาด',
  SKIPPED: 'ข้าม',
  CANCELED: 'ยกเลิก',
};

export function summarizeAction(action: WorkflowActionDefinition, status: WorkflowActionRunStatus): string {
  const label = ACTION_LABEL[action.actionType] ?? 'ดำเนินการอื่น';
  return `${label} · ${ACTION_STATUS_LABEL[status] ?? 'สถานะอื่น'}`;
}

export function nextActionHint(status: string): string {
  switch (status) {
    case 'FAILED':
    case 'PARTIAL_FAILED':
      return 'ตรวจรายการที่ไม่สำเร็จ แล้วลองทำซ้ำเมื่อสถานะต้นทางยังรองรับ';
    case 'SKIPPED':
      return 'ไม่ต้องทำรายการต่อ เพราะเงื่อนไขไม่ตรงหรือข้อมูลต้นทางยังไม่พร้อม';
    case 'SUCCEEDED':
      return 'ไม่ต้องทำรายการต่อ เพราะระบบทำงานสำเร็จแล้ว';
    default:
      return 'ระบบกำลังทำงาน';
  }
}
