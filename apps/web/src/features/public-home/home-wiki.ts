import { HOME_CONTACT_URL, HOME_LINE_URL, HOME_NAMES, HOME_PLANS, HOME_SOCIAL, HOME_URL, homeNumber } from './home-content';
import reviewedHelp from './home-help-v6.json';

// Keep the deployed web app independent of gateway code; home-help-v6.spec.ts pins this reviewed snapshot.
export const HOME_HELP_V6 = reviewedHelp;
export const LLMS_SUMMARY = `# MangmeePlus — มั่งมีพลัส

> Receipt and expense software for Thai shops. AI prepares drafts in LINE; authorized people review and confirm. มั่งมีพลัสช่วยร้านเก็บใบเสร็จและค่าใช้จ่าย AI เตรียมร่าง คนตรวจแล้วยืนยัน ไม่แทนนักบัญชี

Also known as / ชื่อที่ใช้: ${HOME_NAMES.join(', ')} (mangmee_plus is the social media handle / ชื่อบนโซเชียลมีเดีย)

## Product / ผลิตภัณฑ์
- [Bilingual product wiki and reviewed common questions / ข้อมูลและคำถามไทยอังกฤษ](${HOME_URL}llms-full.txt)
- [Home / หน้าแรก](${HOME_URL})
- [How it works / วิธีใช้](${HOME_URL}#how)
- [Features / งานที่ช่วย](${HOME_URL}#use)
- [LINE assistant / น้องมั่งมี](${HOME_URL}#line)
- [Packages / ราคา](${HOME_URL}#pricing)
- [FAQ / คำถามที่พบบ่อย](${HOME_URL}#faq)

## Standard prices / ราคาปกติ
${HOME_PLANS.map(p => `- ${p.name}: ${homeNumber(p.monthlyPrice)} บาท/เดือน / THB ${homeNumber(p.monthlyPrice)}/month; ${homeNumber(p.annualPrice)} บาท/ปี / THB ${homeNumber(p.annualPrice)}/year`).join('\n')}
- ราคานี้ยังไม่มี VAT ออกใบเสร็จรับเงินให้ / No VAT is charged; a receipt is provided.
- แพ็กที่ขายไม่รวมรายงาน / Reports are not included in the sold packages.
- Enterprise ออก 50 ทวิในระบบตามสิทธิ์ แพ็กอื่นจดใบนอกระบบพร้อมไฟล์ถ้ามี / Enterprise supports authorized in-system 50 bis; other packages record external certificates with an optional file.

## Legal and contact / นโยบายและติดต่อ
- [Privacy / ความเป็นส่วนตัว](${HOME_URL}privacy)
- [Terms / เงื่อนไข](${HOME_URL}terms)
- [Start in LINE / เริ่มใช้งานผ่าน LINE](${HOME_LINE_URL})
- [Contact the team / คุยกับทีมงาน](${HOME_CONTACT_URL})
- [Email / อีเมล](mailto:contact@mangmeeplus.com)
${HOME_SOCIAL.map(url => `- [${url.includes('facebook') ? 'Facebook' : url.includes('instagram') ? 'Instagram' : 'TikTok'}](${url})`).join('\n')}
`;

const thaiPackages = HOME_PLANS.map(p => `- ${p.name}: ${homeNumber(p.monthlyPrice)} บาท/เดือน หรือ ${homeNumber(p.annualPrice)} บาท/ปี; อ่านสำเร็จ ${homeNumber(p.monthlyReceipts)} ใบต่อเดือนเมื่อจ่ายรายเดือน หรือ ${homeNumber(p.annualReceipts)} ใบทั้งรอบเมื่อจ่ายรายปี; ผู้ใช้ ${p.users} คนรวมเจ้าของ; ${p.branches} สาขา`).join('\n');
const englishPackages = HOME_PLANS.map((p, i) => `- ${['Starter', 'Basic', 'Pro', 'Enterprise'][i]} (${p.name}): THB ${homeNumber(p.monthlyPrice)}/month or THB ${homeNumber(p.annualPrice)}/year; ${homeNumber(p.monthlyReceipts)} successful reads per monthly period or ${homeNumber(p.annualReceipts)} reads upfront per annual period; ${p.users} users including the owner; ${p.branches} branches.`).join('\n');

