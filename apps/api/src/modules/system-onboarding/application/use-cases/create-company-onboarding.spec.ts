import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { CreateCompanyOnboardingUseCase } from './create-company-onboarding.use-case';
import { verifyPassword } from '../../../auth/domain/logic/password-credential.logic';
import { ALL_FEATURE_ENTITLEMENT_KEYS, FEATURE_PACKAGE_PRESETS } from '@watchdog-bms/contracts';
import { WORKFLOW_TEMPLATE_CATALOG } from '../../../workflow/domain/workflow-template-catalog';
import { APPROVED_FEATURE_KEYS } from '../../../system-partner-management/domain/feature-registry';
import { resolveTransactionTaxPreview } from '../../../tax/domain/logic/transaction-tax.logic';
import { bootstrapCompanyTaxConfiguration, TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID } from '../../../tax/application/services/tax-config-bootstrap.service';
import { CompanySignupCoreService } from '../../../external-signup/application/company-signup-core.service';
import {
  canTransitionCompanySignup,
  companySignupPayloadHash,
  normalizeCompanySignupInput,
} from '../../../external-signup/domain/company-signup.logic';

// ponytail: unit-level; prisma and all side-effects are mocked inline

const configMock = { credentialEncryptionKey: Buffer.alloc(32, 7) } as any;

// Onboarding auto-enables the autoEnable workflow templates in the same transaction, through
// PrismaWorkflowRepository over `tx`. These are the model calls that repository makes.
function workflowTx(createdRules: any[] = []) {
  return {
    workflowTemplate: {
      findUnique: async ({ where }: any) => ({
        id: `tpl-${where.key}`, key: where.key, name: where.key, description: 'd', category: 'finance',
        sourceModule: 'reimbursements', triggerType: 'EVENT', defaultConditionJson: { field: 'requestId', op: 'EXISTS' },
        defaultActionJson: [], requiredPermissions: [], requiredSourceModules: [], defaultEnabled: false,
        status: 'AVAILABLE', createdAt: new Date(), updatedAt: new Date(),
      }),
    },
    workflowRule: {
      findMany: async () => [],
      create: async ({ data }: any) => {
        const rule = { id: `wr-${createdRules.length}`, currentVersion: 0, createdAt: new Date(), updatedAt: new Date(), ...data };
        createdRules.push(rule);
        return rule;
      },
      update: async ({ where, data }: any) => Object.assign(createdRules.find((r) => r.id === where.id), data),
    },
    workflowRuleVersion: { create: async ({ data }: any) => ({ id: 'wrv-1', ...data }) },
  };
}

// F1.5.1 item 1: onboarding seeds the full canonical entitlement key set, the CAS root and the
// COMPLETED normalization marker in ONE transaction, so a new company never hits the
// normalization gate the partner entitlement command enforces.
function entitlementTx(capture: { entitlements?: any; set?: any; normalization?: any } = {}) {
  return {
    companyFeatureEntitlement: {
      createMany: async (args: any) => { capture.entitlements = args; return { count: args.data.length }; },
    },
    companyEntitlementSet: { create: async (args: any) => { capture.set = args; return { id: 'set-1' }; } },
    companyEntitlementNormalization: {
      create: async (args: any) => { capture.normalization = args; return { id: 'norm-1' }; },
    },
  };
}

// RA-16: onboarding also seeds the ACTIVE TH domestic-expense Tax Code profile with its Tax Codes,
// account-determination rules and ภ.พ.30 mappings, in the same transaction as the chart.
function taxConfigTx(capture: { profile?: any; definitions?: any[]; accountRules?: any; reportRules?: any } = {}) {
  capture.definitions = [];
  return {
    companyTaxCodeProfile: {
      count: async () => 0,
      create: async (args: any) => { capture.profile = args.data; return { id: 'tax-profile-1', ...args.data }; },
    },
    taxCodeDefinition: {
      create: async (args: any) => {
        const row = { id: `tax-def-${capture.definitions!.length}`, ...args.data };
        capture.definitions!.push(row);
        return row;
      },
    },
    taxAccountDeterminationRule: {
      createMany: async (args: any) => { capture.accountRules = args.data; return { count: args.data.length }; },
    },
    taxReportMappingRule: {
      createMany: async (args: any) => { capture.reportRules = args.data; return { count: args.data.length }; },
    },
  };
}

function chartBootstrapTx(companyId: string) {
  const rows: any[] = [];
  return {
    companyUpdate: async () => ({ id: companyId }),
    chartOfAccount: {
      count: async ({ where }: any) => rows.filter((row) => row.companyId === where.companyId).length,
      findMany: async ({ where }: any) => {
        if (where.companyId === null) return [];
        // Honours code/status/isPosting too: the tax bootstrap hard-fails onboarding when a mapped
        // account is missing, inactive, or not posting-enabled.
        return rows.filter((row) => row.companyId === where.companyId
          && (!where.code?.in || where.code.in.includes(row.code))
          && (where.status === undefined || row.status === where.status)
          && (where.isPosting === undefined || row.isPosting === where.isPosting));
      },
      createMany: async ({ data }: any) => {
        rows.push(...data.map((row: any, index: number) => ({ id: `coa-${index}`, ...row })));
        return { count: data.length };
      },
    },
    rows,
  };
}

/**
 * The expense-category bootstrap seeds through the same tx and hard-fails onboarding when one of
 * its accounts is not postable, so the fake has to record what it wrote for the assertions below.
 */
function expenseCategoryTx() {
  seededExpenseCategories = [];
  return {
    expenseCategory: {
      createMany: async ({ data }: any) => {
        seededExpenseCategories.push(...data);
        return { count: data.length };
      },
    },
    // The revenue-category bootstrap (ledger spec F-LED-2) seeds through the same tx; it never
    // fails onboarding (skipDuplicates against the NOT NULL companyId unique fence).
    revenueCategory: {
      createMany: async ({ data }: any) => ({ count: data.length }),
    },
  };
}

function makeCmd(overrides: Partial<Parameters<CreateCompanyOnboardingUseCase['execute']>[0]> = {}) {
  return {
    companyName: 'Acme Co',
    businessCategory: 'RETAIL',
    ownerFirstName: 'John',
    ownerLastName: 'Doe',
    ownerUsername: 'john.doe',
    requestingAdminUserId: 'admin-1',
    requestId: 'req-1',
    webBaseUrl: 'http://localhost:3000',
    apiBaseUrl: 'http://localhost:3001/v1',
    ...overrides,
  } as Parameters<CreateCompanyOnboardingUseCase['execute']>[0];
}

/** Rows the last makePrisma() run seeded, so a test can assert on the catalogue it wrote. */
let seededExpenseCategories: any[] = [];

function makePrisma(opts: {
  existingUsername?: boolean;
  existingCompany?: boolean;
  ownerRoleFound?: boolean;
}) {
  const ownerRole = opts.ownerRoleFound ?? true ? { id: 'role-owner' } : null;
  // P29 §4A: the post-commit default-term write. Recorded, never asserted-on by the pre-existing
  // tests — a failure here must never change the onboarding result.
  const planTermUpserts: any[] = [];
  const txResult = {
    company: { id: 'co-1' },
    owner: { id: 'owner-1' },
    handoffUrl: 'http://localhost:3000/companies/co-1/dashboard',
    run: { id: 'run-1' },
  };
  return {
    planTermUpserts: () => planTermUpserts,
    client: {
      user: {
        findUnique: async () => opts.existingUsername ? { id: 'existing' } : null,
      },
      company: {
        findFirst: async () => opts.existingCompany ? { id: 'existing' } : null,
      },
      role: {
        findUnique: async () => ownerRole,
      },
      companyPlanTerm: { upsert: async (args: any) => { planTermUpserts.push(args); return args.create; } },
      auditLog: { create: async () => ({}) },
      $transaction: async (fn: (tx: any) => Promise<any>) => {
        const chart = chartBootstrapTx('co-1');
        const tx = {
            ...expenseCategoryTx(),
          company: { create: async () => txResult.company, update: chart.companyUpdate },
          chartOfAccount: chart.chartOfAccount,
          user: { create: async () => txResult.owner },
          userCredential: { create: async () => ({}) },
          companyMembership: { create: async () => ({ id: 'mem-1' }) },
          membershipRole: { create: async () => ({}) },
          employeeLineLinkToken: { create: async () => ({}) },
          branch: { create: async () => ({}) },
          companyVatRegistrationState: { create: async () => ({}) },
          ...entitlementTx(),
          ...taxConfigTx(),
          companyOnboardingRun: { create: async (args: any) => ({ id: 'run-1', ...args.data }) },
          auditLog: { create: async () => ({}) },
          ...workflowTx(),
        };
        return fn(tx);
      },
    },
  } as any;
}

