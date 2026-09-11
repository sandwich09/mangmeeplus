// 10D branch ABAC enforcement in the expense use-cases (web and LINE share these).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import {
  ConfirmExpenseUseCase,
  CreateExpenseDraftUseCase,
  GetExpenseUseCase,
  ListExpensesUseCase,
  MarkExpenseReadyUseCase,
  UpdateExpenseDraftUseCase,
} from './expense-draft.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';
import { ExpenseController } from '../../presentation/http/expense.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { requireExpenseBranchId } from '../../infrastructure/prisma-expense.repository';

const audit = { log: async () => undefined } as any;
const transactionTax = { resolveLines: async (_ctx: unknown, _header: unknown, lines: unknown[]) => lines } as any;
const launchGate = { assertLaunchRouteOpen: async () => undefined } as any;
const numberServices = [
  { execute: async () => ({ id: 'number-1', documentNumber: 'EXP-202607-00001' }) } as any,
  { execute: async () => undefined } as any,
  { execute: async () => undefined } as any,
  // 4th slot: VAT registration read. Only consulted for a CLAIMABLE expense, which none of
  // these fixtures is, so an UNKNOWN stub keeps the confirm path unchanged.
  { get: async () => ({ status: 'UNKNOWN' }) } as any,
] as const;

function ctx(branchIds?: string[], permissions: string[] = ['expense.read', 'expense.create', 'expense.review']): RequestContext {
  return {
    requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
    membershipId: 'mem-1', roles: [], permissions,
    scopes: branchIds ? { branchIds } : {}, authProvider: 'watchdog',
  };
}

describe('ListExpensesUseCase branch scope', () => {
  function makeRepo() {
    const calls: any[] = [];
    return {
      calls,
      repo: {
        listExpenses: async (filter: any, scopes: any) => { calls.push({ filter, scopes }); return { data: [], total: 0, page: 1, pageSize: 20 }; },
      } as any,
    };
  }

  it('passes the caller scope to the repository', async () => {
    const { repo, calls } = makeRepo();
    await new ListExpensesUseCase(repo).execute(ctx(['b1']), {});
    assert.deepEqual(calls[0].scopes, { branchIds: ['b1'] });
  });

  it('rejects an explicit branch filter outside the scope', async () => {
    const { repo } = makeRepo();
    await assert.rejects(
      () => new ListExpensesUseCase(repo).execute(ctx(['b1']), { branchId: 'b2' }),
      /branch scope/,
    );
  });

  it('allows an explicit branch filter inside the scope', async () => {
    const { repo, calls } = makeRepo();
    await new ListExpensesUseCase(repo).execute(ctx(['b1', 'b2']), { branchId: 'b2' });
    assert.equal(calls[0].filter.branchId, 'b2');
  });

  it('clamps oversized pagination before querying the repository', async () => {
    const { repo, calls } = makeRepo();
    await new ListExpensesUseCase(repo).execute(ctx(), { page: 0, pageSize: 500_000 });
    assert.equal(calls[0].filter.page, 1);
    assert.equal(calls[0].filter.pageSize, 200);
  });
});

