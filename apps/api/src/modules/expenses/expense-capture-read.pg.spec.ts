/**
 * Real-PostgreSQL proof for the capture read QUEUE (contract appendix §4.5/§4.6).
 *
 * Four properties, none of which a fake can establish:
 *   1. two runners claiming at the same instant get DISJOINT jobs (`FOR UPDATE SKIP LOCKED`);
 *   2. a job whose runner died is claimable again once its lease expires, and not before;
 *   3. a write from the previous owner after that reclaim changes NOTHING (the lease fence);
 *   4. one job counts exactly one customer OCR read, however many times it is retried.
 *
 * Gated like every other `*.pg.spec.ts`: skipped without the URL, failing when CI names a
 * database, and refusing to run against anything but an explicit local host.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';
import type { PrismaService } from '../../common/database/prisma.service';
import { admitCompanyOcr, releaseCompanyOcrAdmission } from '../line-ai/application/company-ocr-governance';
import { PrismaExpenseCaptureRepository } from './infrastructure/prisma-expense-capture.repository';

const databaseUrl = process.env.EXPENSE_CAPTURE_READ_TEST_DATABASE_URL;
const LEASE_MS = 120_000;

describe('expense capture read queue on PostgreSQL', { skip: !databaseUrl }, () => {
  const tag = `capread-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`;
  const otherCompanyId = `${tag}-company-2`;
  const userId = `${tag}-user`;
  let client: PrismaClient;
  let prisma: PrismaService;
  let capture: PrismaExpenseCaptureRepository;
  let unreachable: string | null = null;

  async function job(id: string, over: Record<string, unknown> = {}): Promise<string> {
    const row = await client.expenseCaptureReadJob.create({
      data: {
        id: `${tag}-${id}`, companyId, ownerType: 'EXPENSE', attachmentId: `${tag}-att-${id}`,
        attachmentChecksum: `sha-${id}`, ocrAdmissionRequestId: randomUUID(),
        manifestJson: {}, status: 'QUEUED', ...over,
      },
    });
    return row.id;
  }

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'requires an explicit local test database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 25 }) });
    prisma = { client } as unknown as PrismaService;
    capture = new PrismaExpenseCaptureRepository(prisma);
    unreachable = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'EXPENSE_CAPTURE_READ_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.company.createMany({ data: [
      { id: companyId, name: 'Synthetic capture read company' },
      { id: otherCompanyId, name: 'Synthetic capture read company 2' },
    ] });
    await client.user.create({ data: { id: userId, displayName: 'Synthetic runner', status: 'ACTIVE' } });
  });

  after(async () => {
    if (!client) return;
    try {
      if (!unreachable) {
        for (const id of [companyId, otherCompanyId]) {
          await client.expenseCaptureReadJob.deleteMany({ where: { companyId: id } });
          await client.companyOcrUsageEvent.deleteMany({ where: { companyId: id } });
          await client.companyOcrMonthlyUsage.deleteMany({ where: { companyId: id } });
          await client.auditLog.deleteMany({ where: { companyId: id } });
        }
        await client.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
        await client.user.delete({ where: { id: userId } });
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('gives two concurrent runners disjoint jobs and never the same one twice', async (t) => {
    if (unreachable) return t.skip(unreachable);
    // Four jobs of FOUR companies: the per-company ceiling would otherwise (correctly) stop the
    // second claim, and what is under test here is the row-level disjointness.
    const companies = [companyId, otherCompanyId, `${tag}-c3`, `${tag}-c4`];
    await client.company.createMany({ data: companies.slice(2).map((id) => ({ id, name: id })) });
    const ids: string[] = [];
    for (const [index, company] of companies.entries()) {
      ids.push((await client.expenseCaptureReadJob.create({
        data: {
          id: `${tag}-parallel-${index}`, companyId: company, ownerType: 'EXPENSE',
          attachmentId: `${tag}-att-p${index}`, attachmentChecksum: `sha-p${index}`,
          ocrAdmissionRequestId: randomUUID(), manifestJson: {}, status: 'QUEUED',
        },
      })).id);
    }
    try {
      const [left, right] = await Promise.all([
        capture.claimReadJobs({ batchSize: 2, leaseOwner: 'runner-a', leaseMs: LEASE_MS }),
        capture.claimReadJobs({ batchSize: 2, leaseOwner: 'runner-b', leaseMs: LEASE_MS }),
      ]);
      const claimed = [...left, ...right].map((row) => row.id);
      assert.equal(new Set(claimed).size, claimed.length, 'no job was handed to both runners');
      assert.ok(claimed.length >= 2 && claimed.length <= 4);
      for (const row of [...left, ...right]) {
        assert.equal(row.status, 'READING');
        assert.equal(row.attempts, 1, 'the claim itself is the attempt counter');
        assert.ok(row.leasedUntil && row.leasedUntil.getTime() > Date.now());
      }
    } finally {
      await client.expenseCaptureReadJob.deleteMany({ where: { id: { in: ids } } });
      await client.company.deleteMany({ where: { id: { in: companies.slice(2) } } });
    }
  });

  it('claims at most one job per company at a time', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const ids = [await job('same-co-1'), await job('same-co-2')];
    try {
      const claimed = await capture.claimReadJobs({ batchSize: 2, leaseOwner: 'runner-a', leaseMs: LEASE_MS });
      assert.equal(claimed.length, 1, 'one shop cannot occupy the whole reader');
      const second = await capture.claimReadJobs({ batchSize: 2, leaseOwner: 'runner-b', leaseMs: LEASE_MS });
      assert.equal(second.length, 0, 'and the second runner sees the live lease');
    } finally {
      await client.expenseCaptureReadJob.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it('reclaims a job only after its lease expires, and fences the dead owner out', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const id = await job('stranded');
    try {
      const [first] = await capture.claimReadJobs({ batchSize: 1, leaseOwner: 'runner-dead', leaseMs: LEASE_MS });
      assert.equal(first!.id, id);
      assert.equal((await capture.claimReadJobs({ batchSize: 1, leaseOwner: 'runner-b', leaseMs: LEASE_MS })).length, 0,
        'a live lease is not stealable');

      await client.expenseCaptureReadJob.update({ where: { id }, data: { leasedUntil: new Date(Date.now() - 1_000) } });
      const [reclaimed] = await capture.claimReadJobs({ batchSize: 1, leaseOwner: 'runner-b', leaseMs: LEASE_MS });
      assert.equal(reclaimed!.id, id);
      assert.equal(reclaimed!.attempts, 2);

      // The dead runner wakes up and tries to finish: its write must be a no-op.
      const stale = await capture.updateJobFenced({
        jobId: id, leaseOwner: 'runner-dead', data: { status: 'DONE', checkpointJson: { stolen: true } },
      });
      assert.equal(stale, false);
      const row = await client.expenseCaptureReadJob.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'READING', 'the new owner still holds the job');
      assert.deepEqual(row.checkpointJson, {});

      const live = await capture.updateJobFenced({ jobId: id, leaseOwner: 'runner-b', data: { status: 'DONE' } });
      assert.equal(live, true);
    } finally {
      await client.expenseCaptureReadJob.deleteMany({ where: { id } });
    }
  });

  it('counts one customer OCR read per job, whatever the retry does', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const requestId = randomUUID();
    const id = await job('ocr-fence', { ocrAdmissionRequestId: requestId });
    try {
      const first = await admitCompanyOcr(prisma, { companyId, sourceRoute: 'receipt-capture-web', requestId });
      assert.equal(first.allowed, true);
      const retry = await admitCompanyOcr(prisma, { companyId, sourceRoute: 'receipt-capture-web', requestId });
      assert.equal(retry.allowed, false);
      assert.equal((retry as { reason: string }).reason, 'duplicate', 'a resumed job continues, it does not re-count');
      assert.equal(await client.companyOcrUsageEvent.count({ where: { companyId } }), 1);

      // Nothing usable came back: the read goes back to the shop's allowance.
      const released = await releaseCompanyOcrAdmission(prisma, {
        companyId, sourceRoute: 'receipt-capture-web', requestId,
        eventId: (first as { eventId: string }).eventId, reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT',
      });
      assert.equal(released, true);
      assert.equal(await client.companyOcrUsageEvent.count({ where: { companyId } }), 0);
    } finally {
      await client.expenseCaptureReadJob.deleteMany({ where: { id } });
      await client.companyOcrUsageEvent.deleteMany({ where: { companyId } });
      await client.companyOcrMonthlyUsage.deleteMany({ where: { companyId } });
    }
  });

  it('claims a QUEUED, a stranded READING and a PARTIAL job alike, and never a terminal one', async (t) => {
    if (unreachable) return t.skip(unreachable);
    const expired = new Date(Date.now() - 1_000);
    const ids = [
      await job('resume-queued'),
      await job('resume-reading', { status: 'READING', leaseOwner: 'dead', leasedUntil: expired }),
      await job('resume-partial', { status: 'PARTIAL', leaseOwner: 'dead', leasedUntil: expired }),
      await job('resume-done', { status: 'DONE' }),
      await job('resume-cancelled', { status: 'CANCELLED' }),
      await job('resume-failed', { status: 'FAILED' }),
    ];
    try {
      const claimed: string[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const [row] = await capture.claimReadJobs({ batchSize: 1, leaseOwner: `runner-${attempt}`, leaseMs: LEASE_MS });
        if (!row) break;
        claimed.push(row.id);
        // Release the company so the next claim is not blocked by this one's live lease.
        await client.expenseCaptureReadJob.update({ where: { id: row.id }, data: { status: 'DONE', leasedUntil: null } });
      }
      assert.deepEqual(claimed.sort(), ids.slice(0, 3).sort());
    } finally {
      await client.expenseCaptureReadJob.deleteMany({ where: { id: { in: ids } } });
    }
  });
});
