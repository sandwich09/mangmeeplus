export type SubFeatureDefinition = {
  key: string;
  labelTh: string;
  descriptionTh: string;
  route: string;
  permissionKeys: string[];
};

export type FeatureDefinition = {
  key: string;
  labelTh: string;
  descriptionTh: string;
  group: 'operate' | 'finance' | 'growth';
  /**
   * Feature-decoupling spec §6.1 (spec:244-263): `false` marks a PLATFORM baseline key that is
   * always on for an active company and is never a commercial toggle. 16 of the 18 top-level
   * keys are sellable; `employee_access` and `company_settings` are not.
   */
  sellable: boolean;
  submenus: SubFeatureDefinition[];
};

export const FEATURE_CATALOG: FeatureDefinition[] = [
  {
    key: 'inventory',
    labelTh: 'สินค้า/สต๊อก',
    descriptionTh: 'จัดการสินค้า คลัง การรับ-จ่าย ปรับนับ และรายงานสต๊อก',
    group: 'operate',
    sellable: true,
    submenus: [
      {
        key: 'inventory.locations',
        labelTh: 'สถานที่จัดเก็บ',
        descriptionTh: 'ดูและจัดการสถานที่จัดเก็บสินค้า',
        route: '/inventory/locations',
        permissionKeys: ['inventory.location.read', 'inventory.location.manage'],
      },
      {
        key: 'inventory.movements',
        labelTh: 'ความเคลื่อนไหว',
        descriptionTh: 'ดูประวัติความเคลื่อนไหวของสต็อก',
        route: '/inventory/movements',
        permissionKeys: ['inventory.movement.read'],
      },
      {
        key: 'inventory.stock_report',
        labelTh: 'รายงานสต็อก',
        descriptionTh: 'ดูยอดคงเหลือและสถานะสต็อก',
        route: '/inventory/reports/stock',
        permissionKeys: ['inventory.report.read'],
      },
    ],
  },
  {
    key: 'product_catalog',
    labelTh: 'สินค้าและบริการ',
    descriptionTh: 'จัดการสินค้าและบริการที่ใช้ในงานขาย',
    group: 'operate',
    sellable: true,
    submenus: [],
  },
  {
    key: 'sales_documents',
    labelTh: 'เอกสารขาย',
    descriptionTh: 'สร้างและติดตามใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ และการรับชำระ',
    group: 'operate',
    sellable: true,
    submenus: [],
  },
  {
    key: 'expenses',
    labelTh: 'ค่าใช้จ่าย+ใบเสร็จ',
    descriptionTh: 'บันทึกค่าใช้จ่าย ใบเสร็จ และหลักฐานทางบัญชี',
    group: 'finance',
    sellable: true,
    submenus: [
      {
        key: 'expenses.list',
        labelTh: 'รายการค่าใช้จ่าย',
        descriptionTh: 'ดูรายการค่าใช้จ่ายและใบเสร็จทั้งหมด',
        route: '/expenses',
        permissionKeys: ['expense.read', 'expense.read_related', 'expense.read_own'],
      },
      {
        key: 'expenses.upload',
        labelTh: 'อัปโหลดใบเสร็จ',
        descriptionTh: 'ส่งใบเสร็จให้ AI อ่านและสร้างรายการฉบับร่าง',
        route: '/expenses/upload',
        permissionKeys: ['expense.receipt.upload', 'expense.receipt.line_upload', 'expense.ocr.request'],
      },
      {
        key: 'expenses.manual',
        labelTh: 'บันทึกด้วยมือ',
        descriptionTh: 'กรอกรายละเอียดค่าใช้จ่ายและบันทึกเป็นฉบับร่าง',
        route: '/expenses/manual',
        permissionKeys: ['expense.create', 'expense.update'],
      },
      {
        key: 'expenses.categories',
        labelTh: 'หมวดหมู่',
        descriptionTh: 'จัดหมวดหมู่สำหรับรายการค่าใช้จ่าย',
        route: '/expenses/categories',
        permissionKeys: ['expense.category.manage'],
      },
      {
        key: 'expenses.evidence',
        labelTh: 'หลักฐานทางบัญชี',
        descriptionTh: 'ดูและส่งออกหลักฐานค่าใช้จ่ายสำหรับงานบัญชี',
        route: '/expenses/evidence',
        permissionKeys: ['expense.evidence.read', 'expense.export'],
      },
      // ใบรับรองแทนใบเสร็จ deliberately has NO submenu entitlement: it rides along with บิล/ใบเบิก,
      // so whoever can work an expense can work its substitute receipt. Its three gate permissions
      // (expense.review/confirm/read_own) all sit in packs keyed to the parent `expenses` feature,
      // which is what turns the whole thing off. Selling it separately was impossible anyway —
      // expense.read_own is owned by expenses.list, so the gate stayed satisfiable with the
      // sub-feature off, in the nav and on GET /companies/:companyId/substitute-receipts alike.
      {
        key: 'expenses.signatures',
        labelTh: 'ลายเซ็นของฉัน',
        descriptionTh: 'เก็บลายเซ็นประจำตัวไว้ใช้ลงนามเอกสารของบริษัท',
        route: '/expenses/signatures',
        // The self-service key is owned here. Review/confirm can also reach the screen through the
        // parent expense entitlement because those actors may need their own personal signature.
        // The legacy manage key is retained for compatible existing roles but has owner-only scope.
        permissionKeys: ['expense.signature.self_manage', 'expense.signature.manage'],
      },
    ],
  },
  {
    key: 'reimbursement',
    labelTh: 'การเบิกจ่าย',
    descriptionTh: 'จัดการคำขอเบิกจ่าย การอนุมัติ และการตรวจสอบโดยฝ่ายการเงิน',
    group: 'finance',
    sellable: true,
    submenus: [],
  },
  {
    key: 'double_entry_ledger',
    labelTh: 'บัญชีแยกประเภท',
    descriptionTh: 'จัดการผังบัญชี สมุดรายวัน งบการเงิน และรอบบัญชี',
    group: 'finance',
    sellable: true,
    submenus: [],
  },
  {
    // Background posting behaviour, not a menu — it has no route of its own. The Partner screen
    // still needs it listed, because APPROVED_FEATURE_KEYS derives from this catalog and the
    // toggle is the only way to enable auto-posting. set-partner-features enforces that it
    // cannot be on while double_entry_ledger is off.
    key: 'expense_auto_post',
    labelTh: 'ลงบัญชีค่าใช้จ่ายอัตโนมัติ',
    descriptionTh: 'ลงรายการบัญชีให้อัตโนมัติเมื่อยืนยันค่าใช้จ่าย (ต้องเปิดบัญชีแยกประเภท)',
    group: 'finance',
    sellable: true,
    submenus: [],
  },
  {
    key: 'thai_tax',
    labelTh: 'ภาษีไทย',
    descriptionTh: 'จัดการข้อมูลและรายงานภาษี VAT, WHT และ CIT',
    group: 'finance',
    sellable: true,
    submenus: [],
  },
  {
    key: 'procurement',
    labelTh: 'จัดซื้อ/เจ้าหนี้',
    descriptionTh: 'จัดการผู้ขาย การขอซื้อ สั่งซื้อ รับสินค้า เจ้าหนี้ และการชำระเงิน',
    group: 'operate',
    sellable: true,
    submenus: [
      {
        key: 'procurement.suppliers',
        labelTh: 'ผู้จำหน่าย',
        descriptionTh: 'ดูและจัดการข้อมูลผู้จำหน่ายและบัญชีธนาคาร',
        route: '/procurement?tab=suppliers',
        permissionKeys: [
          'procurement.supplier.read',
          'procurement.supplier.manage',
          'procurement.supplier.bank.read',
          'procurement.supplier.bank.manage',
        ],
      },
      {
        key: 'procurement.purchase_requests',
        labelTh: 'ใบขอซื้อ (PR)',
        descriptionTh: 'ดู ส่งอนุมัติ และอนุมัติใบขอซื้อ',
        route: '/procurement?tab=pr',
        permissionKeys: [
          'procurement.purchase_request.read',
          'procurement.purchase_request.create',
          'procurement.purchase_request.approve',
        ],
      },
      {
        key: 'procurement.purchase_orders',
        labelTh: 'ใบสั่งซื้อ (PO)',
        descriptionTh: 'ดู สร้าง อนุมัติ ออก และยกเลิกใบสั่งซื้อ',
        route: '/procurement?tab=po',
        permissionKeys: [
          'procurement.purchase_order.read',
          'procurement.purchase_order.create',
          'procurement.purchase_order.approve',
          'procurement.purchase_order.issue',
          'procurement.purchase_order.manage',
        ],
      },
      {
        key: 'procurement.goods_receipts',
        labelTh: 'ใบรับสินค้า (GR)',
        descriptionTh: 'ดู บันทึกรับ และยกเลิกใบรับสินค้า',
        route: '/procurement?tab=gr',
        permissionKeys: [
          'procurement.goods_receipt.read',
          'procurement.goods_receipt.post',
          'procurement.goods_receipt.void',
        ],
      },
      {
        key: 'procurement.vendor_bills',
        labelTh: 'ใบวางบิล',
        descriptionTh: 'ดู สร้าง ตรวจสอบ และอนุมัติใบวางบิล',
        route: '/accounts-payable?tab=bills',
        permissionKeys: [
          'procurement.vendor_bill.read',
          'procurement.vendor_bill.create',
          'procurement.vendor_bill.direct_entry',
          'procurement.vendor_bill.approve',
          'procurement.vendor_bill.void',
          'procurement.vendor_bill.match',
          'procurement.vendor_bill.match.override',
          'procurement.approval_policy.read',
          'procurement.approval_policy.manage',
        ],
      },
      {
        key: 'procurement.supplier_payments',
        labelTh: 'การชำระเงิน',
        descriptionTh: 'ดู บันทึก ปล่อย และยกเลิกการชำระเงินผู้จำหน่าย',
        route: '/accounts-payable?tab=payments',
        permissionKeys: [
          'procurement.supplier_payment.read',
          'procurement.supplier_payment.create',
          'procurement.supplier_payment.release',
          'procurement.supplier_payment.void',
        ],
      },
      {
        key: 'procurement.ap_aging',
        labelTh: 'AP Aging',
        descriptionTh: 'ดูรายงานอายุเจ้าหนี้และยอดค้างชำระ',
        route: '/accounts-payable?tab=aging',
        permissionKeys: ['procurement.ap.report'],
      },
    ],
  },
  {
    key: 'bank_reconciliation',
    labelTh: 'ธนาคารและกระทบยอด',
    descriptionTh: 'จัดการบัญชีธนาคาร รายการเดินบัญชี การจับคู่ และกระทบยอด',
    group: 'finance',
    sellable: true,
    submenus: [
      {
        key: 'bank_reconciliation.accounts',
        labelTh: 'บัญชีธนาคาร',
        descriptionTh: 'ดูและจัดการบัญชีธนาคารของบริษัท',
        route: '/banking?tab=accounts',
        permissionKeys: ['bank.account.read', 'bank.account.manage', 'bank.account.sensitive_read'],
      },
      {
        key: 'bank_reconciliation.cash',
        labelTh: 'สถานะเงินสด',
        descriptionTh: 'ดูยอดเงินสดและเงินฝากรวมของบริษัท',
        route: '/banking?tab=cash',
        permissionKeys: ['bank.cash.read'],
      },
      {
        key: 'bank_reconciliation.import',
        labelTh: 'นำเข้า statement',
        descriptionTh: 'ดูประวัติ นำเข้า และยกเลิกรายการเดินบัญชี',
        route: '/banking?tab=import',
        permissionKeys: ['bank.statement.read', 'bank.statement.import', 'bank.statement.void'],
      },
      {
        key: 'bank_reconciliation.matching',
        labelTh: 'จับคู่รายการ',
        descriptionTh: 'ดู ยืนยัน ข้าม และยกเลิกการจับคู่รายการ',
        route: '/banking?tab=matching',
        permissionKeys: ['bank.match.read', 'bank.match.confirm', 'bank.match.override', 'bank.match.unmatch'],
      },
      {
        key: 'bank_reconciliation.reconciliations',
        labelTh: 'กระทบยอด',
        descriptionTh: 'ดู สร้าง ปิด และเปิดรอบกระทบยอด',
        route: '/banking?tab=reconciliations',
        permissionKeys: [
          'bank.reconciliation.read',
          'bank.reconciliation.create',
          'bank.reconciliation.complete',
          'bank.reconciliation.reopen',
        ],
      },
      {
        key: 'bank_reconciliation.adjustments',
        labelTh: 'รายการปรับปรุง',
        descriptionTh: 'ดู สร้าง อนุมัติ และยกเลิกรายการปรับปรุงธนาคาร',
        route: '/banking?tab=adjustments',
        permissionKeys: [
          'bank.adjustment.read',
          'bank.adjustment.create',
          'bank.adjustment.approve',
          'bank.adjustment.void',
        ],
      },
    ],
  },
  {
    key: 'crm',
    labelTh: 'ลูกค้าและ CRM',
    descriptionTh: 'จัดการลูกค้า ลีด โอกาสขาย กิจกรรม และรายงาน CRM',
    group: 'growth',
    sellable: true,
    submenus: [
      {
        key: 'crm.overview',
        labelTh: 'รายงาน CRM',
        descriptionTh: 'ดูภาพรวมยอดขาย งานติดตาม และข้อมูลสำคัญของ CRM',
        route: '/crm-reports',
        permissionKeys: ['crm.report.read'],
      },
      {
        key: 'crm.leads',
        labelTh: 'ลูกค้ามุ่งหวัง',
        descriptionTh: 'ดู สร้าง มอบหมาย แปลง และคัดออกลูกค้ามุ่งหวัง',
        route: '/crm?tab=leads',
        permissionKeys: [
          'crm.lead.read',
          'crm.lead.create',
          'crm.lead.update',
          'crm.lead.assign',
          'crm.lead.convert',
          'crm.lead.disqualify',
        ],
      },
      {
        key: 'crm.pipeline',
        labelTh: 'ไปป์ไลน์',
        descriptionTh: 'ดูและจัดการโอกาสขาย กิจกรรม และขั้นตอนการขาย',
        route: '/crm?tab=pipeline',
        permissionKeys: [
          'crm.opportunity.read',
          'crm.opportunity.create',
          'crm.opportunity.update',
          'crm.opportunity.stage_move',
          'crm.opportunity.close',
          'crm.opportunity.reopen',
          'crm.activity.read',
          'crm.activity.create',
          'crm.pipeline.configure',
          'crm.quotation.link',
        ],
      },
      {
        key: 'crm.followups',
        labelTh: 'งานติดตาม',
        descriptionTh: 'ดู สร้าง และทำงานติดตามให้เสร็จ',
        route: '/crm?tab=followups',
        permissionKeys: ['crm.follow_up.read', 'crm.follow_up.create', 'crm.follow_up.complete'],
      },
      {
        key: 'crm.customers',
        labelTh: 'ลูกค้า',
        descriptionTh: 'ดู สร้าง แก้ไข มอบหมาย รวม และเก็บข้อมูลลูกค้า',
        route: '/customers',
        permissionKeys: [
          'crm.customer.read',
          'crm.customer.create',
          'crm.customer.update',
          'crm.customer.archive',
          'crm.customer.assign',
          'crm.customer.merge',
          'crm.customer.export',
          'crm.customer.erase',
          'crm.contact.read',
          'crm.contact.manage',
        ],
      },
      {
        key: 'crm.inbox',
        labelTh: 'กล่องข้อความ',
        descriptionTh: 'ดู ตอบ มอบหมาย และจัดการบทสนทนากับลูกค้า',
        route: '/inbox',
        permissionKeys: [
          'crm.inbox.read',
          'crm.inbox.reply',
          'crm.inbox.note',
          'crm.inbox.assign',
          'crm.inbox.resolve',
        ],
      },
      {
        key: 'crm.bookings',
        labelTh: 'การจองออนไลน์',
        descriptionTh: 'ดู สร้าง แก้ไข และยกเลิกการจองออนไลน์',
        route: '/bookings',
        permissionKeys: ['crm.booking.read', 'crm.booking.create', 'crm.booking.update', 'crm.booking.cancel'],
      },
    ],
  },
  {
    key: 'dashboard_notifications',
    labelTh: 'แดชบอร์ด/แจ้งเตือน',
    descriptionTh: 'ปรับแต่งแดชบอร์ดและจัดการกฎการแจ้งเตือน',
    group: 'operate',
    sellable: true,
    submenus: [
      {
        key: 'dashboard_notifications.preferences',
        labelTh: 'ตั้งค่าการแจ้งเตือน',
        descriptionTh: 'ตั้งค่าช่องทางและช่วงเวลาเงียบของการแจ้งเตือน',
        route: '/notifications/preferences',
        permissionKeys: ['notification.preference.manage'],
      },
      {
        key: 'dashboard_notifications.rules',
        labelTh: 'กฎการแจ้งเตือน',
        descriptionTh: 'เปิดหรือปิดกฎการแจ้งเตือนของบริษัท',
        route: '/notifications/rules',
        permissionKeys: ['notification.rule.manage'],
      },
    ],
  },
  {
    key: 'ai_line_assistant',
    labelTh: 'ผู้ช่วย AI ทาง LINE',
    descriptionTh: 'ใช้ผู้ช่วย AI รับข้อความและใบเสร็จผ่าน LINE',
    group: 'operate',
    sellable: true,
    submenus: [],
  },
  {
    key: 'line_oa',
    labelTh: 'เชื่อมต่อ LINE OA',
    descriptionTh: 'เชื่อมต่อบัญชี LINE Official Account ของบริษัท',
    group: 'operate',
    sellable: true,
    submenus: [],
  },
  {
    key: 'reports',
    labelTh: 'รายงาน/BI',
    descriptionTh: 'ดูรายงานข้ามโมดูลและส่งออกข้อมูล',
    group: 'finance',
    sellable: true,
    submenus: [],
  },
  {
    key: 'workflow_automation',
    labelTh: 'ระบบอัตโนมัติ',
    descriptionTh: 'จัดการเทมเพลต กฎอัตโนมัติ งาน และประวัติการทำงาน',
    group: 'operate',
    sellable: true,
    submenus: [
      {
        key: 'workflow_automation.templates',
        labelTh: 'เทมเพลต',
        descriptionTh: 'ดูเทมเพลตสำหรับสร้างกฎอัตโนมัติ',
        route: '/workflow?tab=templates',
        permissionKeys: ['workflow.template.read'],
      },
      {
        key: 'workflow_automation.rules',
        labelTh: 'กฎอัตโนมัติ',
        descriptionTh: 'ดู สร้าง แก้ไข เปิด และปิดกฎอัตโนมัติ',
        route: '/workflow?tab=rules',
        permissionKeys: ['workflow.rule.read', 'workflow.rule.manage', 'workflow.rule.enable'],
      },
      {
        key: 'workflow_automation.runs',
        labelTh: 'ประวัติการทำงาน',
        descriptionTh: 'ดูรายละเอียดและลองทำงานที่ล้มเหลวอีกครั้ง',
        route: '/workflow?tab=runs',
        permissionKeys: ['workflow.run.read', 'workflow.run.replay'],
      },
      {
        key: 'workflow_automation.tasks',
        labelTh: 'งานที่มอบหมาย',
        descriptionTh: 'ดู เลื่อนเวลา ทำให้เสร็จ และยกเลิกงานที่มอบหมาย',
        route: '/workflow?tab=tasks',
        permissionKeys: ['workflow.task.read', 'workflow.task.work'],
      },
      {
        key: 'workflow_automation.dead_letters',
        labelTh: 'ข้อผิดพลาดค้าง',
        descriptionTh: 'ดู ลองใหม่ หรือข้ามข้อผิดพลาดที่รอดำเนินการ',
        route: '/workflow?tab=dead-letters',
        permissionKeys: ['workflow.dead_letter.read', 'workflow.dead_letter.replay'],
      },
      {
        key: 'workflow_automation.webhooks',
        labelTh: 'Webhook',
        descriptionTh: 'ดู สร้าง เปิด และปิดปลายทาง Webhook',
        route: '/workflow?tab=webhooks',
        permissionKeys: ['workflow.webhook.manage'],
      },
    ],
  },
  {
    key: 'employee_access',
    labelTh: 'พนักงานและสิทธิ์',
    descriptionTh: 'จัดการพนักงาน บทบาท และภาพรวมสิทธิ์ของบริษัท',
    group: 'operate',
    sellable: false,
    submenus: [
      {
        key: 'employee_access.employees',
        labelTh: 'พนักงาน',
        descriptionTh: 'ดูและจัดการพนักงานของบริษัท',
        route: '/settings/employees',
        permissionKeys: [
          'access.employee.read',
          'access.employee.create',
          'access.employee.update',
          'access.employee.disable',
          'access.employee.credential.issue',
          'access.employee.line_link.issue',
          'access.employee.line_link.revoke',
        ],
      },
      {
        key: 'employee_access.roles',
        labelTh: 'บทบาทและสิทธิ์',
        descriptionTh: 'ดูและจัดการบทบาท ชุดสิทธิ์ และเทมเพลตบทบาท',
        route: '/settings/permissions',
        permissionKeys: [
          'access.role.read',
          'access.role.manage',
          'access.role.financial.assign',
          'access.permission.read',
          'access.capability_pack.read',
          'access.role_template.read',
          'access.role_template.manage',
        ],
      },
      {
        key: 'employee_access.overview',
        labelTh: 'ภาพรวมสิทธิ์',
        descriptionTh: 'ดูภาพรวมสิทธิ์ที่มีผลของพนักงาน',
        route: '/settings/access-overview',
        permissionKeys: ['access.effective.read'],
      },
    ],
  },
  {
    key: 'company_settings',
    labelTh: 'ตั้งค่าบริษัท',
    descriptionTh: 'จัดการสาขาและความปลอดภัยบัญชีของบริษัท',
    group: 'operate',
    sellable: false,
    submenus: [
      {
        key: 'company_settings.branches',
        labelTh: 'สาขา',
        descriptionTh: 'ดูและจัดการสาขาของบริษัท',
        route: '/settings/branches',
        permissionKeys: ['company.branch.read', 'company.branch.manage'],
      },
      {
        key: 'company_settings.security',
        labelTh: 'ความปลอดภัยบัญชี',
        descriptionTh: 'จัดการรหัสผ่านและการเชื่อมโยงบัญชีผู้ใช้',
        route: '/settings/security',
        permissionKeys: [
          'account.password.change',
          'account.identity.link',
          'account.identity.unlink',
        ],
      },
    ],
  },
];

