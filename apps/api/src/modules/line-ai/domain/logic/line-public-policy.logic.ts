// Public policy only. These are defaults, not a lookup of this caller's plan or payment status.
// Sources and the owner amendments are recorded in docs/agent-memory/line-trial-policy-conversation-20260918.md.
const ANSWERS = {
  trial: {
    title: 'การเริ่มใช้งานและการต่ออายุ',
    text: 'ร้านที่เปิดสำเร็จและยังไม่เคยซื้อแพ็กเกจ ใช้สิทธิ์อ่านบิล ใบเสร็จ หรือสลิปที่เกี่ยวกับรายจ่ายรวม 3 ใบต่อเดือน ดูและแก้ร่างในเว็บได้ค่ะ สิทธิ์นี้ไม่รวมการถามตอบกับน้องมั่งมีหรือการยืนยันและจ่ายเงิน\n'
      + 'ไม่บังคับซื้อหรือเรียกเก็บเงินอัตโนมัติจากการใช้สิทธิ์ฟรี ร้านที่เคยซื้อแพ็กเกจแล้วหมดอายุไม่อยู่ในสิทธิ์นี้ค่ะ\n'
      + 'ร้านที่มีสิทธิ์ทดลองเดิมยังใช้ตามสิทธิ์เดิมจนหมดช่วง ทั้งหมดขึ้นกับสถานะร้านและสิทธิ์ของผู้ใช้งานค่ะ',
  },
  trial_limits: {
    title: 'เปิดร้านแล้วใช้อะไรได้บ้าง',
    text: 'ร้านที่เปิดสำเร็จและยังไม่เคยซื้อแพ็กเกจ อ่านเอกสารรายจ่ายรวม 3 ใบต่อเดือน เปิดดู แก้ข้อมูลในเว็บ และเก็บร่างได้ค่ะ เมื่ออ่านครบแล้ว ยังเปิดดูและแก้ร่างเดิมได้\n'
      + 'ยังไม่รวมการถามตอบกับน้องมั่งมี การสร้างรายจ่ายเปล่า การยืนยัน อนุมัติ จ่ายเงิน ลงบัญชี หรือโมดูลอื่นค่ะ ร้านที่เคยซื้อแพ็กเกจแล้วหมดอายุไม่อยู่ในสิทธิ์นี้',
  },
  package_features: {
    title: 'เมนูในแพ็กเกจ',
    text: 'แพ็กเกจ 249 / 499 / 999 ได้เมนูหลักชุดเดียวกัน คือ ผู้ช่วย AI ทาง LINE หน้าแรก ค่าใช้จ่ายและใบเสร็จ การเบิกจ่าย พนักงานและสิทธิ์ และการแจ้งเตือน ต่างกันที่จำนวนสาขา ผู้ใช้ และใบเสร็จค่ะ\n'
      + 'แพ็กเกจธุรกิจ 1,999 ได้เมนูเดียวกัน และเพิ่มเอกสารภาษี ภ.ง.ด.53 และ 50 ทวิ ที่ออกจากระบบค่ะ',
  },
  card: {
    title: 'เริ่มใช้งานอย่างไร',
    text: 'กด "เปิดร้านใหม่" ใน LINE → กรอกข้อมูล → รอเปิดร้านสำเร็จ → เข้าหน้าร้านค่ะ\n'
      + 'สมัครไม่ต้องผูกบัตร เมื่อเปิดร้านสำเร็จจึงใช้ฟีเจอร์ตามสิทธิ์ของร้านและผู้ใช้งานได้ค่ะ',
  },
  data: {
    title: 'ข้อมูลเมื่อยังไม่มีแพ็กเกจหรือหมดอายุ',
    text: 'ข้อมูลไม่ได้ถูกลบทันทีเพราะหมดช่วงทดลองค่ะ หากร้านยังไม่เคยซื้อแพ็กเกจและเข้าเกณฑ์สิทธิ์ฟรี ยังดูและแก้ร่างรายจ่ายได้ ส่วนฟีเจอร์อื่นเป็นไปตามสิทธิ์ปัจจุบัน\nหากต้องการขอลบข้อมูล ต้องแจ้งคำขอทางอีเมลและยืนยันตัวตนกับทีมงานก่อน การถามในแชทนี้ยังไม่ได้ลบข้อมูลหรือเริ่มคำขอให้นะคะ ติดต่อทีมงานเพื่อรับขั้นตอนที่ถูกต้องได้ค่ะ',
  },
  paid_renewal: {
    title: 'การต่ออายุแพ็กเกจที่ซื้อแล้ว',
    text: 'แพ็กเกจที่ซื้อแล้วอาจต่ออายุและเรียกเก็บเงินอัตโนมัติเป็นรายเดือนหรือรายปี ตามเงื่อนไขที่คุณยอมรับตอนซื้อค่ะ\nส่วนร้านที่ยังไม่ได้ซื้อแพ็กเกจ จะไม่ถูกเรียกเก็บเงินอัตโนมัติ หากต้องการตรวจว่าบัญชีของคุณตั้งต่ออายุไว้หรือไม่ ให้ทีมงานตรวจสอบก่อนค่ะ',
  },
  buy_early: {
    title: 'ซื้อแพ็กเกจก่อนช่วงเดิมหมด',
    text: 'หากซื้อแพ็กเกจก่อนที่ช่วงใช้งานเดิมจะหมด แพ็กเกจที่ซื้อจะเริ่มทำงานและตัดรอบชำระทันทีค่ะ ควรตรวจเงื่อนไขแพ็กเกจก่อนยืนยันซื้อค่ะ',
  },
  quota: {
    title: 'นับสิทธิ์อ่านใบเสร็จอย่างไร',
    text: 'นับเมื่อ AI อ่านใบเสร็จได้และระบบบันทึกผลสำเร็จค่ะ ถ้าอ่านไม่ได้หรือบันทึกผลไม่สำเร็จ ระบบคืนสิทธิ์ที่กันไว้ การแก้ข้อมูลเองหรือส่งคำตอบซ้ำไม่ใช่การอ่านใหม่\nแพ็กเกจรายปีให้สิทธิ์ครบ 12 เดือนตั้งแต่เริ่มแพ็กเกจ ไม่ได้เติมใหม่ทุกเดือนค่ะ',
  },
  plan_change: {
    title: 'ต่ออายุและเปลี่ยนแพ็กเกจ',
    text: 'ซื้อแพ็กเกจเดิมซ้ำจะได้สิทธิ์อ่านเพิ่มทันที และต่อเวลาจากวันหมดอายุเดิม ถ้าหมดอายุแล้วจะเริ่มจากวันที่ชำระค่ะ\nเพิ่มระดับแพ็กเกจมีผลหลังชำระส่วนต่าง โดยวันหมดอายุเดิมไม่เปลี่ยน ส่วนลดระดับจะมีผลเมื่อจบรอบที่ชำระแล้ว ให้ทีมงานตรวจข้อเสนอที่เปิดให้ใช้ก่อนยืนยันค่ะ',
  },
  cancellation: {
    title: 'ยกเลิกแพ็กเกจและขอคืนเงิน',
    text: 'การยกเลิกแพ็กเกจมีผลเมื่อสิ้นสุดรอบที่ชำระแล้วค่ะ การขอยกเลิกไม่ได้หมายถึงได้รับเงินคืนอัตโนมัติ คำขอคืนเงินหรือยอดที่มีข้อโต้แย้งต้องให้ทีมงานตรวจเป็นรายกรณี\nคำตอบนี้เป็นข้อมูลนโยบาย ยังไม่ได้ยกเลิกหรือยื่นขอคืนเงินให้ค่ะ',
  },
  payment_failure: {
    title: 'เมื่อชำระต่ออายุไม่สำเร็จ',
    text: 'สำหรับแพ็กเกจที่ซื้อแล้ว นโยบายมาตรฐานมีช่วงผ่อนผัน 7 วันเมื่อชำระต่ออายุไม่สำเร็จ แต่ไม่เพิ่มสิทธิ์อ่านรอบใหม่ที่ยังไม่ได้ชำระค่ะ\nช่วงนี้ไม่ใช่วันทดลองใช้ฟรีเพิ่ม และอาจมีเงื่อนไขเฉพาะบริษัท ให้ทีมงานตรวจสถานะจริงก่อนค่ะ',
  },
} as const;