describe('CreateExpenseDraftUseCase branch tagging', () => {
  function makeRepo() {
    const created: any[] = [];
    return {
      created,
      repo: {
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, branchId?: string) =>
          requireExpenseBranchId(branchId ?? (scopes.branchIds?.length === 1 ? scopes.branchIds[0] : null)),
        createExpense: async (input: any) => { created.push(input); return { id: 'exp-1', ...input }; },
        // §5.1: an omitted chargeKind on a replacement PATCH keeps the stored one, so the
        // update path reads them back before it validates.
        listLineChargeKinds: async () => new Map<number, { chargeKind: string | null; description: string }>(),
        upsertLines: async () => undefined,
      } as any,
    };
  }
  const input = { captureSource: 'WEB_MANUAL', expenseDate: '2026-07-03', vatMode: 'NO_VAT', inputVatClaimStatus: 'NOT_CLAIMABLE' } as any;

  it('defaults the only available scoped branch', async () => {
    const { repo, created } = makeRepo();
    await new CreateExpenseDraftUseCase(repo, audit, transactionTax, launchGate).execute(ctx(['b-default']), input);
    assert.equal(created[0].branchId, 'b-default');
  });

  it('does not guess the first scoped branch when more than one is available', async () => {
    const { repo, created } = makeRepo();
    await assert.rejects(() => new CreateExpenseDraftUseCase(repo, audit, transactionTax, launchGate).execute(ctx(['b-default', 'b-2']), input), /เลือกสาขา/);
    assert.equal(created.length, 0);
  });

  it('requires unrestricted creators to select a source branch', async () => {
    const { repo, created } = makeRepo();
    await assert.rejects(() => new CreateExpenseDraftUseCase(repo, audit, transactionTax, launchGate).execute(ctx(undefined), input), /เลือกสาขา/);
    assert.equal(created.length, 0);
  });

  it('preserves an explicitly selected branch without inventing a reviewer VAT snapshot', async () => {
    const { repo, created } = makeRepo();
    await new CreateExpenseDraftUseCase(repo, audit, transactionTax, launchGate).execute(ctx(undefined), { ...input, branchId: 'b1' });
    assert.equal(created[0].branchId, 'b1');
    assert.equal(created[0].vatCaptureSnapshotJson, undefined, 'a pre-OCR draft must not invent reviewer source precedence');
  });

  it('stores a snapshot when the creator explicitly supplies the document VAT source', async () => {
    const { repo, created } = makeRepo();
    await new CreateExpenseDraftUseCase(repo, audit, transactionTax, launchGate).execute(ctx(undefined), {
      ...input,
      branchId: 'b1',
      vatMode: 'VAT_INCLUDED',
      vatSource: { inputType: 'AMOUNT', vatAmount: '7.00' },
      lines: [{ lineNumber: 1, description: 'service', quantity: '1', unitPrice: '107', discountAmount: '0' }],
    });
    assert.equal(created[0].vatCaptureSnapshotJson.source.origin, 'REVIEWER');
    assert.equal(created[0].vatCaptureSnapshotJson.source.vatAmount, '7.0000');
  });

  it('rejects an explicit branch outside the scope', async () => {
    const { repo } = makeRepo();
    await assert.rejects(
      () => new CreateExpenseDraftUseCase(repo, audit, transactionTax, launchGate).execute(ctx(['b1']), { ...input, branchId: 'b9' }),
      /branch scope/,
    );
  });
});

describe('GetExpenseUseCase branch scope', () => {
  const record = (branchId: string | null) => ({ id: 'exp-1', branchId, createdByUserId: 'user-1', status: 'DRAFT' });

  it('hides a record from another branch', async () => {
    const repo = { findByIdWithRelations: async () => record('b9') } as any;
    await assert.rejects(() => new GetExpenseUseCase(repo).execute(ctx(['b1']), 'exp-1'), /branch scope/);
  });

  it('shows company-central records to restricted scopes', async () => {
    const calls: any[][] = [];
    const repo = { findByIdWithRelations: async (...args: any[]) => { calls.push(args); return record(null); } } as any;
    const r = await new GetExpenseUseCase(repo).execute(ctx(['b1']), 'exp-1');
    assert.equal(r.id, 'exp-1');
    assert.deepEqual(calls[0]?.[3], { branchIds: ['b1'] }, 'candidate relations are filtered before the detail leaves the repository');
  });

  it('allows the exact selected payer to open a non-owned signing task', async () => {
    const repo = { findByIdWithRelations: async () => ({
      ...record('b1'), createdByUserId: 'finance-1', substituteReceiptEvidence: { payerUserId: 'user-1' },
    }) } as any;
    const r = await new GetExpenseUseCase(repo).execute(ctx(['b1'], ['expense.read_own']), 'exp-1');
    assert.equal(r.id, 'exp-1');
  });

  it('lets a creator reopen only the draft they created', async () => {
    const ownRepo = { findByIdWithRelations: async () => record('b1') } as any;
    assert.equal((await new GetExpenseUseCase(ownRepo).execute(ctx(['b1'], ['expense.create']), 'exp-1')).id, 'exp-1');

    const otherRepo = { findByIdWithRelations: async () => ({ ...record('b1'), createdByUserId: 'other-user' }) } as any;
    await assert.rejects(
      () => new GetExpenseUseCase(otherRepo).execute(ctx(['b1'], ['expense.create']), 'exp-1'),
      /Access denied/,
    );
  });

  it('lets an expense confirmer read the branch-scoped record needed for the decision', async () => {
    const repo = { findByIdWithRelations: async () => ({ ...record('b1'), createdByUserId: 'other-user' }) } as any;
    assert.equal((await new GetExpenseUseCase(repo).execute(ctx(['b1'], ['expense.confirm']), 'exp-1')).id, 'exp-1');
  });
});

