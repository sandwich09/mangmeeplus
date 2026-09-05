/**
 * The username uniqueness read, against real PostgreSQL.
 *
 * An in-memory fake cannot see this class of bug at all: the first version of this check used
 * Prisma's `mode: 'insensitive'`, which compiles to `"username" ILIKE $1` with the value bound
 * raw. `USERNAME_PATTERN` allows `_`, a single-character LIKE wildcard, so on real Postgres
 * `som_hai` was refused because `somchai` exists, and `somchai_gmail.com` was refused because it
 * matched somebody's EMAIL — an address-enumeration oracle on the one self-service route. Every
 * fake in the repo modelled that operator as equality and reported green.
 *
 * Run with:
 *   ACCOUNT_PROFILE_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15432/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/auth/account-profile-username.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AccountProfileUseCase } from './application/use-cases/account-profile.use-case';

const databaseUrl = process.env.ACCOUNT_PROFILE_TEST_DATABASE_URL;

describe('username uniqueness on real PostgreSQL', { skip: !databaseUrl }, () => {
  it('compares exactly and case-folded, with no LIKE semantics', async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
    // Localhost alone is NOT proof of a local database: the production access recipe port-forwards
    // prod to 127.0.0.1 through SSM. This spec writes to the real `public` schema, so it also
    // requires the local docker database by name before it creates a single row.
    assert.equal(url.pathname, '/watchdog_bms', 'refusing to write to anything but the local docker database');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `acctprofile-${randomUUID().slice(0, 8)}`;
    const useCase = new AccountProfileUseCase({ client } as any, null, null);

    /** Runs the real check and reports how the use case answered, without keeping the credential. */
    const attempt = async (desired: string): Promise<'accepted' | 'taken' | 'invalid'> => {
      const subjectId = `${tag}-subject-${randomUUID().slice(0, 8)}`;
      await client.user.create({ data: { id: subjectId, displayName: 'Subject', status: 'ACTIVE' } });
      try {
        await useCase.setInitialPassword(subjectId, 'backup-password', desired, 'req-1', 'session-1');
        return 'accepted';
      } catch (error) {
        if (error instanceof ConflictException) return 'taken';
        if (error instanceof BadRequestException) return 'invalid';
        throw error;
      } finally {
        await client.userCredential.deleteMany({ where: { userId: subjectId } });
        await client.user.deleteMany({ where: { id: subjectId } });
      }
    };

    try {
      await client.user.createMany({
        data: [
          // Mixed case on purpose: with a lower-case holder, dropping `lower()` from the query
          // would still pass this spec, because the desired name is lower-cased before the read.
          { id: `${tag}-a`, displayName: 'Holder', username: 'SomChai', status: 'ACTIVE' },
          { id: `${tag}-b`, displayName: 'Mailbox', username: `${tag}-b`, email: 'somchai@gmail.com', status: 'ACTIVE' },
        ],
      });

      // The two the ILIKE version got wrong.
      assert.equal(await attempt('som_hai'), 'accepted', '`_` is a LIKE wildcard: nobody holds som_hai');
      assert.equal(await attempt('somchai_gmail.com'), 'accepted', 'a valid name that must not be matched against anyone\u2019s email column');
      assert.equal(await attempt('____'), 'accepted', 'a row of wildcards must not scan every 4-character name');

      // The one it got right, which the fix must keep.
      assert.equal(await attempt('SomChai'), 'taken', 'case-folded equality still catches the real collision');
      assert.equal(await attempt('somchai'), 'taken');
      assert.equal(await attempt(`${tag}-free`.slice(0, 60)), 'accepted');
    } finally {
      await client.auditLog.deleteMany({ where: { actorUserId: { startsWith: tag } } });
      await client.userCredential.deleteMany({ where: { userId: { startsWith: tag } } });
      await client.user.deleteMany({ where: { id: { startsWith: tag } } });
      await client.$disconnect();
    }
  });
});
