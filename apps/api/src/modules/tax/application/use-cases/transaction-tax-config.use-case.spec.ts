import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaxCodeDefinitionDto } from '@watchdog-bms/contracts';
import { TransactionTaxConfigUseCase } from './transaction-tax-config.use-case.js';

const ctx = (permissions: string[]) => ({ requestId: 'r1', userId: 'u1', companyId: 'c1', permissions, scopes: {}, roles: [], membershipId: 'm1', authSubject: 's1', authProvider: 'dev' }) as any;
const profile = (id: string) => ({ id, companyId: 'c1', name: id, sourceSystem: 'SAP_S4HANA', sourceProfileKey: id, countryCode: 'TH', sapClient: null, sapCompanyCode: null, isDefault: false, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://sap.example', roundingMode: 'HALF_UP', roundingScale: 2, taxAmountTolerance: '0.01', reviewedByUserId: 'u1', reviewedAt: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1 }) as any;
const definition = (profileId = 'p1'): TaxCodeDefinitionDto => ({ id: `def-${profileId}`, companyId: 'c1', profileId, externalCode: 'O1', displayName: 'VAT 7', taxRegime: 'VAT', direction: 'OUTPUT', treatment: 'STANDARD', transactionContexts: ['DOMESTIC_SALE'], rate: '7', calculationMethod: 'EXCLUSIVE', sapAccountKey: null, claimabilityDefault: 'NOT_APPLICABLE', evidenceRuleKey: null, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1, reviewedByUserId: 'u1', reviewedAt: '2026-01-01' });
const account = (def: TaxCodeDefinitionDto) => ({ id: 'a1', companyId: 'c1', taxCodeDefinitionId: def.id, taxRegime: def.taxRegime, direction: def.direction, treatment: def.treatment, transactionContext: def.transactionContexts[0], sourceModule: null, accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'vat-payable', postingSide: 'CREDIT', priority: 1, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1 }) as any;
const reports = (def: TaxCodeDefinitionDto) => [
  { id: 'r1', companyId: 'c1', taxCodeDefinitionId: def.id, formType: 'PP30', boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE', signRule: 'NORMAL', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1 },
  { id: 'r2', companyId: 'c1', taxCodeDefinitionId: def.id, formType: 'PP30', boxKey: 'box_5_output_tax', amountSource: 'TAX_AMOUNT', signRule: 'NORMAL', status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null, version: 1 },
] as any[];

function useCase(repo: any) {
  repo.prisma ??= { client: { tradeTaxEvidence: { findMany: async () => [] } } };
  repo.prisma.client.company ??= { findUnique: async () => ({ baseCurrency: 'THB' }) };
  return new TransactionTaxConfigUseCase(repo, { log: async () => undefined } as any, { append: async () => undefined } as any);
}

describe('TransactionTaxConfigUseCase lifecycle and trust boundary', () => {
  it('bootstraps built-in profiles idempotently as inactive reviewed templates', async () => {
    let calls = 0;
    const repo = {
      createProfileFromTemplate: async (_companyId: string, template: any, effectiveFrom: string) => {
        calls += 1;
        return { profile: { ...profile('template'), sourceSystem: template.sourceSystem, sourceProfileKey: template.key, status: 'DRAFT', effectiveFrom }, created: calls === 1 };
      },
    } as any;
    const tax = useCase(repo);
    await assert.rejects(() => tax.createProfileFromTemplate(ctx(['tax.profile.manage']), 'SAP_S4_TH_CURRENT', '2026-07-14'), /tax\.config\.manage/);
    const first = await tax.createProfileFromTemplate(ctx(['tax.profile.manage', 'tax.config.manage']), 'SAP_S4_TH_CURRENT', '2026-07-14');
    const second = await tax.createProfileFromTemplate(ctx(['tax.profile.manage', 'tax.config.manage']), 'SAP_S4_TH_CURRENT', '2026-07-14');
    assert.equal(first.profile.status, 'DRAFT');
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    await assert.rejects(() => tax.createProfileFromTemplate(ctx(['tax.profile.manage', 'tax.config.manage']), 'UNKNOWN', '2026-07-14'), /not found/i);
  });

  it('requires tax configuration management as well as ledger rule management for tax account mapping', async () => {
    const def = definition();
    const repo = {
      listDefinitions: async () => [def],
      listAccountRules: async () => [],
      prisma: { client: { chartOfAccount: { findFirst: async () => ({ id: 'vat-payable' }) } } },
      upsertAccountRule: async () => account(def),
    } as any;
    const input = { ...account(def), id: undefined } as any;
    await assert.rejects(
      () => useCase(repo).upsertAccountRule(ctx(['tax.config.read', 'ledger.posting-rule.manage']), input),
      /tax\.config\.manage/,
    );
    await useCase(repo).upsertAccountRule(ctx(['tax.config.manage', 'ledger.posting-rule.manage']), input);
  });

  it('activates only a complete semantic profile and fails closed when mapping is incomplete', async () => {
    const def = { ...definition(), status: 'REVIEW_REQUIRED' as const };
    let activated = false;
    const repo = {
      prisma: { client: {} }, findProfile: async () => ({ ...profile('p1'), status: 'DRAFT' }),
      listProfiles: async (_company: string, filters: any) => filters.status === 'ACTIVE' ? [] : [{ ...profile('p1'), status: 'DRAFT' }],
      listDefinitions: async () => [def], listAccountRules: async () => [account(def)], listReportRules: async () => reports(def),
      setProfileStatus: async () => { activated = true; return profile('p1'); },
    } as any;
    await useCase(repo).activateProfile(ctx(['tax.profile.manage', 'tax.config.manage']), 'p1');
    assert.equal(activated, true);
    repo.listReportRules = async () => reports(def).slice(0, 1);
    await assert.rejects(() => useCase(repo).activateProfile(ctx(['tax.profile.manage', 'tax.config.manage']), 'p1'), (error: any) => error.getResponse?.().code === 'tax_profile_incomplete');
  });

  it('reports the same missing account/report configuration before activation', async () => {
    const def = { ...definition(), status: 'REVIEW_REQUIRED' as const };
    const repo = {
      findProfile: async () => ({ ...profile('p1'), status: 'DRAFT' }),
      listProfiles: async () => [],
      listDefinitions: async () => [def],
      listAccountRules: async () => [],
      listReportRules: async () => [],
    } as any;
    const readiness = await useCase(repo).getProfileReadiness(ctx(['tax.profile.read', 'tax.config.read']), 'p1');
    assert.equal(readiness.canActivate, false);
    assert.deepEqual(
      readiness.blockers.map((item) => [item.code, item.kind]),
      [
        ['missing_account_rule', 'ACCOUNT_RULE'],
        ['missing_report_rule', 'REPORT_RULE'],
        ['missing_report_rule', 'REPORT_RULE'],
      ],
    );
    await assert.rejects(
      () => useCase(repo).activateProfile(ctx(['tax.profile.manage', 'tax.config.manage']), 'p1'),
      (error: any) => error.getResponse?.().errors?.length === readiness.blockers.length,
    );
  });

  it('reports the same overlapping active profile that activation rejects', async () => {
    const def = { ...definition(), status: 'REVIEW_REQUIRED' as const };
    const target = { ...profile('p1'), status: 'DRAFT' };
    const overlapping = { ...profile('p2'), sourceProfileKey: target.sourceProfileKey };
    const repo = {
      findProfile: async () => target,
      listProfiles: async () => [overlapping],
      listDefinitions: async () => [def],
      listAccountRules: async () => [account(def)],
      listReportRules: async () => reports(def),
    } as any;
    const readiness = await useCase(repo).getProfileReadiness(ctx(['tax.profile.read', 'tax.config.read']), 'p1');
    assert.equal(readiness.canActivate, false);
    assert.deepEqual(
      readiness.blockers.map((item) => [item.code, item.kind]),
      [['overlapping_active_profile_identity', 'PROFILE_OVERLAP']],
    );
    await assert.rejects(
      () => useCase(repo).activateProfile(ctx(['tax.profile.manage', 'tax.config.manage']), 'p1'),
      /same SAP\/source identity overlaps/,
    );
  });

  it('uses explicit definition to disambiguate active profiles while bare external code fails', async () => {
    const def1 = definition('p1');
    const def2 = definition('p2');
    const repo = {
      prisma: { client: { tradeTaxEvidence: { findMany: async () => [] } } },
      listProfiles: async () => [profile('p1'), profile('p2')],
      listDefinitions: async (_company: string, filters: any) => filters.profileId === 'p1' ? [def1] : filters.profileId === 'p2' ? [def2] : [def1, def2],
      listAccountRules: async () => [account(def1)], listReportRules: async () => reports(def1),
    } as any;
    const input = { sourceType: 'accounting.document', sourceId: 'd1', sourceLineId: 'l1', transactionContext: 'DOMESTIC_SALE', documentDate: '2026-07-14', currency: 'THB', taxCodeDefinitionId: def1.id, netAmount: '100', grossAmount: '107' } as any;
    assert.equal((await useCase(repo).resolveSourceTax(ctx(['accounting.document.create']), input, 'FINAL')).snapshot.taxAmount, '7.00');
    await assert.rejects(() => useCase(repo).resolveSourceTax(ctx(['accounting.document.create']), { ...input, taxCodeDefinitionId: undefined, externalTaxCode: 'O1' }, 'FINAL'), /ambiguous/);
  });

  it('uses and snapshots the selected company profile rounding policy', async () => {
    const def = { ...definition('p1'), rate: '5' };
    const selected = { ...profile('p1'), roundingMode: 'HALF_EVEN', roundingScale: 0, taxAmountTolerance: '0.50' };
    const repo = {
      listProfiles: async () => [selected], listDefinitions: async () => [def],
      listAccountRules: async () => [account(def)], listReportRules: async () => reports(def),
    } as any;
    const preview = await useCase(repo).resolveSourceTax(ctx(['accounting.document.create']), {
      sourceType: 'accounting.document', sourceId: 'd1', sourceLineId: 'l1', transactionContext: 'DOMESTIC_SALE',
      documentDate: '2026-07-14', currency: 'THB', taxCodeDefinitionId: def.id,
      netAmount: '50', grossAmount: '52.50', enteredTaxAmount: '2.40',
    } as any, 'FINAL');
    assert.equal(preview.snapshot.taxAmount, '2');
    assert.equal(preview.snapshot.roundingMode, 'HALF_EVEN');
    assert.equal(preview.snapshot.roundingScale, 0);
    assert.equal(preview.snapshot.taxAmountTolerance, '0.50');
  });

  it('overrides forged import amounts with matching verified evidence', async () => {
    const def = { ...definition(), taxRegime: 'IMPORT_VAT' as const, direction: 'INPUT' as const, treatment: 'CLAIMABLE' as const, transactionContexts: ['IMPORT_GOODS' as const], claimabilityDefault: 'CLAIMABLE' as const, evidenceRuleKey: 'CUSTOMS_ENTRY' };
    const importAccounts = [
      { ...account(def), direction: 'INPUT', taxRegime: 'IMPORT_VAT', treatment: 'CLAIMABLE', transactionContext: 'IMPORT_GOODS', accountRole: 'IMPORT_VAT_CLAIMABLE', postingSide: 'DEBIT' },
      { ...account(def), id: 'a2', direction: 'INPUT', taxRegime: 'IMPORT_VAT', treatment: 'CLAIMABLE', transactionContext: 'IMPORT_GOODS', accountRole: 'IMPORT_TAX_SETTLEMENT_PAYABLE', postingSide: 'CREDIT' },
    ];
    const inputReports = reports(def).map((item, index) => ({ ...item, boxKey: index ? 'box_7_input_tax' : 'box_6_eligible_purchases', amountSource: index ? 'TAX_AMOUNT' : 'TAX_BASE' }));
    const evidence = { id: 'ev1', companyId: 'c1', status: 'VERIFIED', reviewedByUserId: 'reviewer-1', reviewedAt: new Date('2026-07-10'), sourceType: 'procurement.vendor_bill', sourceId: 'b1', sourceLineId: 'l1', transactionContext: 'IMPORT_GOODS', branchId: null, evidenceType: 'CUSTOMS_ENTRY', customsValue: '1000', dutyAmount: '0', exciseAmount: '0', otherTaxAmount: '0', importVatAmount: '77' };
    const repo = { prisma: { client: { tradeTaxEvidence: { findMany: async () => [evidence] } } }, listProfiles: async () => [profile('p1')], listDefinitions: async () => [def], listAccountRules: async () => importAccounts, listReportRules: async () => inputReports } as any;
    const preview = await useCase(repo).resolveSourceTax(ctx(['procurement.vendor_bill.create']), { sourceType: 'procurement.vendor_bill', sourceId: 'b1', sourceLineId: 'l1', transactionContext: 'IMPORT_GOODS', documentDate: '2026-07-14', currency: 'THB', taxCodeDefinitionId: def.id, netAmount: '1000', grossAmount: '1077', authoritativeCustomsValue: '9999', authoritativeImportVatAmount: '999', evidenceRefs: ['ev1'] } as any, 'FINAL');
    assert.equal(preview.snapshot.taxBaseAmount, '1000.00');
    assert.equal(preview.snapshot.taxAmount, '77.00');
  });

  it('rejects header-level or wrong-type import evidence so customs amounts cannot duplicate across lines', async () => {
    const def = { ...definition(), taxRegime: 'IMPORT_VAT' as const, direction: 'INPUT' as const, treatment: 'CLAIMABLE' as const, transactionContexts: ['IMPORT_GOODS' as const], claimabilityDefault: 'CLAIMABLE' as const, evidenceRuleKey: null };
    const customs = { id: 'ev-header', companyId: 'c1', status: 'VERIFIED', reviewedByUserId: 'reviewer-1', reviewedAt: new Date(), sourceType: 'procurement.vendor_bill', sourceId: 'b1', sourceLineId: null,
      transactionContext: 'IMPORT_GOODS', branchId: null, evidenceType: 'CUSTOMS_ENTRY', customsValue: '1000', dutyAmount: '0', exciseAmount: '0', otherTaxAmount: '0', importVatAmount: '70' };
    const repo = { prisma: { client: { tradeTaxEvidence: { findMany: async () => [customs] } } }, listProfiles: async () => [profile('p1')], listDefinitions: async () => [def], listAccountRules: async () => [], listReportRules: async () => [] } as any;
    const input = { sourceType: 'procurement.vendor_bill', sourceId: 'b1', sourceLineId: 'line-2', transactionContext: 'IMPORT_GOODS', documentDate: '2026-07-14', currency: 'THB', taxCodeDefinitionId: def.id,
      netAmount: '1000', grossAmount: '1070', evidenceRefs: ['ev-header'] } as any;
    await assert.rejects(() => useCase(repo).resolveSourceTax(ctx(['procurement.vendor_bill.create']), input, 'FINAL'), /source line/);
    await assert.rejects(() => useCase({ prisma: { client: {} } } as any).createEvidence(ctx(['tax.review_issue.resolve', 'procurement.vendor_bill.create']), {
      transactionContext: 'IMPORT_GOODS', sourceType: 'procurement.vendor_bill', sourceId: 'b1', evidenceType: 'CUSTOMS_ENTRY', referenceNumber: 'C-1', evidenceDate: '2026-07-14',
      currency: 'THB', customsValue: '1000', dutyAmount: '0', exciseAmount: '0', otherTaxAmount: '0', importVatAmount: '70', attachmentIds: ['attachment-1'],
    } as any), /exact source line/);
    await assert.rejects(() => useCase({ prisma: { client: {} } } as any).createEvidence(ctx(['tax.review_issue.resolve', 'procurement.vendor_bill.create']), {
      transactionContext: 'IMPORT_SERVICE', sourceType: 'procurement.vendor_bill', sourceId: 'b1', evidenceType: 'PP36_RECEIPT', referenceNumber: 'P-1', evidenceDate: '2026-07-14',
      currency: 'THB', customsValue: '0', dutyAmount: '0', exciseAmount: '0', otherTaxAmount: '0', importVatAmount: '70', attachmentIds: ['attachment-1'],
    } as any), /exact source line/);
    const other = { ...customs, id: 'ev-other', sourceLineId: 'line-2', evidenceType: 'OTHER' };
    repo.prisma.client.tradeTaxEvidence.findMany = async () => [other];
    await assert.rejects(() => useCase(repo).resolveSourceTax(ctx(['procurement.vendor_bill.create']), { ...input, evidenceRefs: ['ev-other'] }, 'FINAL'), /evidence rule/);
  });

  it('rechecks linked attachments before verification while allowing stale evidence to be rejected', async () => {
    const evidence = {
      id: 'ev1', companyId: 'c1', branchId: null, sourceType: 'procurement.vendor_bill', attachmentIds: ['attachment-1', 'attachment-2'],
    };
    let reviewedStatus: string | null = null;
    const repo = {
      prisma: { client: { attachmentObject: { count: async ({ where }: any) => {
        assert.deepEqual(where, { companyId: 'c1', id: { in: ['attachment-1', 'attachment-2'] }, status: 'ACTIVE' });
        return 1;
      } } } },
      findEvidence: async () => evidence,
      verifyEvidence: async (_companyId: string, _id: string, _userId: string, status: string) => {
        reviewedStatus = status;
        return { ...evidence, status };
      },
    } as any;
    const permissions = ['tax.config.manage', 'procurement.vendor_bill.read'];

    await assert.rejects(() => useCase(repo).verifyEvidence(ctx(permissions), 'ev1', 'VERIFIED'), /still be active and owned/);
    assert.equal(reviewedStatus, null);
    await useCase(repo).verifyEvidence(ctx(permissions), 'ev1', 'REJECTED');
    assert.equal(reviewedStatus, 'REJECTED');
  });

  it('requires every configured evidence type and recognizes foreign PP36 in THB on payment date', async () => {
    const def = { ...definition(), externalCode: 'V3', direction: 'SELF_ASSESSED' as const, treatment: 'REVERSE_CHARGE' as const, transactionContexts: ['IMPORT_SERVICE' as const], claimabilityDefault: 'CLAIMABLE' as const, evidenceRuleKey: 'PP36_RECEIPT,PAYMENT_EVIDENCE' };
    const accounts = [
      { ...account(def), direction: 'SELF_ASSESSED', treatment: 'REVERSE_CHARGE', transactionContext: 'IMPORT_SERVICE', accountRole: 'PP36_OUTPUT_VAT_PAYABLE', postingSide: 'CREDIT' },
      { ...account(def), id: 'a2', direction: 'SELF_ASSESSED', treatment: 'REVERSE_CHARGE', transactionContext: 'IMPORT_SERVICE', accountRole: 'PP36_INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT' },
      { ...account(def), id: 'a3', direction: 'SELF_ASSESSED', treatment: 'REVERSE_CHARGE', transactionContext: 'IMPORT_SERVICE', accountRole: 'INPUT_VAT_PENDING', accountId: 'vat-pending', postingSide: 'DEBIT' },
    ];
    const mappings = [
      { ...reports(def)[0], formType: 'PP36', boxKey: 'tax_due', amountSource: 'TAX_AMOUNT' },
      { ...reports(def)[0], id: 'r6', boxKey: 'box_6_eligible_purchases', amountSource: 'TAX_BASE' },
      { ...reports(def)[0], id: 'r7', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT' },
    ];
    const evidence = (id: string, evidenceType: string) => ({ id, companyId: 'c1', status: 'VERIFIED', reviewedByUserId: 'reviewer-1', reviewedAt: new Date('2026-07-20'), sourceType: 'procurement.vendor_bill', sourceId: 'b1', sourceLineId: 'l1', transactionContext: 'IMPORT_SERVICE', branchId: null, evidenceType, evidenceDate: new Date(evidenceType === 'PP36_RECEIPT' ? '2026-07-20' : '2026-07-10'), exchangeRate: '35', exchangeRateSource: 'BOT', customsValue: '0', dutyAmount: '0', exciseAmount: '0', otherTaxAmount: '0', importVatAmount: '0' });
    let rows = [evidence('ev1', 'PP36_RECEIPT')];
    const repo = { prisma: { client: { tradeTaxEvidence: { findMany: async () => rows } } }, listProfiles: async () => [profile('p1')], listDefinitions: async () => [def], listAccountRules: async () => accounts, listReportRules: async () => mappings } as any;
    const input = { sourceType: 'procurement.vendor_bill', sourceId: 'b1', sourceLineId: 'l1', transactionContext: 'IMPORT_SERVICE', documentDate: '2026-07-01', paymentDate: '2026-07-15', currency: 'USD', taxCodeDefinitionId: def.id, netAmount: '100', grossAmount: '107', evidenceRefs: ['ev1'], authoritativeSelfAssessedTaxBaseAmount: '999999', authoritativeSelfAssessedTaxAmount: '999999' } as any;
    const draft = await useCase(repo).resolveSourceTax(ctx(['procurement.vendor_bill.create']), input, 'DRAFT');
    assert.ok(draft.errors.includes('required_evidence_types_incomplete'));
    assert.equal(draft.components.find((component) => component.componentKey === 'PP36_INPUT')?.accountRole, 'INPUT_VAT_PENDING');
    rows = [evidence('ev2', 'PAYMENT_EVIDENCE')];
    const paymentFinal = await useCase(repo).resolveSourceTax(ctx(['procurement.vendor_bill.create']), { ...input, evidenceRefs: ['ev2'] }, 'FINAL');
    assert.equal(paymentFinal.components.find((component) => component.componentKey === 'PP36_OUTPUT')?.snapshot.evidenceStatus, 'VERIFIED');
    assert.equal(paymentFinal.components.find((component) => component.componentKey === 'PP36_INPUT')?.accountRole, 'INPUT_VAT_PENDING');
    assert.deepEqual(paymentFinal.components.find((component) => component.componentKey === 'PP36_INPUT')?.reportContributions, []);
    rows = [evidence('ev1', 'PP36_RECEIPT'), evidence('ev2', 'PAYMENT_EVIDENCE')];
    const final = await useCase(repo).resolveSourceTax(ctx(['procurement.vendor_bill.create']), { ...input, evidenceRefs: ['ev1', 'ev2'] }, 'FINAL');
    assert.equal(final.snapshot.taxBaseAmount, '3500.00');
    assert.equal(final.snapshot.taxAmount, '245.00');
    assert.equal(final.snapshot.sourceCurrency, 'USD');
    assert.equal(final.snapshot.taxCurrency, 'THB');
    assert.equal(final.snapshot.exchangeRate, '35');
    assert.equal(final.snapshot.exchangeRateSource, 'BOT');
    assert.equal(final.snapshot.exchangeRateDate, '2026-07-10');
    assert.equal(final.snapshot.recognitionDate, '2026-07-15');
    assert.equal(final.components.find((component) => component.componentKey === 'PP36_INPUT')?.accountRole, 'PP36_INPUT_VAT_CLAIMABLE');
    repo.findProfile = async () => ({ ...profile('p1'), status: 'RETIRED' });
    repo.listProfiles = async () => assert.fail('historical PP36 settlement must not require an ACTIVE profile');
    const historicalSnapshot = { ...final.snapshot, taxBaseAmount: '1166.67', taxAmount: '81.67' };
    const historical = await useCase(repo).resolveSourceTax(ctx(['procurement.vendor_bill.create']), {
      ...input, netAmount: '33.3333', grossAmount: '33.3333', evidenceRefs: ['ev1', 'ev2'],
    }, 'FINAL', undefined, 'SELF_ASSESSED', 'procurement', {
      authoritativeSelfAssessedTaxBaseAmount: '1166.67', authoritativeSelfAssessedTaxAmount: '81.67', historicalSnapshot,
    });
    assert.equal(historical.snapshot.taxBaseAmount, '1166.67');
    assert.equal(historical.snapshot.taxAmount, '81.67');
    assert.equal(historical.snapshot.roundingMode, historicalSnapshot.roundingMode);
  });

  it('normalizes a USD export to company functional currency and fails closed without verified FX evidence', async () => {
    const def = { ...definition(), externalCode: 'O0', treatment: 'ZERO_RATED' as const, transactionContexts: ['EXPORT_GOODS' as const], rate: '0', calculationMethod: 'NONE' as const, evidenceRuleKey: null };
    const mappings = [
      { ...reports(def)[0], boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE' },
      { ...reports(def)[1], boxKey: 'box_2_zero_rated_sales', amountSource: 'TAX_BASE' },
    ];
    const evidence = (id: string, evidenceType: string, withFx = false) => ({
      id, companyId: 'c1', status: 'VERIFIED', reviewedByUserId: 'reviewer-1', reviewedAt: new Date('2026-07-15'),
      sourceType: 'accounting.document', sourceId: 'd-usd', sourceLineId: 'l-usd', transactionContext: 'EXPORT_GOODS', branchId: null,
      evidenceType, evidenceDate: new Date('2026-07-14'), currency: 'USD', exchangeRate: withFx ? '35' : null,
      exchangeRateSource: withFx ? 'BOT' : null, customsValue: '0', dutyAmount: '0', exciseAmount: '0', otherTaxAmount: '0', importVatAmount: '0',
    });
    let rows = [evidence('export-1', 'EXPORT_DECLARATION'), evidence('payment-1', 'PAYMENT_EVIDENCE', true)];
    const repo = { prisma: { client: { tradeTaxEvidence: { findMany: async () => rows } } }, listProfiles: async () => [profile('p1')], listDefinitions: async () => [def], listAccountRules: async () => [], listReportRules: async () => mappings } as any;
    const input = { sourceType: 'accounting.document', sourceId: 'd-usd', sourceLineId: 'l-usd', transactionContext: 'EXPORT_GOODS', documentDate: '2026-07-14', currency: 'USD', taxCodeDefinitionId: def.id, netAmount: '100', grossAmount: '100', evidenceRefs: ['export-1', 'payment-1'] } as any;
    const preview = await useCase(repo).resolveSourceTax(ctx(['accounting.document.create']), input, 'FINAL');
    assert.equal(preview.snapshot.taxBaseAmount, '3500.00');
    assert.equal(preview.reportContributions[0]?.amount, '3500.00');
    assert.equal(preview.snapshot.taxCurrency, 'THB');
    rows = [evidence('export-1', 'EXPORT_DECLARATION'), evidence('payment-1', 'PAYMENT_EVIDENCE')];
    await assert.rejects(() => useCase(repo).resolveSourceTax(ctx(['accounting.document.create']), input, 'FINAL'), (error: any) => error.getResponse?.().preview?.errors?.includes('functional_currency_fx_required'));
  });

  it('explicitly enriches every unposted legacy scalar line without changing its tax facts', async () => {
    const def = { ...definition(), direction: 'INPUT' as const, treatment: 'CLAIMABLE' as const, transactionContexts: ['DOMESTIC_PURCHASE' as const], claimabilityDefault: 'CLAIMABLE' as const };
    const inputAccount = { ...account(def), direction: 'INPUT', treatment: 'CLAIMABLE', transactionContext: 'DOMESTIC_PURCHASE', accountRole: 'INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT' };
    const inputReports = reports(def).map((item, index) => ({ ...item, boxKey: index ? 'box_7_input_tax' : 'box_6_eligible_purchases', amountSource: index ? 'TAX_AMOUNT' : 'TAX_BASE' }));
    let applied: any;
    const repo = {
      prisma: { client: { tradeTaxEvidence: { findMany: async () => [] } } },
      findLegacyRemediationSource: async () => ({
        companyId: 'c1', sourceType: 'expense.record', sourceId: 'e1', branchId: null,
        documentDate: '2026-07-14T00:00:00.000Z', currency: 'THB', sourceKind: 'TAX_INVOICE',
        status: 'CONFIRMED', postingStatus: 'pending', journalEntryId: null, updatedAt: '2026-07-14T10:00:00.000Z', blockers: [],
        lines: [{ id: 'l1', updatedAt: '2026-07-14T09:00:00.000Z', netAmount: '100', grossAmount: '107', enteredTaxAmount: '7', sourceVatRate: '0.07', taxCodeDefinitionId: null, externalTaxCode: null, taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'NEEDS_REVIEW', taxContext: 'DOMESTIC_PURCHASE', taxRate: '0.07', taxBaseAmount: '100', transactionTaxAmount: '7' }],
      }),
      listProfiles: async () => [profile('p1')], listDefinitions: async () => [def],
      listAccountRules: async () => [inputAccount], listReportRules: async () => inputReports,
      applyLegacyRemediation: async (...args: any[]) => { applied = args; return 1; },
    } as any;
    const result = await useCase(repo).applyLegacyRemediation(ctx(['tax.config.manage', 'tax.review_issue.resolve', 'expense.read']), {
      sourceType: 'expense.record', sourceId: 'e1',
      lines: [{ sourceLineId: 'l1', taxCodeDefinitionId: def.id, transactionContext: 'DOMESTIC_PURCHASE' }],
    });
    assert.equal(result.applied, true);
    assert.equal(result.lines[0].preview.snapshot.taxBaseAmount, '100.00');
    assert.equal(result.lines[0].preview.snapshot.taxAmount, '7.00');
    assert.equal(result.lines[0].preview.snapshot.taxRate, '7');
    assert.equal(applied[0], 'c1');
    assert.equal(applied[4][0].sourceLineId, 'l1');
  });

  it('blocks posted or filed sources and any scalar amount drift', async () => {
    const def = { ...definition(), direction: 'INPUT' as const, treatment: 'CLAIMABLE' as const, transactionContexts: ['DOMESTIC_PURCHASE' as const], claimabilityDefault: 'CLAIMABLE' as const };
    const source = {
      companyId: 'c1', sourceType: 'expense.record', sourceId: 'e1', branchId: null,
      documentDate: '2026-07-14T00:00:00.000Z', currency: 'THB', sourceKind: 'TAX_INVOICE',
      status: 'CONFIRMED', postingStatus: 'posted', journalEntryId: 'j1', updatedAt: '2026-07-14T10:00:00.000Z', blockers: ['source_already_posted', 'tax_period_already_filed'],
      lines: [{ id: 'l1', updatedAt: '2026-07-14T09:00:00.000Z', netAmount: '100', grossAmount: '107', enteredTaxAmount: '8', taxCodeDefinitionId: null, externalTaxCode: null, taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'NEEDS_REVIEW', taxContext: 'DOMESTIC_PURCHASE', taxRate: '7', taxBaseAmount: '100', transactionTaxAmount: '8' }],
    };
    let applied = false;
    const repo = {
      prisma: { client: { tradeTaxEvidence: { findMany: async () => [] } } }, findLegacyRemediationSource: async () => source,
      listProfiles: async () => [profile('p1')], listDefinitions: async () => [def],
      listAccountRules: async () => [{ ...account(def), direction: 'INPUT', treatment: 'CLAIMABLE', transactionContext: 'DOMESTIC_PURCHASE', accountRole: 'INPUT_VAT_CLAIMABLE', postingSide: 'DEBIT' }],
      listReportRules: async () => reports(def).map((item, index) => ({ ...item, boxKey: index ? 'box_7_input_tax' : 'box_6_eligible_purchases', amountSource: index ? 'TAX_AMOUNT' : 'TAX_BASE' })),
      applyLegacyRemediation: async () => { applied = true; },
    } as any;
    const input = { sourceType: 'expense.record' as const, sourceId: 'e1', lines: [{ sourceLineId: 'l1', taxCodeDefinitionId: def.id, transactionContext: 'DOMESTIC_PURCHASE' as const }] };
    const preview = await useCase(repo).previewLegacyRemediation(ctx(['tax.config.manage', 'tax.review_issue.resolve', 'expense.read']), input);
    assert.equal(preview.canApply, false);
    assert.ok(preview.lines[0].errors.includes('entered_tax_amount_outside_tolerance'));
    assert.ok(preview.lines[0].errors.includes('legacy_tax_amount_mismatch'));
    await assert.rejects(() => useCase(repo).applyLegacyRemediation(ctx(['tax.config.manage', 'tax.review_issue.resolve', 'expense.read']), input), (error: any) => error.getResponse?.().code === 'legacy_transaction_tax_remediation_blocked');
    assert.equal(applied, false);
  });

  it('never auto-classifies migrated O0 without explicit export evidence', async () => {
    const def = { ...definition(), externalCode: 'O0', treatment: 'ZERO_RATED' as const, rate: '0', calculationMethod: 'NONE' as const, transactionContexts: ['EXPORT_GOODS' as const] };
    const repo = {
      prisma: { client: { tradeTaxEvidence: { findMany: async () => [] } } },
      findLegacyRemediationSource: async () => ({
        companyId: 'c1', sourceType: 'accounting.document', sourceId: 'd1', branchId: null,
        documentDate: '2026-07-14T00:00:00.000Z', currency: 'THB', sourceKind: 'TAX_INVOICE', status: 'ISSUED', postingStatus: 'pending', journalEntryId: null, updatedAt: '2026-07-14T10:00:00.000Z', blockers: [],
        lines: [{ id: 'l1', updatedAt: '2026-07-14T09:00:00.000Z', netAmount: '100', grossAmount: '100', enteredTaxAmount: '0', taxCodeDefinitionId: null, externalTaxCode: 'O0', taxRegime: 'VAT', taxDirection: 'OUTPUT', taxTreatment: 'NEEDS_REVIEW', taxContext: null, taxRate: '0', taxBaseAmount: '100', transactionTaxAmount: '0' }],
      }),
      listProfiles: async () => [profile('p1')], listDefinitions: async () => [def], listAccountRules: async () => [],
      listReportRules: async () => [
        { ...reports(def)[0], boxKey: 'box_1_total_sales', amountSource: 'TAX_BASE' },
        { ...reports(def)[0], id: 'r2', boxKey: 'box_2_zero_rated_sales', amountSource: 'TAX_BASE' },
      ],
    } as any;
    const preview = await useCase(repo).previewLegacyRemediation(ctx(['tax.config.manage', 'tax.review_issue.resolve', 'accounting.document.read']), {
      sourceType: 'accounting.document', sourceId: 'd1', lines: [{ sourceLineId: 'l1', taxCodeDefinitionId: def.id, transactionContext: 'EXPORT_GOODS' }],
    });
    assert.equal(preview.canApply, false);
    assert.ok(preview.lines[0].errors.includes('tax_evidence_required'));
  });
});
