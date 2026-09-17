import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { BillingAdminService } from './billing-admin.service';

function setup(platformScope: boolean) {
  const reads: any[] = [], counts: any[] = [];
  const service = new BillingAdminService({ client: { company: {
    findMany: async (args: any) => { reads.push(args); return []; },
    count: async (args: any) => { counts.push(args); return 51; },
  } } } as any, { stripe: { enabled: false } } as any);
  service.access = async () => ({ platformScope, companyIds: ['allowed-company'], capabilities: ['system.billing.read'], canManageScopes: false });
  return { service, reads, counts };
}

test('numeric pages and total use the same search and authorized company scope', async () => {
  for (const platformScope of [false, true]) {
    const { service, reads, counts } = setup(platformScope);
    const result = await service.overview({} as any, undefined, 'ร้าน', 2);
    assert.deepEqual(counts[0].where, reads[0].where);
    assert.deepEqual(reads[0].where.id, platformScope ? undefined : { in: ['allowed-company'] });
    assert.deepEqual(reads[0].where.OR, [{ id: { contains: 'ร้าน' } }, { name: { contains: 'ร้าน', mode: 'insensitive' } }]);
    assert.equal(reads[0].skip, 25);
    assert.equal(reads[0].take, 26);
    assert.deepEqual(result.pagination, { page: 2, pageSize: 25, total: 51 });
  }
});

test('legacy cursor clients do not incur a count or change their response shape', async () => {
  const { service, counts, reads } = setup(true);
  const result = await service.overview({} as any);
  assert.equal(result.pagination, undefined);
  assert.equal(reads[0].skip, undefined);
  assert.equal(counts.length, 0);
});

test('invalid numeric pages or mixing page and cursor are rejected before querying', async () => {
  const { service, reads, counts } = setup(true);
  for (const page of [0, -1, 1.5, NaN, Infinity, 1_000_001]) await assert.rejects(() => service.overview({} as any, undefined, '', page), BadRequestException);
  await assert.rejects(() => service.overview({} as any, 'cursor-id', '', 1), BadRequestException);
  assert.equal(reads.length + counts.length, 0);
});
