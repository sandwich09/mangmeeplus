/** Curated product guidance reviewed against these exact source/body hashes. */
import { EXPENSE_CORRECTION_WORDS, THAI_SYSTEM_ROLE_NAMES, LINE_CHAT_ACTIONS, LINE_TOOL_REGISTRY, TOOL_MODULE_FEATURE_KEYS, LINE_RECEIPT_CAPTURE_FEATURE_KEY, hasToolFeature, lineChatAction, canUseLineChatAction, type LineAiAnswerPresentation } from '@watchdog-bms/contracts';
import { knowledgeCardHash, knowledgePackHash, productKnowledgeAccess, renderApprovedKnowledge, type ProductKnowledgeCard, type ProductKnowledgePack } from './approved-knowledge';
import { NEW_PRODUCT_HELP_CARDS, V6_REVISED_BODIES } from './product-help-draft-cards';
import { featureLimitReplyText, featurePackageOffer, permissionAlternative, permissionLimitReplyText, toolPermissionReplyText, scopePolicyWebLinks, type ScopePolicyLanguage } from '../domain/logic/line-ai-scope-policy.logic';

const sources = {
  'tax': { file: 'tax-guide.content.ts', hash: '1eac64225f803d0e436138261b81ff3d33a55c6d54bbd557843a7b733f4a8319' },
  'disbursement-vouchers': { file: 'disbursement-voucher-guide.content.ts', hash: 'def3bfcd017f1fb2558621a1f015434659455fde63bfd95bca42c46c35e91b8a' },

  expenses: { file: 'expenses-guide.content.ts', hash: '7503a7696e159765672b4762ab082858831b9b58e92140fea652b74d9aae717f' },
  reimbursements: { file: 'reimbursement-guide.content.ts', hash: '5cda41267fb2238794ef41e56d985516c9c016fd240ae9f684931ffe222b198f' },
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
const previousDraftPack: ProductKnowledgePack = {
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
const extraQuestions: Record<string, string[]> = {
  'expense.start': ['เริ่มบันทึกบิลตรงไหน', 'รับใบเสร็จเข้าร้านยังไง'],
  'expense.status': ['ยืนยันบิลแล้วต้องจ่ายอีกไหม', 'สถานะตรวจและจ่ายต่างกันไหม'],
  'expense.find': ['ค้นหาบิลเก่าที่ไหน', 'กรองบิลรอตรวจยังไง'],
  'expense.draft': ['ร่างคืออะไร', 'บันทึกแล้วทำไมยังไม่ยืนยัน'],
  'expense.vat-display': ['VAT ในรายการคือภาษีซื้อไหม', 'มี VAT แล้วใช้สิทธิ์ได้เลยไหม'],
  'expense.export': ['ส่งออกให้นักบัญชีตรงไหน', 'ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี'],
  'reimbursement.meaning': ['ใบเบิกคืออะไร', 'จ่ายแทนร้านแล้วขอคืนอย่างไร'],
  'reimbursement.roles': ['ทำไมไม่เห็นแท็บอนุมัติ', 'ฝ่ายบัญชีเห็นใบเบิกแบบไหน'],
  'substitute.meaning': ['ใบรับรองแทนใบเสร็จใช้ทำอะไร', 'แม่ค้าไม่มีใบเสร็จใช้อะไรแทน'],
  'substitute.evidence': ['ต้องมีหลักฐานอะไรบ้าง', 'รูปของกับหลักฐานโอนต่างกันไหม'],
  'substitute.review-sign': ['อ่านใบรับรองก่อนเซ็นที่ไหน', 'ตรวจใบที่เซ็นกระดาษยังไง'],
  'report.access': ['เปิดรายงานแล้วไม่มีสิทธิ์', 'บัญชีดูรายงานได้ทุกอย่างไหม'],
  'voucher.meaning': ['ใบเตรียมจ่ายกับใบสำคัญจ่ายต่างกันไหม', 'ร่างใบเตรียมจ่ายแปลว่าจ่ายแล้วไหม'],
  'wht.certificate-meaning': ['ใบ 50 ทวิใช้ทำอะไร', 'มี 50 ทวิแล้วต้องยื่นอีกไหม'],
  'wht.pnd53-due': ['ดูวันครบกำหนด ภงด53 ตรงไหน', 'ต้องนำส่ง ภงด53 วันไหน'],
  'wht.calculation': ['คำนวณหักภาษีจากยอดไหน', 'หักภาษีรวม VAT หรือเปล่า'],
};

/** Owner-approved v6; the previous v4 record above remains unchanged. */
export const PRODUCT_HELP_DRAFT_PACK: ProductKnowledgePack = {
  // Owner approved every v6 body as shown on the review page (2026-10-21: "อนุมัติคู่มือทั้งหมด").
  ...previousDraftPack, version: 6, status: 'APPROVED', reviewers: ['owner-review:2026-10-21'], contentHash: '',
  cards: [...previousDraftPack.cards.map(original => {
    const value = { ...original, version: original.version + 1, body: V6_REVISED_BODIES[original.id]!, questions: [...original.questions, ...extraQuestions[original.id]!],
      // A certificate's meaning/calculation also applies to shops recording an outside certificate.
      featureKeys: ['wht.certificate-meaning', 'wht.calculation'].includes(original.id) ? [] : original.featureKeys };
    value.contentHash = knowledgeCardHash(value);
    return value;
  }), ...NEW_PRODUCT_HELP_CARDS],
};
PRODUCT_HELP_DRAFT_PACK.contentHash = knowledgePackHash(PRODUCT_HELP_DRAFT_PACK);

/** Changing the reviewed pack's status/reviewers is the release gate; draft text never reaches the model. */
export function activeProductHelpPack(): ProductKnowledgePack {
  return PRODUCT_HELP_DRAFT_PACK.status === 'APPROVED' ? PRODUCT_HELP_DRAFT_PACK : PRODUCT_HELP_PACK;
}

const ACTION_HELP_EN: Record<(typeof LINE_CHAT_ACTIONS)[number]["id"], string> = {
  "reimbursement_submit": "Choose the claim to submit, review it and press submit.",
  "reimbursement_cancel": "Choose the claim to cancel, review it and confirm cancellation.",
  "reimbursement_reject": "Choose the claim and give the rejection reason, then review and press reject.",
  "reimbursement_pay": "Choose an approved claim and send payment evidence, then review and confirm payment.",
  "expense_submit": "Choose the expense, review it and press send for review.",
  "expense_confirm": "Choose the expense and check its evidence before confirming the document.",
  "expense_delete": "Choose the expense draft, review it and confirm deletion.",
  "expense_void": "Choose the expense and give a reason, then review and confirm cancellation.",
  "expense_pay": "Choose the expense and send payment evidence, then review and confirm payment.",
  "expense_capture": "Send a receipt or describe the expense so I can prepare it for your review.",
  "reimbursement_claim": "Tell me what you paid for so I can prepare a reimbursement claim for your review.",
  "payment_voucher": "Choose confirmed expenses for the same payee, then review and confirm the payment voucher I prepare.",
  "wht_certificate": "Choose an expense with withholding tax and check the payee name, tax number and address before reviewing and confirming the tax certificate.",
  "pnd53": "Tell me the period so I can summarize its PND53 withholding tax for your review.",
  "payout_account": "Add your reimbursement bank account on the payout account page on the web.",
  "counterparty": "Tell me the supplier or payee name and available details, then review and confirm the record I prepare.",
  "team_member": "Tell me the employee name and role, then review and confirm their access.",
  "branch": "Tell me the branch name and available details, then review and confirm the branch I prepare.",
  "branch_edit": "Tell me the branch name and what to change so I can prepare the update for your review.",
  "package_purchase": "Choose a package so I can prepare the purchase request for your review.",
  "approvals": "Choose a claim assigned to you for approval, then review its details before confirming.",
  "expense_search": "Tell me the expense or period to search within your access.",
  "sales": "Tell me the period so I can look up sales within your access.",
  "finance": "Tell me the period so I can look up financial reports within your access.",
  "tax": "Tell me the period so I can look up upcoming tax obligations within your access.",
  "inventory": "Tell me the product name to search within your access.",
  "customers": "Tell me the customer name to search within your access.",
  "bookings": "Tell me the period so I can look up bookings within your access.",
  "procurement": "Tell me the period so I can look up purchasing within your access.",
  "alerts": "I can look up the open alerts you have access to.",
  "team": "Tell me the team details to search within your access."
};

function requestsProductAction(text: string): boolean {
  if (text.trim() && LINE_CHAT_ACTIONS.some(action => action.command === text.trim())) return true;
  return !/อธิบาย|คืออะไร|\b(?:explain|what is|why|how)\b/iu.test(text)
    && (/ช่วย.+ให้หน่อย/u.test(text) || /\b(?:please|can you|could you)\b/iu.test(text));
}

/** The semantic selector names a registry entry; neither its prose nor a guide can grant action access. */
export function productHelpAction(input: { actionId?: unknown; text?: string; toolHint?: string; selectedKnowledgeCardIds?: readonly string[];
  packageOffers?: import('@watchdog-bms/contracts').BillingOffer[]; generalHelpEnabled?: boolean;
  permissions: readonly string[]; featureKeys: readonly string[] | null; availableToolNames?: readonly string[]; companyId?: string; language?: ScopePolicyLanguage }) {
  const mapped = LINE_CHAT_ACTIONS.filter(action => action.helpTopics.some(topic => input.selectedKnowledgeCardIds?.includes(topic)));
  const text = input.text ?? '';
  const claim = /ใบเบิก|เบิกเงิน|reimbursement|claim/iu.test(text);
  const expense = /ค่าใช้จ่าย|รายจ่าย|expense|บิล/iu.test(text);
  // Specific operation beats broad creation guides selected for the same document family.
  const operation = claim
    ? /ไม่อนุมัติ|ปฏิเสธ|reject/iu.test(text) ? 'reimbursement_reject'
      : /จ่ายคืน|จ่ายเงิน|จ่ายใบเบิก|โอน|บันทึกจ่าย|\bpay/iu.test(text) ? 'reimbursement_pay'
        : /ยกเลิก|cancel/iu.test(text) ? 'reimbursement_cancel'
          : /ส่ง.*อนุมัติ|submit/iu.test(text) ? 'reimbursement_submit'
            : /อนุมัติ|approve/iu.test(text) ? 'approvals'
              : /สร้าง|ทำ|create/iu.test(text) ? 'reimbursement_claim' : undefined
    : expense ? /ลบ|delete/iu.test(text) ? 'expense_delete'
      : /ยกเลิก|void|cancel/iu.test(text) ? 'expense_void'
        : /บันทึกจ่าย|ชำระ|จ่ายเงิน|จ่าย(?:ค่าใช้จ่าย|รายจ่าย|บิล)|\bpay/iu.test(text) ? 'expense_pay'
          : /ส่งตรวจ|ส่ง.*ตรวจ|submit/iu.test(text) ? 'expense_submit'
            : /ยืนยัน|confirm/iu.test(text) ? 'expense_confirm' : undefined : undefined;
  const action = lineChatAction(input.actionId || mapped.length || input.toolHint === 'reimbursement.list_pending_approvals' ? operation : undefined)
    ?? lineChatAction(input.actionId) ?? (mapped.length === 1 ? mapped[0] : undefined);
  const actionAllowed = (candidate: (typeof LINE_CHAT_ACTIONS)[number]) => canUseLineChatAction(candidate.id, input.permissions, input.featureKeys === null ? null : new Set(input.featureKeys))
    && (!candidate.tool || !input.availableToolNames || input.availableToolNames.includes(candidate.tool));
  const language = input.language ?? 'th';
  const pack = activeProductHelpPack();
  const access = productKnowledgeAccess(input.permissions, input.featureKeys, true, language);
  const selectedHelp = input.generalHelpEnabled !== false && !requestsProductAction(text) && !input.selectedKnowledgeCardIds?.includes('wht.pnd53-due');
  const deniedCard = selectedHelp ? pack.cards.find(card => input.selectedKnowledgeCardIds?.includes(card.id) && (
    !card.requiredPermissions.every(permission => input.permissions.includes(permission))
    || card.permissionAnyOf.length > 0 && !card.permissionAnyOf.some(permission => input.permissions.includes(permission))
    || input.featureKeys !== null && !card.featureKeys.every(key => input.featureKeys!.includes(key))
    || !card.requiredCapabilities.every(capability => access.capabilities.includes(capability)))) : undefined;
  if (deniedCard) {
    const missingFeature = input.featureKeys === null ? undefined : deniedCard.featureKeys.find(key => !input.featureKeys!.includes(key));
    const replyText = missingFeature ? featureLimitReplyText(missingFeature, language, undefined, input.packageOffers, input.featureKeys, input.permissions)
      : action ? permissionLimitReplyText(language, language === 'en' ? 'perform this action' : action.title, input.permissions)
        : toolPermissionReplyText(language, input.permissions);
    const alternative = permissionAlternative(input.permissions, language);
    const link = input.companyId ? scopePolicyWebLinks({ reasonCode: missingFeature ? 'PACKAGE_FEATURE_NOT_ENABLED' : 'ROLE_PERMISSION_REQUIRED', text: replyText,
      webPage: missingFeature && featurePackageOffer(missingFeature, input.packageOffers) ? 'packages' : alternative.page }, input.permissions, input.companyId, language)[0] : undefined;
    const presentation: LineAiAnswerPresentation = { kind: 'answer_cards', cards: [{ text: replyText, ...(link ? { webLink: link } : {}) }] };
    return { replyText, presentation, allowed: false, generalHelp: false, sourceRefs: [], webLinks: link ? [link] : [] };
  }
  const general = selectedHelp
    ? renderApprovedKnowledge(pack, input.selectedKnowledgeCardIds, access, input.companyId ?? 'shop') : null;
  if (general) {
    const cards = general.presentation.cards.map((card, index) => {
      const id = input.selectedKnowledgeCardIds![index]!;
      const linked = LINE_CHAT_ACTIONS.find(candidate => candidate.helpTopics.some(topic => topic === id));
      return { ...card,
        ...(linked && actionAllowed(linked) ? { chatActionId: linked.id } : {}) };
    });
    return { ...general, replyText: cards.map(card => `${card.title}\n${card.text}`).join('\n\n'), presentation: { ...general.presentation, cards }, allowed: true, generalHelp: true };
  }
  if (!action || action.id === 'approvals' && text && operation !== 'approvals') return null;
  const allowed = actionAllowed(action);
  const tool = LINE_TOOL_REGISTRY.find(tool => tool.name === action.tool);
  const entitled = input.featureKeys === null ? null : new Set(input.featureKeys);
  const missingFeature = entitled === null ? undefined
    : action.id === 'expense_capture' && !entitled.has(LINE_RECEIPT_CAPTURE_FEATURE_KEY) ? LINE_RECEIPT_CAPTURE_FEATURE_KEY
      : action.id === 'wht_certificate' && !entitled.has('wht_50bis') ? 'wht_50bis'
        : action.id === 'pnd53' && !entitled.has('wht_pnd53') ? 'wht_pnd53'
          : tool && !hasToolFeature(tool, entitled) ? (tool.featureKeys ?? TOOL_MODULE_FEATURE_KEYS[tool.sourceModule])?.find(key => !entitled.has(key)) : undefined;
  const alternative = permissionAlternative(input.permissions, language);
  const replyText = allowed ? language === 'en' ? ACTION_HELP_EN[action.id] : action.sentence : missingFeature ? featureLimitReplyText(missingFeature, language, undefined, input.packageOffers, input.featureKeys, input.permissions)
    : permissionLimitReplyText(language, language === 'en' ? 'perform this action' : action.title, input.permissions);
  const limitLink = !allowed && input.companyId ? scopePolicyWebLinks({ reasonCode: missingFeature ? 'PACKAGE_FEATURE_NOT_ENABLED' : 'ROLE_PERMISSION_REQUIRED', text: replyText,
    webPage: missingFeature && featurePackageOffer(missingFeature, input.packageOffers) ? 'packages' : alternative.page }, input.permissions, input.companyId, language)[0] : undefined;
  const presentation: LineAiAnswerPresentation = { kind: 'answer_cards', cards: [{ text: replyText,
    ...(allowed ? 'webPath' in action ? { webLink: { label: language === 'en' ? 'My payout account' : 'บัญชีรับเงินคืนของฉัน', path: action.webPath.replace('{companyId}', input.companyId ?? '') } } : { chatActionId: action.id } : limitLink ? { webLink: limitLink } : {}) }] };
  return { replyText, presentation, allowed, generalHelp: false, sourceRefs: [], webLinks: [] };
}
