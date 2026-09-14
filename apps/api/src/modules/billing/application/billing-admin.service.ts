import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BillingSupportOutcome, BillingSupportOutcomeInput, BillingOperatorCompany, BillingOperatorCompanyDetail, BillingOperatorIssue, BillingOperatorOverview, BillingProviderEventView } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingIssue, BillingOperation, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingService } from './billing.service';
import { billingError, hashBilling } from '../domain/billing-policy';
import { billingState } from '../domain/billing-state';
import { billingTimeline } from './billing-timeline';
import { issueOperators } from './billing-issue-ownership';

@Injectable()
export class BillingAdminService {
  constructor(private readonly prisma: PrismaService, private readonly billing: BillingService) {}

  async authorizeOperation(row:BillingOperation,permission:string,tx:Prisma.TransactionClient=this.prisma.client) {
    const proposed=row.proposedJson as {membershipId:string;actorCompanyId:string};
    const member=await tx.companyMembership.findFirstOrThrow({where:{id:proposed.membershipId,userId:row.initiatorUserId,status:'ACTIVE'},
      include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}});
    const context:RequestContext={userId:row.initiatorUserId,membershipId:member.id,companyId:proposed.actorCompanyId,requestId:row.id,
      authSubject:row.initiatorUserId,authProvider:'system',scopes:{},roles:[],permissions:member.roles.flatMap(r=>r.role.permissions.map(p=>p.permission.key))};
    const access=await this.access(context,permission,tx);
    if(row.stripeAccountId!==this.billing.stripe.accountId||row.livemode!==this.billing.stripe.livemode||
      (row.companyId ? !access.platformScope&&!access.companyIds.includes(row.companyId) : !['RETRY_PROVIDER_EVENT','SCAN_PROVIDER_EVENTS'].includes(row.type)||!access.platformScope))throw new ForbiddenException();
    return context;
  }

  async providerEvent(context: RequestContext, id: string, tx: Prisma.TransactionClient = this.prisma.client): Promise<BillingProviderEventView> {
    const access = await this.access(context, 'system.billing.read', tx);
    if (!access.platformScope) throw new NotFoundException();
    const row = await tx.billingProviderEvent.findFirst({ where: { id, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode } });
    if (!row) throw new NotFoundException();
    const issue = await tx.billingIssue.findFirst({ where: { stripeAccountId: row.stripeAccountId, livemode: row.livemode,
      companyId: null, kind: 'PROVIDER_EVENT_FAILED', referenceId: id } });
    return { id, mode: row.livemode ? 'LIVE' : 'TEST', eventType: row.eventType, state: row.status, attempts: row.attempts,
      receivedAt: row.receivedAt.toISOString(), processedAt: row.processedAt?.toISOString() ?? null, retryAt: row.retryAt.toISOString(),
      leaseUntil: row.leaseUntil?.toISOString() ?? null, errorCode: row.errorCode ? 'reconciliation_required' : null, issueId: issue?.id ?? null,
      sourceHash: hashBilling([row.id, row.status, row.attempts, row.leaseToken, row.leaseUntil, row.retryAt, row.processedAt, row.evidenceHash]),
      canRetry: access.capabilities.includes('system.billing.reconcile.run') && ['DEAD', 'RETRY', 'PROCESSING'].includes(row.status) && (!row.leaseUntil || row.leaseUntil <= new Date()) };
  }
  async providerEvents(context: RequestContext, cursor?: string, all = false) {
    const access = await this.access(context, 'system.billing.read');
    if (!access.platformScope) throw new NotFoundException();
    const where: Prisma.BillingProviderEventWhereInput = { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      ...all ? {} : { status: { not: 'PROCESSED' } } };
    if (cursor && !await this.prisma.client.billingProviderEvent.findFirst({ where: { ...where, id: cursor } })) throw new NotFoundException();
    const rows = await this.prisma.client.billingProviderEvent.findMany({ where: { ...where, ...cursor ? { id: { gt: cursor } } : {} }, orderBy: { id: 'asc' }, take: 26 });
    return { items: await Promise.all(rows.slice(0, 25).map(row => this.providerEvent(context, row.id))), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }

  private async issueView(row:BillingIssue,tx:Prisma.TransactionClient=this.prisma.client):Promise<BillingOperatorIssue> {
    const ids=[...new Set([row.assigneeUserId,row.backupUserId].filter((id):id is string=>Boolean(id)))];
    const users=ids.length?await tx.user.findMany({where:{id:{in:ids}},select:{id:true,displayName:true}}):[];
    const available=await issueOperators(tx,row,{ids});
    return {id:row.id,companyId:row.companyId,kind:row.kind,reference:row.referenceId,state:row.state,assigneeUserId:row.assigneeUserId,note:row.note,version:row.version,
      createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),episode:row.episode,lastSeenAt:row.lastSeenAt.toISOString(),
      assigneeName:users.find(u=>u.id===row.assigneeUserId)?.displayName??row.assigneeUserId,assigneeAvailable:available.items.some(u=>u.id===row.assigneeUserId),
      backupUserId:row.backupUserId,backupName:users.find(u=>u.id===row.backupUserId)?.displayName??row.backupUserId,backupAvailable:available.items.some(u=>u.id===row.backupUserId),
      priority:row.priority as BillingOperatorIssue['priority'],followUpAt:row.followUpAt?.toISOString()??null,overdue:row.state!=='RESOLVED'&&Boolean(row.followUpAt&&row.followUpAt<=new Date())};
  }

  async access(context: RequestContext, permission: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const member = await tx.companyMembership.findFirst({ where: { id: context.membershipId, userId: context.userId, companyId: context.companyId, status: 'ACTIVE' },
      include: { company: true, user: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    if (!member || member.user.status !== 'ACTIVE' || member.company.status !== 'ACTIVE') throw new ForbiddenException();
    const roles = member.roles.map(r => r.role).filter(r => r.status === 'ACTIVE' && r.isSystem && r.scopeKey === 'system' && r.companyId === null);
    const capabilities = [...new Set(roles.flatMap(r => r.permissions.map(p => p.permission.key)))].filter(p => p.startsWith('system.billing.') && context.permissions.includes(p));
    if (!capabilities.includes(permission) || !context.permissions.includes(permission)) throw new ForbiddenException();
    const platformScope = roles.some(r => r.key === 'SYSTEM_ADMIN');
    const companyIds = platformScope || !this.billing.stripe.enabled ? [] : (await tx.billingOperatorScope.findMany({ where: {
      userId: context.userId, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode, revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    }, select: { companyId: true } })).map(s => s.companyId);
    const canManageScopes=context.permissions.includes('admin.role.manage') && roles.some(r=>r.key==='SYSTEM_ADMIN' && r.permissions.some(p=>p.permission.key==='admin.role.manage'));
    return { capabilities, platformScope, companyIds, canManageScopes };
  }
  private companyWhere(access: Awaited<ReturnType<BillingAdminService['access']>>, search = ''): Prisma.CompanyWhereInput {
    return { ...(access.platformScope ? {} : { id: { in: access.companyIds } }),
      ...(search ? { OR: [{ id: { contains: search } }, { name: { contains: search, mode: 'insensitive' } }] } : {}) };
  }
  private async companyView(company: Prisma.CompanyGetPayload<{ include: { planTerm: true } }>, account: BillingAccount | null): Promise<BillingOperatorCompany> {
    const invoice = account ? await this.prisma.client.billingInvoice.findFirst({ where: { billingAccountId: account.id }, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }] }) : null;
    const activeAttempt = account?.activeAttemptId ? await this.prisma.client.billingAttempt.findFirst({ where: { id: account.activeAttemptId, billingAccountId: account.id } }) : null;
    const purchaseId=invoice?.sourceAttemptId??account?.contractAttemptId;
    const purchase = activeAttempt ?? (purchaseId ? await this.prisma.client.billingAttempt.findFirst({ where: { id: purchaseId, billingAccountId: account!.id } }) : null);
    const term = company.planTerm;
    return { accountId: account?.id ?? null, companyId: company.id, companyName: company.name,
      mode: this.billing.stripe.enabled ? (this.billing.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED', version: account?.version ?? 0,
      ...billingState(company,account,invoice,activeAttempt), subscriptionState: account?.subscriptionState ?? 'NONE',
      paidThrough: account?.paidThrough?.toISOString() ?? null, nextChargeAt: account?.nextChargeAt?.toISOString() ?? null,
      observedAt: account?.observedAt?.toISOString() ?? null, tierKey: term?.tierKey ?? null, termEndsAt: term?.termEndsAt.toISOString() ?? null,
      companyStatus: company.status, pendingAttemptId: account?.activeAttemptId ?? null,
      source: term?.billingReceiptAccountId ? (term.billingReceiptAccountId === account?.id ? 'STRIPE' : 'OTHER_BILLING') : term?.tierKey === 'FREE_TRIAL_15' ? 'TRIAL' : term ? 'MANUAL' : 'NONE',
      graceEndsAt: account?.graceEndsAt?.toISOString() ?? null, cancelEffectiveAt: account?.cancelAtPeriodEnd ? account.paidThrough?.toISOString() ?? null : null,
      origin: purchase?.channel === 'web' || purchase?.channel === 'line' ? purchase.channel : null,
      branchLimit: term?.branchLimit ?? null, employeeLimit: term?.employeeLimit ?? null,
      pendingPlanChangeId: account?.pendingPlanChangeId ?? null, collectionOperationId: account?.activeCollectionOperationId ?? null };
  }
  async overview(context: RequestContext, cursor?: string, search = ''): Promise<BillingOperatorOverview> {
    const access = await this.access(context, 'system.billing.read');
    if (typeof search !== 'string' || search.length > 100) throw new BadRequestException();
    const where = this.companyWhere(access,search);
    if (cursor && !await this.prisma.client.company.findFirst({ where: { ...where, AND: { id: cursor } } })) throw new NotFoundException();
    const companies = await this.prisma.client.company.findMany({ where: { ...where, ...(cursor ? { AND: { id: { gt: cursor } } } : {}) },
      orderBy: { id: 'asc' }, take: 26, include: { planTerm: true } });
    const accounts = this.billing.stripe.enabled ? await this.prisma.client.billingAccount.findMany({ where: { stripeAccountId: this.billing.stripe.accountId,
      livemode: this.billing.stripe.livemode, companyId: { in: companies.slice(0,25).map(c=>c.id) } } }) : [];
    return { mode: this.billing.stripe.enabled ? (this.billing.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED', capabilities: access.capabilities,
      platformScope: access.platformScope, canManageScopes: access.canManageScopes,
      companies: await Promise.all(companies.slice(0,25).map(c => this.companyView(c,accounts.find(a=>a.companyId===c.id) ?? null))),
      nextCursor: companies.length > 25 ? companies[24]!.id : null };
  }
  private async scopedCompany(context: RequestContext, companyId: string) {
    const access = await this.access(context, 'system.billing.read');
    const company = await this.prisma.client.company.findFirst({ where: { ...this.companyWhere(access), AND: { id: companyId } }, include: { planTerm: true } });
    if (!company) throw new NotFoundException();
    const account = this.billing.stripe.enabled ? await this.billing.account(companyId) : null;
    return { access, company, account };
  }
  async timeline(context: RequestContext, companyId: string, cursor?: string) {
    const { access, account } = await this.scopedCompany(context,companyId);
    return billingTimeline(this.prisma.client, { companyId, accountId: account?.id ?? null,
      stripeAccountId: this.billing.stripe.enabled ? this.billing.stripe.accountId : null, livemode: this.billing.stripe.livemode,
      financial: access.capabilities.includes('system.billing.financial.read'), audit: access.capabilities.includes('system.billing.audit.read'), cursor });
  }
  async company(context: RequestContext, companyId: string, invoiceCursor?: string): Promise<BillingOperatorCompanyDetail> {
    const { access, account, company } = await this.scopedCompany(context,companyId);
    const issues = this.billing.stripe.enabled ? await this.prisma.client.billingIssue.findMany({ where: { companyId, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      state: { not: 'RESOLVED' } }, orderBy: { createdAt: 'desc' }, take: 25 }) : [];
    let financial: BillingOperatorCompanyDetail['financial'] = null;
    if (access.capabilities.includes('system.billing.financial.read') && context.permissions.includes('system.billing.financial.read')) {
      if (invoiceCursor && !account) throw new NotFoundException();
      const cursor = invoiceCursor && account ? await this.prisma.client.billingInvoice.findFirst({ where: { id: invoiceCursor, billingAccountId: account.id } }) : null;
      if (invoiceCursor && !cursor) throw new NotFoundException();
      const rows = account ? await this.prisma.client.billingInvoice.findMany({ where: { billingAccountId: account.id,
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26 }) : [];
      financial = { invoices: rows.slice(0, 25).map(r => ({ id: r.id, number: r.providerNumber, currency: 'THB', amountSatang: r.totalSatang,
        refundedSatang: r.refundedSatang, disputed: r.disputed, financialObservedAt: r.financialObservedAt?.toISOString() ?? null,
        paymentState: r.providerStatus, applyState: r.applyStatus, periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString(),
        createdAt: r.createdAt.toISOString(), hasDocuments: r.providerStatus === 'paid' })), nextCursor: rows.length > 25 ? rows[24]!.id : null };
    } else if (invoiceCursor) throw new ForbiddenException();
    return { ...await this.companyView(company,account), usage: await this.billing.usage(companyId), issues: await Promise.all(issues.map(i=>this.issueView(i))), financial };
  }
  async issues(context: RequestContext, input: { cursor?: string; companyId?: string; state?: string; queue?: 'UNASSIGNED'|'OVERDUE' }) {
    const access = await this.access(context, 'system.billing.read');
    if (!this.billing.stripe.enabled) return { items: [], nextCursor: null };
    if (input.companyId && !access.platformScope && !access.companyIds.includes(input.companyId)) throw new NotFoundException();
    const where: Prisma.BillingIssueWhereInput = { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      ...(!access.platformScope ? { companyId: { in: access.companyIds } } : {}), ...(input.companyId ? { companyId: input.companyId } : {}),
      state: input.state ?? { not: 'RESOLVED' }, ...(input.queue==='UNASSIGNED'?{assigneeUserId:null}:{}),
      ...(input.queue==='OVERDUE'?{followUpAt:{lte:new Date()},state:{not:'RESOLVED'}}:{}) };
    if (input.cursor && !await this.prisma.client.billingIssue.findFirst({ where: { ...where, id: input.cursor } })) throw new NotFoundException();
    const rows = await this.prisma.client.billingIssue.findMany({ where: { ...where, ...(input.cursor ? { id: { gt: input.cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26 });
    return { items: await Promise.all(rows.slice(0, 25).map(i=>this.issueView(i))), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }
  async issue(context: RequestContext, id: string) {
    const access = await this.access(context, 'system.billing.read');
    const row = await this.prisma.client.billingIssue.findFirst({ where: { id, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      ...(access.platformScope ? {} : { companyId: { in: access.companyIds } }) } });
    if (!row) throw new NotFoundException(); return this.issueView(row);
  }
  async assignees(context:RequestContext,id:string,search:string,cursor?:string) {
    await this.access(context,'system.billing.issue.manage');
    await this.issue(context,id);
    const row=await this.prisma.client.billingIssue.findUniqueOrThrow({where:{id}});
    if(search.length>100)throw new BadRequestException();
    return issueOperators(this.prisma.client,row,{search,cursor});
  }
  async updateIssue(context: RequestContext, id: string, input: { expectedVersion: number; state: string; note: string; assigneeUserId: string | null;
    backupUserId?:string|null;priority?:string;followUpAt?:string|null }) {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || !['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PROVIDER', 'WAITING_APPROVAL', 'WAITING_CUSTOMER', 'VERIFYING'].includes(input.state) ||
        (input.state === 'ASSIGNED' && !input.assigneeUserId) || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 1000 ||
        (input.assigneeUserId !== null && (typeof input.assigneeUserId !== 'string' || input.assigneeUserId.length > 128))) throw new BadRequestException('Invalid issue update');
    return this.prisma.client.$transaction(async tx => {
      const access = await this.access(context, 'system.billing.issue.manage', tx);
      const row = await tx.billingIssue.findFirst({ where: { id, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
        ...(access.platformScope ? {} : { companyId: { in: access.companyIds } }) } });
      if (!row) throw new NotFoundException();
      const backupUserId=input.backupUserId===undefined?row.backupUserId:input.backupUserId;
      if ((backupUserId!==null&&(typeof backupUserId!=='string'||backupUserId.length>128)) ||
        (input.priority!==undefined&&!['NORMAL','HIGH','CRITICAL'].includes(input.priority)) ||
        (input.followUpAt!==undefined&&input.followUpAt!==null&&(typeof input.followUpAt!=='string'||!Number.isFinite(Date.parse(input.followUpAt))||Date.parse(input.followUpAt)<=Date.now())) ||
        (backupUserId&&backupUserId===input.assigneeUserId)) throw new BadRequestException('Invalid priority, follow-up or backup');
      const targets=[...new Set([input.assigneeUserId,backupUserId].filter((value):value is string=>Boolean(value)))];
      const eligible=await issueOperators(tx,row,{ids:targets});
      if(eligible.items.length!==targets.length)throw billingError('CONTROL_ASSIGNEE_REVIEW','ผู้รับงานหรือผู้สำรองไม่มีสิทธิ์ดูแลบริษัทนี้แล้ว กรุณาเลือกใหม่หรือคืนเคสเข้าคิว');
      const changed = await tx.billingIssue.updateMany({ where: { id, version: input.expectedVersion, state: { not: 'RESOLVED' } },
        data: { state: input.state, note: input.note.trim(), assigneeUserId: input.assigneeUserId,backupUserId,
          ...(input.priority===undefined?{}:{priority:input.priority}),...(input.followUpAt===undefined?{}:{followUpAt:input.followUpAt?new Date(input.followUpAt):null}),version: { increment: 1 } } });
      if (changed.count !== 1) throw billingError('CONTROL_PREVIEW_STALE', 'เคสเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
      await tx.auditLog.create({ data: { companyId: row.companyId ?? context.companyId, actorUserId: context.userId, action: 'billing.issue.updated',
        targetType: 'BillingIssue', targetId: id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { before: { state: row.state, assigneeUserId: row.assigneeUserId,backupUserId:row.backupUserId,priority:row.priority,followUpAt:row.followUpAt?.toISOString()??null, version: row.version },
          after: { state: input.state, assigneeUserId: input.assigneeUserId,backupUserId,priority:input.priority??row.priority,followUpAt:input.followUpAt===undefined?row.followUpAt?.toISOString()??null:input.followUpAt, version: row.version + 1 }, reason: input.note.trim() } } });
      return this.issueView(await tx.billingIssue.findUniqueOrThrow({ where: { id } }),tx);
    });
  }
  private async outcomeIssue(context:RequestContext,id:string,permission:string,tx:Prisma.TransactionClient=this.prisma.client) {
    const access=await this.access(context,permission,tx);
    const row=await tx.billingIssue.findFirst({where:{id,stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,
      ...(access.platformScope?{}:{companyId:{in:access.companyIds}})}});
    if(!row)throw new NotFoundException();return row;
  }
  private outcomeView(row:BillingOperation,issue:BillingIssue,actorId:string,canManage:boolean):BillingSupportOutcome {
    const source=row.proposedJson as {episode:number;kind:BillingSupportOutcomeInput['kind'];note:string};
    const owned=canManage&&row.initiatorUserId===actorId, pending=row.state==='PREVIEW';
    return {id:row.id,issueId:issue.id,companyId:row.companyId,mode:row.livemode?'LIVE':'TEST',episode:source.episode,sourceVersion:row.sourceVersion,
      kind:source.kind,note:source.note,actorUserId:row.initiatorUserId,createdAt:row.createdAt.toISOString(),recordedAt:row.observedAt?.toISOString()??null,
      expiresAt:row.expiresAt.toISOString(),version:row.version,state:row.state as BillingSupportOutcome['state'],previewHash:row.requestHash,
      canSubmit:owned&&pending&&row.expiresAt>new Date()&&row.sourceVersion===issue.version&&source.episode===issue.episode,canCancel:owned&&pending};
  }
  private async outcomeRow(tx:Prisma.TransactionClient,issue:BillingIssue,id:string) {
    const row=await tx.billingOperation.findFirst({where:{id,type:'RECORD_SUPPORT_OUTCOME',referenceId:issue.id,companyId:issue.companyId,
      stripeAccountId:issue.stripeAccountId,livemode:issue.livemode}});
    if(!row)throw new NotFoundException();return row;
  }
  async supportOutcomes(context:RequestContext,issueId:string,cursor?:string) {
    const issue=await this.outcomeIssue(context,issueId,'system.billing.read');
    const access=await this.access(context,'system.billing.read');
    const anchor=cursor?await this.outcomeRow(this.prisma.client,issue,cursor):null;
    const rows=await this.prisma.client.billingOperation.findMany({where:{type:'RECORD_SUPPORT_OUTCOME',referenceId:issue.id,companyId:issue.companyId,
      stripeAccountId:issue.stripeAccountId,livemode:issue.livemode,...anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{}},
      orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    return {items:rows.slice(0,25).map(row=>this.outcomeView(row,issue,context.userId,access.capabilities.includes('system.billing.issue.manage'))),nextCursor:rows.length>25?rows[24]!.id:null};
  }
  async supportOutcome(context:RequestContext,issueId:string,id:string) {
    const issue=await this.outcomeIssue(context,issueId,'system.billing.read'),access=await this.access(context,'system.billing.read');
    return this.outcomeView(await this.outcomeRow(this.prisma.client,issue,id),issue,context.userId,access.capabilities.includes('system.billing.issue.manage'));
  }
  async previewSupportOutcome(context:RequestContext,issueId:string,input:BillingSupportOutcomeInput,key:string) {
    if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<0||!['CUSTOMER_CONTACTED','PROVIDER_CONTACTED','REPLY_RECORDED','REVIEW_REQUESTED'].includes(input.kind)||
      typeof input.note!=='string'||!input.note.trim()||input.note.length>1000||!key||!/^[A-Za-z0-9:_-]{8,120}$/.test(key))throw new BadRequestException();
    const note=input.note.trim(),requestHash=hashBilling([issueId,context.userId,input.expectedVersion,input.kind,note]);
    const idempotencyKey=`support:${issueId}:${key}`;
    return this.prisma.client.$transaction(async tx=>{
      const issue=await this.outcomeIssue(context,issueId,'system.billing.issue.manage',tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey},0))`;
      await this.outcomeIssue(context,issueId,'system.billing.issue.manage',tx);
      const existing=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{stripeAccountId:issue.stripeAccountId,livemode:issue.livemode,idempotencyKey}}});
      if(existing){
        if(existing.type!=='RECORD_SUPPORT_OUTCOME'||existing.referenceId!==issue.id||existing.companyId!==issue.companyId||existing.initiatorUserId!==context.userId||existing.requestHash!==requestHash)throw billingError('CONTROL_PREVIEW_STALE','คำขอนี้มีข้อมูลต่างจากรายการเดิม กรุณาเปิดรายการเดิม');
        return this.outcomeView(existing,issue,context.userId,true);
      }
      if(issue.version!==input.expectedVersion)throw billingError('CONTROL_PREVIEW_STALE','เคสเปลี่ยนแล้ว กรุณาโหลดเคสและตรวจข้อมูลใหม่');
      const row=await tx.billingOperation.create({data:{type:'RECORD_SUPPORT_OUTCOME',referenceId:issue.id,companyId:issue.companyId,stripeAccountId:issue.stripeAccountId,
        livemode:issue.livemode,sourceVersion:issue.version,reason:note,initiatorUserId:context.userId,idempotencyKey,requestHash,expiresAt:new Date(Date.now()+600000),
        proposedJson:{episode:issue.episode,kind:input.kind,note,membershipId:context.membershipId,actorCompanyId:context.companyId}}});
      await tx.auditLog.create({data:{companyId:issue.companyId,actorUserId:context.userId,action:'billing.support_outcome.previewed',targetType:'BillingIssue',
        targetId:issue.id,requestId:context.requestId,result:'SUCCESS',riskLevel:'MEDIUM',metadataJson:{operationId:row.id,episode:issue.episode,kind:input.kind,caseVersion:issue.version}}});
      return this.outcomeView(row,issue,context.userId,true);
    });
  }
  async commitSupportOutcome(context:RequestContext,issueId:string,id:string,input:{expectedVersion:number;previewHash?:string},cancel=false) {
    if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<0||(!cancel&&typeof input.previewHash!=='string'))throw new BadRequestException();
    return this.prisma.client.$transaction(async tx=>{
      const issue=await this.outcomeIssue(context,issueId,'system.billing.issue.manage',tx);
      await tx.$queryRaw`SELECT id FROM "BillingOperation" WHERE id=${id} FOR UPDATE`;
      await this.outcomeIssue(context,issueId,'system.billing.issue.manage',tx);
      const row=await this.outcomeRow(tx,issue,id),source=row.proposedJson as {episode:number;kind:string};
      if(row.initiatorUserId!==context.userId)throw new ForbiddenException();
      if(!cancel&&input.previewHash!==row.requestHash)throw billingError('CONTROL_PREVIEW_STALE','ข้อมูลตรวจสอบไม่ตรงกับรายการเดิม');
      if(row.state===(cancel?'CANCELLED':'SUCCEEDED'))return this.outcomeView(row,issue,context.userId,true);
      if(row.state!=='PREVIEW'||row.version!==input.expectedVersion||(!cancel&&(row.expiresAt<=new Date()||row.sourceVersion!==issue.version||source.episode!==issue.episode)))throw billingError('CONTROL_PREVIEW_STALE','เคสหรือคำขอเปลี่ยนแล้ว กรุณาตรวจข้อมูลใหม่');
      if(!cancel){const changed=await tx.billingIssue.updateMany({where:{id:issue.id,version:row.sourceVersion,episode:source.episode},data:{version:{increment:1}}});
        if(changed.count!==1)throw billingError('CONTROL_PREVIEW_STALE','เคสเปลี่ยนแล้ว กรุณาตรวจข้อมูลใหม่');}
      const result=await tx.billingOperation.update({where:{id:row.id,version:row.version,state:'PREVIEW'},data:{state:cancel?'CANCELLED':'SUCCEEDED',version:{increment:1},observedAt:new Date(),
        resultJson:{issueId:issue.id,episode:source.episode,caseState:issue.state,financialMutation:false}}});
      await tx.auditLog.create({data:{companyId:issue.companyId,actorUserId:context.userId,action:cancel?'billing.support_outcome.cancelled':'billing.support_outcome.recorded',
        targetType:'BillingIssue',targetId:issue.id,requestId:context.requestId,result:'SUCCESS',riskLevel:'MEDIUM',
        metadataJson:{operationId:row.id,episode:source.episode,kind:source.kind,caseVersion:issue.version,caseState:issue.state,financialMutation:false}}});
      return this.outcomeView(result,issue,context.userId,true);
    });
  }

}
