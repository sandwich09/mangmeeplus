import type { MangmeeTone } from '@/common/components/mangmee';

export type SettingsMenuIconKey = 'BellIcon' | 'BoxIcon' | 'LockIcon' | 'GroupIcon' | 'DollarLineIcon';

export type SettingsMenuItem = {
  key: string;
  href: string;
  title: string;
  desc: string;
  iconKey: SettingsMenuIconKey;
  tone: MangmeeTone;
  requiredAnyPermissions: readonly string[];
  section?: 'primary' | 'advanced';
};

export const SETTINGS_MENU_ITEMS: readonly SettingsMenuItem[] = [
  {
    key: 'line-oa',
    href: '/settings/line-oa',
    title: 'เชื่อมต่อ LINE OA',
    desc: 'เชื่อม LINE OA ของบริษัทให้ข้อความลูกค้าเข้าสู่ CRM Inbox โดยอัตโนมัติ',
    iconKey: 'BellIcon',
    tone: 'line',
    requiredAnyPermissions: ['crm.channel.read'],
  },
  {
    key: 'crm-catalog',
    href: '/settings/crm-catalog',
    title: 'สินค้าและบริการสำหรับ CRM',
    desc: 'จัดการข้อมูล ราคา และระยะเวลาบริการที่พนักงานและ AI ใช้ตอบลูกค้าและสร้างการจอง',
    iconKey: 'BoxIcon',
    tone: 'purple',
    requiredAnyPermissions: ['inventory.product.read'],
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
    requiredAnyPermissions: ['company.branch.read', 'company.branch.manage'],
  },
  {
    key: 'accounting-tax-setup',
    href: '/settings/accounting-tax-setup',
    title: 'ตั้งค่าบัญชีและภาษี',
    desc: 'ทำตามลำดับตั้งแต่ผังบัญชี ชุดรหัสภาษี (Tax Profile) การผูกบัญชีและรายงาน จนพร้อมเปิดใช้งาน',
    iconKey: 'DollarLineIcon',
    tone: 'brand',
    // Every key here is entitlement-gated on purpose. `company.settings.view` (read-only
    // viewer) and `company.setup.manage` (always-on, no featureEntitlementKey) were the two
    // that survived when a company owns neither double_entry_ledger nor thai_tax, so the card
    // kept offering a wizard whose every step then read "ยังเปิดให้ใช้ไม่ได้". No step uses
    // either. With only these keys the card follows entitlement the way every other feature
    // menu does — the resolver strips a disabled family for every role, owner included.
    requiredAnyPermissions: [
      'ledger.account.read',
      'ledger.account.manage',
      'tax.profile.read',
      'tax.profile.manage',
      'tax.config.read',
      'tax.config.manage',
    ],
    section: 'primary',
  },
  {
    key: 'substitute-receipt',
    href: '/settings/substitute-receipt',
    title: 'ตั้งค่าใบรับรองแทนใบเสร็จ',
    desc: 'เลือกรูปแบบการอนุมัติและหลักฐานขั้นต่ำสำหรับรายจ่ายที่ไม่มีใบเสร็จรับเงิน',
    iconKey: 'DollarLineIcon',
    tone: 'brand',
    requiredAnyPermissions: ['company.setup.manage'],
  },
  {
    key: 'tax-codes',
    href: '/settings/tax-codes',
    title: 'Tax Code และ Tax Profile',
    desc: 'จัดการ SAP-compatible Tax Code ตาม profile บริบท อัตรา และช่วงวันที่มีผล',
    iconKey: 'DollarLineIcon',
    tone: 'indigo',
    requiredAnyPermissions: ['tax.profile.read', 'tax.profile.manage', 'tax.config.read', 'tax.config.manage'],
    section: 'advanced',
  },
  {
    key: 'tax-accounts',
    href: '/settings/tax-accounts',
    title: 'Tax Account Determination',
    desc: 'ผูก Tax Code กับผังบัญชี บทบาทบัญชี และช่องรายงาน ภ.พ.30/ภ.พ.36',
    iconKey: 'DollarLineIcon',
    tone: 'teal',
    requiredAnyPermissions: ['tax.config.read', 'tax.config.manage', 'ledger.posting-rule.read', 'ledger.posting-rule.manage'],
    section: 'advanced',
  },
  {
    key: 'chart-of-accounts',
    href: '/settings/chart-of-accounts',
    title: 'ผังบัญชี Master Data',
    desc: 'ตรวจผังบัญชี ที่มาของ Template ความพร้อม และผลกระทบก่อนเพิ่มหรือแทนที่บัญชี',
    iconKey: 'DollarLineIcon',
    tone: 'lime',
    requiredAnyPermissions: ['ledger.account.read', 'ledger.account.manage'],
    section: 'advanced',
  },
];

export function filterSettingsMenuItems(userPermissions: readonly string[]): SettingsMenuItem[] {
  return SETTINGS_MENU_ITEMS.filter(({ requiredAnyPermissions }) =>
    requiredAnyPermissions.length === 0
    || requiredAnyPermissions.some((permission) => userPermissions.includes(permission)),
  );
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
