// Permission registry: canonical source of truth for permission keys and role grants.
// Imported by seed.ts and tested by permission-registry.spec.ts.
import { COMPANY_TEAM_NOTE_WORDS as NOTE_WORDS, COMPANY_TEAM_NOTE_MANAGE_PERMISSION, THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';
import { BILLING_PERMISSIONS, EXECUTIVE_PERMISSION_KEYS, EXECUTIVE_ROLE_KEYS, SALES_PERMISSION_KEYS, SALES_ROLE_KEYS } from '@watchdog-bms/contracts';

/**
 * RB-34 — THE list of platform-only roles: มั่งมี's own staff roles. They are system roles, so every
 * company's role query finds them, but they mean something only inside the platform company.
 * Outside it a company cannot list, read, copy, assign or route an approval to one, and no custom
 * role may take its key (`platformOnlyRoleRefused`, `reservedRoleKey`). A new platform-only role
 * joins HERE and nowhere else.
 */
export const PLATFORM_ONLY_ROLE_KEYS: readonly string[] = [...SALES_ROLE_KEYS, ...EXECUTIVE_ROLE_KEYS];

/**
 * Roles that belong to the PLATFORM, not to a customer company. They hold no business
 * permission of any kind, so none of the "every company role can …" invariants below apply
 * to them — see S29: a sales agent is a member of the platform tenant and must find nothing
 * there to open.
 */
export const PLATFORM_ROLE_KEYS: readonly string[] = ['SYSTEM_ADMIN', ...PLATFORM_ONLY_ROLE_KEYS];

export type PermissionRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PermissionDef = {
  key: string;
  description: string;
  riskLevel: PermissionRiskLevel;
};

export const PERMISSIONS: PermissionDef[] = [
  ...BILLING_PERMISSIONS.map((key): PermissionDef => ({ key, description: `Platform billing: ${key.slice('system.billing.'.length)}`,
    riskLevel: key.endsWith('.read') ? 'MEDIUM' : key === 'system.billing.issue.manage' ? 'HIGH' : 'CRITICAL' })),
  { key: 'account.session.read',       description: 'Read own session info',              riskLevel: 'LOW' },
  { key: 'account.password.change',    description: 'Change own account password',        riskLevel: 'MEDIUM' },
  { key: 'account.identity.link',      description: 'Link external identity',             riskLevel: 'MEDIUM' },
  { key: 'account.identity.unlink',    description: 'Unlink external identity',           riskLevel: 'MEDIUM' },
  { key: 'company.setup.read',         description: 'Read company setup',                 riskLevel: 'LOW' },
  { key: 'company.setup.manage',       description: 'Manage company setup',               riskLevel: 'LOW' },
  { key: 'company.plan.manage',        description: 'Manage company package and billing purchases', riskLevel: 'CRITICAL' },
  // Opens the ตั้งค่าบริษัท hub. Its own key rather than a reused one: company.setup.read is
  // held by Manager/Finance/Accountant, and company.setup.manage also guards the
  // substitute-receipt policy — gating the menu on either would either leak the menu or hand
  // out a write the menu never needed. The cards inside stay individually permission-gated.
  { key: 'company.settings.view',      description: 'Open the company settings hub',      riskLevel: 'LOW' },
  // Step 0 company tax identity (company-tax-identity-setup-spec §10). Separate keys from
  // company.setup.*, which is LOW and handed to Manager/Finance/Accountant: the legal identity
  // is the 13-digit tax id and the registered address that get printed on every tax invoice,
  // and a wrong one is a filing problem, not a settings problem. company.setup.read still sees
  // a masked view (last four digits, province) so the existing screens keep working.
  { key: 'company.legal_identity.read',   description: 'Read full company legal tax identity',   riskLevel: 'MEDIUM' },
  { key: 'company.legal_identity.manage', description: 'Manage company legal tax identity',      riskLevel: 'HIGH' },
  // VAT registration is a legal status with dated facts, not a checkbox — managing it changes
  // whether the company may issue a tax invoice at all.
  { key: 'company.vat_registration.read',   description: 'Read company VAT registration status',   riskLevel: 'LOW' },
  { key: 'company.vat_registration.manage', description: 'Answer/correct company VAT registration', riskLevel: 'HIGH' },
  { key: 'admin.user.read',            description: 'Read users (admin)',                 riskLevel: 'LOW' },
  { key: 'admin.user.manage',          description: 'Manage users (admin)',               riskLevel: 'HIGH' },
  { key: 'admin.role.read',            description: 'Read roles (admin)',                 riskLevel: 'LOW' },
  { key: 'admin.role.manage',          description: 'Manage roles (admin)',               riskLevel: 'HIGH' },
  { key: 'audit.log.read',             description: 'Read audit logs',                    riskLevel: 'MEDIUM' },
  { key: 'ai.tool.invoke',             description: 'Invoke AI tools',                    riskLevel: 'MEDIUM' },
  // Item 04 permissions
  { key: 'company.branch.read',            description: 'Read company branches',              riskLevel: 'LOW' },
  { key: 'company.branch.manage',          description: 'Manage company branches',            riskLevel: 'MEDIUM' },
  { key: 'attachment.read',               description: 'Read attachments',                   riskLevel: 'LOW' },
  { key: 'attachment.create',             description: 'Create/upload attachments',          riskLevel: 'LOW' },
  { key: 'attachment.delete',             description: 'Delete attachments',                 riskLevel: 'MEDIUM' },
  { key: 'document.sequence.read',         description: 'Read document sequences',            riskLevel: 'LOW' },
  { key: 'document.sequence.manage',       description: 'Manage document sequences',          riskLevel: 'HIGH' },
  { key: 'outbox.event.read',              description: 'Read outbox events (ops)',           riskLevel: 'MEDIUM' },
  // Item 06 dashboard and notification permissions
  { key: 'dashboard.read',                  description: 'Read company dashboard',              riskLevel: 'LOW' },
  { key: 'dashboard.configure',             description: 'Configure dashboard widgets',         riskLevel: 'MEDIUM' },
  { key: 'dashboard.snapshot.generate',     description: 'Generate dashboard snapshot',         riskLevel: 'LOW' },
  { key: 'notification.read',               description: 'Read own notifications',              riskLevel: 'LOW' },
  { key: 'notification.preference.manage',  description: 'Manage own notification preferences', riskLevel: 'LOW' },
  { key: 'notification.rule.manage',        description: 'Manage notification rules (admin)',   riskLevel: 'HIGH' },
  { key: 'notification.delivery.read',      description: 'Read notification delivery logs',     riskLevel: 'MEDIUM' },
  { key: 'notification.delivery.retry',     description: 'Retry failed notification deliveries', riskLevel: 'MEDIUM' },
  // Item 07 LINE AI permissions
  { key: 'line.ai.query',                  description: 'Query business data via LINE AI',    riskLevel: 'LOW' },
  // Item 10A platform onboarding permissions
  { key: 'system.company_onboarding.create', description: 'Create customer company onboarding', riskLevel: 'HIGH' },
  { key: 'system.company_onboarding.read', description: 'Read customer company onboarding',   riskLevel: 'MEDIUM' },
  { key: 'system.email_delivery.manage', description: 'Manage local email history retention', riskLevel: 'HIGH' },
  { key: 'system.email_delivery.read', description: 'Read safe platform email delivery observations', riskLevel: 'HIGH' },
  { key: 'system.company_onboarding.regenerate_temporary_password', description: 'Regenerate customer owner temporary password', riskLevel: 'CRITICAL' },
  { key: 'system.line_binding.manage',  description: 'Manage customer LINE channel bindings', riskLevel: 'HIGH' },
  { key: 'system.shared_line_credential.manage', description: 'Read and replace shared Messaging credentials for the existing OA', riskLevel: 'CRITICAL' },
  { key: 'system.home_theme.manage', description: 'Select the public homepage event presentation', riskLevel: 'HIGH' },
  // Item 10A partner management permissions
  { key: 'system.partner_dashboard.read',           description: 'Read partner company list and detail (metadata only)', riskLevel: 'MEDIUM' },
  { key: 'system.executive.read', description: 'ดูรายงานผู้บริหาร', riskLevel: 'MEDIUM' },
  { key: 'system.executive.export', description: 'ส่งออกรายงานผู้บริหาร', riskLevel: 'HIGH' },
  { key: 'system.executive.contact.read', description: 'ดูข้อมูลติดต่อเจ้าของร้านในรายงานผู้บริหาร', riskLevel: 'HIGH' },
  { key: COMPANY_TEAM_NOTE_MANAGE_PERMISSION, description: NOTE_WORDS.permissionDescription, riskLevel: 'MEDIUM' },
  { key: 'system.executive_user.manage', description: 'จัดการบัญชีผู้บริหาร', riskLevel: 'CRITICAL' },
  { key: 'system.wht_income_category.manage', description: 'เปิด–ปิดประเภทเงินได้หัก ณ ที่จ่ายสำหรับทุกร้าน', riskLevel: 'HIGH' },
  { key: 'system.partner_company.create',           description: 'Create new partner company',                          riskLevel: 'HIGH' },
  { key: 'system.partner_company.update',           description: 'Update partner company profile metadata',             riskLevel: 'MEDIUM' },
  { key: 'system.partner_company.lifecycle.manage', description: 'Activate/inactivate/archive partner company',         riskLevel: 'CRITICAL' },
  { key: 'system.partner_feature.manage',           description: 'Set partner feature entitlements',                    riskLevel: 'HIGH' },
  { key: 'system.partner_ai_model.manage',          description: 'Set approved AI model for partner company',           riskLevel: 'HIGH' },
  { key: 'system.partner_line_credential.manage',   description: 'Create/replace LINE credentials for partner company', riskLevel: 'CRITICAL' },
  { key: 'system.partner_member.read',              description: 'View partner company members and credential state',   riskLevel: 'HIGH' },
  { key: 'system.partner_member.manage',            description: 'Reset/reveal partner member temporary passwords, unlink LINE', riskLevel: 'CRITICAL' },
  // F2/CC7 (spec:232-238). Its OWN key, not a reuse of system.partner_feature.manage: this is the
  // one command that writes entitlements while normalization is pending — the exact state that
  // freezes the ordinary partner command — so the two authorities are not interchangeable and the
  // resolver can be granted or withdrawn without touching day-to-day partner feature management.
  { key: 'system.entitlement_exception.manage',     description: 'Resolve a normalization dependency exception (enable prerequisite / disable dependents)', riskLevel: 'HIGH' },
  // F1 internal launch control plane (spec:55, AC29). Platform authority only: customers,
  // partners, tenant users and AI never read or mutate launch route state.
  { key: 'system.launch_gate.read',                 description: 'Read the internal launch-health view (tenant-anonymous)', riskLevel: 'MEDIUM' },
  { key: 'system.launch_gate.manage',               description: 'OPEN/CLOSE an exact launch route (control-plane command)', riskLevel: 'CRITICAL' },
  // Step 0 identity reconciliation (spec §16). CRITICAL rather than HIGH: the holder rewrites
  // the legal tax identity, VAT facts and branch codes of ANY tenant company — a wider authority
  // than system.company_onboarding.create, which only brings a new company into existence.
  { key: 'system.identity_reconciliation.resolve',  description: 'Generate and resolve company tax identity reconciliation items', riskLevel: 'CRITICAL' },
  { key: 'system.data_rights.manage',               description: 'Orchestrate restricted user/company data-rights and offboarding cases', riskLevel: 'CRITICAL' },
  // Sales console (spec §9/§10). Platform-tenant authority for มั่งมี's own sales team — NOT the
  // tenant role `SALES`, which is a shop employee (S06). None of these reads a shop's business or
  // financial data: `sales.company.search` returns name/status/package/province and nothing else.
  { key: 'sales.demo_link.create', description: 'Create a three-day demo link', riskLevel: 'HIGH' },
  { key: 'sales.console.read',          description: 'Open the sales console and read own deals',   riskLevel: 'LOW' },
  { key: 'sales.company.search',        description: 'Search shops by name (limited fields, audited)', riskLevel: 'MEDIUM' },
  { key: 'sales.deal.create',           description: 'Create, edit and submit a sales deal',        riskLevel: 'MEDIUM' },
  { key: 'sales.deal.approve',          description: 'Approve or reject a submitted sales deal',    riskLevel: 'HIGH' },
  { key: 'sales.team.manage',           description: 'Create/reset agents and read own-team tax/bank profiles', riskLevel: 'CRITICAL' },
  { key: 'sales.report.read',           description: 'Read sales figures across teams',             riskLevel: 'MEDIUM' },
  // Admin-wide read/write/export stays separate from a lead's own-team read (S10).
  { key: 'sales.agent_profile.manage',  description: 'Read/write sales agent tax and bank details (PII)', riskLevel: 'CRITICAL' },
  // Sales-event discounts (sales-event-discounts spec §9). HIGH: a batch hands customers a discount
  // or free credit without any further approval — the batch itself is the control (SD-O10).
  { key: 'sales.event.manage',          description: 'Create, edit, pause and suspend event discount batches; revoke their discounts', riskLevel: 'HIGH' },
  // Item 05 inventory permissions
  { key: 'inventory.product.read',         description: 'Read inventory products',            riskLevel: 'LOW' },
  { key: 'inventory.product.manage',       description: 'Create/update/archive products',     riskLevel: 'MEDIUM' },
  { key: 'inventory.location.read',        description: 'Read inventory locations',           riskLevel: 'LOW' },
  { key: 'inventory.location.manage',      description: 'Create/update/archive locations',    riskLevel: 'MEDIUM' },
  { key: 'inventory.movement.read',        description: 'Read stock movements',               riskLevel: 'LOW' },
  { key: 'inventory.movement.create',      description: 'Create stock movements (in/out)',    riskLevel: 'MEDIUM' },
  { key: 'inventory.movement.adjust',      description: 'Create adjustment movements',        riskLevel: 'HIGH' },
  { key: 'inventory.stock_count.create',   description: 'Create stock count adjustments',     riskLevel: 'HIGH' },
  { key: 'inventory.report.read',          description: 'Read inventory reports',             riskLevel: 'LOW' },
  { key: 'inventory.label.manage',         description: 'Generate/print internal QR labels',  riskLevel: 'LOW' },
  // Item 08 accounting document permissions
  { key: 'accounting.counterparty.read',        description: 'Read accounting counterparties',         riskLevel: 'LOW' },
  { key: 'accounting.counterparty.manage',      description: 'Create/update accounting counterparties', riskLevel: 'MEDIUM' },
  { key: 'accounting.document.read',            description: 'Read accounting documents',              riskLevel: 'LOW' },
  { key: 'accounting.document.read_related',    description: 'Read related accounting document chains', riskLevel: 'LOW' },
  { key: 'accounting.document.create',          description: 'Create accounting documents',            riskLevel: 'MEDIUM' },
  { key: 'accounting.document.update',          description: 'Update draft accounting documents',      riskLevel: 'MEDIUM' },
  { key: 'accounting.document.issue',           description: 'Issue accounting documents',             riskLevel: 'HIGH' },
  { key: 'accounting.document.void',            description: 'Void accounting documents',              riskLevel: 'HIGH' },
  { key: 'accounting.document.export',          description: 'Export accounting documents',            riskLevel: 'MEDIUM' },
  { key: 'accounting.revenue_category.manage',  description: 'Manage revenue categories',              riskLevel: 'MEDIUM' },
  { key: 'accounting.quotation.read',           description: 'Read quotations',                        riskLevel: 'LOW' },
  { key: 'accounting.quotation.create',         description: 'Create quotation drafts',                riskLevel: 'MEDIUM' },
  { key: 'accounting.quotation.update',         description: 'Update draft quotations',                riskLevel: 'MEDIUM' },
  { key: 'accounting.quotation.submit_approval', description: 'Submit quotation for approval',         riskLevel: 'MEDIUM' },
  { key: 'accounting.quotation.approve',        description: 'Approve/reject quotation issue',         riskLevel: 'HIGH' },
  { key: 'accounting.quotation.issue',          description: 'Issue approved quotation',               riskLevel: 'HIGH' },
  { key: 'accounting.quotation.void',           description: 'Void quotation',                         riskLevel: 'HIGH' },
  { key: 'accounting.invoice.read',             description: 'Read invoices',                          riskLevel: 'LOW' },
  { key: 'accounting.invoice.create',           description: 'Create invoice drafts',                  riskLevel: 'MEDIUM' },
  { key: 'accounting.invoice.update',           description: 'Update draft invoices',                  riskLevel: 'MEDIUM' },
  { key: 'accounting.invoice.issue',            description: 'Issue invoices',                         riskLevel: 'HIGH' },
  { key: 'accounting.invoice.void',             description: 'Void invoices',                          riskLevel: 'HIGH' },
  { key: 'accounting.billing_note.read',        description: 'Read billing notes',                     riskLevel: 'LOW' },
  { key: 'accounting.billing_note.create',      description: 'Create billing note drafts',             riskLevel: 'MEDIUM' },
  { key: 'accounting.billing_note.update',      description: 'Update draft billing notes',             riskLevel: 'MEDIUM' },
  { key: 'accounting.billing_note.issue',       description: 'Issue billing notes',                    riskLevel: 'HIGH' },
  { key: 'accounting.billing_note.void',        description: 'Void billing notes',                     riskLevel: 'HIGH' },
  { key: 'accounting.receipt.read',             description: 'Read receipts',                          riskLevel: 'LOW' },
  { key: 'accounting.receipt.create',           description: 'Create receipt drafts',                  riskLevel: 'MEDIUM' },
  { key: 'accounting.receipt.update',           description: 'Update draft receipts',                  riskLevel: 'MEDIUM' },
  { key: 'accounting.receipt.issue',            description: 'Issue receipts',                         riskLevel: 'HIGH' },
  { key: 'accounting.receipt.void',             description: 'Void receipts',                          riskLevel: 'HIGH' },
  { key: 'accounting.tax_invoice.read',         description: 'Read tax invoices',                      riskLevel: 'LOW' },
  { key: 'accounting.tax_invoice.issue',        description: 'Issue tax invoices (high-risk)',         riskLevel: 'CRITICAL' },
  { key: 'accounting.tax_invoice.void',         description: 'Void tax invoices (high-risk)',          riskLevel: 'CRITICAL' },
  // Appends buyer identity evidence to an ALREADY ISSUED tax invoice so a later credit/debit
  // note can be issued against it (spec §7.3). Its own key rather than accounting.document.update:
  // that one is a MEDIUM draft-editing key inside pack.billing.operate, and reusing it would let
  // every draft editor rewrite the buyer on a document that has already left the building.
  { key: 'accounting.tax_document_buyer_evidence.manage', description: 'Add buyer identity evidence to an issued tax invoice', riskLevel: 'HIGH' },
  { key: 'accounting.credit_note.read',         description: 'Read credit notes',                      riskLevel: 'LOW' },
  { key: 'accounting.credit_note.create',       description: 'Create credit note drafts',              riskLevel: 'MEDIUM' },
  { key: 'accounting.credit_note.issue',        description: 'Issue credit notes',                     riskLevel: 'HIGH' },
  { key: 'accounting.credit_note.void',         description: 'Void credit notes',                      riskLevel: 'HIGH' },
  { key: 'accounting.debit_note.read',          description: 'Read debit notes',                       riskLevel: 'LOW' },
  { key: 'accounting.debit_note.create',        description: 'Create debit note drafts',               riskLevel: 'MEDIUM' },
  { key: 'accounting.debit_note.issue',         description: 'Issue debit notes',                      riskLevel: 'HIGH' },
  { key: 'accounting.debit_note.void',          description: 'Void debit notes',                       riskLevel: 'HIGH' },
  { key: 'accounting.payment.read',             description: 'Read payment records',                   riskLevel: 'LOW' },
  { key: 'accounting.payment.create',           description: 'Record payments',                        riskLevel: 'HIGH' },
  { key: 'accounting.payment.update',           description: 'Update draft payment records',           riskLevel: 'MEDIUM' },
  { key: 'accounting.payment.void',             description: 'Void payment records',                   riskLevel: 'CRITICAL' },
  // Item 09 expense permissions
  { key: 'expense.read',                        description: 'Read all company expenses',              riskLevel: 'LOW' },
  { key: 'expense.read_related',                description: 'Read expenses related to the current user', riskLevel: 'LOW' },
  { key: 'expense.evidence.read',               description: 'Read shared accounting evidence',       riskLevel: 'LOW' },
  { key: 'expense.read_own',                    description: 'Read own expense drafts',               riskLevel: 'LOW' },
  { key: 'expense.create',                      description: 'Create manual expense drafts',          riskLevel: 'MEDIUM' },
  { key: 'expense.receipt.upload',              description: 'Upload receipt evidence (web)',          riskLevel: 'MEDIUM' },
  { key: 'expense.receipt.line_upload',         description: 'Upload receipt evidence (LINE)',         riskLevel: 'MEDIUM' },
  { key: 'expense.update',                      description: 'Update own expense drafts',             riskLevel: 'MEDIUM' },
  { key: 'expense.review',                      description: 'Review and edit any expense',           riskLevel: 'MEDIUM' },
  { key: 'expense.confirm',                     description: 'Confirm expense records',               riskLevel: 'HIGH' },
  { key: 'expense.reject',                      description: 'Reject expense records',                riskLevel: 'HIGH' },
  { key: 'expense.void',                        description: 'Void confirmed expenses',               riskLevel: 'CRITICAL' },
  { key: 'expense.delete',                      description: 'Hard-delete draft expenses',            riskLevel: 'CRITICAL' },
  { key: 'expense.payment.record',              description: 'Record expense payments',               riskLevel: 'HIGH' },
  { key: 'expense.disbursement.read',            description: 'Read disbursement vouchers',             riskLevel: 'LOW' },
  { key: 'expense.disbursement.prepare',         description: 'Create, edit, submit, take back, or cancel an unpaid disbursement voucher', riskLevel: 'MEDIUM' },
  { key: 'expense.disbursement.approve',         description: 'Approve, send back, or cancel an unpaid disbursement voucher', riskLevel: 'HIGH' },
  { key: 'expense.disbursement.pay',             description: 'Record payment of an approved disbursement voucher', riskLevel: 'HIGH' },
  { key: 'expense.disbursement.issue',           description: 'Issue a disbursement voucher for a payment already recorded on an expense', riskLevel: 'MEDIUM' },
  { key: 'expense.duplicate.resolve',           description: 'Resolve duplicate expense warnings',    riskLevel: 'HIGH' },
  { key: 'expense.ocr.request',                 description: 'Request OCR extraction',               riskLevel: 'MEDIUM' },
  { key: 'expense.ai.verify',                   description: 'Run AI verification on receipts',       riskLevel: 'MEDIUM' },
  { key: 'expense.category.manage',             description: 'Manage expense categories',             riskLevel: 'MEDIUM' },
  { key: 'expense.signature.self_manage',       description: 'Manage and use own personal signatures', riskLevel: 'MEDIUM' },
  { key: 'expense.signature.manage',            description: 'Legacy access to manage own personal signatures', riskLevel: 'HIGH' },
  { key: 'expense.export',                      description: 'Export expense data',                   riskLevel: 'MEDIUM' },
  // Item 11 tax permissions
  { key: 'tax.profile.read',            description: 'Read company tax profile',              riskLevel: 'LOW' },
  { key: 'tax.profile.manage',          description: 'Manage company tax profile',            riskLevel: 'HIGH' },
  { key: 'tax.config.read',             description: 'Read tax year config/rates/calendar',   riskLevel: 'LOW' },
  { key: 'tax.config.manage',           description: 'Manage tax year config/rates/calendar', riskLevel: 'HIGH' },
  { key: 'tax.period.read',             description: 'Read tax periods',                      riskLevel: 'LOW' },
  { key: 'tax.period.manage',           description: 'Reopen/amend tax periods',             riskLevel: 'CRITICAL' },
  { key: 'tax.event.read',              description: 'Read tax events',                       riskLevel: 'LOW' },
  { key: 'tax.event.sync',              description: 'Trigger source tax event sync',         riskLevel: 'MEDIUM' },
  { key: 'tax.report.read',             description: 'Read VAT/WHT/CIT reports',             riskLevel: 'LOW' },
  { key: 'tax.report.recompute',        description: 'Recompute tax report from events',     riskLevel: 'MEDIUM' },
  { key: 'tax.report.export',           description: 'Export tax filing packages',            riskLevel: 'HIGH' },
  { key: 'tax.filing.mark_filed',       description: 'Mark tax period as filed',             riskLevel: 'HIGH' },
  { key: 'tax.filing.mark_paid',        description: 'Mark tax period as paid',              riskLevel: 'HIGH' },
  { key: 'tax.certificate.read',        description: 'Read 50 ทวิ WHT certificates',          riskLevel: 'LOW' },
  { key: 'tax.certificate.issue',       description: 'Issue 50 ทวิ WHT certificates',         riskLevel: 'HIGH' },
  { key: 'tax.certificate.void',        description: 'Void issued 50 ทวิ WHT certificates',   riskLevel: 'HIGH' },
  { key: 'wht.pnd53.read',              description: 'Read PND53 periods and source events', riskLevel: 'LOW' },
  { key: 'wht.pnd53.prepare',           description: 'Compute and export PND53 reports', riskLevel: 'HIGH' },
  // Decoupled from `thai_tax` on purpose (spec:301-302): when the system cannot issue the
  // 50 ทวิ itself, the operator must still be able to see the handoff and link an externally
  // issued certificate — that journey belongs to the payment-owning source feature, not Tax.
  { key: 'wht.certificate.read',        description: 'Read 50 ทวิ external handoffs',        riskLevel: 'LOW' },
  { key: 'wht.external_certificate.link', description: 'Link an externally issued 50 ทวิ',   riskLevel: 'HIGH' },
  // WHT certificate system issuance plan §2.1: mints a 50 ทวิ directly from a settlement/expense
  // handoff (AP/Expenses "ออกเอกสารในระบบ" button). Owner decision 2026-09-22 gates it with
  // `wht_50bis` via a dedicated pack; legacy `thai_tax` grants are retained.
  { key: 'wht.certificate.issue',       description: 'Issue a 50 ทวิ WHT certificate directly from a settlement/expense confirm (SYSTEM issuance)', riskLevel: 'HIGH' },
  // Correction & replacement plan §2.1: shared key for both "แก้ไขหนังสือรับรอง" and "ออกใบแทน" on a
  // SYSTEM-issued certificate — owner confirmed 2026-09-23 this stays ungated (no thai_tax), unlike
  // wht.certificate.issue above (see capability-pack.registry.ts).
  { key: 'wht.certificate.correct',     description: 'Correct or reissue a copy of a SYSTEM-issued 50 ทวิ certificate', riskLevel: 'HIGH' },
  // WHT certificate system issuance plan §2.1b (Decision B): OWNER-only by omission — deliberately
  // never added to any role's grant list below (mirrors company.legal_identity.manage).
  { key: 'company.tax_signature.manage', description: "Upload/manage the company's WHT-certificate signature image (authorized signatory)", riskLevel: 'HIGH' },
  { key: 'tax.review_issue.read',       description: 'Read tax review issues',               riskLevel: 'LOW' },
  { key: 'tax.review_issue.resolve',    description: 'Resolve or ignore tax review issues',  riskLevel: 'MEDIUM' },
  { key: 'tax.adjustment.create',       description: 'Create tax period adjustments',        riskLevel: 'HIGH' },
  // Item 10 ledger permissions
  { key: 'ledger.account.read',                description: 'Read chart of accounts',                riskLevel: 'LOW' },
  { key: 'ledger.account.manage',              description: 'Create/update chart of accounts',       riskLevel: 'HIGH' },
  { key: 'ledger.journal.read',                description: 'Read journal entries',                  riskLevel: 'LOW' },
  { key: 'journal.entry.create',               description: 'Create draft manual journal entries',   riskLevel: 'MEDIUM' },
  { key: 'journal.entry.post',                 description: 'Post balanced journal entries',         riskLevel: 'HIGH' },
  { key: 'journal.entry.reverse',              description: 'Reverse posted journal entries',        riskLevel: 'CRITICAL' },
  { key: 'ledger.posting-rule.read',           description: 'Read posting rules',                   riskLevel: 'LOW' },
  { key: 'ledger.posting-rule.manage',         description: 'Create/update posting rules',          riskLevel: 'HIGH' },
  { key: 'ledger.report.read',                 description: 'Read GL/TB/P&L/Balance Sheet reports', riskLevel: 'LOW' },
  { key: 'ledger.period.read',                 description: 'Read accounting periods',              riskLevel: 'LOW' },
  { key: 'ledger.period.close',                description: 'Close accounting periods',             riskLevel: 'CRITICAL' },
  { key: 'ledger.period.unclose',              description: 'Reopen closed accounting periods',     riskLevel: 'CRITICAL' },
  { key: 'ledger.export',                      description: 'Export ledger reports',                riskLevel: 'MEDIUM' },
  // Item 13 banking permissions
  { key: 'bank.account.read',              description: 'Read bank accounts',                           riskLevel: 'LOW' },
  { key: 'bank.account.manage',            description: 'Create/update bank accounts',                  riskLevel: 'MEDIUM' },
  { key: 'bank.account.sensitive_read',    description: 'Read sensitive bank account fields',           riskLevel: 'HIGH' },
  { key: 'bank.statement.read',            description: 'Read bank statement lines',                    riskLevel: 'LOW' },
  { key: 'bank.statement.import',          description: 'Import bank statements',                       riskLevel: 'HIGH' },
  { key: 'bank.statement.manual_line',     description: 'Create manual statement lines',               riskLevel: 'HIGH' },
  { key: 'bank.statement.void',            description: 'Void bank statement imports',                  riskLevel: 'HIGH' },
  { key: 'bank.match.read',                description: 'Read bank match candidates',                   riskLevel: 'LOW' },
  { key: 'bank.match.suggest',             description: 'Run match suggestions',                        riskLevel: 'MEDIUM' },
  { key: 'bank.match.confirm',             description: 'Confirm bank statement line matches',          riskLevel: 'HIGH' },
  { key: 'bank.match.unmatch',             description: 'Void confirmed matches',                       riskLevel: 'HIGH' },
  { key: 'bank.match.override',            description: 'Override match tolerance or ignore lines',     riskLevel: 'CRITICAL' },
  { key: 'bank.adjustment.read',           description: 'Read bank adjustments',                        riskLevel: 'LOW' },
  { key: 'bank.adjustment.create',         description: 'Create bank adjustment drafts',               riskLevel: 'MEDIUM' },
  { key: 'bank.adjustment.approve',        description: 'Approve bank adjustments',                    riskLevel: 'CRITICAL' },
  { key: 'bank.adjustment.void',           description: 'Void bank adjustments',                       riskLevel: 'HIGH' },
  { key: 'bank.reconciliation.read',       description: 'Read reconciliation sessions',                 riskLevel: 'LOW' },
  { key: 'bank.reconciliation.create',     description: 'Create reconciliation sessions',              riskLevel: 'MEDIUM' },
  { key: 'bank.reconciliation.complete',   description: 'Complete reconciliation sessions',            riskLevel: 'CRITICAL' },
  { key: 'bank.reconciliation.reopen',     description: 'Reopen completed reconciliation sessions',    riskLevel: 'CRITICAL' },
  { key: 'bank.reconciliation.export',     description: 'Export reconciliation evidence',              riskLevel: 'HIGH' },
  { key: 'bank.cash.read',                 description: 'Read cash position summary',                   riskLevel: 'LOW' },
  // Item 12 procurement, supplier, and accounts payable
  { key: 'procurement.supplier.read',              description: 'Read supplier profiles',                       riskLevel: 'LOW' },
  { key: 'procurement.supplier.manage',            description: 'Create/update supplier profiles',              riskLevel: 'MEDIUM' },
  { key: 'procurement.supplier.bank.read',         description: 'Read sensitive supplier bank details',         riskLevel: 'HIGH' },
  { key: 'procurement.supplier.bank.manage',       description: 'Create/update supplier bank details',          riskLevel: 'HIGH' },
  { key: 'procurement.purchase_request.read_related', description: 'Read related purchase-request chains',           riskLevel: 'LOW' },
  { key: 'procurement.purchase_order.read_related',   description: 'Read related purchase-order chains',             riskLevel: 'LOW' },
  { key: 'procurement.goods_receipt.read_related',    description: 'Read related goods-receipt chains',              riskLevel: 'LOW' },
  { key: 'procurement.vendor_bill.read_related',      description: 'Read related vendor-bill chains',                riskLevel: 'LOW' },
  { key: 'procurement.supplier_payment.read_related', description: 'Read related supplier-payment chains',           riskLevel: 'LOW' },
  { key: 'procurement.purchase_request.read',      description: 'Read purchase requests',                       riskLevel: 'LOW' },
  { key: 'procurement.purchase_request.create',    description: 'Create/update purchase requests',              riskLevel: 'MEDIUM' },
  { key: 'procurement.purchase_request.approve',   description: 'Approve/reject purchase requests',             riskLevel: 'HIGH' },
  { key: 'procurement.purchase_order.read',        description: 'Read purchase orders',                        riskLevel: 'LOW' },
  { key: 'procurement.purchase_order.create',      description: 'Create/update draft purchase orders',         riskLevel: 'MEDIUM' },
  { key: 'procurement.purchase_order.approve',     description: 'Approve/reject purchase orders',               riskLevel: 'HIGH' },
  { key: 'procurement.purchase_order.issue',       description: 'Issue approved purchase orders',               riskLevel: 'HIGH' },
  { key: 'procurement.purchase_order.manage',      description: 'Cancel/void purchase orders (admin)',         riskLevel: 'HIGH' },
  { key: 'procurement.goods_receipt.read',         description: 'Read goods receipts',                          riskLevel: 'LOW' },
  { key: 'procurement.goods_receipt.create',       description: 'Create goods receipts against purchase orders', riskLevel: 'MEDIUM' },
  { key: 'procurement.goods_receipt.post',         description: 'Post goods receipts (creates inventory movement)', riskLevel: 'HIGH' },
  { key: 'procurement.goods_receipt.void',         description: 'Void posted goods receipts',                   riskLevel: 'CRITICAL' },
  { key: 'procurement.vendor_bill.read',           description: 'Read vendor bills',                            riskLevel: 'LOW' },
  { key: 'procurement.vendor_bill.create',         description: 'Create vendor bills from PO/receipt/evidence', riskLevel: 'MEDIUM' },
  { key: 'procurement.vendor_bill.direct_entry',   description: 'Create direct vendor bills without a purchase order', riskLevel: 'HIGH' },
  { key: 'procurement.vendor_bill.approve',        description: 'Approve vendor bills for payment',             riskLevel: 'HIGH' },
  { key: 'procurement.vendor_bill.void',           description: 'Void vendor bills',                            riskLevel: 'CRITICAL' },
  { key: 'procurement.vendor_bill.match',          description: 'Match vendor bills to PO/goods receipt',       riskLevel: 'MEDIUM' },
  { key: 'procurement.vendor_bill.match.override', description: 'Override PO/receipt/bill matching tolerance',  riskLevel: 'CRITICAL' },
  { key: 'procurement.supplier_payment.read',      description: 'Read supplier payments',                       riskLevel: 'LOW' },
  { key: 'procurement.supplier_payment.create',    description: 'Record supplier payments',                     riskLevel: 'HIGH' },
  // Team decision 2026-07-29 (GAP-03): today this is a second key required ALONGSIDE
  // create on the same endpoint — there is no separate release step, so it cannot split
  // preparer from releaser. A true two-step release flow is backlog.
  { key: 'procurement.supplier_payment.release',   description: 'Second key required with create to record supplier payments (no separate release step yet)', riskLevel: 'CRITICAL' },
  { key: 'procurement.supplier_payment.void',      description: 'Void supplier payments',                       riskLevel: 'CRITICAL' },
  { key: 'procurement.approval_policy.read',       description: 'Read vendor-bill maker-checker approval policy', riskLevel: 'LOW' },
  { key: 'procurement.approval_policy.manage',     description: 'Change vendor-bill maker-checker approval policy', riskLevel: 'CRITICAL' },
  { key: 'procurement.ap.report',                  description: 'Read accounts payable aging/reports',          riskLevel: 'LOW' },
  // Item 14 reimbursement
  { key: 'reimbursement.read',             description: 'Read all company reimbursement requests',      riskLevel: 'LOW' },
  { key: 'reimbursement.read_related',     description: 'Read reimbursement requests related to the current user', riskLevel: 'LOW' },
  { key: 'reimbursement.read_own',         description: 'Read own reimbursement requests',              riskLevel: 'LOW' },
  { key: 'reimbursement.create',           description: 'Create reimbursement requests',                riskLevel: 'MEDIUM' },
  { key: 'reimbursement.update_own_draft', description: 'Update own reimbursement drafts',              riskLevel: 'MEDIUM' },
  { key: 'reimbursement.submit',           description: 'Submit reimbursement requests for approval',   riskLevel: 'MEDIUM' },
  { key: 'reimbursement.cancel_own',       description: 'Cancel own reimbursement requests',            riskLevel: 'MEDIUM' },
  { key: 'reimbursement.approve',          description: 'Approve reimbursement requests',               riskLevel: 'HIGH' },
  { key: 'reimbursement.reject',           description: 'Reject reimbursement requests',                riskLevel: 'HIGH' },
  { key: 'reimbursement.finance_review',   description: 'Finance review of reimbursement requests',     riskLevel: 'HIGH' },
  { key: 'reimbursement.payment.record',   description: 'Record reimbursement payments',                riskLevel: 'HIGH' },
  { key: 'reimbursement.payment.void',     description: 'Void reimbursement payments',                  riskLevel: 'CRITICAL' },
  { key: 'reimbursement.duplicate.resolve',description: 'Resolve reimbursement duplicate warnings',     riskLevel: 'HIGH' },
  { key: 'reimbursement.policy.read',      description: 'Read reimbursement policy settings',           riskLevel: 'LOW' },
  { key: 'reimbursement.policy.manage',    description: 'Manage reimbursement policy settings',         riskLevel: 'HIGH' },
  { key: 'reimbursement.export',           description: 'Export reimbursement evidence',                riskLevel: 'MEDIUM' },
  // Item 15 CRM and Sales
  { key: 'crm.customer.read',        description: 'Read CRM customers',                    riskLevel: 'LOW' },
  { key: 'crm.customer.create',      description: 'Create CRM customers',                  riskLevel: 'MEDIUM' },
  { key: 'crm.customer.update',      description: 'Update CRM customers',                  riskLevel: 'MEDIUM' },
  { key: 'crm.customer.archive',     description: 'Archive CRM customers',                 riskLevel: 'MEDIUM' },
  { key: 'crm.customer.assign',      description: 'Assign CRM customer owner',             riskLevel: 'MEDIUM' },
  { key: 'crm.customer.merge',       description: 'Merge customers or re-point LINE identity', riskLevel: 'HIGH' },
  { key: 'crm.customer.export',      description: 'Export CRM customer data',              riskLevel: 'MEDIUM' },
  { key: 'crm.customer.erase',       description: 'Erase a CRM customer\'s personal data (PDPA right-to-be-forgotten)', riskLevel: 'CRITICAL' },
  { key: 'crm.contact.read',         description: 'Read CRM contacts',                     riskLevel: 'LOW' },
  { key: 'crm.contact.manage',       description: 'Create/update/archive CRM contacts',    riskLevel: 'MEDIUM' },
  { key: 'crm.lead.read',            description: 'Read CRM leads',                        riskLevel: 'LOW' },
  { key: 'crm.lead.create',          description: 'Create CRM leads',                      riskLevel: 'MEDIUM' },
  { key: 'crm.lead.update',          description: 'Update CRM leads',                      riskLevel: 'MEDIUM' },
  { key: 'crm.lead.assign',          description: 'Assign CRM leads',                      riskLevel: 'MEDIUM' },
  { key: 'crm.lead.convert',         description: 'Convert CRM leads to customers',        riskLevel: 'MEDIUM' },
  { key: 'crm.lead.disqualify',      description: 'Disqualify CRM leads',                  riskLevel: 'MEDIUM' },
  { key: 'crm.opportunity.read',     description: 'Read CRM opportunities',                riskLevel: 'LOW' },
  { key: 'crm.opportunity.create',   description: 'Create CRM opportunities',              riskLevel: 'MEDIUM' },
  { key: 'crm.opportunity.update',   description: 'Update CRM opportunities',              riskLevel: 'MEDIUM' },
  { key: 'crm.opportunity.stage_move', description: 'Move CRM opportunity stage',          riskLevel: 'MEDIUM' },
  { key: 'crm.opportunity.close',    description: 'Close CRM opportunities won/lost',      riskLevel: 'MEDIUM' },
  { key: 'crm.opportunity.reopen',   description: 'Reopen terminal CRM opportunities',     riskLevel: 'HIGH' },
  { key: 'crm.activity.read',        description: 'Read CRM activity timeline',            riskLevel: 'LOW' },
  { key: 'crm.activity.create',      description: 'Append CRM activity entries',           riskLevel: 'LOW' },
  { key: 'crm.follow_up.read',       description: 'Read CRM follow-up tasks',              riskLevel: 'LOW' },
  { key: 'crm.follow_up.create',     description: 'Create CRM follow-up tasks',            riskLevel: 'LOW' },
  { key: 'crm.follow_up.update',     description: 'Update CRM follow-up tasks',            riskLevel: 'LOW' },
  { key: 'crm.follow_up.complete',   description: 'Complete CRM follow-up tasks',          riskLevel: 'LOW' },
  { key: 'crm.pipeline.configure',   description: 'Configure CRM pipeline stages',         riskLevel: 'HIGH' },
  { key: 'crm.quotation.link',       description: 'Link CRM opportunity to quotation draft', riskLevel: 'MEDIUM' },
  { key: 'crm.report.read',          description: 'Read CRM reports/dashboard summaries',  riskLevel: 'LOW' },
  { key: 'crm.ai.read',              description: 'Read-only CRM answers for AI/LINE',     riskLevel: 'LOW' },
  // Item 15A CRM Customer OS — company LINE OA channel + inbox
  { key: 'crm.channel.read',         description: 'Read company messaging channel status',  riskLevel: 'LOW' },
  { key: 'crm.channel.manage',       description: 'Connect/rotate/disable/reveal company messaging channel credentials', riskLevel: 'CRITICAL' },
  { key: 'crm.inbox.read',           description: 'Read CRM inbox conversations and messages', riskLevel: 'LOW' },
  { key: 'crm.inbox.reply',          description: 'Send replies to customers from the CRM inbox', riskLevel: 'MEDIUM' },
  { key: 'crm.ai.assist',            description: 'Use CRM AI staff assist (summary/reply draft/insights) on inbox conversations', riskLevel: 'MEDIUM' },
  { key: 'crm.inbox.note',           description: 'Append staff-only internal notes in the CRM inbox', riskLevel: 'LOW' },
  { key: 'crm.inbox.assign',         description: 'Assign/unassign CRM inbox conversations', riskLevel: 'MEDIUM' },
  { key: 'crm.inbox.resolve',        description: 'Change CRM inbox conversation status/priority/tags incl. resolve', riskLevel: 'LOW' },
  { key: 'crm.template.read',        description: 'Read CRM message templates (quick replies)', riskLevel: 'LOW' },
  { key: 'crm.template.manage',      description: 'Create/update/archive CRM message templates', riskLevel: 'MEDIUM' },
  { key: 'crm.inbox.policy_manage',  description: 'Manage CRM inbox first-response SLA policy', riskLevel: 'HIGH' },
  // มั่งมี Flow A (spec D8) — online booking / appointment calendar
  { key: 'crm.booking.read',         description: 'Read CRM bookings/appointments',        riskLevel: 'LOW' },
  { key: 'crm.booking.create',       description: 'Create CRM bookings/appointments',      riskLevel: 'MEDIUM' },
  { key: 'crm.booking.update',       description: 'Update CRM bookings/appointments',      riskLevel: 'MEDIUM' },
  { key: 'crm.booking.cancel',       description: 'Cancel CRM bookings/appointments',      riskLevel: 'MEDIUM' },
  // Item 10C Employee Access and Role Management
  { key: 'access.employee.read',              description: 'Read employee access profiles',        riskLevel: 'LOW' },
  { key: 'access.employee.create',            description: 'Create employee access',                riskLevel: 'HIGH' },
  { key: 'access.employee.update',            description: 'Update employee access profile/role',   riskLevel: 'MEDIUM' },
  { key: 'access.employee.disable',           description: 'Disable/suspend employee access',       riskLevel: 'HIGH' },
  { key: 'access.employee.credential.issue',  description: 'Issue/regenerate employee temporary password', riskLevel: 'CRITICAL' },
  { key: 'access.employee.line_link.issue',   description: 'Issue employee LINE account-link token', riskLevel: 'MEDIUM' },
  { key: 'access.employee.line_link.revoke',  description: 'Revoke employee LINE account-link token', riskLevel: 'MEDIUM' },
  { key: 'access.role.read',                  description: 'Read company roles',                     riskLevel: 'LOW' },
  { key: 'access.role.manage',                description: 'Create/update/disable company roles',    riskLevel: 'HIGH' },
  { key: 'access.role.operational.assign',    description: 'Assign HR-approved operational roles',   riskLevel: 'HIGH' },
  { key: 'access.role.financial.assign',      description: 'Approve Finance/Accountant role assignment', riskLevel: 'CRITICAL' },
  { key: 'access.permission.read',            description: 'Read permission catalog',                riskLevel: 'LOW' },
  // Item 10C+ Phase 1: Smart Roles (capability packs, job presets, effective-access)
  { key: 'access.capability_pack.read',       description: 'Read capability pack catalog',           riskLevel: 'LOW' },
  { key: 'access.role_template.read',         description: 'Read job presets (role templates)',      riskLevel: 'LOW' },
  { key: 'access.role_template.manage',       description: 'Manage company job presets',             riskLevel: 'HIGH' },
  { key: 'access.effective.read',             description: 'Read effective access (who can do what)', riskLevel: 'MEDIUM' },
  // Item 16 Workflow Automation
  { key: 'workflow.template.read',      description: 'Read workflow templates',                riskLevel: 'LOW' },
  { key: 'workflow.rule.read',          description: 'Read workflow rules',                    riskLevel: 'LOW' },
  { key: 'workflow.rule.manage',        description: 'Create/update/disable workflow rules',   riskLevel: 'HIGH' },
  { key: 'workflow.rule.enable',        description: 'Enable workflow rules',                  riskLevel: 'HIGH' },
  { key: 'workflow.run.read',           description: 'Read workflow runs',                     riskLevel: 'LOW' },
  { key: 'workflow.run.replay',         description: 'Replay failed workflow action runs',     riskLevel: 'HIGH' },
  { key: 'workflow.task.read',          description: 'Read workflow tasks',                    riskLevel: 'LOW' },
  { key: 'workflow.task.work',          description: 'Snooze/complete/cancel workflow tasks',   riskLevel: 'MEDIUM' },
  { key: 'workflow.dead_letter.read',   description: 'Read workflow dead letters',              riskLevel: 'MEDIUM' },
  { key: 'workflow.dead_letter.replay', description: 'Replay or ignore workflow dead letters',  riskLevel: 'HIGH' },
  { key: 'workflow.webhook.manage',     description: 'Manage workflow webhook endpoints',       riskLevel: 'CRITICAL' },
  { key: 'workflow.audit.read',         description: 'Read workflow audit trail',               riskLevel: 'MEDIUM' },
  // Item 17 AI Draft and Suggestion Layer
  { key: 'ai.suggestion.read',            description: 'Read AI suggestions (company scope)',      riskLevel: 'LOW' },
  { key: 'ai.suggestion.read_own',        description: 'Read own/assigned AI suggestions',         riskLevel: 'LOW' },
  { key: 'ai.suggestion.request',         description: 'Request an AI suggestion/draft',           riskLevel: 'LOW' },
  { key: 'ai.suggestion.generate',        description: 'Run AI suggestion generation (service)',   riskLevel: 'MEDIUM' },
  { key: 'ai.suggestion.review',          description: 'Review AI suggestions',                    riskLevel: 'MEDIUM' },
  { key: 'ai.suggestion.dismiss',         description: 'Dismiss AI suggestions',                   riskLevel: 'LOW' },
  { key: 'ai.suggestion.admin',           description: 'Administer AI suggestion settings',        riskLevel: 'HIGH' },
  { key: 'ai.draft.read',                 description: 'Read AI draft artifacts/candidate actions', riskLevel: 'LOW' },
  { key: 'ai.draft.request',              description: 'Request AI draft generation',              riskLevel: 'LOW' },
  { key: 'ai.draft.review',               description: 'Validate AI candidate actions',            riskLevel: 'MEDIUM' },
  { key: 'ai.draft.create_source_draft',  description: 'Create a source-module draft from AI',     riskLevel: 'HIGH' },
  { key: 'ai.template.read',              description: 'Read AI suggestion templates',             riskLevel: 'LOW' },
  { key: 'ai.template.manage',            description: 'Manage AI suggestion template settings',   riskLevel: 'HIGH' },
  { key: 'ai.tool_invocation.read',       description: 'Read AI tool invocation logs',             riskLevel: 'MEDIUM' },
  // Item 18 Reports and BI
  { key: 'report.catalog.read',            description: 'Read curated report catalog',              riskLevel: 'LOW' },
  { key: 'report.dataset.read',            description: 'Read report dataset metadata',             riskLevel: 'LOW' },
  { key: 'report.query.run',               description: 'Run permission-checked report queries',   riskLevel: 'LOW' },
  { key: 'report.view.read',               description: 'Read own/shared report saved views',       riskLevel: 'LOW' },
  { key: 'report.view.create',             description: 'Create report saved views',                riskLevel: 'LOW' },
  { key: 'report.view.update_own',         description: 'Update own report saved views',            riskLevel: 'LOW' },
  { key: 'report.view.share',              description: 'Share report saved views company-wide',    riskLevel: 'MEDIUM' },
  { key: 'report.view.manage',             description: 'Manage shared report saved views',         riskLevel: 'MEDIUM' },
  { key: 'report.snapshot.read',           description: 'Read report snapshot metadata',            riskLevel: 'LOW' },
  { key: 'report.export',                  description: 'Export report data',                       riskLevel: 'MEDIUM' },
  { key: 'report.export.read_own',         description: 'Read own report export jobs/files',        riskLevel: 'LOW' },
  { key: 'report.export.manage',           description: 'Manage report export jobs/files',          riskLevel: 'HIGH' },
  { key: 'report.subscription.manage',     description: 'Manage scheduled report subscriptions',    riskLevel: 'HIGH' },
  { key: 'report.audit.read',              description: 'Read report audit trail',                  riskLevel: 'MEDIUM' },
  { key: 'bi.view.read',                   description: 'Read BI saved views',                      riskLevel: 'LOW' },
  { key: 'bi.view.create',                 description: 'Create BI saved views',                    riskLevel: 'LOW' },
  { key: 'bi.view.update_own',             description: 'Update own BI saved views',                riskLevel: 'LOW' },
  { key: 'bi.view.share',                  description: 'Share BI saved views',                     riskLevel: 'MEDIUM' },
  { key: 'bi.admin',                       description: 'Administer BI dataset/report settings',    riskLevel: 'HIGH' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
/**
 * Everything a customer company's OWNER holds (`ROLE_GRANTS.OWNER` is literally this list), so a
 * key is excluded here precisely when no shop may ever hold it.
 *
 * Two prefixes are platform-scoped: `system.` (partner/billing control plane) and `sales.`
 * (มั่งมี's own sales team — spec §9/R11). `sales.` had to be named explicitly: without it every
 * shop owner would inherit all seven sales keys, `sales.agent_profile.manage` among them, which
 * is the agents' national-id and bank-account record.
 */
const PLATFORM_PERMISSION_PREFIXES = ['system.', 'sales.'];
export const COMPANY_PERMISSION_KEYS = PERMISSION_KEYS.filter(
  (key) => !PLATFORM_PERMISSION_PREFIXES.some((prefix) => key.startsWith(prefix)),
);

const REPORT_BI_OWN_VIEW_GRANTS = [
  'report.catalog.read', 'report.dataset.read', 'report.query.run',
  'report.view.read', 'report.view.create', 'report.view.update_own', 'report.snapshot.read',
  'report.export.read_own', 'bi.view.read', 'bi.view.create', 'bi.view.update_own',
];

const REPORT_BI_STAFF_VIEW_GRANTS = [
  'report.catalog.read', 'report.dataset.read', 'report.query.run',
  'report.view.read', 'report.view.create', 'report.view.update_own', 'report.snapshot.read',
  'report.export.read_own', 'bi.view.read',
];

const REPORT_BI_SHARE_EXPORT_GRANTS = [
  ...REPORT_BI_OWN_VIEW_GRANTS,
  'report.view.share', 'report.export', 'bi.view.share',
];

const REPORT_BI_ADMIN_GRANTS = [
  ...REPORT_BI_SHARE_EXPORT_GRANTS,
  'report.view.manage', 'report.export.manage', 'report.subscription.manage', 'report.audit.read', 'bi.admin',
];

const REPORT_BI_AUDITOR_GRANTS = [
  'report.catalog.read', 'report.dataset.read', 'report.query.run',
  'report.view.read', 'report.snapshot.read', 'report.export', 'report.export.read_own',
  'report.audit.read', 'bi.view.read',
];

// Company-member self-service, not approval/payment authority. Persist these even while the
// reimbursement feature is OFF; the runtime entitlement gate still blocks new claims.
export const REIMBURSEMENT_SELF_SERVICE_PERMISSIONS = [
  'company.branch.read', 'attachment.read', 'attachment.create',
  'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft',
  'reimbursement.submit', 'reimbursement.cancel_own',
];

const STAFF_ROLE_GRANTS = [
  'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink', 'ai.tool.invoke', 'line.ai.query',
  'accounting.document.read_related',
  'company.branch.read', 'attachment.read', 'attachment.create',
  'dashboard.read', 'notification.read', 'notification.preference.manage',
  'expense.read_related', 'expense.read_own', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.update', 'expense.signature.self_manage',
  'reimbursement.read_related',
  'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
  'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
  'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own',
  'workflow.task.read', 'workflow.task.work',
  'ai.suggestion.read_own', 'ai.suggestion.request', 'ai.draft.read', 'ai.draft.request',
  ...REPORT_BI_STAFF_VIEW_GRANTS,
];

// Role grants: maps role key -> list of granted permission keys.
export const ROLE_GRANTS: Record<string, string[]> = {
  OWNER: COMPANY_PERMISSION_KEYS,
  SYSTEM_ADMIN: [
    'system.home_theme.manage',
    'system.shared_line_credential.manage',
    ...BILLING_PERMISSIONS,
    ...EXECUTIVE_PERMISSION_KEYS,
    'account.session.read',
    'account.password.change',
    'account.identity.link',
    'account.identity.unlink',
    'system.company_onboarding.create',
    'system.company_onboarding.read',
    'system.wht_income_category.manage',
    'system.email_delivery.read',
    'system.email_delivery.manage',
    'system.company_onboarding.regenerate_temporary_password',
    'system.line_binding.manage',
    // Item 10A partner management
    'system.partner_dashboard.read',
    'system.partner_company.create',
    'system.partner_company.update',
    'system.partner_company.lifecycle.manage',
    'system.partner_feature.manage',
    'system.partner_ai_model.manage',
    'system.partner_line_credential.manage',
    'system.partner_member.read',
    'system.partner_member.manage',
    // F2/CC7 — granted to the same role that already holds system.partner_feature.manage, so
    // minting the dedicated key changes who can do this today, not what they can do.
    'system.entitlement_exception.manage',
    // F1 launch control plane
    'system.launch_gate.read',
    'system.launch_gate.manage',
    // Step 0 identity reconciliation — platform-side repair of Company↔CompanyTaxProfile drift.
    'system.identity_reconciliation.resolve',
    // Cross-tenant privacy/offboarding case control plane; no tenant role may receive it.
    'system.data_rights.manage',
    // Sales console: the Owner is the single admin, so every sales authority lands here too —
    // including the PII key neither sales role may ever hold (R5/R11/S10).
    ...SALES_PERMISSION_KEYS, 'sales.demo_link.create',
  ],
  MANGMEE_EXECUTIVE: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'system.executive.read',
  ],
  MANGMEE_EXECUTIVE_EXPORT: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'system.executive.export',
  ],
  MANGMEE_EXECUTIVE_CONTACT: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'system.executive.contact.read',
  ],
  MANGMEE_EXECUTIVE_COMPANY_NOTE: [
    'account.session.read', 'account.password.change', 'account.identity.link', COMPANY_TEAM_NOTE_MANAGE_PERMISSION,
  ],
  // ── มั่งมี sales team (spec §5). Platform-tenant memberships, never a shop's. ──
  // S29 is the whole point of these two lists: no business permission of ANY kind, so the
  // platform tenant's own workspace has nothing to show them and the web gate sends them to
  // /sales. The account.* four are exactly what signing in needs — `/v1/auth/me`,
  // `me/companies` and legal acceptance all require `account.session.read`, the forced
  // temp-password change requires `account.password.change`, and the registry spec requires
  // every password-changing role to be able to link its own LINE account.
  // `account.identity.unlink` stays out, matching every other role.
  MANGMEE_SALES_LEAD: [
    'account.session.read', 'account.password.change', 'account.identity.link',
    'sales.demo_link.create', 'sales.console.read', 'sales.company.search', 'sales.deal.create', 'sales.deal.approve',
    'sales.team.manage', 'sales.report.read', 'sales.event.manage',
  ],
  MANGMEE_SALES: [
    'account.session.read', 'account.password.change', 'account.identity.link',
    'sales.demo_link.create', 'sales.console.read', 'sales.company.search', 'sales.deal.create',
  ],
  COMPANY_VIEW: [
    ...REIMBURSEMENT_SELF_SERVICE_PERMISSIONS,
    'account.session.read',
    'account.password.change',
    'account.identity.link',
    'account.identity.unlink',
    'company.setup.read',
    'company.settings.view',
    'dashboard.read',
    'notification.read',
    'notification.preference.manage',
    'crm.inbox.read',
    'accounting.quotation.read',
    'accounting.invoice.read',
    'crm.customer.read',
    'crm.report.read',
    'expense.read',
    'expense.evidence.read',
    'expense.read_related', 'expense.read_own',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    'reimbursement.read',
    'ledger.journal.read',
    'accounting.document.read',
    'report.catalog.read',
    'ledger.report.read',
    'ledger.period.read',
    'access.role.read',
    'admin.role.read',
    'procurement.purchase_order.read',
  ],
  ADMIN: [
    'account.session.read',
    'account.password.change',
    'accounting.document.read_related',
    'expense.read_related',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    'account.identity.link',
    'account.identity.unlink',
    'company.setup.read',
    'company.setup.manage',
    'company.settings.view',
    'admin.user.read',
    'admin.user.manage',
    'admin.role.read',
    // Team decision 2026-07-28: a default ADMIN cannot hand out permissions.
    // admin.role.manage / access.role.manage / access.role_template.manage are
    // owner-delegated — the owner assigns a custom role carrying them to the
    // specific admin they trust with role management.
    'audit.log.read',
    'ai.tool.invoke',
    'company.branch.read',
    'company.branch.manage',
    'attachment.read',
    'attachment.create',
    'attachment.delete',
    'document.sequence.read',
    'document.sequence.manage',
    'outbox.event.read',
    'inventory.product.read',
    'inventory.product.manage',
    'inventory.location.read',
    'inventory.location.manage',
    'inventory.movement.read',
    'inventory.movement.create',
    'inventory.movement.adjust',
    'inventory.stock_count.create',
    'inventory.report.read',
    'inventory.label.manage',
    'dashboard.read',
    'dashboard.configure',
    'dashboard.snapshot.generate',
    'notification.read',
    'notification.preference.manage',
    'notification.rule.manage',
    'notification.delivery.read',
    'notification.delivery.retry',
    'line.ai.query',
    // Item 09 – Owner decision 2026-07-26: ADMIN works expenses owner-equal (create/update/review/
    // confirm/reject/void/payments/duplicates, incl. substitute-receipt prepare and approve).
    // Kept out: expense.signature.approve stays owner-level, expense.ocr.request is redundant with
    // expense.review at the extraction boundary, expense.ai.verify stays service-lane.
    'expense.read', 'expense.evidence.read', 'expense.read_own', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload',
    'expense.update', 'expense.review', 'expense.confirm', 'expense.reject', 'expense.void', 'expense.delete',
    'expense.payment.record', 'expense.duplicate.resolve',
    'expense.disbursement.read', 'expense.disbursement.prepare', 'expense.disbursement.approve',
    'expense.disbursement.pay', 'expense.disbursement.issue',
    'expense.category.manage', 'accounting.revenue_category.manage', 'expense.signature.self_manage', 'expense.signature.manage', 'expense.export',
    // Vendor-address spec CON-2 / §12.1: an expense save auto-creates and fills counterparties, and
    // the toast that announces it links to the counterparty page. ADMIN held NO counterparty key at
    // all, so that link was a dead end for the role that works expenses owner-equal.
    'accounting.counterparty.read', 'accounting.counterparty.manage',
    // Item 13 banking – Admin can read and manage accounts only
    'bank.account.read', 'bank.account.manage',
    'bank.statement.read', 'bank.match.read',
    'bank.adjustment.read', 'bank.reconciliation.read', 'bank.cash.read',
    // Item 12 procurement – Admin configures supplier defaults and reads all procurement data
    'procurement.supplier.read', 'procurement.supplier.manage', 'procurement.supplier.bank.read', 'procurement.supplier.bank.manage',
    'procurement.purchase_request.read', 'procurement.purchase_order.read', 'procurement.purchase_order.manage',
    'procurement.goods_receipt.read', 'procurement.vendor_bill.read', 'procurement.supplier_payment.read', 'procurement.ap.report',
    'procurement.approval_policy.read',
    // Item 14 reimbursement – Admin reads, owns policy, and approves (team decision 2026-07-28:
    // reimbursement approvers are OWNER / ADMIN / MANAGER). Owner decision 2026-09-19 supersedes
    // that decision's "paying stays FINANCE-only" half (D1/A2): an approver can record payment
    // directly, so Admin also gets payment.record/payment.void. finance_review and
    // duplicate.resolve are NOT widened — those stay FINANCE/OWNER only.
    'reimbursement.read', 'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft',
    'reimbursement.submit', 'reimbursement.cancel_own', 'reimbursement.approve', 'reimbursement.reject',
    'reimbursement.payment.record', 'reimbursement.payment.void',
    'reimbursement.policy.read', 'reimbursement.policy.manage', 'reimbursement.export',
    // Item 15 CRM – Admin manages all CRM records and settings
    'crm.customer.read', 'crm.customer.create', 'crm.customer.update', 'crm.customer.archive', 'crm.customer.assign', 'crm.customer.merge', 'crm.customer.export', 'crm.customer.erase',
    'crm.contact.read', 'crm.contact.manage',
    'crm.lead.read', 'crm.lead.create', 'crm.lead.update', 'crm.lead.assign', 'crm.lead.convert', 'crm.lead.disqualify',
    'crm.opportunity.read', 'crm.opportunity.create', 'crm.opportunity.update', 'crm.opportunity.stage_move', 'crm.opportunity.close', 'crm.opportunity.reopen',
    'crm.activity.read', 'crm.activity.create',
    'crm.follow_up.read', 'crm.follow_up.create', 'crm.follow_up.update', 'crm.follow_up.complete',
    'crm.pipeline.configure', 'crm.quotation.link', 'crm.report.read', 'crm.ai.read',
    // Item 15A – Admin manages the company LINE OA channel and works the inbox
    'crm.channel.read', 'crm.channel.manage', 'crm.inbox.read',
    'crm.inbox.reply', 'crm.ai.assist', 'crm.inbox.note', 'crm.inbox.assign', 'crm.inbox.resolve',
    'crm.template.read', 'crm.template.manage', 'crm.inbox.policy_manage',
    // มั่งมี Flow A (spec D8) – Admin manages bookings
    'crm.booking.read', 'crm.booking.create', 'crm.booking.update', 'crm.booking.cancel',
    // Item 10C – Admin manages employee access and roles, except protected owner/system-role changes
    'access.employee.read', 'access.employee.create', 'access.employee.update', 'access.employee.disable',
    'access.employee.credential.issue', 'access.employee.line_link.issue', 'access.employee.line_link.revoke',
    'access.role.read', 'access.permission.read',
    // Item 10C+ Phase 1 – Admin builds roles from packs/presets and reads the who-can-do-what matrix
    'access.capability_pack.read', 'access.role_template.read', 'access.effective.read',
    // Item 16 Workflow Automation – Admin manages rules/webhooks; source-module permissions still gate templates
    'workflow.template.read', 'workflow.rule.read', 'workflow.rule.manage', 'workflow.rule.enable',
    'workflow.run.read', 'workflow.run.replay', 'workflow.task.read', 'workflow.task.work',
    'workflow.dead_letter.read', 'workflow.dead_letter.replay', 'workflow.webhook.manage', 'workflow.audit.read',
    // Item 17 AI Draft/Suggestion – Admin has all AI keys; source-module draft creation still needs source permission
    'ai.suggestion.read', 'ai.suggestion.read_own', 'ai.suggestion.request', 'ai.suggestion.generate',
    'ai.suggestion.review', 'ai.suggestion.dismiss', 'ai.suggestion.admin',
    'ai.draft.read', 'ai.draft.request', 'ai.draft.review', 'ai.draft.create_source_draft',
    'ai.template.read', 'ai.template.manage', 'ai.tool_invocation.read',
    // Item 18 Reports/BI – Admin can manage catalog/admin settings; source permissions still gate data
    ...REPORT_BI_ADMIN_GRANTS,
  ],
  MANAGER: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink', 'company.setup.read', 'ai.tool.invoke', 'line.ai.query',
    'company.branch.read', 'attachment.read', 'attachment.create',
    'inventory.product.read', 'inventory.location.read', 'inventory.movement.read', 'inventory.report.read',
    'dashboard.read', 'notification.read', 'notification.preference.manage',
    'accounting.counterparty.read', 'accounting.document.read', 'accounting.quotation.read',
    'accounting.quotation.approve', 'accounting.invoice.read', 'accounting.billing_note.read',
    'accounting.receipt.read', 'accounting.tax_invoice.read', 'accounting.credit_note.read',
    'accounting.debit_note.read', 'accounting.payment.read',
    'expense.read', 'expense.read_related', 'expense.evidence.read', 'expense.read_own', 'expense.create',
    'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.update', 'expense.signature.self_manage',
    'expense.review', 'expense.duplicate.resolve',
    'expense.disbursement.read', 'expense.disbursement.approve',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    // Item 10
    'ledger.report.read', 'ledger.period.read',
    // Item 11 – Manager sees tax summary
    'tax.profile.read', 'tax.config.read', 'tax.period.read', 'tax.report.read',
    'tax.certificate.read', 'tax.review_issue.read',
    // Item 13 banking – Manager sees cash position only
    'bank.cash.read',
    // Item 12 procurement – Manager/Owner approves purchase requests and purchase orders
    'procurement.supplier.read', 'procurement.purchase_request.read', 'procurement.purchase_request.approve',
    'procurement.purchase_order.read', 'procurement.purchase_order.approve',
    // Item 14 reimbursement – Manager approves/rejects team requests. Owner decision 2026-09-19
    // (D1/A2, supersedes team decision 2026-07-28 "paying stays FINANCE-only"): an approver can
    // record payment directly, so Manager also gets payment.record/payment.void.
    'reimbursement.read', 'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft',
    'reimbursement.submit', 'reimbursement.cancel_own', 'reimbursement.approve', 'reimbursement.reject',
    'reimbursement.payment.record', 'reimbursement.payment.void',
    // Item 15 CRM – Manager manages team pipeline (scope enforced server-side)
    'crm.customer.read', 'crm.customer.assign',
    'crm.contact.read',
    'crm.lead.read', 'crm.lead.create', 'crm.lead.update', 'crm.lead.assign', 'crm.lead.convert', 'crm.lead.disqualify',
    'crm.opportunity.read', 'crm.opportunity.create', 'crm.opportunity.update', 'crm.opportunity.stage_move', 'crm.opportunity.close', 'crm.opportunity.reopen',
    'crm.activity.read', 'crm.activity.create',
    'crm.follow_up.read', 'crm.follow_up.create', 'crm.follow_up.update', 'crm.follow_up.complete',
    'crm.quotation.link', 'crm.report.read', 'crm.ai.read',
    // Item 15A – Manager reads channel status and works the inbox
    'crm.channel.read', 'crm.inbox.read',
    'crm.inbox.reply', 'crm.ai.assist', 'crm.inbox.note', 'crm.inbox.assign', 'crm.inbox.resolve',
    'crm.template.read', 'crm.template.manage',
    // มั่งมี Flow A (spec D8) – Manager manages bookings
    'crm.booking.read', 'crm.booking.create', 'crm.booking.update', 'crm.booking.cancel',
    // Item 10C – Manager reads employee access and edits day-to-day assignments
    // (role/status/branch on สิทธิ์รายบุคคล). Privileged-role assignment and status changes
    // are blocked in the use-cases for requesters without access.role.manage, so Manager
    // cannot escalate anyone (or lock out Admin/Owner). Role definitions and credential
    // issuance stay Owner/Admin-only.
    'access.employee.read', 'access.employee.update', 'access.employee.disable', 'access.role.read',
    // Item 10C+ Phase 1 – Manager reads packs/presets to understand access
    'access.capability_pack.read', 'access.role_template.read',
    // Item 16 Workflow Automation – Manager reads runs, works team tasks
    'workflow.run.read', 'workflow.task.read', 'workflow.task.work',
    // Item 17 AI Draft/Suggestion – Manager reviews team-scoped suggestions (ABAC narrows scope)
    'ai.suggestion.read', 'ai.suggestion.read_own', 'ai.suggestion.request', 'ai.suggestion.review', 'ai.suggestion.dismiss',
    'ai.draft.read', 'ai.draft.request', 'ai.draft.review',
    // Item 18 Reports/BI – source permissions still narrow visible datasets
    ...REPORT_BI_OWN_VIEW_GRANTS,
  ],
  HR: [
    ...STAFF_ROLE_GRANTS,
    'access.employee.read', 'access.employee.create', 'access.employee.update', 'access.employee.disable',
    'access.role.read', 'access.role.operational.assign',
  ],
  SALES: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink', 'ai.tool.invoke', 'line.ai.query',
    'company.branch.read', 'attachment.read', 'attachment.create',
    'inventory.product.read',
    'dashboard.read', 'notification.read', 'notification.preference.manage',
    'accounting.counterparty.read', 'accounting.document.read_related', 'accounting.quotation.read', 'accounting.quotation.create',
    'accounting.quotation.update', 'accounting.quotation.submit_approval', 'accounting.quotation.issue',
    'accounting.invoice.read', 'accounting.billing_note.read', 'accounting.payment.read',
    'expense.read_related', 'expense.read_own', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.update', 'expense.signature.self_manage',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own',
    // Item 15 CRM – Sales owns own/assigned records (scope enforced server-side)
    'crm.customer.read', 'crm.customer.create', 'crm.customer.update',
    'crm.contact.read', 'crm.contact.manage',
    'crm.lead.read', 'crm.lead.create', 'crm.lead.update', 'crm.lead.convert', 'crm.lead.disqualify',
    'crm.opportunity.read', 'crm.opportunity.create', 'crm.opportunity.update', 'crm.opportunity.stage_move', 'crm.opportunity.close',
    'crm.activity.read', 'crm.activity.create',
    'crm.follow_up.read', 'crm.follow_up.create', 'crm.follow_up.update', 'crm.follow_up.complete',
    'crm.quotation.link', 'crm.report.read', 'crm.ai.read',
    // Item 15A – Sales works the inbox scoped to own/assigned + unassigned pickup
    // (no crm.inbox.assign: self pickup/release rides on reply per spec §13)
    'crm.inbox.read',
    'crm.inbox.reply', 'crm.ai.assist', 'crm.inbox.note', 'crm.inbox.resolve',
    'crm.template.read',
    // มั่งมี Flow A (spec D8) – Sales books appointments for customers, no cancel/update of others'
    'crm.booking.read', 'crm.booking.create',
    // Item 16 Workflow Automation – Sales works own workflow tasks
    'workflow.task.read', 'workflow.task.work',
    // Item 17 AI Draft/Suggestion – Sales requests/reviews own Sales/CRM suggestions
    'ai.suggestion.read_own', 'ai.suggestion.request', 'ai.suggestion.dismiss',
    'ai.draft.read', 'ai.draft.request', 'ai.draft.review',
    // Item 18 Reports/BI – sales/CRM datasets only through source permissions
    ...REPORT_BI_OWN_VIEW_GRANTS,
  ],
  INVENTORY: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink', 'ai.tool.invoke', 'line.ai.query',
    'accounting.document.read_related',
    'company.branch.read', 'attachment.read', 'attachment.create',
    'inventory.product.read', 'inventory.location.read', 'inventory.movement.read',
    'inventory.movement.create', 'inventory.movement.adjust', 'inventory.stock_count.create',
    'inventory.report.read', 'inventory.label.manage',
    'dashboard.read', 'notification.read', 'notification.preference.manage',
    'expense.read_related', 'expense.read_own', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.update', 'expense.signature.self_manage',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own',
    // Item 12 procurement – Inventory receives goods against issued purchase orders
    'procurement.purchase_order.read', 'procurement.goods_receipt.read', 'procurement.goods_receipt.create',
    // Item 16 Workflow Automation – Inventory works own workflow tasks
    'workflow.task.read', 'workflow.task.work',
    // Item 17 AI Draft/Suggestion – Inventory requests/reviews own inventory suggestions
    'ai.suggestion.read_own', 'ai.suggestion.request', 'ai.suggestion.dismiss',
    'ai.draft.read', 'ai.draft.request', 'ai.draft.review',
    // Item 18 Reports/BI – inventory datasets only through source permissions
    ...REPORT_BI_OWN_VIEW_GRANTS,
  ],
  FINANCE: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink', 'company.setup.read', 'ai.tool.invoke', 'line.ai.query',
    'company.branch.read', 'attachment.read', 'attachment.create', 'document.sequence.read',
    'inventory.product.read', 'inventory.location.read', 'inventory.movement.read', 'inventory.report.read',
    'dashboard.read', 'notification.read', 'notification.preference.manage',
    'accounting.counterparty.read', 'accounting.counterparty.manage',
    'accounting.document.read', 'accounting.document.create', 'accounting.document.update',
    'accounting.document.issue', 'accounting.document.void', 'accounting.document.export',
    'accounting.quotation.read', 'accounting.quotation.create', 'accounting.quotation.update',
    'accounting.quotation.submit_approval', 'accounting.quotation.approve',
    'accounting.quotation.issue', 'accounting.quotation.void',
    'accounting.invoice.read', 'accounting.invoice.create', 'accounting.invoice.update',
    'accounting.invoice.issue', 'accounting.invoice.void',
    'accounting.billing_note.read', 'accounting.billing_note.create', 'accounting.billing_note.update',
    'accounting.billing_note.issue', 'accounting.billing_note.void',
    'accounting.receipt.read', 'accounting.receipt.create', 'accounting.receipt.update',
    'accounting.receipt.issue', 'accounting.receipt.void',
    'accounting.tax_invoice.read', 'accounting.tax_invoice.issue', 'accounting.tax_invoice.void',
    // Step 0 §10: the role that issues tax invoices is the one that has to unblock a credit note
    // against a legacy one. Listed explicitly — this list is enumerated, so a new key added to
    // pack.tax_invoice.issue does not reach FINANCE on its own.
    'accounting.tax_document_buyer_evidence.manage',
    'accounting.credit_note.read', 'accounting.credit_note.create', 'accounting.credit_note.issue', 'accounting.credit_note.void',
    'accounting.debit_note.read', 'accounting.debit_note.create', 'accounting.debit_note.issue', 'accounting.debit_note.void',
    'accounting.payment.read', 'accounting.payment.create', 'accounting.payment.update', 'accounting.payment.void',
    // Step 0 §10: Finance reads the VAT registration status it depends on but does not answer it.
    'company.vat_registration.read',
    // Item 09 – Finance has full expense access except owner-level signature approval
    'expense.read', 'expense.read_related', 'expense.evidence.read', 'expense.read_own', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    'expense.update', 'expense.review', 'expense.confirm', 'expense.reject', 'expense.void', 'expense.delete',
    'expense.payment.record', 'expense.duplicate.resolve', 'expense.ocr.request', 'expense.ai.verify',
    'expense.disbursement.read', 'expense.disbursement.prepare', 'expense.disbursement.approve',
    'expense.disbursement.pay', 'expense.disbursement.issue',
    'expense.category.manage', 'accounting.revenue_category.manage', 'expense.signature.self_manage', 'expense.signature.manage', 'expense.export',
    // Item 10 – Finance can read ledger and create draft manual journals
    'ledger.account.read', 'ledger.journal.read', 'journal.entry.create',
    'ledger.posting-rule.read', 'ledger.report.read', 'ledger.period.read', 'ledger.export',
    // Item 11 – Finance prepares and exports tax reports, issues/voids certificates
    'tax.profile.read',
    'tax.config.read',
    'tax.period.read',
    'tax.event.read', 'tax.event.sync',
    'tax.report.read', 'tax.report.recompute', 'tax.report.export',
    'tax.filing.mark_filed', 'tax.filing.mark_paid',
    'tax.certificate.read', 'tax.certificate.issue', 'tax.certificate.void',
    'wht.certificate.read', 'wht.external_certificate.link', 'wht.certificate.issue', 'wht.certificate.correct',
    'wht.pnd53.read', 'wht.pnd53.prepare',
    'tax.review_issue.read', 'tax.review_issue.resolve',
    // Item 13 banking – Finance has all except approve, complete, reopen
    'bank.account.read', 'bank.account.manage', 'bank.account.sensitive_read',
    'bank.statement.read', 'bank.statement.import', 'bank.statement.manual_line', 'bank.statement.void',
    'bank.match.read', 'bank.match.suggest', 'bank.match.confirm', 'bank.match.unmatch', 'bank.match.override',
    'bank.adjustment.read', 'bank.adjustment.create', 'bank.adjustment.void',
    'bank.reconciliation.read', 'bank.reconciliation.create', 'bank.reconciliation.export',
    'bank.cash.read',
    // Item 12 procurement – Finance/AP owns suppliers, vendor bills, matching, payments, aging
    'procurement.supplier.read', 'procurement.supplier.manage', 'procurement.supplier.bank.read', 'procurement.supplier.bank.manage',
    'procurement.purchase_request.read', 'procurement.purchase_request.create',
    'procurement.purchase_order.read', 'procurement.purchase_order.create', 'procurement.purchase_order.issue',
    'procurement.goods_receipt.read',
    'procurement.vendor_bill.read', 'procurement.vendor_bill.create', 'procurement.vendor_bill.direct_entry',
    'procurement.vendor_bill.approve', 'procurement.vendor_bill.void', 'procurement.vendor_bill.match', 'procurement.vendor_bill.match.override',
    'procurement.supplier_payment.read', 'procurement.supplier_payment.create', 'procurement.supplier_payment.release', 'procurement.supplier_payment.void',
    'procurement.ap.report', 'procurement.approval_policy.read',
    // Item 14 reimbursement – Finance owns review, payment, duplicates, export
    'reimbursement.read', 'reimbursement.read_own', 'reimbursement.create',
    'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own',
    'reimbursement.finance_review', 'reimbursement.payment.record', 'reimbursement.payment.void',
    'reimbursement.duplicate.resolve', 'reimbursement.policy.read', 'reimbursement.export',
    // Item 15 CRM – Finance reads customer/opportunity context for accounting
    'crm.customer.read', 'crm.contact.read', 'crm.opportunity.read', 'crm.activity.read', 'crm.follow_up.read', 'crm.report.read',
    // Item 16 Workflow Automation – Finance reads runs relevant to its own permissions, works own tasks
    'workflow.run.read', 'workflow.task.read', 'workflow.task.work',
    // Item 17 AI Draft/Suggestion – Finance reviews finance/tax/accounting suggestions
    'ai.suggestion.read', 'ai.suggestion.read_own', 'ai.suggestion.request', 'ai.suggestion.review', 'ai.suggestion.dismiss',
    'ai.draft.read', 'ai.draft.request', 'ai.draft.review',
    // Item 18 Reports/BI – finance can export allowed finance datasets
    ...REPORT_BI_SHARE_EXPORT_GRANTS,
  ],
  ACCOUNTANT: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink', 'company.setup.read', 'audit.log.read', 'ai.tool.invoke', 'line.ai.query',
    'company.branch.read', 'attachment.read', 'attachment.create', 'document.sequence.read', 'outbox.event.read',
    'inventory.product.read', 'inventory.location.read', 'inventory.movement.read', 'inventory.report.read',
    'dashboard.read', 'notification.read', 'notification.preference.manage',
    'accounting.counterparty.read', 'accounting.document.read', 'accounting.document.export',
    'accounting.quotation.read', 'accounting.invoice.read', 'accounting.billing_note.read',
    'accounting.receipt.read', 'accounting.tax_invoice.read', 'accounting.credit_note.read',
    'accounting.debit_note.read', 'accounting.payment.read',
    'expense.read', 'expense.read_related', 'expense.evidence.read', 'expense.read_own', 'expense.create',
    'expense.receipt.upload', 'expense.receipt.line_upload', 'expense.update', 'expense.signature.self_manage', 'expense.export',
    'expense.disbursement.read', 'expense.disbursement.issue',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    // Item 10 – Accountant has full ledger access
    'ledger.account.read', 'ledger.account.manage',
    'ledger.journal.read', 'journal.entry.create', 'journal.entry.post', 'journal.entry.reverse',
    'ledger.posting-rule.read', 'ledger.posting-rule.manage',
    'ledger.report.read', 'ledger.period.read', 'ledger.period.close', 'ledger.period.unclose',
    'ledger.export',
    // Item 11 – Accountant has full tax access
    // Step 0 §10: VAT registration is the accountant's answer to give — they hold
    // tax.profile.manage already. company.legal_identity.* is deliberately NOT here: it stays
    // owner-only until QP2 is answered, and widening a grant later is reversible in one line
    // while narrowing one takes an access review.
    'company.vat_registration.read', 'company.vat_registration.manage',
    'tax.profile.read', 'tax.profile.manage',
    'tax.config.read', 'tax.config.manage',
    'tax.period.read', 'tax.period.manage',
    'tax.event.read', 'tax.event.sync',
    'tax.report.read', 'tax.report.recompute', 'tax.report.export',
    'tax.filing.mark_filed', 'tax.filing.mark_paid',
    'tax.certificate.read', 'tax.certificate.issue', 'tax.certificate.void',
    'wht.certificate.read', 'wht.external_certificate.link', 'wht.certificate.issue', 'wht.certificate.correct',
    'wht.pnd53.read', 'wht.pnd53.prepare',
    'tax.review_issue.read', 'tax.review_issue.resolve',
    'tax.adjustment.create',
    // Item 13 banking – Accountant has full banking access
    'bank.account.read',
    'bank.statement.read', 'bank.match.read', 'bank.match.confirm', 'bank.match.unmatch', 'bank.match.override',
    'bank.adjustment.read', 'bank.adjustment.approve', 'bank.adjustment.void',
    'bank.reconciliation.read', 'bank.reconciliation.create', 'bank.reconciliation.complete',
    'bank.reconciliation.reopen', 'bank.reconciliation.export', 'bank.cash.read',
    // Item 12 procurement – Accountant reviews tax/ledger/exception context and AP reports
    'procurement.supplier.read', 'procurement.purchase_order.read', 'procurement.goods_receipt.read',
    'procurement.vendor_bill.read', 'procurement.supplier_payment.read', 'procurement.ap.report',
    // Item 14 reimbursement – Accountant reviews and exports
    'reimbursement.read', 'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft',
    'reimbursement.submit', 'reimbursement.cancel_own', 'reimbursement.finance_review', 'reimbursement.export',
    // Item 15 CRM – Accountant reads CRM-to-accounting source context
    'crm.customer.read', 'crm.contact.read', 'crm.opportunity.read', 'crm.activity.read', 'crm.report.read',
    // Item 16 Workflow Automation – Accountant reads runs/audit relevant to its own permissions, works own tasks
    'workflow.run.read', 'workflow.task.read', 'workflow.task.work', 'workflow.audit.read',
    // Item 17 AI Draft/Suggestion – Accountant reviews accounting/tax suggestions and reads tool logs
    'ai.suggestion.read', 'ai.suggestion.read_own', 'ai.suggestion.request', 'ai.suggestion.review', 'ai.suggestion.dismiss',
    'ai.draft.read', 'ai.draft.request', 'ai.draft.review', 'ai.tool_invocation.read',
    // Item 18 Reports/BI – accountant can export allowed finance/audit datasets
    ...REPORT_BI_SHARE_EXPORT_GRANTS,
  ],
  MARKETING: [
    'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink', 'ai.tool.invoke', 'line.ai.query',
    'accounting.document.read_related',
    'company.branch.read', 'attachment.read', 'attachment.create',
    'inventory.product.read',
    'dashboard.read', 'notification.read', 'notification.preference.manage',
    'expense.read_related', 'expense.read_own', 'expense.create', 'expense.receipt.upload',
    'expense.receipt.line_upload', 'expense.update', 'expense.signature.self_manage',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own',
    // Item 15 CRM – Marketing reads permitted customer/segment context
    'crm.customer.read', 'crm.report.read', 'crm.ai.read',
    // Item 16 Workflow Automation – Marketing works own workflow tasks
    'workflow.task.read', 'workflow.task.work',
    // Item 17 AI Draft/Suggestion – Marketing requests own marketing-safe suggestions
    'ai.suggestion.read_own', 'ai.suggestion.request', 'ai.draft.read', 'ai.draft.request',
    // Item 18 Reports/BI – marketing-safe datasets only through source permissions
    ...REPORT_BI_OWN_VIEW_GRANTS,
  ],
  STAFF: STAFF_ROLE_GRANTS,
  AUDITOR_READONLY: [
    ...REIMBURSEMENT_SELF_SERVICE_PERMISSIONS,
    'account.session.read', 'account.password.change', 'account.identity.link', 'account.identity.unlink', 'company.setup.read', 'audit.log.read', 'ai.tool.invoke', 'line.ai.query',
    'document.sequence.read', 'outbox.event.read',
    'inventory.product.read', 'inventory.location.read', 'inventory.movement.read', 'inventory.report.read',
    'dashboard.read', 'notification.read', 'notification.delivery.read',
    'accounting.counterparty.read', 'accounting.document.read', 'accounting.document.export',
    'accounting.quotation.read', 'accounting.invoice.read', 'accounting.billing_note.read',
    'accounting.receipt.read', 'accounting.tax_invoice.read', 'accounting.credit_note.read',
    'accounting.debit_note.read', 'accounting.payment.read',
    'expense.read', 'expense.read_related', 'expense.evidence.read', 'expense.read_own', 'expense.export',
    'reimbursement.read_related',
    'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
    'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related', 'procurement.supplier_payment.read_related',
    // Item 10 – Auditor can read all ledger data and export
    'ledger.account.read', 'ledger.journal.read', 'ledger.posting-rule.read',
    'ledger.report.read', 'ledger.period.read', 'ledger.export',
    // Item 11 – Auditor reads all tax data and exports
    'tax.profile.read', 'tax.config.read', 'tax.period.read', 'tax.event.read',
    'tax.report.read', 'tax.report.export',
    'tax.certificate.read', 'tax.review_issue.read',
    // Item 13 banking – Auditor reads all banking data
    'bank.account.read', 'bank.statement.read', 'bank.match.read',
    'bank.adjustment.read', 'bank.reconciliation.read', 'bank.reconciliation.export', 'bank.cash.read',
    // Item 12 procurement – Auditor reads all non-sensitive procurement data
    'procurement.supplier.read', 'procurement.purchase_request.read', 'procurement.purchase_order.read',
    'procurement.goods_receipt.read', 'procurement.vendor_bill.read', 'procurement.supplier_payment.read', 'procurement.ap.report',
    'procurement.approval_policy.read',
    // Audit authority remains read/export; own requests use the universal baseline above.
    'reimbursement.read', 'reimbursement.export',
    // Item 15 CRM – Auditor reads all CRM records and exports customers
    'crm.customer.read', 'crm.customer.export', 'crm.contact.read', 'crm.lead.read',
    'crm.opportunity.read', 'crm.activity.read', 'crm.follow_up.read', 'crm.report.read',
    // Item 15A – Auditor reads channel status (masked) and the inbox
    'crm.channel.read', 'crm.inbox.read', 'crm.template.read',
    // Item 10C – Auditor reads masked employee/role data
    'access.employee.read', 'access.role.read', 'access.permission.read',
    // Item 10C+ Phase 1 – Auditor reads packs/presets and the who-can-do-what matrix
    'access.capability_pack.read', 'access.role_template.read', 'access.effective.read',
    // Item 16 Workflow Automation – Auditor reads rules/runs/dead letters/audit without mutation
    'workflow.template.read', 'workflow.rule.read', 'workflow.run.read', 'workflow.dead_letter.read', 'workflow.audit.read',
    // Item 17 AI Draft/Suggestion – Auditor reads suggestions, drafts, templates, tool logs without mutation
    'ai.suggestion.read', 'ai.suggestion.read_own', 'ai.draft.read', 'ai.template.read', 'ai.tool_invocation.read',
    // Item 18 Reports/BI – auditor can query/export allowed audit-safe datasets
    ...REPORT_BI_AUDITOR_GRANTS,
  ],
};

