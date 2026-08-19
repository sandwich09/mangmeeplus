export type OperatorLanguageCase = {
  id: string;
  category:
    | 'expense_period' | 'expense_daily_close' | 'expense_mixed'
    | 'sales' | 'inventory' | 'customer' | 'finance' | 'receivable'
    | 'payable' | 'tax' | 'alerts' | 'company' | 'reimbursement' | 'business_mixed';
  message: string;
  expectedTools: string[];
  forbiddenTools: string[];
};

export type OperatorAvailabilityCase = {
  id: string;
  category: 'availability';
  family: string;
  message: string;
  expectedTools: string[];
  routeTool?: string;
  routeTools?: string[];
  forbiddenTools: string[];
  expectedPlanStatus: 'ROUTABLE' | 'PARTIAL' | 'UNROUTABLE';
  accessMode: 'feature_disabled' | 'runtime_feature_disabled' | 'forbidden' | 'allowed' | 'no_data' | 'source_unavailable' | 'tool_unavailable' | 'unsupported_module' | 'partial';
  expectedInvokedTools: string[];
  requiredReplyIncludes: string[];
  forbiddenReplyIncludes: string[];
  noisy: boolean;
  route?: { intent: string; subject: string; agent: string };
};

function cases(
  category: OperatorLanguageCase['category'],
  messages: string[],
  expectedTools: string[],
  forbiddenTools: string[],
): OperatorLanguageCase[] {
  return messages.map((message, index) => ({
    id: `${category}-${String(index + 1).padStart(3, '0')}`,
    category,
    message,
    expectedTools,
    forbiddenTools,
  }));
}

const EXPENSE_PERIOD_MESSAGES = [
  'ช่วยคำนวณยอดค่าใช้จ่ายเดือนนี้ให้หน่อย',
  'เดือนนี้ค่าใช้จ่ายรวมเท่าไหร่',
  'เดือนนี้ร้านใช้เงินเป็นค่าใช้จ่ายไปกี่บาท',
  'ขอยอดรวมค่าใช้จ่ายของเดือนนี้',
  'ค่าใช้จ่ายทั้งหมดเดือนนี้เท่าไร',
  'สรุปยอดค่าใช้จ่ายเดือนปัจจุบัน',
  'อยากรู้ว่าเดือนนี้จ่ายเป็นค่าใช้จ่ายไปเท่าไหร่',
  'เดือนนี้มีค่าใช้จ่ายรวมกี่บาท',
  'ยอดใช้จ่ายของร้านเดือนนี้',
  'เช็กยอดค่าใช้จ่ายเดือนนี้ให้ที',
  'ดูค่าใช้จ่ายเดือนนี้หน่อย',
  'เดือนนี้มีค่าใช้จ่ายอะไรบ้าง',
  'ขอรายการค่าใช้จ่ายเดือนนี้',
  'เปิดรายการค่าใช้จ่ายของเดือนนี้ให้ดูหน่อย',
  'เดือนนี้จ่ายค่าอะไรไปบ้าง',
  'ค่าใช้จ่ายล่าสุดในเดือนนี้มีอะไร',
  'ช่วยรวมบิลค่าใช้จ่ายเดือนนี้ให้หน่อย',
  'ดูยอดบิลค่าใช้จ่ายทั้งหมดของเดือนนี้',
  'ยอดรายจ่ายที่บันทึกไว้เดือนนี้เท่าไหร่',
  'ค่าใช้จ่ายที่ลงระบบเดือนนี้รวมเท่าไร',
  'คชจ. เดือนนี้เท่าไหร่',
  'ขอยอด คชจ เดือนนี้',
  'ผปก. อยากดู คชจ. เดือนนี้',
  'สรุปคชจเดือนนี้ที',
  'คชจเดือนนี้มีอะไรบ้าง',
  'รวม คชจ. เดือนปัจจุบันให้หน่อย',
  'ยอดคชจ.ทั้งหมดของเดือนนี้',
  'ดูคชจล่าสุดเดือนนี้',
  'เดือนนี้ คชจ เท่าไรนะ',
  'ขอ list คชจ. เดือนนี้',
  'expense เดือนนี้รวมเท่าไหร่',
  'month นี้ค่าใช้จ่ายเท่าไร',
  'เช็ค total expense เดือนนี้ให้ที',
  'ขอ expense list ของเดือนนี้',
  'เดือนนี้หมดกับค่าใช้จ่ายไปเท่าไหร่อะ',
  'เอายอดใช้จ่ายเดือนนี้หน่อย',
  'ค่าใช้จ่ายเดือนนี้เท่าไหร่นะ',
  'เดือนนี้เสียค่าอะไรไปมั่ง',
  'ช่วยดูเงินที่เป็นค่าใช้จ่ายเดือนนี้ที',
  'ขอดูรายจ่ายในระบบเดือนนี้หน่อยจ้า',
  'ค่าไช้จ่ายเดือนนี้รวมเท่าไหร่',
  'ค่าใช้จ่ายยเดือนนี้กี่บาท',
  'เดือนนี้ค่าใช้จ่ายเท่าไหร',
  'คชจเดิอนนี้เท่าไร',
  'เดิอนนี้มีค่าใช้จ่ายอะไรบ้าง',
  'ยอดค่าใช้จ่ายเดิอนนี้',
  'ช่วยรวมค่าใช้จ่ายเดือนนีให้ที',
  'ดูค่าใช้จ่ายเดือนนี้หนอ่ย',
  'ค่าใช้จ่ายเดือนนี้เท่าไหร่???',
  'เดือนนี้ใช้จ่ายยยไปกี่บาท',
];