/**
 * Feature-decoupling spec §6.1 (spec:262-265): platform baseline keys. They stay ON for an
 * active company, sit outside every commercial toggle, and an explicit `enabled: false` row
 * for them is rejected by the entitlement command instead of taking effect.
 */
export const PLATFORM_INVARIANT_FEATURE_KEYS: readonly string[] = ['employee_access', 'company_settings'];

/** Same two keys, read as "an absent row still means on". Kept as one list so they cannot drift. */
export const DEFAULT_ON_FEATURE_KEYS: readonly string[] = PLATFORM_INVARIANT_FEATURE_KEYS;

/**
 * Feature-decoupling spec §6.1 (spec:264) — THE single declarative dependency matrix.
 * `child ⇒ [prerequisites]`: the child may be ON only while every prerequisite is ON.
 * Validated in both directions by the partner entitlement command and mirrored by the
 * partner UI pre-check; no new imperative copy of this rule may be added anywhere.
 *
 * Contents are exhaustive and deliberately small: one top-level dependency plus the two
 * structural procurement children that have no standalone journey. Spec explicitly forbids
 * `reimbursement ⇒ expenses` and `thai_tax ⇒ double_entry_ledger`.
 */
export const FEATURE_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  expense_auto_post: ['double_entry_ledger'],
  'procurement.supplier_payments': ['procurement.vendor_bills'],
  'procurement.ap_aging': ['procurement.vendor_bills'],
};

