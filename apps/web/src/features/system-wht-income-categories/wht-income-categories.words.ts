import type { WhtIncomeCategory } from './wht-income-categories.api';

export const W = {
  title: 'ประเภทเงินได้หัก ณ ที่จ่าย',
  description: 'เปิด–ปิดประเภทเงินได้สำหรับทุกร้าน ชื่อและอัตราภาษีแก้ไขจากหน้านี้ไม่ได้',
  name: 'ประเภทเงินได้',
  form: 'แบบยื่นภาษี',
  rate: 'อัตราเริ่มต้น',
  status: 'สถานะ',
  action: 'เปิด–ปิด',
  enable: 'เปิดใช้',
  disable: 'ปิดใช้',
  confirm: 'ยืนยัน',
  cancel: 'ยกเลิก',
  saved: 'บันทึกแล้ว',
  loading: 'กำลังโหลดประเภทเงินได้…',
  empty: 'ยังไม่มีประเภทเงินได้ในระบบ',
  noActive: 'ยังไม่มีประเภทเงินได้ที่เปิดใช้งาน กรุณาติดต่อทีมมั่งมีเพื่อตรวจสอบและเปิดใช้ก่อนบันทึกหัก ณ ที่จ่าย',
  accessHelp: 'กรุณาติดต่อทีมมั่งมีเพื่อตรวจสอบสิทธิ์',
  loadFailed: 'โหลดประเภทเงินได้ไม่สำเร็จ กรุณาลองใหม่',
  saveFailed: 'ยังยืนยันผลการบันทึกไม่ได้ กรุณาโหลดข้อมูลใหม่ก่อนเปลี่ยนสถานะอีกครั้ง',
  unknown: 'ยังไม่ทราบสถานะ',
  unknownForm: 'ยังไม่ทราบแบบยื่นภาษี',
  forms: { PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' },
  statuses: { ACTIVE: 'เปิดใช้งาน', DRAFT: 'ยังไม่เปิดใช้งาน', RETIRED: 'เลิกใช้งาน' },
} as const;

export const formLabel = (form: string) => W.forms[form as keyof typeof W.forms] ?? W.unknownForm;
export const statusLabel = (status: string) => W.statuses[status as keyof typeof W.statuses] ?? W.unknown;
export const rateLabel = (rate: string) => `${Number(rate).toLocaleString('th-TH', { maximumFractionDigits: 4 })}%`;

export function confirmation(row: WhtIncomeCategory, enable: boolean): string {
  const identity = `${row.nameTh} · ${formLabel(row.formType)} · ${W.rate} ${rateLabel(row.defaultRate)}`;
  // Issuance copies the saved payment rate, which AP may override; do not promise the catalog default.
  return enable
    ? `${W.enable} ${identity} สำหรับทุกร้านใช่หรือไม่? ร้านจะเลือกประเภทเงินได้นี้ได้ โดยระบบเสนออัตราเริ่มต้นข้างต้น หนังสือรับรอง 50 ทวิทุกใบของประเภทเงินได้นี้ที่ออกหลังจากนี้ใช้อัตราจากรายการจ่ายที่บันทึกไว้ เอกสารที่ออกแล้วไม่เปลี่ยน`
    : `${W.disable} ${identity} สำหรับทุกร้านใช่หรือไม่? ร้านจะเลือกประเภทเงินได้นี้สำหรับรายการใหม่ไม่ได้ รายการจ่ายและเอกสารที่บันทึกแล้วไม่เปลี่ยน`;
}
