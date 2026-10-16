/** Curated product guidance reviewed against these exact source/body hashes. */
import { EXPENSE_CORRECTION_WORDS, THAI_SYSTEM_ROLE_NAMES, LINE_CHAT_ACTIONS, LINE_TOOL_REGISTRY, LINE_RECEIPT_CAPTURE_FEATURE_KEY, hasToolFeature, lineChatAction, canUseLineChatAction, type LineAiAnswerPresentation } from '@watchdog-bms/contracts';
import { knowledgeCardHash, knowledgePackHash, type ProductKnowledgeCard, type ProductKnowledgePack } from './approved-knowledge';

const sources = {
  'tax': { file: 'tax-guide.content.ts', hash: '4aef264e52fed9bd845e83909d9883b3f020f975e390644e680f9f875dc36e06' },
  'disbursement-vouchers': { file: 'disbursement-voucher-guide.content.ts', hash: 'def3bfcd017f1fb2558621a1f015434659455fde63bfd95bca42c46c35e91b8a' },

  expenses: { file: 'expenses-guide.content.ts', hash: 'c1a24890df297c863e56dddf0d59b0cac2f177183f27ef6c0d11d96a940fc14e' },
  reimbursements: { file: 'reimbursement-guide.content.ts', hash: 'b3cae0e6877401a50fb03e5a977e42d893563abafa9a2f0bdacd33a45d4185cf' },
  'substitute-receipts': { file: 'substitute-receipt-guide.content.ts', hash: '4562fee709affca22cb072ad21c57c46985797a1db05b026bf9dfc411ae1d096' },
  reports: { file: 'reports-guide.content.ts', hash: 'a26bbd51335bb620c4ef3511760ee89c14754b12189881416ca0cfca9fd5abe4' },
} as const;

function card(
  id: string, guide: keyof typeof sources, anchor: string, title: string, questions: string[], body: string,
  permissionAnyOf: string[], requiredCapabilities: string[] = [],
): ProductKnowledgeCard {
  const value: ProductKnowledgeCard = {
    id, version: guide === 'reimbursements' ? 4 : guide === 'expenses' ? 3 : guide === 'substitute-receipts' ? 2 : 1, title, questions, summary: title, body,
    sourceURL: `/companies/{companyId}/user-guide/${guide === 'disbursement-vouchers' ? 'expenses' : guide}#${anchor}`,
    sourceFile: `apps/web/src/features/user-guide/${sources[guide].file}`, sourceHash: sources[guide].hash,
    contentHash: '', permissionAnyOf, requiredPermissions: [],
    featureKeys: guide === 'expenses' || guide === 'substitute-receipts' || guide === 'disbursement-vouchers' ? ['expenses'] : guide === 'reports' ? ['reports'] : [],
    requiredCapabilities, audience: 'member', risk: 'R1',
  };
  value.contentHash = knowledgeCardHash(value);
  return value;
}

const expenseReaders = ['expense.read', 'expense.read_own'];
const reimbursementReaders = ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'];
const substituteReaders = ['expense.review', 'expense.confirm', 'expense.read_own'];