export type PublicPolicyTopic = keyof typeof ANSWERS;
export type PublicPolicyAnswer = { topic: PublicPolicyTopic; title: string; text: string };

export function isPublicPolicyTopic(value: unknown): value is PublicPolicyTopic {
  return typeof value === 'string' && Object.hasOwn(ANSWERS, value);
}

function normalizedQuestion(value: string): string {
  if (!value.trim() || value.length > 160) return '';
  return value.normalize('NFC').replace(/\s+/gu, '').replace(/[?？!！]+$/u, '')
    .replace(/(?:นะ)?(?:ครับ|ค่ะ|คะ|คับ|จ้า|จ๊ะ)$/u, '').replace(/[?？!！]+$/u, '')
    .replace(/แพ็คเกจ/gu, 'แพ็กเกจ').replace(/มั้ย/gu, 'ไหม');
}

const charge = /^(?:(?:แอป|แอพ|ระบบ)นี้|มั่งมี(?:พลัส|Plus)?)?(?:ต้อง)?(?:เสีย|มี|คิด|เก็บ)(?:ค่าบริการ|ค่าใช้จ่าย|เงิน)(?:ไหม|หรือเปล่า|หรือไม่)$/iu;
const noPurchase = /^(?:ถ้า)?(?:ยัง)?ไม่ซื้อแพ็กเกจ(?:เพิ่ม)?(?:จะ)?(?:ต้องจ่ายเงิน|เสียเงิน|เสียค่าบริการ|โดนหักเงิน|ถูกเก็บเงิน)(?:ไหม|หรือเปล่า|หรือไม่)$/u;