const EXPENSE_DAILY_CLOSE_MESSAGES = [
  'สรุปปิดร้านวันนี้ให้หน่อย',
  'ก่อนปิดร้านวันนี้มีค่าใช้จ่ายอะไรต้องเช็กบ้าง',
  'วันนี้มีค่าใช้จ่ายอะไรที่ยังต้องจ่ายก่อนปิดร้าน',
  'ช่วยดูงานค่าใช้จ่ายค้างก่อนปิดร้านวันนี้',
  'ปิดร้านวันนี้ต้องตามบิลไหนบ้าง',
  'สิ้นวันนี้มีค่าใช้จ่ายค้างจ่ายอะไร',
  'ขอเช็กลิสต์ค่าใช้จ่ายก่อนปิดร้าน',
  'วันนี้มีบิลไหนถึงกำหนดจ่าย',
  'ก่อนจบวันมีบิลค่าใช้จ่ายเกินกำหนดไหม',
  'สรุปค่าใช้จ่ายรายวันสำหรับปิดร้าน',
  'ปิดยอดวันนี้ มีอะไรต้องตรวจบ้าง',
  'วันนี้ค่าใช้จ่ายรายการไหนรอตรวจ',
  'มีหลักฐานค่าใช้จ่ายไหนขาดก่อนปิดร้านไหม',
  'วันนี้มีบิลซ้ำที่ต้องเช็กก่อนปิดงานหรือเปล่า',
  'ค่าใช้จ่ายวันนี้จ่ายแล้วกับยังไม่จ่ายมีอะไรบ้าง',
  'เช็กค่าใช้จ่ายปลายวันให้หน่อย',
  'ขอสถานะบิลวันนี้ก่อนเลิกงาน',
  'ก่อนปิดกะวันนี้ต้องเคลียร์ค่าใช้จ่ายอะไร',
  'วันนี้มีเจ้าหนี้ค่าใช้จ่ายอะไรต้องจ่ายทันที',
  'รายการวันนี้ที่ยังค้างจ่ายมีอะไรบ้าง',
  'ผปก. ขอสรุป คชจ. รายวันก่อนปิดร้าน',
  'คชจ. วันนี้ที่ต้องเช็กก่อนปิดร้าน',
  'ปิดร้านละ ขอดู คชจ ค้างวันนี้',
  'สรุปคชจวันนี้ จ่ายแล้วค้างเท่าไร',
  'ขอ daily close ค่าใช้จ่ายวันนี้',
  'expense closing วันนี้มีอะไรค้าง',
  'เช็ก due bill วันนี้ก่อนปิดร้าน',
  'today closing มีค่าใช้จ่ายอะไรต้องทำต่อ',
  'ก่อนปิดร้านดูบิลค้างให้ที',
  'ร้านจะปิดแล้ว มีบิลไหนยังไม่เรียบร้อย',
  'ช่วยไล่งานค่าใช้จ่ายวันนี้ให้หน่อยว่าต้องทำอะไรต่อ',
  'สิ้นวันแล้วขอดูรายการที่ต้องตรวจหลักฐาน',
  'สรุปปิดร้านวันนีให้หน่อย',
  'กอ่นปิดร้านวันนี้มีอะไรค้าง',
  'ปิดรานแล้วเช็กคชจวันนี้ที',
  'วันนี้มีบิลค้างจ่ายอะไรมั้งงง',
  'เช็คค่าใช้จ่ายก่อนปิดร้านหนอ่ย',
  'สรุปสิ้นวันคชจ.ที่ยังไมเรียบร้อย',
  'ปิดร้านนน มีบิลไหนต้องตาม',
  'วันนี้ต้องจ่ายอะไรบ้างก่อนจบรอบ',
];

const EXPENSE_MIXED_MESSAGES = [
  'เดือนนี้ค่าใช้จ่ายรวมเท่าไหร่ แล้ววันนี้มีอะไรต้องจ่ายก่อนปิดร้าน',
  'ขอยอดค่าใช้จ่ายเดือนนี้ พร้อมบิลที่ค้างจ่ายวันนี้',
  'เดือนนี้ใช้ไปกี่บาท และปิดร้านวันนี้ต้องเช็กอะไร',
  'ดูรายการค่าใช้จ่ายเดือนนี้ แล้วสรุปงานค้างก่อนจบวันด้วย',
  'คชจ. เดือนนี้เท่าไร วันนี้มีตัวไหน due บ้าง',
  'ผปก. ขอยอด คชจ เดือนนี้กับ daily close วันนี้',
  'รวม expense เดือนนี้ แล้วบอกบิลที่ต้องตามวันนี้',
  'month นี้จ่ายไปเท่าไหร่ แล้ว closing วันนี้มีอะไรค้าง',
  'เดือนนี้มีค่าใช้จ่ายอะไรบ้าง และก่อนปิดร้านวันนี้ต้องทำอะไร',
  'ยอดรายจ่ายเดือนนี้เท่าไหร่ บิลเกินกำหนดวันนี้มีไหม',
  'ขอดูค่าใช้จ่ายเดือนนี้ด้วย แล้วเช็กหลักฐานที่ขาดวันนี้ให้ด้วย',
  'เดือนนี้เสียค่าอะไรไปมั่ง วันนี้มีบิลไหนยังไม่จ่าย',
  'คชจเดิอนนี้เท่าไร แล้วปิดรานวันนี้ต้องตามอะไร',
  'ช่วยรวมค่าไช้จ่ายเดือนนี้และสรุปสิ้นวันให้ที',
  'ยอดเดือนนี้เท่าไหร แล้ววันนี้ก่อนจบรอบมีค่าใช้จ่ายอะไรค้าง',
];

