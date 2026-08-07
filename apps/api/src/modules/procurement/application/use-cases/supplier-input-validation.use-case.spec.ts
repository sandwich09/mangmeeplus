import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreateSupplierUseCase, UpdateSupplierUseCase } from './supplier.use-case';

// The procurement controllers take `@Body() body: any`, so nothing validated
// these Prisma enum columns at the boundary: an unknown value reached the
// insert and came back as a 500. Live UAT reproduction: supplierType "COMPANY".

const ctx: any = { companyId: 'co_1', userId: 'u1', requestId: 'req_1', permissions: ['procurement.supplier.manage'] };

function fixture() {
  const created: any[] = [];
  const repo: any = {
    createSupplierWithCounterparty: mock.fn(async (_co: string, data: any) => {
      created.push(data);
      return { id: 'sup_1', companyId: 'co_1', counterpartyId: 'cp_1', displayNameSnapshot: data.displayName, supplierType: data.supplierType ?? 'JURISTIC_PERSON', status: 'ACTIVE', defaultCurrency: 'THB', createdAt: new Date(), updatedAt: new Date() };
    }),
    updateSupplier: mock.fn(async () => ({ id: 'sup_1', companyId: 'co_1', counterpartyId: 'cp_1', displayNameSnapshot: 'S', supplierType: 'JURISTIC_PERSON', status: 'ACTIVE', defaultCurrency: 'THB', createdAt: new Date(), updatedAt: new Date() })),
  };
  const audit: any = { log: mock.fn(async () => undefined) };
  const outbox: any = { append: mock.fn(async () => undefined) };
  return {
    create: new CreateSupplierUseCase(repo, audit, outbox),
    update: new UpdateSupplierUseCase(repo, audit, outbox),
    repo,
    get created() { return created; },
  };
}

describe('supplier input validation', () => {
  it('rejects an unknown supplierType with 400 instead of letting it reach the insert', async () => {
    const f = fixture();
    await assert.rejects(
      () => f.create.execute(ctx, { displayName: 'ACME', supplierType: 'COMPANY' } as any),
      (err: any) => err instanceof BadRequestException && /supplierType must be one of/.test(err.message),
    );
    assert.equal(f.repo.createSupplierWithCounterparty.mock.callCount(), 0);
  });

  it('rejects unknown values on the other three enum columns', async () => {
    for (const dto of [
      { displayName: 'ACME', status: 'DELETED' },
      { displayName: 'ACME', defaultVatMode: 'VAT_7' },
      { displayName: 'ACME', defaultInputVatClaimStatus: 'MAYBE' },
    ]) {
      const f = fixture();
      await assert.rejects(() => f.create.execute(ctx, dto as any), BadRequestException);
      assert.equal(f.repo.createSupplierWithCounterparty.mock.callCount(), 0);
    }
  });

  it('requires a display name', async () => {
    const f = fixture();
    await assert.rejects(() => f.create.execute(ctx, { displayName: '  ' } as any), BadRequestException);
  });

  it('accepts every documented enum value and omitted optionals', async () => {
    const f = fixture();
    for (const supplierType of ['JURISTIC_PERSON', 'INDIVIDUAL', 'FOREIGN', 'GOVERNMENT', 'OTHER']) {
      await f.create.execute(ctx, { displayName: 'ACME', supplierType } as any);
    }
    await f.create.execute(ctx, { displayName: 'ACME' } as any);
    await f.create.execute(ctx, { displayName: 'ACME', defaultVatMode: 'VAT_EXCLUDED', defaultInputVatClaimStatus: 'CLAIMABLE' } as any);
    assert.equal(f.created.length, 7);
  });

  it('validates the update path too', async () => {
    const f = fixture();
    await assert.rejects(() => f.update.execute(ctx, 'sup_1', { status: 'GONE' } as any), BadRequestException);
    assert.equal(f.repo.updateSupplier.mock.callCount(), 0);
    await f.update.execute(ctx, 'sup_1', { status: 'ARCHIVED' } as any);
    assert.equal(f.repo.updateSupplier.mock.callCount(), 1);
  });

  it('still checks permission before anything else', async () => {
    const f = fixture();
    await assert.rejects(() => f.create.execute({ ...ctx, permissions: [] }, { displayName: 'ACME', supplierType: 'COMPANY' } as any), ForbiddenException);
  });
});
