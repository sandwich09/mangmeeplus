import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { ListPartnersUseCase } from './list-partners.use-case';
import { LookupUsersUseCase } from './lookup-users.use-case';

// Exercise query boundaries without reading customer business data.
test('company search and status constrain both count and paginated rows', async () => {
  let rows: any, count: any;
  const service = new ListPartnersUseCase({ client: { company: {
    findMany: async (args: any) => { rows = args; return []; },
    count: async (args: any) => { count = args; return 25; },
  } } } as any);
  const result = await service.execute({ q: '  ร้าน  ', status: 'SUSPENDED', page: 2, pageSize: 20 });
  assert.deepEqual(rows.where, count.where);
  assert.equal(rows.where.status, 'SUSPENDED');
  assert.deepEqual(rows.where.OR, [{ name: { contains: 'ร้าน', mode: 'insensitive' } }, { registeredName: { contains: 'ร้าน', mode: 'insensitive' } }, { id: 'ร้าน' }]);
  assert.equal(rows.skip, 20);
  assert.equal(rows.take, 20);
  assert.equal(result.total, 25);
  assert.deepEqual(rows.orderBy, [{ createdAt: 'desc' }, { id: 'asc' }]);
  // R-C6/R-C7 (purchase-without-setup): the row needs the full term shape to derive planState.
  assert.deepEqual(rows.select.planTerm.select, {
    tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true,
  });
  for (const query of [{ q: 'x'.repeat(121) }, { status: 'INVALID' }, { page: -1 }, { page: NaN }, { pageSize: 101 }, { page: 1.5 }, { page: Number.MAX_SAFE_INTEGER }, { q: ['invalid'] as any }]) {
    await assert.rejects(() => service.execute(query), UnprocessableEntityException);
  }
  await service.execute({});
  assert.deepEqual(rows.where, {});
});

test('a term-locked no_package shop reports planState/lockReason/tierKey/termEndsAt', async () => {
  const T = new Date('2026-09-20T00:00:00.000Z');
  const service = new ListPartnersUseCase({ client: { company: {
    findMany: async () => [{
      id: 'co-locked', name: 'Locked shop', registeredName: null, timezone: 'Asia/Bangkok', locale: 'th',
      status: 'DISABLED', createdAt: T, activatedAt: null, disabledAt: T, archivedAt: null,
      planTerm: { tierKey: 'FREE_TRIAL_15', termStartAt: T, termEndsAt: T, renewCount: 0, termDisabledAt: T },
      featureEntitlements: [], aiConfiguration: null, memberships: [],
    }],
    count: async () => 1,
  } } } as any);
  const result = await service.execute({});
  assert.equal(result.items[0]!.planState, 'NO_PACKAGE');
  assert.equal(result.items[0]!.lockReason, 'no_package');
  assert.equal(result.items[0]!.tierKey, 'FREE_TRIAL_15');
  assert.equal(result.items[0]!.termEndsAt, T.toISOString());
});

test('user status applies before the existing result cap and invalid status is rejected', async () => {
  let args: any;
  const service = new LookupUsersUseCase({ client: { user: { findMany: async (value: any) => { args = value; return []; } } } } as any);
  await service.execute('  สมชาย  ', 'DISABLED');
  assert.equal(args.where.status, 'DISABLED');
  assert.equal(args.take, 20);
  assert.equal(args.where.OR[2].displayName.contains, 'สมชาย');
  await assert.rejects(() => service.execute('สมชาย', 'ARCHIVED'), UnprocessableEntityException);
});