const OTHER_BUSINESS_CASES: OperatorLanguageCase[] = [
  ...cases('sales', [
    'ยอดขายเดือนนี้เท่าไหร่',
    'เดือนนี้ขายได้กี่บาท',
    'ขอสรุป sales เดือนนี้',
    'ยอดขายเดิอนนี้เท่าไร',
    'เดือนนี้รับเงินจากลูกค้าไปเท่าไหร่',
    'สรุปรายรับจากการขายเดือนนี้ให้ที',
    'ขายของเดือนนี้เป็นไงบ้าง',
    'ยอดขาเดือนนี้เท่าไร',
    'เช็กยอดเซลเดือนนี้หนอ่ย',
    'เดือนนี้ขายยยได้ทั้งหมดกี่บาท',
  ], ['sales.get_sales_summary'], ['ledger.get_financial_summary', 'expense.list_recent']),
  ...cases('inventory', [
    'สินค้าอะไรใกล้หมด',
    'เช็กของใกล้หมดให้หน่อย',
    'สต็อกต่ำมีตัวไหนบ้าง',
    'low stock ตอนนี้มีอะไร',
    'ของไกล้หมดมีตัวไหน',
    'เช็คสตอกที่ต้องเติมที',
    'สินค้าไหนเหลือน้อยยย',
    'ของตัวไหนต้องสั่งเพิ่มแล้ว',
    'stock ตัวไหนใกล้หมดช่วยบอกที',
    'เช็กของเหลือนอ้ยให้หน่อย',
  ], ['inventory.list_low_stock'], ['inventory.get_stock_balance', 'expense.list_recent']),
  ...cases('customer', [
    'ลูกค้าทั้งหมดมีกี่ราย',
    'ลค. ตอนนี้มีกี่คน',
    'ขอสรุปจำนวนลูกค้า',
    'customer ทั้งหมดเท่าไหร่',
    'ลูกค้าที่ใช้งานอยู่มีกี่ราย',
    'จำนวนลุกค้าตอนนี้',
    'มีลูกค้าใหม่กับลูกค้าเก่ากี่ราย',
    'ดูภาพรวม ลค ให้ที',
    'ลุกค้าทั้งหมดตอนนี้กี่คน',
    'เช็ก customer count หน่อย',
  ], ['crm.get_customer_summary'], ['crm.search_customers', 'expense.list_recent']),
  ...cases('finance', [
    'กำไรสุทธิเดือนนี้เท่าไหร่',
    'ขอดูภาพรวมกำไรกับสินทรัพย์',
    'ตอนนี้สินทรัพย์รวมเท่าไร',
    'สรุปฐานะการเงินให้เจ้าของดูหน่อย',
    'ร้านมีกำไรสุทธิเท่าไหร่ในระบบ',
    'ขอ financial summary',
    'กำไรกับทรัพสินรวมเป็นยังไง',
    'เช็กกำไรรสุทธิให้ที',
    'สินทรัพย์รวมตอนนีเท่าไร',
    'ดูภาพรวมการเงืนหน่อย',
  ], ['ledger.get_financial_summary'], ['sales.get_sales_summary', 'expense.list_recent']),
  ...cases('receivable', [
    'ลูกหนี้ค้างรับตอนนี้เท่าไหร่',
    'ลูกค้ายังค้างจ่ายเราอยู่กี่ราย',
    'ยอดเงินที่ยังเก็บจากลูกค้าไม่ได้เท่าไร',
    'ขอสรุป invoice ที่ยังไม่รับเงิน',
    'AR คงค้างมีเท่าไหร่',
    'มีใบแจ้งหนี้ค้างรับกี่ใบ',
    'ใครยังติดเงินร้านอยู่รวมเท่าไร',
    'เช็กลูกหนีค้างรับให้ที',
    'ยอดค้างรับจากลค.ตอนนี้',
    'เงินที่ลูกค้ายังไม่จ่ายมีเท่าไหร',
  ], ['accounting.get_receivable_summary'], ['procurement.get_ap_outstanding', 'expense.list_recent']),
  ...cases('payable', [
    'เจ้าหนี้ค้างจ่ายตอนนี้เท่าไหร่',
    'ร้านยังติดเงินผู้ขายอยู่เท่าไร',
    'ขอสรุปยอดค้างจ่าย supplier',
    'มีบิลผู้ขายที่ยังไม่จ่ายกี่บาท',
    'AP outstanding ตอนนี้เท่าไหร่',
    'ต้องจ่ายเจ้าหนี้อีกเท่าไร',
    'ผู้ขายรายไหนมียอดค้างสูง',
    'เช็กเจ้าหนีค้างจ่ายให้ที',
    'ยอดค้างจ่ายซัพพลายเออร์ตอนนี',
    'เงินที่เรายังไม่จ่ายร้านค้ามีเท่าไหร',
  ], ['procurement.get_ap_outstanding'], ['accounting.get_receivable_summary', 'expense.list_recent']),
  ...cases('tax', [
    'มีภาษีอะไรใกล้ถึงกำหนดยื่นบ้าง',
    'งวดนี้ต้องยื่นภาษีตัวไหน',
    'ขอรายการภาษีที่ยังเปิดอยู่',
    'ภาษีอะไรต้องทำต่อเร็ว ๆ นี้',
    'deadline ภาษีรอบนี้มีอะไร',
    'มีแบบภาษีไหนยังไม่ได้ยื่น',
    'เจ้าของต้องระวังกำหนดภาษีอะไรบ้าง',
    'เช็กภาสีใกล้ครบกำหนดให้ที',
    'ภาษีที่ต้องยื่นเรวๆนี้',
    'tax due มีอะไรบ้างงง',
  ], ['tax.get_upcoming_tax_obligations'], ['tax.get_vat_summary', 'expense.list_recent']),
  ...cases('alerts', [
    'ตอนนี้มีแจ้งเตือนอะไรเปิดอยู่',
    'มีเรื่องอะไรที่ระบบเตือนให้ทำบ้าง',
    'ขอดู alert ที่ยังไม่ปิด',
    'มีอะไรผิดปกติที่ต้องรีบดูไหม',
    'รายการแจ้งเตือนค้างมีอะไร',
    'เจ้าของต้องเข้าไปเช็กแจ้งเตือนไหน',
    'open alerts ตอนนี้มีเท่าไหร่',
    'เช็กแจ้งเตือนที่ยังคางให้ที',
    'มีเรื่องดว่นที่ระบบเตือนไหม',
    'ดูอะเลิตที่เปิดอยู่หน่อย',
  ], ['notifications.list_open_alerts'], ['notifications.get_daily_summary', 'expense.get_daily_closing']),
  ...cases('company', [
    'บริษัทมีทั้งหมดกี่สาขา',
    'ขอรายชื่อสาขาทั้งหมด',
    'ตอนนี้ร้านเรามีสาขาอะไรบ้าง',
    'มีสาขาไหนอยู่ในระบบบ้าง',
    'เช็กจำนวน branch ให้หน่อย',
    'สาขาทั้งหมดชื่ออะไร',
    'ขอดู code กับชื่อสาขา',
    'บรัษัทมีกี่สาขา',
    'เช็กรายชื่อสาขาหนอ่ย',
    'branch list ของร้านมีอะไรบ้าง',
  ], ['company.list_branches'], ['company.get_current_context', 'expense.list_recent']),
  ...cases('reimbursement', [
    'มีเบิกจ่ายอะไรค้างอนุมัติบ้าง',
    'รายการเบิกเงินที่รอฉันอนุมัติมีกี่รายการ',
    'ขอดูคิวเบิกจ่ายรออนุมัติ',
    'มีใครส่งเบิกแล้วรอเจ้าของดูไหม',
    'reimbursement pending approval มีอะไร',
    'ใบเบิกไหนยังรออนุมัติ',
    'มีงานอนุมัติเบิกจ่ายค้างอยู่ไหม',
    'เช็กรายการเบิกที่รออนุมัตที',
    'เบิกจ่ายค้างอนุมัติมีกี่อัน',
    'ดูคิวเบิกเงินหนอ่ย',
  ], ['reimbursement.list_pending_approvals'], ['reimbursement.get_summary', 'expense.list_recent']),
  ...cases('business_mixed', [
    'ยอดขายเดือนนี้เท่าไหร่ แล้วสินค้าอะไรใกล้หมด',
    'ขายได้กี่บาทกับของที่ต้องเติมมีอะไรบ้าง',
    'ขอสรุป sales เดือนนี้และ low stock',
    'กำไรสุทธิเท่าไหร่ แล้วลูกหนี้ค้างรับเท่าไร',
    'ดูภาพรวมการเงินกับเงินที่ลูกค้ายังค้าง',
    'กำไรรวมและ AR คงค้างตอนนี้',
    'เจ้าหนี้ค้างจ่ายเท่าไหร่ แล้วมีภาษีอะไรใกล้กำหนด',
    'ดู AP outstanding กับ tax due ให้ที',
    'ร้านติดผู้ขายเท่าไรและต้องยื่นภาษีอะไร',
    'มีแจ้งเตือนอะไร กับเบิกจ่ายไหนรออนุมัติ',
    'ดู open alert และคิวเบิกเงินที',
    'เรื่องด่วนมีอะไรบ้างรวมงานอนุมัติเบิกจ่าย',
    'บริษัทมีกี่สาขาและยอดขายเดือนนี้เท่าไหร่',
    'ขอ branch list พร้อม sales เดือนนี้',
    'สาขามีอะไรบ้าง แล้วเดือนนี้ขายได้กี่บาท',
  ], [], []),
];

