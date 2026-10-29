import { billingOffer, shopPlanTierLabel } from '@watchdog-bms/contracts';
import faq from './home-faq.json';

export const HOME_URL = 'https://mangmeeplus.com/';
export const HOME_LINE_URL = 'https://lin.ee/U5oRBx1';
export const HOME_CONTACT_URL = 'https://line.me/R/ti/p/@695ultfm';
export const HOME_TITLE = 'มั่งมีพลัส (MangmeePlus) | จัดการรายจ่ายและเบิกจ่ายอย่างเป็นระบบ';
export const HOME_DESCRIPTION = 'มั่งมีพลัส โดย บริษัท มั่งมียั่งยืน จำกัด ช่วยรวมรายจ่ายและใบเบิก ตรวจและอนุมัติตามสิทธิ์ บันทึกการจ่ายพร้อมหลักฐานส่งสำนักงานบัญชี มี AI ช่วยอ่านใบเสร็จผ่าน LINE';
export const HOME_FAQ = faq;
export const HOME_PLANS = (['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'] as const).map(tier => {
  const month = billingOffer(tier, 'month'), year = billingOffer(tier, 'year');
  return { tier, name: shopPlanTierLabel(tier), monthlyPrice: month.priceSatang / 100,
    annualPrice: year.priceSatang / 100, monthlyReceipts: month.receiptAllowance,
    annualReceipts: year.receiptAllowance, users: month.employeeLimit, branches: month.branchLimit,
    systemTax: month.featureKeys.includes('wht_50bis') };
});
export type HomePlan = typeof HOME_PLANS[number];
export const homeNumber = (n: number) => n.toLocaleString('en-US');

export const HOME_DOCUMENTS = [
  ['sample-reimbursement', 'ใบเบิกค่าใช้จ่าย', 1273, 'ทุกแพ็กเกจ'],
  ['sample-payment-voucher', 'ใบสำคัญจ่าย', 1272, 'ทุกแพ็กเกจ'],
  ['sample-substitute-receipt', 'ใบรับรองแทนใบเสร็จรับเงิน', 1272, 'ทุกแพ็กเกจ'],
  ['sample-withholding-certificate', 'หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)', 1274, 'แพ็กเกจธุรกิจ'],
  ['sample-pnd3', 'แบบ ภ.ง.ด.3', 1272, 'แพ็กเกจธุรกิจ'],
  ['sample-pnd53', 'แบบ ภ.ง.ด.53', 1263, 'แพ็กเกจธุรกิจ'],
] as const;

// Names people search and the social media handle; the wiki lists the same set.
export const HOME_NAMES = ['มั่งมีพลัส', 'MangmeePlus', 'มั่งมี Plus', 'มั่งมี-Plus', 'Mangmee Plus', 'mangmee_plus'];
// The footer's social pages; Facebook is the page the footer's share link opens.
export const HOME_SOCIAL = ['https://www.facebook.com/profile.php?id=61593624702840', 'https://www.instagram.com/mangmee_plus', 'https://www.tiktok.com/@mangmee_plus'];

export const HOME_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${HOME_URL}#organization`, name: 'บริษัท มั่งมียั่งยืน จำกัด',
      alternateName: ['มั่งมียั่งยืน', ...HOME_NAMES], description: HOME_DESCRIPTION,
      sameAs: HOME_SOCIAL, url: HOME_URL, email: 'contact@mangmeeplus.com',
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', url: HOME_CONTACT_URL, availableLanguage: ['Thai', 'English'] } },
    { '@type': 'WebSite', '@id': `${HOME_URL}#website`, name: 'มั่งมีพลัส (MangmeePlus)', alternateName: HOME_NAMES, url: HOME_URL,
      inLanguage: 'th', publisher: { '@id': `${HOME_URL}#organization` } },
    { '@type': 'SoftwareApplication', '@id': `${HOME_URL}#software`, name: 'มั่งมีพลัส (MangmeePlus)', alternateName: HOME_NAMES, url: HOME_URL,
      applicationCategory: 'BusinessApplication', operatingSystem: 'Web, LINE', description: HOME_DESCRIPTION,
      publisher: { '@id': `${HOME_URL}#organization` },
      offers: HOME_PLANS.flatMap(plan => (['month', 'year'] as const).map(interval => ({
        '@type': 'Offer', name: `${plan.name} · ${interval === 'month' ? 'รายเดือน' : 'รายปี'}`,
        url: `${HOME_URL}#pricing`, price: interval === 'month' ? plan.monthlyPrice : plan.annualPrice, priceCurrency: 'THB',
        priceSpecification: { '@type': 'UnitPriceSpecification', price: interval === 'month' ? plan.monthlyPrice : plan.annualPrice,
          priceCurrency: 'THB', billingDuration: interval === 'month' ? 'P1M' : 'P1Y' },
      }))) },
    { '@type': 'FAQPage', '@id': `${HOME_URL}#faq`, mainEntity: HOME_FAQ.map(item => ({
      '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })) },
  ],
};