describe('CreateCompanyOnboardingUseCase', () => {
  it('throws ConflictException when username already exists', async () => {
    const prisma = makePrisma({ existingUsername: true });
    const useCase = new CreateCompanyOnboardingUseCase(prisma, configMock);
    await assert.rejects(
      () => useCase.execute(makeCmd()),
      (err: unknown) => { assert.ok(err instanceof ConflictException); return true; },
    );
  });

  it('throws ConflictException when company name already exists', async () => {
    const prisma = makePrisma({ existingCompany: true });
    const useCase = new CreateCompanyOnboardingUseCase(prisma, configMock);
    await assert.rejects(
      () => useCase.execute(makeCmd()),
      (err: unknown) => { assert.ok(err instanceof ConflictException); return true; },
    );
  });

  it('throws NotFoundException when OWNER role is not seeded', async () => {
    const prisma = makePrisma({ ownerRoleFound: false });
    const useCase = new CreateCompanyOnboardingUseCase(prisma, configMock);
    await assert.rejects(
      () => useCase.execute(makeCmd()),
      (err: unknown) => { assert.ok(err instanceof NotFoundException); return true; },
    );
  });

  it('returns result with temporaryPassword and correct structure', async () => {
    const prisma = makePrisma({});
    // ponytail: capture credential and line-link create args to verify hashes
    let credArgs: any;
    let lineTokenArgs: any;
    const entitlement: { entitlements?: any; set?: any; normalization?: any } = {};
    const autoEnabledRules: any[] = [];
    let transactionOptions: any;
    let persistedChartRows: any[] = [];
    prisma.client.$transaction = async (fn: (tx: any) => Promise<any>, options: any) => {
      transactionOptions = options;
      const chart = chartBootstrapTx('co-1');
      persistedChartRows = chart.rows;
      const tx = {
            ...expenseCategoryTx(),
        company: { create: async () => ({ id: 'co-1' }), update: chart.companyUpdate },
        chartOfAccount: chart.chartOfAccount,
        user: { create: async () => ({ id: 'owner-1' }) },
        userCredential: { create: async (args: any) => { credArgs = args; return {}; } },
        companyMembership: { create: async () => ({ id: 'mem-1' }) },
        membershipRole: { create: async () => ({}) },
        employeeLineLinkToken: { create: async (args: any) => { lineTokenArgs = args; return {}; } },
        branch: { create: async () => ({}) },
        companyVatRegistrationState: { create: async () => ({}) },
        ...entitlementTx(entitlement),
        ...taxConfigTx(),
        companyOnboardingRun: { create: async () => ({ id: 'run-1' }) },
        auditLog: { create: async () => ({}) },
        ...workflowTx(autoEnabledRules),
      };
      return fn(tx);
    };

    const useCase = new CreateCompanyOnboardingUseCase(prisma, configMock);
    const result = await useCase.execute(makeCmd({ lineOaAddUrl: 'https://line.me/R/oa' }));

    // temporaryPassword is present and non-empty
    assert.ok(result.temporaryPassword, 'temporaryPassword must be returned');
    assert.ok(result.temporaryPassword.length >= 12, 'password should be 12 chars');

    // password hash is not the password itself (i.e. it is hashed)
    assert.ok(credArgs.data.passwordHash !== result.temporaryPassword);

    // hash verifies correctly
    assert.equal(verifyPassword(result.temporaryPassword, credArgs.data.passwordHash), true);

    // credential must require a password change
    assert.equal(credArgs.data.mustChangePassword, true);
    assert.equal(credArgs.data.status, 'TEMPORARY');

    // result fields
    assert.equal(result.onboardingRunId, 'run-1');
    assert.equal(result.companyId, 'co-1');
    assert.equal(result.ownerId, 'owner-1');
    assert.equal(result.username, 'john.doe');
    assert.ok(result.handoffUrl.includes('/companies/co-1/dashboard'));
    assert.equal(result.lineAddUrl, 'https://line.me/R/oa');
    assert.equal(result.chartOfAccounts.templateKey, 'TH_SME_COA_V1');
    assert.equal(result.chartOfAccounts.accountCount, 175);
    assert.equal(result.chartOfAccounts.readyForManualLedger, true);
    assert.equal(result.chartOfAccounts.readyForAutomaticPosting, false);

    // Without a catalogue a new company cannot issue ใบรับรองแทนใบเสร็จ, AI/OCR has nothing to
    // classify into, and every confirmed expense parks at postingStatus `pending` to fail the
    // eventual backfill. Seeded bound, and stamped machine-attested rather than human-reviewed.
    assert.equal(result.expenseCategories.categoryCount, seededExpenseCategories.length);
    assert.ok(seededExpenseCategories.length > 0);
    assert.ok(seededExpenseCategories.every((row) => row.companyId === 'co-1' && row.ledgerAccountCode));
    assert.ok(seededExpenseCategories.every((row) => row.ledgerAccountReviewedByUserId === 'system:expense-category-bootstrap'));
    assert.ok(seededExpenseCategories.some((row) => row.name === 'ค่ารับรอง' && row.defaultInputTaxCode === 'ND'));
    assert.deepEqual(transactionOptions, { maxWait: 5_000, timeout: 15_000 });
    assert.equal(persistedChartRows.length, 175);
    assert.ok(persistedChartRows.every((row) => row.companyId === 'co-1' && row.isSystem === false));

    // owner LINE link package: single-use token bound to the owner membership/user
    assert.ok(result.ownerLineLink, 'ownerLineLink must be returned');
    assert.ok(result.ownerLineLink.linkUrl.startsWith('http://localhost:3001/v1/auth/line/link-page/employee?token='));
    // H-09: QR is rendered locally as a data URI — the bearer link never rides a third-party image URL
    assert.ok(result.ownerLineLink.qrImageUrl.startsWith('data:image/svg+xml;base64,'));
    assert.equal(lineTokenArgs.data.userId, 'owner-1');
    assert.equal(lineTokenArgs.data.membershipId, 'mem-1');
    // raw token never persisted — only its hash
    const rawToken = new URL(result.ownerLineLink.linkUrl).searchParams.get('token')!;
    assert.notEqual(lineTokenArgs.data.tokenHash, rawToken);
    // handoff-window TTL matches the 72h temporary-password window, not the 15-minute in-person TTL
    const ttlMs = new Date(result.ownerLineLink.expiresAt).getTime() - Date.now();
    assert.ok(ttlMs > 71 * 60 * 60 * 1000, 'owner QR should carry the 72h handoff TTL');
    assert.ok(ttlMs <= 72 * 60 * 60 * 1000, 'owner QR TTL must not exceed 72h');

    // Zero admin setup: the autoEnable workflow templates arrive as ENABLED rules on the new
    // company, in the same transaction, so notifications work before any release-task run.
    const autoEnableKeys = WORKFLOW_TEMPLATE_CATALOG.filter((t) => t.autoEnable).map((t) => t.key);
    assert.equal(autoEnabledRules.length, autoEnableKeys.length);
    assert.ok(autoEnabledRules.every((rule) => rule.status === 'ENABLED' && rule.companyId === 'co-1'));
    assert.deepEqual(
      autoEnabledRules.map((rule) => String(rule.templateId).replace('tpl-', '')).sort(),
      [...autoEnableKeys].sort(),
    );

    // Standard feature package: an explicit row for every CANONICAL entitlement key — parents AND
    // submenus (60 today) — so the new company never reads as the legacy fail-open sentinel and
    // never hits the partner command's normalization gate.
    const rows = entitlement.entitlements.data as Array<{ featureKey: string; enabled: boolean }>;
    assert.equal(rows.length, ALL_FEATURE_ENTITLEMENT_KEYS.length, 'every canonical entitlement key gets an explicit row');
    assert.ok(rows.length > APPROVED_FEATURE_KEYS.length, 'submenus are seeded too, not just the 18 parents');
    assert.deepEqual(rows.map((r) => r.featureKey).sort(), [...ALL_FEATURE_ENTITLEMENT_KEYS].sort());
    // The foundation pair must be on: onboarding writes explicit rows and explicit false beats
    // DEFAULT_ON_FEATURE_KEYS, so without them a brand-new company could not add its first
    // employee or see its own branches until an operator intervened. A submenu follows its parent.
    const enabledParents = rows
      .filter((r) => r.enabled && !r.featureKey.includes('.'))
      .map((r) => r.featureKey)
      .sort();
    assert.deepEqual(enabledParents, [
      'ai_line_assistant', 'company_settings', 'crm', 'dashboard_notifications', 'double_entry_ledger',
      'employee_access', 'expenses', 'line_oa', 'product_catalog', 'reimbursement', 'thai_tax',
      'workflow_automation',
    ]);
    assert.equal(rows.find((row) => row.featureKey === 'crm.bookings')?.enabled, true, 'submenu inherits its parent');
    assert.equal(rows.find((row) => row.featureKey === 'procurement.vendor_bills')?.enabled, false);
    assert.equal(rows.find((row) => row.featureKey === 'expense_auto_post')?.enabled, false);
    assert.ok(rows.every((r) => (r as any).companyId === 'co-1'));
    // `grantOrigin` is never set: these are EXPLICIT new-company grants, not a LEGACY backfill.
    assert.ok(rows.every((r) => !('grantOrigin' in r)));

    // The CAS root and the COMPLETED normalization marker land in the SAME transaction.
    assert.deepEqual(entitlement.set.data, { companyId: 'co-1' });
    assert.equal(entitlement.normalization.data.companyId, 'co-1');
    assert.equal(entitlement.normalization.data.status, 'COMPLETED');
    assert.equal(entitlement.normalization.data.runId, 'req-1');
    assert.match(entitlement.normalization.data.snapshotHash, /^[0-9a-f]{64}$/);
    assert.ok(entitlement.normalization.data.completedAt instanceof Date);
  });

  it('rolls the whole seed back when one of the three entitlement writes fails', async () => {
    // The gate is only safe if it is impossible to commit rows without the COMPLETED marker (or
    // the marker without the rows). The transaction is the guarantee — assert it stays one unit.
    for (const failing of ['companyFeatureEntitlement', 'companyEntitlementSet', 'companyEntitlementNormalization']) {
      const prisma = makePrisma({});
      const written: string[] = [];
      let runCreates = 0;
      let auditCreates = 0;
      prisma.client.$transaction = async (fn: (tx: any) => Promise<any>) => {
        const chart = chartBootstrapTx('co-1');
        const seed = entitlementTx();
        const guard = (model: string, impl: any) => (
          failing === model
            ? { ...impl, ...(model === 'companyFeatureEntitlement' ? { createMany: async () => { throw new Error(`${model} failed`); } } : { create: async () => { throw new Error(`${model} failed`); } }) }
            : new Proxy(impl, { get: (target, key) => async (args: any) => { written.push(model); return (target as any)[key](args); } })
        );
        return fn({
          ...expenseCategoryTx(),
          company: { create: async () => ({ id: 'co-1' }), update: chart.companyUpdate },
          chartOfAccount: chart.chartOfAccount,
          user: { create: async () => ({ id: 'owner-1' }) },
          userCredential: { create: async () => ({}) },
          companyMembership: { create: async () => ({ id: 'mem-1' }) },
          membershipRole: { create: async () => ({}) },
          employeeLineLinkToken: { create: async () => ({}) },
          branch: { create: async () => ({}) },
          companyVatRegistrationState: { create: async () => ({}) },
          ...taxConfigTx(),
          companyFeatureEntitlement: guard('companyFeatureEntitlement', seed.companyFeatureEntitlement),
          companyEntitlementSet: guard('companyEntitlementSet', seed.companyEntitlementSet),
          companyEntitlementNormalization: guard('companyEntitlementNormalization', seed.companyEntitlementNormalization),
          companyOnboardingRun: { create: async () => { runCreates += 1; return { id: 'run-1' }; } },
          auditLog: { create: async () => { auditCreates += 1; return {}; } },
          ...workflowTx(),
        });
      };

      await assert.rejects(
        () => new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd()),
        new RegExp(`${failing} failed`),
      );
      // The transaction aborts on the first failure: nothing downstream of the seed is written,
      // so no company is ever left with a partial entitlement state.
      assert.equal(runCreates, 0, `${failing}: onboarding run must not be created`);
      assert.equal(auditCreates, 0, `${failing}: success audit must not be written`);
      assert.ok(!written.includes(failing), `${failing}: the failing write never lands`);
      assert.equal(
        written.includes('companyEntitlementNormalization'),
        false,
        `${failing}: the COMPLETED marker never lands without the rows it describes`,
      );
    }
  });

  it('audit log metadataJson does NOT contain temporaryPassword', async () => {
    const prisma = makePrisma({});
    let auditArgs: any;
    prisma.client.$transaction = async (fn: (tx: any) => Promise<any>) => {
      const chart = chartBootstrapTx('co-1');
      const tx = {
            ...expenseCategoryTx(),
        company: { create: async () => ({ id: 'co-1' }), update: chart.companyUpdate },
        chartOfAccount: chart.chartOfAccount,
        user: { create: async () => ({ id: 'owner-1' }) },
        userCredential: { create: async () => ({}) },
        companyMembership: { create: async () => ({ id: 'mem-1' }) },
        membershipRole: { create: async () => ({}) },
        employeeLineLinkToken: { create: async () => ({}) },
        branch: { create: async () => ({}) },
        companyVatRegistrationState: { create: async () => ({}) },
        ...entitlementTx(),
        ...taxConfigTx(),
        companyOnboardingRun: { create: async () => ({ id: 'run-1' }) },
        auditLog: { create: async (args: any) => { auditArgs = args; return {}; } },
        ...workflowTx(),
      };
      return fn(tx);
    };

    const useCase = new CreateCompanyOnboardingUseCase(prisma, configMock);
    await useCase.execute(makeCmd());

    const meta = auditArgs.data.metadataJson;
    // temporaryPassword must never appear in audit metadata
    assert.ok(!('temporaryPassword' in meta), 'temporaryPassword must NOT appear in audit log');
    assert.ok(!('passwordHash' in meta), 'passwordHash must NOT appear in audit log');
  });

  it('does not create a completed run or success audit when chart bootstrap fails', async () => {
    const prisma = makePrisma({});
    let runCreates = 0;
    let auditCreates = 0;
    prisma.client.$transaction = async (fn: (tx: any) => Promise<any>) => fn({
      company: { create: async () => ({ id: 'co-failed' }), update: async () => ({}) },
      chartOfAccount: {
        count: async () => 0,
        findMany: async () => [],
        createMany: async () => { throw new Error('row insert failed'); },
      },
      user: { create: async () => ({ id: 'owner-1' }) },
      userCredential: { create: async () => ({}) },
      companyMembership: { create: async () => ({ id: 'mem-1' }) },
      membershipRole: { create: async () => ({}) },
      employeeLineLinkToken: { create: async () => ({}) },
      branch: { create: async () => ({}) },
      companyVatRegistrationState: { create: async () => ({}) },
      ...entitlementTx(),
      companyOnboardingRun: { create: async () => { runCreates += 1; return { id: 'run-1' }; } },
      auditLog: { create: async () => { auditCreates += 1; return {}; } },
      ...workflowTx(),
    });

    await assert.rejects(
      () => new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd()),
      (error: any) => error.getResponse?.().code === 'coa_postcondition_failed',
    );
    assert.equal(runCreates, 0);
    assert.equal(auditCreates, 0);
  });

  // Step 0: every company starts with a head office that IS a ภ.พ.20 establishment and with a
  // VAT registration state at version 0. Without the state row the first compare-and-set has
  // nothing to compare against, and creating it lazily inside the command would race two
  // concurrent first answers.
  it('creates the head office as a VAT establishment and a version-0 VAT state', async () => {
    const prisma = makePrisma({});
    let branchData: any;
    let vatStateData: any;
    const inner = prisma.client.$transaction;
    prisma.client.$transaction = async (fn: (tx: any) => Promise<any>, opts?: any) =>
      inner.call(prisma.client, async (tx: any) => {
        tx.branch = { create: async (args: any) => { branchData = args.data; return {}; } };
        tx.companyVatRegistrationState = { create: async (args: any) => { vatStateData = args.data; return {}; } };
        return fn(tx);
      }, opts);

    await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd());

    assert.equal(branchData.taxBranchCode, '00000');
    assert.equal(branchData.isVatEstablishment, true);
    assert.equal(vatStateData.version, 0);
    assert.ok(vatStateData.companyId);
  });

  // Owner decision (UAT round 1): self-signup shops start on the "เริ่มต้น" preset — the same rows
  // the admin console's preset button submits — so a trial shop opens without the CRM group.
  it("modulePackage 'starter' seeds exactly the admin console starter preset", async () => {
    const prisma = makePrisma({});
    let entitlementRows: Array<{ featureKey: string; enabled: boolean }> | undefined;
    const inner = prisma.client.$transaction;
    prisma.client.$transaction = async (fn: (tx: any) => Promise<any>, opts?: any) =>
      inner.call(prisma.client, async (tx: any) => {
        const passthrough = tx.companyFeatureEntitlement.createMany;
        tx.companyFeatureEntitlement = {
          createMany: async (args: any) => { entitlementRows = args.data; return passthrough(args); },
        };
        return fn(tx);
      }, opts);
    await new CreateCompanyOnboardingUseCase(prisma, configMock).execute({ ...makeCmd(), modulePackage: 'starter' } as any);

    assert.ok(entitlementRows, 'entitlement rows are still seeded');
    assert.equal(entitlementRows.length, ALL_FEATURE_ENTITLEMENT_KEYS.length, 'still one explicit row per canonical key');
    const starter = new Set<string>(FEATURE_PACKAGE_PRESETS.starter.featureKeys);
    for (const row of entitlementRows) {
      assert.equal(row.enabled, starter.has(row.featureKey), `row ${row.featureKey} must mirror the preset`);
    }
    assert.equal(entitlementRows.find((row) => row.featureKey === 'crm')?.enabled, false, 'CRM stays off on starter');
    assert.equal(entitlementRows.find((row) => row.featureKey === 'expenses')?.enabled, true, 'expenses stays on');
  });

  // The VAT question is asked once, where the company is created. An admin who does not know
  // leaves it out — and "unknown" must never be recorded as "not registered".
  it('records the admin answer as the first VAT fact, and records nothing when unanswered', async () => {
    async function run(cmdExtra: Record<string, unknown>) {
      const prisma = makePrisma({});
      let vatStateData: any;
      let factData: any;
      const companyUpdates: any[] = [];
      const inner = prisma.client.$transaction;
      prisma.client.$transaction = async (fn: (tx: any) => Promise<any>, opts?: any) =>
        inner.call(prisma.client, async (tx: any) => {
          tx.companyVatRegistrationState = { create: async (args: any) => { vatStateData = args.data; return {}; } };
          tx.companyVatRegistrationFact = { create: async (args: any) => { factData = args.data; return {}; } };
          const companyUpdate = tx.company.update;
          tx.company = { ...tx.company, update: async (args: any) => { companyUpdates.push(args.data); return companyUpdate ? companyUpdate(args) : {}; } };
          return fn(tx);
        }, opts);
      await new CreateCompanyOnboardingUseCase(prisma, configMock).execute({ ...makeCmd(), ...cmdExtra } as any);
      return { vatStateData, factData, companyUpdates };
    }

    const registered = await run({ vatRegistration: { status: 'REGISTERED', effectiveFrom: '2026-07-01' } });
    assert.equal(registered.factData.status, 'REGISTERED');
    assert.equal(registered.factData.source, 'USER_ANSWER');
    assert.equal(registered.factData.effectiveFrom.toISOString().slice(0, 10), '2026-07-01');
    // The state starts at 1 so a later answer's compare-and-set has the right expected version.
    assert.equal(registered.vatStateData.version, 1);
    assert.ok(registered.companyUpdates.some((data) => data.vatRegistered === true));

    const notRegistered = await run({ vatRegistration: { status: 'NOT_REGISTERED', effectiveFrom: '2026-08-05' } });
    assert.equal(notRegistered.factData.status, 'NOT_REGISTERED');
    // The mirror bit stays false; only REGISTERED sets it.
    assert.ok(!notRegistered.companyUpdates.some((data) => data.vatRegistered === true));

    const unanswered = await run({});
    assert.equal(unanswered.factData, undefined);
    assert.equal(unanswered.vatStateData.version, 0);
  });

  it('refuses an effective date that is not a civil date', async () => {
    const prisma = makePrisma({});
    await assert.rejects(
      () => new CreateCompanyOnboardingUseCase(prisma, configMock).execute({
        ...makeCmd(), vatRegistration: { status: 'REGISTERED', effectiveFrom: '01/07/2026' },
      } as any),
      /effectiveFrom must be YYYY-MM-DD/,
    );
  });

  // Owner decision 2026-08-04 + RA-16: Thai tax accounting is ON out of the box, and the tax config
  // a claimable input-VAT line needs is seeded ACTIVE against the chart bootstrapped in the same
  // transaction. `expense_auto_post` stays OFF — postings accumulate pending until it is enabled.
  it('enables Thai tax accounting and seeds a resolvable tax-code profile for a fresh company', async () => {
    const prisma = makePrisma({});
    const entitlement: { entitlements?: any } = {};
    const taxConfig: { profile?: any; definitions?: any[]; accountRules?: any; reportRules?: any } = {};
    let chartRows: any[] = [];
    prisma.client.$transaction = async (fn: (tx: any) => Promise<any>) => {
      const chart = chartBootstrapTx('co-1');
      chartRows = chart.rows;
      return fn({
        ...expenseCategoryTx(),
        company: { create: async () => ({ id: 'co-1' }), update: chart.companyUpdate },
        chartOfAccount: chart.chartOfAccount,
        user: { create: async () => ({ id: 'owner-1' }) },
        userCredential: { create: async () => ({}) },
        companyMembership: { create: async () => ({ id: 'mem-1' }) },
        membershipRole: { create: async () => ({}) },
        employeeLineLinkToken: { create: async () => ({}) },
        branch: { create: async () => ({}) },
        companyVatRegistrationState: { create: async () => ({}) },
        ...entitlementTx(entitlement),
        ...taxConfigTx(taxConfig),
        companyOnboardingRun: { create: async () => ({ id: 'run-1' }) },
        auditLog: { create: async () => ({}) },
        ...workflowTx(),
      });
    };

    const result = await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd());

    const enabled = new Map((entitlement.entitlements.data as Array<{ featureKey: string; enabled: boolean }>)
      .map((row) => [row.featureKey, row.enabled]));
    for (const key of ['thai_tax', 'double_entry_ledger', 'workflow_automation']) {
      assert.equal(enabled.get(key), true, `${key} must be on for a new company`);
    }
    // expense_auto_post declares double_entry_ledger as a prerequisite; enabling the prerequisite
    // must not drag the child on, because enable-later runs a guarded backfill.
    assert.equal(enabled.get('expense_auto_post'), false);
    assert.deepEqual(
      [...enabled.keys()].filter((key) => key.startsWith('workflow_automation.') && !enabled.get(key)),
      [],
      'submenus follow their parent',
    );

    // One ACTIVE profile only, so `buildPreview` selects it without an explicit profileId.
    assert.equal(taxConfig.profile.status, 'ACTIVE');
    assert.equal(taxConfig.profile.sourceProfileKey, 'WATCHDOG_TH_DOMESTIC_EXPENSE_V1');
    assert.equal(result.taxConfiguration.profileStatus, 'ACTIVE');
    // Opens on 1 January of the PREVIOUS year, so a January-onboarded company still resolves the
    // December tax invoice it may claim input VAT on for six months.
    assert.equal(result.taxConfiguration.effectiveFrom, `${new Date().getUTCFullYear() - 1}-01-01`);

    // Tax Codes land ACTIVE, not REVIEW_REQUIRED — that is the difference between a resolvable
    // company and a 422 on the first confirm. The review attestation names the system seam, not the
    // owner who has not logged in yet.
    assert.deepEqual(taxConfig.definitions!.map((row) => row.externalCode), ['V7', 'ND']);
    assert.ok(taxConfig.definitions!.every((row) => row.status === 'ACTIVE'
      && row.reviewedByUserId === TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID && row.createdByUserId === 'owner-1'));
    assert.equal(taxConfig.profile.reviewedByUserId, TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID);

    // Account rules cover exactly the roles `requiredAccountAssignments` demands for those two
    // codes, pointed at the reviewed chart accounts from the template mapping manifest.
    const accountByCode = new Map(chartRows.map((row) => [row.code, row.id]));
    assert.deepEqual(
      (taxConfig.accountRules as any[]).map((rule) => [rule.accountRole, rule.postingSide, rule.accountId, rule.status]),
      [
        ['INPUT_VAT_CLAIMABLE', 'DEBIT', accountByCode.get('1154-00'), 'ACTIVE'],
        ['NONDEDUCTIBLE_VAT_EXPENSE', 'DEBIT', accountByCode.get('5390-02'), 'ACTIVE'],
      ],
    );
    // Context/module stay open so expense, procurement and accounting all match the same rule, and
    // every rule row says on its face that it was machine-seeded rather than hand-mapped.
    assert.ok((taxConfig.accountRules as any[]).every((rule) => rule.transactionContext === undefined && rule.sourceModule === undefined
      && rule.reviewedByUserId === TAX_CONFIG_BOOTSTRAP_ACTOR_USER_ID
      && (rule.sourceMetadataJson as any).bootstrap === 'company-onboarding'));

    // ภ.พ.30 mappings for the claimable code, so the boxes are not silently 0 (RA-16).
    assert.deepEqual(
      (taxConfig.reportRules as any[]).map((rule) => [rule.formType, rule.boxKey, rule.amountSource, rule.status]),
      [
        ['PP30', 'box_6_eligible_purchases', 'TAX_BASE', 'ACTIVE'],
        ['PP30', 'box_7_input_tax', 'TAX_AMOUNT', 'ACTIVE'],
      ],
    );

    // The configuration half of the acceptance criterion: feed the seeded rows to the resolver that
    // `buildPreview` wraps. Zero errors here is what removes the config-side 422 a fresh company
    // used to hit (tax_account_rule_missing:INPUT_VAT_CLAIMABLE / transaction_tax_needs_review).
    // `buildPreview` adds its own evidence/trust errors on top, which are per-document, not per-company.
    // The three fields patched onto the account rules below are the schema defaults Prisma will
    // write for the columns the service deliberately omits (schema.prisma:3003-3008).
    const iso = (value: any) => new Date(value).toISOString();
    const claimable = taxConfig.definitions!.find((row) => row.externalCode === 'V7')!;
    const preview = resolveTransactionTaxPreview({
      definitions: taxConfig.definitions!.map((row) => ({
        ...row, transactionContexts: row.transactionContextsJson, effectiveFrom: iso(row.effectiveFrom), effectiveTo: null,
      })) as any,
      accountRules: (taxConfig.accountRules as any[]).map((rule) => ({
        ...rule, transactionContext: null, sourceModule: null, priority: 100, effectiveFrom: iso(rule.effectiveFrom), effectiveTo: null,
      })) as any,
      reportRules: (taxConfig.reportRules as any[]).map((rule) => ({
        ...rule, signRule: 'NORMAL', effectiveFrom: iso(rule.effectiveFrom), effectiveTo: null,
      })) as any,
      input: {
        sourceType: 'expense.record', sourceId: 'src-1', sourceLineId: 'line-1',
        transactionContext: 'DOMESTIC_PURCHASE', documentDate: new Date().toISOString().slice(0, 10),
        currency: 'THB', taxCurrency: 'THB', taxCodeDefinitionId: claimable.id,
        netAmount: '100', grossAmount: '107', enteredTaxAmount: '7',
      },
      direction: 'INPUT',
      sourceModule: 'expense',
    });
    assert.deepEqual(preview.errors, [], 'a fresh company must resolve claimable input VAT with no review errors');
    assert.equal(preview.snapshot.claimability, 'CLAIMABLE');
    assert.equal(preview.accountId, accountByCode.get('1154-00'));
    assert.deepEqual(preview.reportContributions.map((item) => [item.boxKey, item.amount]), [
      ['box_6_eligible_purchases', '100.00'],
      ['box_7_input_tax', '7.00'],
    ]);

    // The seam refuses a second run: a second ACTIVE profile makes every line that carries no
    // explicit Tax Code ambiguous company-wide, and the schema unique key would not catch it.
    await assert.rejects(
      () => bootstrapCompanyTaxConfiguration({ companyTaxCodeProfile: { count: async () => 1 } } as any, { companyId: 'co-1', createdByUserId: 'owner-1' }),
      (error: any) => error.getResponse?.().code === 'tax_config_already_bootstrapped',
    );
  });
});