const FOLLOW_UP = /^(?:ต้องสมัครต่อไหม|(?:แบบ)?(?:หมดอายุฟรีแล้ว)?(?:ถามว่า)?บังคับ(?:สมัครต่อ|ซื้อ|จ่ายเงิน)?ไหม|ไม่ต่อได้ไหม|ไม่ซื้อได้ไหม|ต้องจ่ายไหม|จะโดนหักเงินไหม|แน่(?:ใจ)?นะ|จริงไหม|แล้วข้อมูล(?:จะ)?หายไหม|(?:กดลิง(?:ก์|ค์)?|เข้า)(?:แล้ว)?(?:มา|ไป|เป็น)หน้าค่าใช้จ่าย|ลิง(?:ก์|ค์)?ผิด|กดแล้วไม่เจอแพ็กเกจ)$/u;

/** Only these short, whole-message follow-ups may read the last delivered public topic. */
export function isPublicPolicyFollowUp(messageText: string): boolean {
  const text = normalizedQuestion(messageText);
  return FOLLOW_UP.test(text) || charge.test(text) || noPurchase.test(text);
}

/** Owner 2026-09-30 (advisor spec §2.2): every policy answer ends by pointing at a person — the card's
 *  ติดต่อเจ้าหน้าที่ button — and never at the public package page. */
function answer(topic: PublicPolicyTopic): PublicPolicyAnswer {
  return { topic, ...ANSWERS[topic], text: `${ANSWERS[topic].text}\nมีคำถามเพิ่มเติม กดติดต่อเจ้าหน้าที่ได้เลยค่ะ` };
}

/** Same reviewed public instructions; a linked member's actual door is role/config scoped by the API. */
export const OPEN_SHOP_HELP_ANSWER = answer('card');
export function isOpenShopHelpQuestion(messageText: string): boolean {
  return /^(?:อยาก|ขอ)?เปิด(?:ร้าน(?:ใหม่|เพิ่ม|อีก(?:ร้าน)?)?|อีกร้าน)(?:ต้อง)?(?:ทำ)?(?:ยังไง|อย่างไร|ได้ไหม|ได้มั้ย|ได้หรือเปล่า)?$/u.test(normalizedQuestion(messageText));
}

