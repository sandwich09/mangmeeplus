import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CreateDocumentUseCase, signedComponent } from './document.use-case.js';
import type { TransactionTaxComponentPreview } from '@watchdog-bms/contracts';

const original: TransactionTaxComponentPreview = {
  componentKey: 'VAT',
  snapshot: {
    taxCodeDefinitionId: 'definition-o1', externalTaxCode: 'O1', taxProfileKey: 'S4_TH', taxProfileVersion: 3,
    taxRegime: 'VAT', taxDirection: 'OUTPUT', taxTreatment: 'STANDARD', taxContext: 'DOMESTIC_SALE',
    taxRate: '7', sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1', exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-07-01',
    taxBaseAmount: '1000.00', taxAmount: '70.00', claimability: 'NOT_APPLICABLE',
    evidenceStatus: 'VERIFIED', accountRuleVersion: 4, reportRuleVersion: 2,
  },
  accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'vat-output-id',
  accountAssignments: [{ accountRole: 'OUTPUT_VAT_PAYABLE', accountId: 'vat-output-id', postingSide: 'CREDIT', ruleVersion: 4 }],
  reportContributions: [
    { formType: 'PP30', boxKey: 'box_1_total_sales', amount: '1000.00', amountSource: 'TAX_BASE' },
    { formType: 'PP30', boxKey: 'box_5_output_tax', amount: '70.00', amountSource: 'TAX_AMOUNT' },
  ],
};

describe('correction Tax Code snapshot inheritance', () => {
  it('keeps immutable mapping but uses a partial credit-note amount and reverses posting side', () => {
    const credit = signedComponent(original, -1, 'RETURN_OR_CREDIT', {
      taxBaseAmount: '100.00', taxAmount: '7.00', grossAmount: '107.00',
    });
    assert.equal(credit.snapshot.taxCodeDefinitionId, 'definition-o1');
    assert.equal(credit.snapshot.taxProfileVersion, 3);
    assert.equal(credit.snapshot.taxBaseAmount, '-100.00');
    assert.equal(credit.snapshot.taxAmount, '-7.00');
    assert.equal(credit.accountAssignments[0]?.postingSide, 'DEBIT');
    assert.deepEqual(credit.reportContributions.map((entry) => entry.amount), ['-100.00', '-7.00']);
  });
});

describe('CreateDocumentUseCase Tax Code compatibility header', () => {
  it('deletes the draft and rejects when a resolved S/4HANA O1 line contradicts an O7 header', async () => {
    const document: any = {
      id: 'document-1',
      companyId: 'company-1',
      documentType: 'TAX_INVOICE',
      status: 'DRAFT',
      documentDate: new Date('2026-07-29'),
      currency: 'THB',
      vatMode: 'VAT_EXCLUDED',
      outputTaxCode: 'O7',
      vatAmount: '7.00',
      lines: [{
        id: 'line-1',
        lineNumber: 1,
        lineSubtotalAmount: '100.00',
        lineTotalAmount: '107.00',
        vatAmount: '7.00',
      }],
    };
    const repo = {
      findActiveBranch: async () => ({ id: 'branch-1' }),
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      createDocument: mock.fn(async () => document),
      findDocumentById: mock.fn(async () => document),
      saveLineTaxSnapshots: mock.fn(async (_companyId: string, _documentId: string, rows: any[]) => {
        document.lines[0].taxSnapshot = rows[0].preview.snapshot;
        document.lines[0].taxComponents = rows[0].preview.components;
      }),
      deleteDraftDocument: mock.fn(async () => undefined),
    };
    const transactionTax = {
      resolveSourceTax: mock.fn(async () => ({
        components: [original],
        snapshot: original.snapshot,
        accountRole: original.accountRole,
        accountId: original.accountId,
        reportContributions: original.reportContributions,
        warnings: [],
        errors: [],
        sourceChecksum: 'source',
        configurationChecksum: 'configuration',
      })),
    };
    const useCase = new CreateDocumentUseCase(
      repo as any,
      { log: mock.fn(async () => undefined) } as any,
      transactionTax as any,
      { get: mock.fn(async () => ({ status: 'REGISTERED' })) } as any,
      { assertLaunchRouteOpen: mock.fn(async () => undefined) } as any,
    );

    await assert.rejects(
      () => useCase.execute({
        requestId: 'request-1',
        authSubject: 'subject-1',
        userId: 'user-1',
        companyId: 'company-1',
        membershipId: 'membership-1',
        roles: [],
        permissions: ['accounting.document.create'],
        scopes: {},
        authProvider: 'dev',
      }, {
        documentType: 'TAX_INVOICE',
        documentDate: '2026-07-29',
        currency: 'THB',
        vatMode: 'VAT_EXCLUDED',
        outputTaxCode: 'O7',
        lines: [{
          lineNumber: 1,
          description: 'Service',
          quantity: '1',
          unitPrice: '100',
          vatRate: '7',
          taxCodeDefinitionId: 's4-o1',
        }],
      }),
      (error: any) => error.getResponse?.().message === 'output_tax_code_line_mismatch',
    );
    assert.equal(repo.deleteDraftDocument.mock.callCount(), 1);
  });
});
