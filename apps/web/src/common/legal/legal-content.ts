import { MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS } from '@watchdog-bms/contracts';

export const LEGAL_LAST_UPDATED = '9 สิงหาคม 2569';
export const LEGAL_EFFECTIVE_DATE = '9 สิงหาคม 2569';

export const LEGAL_OPERATOR = {
  tradeName: 'MangmeePlus',
  thaiTradeName: 'มั่งมี',
  legalName: 'บริษัท มั่งมียั่งยืน จำกัด',
  registrationNumber: '0105569135722',
  // Management-supplied contact address. Do not label it as the registered/head-office address
  // until a current DBD e-Certificate and RefNo verification are attached to the release evidence.
  contactAddress: '123/219 หมู่ที่ 11 แขวงบางขุนเทียน เขตจอมทอง กรุงเทพมหานคร 10150',
  privacyEmail: 'contact@mangmeeplus.com',
  // One intake address keeps privacy, security and service requests in the same monitored queue.
  // Production release remains blocked until mailbox ownership and primary/backup operators are proven.
  supportEmail: 'contact@mangmeeplus.com',
  website: 'https://mangmeeplus.com',
} as const;

export type LegalPageKind = 'privacy' | 'terms' | 'data-deletion';

export const LEGAL_NAV_ITEMS: ReadonlyArray<{
  key: LegalPageKind;
  href: string;
  label: string;
}> = [
  { key: 'privacy', href: '/privacy', label: 'นโยบายความเป็นส่วนตัว' },
  { key: 'terms', href: '/terms', label: 'ข้อกำหนดการใช้งาน' },
  { key: 'data-deletion', href: '/data-deletion', label: 'การลบข้อมูล' },
];

export const LEGAL_SOURCES = {
  pdpaAct: 'https://odl.parliament.go.th/handle/20.500.13072/547319',
  pdpaRules: 'https://www.mdes.go.th/law',
  pdpaErasureRule: 'https://infocenter.oic.go.th/upload/cms/1744195455_4477.pdf',
  crossBorderSection28: 'https://ratchakitcha.soc.go.th/documents/14915.pdf',
  crossBorderSection29: 'https://ratchakitcha.soc.go.th/documents/14913.pdf',
  accountingAct:
    'https://www.dbd.go.th/storage/law/9718f7ee-dd9f-463e-aa79-c7157355cec5.pdf',
  revenueCodeVat: 'https://www.rd.go.th/5209.html',
  electronicTransactions:
    'https://www.etda.or.th/th/Useful-Resource/%E0%B8%81%E0%B8%8F%E0%B8%AB%E0%B8%A1%E0%B8%B2%E0%B8%A2-HTML/%E0%B8%9E%E0%B8%A3%E0%B8%B0%E0%B8%A3%E0%B8%B2%E0%B8%8A%E0%B8%9A%E0%B8%B1%E0%B8%8D%E0%B8%8D%E0%B8%B1%E0%B8%95%E0%B8%B4%E0%B8%A7%E0%B9%88%E0%B8%B2%E0%B8%94%E0%B9%89%E0%B8%A7%E0%B8%A2%E0%B8%98%E0%B8%B8%E0%B8%A3%E0%B8%81%E0%B8%A3%E0%B8%A3%E0%B8%A1%E0%B8%97%E0%B8%B2%E0%B8%87%E0%B8%AD%E0%B8%B4%E0%B9%80%E0%B8%A5%E0%B9%87%E0%B8%81%E0%B8%97%E0%B8%A3%E0%B8%AD%E0%B8%99%E0%B8%B4%E0%B8%81%E0%B8%AA/%E0%B8%9E%E0%B8%A3%E0%B8%B0%E0%B8%A3%E0%B8%B2%E0%B8%8A%E0%B8%9A%E0%B8%B1%E0%B8%8D%E0%B8%8D%E0%B8%B1%E0%B8%95%E0%B8%B4%E0%B8%A7%E0%B9%88%E0%B8%B2%E0%B8%94%E0%B9%89%E0%B8%A7%E0%B8%A2%E0%B8%98%E0%B8%B8%E0%B8%A3%E0%B8%81%E0%B8%A3%E0%B8%A3%E0%B8%A1%E0%B8%97%E0%B8%B2%E0%B8%87%E0%B8%AD%E0%B8%B4%E0%B9%80%E0%B8%A5%E0%B9%87%E0%B8%81%E0%B8%97%E0%B8%A3%E0%B8%AD%E0%B8%99%E0%B8%B4%E0%B8%81%E0%B8%AA-%E0%B8%9E-%E0%B8%A8-2544-%28%E0%B8%89%E0%B8%9A%E0%B8%B1%E0%B8%9A%E0%B9%81%E0%B8%81%E0%B9%89%E0%B9%84%E0%B8%82%E0%B9%80%E0%B8%9E%E0%B8%B4%E0%B9%88%E0%B8%A1%E0%B9%80%E0%B8%95%E0%B8%B4%E0%B8%A1%29.aspx',
  pdpcOffice: 'https://www.pdpc.or.th/',
  companyRegistryService: 'https://ebiz.dbd.go.th/eservice-web/index.xhtml',
} as const;

export const PLATFORM_RETENTION_DEFAULTS = {
  aiDataDays: 90,
  crmMessageTextMonths: 24,
  crmMediaMonths: 12,
} as const;

export const REQUIRED_MARKETING_OPT_OUT_KEYWORDS = MANDATORY_MARKETING_UNSUBSCRIBE_KEYWORDS;
