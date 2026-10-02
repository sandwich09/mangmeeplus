// Item 10C+ Phase 1: Capability Pack catalog.
// Curated, plain-language bundles over the canonical permission keys in permission-registry.ts.
// Packs are an AUTHOR-TIME layer only: they compile to the same permissionKeys a role already stores,
// so the runtime authorization path is unchanged. featureEntitlementKey values map to the real
// APPROVED_FEATURE_KEYS used by item 10A (system-partner-management/domain/feature-registry.ts).
import type { CapabilityPack, RiskLevel } from '@watchdog-bms/contracts';
import { PERMISSIONS, REIMBURSEMENT_SELF_SERVICE_PERMISSIONS } from '../../../auth/permission-registry';

type RawPack = Omit<CapabilityPack, 'riskLevel' | 'isCore'> & { isCore?: boolean };

const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const RISK_BY_KEY = new Map<string, RiskLevel>(PERMISSIONS.map((p) => [p.key, p.riskLevel]));

function maxRisk(keys: string[]): RiskLevel {
  let top: RiskLevel = 'LOW';
  for (const k of keys) {
    const r = RISK_BY_KEY.get(k) ?? 'LOW';
    if (RISK_RANK[r] > RISK_RANK[top]) top = r;
  }
  return top;
}

const RAW_PACKS: RawPack[] = [
  // ---- Foundation ----
  {
    key: 'pack.core.basics', module: 'foundation', isCore: true,
    nameTh: 'พื้นฐาน (ทุกคน)', nameEn: 'Core basics',
    description: 'บัญชีผู้ใช้ แจ้งเตือน แดชบอร์ด และผู้ช่วย AI พื้นฐาน — ทุกคนได้รับอัตโนมัติ',
    permissionKeys: [
      'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink',
      'notification.read', 'notification.preference.manage', 'dashboard.read', 'attachment.read',
      'company.branch.read', 'ai.tool.invoke', 'line.ai.query', 'accounting.document.read_related',
      'expense.read_related', 'reimbursement.read_related',
      'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
      'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    ],
  },
  {
    key: 'pack.workflow.tasks', module: 'foundation', featureEntitlementKey: 'workflow_automation',
    nameTh: 'งานที่ได้รับมอบหมาย', nameEn: 'My tasks',
    description: 'รับและทำงาน/เควสต์ที่ระบบมอบหมายให้',
    permissionKeys: ['workflow.task.read', 'workflow.task.work'],
  },

  // ---- Company setup & administration ----
  // The two foundation packs below intentionally carry NO featureEntitlementKey. The
  // `company_settings` / `employee_access` toggles are enforced by the submenu rules in
  // feature-gate.logic.ts, which name the exact permissions each menu needs and are checked
  // before pack membership. Tagging the packs instead would gate everything else they carry —
  // attachment.create/delete (every upload in the product), company.setup.manage (which guards
  // the ตั้งค่าใบรับรองแทนใบเสร็จ menu under Expenses), document.sequence.*, outbox.event.read —
  // none of which belong to สาขา or ความปลอดภัยบัญชี.
  {
    key: 'pack.company.settings.view', module: 'company',
    nameTh: 'ดูตั้งค่าบริษัท', nameEn: 'View company setup',
    description: 'ดูข้อมูลบริษัท สาขา และเลขที่เอกสาร',
    permissionKeys: ['company.setup.read', 'company.branch.read', 'document.sequence.read'],
  },
  {
    key: 'pack.company.settings.manage', module: 'company',
    nameTh: 'จัดการตั้งค่าบริษัท', nameEn: 'Manage company setup',
    description: 'แก้ข้อมูลบริษัท สาขา เลขที่เอกสาร และไฟล์แนบ',
    permissionKeys: ['company.setup.manage', 'company.branch.manage', 'document.sequence.manage', 'attachment.create', 'attachment.delete', 'outbox.event.read'],
  },
  {
    key: 'pack.company.plan.manage', module: 'company',
    nameTh: 'จัดการแพ็กเกจและการชำระเงิน', nameEn: 'Manage company package and billing',
    description: 'เลือกหรือเปลี่ยนแพ็กเกจ ซื้อบริการ และดูหรือชำระเงินของบริษัท',
    permissionKeys: ['company.plan.manage'],
  },
  // Deliberately NO featureEntitlementKey, both of them. A company that never bought `thai_tax`
  // still has one legal name, one tax id and one VAT status — those are facts about the company,
  // not features of the tax workspace, and the Step 0 wizard has to run for every tenant
  // (spec §14). No PREFIX_FEATURE_RULES entry starts with `company.`, so an ungated pack is what
  // keeps these keys alive when the tax entitlement is off.
  {
    key: 'pack.company.legal_identity.manage', module: 'company',
    nameTh: 'จัดการตัวตนภาษีบริษัท', nameEn: 'Manage company tax identity',
    description: 'ดูและแก้เลขผู้เสียภาษี ชื่อจดทะเบียน และที่อยู่จดทะเบียนของบริษัท',
    // Read ships with manage on purpose: this is one editing screen, and an editor who cannot
    // read the current value can only overwrite it blind.
    permissionKeys: ['company.legal_identity.read', 'company.legal_identity.manage'],
  },
  {
    key: 'pack.company.vat_registration.manage', module: 'company',
    nameTh: 'ตอบสถานะจด VAT', nameEn: 'Answer VAT registration',
    description: 'ดูและตอบสถานะการจดทะเบียนภาษีมูลค่าเพิ่มพร้อมวันที่มีผล',
    permissionKeys: ['company.vat_registration.read', 'company.vat_registration.manage'],
  },
  {
    key: 'pack.people.view', module: 'people',
    nameTh: 'ดูพนักงานและสิทธิ์', nameEn: 'View people & roles',
    description: 'ดูรายชื่อพนักงาน บทบาท และภาพรวมสิทธิ์',
    permissionKeys: [
      'access.employee.read', 'access.role.read', 'access.permission.read',
      'access.capability_pack.read', 'access.role_template.read', 'access.effective.read',
    ],
  },
  {
    key: 'pack.people.manage', module: 'people',
    nameTh: 'จัดการพนักงานและสิทธิ์', nameEn: 'Manage people & roles',
    description: 'สร้าง/ปิดพนักงาน ออกรหัสผ่าน ผูก LINE และจัดการบทบาท/ชุดสิทธิ์',
    permissionKeys: [
      'access.employee.create', 'access.employee.update', 'access.employee.disable',
      'access.employee.credential.issue', 'access.employee.line_link.issue', 'access.employee.line_link.revoke',
      'access.role.manage', 'access.role_template.manage',
    ],
  },
  {
    key: 'pack.audit.read', module: 'company',
    nameTh: 'ดูบันทึกการใช้งาน (audit)', nameEn: 'Read audit log',
    description: 'ดูประวัติการกระทำที่ตรวจสอบได้ของบริษัท',
    permissionKeys: ['audit.log.read', 'workflow.audit.read'],
  },
  {
    key: 'pack.dashboard.manage', module: 'company', featureEntitlementKey: 'dashboard_notifications',
    nameTh: 'ปรับแต่งแดชบอร์ด', nameEn: 'Configure dashboard',
    description: 'ปรับแต่งวิดเจ็ตและสร้างสแนปช็อตแดชบอร์ด',
    permissionKeys: ['dashboard.configure', 'dashboard.snapshot.generate'],
  },
  {
    key: 'pack.notification.admin', module: 'company', featureEntitlementKey: 'dashboard_notifications',
    nameTh: 'จัดการแจ้งเตือน (แอดมิน)', nameEn: 'Notification admin',
    description: 'ตั้งกฎแจ้งเตือน และดู/ส่งซ้ำการส่งแจ้งเตือน',
    permissionKeys: ['notification.rule.manage', 'notification.delivery.read', 'notification.delivery.retry'],
  },
  {
    key: 'pack.workflow.view', module: 'company', featureEntitlementKey: 'workflow_automation',
    nameTh: 'ดูออโตเมชัน', nameEn: 'View automation',
    description: 'ดูเทมเพลต กฎ การรัน และ dead letter ของออโตเมชัน',
    permissionKeys: ['workflow.template.read', 'workflow.rule.read', 'workflow.run.read', 'workflow.dead_letter.read', 'workflow.audit.read'],
  },
  {
    key: 'pack.workflow.manage', module: 'company', featureEntitlementKey: 'workflow_automation',
    nameTh: 'จัดการออโตเมชัน', nameEn: 'Manage automation',
    description: 'สร้าง/เปิดกฎ รันซ้ำ และจัดการ webhook ของออโตเมชัน',
    permissionKeys: ['workflow.rule.manage', 'workflow.rule.enable', 'workflow.run.replay', 'workflow.dead_letter.replay', 'workflow.webhook.manage'],
  },

  // ---- Products & inventory ----
  {
    key: 'pack.inventory.view', module: 'inventory', featureEntitlementKey: 'inventory',
    nameTh: 'ดูสินค้าและสต๊อก', nameEn: 'View products & stock',
    description: 'ดูสินค้า คลัง ความเคลื่อนไหวสต๊อก และรายงาน',
    permissionKeys: ['inventory.product.read', 'inventory.location.read', 'inventory.movement.read', 'inventory.report.read'],
  },
  {
    key: 'pack.inventory.operate', module: 'inventory', featureEntitlementKey: 'inventory',
    nameTh: 'รับ-จ่ายสต๊อก', nameEn: 'Operate stock',
    description: 'จัดการสินค้า/คลัง รับ-จ่ายสต๊อก และพิมพ์ป้าย QR',
    permissionKeys: ['inventory.product.manage', 'inventory.location.manage', 'inventory.movement.create', 'inventory.label.manage'],
  },
  {
    key: 'pack.inventory.adjust', module: 'inventory', featureEntitlementKey: 'inventory',
    nameTh: 'ปรับ/นับสต๊อก', nameEn: 'Adjust & count stock',
    description: 'ปรับยอดสต๊อกและบันทึกผลการนับ (กระทบยอดสินค้า)',
    permissionKeys: ['inventory.movement.adjust', 'inventory.stock_count.create'],
  },

  // ---- Sales & customers (CRM) ----
  {
    key: 'pack.crm.view', module: 'sales', featureEntitlementKey: 'crm',
    nameTh: 'ดูลูกค้าและไปป์ไลน์', nameEn: 'View customers & pipeline',
    description: 'ดูลูกค้า ผู้ติดต่อ ลีด โอกาสขาย กิจกรรม และงานติดตาม',
    permissionKeys: [
      'crm.customer.read', 'crm.contact.read', 'crm.lead.read', 'crm.opportunity.read',
      'crm.activity.read', 'crm.follow_up.read', 'crm.report.read', 'crm.ai.read',
    ],
  },
  {
    key: 'pack.crm.operate', module: 'sales', featureEntitlementKey: 'crm',
    nameTh: 'ทำงานขายรายวัน', nameEn: 'Work sales daily',
    description: 'สร้าง/แก้ลูกค้า ลีด โอกาสขาย เลื่อนสเตจ ปิดการขาย และงานติดตาม',
    permissionKeys: [
      'crm.customer.create', 'crm.customer.update', 'crm.contact.manage',
      'crm.lead.create', 'crm.lead.update', 'crm.lead.convert', 'crm.lead.disqualify',
      'crm.opportunity.create', 'crm.opportunity.update', 'crm.opportunity.stage_move', 'crm.opportunity.close',
      'crm.activity.create', 'crm.follow_up.create', 'crm.follow_up.update', 'crm.follow_up.complete', 'crm.quotation.link',
    ],
  },
  {
    key: 'pack.crm.manage', module: 'sales', featureEntitlementKey: 'crm',
    nameTh: 'จัดการลูกค้า/ไปป์ไลน์', nameEn: 'Manage customers & pipeline',
    description: 'มอบหมายเจ้าของ จัดเก็บ ส่งออกลูกค้า เปิดโอกาสขายที่ปิดแล้ว และตั้งค่าไปป์ไลน์',
    permissionKeys: ['crm.customer.archive', 'crm.customer.assign', 'crm.customer.export', 'crm.lead.assign', 'crm.opportunity.reopen', 'crm.pipeline.configure'],
  },

  // ---- Quotations & selling documents ----
  {
    key: 'pack.quotation.operate', module: 'sales', featureEntitlementKey: 'sales_documents',
    nameTh: 'ทำใบเสนอราคา', nameEn: 'Work quotations',
    description: 'สร้าง/แก้/ส่งอนุมัติ/ออกใบเสนอราคา',
    permissionKeys: ['accounting.counterparty.read', 'accounting.quotation.read', 'accounting.quotation.create', 'accounting.quotation.update', 'accounting.quotation.submit_approval', 'accounting.quotation.issue'],
  },
  {
    key: 'pack.quotation.approve', module: 'sales', featureEntitlementKey: 'sales_documents',
    nameTh: 'อนุมัติใบเสนอราคา', nameEn: 'Approve quotations',
    description: 'อนุมัติ/ปฏิเสธ และยกเลิกใบเสนอราคา',
    permissionKeys: ['accounting.quotation.read', 'accounting.quotation.approve', 'accounting.quotation.void'],
  },

  // ---- Billing & documents ----
  {
    key: 'pack.billing.view', module: 'billing', featureEntitlementKey: 'sales_documents',
    nameTh: 'ดูบิล/ใบเสร็จ/ใบกำกับ', nameEn: 'View billing docs',
    description: 'ดูเอกสารขาย ใบแจ้งหนี้ ใบเสร็จ ใบวางบิล ใบลดหนี้/เพิ่มหนี้ และใบกำกับภาษี',
    permissionKeys: [
      'accounting.counterparty.read', 'accounting.document.read', 'accounting.invoice.read', 'accounting.receipt.read',
      'accounting.billing_note.read', 'accounting.credit_note.read', 'accounting.debit_note.read', 'accounting.tax_invoice.read',
    ],
  },
  {
    key: 'pack.billing.operate', module: 'billing', featureEntitlementKey: 'sales_documents',
    nameTh: 'ออกร่างเอกสารขาย', nameEn: 'Draft billing docs',
    description: 'สร้าง/แก้ร่างเอกสารขาย ใบแจ้งหนี้ ใบเสร็จ ใบวางบิล ใบลดหนี้/เพิ่มหนี้',
    permissionKeys: [
      'accounting.counterparty.manage', 'accounting.document.create', 'accounting.document.update',
      'accounting.invoice.create', 'accounting.invoice.update', 'accounting.receipt.create', 'accounting.receipt.update',
      'accounting.billing_note.create', 'accounting.billing_note.update', 'accounting.credit_note.create', 'accounting.debit_note.create',
    ],
  },
  {
    key: 'pack.billing.issue', module: 'billing', featureEntitlementKey: 'sales_documents',
    nameTh: 'ออกจริง/ยกเลิกเอกสาร', nameEn: 'Issue & void billing docs',
    description: 'ออกจริงและยกเลิกเอกสารขาย/ใบแจ้งหนี้/ใบเสร็จ/ใบวางบิล/ใบลดหนี้-เพิ่มหนี้ และส่งออก',
    permissionKeys: [
      'accounting.document.issue', 'accounting.document.void', 'accounting.document.export',
      'accounting.invoice.issue', 'accounting.invoice.void', 'accounting.receipt.issue', 'accounting.receipt.void',
      'accounting.billing_note.issue', 'accounting.billing_note.void',
      'accounting.credit_note.issue', 'accounting.credit_note.void', 'accounting.debit_note.issue', 'accounting.debit_note.void',
    ],
  },
  {
    key: 'pack.tax_invoice.issue', module: 'billing', featureEntitlementKey: 'sales_documents',
    nameTh: 'ออก/ยกเลิกใบกำกับภาษี', nameEn: 'Issue & void tax invoices',
    description: 'ออกและยกเลิกใบกำกับภาษี และเพิ่มหลักฐานผู้ซื้อของใบที่ออกแล้ว (ความเสี่ยงสูง แยกออกจากงานออกบิลทั่วไป)',
    // The buyer-evidence key belongs HERE and not in pack.billing.issue: presets such as
    // tpl.retail.cashier and tpl.ecom.order_ops hold pack.billing.issue by design precisely so
    // they never touch tax invoices, and evidence remediation is a tax-invoice authority.
    permissionKeys: ['accounting.tax_invoice.issue', 'accounting.tax_invoice.void', 'accounting.tax_document_buyer_evidence.manage'],
  },
  {
    key: 'pack.payment.view', module: 'billing', featureEntitlementKey: 'sales_documents',
    nameTh: 'ดูการรับชำระ', nameEn: 'View payments',
    description: 'ดูรายการรับชำระเงิน',
    permissionKeys: ['accounting.payment.read'],
  },
  {
    key: 'pack.payment.record', module: 'billing', featureEntitlementKey: 'sales_documents',
    nameTh: 'รับชำระเงิน', nameEn: 'Record payments',
    description: 'บันทึกและแก้ไขการรับชำระเงิน',
    permissionKeys: ['accounting.payment.create', 'accounting.payment.update'],
  },
  {
    key: 'pack.payment.void', module: 'billing', featureEntitlementKey: 'sales_documents',
    nameTh: 'ยกเลิกการรับชำระ', nameEn: 'Void payments',
    description: 'ยกเลิกรายการรับชำระเงิน (ความเสี่ยงวิกฤติ)',
    permissionKeys: ['accounting.payment.void'],
  },

  // ---- Expenses ----
  {
    key: 'pack.expense.view', module: 'expense', featureEntitlementKey: 'expenses',
    nameTh: 'ดูค่าใช้จ่าย', nameEn: 'View expenses',
    description: 'ดูและส่งออกค่าใช้จ่ายทั้งบริษัท (อ่านอย่างเดียว)',
    // expense.read_own rides along: the expense screens gate on it as the entry permission.
    permissionKeys: ['expense.read', 'expense.evidence.read', 'expense.read_own', 'expense.export'],
  },
  {
    key: 'pack.expense.self', module: 'expense', featureEntitlementKey: 'expenses',
    nameTh: 'บันทึกค่าใช้จ่ายของฉัน', nameEn: 'Capture own expenses',
    description: 'สร้างและอัปโหลดใบเสร็จค่าใช้จ่ายของตัวเอง',
    permissionKeys: ['expense.read_own', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.update', 'expense.ocr.request', 'expense.signature.self_manage', 'attachment.create'],
  },
  {
    key: 'pack.expense.review', module: 'expense', featureEntitlementKey: 'expenses',
    nameTh: 'ตรวจค่าใช้จ่าย', nameEn: 'Review expenses',
    description: 'ดู/ตรวจค่าใช้จ่ายทั้งบริษัท ตรวจ AI จัดหมวด และแก้รายการซ้ำ',
    // `accounting.counterparty.read` (vendor-address CON-2): the reviewer is who sees the
    // "เพิ่ม [ร้าน] ลงทะเบียนคู่ค้าแล้ว · ดู" toast, so they must be able to open what it points at.
    // Read only — changing a primary address by hand still needs `accounting.counterparty.manage`,
    // or having added that counterparty (owner 2026-09-25).
    permissionKeys: ['expense.read', 'expense.evidence.read', 'expense.read_own', 'expense.review', 'expense.ai.verify', 'expense.category.manage', 'expense.duplicate.resolve', 'attachment.create', 'accounting.counterparty.read'],
  },
  {
    key: 'pack.expense.finance', module: 'expense', featureEntitlementKey: 'expenses',
    nameTh: 'อนุมัติ/จ่ายค่าใช้จ่าย', nameEn: 'Confirm & pay expenses',
    description: 'ยืนยัน/ปฏิเสธ/ยกเลิก บันทึกการจ่าย และส่งออกค่าใช้จ่าย',
    permissionKeys: ['expense.confirm', 'expense.reject', 'expense.void', 'expense.delete', 'expense.payment.record', 'expense.export'],
  },

  // ---- Reimbursement (no dedicated feature entitlement key in 10A) ----
  {
    key: 'pack.reimbursement.self', module: 'reimbursement', isCore: true,
    nameTh: 'ขอเบิกของฉัน (ทุกคน)', nameEn: 'Request own reimbursement (everyone)',
    description: 'ทุกบทบาทได้รับอัตโนมัติ: สร้าง แนบใบเสร็จ แก้ ส่ง และยกเลิกคำขอของตัวเอง เมื่อบริษัทเปิดการเบิกจ่าย',
    permissionKeys: REIMBURSEMENT_SELF_SERVICE_PERMISSIONS,
  },
  {
    key: 'pack.reimbursement.approve', module: 'reimbursement',
    nameTh: 'อนุมัติการเบิก', nameEn: 'Approve reimbursement',
    // The role page prints this under the choice, so it names everything the choice gives: paying and
    // taking a payment back too, which "อนุมัติ" alone does not say.
    description: 'ดู อนุมัติ และปฏิเสธคำขอเบิก รวมทั้งบันทึกจ่ายเงินคืนและยกเลิกการจ่าย',
    // Owner decision 2026-09-19 (D1/A2, supersedes team decision 2026-07-28 "paying stays
    // FINANCE-only"): an approver can record payment directly, so a custom role built from this
    // pack gets the same payment.record/payment.void the ADMIN/MANAGER system roles now hold.
    permissionKeys: [
      'reimbursement.read', 'reimbursement.read_own', 'reimbursement.approve', 'reimbursement.reject',
      'reimbursement.payment.record', 'reimbursement.payment.void',
    ],
  },
  {
    key: 'pack.reimbursement.review', module: 'reimbursement',
    nameTh: 'ตรวจสอบการเบิก', nameEn: 'Review reimbursement',
    // The finance-review right also reaches other people's claims: preparing, editing, sending and cancelling one for its requester.
    description: 'ดูและส่งออกคำขอเบิก ตรวจการเงิน และสร้าง แก้ ส่ง หรือยกเลิกคำขอแทนผู้เบิก แต่บันทึกจ่ายและยกเลิกการจ่ายไม่ได้',
    permissionKeys: ['reimbursement.read', 'reimbursement.read_own', 'reimbursement.read_related', 'reimbursement.finance_review', 'reimbursement.export'],
  },
  {
    key: 'pack.reimbursement.finance', module: 'reimbursement',
    nameTh: 'ตรวจ/จ่ายการเบิก', nameEn: 'Finance review & pay',
    description: 'ดูและส่งออกคำขอเบิก ตรวจการเงิน บันทึกจ่าย ยกเลิกการจ่าย ปลดรายการซ้ำ และสร้าง แก้ ส่ง หรือยกเลิกคำขอแทนผู้เบิก',
    permissionKeys: ['reimbursement.read', 'reimbursement.read_own', 'reimbursement.finance_review', 'reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.duplicate.resolve', 'reimbursement.export'],
  },
  {
    key: 'pack.reimbursement.policy', module: 'reimbursement',
    nameTh: 'ตั้งนโยบายการเบิก', nameEn: 'Manage reimbursement policy',
    description: 'ดูและตั้งนโยบายการเบิกจ่าย',
    permissionKeys: ['reimbursement.policy.read', 'reimbursement.policy.manage'],
  },

  // ---- Procurement & accounts payable ----
  {
    key: 'pack.procurement.view', module: 'procurement', featureEntitlementKey: 'procurement',
    nameTh: 'ดูจัดซื้อ/เจ้าหนี้', nameEn: 'View procurement & AP',
    description: 'ดูผู้ขาย ใบขอซื้อ ใบสั่งซื้อ การรับของ ใบวางบิลผู้ขาย การจ่าย และรายงานเจ้าหนี้',
    permissionKeys: ['procurement.supplier.read', 'procurement.purchase_request.read', 'procurement.purchase_order.read', 'procurement.goods_receipt.read', 'procurement.vendor_bill.read', 'procurement.supplier_payment.read', 'procurement.ap.report'],
  },
  {
    key: 'pack.procurement.request', module: 'procurement', featureEntitlementKey: 'procurement',
    nameTh: 'ขอซื้อ/รับของ', nameEn: 'Request purchases & receive',
    description: 'สร้างใบขอซื้อ ใบสั่งซื้อ และบันทึกการรับของ',
    permissionKeys: ['procurement.purchase_request.create', 'procurement.purchase_order.create', 'procurement.goods_receipt.create'],
  },
  {
    // GAP-06 (2026-07-29): vendor-bill approval removed — the system MANAGER role (which the
    // manager presets mirror) does not approve vendor bills; that stays FINANCE/OWNER-side.
    key: 'pack.procurement.approve', module: 'procurement', featureEntitlementKey: 'procurement',
    nameTh: 'อนุมัติจัดซื้อ', nameEn: 'Approve procurement',
    description: 'อนุมัติใบขอซื้อ/ใบสั่งซื้อ และออกใบสั่งซื้อ',
    permissionKeys: ['procurement.purchase_request.approve', 'procurement.purchase_order.approve', 'procurement.purchase_order.issue'],
  },
  {
    // GAP-06 (2026-07-29): goods-receipt post/void moved to pack.procurement.goods_receipt_post —
    // among system roles only OWNER holds them, so ap_manage (used by the finance presets) must not.
    key: 'pack.procurement.ap_manage', module: 'procurement', featureEntitlementKey: 'procurement',
    nameTh: 'จัดการเจ้าหนี้/จ่ายเงิน', nameEn: 'Manage AP & pay suppliers',
    description: 'จัดการผู้ขาย ออก/อนุมัติ/ยกเลิกใบวางบิล และจ่ายเงินผู้ขาย',
    permissionKeys: [
      'procurement.supplier.manage', 'procurement.purchase_order.manage',
      // GAP-06.7 (2026-07-29): the finance presets mirror system FINANCE, which approves
      // vendor bills. The per-user self-approval guard still applies — a submitter can
      // never approve their own bill, and FINANCE is not in SELF_APPROVAL_EXEMPT_ROLES.
      'procurement.vendor_bill.create', 'procurement.vendor_bill.direct_entry', 'procurement.vendor_bill.approve', 'procurement.vendor_bill.void', 'procurement.vendor_bill.match',
      'procurement.supplier_payment.create', 'procurement.supplier_payment.release', 'procurement.supplier_payment.void',
    ],
  },
  {
    // GAP-06 (2026-07-29): owner-only capability. No preset references this pack — it exists so the
    // owner can deliberately delegate goods-receipt posting/voiding through a custom role.
    key: 'pack.procurement.goods_receipt_post', module: 'procurement', featureEntitlementKey: 'procurement',
    nameTh: 'ลงบัญชี/ยกเลิกรับของ', nameEn: 'Post & void goods receipts',
    description: 'ลงบัญชีรับของ (สร้างความเคลื่อนไหวสต๊อก) และยกเลิกรับของที่ลงบัญชีแล้ว (ความเสี่ยงวิกฤติ)',
    permissionKeys: ['procurement.goods_receipt.post', 'procurement.goods_receipt.void'],
  },
  {
    key: 'pack.procurement.supplier_bank', module: 'procurement', featureEntitlementKey: 'procurement',
    nameTh: 'ดู/แก้บัญชีธนาคารผู้ขาย', nameEn: 'Supplier bank details',
    description: 'ดูและแก้ไขบัญชีธนาคารของผู้ขาย และข้ามเกณฑ์การจับคู่ (ข้อมูลอ่อนไหว)',
    permissionKeys: ['procurement.supplier.bank.read', 'procurement.supplier.bank.manage', 'procurement.vendor_bill.match.override'],
  },

  // ---- Banking & reconciliation ----
  {
    key: 'pack.cash.view', module: 'banking', featureEntitlementKey: 'bank_reconciliation',
    nameTh: 'ดูยอดเงินสด', nameEn: 'View cash position',
    description: 'ดูสรุปยอดเงินสด/เงินฝาก',
    permissionKeys: ['bank.cash.read'],
  },
  {
    key: 'pack.bank.view', module: 'banking', featureEntitlementKey: 'bank_reconciliation',
    nameTh: 'ดูธนาคาร/กระทบยอด', nameEn: 'View banking',
    description: 'ดูบัญชีธนาคาร รายการเดินบัญชี การจับคู่ การปรับปรุง และการกระทบยอด',
    permissionKeys: ['bank.account.read', 'bank.statement.read', 'bank.match.read', 'bank.adjustment.read', 'bank.reconciliation.read', 'bank.cash.read'],
  },
  {
    key: 'pack.bank.operate', module: 'banking', featureEntitlementKey: 'bank_reconciliation',
    nameTh: 'นำเข้า/จับคู่รายการ', nameEn: 'Import & match',
    description: 'จัดการบัญชี นำเข้ารายการเดินบัญชี จับคู่ และเริ่มการกระทบยอด',
    permissionKeys: ['bank.account.manage', 'bank.statement.import', 'bank.statement.manual_line', 'bank.match.suggest', 'bank.match.confirm', 'bank.match.unmatch', 'bank.adjustment.create', 'bank.reconciliation.create'],
  },
  {
    key: 'pack.bank.reconcile_manage', module: 'banking', featureEntitlementKey: 'bank_reconciliation',
    nameTh: 'ปิด/เปิดกระทบยอด', nameEn: 'Complete & reopen reconciliation',
    description: 'ปิด/เปิดการกระทบยอด อนุมัติการปรับปรุง ข้ามเกณฑ์จับคู่ และส่งออกหลักฐาน',
    permissionKeys: ['bank.statement.void', 'bank.match.override', 'bank.adjustment.approve', 'bank.adjustment.void', 'bank.reconciliation.complete', 'bank.reconciliation.reopen', 'bank.reconciliation.export'],
  },
  {
    key: 'pack.bank.sensitive', module: 'banking', featureEntitlementKey: 'bank_reconciliation',
    nameTh: 'ดูข้อมูลบัญชีเชิงลึก', nameEn: 'Read sensitive bank fields',
    description: 'ดูข้อมูลบัญชีธนาคารที่อ่อนไหว (เลขบัญชีเต็ม ฯลฯ)',
    permissionKeys: ['bank.account.sensitive_read'],
  },

  // ---- Accounting core (ledger) ----
  {
    key: 'pack.ledger.view', module: 'accounting', featureEntitlementKey: 'double_entry_ledger',
    nameTh: 'ดูบัญชีแยกประเภท/งบ', nameEn: 'View GL & reports',
    description: 'ดูผังบัญชี สมุดรายวัน กฎการลงบัญชี งบการเงิน และงวดบัญชี',
    permissionKeys: ['ledger.account.read', 'ledger.journal.read', 'ledger.posting-rule.read', 'ledger.report.read', 'ledger.period.read', 'ledger.export'],
  },
  {
    key: 'pack.ledger.operate', module: 'accounting', featureEntitlementKey: 'double_entry_ledger',
    nameTh: 'ลงรายการบัญชีร่าง', nameEn: 'Draft journal entries',
    description: 'สร้างสมุดรายวันแบบร่าง',
    permissionKeys: ['journal.entry.create'],
  },
  {
    key: 'pack.ledger.manage', module: 'accounting', featureEntitlementKey: 'double_entry_ledger',
    nameTh: 'ปิดงวด/ผังบัญชี', nameEn: 'Post, close & manage ledger',
    description: 'จัดการผังบัญชี ผ่านรายการ กลับรายการ กฎการลงบัญชี และปิด/เปิดงวด',
    permissionKeys: ['ledger.account.manage', 'journal.entry.post', 'journal.entry.reverse', 'ledger.posting-rule.manage', 'ledger.period.close', 'ledger.period.unclose'],
  },

  // ---- Tax ----
  {
    key: 'pack.wht.pnd53', module: 'tax', featureEntitlementKey: 'wht_pnd53',
    nameTh: 'จัดทำ ภ.ง.ด.53', nameEn: 'Prepare PND53',
    description: 'ดูงวดและรายการ ภ.ง.ด.53 คำนวณรายงาน และส่งออกเอกสารเฉพาะแบบนี้',
    permissionKeys: ['wht.pnd53.read', 'wht.pnd53.prepare'],
  },
  {
    key: 'pack.tax.view', module: 'tax', featureEntitlementKey: 'thai_tax',
    nameTh: 'ดูภาษี/รายงาน', nameEn: 'View tax & reports',
    description: 'ดูโปรไฟล์ภาษี งวด รายงาน หนังสือรับรองหัก ณ ที่จ่าย และประเด็นตรวจ',
    permissionKeys: ['tax.profile.read', 'tax.config.read', 'tax.period.read', 'tax.event.read', 'tax.report.read', 'tax.certificate.read', 'tax.review_issue.read'],
  },
  {
    key: 'pack.tax.prepare', module: 'tax', featureEntitlementKey: 'thai_tax',
    nameTh: 'เตรียม/ยื่นภาษี', nameEn: 'Prepare & file tax',
    description: 'ซิงก์เหตุการณ์ภาษี คำนวณ/ส่งออกรายงาน ทำเครื่องหมายยื่น/จ่าย ออก 50 ทวิ และปรับปรุง',
    permissionKeys: ['tax.event.sync', 'tax.report.recompute', 'tax.report.export', 'tax.filing.mark_filed', 'tax.filing.mark_paid', 'tax.certificate.issue', 'tax.certificate.void', 'tax.review_issue.resolve', 'tax.adjustment.create'],
  },
  {
    key: 'pack.tax.manage', module: 'tax', featureEntitlementKey: 'thai_tax',
    nameTh: 'ตั้งค่าภาษี/แก้งวด', nameEn: 'Manage tax config & periods',
    description: 'จัดการโปรไฟล์ภาษี ปฏิทิน/อัตรา และแก้ไข/เปิดงวดภาษี',
    permissionKeys: ['tax.profile.manage', 'tax.config.manage', 'tax.period.manage'],
  },
  {
    // Deliberately NO featureEntitlementKey. The 50 ทวิ external-handoff journey must work for a
    // company that never bought `thai_tax` (spec:301-302, plan:89) — a company still withholds tax
    // and still owes its payee a certificate. An ungated pack wins over a gated one in
    // filterPermissionsByEntitlement, and no PREFIX_FEATURE_RULES entry starts with `wht.`.
    key: 'pack.wht.certificate.manage', module: 'tax',
    nameTh: 'หนังสือรับรองหัก ณ ที่จ่าย (แนบภายนอก)', nameEn: 'WHT certificate handoff',
    description: 'ดูงานที่ต้องออก 50 ทวิ ภายนอก และแนบหนังสือรับรองที่ออกแล้วกลับเข้าระบบ',
    // Correction & replacement plan §2.1: owner confirmed 2026-09-23 this stays ungated — fixing/
    // reissuing a certificate the company already issued is an ongoing compliance obligation, not a
    // new commercial feature (unlike wht.certificate.issue's own dedicated ENTERPRISE-gated pack
    // below).
    permissionKeys: ['wht.certificate.read', 'wht.external_certificate.link', 'wht.certificate.correct'],
  },
  // WHT certificate system issuance plan §2.1: owner decision 2026-09-22 — the SYSTEM-issue button
  // (only) is ENTERPRISE-gated, unlike the ungated pack above. A NEW sibling pack rather than adding
  // `featureEntitlementKey` to `pack.tax.prepare`/reusing `tax.certificate.issue`: that permission's
  // use case requires a pre-existing TaxPeriod/TaxEventIds this button does not have (plan §2.2), and
  // adding the key to `pack.wht.certificate.manage` above would wrongly gate read/link too.
  {
    key: 'pack.wht.certificate.issue', module: 'tax', featureEntitlementKey: 'wht_50bis',
    nameTh: 'ออกหนังสือรับรองหัก ณ ที่จ่ายในระบบ', nameEn: 'System-issue WHT certificate',
    description: 'ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) เป็น PDF ในระบบทันทีที่ยืนยันจ่าย/ยืนยันเอกสาร',
    permissionKeys: ['wht.certificate.issue'],
  },
  // Pre-change paid full-Tax terms and immutable deal snapshots keep the issuance right they bought.
  {
    key: 'pack.wht.certificate.issue.legacy', module: 'tax', featureEntitlementKey: 'thai_tax',
    nameTh: 'ออก 50 ทวิจากสิทธิ์ภาษีเดิม', nameEn: 'Legacy Tax WHT issuance',
    description: 'คงสิทธิ์ออกหนังสือรับรองในระบบสำหรับร้านที่มีแพ็กภาษีเดิม',
    permissionKeys: ['wht.certificate.issue'],
  },
  // WHT certificate system issuance plan §2.1b (Decision B): the signature UPLOAD/management setting
  // is a separate, narrower permission than ISSUING a certificate — OWNER-only via omission from
  // every role's grant list (permission-registry.ts). Gated by `thai_tax` like the pack above: the
  // setting is meaningless without the WHT-certificate feature at all.
  {
    key: 'pack.company.tax_signature.manage', module: 'tax', featureEntitlementKey: 'wht_50bis',
    nameTh: 'จัดการลายเซ็นผู้จ่ายเงินสำหรับ 50 ทวิ', nameEn: 'Manage WHT certificate signature',
    description: 'อัปโหลด/จัดการรูปลายเซ็นผู้มีอำนาจลงนามที่จะประทับลงหนังสือรับรองหัก ณ ที่จ่ายที่ระบบออกให้',
    permissionKeys: ['company.tax_signature.manage'],
  },
  {
    key: 'pack.company.tax_signature.manage.legacy', module: 'tax', featureEntitlementKey: 'thai_tax',
    nameTh: 'ลายเซ็น 50 ทวิจากสิทธิ์ภาษีเดิม', nameEn: 'Legacy Tax WHT signature',
    description: 'คงสิทธิ์ลายเซ็นสำหรับร้านที่มีแพ็กภาษีเดิม',
    permissionKeys: ['company.tax_signature.manage'],
  },
];

export const CAPABILITY_PACKS: CapabilityPack[] = RAW_PACKS.map((p) => ({
  ...p,
  isCore: p.isCore ?? false,
  riskLevel: maxRisk(p.permissionKeys),
}));

export const CAPABILITY_PACK_BY_KEY = new Map(CAPABILITY_PACKS.map((p) => [p.key, p]));
export const CORE_PACK_KEYS = CAPABILITY_PACKS.filter((p) => p.isCore).map((p) => p.key);
