import { COMPANY_PROFILE_SETTINGS_PATH } from '@watchdog-bms/contracts';
import type { MangmeeTone } from '@/common/components/mangmee';
import { canSeeRoute } from './route-permissions';

export type SettingsMenuIconKey = 'BellIcon' | 'BoxIcon' | 'LockIcon' | 'GroupIcon' | 'DollarLineIcon';

export type SettingsMenuItem = {
  key: string;
  href: string;
  title: string;
  desc: string;
  iconKey: SettingsMenuIconKey;
  tone: MangmeeTone;
  section?: 'primary' | 'advanced';
};

export const SETTINGS_MENU_ITEMS: readonly SettingsMenuItem[] = [
  // P10-L §15.4: the one place a shop opened from LINE can fill in everything the signup form
  // never asked for. First on purpose — for those customers it is the only entry that applies.
  {
    key: 'company-profile',
    href: COMPANY_PROFILE_SETTINGS_PATH,
    title: 'ข้อมูลร้านและบัญชีของฉัน',
    desc: 'ชื่อจดทะเบียน เลขผู้เสียภาษี ที่อยู่ และอีเมล เบอร์ รหัสผ่านสำรองของคุณ',
    iconKey: 'LockIcon',
    tone: 'brand',
  },
  {
    key: 'line-oa',
    href: '/settings/line-oa',
    title: 'เชื่อมต่อ LINE OA',
    desc: 'เชื่อม LINE OA ของบริษัทให้ข้อความลูกค้าเข้าสู่ CRM Inbox โดยอัตโนมัติ',
    iconKey: 'BellIcon',
    tone: 'line',
  },
  {
    key: 'crm-catalog',
    href: '/settings/crm-catalog',
    title: 'สินค้าและบริการสำหรับ CRM',
    desc: 'จัดการข้อมูล ราคา และระยะเวลาบริการที่พนักงานและ AI ใช้ตอบลูกค้าและสร้างการจอง',
    iconKey: 'BoxIcon',
    tone: 'purple',
  },
  // Account-security screen is feature-disabled (owner decision 2026-08-05): recovery email
  // cannot verify without a mailer and the page promised a password form it never had. The
  // header menu links straight to /change-password instead; API endpoints stay intact.
  {
    key: 'branches',
    href: '/settings/branches',
    title: 'สาขา',
    desc: 'จัดการสาขาของบริษัท และใช้เป็นขอบเขตข้อมูลของพนักงานทั้งเว็บและ LINE',
    iconKey: 'GroupIcon',
    tone: 'sky',
  },
  {
    key: 'accounting-tax-setup',
    href: '/settings/accounting-tax-setup',
    title: 'ตั้งค่าบัญชีและภาษี',
    desc: 'ทำตามลำดับตั้งแต่ผังบัญชี ชุดรหัสภาษี (Tax Profile) การผูกบัญชีและรายงาน จนพร้อมเปิดใช้งาน',
    iconKey: 'DollarLineIcon',
    tone: 'brand',
    section: 'primary',
  },
  {
    key: 'substitute-receipt',
    href: '/settings/substitute-receipt',
    title: 'ตั้งค่าใบรับรองแทนใบเสร็จ',
    desc: 'เลือกรูปแบบการอนุมัติและหลักฐานขั้นต่ำสำหรับรายจ่ายที่ไม่มีใบเสร็จรับเงิน',
    iconKey: 'DollarLineIcon',
    tone: 'brand',
  },
  {
    key: 'tax-codes',
    href: '/settings/tax-codes',
    title: 'Tax Code และ Tax Profile',
    desc: 'จัดการ SAP-compatible Tax Code ตาม profile บริบท อัตรา และช่วงวันที่มีผล',
    iconKey: 'DollarLineIcon',
    tone: 'indigo',
    section: 'advanced',
  },
  {
    key: 'tax-accounts',
    href: '/settings/tax-accounts',
    title: 'Tax Account Determination',
    desc: 'ผูก Tax Code กับผังบัญชี บทบาทบัญชี และช่องรายงาน ภ.พ.30/ภ.พ.36',
    iconKey: 'DollarLineIcon',
    tone: 'teal',
    section: 'advanced',
  },
  {
    key: 'chart-of-accounts',
    href: '/settings/chart-of-accounts',
    title: 'ผังบัญชี Master Data',
    desc: 'ตรวจผังบัญชี ที่มาของ Template ความพร้อม และผลกระทบก่อนเพิ่มหรือแทนที่บัญชี',
    iconKey: 'DollarLineIcon',
    tone: 'lime',
    section: 'advanced',
  },
  // WHT certificate system issuance plan §2.1b/§3.3 (Decision B): OWNER-only via
  // `company.tax_signature.manage` — FINANCE/ACCOUNTANT (who see every other card on this page)
  // never see this one, the same way `filterSettingsMenuItems` already hides any card whose
  // permission the viewer lacks.
  {
    key: 'tax-signature',
    href: '/settings/tax-signature',
    title: 'ลายเซ็นผู้จ่ายเงินสำหรับ 50 ทวิ',
    desc: 'ตั้งค่าลายเซ็นผู้มีอำนาจลงนามที่จะประทับลงหนังสือรับรองหัก ณ ที่จ่ายที่ระบบออกให้อัตโนมัติ',
    iconKey: 'DollarLineIcon',
    tone: 'indigo',
    section: 'advanced',
  },
];

/**
 * `locked` = this shop has no usable package (spec §12): the hub keeps only the card it may still
 * open, ข้อมูลร้านและบัญชีของฉัน, because every other card leads to a page the term guard refuses.
 * Permissions still decide, so a member without them sees nothing extra by being locked.
 */
export function filterSettingsMenuItems(userPermissions: readonly string[], locked = false): SettingsMenuItem[] {
  return SETTINGS_MENU_ITEMS.filter((item) => (!locked || item.key === 'company-profile')
    && canSeeRoute(item.href, userPermissions));
}

/**
 * ข้อมูลร้านและบัญชีของฉัน needs `company.setup.read`, which staff do not have — so in the locked
 * shell their ตั้งค่า led to an empty hub, and the two account pages that DO work for them were
 * behind no link at all. Both live outside the company workspace, which is why they survive a
 * locked term; neither belongs in `SETTINGS_MENU_ITEMS`, whose items are company routes.
 */
export const LOCKED_ACCOUNT_CARD = {
  title: 'บัญชีของฉัน',
  desc: 'จัดการรหัสผ่านและอีเมลของบัญชีคุณ ใช้ได้แม้ร้านยังไม่มีแพ็กเกจ',
  links: [
    { key: 'password', label: 'เปลี่ยนรหัสผ่าน', href: '/change-password' },
    { key: 'email', label: 'อีเมลบัญชี', href: '/account/email' },
  ],
} as const;

/** Only when the locked hub would otherwise have nothing on it at all. */
export function showsLockedAccountCard(userPermissions: readonly string[], locked: boolean): boolean {
  return locked && filterSettingsMenuItems(userPermissions, true).length === 0;
}

const SETTINGS_SIDEBAR_KEYS = [
  'accounting-tax-setup',
  'chart-of-accounts',
  'tax-codes',
  'tax-accounts',
  'branches',
] as const;

export function filterSettingsSidebarItems(userPermissions: readonly string[]): SettingsMenuItem[] {
  const visible = new Map(filterSettingsMenuItems(userPermissions).map((item) => [item.key, item]));
  return SETTINGS_SIDEBAR_KEYS.flatMap((key) => visible.get(key) ?? []);
}
