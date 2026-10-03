import { HttpException, Injectable } from '@nestjs/common';
import {
  EXECUTIVE_ACCOUNT_STATUSES, EXECUTIVE_ROLE_KEYS, EXECUTIVE_WORDS as W,
  type ExecutiveAccountStatus, type ExecutiveUserAccessBody, type ExecutiveUserCreateBody,
  type ExecutiveUserCreateResult, type ExecutiveUserCredential, type ExecutiveUserListDto,
  type ExecutiveUserListQuery, type ExecutiveUserReasonBody, type ExecutiveUserStatusBody, type ExecutiveUserView,
} from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { serializableTransaction } from '../../../common/database/serializable-transaction';
import { uniqueConstraintFields } from '../../../common/database/prisma-error';
import { AuditService } from '../../audit/application/audit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { revokeActiveSessions } from '../../auth/domain/logic/session-revocation.logic';
import { generateTemporaryPassword, hashTemporaryPassword, temporaryPasswordExpiry } from '../../employee-access/domain/logic/employee-access.logic';
import { PLATFORM_TENANT_ID } from '../../sales-console/application/sales-context';
import { optionalLineContactEmail } from '../../external-signup/domain/line-signup.logic';

const [BASE_ROLE, EXPORT_ROLE, CONTACT_ROLE] = EXECUTIVE_ROLE_KEYS;
const SYSTEM_ROLE = { scopeKey: 'system', isSystem: true, companyId: null } as const;
const EXECUTIVE_MEMBER = { companyId: PLATFORM_TENANT_ID, status: { in: ['ACTIVE', 'SUSPENDED', 'DISABLED'] }, roles: { some: { role: { ...SYSTEM_ROLE, key: BASE_ROLE } } } } satisfies Prisma.CompanyMembershipWhereInput;
const ADMIN_USER = { memberships: { some: { roles: { some: { role: { key: 'SYSTEM_ADMIN' } } } } } };
const ACCOUNT_SELECT = {
  id: true, userId: true, status: true,
  roles: { select: { role: { select: { key: true, scopeKey: true, status: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
  user: { select: {
    id: true, username: true, displayName: true, email: true, phoneNumber: true, status: true,
    credential: { select: { status: true, expiresAt: true } },
    sessions: { orderBy: { issuedAt: 'desc' }, take: 1, select: { issuedAt: true } },
  } },
} as const satisfies Prisma.CompanyMembershipSelect;
type AccountRow = Prisma.CompanyMembershipGetPayload<{ select: typeof ACCOUNT_SELECT }>;

// Codes are for clients; these fixed messages never interpolate input or database details.
const ERRORS = {
  INVALID_INPUT: [400, 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'],
  EXECUTIVE_QUERY_INVALID: [400, 'ตัวกรองไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'],
  EXECUTIVE_ACCESS_DENIED: [403, 'ไม่มีสิทธิ์จัดการบัญชีผู้บริหาร'],
  ACCOUNT_NOT_FOUND: [404, 'ไม่พบบัญชีผู้บริหาร'],
  COMPANY_NOT_FOUND: [404, 'ไม่พบบริษัทนี้ในรายงาน'],
  ACCOUNT_ALREADY_EXISTS: [409, 'ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้แล้ว'],
  ACCOUNT_REVOKED: [409, 'บัญชีนี้ถูกปิดจากทางอื่นของระบบ หน้านี้เปิดคืนไม่ได้'],
  ACCOUNT_PROTECTED: [422, 'ไม่สามารถเปลี่ยนบัญชีผู้ดูแลระบบด้วยคำสั่งนี้ได้'],
  EXECUTIVE_SNAPSHOT_EXPIRED: [409, W.export.expired],
  EXECUTIVE_EXPORT_LIMIT_EXCEEDED: [422, W.export.limit],
  EXECUTIVE_EXPORT_EMPTY: [422, W.export.empty],
  SOURCE_UNAVAILABLE: [503, 'ระบบยังอ่านข้อมูลส่วนนี้ไม่ได้ กรุณาลองใหม่ภายหลัง'],
} as const;
/** `message` replaces the fixed text where a page needs other words for the same code (a report denies reading, not managing). */
export function executiveError(requestId: string, code: keyof typeof ERRORS, field?: string, message: string = ERRORS[code][1]): HttpException {
  return new HttpException({ code, message, requestId, ...(field ? { fieldErrors: { [field]: code } } : {}) }, ERRORS[code][0]);
}

@Injectable()
export class ExecutiveUsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(ctx: RequestContext, query: ExecutiveUserListQuery): Promise<ExecutiveUserListDto> {
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
      || (query.status !== undefined && !EXECUTIVE_ACCOUNT_STATUSES.includes(query.status))
      || (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 320))) {
      throw executiveError(ctx.requestId, 'EXECUTIVE_QUERY_INVALID');
    }
    const q = query.q?.trim();
    const rows = await this.prisma.client.companyMembership.findMany({
      where: {
        ...EXECUTIVE_MEMBER,
        user: { NOT: ADMIN_USER, ...(q ? { OR: ['username', 'displayName', 'email', 'phoneNumber'].map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}) },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: ACCOUNT_SELECT,
    });
    // ponytail: this is the small dedicated executive roster; compute status before filtering/paging.
    // Move status predicates into SQL if this ever becomes a large directory.
    const items = rows.map((row) => this.view(row)).filter((row) => !query.status || row.status === query.status);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: items.length, totalPages: Math.ceil(items.length / pageSize) } };
  }

  async detail(ctx: RequestContext, userId: string): Promise<ExecutiveUserView> {
    return this.view(await this.account(this.prisma.client, ctx, userId));
  }

  async create(ctx: RequestContext, body: ExecutiveUserCreateBody): Promise<ExecutiveUserCreateResult> {
    const username = body.username?.trim().toLowerCase();
    const displayName = body.displayName?.trim();
    let email: string | null;
    try { email = optionalLineContactEmail(body.email); }
    catch { throw executiveError(ctx.requestId, 'INVALID_INPUT', 'email'); }
    const phoneNumber = body.phoneNumber?.trim() || null;
    if (!username || !/^[a-z0-9._-]{3,40}$/.test(username)) throw executiveError(ctx.requestId, 'INVALID_INPUT', 'username');
    if (!displayName || displayName.length > 120) throw executiveError(ctx.requestId, 'INVALID_INPUT', 'displayName');
    if (phoneNumber && phoneNumber.length > 20) throw executiveError(ctx.requestId, 'INVALID_INPUT', 'phoneNumber');
    this.validateAccess(ctx, body);
    const temporaryPassword = generateTemporaryPassword();
    const expiresAt = temporaryPasswordExpiry(new Date());
    try {
      return await serializableTransaction(this.prisma.client, async (tx) => {
        const duplicate = await tx.user.findFirst({
          where: { OR: [{ username: { equals: username, mode: 'insensitive' } }, ...(email ? [{ email }] : [])] },
          select: { username: true },
        });
        if (duplicate) throw executiveError(ctx.requestId, 'ACCOUNT_ALREADY_EXISTS', duplicate.username?.toLowerCase() === username ? 'username' : 'email');
        const roles = await this.roles(tx, ctx);
        const user = await tx.user.create({ data: { username, displayName, email, phoneNumber, status: 'ACTIVE' }, select: { id: true } });
        await tx.userCredential.create({ data: { userId: user.id, passwordHash: hashTemporaryPassword(temporaryPassword), status: 'TEMPORARY', mustChangePassword: true, expiresAt } });
        const membership = await tx.companyMembership.create({ data: { userId: user.id, companyId: PLATFORM_TENANT_ID, status: 'ACTIVE' }, select: { id: true } });
        await tx.membershipRole.createMany({ data: roles.filter((role) => role.key === BASE_ROLE || (role.key === EXPORT_ROLE && body.canExport) || (role.key === CONTACT_ROLE && body.canSeeContacts))
          .map((role) => ({ membershipId: membership.id, roleId: role.id })) });
        const view = this.view(await this.account(tx, ctx, user.id));
        await this.log(tx, ctx, user.id, 'created', null, this.accessState(view), null);
        return { user: view, credential: { userId: user.id, username, temporaryPassword, expiresAt: expiresAt.toISOString() } };
      });
    } catch (error) {
      const field = uniqueConstraintFields(error)?.find((field) => field === 'username' || field === 'email');
      if (field) throw executiveError(ctx.requestId, 'ACCOUNT_ALREADY_EXISTS', field);
      throw error;
    }
  }

  async setStatus(ctx: RequestContext, userId: string, body: ExecutiveUserStatusBody): Promise<ExecutiveUserView> {
    const reason = this.reason(ctx, body.reason);
    if (!['ACTIVE', 'SUSPENDED'].includes(body.status)) throw executiveError(ctx.requestId, 'INVALID_INPUT', 'status');
    return serializableTransaction(this.prisma.client, async (tx) => {
      const current = await this.account(tx, ctx, userId, true);
      if (current.status === body.status) return this.view(current);
      await tx.companyMembership.update({ where: { id: current.id }, data: { status: body.status }, select: { id: true } });
      if (body.status === 'SUSPENDED') await revokeActiveSessions(tx.authSession, { userId });
      const updated = this.view(await this.account(tx, ctx, userId));
      await this.log(tx, ctx, userId, body.status === 'SUSPENDED' ? 'suspended' : 'reactivated',
        { membershipStatus: current.status }, { membershipStatus: body.status }, reason);
      return updated;
    });
  }

  async resetCredential(ctx: RequestContext, userId: string, body: ExecutiveUserReasonBody): Promise<ExecutiveUserCredential> {
    const reason = this.reason(ctx, body.reason);
    return serializableTransaction(this.prisma.client, async (tx) => {
      const current = await this.account(tx, ctx, userId, true);
      const temporaryPassword = generateTemporaryPassword();
      const expiresAt = temporaryPasswordExpiry(new Date());
      await tx.userCredential.update({ where: { userId }, data: {
        passwordHash: hashTemporaryPassword(temporaryPassword), status: 'TEMPORARY', mustChangePassword: true,
        expiresAt, tempPasswordEncrypted: null,
      }, select: { id: true } });
      await revokeActiveSessions(tx.authSession, { userId });
      await this.log(tx, ctx, userId, 'credential_issued', { status: current.user.credential?.status ?? null }, { status: 'TEMPORARY' }, reason);
      return { userId, username: current.user.username ?? '', temporaryPassword, expiresAt: expiresAt.toISOString() };
    });
  }

  async setAccess(ctx: RequestContext, userId: string, body: ExecutiveUserAccessBody): Promise<ExecutiveUserView> {
    const reason = this.reason(ctx, body.reason);
    this.validateAccess(ctx, body);
    return serializableTransaction(this.prisma.client, async (tx) => {
      const current = await this.account(tx, ctx, userId, true);
      const before = this.view(current);
      const roles = await this.roles(tx, ctx);
      const desired = roles.filter((role) => (role.key === EXPORT_ROLE && body.canExport) || (role.key === CONTACT_ROLE && body.canSeeContacts));
      const existing = current.roles.map(({ role }) => role.key);
      if ([EXPORT_ROLE, CONTACT_ROLE].every((key) => existing.includes(key) === desired.some((role) => role.key === key))) return before;
      await tx.membershipRole.deleteMany({ where: { membershipId: current.id, roleId: { in: roles.filter((role) => role.key !== BASE_ROLE && !desired.includes(role)).map((role) => role.id) } } });
      await tx.membershipRole.createMany({ data: desired.map((role) => ({ membershipId: current.id, roleId: role.id })), skipDuplicates: true });
      const after = this.view(await this.account(tx, ctx, userId));
      await this.log(tx, ctx, userId, 'access_changed', this.accessState(before), this.accessState(after), reason);
      return after;
    });
  }

  private async account(tx: Prisma.TransactionClient, ctx: RequestContext, userId: string, command = false): Promise<AccountRow> {
    if (command && await tx.user.findFirst({ where: { id: userId, ...ADMIN_USER }, select: { id: true } })) {
      throw executiveError(ctx.requestId, 'ACCOUNT_PROTECTED');
    }
    const row = await tx.companyMembership.findFirst({ where: { ...EXECUTIVE_MEMBER, userId, user: { NOT: ADMIN_USER } }, select: ACCOUNT_SELECT });
    if (!row) throw executiveError(ctx.requestId, 'ACCOUNT_NOT_FOUND');
    if (command && this.view(row).status === 'REVOKED') throw executiveError(ctx.requestId, 'ACCOUNT_REVOKED');
    return row;
  }

  private async roles(tx: Prisma.TransactionClient, ctx: RequestContext) {
    const rows = await tx.role.findMany({ where: { ...SYSTEM_ROLE, status: 'ACTIVE', key: { in: [...EXECUTIVE_ROLE_KEYS] } }, select: { id: true, key: true } });
    if (rows.length !== EXECUTIVE_ROLE_KEYS.length) throw executiveError(ctx.requestId, 'SOURCE_UNAVAILABLE');
    return rows;
  }

  private view(row: AccountRow): ExecutiveUserView {
    const credential = row.user.credential;
    let status: ExecutiveAccountStatus;
    if (row.user.status !== 'ACTIVE' || row.status === 'DISABLED' || !credential || credential.status === 'DISABLED') status = 'REVOKED';
    else if (row.status === 'SUSPENDED') status = 'SUSPENDED';
    else if (credential.status === 'TEMPORARY' || (credential.expiresAt && credential.expiresAt <= new Date())) status = 'PENDING_ACTIVATION';
    else status = 'ACTIVE';
    const permissions = new Set(row.roles.filter(({ role }) => role.status === 'ACTIVE').flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)));
    return { userId: row.userId, username: row.user.username ?? '', displayName: row.user.displayName,
      email: row.user.email, phoneNumber: row.user.phoneNumber, status,
      temporaryPasswordExpiresAt: status === 'PENDING_ACTIVATION' ? credential?.expiresAt?.toISOString() ?? null : null,
      canRead: permissions.has('system.executive.read'), canExport: permissions.has('system.executive.export'), canSeeContacts: permissions.has('system.executive.contact.read'),
      lastWebEntryAt: row.user.sessions[0]?.issuedAt.toISOString() ?? null };
  }

  private reason(ctx: RequestContext, reason: string): string {
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) throw executiveError(ctx.requestId, 'INVALID_INPUT', 'reason');
    return reason.trim();
  }

  private validateAccess(ctx: RequestContext, body: { canExport: boolean; canSeeContacts: boolean }): void {
    for (const field of ['canExport', 'canSeeContacts'] as const) if (typeof body[field] !== 'boolean') throw executiveError(ctx.requestId, 'INVALID_INPUT', field);
  }

  private accessState(view: ExecutiveUserView) {
    return { status: view.status, canRead: view.canRead, canExport: view.canExport, canSeeContacts: view.canSeeContacts };
  }

  private log(tx: Prisma.TransactionClient, ctx: RequestContext, userId: string, action: string,
    from: Record<string, unknown> | null, to: Record<string, unknown>, reason: string | null) {
    return this.audit.log({ actorUserId: ctx.userId, action: `executive.user.${action}`, targetType: 'User', targetId: userId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { from, to, reason } }, tx);
  }
}