function externalSignupHarness() {
  const rows = new Map<string, any>();
  const audits: any[] = [];
  const outbox: any[] = [];
  let idSequence = 0;
  let lockCalls = 0;
  let transactionTail = Promise.resolve();

  const byWhere = (where: any) => {
    if (where.id) return rows.get(where.id) ?? null;
    return [...rows.values()].find((row) => row.externalSignupId === where.externalSignupId) ?? null;
  };
  const tx = {
    $executeRaw: async () => { lockCalls += 1; return 1; },
    companySignupRequest: {
      findUnique: async ({ where }: any) => byWhere(where),
      findUniqueOrThrow: async ({ where }: any) => {
        const row = byWhere(where);
        if (!row) throw new Error('not found');
        return row;
      },
      create: async ({ data }: any) => {
        const now = new Date();
        const row = {
          id: `signup-${++idSequence}`, source: 'official-site', state: 'RECEIVED', version: 0,
          failureCode: null, provisioningAttemptId: null, provisioningStartedAt: null,
          companyId: null, ownerUserId: null, createdAt: now, updatedAt: now, ...data,
        };
        rows.set(row.id, row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = rows.get(where.id);
        if (!row || row.state !== where.state || row.version !== where.version) return { count: 0 };
        const { version, ...fields } = data;
        Object.assign(row, fields, { version: row.version + version.increment, updatedAt: new Date() });
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } },
    outboxEvent: { create: async ({ data }: any) => { outbox.push(data); return data; } },
  };
  const client = {
    $transaction: async (work: (transaction: any) => Promise<any>) => {
      let release!: () => void;
      const previous = transactionTail;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await work(tx); } finally { release(); }
    },
  };
  return {
    service: new CompanySignupCoreService({ client } as any), rows, audits, outbox,
    lockCalls: () => lockCalls,
  };
}

