// P12-0 read-only inventory of LINE identities against the canonical messaging
// channel (LINE Login journey spec §4.2). No mutation — classification only.
//
// Run from apps/api with DATABASE_URL + LINE_MESSAGING_CHANNEL_ID set:
//   pnpm exec tsx src/scripts/line-identity-inventory.ts [--dispositions <file.json>]
//
// --dispositions: JSON array of ExternalIdentity ids whose CONFLICT has a
// recorded disposition. Exit codes: 0 clean, 1 CONFLICT without disposition
// (or unexpected failure), 2 usage/config error.
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import {
  classifyLineIdentityInventory,
  undispositionedConflicts,
  type LineIdentityRow,
} from './line-identity-inventory.logic';

class UsageError extends Error {}

function parseDispositions(argv: string[]): string[] {
  const flagIndex = argv.indexOf('--dispositions');
  if (flagIndex === -1) return [];
  const path = argv[flagIndex + 1];
  if (!path) throw new UsageError('--dispositions requires a file path');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new UsageError('--dispositions file must be a JSON array of ExternalIdentity id strings');
  }
  return parsed as string[];
}

async function main(): Promise<void> {
  const canonicalChannelId = process.env['LINE_MESSAGING_CHANNEL_ID'];
  const databaseUrl = process.env['DATABASE_URL'];
  if (!canonicalChannelId) throw new UsageError('LINE_MESSAGING_CHANNEL_ID is required (canonical providerChannelId)');
  if (!databaseUrl) throw new UsageError('DATABASE_URL is required');
  const dispositioned = parseDispositions(process.argv.slice(2));

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const identityRows = await prisma.externalIdentity.findMany({
      where: { provider: 'LINE' },
      select: {
        id: true,
        userId: true,
        providerUserId: true,
        providerChannelId: true,
        status: true,
        user: { select: { status: true } },
      },
      orderBy: { id: 'asc' },
    });
    const memberships = await prisma.companyMembership.findMany({
      where: {
        userId: { in: [...new Set(identityRows.map((r) => r.userId))] },
        status: 'ACTIVE',
        company: { status: 'ACTIVE' },
      },
      select: { userId: true, companyId: true },
    });
    const contexts = await prisma.lineCompanyContext.findMany({ select: { lineUserId: true, companyId: true } });

    const membershipsByUser = new Map<string, string[]>();
    for (const membership of memberships) {
      const list = membershipsByUser.get(membership.userId) ?? [];
      list.push(membership.companyId);
      membershipsByUser.set(membership.userId, list);
    }

    const identities: LineIdentityRow[] = identityRows.map((r) => ({
      id: r.id,
      userId: r.userId,
      providerUserId: r.providerUserId,
      providerChannelId: r.providerChannelId,
      status: r.status,
      userStatus: r.user.status,
      activeMembershipCompanyIds: membershipsByUser.get(r.userId) ?? [],
    }));

    const report = classifyLineIdentityInventory({ canonicalChannelId, identities, contexts });
    const openConflicts = undispositionedConflicts(report, dispositioned);
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ...report, openConflictCount: openConflicts.length }, null, 2));
    if (openConflicts.length > 0) {
      console.error(`line-identity-inventory: ${openConflicts.length} CONFLICT row(s) without disposition`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
