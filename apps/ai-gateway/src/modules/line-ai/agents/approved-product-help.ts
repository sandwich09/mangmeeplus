/** Curated product guidance reviewed against these exact source/body hashes. */
import { knowledgeCardHash, knowledgePackHash, type ProductKnowledgeCard, type ProductKnowledgePack } from './approved-knowledge';

const sources = {
  expenses: { file: 'expenses-guide.content.ts', hash: '73f50c3324ed2051b4881206cd68b1beb2542b21fcd67875eb68f07d92d42982' },
  reimbursements: { file: 'reimbursement-guide.content.ts', hash: '253ebcff2fcd5d3ae50eb94a27722027092a528c19ae769ed57be92bc6539954' },
  'substitute-receipts': { file: 'substitute-receipt-guide.content.ts', hash: 'a444dd458af1b3ec395175b720a08fd58e3de0ec913b46cb985d262565b1c705' },
  reports: { file: 'reports-guide.content.ts', hash: '8bf9239b344d299117b3e228ce9aec503809758458f14cec8c316b1143b40baa' },
} as const;

function card(
  id: string, guide: keyof typeof sources, anchor: string, title: string, questions: string[], body: string,
  permissionAnyOf: string[], requiredCapabilities: string[] = [],
): ProductKnowledgeCard {
  const value: ProductKnowledgeCard = {
    id, version: 1, title, questions, summary: title, body,
    sourceURL: `/companies/{companyId}/user-guide/${guide}#${anchor}`,
    sourceFile: `apps/web/src/features/user-guide/${sources[guide].file}`, sourceHash: sources[guide].hash,
    contentHash: '', permissionAnyOf, requiredPermissions: [],
    featureKeys: guide === 'expenses' || guide === 'substitute-receipts' ? ['expenses'] : guide === 'reports' ? ['reports'] : [],
    requiredCapabilities, audience: 'member', risk: 'R1',
  };
  value.contentHash = knowledgeCardHash(value);
  return value;
}

const expenseReaders = ['expense.read', 'expense.read_own'];
const reimbursementReaders = ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'];
const substituteReaders = ['expense.review', 'expense.confirm', 'expense.read_own'];