const signupInput = {
  externalSignupId: 'official-001', companyName: 'บริษัท ตัวอย่าง จำกัด', taxId: '0105555000012',
  ownerFirstName: 'คุณสมชาย',
  ownerLastName: 'ทดสอบ', contactEmail: 'Owner@Example.com', consentVersion: 'terms-2026-08',
  // Only PRO_TRIAL is sellable (spec §3A); the pre-catalog placeholder this used to carry is now
  // rejected by the offer allowlist, which is the intended behaviour.
  referralCode: 'creator-a', requestedOfferKey: 'PRO_TRIAL',
};

describe('P10-0 external signup core', () => {
  it('normalizes identity fields before a stable payload hash and pins recovery transitions', () => {
    const first = normalizeCompanySignupInput(signupInput);
    const retry = normalizeCompanySignupInput({
      ...signupInput, companyName: `  ${signupInput.companyName} `, contactEmail: ' owner@example.COM ',
      taxId: '0-1055-55000-01-2',
    });
    assert.deepEqual(retry, first);
    assert.equal(companySignupPayloadHash(retry), companySignupPayloadHash(first));
    assert.equal(canTransitionCompanySignup('EMAIL_FAILED', 'EMAIL_PENDING'), true);
    assert.equal(canTransitionCompanySignup('PROVISIONING_FAILED', 'PROVISIONING'), true);
    assert.equal(canTransitionCompanySignup('COMPLETED', 'RECEIVED'), false);
  });

  it('replays the same external id/payload and rejects a conflicting payload', async () => {
    const h = externalSignupHarness();
    const first = await h.service.receive(signupInput, 'request-1');
    const retry = await h.service.receive({ ...signupInput, contactEmail: 'owner@example.com' }, 'request-2');
    assert.equal(first.replayed, false);
    assert.equal(retry.replayed, true);
    assert.equal(retry.request.id, first.request.id);
    assert.equal(h.rows.size, 1);
    assert.equal(h.audits.length, 1);
    assert.equal(h.outbox.length, 1);
    await assert.rejects(
      () => h.service.receive({ ...signupInput, companyName: 'คนละบริษัท' }, 'request-3'),
      (error: unknown) => error instanceof ConflictException,
    );
  });

  it('serializes concurrent same-request retries into exactly one durable request', async () => {
    const h = externalSignupHarness();
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      h.service.receive(signupInput, `concurrent-${index}`)));
    assert.equal(h.rows.size, 1);
    assert.equal(results.filter((result) => !result.replayed).length, 1);
    assert.equal(new Set(results.map((result) => result.request.id)).size, 1);
    assert.equal(h.audits.length, 1);
    assert.equal(h.outbox.length, 1);
    assert.equal(h.lockCalls(), 8, 'every receive takes the database advisory lock');
  });

  it('records state evidence without copying signup PII into audit or outbox', async () => {
    const h = externalSignupHarness();
    const received = await h.service.receive(signupInput, 'state-0');
    await h.service.advance(received.request.id, 'VALIDATED', 'state-1');
    await h.service.advance(received.request.id, 'PENDING_REVIEW', 'state-1b');
    await h.service.advance(received.request.id, 'EMAIL_PENDING', 'state-2');
    const replay = await h.service.advance(received.request.id, 'EMAIL_PENDING', 'state-3');
    assert.equal(replay.replayed, true);
    assert.equal(h.audits.length, 4);
    assert.equal(h.outbox.length, 4);
    const evidence = JSON.stringify({ audits: h.audits, outbox: h.outbox });
    for (const privateValue of [signupInput.companyName, signupInput.contactEmail.toLowerCase(), signupInput.taxId]) {
      assert.equal(evidence.includes(privateValue), false);
    }
  });

  it('elects one provisioning caller and makes successful completion idempotent', async () => {
    const h = externalSignupHarness();
    const received = await h.service.receive(signupInput, 'provision-0');
    await h.service.advance(received.request.id, 'VALIDATED', 'provision-1');
    await h.service.advance(received.request.id, 'PENDING_REVIEW', 'provision-1b');
    await h.service.advance(received.request.id, 'EMAIL_PENDING', 'provision-2');
    await h.service.advance(received.request.id, 'EMAIL_VERIFIED', 'provision-3');
    const claims = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      h.service.claimProvisioning(received.request.id, `claim-${index}`)));
    const winner = claims.find((claim) => claim.claimed)!;
    assert.equal(claims.filter((claim) => claim.claimed).length, 1);
    assert.ok(winner.attemptId);
    const complete = await h.service.completeProvisioning({
      requestId: received.request.id, attemptId: winner.attemptId!, companyId: 'company-1',
      ownerUserId: 'owner-1', correlationRequestId: 'complete-1',
    });
    const replay = await h.service.completeProvisioning({
      requestId: received.request.id, attemptId: winner.attemptId!, companyId: 'company-1',
      ownerUserId: 'owner-1', correlationRequestId: 'complete-2',
    });
    assert.equal(complete.request.state, 'READY');
    assert.equal(replay.replayed, true);
    // VALIDATED, PENDING_REVIEW, EMAIL_PENDING, EMAIL_VERIFIED, PROVISIONING, READY — the Flow B
    // admin gate adds one transition to the P10-0 count.
    assert.equal(h.outbox.filter((event) => event.eventType === 'company_signup.state_changed').length, 6);
  });

  it('recovers EMAIL_FAILED and PROVISIONING_FAILED with a fresh fenced attempt', async () => {
    const h = externalSignupHarness();
    const received = await h.service.receive(signupInput, 'recover-0');
    await h.service.advance(received.request.id, 'VALIDATED', 'recover-1');
    await h.service.advance(received.request.id, 'PENDING_REVIEW', 'recover-1b');
    await h.service.advance(received.request.id, 'EMAIL_PENDING', 'recover-2');
    await h.service.advance(received.request.id, 'EMAIL_FAILED', 'recover-3', 'provider_unavailable');
    await h.service.advance(received.request.id, 'EMAIL_PENDING', 'recover-4');
    await h.service.advance(received.request.id, 'EMAIL_VERIFIED', 'recover-5');
    const first = await h.service.claimProvisioning(received.request.id, 'recover-6');
    await h.service.failProvisioning({
      requestId: received.request.id, attemptId: first.attemptId!, failureCode: 'company_conflict',
      correlationRequestId: 'recover-7',
    });
    const second = await h.service.claimProvisioning(received.request.id, 'recover-8');
    assert.equal(second.claimed, true);
    assert.notEqual(second.attemptId, first.attemptId);
    await assert.rejects(() => h.service.completeProvisioning({
      requestId: received.request.id, attemptId: first.attemptId!, companyId: 'company-1',
      ownerUserId: 'owner-1', correlationRequestId: 'stale-attempt',
    }), (error: unknown) => error instanceof ConflictException);
  });
});

