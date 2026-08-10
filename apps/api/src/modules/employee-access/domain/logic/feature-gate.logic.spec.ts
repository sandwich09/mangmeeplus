import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ON_FEATURE_KEYS, FEATURE_CATALOG } from '@watchdog-bms/contracts';
import { filterPermissionsByEntitlement } from './feature-gate.logic';
import { loadEntitledFeatureKeys } from '../../application/entitlement.helper';
import { PERMISSIONS } from '../../../auth/permission-registry';

const ORIGINAL_FEATURE_KEYS = [
  'inventory',
  'sales_documents',
  'expenses',
  'double_entry_ledger',
  'thai_tax',
  'procurement',
  'bank_reconciliation',
  'crm',
  'dashboard_notifications',
  'ai_line_assistant',
  'reports',
  'workflow_automation',
] as const;

const ACCESS_PERMISSIONS = PERMISSIONS
  .map((permission) => permission.key)
  .filter((permission) => permission.startsWith('access.'));

// The two menus the `company_settings` toggle actually owns: สาขา and ความปลอดภัยบัญชี.
const COMPANY_SETTINGS_MENU_PERMISSIONS = [
  'company.branch.read',
  'company.branch.manage',
  'account.password.change',
  'account.identity.link',
  'account.identity.unlink',
];

// Everything else the company-settings capability packs carry. These are product-wide
// foundations that must survive the toggle: attachment.create/delete guard every upload
// endpoint and are granted by no other pack, and company.setup.manage guards the
// ตั้งค่าใบรับรองแทนใบเสร็จ menu that lives under Expenses.
const COMPANY_FOUNDATION_PERMISSIONS = [
  'company.setup.read',
  'company.setup.manage',
  'document.sequence.read',
  'document.sequence.manage',
  'attachment.create',
  'attachment.delete',
  'outbox.event.read',
];

const COMPANY_SETTINGS_PERMISSIONS = [
  ...COMPANY_SETTINGS_MENU_PERMISSIONS,
  ...COMPANY_FOUNDATION_PERMISSIONS,
];

function originalFeatureRows() {
  return ORIGINAL_FEATURE_KEYS.map((featureKey) => ({ featureKey, enabled: true }));
}

function entitledWithChildren(...featureKeys: string[]): Set<string> {
  const entitled = new Set(featureKeys);
  for (const feature of FEATURE_CATALOG) {
    if (entitled.has(feature.key)) {
      for (const submenu of feature.submenus) entitled.add(submenu.key);
    }
  }
  return entitled;
}