// `name` is an identifier other code compares (a company's copy of a standard role starts with it), so it
// stays as it is and each screen prints its own Thai name by key. `description` is read by the shop
// under the role's title on the role page, and copied into the company's copy when it edits a standard
// role: it says in plain Thai who the role is for and the kind of work it does.
export const SYSTEM_ROLES: Array<{ key: string; name: string; description: string }> = [
  { key: 'OWNER',           name: 'Owner',          description: 'มีทุกสิทธิ์ที่บริษัทนี้ใช้ได้' },
  { key: 'SYSTEM_ADMIN',    name: 'System Admin',   description: 'สำหรับเจ้าหน้าที่ของมั่งมีที่ดูแลระบบ ไม่ใช่บทบาทของพนักงานในร้าน' },
  { key: 'COMPANY_VIEW',    name: 'Company owner',  description: 'สำหรับผู้ที่ต้องการดูภาพรวมของบริษัทโดยไม่แก้ไขข้อมูล เช่น ลูกค้า เอกสารขาย ค่าใช้จ่าย บัญชี และรายงาน' },
  { key: 'ADMIN',           name: 'Admin',           description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.ADMIN}: ตั้งค่าบริษัท สาขา พนักงาน และงานประจำวันของร้าน` },
  { key: 'MANAGER',         name: 'Manager',         description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.MANAGER}: ดูแลทีมและอนุมัติงาน เช่น ใบขอซื้อและการเบิกจ่าย` },
  { key: 'HR',              name: 'HR',              description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.HR}: เพิ่ม แก้ไข และปิดบัญชีพนักงาน และกำหนดบทบาทให้พนักงานได้บางบทบาท` },
  { key: 'SALES',           name: 'Sales',           description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.SALES}: ดูแลลูกค้าและทำใบเสนอราคา` },
  { key: 'INVENTORY',       name: 'Inventory',       description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.INVENTORY}: รับ-จ่ายสินค้า นับและปรับสต๊อก และบันทึกรับของ` },
  { key: 'FINANCE',         name: 'Finance',         description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.FINANCE}: ออกเอกสารขาย รับเงิน จ่ายเงิน กระทบยอดธนาคาร และเตรียมภาษี` },
  { key: 'ACCOUNTANT',      name: 'Accountant',      description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.ACCOUNTANT}: ลงบัญชี ปิดงวด ทำภาษี และกระทบยอดธนาคาร` },
  { key: 'MARKETING',       name: 'Marketing',       description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.MARKETING}: ดูข้อมูลลูกค้าและรายงาน` },
  { key: 'STAFF',           name: 'Staff',           description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.STAFF}ทั่วไป: บันทึกค่าใช้จ่ายและขอเบิกของตัวเอง` },
  { key: 'AUDITOR_READONLY',name: 'Auditor (Read-only)', description: `สำหรับ${THAI_SYSTEM_ROLE_NAMES.AUDITOR_READONLY}: ดูข้อมูลของบริษัทเพื่อตรวจสอบโดยไม่แก้ไข` },
  { key: 'MANGMEE_EXECUTIVE', name: THAI_SYSTEM_ROLE_NAMES.MANGMEE_EXECUTIVE, description: 'สำหรับผู้บริหารมั่งมีที่ดูรายงานผู้บริหาร' },
  { key: 'MANGMEE_EXECUTIVE_EXPORT', name: THAI_SYSTEM_ROLE_NAMES.MANGMEE_EXECUTIVE_EXPORT, description: 'สิทธิ์เพิ่มเติมสำหรับส่งออกรายงานผู้บริหาร' },
  { key: 'MANGMEE_EXECUTIVE_COMPANY_NOTE', name: THAI_SYSTEM_ROLE_NAMES.MANGMEE_EXECUTIVE_COMPANY_NOTE, description: NOTE_WORDS.roleDescription },
  { key: 'MANGMEE_EXECUTIVE_CONTACT', name: THAI_SYSTEM_ROLE_NAMES.MANGMEE_EXECUTIVE_CONTACT, description: 'สิทธิ์เพิ่มเติมสำหรับดูข้อมูลติดต่อเจ้าของร้านในรายงานผู้บริหาร' },
  // S06: prefixed so they can never be confused with the tenant role `SALES` above, which is a
  // shop's own sales employee. UI wording is "ทีมขายมั่งมี" / "เซลล์".
  { key: 'MANGMEE_SALES_LEAD', name: 'Mangmee Sales Lead', description: 'Mangmee sales team lead: all teams deals, approvals, team accounts' },
  { key: 'MANGMEE_SALES',      name: 'Mangmee Sales',      description: 'Mangmee sales agent: own deals and shop search' },
];