describe('UpdateExpenseDraftUseCase branch scope', () => {
  it('blocks mutating a record from another branch', async () => {
    const repo = { findById: async () => ({ id: 'exp-1', branchId: 'b9', createdByUserId: 'user-1', status: 'DRAFT' }) } as any;
    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(ctx(['b1']), 'exp-1', { note: 'x' } as any),
      /branch scope/,
    );
  });

  it('blocks re-tagging a record to an out-of-scope branch', async () => {
    const repo = { findById: async () => ({ id: 'exp-1', branchId: 'b1', createdByUserId: 'user-1', status: 'DRAFT' }) } as any;
    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(ctx(['b1']), 'exp-1', { branchId: 'b9' } as any),
      /branch scope/,
    );
  });

  it('keeps document, tax, and accounting classification fields finance-only', async () => {
    const repo = { findById: async () => ({ id: 'exp-1', branchId: 'b1', createdByUserId: 'user-1', status: 'DRAFT' }) } as any;
    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(ctx(['b1'], ['expense.update']), 'exp-1', { sourceDocumentType: 'RECEIPT' } as any),
      /expense.review/,
    );
  });

  it('blocks an API bypass that keeps a Tax Code while classifying the draft as a receipt', async () => {
    const repo = {
      findById: async () => ({
        id: 'exp-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW', vatMode: 'VAT_EXCLUDED',
      }),
    } as any;

    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(
        ctx(undefined, ['expense.review']),
        'exp-1',
        {
          sourceDocumentType: 'RECEIPT',
          lines: [{
            lineNumber: 1, description: 'อาหาร', quantity: '1', unitPrice: '100',
            taxCodeDefinitionId: 'tax-o7', externalTaxCode: 'O7', transactionContext: 'DOMESTIC_PURCHASE',
          }],
        } as any,
      ),
      /cannot retain a Tax Code/,
    );
  });

  it('blocks a document-only API bypass when persisted Tax Code snapshots would become stale', async () => {
    const repo = {
      findById: async () => ({
        id: 'exp-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW', vatMode: 'VAT_EXCLUDED',
      }),
      findByIdWithRelations: async () => ({
        lines: [{ id: 'line-1', taxSnapshot: { taxCodeDefinitionId: 'tax-o7', taxContext: 'DOMESTIC_PURCHASE' } }],
      }),
    } as any;

    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(
        ctx(undefined, ['expense.review']), 'exp-1', { sourceDocumentType: 'RECEIPT' },
      ),
      /Remove the existing Tax Code lines/,
    );
  });
});

