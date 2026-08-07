import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TransactionTaxReconciliationUseCase } from './transaction-tax-reconciliation.use-case.js';

const ctx = (permissions: string[], branchIds?: string[]) => ({ companyId: 'c1', userId: 'u1', requestId: 'r1', permissions, scopes: { branchIds } }) as any;

describe('TransactionTaxReconciliationUseCase branch boundaries', () => {
  it('lists and reads across all granted branches without forcing one branch', async () => {
    const calls: any[] = [];
    const repo = {
      prisma: { client: {} },
      listReconciliations: async (...args: any[]) => { calls.push(['list', ...args]); return []; },
      findReconciliation: async (...args: any[]) => { calls.push(['get', ...args]); return { id: 'run-1' }; },
    } as any;
    const useCase = new TransactionTaxReconciliationUseCase(repo, {} as any, {} as any);
    await useCase.list(ctx(['tax.report.read'], ['b1', 'b2']), {});
    await useCase.get(ctx(['tax.report.read'], ['b1', 'b2']), 'run-1');
    assert.deepEqual(calls[0]?.[2], ['b1', 'b2']);
    assert.deepEqual(calls[1]?.[3], ['b1', 'b2']);
  });

  it('rejects a supplied branch owned by another company even for unrestricted actors', async () => {
    const repo = { prisma: { client: { branch: { findFirst: async () => null } } } } as any;
    const useCase = new TransactionTaxReconciliationUseCase(repo, {} as any, {} as any);
    await assert.rejects(() => useCase.generate(ctx(['tax.report.recompute']), { formType: 'PP30', periodKey: '2026-07', branchId: 'foreign-branch' }), /outside the company/);
  });

  it('selects paid PP36 vendor components by recognition month instead of bill month', async () => {
    let vendorQuery: any;
    const component = {
      componentKey: 'PP36_OUTPUT',
      snapshot: { recognitionDate: '2026-08-15', taxAmount: '7.00' },
      accountAssignments: [], reportContributions: [],
    };
    const repo = { prisma: { client: {
      accountingDocumentLine: { findMany: async () => [] },
      expenseLine: { findMany: async () => [] },
      vendorBillLine: { findMany: async (query: any) => {
        vendorQuery = query;
        return [{ id: 'line-1', taxComponentsJson: [component], vendorBill: { id: 'bill-1', branchId: 'b1', billDate: new Date('2026-07-20') } }];
      } },
      taxAdjustment: { findMany: async () => [] },
      supplierPaymentAllocation: { findMany: async () => [] },
    } } } as any;
    const useCase = new TransactionTaxReconciliationUseCase(repo, {} as any, {} as any);
    const july = await (useCase as any).sourceFacts('c1', undefined, 'PP36', { gte: new Date('2026-07-01'), lt: new Date('2026-08-01') });
    const august = await (useCase as any).sourceFacts('c1', undefined, 'PP36', { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') });
    assert.equal(july.length, 0);
    assert.deepEqual(august.map((fact: any) => [fact.sourceType, fact.sourceId, fact.sourceLineKey, fact.componentKey]), [
      ['procurement.vendor_bill', 'bill-1', 'line-1', 'PP36_OUTPUT'],
    ]);
    assert.equal(vendorQuery.where.vendorBill.billDate, undefined);
    assert.equal(vendorQuery.where.OR[0].taxContextSnapshot, 'IMPORT_SERVICE');
  });

  it('maps active PP36 payment recognitions to the Tax Event and journal identity in the payment period', async () => {
    const allocationQueries: any[] = [];
    const output = { componentKey: 'PP36_OUTPUT', snapshot: { recognitionDate: '2026-08-15', taxAmount: '7.00' } };
    const repo = { prisma: { client: {
      accountingDocumentLine: { findMany: async () => [] }, expenseLine: { findMany: async () => [] },
      vendorBillLine: { findMany: async () => [] }, taxAdjustment: { findMany: async () => [] },
      supplierPaymentAllocation: { findMany: async (query: any) => {
        allocationQueries.push(query);
        return [{ pp36RecognitionStatus: 'ACTIVE', pp36RecognitionJson: [{
          recognitionKey: 'allocation-1:line-1', vendorBillLineId: 'line-1',
          preview: { components: [output, { componentKey: 'PP36_INPUT' }] },
        }], supplierPayment: { id: 'payment-1', branchId: 'b1' } }];
      } },
    } } } as any;
    const useCase = new TransactionTaxReconciliationUseCase(repo, {} as any, {} as any);
    const range = { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') };
    const facts = await (useCase as any).sourceFacts('c1', 'b1', 'PP36', range);
    await (useCase as any).sourceFacts('c1', 'b1', 'PP30', range);
    assert.deepEqual(facts.map((fact: any) => [fact.sourceType, fact.sourceId, fact.sourceLineKey, fact.componentKey]), [
      ['procurement.supplier_payment.pp36', 'payment-1', 'allocation-1:line-1', 'PP36_OUTPUT'],
    ]);
    assert.equal(facts[0]?.sourceLineId, 'line-1');
    assert.equal(facts[0]?.component, output);
    assert.equal(allocationQueries.length, 1);
    assert.deepEqual(allocationQueries[0].where, {
      companyId: 'c1', pp36RecognitionStatus: 'ACTIVE', supplierPayment: { branchId: 'b1', paymentDate: range },
    });
  });

  it('excludes pending PP36 input from PP30 and includes only the immutable claim-release source', async () => {
    const pending = { componentKey: 'PP36_INPUT', snapshot: { recognitionDate: '2026-08-15', claimability: 'PENDING_EVIDENCE', taxAmount: '7.00' }, accountAssignments: [], reportContributions: [] };
    const released = { componentKey: 'PP36_INPUT', snapshot: { recognitionDate: '2026-09-20', claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED', taxAmount: '7.00' },
      accountAssignments: [{ accountRole: 'PP36_INPUT_VAT_CLAIMABLE', accountId: 'claimable', postingSide: 'DEBIT', ruleVersion: 3 }],
      reportContributions: [{ formType: 'PP30', boxKey: 'box_7_input_tax', amountSource: 'TAX_AMOUNT', amount: '7.00' }] };
    const repo = { prisma: { client: {
      accountingDocumentLine: { findMany: async () => [] }, expenseLine: { findMany: async () => [] },
      vendorBillLine: { findMany: async () => [{ id: 'line-1', taxComponentsJson: [pending], vendorBill: { id: 'bill-1', branchId: 'b1', billDate: new Date('2026-07-20') } }] },
      taxAdjustment: { findMany: async () => [{ id: 'adjustment-1', metadataJson: { kind: 'PP36_INPUT_CLAIM_RELEASE', branchId: 'b1', claimDate: '2026-09-20', component: released } }] },
    } } } as any;
    const useCase = new TransactionTaxReconciliationUseCase(repo, {} as any, {} as any);
    const facts = await (useCase as any).sourceFacts('c1', 'b1', 'PP30', { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') });
    assert.deepEqual(facts.map((fact: any) => [fact.sourceType, fact.sourceId, fact.sourceLineKey, fact.componentKey]), [
      ['tax.pp36_input_claim', 'adjustment-1', 'adjustment-1', 'PP36_INPUT'],
    ]);
  });

  it('aggregates PP30 boxes with the Tax Event rounding snapshot', async () => {
    const repo = { prisma: { client: {
      company: { findUnique: async () => ({ baseCurrency: 'THB' }) },
      taxEvent: { findMany: async () => [{
        currency: 'THB', roundingModeSnapshot: 'HALF_EVEN', roundingScaleSnapshot: 3, taxAmountToleranceSnapshot: '0.005',
        reportContributionsJson: [{ formType: 'PP30', boxKey: 'box_5_output_tax', amountSource: 'TAX_AMOUNT', amount: '7.005' }],
      }] },
    } } } as any;
    const useCase = new TransactionTaxReconciliationUseCase(repo, {} as any, {} as any);
    const boxes = await useCase.pp30Boxes(ctx(['tax.report.read']), '2026-07');
    assert.equal(boxes.box5OutputTax, '7.005');
    assert.equal(boxes.box8TaxPayable, '7.005');
  });
});
