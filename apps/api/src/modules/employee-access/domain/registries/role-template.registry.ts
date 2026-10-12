// Item 10C+ Phase 1: Job Presets (role templates).
// Curated bundles of capability packs that seed a starting point for a company custom role.
// pack.core.basics is applied automatically by compileRole (it is a core pack), so it is not listed here.
// Presets never produce OWNER/SYSTEM_ADMIN and never edit system roles — they create editable company roles.
import type { RoleTemplate } from '@watchdog-bms/contracts';

type RawTemplate = Omit<RoleTemplate, 'isSystem'>;

const TASKS = 'pack.workflow.tasks';

// Shared bundles reused by several niche presets (keeps presets consistent with the six pillars).
const MANAGER_PACKS = [
  'pack.crm.view', 'pack.crm.manage', 'pack.quotation.approve', 'pack.billing.view', 'pack.payment.view', 'pack.inventory.view',
  'pack.expense.review', 'pack.reimbursement.approve', 'pack.procurement.view', 'pack.procurement.approve', 'pack.cash.view',
  'pack.expense.disbursement.view', 'pack.expense.disbursement.approve',
  'pack.dashboard.manage', 'pack.people.view', 'pack.tax.view', 'pack.ledger.view', TASKS,
];
// Each write pack is paired with its read/.view sibling so a role can open the screens it operates in.
// GAP-06 (2026-07-29): finance presets mirror the system FINANCE role, which issues/voids tax
// invoices — pack.tax_invoice.issue is part of the bundle.
const FINANCE_PACKS = [
  'pack.billing.view', 'pack.billing.operate', 'pack.billing.issue', 'pack.tax_invoice.issue', 'pack.payment.view', 'pack.payment.record', 'pack.payment.void',
  'pack.bank.view', 'pack.bank.operate', 'pack.procurement.view', 'pack.procurement.ap_manage', 'pack.tax.view', 'pack.tax.prepare',
  'pack.ledger.operate', 'pack.expense.view', 'pack.expense.finance', 'pack.reimbursement.finance',
  'pack.expense.disbursement.view', 'pack.expense.disbursement.prepare', 'pack.expense.disbursement.approve',
  'pack.expense.disbursement.pay', 'pack.expense.disbursement.issue',
  // Handoff for a 50 ทวิ the system cannot issue — pairs with the FINANCE role's wht.* grants.
  'pack.wht.certificate.manage', 'pack.wht.pnd53', TASKS,
];