export const LLMS_FULL = `# MangmeePlus / มั่งมีพลัส

Canonical: ${HOME_URL}
Also known as: ${HOME_NAMES.join(', ')}
Social (mangmee_plus): ${HOME_SOCIAL.join(' ')}
Publisher: บริษัท มั่งมียั่งยืน จำกัด
Facts aligned with owner-approved LINE help v6 (2026-10-21). Current shop offers, enabled channels and permissions apply.

## ภาษาไทย
มั่งมีพลัสช่วยร้านและธุรกิจเล็กเก็บใบเสร็จและค่าใช้จ่ายผ่าน LINE และเว็บ AI เตรียมร่างให้คนตรวจ ไม่แทนนักบัญชี ไม่โอนเงิน ไม่ยื่นภาษี และไม่ให้สินเชื่อ

### เริ่มใช้งาน
เริ่มที่ ${HOME_LINE_URL} เมื่อเปิดรับสมัคร เจ้าของกิจการพิมพ์ “เปลี่ยนบริษัท” แล้วกด “เปิดร้านใหม่” พนักงานเลือก “แพ็กเกจและราคา” ร้านที่เข้าเกณฑ์ใช้ฟรีส่งเอกสารเพื่อเก็บร่างได้ตามสิทธิ์ งานอื่นใช้สิทธิ์ของแพ็กเกจปัจจุบัน เข้าระบบที่ ${HOME_URL}login หรือลิงก์ส่วนตัว “เปิดเว็บบริษัทนี้”
สิทธิ์ใช้ฟรีเก็บร่างรายจ่ายจากเอกสารเท่านั้น ยังยืนยันเอกสาร บันทึกจ่าย หรือส่งออกไม่ได้ ร้านที่เคยซื้อแพ็กเกจแล้วหมดอายุไม่อยู่ในสิทธิ์ใช้ฟรีนี้

### แพ็กเกจมาตรฐาน
${thaiPackages}
แพ็ก 249 / 499 / 999 ใช้เมนูหลักเดียวกัน: LINE หน้าแรก ค่าใช้จ่าย การเบิกจ่าย พนักงานและสิทธิ์ การแจ้งเตือน รุ่น 1,999 เพิ่ม ภ.ง.ด.53 และออก 50 ทวิในระบบ รายงานไม่รวมในแพ็กที่ขาย ร้านที่เปิดแยกยังต้องมีสิทธิ์ดูและส่งออก
นับเมื่อ AI อ่านและบันทึกผลสำเร็จ แก้เองใช้ผลเดิม รายปีจ่ายเท่ากับ 10 เดือน ได้สิทธิ์ทั้งรอบตั้งแต่เริ่ม ผู้ใช้รวมเจ้าของ ราคานี้ยังไม่มี VAT ออกใบเสร็จรับเงินให้ ตรวจข้อเสนอปัจจุบันก่อนจ่าย
ต่ออายุ เปลี่ยน ยกเลิก คืนเงิน หมดอายุ และจ่ายไม่ผ่าน ดูคำถามแพ็กเกจด้านล่าง การคืนเงินตรวจเป็นรายกรณี ข้อมูลเก็บตามนโยบาย

### งานที่ช่วยตามช่องทางและสิทธิ์
- ใบเบิก: ส่ง → อนุมัติ → จ่ายเงินคืน → เซ็น ผู้เบิกและผู้อนุมัติเซ็นตามหน้าที่หลังจ่ายคืน หรือแนบกระดาษที่เซ็นครบ
- “เลือกวันที่” เริ่มเดือนก่อน เฉพาะยอดรายจ่ายตามช่วง ใบเสร็จรอตรวจและค้างจ่ายทั้งหมดรวมทุกช่วงเวลา
- ขั้นตอนรายจ่าย การจ่าย ใบเตรียมจ่าย ใบรับรองแทนใบเสร็จ ส่งออกให้นักบัญชี ลายเซ็นและการแจ้งเตือนอยู่ในคำถามด้านล่าง ตามช่องทางและสิทธิ์ของร้าน

### 50 ทวิและข้อมูล
ร้านที่ใช้แพ็ก 1,999 และมีสิทธิ์ออกหนังสือรับรอง 50 ทวิ ตรวจข้อมูลผู้รับเงินและการจ่ายก่อนออกใบ แพ็กอื่นจดเลขที่และวันที่ของใบนอกระบบและแนบไฟล์ถ้ามี ตรวจ VAT ก่อนใช้ตอนยื่นภาษีและส่งภาษีให้กรมสรรพากรแยกจากการออกใบ
ใช้ AWS และ AI บน AWS Bedrock เว็บ HTTPS เข้ารหัสระหว่างทาง ตรวจสิทธิ์และขอบเขตทั้งเว็บกับ LINE เก็บประวัติรายการสำคัญ นโยบายความเป็นส่วนตัวกำกับการใช้และเก็บข้อมูล รูปเบลอ ใบยับและลายมืออาจอ่านผิด ต้องตรวจก่อนยืนยัน ไม่รับรองความถูกต้องทางภาษี

## English
MangmeePlus helps Thai shops, employees and accountants manage receipts and expenses. AI prepares drafts for human review; it does not replace an accountant, transfer money, file taxes or provide loans.

### Getting started
Start at ${HOME_LINE_URL} when signup is open. Linked owners choose a shop or open a new one. Staff can view packages and prices. Eligible never-paid shops can send expense documents and keep drafts within their free allowance. Other work follows the shop’s current package and permissions. Sign in at ${HOME_URL}login or use the personal shop link.
Free access covers source drafts only, without financial confirmation, payment recording or exports. Shops whose paid package has expired are outside this free allowance.

### Standard packages
${englishPackages}
Starter, Basic and Pro share core LINE, home, expense, claim, staff/permission and notification menus. Enterprise adds PND 53 and in-system 50 bis. Reports are not included in sold packages; separately enabled reports require view/export permissions.
Count successful AI reads saved to the system; corrections reuse results. Annual billing costs ten monthly payments and grants all reads upfront. Users include the owner. No VAT is charged; a receipt is provided. Check current offers before paying.
Renewal, changes, cancellation, refunds and expiry follow current shop terms and the reviewed questions below. Refunds are assessed individually; data retention follows policy.

### Workflows and safeguards
LINE drafts, totals and branches follow permissions. Confirmation and payment are separate. Claims follow submit → approve → reimburse → sign; claimant and approver sign after reimbursement or provide fully signed paper. The shop pays itself.
Payment preparation groups one payee's expenses; after approval and actual payment, recording it creates a payment voucher with the same number. Substitute receipts document actual payments with incomplete payee evidence; check purchase/payment evidence and read the full document before signing or approving, including all uploaded paper pages. Registering a signature or reading a notification does not perform the document action.
Home custom dates initially select last month; only spending follows the range. Pending receipts and total unpaid cover all dates. Authorized accountant exports of reviewed, confirmed records are distinct from reports.
Authorized shops on the 1,999 pack can issue a 50 bis after checking the payee and payment. Other packs record an external certificate’s number and date with an optional file. Check VAT before using it when filing tax. The shop handles filing and sending tax to the Revenue Department separately.
AWS and AWS Bedrock are used; HTTPS encrypts traffic. Web and LINE check permissions/scope and retain important-action history. The privacy policy governs processing/retention. Blurry or handwritten evidence can need correction; AI does not guarantee tax accuracy.

## Common questions / คำถามที่พบบ่อยจากผู้ใช้
${reviewedHelp.cards.map(c => `- ${c.titleTh} / ${c.titleEn}: ${c.answerTh} / ${c.answerEn}`).join('\n')}

## Contact / ติดต่อ
- Website / เว็บ: ${HOME_URL}
- Start / เริ่ม: ${HOME_LINE_URL}
- Team / ทีมงาน LINE @mangmeeplus: ${HOME_CONTACT_URL}
- Email / อีเมล: contact@mangmeeplus.com
- Privacy / ความเป็นส่วนตัว: ${HOME_URL}privacy
- Terms / เงื่อนไข: ${HOME_URL}terms
`;

export function wikiResponse(body: string) {
  return new Response(body, { status: 200, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=86400',
  } });
}
