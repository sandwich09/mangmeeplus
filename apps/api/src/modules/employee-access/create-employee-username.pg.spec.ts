/**
 * The cross-company username reuse read AND the unique-violation translations, against real
 * PostgreSQL. Both are things an in-memory fake cannot see.
 *
 * 1. The reuse read used Prisma's `mode: 'insensitive'`, which compiles to `"username" ILIKE $1`
 *    with the value bound raw. Usernames allow `_`, a single-character LIKE wildcard, so on real
 *    Postgres `som_hai` matched a stored `somchai`. Without `linkExistingUser` that refused a free
 *    username with `employee_existing_user`; WITH it, the WRONG user row flowed into
 *    `attachExistingUser` and got a membership in a company its owner never applied to — and
 *    `employee_email_must_differ` does not catch that, because the wrong account's email differs
 *    too. Every fake in the repo modelled that operator as equality and reported green.
 *
 * 2. The P2002 catch blocks read `meta.target`, which `@prisma/adapter-pg` never populates (it puts
 *    the columns under `meta.driverAdapterError` instead — see `uniqueConstraintFields`). So every
 *    field-specific conflict code was dead in production and an exact duplicate degraded to the
 *    generic 409 from `AllExceptionsFilter`, losing the code the web wizard keys its Thai
 *    field-level message off. The unit fake never enforced uniqueness at all, so nothing caught it.
 *
 * Run with:
 *   EMPLOYEE_ACCESS_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15432/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/employee-access/create-employee-username.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { CreateEmployeeUseCase } from './application/use-cases/create-employee.use-case';

const databaseUrl = process.env.EMPLOYEE_ACCESS_TEST_DATABASE_URL;

/**
 * One disposable company, role and admin, plus the two ways this file drives the real use case.
 * `run` reports the outcome as a STRING rather than throwing, so a regression that lets a raw
 * driver error escape shows up as a readable assertion diff instead of an exception.
 */
async function harness() {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  // Localhost alone is NOT proof of a local database: the production access recipe port-forwards
  // prod to 127.0.0.1 through SSM. This spec writes to the real `public` schema, so it also
  // requires the local docker database by name before it creates a single row.
  assert.equal(url.pathname, '/watchdog_bms', 'refusing to write to anything but the local docker database');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const tag = `empusername-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`;
  const holderId = `${tag}-holder`;
  const useCase = new CreateEmployeeUseCase(
    { client } as any,
    { credentialEncryptionKey: Buffer.from('a'.repeat(64), 'hex') } as any,
  );

  const command = {
    companyId,
    displayName: tag,
    dateOfBirth: '1998-09-28',
    identityType: 'THAI_NATIONAL_ID' as const,
    identityNumber: '1-2345-67890-12-3',
    phoneNumber: '0812345678',
    roleIds: [`${tag}-role`],
    requestingUserId: `${tag}-admin`,
    requesterPermissions: [] as string[],
    requestId: 'req-1',
    apiBaseUrl: 'https://api.example.com/v1',
  };

  await client.company.create({ data: { id: companyId, name: tag } });
  await client.role.create({ data: { id: `${tag}-role`, scopeKey: companyId, companyId, key: 'SALES', name: 'Sales' } });
  await client.user.create({ data: { id: `${tag}-admin`, displayName: 'Admin', username: `${tag}-admin`, status: 'ACTIVE' } });

  /** Every row this company gained, so the next attempt starts from the seeded state again. */
  const reset = async () => {
    await client.auditLog.deleteMany({ where: { companyId } });
    await client.employeeLineLinkToken.deleteMany({ where: { companyId } });
    await client.employeeAccessProfile.deleteMany({ where: { companyId } });
    await client.membershipRole.deleteMany({ where: { membership: { companyId } } });
    await client.companyMembership.deleteMany({ where: { companyId } });
    await client.userCredential.deleteMany({ where: { user: { displayName: tag } } });
    await client.user.deleteMany({ where: { displayName: tag } });
  };

  /**
   * `'created'` — a brand new account. `'attached'` — the seeded holder gained a membership, the
   * dangerous answer. Anything else is the conflict `code`, or a description of whatever else
   * escaped. Users the use case creates carry `displayName: tag` so `reset` can reclaim them
   * without trusting a generated id.
   */
  const run = async (username: string, extra: Record<string, unknown> = {}): Promise<string> => {
    try {
      const result = await useCase.execute({ ...command, ...extra, username } as any);
      return result.userId === holderId ? 'attached' : 'created';
    } catch (error) {
      if (error instanceof ConflictException) {
        const body = error.getResponse() as { code?: string };
        return body.code ?? `conflict-without-code:${JSON.stringify(body)}`;
      }
      const err = error as { name?: string; code?: string; message?: string };
      return `uncaught:${err.name}:${err.code ?? ''}:${err.message ?? ''}`;
    }
  };

  /** `run`, then put the company back to its seeded state. */
  const attempt = async (username: string, extra: Record<string, unknown> = {}): Promise<string> => {
    try {
      return await run(username, extra);
    } finally {
      await reset();
    }
  };

  const teardown = async () => {
    await reset();
    await client.role.deleteMany({ where: { scopeKey: companyId } });
    await client.user.deleteMany({ where: { id: { startsWith: tag } } });
    await client.company.deleteMany({ where: { id: companyId } });
    await client.$disconnect();
  };

  return { client, tag, companyId, holderId, run, attempt, reset, teardown };
}

