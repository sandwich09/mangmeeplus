export const TEMPLATE_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'พร้อมใช้งาน',
  UNAVAILABLE: 'ยังใช้งานไม่ได้',
  DEPRECATED: 'เลิกใช้',
};

export const RULE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ร่าง',
  ENABLED: 'เปิดใช้งาน',
  DISABLED: 'ปิดใช้งาน',
  ARCHIVED: 'เก็บถาวร',
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: 'รอดำเนินการ',
  RUNNING: 'กำลังทำงาน',
  SUCCEEDED: 'สำเร็จ',
  PARTIAL_FAILED: 'สำเร็จบางส่วน',
  FAILED: 'ล้มเหลว',
  SKIPPED: 'ข้าม',
  CANCELED: 'ยกเลิก',
};

export const ACTION_RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: 'รอดำเนินการ',
  RUNNING: 'กำลังทำงาน',
  SUCCEEDED: 'สำเร็จ',
  FAILED_RETRYABLE: 'ล้มเหลว (จะลองใหม่)',
  FAILED_FINAL: 'ล้มเหลว',
  DEAD_LETTERED: 'ค้างในคิวข้อผิดพลาด',
  SKIPPED: 'ข้าม',
  CANCELED: 'ยกเลิก',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  OPEN: 'เปิดอยู่',
  SNOOZED: 'เลื่อนแจ้งเตือน',
  DONE: 'เสร็จสิ้น',
  CANCELED: 'ยกเลิก',
};

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  LOW: 'ต่ำ',
  NORMAL: 'ปานกลาง',
  HIGH: 'สูง',
  CRITICAL: 'เร่งด่วน',
};

export const DEAD_LETTER_RESOLUTION_LABELS: Record<string, string> = {
  OPEN: 'ยังไม่แก้ไข',
  REPLAYED: 'ลองใหม่แล้ว',
  IGNORED: 'ละเว้น',
  RESOLVED_EXTERNALLY: 'แก้ไขจากภายนอก',
};

export const STATUS_BADGE_COLORS: Record<string, string> = {
  AVAILABLE: 'bg-green-100 text-green-700',
  UNAVAILABLE: 'bg-gray-100 text-gray-500',
  DRAFT: 'bg-gray-100 text-gray-700',
  ENABLED: 'bg-green-100 text-green-700',
  DISABLED: 'bg-gray-100 text-gray-600',
  ARCHIVED: 'bg-gray-100 text-gray-400',
  QUEUED: 'bg-gray-100 text-gray-600',
  RUNNING: 'bg-blue-100 text-blue-700',
  SUCCEEDED: 'bg-green-100 text-green-700',
  PARTIAL_FAILED: 'bg-orange-100 text-orange-700',
  FAILED: 'bg-red-100 text-red-700',
  FAILED_RETRYABLE: 'bg-orange-100 text-orange-700',
  FAILED_FINAL: 'bg-red-100 text-red-700',
  DEAD_LETTERED: 'bg-red-100 text-red-800',
  SKIPPED: 'bg-gray-100 text-gray-500',
  CANCELED: 'bg-gray-100 text-gray-500',
  OPEN: 'bg-yellow-100 text-yellow-800',
  SNOOZED: 'bg-blue-100 text-blue-700',
  DONE: 'bg-green-100 text-green-700',
  REPLAYED: 'bg-blue-100 text-blue-700',
  IGNORED: 'bg-gray-100 text-gray-500',
  RESOLVED_EXTERNALLY: 'bg-gray-100 text-gray-500',
};

export const PRIORITY_BADGE_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  NORMAL: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-orange-100 text-orange-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  EVENT: 'เหตุการณ์',
  SCHEDULE: 'ตามกำหนดเวลา',
  THRESHOLD_SCAN: 'ตรวจสอบเกณฑ์',
  SLA_SCAN: 'ตรวจสอบ SLA',
  MANUAL_TEST: 'ทดสอบ',
  MANUAL_REPLAY: 'ทำซ้ำ',
};
