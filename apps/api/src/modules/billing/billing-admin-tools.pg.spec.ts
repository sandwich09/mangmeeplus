/**
 * Purchase without setup PR E, against real PostgreSQL. Scope of THIS file: the one thing a fake
 * Prisma client cannot show — that the additive migration `20260928210000_line_support_request_reference`
 * actually applied and the two columns round-trip through a real `ALTER TABLE`.
 *
 * NOT covered here (see docs/agent-memory/purchase-without-setup-2026-09-26.md "PR E open items"
 * for why, and where each is covered instead):
 *   - The recipient admin op's full Stripe-backed cycle and the R-A5 proof (quote/checkout pass
 *     when `account.recipientEmail !== user.email`) — these exercise `billing.service.ts` quote/
 *     checkout (PR C's surface) end-to-end with a fake Stripe fetch, which is a materially bigger
 *     harness than this column-round-trip check; `billing-document-admin.service.spec.ts` already
 *     covers the admin op's own state machine and guards against a fake store.
 *   - `lookup()` suffix matching and cross-company scope isolation against real ids — covered at
 *     the e2e layer instead (`e2e/billing-admin-directory.spec.ts` "lookup" case), which already
 *     seeds a real company/invoice through the app's own fixtures and exercises the real
 *     permission system a raw-Prisma PG spec would otherwise have to reconstruct by hand.
 *
 * Run with:
 *   BILLING_ADMIN_TOOLS_TEST_DATABASE_URL='postgresql://…@127.0.0.1:15498/watchdog_bms?schema=public' \
 *     npx tsx --test src/modules/billing/billing-admin-tools.pg.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

const databaseUrl = process.env.BILLING_ADMIN_TOOLS_TEST_DATABASE_URL;

async function harness() {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
  const disposable = url.pathname === '/watchdog_bms' || url.pathname === '/email_otp_test' || url.pathname.endsWith('_ci');
  assert.ok(disposable, `refusing to write to ${url.pathname}: only a disposable test database is allowed`);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const lineUserId = `pg-test-${randomUUID()}`;
  return { client, lineUserId, lineUserIdHash: createHash('sha256').update(lineUserId).digest('hex').slice(0, 16) };
}

describe('LineSupportRequest.referenceKind/referenceId — migration 20260928210000, real PostgreSQL', { skip: !databaseUrl }, () => {
  it('are absent by default (additive, nullable) on a row that names neither', async () => {
    const { client, lineUserId, lineUserIdHash } = await harness();
    try {
      const created = await client.lineSupportRequest.create({ data: { lineUserId, lineUserIdHash } });
      assert.equal(created.referenceKind, null);
      assert.equal(created.referenceId, null);
    } finally {
      await client.lineSupportRequest.deleteMany({ where: { lineUserId } });
      await client.$disconnect();
    }
  });

  it('round-trip on create, and the newest context wins on update — R-E5', async () => {
    const { client, lineUserId, lineUserIdHash } = await harness();
    try {
      const attemptId = randomUUID();
      const created = await client.lineSupportRequest.create({
        data: { lineUserId, lineUserIdHash, referenceKind: 'attempt', referenceId: attemptId },
      });
      assert.equal(created.referenceKind, 'attempt');
      assert.equal(created.referenceId, attemptId);

      const invoiceId = randomUUID();
      const updated = await client.lineSupportRequest.update({
        where: { id: created.id }, data: { referenceKind: 'invoice', referenceId: invoiceId },
      });
      assert.equal(updated.referenceKind, 'invoice');
      assert.equal(updated.referenceId, invoiceId);

      const reread = await client.lineSupportRequest.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(reread.referenceKind, 'invoice');
      assert.equal(reread.referenceId, invoiceId);
    } finally {
      await client.lineSupportRequest.deleteMany({ where: { lineUserId } });
      await client.$disconnect();
    }
  });

  it('accepts any staff-only string (no Prisma enum — spec §9/A4 additive, string like closedReason)', async () => {
    const { client, lineUserId, lineUserIdHash } = await harness();
    try {
      // Values are validated in application code (openSupportRequest/handlePackageCallback), not
      // by the column itself — this proves the migration did not accidentally add a CHECK/enum.
      const created = await client.lineSupportRequest.create({
        data: { lineUserId, lineUserIdHash, referenceKind: 'not-a-real-kind', referenceId: 'anything' },
      });
      assert.equal(created.referenceKind, 'not-a-real-kind');
    } finally {
      await client.lineSupportRequest.deleteMany({ where: { lineUserId } });
      await client.$disconnect();
    }
  });
});