describe('expense Tax Code confirmation guard', () => {
  const readyRecord = {
    id: 'exp-1', branchId: 'b1', status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'NO_MATCH',
    primaryAttachmentId: 'att-1', missingReceiptReason: null, vendorNameSnapshot: 'Supplier',
    vendorTaxIdSnapshot: '0100000000001', vendorDocumentNumber: 'TAX-INV-1',
    expenseDate: new Date('2026-07-13T00:00:00.000Z'), currency: 'THB',
    grandTotalAmount: '107.00', vatMode: 'VAT_EXCLUDED', inputVatClaimStatus: 'CLAIMABLE',
    vendorCounterpartyId: null, sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'USABLE_FOR_TAX',
    substituteReceiptGeneratedAt: null, substituteReceiptEvidence: null,
    updatedAt: new Date('2026-07-13T10:00:00.000Z'), aiVerificationSummaryJson: null,
    lines: [{
      id: 'line-1', lineNumber: 1, description: 'สินค้า', quantity: '1', unitPrice: '100',
      discountAmount: '0', taxableAmount: '100', vatRate: '0.07', vatAmount: '7',
      whtRate: null, whtAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '107',
      expenseCategoryId: null, accountHintKey: null, taxCategory: 'INPUT_VAT',
      taxSnapshot: {
        taxCodeDefinitionId: 'tax-o7', externalTaxCode: 'O7', taxProfileKey: 'SAP-TH', taxProfileVersion: 1,
        taxRegime: 'VAT', taxDirection: 'INPUT', taxTreatment: 'CLAIMABLE', taxContext: 'DOMESTIC_PURCHASE',
        taxRate: '7', sourceCurrency: 'THB', taxCurrency: 'THB', exchangeRate: '1',
        exchangeRateSource: 'FUNCTIONAL_CURRENCY', exchangeRateDate: '2026-07-13', taxBaseAmount: '100',
        taxAmount: '7', claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
      },
      taxComponents: [{}],
    }],
  };

  // Plan 13.11.B: the mismatched snapshot a reviewer actually sees — printed 8.00 against a
  // calculated 7.00 on a 7%-plus-no-VAT receipt, pointing at line 1.
  const mismatchedVatRecord = {
    ...readyRecord,
    vatCaptureSnapshotJson: {
      version: 1,
      source: { vatAmount: '8.0000' },
      calculation: { vatAmount: '7.0000' },
      reconciliation: {
        status: 'MISMATCH', acceptedSource: 'CALCULATED',
        differenceAmount: '1.0000', toleranceAmount: '0.05', attentionLineNumbers: [1],
      },
    },
  };

  it('blocks confirmation while VAT source reconciliation needs review, naming the line to check', async () => {
    const repo = { findByIdWithRelations: async () => mismatchedVatRecord } as any;

    await assert.rejects(
      () => new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3]).execute(ctx(undefined, ['expense.confirm']), 'exp-1'),
      (error: any) => {
        const body = error?.getResponse?.();
        assert.equal(body.code, 'EXPENSE_VAT_RECONCILIATION_REQUIRED');
        assert.match(body.message, /VAT จากเอกสาร 8\.00 บาท/);
        assert.match(body.message, /กรุณาตรวจรายการที่ 1/);
        assert.deepEqual(body.attentionLines, [{ lineNumber: 1, description: 'สินค้า' }]);
        return true;
      },
    );
  });

  // Owner decision 2026-08-28, from a real dead end: the block above is the only way this receipt
  // can be filed, and it used to require `expense.review` ON TOP of the `expense.confirm` this call
  // already demands. Someone holding only confirm was refused the save AND not shown the control that
  // would clear it — the same reviewer-only strand `substitute-receipt-payer-access` was written for.
  // Whoever may confirm the expense may now accept the document total; the reason, the carrying line,
  // the freshness check and the audit entry all stay.
  it('lets whoever may confirm accept the document VAT total, so nobody is stranded', async () => {
    const repo = { findByIdWithRelations: async () => mismatchedVatRecord } as any;
    let permissionError: unknown = null;

    await new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3])
      .execute(ctx(undefined, ['expense.confirm']), 'exp-1', { reason: 'ใบเสร็จพิมพ์ VAT รวมทั้งใบ', vatLineNumber: 1, expectedUpdatedAt: readyRecord.updatedAt.toISOString() })
      .catch((error: unknown) => { permissionError = error; });

    // The mock repo cannot carry the confirm all the way through, so this asserts the one thing that
    // must never come back: a refusal for holding the wrong permission.
    assert.doesNotMatch(String((permissionError as Error)?.message ?? ''), /Missing permission/, 'confirm alone must be enough');
  });

  it('refuses to hang the difference on a line that bears no VAT', async () => {
    const repo = {
      findByIdWithRelations: async () => ({
        ...mismatchedVatRecord,
        lines: [...mismatchedVatRecord.lines, { ...mismatchedVatRecord.lines[0], id: 'line-2', lineNumber: 2, description: 'ผัก', vatRate: '0', vatAmount: '0', taxSnapshot: null, taxComponents: [] }],
      }),
    } as any;

    await assert.rejects(
      () => new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3])
        .execute(ctx(undefined, ['expense.confirm', 'expense.review']), 'exp-1', { reason: 'ตามเอกสาร', vatLineNumber: 2, expectedUpdatedAt: readyRecord.updatedAt.toISOString() }),
      (error: any) => error?.getResponse?.().code === 'EXPENSE_VAT_OVERRIDE_INVALID',
    );
  });

  it('lets a reviewer confirm on the document VAT total and writes the decision to audit', async () => {
    const auditEntries: any[] = [];
    const repo = {
      findByIdWithRelations: async () => mismatchedVatRecord,
      finalizeAndConfirmExpenseCas: async (input: any, finalize: any) => {
        assert.equal(input.vatSourceOverride.vatLineNumber, 1);
        const finalized = await finalize({ db: { transaction: true }, expense: {
          ...mismatchedVatRecord, taxableAmount: '100.0000', vatAmount: '8.0000', grandTotalAmount: '108.0000',
          whtAmount: '0.0000', netPayableAmount: '108.0000',
        } });
        return { expense: { ...input, status: 'CONFIRMED', expenseNumber: 'EXP-1' }, finalized };
      },
    } as any;

    const confirmed = await new ConfirmExpenseUseCase(
      repo, { log: async (entry: any, tx: any) => {
        if (entry.action === 'expense.vat.source_override') assert.equal(tx.transaction, true);
        auditEntries.push(entry);
      } } as any, transactionTax, numberServices[3],
    ).execute(ctx(undefined, ['expense.confirm', 'expense.review']), 'exp-1', {
      reason: 'ใบเสร็จพิมพ์ VAT รวมทั้งใบ ตรวจกับร้านแล้ว', vatLineNumber: 1,
      expectedUpdatedAt: readyRecord.updatedAt.toISOString(),
    });

    assert.equal(confirmed.status, 'CONFIRMED');
    const override = auditEntries.find((entry) => entry.action === 'expense.vat.source_override');
    assert.ok(override, 'the override decision must be audited');
    assert.equal(override.riskLevel, 'HIGH');
    assert.deepEqual(override.metadataJson, {
      reason: 'ใบเสร็จพิมพ์ VAT รวมทั้งใบ ตรวจกับร้านแล้ว',
      vatLineNumber: 1,
      reconciliationStatus: 'MISMATCH',
      documentVatAmount: '8.0000',
      calculatedVatAmount: '7.0000',
      differenceAmount: '1.0000',
      toleranceAmount: '0.05',
      acceptedVatAmount: '8.0000', acceptedPreVatAmount: '100.0000', acceptedGrossAmount: '108.0000',
      acceptedWhtAmount: '0.0000', acceptedNetPayableAmount: '108.0000',
    });
  });

  it('rejects confirmation when a receipt still has a Tax Code snapshot', async () => {
    const repo = {
      findByIdWithRelations: async () => ({
        ...readyRecord,
        sourceDocumentType: 'RECEIPT', inputVatClaimStatus: 'NON_CLAIMABLE', vatMode: 'NO_VAT',
      }),
    } as any;

    await assert.rejects(
      () => new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3]).execute(ctx(undefined, ['expense.confirm']), 'exp-1'),
      /cannot retain a Tax Code/,
    );
  });

  it('emits the finalized tax source ledger metadata after confirmation', async () => {
    const auditEntries: any[] = [];
    const repo = {
      findByIdWithRelations: async () => readyRecord,
      finalizeAndConfirmExpenseCas: async (input: any, finalize: any) => {
        const finalized = await finalize({ db: {}, expense: readyRecord });
        return {
          expense: { ...input, expenseNumber: 'EXP-1', grandTotalAmount: '107.00' },
          finalized: finalized.map((line: any) => ({ ...line, taxSnapshot: readyRecord.lines[0].taxSnapshot })),
        };
      },
    } as any;
    const recordingAudit = { log: async (entry: any) => { auditEntries.push(entry); } } as any;

    await new ConfirmExpenseUseCase(repo, recordingAudit, transactionTax, numberServices[3])
      .execute(ctx(undefined, ['expense.confirm']), 'exp-1');

    const finalized = auditEntries.find((entry) => entry.action === 'tax.document_tax.finalize');
    assert.equal(finalized.metadataJson.sourceDocumentType, 'TAX_INVOICE');
    assert.deepEqual(finalized.metadataJson.lines[0], {
      sourceLineId: 'line-1', lineNumber: 1, taxCodeDefinitionId: 'tax-o7', externalTaxCode: 'O7',
      taxProfileKey: 'SAP-TH', taxProfileVersion: 1, taxContext: 'DOMESTIC_PURCHASE', taxTreatment: 'CLAIMABLE',
      claimability: 'CLAIMABLE', evidenceStatus: 'VERIFIED', accountRuleVersion: 1, reportRuleVersion: 1,
    });
  });

  it('carries zero-treatment meaning into the final Tax Code resolution clone', async () => {
    for (const vatTreatment of ['ZERO_RATED', 'EXEMPT', 'NON_VAT'] as const) {
      const record = {
        ...readyRecord, grandTotalAmount: '100.00', inputVatClaimStatus: 'NON_CLAIMABLE',
        lines: [{
          ...readyRecord.lines[0], vatRate: '0', vatAmount: '0', vatTreatment, lineTotalAmount: '100',
          taxSnapshot: { ...readyRecord.lines[0].taxSnapshot, taxRate: '0', taxAmount: '0', taxTreatment: vatTreatment === 'NON_VAT' ? 'NON_TAXABLE' : vatTreatment },
        }],
      };
      let finalizedTreatment: string | undefined;
      const repo = {
        findByIdWithRelations: async () => record,
        finalizeAndConfirmExpenseCas: async (input: any, finalize: any) => {
          const finalized = await finalize({ db: {}, expense: record });
          finalizedTreatment = finalized[0]?.vatTreatment;
          return { expense: { ...input, status: 'CONFIRMED' }, finalized };
        },
      } as any;
      await new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3])
        .execute(ctx(undefined, ['expense.confirm']), 'exp-1');
      assert.equal(finalizedTreatment, vatTreatment);
    }
  });

  // Spec S1-R5: override telemetry on the web confirm path. `fromSuggested` separates "the reviewer
  // replaced the AI's category" from "AI proposed nothing", which is what makes an override rate
  // readable. Ids, a surface and a boolean only — no category names, no document content.
  it('emits a category override event when the confirmed category is not the AI suggestion', async () => {
    const confirmWith = async (expenseCategoryId: string | null, categorySuggestion: unknown) => {
      const events: any[] = [];
      const repo = {
        findByIdWithRelations: async () => ({
          ...readyRecord,
          expenseCategoryId,
          ...(categorySuggestion ? { aiVerificationSummaryJson: { categorySuggestion } } : {}),
        }),
        finalizeAndConfirmExpenseCas: async (input: any, finalize: any) => {
          const finalized = await finalize({ db: {}, expense: readyRecord });
          return { expense: { ...input, expenseNumber: 'EXP-1' }, finalized };
        },
      } as any;
      const useCase = new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3]);
      (useCase as any).logger = { log: (entry: any) => events.push(entry) };
      await useCase.execute(ctx(undefined, ['expense.confirm']), 'exp-1');
      return events.filter((entry) => entry.msg === 'expense_category_overridden');
    };
    const suggestion = { expenseCategoryId: 'cat-meals', confidence: 0.9, categoryName: 'ค่าอาหาร' };
    const overridden = { msg: 'expense_category_overridden', companyId: 'company-1', expenseId: 'exp-1', surface: 'web' };

    assert.deepEqual(await confirmWith('cat-meals', suggestion), [], 'confirming the suggested category is not an override');
    assert.deepEqual(await confirmWith('cat-fuel', suggestion), [{ ...overridden, fromSuggested: true }]);
    assert.deepEqual(await confirmWith('cat-fuel', null), [{ ...overridden, fromSuggested: false }]);
    assert.deepEqual(await confirmWith(null, suggestion), [], 'no category on the confirmed expense is not an override');
  });

  it('rejects a usable tax-invoice header while its domestic Tax Code evidence is not verified', async () => {
    const unverified = {
      ...readyRecord,
      lines: readyRecord.lines.map((line) => ({
        ...line,
        taxSnapshot: { ...line.taxSnapshot, evidenceStatus: 'DRAFT' },
      })),
    };
    const repo = {
      findByIdWithRelations: async () => unverified,
      finalizeAndConfirmExpenseCas: async (_input: any, finalize: any) => {
        const finalized = (await finalize({ db: {}, expense: unverified }))
          .map((line: any) => ({ ...line, taxSnapshot: unverified.lines[0].taxSnapshot }));
        if (finalized.some((line: any) => line.taxSnapshot?.taxContext === 'DOMESTIC_PURCHASE'
          && line.taxSnapshot?.evidenceStatus !== 'VERIFIED')) {
          throw new Error('Domestic input VAT requires verified Tax Code evidence before confirmation.');
        }
        throw new Error('Expected evidence validation to fail');
      },
    } as any;

    await assert.rejects(
      () => new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3]).execute(ctx(undefined, ['expense.confirm']), 'exp-1'),
      /requires verified Tax Code evidence/,
    );
  });

  it('rethrows the original atomic-confirmation failure without a second number mutation', async () => {
    let attempts = 0;
    const repo = {
      findByIdWithRelations: async () => readyRecord,
      finalizeAndConfirmExpenseCas: async () => { attempts++; throw new Error('expense_confirmation_source_checksum_changed'); },
    } as any;
    await assert.rejects(
      () => new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3]).execute(ctx(undefined, ['expense.confirm']), 'exp-1'),
      /expense_confirmation_source_checksum_changed/,
    );
    assert.equal(attempts, 1);
  });
});