describe('filterPermissionsByEntitlement', () => {
  it('assigns each permission to at most one submenu entitlement', () => {
    const owners = new Map<string, string>();
    for (const feature of FEATURE_CATALOG) {
      for (const submenu of feature.submenus) {
        for (const permission of submenu.permissionKeys) {
          assert.equal(owners.get(permission), undefined, `${permission} is shared by ${owners.get(permission)} and ${submenu.key}`);
          owners.set(permission, submenu.key);
        }
      }
    }
  });

  it('returns permissions unchanged when the company has no entitlement rows (legacy fail-open)', () => {
    const permissions = ['inventory.product.read', 'expense.read', 'report.catalog.read'];
    assert.deepEqual(filterPermissionsByEntitlement(permissions, null), permissions);
  });

  it('strips permissions of disabled features and keeps enabled ones', () => {
    const entitled = entitledWithChildren('crm');
    entitled.add('expenses');
    entitled.add('expenses.list');
    const result = filterPermissionsByEntitlement(
      ['inventory.product.read', 'inventory.movement.adjust', 'expense.read', 'crm.customer.read'],
      entitled,
    );
    assert.deepEqual(result, ['expense.read', 'crm.customer.read']);
  });

  it('keeps universal related-record view gated by sales documents', () => {
    assert.deepEqual(
      filterPermissionsByEntitlement(['accounting.document.read_related'], entitledWithChildren('expenses')),
      [],
    );
    assert.deepEqual(
      filterPermissionsByEntitlement(['accounting.document.read_related'], entitledWithChildren('sales_documents')),
      ['accounting.document.read_related'],
    );
  });

  it('keeps expense related-view authority only while expenses are enabled', () => {
    assert.deepEqual(
      filterPermissionsByEntitlement(['expense.read_related'], entitledWithChildren('sales_documents')),
      [],
    );
    assert.deepEqual(
      filterPermissionsByEntitlement(['expense.read_related'], entitledWithChildren('expenses')),
      ['expense.read_related'],
    );
    assert.deepEqual(
      filterPermissionsByEntitlement(['expense.read_related'], new Set(['expenses'])),
      [],
      'an explicitly disabled expenses.list child must remove the related-view route too',
    );
  });

  it('keeps procurement related-view authority only while procurement is enabled', () => {
    assert.deepEqual(
      filterPermissionsByEntitlement(['procurement.purchase_order.read_related'], entitledWithChildren('expenses')),
      [],
    );
    assert.deepEqual(
      filterPermissionsByEntitlement(['procurement.purchase_order.read_related'], entitledWithChildren('procurement')),
      ['procurement.purchase_order.read_related'],
    );
    assert.deepEqual(
      filterPermissionsByEntitlement(
        ['procurement.purchase_request.read_related', 'procurement.purchase_order.read_related'],
        new Set(['procurement', 'procurement.purchase_requests']),
      ),
      ['procurement.purchase_request.read_related'],
      'disabling one procurement child must not leak that document family through another child',
    );
  });

  it('does not retain a child permission when only the child entitlement is enabled', () => {
    assert.deepEqual(
      filterPermissionsByEntitlement(['expense.evidence.read'], new Set(['expenses.evidence'])),
      [],
    );
  });

  it('strips disabled Phase 2 children without taking down their parent modules', () => {
    assert.deepEqual(
      filterPermissionsByEntitlement(
        ['bank.account.read', 'bank.match.read', 'crm.customer.read', 'crm.follow_up.read'],
        new Set([
          'bank_reconciliation',
          'bank_reconciliation.accounts',
          'crm',
          'crm.customers',
        ]),
      ),
      ['bank.account.read', 'crm.customer.read'],
    );
  });

  it('registers every safe Phase 2 tab as a child entitlement', () => {
    const childrenByFeature = Object.fromEntries(
      FEATURE_CATALOG.map((feature) => [feature.key, feature.submenus.map((submenu) => submenu.key)]),
    );

    assert.deepEqual(childrenByFeature.inventory, [
      'inventory.locations',
      'inventory.movements',
      'inventory.stock_report',
    ]);
    assert.deepEqual(childrenByFeature.procurement, [
      'procurement.suppliers',
      'procurement.purchase_requests',
      'procurement.purchase_orders',
      'procurement.goods_receipts',
      'procurement.vendor_bills',
      'procurement.supplier_payments',
      'procurement.ap_aging',
    ]);
    assert.deepEqual(childrenByFeature.bank_reconciliation, [
      'bank_reconciliation.accounts',
      'bank_reconciliation.cash',
      'bank_reconciliation.import',
      'bank_reconciliation.matching',
      'bank_reconciliation.reconciliations',
      'bank_reconciliation.adjustments',
    ]);
    assert.deepEqual(childrenByFeature.crm, [
      'crm.overview',
      'crm.leads',
      'crm.pipeline',
      'crm.followups',
      'crm.customers',
      'crm.inbox',
      'crm.bookings',
    ]);
    assert.deepEqual(childrenByFeature.workflow_automation, [
      'workflow_automation.templates',
      'workflow_automation.rules',
      'workflow_automation.runs',
      'workflow_automation.tasks',
      'workflow_automation.dead_letters',
      'workflow_automation.webhooks',
    ]);
  });

  it('registers the foundation feature children with their exact permissions', () => {
    const featureByKey = new Map(FEATURE_CATALOG.map((feature) => [feature.key, feature]));

    assert.equal(featureByKey.get('employee_access')?.labelTh, 'พนักงานและสิทธิ์');
    assert.deepEqual(
      featureByKey.get('employee_access')?.submenus.map(({ key, labelTh, route, permissionKeys }) => ({
        key, labelTh, route, permissionKeys,
      })),
      [
        {
          key: 'employee_access.employees',
          labelTh: 'พนักงาน',
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
          route: '/settings/permissions',
          // access.permission.read belongs here rather than riding on the pack: with the
          // foundation packs untagged, a child rule is the only thing that gates it.
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
          route: '/settings/access-overview',
          permissionKeys: ['access.effective.read'],
        },
      ],
    );
    assert.equal(featureByKey.get('company_settings')?.labelTh, 'ตั้งค่าบริษัท');
    assert.deepEqual(
      featureByKey.get('company_settings')?.submenus.map(({ key, labelTh, route, permissionKeys }) => ({
        key, labelTh, route, permissionKeys,
      })),
      [
        {
          key: 'company_settings.branches',
          labelTh: 'สาขา',
          route: '/settings/branches',
          permissionKeys: ['company.branch.read', 'company.branch.manage'],
        },
        {
          key: 'company_settings.security',
          labelTh: 'ความปลอดภัยบัญชี',
          route: '/settings/security',
          permissionKeys: [
            'account.password.change',
            'account.identity.link',
            'account.identity.unlink',
          ],
        },
      ],
    );
  });

  it('never strips ungated foundation permissions even when every feature is off', () => {
    const result = filterPermissionsByEntitlement(
      ['line.ai.query', 'account.session.read'],
      new Set<string>(),
    );
    assert.deepEqual(result, ['line.ai.query', 'account.session.read']);
  });

  it('gates dashboard and notification keys behind dashboard_notifications, overriding the core pack', () => {
    const permissions = ['dashboard.read', 'dashboard.configure', 'notification.read', 'notification.rule.manage'];
    assert.deepEqual(filterPermissionsByEntitlement(permissions, new Set(['expenses'])), []);
    assert.deepEqual(
      filterPermissionsByEntitlement(permissions, entitledWithChildren('dashboard_notifications')),
      permissions,
    );
  });

  it('gates report catalog/BI keys by prefix under the reports feature (no pack exists)', () => {
    const off = filterPermissionsByEntitlement(['report.catalog.read', 'report.query.run'], new Set(['expenses']));
    assert.deepEqual(off, []);
    const on = filterPermissionsByEntitlement(['report.catalog.read', 'report.query.run'], new Set(['reports']));
    assert.deepEqual(on, ['report.catalog.read', 'report.query.run']);
  });

  it('retains only the narrow report history reads while reports is off', () => {
    const permissions = [
      'report.catalog.read',
      'report.query.run',
      'report.view.read',
      'report.view.create',
      'report.snapshot.read',
      'report.export',
      'report.export.read_own',
      'report.export.manage',
      'report.audit.read',
    ];
    assert.deepEqual(
      filterPermissionsByEntitlement(permissions, new Set(['expenses'])),
      ['report.view.read', 'report.snapshot.read', 'report.export.read_own', 'report.export.manage', 'report.audit.read'],
    );
  });

  it('gates new reimbursement roots behind its entitlement while runoff work keeps flowing', () => {
    // Owner decision 2026-08-10 (§6.3 r5): OFF blocks new claims only — reads, approve/reject,
    // finance review, payout/void and duplicate resolution continue for in-flight claims.
    const blocked = ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit',
      'reimbursement.cancel_own', 'reimbursement.export', 'reimbursement.policy.read', 'reimbursement.policy.manage'];
    const retained = ['reimbursement.read', 'reimbursement.read_own', 'reimbursement.read_related',
      'reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review',
      'reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.duplicate.resolve'];
    assert.deepEqual(filterPermissionsByEntitlement([...blocked, ...retained], new Set(['expenses', 'procurement'])), retained);
    assert.deepEqual(filterPermissionsByEntitlement([...blocked, ...retained], new Set(['reimbursement'])), [...blocked, ...retained]);
  });

  it('gates the CRM domain (including ungated inbox/template keys) behind the crm feature', () => {
    const perms = ['crm.customer.read', 'crm.inbox.read', 'crm.template.read'];
    assert.deepEqual(filterPermissionsByEntitlement(perms, new Set(['expenses'])), []);
    assert.deepEqual(filterPermissionsByEntitlement(perms, entitledWithChildren('crm')), perms);
  });

  it('gates product-catalog permissions independently from Inventory and CRM', () => {
    const permissions = ['inventory.product.read', 'inventory.product.manage'];
    assert.deepEqual(filterPermissionsByEntitlement(permissions, new Set(['inventory', 'crm'])), []);
    assert.deepEqual(filterPermissionsByEntitlement(permissions, new Set(['product_catalog'])), permissions);
  });

  it('gates crm.channel.* behind line_oa rather than crm', () => {
    const permissions = ['crm.channel.read', 'crm.channel.manage'];
    assert.deepEqual(filterPermissionsByEntitlement(permissions, entitledWithChildren('crm')), []);
    assert.deepEqual(filterPermissionsByEntitlement(permissions, new Set(['line_oa'])), permissions);
  });

  it('gates crm.ai.* (inbox AI assist) behind ai_line_assistant, not the crm toggle', () => {
    const perms = ['crm.ai.assist', 'crm.ai.read', 'crm.inbox.read'];
    // crm on but AI off: inbox stays, AI assist/read stripped.
    assert.deepEqual(filterPermissionsByEntitlement(perms, entitledWithChildren('crm')), ['crm.inbox.read']);
    assert.deepEqual(filterPermissionsByEntitlement(perms, entitledWithChildren('crm', 'ai_line_assistant')), perms);
  });

  it('gates AI suggestions/drafts (AI แนะนำ) behind ai_line_assistant, but keeps core AI plumbing', () => {
    const perms = ['ai.suggestion.read', 'ai.draft.read', 'ai.tool.invoke', 'line.ai.query'];
    // ai_line_assistant off: suggestion/draft stripped; core ai.tool.invoke/line.ai.query stay.
    assert.deepEqual(filterPermissionsByEntitlement(perms, new Set(['expenses'])), ['ai.tool.invoke', 'line.ai.query']);
    assert.deepEqual(filterPermissionsByEntitlement(perms, new Set(['ai_line_assistant'])), perms);
  });

  it('keeps permissions mapped to no feature (system/admin plumbing is not feature-gated)', () => {
    const result = filterPermissionsByEntitlement(['system.partner_dashboard.read'], new Set<string>());
    assert.deepEqual(result, ['system.partner_dashboard.read']);
  });

  // H4: a company that never bought `thai_tax` still withholds tax and still owes its payee a
  // 50 ทวิ. When the system cannot issue it, the external-handoff journey must survive the
  // entitlement filter — otherwise the fallback is unreachable and the payer is stuck.
  it('keeps the 50 ทวิ external-handoff keys for a company without thai_tax', () => {
    const whtKeys = ['wht.certificate.read', 'wht.external_certificate.link'];
    assert.deepEqual(filterPermissionsByEntitlement(whtKeys, new Set(['procurement'])), whtKeys);
    assert.deepEqual(filterPermissionsByEntitlement(whtKeys, new Set<string>()), whtKeys);
  });

  it('still strips the thai_tax-owned certificate keys from that same company', () => {
    assert.deepEqual(
      filterPermissionsByEntitlement(
        ['tax.certificate.read', 'tax.certificate.issue', 'wht.certificate.read'],
        new Set(['procurement']),
      ),
      ['wht.certificate.read'],
    );
  });
});