// 10D attach mode: new company onto an existing owner username — no new user/credential/password.
describe('CreateCompanyOnboardingUseCase attachExistingOwner', () => {
  function makeAttachPrisma(opts: { userStatus?: string | null; ownerHasLine?: boolean } = {}) {
    const calls = { userCreate: 0, credentialCreate: 0, lineTokenCreate: 0, membershipCreate: 0, auditArgs: undefined as any };
    const prisma = {
      client: {
        user: {
          findUnique: async () =>
            opts.userStatus === null ? null : { id: 'owner-existing', status: opts.userStatus ?? 'ACTIVE' },
        },
        company: { findFirst: async () => null },
        role: { findUnique: async () => ({ id: 'role-owner' }) },
        // P29: the post-commit default-term write (asserted in its own describe block below).
        companyPlanTerm: { upsert: async (args: any) => args.create },
        externalIdentity: { findFirst: async () => (opts.ownerHasLine ? { id: 'ident-1' } : null) },
        $transaction: async (fn: (tx: any) => Promise<any>) => {
          const chart = chartBootstrapTx('co-2');
          const tx = {
            ...expenseCategoryTx(),
            company: { create: async () => ({ id: 'co-2' }), update: chart.companyUpdate },
            chartOfAccount: chart.chartOfAccount,
            user: {
              create: async () => { calls.userCreate += 1; return { id: 'new-user' }; },
              findUniqueOrThrow: async () => ({ id: 'owner-existing', displayName: 'Existing Owner' }),
            },
            userCredential: { create: async () => { calls.credentialCreate += 1; return {}; } },
            companyMembership: { create: async () => { calls.membershipCreate += 1; return { id: 'mem-2' }; } },
            membershipRole: { create: async () => ({}) },
            employeeLineLinkToken: { create: async () => { calls.lineTokenCreate += 1; return {}; } },
            branch: { create: async () => ({}) },
            companyVatRegistrationState: { create: async () => ({}) },
            ...entitlementTx(),
            ...taxConfigTx(),
            companyOnboardingRun: { create: async () => ({ id: 'run-2' }) },
            auditLog: { create: async (args: any) => { calls.auditArgs = args; return {}; } },
            ...workflowTx(),
          };
          return fn(tx);
        },
      },
    } as any;
    return { prisma, calls };
  }

  it('rejects when the username does not exist', async () => {
    const { prisma } = makeAttachPrisma({ userStatus: null });
    await assert.rejects(
      () => new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd({ attachExistingOwner: true })),
      /does not match an active user/,
    );
  });

  it('rejects when the existing user is not ACTIVE', async () => {
    const { prisma } = makeAttachPrisma({ userStatus: 'DISABLED' });
    await assert.rejects(
      () => new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd({ attachExistingOwner: true })),
      /does not match an active user/,
    );
  });

  it('creates membership only — no new user, credential, or temporary password', async () => {
    const { prisma, calls } = makeAttachPrisma({});
    const result = await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd({ attachExistingOwner: true }));
    assert.equal(calls.userCreate, 0);
    assert.equal(calls.credentialCreate, 0);
    assert.equal(calls.membershipCreate, 1);
    assert.equal(result.temporaryPassword, undefined);
    assert.equal(result.attachedExistingOwner, true);
    assert.equal(result.ownerId, 'owner-existing');
    assert.equal(result.chartOfAccounts.accountCount, 175);
    assert.equal(calls.auditArgs.data.metadataJson.attachExistingOwner, true);
  });

  it('skips the LINE link QR when the owner already has an ACTIVE LINE identity', async () => {
    const { prisma, calls } = makeAttachPrisma({ ownerHasLine: true });
    const result = await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd({ attachExistingOwner: true }));
    assert.equal(calls.lineTokenCreate, 0);
    assert.equal(result.ownerLineLink, undefined);
  });

  it('still issues the LINE link QR when the owner has no LINE identity yet', async () => {
    const { prisma, calls } = makeAttachPrisma({ ownerHasLine: false });
    const result = await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd({ attachExistingOwner: true }));
    assert.equal(calls.lineTokenCreate, 1);
    assert.ok(result.ownerLineLink);
  });
});