export const PRODUCT_HELP_PACK: ProductKnowledgePack = {
  id: 'mangmee-product-help', version: 1, status: 'APPROVED',
  language: 'th', jurisdiction: 'TH',
  owner: 'repository:product-help', reviewers: ['repository-ai-source-code-review:codex-gpt-5.6-sol:2026-09-27'],
  effectiveFrom: '2026-09-27T00:00:00+07:00', effectiveTo: '2026-12-27T00:00:00+07:00', reviewDueAt: '2026-12-27T00:00:00+07:00',
  releaseRange: { min: '2.4.0', maxExclusive: '2.5.0' }, contentHash: '',
  cards: [
    card('expense.start', 'expenses', 'overview', 'เริ่มบันทึกค่าใช้จ่าย', ['เริ่มลงค่าใช้จ่ายยังไง', 'รายจ่ายเข้าระบบแล้วทำอะไรต่อ'],
      'เลือกสาขาของรายการ แล้วนำใบเสร็จเข้าระบบหรือบันทึกด้วยมือ ระบบเก็บเป็นฉบับร่างให้ตรวจชื่อผู้ขาย เลขที่เอกสาร วันที่ ยอดเงิน และไฟล์แนบก่อนยืนยัน การบันทึกร่างยังไม่ใช่การยืนยันเอกสารหรือจ่ายเงินค่ะ', expenseReaders),
    card('expense.status', 'expenses', 'overview', 'สถานะเอกสารกับสถานะจ่ายเงิน', ['ยืนยันแล้วแปลว่าจ่ายแล้วไหม', 'ทำไมสถานะมีสองบรรทัด'],
      'สถานะเอกสารบอกว่าตรวจไปถึงขั้นใด ส่วนสถานะชำระเงินบอกว่าจ่ายให้ผู้ขายหรือยัง เป็นคนละเรื่องกันค่ะ เอกสารที่ยืนยันแล้วอาจยังไม่จ่ายเงิน และรายการที่จ่ายแล้วอาจยังตรวจเอกสารไม่ครบ', expenseReaders),
    card('expense.find', 'expenses', 'list', 'ค้นหารายการค่าใช้จ่าย', ['หาบิลร้านเดิมยังไง', 'ดูรายการตามสถานะที่ไหน'],
      'ในรายการค่าใช้จ่าย เลือกช่วงเวลาแล้วกรองสถานะได้ ช่องค้นหาใช้ชื่อผู้ขายหรือเลขที่เอกสาร จากนั้นเปิดรายการที่ต้องการเพื่อตรวจรายละเอียดค่ะ', expenseReaders, ['expense.list_recent']),
    card('expense.draft', 'expenses', 'overview', 'ฉบับร่างต่างจากยืนยันแล้วอย่างไร', ['ร่างใช้เป็นยอดบัญชีแล้วหรือยัง', 'บันทึกไว้ก่อนแล้วค่อยตรวจได้ไหม'],
      'ฉบับร่างเป็นรายการที่บันทึกไว้และยังแก้ไขได้ ต้องตรวจรายละเอียดให้ครบก่อนยืนยัน เมื่อยืนยันแล้วไม่ใช่ร่างที่แก้ได้ตามปกติค่ะ หากข้อมูลผิดให้ตรวจขั้นตอนแก้ไขหรือยกเลิกตามสิทธิ์ก่อนดำเนินการ', expenseReaders),
    card('expense.vat-display', 'expenses', 'list', 'VAT ที่พบในเอกสารหมายถึงอะไร', ['ตัวเลข VAT ด้านบนขอคืนได้เลยไหม', 'ยอดภาษีในหน้ารายจ่ายคือยอดยื่นไหม'],
      'การ์ด VAT ในหน้ารายการเป็นยอด VAT ที่พบในเอกสาร ยังไม่ใช่ยอดภาษีซื้อที่ขอคืนได้ค่ะ ต้องตรวจคุณสมบัติเอกสารและเงื่อนไขภาษีของแต่ละรายการก่อนนำไปใช้ยื่น', expenseReaders),
    card('expense.export', 'expenses', 'overview', 'ส่งเอกสารให้นักบัญชี', ['เตรียมข้อมูลให้นักบัญชียังไง', 'ส่งรายจ่ายพร้อมหลักฐานได้ไหม'],
      'ตรวจรายการและหลักฐานให้ครบก่อนยืนยัน แล้วใช้ขั้นตอนส่งออกชุดรายการและหลักฐานที่ยืนยันแล้วบนเว็บตามสิทธิ์ เพื่อให้นักบัญชีตรวจและบันทึกบัญชีต่อค่ะ การถามคู่มือนี้ยังไม่ได้ส่งออกหรือส่งข้อมูลให้ใคร', ['expense.export']),
    card('reimbursement.meaning', 'reimbursements', 'quick-start', 'คำขอเบิกกับใบเบิกค่าใช้จ่าย', ['คำขอเบิกกับใบเบิกต่างกันยังไง', 'ฉันสำรองเงินเองแล้วต้องใช้เมนูไหน'],
      'การเบิกคืนใช้เมื่อคุณจ่ายเงินไปก่อนแล้วขอคืนจากบริษัทค่ะ คำขอเบิกคือรายการในระบบ ส่วนใบเบิกค่าใช้จ่ายคือเอกสารที่พิมพ์ไปลงนาม อย่าสับสนว่าการมีร่างหรือเอกสารพิมพ์หมายถึงอนุมัติหรือจ่ายคืนแล้ว', reimbursementReaders),
    card('reimbursement.roles', 'reimbursements', 'tabs', 'ทำไมเห็นแท็บเบิกจ่ายไม่เหมือนกัน', ['เพื่อนเห็นแท็บแต่ฉันไม่เห็น', 'หาเมนูเบิกจ่ายไม่เจอ'],
      'หน้าการเบิกจ่ายแสดงแท็บตามบทบาทและสิทธิ์ของแต่ละคนค่ะ ผู้เบิก ผู้อนุมัติ และฝ่ายการเงินจึงเห็นงานต่างกัน หากไม่พบส่วนที่ต้องใช้ ให้ผู้ดูแลตรวจสิทธิ์ของคุณก่อน ไม่ต้องสร้างคำขอใหม่เพื่อแก้ปัญหาการเข้าถึง', reimbursementReaders),
    card('substitute.meaning', 'substitute-receipts', 'overview', 'ใบรับรองแทนใบเสร็จคืออะไร', ['ร้านออกใบเสร็จไม่ได้ต้องทำไง', 'ใบทดแทนใช้ทำอะไร'],
      'เป็นเอกสารที่บริษัทจัดทำเพื่อใช้เป็นหลักฐานรายจ่าย เมื่อจ่ายเงินจริงเพื่อกิจการแต่ผู้รับเงินออกใบเสร็จที่ถูกต้องครบถ้วนให้ไม่ได้ค่ะ เริ่มจากรายการค่าใช้จ่ายที่เกี่ยวข้อง แล้วตรวจข้อมูลและหลักฐานตามขั้นตอนของบริษัท', substituteReaders),
    card('substitute.evidence', 'substitute-receipts', 'evidence', 'หลักฐานรายการกับหลักฐานชำระเงิน', ['สลิปกับรูปของซื้อใช้แทนกันไหม', 'ทำไมต้องแนบหลักฐานสองแบบ'],
      'หลักฐานประกอบรายการบอกว่าซื้ออะไร เช่น บิลเขียนมือ ภาพสินค้า หรือข้อความยืนยันคำสั่งซื้อ ส่วนหลักฐานชำระเงินบอกว่าจ่ายจริง เช่น สลิปโอนหรือใบสำคัญรับเงินที่ลงชื่อแล้วค่ะ จึงใช้ตอบคนละคำถาม', substituteReaders),
    card('substitute.review-sign', 'substitute-receipts', 'sign', 'อ่านเอกสารก่อนลงนาม', ['ทำไมกดลงชื่อไม่ได้', 'ต้องอ่านฉบับเต็มก่อนอนุมัติไหม'],
      'ขั้นตอนลงลายมือชื่อและอนุมัติบังคับให้เปิดอ่านเอกสารฉบับเต็มก่อนค่ะ ผู้ลงนามและผู้อนุมัติต้องตรวจฉบับที่ตรงกับขั้นตอนของตน การลงนาม ยืนยันคำรับรอง และอนุมัติออกเอกสารทำบนเว็บด้วยสิทธิ์ที่กำหนด', substituteReaders),
    card('report.access', 'reports', 'overview', 'รายงานที่แต่ละคนเรียกดูได้', ['ทำไมฉันเห็นรายงานน้อยกว่าเจ้าของ', 'ส่งออกแล้วตรวจสิทธิ์อีกไหม'],
      'ระบบแสดงเฉพาะรายงานที่บัญชีของคุณมีสิทธิ์เรียกดู และตรวจสิทธิ์อีกครั้งเมื่อส่งออกค่ะ ผู้ใช้ต่างบทบาทจึงเห็นรายงานไม่เท่ากัน ถ้าต้องใช้รายงานเพิ่ม ให้ผู้ดูแลตรวจสิทธิ์ก่อน', ['report.catalog.read', 'report.snapshot.read']),
  ],
};
PRODUCT_HELP_PACK.contentHash = knowledgePackHash(PRODUCT_HELP_PACK);
