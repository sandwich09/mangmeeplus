import {
  EXECUTIVE_ACCOUNT_STATUSES, type ExecutiveAccountStatus, type ExecutiveUserCreateBody,
  type ExecutiveUserView, type ExecutiveUserAccessBody, type ExecutiveUserStatusBody, type ExecutiveUserReasonBody,
} from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '../../common/api/api-error-message';
import { formatThaiDateTime } from '../../common/i18n/thai-date';
import type { MangmeeTone } from '../../common/components/mangmee';

export const EXECUTIVE_USERS_TITLE = 'บัญชีผู้บริหาร';
export const executiveWords = {
  admin: 'ผู้ดูแลระบบ', add: 'เพิ่มผู้บริหาร', detail: 'รายละเอียดบัญชีผู้บริหาร',
  searchLabel: 'ค้นหาชื่อหรือชื่อผู้ใช้', statusLabel: 'สถานะบัญชี', allStatuses: 'ทุกสถานะ',
  search: 'ค้นหา', clear: 'ล้างตัวกรอง', firstPage: 'กลับหน้าแรก', loadingList: 'กำลังโหลดรายชื่อ…', loadingAccount: 'กำลังโหลดบัญชี…',
  empty: 'ไม่พบบัญชีผู้บริหารตามเงื่อนไขที่เลือก', emptyPage: 'ไม่มีรายการในหน้านี้ กลับหน้าแรกหรือเปลี่ยนตัวกรองเพื่อดูรายการ',
  caption: 'บัญชีผู้บริหารตามเงื่อนไขที่เลือก', account: 'บัญชี', rights: 'สิทธิ์', status: 'สถานะ', lastEntry: 'เข้าเว็บล่าสุด',
  username: 'ชื่อผู้ใช้', displayName: 'ชื่อที่แสดง', phoneNumber: 'เบอร์มือถือ', email: 'อีเมล', optional: '(ไม่บังคับ)',
  missing: 'ยังไม่มีข้อมูล', unspecified: 'ไม่ระบุ', save: 'บันทึก', cancel: 'ยกเลิก', openAccount: 'เปิดหน้าบัญชีนี้',
  created: 'สร้างบัญชีผู้บริหารแล้ว', saved: 'บันทึกการเปลี่ยนแปลงแล้ว',
  reasonLabel: 'เหตุผล (จำเป็น ไม่เกิน 500 ตัวอักษร)', reasonInvalid: 'กรุณาระบุเหตุผล 1–500 ตัวอักษร',
  copy: 'คัดลอก', copied: 'คัดลอกรหัสผ่านแล้ว', copyFailed: 'คัดลอกไม่สำเร็จ กรุณาเลือกรหัสผ่านแล้วคัดลอกด้วยตนเอง',
  closeCredential: 'ปิดกล่องนี้', credentialOnce: 'แสดงครั้งเดียว ออกจากหน้าหรือปิดกล่องนี้แล้วเรียกดูอีกไม่ได้ ระบบจะให้ตั้งรหัสผ่านใหม่เมื่อเข้าใช้งาน',
  credentialDelivery: 'กรุณาส่งรหัสให้เจ้าตัวด้วยตนเอง ระบบไม่ได้ส่งข้อความหรืออีเมล',
  credentialTitle: (username: string) => `รหัสผ่านชั่วคราวของ ${username}`,
  credentialExpiry: (expiresAt: string) => `รหัสผ่านใช้ได้ถึง ${formatThaiDateTime(expiresAt)}`,
  found: (total: number) => `พบ ${total.toLocaleString('th-TH')} บัญชี`,
};
export const EXECUTIVE_RIGHTS = {
  canRead: 'ดูรายงานผู้บริหาร', canExport: 'ส่งออก Excel', canSeeContacts: 'ดูข้อมูลติดต่อเจ้าของร้าน',
};
export const EXECUTIVE_EXPORT_NOTE = 'ไฟล์มีข้อมูลบริษัทตามสิทธิ์และตัวกรองที่เลือก และดาวน์โหลดไปแล้วเรียกคืนไม่ได้';
export const EXECUTIVE_CONTACT_NOTE = 'เห็นอีเมลและเบอร์โทรของเจ้าของร้าน ซึ่งเป็นข้อมูลส่วนบุคคล';
export const EXECUTIVE_CONTACT_EXPORT_NOTE = 'ข้อมูลติดต่อจะอยู่ในไฟล์ได้ต้องมีทั้งสิทธิ์ส่งออกและสิทธิ์ดูข้อมูลติดต่อ';
const STATUS_WORDS: Record<ExecutiveAccountStatus, { label: string; tone: MangmeeTone }> = {
  PENDING_ACTIVATION: { label: 'รอเปิดใช้งาน', tone: 'amber' }, ACTIVE: { label: 'เปิดใช้งาน', tone: 'brand' },
  SUSPENDED: { label: 'ระงับ', tone: 'danger' }, REVOKED: { label: 'ถอนสิทธิ์แล้ว', tone: 'slate' },
};
export const executiveStatus = (status: ExecutiveAccountStatus) => STATUS_WORDS[status].label;
export const executiveStatusTone = (status: ExecutiveAccountStatus) => STATUS_WORDS[status].tone;
export const executiveStatusOptions = EXECUTIVE_ACCOUNT_STATUSES.map(value => ({ value, label: executiveStatus(value) }));
export function executiveRights(user: Pick<ExecutiveUserView, 'canRead' | 'canExport' | 'canSeeContacts'>): string {
  return (Object.keys(EXECUTIVE_RIGHTS) as Array<keyof typeof EXECUTIVE_RIGHTS>).filter(key => user[key]).map(key => EXECUTIVE_RIGHTS[key]).join(' · ') || 'ไม่มีสิทธิ์รายงาน';
}