/**
 * M-05 register §6 tenant tripwire. The register defers the s.41 limb (b) and
 * controller/processor questions on the assumption that tenants stay general
 * retail/trading/service; a health-adjacent tenant invalidates that on its own. These cases
 * are what stop the deferral expiring silently, so they assert the alarm-visible shape
 * (`riskLevel` root-level, which is what the production metric filter reads) and not just
 * that "some log happened".
 *
 * Capture is via `Logger.overrideLogger` — the emitter uses Nest's `Logger`, bridged to the
 * pino stream by M-02, per the `security-event-emitters.spec.ts` precedent.
 */

/**
 * Audit H-31: the admin knows the company's tax id at handover, but company.legal_identity.manage
 * lives inside the company, so until now the number could not be captured until the owner first
 * logged in — and sellerIdentityComplete could never become true.
 */
describe('CreateCompanyOnboardingUseCase tax identity capture', () => {
  function harness(taxId?: string) {
    const captured: { company?: any; revisions: any[]; taxProfiles: any[] } = { revisions: [], taxProfiles: [] };
    const prisma = {
      client: {
        user: { findUnique: async () => null },
        company: { findFirst: async () => null },
        role: { findUnique: async () => ({ id: 'role-owner' }) },
        // P29: the post-commit default-term write (asserted in its own describe block below).
        companyPlanTerm: { upsert: async (args: any) => args.create },
        $transaction: async (fn: (tx: any) => Promise<any>) => {
          const chart = chartBootstrapTx('co-1');
          return fn({
        ...expenseCategoryTx(),
            company: {
              create: async (args: any) => { captured.company = args.data; return { id: 'co-1' }; },
              update: chart.companyUpdate,
            },
            companyLegalIdentityRevision: { create: async (args: any) => { captured.revisions.push(args.data); return args.data; } },
            companyTaxProfile: { upsert: async (args: any) => { captured.taxProfiles.push(args); return args.create; } },
            chartOfAccount: chart.chartOfAccount,
            user: { create: async () => ({ id: 'owner-1' }) },
            userCredential: { create: async () => ({}) },
            companyMembership: { create: async () => ({ id: 'mem-1' }) },
            membershipRole: { create: async () => ({}) },
            employeeLineLinkToken: { create: async () => ({}) },
            branch: { create: async () => ({}) },
            companyVatRegistrationState: { create: async () => ({}) },
            ...entitlementTx(),
            ...taxConfigTx(),
            companyOnboardingRun: { create: async () => ({ id: 'run-1' }) },
            auditLog: { create: async () => ({}) },
            ...workflowTx(),
          });
        },
      },
    } as any;
    const run = () => new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd(taxId ? { taxId } as any : {}));
    return { run, captured };
  }

  it('stores the tax id as a versioned initial capture, not a bare column', async () => {
    const { run, captured } = harness('0105536000021');
    await run();

    assert.equal(captured.company.taxId, '0105536000021');
    // A bare column write would leave the version at 0 with no revision behind it, and the identity
    // screen's optimistic concurrency and its history would both describe a value nobody wrote.
    assert.equal(captured.company.legalIdentityVersion, 1);
    assert.equal(captured.revisions.length, 1);
    assert.equal(captured.revisions[0].changeKind, 'INITIAL_CAPTURE');
    assert.equal(captured.revisions[0].legalIdentityVersion, 1);
    assert.deepEqual(captured.revisions[0].snapshotJson.taxId, '0105536000021');
    // The legacy mirror patch() also writes — skipping it would leave the tax profile disagreeing
    // with the company row from day one.
    assert.equal(captured.taxProfiles.length, 1);
    assert.equal(captured.taxProfiles[0].create.taxId, '0105536000021');
  });

  it('accepts the printed form and stores digits, so both entry points agree on the value', async () => {
    const { run, captured } = harness('0-1055-36000-02-1');
    await run();
    assert.equal(captured.company.taxId, '0105536000021');
  });

  it('leaves the company untouched when the admin does not have the number', async () => {
    const { run, captured } = harness();
    await run();

    assert.equal(captured.company.taxId, undefined);
    assert.equal(captured.company.legalIdentityVersion, undefined, 'version stays at the schema default');
    assert.equal(captured.revisions.length, 0);
    assert.equal(captured.taxProfiles.length, 0);
  });

  it('refuses a number that is not 13 digits rather than storing a partial one', async () => {
    for (const bad of ['12345', '010553600002199', 'abcdefghijklm']) {
      const { run } = harness(bad);
      await assert.rejects(run, /13 digits/, bad);
    }
  });
});

