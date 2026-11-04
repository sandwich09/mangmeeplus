import { formatCompanyLegalAddress, type CompanyLegalAddress } from './company-tax-identity.js';
import { executiveMonthLabel } from './executive-report-words.js';
import type { AccountingOutputTaxCode } from './accounting-documents.js';

export const WHT_CERTIFICATE_CORRECTION_WORDS = {
  fieldLocked: 'แก้ยอด อัตรา รายการที่จ่าย หรือเลขผู้เสียภาษีที่รายจ่ายด้วย “แก้ไขเอกสาร”',
  numberDuplicate: 'ออกหนังสือรับรองไม่สำเร็จเพราะเลขที่เอกสารซ้ำ ลองอีกครั้ง ถ้ายังไม่สำเร็จ ให้แจ้งทีมงานมั่งมีพร้อมเลขที่เอกสารรายจ่ายนี้',
  noChanges: 'ข้อมูลตรงกับหนังสือรับรองใบปัจจุบันอยู่แล้ว จึงไม่มีอะไรต้องแก้ไข ถ้าเพิ่งกดแก้ไขไป การแก้ไขครั้งนั้นอาจบันทึกแล้ว เปิดหน้านี้ใหม่',
  payeeAddressRequired: 'ยังไม่มีที่อยู่ผู้รับเงิน พิมพ์ที่อยู่ในแบบฟอร์มนี้ก่อนบันทึก',
  payeeNameRequired: 'ชื่อผู้รับเงินบนหนังสือรับรองว่างไม่ได้ ใส่ชื่อผู้รับเงิน',
} as const;

export const WHT_PRINT_CERTIFICATE_LABEL = 'ออกหนังสือรับรอง 50 ทวิ';
export const WHT_PRINT_CERTIFICATE_BUSY_LABEL = 'กำลังออกหนังสือรับรอง…';
export const WHT_HANDOFF_PAYEE_ADDRESS_MISSING_MESSAGE = `ยังไม่มีที่อยู่ผู้รับเงิน เพิ่มที่อยู่ผู้รับเงินก่อน แล้วกด “${WHT_PRINT_CERTIFICATE_LABEL}” อีกครั้ง`;

/** The address printed on a certificate: a typed override, then the frozen payee snapshot. */
export function whtPayeeAddress(typedAddress: string | null | undefined, snapshotAddress: string | null | undefined): string | null {
  return typedAddress?.trim() || snapshotAddress?.trim() || null;
}

export type WhtPayerMissing = 'REGISTERED_NAME' | 'TAX_ID' | 'ADDRESS';

function printablePayerAddress(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  if (!value.trim().startsWith('{')) return true;
  try { return Boolean(formatCompanyLegalAddress(JSON.parse(value) as CompanyLegalAddress)); } catch { return false; }
}

/** Legacy snapshots cannot prove the origin of companyName: use the current registered name for issuance. Frozen tax/address facts remain authoritative. */
export function whtPayerIdentity(frozen: PayerSnapshot, current: { registeredName: string | null; taxId: string | null; address: string | null }): { payer: PayerSnapshot; missing: WhtPayerMissing[] } {
  const payer = { ...frozen, companyName: current.registeredName?.trim() || '', taxId: /^\d{13}$/.test(frozen?.taxId?.trim() ?? '') ? frozen.taxId : current.taxId,
    address: printablePayerAddress(frozen?.address) ? frozen.address : current.address };
  return { payer, missing: [
    ...(!payer.companyName ? ['REGISTERED_NAME' as const] : []),
    ...(!/^\d{13}$/.test(payer.taxId?.trim() ?? '') ? ['TAX_ID' as const] : []),
    ...(!printablePayerAddress(payer.address) ? ['ADDRESS' as const] : []),
  ] };
}

export function whtPayerMissingLabel(missing: readonly WhtPayerMissing[]): string {
  const words = [missing.includes('REGISTERED_NAME') && 'ชื่อจดทะเบียน', missing.includes('TAX_ID') && 'เลขผู้เสียภาษี', missing.includes('ADDRESS') && 'ที่อยู่'].filter(Boolean);
  return `${words.length === 3 ? `${words[0]} ${words[1]} และ${words[2]}` : words.join('และ')}ของร้าน`;
}

export function whtPayerIdentityMissingMessage(missing: readonly WhtPayerMissing[]): string {
  return `ยังไม่มี${whtPayerMissingLabel(missing)} กรอกในหน้าข้อมูลร้านก่อน แล้วกด “${WHT_PRINT_CERTIFICATE_LABEL}” อีกครั้ง`;
}

export const WHT_REMITTANCES = ['PAYER_FILES', 'E_WHT'] as const;
export type WhtRemittance = (typeof WHT_REMITTANCES)[number];

export const E_WHT_REDUCED_RATE = {
  ratePercent: '1',
  windows: [
    { from: '2023-01-01', to: '2025-12-31', source: 'https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr389.pdf' },
    { from: '2026-01-01', to: '2027-12-31', source: 'https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr402.docx' },
  ],
  reduced: ['WHT_SERVICE_3', 'WHT_SERVICE_5', 'WHT_RENT_IND', 'WHT_RENT_JUR', 'WHT_PROFESSIONAL_IND', 'WHT_PROFESSIONAL_JUR',
    'WHT_ADVERTISING_IND', 'WHT_ADVERTISING_JUR', 'WHT_PRIZE', 'WHT_PRIZE_JUR'],
  unknown: ['WHT_OTHER_IND', 'WHT_OTHER_JUR'],
} as const;

export function eWhtRateKind(code?: string | null): 'REDUCED' | 'NOT_REDUCED' | 'UNKNOWN' {
  if (!code || (E_WHT_REDUCED_RATE.unknown as readonly string[]).includes(code)) return 'UNKNOWN';
  return (E_WHT_REDUCED_RATE.reduced as readonly string[]).includes(code) ? 'REDUCED' : 'NOT_REDUCED';
}

export function eWhtReducedRateOn(code: string | null | undefined, civilDate: string): '1' | null {
  return eWhtRateKind(code) === 'REDUCED' && E_WHT_REDUCED_RATE.windows.some(({ from, to }) => civilDate >= from && civilDate <= to)
    ? E_WHT_REDUCED_RATE.ratePercent : null;
}

export function eWhtPaymentMethodAllowed(method?: string | null): boolean {
  return method !== 'CASH' && method !== 'CARD';
}

const eWhtExplanation = 'จ่ายผ่านบริการ e-WHT ของธนาคาร ธนาคารจะนำส่งภาษีให้ ร้านไม่ต้องยื่น ภ.ง.ด.3/53 และไม่ต้องออก 50 ทวิสำหรับการจ่ายนั้นค่ะ 😊 ค่าบริการ ค่าเช่า ค่าวิชาชีพ ค่าโฆษณา และรางวัล ที่จ่ายถึง 31 ธ.ค. 2570 หัก 1% (มีข้อยกเว้นบางกรณี) ในรายจ่ายให้เลือก “ธนาคารนำส่ง (e-WHT)” (ร้านที่ยังไม่เห็นตัวเลือกนี้ ให้ผู้ดูแลร้านเปิดใช้ที่ ตั้งค่าร้าน > จ่ายผ่าน e-WHT ของธนาคาร ก่อน) ผู้รับเงินตรวจหลักฐานได้ที่เว็บกรมสรรพากรค่ะ';

