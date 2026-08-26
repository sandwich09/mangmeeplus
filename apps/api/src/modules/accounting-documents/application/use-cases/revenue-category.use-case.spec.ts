import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CreateRevenueCategoryUseCase,
  ListAllRevenueCategoriesUseCase,
  ListRevenueCategoriesUseCase,
  UpdateRevenueCategoryUseCase,
} from './revenue-category.use-case';

const manageCtx = {
  requestId: 'request-1', authSubject: 'subject-1', userId: 'admin-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: [], permissions: ['accounting.revenue_category.manage'], scopes: {}, authProvider: 'dev',
} as any;
const readOnlyCtx = { ...manageCtx, permissions: ['accounting.document.read'] } as any;

const CATEGORY = {
  id: 'cat-1', companyId: 'company-1', name: 'ขายสินค้า', accountHintKey: 'revenue.goods',
  defaultOutputTaxCode: null, status: 'ACTIVE', sortOrder: 1,
};

function auditStub() {
  return { log: mock.fn(async () => undefined) } as any;
}

describe('ListRevenueCategoriesUseCase', () => {
  it('returns the company-scoped active list for pickers', async () => {
    const repo = { listRevenueCategories: mock.fn(async () => [CATEGORY]) } as any;
    const result = await new ListRevenueCategoriesUseCase(repo).execute(readOnlyCtx);
    assert.deepEqual(result, [CATEGORY]);
    assert.equal(repo.listRevenueCategories.mock.calls[0].arguments[0], 'company-1');
  });
});

describe('ListAllRevenueCategoriesUseCase', () => {
  it('refuses without the manage permission', async () => {
    const repo = { listAllRevenueCategories: mock.fn(async () => []) } as any;
    await assert.rejects(new ListAllRevenueCategoriesUseCase(repo).execute(readOnlyCtx), ForbiddenException);
    assert.equal(repo.listAllRevenueCategories.mock.callCount(), 0);
  });

  it('returns archived rows too for the management view', async () => {
    const archived = { ...CATEGORY, id: 'cat-2', name: 'เก่า', status: 'ARCHIVED' };
    const repo = { listAllRevenueCategories: mock.fn(async () => [CATEGORY, archived]) } as any;
    const result = await new ListAllRevenueCategoriesUseCase(repo).execute(manageCtx);
    assert.equal(result.length, 2);
  });
});

describe('CreateRevenueCategoryUseCase', () => {
  it('refuses without the manage permission', async () => {
    const repo = { createRevenueCategory: mock.fn() } as any;
    await assert.rejects(
      new CreateRevenueCategoryUseCase(repo, auditStub()).execute(readOnlyCtx, { name: 'x', accountHintKey: 'revenue.other' }),
      ForbiddenException,
    );
    assert.equal(repo.createRevenueCategory.mock.callCount(), 0);
  });

  it('requires a non-blank name and hint key', async () => {
    const repo = { createRevenueCategory: mock.fn() } as any;
    const useCase = new CreateRevenueCategoryUseCase(repo, auditStub());
    await assert.rejects(useCase.execute(manageCtx, { name: '   ', accountHintKey: 'revenue.other' }), BadRequestException);
    await assert.rejects(useCase.execute(manageCtx, { name: 'ขายของ', accountHintKey: '  ' }), BadRequestException);
  });

  it('trims the name, creates, and writes a MEDIUM audit row', async () => {
    const audit = auditStub();
    const repo = { createRevenueCategory: mock.fn(async (_companyId: string, input: any) => ({ ...CATEGORY, name: input.name })) } as any;
    const result = await new CreateRevenueCategoryUseCase(repo, audit).execute(manageCtx, { name: '  ขายสินค้า ', accountHintKey: 'revenue.goods' });
    assert.equal(result.name, 'ขายสินค้า');
    assert.equal(repo.createRevenueCategory.mock.calls[0].arguments[1].name, 'ขายสินค้า');
    const entry = audit.log.mock.calls[0].arguments[0];
    assert.equal(entry.action, 'accounting.revenue_category.create');
    assert.equal(entry.riskLevel, 'MEDIUM');
  });

  it('maps the unique-name violation to 409', async () => {
    const repo = { createRevenueCategory: mock.fn(async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }); }) } as any;
    await assert.rejects(
      new CreateRevenueCategoryUseCase(repo, auditStub()).execute(manageCtx, { name: 'ขายสินค้า', accountHintKey: 'revenue.goods' }),
      ConflictException,
    );
  });
});

describe('UpdateRevenueCategoryUseCase', () => {
  it('refuses without the manage permission', async () => {
    const repo = { findRevenueCategoryById: mock.fn() } as any;
    await assert.rejects(
      new UpdateRevenueCategoryUseCase(repo, auditStub()).execute(readOnlyCtx, 'cat-1', { name: 'ใหม่' }),
      ForbiddenException,
    );
  });

  it('404s when the category does not belong to the company', async () => {
    const repo = { findRevenueCategoryById: mock.fn(async () => null), updateRevenueCategory: mock.fn() } as any;
    await assert.rejects(
      new UpdateRevenueCategoryUseCase(repo, auditStub()).execute(manageCtx, 'cat-other', { name: 'ใหม่' }),
      NotFoundException,
    );
    assert.equal(repo.updateRevenueCategory.mock.callCount(), 0);
  });

  it('archives (never deletes) and audits the status change', async () => {
    const audit = auditStub();
    const repo = {
      findRevenueCategoryById: mock.fn(async () => CATEGORY),
      updateRevenueCategory: mock.fn(async (_companyId: string, _id: string, input: any) => ({ ...CATEGORY, ...input })),
    } as any;
    const result = await new UpdateRevenueCategoryUseCase(repo, audit).execute(manageCtx, 'cat-1', { status: 'ARCHIVED' });
    assert.equal(result.status, 'ARCHIVED');
    const entry = audit.log.mock.calls[0].arguments[0];
    assert.equal(entry.action, 'accounting.revenue_category.update');
    assert.equal(entry.metadataJson.status, 'ARCHIVED');
  });

  it('rejects a blank rename', async () => {
    const repo = { findRevenueCategoryById: mock.fn(async () => CATEGORY), updateRevenueCategory: mock.fn() } as any;
    await assert.rejects(
      new UpdateRevenueCategoryUseCase(repo, auditStub()).execute(manageCtx, 'cat-1', { name: '   ' }),
      BadRequestException,
    );
  });
});
