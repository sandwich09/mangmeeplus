import { E_WHT_WORDS, COMPANY_PROFILE_ACCOUNT_HASH, COMPANY_PROFILE_SETTINGS_PATH } from '@watchdog-bms/contracts';
import type { MangmeeTone } from '@/common/components/mangmee';
import { canSeeRoute } from './route-permissions';

/** The picture of the row under ตั้งค่าบริษัท in the side menu (the hub's cards draw none). */
export type SettingsMenuIconKey = 'BellIcon' | 'BoxIcon' | 'LockIcon' | 'GroupIcon' | 'DollarLineIcon' | 'BankIcon' | 'UserIcon' | 'StampIcon';

export type SettingsMenuItem = {
  key: string;
  /** A company route with a registered permission rule; `canSeeRoute` reads it, so it carries no hash. */
  href: string;
  /** The part of the page the card opens, e.g. `#account`. */
  hash?: string;
  title: string;
  desc: string;
  iconKey: SettingsMenuIconKey;
  tone: MangmeeTone;
  section?: 'primary' | 'advanced';
};

export const SETTINGS_MENU_ITEMS: readonly SettingsMenuItem[] = [
  // P10-L §15.4: the one place a shop opened from LINE can fill in everything the signup form
  // never asked for. First on purpose — for those customers it is the only entry that applies.
  // Two cards since 2026-10-13: one card named two things and its description listed seven.
  {
    key: 'company-profile',
    href: COMPANY_PROFILE_SETTINGS_PATH,
    title: 'ข้อมูลร้าน',
    desc: 'ชื่อจดทะเบียน เลขผู้เสียภาษี ที่อยู่',
    iconKey: 'BankIcon',
    tone: 'brand',
  },
  {
    key: 'my-account',
    href: COMPANY_PROFILE_SETTINGS_PATH,
    hash: COMPANY_PROFILE_ACCOUNT_HASH,
    title: 'บัญชีของฉัน',
    desc: 'อีเมล เบอร์มือถือ รหัสผ่าน',
    iconKey: 'UserIcon',
    tone: 'brand',
  },
  // Account-security screen is feature-disabled (owner decision 2026-08-05): recovery email
  // cannot verify without a mailer and the page promised a password form it never had. The
  // header menu links straight to /change-password instead; API endpoints stay intact.
  {
    key: 'branches',
    href: '/settings/branches',
    title: 'สาขา',
    desc: 'ชื่อ รหัส และเบอร์โทรของแต่ละสาขา',
    iconKey: 'GroupIcon',
    tone: 'sky',
  },
  // The hub's old description promised employees and rights and had no card for them.
  {
    key: 'employees',
    href: '/settings/access-overview',
    title: 'พนักงานและสิทธิ์',
    desc: 'รายชื่อพนักงานและบทบาทของแต่ละคน',
    iconKey: 'GroupIcon',
    tone: 'slate',
  },
  {
    key: 'substitute-receipt',
    href: '/settings/substitute-receipt',
    title: 'ตั้งค่าใบรับรองแทนใบเสร็จ',
    desc: 'วิธีอนุมัติและหลักฐานที่ต้องแนบ',
    iconKey: 'DollarLineIcon',
    tone: 'brand',
  },
  {
    key: 'e-wht',
    href: '/settings/e-wht',
    title: E_WHT_WORDS['S-1'],
    desc: E_WHT_WORDS['S-2'],
    iconKey: 'BankIcon',
    tone: 'brand',
  },
  // WHT certificate system issuance plan §2.1b/§3.3 (Decision B): OWNER-only via
  // `company.tax_signature.manage` — FINANCE/ACCOUNTANT (who see every other card on this page)
  // never see this one, the same way `filterSettingsMenuItems` already hides any card whose
  // permission the viewer lacks. An ordinary card: it was the only row of a "การตั้งค่าขั้นสูง" block.
  {
    key: 'tax-signature',
    href: '/settings/tax-signature',
    title: 'ลายเซ็นบน 50 ทวิ',
    desc: 'ลายเซ็นที่พิมพ์บนหนังสือรับรอง 50 ทวิ',
    iconKey: 'StampIcon',
    tone: 'indigo',
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
];

/** The two cards of the person's own profile page, the only company route a locked shop still serves. */
const LOCKED_SHELL_CARD_KEYS: ReadonlySet<string> = new Set(['company-profile', 'my-account']);

/**
 * `locked` = this shop has no usable package (spec §12): the hub keeps only the cards it may still
 * open, ข้อมูลร้าน and บัญชีของฉัน, because every other card leads to a page the term guard refuses.
 * Permissions still decide, so a member without them sees nothing extra by being locked.
 */
export function filterSettingsMenuItems(userPermissions: readonly string[], locked = false, systemCertificatesAvailable = true): SettingsMenuItem[] {
  return SETTINGS_MENU_ITEMS.filter((item) => (!locked || LOCKED_SHELL_CARD_KEYS.has(item.key)) && (systemCertificatesAvailable || item.key !== 'tax-signature')
    && canSeeRoute(item.href, userPermissions));
}

/** Package management has one top-level entry, separate from the settings overview. */
export const PACKAGE_MENU = { title: 'แพ็กเกจ', href: '/billing' } as const;

/**
 * ข้อมูลร้าน and บัญชีของฉัน need `company.setup.read`, which staff do not have — so in the locked
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

// The rows under ตั้งค่าบริษัท. The first and the last three are what a sold shop sees, in the order of the hub; the
// accounting rows keep their place for the shops that hold them.
const SETTINGS_SIDEBAR_KEYS = [
  'company-profile',
  'accounting-tax-setup',
  'chart-of-accounts',
  'tax-codes',
  'tax-accounts',
  'branches',
  'substitute-receipt',
  'e-wht',
  'tax-signature',
] as const;

export function filterSettingsSidebarItems(userPermissions: readonly string[], systemCertificatesAvailable = true): SettingsMenuItem[] {
  const visible = new Map(filterSettingsMenuItems(userPermissions, false, systemCertificatesAvailable).map((item) => [item.key, item]));
  return SETTINGS_SIDEBAR_KEYS.flatMap((key) => visible.get(key) ?? []);
}