// Spec §10.1: sentence IDs keep the web, API, LINE and guide on the same approved words.
export const E_WHT_WORDS = {
  'S-1': 'จ่ายผ่าน e-WHT ของธนาคาร',
  'S-2': 'ร้านสมัครหักภาษีผ่านธนาคารไว้หรือไม่',
  'S-3': 'ร้านสมัครบริการ e-WHT กับธนาคารไว้หรือเปล่า',
  'S-4': { no: 'ยังไม่ได้สมัคร', yes: 'สมัครแล้ว' },
  'S-5': 'เลือก “สมัครแล้ว” รายจ่ายที่หักภาษีจะมีตัวเลือก “ธนาคารนำส่ง (e-WHT)”',
  'S-6': 'บันทึกแล้ว เลือก “ธนาคารนำส่ง (e-WHT)” ได้ในรายจ่ายที่หักภาษี',
  'S-7': 'บันทึกแล้ว รายจ่ายที่บันทึกไว้แล้วไม่เปลี่ยน',

  'S-8': 'ร้านยังไม่ได้เปิดใช้ e-WHT ให้ผู้ดูแลร้านเปิดที่ ตั้งค่าร้าน หรือเลือก “ร้านยื่นแบบเอง”',
  'W-F1': 'นำส่งภาษีอย่างไร',
  'W-F2': 'ร้านยื่นแบบเอง',
  'W-F3': 'ธนาคารนำส่ง (e-WHT)',
  'W-F4': 'ธนาคารนำส่งภาษีให้ ไม่ต้องยื่นแบบและไม่ต้องออก 50 ทวิสำหรับรายการนี้',
  'W-F5': 'อัตรา e-WHT 1% · ค่าบริการโรงแรม ภัตตาคาร และเบี้ยประกันชีวิตไม่อยู่ในประเภทนี้',
  'W-F6': 'อัตรา e-WHT 1%',
  'W-F7': 'ประเภทนี้ไม่ลดอัตราเมื่อจ่ายผ่าน e-WHT',
  'W-F8': 'ประเภท “อื่นๆ” ให้ผู้ทำบัญชีบอกอัตรา e-WHT',
  'W-F9': 'วันที่เอกสารอยู่นอกช่วงอัตรา e-WHT 1% (1 ม.ค. 2566–31 ธ.ค. 2570)',
  'W-F10': 'ถ้าจ่ายผ่าน e-WHT ให้เลือก “ธนาคารนำส่ง (e-WHT)” แทน',
  'W-F11': 'ใช้เลือกประเภทเงินได้ที่ตรงกัน',
  'W-F10o': 'ถ้าจ่ายผ่าน e-WHT ของธนาคาร เปิดใช้ที่ตั้งค่าร้านก่อน',
  "W-F10o'": 'ถ้าจ่ายผ่าน e-WHT ของธนาคาร ให้ผู้ดูแลร้านเปิดใช้ที่ตั้งค่าร้านก่อน',
  'W-D1': 'จ่ายผ่าน e-WHT ธนาคารเป็นผู้นำส่งภาษี ไม่ต้องออก 50 ทวิ ผู้รับเงินตรวจหลักฐานได้ที่เว็บกรมสรรพากร',
  'W-D1u': 'ตั้งให้จ่ายผ่าน e-WHT เมื่อจ่ายแล้ว ธนาคารจะนำส่งภาษี ไม่ต้องออก 50 ทวิ',
  'W-P1': 'จ่ายผ่าน e-WHT ต้องจ่ายผ่านธนาคาร',
  'W-P2': 'วันที่จ่ายอยู่นอกช่วงอัตรา e-WHT 1% ตรวจอัตราหักก่อนบันทึก',
  'W-PD1': 'ยังไม่ทราบวันที่จ่ายเงินจริง ระบุวันที่จากหลักฐาน',
  'W-PD2': 'บันทึกวันที่จ่ายแล้ว รายการนี้จ่ายผ่าน e-WHT ธนาคารเป็นผู้นำส่ง',
  'W-C1': 'การแก้ในระบบไม่เปลี่ยนภาษีที่ธนาคารนำส่ง ถ้ายอดหักเปลี่ยน ให้ผู้ทำบัญชีจัดการกับธนาคารหรือกรมสรรพากร',
  'W-V1': 'จ่ายผ่าน e-WHT ธนาคารเป็นผู้นำส่งภาษี ไม่ต้องออก 50 ทวิ',
  'W-V1u': 'จะจ่ายผ่าน e-WHT ธนาคารจะนำส่งภาษี ไม่ต้องออก 50 ทวิ',
  'W-T1': 'จ่ายผ่าน e-WHT',
  'W-T2': 'ธนาคารเป็นผู้นำส่ง จึงไม่อยู่ในแบบ ภ.ง.ด.3/53',
  'W-T2b': 'ดาวน์โหลดรายการ e-WHT',
  'W-T3': (form: string, branchName?: string | null) => `รายการที่จ่ายแล้วของ ${form}${branchName ? `ของสาขา ${branchName}` : ''} ในระบบเดือนนี้จ่ายผ่าน e-WHT ทั้งหมด จึงไม่มีแถวในแบบนี้`,
  'W-T4': (payee: string) => `${payee}: หัก 1% ถ้าจ่ายผ่าน e-WHT ให้เปิดแก้รายจ่ายแล้วเลือก “ธนาคารนำส่ง (e-WHT)” (ร้านที่ยังไม่เห็นตัวเลือกนี้ ให้ผู้ดูแลร้านเปิดใช้ที่ ตั้งค่าร้าน > จ่ายผ่าน e-WHT ของธนาคาร ก่อน) ถ้าไม่ใช่ ตรวจว่าอัตรานี้ถูกต้อง`,
  'W-T5': 'มีรายการของสาขาที่คุณไม่ได้ดูแลที่ต้องแก้ก่อนยื่นแบบนี้ ให้ผู้ดูแลสาขานั้นแก้ข้อมูล',
  'W-T6': (payee: string) => `${payee}: ไม่อยู่ในแบบที่ยื่นแล้ว แก้ข้อมูลก่อน แล้วระบบจะบอกว่าต้องยื่นแบบเพิ่มเติมหรือยื่นอีกแบบหนึ่ง`,
  'W-X1': 'วิธีนำส่งภาษีหัก ณ ที่จ่าย',
  'W-X2': { PAYER_FILES: 'ร้านยื่นแบบเอง', E_WHT: 'ธนาคารนำส่ง (e-WHT)', unspecified: 'ไม่ได้ระบุ', noWithholding: '' },
  'W-X3': 'จ่ายผ่าน e-WHT',
  'W-R1': 'รายการนี้จ่ายผ่าน e-WHT ต้องจ่ายผ่านธนาคาร เลือกวิธีจ่ายอื่น หรือเปิดแก้รายการเพื่อเปลี่ยนวิธีนำส่ง',
  'W-R2': 'รายการนี้มีการจ่ายด้วยเงินสดหรือบัตรอยู่ จึงเลือก e-WHT ไม่ได้ ให้คงเป็น “ร้านยื่นแบบเอง”',
  'W-R3': 'รายจ่ายนี้จ่ายผ่าน e-WHT ต้องจ่ายผ่านธนาคาร เลือกวิธีจ่ายอื่นในใบรับรอง',
  'N-1': 'ถ้าเอกสารถูกยืนยันอีกครั้งและยังต้องมีหนังสือรับรอง ระบบจะขึ้นให้ออกใบใหม่',
  'L-1': 'รายการนี้จ่ายผ่าน e-WHT ต้องจ่ายผ่านธนาคารค่ะ กด “โอนเงิน” หรือเปิดรายการเพื่อเปลี่ยนวิธีนำส่งค่ะ',
  'L-2': 'รายการนี้จะจ่ายผ่าน e-WHT ธนาคารจะนำส่งภาษีหลังจ่ายค่ะ',
  'L-3': 'ตรวจหลักฐานเพื่อยืนยันรายจ่ายก่อนสร้างใบเตรียมจ่ายค่ะ',
  'L-4': (wht: string, eWht = false) => `หักภาษีทั้งเอกสาร ${wht} บาท${eWht ? ' (e-WHT)' : ''}`,
  'L-5': (amount: string) => `ถ้าจ่ายผ่าน e-WHT ของธนาคารภายใน 31 ธ.ค. 2570 จะหัก 1% คือ ${amount} บาท ยกเว้นบางกรณีค่ะ`,
  'L-9': 'วันที่จ่ายอยู่นอกช่วงอัตรา e-WHT 1% ตรวจอัตราหักก่อนยืนยันค่ะ',
  'L-10': 'จ่ายผ่านธนาคารแบบไหนคะ',
  'L-11': (count: number, amountByCurrency: string) => `จ่ายผ่าน e-WHT ${count} รายการ หักไว้ ${amountByCurrency} ธนาคารเป็นผู้นำส่ง ไม่รวมในยอดข้างบนค่ะ`,
  'L-7': eWhtExplanation,
  'L-14': eWhtExplanation,
  'L-8': 'ใช้ยอดก่อน VAT คูณอัตราตามประเภทเงินได้ค่ะ 😊 เลือก “จ่ายค่าอะไร” ให้ตรงกับรายการก่อน ถ้าจ่ายผ่าน e-WHT ให้เลือก “ธนาคารนำส่ง (e-WHT)” ด้วย (ร้านที่ยังไม่เห็นตัวเลือกนี้ ให้ผู้ดูแลร้านเปิดใช้ที่ ตั้งค่าร้าน > จ่ายผ่าน e-WHT ของธนาคาร ก่อน) ถ้าประเภทนั้นลดอัตราได้ วันที่เอกสารอยู่ในช่วงที่กฎหมายลดอัตรา และกรอกเป็นเปอร์เซ็นต์ ระบบเติมอัตราที่ลดแล้วให้ค่ะ',
  'H-1': 'จ่ายผ่าน e-WHT — ถ้าจ่ายผ่านบริการ e-WHT ของธนาคาร ธนาคารนำส่งภาษีให้ ไม่ต้องยื่นแบบและไม่ต้องออก 50 ทวิสำหรับการจ่ายนั้น ในรายจ่ายเลือก “ธนาคารนำส่ง (e-WHT)” (ร้านที่ยังไม่เห็นตัวเลือกนี้ ให้ผู้ดูแลร้านเปิดใช้ที่ ตั้งค่าร้าน > จ่ายผ่าน e-WHT ของธนาคาร ก่อน) ถ้าประเภทลดอัตราได้ วันที่เอกสารอยู่ในช่วงที่กฎหมายลด (ถึง 31 ธ.ค. 2570) และกรอกเป็นเปอร์เซ็นต์ ระบบเติม 1% ให้ รายการนี้จะไม่อยู่ในแบบ ภ.ง.ด.3/53',
  'H-2': 'มั่งมีเปิดใช้ประเภทเงินได้ให้แล้ว ประเภทที่ยังรอตรวจจะเลือกไม่ได้',
  'W-F10o-link': 'ไปที่ตั้งค่า',
} as const;

