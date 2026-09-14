import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BILLING_ACTIONS, BILLING_CONFIGURATION_IMPACT_KINDS, BILLING_DRAFT_POLICY, BILLING_PAID_TIERS, billingOffer, type BillingPolicy, type BillingConfiguration,
  type BillingConfigurationImpactPage, type BillingConfigurationImpactKind,
  type BillingConfigurationInput, type BillingConfigurationDraftInput, type BillingConfigurationImpact, type BillingConfigurationOperation } from '@watchdog-bms/contracts';
import { Prisma, type BillingOperation } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { verifyPassword } from '../../auth/domain/logic/password-credential.logic';
import { BillingAdminService } from './billing-admin.service';
import { BillingService } from './billing.service';
import { assertKeys, assertPolicyReady, assertStripePrice, assertStripePortalConfiguration, billingError, effectiveBillingGates, hashBilling, parseBillingPolicy, quoteTotals } from '../domain/billing-policy';
import { stripeId } from '../infrastructure/stripe.client';
import { configurationImpact } from './billing-configuration-impact';
import { randomUUID } from 'node:crypto';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';

type Proposed = { policy: BillingPolicy; gates: BillingConfiguration['gates']; impact: BillingConfigurationImpact|null;
  sourcePolicyRevision: string | null; membershipId: string; actorCompanyId: string; sessionId: string;draftVersion?:number;draftCreateHash?:string;effectiveAt?:string };
type ScheduledApproval={membershipId:string;companyId:string;credentialVersion:string;initiatorCredentialVersion:string;approvedAt:string};
function scheduledTime(value:unknown,review=false):string|undefined {
  if(value==null)return undefined;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new BadRequestException('Invalid publication time');
  const at=Date.parse(value),calendar=new Date(`${value.slice(0,10)}T00:00:00Z`);
  if(calendar.toISOString().slice(0,10)!==value.slice(0,10))throw new BadRequestException('Invalid publication date');
  if(review&&(at<Date.now()+60000||at>Date.now()+365*86400000))throw billingError('CONTROL_SCHEDULE_TIME','เลือกเวลาล่วงหน้าอย่างน้อยหนึ่งนาทีและไม่เกินหนึ่งปี แล้วตรวจผลกระทบใหม่');
  return new Date(at).toISOString();
}
// PostgreSQL JSONB may reorder object keys; compare semantic snapshots, not insertion order.
export function configurationHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : item;
  return hashBilling(canonical(value));
}
const types = ['PUBLISH_POLICY', 'SET_ACTION_GATE'];
const permission = (type: string) => type === 'PUBLISH_POLICY' ? 'system.billing.policy.manage' : 'system.billing.gate.manage';
const stale = () => billingError('CONTROL_PREVIEW_STALE', 'ข้อมูลเปลี่ยนหรือรายการหมดอายุ กรุณาโหลดการตั้งค่าและตรวจสอบใหม่');

