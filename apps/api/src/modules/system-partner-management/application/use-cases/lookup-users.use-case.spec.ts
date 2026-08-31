import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnprocessableEntityException } from '@nestjs/common';
import { LookupUsersUseCase } from './lookup-users.use-case';
import { SystemUserLookupController } from '../../presentation/http/system-user-lookup.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import 'reflect-metadata';

// ponytail: unit-level; Prisma is a stub that records the args, because what this use case has to
// get right is the where/select it sends and the shape it maps back — not SQL.

const MERGED_AT = new Date('2026-08-30T03:00:00.000Z');

function userRow(over: Record<string, any> = {}) {
  return {
    id: 'user-1',
    displayName: 'สมชาย ใจดี',
    username: 'somchai.x',
    email: 'somchai@example.com',
    status: 'ACTIVE',
    externalIdentities: [{ id: 'ext-1' }],
    memberships: [
      {
        status: 'ACTIVE',
        company: { id: 'co-1', name: 'ร้านมั่งมี', status: 'ACTIVE' },
        roles: [{ role: { key: 'OWNER' } }, { role: { key: 'ADMIN' } }],
      },
    ],
    ...over,
  };
}

function makePrisma(opts: { users?: any[]; mergeRows?: any[] } = {}) {
  const userArgs: any[] = [];
  const auditArgs: any[] = [];
  const client = {
    user: {
      findMany: async (args: any) => {
        userArgs.push(args);
        return opts.users ?? [userRow()];
      },
    },
    auditLog: {
      findMany: async (args: any) => {
        auditArgs.push(args);
        return opts.mergeRows ?? [];
      },
    },
  };
  return { prisma: { client } as any, userArgs, auditArgs };
}

const run = (q: string | undefined, opts: Parameters<typeof makePrisma>[0] = {}) => {
  const ctx = makePrisma(opts);
  return { ...ctx, result: new LookupUsersUseCase(ctx.prisma).execute(q) };
};

describe('LookupUsersUseCase — query validation', () => {
  it('422s on a query shorter than 2 characters after trimming', async () => {
    const { result } = run(' a ');
    await assert.rejects(() => result, UnprocessableEntityException);
  });

  it('422s on an empty/absent query', async () => {
    await assert.rejects(() => run('').result, UnprocessableEntityException);
    await assert.rejects(() => run(undefined).result, UnprocessableEntityException);
  });

  it('422s above 120 characters, with a Thai message', async () => {
    await assert.rejects(
      () => run('x'.repeat(121)).result,
      (err: UnprocessableEntityException) => {
        assert.ok(String((err.getResponse() as any).message).includes('คำค้น'));
        return true;
      },
    );
  });

  it('trims the query before it reaches the database', async () => {
    const { userArgs, result } = run('  somchai  ');
    await result;
    assert.deepEqual(userArgs[0].where.OR[1], { username: 'somchai' });
  });
});

describe('LookupUsersUseCase — matching', () => {
  it('matches email exactly on the lowercased query, username exactly, and name by contains', async () => {
    const { userArgs, result } = run('Somchai@Example.com');
    await result;
    const or = userArgs[0].where.OR;
    assert.deepEqual(or[0], { email: 'somchai@example.com' });
    assert.deepEqual(or[1], { username: 'Somchai@Example.com' });
    assert.deepEqual(or[2], { displayName: { contains: 'Somchai@Example.com', mode: 'insensitive' } });
  });

  it('caps the result set at 20 rows and orders by displayName', async () => {
    const { userArgs, result } = run('สมชาย');
    await result;
    assert.equal(userArgs[0].take, 20);
    assert.deepEqual(userArgs[0].orderBy, { displayName: 'asc' });
  });

  it('returns an empty list and skips the audit read when nothing matches', async () => {
    const { auditArgs, result } = run('nobody', { users: [] });
    assert.deepEqual(await result, { items: [] });
    assert.equal(auditArgs.length, 0);
  });
});