// ─── Enums ───────────────────────────────────────────────────────────────────

export type TaxType = 'VAT' | 'WHT' | 'CIT' | 'CUSTOMS';

export type VatFormType = 'PP30' | 'PP36';
export type WhtFormType = 'PND3' | 'PND53';
export type WhtHandoffFormType = 'PND2' | WhtFormType;
export type CitFormType = 'PND50' | 'PND51';
export type CustomsFormType = 'CUSTOMS_SUPPORT';
export type TaxFormType = 'PND2' | VatFormType | WhtFormType | CitFormType | CustomsFormType;

export type TaxPeriodType = 'MONTHLY' | 'ANNUAL' | 'HALF_YEAR';

export const TAX_FORM_SHORT_NAMES: Partial<Record<string, string>> = {
  PND2: 'ภ.ง.ด.2', PP30: 'ภ.พ.30', PP36: 'ภ.พ.36', PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53', CUSTOMS_SUPPORT: 'เอกสารประกอบภาษีนำเข้า',
};

/** Filed withholding periods cannot be reopened in the tax workspace. */
export function withholdingPeriodLockedMessage(periodKey: string, action: 'แก้ไขเอกสารนี้' | 'ยกเลิกเอกสารนี้' | 'ยกเลิกใบเบิก', formType: string, kind?: 'SYSTEM' | 'EXTERNAL'): string {
  if (action === 'แก้ไขเอกสารนี้') return `ภาษีหัก ณ ที่จ่าย (${TAX_FORM_SHORT_NAMES[formType] ?? 'ภาษี'}) ของเดือน ${executiveMonthLabel(periodKey)} ยื่นไปแล้ว จึงแก้ไขเอกสารนี้ไม่ได้ ${kind === 'SYSTEM'
    ? 'ถ้าผิดเฉพาะตัวสะกดชื่อหรือที่อยู่บนหนังสือรับรอง ใช้ปุ่ม "แก้ไขหนังสือรับรอง" ได้ ถ้าข้อเท็จจริงผิด ให้ยกเลิกเอกสารแล้วบันทึกใหม่ ให้ผู้ทำบัญชีแจ้งกรมสรรพากรเรื่องแบบเดิม'
    : 'ให้ยกเลิกเอกสารแล้วบันทึกใหม่ ให้ผู้ทำบัญชีแจ้งกรมสรรพากรเรื่องแบบเดิม'}`;
  return `ภาษีหัก ณ ที่จ่าย (${TAX_FORM_SHORT_NAMES[formType] ?? 'ภาษี'}) ของเดือน ${executiveMonthLabel(periodKey)} ยื่นไปแล้ว จึง${action}ไม่ได้ ${kind === 'SYSTEM'
    ? 'ถ้าผิดเฉพาะตัวสะกดชื่อหรือที่อยู่บนหนังสือรับรอง ใช้ปุ่ม "แก้ไขหนังสือรับรอง" ได้ ถ้ายอดเงิน อัตรา หรือเลขผู้เสียภาษีผิด ต้องยื่นแบบเพิ่มเติมกับกรมสรรพากร ให้ผู้ทำบัญชีของร้านยื่นแบบเพิ่มเติมให้'
    : 'ถ้าข้อมูลผิด ต้องยื่นแบบเพิ่มเติมกับกรมสรรพากร ให้ผู้ทำบัญชีของร้านยื่นแบบเพิ่มเติมให้'}`;
}

