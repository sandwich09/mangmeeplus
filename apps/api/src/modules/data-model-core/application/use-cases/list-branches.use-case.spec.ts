import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { REQUIRED_ANY_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { BranchController } from '../../presentation/http/branch.controller';
import { ListBranchesUseCase } from './list-branches.use-case';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

const makeCtx = (permissions: string[] = []): RequestContext => ({
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: [],
  permissions,
  scopes: {},
  authProvider: 'dev',
});

const makeRepo = (items: any[] = []) => ({
  list: mock.fn(async () => ({ items, total: items.length, page: 1, pageSize: 20 })),
  create: mock.fn(async () => { throw new Error('not used'); }),
  update: mock.fn(async () => { throw new Error('not used'); }),
  findById: mock.fn(async () => null),
  countActiveHeadOffice: mock.fn(async () => 0),
});

describe('ListBranchesUseCase', () => {
  it('throws ForbiddenException when ctx lacks company.branch.read', async () => {
    const repo = makeRepo();
    const uc = new ListBranchesUseCase(repo as any);
    await assert.rejects(() => uc.execute(makeCtx([]), {}), ForbiddenException);
  });

  it('calls list with companyId from ctx (not caller-supplied)', async () => {
    const repo = makeRepo();
    const uc = new ListBranchesUseCase(repo as any);
    await uc.execute(makeCtx(['company.branch.read']), { status: 'ACTIVE' });
    assert.equal(((repo.list.mock.calls as any[])[0]?.arguments[0] as any).companyId, 'co-1');
  });
});

it('legacy branch managers may read branches in their company, while unrelated rights cannot', async () => {
  assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, BranchController.prototype.list), ['company.branch.read', 'company.branch.manage']);
  const repo = makeRepo();
  const useCase = new ListBranchesUseCase(repo as any);
  await useCase.execute(makeCtx(['company.branch.manage']), {});
  assert.equal((repo.list.mock.calls[0]!.arguments as any[])[0].companyId, 'co-1');
  await assert.rejects(() => useCase.execute(makeCtx(['company.setup.read']), {}), ForbiddenException);
});
