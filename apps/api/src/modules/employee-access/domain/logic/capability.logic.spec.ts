import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileRole, summarizeCapabilities, toEffectivePermissions } from './capability.logic';
import { CAPABILITY_PACKS, CAPABILITY_PACK_BY_KEY } from '../registries/capability-pack.registry';
import { COMPANY_ROLE_BACKFILLS } from '../registries/company-role-backfill.registry';
import { ROLE_TEMPLATES } from '../registries/role-template.registry';
import { COMPANY_PERMISSION_KEYS, REIMBURSEMENT_SELF_SERVICE_PERMISSIONS, ROLE_GRANTS } from '../../../auth/permission-registry';
import { filterPermissionsByEntitlement } from './feature-gate.logic';
import { evaluateEntitledFeatureKeys } from '../../application/entitlement.helper';
import { ListCapabilityPacksUseCase } from '../../application/use-cases/list-capability-packs.use-case';

const COMPANY_KEYS = new Set(COMPANY_PERMISSION_KEYS);

describe('capability-pack registry integrity', () => {
  it('shows own-request self-service as automatic rather than an ungrantable job pack for a feature-OFF editor', async () => {
    const catalog = await new ListCapabilityPacksUseCase({ client: { companyFeatureEntitlement: {
      findMany: async () => [{ featureKey: 'reimbursement', enabled: false }],
    } } } as any).execute('co-1', ['account.session.read'], false);
    const packs = catalog.modules.flatMap((module) => module.packs);
    const self = packs.find((pack) => pack.key === 'pack.reimbursement.self')!;
    assert.equal(self.isCore, true);
    assert.equal(self.grantableByCurrentUser, true);
    assert.equal(packs.find((pack) => pack.key === 'pack.reimbursement.approve')!.grantableByCurrentUser, false);
  });

  it('exposes package management as grantable only to the actual owner', async () => {
    const prisma = { client: { companyFeatureEntitlement: { findMany: async () => [] } } } as any;
    const useCase = new ListCapabilityPacksUseCase(prisma);
    const owner = await useCase.execute('co-1', ['company.plan.manage'], true);
    const delegated = await useCase.execute('co-1', ['company.plan.manage', 'access.role.financial.assign'], false);
    const findPack = (catalog: typeof owner) => catalog.modules.flatMap((module) => module.packs)
      .find((pack) => pack.key === 'pack.company.plan.manage');

    assert.equal(findPack(owner)?.grantableByCurrentUser, true);
    assert.equal(findPack(delegated)?.grantableByCurrentUser, false);
  });

  it('every pack key is a known company permission key', () => {
    for (const pack of CAPABILITY_PACKS) {
      for (const k of pack.permissionKeys) {
        assert.ok(COMPANY_KEYS.has(k), `pack ${pack.key} references unknown key ${k}`);
      }
    }
  });

  it('every pack granted expense.read is also granted expense.evidence.read', () => {
    for (const pack of CAPABILITY_PACKS) {
      if (pack.permissionKeys.includes('expense.read')) {
        assert.ok(
          pack.permissionKeys.includes('expense.evidence.read'),
          `Pack ${pack.key} grants expense.read but not expense.evidence.read`,
        );
      }
    }
  });

  // Owner decision 2026-10-01 (payout-account spec §13.3 F1): whoever approves a claim can record and void its
  // payment. The backfill that brings older company roles up to this is anchored on reimbursement.approve.
  it('every pack and system role granted reimbursement.approve is also granted payment.record and payment.void', () => {
    const pay = ['reimbursement.payment.record', 'reimbursement.payment.void'];
    const packs = CAPABILITY_PACKS.filter((pack) => pack.permissionKeys.includes('reimbursement.approve'));
    assert.deepEqual(packs.map((pack) => pack.key), ['pack.reimbursement.approve']);
    for (const pack of packs) for (const key of pay) assert.ok(pack.permissionKeys.includes(key), `Pack ${pack.key} approves but lacks ${key}`);
    const approverRoles = Object.entries(ROLE_GRANTS).filter(([, keys]) => keys.includes('reimbursement.approve'));
    assert.deepEqual(approverRoles.map(([role]) => role).sort(), ['ADMIN', 'MANAGER', 'OWNER']);
    for (const [role, keys] of approverRoles) for (const key of pay) assert.ok(keys.includes(key), `${role} approves but lacks ${key}`);
    assert.deepEqual(COMPANY_ROLE_BACKFILLS.filter((backfill) => backfill.anchor === 'reimbursement.approve').map((backfill) => backfill.key), pay);
  });

  // The foundation toggles are enforced by submenu rules, not by tagging these packs. Tagging
  // them would strip everything else they carry — most damagingly attachment.create, which is
  // granted by no other pack and guards every upload endpoint in the product.
  it('leaves the foundation administration packs untagged and keeps sessions core', () => {
    assert.equal(CAPABILITY_PACK_BY_KEY.get('pack.people.view')?.featureEntitlementKey, undefined);
    assert.equal(CAPABILITY_PACK_BY_KEY.get('pack.people.manage')?.featureEntitlementKey, undefined);
    assert.equal(CAPABILITY_PACK_BY_KEY.get('pack.company.settings.view')?.featureEntitlementKey, undefined);
    assert.equal(CAPABILITY_PACK_BY_KEY.get('pack.company.settings.manage')?.featureEntitlementKey, undefined);
    assert.ok(CAPABILITY_PACK_BY_KEY.get('pack.core.basics')?.permissionKeys.includes('account.session.read'));
    assert.equal(CAPABILITY_PACK_BY_KEY.get('pack.core.basics')?.featureEntitlementKey, undefined);
  });

  // sync-permissions.ts grants each backfill key to every company role already holding its anchor.
  // If an anchor appears in a pack that does NOT grant the key, the backfill widens roles that were
  // never entitled to it — so the anchor must imply the key across the whole pack catalog.
  describe('company-role backfill anchors', () => {
    it('uses keys and anchors that are real company permissions', () => {
      for (const backfill of COMPANY_ROLE_BACKFILLS) {
        assert.ok(COMPANY_KEYS.has(backfill.key), `backfill key ${backfill.key} is not a company permission`);
        if (backfill.anchor) {
          assert.ok(COMPANY_KEYS.has(backfill.anchor), `anchor ${backfill.anchor} is not a company permission`);
        }
        assert.ok(backfill.why.length > 0, `backfill ${backfill.key} must say why it exists`);
      }
    });

    it('never grants a key to a pack that holds the anchor but not the key', () => {
      for (const backfill of COMPANY_ROLE_BACKFILLS) {
        if (!backfill.anchor) continue;
        for (const pack of CAPABILITY_PACKS) {
          if (!pack.permissionKeys.includes(backfill.anchor)) continue;
          assert.ok(
            pack.permissionKeys.includes(backfill.key),
            `pack ${pack.key} grants anchor ${backfill.anchor} but not ${backfill.key}: `
            + 'the backfill would widen roles built from this pack',
          );
        }
      }
    });

    it('anchors every key that is not universal, so a backfill cannot hit read-only roles', () => {
      const universal = COMPANY_ROLE_BACKFILLS.filter((backfill) => backfill.anchor === null);
      assert.deepEqual(universal.map((backfill) => backfill.key), [
        ...REIMBURSEMENT_SELF_SERVICE_PERMISSIONS,
        'account.password.change', 'dashboard.read', 'accounting.document.read_related', 'expense.read_related',
        'reimbursement.read_related',
        'procurement.purchase_request.read_related', 'procurement.purchase_order.read_related',
        'procurement.goods_receipt.read_related', 'procurement.vendor_bill.read_related',
        'procurement.supplier_payment.read_related',
      ]);
    });
  });

  it('every preset references only known packs', () => {
    for (const tpl of ROLE_TEMPLATES) {
      for (const pk of tpl.capabilityPackKeys) {
        assert.ok(CAPABILITY_PACK_BY_KEY.has(pk), `preset ${tpl.key} references unknown pack ${pk}`);
      }
    }
  });
});