@Injectable()
export class BillingConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly admin: BillingAdminService, private readonly billing: BillingService) {}
  private async platform(context: RequestContext, key: string, tx: Prisma.TransactionClient = this.prisma.client) {
    const access = await this.admin.access(context, key, tx);
    if (!access.platformScope) throw new ForbiddenException('ต้องได้รับสิทธิ์ดูแลการตั้งค่าระดับระบบ');
    return access;
  }
  private async proof(context: RequestContext, tx: Prisma.TransactionClient = this.prisma.client) {
    const session = context.sessionId ? await tx.authSession.findFirst({ where: { id: context.sessionId, userId: context.userId, status: 'ACTIVE',
      revokedAt: null, expiresAt: { gt: new Date() } } }) : null;
    const credential = await tx.userCredential.findUnique({ where: { userId: context.userId } });
    const valid = session && credential?.status === 'ACTIVE' && !credential.mustChangePassword && (!credential.expiresAt || credential.expiresAt > new Date());
    const until = valid && session.billingReauthenticatedAt && session.billingCredentialVersion?.getTime() === credential.updatedAt.getTime()
      ? new Date(Math.min(session.billingReauthenticatedAt.getTime() + 300_000, session.expiresAt.getTime(), credential.expiresAt?.getTime() ?? Infinity)) : null;
    return { session: valid ? session : null, credential: valid ? credential : null, until: until && until > new Date() ? until : null };
  }
  async requireProof(context: RequestContext, tx: Prisma.TransactionClient) {
    if (tx !== this.prisma.client) {
      await tx.$queryRaw`SELECT id FROM "UserCredential" WHERE "userId" = ${context.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${context.sessionId ?? ''} FOR SHARE`;
    }
    if (!(await this.proof(context, tx)).until) throw billingError('CONTROL_REAUTH_REQUIRED', 'กรุณายืนยันรหัสผ่านปัจจุบันก่อนดำเนินการ');
  }
  async reauthenticate(context: RequestContext, password: string) {
    await this.platform(context, 'system.billing.read');
    if (typeof password !== 'string' || password.length < 1 || password.length > 1024) throw new BadRequestException('Invalid password');
    const proof = await this.proof(context);
    if (!proof.session || !proof.credential || !verifyPassword(password, proof.credential.passwordHash)) throw new ForbiddenException({ code: 'CONTROL_REAUTH_FAILED', message: 'ยืนยันรหัสผ่านไม่ได้ ตรวจสอบรหัสผ่านหรือใช้หน้ากู้บัญชี' });
    return this.prisma.client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "UserCredential" WHERE "userId" = ${context.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${context.sessionId ?? ''} FOR UPDATE`;
      const current = await this.proof(context, tx);
      if (!current.credential || current.credential.updatedAt.getTime() !== proof.credential!.updatedAt.getTime() || !current.session) throw new ForbiddenException();
      const now = new Date();
      const changed = await tx.authSession.updateMany({ where: { id: current.session.id, status: 'ACTIVE', revokedAt: null, expiresAt: { gt: now } },
        data: { billingReauthenticatedAt: now, billingCredentialVersion: current.credential.updatedAt } });
      if (!changed.count) throw new ForbiddenException();
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'billing.reauthenticated', targetType: 'AuthSession',
        targetId: current.session.id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH' } });
      return { reauthenticatedUntil: (await this.proof(context, tx)).until!.toISOString() };
    });
  }
  async settings(context: RequestContext): Promise<BillingConfiguration> {
    const access = await this.platform(context, 'system.billing.read');
    if (!this.billing.stripe.enabled) return { version: 0, mode: 'DISABLED', policy: BILLING_DRAFT_POLICY, policyRevisionId: null,
      gates: Object.fromEntries(BILLING_ACTIONS.map(a => [a, false])) as BillingConfiguration['gates'], capabilities: access.capabilities, reauthenticatedUntil: null };
    const state = await this.billing.settings();
    return { version: state.settings.version, mode: this.billing.stripe.livemode ? 'LIVE' : 'TEST', policy: state.policy ?? BILLING_DRAFT_POLICY,
      policyRevisionId: state.revision?.id ?? null, gates: state.gates, capabilities: access.capabilities, salesCompanies: await this.salesCompanies(state.policy?.salesCompanyIds),
      reauthenticatedUntil: (await this.proof(context)).until?.toISOString() ?? null };
  }
  private async salesCompanies(ids: string[] | null | undefined, tx: Prisma.TransactionClient = this.prisma.client) {
    return ids?.length ? tx.company.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, name: true, status: true } }) : [];
  }
  private async validateCompanies(policy: BillingPolicy, tx: Prisma.TransactionClient = this.prisma.client) {
    if ((await this.salesCompanies(policy.salesCompanyIds, tx)).length !== (policy.salesCompanyIds?.length ?? 0))
      throw billingError('CONTROL_SALES_COMPANY_INVALID', 'มีบริษัทที่ไม่พบแล้ว กรุณาเลือกบริษัทใหม่และตรวจผลกระทบอีกครั้ง');
  }
  private gates(value: unknown): BillingConfiguration['gates'] {
    assertKeys(value, BILLING_ACTIONS);
    if (BILLING_ACTIONS.some(a => typeof value[a] !== 'boolean')) throw new BadRequestException('Invalid billing gates');
    if (value.portal_change_plan) throw billingError('CONTROL_ACTION_NOT_SUPPORTED', 'เปลี่ยนแพ็กเกจผ่านหน้ามั่งมี โดยใช้การตั้งค่าเปลี่ยนแพ็กเกจ');
    return Object.fromEntries(BILLING_ACTIONS.map(a => [a, value[a]])) as BillingConfiguration['gates'];
  }
  private async impact(policy: BillingPolicy, before: BillingPolicy | null, tx: Prisma.TransactionClient = this.prisma.client): Promise<BillingConfigurationImpact> {
    const where = { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode };
    const { cursorValid: _cursor, items: _items, ...counts } = await configurationImpact(tx, where);
    const cohort = policy.salesCompanyIds !== undefined || before?.salesCompanyIds !== undefined;
    return { ...counts, ...(policy.supportSlaMinutes!==undefined||before?.supportSlaMinutes!==undefined?{supportSla:{before:before?.supportSlaMinutes??null,after:policy.supportSlaMinutes??null}}:{}),
      ...(cohort ? { salesCohort: { before: before?.salesCompanyIds ?? null, after: policy.salesCompanyIds ?? null,
      companies: await this.salesCompanies([...new Set([...(before?.salesCompanyIds ?? []), ...(policy.salesCompanyIds ?? [])])], tx) } } : {}),
      prices: BILLING_PAID_TIERS.flatMap(tier => (['month', 'year'] as const).map(interval => ({ offerKey: `${tier}:${interval}` as const,
        beforeTotalSatang: quoteTotals(billingOffer(tier, interval).priceSatang, before?.taxTreatment ?? null).totalSatang,
        afterTotalSatang: quoteTotals(billingOffer(tier, interval).priceSatang, policy.taxTreatment).totalSatang }))) };
  }
  private async validateProvider(policy: BillingPolicy) {
    assertPolicyReady(policy);
    if (policy.paidStart !== 'IMMEDIATE') throw billingError('CONTROL_POLICY_NOT_SUPPORTED', 'นโยบายปัจจุบันเริ่มและจ่ายทันที');
    await this.billing.stripe.assertAccount();
    if (!Object.keys(policy.priceIds).length) throw billingError('CONTROL_POLICY_NOT_READY', 'กรุณาผูก Stripe Price อย่างน้อยหนึ่งแพ็กเกจ');
    for (const tier of BILLING_PAID_TIERS) for (const interval of ['month', 'year'] as const) {
      const priceId = policy.priceIds[`${tier}:${interval}`], zeroId = policy.zeroPriceIds?.[`${tier}:${interval}`];
      if (zeroId && !priceId) throw new BadRequestException('Prepaid price needs its paid price');
      if (!priceId) continue;
      const offer = billingOffer(tier, interval), price = await this.billing.stripe.request('GET', `/prices/${priceId}`);
      assertStripePrice(price, offer, policy, this.billing.stripe.livemode, priceId);
      if (zeroId) {
        const zero = await this.billing.stripe.request('GET', `/prices/${zeroId}`);
        assertStripePrice(zero, { ...offer, priceSatang: 0 }, policy, this.billing.stripe.livemode, zeroId);
        if (!stripeId(price.product) || stripeId(zero.product) !== stripeId(price.product)) throw billingError('BILLING_PRICE_MISMATCH', 'ราคาเก็บเงินและราคาสำหรับช่วงที่จ่ายล่วงหน้าต้องเป็นสินค้าเดียวกัน');
      }
    }
    const portal = await this.billing.stripe.request('GET', `/billing_portal/configurations/${policy.portalConfigurationId}`);
    assertStripePortalConfiguration(portal, policy.portalConfigurationId!, this.billing.stripe.livemode);
    await this.billing.assertTaxSettings(policy);
  }
  private async view(row: BillingOperation, context: RequestContext): Promise<BillingConfigurationOperation> {
    const p = row.proposedJson as unknown as Proposed, access = await this.platform(context, 'system.billing.read');
    const own = row.initiatorUserId === context.userId, fresh = row.expiresAt > new Date();
    return { id: row.id, type: row.type as BillingConfigurationInput['type'], state: row.state as BillingConfigurationOperation['state'],
      scope: { kind: 'PLATFORM', mode: row.livemode ? 'LIVE' : 'TEST' }, version: row.version, reason: row.reason, initiatorUserId: row.initiatorUserId,
      approverUserId: row.approverUserId, errorCode: row.errorCode, createdAt: row.createdAt.toISOString(), observedAt: row.observedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(), referenceId: row.referenceId, sourceVersion: row.sourceVersion, previewHash: row.requestHash,
      proposed: { policy: p.policy, gates: effectiveBillingGates(p.gates),...p.effectiveAt?{effectiveAt:p.effectiveAt}:{} }, impact: p.impact, activeRevisionId: (row.resultJson as { activeRevisionId?: string } | null)?.activeRevisionId ?? null,
      scheduledFor:row.scheduledFor?.toISOString()??null,scheduleDue:Boolean(row.scheduledFor&&row.scheduledFor<=new Date()),
      salesCompanies: await this.salesCompanies(p.policy.salesCompanyIds),
      canEditDraft:row.state==='DRAFT'&&own&&access.capabilities.includes(permission(row.type)),sourceDraftVersion:p.draftVersion,
      allowedActions: [...(own && fresh && row.state === 'PREVIEW' && access.capabilities.includes(permission(row.type)) ? ['submit' as const] : []),
        ...(!own && fresh && row.state === 'AWAITING_APPROVAL' && access.capabilities.includes('system.billing.approval.approve') ? ['approve' as const] : []),
        ...(['SCHEDULED','RUNNING'].includes(row.state)&&(!row.leaseUntil||row.leaseUntil<=new Date())&&row.scheduledFor&&row.scheduledFor<=new Date()&&access.capabilities.includes(permission(row.type))?['apply' as const]:[]),
        ...((own&&['DRAFT','PREVIEW','AWAITING_APPROVAL'].includes(row.state))||
          (row.scheduledFor&&['SCHEDULED','BLOCKED'].includes(row.state)&&(own||row.approverUserId===context.userId||access.capabilities.includes(permission(row.type))))?['cancel' as const]:[])] };
  }
  private async row(context: RequestContext, id: string, tx: Prisma.TransactionClient = this.prisma.client) {
    await this.platform(context, 'system.billing.read', tx);
    const row = await tx.billingOperation.findFirst({ where: { id, companyId: null, stripeAccountId: this.billing.stripe.accountId,
      livemode: this.billing.stripe.livemode, type: { in: types } } });
    if (!row) throw new NotFoundException(); return row;
  }
  async get(context: RequestContext, id: string) { return this.view(await this.row(context, id), context); }
  async affected(context: RequestContext, id: string, kind: string, cursor?: string, sourceHash?: string): Promise<BillingConfigurationImpactPage> {
    const row = await this.row(context,id);
    if (!BILLING_CONFIGURATION_IMPACT_KINDS.includes(kind as BillingConfigurationImpactKind) || (cursor && cursor.length>180) ||
      (sourceHash && !/^[a-f0-9]{64}$/.test(sourceHash))) throw new BadRequestException('Invalid impact page');
    const impact = (row.proposedJson as Proposed).impact;
    if (!impact) throw billingError('CONTROL_IMPACT_NOT_READY','ตรวจผลกระทบจากฉบับร่างก่อนเปิดรายชื่อ');
    const current = await configurationImpact(this.prisma.client,{stripeAccountId:row.stripeAccountId,livemode:row.livemode},{kind:kind as BillingConfigurationImpactKind,cursor});
    if (cursor && (!sourceHash || sourceHash!==current.sourceHash)) throw stale();
    if (!current.cursorValid) throw new NotFoundException();
    const items=current.items.slice(0,25), companies=await this.prisma.client.company.findMany({where:{id:{in:items.map(i=>i.companyId)}},select:{id:true,name:true}});
    return {kind:kind as BillingConfigurationImpactKind,items:items.map(i=>({...i,companyName:companies.find(c=>c.id===i.companyId)?.name??i.companyId})),
      sourceHash:current.sourceHash!,matchesPreview:Boolean(impact.sourceHash&&impact.sourceHash===current.sourceHash),observedAt:new Date().toISOString(),
      nextCursor:current.items.length>25?items[24]!.reference:null};
  }
  async list(context: RequestContext, cursor?: string) {
    await this.platform(context, 'system.billing.read');
    if (!this.billing.stripe.enabled) return { items: [], nextCursor: null };
    if (cursor) await this.row(context, cursor);
    const rows = await this.prisma.client.billingOperation.findMany({ where: { stripeAccountId: this.billing.stripe.accountId,
      livemode: this.billing.stripe.livemode, companyId: null, type: { in: types }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 26 });
    return { items: await Promise.all(rows.slice(0, 25).map(r => this.view(r, context))), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }
  async preview(context: RequestContext, input: BillingConfigurationInput) {
    if (!types.includes(input.type) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) throw new BadRequestException('Invalid configuration');
    await this.platform(context, permission(input.type));
    const policy = parseBillingPolicy(input.policy), gates = this.gates(input.gates), state = await this.billing.settings(), effectiveAt=scheduledTime(input.effectiveAt,true);
    if (state.settings.version !== input.expectedVersion) throw stale();
    if (input.type === 'SET_ACTION_GATE' && configurationHash(policy) !== configurationHash(state.policy)) throw billingError('CONTROL_GATE_POLICY_STALE','โหลดนโยบายล่าสุดก่อนตรวจค่าสวิตช์อีกครั้ง');
    if (configurationHash(gates) !== configurationHash(state.gates)) await this.platform(context, 'system.billing.gate.manage');
    const draft=input.draftId?await this.row(context,input.draftId):null;
    if(draft&&(draft.state!=='DRAFT'||draft.initiatorUserId!==context.userId||draft.version!==input.draftVersion||draft.type!==input.type||
      configurationHash([draft.reason,(draft.proposedJson as Proposed).policy,effectiveBillingGates((draft.proposedJson as Proposed).gates),(draft.proposedJson as Proposed).effectiveAt??null])!==configurationHash([input.reason.trim(),policy,gates,effectiveAt??null])))throw stale();
    if(!draft&&input.draftVersion!==undefined)throw new BadRequestException('Missing source draft');
    await this.validateCompanies(policy);
    await this.validateProvider(policy);
    const proposed: Proposed = { policy, gates, impact: await this.impact(policy, state.policy), sourcePolicyRevision: state.revision?.id ?? null,
      membershipId: context.membershipId, actorCompanyId: context.companyId, sessionId: context.sessionId ?? '',...draft?{draftVersion:draft.version}:{},...effectiveAt?{effectiveAt}:{} };
    const row = await this.prisma.client.$transaction(async tx=>{
      if(draft){await this.lock(tx);await this.platform(context,permission(input.type),tx);
        const current=await this.row(context,draft.id,tx);if(current.state!=='DRAFT'||current.version!==draft.version)throw stale();}
      return tx.billingOperation.create({ data: { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
      type: input.type, sourceVersion: input.expectedVersion, reason: input.reason.trim(), proposedJson: proposed as unknown as Prisma.InputJsonValue,
      referenceId:draft?.id,initiatorUserId: context.userId, requestHash: configurationHash([input.type, input.expectedVersion, proposed, input.reason.trim(),draft?.id??null]), expiresAt: new Date(Date.now() + 600_000) } });});
    return this.view(row, context);
  }

  async saveDraft(context:RequestContext,input:BillingConfigurationDraftInput,key:string){
    if(!types.includes(input.type)||!Number.isInteger(input.expectedVersion)||input.expectedVersion<0||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||
      !/^[a-zA-Z0-9_-]{16,120}$/.test(key))throw new BadRequestException('Invalid configuration draft');
    const policy=parseBillingPolicy(input.policy),gates=this.gates(input.gates),reason=input.reason.trim(),effectiveAt=scheduledTime(input.effectiveAt);
    const hash=configurationHash([input.draftId??null,input.expectedVersion,input.type,policy,gates,reason,...effectiveAt?[effectiveAt]:[]]);
    const row=await this.prisma.client.$transaction(async tx=>{
      await this.platform(context,permission(input.type),tx);const state=await this.lock(tx);
      await this.validateCompanies(policy, tx);
      if(input.type==='SET_ACTION_GATE'&&configurationHash(policy)!==configurationHash(state.policy))throw billingError('CONTROL_GATE_POLICY_STALE','โหลดนโยบายล่าสุดก่อนบันทึกร่างค่าสวิตช์อีกครั้ง');
      if(configurationHash(gates)!==configurationHash(state.gates))await this.platform(context,'system.billing.gate.manage',tx);
      const proposed:Proposed={policy,gates,impact:null,sourcePolicyRevision:state.revision?.id??null,membershipId:context.membershipId,actorCompanyId:context.companyId,sessionId:context.sessionId??'',...effectiveAt?{effectiveAt}:{}};
      let saved:BillingOperation;
      if(input.draftId){
        const current=await this.row(context,input.draftId,tx);
        if(current.initiatorUserId!==context.userId||current.type!==input.type)throw new ForbiddenException();
        const prior=await tx.auditLog.findFirst({where:{targetType:'BillingOperation',targetId:current.id,action:'billing.configuration.draft_saved',metadataJson:{path:['commandKey'],equals:key}}});
        if(prior){if((prior.metadataJson as {hash?:string}).hash!==hash)throw stale();return current;}
        if(current.state!=='DRAFT'||current.version!==input.expectedVersion)throw stale();
        proposed.draftCreateHash=(current.proposedJson as Proposed).draftCreateHash;
        const changed=await tx.billingOperation.updateMany({where:{id:current.id,state:'DRAFT',version:input.expectedVersion},data:{reason,proposedJson:proposed as unknown as Prisma.InputJsonValue,
          sourceVersion:state.settings.version,requestHash:hash,version:{increment:1}}});
        if(!changed.count)throw stale();saved=await tx.billingOperation.findUniqueOrThrow({where:{id:current.id}});
      }else{
        const prior=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,idempotencyKey:key}}});
        if(prior){if(prior.initiatorUserId!==context.userId||(prior.proposedJson as Proposed).draftCreateHash!==hash)throw stale();return prior;}
        if(input.expectedVersion!==0)throw stale();proposed.draftCreateHash=hash;
        // DRAFT has no execution window. Only its separately created PREVIEW uses expiresAt.
        saved=await tx.billingOperation.create({data:{stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,type:input.type,state:'DRAFT',reason,
          sourceVersion:state.settings.version,initiatorUserId:context.userId,idempotencyKey:key,requestHash:hash,expiresAt:new Date(),proposedJson:proposed as unknown as Prisma.InputJsonValue}});
      }
      await tx.auditLog.create({data:{companyId:context.companyId,actorUserId:context.userId,action:'billing.configuration.draft_saved',targetType:'BillingOperation',targetId:saved.id,
        requestId:context.requestId,result:'SUCCESS',riskLevel:'LOW',metadataJson:{commandKey:key,hash,version:saved.version,type:saved.type}}});return saved;
    });return this.view(row,context);
  }
  private async lock(tx: Prisma.TransactionClient) {
    const state = await this.billing.settings(tx);
    await tx.$queryRaw`SELECT id FROM "BillingSettings" WHERE id = ${state.settings.id} FOR UPDATE`;
    return this.billing.settings(tx);
  }
  private audit(tx: Prisma.TransactionClient, context: RequestContext, row: BillingOperation, action: string,worker=false) {
    return tx.auditLog.create({ data: { companyId: context.companyId, actorType:worker?'SERVICE':'USER',actorRefId:worker?'billing-configuration-worker':undefined,actorUserId: worker?null:context.userId, action: `billing.configuration.${action}`,
      targetType: 'BillingOperation', targetId: row.id, requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { hash: row.requestHash, reason: row.reason, sourceVersion: row.sourceVersion, type: row.type } } });
  }
  async submit(context: RequestContext, id: string, expectedVersion: number, previewHash: string, key: string) {
    if (!/^[a-zA-Z0-9_-]{16,120}$/.test(key)) throw new BadRequestException('Invalid idempotency key');
    const row = await this.prisma.client.$transaction(async tx => {
      const state = await this.lock(tx);
      const current = await this.row(context, id, tx); await this.platform(context, permission(current.type), tx);
      const replay = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: { stripeAccountId: current.stripeAccountId, livemode: current.livemode, idempotencyKey: key } } });
      if (replay) { if (replay.id !== id || replay.initiatorUserId !== context.userId || replay.requestHash !== previewHash) throw stale(); return replay; }
      await this.requireProof(context, tx);
      if (current.state !== 'PREVIEW' || current.version !== expectedVersion || current.requestHash !== previewHash || current.initiatorUserId !== context.userId ||
          current.expiresAt <= new Date() || current.sourceVersion !== state.settings.version) throw stale();
      if (configurationHash(effectiveBillingGates((current.proposedJson as unknown as Proposed).gates)) !== configurationHash(state.gates)) await this.platform(context, 'system.billing.gate.manage', tx);
      const changed = await tx.billingOperation.updateMany({ where: { id, state: 'PREVIEW', version: expectedVersion }, data: { state: 'AWAITING_APPROVAL', idempotencyKey: key, version: { increment: 1 } } });
      if (!changed.count) throw stale();
      const updated = await tx.billingOperation.findUniqueOrThrow({ where: { id } });
      await this.audit(tx, context, updated, 'submitted'); return updated;
    }); return this.view(row, context);
  }
  async approve(context: RequestContext, id: string, expectedVersion: number, previewHash: string) {
    const candidate = await this.row(context, id);
    await this.platform(context, 'system.billing.approval.approve');
    if (candidate.initiatorUserId === context.userId) throw new ForbiddenException('ผู้ขออนุมัติรายการของตนเองไม่ได้');
    if (['SUCCEEDED','SCHEDULED'].includes(candidate.state) && candidate.approverUserId === context.userId && candidate.requestHash === previewHash) return this.view(candidate, context);
    await this.requireProof(context, this.prisma.client);
    const proposed = candidate.proposedJson as unknown as Proposed;
    await this.validateProvider(proposed.policy);
    const row = await this.prisma.client.$transaction(async tx => {
      // Match purchase/lifecycle lock order: companies first, then BillingSettings.
      const companyIds = [...new Set([...(proposed.impact?.salesCohort?.before ?? []), ...(proposed.policy.salesCompanyIds ?? [])])].sort();
      if (companyIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id IN (${Prisma.join(companyIds)}) ORDER BY id FOR SHARE`);
      const state = await this.lock(tx), current = await this.row(context, id, tx);
      await this.platform(context, 'system.billing.approval.approve', tx); await this.requireProof(context, tx);
      if (current.state !== 'AWAITING_APPROVAL' || current.version !== expectedVersion || current.requestHash !== previewHash || current.expiresAt <= new Date() || current.sourceVersion !== state.settings.version) throw stale();
      const member = await tx.companyMembership.findUniqueOrThrow({ where: { id: proposed.membershipId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
      const initiator: RequestContext = { ...context, userId: current.initiatorUserId, companyId: proposed.actorCompanyId, membershipId: member.id,
        sessionId: proposed.sessionId, permissions: member.roles.flatMap(r => r.role.permissions.map(p => p.permission.key)) };
      await this.platform(initiator, permission(current.type), tx);
      if (configurationHash(effectiveBillingGates(proposed.gates)) !== configurationHash(state.gates)) await this.platform(initiator, 'system.billing.gate.manage', tx);
      await this.validateCompanies(proposed.policy, tx);
      if (configurationHash(await this.impact(proposed.policy, state.policy, tx)) !== configurationHash(proposed.impact)) throw stale();
      if(proposed.effectiveAt){
        const at=new Date(proposed.effectiveAt);if(!Number.isFinite(at.getTime())||at<=new Date())throw billingError('CONTROL_SCHEDULE_TIME','เวลาที่เลือกผ่านไปแล้ว กรุณาตรวจผลกระทบพร้อมกำหนดเวลาใหม่');
        await tx.$queryRaw`SELECT "userId" FROM "UserCredential" WHERE "userId" = ${current.initiatorUserId} FOR SHARE`;
        const initiatorCredential=await this.activeCredential(tx,current.initiatorUserId),approverCredential=await this.activeCredential(tx,context.userId);
        const scheduledApproval:ScheduledApproval={membershipId:context.membershipId,companyId:context.companyId,credentialVersion:approverCredential.updatedAt.toISOString(),
          initiatorCredentialVersion:initiatorCredential.updatedAt.toISOString(),approvedAt:new Date().toISOString()};
        const scheduled=await tx.billingOperation.update({where:{id},data:{state:'SCHEDULED',scheduledFor:at,approverUserId:context.userId,version:{increment:1},
          resultJson:{scheduledApproval}}});await this.audit(tx,context,scheduled,'scheduled');return scheduled;
      }
      return this.publish(tx,state,current,proposed,context);
    }); return this.view(row, context);
  }
  private async activeCredential(tx:Prisma.TransactionClient,userId:string){
    const value=await tx.userCredential.findUnique({where:{userId}});
    if(!value||value.status!=='ACTIVE'||value.mustChangePassword||(value.expiresAt&&value.expiresAt<=new Date()))throw new ForbiddenException();return value;
  }
  async operationActor(row:BillingOperation,userId:string,membershipId:string,companyId:string,key:string,tx:Prisma.TransactionClient){
    if(!userId||!membershipId||!companyId)throw stale();
    if(tx!==this.prisma.client)await tx.$queryRaw`SELECT m.id FROM "CompanyMembership" m JOIN "User" u ON u.id=m."userId"
      JOIN "MembershipRole" mr ON mr."membershipId"=m.id JOIN "Role" r ON r.id=mr."roleId"
      JOIN "RolePermission" rp ON rp."roleId"=r.id WHERE m.id=${membershipId} AND u.id=${userId} ORDER BY r.id,rp."permissionId" FOR SHARE OF m,u,mr,r,rp`;
    const member=await tx.companyMembership.findFirstOrThrow({where:{id:membershipId,userId,companyId},include:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}}});
    const context:RequestContext={requestId:row.id,authSubject:userId,authProvider:'system',userId,companyId,membershipId,roles:[],scopes:{},permissions:member.roles.flatMap(r=>r.role.permissions.map(p=>p.permission.key))};
    await this.platform(context,key,tx);return context;
  }
  private async scheduledActors(row:BillingOperation,state:Awaited<ReturnType<BillingService['settings']>>,tx:Prisma.TransactionClient){
    const p=row.proposedJson as Proposed,a=(row.resultJson as {scheduledApproval?:ScheduledApproval}|null)?.scheduledApproval;
    if(!a||!row.approverUserId||row.approverUserId===row.initiatorUserId||!row.scheduledFor||row.scheduledFor.toISOString()!==p.effectiveAt||
      ![a.membershipId,a.companyId,a.credentialVersion,a.initiatorCredentialVersion,a.approvedAt].every(v=>typeof v==='string'&&v.length>0))throw stale();
    if(row.requestHash!==configurationHash([row.type,row.sourceVersion,p,row.reason,row.referenceId??null])||
      !Number.isFinite(Date.parse(a.approvedAt))||Date.parse(a.approvedAt)>=row.scheduledFor.getTime())throw stale();
    if(tx!==this.prisma.client)await tx.$queryRaw(Prisma.sql`SELECT "userId" FROM "UserCredential" WHERE "userId" IN (${Prisma.join([row.initiatorUserId,row.approverUserId].sort())}) ORDER BY "userId" FOR SHARE`);
    const initiator=await this.operationActor(row,row.initiatorUserId,p.membershipId,p.actorCompanyId,permission(row.type),tx);
    if(configurationHash(effectiveBillingGates(p.gates))!==configurationHash(state.gates))await this.platform(initiator,'system.billing.gate.manage',tx);
    const approver=await this.operationActor(row,row.approverUserId,a.membershipId,a.companyId,'system.billing.approval.approve',tx);
    if((await this.activeCredential(tx,row.initiatorUserId)).updatedAt.toISOString()!==a.initiatorCredentialVersion||
      (await this.activeCredential(tx,row.approverUserId)).updatedAt.toISOString()!==a.credentialVersion)throw new ForbiddenException();
    return approver;
  }
  private async executeScheduled(candidate:BillingOperation,caller?:RequestContext){
    const lease=randomUUID(),now=new Date();
    const claimed=await this.prisma.client.billingOperation.updateMany({where:{id:candidate.id,version:candidate.version,scheduledFor:{lte:now},
      stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,type:{in:types},state:{in:['SCHEDULED','RUNNING']},
      OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{state:'RUNNING',leaseToken:lease,leaseUntil:new Date(now.getTime()+120000),version:{increment:1}}});
    if(!claimed.count)return null;
    try{
      const proposed=candidate.proposedJson as Proposed,state=await this.billing.settings();
      await this.scheduledActors(candidate,state,this.prisma.client);await this.validateProvider(proposed.policy);
      await this.prisma.client.$transaction(async tx=>{
        const approval=(candidate.resultJson as {scheduledApproval:ScheduledApproval}).scheduledApproval;
        const companyIds=[...new Set([...proposed.impact?.salesCohort?.before??[],...proposed.policy.salesCompanyIds??[],proposed.actorCompanyId,approval.companyId])].sort();
        if(companyIds.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id IN (${Prisma.join(companyIds)}) ORDER BY id FOR SHARE`);
        const active=await this.lock(tx);
        const current=await tx.billingOperation.findFirst({where:{id:candidate.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}}});
        if(!current||current.requestHash!==candidate.requestHash||current.sourceVersion!==active.settings.version||
          configurationHash(current.proposedJson)!==configurationHash(candidate.proposedJson)||configurationHash(current.resultJson)!==configurationHash(candidate.resultJson))throw stale();
        const approver=await this.scheduledActors(current,active,tx);
        if(caller){await this.platform(caller,permission(current.type),tx);await this.requireProof(caller,tx);}
        await this.validateCompanies(proposed.policy,tx);
        if(configurationHash(await this.impact(proposed.policy,active.policy,tx))!==configurationHash(proposed.impact))throw stale();
        await this.publish(tx,active,current,proposed,caller??approver,!caller);
        await resolveBillingIssue(tx,{companyId:null,stripeAccountId:current.stripeAccountId,livemode:current.livemode,kind:'CONFIGURATION_SCHEDULE_REVIEW',referenceId:current.id},'SCHEDULED_CONFIGURATION_PUBLISHED');
      });return true;
    }catch(error){
      await this.prisma.client.$transaction(async tx=>{
        const changed=await tx.billingOperation.updateMany({where:{id:candidate.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{state:'BLOCKED',errorCode:error instanceof ForbiddenException?'CONTROL_PERMISSION_CHANGED':'CONTROL_SCHEDULE_REVIEW',leaseToken:null,leaseUntil:null,version:{increment:1}}});
        if(changed.count){
          await detectBillingIssue(tx,{companyId:null,stripeAccountId:candidate.stripeAccountId,livemode:candidate.livemode,kind:'CONFIGURATION_SCHEDULE_REVIEW',referenceId:candidate.id});
          await tx.auditLog.create({data:{actorType:'SERVICE',actorRefId:'billing-configuration-worker',action:'billing.configuration.schedule_blocked',targetType:'BillingOperation',targetId:candidate.id,
            requestId:candidate.id,result:'FAILED',riskLevel:'HIGH',metadataJson:{hash:candidate.requestHash,sourceVersion:candidate.sourceVersion,type:candidate.type}}});
        }
      });return false;
    }
  }
  async drainScheduled(){
    if(!this.billing.stripe.enabled)return {processed:0,failed:0};
    const rows=await this.prisma.client.billingOperation.findMany({where:{stripeAccountId:this.billing.stripe.accountId,livemode:this.billing.stripe.livemode,companyId:null,
      type:{in:types},state:{in:['SCHEDULED','RUNNING']},scheduledFor:{lte:new Date()},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:[{scheduledFor:'asc'},{id:'asc'}],take:5});
    let processed=0,failed=0;for(const row of rows){const result=await this.executeScheduled(row);if(result===true)processed++;else if(result===false)failed++;}return {processed,failed};
  }
  async applyScheduled(context:RequestContext,id:string,expectedVersion:number,previewHash:string){
    const row=await this.row(context,id);await this.platform(context,permission(row.type));await this.requireProof(context,this.prisma.client);
    if(row.requestHash!==previewHash)throw stale();if(row.state==='SUCCEEDED')return this.view(row,context);
    if(row.version!==expectedVersion||!['SCHEDULED','RUNNING'].includes(row.state)||(row.leaseUntil&&row.leaseUntil>new Date()))throw stale();
    if(!row.scheduledFor||row.scheduledFor>new Date())throw billingError('CONTROL_SCHEDULE_NOT_DUE','ยังไม่ถึงเวลาที่อนุมัติไว้');
    await this.executeScheduled(row,context);return this.get(context,id);
  }
  private async publish(tx:Prisma.TransactionClient,state:Awaited<ReturnType<BillingService['settings']>>,current:BillingOperation,proposed:Proposed,context:RequestContext,worker=false){
      const scheduledApproval=(current.resultJson as {scheduledApproval?:ScheduledApproval}|null)?.scheduledApproval;
      let revisionId = state.revision?.id ?? null;
      if (current.type === 'PUBLISH_POLICY') {
        const max = await tx.billingPolicyRevision.aggregate({ where: { stripeAccountId: current.stripeAccountId, livemode: current.livemode }, _max: { version: true } });
        const revision = await tx.billingPolicyRevision.create({ data: { stripeAccountId: current.stripeAccountId, livemode: current.livemode, version: (max._max.version ?? 0) + 1,
          state: 'ACTIVE', policyJson: proposed.policy as unknown as Prisma.InputJsonValue, createdByUserId: current.initiatorUserId, approvedByUserId: current.approverUserId??context.userId, approvedAt: scheduledApproval?new Date(scheduledApproval.approvedAt):new Date() } });
        revisionId = revision.id;
      }
      await tx.billingSettings.update({ where: { id: state.settings.id }, data: { policyRevisionId: revisionId, gatesJson: effectiveBillingGates(proposed.gates), version: { increment: 1 } } });
      const changed = await tx.billingOperation.updateMany({ where: { id:current.id,version:current.version,state:current.state,
        ...(current.scheduledFor?{leaseToken:current.leaseToken,leaseUntil:{gt:new Date()}}:{}) }, data: { state: 'SUCCEEDED', approverUserId: current.approverUserId??context.userId, observedAt: new Date(), leaseToken:null,leaseUntil:null,
        version: { increment: 1 }, resultJson: { ...scheduledApproval?{scheduledApproval}:{}, activeRevisionId: revisionId, settingsVersion: state.settings.version + 1 } } });
      if(!changed.count)throw stale();
      const updated=await tx.billingOperation.findUniqueOrThrow({where:{id:current.id}});
      await this.audit(tx, context, updated, 'published',worker); return updated;
  }
  async cancel(context: RequestContext, id: string, expectedVersion: number) {
    const row = await this.prisma.client.$transaction(async tx => {
      await this.platform(context, 'system.billing.read', tx);
      await this.lock(tx);
      const current = await this.row(context, id, tx);
      const scheduled=Boolean(current.scheduledFor&&['SCHEDULED','BLOCKED'].includes(current.state));
      if(current.initiatorUserId!==context.userId){if(!scheduled)throw new ForbiddenException();
        if(current.approverUserId!==context.userId)await this.platform(context,permission(current.type),tx);await this.requireProof(context,tx);}
      const changed = await tx.billingOperation.updateMany({ where: { id, version: expectedVersion, state: { in: ['DRAFT','PREVIEW', 'AWAITING_APPROVAL',...scheduled?['SCHEDULED','BLOCKED']:[]] } }, data: { state: 'CANCELLED', version: { increment: 1 } } });
      if (!changed.count) throw stale(); await this.audit(tx, context, current, 'cancelled');
      if(scheduled)await resolveBillingIssue(tx,{companyId:null,stripeAccountId:current.stripeAccountId,livemode:current.livemode,kind:'CONFIGURATION_SCHEDULE_REVIEW',referenceId:id},'UNEXECUTED_SCHEDULE_CANCELLED');
      return tx.billingOperation.findUniqueOrThrow({ where: { id } });
    }); return this.view(row, context);
  }
  async close(context: RequestContext, input: { expectedVersion: number; gates: unknown; reason: string }, key: string) {
    const gates = this.gates(input.gates);
    if (!Number.isInteger(input.expectedVersion) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500 || !/^[a-zA-Z0-9_-]{16,120}$/.test(key)) throw new BadRequestException('Invalid close request');
    const hash = configurationHash([input.expectedVersion, gates, input.reason.trim()]);
    const row = await this.prisma.client.$transaction(async tx => {
      await this.platform(context, 'system.billing.gate.manage', tx);
      const state = await this.lock(tx);
      const replay = await tx.billingOperation.findUnique({ where: { stripeAccountId_livemode_idempotencyKey: { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode, idempotencyKey: key } } });
      if (replay) { if (replay.requestHash !== hash || replay.initiatorUserId !== context.userId) throw stale(); return replay; }
      await this.requireProof(context, tx);
      if (state.settings.version !== input.expectedVersion) throw stale();
      if (BILLING_ACTIONS.some(a => gates[a] && !state.gates[a]) || configurationHash(gates) === configurationHash(state.gates)) throw new BadRequestException('Emergency action only closes gates');
      const policy = state.policy ?? BILLING_DRAFT_POLICY, proposed: Proposed = { policy, gates, impact: await this.impact(policy, state.policy, tx),
        sourcePolicyRevision: state.revision?.id ?? null, membershipId: context.membershipId, actorCompanyId: context.companyId, sessionId: context.sessionId! };
      await tx.billingSettings.update({ where: { id: state.settings.id }, data: { gatesJson: gates, version: { increment: 1 } } });
      const operation = await tx.billingOperation.create({ data: { stripeAccountId: this.billing.stripe.accountId, livemode: this.billing.stripe.livemode,
        type: 'SET_ACTION_GATE', state: 'SUCCEEDED', sourceVersion: input.expectedVersion, proposedJson: proposed as unknown as Prisma.InputJsonValue,
        reason: input.reason.trim(), initiatorUserId: context.userId, idempotencyKey: key, requestHash: hash, expiresAt: new Date(), observedAt: new Date(),
        resultJson: { activeRevisionId: state.revision?.id ?? null, settingsVersion: state.settings.version + 1 } } });
      await this.audit(tx, context, operation, 'emergency_closed'); return operation;
    }); return this.view(row, context);
  }
}
