import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_PERMISSION_KEYS, PERMISSIONS, PERMISSION_KEYS, PLATFORM_ONLY_ROLE_KEYS, PLATFORM_ROLE_KEYS, REIMBURSEMENT_SELF_SERVICE_PERMISSIONS, ROLE_GRANTS, SYSTEM_ROLES } from './permission-registry';
import { REQUIRED_ANY_PERMISSIONS_KEY } from '../../common/security/permissions.decorator';
import { AccessCatalogController } from '../employee-access/presentation/http/access-catalog.controller';
import { EmployeeController } from '../employee-access/presentation/http/employee.controller';
import { PermissionController } from '../employee-access/presentation/http/permission.controller';
import { RoleController } from '../employee-access/presentation/http/role.controller';
import { ReimbursementPolicyController } from '../reimbursements/presentation/http/reimbursement-policy.controller';
import { BILLING_PERMISSIONS, SALES_PERMISSION_KEYS, SALES_ROLE_KEYS } from '@watchdog-bms/contracts';

function requiredAny(target: object, method: string): string[] {
  return Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, (target as Record<string, object>)[method]);
}

/**
 * Roles that live inside a CUSTOMER company. The platform roles (SYSTEM_ADMIN and the two
 * มั่งมี sales roles) are excluded: they hold no business permission by design (S29), so the
 * "every company role can ..." invariants below would be asserting the opposite of the rule.
 */
function companyRoleKeys(): string[] {
  return SYSTEM_ROLES.map(({ key }) => key).filter((key) => !PLATFORM_ROLE_KEYS.includes(key));
}