export function resolvePublicPolicyAnswer(messageText: string, previous?: PublicPolicyTopic): PublicPolicyAnswer | null {
  const text = normalizedQuestion(messageText);
  if (!text) return null;
  // Whole-string matching deliberately leaves mixed requests, quotations and business mutations alone.
  const trialQuestion = /^(?:หลังจาก|หลัง|เมื่อ|พอ|ถ้า)?(?:หมด|จบ)?(?:ช่วง)?(?:ทดลอง(?:ใช้|ใข้)?(?:แอป|แอพ|ระบบ)?ฟรี|ใช้ฟรี|โปร(?:โมชั่น|โมชัน)?ฟรี)(?:หมด|จบ|สิ้นสุด)?(?:แล้ว)?(?:จะ)?(?:ต้อง)?(?:(?:(?:เสีย|จ่าย|มี|คิด|เก็บ)(?:เงิน|ค่าบริการ|ค่าใช้จ่าย)?)?(?:กี่บาท|เท่าไหร่|เท่าไร|ไหม|หรือเปล่า|หรือไม่)?|(?:ทำ(?:ยังไง|อย่างไร|ไง)|เป็น(?:ยังไง|อย่างไร)|ทำอะไร)(?:ต่อ)?|(?:ใช้|ใช้งาน)ต่อ(?:ยังไง|อย่างไร|ได้ไหม)|(?:บังคับ)?(?:สมัครต่อ|ซื้อแพ็กเกจ)(?:ไหม|หรือเปล่า))$/u;
  if (previous && !['trial', 'trial_limits', 'card'].includes(previous)
    && (charge.test(text) || noPurchase.test(text))) return answer('paid_renewal');
  if (trialQuestion.test(text) || charge.test(text) || noPurchase.test(text)
    || /^(?:แบบ)?หมดอายุฟรีแล้วบังคับสมัครต่อไหม$/u.test(text)) return answer('trial');

  const questions: ReadonlyArray<[PublicPolicyTopic, RegExp]> = [
    ['trial_limits', /^(?:(?:ทดลอง(?:ใช้)?ฟรี|ใช้ฟรี)(?:ได้)?(?:กี่วัน|นานแค่ไหน|กี่คน|กี่สาขา|กี่ใบ|กี่รายการ)|สิทธิ์ทดลองใช้ฟรี(?:มีอะไรบ้าง|ได้อะไรบ้าง))$/u],
    ['package_features', /^แพ็กเกจ(?:ไหน|นี้|ธุรกิจ|แต่ละแบบ)?(?:ได้|มี|เปิด|ใช้)(?:เมนู)?อะไร(?:ได้)?บ้าง$/u],
    ['card', /^(?:(?:สมัคร)?(?:ทดลอง(?:ใช้)?ฟรี|ใช้ฟรี)(?:ต้อง)?(?:ผูก|ใช้|ใส่|กรอก)(?:บัตร|บัตรเครดิต)(?:ไหม|หรือเปล่า)|ไม่มีบัตรเครดิต(?:ทดลองฟรี|ใช้ฟรี)ได้ไหม)$/u],
    ['data', /^(?:(?:ถ้า)?(?:หมด(?:ช่วง)?(?:ทดลอง(?:ใช้)?ฟรี|โปรฟรี)|ไม่ต่อ(?:อายุ)?แพ็กเกจ)(?:แล้ว)?ข้อมูล(?:จะ)?(?:หาย|ถูกลบ|ยังอยู่)(?:ไหม|หรือเปล่า)|(?:นโยบาย|ขั้นตอน)(?:การ)?ลบข้อมูล(?:เป็นอย่างไร|มีอะไรบ้าง)?|ขอลบข้อมูล(?:ต้องทำยังไง|มีขั้นตอนยังไง))$/u],
    ['paid_renewal', /^(?:(?:ซื้อแพ็กเกจแล้ว|แพ็กเกจที่ซื้อแล้ว)(?:จะ)?(?:หักเงินอีก|ต่ออายุอัตโนมัติ|หักเงินอัตโนมัติ)ไหม|ต่ออายุแพ็กเกจ(?:เสียเงิน|อัตโนมัติ)ไหม)$/u],
    ['buy_early', /^(?:ซื้อแพ็กเกจ(?:ก่อนหมด(?:ช่วง)?(?:ทดลอง(?:ใช้)?ฟรี|โปรฟรี)|ระหว่าง(?:ทดลอง(?:ใช้)?ฟรี|ใช้ฟรี))(?:ได้ไหม|เป็นยังไง|คิดเงินเมื่อไหร่)|(?:วัน|สิทธิ์)ทดลอง(?:ใช้)?ฟรีที่เหลือ(?:ทบได้ไหม|หายไหม))$/u],
    ['quota', /^(?:สิทธิ์อ่านใบเสร็จ(?:นับยังไง|นับอย่างไร)|(?:AI)?อ่านใบเสร็จไม่(?:สำเร็จ|ได้)(?:เสียสิทธิ์|หักสิทธิ์|นับโควตา)ไหม|แพ็กเกจรายปี(?:เติมสิทธิ์ทุกเดือนไหม|ได้สิทธิ์อ่านยังไง))$/iu],
    ['plan_change', /^(?:ซื้อแพ็กเกจเดิมซ้ำ(?:ได้อะไร|ได้ไหม)|(?:อัปเกรด|อัพเกรด|ดาวน์เกรด|เพิ่มระดับ|ลดระดับ)แพ็กเกจ(?:คิดเงินยังไง|มีผลเมื่อไหร่)|เปลี่ยนแพ็กเกจ(?:มีเงื่อนไขอะไร|คิดเงินยังไง))$/u],
    ['cancellation', /^(?:ยกเลิกแพ็กเกจ(?:ได้เงินคืนไหม|คืนเงินไหม|มีผลเมื่อไหร่|ทำยังไง)|(?:นโยบาย|เงื่อนไข)(?:การ)?(?:คืนเงิน|ยกเลิกแพ็กเกจ)(?:เป็นยังไง|มีอะไรบ้าง)?)$/u],
    ['payment_failure', /^(?:(?:ชำระ|จ่ายเงิน|ตัดเงิน)(?:ต่ออายุแพ็กเกจ)?ไม่(?:สำเร็จ|ผ่าน)(?:จะเป็นยังไง|ทำยังไง|มีผ่อนผันไหม)|แพ็กเกจ(?:มีระยะผ่อนผันกี่วัน|ผ่อนผันกี่วัน))$/u],
  ];
  for (const [topic, pattern] of questions) if (pattern.test(text)) return answer(topic);
  if (!previous || !FOLLOW_UP.test(text)) return null;
  if (/(?:หน้าค่าใช้จ่าย|ลิง(?:ก์|ค์)?ผิด|ไม่เจอแพ็กเกจ)/u.test(text)) {
    return { topic: previous, title: 'สอบถามเรื่องแพ็กเกจ', text: 'ขอโทษค่ะ หน้าค่าใช้จ่ายไม่ใช่หน้าข้อมูลแพ็กเกจที่คุณถาม\n'
      + 'เรื่องแพ็กเกจ กดติดต่อเจ้าหน้าที่ให้ทีมงานช่วยตอบได้เลยค่ะ' };
  }
  if (text === 'แล้วข้อมูลหายไหม' || text === 'แล้วข้อมูลจะหายไหม') return answer('data');
  if (/^(?:แน่(?:ใจ)?นะ|จริงไหม)$/u.test(text)) return answer(previous);
  // A paid-plan follow-up must never inherit the unpaid-trial assurance.
  return answer(['trial', 'trial_limits', 'card'].includes(previous) ? 'trial' : 'paid_renewal');
}

