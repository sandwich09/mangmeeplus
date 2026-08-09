import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreateManualJournalUseCase, PostJournalUseCase } from './journal.use-case';
import { validateJournalBalance } from '../../domain/logic/journal-balance.logic';

const ctx = (branchIds?: string[]) => ({
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1', membershipId: 'member-1',
  roles: ['ACCOUNTANT'], permissions: ['journal.entry.create', 'journal.entry.post'], scopes: { branchIds }, authProvider: 'watchdog',
}) as any;

const account = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, companyId: 'company-1', code: id, nameTh: id, nameEn: null, accountClass: 'ASSET', reportGroup: null,
  normalBalance: 'DEBIT', parentAccountId: null, isPosting: true, isSystem: false, isControlled: false,
  taxCategory: null, cashFlowCategory: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...overrides,
});

const input = (lines: any[]) => ({ entryDate: '2026-07-18', memo: 'manual adjustment', lines });
const balancedLines = (creditAccountId = 'credit', branchId?: string) => [
  { accountId: 'debit', branchId, debitAmount: '100.00' },
  { accountId: creditAccountId, branchId, creditAmount: '100.00' },
];

function entry(lines: any[] = balancedLines()) {
  const now = new Date('2026-07-18T00:00:00.000Z');
  return {
    id: 'journal-1', companyId: 'company-1', periodId: 'period-1', entryNumber: 'JV-1', entryType: 'MANUAL',
    sourceType: null, sourceId: null, reversalOfJournalEntryId: null, status: 'DRAFT', entryDate: now,
    postedAt: null, postedByUserId: null, memo: 'manual adjustment', createdByUserId: 'user-1',
    createdAt: now, updatedAt: now,
    lines: lines.map((line, index) => ({
      id: `line-${index + 1}`, companyId: 'company-1', journalEntryId: 'journal-1', lineNumber: index + 1,
      description: null, debitAmount: '0', creditAmount: '0', currency: 'THB', sourceType: null, sourceId: null,
      taxCode: null, branchId: null, createdAt: now, ...line,
    })),
  } as any;
}

function repo(overrides: Record<string, unknown> = {}) {
  return {
    findAccountById: async (id: string) => account(id),
    findBranchById: async (id: string) => ({ id, companyId: 'company-1', status: 'ACTIVE' }),
    findPeriod: async () => ({ id: 'period-1', companyId: 'company-1', periodKey: '2026-07', status: 'OPEN' }),
    findPeriodById: async () => ({ id: 'period-1', companyId: 'company-1', periodKey: '2026-07', status: 'OPEN' }),
    createJournalEntry: async (value: any) => entry(value.lines),
    findJournalById: async () => entry(),
    getJournalLines: async () => entry().lines,
    postJournalEntry: async () => ({ ...entry(), status: 'POSTED', postedAt: new Date() }),
    ...overrides,
  } as any;
}

const audit = { log: async () => undefined } as any;
const reserve = { execute: async () => ({ id: 'reservation-1', documentNumber: 'JV-1' }) } as any;
const commit = { execute: async () => undefined } as any;
const outbox = { append: async () => undefined } as any;