describe('permission-registry', () => {
  it('grants package management to OWNER by default, not ADMIN', () => {
    assert.ok(COMPANY_PERMISSION_KEYS.includes('company.plan.manage'));
    assert.ok(ROLE_GRANTS.OWNER!.includes('company.plan.manage'));
    assert.ok(!ROLE_GRANTS.ADMIN!.includes('company.plan.manage'));
  });

  it('billing control grants are registered only for platform administration, never customer OWNER', () => {
    assert.ok(BILLING_PERMISSIONS.includes('system.billing.approval.approve'));
    for (const key of BILLING_PERMISSIONS) {
      assert.ok(PERMISSION_KEYS.includes(key)); assert.ok(ROLE_GRANTS.SYSTEM_ADMIN!.includes(key));
      assert.ok(!COMPANY_PERMISSION_KEYS.includes(key)); assert.ok(!ROLE_GRANTS.OWNER!.includes(key));
    }
  });
  it('lets employee create/update permissions load only the supporting editor catalogs', () => {
    assert.deepEqual(requiredAny(RoleController.prototype, 'list'), [
      'access.role.read', 'access.role.manage', 'access.employee.create', 'access.employee.update',
    ]);
    assert.deepEqual(requiredAny(EmployeeController.prototype, 'get'), [
      'access.employee.read', 'access.employee.update',
    ]);
    assert.deepEqual(requiredAny(AccessCatalogController.prototype, 'addresses'), [
      'access.employee.read', 'access.employee.create', 'access.employee.update',
      'company.setup.read', 'company.legal_identity.read', 'company.legal_identity.manage',
    ]);
  });

  it('lets role managers load the role builder without granting employee-list read', () => {
    assert.deepEqual(requiredAny(RoleController.prototype, 'get'), ['access.role.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(RoleController.prototype, 'preview'), ['access.role.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(AccessCatalogController.prototype, 'packs'), ['access.capability_pack.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(AccessCatalogController.prototype, 'templates'), ['access.role_template.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(AccessCatalogController.prototype, 'accessMatrix'), ['access.role.read', 'access.role.manage']);
    assert.deepEqual(requiredAny(PermissionController.prototype, 'list'), ['access.permission.read', 'access.role.manage']);
  });

  it('lets reimbursement policy managers load the settings they are allowed to update', () => {
    assert.deepEqual(requiredAny(ReimbursementPolicyController.prototype, 'get'), [
      'reimbursement.policy.read', 'reimbursement.policy.manage',
    ]);
  });

  it('has no duplicate permission keys', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length, `Duplicate keys: ${keys.filter((k, i) => keys.indexOf(k) !== i).join(', ')}`);
  });

  it('all role grants reference only known permission keys', () => {
    const knownKeys = new Set(PERMISSION_KEYS);
    for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
      for (const key of grants) {
        assert.ok(knownKeys.has(key), `Role ${role} grants unknown permission: ${key}`);
      }
    }
  });

  // SEC-03: the internal AI tool route enforces `ai.tool.invoke` at the execution
  // boundary. Any role that can query business data via LINE AI (`line.ai.query`)
  // must therefore also hold `ai.tool.invoke`, or its AI would resolve then be denied.
  it('every role granted line.ai.query is also granted ai.tool.invoke', () => {
    for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
      if (grants.includes('line.ai.query')) {
        assert.ok(
          grants.includes('ai.tool.invoke'),
          `Role ${role} grants line.ai.query but not ai.tool.invoke (its LINE AI tools would be denied at the execution boundary)`,
        );
      }
    }
  });

  it('every role granted expense.read is also granted expense.evidence.read', () => {
    for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
      if (grants.includes('expense.read')) {
        assert.ok(
          grants.includes('expense.evidence.read'),
          `Role ${role} grants expense.read but not expense.evidence.read`,
        );
      }
    }
  });

  it('every role granted expense.void is also granted expense.delete', () => {
    for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
      if (grants.includes('expense.void')) {
        assert.ok(grants.includes('expense.delete'), `Role ${role} grants expense.void but not expense.delete`);
      }
    }
  });

  it('every internal employee role has the complete self-service baseline', () => {
    const employeeRoles = ['OWNER', 'ADMIN', 'MANAGER', 'HR', 'SALES', 'INVENTORY', 'FINANCE', 'ACCOUNTANT', 'MARKETING', 'STAFF'];
    const baseline = [
      'expense.read_own', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload',
      'expense.update', 'expense.signature.self_manage',
      'reimbursement.read_own', 'reimbursement.create', 'reimbursement.update_own_draft',
      'reimbursement.submit', 'reimbursement.cancel_own',
    ];
    for (const role of employeeRoles) {
      const grants = ROLE_GRANTS[role] ?? [];
      assert.ok(grants.includes('attachment.create'), `${role} cannot store LINE receipt evidence`);
      assert.ok(grants.includes('expense.read_related'), `${role} cannot read an expense they participated in`);
      for (const permission of baseline) {
        assert.ok(grants.includes(permission), `${role} missing employee baseline ${permission}`);
      }
    }
    for (const role of ['SYSTEM_ADMIN', 'COMPANY_VIEW', 'AUDITOR_READONLY']) {
      for (const permission of baseline.filter((key) => !key.endsWith('.read_own')
        && (role === 'SYSTEM_ADMIN' || !REIMBURSEMENT_SELF_SERVICE_PERMISSIONS.includes(key)))) {
        assert.equal(ROLE_GRANTS[role]?.includes(permission), false, `${role} must not receive ${permission}`);
      }
    }
  });

  it('every company role can request its own reimbursement without granting approval or payment to read-only roles', () => {
    for (const { key: role } of SYSTEM_ROLES) {
      for (const permission of REIMBURSEMENT_SELF_SERVICE_PERMISSIONS) {
        assert.equal(ROLE_GRANTS[role].includes(permission), !PLATFORM_ROLE_KEYS.includes(role), `${role}: ${permission}`);
      }
    }
    for (const role of ['COMPANY_VIEW', 'AUDITOR_READONLY']) {
      for (const permission of ['reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review',
        'reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.policy.manage']) {
        assert.equal(ROLE_GRANTS[role].includes(permission), false, `${role}: ${permission}`);
      }
    }
  });

  it('every company role has view-only access to reimbursements it participated in', () => {
    for (const role of companyRoleKeys()) {
      assert.ok(
        ROLE_GRANTS[role]?.includes('reimbursement.read_related'),
        `${role} cannot read a reimbursement it participated in`,
      );
    }
  });

  it('every company role has view-only access to each procurement document family it participated in', () => {
    const related = [
      'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
      'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related',
      'procurement.supplier_payment.read_related',
    ];
    for (const role of companyRoleKeys()) {
      for (const permission of related) {
        assert.ok(ROLE_GRANTS[role]?.includes(permission), `${role} missing ${permission}`);
      }
    }
  });

  it('ADMIN can upload receipt evidence through web', () => {
    assert.ok(ROLE_GRANTS.ADMIN.includes('attachment.create'));
    assert.ok(ROLE_GRANTS.ADMIN.includes('expense.receipt.upload'));
  });

  // Team decision 2026-07-28: a default ADMIN cannot hand out permissions — the
  // role-management keys are owner-delegated via a custom role, not default grants.
  it('default ADMIN cannot manage roles until the owner delegates it', () => {
    for (const key of ['access.role.manage', 'admin.role.manage', 'access.role_template.manage']) {
      assert.equal(ROLE_GRANTS.ADMIN.includes(key), false, `ADMIN should not hold ${key} by default`);
    }
    // Reads stay: the admin can still see roles/permissions, and still manages employees.
    for (const key of ['access.role.read', 'access.role_template.read', 'access.employee.create', 'access.employee.update']) {
      assert.ok(ROLE_GRANTS.ADMIN.includes(key), `ADMIN should keep ${key}`);
    }
  });

  // Team decision 2026-07-28: reimbursement approvers are OWNER / ADMIN / MANAGER. Owner decision
  // 2026-09-19 supersedes that decision's "paying stays FINANCE-only" half (D1/A2): an approver
  // can record payment directly, so ADMIN/MANAGER now hold payment.record/payment.void too.
  it('OWNER, ADMIN and MANAGER can approve and pay reimbursements; FINANCE cannot approve', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER']) {
      assert.ok(ROLE_GRANTS[role].includes('reimbursement.approve'), `${role} missing reimbursement.approve`);
      assert.ok(ROLE_GRANTS[role].includes('reimbursement.reject'), `${role} missing reimbursement.reject`);
      assert.ok(ROLE_GRANTS[role].includes('reimbursement.payment.record'), `${role} missing reimbursement.payment.record`);
      assert.ok(ROLE_GRANTS[role].includes('reimbursement.payment.void'), `${role} missing reimbursement.payment.void`);
    }
    assert.equal(ROLE_GRANTS.FINANCE.includes('reimbursement.approve'), false);
    // finance_review and duplicate.resolve are NOT widened by the 2026-09-19 decision.
    for (const role of ['ADMIN', 'MANAGER']) {
      assert.equal(ROLE_GRANTS[role].includes('reimbursement.finance_review'), false, `${role} must not hold reimbursement.finance_review`);
      assert.equal(ROLE_GRANTS[role].includes('reimbursement.duplicate.resolve'), false, `${role} must not hold reimbursement.duplicate.resolve`);
    }
  });

  // Owner decision 2026-07-26: ADMIN works the expense module owner-equal — the full
  // reviewer lane (review-fields, reviewer-mark-ready, substitute-receipt prepare/supersede)
  // plus confirm/reject/void/payment/duplicate resolution. Signature-asset approval stays
  // owner-level; ocr.request/ai.verify stay service-lane.
  it('ADMIN works expenses owner-equal, minus owner-level signature approval', () => {
    const lane = ['expense.create', 'expense.update', 'expense.review', 'expense.confirm',
      'expense.reject', 'expense.void', 'expense.payment.record', 'expense.duplicate.resolve'];
    for (const key of lane) {
      assert.ok(ROLE_GRANTS.ADMIN.includes(key), `ADMIN missing ${key}`);
    }
    assert.equal(ROLE_GRANTS.ADMIN.includes('expense.signature.approve'), false);
  });

  // Every role must be able to change its own password: a forced temp-password change
  // that 403s would lock the account out of the whole app (pack.core.basics intent).
  it('every role can change its own password', () => {
    for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
      assert.ok(grants.includes('account.password.change'), `Role ${role} cannot change its own password`);
    }
  });

  // Self-service LINE link (line-self-link spec §5): every role that may change its own password
  // may also link its own LINE account — strictly ctx.userId-scoped, and employees are the ones
  // who hit the 15-minute QR expiry. `account.identity.unlink` is deliberately NOT widened
  // (owner directive 2026-09-01): the sidebar shows an already-linked account as a disabled row,
  // so unlink stays an admin-console action and the grant would be unused surface.
  it('every role that can change its own password can link its own LINE account', () => {
    for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
      if (!grants.includes('account.password.change')) continue;
      assert.ok(grants.includes('account.identity.link'), `Role ${role} cannot link its own LINE account`);
    }
  });

  it('STAFF keeps dashboard access when the dashboard menu starts requiring dashboard.read', () => {
    assert.ok(ROLE_GRANTS.STAFF.includes('dashboard.read'));
  });

  // Spec §5/§9/S06/S29. The whole security story of the sales console is "these two roles hold
  // sales.* plus the account.* four and NOTHING else" — if a business key ever leaks into either
  // grant list, a sales agent gains read access to the platform tenant's own workspace.
  it('the two Mangmee sales roles hold only sales.* and the account.* login baseline', () => {
    const loginBaseline = ['account.session.read', 'account.password.change', 'account.identity.link'];
    for (const role of SALES_ROLE_KEYS) {
      const grants = ROLE_GRANTS[role] ?? [];
      assert.ok(grants.length > 0, `${role} has no grants`);
      for (const key of loginBaseline) assert.ok(grants.includes(key), `${role} cannot sign in without ${key}`);
      for (const key of grants) {
        assert.ok(
          key.startsWith('sales.') || loginBaseline.includes(key),
          `${role} must not hold the business permission ${key} (S29)`,
        );
      }
      // Never the unlink key or the admin-wide PII management key (S10/R11).
      assert.equal(grants.includes('account.identity.unlink'), false, `${role} must not unlink identities`);
      assert.equal(grants.includes('sales.agent_profile.manage'), false, `${role} must not manage every agent tax/bank profile`);
    }
  });

  it('separates the sales lead from the sales agent exactly where the spec does', () => {
    const lead = ROLE_GRANTS['MANGMEE_SALES_LEAD'] ?? [], agent = ROLE_GRANTS['MANGMEE_SALES'] ?? [];
    // R5: an agent can never approve — not their own deal and not anyone else's. Sales-event §9: nor
    // create, pause, suspend or revoke an event discount; they only show the QR they were given.
    for (const key of ['sales.deal.approve', 'sales.team.manage', 'sales.report.read', 'sales.event.manage']) {
      assert.ok(lead.includes(key), `lead missing ${key}`);
      assert.equal(agent.includes(key), false, `agent must not hold ${key}`);
    }
    for (const key of ['sales.console.read', 'sales.company.search', 'sales.deal.create']) {
      assert.ok(lead.includes(key) && agent.includes(key), `both sales roles need ${key}`);
    }
  });

  it('gives SYSTEM_ADMIN every sales key including the PII one, and no tenant role any of them', () => {
    for (const key of SALES_PERMISSION_KEYS) {
      assert.ok(PERMISSION_KEYS.includes(key), `${key} is not registered`);
      assert.ok(ROLE_GRANTS.SYSTEM_ADMIN!.includes(key), `SYSTEM_ADMIN missing ${key}`);
      assert.equal(COMPANY_PERMISSION_KEYS.includes(key), false, `${key} must not be a company permission`);
      assert.equal(ROLE_GRANTS.OWNER!.includes(key), false, `OWNER must not hold ${key}`);
      // S06: the shop's own SALES role must never pick up a platform sales authority.
      assert.equal(ROLE_GRANTS.SALES!.includes(key), false, `tenant SALES must not hold ${key}`);
    }
  });

  // Owner report 2026-10-02: the role page prints a role's description under its title, and a shop
  // read "Accounting access" there. A shop is listed every system role except the platform-only ones.
  it('describes every role a shop is listed in Thai', () => {
    for (const role of SYSTEM_ROLES.filter(({ key }) => !PLATFORM_ONLY_ROLE_KEYS.includes(key))) {
      assert.match(role.description, /[ก-๙]/, `${role.key} has no Thai description`);
      assert.doesNotMatch(role.description, /[A-Za-z]/, `${role.key}: "${role.description}"`);
    }
  });

  it('SYSTEM_ROLES keys match ROLE_GRANTS keys', () => {
    const roleKeys = new Set(SYSTEM_ROLES.map((r) => r.key));
    const grantKeys = new Set(Object.keys(ROLE_GRANTS));
    for (const k of roleKeys) {
      assert.ok(grantKeys.has(k), `SYSTEM_ROLES has role "${k}" not found in ROLE_GRANTS`);
    }
    for (const k of grantKeys) {
      assert.ok(roleKeys.has(k), `ROLE_GRANTS has role "${k}" not found in SYSTEM_ROLES`);
    }
  });

  it('OWNER has all company permissions but no platform permissions', () => {
    const ownerGrants = new Set(ROLE_GRANTS['OWNER']);
    for (const perm of COMPANY_PERMISSION_KEYS) {
      assert.ok(ownerGrants.has(perm), `OWNER missing permission: ${perm}`);
    }
    // Both platform prefixes: `sales.` is not `system.`-prefixed, so checking only the latter
    // let the whole sales key family reach OWNER unnoticed.
    assert.equal([...ownerGrants].some((perm) => perm.startsWith('system.') || perm.startsWith('sales.')), false);
  });

  it('lets every company role reach accounting relation ABAC without widening document reads', () => {
    for (const role of companyRoleKeys()) {
      const grants = ROLE_GRANTS[role] ?? [];
      assert.ok(
        grants.includes('accounting.document.read') || grants.includes('accounting.document.read_related'),
        `${role} must have broad or relation-scoped accounting document view`,
      );
    }
  });

  it('keeps financial role assignment approval OWNER-only', () => {
    assert.ok(ROLE_GRANTS.OWNER.includes('access.role.financial.assign'));
    assert.equal(ROLE_GRANTS.ADMIN.includes('access.role.financial.assign'), false);
    assert.equal(ROLE_GRANTS.HR.includes('access.role.financial.assign'), false);
  });

  it('gives HR only the dedicated operational employee-administration boundary', () => {
    for (const key of [
      'access.employee.read', 'access.employee.create', 'access.employee.update',
      'access.employee.disable', 'access.role.read', 'access.role.operational.assign',
    ]) {
      assert.ok(ROLE_GRANTS.HR.includes(key), `HR missing ${key}`);
    }
    for (const key of [
      'access.role.manage', 'access.role.financial.assign', 'access.permission.read',
      'access.employee.credential.issue', 'admin.user.manage', 'admin.role.manage',
    ]) {
      assert.equal(ROLE_GRANTS.HR.includes(key), false, `HR must not hold ${key}`);
    }
    for (const role of Object.keys(ROLE_GRANTS)) {
      assert.equal(
        ROLE_GRANTS[role].includes('access.role.operational.assign'),
        role === 'OWNER' || role === 'HR',
        `${role} has an unexpected operational role-assignment grant`,
      );
    }
  });

  it('all 7 item-10A partner management permission keys are present', () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    const partnerKeys = [
      'system.partner_dashboard.read',
      'system.partner_company.create',
      'system.partner_company.update',
      'system.partner_company.lifecycle.manage',
      'system.partner_feature.manage',
      'system.partner_ai_model.manage',
      'system.partner_line_credential.manage',
    ];
    for (const k of partnerKeys) {
      assert.ok(keys.has(k), `Missing permission key: ${k}`);
    }
  });

  it('SYSTEM_ADMIN has all 7 partner management permission keys', () => {
    const systemAdminGrants = new Set(ROLE_GRANTS['SYSTEM_ADMIN']);
    const partnerKeys = [
      'system.partner_dashboard.read',
      'system.partner_company.create',
      'system.partner_company.update',
      'system.partner_company.lifecycle.manage',
      'system.partner_feature.manage',
      'system.partner_ai_model.manage',
      'system.partner_line_credential.manage',
    ];
    for (const k of partnerKeys) {
      assert.ok(systemAdminGrants.has(k), `SYSTEM_ADMIN missing: ${k}`);
    }
  });

  it('COMPANY_VIEW has the compact menu permissions used by the Mangmee company shell', () => {
    const companyViewGrants = new Set(ROLE_GRANTS['COMPANY_VIEW']);
    const requiredMenuKeys = [
      'dashboard.read',
      'notification.read',
      'crm.inbox.read',
      'accounting.quotation.read',
      'accounting.invoice.read',
      'crm.customer.read',
      'crm.report.read',
      'expense.read',
      'ledger.journal.read',
      'accounting.document.read',
      'report.catalog.read',
      'ledger.report.read',
      'ledger.period.read',
      'access.role.read',
      'admin.role.read',
      'procurement.purchase_order.read',
    ];
    for (const k of requiredMenuKeys) {
      assert.ok(companyViewGrants.has(k), `COMPANY_VIEW missing: ${k}`);
    }
    assert.equal([...companyViewGrants].some((perm) => perm.startsWith('system.')), false);
  });

  it('customer merge and LINE identity re-point stay Owner/Admin-only', () => {
    assert.ok(ROLE_GRANTS['OWNER'].includes('crm.customer.merge'));
    assert.ok(ROLE_GRANTS['ADMIN'].includes('crm.customer.merge'));
    assert.equal(ROLE_GRANTS['MANAGER'].includes('crm.customer.merge'), false);
    assert.equal(ROLE_GRANTS['SALES'].includes('crm.customer.merge'), false);
  });

  it('MARKETING can segment customers but cannot read contact-person PII', () => {
    assert.ok(ROLE_GRANTS['MARKETING'].includes('crm.customer.read'));
    assert.equal(ROLE_GRANTS['MARKETING'].includes('crm.contact.read'), false);
  });

  // Step 0 company tax identity (company-tax-identity-setup-spec §10).
  describe('Step 0 company tax identity', () => {
    const riskOf = (key: string) => PERMISSIONS.find((p) => p.key === key)?.riskLevel;

    it('registers the six keys at the risk levels the spec fixes', () => {
      assert.equal(riskOf('company.legal_identity.read'), 'MEDIUM');
      assert.equal(riskOf('company.legal_identity.manage'), 'HIGH');
      assert.equal(riskOf('company.vat_registration.read'), 'LOW');
      assert.equal(riskOf('company.vat_registration.manage'), 'HIGH');
      assert.equal(riskOf('accounting.tax_document_buyer_evidence.manage'), 'HIGH');
      assert.equal(riskOf('system.identity_reconciliation.resolve'), 'CRITICAL');
    });

    it('gives the owner every company-side key without an explicit grant', () => {
      for (const key of [
        'company.legal_identity.read',
        'company.legal_identity.manage',
        'company.vat_registration.read',
        'company.vat_registration.manage',
        'accounting.tax_document_buyer_evidence.manage',
      ]) {
        assert.ok(COMPANY_PERMISSION_KEYS.includes(key), `${key} should be a company key`);
        assert.ok(ROLE_GRANTS['OWNER'].includes(key), `OWNER missing ${key}`);
      }
    });

    it('keeps reconciliation platform-side only', () => {
      assert.ok(ROLE_GRANTS['SYSTEM_ADMIN'].includes('system.identity_reconciliation.resolve'));
      assert.equal(COMPANY_PERMISSION_KEYS.includes('system.identity_reconciliation.resolve'), false);
      for (const role of ['OWNER', 'ADMIN', 'ACCOUNTANT', 'FINANCE']) {
        assert.equal(
          (ROLE_GRANTS[role] ?? []).includes('system.identity_reconciliation.resolve'),
          false,
          `${role} must not resolve cross-tenant identity`,
        );
      }
    });

    it('keeps data-rights orchestration CRITICAL and platform-side only', () => {
      assert.equal(riskOf('system.data_rights.manage'), 'CRITICAL');
      assert.ok(ROLE_GRANTS['SYSTEM_ADMIN'].includes('system.data_rights.manage'));
      assert.equal(COMPANY_PERMISSION_KEYS.includes('system.data_rights.manage'), false);
      for (const role of ['OWNER', 'ADMIN', 'ACCOUNTANT', 'FINANCE']) {
        assert.equal((ROLE_GRANTS[role] ?? []).includes('system.data_rights.manage'), false);
      }
    });

    it('answers VAT with the accountant and reads it with finance', () => {
      assert.ok(ROLE_GRANTS['ACCOUNTANT'].includes('company.vat_registration.manage'));
      assert.ok(ROLE_GRANTS['ACCOUNTANT'].includes('company.vat_registration.read'));
      assert.ok(ROLE_GRANTS['FINANCE'].includes('company.vat_registration.read'));
      assert.equal(ROLE_GRANTS['FINANCE'].includes('company.vat_registration.manage'), false);
      // QP2 default until the owner answers: MANAGER does not read the VAT status.
      assert.equal(ROLE_GRANTS['MANAGER'].includes('company.vat_registration.read'), false);
    });

    // The role that issues tax invoices is the one that unblocks a credit note against a legacy
    // one; every other role has to be granted it deliberately.
    it('gives buyer-evidence remediation to finance and to nobody else by default', () => {
      assert.ok(ROLE_GRANTS['FINANCE'].includes('accounting.tax_document_buyer_evidence.manage'));
      for (const role of ['ACCOUNTANT', 'MANAGER', 'SALES', 'STAFF', 'ADMIN', 'COMPANY_VIEW', 'AUDITOR_READONLY']) {
        assert.equal(
          (ROLE_GRANTS[role] ?? []).includes('accounting.tax_document_buyer_evidence.manage'),
          false,
          `${role} should not edit issued tax invoice evidence`,
        );
      }
    });

    // QP2 is unanswered, so manage stays with the owner alone. Documented, not accidental:
    // widening this later is one line, narrowing it needs an access review.
    it('keeps the legal identity owner-only pending QP2', () => {
      for (const role of Object.keys(ROLE_GRANTS)) {
        if (role === 'OWNER') continue;
        assert.equal(
          ROLE_GRANTS[role].includes('company.legal_identity.manage'),
          false,
          `${role} should not manage the legal identity yet`,
        );
      }
    });

    // WHT certificate system issuance plan §2.1b/§3.3 (Decision B): the company signature setting
    // is OWNER-only by the exact same omission mechanism as company.legal_identity.manage above —
    // FINANCE and ACCOUNTANT keep wht.certificate.issue (issuing a certificate) but never this.
    it('keeps the WHT-certificate company signature setting owner-only (Decision B)', () => {
      for (const role of Object.keys(ROLE_GRANTS)) {
        if (role === 'OWNER') continue;
        assert.equal(
          ROLE_GRANTS[role].includes('company.tax_signature.manage'),
          false,
          `${role} should not manage the company WHT-certificate signature`,
        );
      }
      assert.ok(COMPANY_PERMISSION_KEYS.includes('company.tax_signature.manage'), 'OWNER gets it via COMPANY_PERMISSION_KEYS');
      assert.ok(ROLE_GRANTS['FINANCE'].includes('wht.certificate.issue'));
      assert.ok(ROLE_GRANTS['ACCOUNTANT'].includes('wht.certificate.issue'));
    });

    // Correction & replacement plan §2.1: the same two roles that may ISSUE a SYSTEM certificate
    // may also correct/reissue a copy of one — a continuing responsibility, not a new grant.
    it('grants wht.certificate.correct to the same roles that hold wht.certificate.issue', () => {
      assert.ok(ROLE_GRANTS['FINANCE'].includes('wht.certificate.correct'));
      assert.ok(ROLE_GRANTS['ACCOUNTANT'].includes('wht.certificate.correct'));
    });
  });
});

it('standard-role descriptions name the same administrator and read-only auditor as the role labels', () => {
  assert.ok(SYSTEM_ROLES.find((role) => role.key === 'ADMIN')!.description.includes('ผู้ดูแลบริษัท'));
  assert.ok(SYSTEM_ROLES.find((role) => role.key === 'AUDITOR_READONLY')!.description.includes('ผู้ตรวจสอบ (ดูอย่างเดียว)'));
});
