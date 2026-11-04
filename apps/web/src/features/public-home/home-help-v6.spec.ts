import assert from 'node:assert/strict';
import test from 'node:test';
import { TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
import { HOME_FAQ, HOME_JSON_LD, HOME_PLANS, homeNumber } from './home-content';
import { HOME_HELP_V6, LLMS_FULL, LLMS_SUMMARY } from './home-wiki';

// Test-only read across apps: the deployed web routes import only their own reviewed snapshot.
const { activeProductHelpPack } = require('../../../../ai-gateway/src/modules/line-ai/agents/approved-product-help') as {
  activeProductHelpPack(): { version: number; status: string; contentHash: string; cards: Array<{
    id: string; title: string; body: string; featureKeys: string[]; permissionAnyOf: string[];
  }> };
};
const pack = activeProductHelpPack();
const card = (id: string) => { const value = pack.cards.find(c => c.id === id); assert.ok(value, id); return value; };
const summary = (id: string) => { const value = HOME_HELP_V6.cards.find(c => c.id === id); assert.ok(value, id); return value; };
const faq = (question: string) => { const value = HOME_FAQ.find(f => f.question === question); assert.ok(value, question); return value.answer; };

test('HOME-WIKI-V6 pins all 69 bilingual summaries to the approved pack and its exact titles', () => {
  assert.equal(pack.version, 7); assert.equal(pack.status, 'APPROVED'); assert.equal(pack.cards.length, 69);
  assert.equal(HOME_HELP_V6.sourcePackHash, pack.contentHash, 'Approved source changed: review website summaries before re-pinning');
  assert.deepEqual(HOME_HELP_V6.cards.map(c => [c.id, c.titleTh]), pack.cards.map(c => [c.id, c.title]));
  assert.match(LLMS_FULL, /## Common questions \/ คำถามที่พบบ่อยจากผู้ใช้/);
  for (const c of HOME_HELP_V6.cards) {
    assert.ok(c.answerTh && c.titleEn && c.answerEn, c.id);
    assert.ok(LLMS_FULL.includes(`${c.titleTh} / ${c.titleEn}: ${c.answerTh} / ${c.answerEn}`), c.id);
    assert.doesNotMatch(c.answerTh + c.answerEn, /\p{Extended_Pictographic}|[\uFE0F\u200D]|ค่ะ|นะคะ/gu, c.id);
  }
  assert.ok(Buffer.byteLength(LLMS_FULL, 'utf8') <= 40 * 1024, `Wiki is ${Buffer.byteLength(LLMS_FULL)} bytes`);
});

test('HOME-WIKI-V6 catalog prices, receipt quotas, branches and users agree with package.compare', () => {
  const numbers = card('package.compare').body.match(/ราคามาตรฐานต่อเดือน ([\d, /]+) บาท ตามลำดับได้ ([\d/]+) สาขา ผู้ใช้ ([\d/]+) คน ใบเสร็จ ([\d/]+) ใบ/);
  assert.ok(numbers);
  const values = (s: string) => s.split('/').map(n => Number(n.replaceAll(',', '').trim()));
  assert.deepEqual(values(numbers[1]!), HOME_PLANS.map(p => p.monthlyPrice));
  assert.deepEqual(values(numbers[2]!), HOME_PLANS.map(p => p.branches));
  assert.deepEqual(values(numbers[3]!), HOME_PLANS.map(p => p.users));
  assert.deepEqual(values(numbers[4]!), HOME_PLANS.map(p => p.monthlyReceipts));
  for (const p of HOME_PLANS) {
    for (const wiki of [LLMS_FULL, LLMS_SUMMARY]) {
      assert.ok(wiki.includes(`${homeNumber(p.monthlyPrice)} บาท/เดือน`));
      assert.ok(wiki.includes(`THB ${homeNumber(p.monthlyPrice)}/month`));
    }
    assert.ok(faq('ราคาเท่าไร เปิดร้านเสียเงินไหม?').includes(homeNumber(p.monthlyPrice)));
  }
  assert.match(card('package.quota').body, /นับเมื่อ AI อ่านและบันทึกผลสำเร็จ/);
  assert.match(faq('นับใบเสร็จในแพ็กเกจยังไง?'), /นับเมื่อน้องมั่งมีอ่านและบันทึกผลสำเร็จ/);
  assert.match(LLMS_FULL, /Count successful AI reads saved to the system/);
  assert.match(summary('package.quota').answerTh, /AI อ่านและบันทึกผลสำเร็จ.*ผลเดิม.*รายปี.*ตั้งแต่เริ่ม/);
  assert.match(summary('package.quota').answerEn, /successful AI reads saved.*corrections reuse.*annual.*upfront/i);
});

test('HOME-WIKI-V6 keeps Enterprise issuing separate from an optional-file outside certificate', () => {
  assert.deepEqual(card('wht.system').featureKeys, ['wht_50bis']);
  assert.ok(card('wht.system').permissionAnyOf.includes('wht.certificate.issue'));
  assert.deepEqual(card('wht.outside').featureKeys, []);
  assert.ok(card('wht.outside').permissionAnyOf.includes('wht.external_certificate.link'));
  assert.match(card('wht.outside').body, /เลขที่และวันที่.*ได้ถ้ามี/);
  const answer = faq('ออก 50 ทวิ ภ.ง.ด.3 และ ภ.ง.ด.53 ได้ไหม?');
  assert.match(answer, /แพ็กเกจธุรกิจ.*ในระบบ.*แพ็กเกจอื่น.*นอกระบบ.*เลขที่และวันที่.*PDF ได้ถ้ามี/);
  assert.match(LLMS_FULL, /Authorized shops on the 1,999 pack can issue a 50 bis/);
  assert.match(LLMS_FULL, /Other packs record an external certificate’s number and date with an optional file/);
  assert.match(summary('wht.outside').answerTh, /เลขที่และวันที่.*ได้ถ้ามี/);
  assert.match(summary('wht.system').answerEn, /Enterprise with issuing enabled and authorized staff/);
  assert.deepEqual(HOME_PLANS.filter(p => p.systemTax).map(p => p.tier), ['ENTERPRISE_1999']);
});

test('HOME-WIKI-V6 claims are submitted, approved, reimbursed then signed by claimant and approver', () => {
  assert.match(card('claim.submit').body, /ส่งอนุมัติ/);
  assert.match(card('claim.approve').body, /จ่ายคืนเป็นขั้นตอนหลังอนุมัติ/);
  assert.match(card('claim.sign').body, /หลังจ่ายคืน ผู้เบิกและผู้อนุมัติเซ็น/);
  assert.match(LLMS_FULL, /ส่ง → อนุมัติ → จ่ายเงินคืน → เซ็น/);
  assert.match(LLMS_FULL, /submit → approve → reimburse → sign/);
  assert.match(faq('พนักงานเบิกเงินคืนยังไง?'), /อนุมัติ.*จ่ายเงินจริง.*จากนั้นผู้เบิกและผู้อนุมัติเซ็น/);
});

test('HOME-WIKI-V6 never promises the report module in sold packs', () => {
  for (const keys of Object.values(TIER_FEATURE_PRESETS)) assert.equal(keys.includes('reports'), false);
  for (const id of ['report.access', 'report.run-help']) {
    assert.ok(card(id).featureKeys.includes('reports'));
    assert.match(summary(id).answerTh, /(?:รายงานไม่รวมในแพ็กที่ขาย|แพ็กที่ขายไม่รวมรายงาน)/);
    assert.match(summary(id).answerEn, /Reports are not (?:included in|in) (?:the )?sold packages/);
  }
  for (const wiki of [LLMS_FULL, LLMS_SUMMARY]) assert.match(wiki, /Reports are not included in (?:the )?sold packages/);
  assert.match(faq('แพ็กเกจมีรายงานให้เรียกดูไหม?'), /รายงานไม่รวมในแพ็กที่ขาย.*เปิดรายงานแยก.*สิทธิ์/);
});

test('HOME-WIKI-V6 expiry/refunds stay conditional and only spending follows the home date range', () => {
  assert.match(card('package.expiry').body, /พักไว้.*ตามนโยบาย.*ลบข้อมูล.*แยก/);
  assert.match(card('package.cancellation').body, /จบรอบ.*รายกรณี/);
  assert.match(faq('แพ็กเกจหมดอายุแล้วข้อมูลอยู่ไหม?'), /พักไว้.*ตามนโยบาย.*แยก/);
  assert.match(faq('ยกเลิกแพ็กเกจหรือขอคืนเงินได้ไหม?'), /จบรอบ.*รายกรณี/);
  assert.match(LLMS_FULL, /Refunds are assessed individually; data retention follows policy/);
  assert.match(card('home.range').body, /เดือนก่อน.*ยอดรายจ่าย.*ใบเสร็จรอตรวจ.*ค้างจ่ายทั้งหมด.*ทุกช่วงเวลา/);
  assert.match(faq('ดูยอดค่าใช้จ่ายย้อนหลังได้ไหม?'), /เดือนก่อน.*ยอดรายจ่าย.*ใบเสร็จรอตรวจ.*ค้างจ่ายทั้งหมด.*ทุกช่วงเวลา/);
  const structuredFaq = HOME_JSON_LD['@graph'].find(item => item['@type'] === 'FAQPage');
  assert.ok(structuredFaq);
  assert.deepEqual(structuredFaq.mainEntity?.map(item => item.acceptedAnswer.text), HOME_FAQ.map(item => item.answer));
});

test('HOME-WIKI-V6 shop opening distinguishes owners/staff, pending requests and existing trials', () => {
  assert.match(card('shop.open').body, /เจ้าของกิจการ.*เปลี่ยนบริษัท.*เปิดร้านใหม่.*ช่องทางสมัครเปิด.*คำขอค้าง/);
  assert.match(card('shop.staff-open').body, /พนักงาน.*แพ็กเกจและราคา.*โปรโมชั่น/);
  assert.match(faq('เริ่มใช้ต้องทำอะไรบ้าง?'), /เจ้าของกิจการ.*เปลี่ยนบริษัท.*เปิดร้านใหม่.*คำขอค้าง.*พนักงาน.*แพ็กเกจและราคา/);
  assert.match(card('package.before-payment').body, /ตั้งค่าร้านและบัญชี.*งานธุรกิจเริ่มเมื่อเลือกและจ่าย.*ทดลองเดิม/);
  assert.match(faq('ราคาเท่าไร เปิดร้านเสียเงินไหม?'), /งานธุรกิจเริ่มหลังเลือกและจ่าย.*ทดลองเดิม.*วันสิ้นสุด/);
  assert.match(summary('shop.staff-open').answerEn, /Staff use.*แพ็กเกจและราคา.*โปรโมชั่น.*for owners/);
});


test('PWS-PUBLIC-WORDS / PWS-WIKI-FREE-PAID describes source drafts, paid work and VAT in plain words', () => {
  const thai = LLMS_FULL.split('## ภาษาไทย')[1]!.split('## English')[0]!;
  const english = LLMS_FULL.split('## English')[1]!.split('## Common questions')[0]!;
  assert.ok(thai.includes('ร้านที่เข้าเกณฑ์ใช้ฟรีส่งเอกสารเพื่อเก็บร่างได้ตามสิทธิ์ งานอื่นใช้สิทธิ์ของแพ็กเกจปัจจุบัน'));
  assert.ok(thai.includes('สิทธิ์ใช้ฟรีเก็บร่างรายจ่ายจากเอกสารเท่านั้น ยังยืนยันเอกสาร บันทึกจ่าย หรือส่งออกไม่ได้'));
  assert.ok(thai.includes('ร้านที่เคยซื้อแพ็กเกจแล้วหมดอายุไม่อยู่ในสิทธิ์ใช้ฟรีนี้'));
  assert.ok(english.includes('Eligible never-paid shops can send expense documents and keep drafts within their free allowance. Other work follows the shop’s current package and permissions.'));
  assert.ok(english.includes('Free access covers source drafts only, without financial confirmation, payment recording or exports.'));
  assert.ok(english.includes('Shops whose paid package has expired are outside this free allowance.'));
  assert.ok(thai.includes('ร้านที่ใช้แพ็ก 1,999 และมีสิทธิ์ออกหนังสือรับรอง 50 ทวิ ตรวจข้อมูลผู้รับเงินและการจ่ายก่อนออกใบ'));
  assert.ok(thai.includes('ตรวจ VAT ก่อนใช้ตอนยื่นภาษีและส่งภาษีให้กรมสรรพากรแยกจากการออกใบ'));
  assert.ok(english.includes('Check VAT before using it when filing tax. The shop handles filing and sending tax to the Revenue Department separately.'));
  assert.doesNotMatch(thai + english, /งานธุรกิจเริ่มหลังจ่ายแพ็กเกจ|business work starts after payment|สิทธิ์ภาษีซื้อ|claimable input VAT/);
  assert.match(thai, /รายงานไม่รวมในแพ็กที่ขาย/);
  assert.match(english, /Reports are not included in sold packages/);
});


test('PWS-PUBLIC-HELP-WORDS pins the four exact owner-approved Thai public summaries', () => {
  assert.equal(summary('expense.vat-display').answerTh, "ยอดที่อ่านได้จากเอกสาร ยังไม่ได้แปลว่าใช้ตอนยื่นภาษีได้");
  assert.equal(summary('wht.calculation').answerTh, "เลือก “จ่ายค่าอะไร” แล้วใช้ยอดก่อน VAT คูณอัตราที่แสดง");
  assert.equal(summary('expense.vat-credit').answerTh, "ขึ้นกับเอกสารและเงื่อนไขของรายการ ดูคำตอบ “ใช้ VAT ตอนยื่นภาษี” ในรายการนั้น มีตัวจริงแต่ยังไม่มีรูป เลือก “มีตัวจริง ยังไม่ได้แนบรูป” แล้วแนบทีหลังได้");
  assert.equal(summary('pnd53.prepare').answerTh, "ร้านที่มีเมนูภาษีหัก ณ ที่จ่าย เปิดเดือนที่ต้องการ ตรวจผู้รับเงินให้ครบ แล้วส่งออก ภ.ง.ด.53 ไปยื่น การยื่นแยกจากการออก 50 ทวิ");
  assert.equal(summary('expense.vat-credit').titleTh, 'VAT นี้ใช้ตอนยื่นภาษีได้ไหม');
});