describe('CreateManualJournalUseCase H-03 invariants', () => {
  it('rejects an arithmetic-balanced cross-tenant split so the tenant report cannot become half-entry', async () => {
    const lines = balancedLines('foreign-credit');
    assert.equal(validateJournalBalance(lines).isBalanced, true);
    const useCase = new CreateManualJournalUseCase(repo({
      findAccountById: async (id: string) => account(id, id === 'foreign-credit' ? { companyId: 'company-2' } : {}),
    }), audit, reserve, commit);
    await assert.rejects(() => useCase.execute(ctx(), input(lines)), BadRequestException);
  });

  it('rejects an out-of-scope branch even when the branch belongs to the company', async () => {
    const useCase = new CreateManualJournalUseCase(repo(), audit, reserve, commit);
    await assert.rejects(() => useCase.execute(ctx(['branch-allowed']), input(balancedLines('credit', 'branch-forbidden'))), ForbiddenException);
  });

  it('requires active posting accounts', async () => {
    for (const invalid of [{ status: 'INACTIVE' }, { isPosting: false }]) {
      const useCase = new CreateManualJournalUseCase(repo({ findAccountById: async (id: string) => account(id, id === 'credit' ? invalid : {}) }), audit, reserve, commit);
      await assert.rejects(() => useCase.execute(ctx(), input(balancedLines())), BadRequestException);
    }
  });

  it('allows an approved global system account and strips caller provenance/tax metadata', async () => {
    let persisted: any;
    const useCase = new CreateManualJournalUseCase(repo({
      findAccountById: async (id: string) => account(id, id === 'credit' ? { companyId: null, isSystem: true } : {}),
      createJournalEntry: async (value: any) => { persisted = value; return entry(value.lines); },
    }), audit, reserve, commit);
    await useCase.execute(ctx(), input([
      { accountId: 'debit', debitAmount: '100', sourceType: 'forged', taxCode: 'VAT7', taxSnapshot: { taxAmount: '7' } },
      { accountId: 'credit', creditAmount: '100', sourceId: 'forged', reportContributions: [{ report: 'VAT' }] },
    ] as any));
    assert.deepEqual(persisted.lines, [
      { accountId: 'debit', branchId: undefined, description: undefined, debitAmount: '100', creditAmount: undefined, currency: undefined },
      { accountId: 'credit', branchId: undefined, description: undefined, debitAmount: undefined, creditAmount: '100', currency: undefined },
    ]);
  });

  it('uses the Bangkok civil day consistently for period creation and @db.Date persistence', async () => {
    let upserted: any;
    let persisted: any;
    const useCase = new CreateManualJournalUseCase(repo({
      findPeriod: async () => null,
      upsertPeriod: async (_companyId: string, periodKey: string, start: Date, end: Date) => {
        upserted = { periodKey, start, end };
        return { id: 'period-1', companyId: 'company-1', periodKey, status: 'OPEN' };
      },
      createJournalEntry: async (value: any) => { persisted = value; return entry(value.lines); },
    }), audit, reserve, commit);

    await useCase.execute(ctx(), { ...input(balancedLines()), entryDate: '2026-08-31T19:00:00.000Z' });

    assert.deepEqual(upserted, {
      periodKey: '2026-09',
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-09-30T00:00:00.000Z'),
    });
    assert.equal(persisted.entryDate.toISOString(), '2026-09-01T00:00:00.000Z');
  });
});

describe('PostJournalUseCase H-03 invariants', () => {
  it('re-resolves accounts and rejects an arithmetic-balanced legacy cross-tenant draft', async () => {
    const lines = entry(balancedLines('foreign-credit')).lines;
    assert.equal(validateJournalBalance(lines).isBalanced, true);
    let posted = false;
    const useCase = new PostJournalUseCase(repo({
      getJournalLines: async () => lines,
      findAccountById: async (id: string) => account(id, id === 'foreign-credit' ? { companyId: 'company-2' } : {}),
      postJournalEntry: async () => { posted = true; return entry(); },
    }), audit, outbox);
    await assert.rejects(() => useCase.execute(ctx(), 'journal-1'), BadRequestException);
    assert.equal(posted, false);
  });

  it('re-checks branch scope before posting a draft', async () => {
    const lines = entry(balancedLines('credit', 'branch-forbidden')).lines;
    const useCase = new PostJournalUseCase(repo({ getJournalLines: async () => lines }), audit, outbox);
    await assert.rejects(() => useCase.execute(ctx(['branch-allowed']), 'journal-1'), ForbiddenException);
  });

  it('rejects stored caller provenance/tax metadata before posting', async () => {
    const lines = entry(balancedLines()).lines;
    lines[0].sourceType = 'forged.source';
    const useCase = new PostJournalUseCase(repo({ getJournalLines: async () => lines }), audit, outbox);
    await assert.rejects(() => useCase.execute(ctx(), 'journal-1'), (error: unknown) => {
      assert.equal(((error as BadRequestException).getResponse() as any).code, 'manual_journal_provenance_forbidden');
      return true;
    });
  });
});
