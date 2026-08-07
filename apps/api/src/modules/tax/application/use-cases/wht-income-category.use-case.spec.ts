import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SetWhtIncomeCategoryStatusUseCase } from './wht-income-category.use-case.js';

const ctx = (permissions: string[] = ['tax.config.manage']) =>
  ({ companyId: 'company-1', userId: 'accountant-1', requestId: 'request-1', permissions, scopes: {} }) as any;

function useCase(rows: Record<string, any>, audits: any[] = []) {
  const repo = {
    prisma: {
      client: {
        whtIncomeCategory: {
          findUnique: async ({ where }: any) => rows[where.code] ?? null,
          update: async ({ where, data }: any) => { rows[where.code] = { ...rows[where.code], ...data }; return rows[where.code]; },
        },
      },
    },
  } as any;
  return { subject: new SetWhtIncomeCategoryStatusUseCase(repo, { log: async (entry: any) => { audits.push(entry); } } as any), rows, audits };
}

const draft = () => ({ WHT_SERVICE_5: { code: 'WHT_SERVICE_5', nameTh: 'ค่าบริการ (นิติบุคคล)', formType: 'PND53', defaultRate: '3.0000', status: 'DRAFT' } });

describe('SetWhtIncomeCategoryStatusUseCase', () => {
  it('records the accountant vouching for a seeded rate', async () => {
    const { subject, rows, audits } = useCase(draft());
    const result = await subject.execute(ctx(), 'WHT_SERVICE_5', 'ACTIVE');
    assert.equal(result.status, 'ACTIVE');
    assert.equal(rows['WHT_SERVICE_5'].status, 'ACTIVE');
    // Activating vouches for a statutory rate every later certificate inherits, so it is audited.
    assert.equal(audits[0].action, 'tax.wht_income_category.set_status');
    assert.equal(audits[0].riskLevel, 'HIGH');
    assert.deepEqual({ from: audits[0].metadataJson.from, to: audits[0].metadataJson.to }, { from: 'DRAFT', to: 'ACTIVE' });
  });

  it('can retire a category without touching what was already withheld under it', async () => {
    const rows = draft();
    rows['WHT_SERVICE_5']!.status = 'ACTIVE';
    const { subject } = useCase(rows);
    assert.equal((await subject.execute(ctx(), 'WHT_SERVICE_5', 'DRAFT')).status, 'DRAFT');
  });

  it('refuses without the manage permission, on an unknown code, or on a status it does not own', async () => {
    const { subject } = useCase(draft());
    await assert.rejects(() => subject.execute(ctx(['tax.config.read']), 'WHT_SERVICE_5', 'ACTIVE'), /tax.config.manage/);
    await assert.rejects(() => subject.execute(ctx(), 'WHT_MADE_UP', 'ACTIVE'), /not found/);
    await assert.rejects(() => subject.execute(ctx(), 'WHT_SERVICE_5', 'ARCHIVED'), /status must be one of/);
  });
});