export const PRODUCT_HELP_PACK: ProductKnowledgePack = {
  id: 'mangmee-product-help', version: 4, status: 'APPROVED',
  language: 'th', jurisdiction: 'TH',
  owner: 'repository:product-help', reviewers: ['repository-ai-source-code-review:claude-opus-5-5:2026-10-13'],
  effectiveFrom: '2026-09-27T00:00:00+07:00', effectiveTo: '2026-12-27T00:00:00+07:00', reviewDueAt: '2026-12-27T00:00:00+07:00',
  releaseRange: { min: '2.4.0', maxExclusive: '2.5.0' }, contentHash: '',
  cards: [
    card('expense.start', 'expenses', 'overview', 'เริ่มบันทึกค่าใช้จ่าย', ['เริ่มลงค่าใช้จ่ายยังไง', 'รายจ่ายเข้าระบบแล้วทำอะไรต่อ'],
      'เลือกสาขาของรายการ แล้วนำใบเสร็จเข้าระบบหรือบันทึกด้วยมือตามช่องทางที่เปิดใช้สำหรับร้านของคุณและสิทธิ์ที่คุณมี ระบบเก็บเป็นร่างให้ตรวจชื่อผู้ขาย เลขที่เอกสาร วันที่ ยอดเงิน และไฟล์แนบก่อนยืนยัน การบันทึกร่างยังไม่ใช่การยืนยันเอกสารหรือจ่ายเงินค่ะ', expenseReaders),
    card('expense.status', 'expenses', 'overview', 'สถานะเอกสารกับสถานะจ่ายเงิน', ['ยืนยันแล้วแปลว่าจ่ายแล้วไหม', 'ทำไมสถานะมีสองบรรทัด'],
      'สถานะเอกสารบอกว่าตรวจไปถึงขั้นใด ส่วนสถานะการจ่ายบอกว่าจ่ายให้ผู้ขายหรือยัง เป็นคนละเรื่องกันค่ะ เอกสารที่ยืนยันแล้วอาจยังไม่จ่ายเงิน และรายการที่จ่ายแล้วอาจยังตรวจเอกสารไม่ครบ', expenseReaders),
    card('expense.find', 'expenses', 'list', 'ค้นหารายการค่าใช้จ่าย', ['หาบิลร้านเดิมยังไง', 'ดูรายการตามสถานะที่ไหน'],
      'ในรายการค่าใช้จ่าย เลือกช่วงเวลาแล้วกรองสถานะได้ ช่องค้นหาใช้ชื่อผู้ขายหรือเลขที่เอกสาร จากนั้นเปิดรายการที่ต้องการเพื่อตรวจรายละเอียดค่ะ', expenseReaders, ['expense.list_recent']),
    card('expense.draft', 'expenses', 'overview', 'ร่างต่างจากยืนยันแล้วอย่างไร', ['ร่างใช้เป็นยอดบัญชีแล้วหรือยัง', 'บันทึกไว้ก่อนแล้วค่อยตรวจได้ไหม'],
      `ร่างเป็นรายการที่บันทึกไว้และยังแก้ไขได้ ต้องตรวจรายละเอียดให้ครบก่อนยืนยันค่ะ หากข้อมูลผิดหลังยืนยัน ผู้มีสิทธิ์กด “${EXPENSE_CORRECTION_WORDS.reopen}” ได้เมื่อเอกสารเปิดแก้ไขได้ เอกสารกลับไปตรวจสอบโดยใช้เลขเอกสารเดิม หากเปิดแก้ไขไม่ได้ หน้ารายจ่ายบอกเหตุผลและผู้ที่ต้องติดต่อ`, expenseReaders),
    card('expense.vat-display', 'expenses', 'list', 'VAT ที่พบในเอกสารหมายถึงอะไร', ['ตัวเลข VAT ด้านบนขอคืนได้เลยไหม', 'ยอดภาษีในหน้ารายจ่ายคือยอดยื่นไหม'],
      'การ์ด VAT ในหน้ารายการเป็นยอด VAT ที่พบในเอกสาร ยังไม่ใช่ยอดภาษีซื้อที่ขอคืนได้ค่ะ ต้องตรวจคุณสมบัติเอกสารและเงื่อนไขภาษีของแต่ละรายการก่อนนำไปใช้ยื่น', expenseReaders),
    card('expense.export', 'expenses', 'overview', 'ส่งเอกสารให้นักบัญชี', ['เตรียมข้อมูลให้นักบัญชียังไง', 'ส่งรายจ่ายพร้อมหลักฐานได้ไหม'],
      'ตรวจรายการและหลักฐานให้ครบก่อนยืนยัน แล้วใช้ขั้นตอนส่งออกชุดรายการและหลักฐานที่ยืนยันแล้วบนเว็บตามสิทธิ์ เพื่อให้นักบัญชีตรวจและบันทึกบัญชีต่อค่ะ การถามคู่มือนี้ยังไม่ได้ส่งออกหรือส่งข้อมูลให้ใคร', ['expense.export']),
    card('reimbursement.meaning', 'reimbursements', 'quick-start', 'ใบเบิกคืออะไร', ['คำขอเบิกกับใบเบิกต่างกันยังไง', 'ฉันสำรองเงินเองแล้วต้องใช้เมนูไหน'],
      'การเบิกคืนใช้เมื่อคุณจ่ายเงินไปก่อนแล้วขอคืนจากร้านค่ะ บนเว็บเรียกรายการนี้ว่าใบเบิก ส่วนข้อความใน LINE บางจุดยังเรียกว่าคำขอเบิก เป็นสิ่งเดียวกัน สร้างได้ที่เมนูการเบิกจ่าย แล้วพิมพ์ใบเบิกออกมาเซ็นได้ การมีร่างหรือพิมพ์ใบเบิกแล้วยังไม่ได้แปลว่าอนุมัติหรือจ่ายคืนแล้ว', reimbursementReaders),
    card('reimbursement.roles', 'reimbursements', 'tabs', 'ทำไมเห็นแท็บเบิกจ่ายไม่เหมือนกัน', ['เพื่อนเห็นแท็บแต่ฉันไม่เห็น', 'หาเมนูเบิกจ่ายไม่เจอ'],
      'หน้าการเบิกจ่ายแสดงแท็บตามบทบาทและสิทธิ์ของแต่ละคนค่ะ ผู้เบิก ผู้อนุมัติ และฝ่ายการเงินจึงเห็นงานต่างกัน หากไม่พบส่วนที่ต้องใช้ ให้ผู้ดูแลตรวจสิทธิ์ของคุณก่อน ไม่ต้องสร้างใบเบิกใหม่เพื่อแก้ปัญหาการเข้าถึง', reimbursementReaders),
    card('substitute.meaning', 'substitute-receipts', 'overview', 'ใบรับรองแทนใบเสร็จคืออะไร', ['ร้านออกใบเสร็จไม่ได้ต้องทำไง', 'ใบทดแทนใช้ทำอะไร'],
      'เป็นเอกสารที่ร้านจัดทำเพื่อใช้เป็นหลักฐานรายจ่าย เมื่อจ่ายเงินจริงเพื่อกิจการแต่ผู้รับเงินออกใบเสร็จที่ถูกต้องครบถ้วนให้ไม่ได้ค่ะ เริ่มจากรายการค่าใช้จ่ายที่เกี่ยวข้อง แล้วตรวจข้อมูลและหลักฐานตามขั้นตอนของร้าน', substituteReaders),
    card('substitute.evidence', 'substitute-receipts', 'evidence', 'หลักฐานประกอบกับหลักฐานการจ่าย', ['สลิปกับรูปของซื้อใช้แทนกันไหม', 'ทำไมต้องแนบหลักฐานสองแบบ'],
      'หลักฐานประกอบบอกว่าซื้ออะไร เช่น บิลเขียนมือ ภาพสินค้า หรือข้อความยืนยันคำสั่งซื้อ ส่วนหลักฐานการจ่ายบอกว่าจ่ายจริง เช่น สลิปโอนหรือใบสำคัญรับเงินที่ผู้รับเงินเซ็นแล้วค่ะ จึงใช้ตอบคนละคำถาม', substituteReaders),
    card('substitute.review-sign', 'substitute-receipts', 'sign', 'อ่านเอกสารก่อนเซ็น', ['ทำไมกดลงชื่อไม่ได้', 'ต้องอ่านฉบับเต็มก่อนอนุมัติไหม'],
      'ถ้าเซ็นออนไลน์ ขั้นตอนเซ็นและอนุมัติบังคับให้เปิดอ่านเอกสารฉบับเต็มก่อนค่ะ ผู้เซ็นและผู้อนุมัติต้องตรวจฉบับที่ตรงกับขั้นตอนของตน การเซ็น ยืนยันคำรับรอง และอนุมัติออกเอกสารทำบนเว็บด้วยสิทธิ์ที่กำหนด ถ้าพิมพ์แล้วเซ็นบนกระดาษ ผู้ตรวจรับต้องเปิดอ่านฉบับที่อัปโหลดให้ครบทุกหน้าก่อนตรวจรับบนเว็บ', substituteReaders),
    card('report.access', 'reports', 'overview', 'รายงานที่แต่ละคนเรียกดูได้', ['ทำไมฉันเห็นรายงานน้อยกว่าเจ้าของ', 'ส่งออกแล้วตรวจสิทธิ์อีกไหม'],
      `ทุกคนที่เปิดเมนูรายงานได้จะเห็นรายการรายงานครบค่ะ รายงานที่บัญชีของคุณยังไม่มีสิทธิ์เรียกดูจะมีป้าย “ไม่มีสิทธิ์” และเรียกดูไม่ได้ และระบบตรวจสิทธิ์อีกครั้งเมื่อส่งออก ถ้าต้องใช้รายงานเพิ่ม ให้แจ้ง${THAI_SYSTEM_ROLE_NAMES.OWNER}ว่าต้องการสิทธิ์ใด`, ['report.catalog.read', 'report.snapshot.read']),
  ],
};
PRODUCT_HELP_PACK.contentHash = knowledgePackHash(PRODUCT_HELP_PACK);