function prismaWithEntitlements(rows: Array<{ featureKey: string; enabled: boolean }>) {
  return {
    client: {
      companyFeatureEntitlement: {
        findMany: async () => rows,
      },
    },
  } as any;
}

describe('loadEntitledFeatureKeys submenu inheritance', () => {
  it('keeps legacy permissions when a new menu entitlement has no row, while explicit false still wins', async () => {
    // Reimbursement's runoff set (owner decision 2026-08-10) survives even an explicit
    // disable — only new-root permissions are stripped. The other families strip fully.
    const REIMBURSEMENT_RUNOFF = ['reimbursement.read', 'reimbursement.read_own', 'reimbursement.read_related',
      'reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review',
      'reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.duplicate.resolve'];
    const cases: Array<[string, string, string[], string[]]> = [
      ['expenses', 'reimbursement', PERMISSIONS.map(({ key }) => key).filter((key) => key.startsWith('reimbursement.')), REIMBURSEMENT_RUNOFF],
      ['inventory', 'product_catalog', ['inventory.product.read', 'inventory.product.manage'], []],
      ['crm', 'line_oa', ['crm.channel.read', 'crm.channel.manage'], []],
    ];

    for (const [legacyKey, featureKey, permissions, survivesDisable] of cases) {
      const inherited = await loadEntitledFeatureKeys(
        prismaWithEntitlements([{ featureKey: legacyKey, enabled: true }]),
        'co-1',
      );
      assert.equal(inherited?.has(featureKey), true);
      assert.deepEqual(filterPermissionsByEntitlement(permissions, inherited), permissions);

      const explicitlyDisabled = await loadEntitledFeatureKeys(
        prismaWithEntitlements([
          { featureKey: legacyKey, enabled: true },
          { featureKey, enabled: false },
        ]),
        'co-1',
      );
      assert.equal(explicitlyDisabled?.has(featureKey), false);
      assert.deepEqual(
        filterPermissionsByEntitlement(permissions, explicitlyDisabled),
        permissions.filter((key) => survivesDisable.includes(key)),
      );
    }
  });

  it('materializes every registered child so parent-only companies keep all pre-submenu permissions', async () => {
    const featuresWithChildren = FEATURE_CATALOG.filter((feature) => feature.submenus.length > 0);
    const permissions = featuresWithChildren.flatMap((feature) =>
      feature.submenus.flatMap((submenu) => submenu.permissionKeys),
    );
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements(FEATURE_CATALOG.map((feature) => ({ featureKey: feature.key, enabled: true }))),
      'co-1',
    );

    assert.deepEqual(filterPermissionsByEntitlement(permissions, entitled), permissions);
  });

  it('materializes inherited expenses children so a parent-only company keeps the byte-identical pre-submenu permission set', async () => {
    const permissions = [
      'expense.read',
      'expense.read_own',
      'expense.receipt.upload',
      'expense.receipt.line_upload',
      'expense.ocr.request',
      'expense.create',
      'expense.update',
      'expense.category.manage',
      'expense.evidence.read',
      'expense.export',
      'expense.signature.manage',
      'expense.signature.approve',
    ];
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements([{ featureKey: 'expenses', enabled: true }]),
      'co-1',
    );

    assert.deepEqual(filterPermissionsByEntitlement(permissions, entitled), permissions);
  });

  it('keeps inherited children except an explicitly disabled child and strips only that child permissions', async () => {
    const permissions = [
      'expense.read',
      'expense.category.manage',
      'expense.evidence.read',
      'expense.signature.manage',
    ];
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements([
        { featureKey: 'expenses', enabled: true },
        { featureKey: 'expenses.categories', enabled: false },
      ]),
      'co-1',
    );

    assert.deepEqual(
      filterPermissionsByEntitlement(permissions, entitled),
      ['expense.read', 'expense.evidence.read', 'expense.signature.manage'],
    );
  });

  it('strips every child permission when its parent is off, including an explicitly enabled child row', async () => {
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements([
        { featureKey: 'expenses', enabled: false },
        { featureKey: 'expenses.evidence', enabled: true },
        { featureKey: 'crm', enabled: true },
      ]),
      'co-1',
    );

    assert.equal(entitled?.has('expenses.evidence'), true, 'loader preserves the explicit child row');
    assert.deepEqual(
      filterPermissionsByEntitlement(['expense.read', 'expense.evidence.read', 'crm.customer.read'], entitled),
      ['crm.customer.read'],
    );
  });

  it('returns null when the company has no rows so legacy fail-open remains unchanged', async () => {
    assert.equal(await loadEntitledFeatureKeys(prismaWithEntitlements([]), 'co-1'), null);
  });
});