const RAW_TEMPLATES: RawTemplate[] = [
  // ---- Cross-cutting ----
  {
    key: 'tpl.x.readonly', industryTag: 'crosscutting',
    nameTh: 'อ่านอย่างเดียว/ผู้ตรวจสอบ', nameEn: 'Read-only / Auditor',
    description: 'เห็นข้อมูลทุกส่วนแบบอ่านอย่างเดียวสำหรับตรวจสอบ',
    capabilityPackKeys: ['pack.people.view', 'pack.audit.read', 'pack.inventory.view', 'pack.crm.view', 'pack.billing.view', 'pack.payment.view', 'pack.expense.view', 'pack.procurement.view', 'pack.bank.view', 'pack.ledger.view', 'pack.tax.view'],
  },
  {
    key: 'tpl.x.accounting', industryTag: 'crosscutting',
    nameTh: 'บัญชี/ผู้ทำบัญชี', nameEn: 'Bookkeeper / Accountant',
    description: 'ทำบัญชีแยกประเภท ภาษี กระทบยอดธนาคาร และตรวจค่าใช้จ่าย',
    capabilityPackKeys: ['pack.billing.view', 'pack.payment.view', 'pack.ledger.view', 'pack.ledger.manage', 'pack.tax.view', 'pack.tax.manage', 'pack.wht.pnd53', 'pack.bank.reconcile_manage', 'pack.bank.view', 'pack.expense.review', 'pack.expense.disbursement.view', 'pack.expense.disbursement.issue', 'pack.reimbursement.review', 'pack.procurement.view', 'pack.audit.read', 'pack.wht.certificate.manage', TASKS],
  },
  {
    key: 'tpl.x.marketing', industryTag: 'crosscutting',
    nameTh: 'การตลาด', nameEn: 'Marketing',
    description: 'ดูลูกค้าที่อนุญาตและปรับแดชบอร์ดการตลาด',
    capabilityPackKeys: ['pack.crm.view', 'pack.dashboard.manage', TASKS],
  },
  {
    key: 'tpl.x.manager', industryTag: 'crosscutting',
    nameTh: 'ผู้จัดการ', nameEn: 'Manager',
    description: 'ดูแลทีม อนุมัติงาน และเห็นสรุปการเงิน/ภาษี',
    capabilityPackKeys: MANAGER_PACKS,
  },
  {
    key: 'tpl.x.finance', industryTag: 'crosscutting',
    nameTh: 'การเงิน (ลูกหนี้/เจ้าหนี้)', nameEn: 'Finance',
    description: 'ออกบิล รับ/จ่ายเงิน กระทบยอด และเตรียมภาษี',
    capabilityPackKeys: FINANCE_PACKS,
  },

  // ---- Retail ----
  {
    key: 'tpl.retail.cashier', industryTag: 'retail',
    nameTh: 'แคชเชียร์', nameEn: 'Cashier',
    description: 'ออกใบเสร็จ/ใบแจ้งหนี้หน้าร้าน รับชำระเงิน และดูสต๊อก',
    capabilityPackKeys: ['pack.billing.view', 'pack.billing.operate', 'pack.billing.issue', 'pack.payment.view', 'pack.payment.record', 'pack.inventory.view', 'pack.crm.view', TASKS],
  },
  {
    key: 'tpl.retail.sales', industryTag: 'retail',
    nameTh: 'พนักงานขาย', nameEn: 'Sales staff',
    description: 'ดูแลลูกค้า ทำใบเสนอราคา และบันทึกค่าใช้จ่าย/เบิกของตัวเอง',
    capabilityPackKeys: ['pack.crm.view', 'pack.crm.operate', 'pack.quotation.operate', 'pack.billing.view', 'pack.inventory.view', 'pack.expense.self', 'pack.reimbursement.self', TASKS],
  },
  {
    key: 'tpl.retail.stock', industryTag: 'retail',
    nameTh: 'พนักงานคลัง', nameEn: 'Stock staff',
    description: 'รับ-จ่าย ปรับ/นับสต๊อก และรับของจากใบสั่งซื้อ',
    capabilityPackKeys: ['pack.inventory.view', 'pack.inventory.operate', 'pack.inventory.adjust', 'pack.procurement.view', 'pack.procurement.request', 'pack.expense.self', 'pack.reimbursement.self', TASKS],
  },
  {
    key: 'tpl.retail.store_manager', industryTag: 'retail',
    nameTh: 'ผู้จัดการร้าน', nameEn: 'Store manager',
    description: 'ดูแลหน้าร้านครบวงจร อนุมัติ และเห็นสรุป',
    capabilityPackKeys: MANAGER_PACKS,
  },

  // ---- Trading ----
  {
    key: 'tpl.trading.sales', industryTag: 'trading',
    nameTh: 'ฝ่ายขาย', nameEn: 'Sales',
    description: 'ดูแลลูกค้า ทำใบเสนอราคา และงานขายรายวัน',
    capabilityPackKeys: ['pack.crm.view', 'pack.crm.operate', 'pack.quotation.operate', 'pack.billing.view', 'pack.inventory.view', 'pack.expense.self', 'pack.reimbursement.self', TASKS],
  },
  {
    key: 'tpl.trading.purchasing', industryTag: 'trading',
    nameTh: 'ฝ่ายจัดซื้อ', nameEn: 'Purchasing',
    description: 'ขอซื้อ ออกใบสั่งซื้อ และดูจัดซื้อ',
    capabilityPackKeys: ['pack.procurement.view', 'pack.procurement.request', 'pack.inventory.view', 'pack.crm.view', 'pack.expense.self', TASKS],
  },
  {
    key: 'tpl.trading.inventory', industryTag: 'trading',
    nameTh: 'คลังสินค้า', nameEn: 'Warehouse',
    description: 'รับ-จ่าย ปรับสต๊อก และรับของ',
    capabilityPackKeys: ['pack.inventory.view', 'pack.inventory.operate', 'pack.inventory.adjust', 'pack.procurement.view', 'pack.procurement.request', 'pack.expense.self', 'pack.reimbursement.self', TASKS],
  },
  {
    key: 'tpl.trading.finance', industryTag: 'trading',
    nameTh: 'การเงิน/บัญชีเจ้าหนี้', nameEn: 'Finance / AP',
    description: 'ออกบิล รับ/จ่ายเงิน จัดการเจ้าหนี้ และเตรียมภาษี',
    capabilityPackKeys: FINANCE_PACKS,
  },

  // ---- Service ----
  {
    key: 'tpl.service.front_desk', industryTag: 'service',
    nameTh: 'หน้าร้าน/ต้อนรับ', nameEn: 'Front desk',
    description: 'รับลูกค้า ออกเอกสาร และรับชำระเงิน',
    capabilityPackKeys: ['pack.crm.view', 'pack.crm.operate', 'pack.billing.view', 'pack.billing.operate', 'pack.payment.view', 'pack.payment.record', 'pack.reimbursement.self', TASKS],
  },
  {
    key: 'tpl.service.sales', industryTag: 'service',
    nameTh: 'ฝ่ายขาย/ดูแลลูกค้า', nameEn: 'Sales / CRM',
    description: 'ดูแลลูกค้าและทำใบเสนอราคา',
    capabilityPackKeys: ['pack.crm.view', 'pack.crm.operate', 'pack.quotation.operate', 'pack.billing.view', 'pack.expense.self', 'pack.reimbursement.self', TASKS],
  },
  {
    key: 'tpl.service.finance', industryTag: 'service',
    nameTh: 'การเงิน', nameEn: 'Finance',
    description: 'ออกบิล รับ/จ่ายเงิน และเตรียมภาษี',
    capabilityPackKeys: FINANCE_PACKS,
  },
  {
    key: 'tpl.service.manager', industryTag: 'service',
    nameTh: 'ผู้จัดการ', nameEn: 'Manager',
    description: 'ดูแลทีมและอนุมัติงาน',
    capabilityPackKeys: MANAGER_PACKS,
  },

  // ---- E-commerce ----
  {
    key: 'tpl.ecom.order_ops', industryTag: 'ecommerce',
    nameTh: 'จัดการออเดอร์', nameEn: 'Order operations',
    description: 'รับออเดอร์ ออกเอกสาร รับชำระเงิน และดูสต๊อก',
    capabilityPackKeys: ['pack.crm.view', 'pack.crm.operate', 'pack.billing.view', 'pack.billing.operate', 'pack.billing.issue', 'pack.payment.view', 'pack.payment.record', 'pack.inventory.view', TASKS],
  },
  {
    key: 'tpl.ecom.fulfillment', industryTag: 'ecommerce',
    nameTh: 'แพ็ก/ส่งของ', nameEn: 'Fulfillment',
    description: 'จัดการสต๊อก ปรับยอด และรับของ',
    capabilityPackKeys: ['pack.inventory.view', 'pack.inventory.operate', 'pack.inventory.adjust', 'pack.procurement.view', 'pack.procurement.request', 'pack.expense.self', TASKS],
  },
  {
    key: 'tpl.ecom.finance', industryTag: 'ecommerce',
    nameTh: 'การเงิน', nameEn: 'Finance',
    description: 'ออกบิล รับ/จ่ายเงิน และเตรียมภาษี',
    capabilityPackKeys: FINANCE_PACKS,
  },
  {
    key: 'tpl.ecom.marketing', industryTag: 'ecommerce',
    nameTh: 'การตลาดออนไลน์', nameEn: 'Online marketing',
    description: 'ดูลูกค้าและปรับแดชบอร์ดการตลาด',
    capabilityPackKeys: ['pack.crm.view', 'pack.dashboard.manage', TASKS],
  },
];

export const ROLE_TEMPLATES: RoleTemplate[] = RAW_TEMPLATES.map((t) => ({ ...t, isSystem: true }));
export const ROLE_TEMPLATE_BY_KEY = new Map(ROLE_TEMPLATES.map((t) => [t.key, t]));