/** English copy of the same published policy; topic selection and account checks are unchanged. */
export function publicPolicyAnswerLanguage(answer: PublicPolicyAnswer, language: 'th' | 'en'): PublicPolicyAnswer {
  if (language === 'th') return answer;
  const copy: Record<PublicPolicyTopic, { title: string; text: string }> = {
    trial: { title: 'Getting started and renewal', text: 'Opened shops that have never bought a package can read three expense documents per month and view or edit drafts on the web. This does not include open chat or financial actions, does not charge automatically, and excludes expired paid shops. Existing trials retain their original access until expiry; shop status and user permissions still apply.' },
    trial_limits: { title: 'Available services', text: 'Opened shops that have never bought a package can read three expense documents per month and keep editing existing drafts after reaching the limit. Open chat, blank expense creation, confirmation, approval, payment, posting and other modules are excluded.' },
    package_features: { title: 'Package menus', text: 'The 249, 499 and 999 THB packages share core LINE AI, home, expenses, claims, team and notification menus with different allowances, while the 1,999 THB business package adds supported PND53 and withholding certificates.' },
    card: { title: 'Start using your shop', text: 'Choose Open new shop in LINE, enter the shop details, then wait for the shop to open and use its available features according to your permissions; no payment card is needed just to register.' },
    data: { title: 'Data without an active package', text: 'Data is not immediately deleted when trial access ends; eligible shops that have never bought a package can still view and edit expense drafts; a deletion request requires email and staff identity verification, and this chat has not deleted data or opened such a request.' },
    paid_renewal: { title: 'Paid package renewal', text: 'A purchased package may renew and charge monthly or yearly under the terms you accepted; a shop without a purchased package is not charged automatically, and staff can check your actual renewal settings.' },
    buy_early: { title: 'Buying before current access ends', text: 'A package bought before the existing access period ends starts its service and payment cycle immediately; review the terms before confirming purchase.' },
    quota: { title: 'Receipt-reading allowance', text: 'An allowance is used when AI reading and result storage succeed; failed reads or storage return the reserved allowance, manual edits and repeated replies are not new reads, and annual packages provide the full twelve-month allowance at the start.' },
    plan_change: { title: 'Renewing or changing packages', text: 'Buying the same package adds reading allowance immediately and extends the existing expiry, or starts from payment if expired; upgrades apply after paying the difference without changing the original expiry, while downgrades start after the current paid period.' },
    cancellation: { title: 'Cancellation and refunds', text: 'Cancel renewal to stop future charges; payments are generally non-refundable except where law requires otherwise or staff approve a case, and this policy answer has not cancelled a package or submitted a refund request.' },
    payment_failure: { title: 'Failed renewal payment', text: 'The standard paid-package policy allows a seven-day grace period after a failed renewal payment without adding unpaid reading allowance; this is not an extra free trial, and staff should verify shop-specific conditions and current status.' },
  };
  return { topic: answer.topic, ...copy[answer.topic], text: `${copy[answer.topic].text} Contact staff for further help.` };
}