describe('loadEntitledFeatureKeys default-on foundation features', () => {
  it("keeps existing tenants' access permissions when all original 12 feature rows exist and employee_access has no row", async () => {
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements(originalFeatureRows()),
      'co-1',
    );

    assert.deepEqual(filterPermissionsByEntitlement(ACCESS_PERMISSIONS, entitled), ACCESS_PERMISSIONS);
  });

  it('strips access permissions when employee_access is explicitly disabled', async () => {
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements([
        ...originalFeatureRows(),
        { featureKey: 'employee_access', enabled: false },
      ]),
      'co-1',
    );

    assert.deepEqual(filterPermissionsByEntitlement(ACCESS_PERMISSIONS, entitled), []);
  });

  it("keeps existing tenants' company settings permissions when all original 12 feature rows exist and company_settings has no row", async () => {
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements(originalFeatureRows()),
      'co-1',
    );

    assert.deepEqual(
      filterPermissionsByEntitlement(COMPANY_SETTINGS_PERMISSIONS, entitled),
      COMPANY_SETTINGS_PERMISSIONS,
    );
  });

  it('strips only the branch and security menus when company_settings is explicitly disabled', async () => {
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements([
        ...originalFeatureRows(),
        { featureKey: 'company_settings', enabled: false },
      ]),
      'co-1',
    );

    assert.deepEqual(
      filterPermissionsByEntitlement(COMPANY_SETTINGS_PERMISSIONS, entitled),
      COMPANY_FOUNDATION_PERMISSIONS,
    );
  });

  // Regression guard: tagging pack.company.settings.manage with the feature key would strip
  // attachment.create — granted by no other pack — and silently break every upload in the
  // product for that company, including receipt uploads under a still-enabled Expenses plan.
  it('keeps attachments and expense setup working when company_settings is disabled', async () => {
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements([
        ...originalFeatureRows(),
        { featureKey: 'company_settings', enabled: false },
      ]),
      'co-1',
    );

    assert.deepEqual(
      filterPermissionsByEntitlement(
        ['attachment.create', 'attachment.delete', 'company.setup.manage', 'company.branch.read'],
        entitled,
      ),
      ['attachment.create', 'attachment.delete', 'company.setup.manage'],
    );
  });

  it('keeps original feature keys deny-by-default when crm has no row', async () => {
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements(
        originalFeatureRows().filter((row) => row.featureKey !== 'crm'),
      ),
      'co-1',
    );

    assert.equal(entitled?.has('crm'), false);
    assert.deepEqual(filterPermissionsByEntitlement(['crm.customer.read'], entitled), []);
  });

  it('keeps account.session.read when company_settings is explicitly disabled', async () => {
    const entitled = await loadEntitledFeatureKeys(
      prismaWithEntitlements([
        ...originalFeatureRows(),
        { featureKey: 'company_settings', enabled: false },
      ]),
      'co-1',
    );

    assert.deepEqual(
      filterPermissionsByEntitlement(
        ['account.session.read', 'account.password.change', 'account.identity.link'],
        entitled,
      ),
      ['account.session.read'],
    );
  });

  it('defaults on only the two new compatibility features', () => {
    assert.deepEqual(DEFAULT_ON_FEATURE_KEYS, ['employee_access', 'company_settings']);
    assert.ok(ORIGINAL_FEATURE_KEYS.every((featureKey) => !DEFAULT_ON_FEATURE_KEYS.includes(featureKey)));
  });
});