describe('LookupUsersUseCase — response shape', () => {
  it('maps membership roles to raw role keys and reports the LINE link', async () => {
    const { result } = run('สมชาย');
    const [item] = (await result).items;
    assert.equal(item.userId, 'user-1');
    assert.equal(item.lineLinked, true);
    assert.deepEqual(item.memberships[0], {
      companyId: 'co-1',
      companyName: 'ร้านมั่งมี',
      companyStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      roleKeys: ['OWNER', 'ADMIN'],
    });
  });

  it('keeps a DISABLED membership — a merge leaves one behind and the admin has to see it', async () => {
    const users = [
      userRow({
        memberships: [
          {
            status: 'DISABLED',
            company: { id: 'co-2', name: 'ร้านเก่า', status: 'DISABLED' },
            roles: [{ role: { key: 'STAFF' } }],
          },
          {
            status: 'ACTIVE',
            company: { id: 'co-1', name: 'ร้านมั่งมี', status: 'ACTIVE' },
            roles: [],
          },
        ],
      }),
    ];
    const [item] = (await run('สมชาย', { users }).result).items;
    assert.equal(item.memberships.length, 2);
    assert.equal(item.memberships[0].membershipStatus, 'DISABLED');
    assert.equal(item.memberships[0].companyStatus, 'DISABLED');
    assert.deepEqual(item.memberships[1].roleKeys, []);
  });

  it('never selects credential material', async () => {
    const { userArgs, result } = run('สมชาย');
    await result;
    const select = userArgs[0].select;
    assert.equal(select.credential, undefined);
    assert.equal(select.passwordHash, undefined);
    const serialized = JSON.stringify(select);
    for (const forbidden of ['credential', 'passwordHash', 'tempPasswordEncrypted', 'emailVerification', 'passwordReset', 'sessions']) {
      assert.ok(!serialized.includes(forbidden), `select must not reach ${forbidden}`);
    }
    assert.ok(!JSON.stringify(await result).includes('passwordHash'));
  });
});

describe('LookupUsersUseCase — merge trail', () => {
  const mergeRows = [
    { metadataJson: { newUserId: 'user-1', existingUserId: 'user-9' }, createdAt: MERGED_AT },
    { metadataJson: { newUserId: 'user-7', existingUserId: 'user-1' }, createdAt: MERGED_AT },
    { metadataJson: { newUserId: 'other-a', existingUserId: 'other-b' }, createdAt: MERGED_AT },
    { metadataJson: null, createdAt: MERGED_AT },
  ];

  it('derives both directions from metadataJson and ignores rows about other people', async () => {
    const [item] = (await run('สมชาย', { mergeRows }).result).items;
    assert.deepEqual(item.mergeTrail, [
      { direction: 'merged_into', otherUserId: 'user-9', at: MERGED_AT.toISOString() },
      { direction: 'received_merge', otherUserId: 'user-7', at: MERGED_AT.toISOString() },
    ]);
  });

  it('reads only AUTH_ACCOUNT_MERGE rows, newest first', async () => {
    const { auditArgs, result } = run('สมชาย', { mergeRows });
    await result;
    assert.equal(auditArgs[0].where.action, 'auth.account.merge');
    assert.deepEqual(auditArgs[0].orderBy, { createdAt: 'desc' });
  });

  it('bounds the trail at the latest 5 entries', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      metadataJson: { newUserId: 'user-1', existingUserId: `user-${i}` },
      createdAt: MERGED_AT,
    }));
    const [item] = (await run('สมชาย', { mergeRows: many }).result).items;
    assert.equal(item.mergeTrail.length, 5);
    assert.equal(item.mergeTrail[0].otherUserId, 'user-0');
  });

  it('leaves the trail empty when no merge touched the account', async () => {
    const [item] = (await run('สมชาย', { mergeRows: [mergeRows[2]] }).result).items;
    assert.deepEqual(item.mergeTrail, []);
  });
});

describe('SystemUserLookupController', () => {
  it('is guarded by the system partner-member read permission', () => {
    const permissions = Reflect.getMetadata(
      REQUIRED_PERMISSIONS_KEY,
      SystemUserLookupController.prototype.lookup,
    );
    assert.deepEqual(permissions, ['system.partner_member.read']);
  });

  it('passes the raw q through to the use case', async () => {
    const calls: (string | undefined)[] = [];
    const controller = new SystemUserLookupController({
      execute: async (q?: string) => { calls.push(q); return { items: [] }; },
    } as any);
    assert.deepEqual(await controller.lookup('somchai'), { items: [] });
    assert.deepEqual(calls, ['somchai']);
  });
});