/** New subjects are awaiting owner review; the original 12-card AI-only approval does not cover them. */
export const PRODUCT_HELP_DRAFT_PACK: ProductKnowledgePack = {
  ...PRODUCT_HELP_PACK, version: 5, status: 'DRAFT', reviewers: [], contentHash: '',
  cards: [...PRODUCT_HELP_PACK.cards,
    card('voucher.meaning', 'disbursement-vouchers', 'disbursement-vouchers', 'ใบสำคัญจ่ายคืออะไร ทำไมต้องทำ',
      ['ใบสำคัญจ่ายคืออะไร', 'ทำไมต้องทำใบสำคัญจ่าย'],
      'ใบเตรียมจ่ายใช้รวบรวมรายจ่ายให้ผู้รับเงินรายเดียวเพื่อตรวจและอนุมัติก่อนจ่าย เมื่อจ่ายเงินจริงและบันทึกว่าจ่ายแล้วจึงเป็นใบสำคัญจ่ายค่ะ ฉบับร่างยังไม่ได้จ่ายเงิน และสถานะรอจ่ายหมายถึงอนุมัติแล้วแต่ยังไม่ได้บันทึกว่าจ่ายเงินจริง', ['expense.disbursement.read']),
    ...[
      card('wht.certificate-meaning', 'tax', 'wht', '50 ทวิคืออะไร', ['50 ทวิ คืออะไร', 'ทำไมต้องออก 50 ทวิ'],
        'หนังสือที่ผู้จ่ายเงินออกให้ผู้รับเงิน บอกยอดที่จ่ายและภาษีที่หักไว้ค่ะ ออกแล้วยังไม่ใช่การนำส่งภาษี', ['wht.certificate.read']),
      card('wht.pnd53-due', 'tax', 'wht', 'ภงด.53 ต้องยื่นเมื่อไหร่', ['ภงด.53 ต้องยื่นเมื่อไหร่', 'ภงด 53 นำส่งวันไหน'],
        'ดูวันครบกำหนดที่งวด ภงด.53 ในระบบค่ะ ถ้ายังไม่ได้ตั้งไว้ ระบบใช้วันที่ 7 ของเดือนถัดไปสำหรับแบบกระดาษ', ['wht.pnd53.read']),
      card('wht.calculation', 'tax', 'wht', 'หัก ณ ที่จ่ายคิดอย่างไร', ['หัก ณ ที่จ่ายคิดยังไง', 'ต้องหักเท่าไหร่'],
        'ยอดก่อน VAT คูณอัตราของประเภทเงินได้ที่เลือกค่ะ ต้องเลือกประเภทเงินได้ก่อน ระบบไม่เดาอัตราให้', ['expense.create', 'procurement.supplier_payment.read']),
    ].map(value => {
      value.featureKeys = [value.id === 'wht.pnd53-due' ? 'wht_pnd53' : 'wht_50bis'];
      value.contentHash = knowledgeCardHash(value);
      return value;
    }),
  ],
};
PRODUCT_HELP_DRAFT_PACK.contentHash = knowledgePackHash(PRODUCT_HELP_DRAFT_PACK);