export type TaxRuleStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export type TaxPeriodStatus =
  | 'OPEN'
  | 'NEEDS_REVIEW'
  | 'READY_FOR_REVIEW'
  | 'REVIEWED'
  | 'EXPORTED'
  | 'FILED'
  | 'PAID'
  | 'CLOSED'
  | 'AMENDED';

export type TaxEventType =
  | 'WHT_PND2'
  | 'VAT_OUTPUT'
  | 'VAT_INPUT'
  | 'VAT_EXEMPT'
  | 'VAT_REVIEW'
  | 'CUSTOMS_ASSESSED'
  | 'WHT_PND3'
  | 'WHT_PND53';

export type TaxEventStatus = 'ACTIVE' | 'SUPERSEDED' | 'REVERSED' | 'EXCLUDED';

export type FilingPackageStatus =
  | 'GENERATED'
  | 'DOWNLOADED'
  | 'VOIDED'
  | 'ACCEPTED_MANUAL'
  | 'REJECTED_MANUAL';

export type ReviewIssueSeverity = 'INFO' | 'WARNING' | 'BLOCKING';

export type ReviewIssueStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export type WhtCertificateStatus = 'DRAFT' | 'ISSUED' | 'VOIDED';

export type TaxExportFormat = 'REVIEW_JSON' | 'CSV' | 'XLSX' | 'PDF';

export type TaxAdjustmentType = 'CORRECTION' | 'REVERSAL' | 'AMENDED';

// ─── Source reference ─────────────────────────────────────────────────────────

export type TaxSourceRef = {
  sourceType: string;
  sourceId: string;
  sourceEventType?: string;
  permissionChecked: boolean;
};

// ─── Company Tax Profile ──────────────────────────────────────────────────────

export type CompanyTaxProfileDto = {
  id: string;
  companyId: string;
  taxId: string | null;
  vatRegistered: boolean;
  vatEffectiveDate: string | null;
  branchPolicy: 'HEAD_OFFICE_ONLY' | 'ALL_BRANCHES' | 'SELECTED_BRANCHES';
  accountingPeriodMonth: number;
  taxReviewerRole: string;
  notes: string | null;
  updatedAt: string;
};

export type UpdateCompanyTaxProfileDto = {
  taxId?: string;
  vatRegistered?: boolean;
  vatEffectiveDate?: string;
  branchPolicy?: CompanyTaxProfileDto['branchPolicy'];
  accountingPeriodMonth?: number;
  taxReviewerRole?: string;
  notes?: string;
};

// ─── Tax Rule Source ──────────────────────────────────────────────────────────

export type TaxRuleSourceDto = {
  id: string;
  companyId: string | null;
  sourceUrl: string;
  sourceTitle: string;
  checkedAt: string;
  checkedBy: string;
  note: string | null;
};

// ─── Tax Year Config ──────────────────────────────────────────────────────────

export type TaxYearConfigDto = {
  id: string;
  companyId: string | null;
  year: number;
  status: TaxRuleStatus;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string | null;
};

// ─── Tax Rate Config ──────────────────────────────────────────────────────────

export type TaxRateConfigDto = {
  id: string;
  taxYearConfigId: string;
  taxType: TaxType;
  code: string;
  description: string;
  rate: string;
  cap: string | null;
  conditionJson: Record<string, unknown> | null;
  status: TaxRuleStatus;
  sourceRuleId: string | null;
};

// ─── Tax Calendar Rule ────────────────────────────────────────────────────────

export type TaxCalendarRuleDto = {
  id: string;
  taxYearConfigId: string;
  formType: TaxFormType;
  periodType: TaxPeriodType;
  dueRuleJson: Record<string, unknown>;
  onlineExtensionJson: Record<string, unknown> | null;
  status: TaxRuleStatus;
  sourceRuleId: string | null;
};

// ─── Tax Period ───────────────────────────────────────────────────────────────

