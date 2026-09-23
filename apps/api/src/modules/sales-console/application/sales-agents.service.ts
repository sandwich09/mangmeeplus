/**
 * Sales agent accounts (spec J5, R12, S08–S10, S28, Q3).
 *
 * Deliberately NOT built on `CreateEmployeeUseCase`: that command requires a date of birth, an
 * identity number and HR fields, and it writes an `EmployeeAccessProfile` that would make a sales
 * agent show up in the platform tenant's HR pages (S09). This builds the same primitives directly —
 * user, credential, membership, membership role — exactly as `add-system-admin.ts` does.
 *
 * S08: the platform tenant has no `CompanyPlanTerm` row, so `assertEmployeeLimit` is a no-op there
 * and creating agents can never be blocked by a seat limit. Nothing needs exempting.
 */
import { Injectable } from '@nestjs/common';
import {
  SALES_CODE_PATTERN,
  type SalesAgentCreateBody,
  type SalesAgentCreateResult,
  type SalesAgentCredentialHandoff,
  type SalesAgentListDto,
  type SalesAgentProfileDto,
  type SalesAgentProfileInput,
  type SalesAgentSelfProfileInput,
  type SalesAgentStatus,
  type SalesAgentUpdateBody,
  type SalesAgentView,
  type SalesRoleKey,
} from '@watchdog-bms/contracts';
import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { uniqueConstraintFields } from '../../../common/database/prisma-error';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { revokeActiveSessions } from '../../auth/domain/logic/session-revocation.logic';
import { buildTemporaryPasswordFlexMessage, pushSystemLineMessages } from '../../auth/infrastructure/system-line-push';
import {
  generateTemporaryPassword,
  hashTemporaryPassword,
  temporaryPasswordExpiry,
} from '../../employee-access/domain/logic/employee-access.logic';
import {
  decryptCredential,
  encryptCredential,
} from '../../system-partner-management/domain/logic/credential-cipher.logic';
import { generateSalesCode, normalizeSalesCode } from '../domain/sales-deal.logic';
import {
  PLATFORM_TENANT_ID, SALES_AGENT_ROLE, SALES_LEAD_ROLE,
  isSystemAdmin, salesBadRequest, salesError, salesNotFound,
} from './sales-context';

const CODE_ATTEMPTS = 8;

type AgentRow = {
  id: string; userId: string; teamLeadUserId: string | null; salesCode: string; status: string;
  /** Only ever used as a NOT-NULL test for `hasProfile`; the value never leaves this service. */
  legalName: string | null;
  createdAt: Date; suspendedAt: Date | null;
};

/** Columns the console may read. No ciphertext, so no PII can reach a list DTO by accident. */
const AGENT_SELECT = {
  id: true, userId: true, teamLeadUserId: true, salesCode: true, status: true,
  legalName: true, createdAt: true, suspendedAt: true,
} as const;