/** The semantic selector names a registry entry; neither its prose nor a guide can grant action access. */
export function productHelpAction(input: { actionId?: unknown; selectedKnowledgeCardIds?: readonly string[];
  permissions: readonly string[]; featureKeys: readonly string[] | null; availableToolNames?: readonly string[]; companyId?: string }) {
  const mapped = LINE_CHAT_ACTIONS.filter(action => action.helpTopics.some(topic => input.selectedKnowledgeCardIds?.includes(topic)));
  const action = lineChatAction(input.actionId) ?? (mapped.length === 1 ? mapped[0] : undefined);
  if (!action) return null;
  const allowed = canUseLineChatAction(action.id, input.permissions, input.featureKeys === null ? null : new Set(input.featureKeys))
    && (!action.tool || !input.availableToolNames || input.availableToolNames.includes(action.tool));
  const tool = LINE_TOOL_REGISTRY.find(tool => tool.name === action.tool);
  const entitled = input.featureKeys === null ? null : new Set(input.featureKeys);
  const featureMissing = action.id === 'expense_capture' && entitled !== null && !entitled.has(LINE_RECEIPT_CAPTURE_FEATURE_KEY)
    || tool && !hasToolFeature(tool, entitled)
    || entitled !== null && (action.id === 'wht_certificate' && !entitled.has('wht_50bis') || action.id === 'pnd53' && !entitled.has('wht_pnd53'));
  const replyText = allowed ? action.sentence : featureMissing
    ? 'ให้ผู้มีสิทธิ์จัดการแพ็กเกจตรวจเมนูที่ร้านเปิดใช้สำหรับงานนี้ค่ะ'
    : `ให้${action.responsible}ดำเนินการ หรือให้ผู้ดูแลตรวจสิทธิ์ของคุณค่ะ`;
  const presentation: LineAiAnswerPresentation = { kind: 'answer_cards', cards: [{ text: replyText,
    ...(allowed ? 'webPath' in action ? { webLink: { label: 'บัญชีรับเงินคืนของฉัน', path: action.webPath.replace('{companyId}', input.companyId ?? '') } } : { chatActionId: action.id } : {}) }] };
  return { replyText, presentation, allowed };
}