export type TaxPeriodDto = {
  id: string;
  companyId: string;
  taxType: TaxType;
  formType: TaxFormType;
  periodKey: string;
  status: TaxPeriodStatus;
  dueDate: string | null;
  filedAt: string | null;
  paidAt: string | null;
  reviewNote: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── Tax Event ────────────────────────────────────────────────────────────────

export type TaxEventDto = {
  id: string;
  companyId: string;
  branchId: string | null;
  taxPeriodId: string;
  eventType: TaxEventType;
  status: TaxEventStatus;
  sourceType: string;
  sourceId: string;
  sourceEventType: string | null;
  sourceHash: string | null;
  periodKey: string;
  eventDate: string;
  taxableBase: string;
  taxAmount: string;
  currency: string;
  vatMode: string | null;
  outputTaxCode: AccountingOutputTaxCode | null;
  sourceLineId: string | null;
  componentKey: import('./transaction-tax.js').TransactionTaxComponentPreview['componentKey'] | null;
  taxSnapshot: import('./transaction-tax.js').TransactionTaxSnapshot | null;
  reportContributions: import('./transaction-tax.js').TaxReportContribution[];
  whtFormType: WhtFormType | 'PND2' | null;
  payeeSnapshot: PayeeSnapshot | null;
  incomeCategoryCode: string | null;
  whtRate: string | null;
  grossAmount: string | null;
  withheldAmount: string | null;
  netPaidAmount: string | null;
  taxInvoiceNumber: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type PayeeSnapshot = {
  name: string;
  taxId: string | null;
  address: string | null;
  branchCode: string | null;
};

// ─── WHT Income Category ──────────────────────────────────────────────────────

export type WhtFilingRoute = 'SYSTEM_FILLS' | 'ACCOUNTANT_PREPARES' | 'SEPARATE_PND2';

export type WhtIncomeCategoryDto = {
  filingRoute?: WhtFilingRoute;
  id: string;
  code: string;
  nameTh: string;
  nameEn: string | null;
  formType: WhtFormType | 'PND2';
  defaultRate: string;
  status: TaxRuleStatus;
  conditionNote: string | null;
  sourceRuleId: string | null;
};

// ─── VAT Report ───────────────────────────────────────────────────────────────

export type VatReportDto = {
  id: string;
  companyId: string;
  periodId: string;
  formType: VatFormType;
  periodKey: string;
  outputVatTotal: string;
  inputVatTotal: string;
  netVatPayable: string;
  reviewNeededTotal: string;
  lineCount: number;
  reviewIssueCount: number;
  checksum: string | null;
  snapshotAt: string | null;
  sourceRefs: TaxSourceRef[];
  pp30Boxes?: import('./transaction-tax.js').Pp30BoxesDto;
};

export type VatReportLineDto = {
  taxEventId: string;
  eventType: TaxEventType;
  eventDate: string;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  taxInvoiceNumber: string | null;
  taxableBase: string;
  taxAmount: string;
  outputTaxCode: AccountingOutputTaxCode | null;
  included: boolean;
  reviewNote: string | null;
  sourceRef: TaxSourceRef;
  sourceLineId?: string | null;
  componentKey?: import('./transaction-tax.js').TransactionTaxComponentPreview['componentKey'] | null;
  taxSnapshot?: import('./transaction-tax.js').TransactionTaxSnapshot | null;
  reportContributions?: import('./transaction-tax.js').TaxReportContribution[];
};

// ─── WHT Report ───────────────────────────────────────────────────────────────

export type WhtReportDto = {
  id: string;
  companyId: string;
  periodId: string;
  formType: WhtFormType;
  periodKey: string;
  totalGross: string;
  totalWithheld: string;
  payeeGroupCount: number;
  reviewIssueCount: number;
  checksum: string | null;
  snapshotAt: string | null;
  sourceRefs: TaxSourceRef[];
};

export type WhtPayeeGroupDto = {
  payeeName: string;
  payeeTaxId: string | null;
  incomeCategoryCode: string;
  /** Null when only an amount is known or the source carries mixed rates; never implies 0%. */
  whtRate: string | null;
  totalGross: string;
  totalWithheld: string;
  totalNetPaid: string;
  certificateNumbers: string[];
  taxEventIds: string[];
};

// ─── 50 ทวิ Certificate ───────────────────────────────────────────────────────

export type WhtCertificateDto = {
  id: string;
  companyId: string;
  certificateNumber: string;
  status: WhtCertificateStatus;
  taxPeriodId: string;
  periodKey: string;
  payeeSnapshot: PayeeSnapshot;
  payerSnapshot: PayerSnapshot;
  incomeCategoryCode: string;
  incomeCategoryName: string;
  whtRate: string;
  grossAmount: string;
  withheldAmount: string;
  paymentDate: string;
  taxEventIds: string[];
  pdfAttachmentId: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
};

export type PayerSnapshot = {
  companyName: string;
  taxId: string | null;
  branchCode: string | null;
  address: string | null;
};

export type CreateWhtCertificateDto = {
  taxPeriodId: string;
  incomeCategoryCode: string;
  whtRate: string;
  grossAmount: string;
  withheldAmount: string;
  paymentDate: string;
  payeeSnapshot: PayeeSnapshot;
  taxEventIds: string[];
};

// ─── 50 ทวิ Correction & Replacement ──────────────────────────────────────────
//
// Payee name/address/branch and payment date may change. Locked fields remain accepted for
// older whole-form callers only when equal to the current certificate. Payer handling is unchanged.

export type WhtCertificateCorrectionInput = {
  formType?: WhtFormType;
  incomeCategoryCode?: string;
  incomeCategoryName?: string;
  whtRate?: string;
  grossAmount?: string;
  withheldAmount?: string;
  paymentDate?: string;
  payerSnapshot?: Partial<PayerSnapshot>;
  payeeSnapshot?: Partial<PayeeSnapshot>;
};

export type CorrectWhtCertificateDto = {
  corrected: WhtCertificateCorrectionInput;
  reason: string;
};

// ─── 50 ทวิ External Handoff (H4) ─────────────────────────────────────────────
//
// While `cap.wht50bis/SYSTEM_INITIAL_ISSUE` is CLOSED the system issues no certificate.
// Instead it persists a durable, prefilled handoff so the operator can have the 50 ทวิ
// issued externally (accountant/RD) and link it back — never a bare 409.
// Spec: feature-entitlement-decoupling-spec.md:205, tax-thailand-2026-spec.md:1324-1343.

/** tax-thailand-2026-spec.md:1332 — exactly these four values. */
export type WhtHandoffStatus = 'REQUIRED' | 'EXTERNAL_LINKED' | 'SYSTEM_ISSUED' | 'CANCELLED';

export type WhtCertificateHistoryEventType =
  | 'ISSUED'
  | 'CORRECTED'
  | 'CANCELLED_SOURCE_REOPENED'
  | 'CANCELLED_SOURCE_VOIDED'
  | 'EXTERNAL_RECORDED'
  | 'EXTERNAL_RECORD_REMOVED'
  | 'EXTERNAL_RECORD_CHANGED'
  | 'PAYEE_ADDRESS_CLEARED';

export const WHT_CERTIFICATE_HISTORY_EVENT_LABELS: Record<WhtCertificateHistoryEventType, string> = {
  ISSUED: 'ออกหนังสือรับรอง',
  CORRECTED: 'แก้ไขหนังสือรับรอง ออกใบใหม่แทนใบนี้',
  CANCELLED_SOURCE_REOPENED: 'ยกเลิก เพราะเอกสารถูกแก้ไข',
  CANCELLED_SOURCE_VOIDED: 'ยกเลิก เพราะเอกสารถูกยกเลิก',
  EXTERNAL_RECORDED: 'จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบแล้ว',
  EXTERNAL_RECORD_REMOVED: 'ยกเลิกการบันทึกหนังสือรับรองที่ทำนอกระบบ',
  EXTERNAL_RECORD_CHANGED: 'แก้ไขการบันทึกหนังสือรับรองที่ทำนอกระบบ',
  PAYEE_ADDRESS_CLEARED: 'ล้างที่อยู่ผู้รับเงิน เพราะเลขผู้เสียภาษีเปลี่ยน',
};

export type WhtCertificateHistoryDto = {
  handoffId?: string;
  externalAttachmentId?: string | null;
  eventType: WhtCertificateHistoryEventType;
  certificateNumber: string | null;
  isExternal: boolean;
  certificateDate: string | null;
  reason: string | null;
  evidenceRef: string | null;
  note: string | null;
  relatedCertificateNumber: string | null;
  actorDisplayName: string | null;
  occurredAt: string;
  taxFilingAttested: boolean;
  removedManually?: boolean;
  previousExternalRecord?: { number: string | null; issuedDate: string | null; externalEvidenceRef: string | null; note: string | null };
};

/**
 * The statutory field set the handoff must carry so nothing is re-keyed
 * (tax-thailand-2026-spec.md:1389). Fields the system cannot truly derive stay null —
 * a prefill is never fabricated (spec:208).
 */
export type WhtHandoffPrefillDto = {
  externalPaymentDate?: string;
  expensePaymentId?: string;
  expenseTotals?: { grossAmount: string; withheldAmount: string };
  payerSnapshot: PayerSnapshot;
  payeeSnapshot: PayeeSnapshot;
  formType: WhtHandoffFormType | null;
  incomeCategoryCode: string | null;
  incomeCategoryName: string | null;
  whtRate: string | null;
  grossAmount: string;
  withheldAmount: string;
  paymentDate: string;
};

export type WhtCertificateHandoffDto = {
  externalAttachmentId?: string | null;
  payments?: Array<{ id: string; paidAt: string; paidAtConfirmed: boolean; amount: string; grossAmount?: string; withheldAmount?: string }>;
  id: string;
  companyId: string;
  status: WhtHandoffStatus;
  sourcePaymentType: string | null;
  sourcePaymentId: string | null;
  payeeId: string | null;
  /** The PAYEE's tax branch code (certificate prefill). */
  branchCode: string | null;
  /** The internal branch that made the payment; governed by the caller's branch scope. */
  sourceBranchId: string | null;
  sourceFeatureKey: string;
  taxPeriodId: string | null;
  taxEventIds: string[];
  prefill: WhtHandoffPrefillDto;
  /**
   * §10: the payee address, typed on the handoff screen when the frozen prefill has none. A
   * sibling of `prefill`, never a field inside it — `prefillSnapshotHash` guards that snapshot so
   * the facts the operator copies cannot drift, and readers must prefer this over
   * `prefill.payeeSnapshot.address`.
   */
  payeeAddress: string | null;
  payeeAddressAt: string | null;
  /** A typed address was cleared when the expense was confirmed for a different tax number. */
  payeeAddressClearedByTaxIdChange: boolean;
  payeeAddressByUserId: string | null;
  externalCertificateNumber: string | null;
  externalEvidenceRef: string | null;
  externalPaymentDate?: string | null;
  externalIssuedDate: string | null;
  linkNote: string | null;
  linkedAt: string | null;
  linkedByUserId: string | null;
  /** Set once SYSTEM-issued (status SYSTEM_ISSUED) — the WhtCertificate row this handoff minted. */
  certificateId: string | null;
  certificateNumber: string | null;
  certificateIssuedAt: string | null;
  currentCertificate: {
    number: string; issuedAt: string | null; formType: WhtFormType;
    incomeCategoryCode: string; incomeCategoryName: string;
    whtRate: string; grossAmount: string; withheldAmount: string; paymentDate: string;
    payee: PayeeSnapshot;
  } | null;
  /**
   * WHT certificate system issuance plan §2.4: whether `cap.wht50bis/SYSTEM_INITIAL_ISSUE` is OPEN,
   * computed once per request so the AP/Expenses "ออกเอกสารในระบบ" button can decide to show/hide
   * without an extra fetch. On `list`/`get` only — additive, defaults to false elsewhere.
   */
  systemIssuanceOpen: boolean;
  /**
   * Correction & replacement plan §2.4: whether `cap.wht50bis/SYSTEM_CONTENT_CORRECTION` /
   * `SYSTEM_REPLACEMENT_COPY` are OPEN, computed once per request exactly like `systemIssuanceOpen`
   * above. On `list`/`get` only — additive, defaults to false elsewhere.
   */
  systemCorrectionOpen: boolean;
  systemReplacementOpen: boolean;
  payerMissing: WhtPayerMissing[];
  canChangeExternalRecord: boolean;
  previousCertificate?: { number: string | null; kind: 'SYSTEM' | 'EXTERNAL'; cancelledAt: string };
  createdAt: string;
  updatedAt: string;
  /**
   * §7/§8: what the counterparty-registry side effect of a payee-address write did. Present on
   * that write's response only, never on a read and never persisted — it drives one confirmation
   * line or the "ยังไม่ได้บันทึกลงทะเบียนคู่ค้า" bar.
   */
  counterpartyAutoSave?: import('./accounting-documents.js').VendorCounterpartyAutoSaveResult;
};

/** Expense list §10.2: the two statutory gaps checked by system issuance. */
export type WhtHandoffMissingReason = 'FORM_TYPE_UNRESOLVED' | 'INCOME_CATEGORY_OR_RATE_MISSING';
export const WHT_HANDOFF_MISSING_LABELS: Record<WhtHandoffMissingReason, string> = {
  FORM_TYPE_UNRESOLVED: 'ยังไม่ทราบว่าผู้รับเงินเป็นบุคคลหรือนิติบุคคล',
  INCOME_CATEGORY_OR_RATE_MISSING: 'ยังไม่มีประเภทเงินได้หรืออัตราภาษี',
};

export type WhtCertificateHandoffListRowDto = WhtCertificateHandoffDto & {
  formType: WhtHandoffFormType | null;
  matchedPreviousNumber: string | null;
  expenseDescription: string | null;
  payeeName: string;
  payeeTaxId: string | null;
  expenseId: string | null;
  expenseNumber: string | null;
  documentDate: string;
  withheldAmount: string;
  missing: WhtHandoffMissingReason[];
  hasPayeeAddress: boolean;
  cancellation?: { cancelledAt: string; eventType: WhtCertificateHistoryEventType; reason: string | null };
};

export type WhtCertificateHandoffListQuery = {
  status?: string; branchId?: string; sourcePaymentId?: string;
  periodKey?: string; formType?: WhtHandoffFormType; search?: string;
  page?: number; pageSize?: number; order?: 'newest' | 'oldest';
};

/** GET wht/payment-handoffs with page or pageSize; without either it remains an array. */
export type WhtCertificateHandoffPageDto = {
  /** Same filters and selected status as rows, across all pages. */
  sums: { withheld: string };
  rows: WhtCertificateHandoffListRowDto[];
  /** Readable payment months, newest first; independent of month, form, search, status and paging. */
  months?: string[];
  total: number;
  page: number;
  pageSize: number;
  /** Same branch, expense and search filters, independent of the selected status tab. */
  counts: Record<WhtHandoffStatus, number>;
};

/** §10: the operator supplies the missing payee address on a handoff still awaiting its document. */
export type SetWhtHandoffPayeeAddressDto = { payeeAddress: string };

/** Same 500-character ceiling as `ExpenseRecord.vendorAddressSnapshot` (§6). */
export const WHT_HANDOFF_PAYEE_ADDRESS_MAX = 500;

export type LinkExternalWhtCertificateDto = {
  externalAttachmentId?: string | null;
  paymentDate?: string;
  paymentId?: string;
  commandId: string;
  externalCertificateNumber: string;
  externalEvidenceRef: string;
  issuedDate: string;
  note?: string;
};

/** Same fields and validation as recording; all standing values are replaced. */
export type ChangeExternalWhtCertificateDto = LinkExternalWhtCertificateDto;

export type RemoveExternalWhtCertificateDto = { commandId: string; expectedUpdatedAt: string; reason: string };

export const WHT_EXTERNAL_RECORD_WORDS = {
  removePermissionDenied: 'คุณไม่มีสิทธิ์ลบการบันทึกนี้ ให้ผู้ที่บันทึกหนังสือรับรองที่ทำนอกระบบได้ลบให้',
  removeInvalid: 'กรอกเหตุผล 3–500 ตัวอักษร แล้วลองลบการบันทึกอีกครั้ง',
  removeRequestInvalid: 'ข้อมูลรายการเปลี่ยนแล้ว เปิดหน้านี้ใหม่แล้วลองลบการบันทึกอีกครั้ง',
  removedManually: 'ลบการบันทึกว่าทำนอกระบบ',

  notLinkable: 'บันทึกไม่ได้ เพราะมีผู้ออกหรือบันทึกหนังสือรับรองของรายจ่ายนี้ไปก่อนแล้ว หรือเอกสารถูกแก้ไขหรือยกเลิก เปิดหน้านี้ใหม่เพื่อดูสถานะล่าสุด',
  alreadyLinked: 'รายจ่ายนี้บันทึกหนังสือรับรองที่ทำนอกระบบไว้แล้ว ถ้าข้อมูลผิด ให้ใช้ "แก้ไขการบันทึก"',
  noChanges: 'ข้อมูลตรงกับที่บันทึกไว้อยู่แล้ว จึงไม่มีอะไรต้องแก้ไข',
  invalid: 'ข้อมูลที่บันทึกไม่ครบหรือไม่ถูกต้อง ตรวจเลขที่ วันที่ เลขอ้างอิง และหมายเหตุ แล้วบันทึกอีกครั้ง',
  futureDate: 'วันที่ทำใบต้องไม่เกินวันนี้ เลือกวันที่แล้วบันทึกอีกครั้ง',
  permissionDenied: 'คุณไม่มีสิทธิ์แก้ไขการบันทึกหนังสือรับรองนี้ ให้ผู้ที่มีสิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบแก้ไขให้',
  commandReused: 'คำขอนี้ถูกใช้บันทึกข้อมูลอื่นไปแล้ว เปิดหน้านี้ใหม่แล้วลองอีกครั้ง',
} as const;

/**
 * WHT certificate system issuance plan §3.3 (Decision B): OWNER-only
 * (`company.tax_signature.manage`), separate from issuing a certificate. `signatureAttachmentId`
 * comes from the generic `companies/:companyId/attachments/{upload-intent,:id/complete}` flow —
 * no dedicated upload endpoint for this feature. v1 is signature-only; no seal field exists.
 */
export type UpdateCompanyTaxSignatureDto = {
  signatureMode: 'BLANK' | 'AUTO_STAMP';
  signatureAttachmentId?: string;
};

/** 409 body of POST tax/wht-certificates while the SYSTEM route is CLOSED. */
export type WhtSystemIssuanceUnavailableBody = {
  code: 'wht_system_issuance_unavailable';
  fallback: 'EXTERNAL_CERTIFICATE_REQUIRED';
  message: string;
  handoffId: string;
  handoffStatus: WhtHandoffStatus;
};

// ─── CIT Calendar / Supporting Summary ───────────────────────────────────────

export type CitCalendarEntryDto = {
  formType: CitFormType;
  periodKey: string;
  accountingPeriodId: string | null;
  dueDate: string | null;
  onlineExtensionDueDate: string | null;
  status: TaxPeriodStatus | null;
  hasLedgerSummary: boolean;
};

export type CitSupportingSummaryDto = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  accountingPeriodId: string | null;
  revenueTotal: string;
  expenseTotal: string;
  profitLoss: string;
  taxExpenseTotal: string;
  ledgerReportRef: string | null;
  snapshotAt: string | null;
  disclaimer: string;
  missingLedger: boolean;
};

// ─── Tax Filing Package ───────────────────────────────────────────────────────

export type TaxFilingPackageDto = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  formType: TaxFormType;
  periodKey: string;
  exportNumber: string;
  status: FilingPackageStatus;
  exportFormat: TaxExportFormat;
  attachmentId: string | null;
  checksum: string | null;
  generatedAt: string;
  downloadedAt: string | null;
  voidedAt: string | null;
  filedManuallyAt: string | null;
  filedManuallyNote: string | null;
  createdAt: string;
};