describe('CreateCompanyOnboardingUseCase PDPA tenant tripwire', () => {
  function captureWarnings(): { lines: Array<Record<string, unknown>>; restore: () => void } {
    const lines: Array<Record<string, unknown>> = [];
    Logger.overrideLogger({
      log: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {},
      warn: (message: unknown) => void lines.push(message as Record<string, unknown>),
    });
    return { lines, restore: () => Logger.overrideLogger(false) };
  }

  function tripwirePrisma() {
    const captured = { companyArgs: undefined as any, auditArgs: undefined as any };
    const prisma = {
      client: {
        user: { findUnique: async () => null },
        company: { findFirst: async () => null },
        role: { findUnique: async () => ({ id: 'role-owner' }) },
        // P29: the post-commit default-term write (asserted in its own describe block below).
        companyPlanTerm: { upsert: async (args: any) => args.create },
        $transaction: async (fn: (tx: any) => Promise<any>) => {
          const chart = chartBootstrapTx('co-health-1');
          const tx = {
            ...expenseCategoryTx(),
            company: {
              create: async (args: any) => { captured.companyArgs = args; return { id: 'co-health-1' }; },
              update: chart.companyUpdate,
            },
            chartOfAccount: chart.chartOfAccount,
            user: { create: async () => ({ id: 'owner-1' }) },
            userCredential: { create: async () => ({}) },
            companyMembership: { create: async () => ({ id: 'mem-1' }) },
            membershipRole: { create: async () => ({}) },
            employeeLineLinkToken: { create: async () => ({}) },
            branch: { create: async () => ({}) },
            companyVatRegistrationState: { create: async () => ({}) },
            ...entitlementTx(),
            ...taxConfigTx(),
            companyOnboardingRun: { create: async () => ({ id: 'run-health-1' }) },
            auditLog: { create: async (args: any) => { captured.auditArgs = args; return {}; } },
            ...workflowTx(),
          };
          return fn(tx);
        },
      },
    } as any;
    return { prisma, captured };
  }

  const EVENT = 'pdpa.tenant.health_adjacent_onboarded';

  for (const category of ['CLINIC', 'WELLNESS_SPA', 'MEDICAL_RETAIL'] as const) {
    it(`alerts the dev team when a ${category} tenant onboards`, async () => {
      const { prisma } = tripwirePrisma();
      const { lines, restore } = captureWarnings();
      try {
        await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd({ businessCategory: category }));
      } finally {
        restore();
      }

      const events = lines.filter((line) => line['msg'] === EVENT);
      assert.equal(events.length, 1, 'exactly one alert per qualifying onboarding');
      const event = events[0]!;
      // Root-level riskLevel is the whole mechanism: the production metric filter reads
      // $.riskLevel, so a nested or missing one is a tripwire that never fires.
      assert.equal(event['riskLevel'], 'HIGH');
      assert.equal(event['businessCategory'], category);
      assert.equal(event['companyId'], 'co-health-1');
      assert.equal(event['onboardingRunId'], 'run-health-1');
      assert.equal(event['actorUserId'], 'admin-1');
      assert.equal(event['requestId'], 'req-1');
      // The alert says "go look" — identity detail stays on the audit row.
      assert.ok(!('companyName' in event), 'no company name on the alarm path');
      assert.ok(!('ownerDisplayName' in event), 'no owner name on the alarm path');
    });
  }

  for (const category of ['RETAIL', 'TRADING', 'SERVICE', 'OTHER'] as const) {
    it(`stays silent for a ${category} tenant`, async () => {
      const { prisma } = tripwirePrisma();
      const { lines, restore } = captureWarnings();
      try {
        await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd({ businessCategory: category }));
      } finally {
        restore();
      }
      assert.equal(
        lines.filter((line) => line['msg'] === EVENT).length,
        0,
        'a tripwire that fires on every onboarding is one nobody reads',
      );
    });
  }

  it('persists the declared category on the company and the audit row', async () => {
    const { prisma, captured } = tripwirePrisma();
    const { restore } = captureWarnings();
    try {
      await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd({ businessCategory: 'CLINIC' }));
    } finally {
      restore();
    }
    assert.equal(captured.companyArgs.data.businessCategory, 'CLINIC');
    // The durable half: log retention expires, the audit row does not.
    assert.equal(captured.auditArgs.data.metadataJson.businessCategory, 'CLINIC');
  });
});