@Injectable()
export class SalesAgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly lineCredentials: LineMessagingCredentialsService,
  ) {}

  /**
   * The team list. A lead sees their own team plus themselves; SYSTEM_ADMIN sees everyone.
   * Never returns a single PII field; scoped profile reads use a separate audited endpoint.
   */
  async list(ctx: RequestContext): Promise<SalesAgentListDto> {
    const profiles = await this.prisma.client.salesAgentProfile.findMany({
      where: isSystemAdmin(ctx) ? {} : { OR: [{ teamLeadUserId: ctx.userId }, { userId: ctx.userId }] },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: AGENT_SELECT,
    });
    return { items: await this.toViews(profiles) };
  }

  async create(ctx: RequestContext, body: SalesAgentCreateBody): Promise<SalesAgentCreateResult> {
    const role = this.requireRole(body.role);
    // A lead can supply payroll details for a new agent in their own team.
    if (body.profile && !ctx.permissions.includes('sales.agent_profile.manage')
      && !(ctx.permissions.includes('sales.team.manage') && role === SALES_AGENT_ROLE)) {
      throw salesBadRequest('SALES_AGENT_NOT_FOUND', 'ไม่มีสิทธิ์กรอกข้อมูลภาษีของเซลล์');
    }
    // A lead may only create plain agents, and only inside their own team (R11/§11).
    const teamLeadUserId = isSystemAdmin(ctx)
      ? await this.resolveTeamLead(body.teamLeadUserId ?? null)
      : ctx.userId;
    if (!isSystemAdmin(ctx) && role !== SALES_AGENT_ROLE) {
      throw salesBadRequest('SALES_TEAM_LEAD_INVALID', 'หัวหน้าทีมสร้างได้เฉพาะบัญชีเซลล์ในทีมของตนเอง');
    }

    const username = (body.username ?? '').trim().toLowerCase();
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
      throw salesBadRequest('SALES_AGENT_USERNAME_TAKEN', 'ชื่อผู้ใช้ต้องมี 3–40 ตัวอักษร (a-z, 0-9, . _ -)');
    }
    const displayName = (body.displayName ?? '').trim();
    if (!displayName || displayName.length > 120) {
      throw salesBadRequest('SALES_AGENT_NOT_FOUND', 'ต้องระบุชื่อที่แสดงของเซลล์');
    }
    if (await this.prisma.client.user.findUnique({ where: { username }, select: { id: true } })) {
      throw salesError('SALES_AGENT_USERNAME_TAKEN', 'ชื่อผู้ใช้นี้ถูกใช้แล้ว');
    }

    const temporaryPassword = generateTemporaryPassword();
    const expiresAt = temporaryPasswordExpiry(new Date());
    const roleRow = await this.prisma.client.role.findUniqueOrThrow({
      where: { scopeKey_key: { scopeKey: 'system', key: role } },
      select: { id: true },
    });

    const created = await this.withSalesCode(body.salesCode, async (salesCode) =>
      this.prisma.client.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username, displayName, status: 'ACTIVE',
            ...(body.phoneNumber?.trim() ? { phoneNumber: body.phoneNumber.trim() } : {}),
            ...(body.email?.trim() ? { email: body.email.trim().toLowerCase() } : {}),
          },
          select: { id: true },
        });
        await tx.userCredential.create({
          data: {
            userId: user.id,
            passwordHash: hashTemporaryPassword(temporaryPassword),
            status: 'TEMPORARY',
            // J5: the agent must set their own password before the console opens.
            mustChangePassword: true,
            expiresAt,
            tempPasswordEncrypted: encryptCredential(temporaryPassword, this.config.credentialEncryptionKey),
          },
        });
        const membership = await tx.companyMembership.create({
          data: { companyId: PLATFORM_TENANT_ID, userId: user.id, status: 'ACTIVE' },
          select: { id: true },
        });
        await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: roleRow.id } });
        const profile = await tx.salesAgentProfile.create({
          data: {
            userId: user.id,
            teamLeadUserId: role === SALES_LEAD_ROLE ? null : teamLeadUserId,
            salesCode,
            ...this.profileColumns(body.profile),
            status: 'ACTIVE',
            createdByUserId: ctx.userId,
          },
          select: AGENT_SELECT,
        });
        // S10: ids, role and code only. No legal name, no national id, no bank account.
        await this.audit.log({
          actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: 'sales.agent.created',
          targetType: 'SalesAgentProfile', targetId: profile.id, requestId: ctx.requestId,
          result: 'SUCCESS', riskLevel: 'HIGH',
          metadataJson: { userId: user.id, role, salesCode, hasProfile: Boolean(body.profile) },
        }, tx);
        return profile;
      }));

    const [agent] = await this.toViews([created]);
    return {
      agent: agent!,
      credential: await this.handoff(created.userId, username, temporaryPassword, expiresAt),
    };
  }

  async update(ctx: RequestContext, userId: string, body: SalesAgentUpdateBody): Promise<SalesAgentView> {
    const current = await this.requireAgent(ctx, userId);
    if (body.profile && !ctx.permissions.includes('sales.agent_profile.manage')) {
      throw salesBadRequest('SALES_AGENT_NOT_FOUND', 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ข้อมูลภาษีของเซลล์ได้');
    }
    const statusChange = body.status && body.status !== current.status ? body.status : null;
    if (statusChange && !(body.reason ?? '').trim()) {
      throw salesBadRequest('SALES_AGENT_NOT_FOUND', 'ต้องระบุเหตุผลเมื่อเปลี่ยนสถานะของเซลล์');
    }
    const salesCode = body.salesCode === undefined ? undefined : this.requireCode(body.salesCode);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (body.displayName !== undefined || body.phoneNumber !== undefined || body.email !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
            ...(body.phoneNumber !== undefined ? { phoneNumber: body.phoneNumber?.trim() || null } : {}),
            ...(body.email !== undefined ? { email: body.email?.trim().toLowerCase() || null } : {}),
          },
        });
      }
      const row = await tx.salesAgentProfile.update({
        where: { userId },
        data: {
          ...(salesCode !== undefined ? { salesCode } : {}),
          ...(body.teamLeadUserId !== undefined && isSystemAdmin(ctx) ? { teamLeadUserId: body.teamLeadUserId } : {}),
          ...(body.profile ? this.profileColumns(body.profile) : {}),
          ...(statusChange
            ? {
              status: statusChange,
              // Suspending keeps the membership and the role: the lead must still be able to read
              // the agent's deals afterwards (§J5/R12). Only the sales code stops resolving.
              suspendedAt: statusChange === 'SUSPENDED' ? new Date() : null,
              suspendReason: statusChange === 'SUSPENDED' ? (body.reason ?? '').trim() : null,
            }
            : {}),
        },
        select: AGENT_SELECT,
      });
      if (statusChange === 'SUSPENDED') {
        await revokeActiveSessions(tx.authSession, { userId });
      }
      await this.audit.log({
        actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID,
        action: statusChange ? 'sales.agent.suspended' : 'sales.agent.updated',
        targetType: 'SalesAgentProfile', targetId: row.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          userId, status: row.status,
          ...(statusChange ? { statusChange } : {}),
          profileChanged: Boolean(body.profile),
          ...(salesCode !== undefined ? { salesCode } : {}),
        },
      }, tx);
      return row;
    }).catch((error: unknown) => { throw this.mapCodeConflict(error); });

    const [view] = await this.toViews([updated]);
    return view!;
  }

  /** Q3: a fresh temporary password, shown once on the creator's screen and pushed if LINE-linked. */
  async resetCredential(ctx: RequestContext, userId: string): Promise<SalesAgentCredentialHandoff> {
    const agent = await this.requireAgent(ctx, userId);
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });
    const temporaryPassword = generateTemporaryPassword();
    const expiresAt = temporaryPasswordExpiry(new Date());

    await this.prisma.client.$transaction(async (tx) => {
      await tx.userCredential.update({
        where: { userId },
        data: {
          passwordHash: hashTemporaryPassword(temporaryPassword),
          status: 'TEMPORARY',
          mustChangePassword: true,
          expiresAt,
          tempPasswordEncrypted: encryptCredential(temporaryPassword, this.config.credentialEncryptionKey),
        },
      });
      const revokedSessionCount = await revokeActiveSessions(tx.authSession, { userId });
      await this.audit.log({
        actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: 'sales.agent.credential_issued',
        targetType: 'SalesAgentProfile', targetId: agent.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'CRITICAL',
        metadataJson: { userId, revokedSessionCount },
      }, tx);
    });
    return this.handoff(userId, user.username ?? '', temporaryPassword, expiresAt);
  }

  /** Decrypted PII, scoped to admin, self or own-team lead; every read is audited. */
  async readProfile(ctx: RequestContext, userId: string): Promise<SalesAgentProfileDto> {
    const admin = isSystemAdmin(ctx) && ctx.permissions.includes('sales.agent_profile.manage');
    const self = userId === ctx.userId && ctx.permissions.includes('sales.console.read');
    const lead = ctx.permissions.includes('sales.team.manage');
    if (!admin && !self && !lead) throw salesNotFound('SALES_AGENT_NOT_FOUND', 'ไม่พบบัญชีเซลล์นี้');
    const row = await this.prisma.client.salesAgentProfile.findFirst({
      where: admin || self ? { userId } : { userId, teamLeadUserId: ctx.userId },
      select: {
        id: true, legalName: true, nationalIdEncrypted: true, taxIdEncrypted: true,
        address: true, bankName: true, bankAccountEncrypted: true, whtRatePercent: true,
      },
    });
    if (!row) throw salesNotFound('SALES_AGENT_NOT_FOUND', 'ไม่พบบัญชีเซลล์นี้');
    await this.audit.log({
      actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: 'sales.agent.profile_viewed',
      targetType: 'SalesAgentProfile', targetId: row.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { userId },
    });
    const key = this.config.credentialEncryptionKey;
    const plain = (value: string | null) => (value ? decryptCredential(value, key) : null);
    return {
      legalName: row.legalName,
      nationalId: plain(row.nationalIdEncrypted),
      taxId: plain(row.taxIdEncrypted),
      address: row.address,
      bankName: row.bankName,
      bankAccount: plain(row.bankAccountEncrypted),
      whtRatePercent: row.whtRatePercent,
    };
  }

  /** A sales user can replace only their own identity/address/bank fields. WHT stays admin-owned. */
  async updateOwnProfile(ctx: RequestContext, profile: SalesAgentSelfProfileInput): Promise<SalesAgentProfileDto> {
    if (!ctx.permissions.includes('sales.console.read')) throw salesNotFound('SALES_AGENT_NOT_FOUND', 'ไม่พบบัญชีเซลล์นี้');
    const ownColumns = this.profileColumns(profile, false);
    await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.salesAgentProfile.update({
        where: { userId: ctx.userId },
        data: ownColumns,
        select: { id: true },
      });
      await this.audit.log({
        actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: 'sales.agent.updated',
        targetType: 'SalesAgentProfile', targetId: row.id, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { userId: ctx.userId, profileChanged: true, selfEdited: true },
      }, tx);
    });
    return this.readProfile(ctx, ctx.userId);
  }

  /** R12: the payroll hand-off. SYSTEM_ADMIN only, audited HIGH because it moves every agent's PII at once. */
  async exportCsv(ctx: RequestContext): Promise<string> {
    const rows = await this.prisma.client.salesAgentProfile.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true, salesCode: true, legalName: true, nationalIdEncrypted: true, taxIdEncrypted: true,
        address: true, bankName: true, bankAccountEncrypted: true, whtRatePercent: true, status: true,
      },
    });
    const key = this.config.credentialEncryptionKey;
    // An agent whose payroll record the Owner has not filled in yet exports as empty cells rather
    // than being dropped: accounting still needs to see that the person exists.
    const plain = (value: string | null) => (value ? decryptCredential(value, key) : '');
    const header = ['salesCode', 'legalName', 'nationalId', 'taxId', 'address', 'bankName', 'bankAccount', 'whtRatePercent', 'status'];
    const body = rows.map((row) => [
      row.salesCode, row.legalName ?? '', plain(row.nationalIdEncrypted), plain(row.taxIdEncrypted),
      row.address ?? '', row.bankName ?? '', plain(row.bankAccountEncrypted),
      String(row.whtRatePercent), row.status,
    ].map(csvCell).join(','));
    await this.audit.log({
      actorUserId: ctx.userId, companyId: PLATFORM_TENANT_ID, action: 'sales.agent.profile_exported',
      targetType: 'SalesAgentProfile', requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { rows: rows.length },
    });
    return [header.join(','), ...body].join('\n');
  }

  // ── internals ────────────────────────────────────────────────────────────────────────

  private requireRole(role: unknown): SalesRoleKey {
    if (role !== SALES_LEAD_ROLE && role !== SALES_AGENT_ROLE) {
      throw salesBadRequest('SALES_TEAM_LEAD_INVALID', 'บทบาทของเซลล์ไม่ถูกต้อง');
    }
    return role;
  }

  private requireCode(raw: unknown): string {
    const code = normalizeSalesCode(raw);
    if (!code) throw salesBadRequest('SALES_CODE_INVALID', 'รหัสเซลล์ต้องเป็นตัวพิมพ์ใหญ่หรือตัวเลข 3–6 ตัว');
    return code;
  }

  private async resolveTeamLead(teamLeadUserId: string | null): Promise<string | null> {
    if (!teamLeadUserId) return null;
    const lead = await this.prisma.client.salesAgentProfile.findUnique({
      where: { userId: teamLeadUserId }, select: { userId: true },
    });
    if (!lead) throw salesBadRequest('SALES_TEAM_LEAD_INVALID', 'ไม่พบหัวหน้าทีมที่ระบุ');
    return lead.userId;
  }

  /**
   * A self-chosen code is used verbatim or refused; a generated one retries on collision. Without
   * the retry, a random 4-character code would surface a raw P2002 to the operator roughly once in
   * a thousand creations.
   */
  private async withSalesCode<T>(requested: string | undefined, write: (code: string) => Promise<T>): Promise<T> {
    if (requested !== undefined) {
      try {
        return await write(this.requireCode(requested));
      } catch (error) {
        throw this.mapCodeConflict(error);
      }
    }
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        return await write(generateSalesCode());
      } catch (error) {
        if (!isSalesCodeConflict(error) || attempt === CODE_ATTEMPTS - 1) throw this.mapCodeConflict(error);
      }
    }
    throw salesError('SALES_CODE_TAKEN', 'ออกรหัสเซลล์อัตโนมัติไม่สำเร็จ ลองอีกครั้ง');
  }

  private mapCodeConflict(error: unknown): unknown {
    return isSalesCodeConflict(error)
      ? salesError('SALES_CODE_TAKEN', 'รหัสเซลล์นี้ถูกใช้แล้ว เลือกรหัสอื่น')
      : error;
  }

  private profileColumns(profile: SalesAgentProfileInput | SalesAgentSelfProfileInput | undefined, includeWht = true) {
    // An omitted profile stays NULL, distinguishing "never captured" from an entered value.
    if (!profile) return {};
    const key = this.config.credentialEncryptionKey;
    return {
      legalName: profile.legalName.trim(),
      address: profile.address.trim(),
      bankName: profile.bankName.trim(),
      ...(includeWht && 'whtRatePercent' in profile ? { whtRatePercent: profile.whtRatePercent } : {}),
      nationalIdEncrypted: encryptCredential(profile.nationalId.trim(), key),
      bankAccountEncrypted: encryptCredential(profile.bankAccount.trim(), key),
      taxIdEncrypted: profile.taxId?.trim() ? encryptCredential(profile.taxId.trim(), key) : null,
    };
  }

  private async requireAgent(ctx: RequestContext, userId: string): Promise<AgentRow> {
    const row = await this.prisma.client.salesAgentProfile.findUnique({
      where: { userId },
      select: AGENT_SELECT,
    });
    if (!row) throw salesNotFound('SALES_AGENT_NOT_FOUND', 'ไม่พบบัญชีเซลล์นี้');
    // A lead may only touch their own team.
    if (!isSystemAdmin(ctx) && row.teamLeadUserId !== ctx.userId) {
      throw salesNotFound('SALES_AGENT_NOT_FOUND', 'ไม่พบบัญชีเซลล์นี้');
    }
    return row;
  }

  private async handoff(
    userId: string, username: string, temporaryPassword: string, expiresAt: Date,
  ): Promise<SalesAgentCredentialHandoff> {
    return {
      userId, username, temporaryPassword, expiresAt: expiresAt.toISOString(),
      // S28: a brand-new agent has no LINE identity, so this is false and the creator's screen is
      // the only delivery. Returned so the UI can say so rather than imply a message was sent.
      lineNotified: await this.pushTemporaryPassword(userId, temporaryPassword, expiresAt),
    };
  }

  private async pushTemporaryPassword(userId: string, temporaryPassword: string, expiresAt: Date): Promise<boolean> {
    const credentials = await this.lineCredentials.get().catch(() => null);
    const token = credentials?.accessToken;
    if (!token || !credentials?.channelId) return false;
    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { userId, provider: 'LINE', providerChannelId: credentials.channelId, status: 'ACTIVE' },
      select: { providerUserId: true },
    });
    if (!identity) return false;
    const expiry = expiresAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
    return pushSystemLineMessages(token, identity.providerUserId, [
      buildTemporaryPasswordFlexMessage(temporaryPassword, [
        `ใช้ได้ถึง ${expiry}`,
        'เข้าสู่ระบบแล้วระบบจะให้ตั้งรหัสผ่านใหม่ทันที',
      ]),
    ]);
  }

  private async toViews(rows: readonly AgentRow[]): Promise<SalesAgentView[]> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.flatMap((row) => [row.userId, row.teamLeadUserId]).filter((id): id is string => Boolean(id)))];
    const credentials = await this.lineCredentials.get().catch(() => null);
    const [users, memberships, identities] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, displayName: true, phoneNumber: true, email: true },
      }),
      this.prisma.client.companyMembership.findMany({
        where: { companyId: PLATFORM_TENANT_ID, userId: { in: rows.map((row) => row.userId) } },
        select: { userId: true, roles: { select: { role: { select: { key: true } } } } },
      }),
      credentials?.channelId
        ? this.prisma.client.externalIdentity.findMany({
          where: { userId: { in: rows.map((row) => row.userId) }, provider: 'LINE', providerChannelId: credentials.channelId, status: 'ACTIVE' },
          select: { userId: true },
        })
        : Promise.resolve([] as Array<{ userId: string }>),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const roleByUserId = new Map(memberships.map((membership) => [
      membership.userId,
      membership.roles.map((entry) => entry.role.key).find((key) => key === SALES_LEAD_ROLE || key === SALES_AGENT_ROLE) as SalesRoleKey | undefined,
    ]));
    const linked = new Set(identities.map((identity) => identity.userId));

    return rows.map((row): SalesAgentView => {
      const user = userById.get(row.userId);
      return {
        userId: row.userId,
        username: user?.username ?? '',
        displayName: user?.displayName ?? '',
        phoneNumber: user?.phoneNumber ?? null,
        email: user?.email ?? null,
        role: roleByUserId.get(row.userId) ?? SALES_AGENT_ROLE,
        teamLeadUserId: row.teamLeadUserId,
        teamLeadDisplayName: row.teamLeadUserId ? userById.get(row.teamLeadUserId)?.displayName ?? null : null,
        status: row.status as SalesAgentStatus,
        salesCode: row.salesCode,
        lineLinked: linked.has(row.userId),
        // Says whether payroll data exists WITHOUT revealing any of it (S10).
        hasProfile: row.legalName !== null,
        createdAt: row.createdAt.toISOString(),
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
      };
    });
  }
}

/**
 * `uniqueConstraintFields` handles the Prisma 7 adapter shape and strips the quotes the driver puts
 * around each column name — `SalesAgentProfile_salesCode_key` arrives as `["salesCode"]`.
 */
function isSalesCodeConflict(error: unknown): boolean {
  return uniqueConstraintFields(error)?.some((field) => field === 'salesCode') === true;
}

/** Minimal RFC-4180 quoting; the export is opened in Excel by an accountant. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export { SALES_CODE_PATTERN };