// Step 0 (company-tax-identity-setup-spec §14): a company that never bought the Thai tax
// workspace still has to be able to state who it legally is. permission-matrix.md describes
// PREFIX filtering, which is what this proves does NOT reach `company.vat_registration.*`.
describe('Step 0 company tax identity permissions vs entitlements', () => {
  const STEP0_COMPANY_KEYS = [
    'company.legal_identity.read',
    'company.legal_identity.manage',
    'company.vat_registration.read',
    'company.vat_registration.manage',
  ];

  it('survives thai_tax being off', () => {
    const entitled = new Set<string>(ORIGINAL_FEATURE_KEYS.filter((key) => key !== 'thai_tax'));
    assert.deepEqual(filterPermissionsByEntitlement([...STEP0_COMPANY_KEYS], entitled), STEP0_COMPANY_KEYS);
  });

  it('survives every sellable feature being off', () => {
    assert.deepEqual(filterPermissionsByEntitlement([...STEP0_COMPANY_KEYS], new Set<string>()), STEP0_COMPANY_KEYS);
  });

  // The counterweight: buyer evidence edits a sales document, so it must still follow
  // sales_documents. If this ever passed with an empty set, the keys would be ungated by accident.
  it('still gates buyer-evidence remediation behind sales_documents', () => {
    const key = ['accounting.tax_document_buyer_evidence.manage'];
    assert.deepEqual(filterPermissionsByEntitlement([...key], new Set<string>()), []);
    assert.deepEqual(filterPermissionsByEntitlement([...key], new Set(['sales_documents'])), key);
    assert.deepEqual(filterPermissionsByEntitlement([...key], new Set(['thai_tax'])), []);
  });
});