describe('cross-company username reuse on real PostgreSQL', { skip: !databaseUrl }, () => {
  it('matches exactly and case-folded, with no LIKE semantics', async () => {
    const { client, tag, holderId, attempt, teardown } = await harness();
    try {
      await client.user.createMany({
        data: [
          // Mixed case on purpose: with a lower-case holder, dropping `lower()` from the query
          // would still pass this spec, because the wanted name is lower-cased before the read.
          { id: holderId, displayName: 'Holder', username: 'SomChai', email: 'holder@example.test', status: 'ACTIVE' },
          { id: `${tag}-other`, displayName: 'Unrelated', username: `${tag}-other`, status: 'ACTIVE' },
        ],
      });

      // The ones the ILIKE version got wrong. `_` and `%` are LIKE wildcards, so `som_hai` was
      // refused and — worse — confirming the link attached the admin to `SomChai` instead.
      // (`%` cannot reach here over HTTP: `employee-access.dtos.ts` rejects it. `_` can, which is
      // what made this reachable in production rather than merely theoretical.)
      assert.equal(await attempt('som_hai'), 'created', '`_` is a LIKE wildcard: nobody holds som_hai');
      assert.equal(
        await attempt('som_hai', { linkExistingUser: true, email: 'somchai.b@work.co.th' }),
        'created',
        'confirming the link must never attach an account the admin did not choose',
      );
      assert.equal(await attempt('som%'), 'created', '`%` must match the literal character, not every name starting som');
      assert.equal(await attempt('____'), 'created', 'a row of wildcards must not scan every 4-character name');

      // The ones it got right, which the fix must keep.
      assert.equal(await attempt('somchai'), 'employee_existing_user', 'case-folded equality still catches the real collision');
      assert.equal(await attempt('SOMCHAI'), 'employee_existing_user');
      assert.equal(await attempt('SomChai'), 'employee_existing_user');
      // …including the confirmed link, which is the whole point of the conflict above.
      assert.equal(await attempt('somchai', { linkExistingUser: true, email: 'holder@example.test' }), 'employee_email_must_differ');
      assert.equal(await attempt('somchai', { linkExistingUser: true, email: 'somchai.b@work.co.th' }), 'attached');
    } finally {
      await teardown();
    }
  });

  it('translates a real unique violation into its field-specific conflict code', async () => {
    const { client, tag, run, reset, teardown } = await harness();
    try {
      await client.user.createMany({
        data: [
          // DISABLED, so the reuse branch above skips it (`status === 'ACTIVE'` only) and the create
          // reaches the database — which is the only way to prove the P2002 translation is alive.
          { id: `${tag}-disabled`, displayName: 'Disabled', username: `${tag}-taken`, status: 'DISABLED' },
          { id: `${tag}-mailbox`, displayName: 'Mailbox', username: `${tag}-mailbox`, email: `${tag}-taken@example.test`, status: 'ACTIVE' },
        ],
      });

      // Create path, `User_username_key`. Before the fix this fell through to `throw err` and the
      // client saw the filter's generic duplicate 409 with no code to key a field message off.
      assert.equal(await run(`${tag}-taken`), 'employee_username_conflict');
      await reset();

      // Create path, `User_email_key`.
      assert.equal(await run(`${tag}-fresh`, { email: `${tag}-taken@example.test` }), 'employee_email_conflict');
      await reset();

      // Draft-resume path — the OTHER catch block, which re-syncs the shared user row. Same
      // identity as the row just created, so `duplicateIdentity` sends it down the resume branch.
      assert.equal(await run(`${tag}-resume`, { email: `${tag}-mine@example.test` }), 'created');
      assert.equal(await run(`${tag}-resume`, { email: `${tag}-taken@example.test` }), 'employee_email_conflict');
      await reset();

      // Phone is unique per company, and the pre-read that guards it is not in the same transaction
      // as the insert — so under real concurrency one of these two is decided by the index, not the
      // read. Whichever layer answers, the code must be the specific one (never a bare P2002).
      const raced = await Promise.all([
        run(`${tag}-race-a`, { identityNumber: '2-2222-22222-22-2', phoneNumber: '0899999999' }),
        run(`${tag}-race-b`, { identityNumber: '3-3333-33333-33-3', phoneNumber: '0899999999' }),
      ]);
      assert.deepEqual(raced.slice().sort(), ['created', 'employee_phone_conflict']);
    } finally {
      await teardown();
    }
  });

  // A rehearsal for docs/runbooks/username-case-uniqueness-followup.md. Postgres reports a
  // functional index by its expression, truncated at the first `(` — `['lower(username']` — so the
  // day that index is promoted to UNIQUE, a translation matching the column name exactly would stop
  // matching and the conflict would silently degrade again. This proves the normalisation holds
  // BEFORE the promotion ships, without making the shipped index unique.
  it('translates a violation of the (pending) UNIQUE functional index, whose column arrives truncated', async () => {
    const { client, tag, run, teardown } = await harness();
    const indexName = `${tag}_lower_unique`;
    try {
      // Partial, so it constrains only this test's own rows and can never fail to build on whatever
      // the local database already holds. The reported constraint fields are identical either way.
      await client.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "${indexName}" ON "User" (lower("username")) WHERE "displayName" = '${tag}'`,
      );
      // Mixed case and DISABLED: the case-SENSITIVE `User_username_key` does not collide with
      // `somename`, and the reuse branch skips a non-ACTIVE account — so the functional index is
      // the only thing that can reject this, which is exactly what the promotion will rely on.
      await client.user.create({ data: { id: `${tag}-mixed`, displayName: tag, username: 'SomeName', status: 'DISABLED' } });

      assert.equal(await run('somename'), 'employee_username_conflict');
    } finally {
      await client.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName}"`);
      await teardown();
    }
  });
});