export type GenerateFilingPackageDto = {
  taxPeriodId: string;
  exportFormat: TaxExportFormat;
};

// ─── Tax Review Issue ─────────────────────────────────────────────────────────

export type TaxReviewIssueDto = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  taxEventId: string | null;
  severity: ReviewIssueSeverity;
  status: ReviewIssueStatus;
  issueCode: string;
  description: string;
  sourceRef: TaxSourceRef | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  createdAt: string;
};

// ─── Tax Adjustment ───────────────────────────────────────────────────────────

export type TaxAdjustmentDto = {
  id: string;
  companyId: string;
  taxPeriodId: string;
  adjustmentType: TaxAdjustmentType;
  reason: string;
  adjustedByUserId: string;
  adjustedAt: string;
  metadataJson: Record<string, unknown> | null;
};

// ─── Tax Verification Checklist ───────────────────────────────────────────────

export type TaxVerificationChecklistDto = {
  id: string;
  companyId: string | null;
  taxYearConfigId: string;
  item: string;
  status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'SKIPPED';
  reviewer: string | null;
  reviewedAt: string | null;
  note: string | null;
};

// ─── AI Tax Tool responses ────────────────────────────────────────────────────

export type TaxUpcomingObligationsResult = {
  obligations: {
    formType: TaxFormType;
    periodKey: string;
    dueDate: string | null;
    status: TaxPeriodStatus | null;
    overdue: boolean;
    webLink: string | null;
  }[];
  windowDays: number;
  permissionChecked: true;
  disclaimer: string;
};