describe('compileRole', () => {
  it('every template and custom role receives mandatory own reimbursement, including evidence/branch prerequisites', () => {
    for (const roleTemplateKey of [undefined, ...ROLE_TEMPLATES.map((template) => template.key)]) {
      const { permissionKeys } = compileRole({ roleTemplateKey, entitledFeatureKeys: null });
      for (const key of REIMBURSEMENT_SELF_SERVICE_PERMISSIONS) {
        assert.ok(permissionKeys.includes(key), `${roleTemplateKey ?? 'custom'}: ${key}`);
      }
    }
    const ownOnly = compileRole({ entitledFeatureKeys: null }).permissionKeys;
    for (const key of ['reimbursement.read', 'reimbursement.approve', 'reimbursement.finance_review',
      'reimbursement.payment.record', 'reimbursement.export', 'reimbursement.policy.manage']) {
      assert.equal(ownOnly.includes(key), false, `automatic baseline must not grant ${key}`);
    }
    assert.equal(CAPABILITY_PACK_BY_KEY.get('pack.reimbursement.self')?.isCore, true);
  });

  it('persists universal own service despite a feature-OFF granter, but runtime OFF still blocks new claims', () => {
    const { permissionKeys, dropped } = compileRole({
      permissionKeys: ['reimbursement.approve', 'reimbursement.payment.record'],
      granterPermissionKeys: new Set(['account.session.read']),
      entitledFeatureKeys: new Set(),
    });
    for (const key of REIMBURSEMENT_SELF_SERVICE_PERMISSIONS) assert.ok(permissionKeys.includes(key));
    assert.deepEqual(dropped.filter(({ key }) => ['reimbursement.approve', 'reimbursement.payment.record'].includes(key)), [
      { key: 'reimbursement.approve', reason: 'above_granter_scope' },
      { key: 'reimbursement.payment.record', reason: 'above_granter_scope' },
    ]);
    const off = filterPermissionsByEntitlement(permissionKeys, new Set());
    assert.ok(off.includes('reimbursement.read_own'));
    assert.equal(off.includes('reimbursement.create'), false);
    assert.equal(off.includes('reimbursement.submit'), false);
    const on = filterPermissionsByEntitlement(permissionKeys, evaluateEntitledFeatureKeys([{ featureKey: 'reimbursement', enabled: true }]));
    for (const key of REIMBURSEMENT_SELF_SERVICE_PERMISSIONS) assert.ok(on.includes(key));
  });

  it('expands a preset into permission keys and always includes core basics', () => {
    const { permissionKeys, dropped } = compileRole({ roleTemplateKey: 'tpl.retail.cashier', entitledFeatureKeys: null });
    assert.equal(dropped.length, 0);
    assert.ok(permissionKeys.includes('account.session.read'), 'core pack applied');
    assert.ok(permissionKeys.includes('accounting.payment.create'), 'cashier can record payments');
    assert.ok(permissionKeys.includes('accounting.receipt.issue'), 'cashier can issue receipts');
    assert.ok(!permissionKeys.includes('accounting.tax_invoice.issue'), 'cashier cannot issue tax invoices');
  });

  it('drops packs whose feature is not entitled', () => {
    const entitled = new Set<string>(); // company has config, nothing enabled
    const { permissionKeys, dropped } = compileRole({ capabilityPackKeys: ['pack.inventory.view'], entitledFeatureKeys: entitled });
    assert.ok(!permissionKeys.includes('inventory.product.read'), 'non-entitled pack dropped');
    assert.ok(dropped.some((d) => d.key === 'pack.inventory.view' && d.reason === 'not_entitled'));
  });

  it('keeps entitled packs', () => {
    const { permissionKeys } = compileRole({ capabilityPackKeys: ['pack.inventory.view'], entitledFeatureKeys: new Set(['inventory']) });
    assert.ok(permissionKeys.includes('inventory.product.read'));
  });

  it('drops keys above the granter scope but never for OWNER (null granter)', () => {
    // granter holds crm.customer.read plus the core-basics keys it would already have as an employee.
    const granter = new Set(['crm.customer.read', 'account.session.read']);
    const scoped = compileRole({ permissionKeys: ['crm.customer.read', 'crm.customer.export'], entitledFeatureKeys: null, granterPermissionKeys: granter });
    assert.ok(scoped.permissionKeys.includes('crm.customer.read'));
    assert.ok(!scoped.permissionKeys.includes('crm.customer.export'), 'export dropped: above granter scope');
    assert.ok(scoped.dropped.some((d) => d.key === 'crm.customer.export' && d.reason === 'above_granter_scope'));

    // OWNER (null granter) keeps everything; core basics are always folded in.
    const owner = compileRole({ permissionKeys: ['crm.customer.read', 'crm.customer.export'], entitledFeatureKeys: null, granterPermissionKeys: null });
    assert.ok(owner.permissionKeys.includes('crm.customer.export'));
    assert.ok(owner.permissionKeys.includes('crm.customer.read'));
    assert.ok(owner.permissionKeys.includes('account.session.read'), 'core basics folded in');
  });

  it('flags unknown pack and permission keys', () => {
    const { dropped } = compileRole({ capabilityPackKeys: ['pack.nope'], permissionKeys: ['not.a.key'], entitledFeatureKeys: null });
    assert.ok(dropped.some((d) => d.key === 'pack.nope' && d.reason === 'unknown'));
    assert.ok(dropped.some((d) => d.key === 'not.a.key' && d.reason === 'unknown'));
  });
});

describe('summarize', () => {
  it('reports covered non-core packs from a key set', () => {
    const { permissionKeys } = compileRole({ capabilityPackKeys: ['pack.inventory.view'], entitledFeatureKeys: new Set(['inventory']) });
    const caps = summarizeCapabilities(permissionKeys);
    assert.ok(caps.some((c) => c.packKey === 'pack.inventory.view'));
    assert.ok(!caps.some((c) => c.packKey === 'pack.core.basics'), 'core packs excluded from summary');
  });

  it('maps keys to effective permissions with descriptions', () => {
    const perms = toEffectivePermissions(['crm.customer.read', 'not.a.key']);
    assert.equal(perms.length, 1);
    assert.equal(perms[0].module, 'crm');
    assert.ok(perms[0].description.length > 0);
  });
});