type Filters = { q: string; status?: ExecutiveAccountStatus; page: number };
export function executiveFilters(params: Pick<URLSearchParams, 'get'>): Filters & { pageSize: number } {
  const page = Number(params.get('page') ?? 1);
  const status = params.get('filter_status') as ExecutiveAccountStatus;
  return { q: params.get('q') ?? '', status: EXECUTIVE_ACCOUNT_STATUSES.includes(status) ? status : undefined,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1, pageSize: 20 };
}
export function executiveListUrl(current: Filters, changes: Partial<Filters>): string {
  const next = { ...current, ...changes, page: 'q' in changes || 'status' in changes ? 1 : changes.page ?? current.page };
  const params = new URLSearchParams();
  if (next.q.trim()) params.set('q', next.q.trim());
  if (next.status) params.set('filter_status', next.status);
  if (next.page > 1) params.set('page', String(next.page));
  return `/system/executive-users${params.size ? `?${params}` : ''}`;
}

export type ExecutiveAction = 'export' | 'contacts' | 'suspend' | 'activate' | 'credential';
export function executiveActions(user: ExecutiveUserView, protectedAccount = false): ExecutiveAction[] {
  return protectedAccount || user.status === 'REVOKED' ? [] : ['export', 'contacts', user.status === 'SUSPENDED' ? 'activate' : 'suspend', 'credential'];
}
export function executiveActionLabel(user: ExecutiveUserView, action: ExecutiveAction): string {
  if (action === 'export') return `${user.canExport ? 'ปิด' : 'เปิด'}สิทธิ์${EXECUTIVE_RIGHTS.canExport}`;
  if (action === 'contacts') return `${user.canSeeContacts ? 'ปิด' : 'เปิด'}สิทธิ์${EXECUTIVE_RIGHTS.canSeeContacts}`;
  return { suspend: 'ระงับบัญชี', activate: 'เปิดใช้อีกครั้ง', credential: 'ออกรหัสผ่านใหม่' }[action];
}
export function executiveConfirmation(user: ExecutiveUserView, action: ExecutiveAction): string {
  const effect = action === 'credential' ? 'การเข้าระบบที่ค้างอยู่ของบัญชีนี้จะถูกยกเลิก รหัสผ่านเดิมจะใช้ไม่ได้ และต้องตั้งรหัสผ่านใหม่เมื่อเข้าใช้งาน'
    : action === 'suspend' ? 'บัญชีนี้จะเข้าใช้งานไม่ได้ตั้งแต่คำขอถัดไป และเข้าระบบใหม่ไม่ได้จนกว่าจะเปิดใช้อีกครั้ง'
      : action === 'activate' ? 'ยกเลิกการระงับบัญชี หากรหัสผ่านหมดอายุ ต้องออกรหัสผ่านใหม่ด้วย'
        : `สิทธิ์ใหม่มีผลตั้งแต่คำขอถัดไป ${action === 'export' ? EXECUTIVE_EXPORT_NOTE : `${EXECUTIVE_CONTACT_NOTE} ${EXECUTIVE_EXPORT_NOTE}`}`;
  return `${user.displayName} · ${executiveWords.username} ${user.username}\n${effect}`;
}
export type ExecutiveCommand = { path: 'access'; body: ExecutiveUserAccessBody }
  | { path: 'status'; body: ExecutiveUserStatusBody } | { path: 'credential'; body: ExecutiveUserReasonBody };