const MIXED_EXPECTATIONS = [
  ['sales.get_sales_summary', 'inventory.list_low_stock'],
  ['sales.get_sales_summary', 'inventory.list_low_stock'],
  ['sales.get_sales_summary', 'inventory.list_low_stock'],
  ['ledger.get_financial_summary', 'accounting.get_receivable_summary'],
  ['ledger.get_financial_summary', 'accounting.get_receivable_summary'],
  ['ledger.get_financial_summary', 'accounting.get_receivable_summary'],
  ['procurement.get_ap_outstanding', 'tax.get_upcoming_tax_obligations'],
  ['procurement.get_ap_outstanding', 'tax.get_upcoming_tax_obligations'],
  ['procurement.get_ap_outstanding', 'tax.get_upcoming_tax_obligations'],
  ['notifications.list_open_alerts', 'reimbursement.list_pending_approvals'],
  ['notifications.list_open_alerts', 'reimbursement.list_pending_approvals'],
  ['notifications.list_open_alerts', 'reimbursement.list_pending_approvals'],
  ['company.list_branches', 'sales.get_sales_summary'],
  ['company.list_branches', 'sales.get_sales_summary'],
  ['company.list_branches', 'sales.get_sales_summary'],
] as const;

for (const [index, expectation] of MIXED_EXPECTATIONS.entries()) {
  const testCase = OTHER_BUSINESS_CASES.find((candidate) => candidate.category === 'business_mixed' && candidate.id.endsWith(String(index + 1).padStart(3, '0')));
  if (testCase) testCase.expectedTools = [...expectation];
}

export const LINE_AI_OPERATOR_LANGUAGE_CORPUS: OperatorLanguageCase[] = [
  ...cases('expense_period', EXPENSE_PERIOD_MESSAGES, ['expense.list_recent'], ['expense.get_daily_closing']),
  ...cases('expense_daily_close', EXPENSE_DAILY_CLOSE_MESSAGES, ['expense.get_daily_closing'], ['expense.list_recent']),
  ...cases('expense_mixed', EXPENSE_MIXED_MESSAGES, ['expense.list_recent', 'expense.get_daily_closing'], []),
  ...OTHER_BUSINESS_CASES,
];

