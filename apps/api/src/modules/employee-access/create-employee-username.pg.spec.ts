/**
 * The cross-company username reuse read, against real PostgreSQL.
 *
 * An in-memory fake cannot see this class of bug at all: the first version of this check used
 * Prisma's `mode: 'insensitive'`, which compiles to `"username" ILIKE $1` with the value bound
 * raw. Usernames allow `_`, a single-character LIKE wildcard, so on real Postgres `som_hai`
 * matched a stored `somchai`. Without `linkExistingUser` that refused a free username with
 * `employee_existing_user`; WITH it, the WRONG user row flowed into `attachExistingUser` and got a
 * membership in a company its owner never applied to — and `employee_email_must_differ` does not
 * catch that, because the wrong account's email differs too. Every fake in the repo modelled that
 * operator as equality and reported green.
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

describe('cross-company username reuse on real PostgreSQL', { skip: !databaseUrl }, () => {
  it('matches exactly and case-folded, with no LIKE semantics', async () => {
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
      displayName: 'Somchai Jaidee',
      dateOfBirth: '1998-09-28',
      identityType: 'THAI_NATIONAL_ID' as const,
      identityNumber: '1-2345-67890-12-3',
      phoneNumber: '0812345678',
      roleIds: [`${tag}-role`],
      requestingUserId: `${tag}-admin`,
      requesterPermissions: [],
      requestId: 'req-1',
      apiBaseUrl: 'https://api.example.com/v1',
    };

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
     * Runs the real use case and reports how it answered. `displayName` is the tag so every user
     * the use case creates is reclaimable by `reset` without trusting its generated id.
     */
    const attempt = async (
      username: string,
      extra: { linkExistingUser?: boolean; email?: string } = {},
    ): Promise<'created' | 'attached' | 'existing-user' | 'must-differ'> => {
      try {
        const result = await useCase.execute({ ...command, ...extra, username, displayName: tag });
        // `attached` is the dangerous answer: it means an account the admin never named just
        // gained a membership here. Read it off the shared user, not off the handoff flag.
        return result.userId === holderId ? 'attached' : 'created';
      } catch (error) {
        if (error instanceof ConflictException) {
          const code = (error.getResponse() as { code?: string }).code;
          if (code === 'employee_existing_user') return 'existing-user';
          if (code === 'employee_email_must_differ') return 'must-differ';
        }
        throw error;
      } finally {
        await reset();
      }
    };

    try {
      await client.company.create({ data: { id: companyId, name: tag } });
      await client.role.create({ data: { id: `${tag}-role`, scopeKey: companyId, companyId, key: 'SALES', name: 'Sales' } });
      await client.user.createMany({
        data: [
          { id: `${tag}-admin`, displayName: 'Admin', username: `${tag}-admin`, status: 'ACTIVE' },
          // Mixed case on purpose: with a lower-case holder, dropping `lower()` from the query
          // would still pass this spec, because the wanted name is lower-cased before the read.
          { id: holderId, displayName: 'Holder', username: 'SomChai', email: 'holder@example.test', status: 'ACTIVE' },
          { id: `${tag}-other`, displayName: 'Unrelated', username: `${tag}-other`, status: 'ACTIVE' },
        ],
      });

      // The ones the ILIKE version got wrong. `_` and `%` are LIKE wildcards, so `som_hai` was
      // refused and — worse — confirming the link attached the admin to `SomChai` instead.
      assert.equal(await attempt('som_hai'), 'created', '`_` is a LIKE wildcard: nobody holds som_hai');
      assert.equal(
        await attempt('som_hai', { linkExistingUser: true, email: 'somchai.b@work.co.th' }),
        'created',
        'confirming the link must never attach an account the admin did not choose',
      );
      assert.equal(await attempt('som%'), 'created', '`%` must match the literal character, not every name starting som');
      assert.equal(await attempt('____'), 'created', 'a row of wildcards must not scan every 4-character name');

      // The ones it got right, which the fix must keep.
      assert.equal(await attempt('somchai'), 'existing-user', 'case-folded equality still catches the real collision');
      assert.equal(await attempt('SOMCHAI'), 'existing-user');
      assert.equal(await attempt('SomChai'), 'existing-user');
      // …including the confirmed link, which is the whole point of the conflict above.
      assert.equal(await attempt('somchai', { linkExistingUser: true, email: 'holder@example.test' }), 'must-differ');
      assert.equal(await attempt('somchai', { linkExistingUser: true, email: 'somchai.b@work.co.th' }), 'attached');
    } finally {
      await reset();
      await client.role.deleteMany({ where: { scopeKey: companyId } });
      await client.user.deleteMany({ where: { id: { startsWith: tag } } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.$disconnect();
    }
  });
});