export function executiveCommand(user: ExecutiveUserView, action: ExecutiveAction, reason: string): ExecutiveCommand | null {
  reason = reason.trim();
  if (!reason || reason.length > 500 || !executiveActions(user).includes(action)) return null;
  if (action === 'credential') return { path: 'credential', body: { reason } };
  if (action === 'suspend' || action === 'activate') return { path: 'status', body: { status: action === 'suspend' ? 'SUSPENDED' : 'ACTIVE', reason } };
  return { path: 'access', body: { canExport: action === 'export' ? !user.canExport : user.canExport,
    canSeeContacts: action === 'contacts' ? !user.canSeeContacts : user.canSeeContacts, reason } };
}
export function executiveExpiryNotice(user: ExecutiveUserView, now = Date.now()): string | null {
  if (user.status !== 'PENDING_ACTIVATION') return null;
  if (!user.temporaryPasswordExpiresAt) return 'ไม่ระบุวันหมดอายุของรหัสผ่าน';
  return Date.parse(user.temporaryPasswordExpiresAt) <= now
    ? 'รหัสผ่านหมดอายุแล้ว ต้องออกรหัสผ่านใหม่ก่อนเข้าใช้งาน'
    : `รหัสผ่านชั่วคราวใช้ได้ถึง ${formatThaiDateTime(user.temporaryPasswordExpiresAt)}`;
}

export type ExecutiveForm = ExecutiveUserCreateBody & { phoneNumber: string; email: string };
export type ExecutiveFormErrors = Partial<Record<keyof ExecutiveForm, string>>;
export function emptyExecutiveForm(): ExecutiveForm {
  return { username: '', displayName: '', phoneNumber: '', email: '', canExport: false, canSeeContacts: false };
}
export function validateExecutiveForm(values: ExecutiveForm): ExecutiveFormErrors {
  const errors: ExecutiveFormErrors = {};
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(values.username.trim())) errors.username = 'ใช้ตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง รวม 3–40 ตัวอักษร';
  if (!values.displayName.trim() || values.displayName.trim().length > 120) errors.displayName = 'กรอกชื่อที่แสดง 1–120 ตัวอักษร';
  if (values.phoneNumber.trim().length > 20) errors.phoneNumber = 'เบอร์มือถือยาวได้ไม่เกิน 20 ตัวอักษร';
  if (values.email.trim() && (values.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))) errors.email = 'กรอกอีเมลให้ถูกต้องและไม่เกิน 254 ตัวอักษร';
  return errors;
}
export function executiveCreateBody(values: ExecutiveForm): ExecutiveUserCreateBody {
  return { username: values.username.trim().toLowerCase(), displayName: values.displayName.trim(),
    ...(values.phoneNumber.trim() ? { phoneNumber: values.phoneNumber.trim() } : {}),
    ...(values.email.trim() ? { email: values.email.trim() } : {}), canExport: values.canExport, canSeeContacts: values.canSeeContacts };
}
export function executiveFieldErrors(error: unknown): ExecutiveFormErrors {
  const value = error as { fieldErrors?: Record<string, unknown>; details?: { fieldErrors?: Record<string, unknown> } } | null;
  const fields = value?.fieldErrors ?? value?.details?.fieldErrors;
  const result: ExecutiveFormErrors = {};
  for (const field of ['username', 'displayName', 'phoneNumber', 'email'] as const) if (fields?.[field]) result[field] = apiErrorMessage({ code: apiErrorCode(error) });
  return result;
}