export const OPERATOR_LANGUAGE_CATEGORY_MINIMUMS: Record<OperatorLanguageCase['category'], number> = {
  expense_period: 50,
  expense_daily_close: 40,
  expense_mixed: 15,
  sales: 10,
  inventory: 10,
  customer: 10,
  finance: 10,
  receivable: 10,
  payable: 10,
  tax: 10,
  alerts: 10,
  company: 10,
  reimbursement: 10,
  business_mixed: 15,
};

type AvailabilityFamily = {
  key: string;
  tool?: string;
  route?: OperatorAvailabilityCase['route'];
  copy: string;
  mode?: 'feature_gated' | 'permission_only' | 'tool_unavailable' | 'unsupported_module';
  messages: string[];
};

const AVAILABILITY_FAMILIES: AvailabilityFamily[] = [
  { key: 'product_catalog', tool: 'inventory.search_products', route: { intent: 'read_detail', subject: 'product', agent: 'inventory' }, copy: 'ระบบสินค้าและบริการ', messages: ['มีน้ำมันพืช A มั้ย', 'หาสินค้าชื่อกาแฟหนอ่ย', 'มีของชื่อนมสดมะ', 'ช่วยค้นหาสินค้ารหัส P100', 'ค้นรายการบริการล้างแอร์', 'มี product คำว่าชาเขียวไหม', 'ขอดูสินค้าที่ชื่อสบู่', 'เช็กว่าร้านมีกระดาษ A4 ไหม'] },
  { key: 'inventory', tool: 'inventory.list_low_stock', route: { intent: 'read_summary', subject: 'inventory', agent: 'inventory' }, copy: 'ระบบคลังสินค้า', messages: ['ของไกล้หมดมีไรมั่ง', 'เช็คสตอกต่ำที', 'สินค้าเหลือนอ้ยยยมีอะไร', 'ตอนนี้สินค้าอะไรใกล้หมด', 'ขอรายการ low stock', 'ของตัวไหนต้องเติมสต็อก', 'ช่วยดูสต็อกต่ำให้หน่อย', 'คลังมีอะไรเหลือน้อย'] },
  { key: 'expenses', tool: 'expense.list_recent', route: { intent: 'read_summary', subject: 'expense', agent: 'accounting' }, copy: 'ระบบค่าใช้จ่ายและเอกสาร', messages: ['คชจเดือนนี้กี่บาท', 'ขอยอดค่าไช้จ่ายหนอ่ย', 'เดิอนนี้จ่ายอะไรไปมั่ง', 'สรุปค่าใช้จ่ายเดือนนี้', 'มีรายจ่ายล่าสุดอะไร', 'เช็ก expense เดือนนี้', 'ร้านใช้เงินไปเท่าไหร่เดือนนี้', 'ขอดูรายการค่าใช้จ่าย'] },
  { key: 'sales_documents', tool: 'sales.get_sales_summary', route: { intent: 'report_request', subject: 'sale', agent: 'sales' }, copy: 'ระบบเอกสารขายและรับชำระ', messages: ['ยอดขายเดิอนนี้เท่าไร', 'เช็กยอดเซลหนอ่ย', 'ขายได้กี่บาทมั่งงง', 'ขอสรุปยอดขายเดือนนี้', 'เดือนนี้ขายได้กี่รายการ', 'sales month นี้เท่าไหร่', 'รายรับจากการขายเป็นไง', 'ช่วยดูภาพรวมการขาย'] },
  { key: 'crm', tool: 'crm.get_customer_summary', route: { intent: 'read_summary', subject: 'customer', agent: 'crm' }, copy: 'ระบบลูกค้าและงานติดตาม', messages: ['ลคทั้งหมดกี่คน', 'สรุปลุกค้าให้ที', 'ลูกค้ามีกี่รายยย', 'ขอภาพรวมลูกค้า', 'ลูกค้าที่ active มีกี่ราย', 'ดู customer summary หน่อย', 'ตอนนี้เรามีลูกค้าเท่าไหร่', 'เช็กจำนวนลูกค้าให้หน่อย'] },
  { key: 'crm_bookings', tool: 'crm.get_booking_summary', route: { intent: 'read_summary', subject: 'booking', agent: 'crm' }, copy: 'ระบบลูกค้าและงานติดตาม', messages: ['วันนี้มีนัดกี่คิว', 'ดูคิวจองวันนี้ที', 'มี booking กี่อันนน', 'ขอสรุปนัดหมาย', 'ลูกค้าจองคิวไว้กี่ราย', 'เช็ก appointment วันนี้', 'อาทิตย์นี้มีคิวนัดเท่าไหร่', 'ช่วยดูภาพรวมการจอง'] },
  { key: 'crm_inbox', tool: 'crm.get_inbox_summary', route: { intent: 'read_summary', subject: 'conversation', agent: 'crm' }, copy: 'ระบบลูกค้าและงานติดตาม', messages: ['แชทลคค้างมีกี่อัน', 'ดูอินบอกหนอ่ย', 'ข้อความลูกค้าค้างงงมีไหม', 'ขอสรุปกล่องข้อความ', 'มีแชทไหนยังไม่ตอบ', 'เช็ก CRM inbox', 'มีบทสนทนาที่ต้องรีบดูไหม', 'ขอภาพรวมข้อความลูกค้า'] },
  { key: 'procurement', tool: 'procurement.get_summary', route: { intent: 'read_summary', subject: 'procurement', agent: 'accounting' }, copy: 'ระบบจัดซื้อและผู้ขาย', messages: ['ใบสั่งซื้อค้างกี่ใบ', 'เช็ค po หนอ่ย', 'สรุปจัดซื้อให้ทีได้มั้ย', 'ขอภาพรวมการจัดซื้อ', 'มีใบสั่งซื้อสถานะอะไรบ้าง', 'ดู procurement summary', 'งานซื้อของตอนนี้เป็นไง', 'ช่วยสรุป PO ล่าสุด'] },
  { key: 'ledger', tool: 'ledger.get_financial_summary', route: { intent: 'read_summary', subject: 'ledger', agent: 'cfo' }, copy: 'ระบบบัญชี', messages: ['กำไรสุดทิเท่าไร', 'เช็คงบหนอ่ย', 'ภาพรวมการเงินเปนไงมั่ง', 'ขอสรุปการเงิน', 'สินทรัพย์รวมตอนนี้เท่าไหร่', 'ดู financial summary', 'ตอนนี้บัญชีภาพรวมเป็นยังไง', 'รายงานกำไรกับสินทรัพย์ให้หน่อย'] },
  { key: 'tax', tool: 'tax.get_upcoming_tax_obligations', route: { intent: 'read_summary', subject: 'tax', agent: 'tax' }, copy: 'ระบบภาษี', messages: ['ภาสีอะไรใกล้ถึงกำหนด', 'เช็ค tax due ที', 'มีแบบภาษีค้างงงมั้ย', 'ขอรายการภาษีใกล้กำหนด', 'งวดนี้ต้องยื่นอะไร', 'ดู upcoming tax', 'เรื่องภาษีมีอะไรต้องรีบทำ', 'ช่วยเช็กกำหนดยื่นภาษี'] },
  { key: 'workflow', tool: 'workflow.list_assigned_tasks', route: { intent: 'read_summary', subject: 'workflow', agent: 'general' }, copy: 'ระบบงานอัตโนมัติ', messages: ['มีงานอะไรมอบให้ฉัน', 'เช็ค task ค้างที', 'งานออโต้มีไรให้ทำมั่ง', 'ขอรายการงานที่ได้รับมอบหมาย', 'ตอนนี้มี workflow ไหนรอฉัน', 'ดู assigned tasks', 'มีงานระบบไหนต้องจัดการ', 'ขอเช็กงานอัตโนมัติของฉัน'] },
  { key: 'reports', tool: 'reports.get_monthly_report_summary', route: { intent: 'report_request', subject: 'report', agent: 'general' }, copy: 'ระบบรายงาน', messages: ['ขอรายงานเดือนนี้', 'เช็ค report ที', 'รายงานเดิอนนี้มีไรมั่ง', 'ขอสรุปรายงานรายเดือน', 'รายงานล่าสุดเป็นยังไง', 'ดู monthly report summary', 'เดือนนี้มีรายงานอะไร', 'ช่วยสรุปรายงานให้เจ้าของ'] },
  { key: 'dashboard', tool: 'dashboard.get_business_health_summary', route: { intent: 'read_summary', subject: 'company', agent: 'general' }, copy: 'แดชบอร์ดและแจ้งเตือน', messages: ['ร้านโอเคมั้ยวันนี้', 'ดูแดชบอดที', 'สุขภาพธุรกิดเปนไงมั่งงง', 'ขอภาพรวมธุรกิจ', 'ตอนนี้มีจุดไหนต้องรีบดู', 'เช็ก business health', 'สรุปภาพรวมวันนี้ให้หน่อย', 'แดชบอร์ดมีอะไรผิดปกติ'] },
  { key: 'notifications', tool: 'notifications.list_open_alerts', route: { intent: 'read_summary', subject: 'report', agent: 'notifications' }, copy: 'แดชบอร์ดและแจ้งเตือน', messages: ['มีแจ้งเตือนค้างมั้ย', 'เช็คอะเลิตหนอ่ย', 'เรื่องดว่นที่ระบบเตือนมีไร', 'ขอรายการแจ้งเตือน', 'มี notification อะไรเปิดอยู่', 'ดู open alerts ที', 'ตอนนี้ระบบเตือนเรื่องอะไร', 'ช่วยเช็กแจ้งเตือนที่ยังไม่ปิด'] },
  { key: 'receivables', tool: 'accounting.get_receivable_summary', route: { intent: 'read_summary', subject: 'accounting_document', agent: 'accounting' }, copy: 'ระบบเอกสารขายและรับชำระ', messages: ['ลหนี้ค้างเท่าไร', 'เช็ค ar หนอ่ย', 'ลูกค้ายังค้างเรากี่บาท', 'ขอสรุปลูกหนี้ค้างรับ', 'ใบแจ้งหนี้ยังไม่จ่ายกี่ใบ', 'ดู receivable summary', 'เงินที่ลูกค้ายังไม่จ่ายมีเท่าไหร่', 'ช่วยดูยอดค้างชำระลูกค้า'] },
  { key: 'employees', tool: 'company.get_employee_summary', route: { intent: 'read_summary', subject: 'employee', agent: 'general' }, copy: '', mode: 'permission_only', messages: ['มีพนงกี่คน', 'เช็คคนในร้านที', 'ทีมงานมีกี่คนมั่งงง', 'ขอสรุปจำนวนพนักงาน', 'ตอนนี้มีพนักงานกี่คน', 'ดู employee summary', 'ในบริษัทมีสมาชิกกี่ราย', 'ช่วยเช็กจำนวนคนทำงาน'] },
  { key: 'reimbursement', tool: 'reimbursement.get_summary', route: { intent: 'read_summary', subject: 'reimbursement', agent: 'accounting' }, copy: '', mode: 'permission_only', messages: ['เบิกจ่ายค้างกี่อัน', 'เช็คใบเบิกที', 'สรุปเบิกเงินหนอ่ยยย', 'ขอภาพรวมเบิกจ่าย', 'มีรายการเบิกสถานะอะไรบ้าง', 'ดู reimbursement summary', 'เบิกจ่ายตอนนี้เป็นยังไง', 'ช่วยสรุปใบเบิกให้ที'] },
  { key: 'company_core', tool: 'company.list_branches', route: { intent: 'read_summary', subject: 'branch', agent: 'general' }, copy: '', mode: 'permission_only', messages: ['บริสัทมีกี่สาขา', 'ขอ branch list ที', 'มีสาขาอะไรมั่งงง', 'ขอรายชื่อสาขา', 'ร้านเรามีสาขาไหนบ้าง', 'เช็กจำนวน branch', 'สรุปข้อมูลสาขาให้หน่อย', 'มีสาขาทั้งหมดกี่ที่'] },
  { key: 'bank_build', tool: 'bank.get_account_balances', route: { intent: 'read_summary', subject: 'bank', agent: 'cfo' }, copy: 'ผ่าน LINE', mode: 'tool_unavailable', messages: ['ยอดธนาคารเหลือเท่าไร', 'เช็คแบงค์ที', 'เงินในบันชีมีกี่บาทมั่งงง', 'ขอยอดคงเหลือธนาคาร', 'บัญชีธนาคารมียอดอะไรบ้าง', 'ดู bank balance', 'เช็กเงินคงเหลือทุกบัญชี', 'ตอนนี้ธนาคารรวมเท่าไหร่'] },
  { key: 'leave_build', tool: 'hr.get_leave_summary', route: { intent: 'read_summary', subject: 'leave', agent: 'general' }, copy: 'ผ่าน LINE', mode: 'tool_unavailable', messages: ['ปีนี้ฉันลาไปกี่วัน', 'เช็ควันลาหนอ่ย', 'พนงลาค้างงงมีไหม', 'ขอสรุปวันลา', 'ใครลาวันนี้บ้าง', 'ดู leave summary', 'วันลาคงเหลือเท่าไหร่', 'ช่วยเช็กข้อมูลการลา'] },
  { key: 'crm_suggestion_build', tool: 'crm.suggest_sales_followups', route: { intent: 'read_summary', subject: 'follow_up', agent: 'crm' }, copy: 'ผ่าน LINE', mode: 'tool_unavailable', messages: ['ควรตามลูกค้าคนไหน', 'แนะนำ follow up ที', 'ลคคนไหนต้องโทรหาบ้างงง', 'ขอคำแนะนำติดตามลูกค้า', 'ช่วยจัดลำดับลูกค้าที่ต้องตาม', 'suggest sales followups', 'วันนี้ควรทักหาใคร', 'บอกทีว่าต้องตามดีลไหนก่อน'] },
  { key: 'receipt_tool_build', tool: 'accounting.capture_receipt_evidence', route: { intent: 'read_detail', subject: 'expense', agent: 'accounting' }, copy: 'ผ่าน LINE', mode: 'tool_unavailable', messages: ['เปิดเครื่องมือจับบิลให้ที', 'ใช้ tool อ่านใบเสร็จหนอ่ย', 'สร้างหลักฐานจากบิลนี้ในแชท', 'ขอใช้ระบบ receipt evidence', 'ให้ AI tool บันทึกใบเสร็จ', 'capture receipt evidence ที', 'เปิดฟังก์ชันจัดการหลักฐานบิล', 'ใช้เครื่องมือสร้างร่างจากใบเสร็จ'] },
  { key: 'recommendation', copy: 'ยอดขาย กำไร และสต็อก', mode: 'unsupported_module', messages: ['ช่วงนี้ขายอะไรดี', 'ควรเติมของไรมาขาย', 'เอาสินค้าตัวไหนมาขายดีอะ', 'แนะนำสินค้าที่ควรขาย', 'เดือนหน้าควรขายอะไร', 'what product should we sell', 'ช่วยเลือกของมาลงร้าน', 'ตัวไหนน่าจะขายดีสุด'] },
  { key: 'expense_bill', tool: 'expense.get_detail', route: { intent: 'read_detail', subject: 'expense', agent: 'accounting' }, copy: 'ระบบค่าใช้จ่ายและเอกสาร', messages: ['บิล EXP-001 ซื้อไร', 'ดูบิล exp001 ที', 'บิลค่าของ EXP-001 มีไรมั่ง', 'ขอรายละเอียดค่าใช้จ่าย EXP-001', 'บิลผู้ขาย EXP-001 จ่ายค่าอะไร', 'เช็ก expense EXP-001', 'เอกสาร EXP-001 มีรายการอะไร', 'ขอดูรายการในบิล EXP-001'] },
  { key: 'sales_bill', tool: 'accounting.get_document_detail', route: { intent: 'read_detail', subject: 'accounting_document', agent: 'accounting' }, copy: 'ระบบเอกสารขายและรับชำระ', messages: ['ใบขาย INV-001 มีอะไร', 'ดูอินวอย inv001 ที', 'บิลลูกค้า INV-001 ขายอะไรมั่ง', 'ขอรายละเอียดเอกสารขาย INV-001', 'ใบแจ้งหนี้ INV-001 เก็บค่าอะไร', 'เช็ก sales document INV-001', 'เอกสารลูกค้า INV-001 มีรายการอะไร', 'ขอดูรายการใน invoice INV-001'] },
];