export type TaxVatSummaryResult = {
  periodKey: string;
  formType: VatFormType;
  status: TaxPeriodStatus | null;
  outputVatTotal: string;
  inputVatTotal: string;
  netVatPayable: string;
  reviewIssueCount: number;
  sourceRefs: TaxSourceRef[];
  permissionChecked: true;
  disclaimer: string;
  webLink: string | null;
};

export type TaxWhtSummaryResult = {
  periodKey: string;
  formType: WhtFormType;
  status: TaxPeriodStatus | null;
  totalGross: string;
  totalWithheld: string;
  payeeGroupCount: number;
  reviewIssueCount: number;
  sourceRefs: TaxSourceRef[];
  permissionChecked: true;
  disclaimer: string;
  webLink: string | null;
};

export type TaxCitCalendarResult = {
  entries: CitCalendarEntryDto[];
  permissionChecked: true;
  disclaimer: string;
};

export type TaxMissingDocumentsResult = {
  issues: {
    issueCode: string;
    description: string;
    severity: ReviewIssueSeverity;
    periodKey: string | null;
    sourceRef: TaxSourceRef | null;
  }[];
  permissionChecked: true;
  disclaimer: string;
};

// ─── Query/list types ─────────────────────────────────────────────────────────

export type ListTaxPeriodsQuery = {
  taxType?: TaxType;
  formType?: TaxFormType;
  status?: TaxPeriodStatus;
  periodKey?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedTaxPeriodsDto = {
  items: TaxPeriodDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListTaxEventsQuery = {
  taxPeriodId?: string;
  eventType?: TaxEventType;
  status?: TaxEventStatus;
  page?: number;
  pageSize?: number;
};

export type PaginatedTaxEventsDto = {
  items: TaxEventDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListReviewIssuesQuery = {
  taxPeriodId?: string;
  severity?: ReviewIssueSeverity;
  status?: ReviewIssueStatus;
  page?: number;
  pageSize?: number;
};

export type PaginatedReviewIssuesDto = {
  items: TaxReviewIssueDto[];
  total: number;
  page: number;
  pageSize: number;
};


/** The combined withholding page reads one month, with one card for each supported form. */
export type WithholdingMonthIssueDto = {
  id: string;
  issueCode: string;
  description: string;
  severity: ReviewIssueSeverity;
  sourceType: string | null;
  sourceId: string | null;
  expenseId: string | null;
  counterpartyId: string | null;
};
export type WithholdingCancellationDto = {
  filingId: string; formType: WhtFormType; sourceType: string; sourceId: string;
  payeeName: string; payeeTaxId: string | null; withheld: string;
  cancelledAt: string; cancelledByUserId: string | null;
};
export type WithholdingPaperRef = { id: string | null; kind: 'NORMAL' | 'ADDITIONAL'; sequence: number; establishmentCode: string };
export type WithholdingMonthPaperDto = Omit<WithholdingMonthFormDto, 'papers' | 'monthTotals'> & WithholdingPaperRef & {
  downloadedAt: string | null;
  filedAt: string | null;
  noticeCode: 'WHT_ADDITIONAL_SURCHARGE_MANUAL' | null;
};
export type WithholdingMonthFormDto = {
  paymentBasisChanged?: boolean;
  papers?: WithholdingMonthPaperDto[];
  cancellations?: WithholdingCancellationDto[];
  cancelledPayeeNames?: string[];
  canConfirmRows?: boolean;
  rowsConfirmation?: { userId: string; at: string; displayName?: string | null } | null;
  rowsUncertainNotice?: string | null;
  monthTotals?: { paymentCount: number; totalPaid: string; totalWithheld: string };
  unfiledPaymentCount?: number;
  establishmentCode?: string;
  canDownload?: boolean;
  canMarkFiled?: boolean;
  /** False for historical papers whose original rows were never stored. */
  rowsCertain?: boolean;
  accountantPrepared?: boolean;
  accountantTypes?: { incomeType: string; payeeName: string }[];
  formType: WhtFormType;
  periodId: string | null;
  status: TaxPeriodStatus | null;
  paymentCount: number;
  totalPaid: string;
  totalWithheld: string;
  dueDate: string;
  issues: WithholdingMonthIssueDto[];
};
export type WhtPayerMode = 'HEAD_OFFICE_PAYS_ALL' | 'EACH_BRANCH_PAYS';
export type AnswerWhtPayerModeRequest = { mode: WhtPayerMode; effectiveFromPeriodKey?: string };
export type WhtPayerModeDto = {
  periodKey: string;
  mode: WhtPayerMode | null;
  asked: boolean;
  firstAllowedPeriodKey: string;
};
export type WhtEstablishment = { kind: 'ESTABLISHMENT'; code: string; branchId: string | null; name: string };
export type WhtPaymentEstablishment = WhtEstablishment
  | { kind: 'SHOP_HAS_NOT_ANSWERED' }
  | { kind: 'BRANCH_HAS_NO_CODE'; branchId: string | null };

export type WithholdingMonthPaymentDto = {
  currency?: string;
  paymentId?: string | null;
  paper?: WithholdingPaperRef | null;
  establishment?: WhtPaymentEstablishment;
  id: string;
  paymentDate: string;
  payeeName: string;
  formType: WhtFormType | 'PND2';
  incomeCategoryCode: string | null;
  incomeCategoryLabel: string | null;
  rate: string | null;
  paid: string;
  withheld: string;
  sourceType: string;
  sourceId: string;
  expenseId: string | null;
  certificate: { handoffId: string; state: WhtHandoffStatus; number: string | null; canDownload: boolean } | null;
};
export type WithholdingMonthDto = {
  unpaidExpenses?: { expenseId: string; payeeName: string }[];
  paidWithoutWithholding?: { expenseId: string; payeeName: string }[];
  /** Payments without an attested payment date have no tax month yet. */
  undatedPayments?: { paymentId: string; expenseId: string; payeeName: string; amount: string; recordedAt: string; recordedByUserId: string }[];
  establishments?: (WhtEstablishment & { forms: WithholdingMonthFormDto[] })[];
  establishmentIssues?: { issueCode: 'WHT_PAYER_MODE_REQUIRED' | 'WHT_BRANCH_HAS_NO_CODE'; branchId: string | null; branchName: string; description: string; paymentCount: number; totalPaid: string; totalWithheld: string }[];
  separatePnd2?: WithholdingMonthPaymentDto[];
  bankRemitted?: WithholdingMonthPaymentDto[];
  periodKey: string;
  forms: WithholdingMonthFormDto[];
  payments: WithholdingMonthPaymentDto[];
};
export type WithholdingMonthsDto = { months: string[] };

/** No system certificate until these income types can be printed on their proper form. */
export function whtCertificateUnsupportedReason(code?: string | null, formType?: string | null): string | null {
  if (formType === 'PND2' || code === 'WHT_INTEREST' || code === 'WHT_DIVIDEND_IND') return 'ประเภทนี้ยื่น ภ.ง.ด.2 ระบบยังออกหนังสือรับรอง 50 ทวิให้ไม่ได้ ให้ผู้ทำบัญชีทำนอกระบบแล้วจดเลขที่ไว้';
  if (code === 'WHT_DIVIDEND') return 'ระบบยังออกหนังสือรับรอง 50 ทวิสำหรับเงินปันผลไม่ได้ ให้ผู้ทำบัญชีทำนอกระบบแล้วจดเลขที่ไว้';
  return null;
}
export function whtFilingRouteHint(category?: { code: string; formType: string; filingRoute?: string } | null): string | null {
  if (category?.filingRoute === 'SEPARATE_PND2') return 'ประเภทนี้ยื่น ภ.ง.ด.2 แยก ไม่อยู่ใน ภ.ง.ด.3';
  if (category?.filingRoute !== 'ACCOUNTANT_PREPARES') return null;
  if (category.code === 'WHT_OTHER_IND' || category.code === 'WHT_OTHER_JUR') return 'บอกผู้ทำบัญชีว่าเป็นเงินได้อะไร ผู้ทำบัญชีต้องจัดทำแบบของเดือนนี้เอง';
  return `ระบบยังกรอกประเภทนี้ลงแบบไม่ได้ ผู้ทำบัญชีต้องจัดทำ ${category.formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'} ของเดือนนี้เอง`;
}


export const WHT_EXTERNAL_FILE = {
  target: 'wht.external_certificate', purpose: 'wht.external_certificate.evidence', maxBytes: 10 * 1024 * 1024,
  label: 'แนบรูปหรือ PDF ของใบ (ถ้ามี)',
  hint: 'ใบนี้ทำจากนอกระบบ ระบบเก็บเลขที่และไฟล์ไว้ให้ค้นเจอเท่านั้น',
  invalid: 'แนบรูปหรือ PDF ของใบ ไม่เกิน 10 เมกะไบต์ แล้วลองอีกครั้ง',
  readFromRecord: 'เปิดไฟล์นี้จากใบ 50 ทวิ ที่จดเลขที่ไว้',
  retained: 'ไฟล์นี้เก็บไว้ในประวัติใบ 50 ทวิ เปลี่ยนหรือนำไฟล์ออกจากการจดเลขที่ใบแทน',
} as const;

export function whtPaymentProgressText(systemCertificatesAvailable: boolean, complete: boolean) {
  return complete
    ? systemCertificatesAvailable ? 'จ่ายครบและมีหนังสือรับรองแล้ว' : 'จ่ายครบ และทำใบ 50 ทวิ นอกระบบแล้ว'
    : systemCertificatesAvailable ? 'จ่ายครบแล้ว ยังออกหนังสือรับรองไม่ครบ' : 'จ่ายครบแล้ว ยังไม่ได้ทำใบ 50 ทวิ';
}
export const WHT_OUTSIDE_BEFORE_PAYMENT = 'บันทึกการจ่ายก่อน แล้วค่อยจดเลขที่ใบ 50 ทวิ';

export const WHT_OUTSIDE_PAYMENT_DATE_REQUIRED = 'ระบุวันที่จ่ายจริงในรายการจ่ายก่อน แล้วค่อยจดเลขที่ใบ 50 ทวิ';