describe('CreateCompanyOnboardingUseCase P29 default term', () => {
  it('gives every admin-created company STARTER for exactly 30 days', async () => {
    const prisma = makePrisma({});
    await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd());

    assert.equal(prisma.planTermUpserts().length, 1);
    const args = prisma.planTermUpserts()[0];
    assert.deepEqual(args.where, { companyId: 'co-1' });
    assert.equal(args.create.tierKey, 'STARTER_249');
    assert.equal(args.create.branchLimit, 1);
    assert.equal(args.create.employeeLimit, 2);
    assert.equal(args.create.monthlySlipLimit, 30);
    assert.equal(args.create.warningDays, 7);
    assert.equal(
      args.create.termEndsAt.getTime() - args.create.termStartAt.getTime(),
      30 * 24 * 60 * 60 * 1000,
    );
    // Idempotent: re-running provisioning must not restart or shorten an existing term.
    assert.deepEqual(args.update, {});
  });

  // Review B-01: the tier is decided HERE or nowhere. `applyPlanTermPreset` leaves an existing row
  // alone, so a provisioning caller that upserted its own preset afterwards was silently ignored.
  it('writes the preset a provisioning caller named instead of the console default', async () => {
    const prisma = makePrisma({});
    await new CreateCompanyOnboardingUseCase(prisma, configMock)
      .execute(makeCmd({ planTier: 'PRO_999', planDays: 30 }));

    assert.equal(prisma.planTermUpserts().length, 1);
    const args = prisma.planTermUpserts()[0];
    assert.equal(args.create.tierKey, 'PRO_999');
    assert.equal(args.create.monthlySlipLimit, 100);
    assert.equal(
      args.create.termEndsAt.getTime() - args.create.termStartAt.getTime(),
      30 * 24 * 60 * 60 * 1000,
    );
  });

  it('a failed term write NEVER fails the onboarding', async () => {
    const prisma = makePrisma({});
    prisma.client.companyPlanTerm.upsert = async () => { throw new Error('db down'); };

    const result = await new CreateCompanyOnboardingUseCase(prisma, configMock).execute(makeCmd());
    // The company exists and is usable — a company with no term row is unlimited, not broken.
    assert.equal(result.companyId, 'co-1');
    assert.equal(result.onboardingRunId, 'run-1');
  });
});
