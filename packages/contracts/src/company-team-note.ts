/** Platform-only, live company note. Owner decision COMPANY-TEAM-NOTE, 2026-10-04. */
export const COMPANY_TEAM_NOTE_MAX_LENGTH = 1_000;
export const COMPANY_TEAM_NOTE_MANAGE_PERMISSION = 'system.executive.company_note.manage';

export type CompanyTeamNoteDto = {
  companyId: string;
  text: string;
  version: number;
  updatedAt: string | null;
  updatedBy: { userId: string; displayName: string } | null;
  canManage: boolean;
};
export type PutCompanyTeamNoteBody = { text: string; expectedVersion: number };

/** Admin and executive screens/API share every system-authored word about the note. */
export const COMPANY_TEAM_NOTE_WORDS = {
  title: 'หมายเหตุของทีมมั่งมี',
  description: 'หมายเหตุภายในทีมมั่งมี ใช้ร่วมกันกับรายงานผู้บริหาร',
  empty: 'ยังไม่มีหมายเหตุ',
  loading: 'กำลังโหลดหมายเหตุ',
  loadFailed: 'ยังโหลดหมายเหตุไม่ได้ กรุณาลองใหม่',
  edit: 'แก้ไขหมายเหตุ',
  save: 'บันทึกหมายเหตุ',
  cancel: 'ยกเลิก',
  reload: 'โหลดข้อมูลล่าสุด',
  reloadDiscard: 'โหลดล่าสุดและทิ้งร่างนี้',
  saved: 'บันทึกหมายเหตุแล้ว',
  readOnly: 'คุณอ่านหมายเหตุได้ แต่ยังไม่มีสิทธิ์แก้ไข',
  denied: 'คุณไม่มีสิทธิ์อ่านหมายเหตุของทีมมั่งมี',
  editDenied: 'คุณไม่มีสิทธิ์แก้ไขหมายเหตุของทีมมั่งมี',
  conflict: 'หมายเหตุมีการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง',
  saveUnknown: 'ยังยืนยันผลการบันทึกไม่ได้ กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง',
  invalid: 'ข้อมูลหมายเหตุไม่ถูกต้อง กรุณาโหลดข้อมูลล่าสุดแล้วตรวจสอบอีกครั้ง',
  tooLong: `หมายเหตุยาวได้ไม่เกิน ${COMPANY_TEAM_NOTE_MAX_LENGTH.toLocaleString('th-TH')} ตัวอักษร`,
  notFound: 'ไม่พบบริษัทนี้',
  unknownEditor: 'ไม่พบข้อมูลผู้แก้ไข',
  lastChanged: (name: string, time: string) => `แก้ล่าสุดโดย ${name} เมื่อ ${time}`,
  count: (length: number) => `${length.toLocaleString('th-TH')} / ${COMPANY_TEAM_NOTE_MAX_LENGTH.toLocaleString('th-TH')} ตัวอักษร`,
  permissionDescription: 'แก้ไขหมายเหตุของทีมมั่งมีในรายงานผู้บริหาร',
  roleName: 'สิทธิ์แก้ไขหมายเหตุสำหรับผู้บริหาร',
  roleDescription: 'สิทธิ์เพิ่มเติมสำหรับแก้ไขหมายเหตุของทีมมั่งมี',
} as const;
