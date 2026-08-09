export const LEGAL_LAST_UPDATED = '10 สิงหาคม 2569';
export const LEGAL_EFFECTIVE_DATE = '10 สิงหาคม 2569';

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
  shortLabel: string;
}> = [
  { key: 'privacy', href: '/privacy', label: 'ประกาศความเป็นส่วนตัว', shortLabel: 'ความเป็นส่วนตัว' },
  { key: 'terms', href: '/terms', label: 'ข้อกำหนดการใช้งาน', shortLabel: 'ข้อกำหนด' },
  { key: 'data-deletion', href: '/data-deletion', label: 'การลบข้อมูล', shortLabel: 'การลบข้อมูล' },
];

export const LEGAL_SOURCES = {
  pdpaAct: 'https://odl.parliament.go.th/handle/20.500.13072/547319',
  pdpaRules: 'https://www.mdes.go.th/law',
  pdpaErasureRule: 'https://infocenter.oic.go.th/upload/cms/1744195455_4477.pdf',
  crossBorderSection28: 'https://ratchakitcha.soc.go.th/documents/14915.pdf',
  crossBorderSection29: 'https://ratchakitcha.soc.go.th/documents/14913.pdf',
  pdpcOffice: 'https://www.pdpc.or.th/',
} as const;
