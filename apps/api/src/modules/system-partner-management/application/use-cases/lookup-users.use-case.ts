import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import type {
  SystemUserLookupDto,
  SystemUserLookupItemDto,
  SystemUserMergeTrailDto,
} from '@watchdog-bms/contracts';

export const USER_LOOKUP_MIN_QUERY = 2;
export const USER_LOOKUP_MAX_QUERY = 120;
const RESULT_LIMIT = 20;
const MERGE_TRAIL_LIMIT = 5;

type MergeRow = { metadataJson: unknown; createdAt: Date };

/** The merge use-case writes `{ newUserId, existingUserId, ... }` into the audit row's metadata,
 *  so one row tells both sides of the story — which side this user is on decides the direction. */
function mergeTrailEntry(userId: string, row: MergeRow): SystemUserMergeTrailDto | null {
  const meta = (row.metadataJson ?? {}) as { newUserId?: unknown; existingUserId?: unknown };
  const at = row.createdAt.toISOString();
  if (meta.newUserId === userId && typeof meta.existingUserId === 'string') {
    return { direction: 'merged_into', otherUserId: meta.existingUserId, at };
  }
  if (meta.existingUserId === userId && typeof meta.newUserId === 'string') {
    return { direction: 'received_merge', otherUserId: meta.newUserId, at };
  }
  return null;
}

/**
 * Person-centric system-console read: one search term, every company the person belongs to,
 * plus the merge trail that explains a duplicate DISABLED membership.
 */
@Injectable()
export class LookupUsersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(rawQuery: string | undefined, status?: string): Promise<SystemUserLookupDto> {
    if (rawQuery !== undefined && typeof rawQuery !== 'string') throw new UnprocessableEntityException('คำค้นผู้ใช้งานไม่ถูกต้อง');
    const q = (rawQuery ?? '').trim();
    if (status && !['ACTIVE', 'SUSPENDED', 'DISABLED'].includes(status)) {
      throw new UnprocessableEntityException('สถานะผู้ใช้งานไม่ถูกต้อง');
    }
    if (q.length < USER_LOOKUP_MIN_QUERY || q.length > USER_LOOKUP_MAX_QUERY) {
      throw new UnprocessableEntityException(
        `คำค้นต้องมีความยาว ${USER_LOOKUP_MIN_QUERY} ถึง ${USER_LOOKUP_MAX_QUERY} ตัวอักษร`,
      );
    }

    // ponytail: explicit select — UserCredential (passwordHash, tempPasswordEncrypted) is never
    // traversed here. This screen answers "who is this person", not "what is their password".
    const users = await this.prisma.client.user.findMany({
      where: {
        ...(status ? { status: status as 'ACTIVE' | 'SUSPENDED' | 'DISABLED' } : {}),
        OR: [
          { email: q.toLowerCase() },
          { username: q },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: RESULT_LIMIT,
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        username: true,
        email: true,
        status: true,
        externalIdentities: {
          where: { provider: 'LINE', status: 'ACTIVE' },
          select: { id: true },
          take: 1,
        },
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            status: true,
            company: { select: { id: true, name: true, status: true } },
            roles: { select: { role: { select: { key: true } } } },
          },
        },
      },
    });

    if (users.length === 0) return { items: [] };

    const userIds = users.map((u) => u.id);
    // Narrowed by the indexed columns the merge writes (actorUserId = the emptied account,
    // targetType/targetId = the account it merged into); direction still comes from the metadata,
    // which is the documented shape. ponytail: one flat read, grouped in memory — a merge is rare
    // enough that a per-user query would be 20 round trips for a handful of rows.
    const mergeRows = await this.prisma.client.auditLog.findMany({
      where: {
        action: AuditAction.AUTH_ACCOUNT_MERGE,
        OR: [{ actorUserId: { in: userIds } }, { targetType: 'User', targetId: { in: userIds } }],
      },
      orderBy: { createdAt: 'desc' },
      take: RESULT_LIMIT * MERGE_TRAIL_LIMIT,
      select: { metadataJson: true, createdAt: true },
    });

    const items: SystemUserLookupItemDto[] = users.map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      username: u.username ?? undefined,
      email: u.email ?? undefined,
      status: u.status as SystemUserLookupItemDto['status'],
      lineLinked: u.externalIdentities.length > 0,
      memberships: u.memberships.map((m) => ({
        companyId: m.company.id,
        companyName: m.company.name,
        companyStatus: m.company.status as SystemUserLookupItemDto['memberships'][number]['companyStatus'],
        membershipStatus: m.status as SystemUserLookupItemDto['memberships'][number]['membershipStatus'],
        roleKeys: m.roles.map((r) => r.role.key),
      })),
      mergeTrail: mergeRows
        .map((row) => mergeTrailEntry(u.id, row))
        .filter((entry): entry is SystemUserMergeTrailDto => entry !== null)
        .slice(0, MERGE_TRAIL_LIMIT),
    }));

    return { items };
  }
}
