import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';
import { PrismaBranchRepository } from './prisma-branch.repository';

const row = {
  id: 'b-1', companyId: 'co-1', code: 'HQ', name: 'Head Office', type: 'HEAD_OFFICE',
  taxBranchCode: '00000', isVatEstablishment: true, status: 'ACTIVE',
  addressJson: null, phone: null, email: null, createdByUserId: null, updatedByUserId: null,
  createdAt: new Date(), updatedAt: new Date(),
};

function makeRepo() {
  const branch = {
    create: mock.fn(async ({ data }: any) => ({ ...row, ...data })),
    update: mock.fn(async ({ data }: any) => ({ ...row, ...data })),
  };
  return { repo: new PrismaBranchRepository({ client: { branch } } as any), branch };
}

describe('PrismaBranchRepository tax identity coupling', () => {
  it('persists a tax code as a VAT establishment and exposes the status', async () => {
    const { repo, branch } = makeRepo();
    const result = await repo.create({ companyId: 'co-1', code: 'HQ', name: 'Head Office', type: 'HEAD_OFFICE', taxBranchCode: '00000' });
    const data = (branch.create.mock.calls as any[])[0]?.arguments[0].data;
    assert.equal(data.isVatEstablishment, true);
    assert.equal(result.isVatEstablishment, true);
  });

  it('does not clear the coupling during an unrelated update', async () => {
    const { repo, branch } = makeRepo();
    await repo.update({ id: 'b-1', companyId: 'co-1', name: 'สำนักงานใหญ่' });
    const data = (branch.update.mock.calls as any[])[0]?.arguments[0].data;
    assert.equal('taxBranchCode' in data, false);
    assert.equal('isVatEstablishment' in data, false);
  });

  it('clears both fields only when the caller explicitly sends null', async () => {
    const { repo, branch } = makeRepo();
    await repo.update({ id: 'b-1', companyId: 'co-1', taxBranchCode: null });
    const data = (branch.update.mock.calls as any[])[0]?.arguments[0].data;
    assert.equal(data.taxBranchCode, null);
    assert.equal(data.isVatEstablishment, false);
  });
});