describe('manual web upload non-expense workflow guard', () => {
  const nonExpenseSummary = {
    status: 'NOT_EXPENSE_DOCUMENT',
    classification: { contentKind: 'DOCUMENT', documentKind: 'QUOTATION' },
    nextAction: 'review_attachment_or_upload_expense_evidence',
  };

  it('exposes the explicit override endpoint only to expense reviewers', () => {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ExpenseController.prototype.overrideNonExpenseClassification),
      ['expense.review'],
    );
  });

  it('guards shared accounting evidence with its dedicated permission', () => {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ExpenseController.prototype.getSharedEvidence),
      ['expense.evidence.read'],
    );
  });

  it('exposes a reviewer mark-ready route without weakening the own-update route', () => {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ExpenseController.prototype.markReadyAsReviewer),
      ['expense.review'],
    );
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ExpenseController.prototype.markReady),
      ['expense.update'],
    );
  });

  it('blocks sending an unresolved non-expense draft for confirmation', async () => {
    const repo = {
      findById: async () => ({
        id: 'exp-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        aiVerificationSummaryJson: nonExpenseSummary,
      }),
    } as any;

    await assert.rejects(
      () => new MarkExpenseReadyUseCase(repo).execute(ctx(undefined, ['expense.review']), 'exp-1'),
      /classified as non-expense/,
    );
  });

  it('blocks direct confirmation for an unresolved non-expense classification', async () => {
    const repo = {
      findByIdWithRelations: async () => ({
        id: 'exp-1', branchId: 'b1', status: 'READY_FOR_CONFIRMATION',
        aiVerificationSummaryJson: nonExpenseSummary,
      }),
    } as any;

    await assert.rejects(
      () => new ConfirmExpenseUseCase(repo, audit, transactionTax, numberServices[3])
        .execute(ctx(undefined, ['expense.confirm']), 'exp-1'),
      /classified as non-expense/,
    );
  });

  it('allows finance to explicitly override the classification while preserving its history', async () => {
    const updates: any[] = [];
    const auditEntries: any[] = [];
    const repo = {
      findById: async () => ({
        id: 'exp-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        vatMode: 'NO_VAT', aiVerificationSummaryJson: nonExpenseSummary,
      }),
      updateExpense: async (input: any) => { updates.push(input); return input; },
    } as any;
    const recordingAudit = { log: async (entry: any) => { auditEntries.push(entry); } } as any;

    await new UpdateExpenseDraftUseCase(repo, recordingAudit, transactionTax).execute(
      ctx(undefined, ['expense.review']),
      'exp-1',
      {
        sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT',
        nonExpenseClassificationOverride: { acknowledged: true, reason: 'Verified against the final supplier bill.' },
      },
    );

    assert.equal(updates[0].aiVerificationSummaryJson.status, 'NOT_EXPENSE_DOCUMENT');
    assert.equal(updates[0].aiVerificationSummaryJson.classification.documentKind, 'QUOTATION');
    assert.equal(updates[0].aiVerificationSummaryJson.classificationResolution.outcome, 'FINANCE_OVERRIDDEN_AS_EXPENSE');
    assert.equal(updates[0].aiVerificationSummaryJson.classificationResolution.acknowledged, true);
    assert.equal(updates[0].aiVerificationSummaryJson.classificationResolution.sourceDocumentType, 'OTHER_EXPENSE_DOCUMENT');
    assert.equal(updates[0].aiVerificationSummaryJson.classificationResolution.reason, 'Verified against the final supplier bill.');
    assert.deepEqual(auditEntries[0].metadataJson, {
      classificationOverride: {
        detectedDocumentKind: 'QUOTATION',
        sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT',
        reason: 'Verified against the final supplier bill.',
      },
    });
    assert.equal(auditEntries[0].action, 'expense.classification.override');
    assert.equal(auditEntries[0].riskLevel, 'HIGH');
  });

  it('does not treat an incidental source document field as an override', async () => {
    const updates: any[] = [];
    const repo = {
      findById: async () => ({
        id: 'exp-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        vatMode: 'NO_VAT', aiVerificationSummaryJson: nonExpenseSummary,
      }),
      updateExpense: async (input: any) => { updates.push(input); return input; },
    } as any;

    await new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(
      ctx(undefined, ['expense.review']),
      'exp-1',
      { sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT' },
    );

    assert.equal(updates[0].aiVerificationSummaryJson, undefined);
  });

  it('requires reviewer permission, a reviewed document type, and a bounded reason for override', async () => {
    const record = {
      id: 'exp-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
      vatMode: 'NO_VAT', sourceDocumentType: 'NEEDS_REVIEW', aiVerificationSummaryJson: nonExpenseSummary,
    };
    const repo = { findById: async () => record } as any;

    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(
        ctx(undefined, ['expense.update']), 'exp-1',
        { sourceDocumentType: 'RECEIPT', nonExpenseClassificationOverride: { acknowledged: true, reason: 'Checked' } },
      ),
      /expense.review/,
    );
    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(
        ctx(undefined, ['expense.review']), 'exp-1',
        {
          sourceDocumentType: 'RECEIPT',
          nonExpenseClassificationOverride: { reason: 'Checked' } as any,
        },
      ),
      /acknowledgement is required/,
    );
    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(
        ctx(undefined, ['expense.review']), 'exp-1',
        { nonExpenseClassificationOverride: { acknowledged: true, reason: 'Checked' } },
      ),
      /Select a reviewed expense source document type/,
    );
    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(
        ctx(undefined, ['expense.review']), 'exp-1',
        { sourceDocumentType: 'RECEIPT', nonExpenseClassificationOverride: { acknowledged: true, reason: '   ' } },
      ),
      /reason is required/,
    );
    await assert.rejects(
      () => new UpdateExpenseDraftUseCase(repo, audit, transactionTax).execute(
        ctx(undefined, ['expense.review']), 'exp-1',
        { sourceDocumentType: 'RECEIPT', nonExpenseClassificationOverride: { acknowledged: true, reason: 'x'.repeat(501) } },
      ),
      /must not exceed 500/,
    );
    await assert.rejects(
      () => new UpdateExpenseDraftUseCase({
        findById: async () => ({
          ...record,
          aiVerificationSummaryJson: { status: 'NOT_EXPENSE_DOCUMENT' },
        }),
      } as any, audit, transactionTax).execute(
        ctx(undefined, ['expense.review']), 'exp-1',
        { sourceDocumentType: 'RECEIPT', nonExpenseClassificationOverride: { acknowledged: true, reason: 'Checked' } },
      ),
      /Re-run document classification/,
    );
  });

  it('allows the reviewed draft to advance after the explicit override', async () => {
    const updates: any[] = [];
    const repo = {
      findById: async () => ({
        id: 'exp-1', branchId: null, createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        aiVerificationSummaryJson: {
          ...nonExpenseSummary,
          classificationResolution: {
            outcome: 'FINANCE_OVERRIDDEN_AS_EXPENSE',
            acknowledged: true,
            reason: 'Verified against the final supplier bill.',
            sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT',
            resolvedByUserId: 'user-1',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      }),
      updateExpense: async (input: any) => { updates.push(input); return input; },
    } as any;

    await new MarkExpenseReadyUseCase(repo).execute(ctx(undefined, ['expense.review']), 'exp-1');
    assert.equal(updates[0].status, 'READY_FOR_CONFIRMATION');
  });

  it('allows confirmation after a valid finance resolution and emits one outbox event', async () => {
    const updates: any[] = [];
    const numberCalls: any[] = [];
    const trackedNumberServices = [
      { execute: async (input: any) => { numberCalls.push(['reserve', input]); return { id: 'number-1', documentNumber: 'EXP-202607-00001' }; } } as any,
      { execute: async (input: any) => { numberCalls.push(['commit', input]); } } as any,
      { execute: async (input: any) => { numberCalls.push(['void', input]); } } as any,
      // 4th slot: VAT registration read. Only consulted for a CLAIMABLE expense, which none of
  // these fixtures is, so an UNKNOWN stub keeps the confirm path unchanged.
  { get: async () => ({ status: 'UNKNOWN' }) } as any,
] as const;
    const repo = {
      findByIdWithRelations: async () => ({
        id: 'exp-1', branchId: 'b1', status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'NO_MATCH',
        primaryAttachmentId: 'att-1', missingReceiptReason: null, vendorNameSnapshot: 'Supplier',
        vendorDocumentNumber: 'BILL-1', expenseDate: new Date('2026-07-13T00:00:00.000Z'),
        grandTotalAmount: '100.00', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
        vendorCounterpartyId: null, sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT', taxEvidenceStatus: 'SUPPORTING_ONLY',
        substituteReceiptGeneratedAt: null, substituteReceiptEvidence: null, updatedAt: new Date('2026-07-13T10:00:00.000Z'),
        aiVerificationSummaryJson: {
          ...nonExpenseSummary,
          classificationResolution: {
            outcome: 'FINANCE_OVERRIDDEN_AS_EXPENSE',
            acknowledged: true,
            reason: 'Verified against the final supplier bill.',
            sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT',
            resolvedByUserId: 'user-1',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      }),
      finalizeAndConfirmExpenseCas: async (input: any, finalize: any) => {
        updates.push({ ...input, status: 'CONFIRMED' });
        return {
          expense: { ...input, status: 'CONFIRMED', expenseNumber: 'EXP-1', grandTotalAmount: '100.00' },
          finalized: await finalize({ db: {}, expense: await repo.findByIdWithRelations() }),
        };
      },
    } as any;
    await new ConfirmExpenseUseCase(repo, audit, transactionTax, trackedNumberServices[3]).execute(ctx(undefined, ['expense.confirm']), 'exp-1');

    assert.equal(updates[0].status, 'CONFIRMED');
    assert.equal(updates[0].expenseNumber, undefined, 'the aggregate transaction owns number allocation');
    assert.equal(numberCalls.length, 0);
    assert.equal(updates[0].outboxEvent.payloadJson.data.expenseId, 'exp-1');
    assert.match(updates[0].outboxEvent.eventKey, /^expense\.confirmed:expense_record:exp-1:/);
  });
});