/** Prerequisites a key needs to stay ON; `[]` when it has none. */
export function requiredFeatureKeys(featureKey: string): readonly string[] {
  return FEATURE_DEPENDENCIES[featureKey] ?? [];
}

/** Keys that would be stranded if `featureKey` were turned off, in canonical key order. */
export function dependentFeatureKeys(featureKey: string): string[] {
  return Object.keys(FEATURE_DEPENDENCIES)
    .filter((child) => FEATURE_DEPENDENCIES[child]!.includes(featureKey))
    .sort();
}

export type FeatureDependencyViolation = { featureKey: string; requiresFeatureKey: string };

/**
 * Both-direction validation of a proposed FINAL set: every ON key whose prerequisite is not ON.
 * Enabling a child without its parent and disabling a parent under an ON child both surface here.
 */
export function unmetFeatureDependencies(
  isOn: (featureKey: string) => boolean,
): FeatureDependencyViolation[] {
  return Object.keys(FEATURE_DEPENDENCIES)
    .sort()
    .flatMap((featureKey) => (
      isOn(featureKey)
        ? FEATURE_DEPENDENCIES[featureKey]!
          .filter((requiresFeatureKey) => !isOn(requiresFeatureKey))
          .map((requiresFeatureKey) => ({ featureKey, requiresFeatureKey }))
        : []
    ));
}

export const LEGACY_FEATURE_INHERITANCE: Record<string, string[]> = {
  reimbursement: ['expenses', 'procurement'],
  product_catalog: ['inventory', 'crm'],
  line_oa: ['crm'],
};

export const FEATURE_KEYS: string[] = FEATURE_CATALOG.map((feature) => feature.key);

export const ALL_FEATURE_ENTITLEMENT_KEYS: string[] = FEATURE_CATALOG.flatMap((feature) => [
  feature.key,
  ...feature.submenus.map((submenu) => submenu.key),
]);

export function parentFeatureKey(key: string): string {
  return key.split('.')[0] ?? key;
}
