import { billingApprovalMode } from './billing-approval';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BillingOperatorScopeView, BillingScopeChange, BillingScopeDirectory } from '@watchdog-bms/contracts';
import type { BillingOperation, BillingOperatorScope, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingAdminService } from './billing-admin.service';
import { BillingService } from './billing.service';
import { BillingConfigurationService } from './billing-configuration.service';
import { billingError, hashBilling } from '../domain/billing-policy';

const TYPES = ['GRANT_SCOPE', 'REVOKE_SCOPE'];
const stale = () => billingError('CONTROL_PREVIEW_STALE', 'ข้อมูลสิทธิ์เปลี่ยนหรือรายการหมดอายุ กรุณาตรวจสอบใหม่');
const platformRole = { status: 'ACTIVE' as const, isSystem: true, scopeKey: 'system', companyId: null };
type Source = { scope: BillingOperatorScopeView | null; companyName: string; userName: string; capabilities: string[]; hash: string };
type Proposed = { userId: string; companyId: string; expiresAt: string | null; source: Source; membershipId: string; actorCompanyId: string; sessionId: string };

@Injectable()
export class BillingScopesService {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService, private readonly admin: BillingAdminService,
    private readonly configuration: BillingConfigurationService) {}
  private mode() { return { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode }; }
  private async manager(context: RequestContext, tx: Prisma.TransactionClient = this.prisma.client, approval = false) {
    const access = await this.admin.access(context, approval ? 'system.billing.approval.approve' : 'system.billing.read', tx);
    if (!access.canManageScopes) throw new ForbiddenException();
    if (!this.billing.stripe.enabled) throw billingError('CONTROL_PROVIDER_DISABLED', 'ยังไม่ได้ตั้งค่าบัญชีผู้ให้บริการ');
  }
  private scopeView(row: BillingOperatorScope, companyName: string, userName: string): BillingOperatorScopeView {
    return { id: row.id, companyId: row.companyId, companyName, userId: row.userId, userName, mode: row.livemode ? 'LIVE' : 'TEST', version: row.version,
      expiresAt: row.expiresAt?.toISOString() ?? null, state: row.revokedAt ? 'REVOKED' : row.expiresAt && row.expiresAt <= new Date() ? 'EXPIRED' : 'ACTIVE' };
  }
  private async source(tx: Prisma.TransactionClient, userId: string, companyId: string, grant: boolean): Promise<Source> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, status: true } });
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, status: true } });
    if (!user || !company) throw new NotFoundException();
    const members = await tx.companyMembership.findMany({ where: { userId, status: 'ACTIVE', company: { status: 'ACTIVE' } }, orderBy: { id: 'asc' },
      select: { id: true, companyId: true, status: true, roles: { where: { role: platformRole }, orderBy: { roleId: 'asc' }, include: {
        role: { include: { permissions: { orderBy: { permissionId: 'asc' }, include: { permission: true } } } } } } } });
    const roles = members.flatMap(m => m.roles.map(r => r.role));
    const capabilities = [...new Set(roles.flatMap(r => r.permissions.map(p => p.permission.key)).filter(p => p.startsWith('system.billing.')))].sort();
    if (grant && (user.status !== 'ACTIVE' || !capabilities.includes('system.billing.read') || roles.some(r => r.key === 'SYSTEM_ADMIN')))
      throw billingError('CONTROL_SCOPE_TARGET_INVALID', 'เลือกเจ้าหน้าที่ที่มี role ระดับระบบสำหรับงาน Billing อยู่แล้ว ผู้ดูแลระบบมีขอบเขตทั้งหมดอยู่แล้ว');
    const scope = await tx.billingOperatorScope.findUnique({ where: { userId_stripeAccountId_livemode_companyId: { userId, companyId, ...this.mode() } } });
    return { scope: scope ? this.scopeView(scope, company.name, user.displayName ?? user.id) : null, companyName: company.name, userName: user.displayName ?? user.id,
      capabilities, hash: hashBilling([user, company, members, scope]) };
  }
  async directory(context: RequestContext, kind: string, search: string, cursor?: string): Promise<BillingScopeDirectory> {
    await this.manager(context);
    if (!['companies', 'operators'].includes(kind) || typeof search !== 'string' || search.length > 100) throw new BadRequestException();
    if (kind === 'companies') {
      const where = search ? { OR: [{ id: { contains: search } }, { name: { contains: search, mode: 'insensitive' as const } }] } : {};
      if (cursor && !await this.prisma.client.company.findFirst({ where: { ...where, id: cursor } })) throw new NotFoundException();
      const rows = await this.prisma.client.company.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26, select: { id: true, name: true } });
      return { items: rows.slice(0,25), nextCursor: rows.length > 25 ? rows[24]!.id : null };
    }
    const where: Prisma.UserWhereInput = { status: 'ACTIVE', memberships: { some: { status: 'ACTIVE', company: { status: 'ACTIVE' }, roles: { some: { role: {
      ...platformRole, permissions: { some: { permission: { key: 'system.billing.read' } } } } } } } },
      NOT: { memberships: { some: { status: 'ACTIVE', company: { status: 'ACTIVE' }, roles: { some: { role: { ...platformRole, key: 'SYSTEM_ADMIN' } } } } } },
      ...(search ? { OR: [{ id: { contains: search } }, { displayName: { contains: search, mode: 'insensitive' } }] } : {}) };
    if (cursor && !await this.prisma.client.user.findFirst({ where: { ...where, id: cursor } })) throw new NotFoundException();
    const users = await this.prisma.client.user.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26, select: { id: true, displayName: true } });
    return { items: users.slice(0,25).map(u => ({ id: u.id, name: u.displayName ?? u.id })), nextCursor: users.length > 25 ? users[24]!.id : null };
  }
  async list(context: RequestContext, cursor?: string) {
    await this.manager(context);
    if (cursor && !await this.prisma.client.billingOperatorScope.findFirst({ where: { ...this.mode(), id: cursor } })) throw new NotFoundException();
    const rows = await this.prisma.client.billingOperatorScope.findMany({ where: { ...this.mode(), ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26 });
    return { items: await Promise.all(rows.slice(0,25).map(async r => {
      const [company,user] = await Promise.all([this.prisma.client.company.findUnique({ where: { id: r.companyId }, select: { name: true } }),
        this.prisma.client.user.findUnique({ where: { id: r.userId }, select: { displayName: true } })]);
      return this.scopeView(r,company?.name ?? r.companyId,user?.displayName ?? r.userId);
    })), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }
  private view(row: BillingOperation, context: RequestContext): BillingScopeChange {
    const p = row.proposedJson as unknown as Proposed;
    return { approvalMode: billingApprovalMode(row), id: row.id, type: row.type as BillingScopeChange['type'], state: row.state as BillingScopeChange['state'], version: row.version,
      previewHash: row.requestHash, mode: row.livemode ? 'LIVE' : 'TEST', companyId: p.companyId, companyName: p.source.companyName,
      userId: p.userId, userName: p.source.userName, capabilities: p.source.capabilities, current: p.source.scope, scopeExpiresAt: p.expiresAt,
      expiresAt: row.expiresAt.toISOString(), reason: row.reason, observedAt: row.observedAt?.toISOString() ?? null,
      allowedActions: [...(row.state === 'PREVIEW' && row.expiresAt > new Date() && row.initiatorUserId === context.userId ? ['submit' as const] : []),
        ...(row.state === 'AWAITING_APPROVAL' && row.expiresAt > new Date() && context.permissions.includes('system.billing.approval.approve') ? ['approve' as const] : []),
        ...(['PREVIEW','AWAITING_APPROVAL'].includes(row.state) ? ['cancel' as const] : [])] };
  }
  private async row(context: RequestContext, id: string, tx: Prisma.TransactionClient = this.prisma.client) {
    await this.manager(context,tx);
    const row = await tx.billingOperation.findFirst({ where: { id, ...this.mode(), type: { in: TYPES } } });
    if (!row) throw new NotFoundException(); return row;
  }
  async get(context: RequestContext, id: string) { return this.view(await this.row(context,id),context); }
  async changes(context: RequestContext, cursor?: string) {
    await this.manager(context); if (cursor) await this.row(context,cursor);
    const rows = await this.prisma.client.billingOperation.findMany({ where: { ...this.mode(), type: { in: TYPES }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26 });
    return { items: rows.slice(0,25).map(r => this.view(r,context)), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }
  async preview(context: RequestContext, input: { type: string; userId: string; companyId: string; expiresAt: string | null; reason: string }) {
    await this.manager(context);
    if (!TYPES.includes(input.type) || !input.userId || !input.companyId || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500 ||
      (input.expiresAt !== null && (typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()))) throw new BadRequestException();
    const source = await this.source(this.prisma.client,input.userId,input.companyId,input.type === 'GRANT_SCOPE');
    if (input.type === 'REVOKE_SCOPE' && !source.scope) throw new NotFoundException();
    const proposed: Proposed = { userId: input.userId, companyId: input.companyId, expiresAt: input.type === 'GRANT_SCOPE' && input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
      source, membershipId: context.membershipId!, actorCompanyId: context.companyId, sessionId: context.sessionId! };
    const row = await this.prisma.client.billingOperation.create({ data: { ...this.mode(), companyId: input.companyId, type: input.type,
      proposedJson: proposed as unknown as Prisma.InputJsonValue, sourceVersion: source.scope?.version ?? -1, reason: input.reason.trim(),
      initiatorUserId: context.userId, requestHash: hashBilling([input.type,proposed]), expiresAt: new Date(Date.now()+600000) } });
    return this.view(row,context);
  }
  async act(context: RequestContext, id: string, action: 'submit'|'approve'|'cancel', expectedVersion: number, previewHash: string, key?: string) {
    await this.row(context,id);
    if (!Number.isInteger(expectedVersion) || (action === 'submit' && !/^[a-zA-Z0-9_-]{16,120}$/.test(key ?? ''))) throw new BadRequestException();
    const row = await this.prisma.client.$transaction(async tx => {
      const candidate = await this.row(context,id,tx), p = candidate.proposedJson as unknown as Proposed;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing-scope:${candidate.stripeAccountId}:${candidate.livemode}:${p.companyId}:${p.userId}`}))`;
      const current = await this.row(context,id,tx);
      if (action === 'submit') {
        const replay = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: { ...this.mode(), idempotencyKey: key! } } });
        if (replay) { if (replay.id !== id || replay.requestHash !== previewHash || replay.initiatorUserId !== context.userId) throw stale(); return replay; }
      }
      if (action === 'approve' && current.state === 'SUCCEEDED' && current.approverUserId === context.userId && current.requestHash === previewHash) return current;
      if (current.version !== expectedVersion || !['PREVIEW','AWAITING_APPROVAL'].includes(current.state) || (action !== 'cancel' &&
        (current.expiresAt <= new Date() || current.requestHash !== previewHash))) throw stale();
      if (action === 'cancel') {
        const updated = await tx.billingOperation.update({ where: { id }, data: { state: 'CANCELLED', version: { increment: 1 } } });
        await this.audit(tx,context,updated,'cancelled'); return updated;
      }
      await this.configuration.requireProof(context,tx);
      if (action === 'submit' && (current.state !== 'PREVIEW' || current.initiatorUserId !== context.userId)) throw new ForbiddenException();
      if (action === 'approve') {
        if (current.state !== 'AWAITING_APPROVAL' || current.type !== 'GRANT_SCOPE') throw new ForbiddenException();
        await this.configuration.requireApprovalActor(current,context,'system.billing.read',tx,null);
        await this.manager(context,tx,true);
        const member = await tx.companyMembership.findUnique({ where: { id: p.membershipId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
        if (!member) throw new ForbiddenException();
        await this.manager({ ...context,userId:current.initiatorUserId,companyId:p.actorCompanyId,membershipId:member.id,sessionId:p.sessionId,
          permissions:member.roles.flatMap(r=>r.role.permissions.map(g=>g.permission.key)) },tx);
      }
      const source = await this.source(tx,p.userId,p.companyId,current.type === 'GRANT_SCOPE');
      if (source.hash !== p.source.hash || (p.expiresAt && Date.parse(p.expiresAt) <= Date.now())) throw stale();
      const execute = action === 'approve' || current.type === 'REVOKE_SCOPE';
      if (execute) {
        const identity = { ...this.mode(),userId:p.userId,companyId:p.companyId };
        if (source.scope) {
          const changed = await tx.billingOperatorScope.updateMany({ where: { ...identity,id:source.scope.id,version:source.scope.version },
            data: { revokedAt: current.type === 'REVOKE_SCOPE' ? new Date() : null,
              ...(current.type === 'GRANT_SCOPE' ? { expiresAt:p.expiresAt ? new Date(p.expiresAt) : null } : {}), version:{increment:1} } });
          if (!changed.count) throw stale();
        } else await tx.billingOperatorScope.create({ data:{...identity,expiresAt:p.expiresAt ? new Date(p.expiresAt) : null,createdByUserId:current.initiatorUserId} });
      }
      const updated = await tx.billingOperation.update({ where:{id},data:{state:execute?'SUCCEEDED':'AWAITING_APPROVAL',version:{increment:1},
        ...(action==='submit'?{idempotencyKey:key}:{}),...(action==='approve'?{approverUserId:context.userId}:{}),...(execute?{observedAt:new Date(),resultJson:{scopeApplied:true}}:{})} });
      await this.audit(tx,context,updated,execute?'applied':'submitted');return updated;
    });return this.view(row,context);
  }
  private audit(tx:Prisma.TransactionClient,context:RequestContext,row:BillingOperation,action:string) {
    const p=row.proposedJson as unknown as Proposed;
    return tx.auditLog.create({data:{companyId:p.companyId,actorUserId:context.userId,action:`billing.operator_scope.${action}`,targetType:'BillingOperation',targetId:row.id,
      requestId:context.requestId,result:'SUCCESS',riskLevel:'CRITICAL',metadataJson:{userId:p.userId,type:row.type,mode:row.livemode?'LIVE':'TEST',sourceHash:p.source.hash,reason:row.reason,approvalMode:billingApprovalMode(row),initiatorUserId:row.initiatorUserId,approverUserId:row.approverUserId}}});
  }
}
