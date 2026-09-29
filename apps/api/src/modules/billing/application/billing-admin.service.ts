import { effectivePlanCapacity } from '../../system-partner-management/domain/logic/plan-capacity';
import { billingHistoryExport } from './billing-history-export';
import { readInvoiceAdjustments, readInvoiceDocument, sameInvoiceSource } from './billing-invoice-details';
import { billingRepairTypes } from './billing-reconcile-command';
import { planTermLockReason, planTermState, type BillingAdjustmentKind } from '@watchdog-bms/contracts';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BillingSupportOutcome, BillingSupportOutcomeInput, BillingOperatorCompany, BillingOperatorCompanyDetail, BillingOperatorIssue, BillingOperatorOverview, BillingProviderEventView, BillingReferenceLookup } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingIssue, BillingOperation, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingService, latestPackageInvoice } from './billing.service';
import { billingError, hashBilling } from '../domain/billing-policy';
import { billingState } from '../domain/billing-state';
import { billingTimeline } from './billing-timeline';
import { issueOperators } from './billing-issue-ownership';
import { effectiveIssueFollowUp, issuePriorityDeadline } from './billing-issues';

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
      (row.companyId ? !access.platformScope&&!access.companyIds.includes(row.companyId) : !['RETRY_PROVIDER_EVENT','SCAN_PROVIDER_EVENTS','CONFIGURE_PROVIDER_SCANS'].includes(row.type)||!access.platformScope))throw new ForbiddenException();
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

  private async issueView(row:BillingIssue,tx:Prisma.TransactionClient=this.prisma.client,companyName?:string|null):Promise<BillingOperatorIssue> {
    const ids=[...new Set([row.assigneeUserId,row.backupUserId].filter((id):id is string=>Boolean(id)))];
    const users=ids.length?await tx.user.findMany({where:{id:{in:ids}},select:{id:true,displayName:true}}):[];
    const available=await issueOperators(tx,row,{ids});
    const operation=['CONTROL_OPERATION_REVIEW','CUSTOMER_COLLECTION_REVIEW'].includes(row.kind)?await tx.billingOperation.findFirst({where:{id:row.referenceId,companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode},select:{type:true}}):null;
    const name=companyName===undefined&&row.companyId?(await tx.company.findUnique({where:{id:row.companyId},select:{name:true}}))?.name??null:companyName??null;
    return {id:row.id,companyId:row.companyId,companyName:name,...['CONTROL_OPERATION_REVIEW','CUSTOMER_COLLECTION_REVIEW'].includes(row.kind)?{operationType:operation?.type??null}:{},kind:row.kind,reference:row.referenceId,state:row.state,assigneeUserId:row.assigneeUserId,note:row.note,version:row.version,
      createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),episode:row.episode,lastSeenAt:row.lastSeenAt.toISOString(),
      assigneeName:users.find(u=>u.id===row.assigneeUserId)?.displayName??row.assigneeUserId,assigneeAvailable:available.items.some(u=>u.id===row.assigneeUserId),
      backupUserId:row.backupUserId,backupName:users.find(u=>u.id===row.backupUserId)?.displayName??row.backupUserId,backupAvailable:available.items.some(u=>u.id===row.backupUserId),
      priority:row.priority as BillingOperatorIssue['priority'],followUpAt:row.followUpAt?.toISOString()??null,
      slaDueAt:row.slaDueAt?.toISOString()??null,slaStartedAt:row.slaStartedAt?.toISOString()??null,slaPolicyRevisionId:row.slaPolicyRevisionId,
      effectiveFollowUpAt:effectiveIssueFollowUp(row)?.toISOString()??null,overdue:row.state!=='RESOLVED'&&Boolean(effectiveIssueFollowUp(row)&&effectiveIssueFollowUp(row)!<=new Date())};
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
    const invoice = account ? await latestPackageInvoice(this.prisma.client, { billingAccountId: account.id }) : null;
    const activeAttempt = account?.activeAttemptId ? await this.prisma.client.billingAttempt.findFirst({ where: { id: account.activeAttemptId, billingAccountId: account.id } }) : null;
    const purchaseId=invoice?.sourceAttemptId??account?.contractAttemptId;
    const purchase = activeAttempt ?? (purchaseId ? await this.prisma.client.billingAttempt.findFirst({ where: { id: purchaseId, billingAccountId: account!.id } }) : null);
    const term = company.planTerm;
    return { accountId: account?.id ?? null, companyId: company.id, companyName: company.name,
      mode: this.billing.stripe.enabled ? (this.billing.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED', version: account?.version ?? 0,
      ...billingState(company,account,invoice,activeAttempt), subscriptionState: account?.subscriptionState ?? 'NONE',
      renewalMode: (account?.renewalMode !== 'NONE' ? account?.renewalMode : account?.baseSubscriptionId ? 'CARD_AUTO' : 'NONE') as BillingOperatorCompany['renewalMode'],
      paidThrough: account?.paidThrough?.toISOString() ?? null, nextChargeAt: account?.nextChargeAt?.toISOString() ?? null,
      observedAt: account?.observedAt?.toISOString() ?? null, effectiveCapacity: term ? effectivePlanCapacity(term) : null, tierKey: term?.tierKey ?? null, termEndsAt: term?.termEndsAt.toISOString() ?? null,
      companyStatus: company.status, pendingAttemptId: account?.activeAttemptId ?? null,
      // S43/D-P3-6: 'DEAL' when the attempt that IS the current contract carries a sales-deal
      // snapshot. Read next to `renewalMode`, which still says how the shop pays.
      source: term?.billingReceiptAccountId ? (term.billingReceiptAccountId === account?.id
        ? (purchase?.id === account?.contractAttemptId && (purchase?.quoteSnapshot as { deal?: unknown } | null)?.deal ? 'DEAL' : 'STRIPE')
        : 'OTHER_BILLING') : term && planTermLockReason(term) === 'no_package' ? 'NONE' : term?.tierKey === 'FREE_TRIAL_15' ? 'TRIAL' : term ? 'MANUAL' : 'NONE',
      planState: planTermState(term, new Date(), company.status),
      graceEndsAt: account?.graceEndsAt?.toISOString() ?? null, cancelEffectiveAt: account?.cancelAtPeriodEnd ? account.paidThrough?.toISOString() ?? null : null,
      origin: purchase?.channel === 'web' || purchase?.channel === 'line' ? purchase.channel : null,
      branchLimit: term?.branchLimit ?? null, employeeLimit: term?.employeeLimit ?? null,
      pendingPlanChangeId: account?.pendingPlanChangeId ?? null, collectionOperationId: account?.activeCollectionOperationId ?? null };
  }
  async overview(context: RequestContext, cursor?: string, search = '', page?: number): Promise<BillingOperatorOverview> {
    const access = await this.access(context, 'system.billing.read');
    if (typeof search !== 'string' || search.length > 100) throw new BadRequestException();
    if (page !== undefined && (cursor || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000)) throw new BadRequestException();
    const where = this.companyWhere(access,search);
    if (cursor && !await this.prisma.client.company.findFirst({ where: { ...where, AND: { id: cursor } } })) throw new NotFoundException();
    const [companies, total] = await Promise.all([
      this.prisma.client.company.findMany({ where: { ...where, ...(cursor ? { AND: { id: { gt: cursor } } } : {}) },
        ...(page === undefined ? {} : { skip: (page - 1) * 25 }),
        orderBy: { id: 'asc' }, take: 26, include: { planTerm: true } }),
      page === undefined ? undefined : this.prisma.client.company.count({ where }),
    ]);
    const accounts = this.billing.stripe.enabled ? await this.prisma.client.billingAccount.findMany({ where: { stripeAccountId: this.billing.stripe.accountId,
      livemode: this.billing.stripe.livemode, companyId: { in: companies.slice(0,25).map(c=>c.id) } } }) : [];
    return { mode: this.billing.stripe.enabled ? (this.billing.stripe.livemode ? 'LIVE' : 'TEST') : 'DISABLED', capabilities: access.capabilities,
      platformScope: access.platformScope, canManageScopes: access.canManageScopes,
      companies: await Promise.all(companies.slice(0,25).map(c => this.companyView(c,accounts.find(a=>a.companyId===c.id) ?? null))),
      ...(page === undefined ? {} : { pagination: { page, pageSize: 25, total: total! } }),
      nextCursor: companies.length > 25 ? companies[24]!.id : null };
  }
  /** PR E (R-E4, RV27): find by the 8-char suffix the customer sees (`billingSupportReference`), a
   *  provider id, or an invoice number. Out of scope or not found both answer with an empty 404 —
   *  the lookup itself must not confirm a reference exists outside the caller's companies. */
  private ambiguous() { return billingError('BILLING_LOOKUP_AMBIGUOUS', 'เลขอ้างอิงนี้ตรงหลายรายการ ให้ใช้เลขใบแจ้งหนี้หรือรหัสเต็ม'); }
  // Route table mirrors billingTimeline()'s href switch (billing-timeline.ts) and
  // BillingIssueResolutionPanel's operationType switch: only these operation types have their
  // own admin detail page. Anything else (SCHEDULE_PRICE_RETURN, APPLY_PLAN_MENUS,
  // CUSTOMER_PROFILE_SYNC, CHECK_PROVIDER_CONFIGURATION, and a customer-created
  // UPDATE_BILLING_EMAIL) falls back to the company's admin billing page.
  private async lookupResult(kind: BillingReferenceLookup['kind'], id: string, companyId: string, opType?: string, opProposed?: unknown): Promise<BillingReferenceLookup> {
    const company = await this.prisma.client.company.findUnique({ where: { id: companyId }, select: { name: true } });
    if (!company) throw new NotFoundException();
    const href = kind === 'INVOICE' ? `/system/billing/companies/${companyId}/invoices/${id}`
      : kind === 'ATTEMPT' ? `/system/billing/companies/${companyId}/checkouts/${id}`
      : kind === 'ISSUE' ? `/system/billing/issues/${id}`
      : opType === 'REFUND' ? `/system/billing/refunds/${id}`
      : opType === 'EXPIRE_CHECKOUT' ? `/system/billing/checkout-expiry/${id}`
      : opType && ['CHANGE_COLLECTION', 'GRANT_FREE_DAYS', 'GRANT_OVERRIDE', 'REVOKE_OVERRIDE'].includes(opType) ? `/system/billing/plan-adjustments/${id}`
      : opType && ['GRANT_RECEIPTS', 'REVOKE_RECEIPTS'].includes(opType) ? `/system/billing/receipt-adjustments/${id}`
      : opType && ['SET_ACTION_GATE', 'PUBLISH_POLICY'].includes(opType) ? `/system/billing/configuration-changes/${id}`
      : opType && billingRepairTypes.includes(opType) ? `/system/billing/operations/${id}`
      : opType === 'UPDATE_BILLING_EMAIL' && (opProposed as { target?: { source?: string } } | null)?.target?.source === 'ADMIN' ? `/system/billing/recipient-changes/${id}`
      : `/system/billing/companies/${companyId}`;
    return { kind, id, companyId, companyName: company.name, href };
  }
  async lookup(context: RequestContext, reference: string): Promise<BillingReferenceLookup> {
    const access = await this.access(context, 'system.billing.read');
    const raw = reference.trim(), upper = raw.toUpperCase(), clean = upper.replace(/[^A-Z0-9]/g, '');
    if (clean.length < 8 && !/^[A-Z0-9]{4,12}-\d{4}$/.test(upper)) throw billingError('BILLING_LOOKUP_TOO_SHORT', 'เลขอ้างอิงต้องมีอย่างน้อย 8 ตัวอักษร');
    const suffix = clean.slice(-8).toLowerCase();
    const stripeAccountId = this.billing.stripe.accountId, livemode = this.billing.stripe.livemode;
    const companyScope = access.platformScope ? {} : { companyId: { in: access.companyIds } };
    const opScope = access.platformScope ? { not: null } : { in: access.companyIds };
    // Sales-event discount serial (spec §7.1, SD-E20): 8 characters with no 0/O or 1/I, matched exactly and
    // before the fuzzy id suffixes. An unused one belongs to no shop, so only platform scope hears that.
    if (/^[A-HJ-NP-Z2-9]{8}$/.test(clean)) {
      const ticket = await this.prisma.client.salesEventTicket.findFirst({ where: { serial: clean, ...companyScope }, select: { id: true, companyId: true } });
      if (ticket?.companyId) return this.lookupResult('EVENT_TICKET', ticket.id, ticket.companyId);
      if (ticket) throw billingError('BILLING_LOOKUP_EVENT_TICKET_UNUSED', 'ส่วนลดจากงานนี้ยังไม่ได้ใช้กับร้านใด');
    }
    // BillingInvoice/BillingAttempt only carry billingAccountId (no declared relation field to
    // navigate), so scope them by first resolving which accounts are in scope.
    const accounts = await this.prisma.client.billingAccount.findMany({ where: { ...companyScope, stripeAccountId, livemode }, select: { id: true, companyId: true } });
    const accountIds = accounts.map(a => a.id), companyOfAccount = new Map(accounts.map(a => [a.id, a.companyId]));

    const invoices = accountIds.length ? await this.prisma.client.billingInvoice.findMany({
      where: { billingAccountId: { in: accountIds }, OR: [{ providerNumber: upper }, { providerInvoiceId: raw }, { providerChargeId: raw }, { id: { endsWith: suffix } }] },
      select: { id: true, billingAccountId: true }, take: 2 }) : [];
    if (invoices.length > 1) throw this.ambiguous();
    if (invoices.length === 1) return this.lookupResult('INVOICE', invoices[0]!.id, companyOfAccount.get(invoices[0]!.billingAccountId)!);

    const attempts = accountIds.length ? await this.prisma.client.billingAttempt.findMany({
      where: { billingAccountId: { in: accountIds }, OR: [{ checkoutSessionId: raw }, { id: { endsWith: suffix } }] },
      select: { id: true, billingAccountId: true }, take: 2 }) : [];
    if (attempts.length > 1) throw this.ambiguous();
    if (attempts.length === 1) return this.lookupResult('ATTEMPT', attempts[0]!.id, companyOfAccount.get(attempts[0]!.billingAccountId)!);

    const operations = await this.prisma.client.billingOperation.findMany({
      where: { id: { endsWith: suffix }, stripeAccountId, livemode, companyId: opScope }, select: { id: true, companyId: true, type: true, proposedJson: true }, take: 2 });
    if (operations.length > 1) throw this.ambiguous();
    if (operations.length === 1) return this.lookupResult('OPERATION', operations[0]!.id, operations[0]!.companyId!, operations[0]!.type, operations[0]!.proposedJson);

    const issues = await this.prisma.client.billingIssue.findMany({
      where: { id: { endsWith: suffix }, stripeAccountId, livemode, companyId: opScope }, select: { id: true, companyId: true }, take: 2 });
    if (issues.length > 1) throw this.ambiguous();
    if (issues.length === 1) return this.lookupResult('ISSUE', issues[0]!.id, issues[0]!.companyId!);

    throw new NotFoundException();
  }
  async scopedCompany(context: RequestContext, companyId: string, tx:Prisma.TransactionClient=this.prisma.client) {
    const access = await this.access(context, 'system.billing.read',tx);
    const company = await tx.company.findFirst({ where: { ...this.companyWhere(access), AND: { id: companyId } }, include: { planTerm: true } });
    if (!company) throw new NotFoundException();
    const account = this.billing.stripe.enabled ? await this.billing.account(companyId,tx) : null;
    return { access, company, account };
  }
  private async scopedInvoice(context:RequestContext,companyId:string,id:string,permission:string) {
    await this.access(context,permission);
    const {account,access}=await this.scopedCompany(context,companyId);
    const row=account?await this.prisma.client.billingInvoice.findFirst({where:{id,billingAccountId:account.id}}):null;
    if(!row||!account)throw new NotFoundException();return {account,row,access};
  }
  async adjustments(context:RequestContext,companyId:string,id:string,kind:BillingAdjustmentKind,cursor?:string) {
    const {account,row}=await this.scopedInvoice(context,companyId,id,'system.billing.financial.read');
    const result=await readInvoiceAdjustments(this.billing.stripe,account,row,kind,cursor);
    const current=await this.scopedInvoice(context,companyId,id,'system.billing.financial.read');sameInvoiceSource(account,row,current.account,current.row);
    return {...result,canOpenDocuments:current.access.capabilities.includes('system.billing.document.read')};
  }
  async document(context:RequestContext,companyId:string,id:string,kind:'invoice'|'receipt'|'pdf'|'credit-note',creditNoteId?:string) {
    const {account,row}=await this.scopedInvoice(context,companyId,id,'system.billing.document.read');
    const result=await readInvoiceDocument(this.billing.stripe,account,row,kind,creditNoteId);
    const current=await this.scopedInvoice(context,companyId,id,'system.billing.document.read');sameInvoiceSource(account,row,current.account,current.row);
    await this.prisma.client.auditLog.create({data:{companyId,actorUserId:context.userId,action:'billing.operator_document.opened',targetType:'BillingInvoice',
      targetId:id,requestId:context.requestId,result:'SUCCESS',riskLevel:'HIGH',metadataJson:{kind,...creditNoteId?{creditNoteId}:{}}}});
    return result;
  }
  async exportTimeline(context:RequestContext,companyId:string,cursor?:string) {
    await this.access(context,'system.billing.export');
    const source=await this.scopedCompany(context,companyId);
    const mode=this.billing.stripe.enabled?(this.billing.stripe.livemode?'LIVE':'TEST'):'DISABLED';
    const timeline=await billingTimeline(this.prisma.client,{companyId,accountId:source.account?.id??null,
      stripeAccountId:this.billing.stripe.enabled?this.billing.stripe.accountId:null,livemode:this.billing.stripe.livemode,
      financial:source.access.capabilities.includes('system.billing.financial.read'),audit:source.access.capabilities.includes('system.billing.audit.read'),cursor});
    const result=billingHistoryExport(source.company,mode,timeline);
    return this.prisma.client.$transaction(async tx=>{
      await this.access(context,'system.billing.export',tx);
      const current=await this.scopedCompany(context,companyId,tx);
      if(current.account?.id!==source.account?.id||current.account?.version!==source.account?.version||
        current.company.name!==source.company.name||current.company.status!==source.company.status||
        current.access.capabilities.includes('system.billing.financial.read')!==timeline.financialIncluded||
        current.access.capabilities.includes('system.billing.audit.read')!==timeline.auditIncluded)
        throw billingError('CONTROL_EXPORT_CHANGED','ข้อมูลหรือสิทธิ์เปลี่ยนแล้ว โหลดประวัติล่าสุดก่อนดาวน์โหลดอีกครั้ง');
      await tx.auditLog.create({data:{companyId,actorUserId:context.userId,action:'billing.history.exported',targetType:'Company',targetId:companyId,
        requestId:context.requestId,result:'SUCCESS',riskLevel:'HIGH',metadataJson:{mode,accountId:source.account?.id??null,cursor:cursor??null,
          rowCount:result.rowCount,references:timeline.items.map(entry=>entry.reference),financialIncluded:result.financialIncluded,
          auditIncluded:result.auditIncluded,exportedAt:result.exportedAt,sha256:result.sha256}}});
      return result;
    });
  }

  async timeline(context: RequestContext, companyId: string, cursor?: string) {
    const { access, account } = await this.scopedCompany(context,companyId);
    return {...await billingTimeline(this.prisma.client, { companyId, accountId: account?.id ?? null,
      stripeAccountId: this.billing.stripe.enabled ? this.billing.stripe.accountId : null, livemode: this.billing.stripe.livemode,
      financial: access.capabilities.includes('system.billing.financial.read'), audit: access.capabilities.includes('system.billing.audit.read'), cursor }),canExport:access.capabilities.includes('system.billing.export')};
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
    // SD-E20: the shop's sales-event discounts. The amount and the bill are money, so they follow `financial`.
    const tickets = await this.prisma.client.salesEventTicket.findMany({ where: { companyId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 25,
      select: { serial: true, state: true, redeemedAs: true, appliedDiscountSatang: true, invoiceId: true, usedAt: true, reservedAt: true,
        batch: { select: { eventName: true, batchName: true } } } });
    const eventDiscounts = tickets.map(t => ({ serial: t.serial, eventName: t.batch.eventName, batchName: t.batch.batchName,
      redeemedAs: t.redeemedAs as 'DISCOUNT' | 'CREDIT' | null, state: t.state as 'ISSUED' | 'RESERVED' | 'USED' | 'REVOKED',
      appliedDiscountSatang: financial ? t.appliedDiscountSatang : null, invoiceId: financial ? t.invoiceId : null,
      usedAt: t.usedAt?.toISOString() ?? null, reservedAt: t.reservedAt?.toISOString() ?? null }));
    return { ...await this.companyView(company,account), usage: await this.billing.usage(companyId), issues: await Promise.all(issues.map(i=>this.issueView(i,this.prisma.client,company.name))), financial, eventDiscounts };
  }
  async issues(context: RequestContext, input: { cursor?: string; companyId?: string; state?: string; queue?: 'UNASSIGNED'|'OVERDUE' }) {
    const access = await this.access(context, 'system.billing.read');
    if (!this.billing.stripe.enabled) return { items: [], nextCursor: null };
    if (input.companyId && !access.platformScope && !access.companyIds.includes(input.companyId)) throw new NotFoundException();
    const where: Prisma.BillingIssueWhereInput = { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      ...(!access.platformScope ? { companyId: { in: access.companyIds } } : {}), ...(input.companyId ? { companyId: input.companyId } : {}),
      state: input.state ?? { not: 'RESOLVED' }, ...(input.queue==='UNASSIGNED'?{assigneeUserId:null}:{}),
      ...(input.queue==='OVERDUE'?{OR:[{followUpAt:{lte:new Date()}},{followUpAt:null,slaDueAt:{lte:new Date()}}],state:{not:'RESOLVED'}}:{}) };
    if (input.cursor && !await this.prisma.client.billingIssue.findFirst({ where: { ...where, id: input.cursor } })) throw new NotFoundException();
    const rows = await this.prisma.client.billingIssue.findMany({ where: { ...where, ...(input.cursor ? { id: { gt: input.cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26 });
    const companyIds=[...new Set(rows.slice(0,25).flatMap(row=>row.companyId?[row.companyId]:[]))];
    const names=new Map((companyIds.length?await this.prisma.client.company.findMany({where:{id:{in:companyIds}},select:{id:true,name:true}}):[]).map(c=>[c.id,c.name]));
    return { items: await Promise.all(rows.slice(0, 25).map(i=>this.issueView(i,this.prisma.client,i.companyId?names.get(i.companyId)??null:null))), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }
  async issue(context: RequestContext, id: string) {
    const access = await this.access(context, 'system.billing.read');
    const row = await this.prisma.client.billingIssue.findFirst({ where: { id, stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      ...(access.platformScope ? {} : { companyId: { in: access.companyIds } }) } });
    if (!row) throw new NotFoundException();
    const relatedAccount = row.companyId && ['PAID_NOT_APPLIED','PAID_HELD'].includes(row.kind) ? await this.prisma.client.billingAccount.findFirst({where:{
      companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode},select:{id:true}}) : null;
    const relatedInvoice = relatedAccount ? await this.prisma.client.billingInvoice.findFirst({where:{
      billingAccountId:relatedAccount.id,
      // Detector references are local IDs for held invoices, Stripe IDs for failed application.
      ...(row.kind==='PAID_HELD'?{id:row.referenceId}:{providerInvoiceId:row.referenceId}),
    },select:{id:true}}) : null;
    const refund = row.companyId && row.kind==='REFUND_FAILED' && access.capabilities.includes('system.billing.financial.read') ?
      await this.prisma.client.billingOperation.findFirst({where:{companyId:row.companyId,stripeAccountId:row.stripeAccountId,livemode:row.livemode,
        type:'REFUND',resultJson:{path:['refundId'],equals:row.referenceId}},orderBy:{createdAt:'desc'},select:{id:true}}) : null;
    return {...await this.issueView(row),relatedInvoiceId:relatedInvoice?.id??null,relatedRefundOperationId:refund?.id??null,resolvedAt:row.resolvedAt?.toISOString()??null};
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
      const slaDueAt=await issuePriorityDeadline(tx,row,input.priority??row.priority,Boolean(input.followUpAt===undefined?row.followUpAt:input.followUpAt));
      const changed = await tx.billingIssue.updateMany({ where: { id, version: input.expectedVersion, state: { not: 'RESOLVED' } },
        data: { state: input.state, note: input.note.trim(), assigneeUserId: input.assigneeUserId,backupUserId,slaDueAt,
          ...(input.priority===undefined?{}:{priority:input.priority}),...(input.followUpAt===undefined?{}:{followUpAt:input.followUpAt?new Date(input.followUpAt):null}),version: { increment: 1 } } });
      if (changed.count !== 1) throw billingError('CONTROL_PREVIEW_STALE', 'เคสเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
      await tx.auditLog.create({ data: { companyId: row.companyId ?? context.companyId, actorUserId: context.userId, action: 'billing.issue.updated',
        targetType: 'BillingIssue', targetId: id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: { before: { state: row.state, assigneeUserId: row.assigneeUserId,backupUserId:row.backupUserId,priority:row.priority,followUpAt:row.followUpAt?.toISOString()??null, version: row.version },
          after: { state: input.state, assigneeUserId: input.assigneeUserId,backupUserId,priority:input.priority??row.priority,followUpAt:input.followUpAt===undefined?row.followUpAt?.toISOString()??null:input.followUpAt, version: row.version + 1 },
          sla:{policyRevisionId:row.slaPolicyRevisionId,startedAt:row.slaStartedAt?.toISOString()??null,before:row.slaDueAt?.toISOString()??null,after:slaDueAt?.toISOString()??null},reason: input.note.trim() } } });
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