function availabilityMode(family: AvailabilityFamily, index: number): OperatorAvailabilityCase['accessMode'] {
  if (family.mode === 'tool_unavailable' || family.mode === 'unsupported_module') return family.mode;
  if (family.mode === 'permission_only') return index < 4 ? 'forbidden' : index === 7 ? 'no_data' : 'allowed';
  return index < 3 ? 'feature_disabled' : index === 3 ? 'runtime_feature_disabled' : index < 6 ? 'forbidden' : index === 7 ? 'no_data' : 'allowed';
}

export const LINE_AI_OPERATOR_AVAILABILITY_CORPUS: OperatorAvailabilityCase[] = AVAILABILITY_FAMILIES.flatMap((family) =>
  family.messages.map((message, index) => {
    const accessMode = availabilityMode(family, index);
    const expectedTools = family.tool && !['tool_unavailable', 'unsupported_module'].includes(accessMode) ? [family.tool] : [];
    const expectedInvokedTools = family.tool && ['runtime_feature_disabled', 'allowed', 'no_data'].includes(accessMode) ? [family.tool] : [];
    const expectedPlanStatus = accessMode === 'partial' ? 'PARTIAL'
      : ['feature_disabled', 'runtime_feature_disabled', 'forbidden', 'tool_unavailable', 'unsupported_module'].includes(accessMode) ? 'UNROUTABLE'
        : 'ROUTABLE';
    const requiredReplyIncludes = accessMode === 'feature_disabled' || accessMode === 'runtime_feature_disabled'
      ? [family.copy, 'ยังไม่ได้เปิดใช้งาน']
      : accessMode === 'forbidden' ? ['ไม่มีสิทธิ์']
        : accessMode === 'tool_unavailable' ? [/[\u0E00-\u0E7F]/u.test(message) ? 'ผ่าน LINE' : 'through LINE']
          : accessMode === 'unsupported_module' ? [index === 5 ? 'sales, margin, and stock' : family.copy]
            : [];
    return {
      id: `availability-${family.key}-${String(index + 1).padStart(2, '0')}`,
      category: 'availability' as const,
      family: family.key,
      message,
      expectedTools,
      ...(family.tool ? { routeTool: family.tool } : {}),
      forbiddenTools: family.tool ? [] : ['inventory.search_products', 'inventory.list_low_stock', 'sales.get_sales_summary'],
      expectedPlanStatus,
      accessMode,
      expectedInvokedTools,
      requiredReplyIncludes,
      forbiddenReplyIncludes: accessMode === 'feature_disabled' || accessMode === 'runtime_feature_disabled'
        ? ['ไม่มีสิทธิ์', 'ไม่พบข้อมูล']
        : accessMode === 'forbidden' ? ['ยังไม่ได้เปิดใช้งาน'] : [],
      noisy: index < 3,
      ...(family.route ? { route: family.route } : {}),
    };
  }),
).concat(
  [
    'มีน้ำมันพืช A มั้ย แล้วของอะไรใกล้หมด',
    'หากาแฟให้ที กับเช็คสตอกต่ำด้วย',
    'มีสบู่ขายไหม ของตัวไหนต้องเติมสต็อก',
    'ค้นสินค้า P100 และดู low stock หน่อย',
    'ช่วยหาชาเขียว แล้วคลังมีอะไรเหลือน้อย',
    'มีบริการล้างแอร์ไหมกับสินค้าไกล้หมด',
    'เช็กกระดาษ A4 พร้อมของเหลือนอ้ยยย',
    'หา product คำว่านม และสรุปสต็อกต่ำ',
  ].map((message, index) => ({
    id: `availability-partial-product-inventory-${String(index + 1).padStart(2, '0')}`,
    category: 'availability' as const,
    family: 'product_catalog_and_inventory',
    message,
    expectedTools: ['inventory.search_products', 'inventory.list_low_stock'],
    routeTools: ['inventory.search_products', 'inventory.list_low_stock'],
    forbiddenTools: [],
    expectedPlanStatus: 'PARTIAL' as const,
    accessMode: 'partial' as const,
    expectedInvokedTools: ['inventory.search_products'],
    requiredReplyIncludes: ['ระบบคลังสินค้า', 'ยังไม่ได้เปิดใช้งาน'],
    forbiddenReplyIncludes: ['ไม่มีสิทธิ์'],
    noisy: index < 4,
  })),
).concat(
  [
    'หาสินค้า A ให้ที แต่ระบบดึงไม่ขึ้น',
    'เช็ค product P100 หนอ่ยเน็ตเหมือนมีปัญหา',
    'ค้นนมสดที ระบบอ่านข้อมูลไม่ได้',
    'มีสบู่ไหม ลองดึงข้อมูลให้หน่อย',
    'ค้นชานมให้ที ถ้าต้นทางล่มบอกตรงๆ',
    'หา service ล้างแอร์ ระบบเหมือนค้างงง',
    'search product กาแฟให้หน่อย',
    'ลองเช็กสินค้ากระดาษ A4 ที',
  ].map((message, index) => ({
    id: `availability-source-unavailable-${String(index + 1).padStart(2, '0')}`,
    category: 'availability' as const,
    family: 'source_unavailable',
    message,
    expectedTools: ['inventory.search_products'],
    routeTool: 'inventory.search_products',
    forbiddenTools: [],
    expectedPlanStatus: 'ROUTABLE' as const,
    accessMode: 'source_unavailable' as const,
    expectedInvokedTools: ['inventory.search_products'],
    requiredReplyIncludes: ['ไม่สามารถดึงข้อมูล'],
    forbiddenReplyIncludes: ['ยังไม่ได้เปิดใช้งาน', 'ไม่มีสิทธิ์', 'ไม่พบข้อมูล'],
    noisy: index < 4,
    route: { intent: 'read_detail', subject: 'product', agent: 'inventory' },
  })),
);

export const LINE_AI_ALL_OPERATOR_CASES = [
  ...LINE_AI_OPERATOR_LANGUAGE_CORPUS,
  ...LINE_AI_OPERATOR_AVAILABILITY_CORPUS,
];
