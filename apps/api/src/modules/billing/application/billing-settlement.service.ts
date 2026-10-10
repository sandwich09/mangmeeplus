import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BillingSettlementRun, BillingSettlementFindings } from '@watchdog-bms/contracts';
import type { BillingAccount, BillingInvoice, BillingOperation, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { StripeClient, StripeRequestError, stripeId } from '../infrastructure/stripe.client';
import { assertKeys, billingError, configurationHash } from '../domain/billing-policy';
import { BillingAdminService } from './billing-admin.service';
import { BillingConfigurationService } from './billing-configuration.service';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';
import { assertMappedCharge } from './billing-financial';
import { assertOriginalInvoiceCharge, nativeId } from './billing-refund-source';
import { originalInvoice, chargeIdPrefix, refundIdPrefix } from './billing-invoice-details';
import { settlementPage, settlementPayout, type SettlementMovement, type SettlementPayout } from './billing-settlement-source';
import { scheduleConfig } from './billing-provider-scans.service';

const TYPE='SCAN_PROVIDER_BALANCE',FINDING='OBSERVE_PROVIDER_BALANCE',RUN='system.billing.reconcile.run';
const stale=()=>billingError('CONTROL_PREVIEW_STALE','งานหรือข้อมูลเปลี่ยนแล้ว กรุณาโหลดผลล่าสุด');
const json=(v:unknown)=>v as Prisma.InputJsonValue;
type Source={since:number;until:number;membershipId:string;actorCompanyId:string;scheduleId?:string};
type Totals={grossCharges:string;knownTax:string;unknownTaxCharges:number;fees:string;netMovement:string;payouts:string;payoutReversals:string;excluded:number};
type Progress={totals:Totals;cursor:string|null;pages:number;seen:number;matched:number;different:number;manual:number;missing:number;failures:number;retryAt:string|null};
const empty=():Progress=>({totals:{grossCharges:'0',knownTax:'0',unknownTaxCharges:0,fees:'0',netMovement:'0',payouts:'0',payoutReversals:'0',excluded:0},cursor:null,pages:0,seen:0,matched:0,different:0,manual:0,missing:0,failures:0,retryAt:null});
type Observation={movement:SettlementMovement;classification:'MATCHED'|'DIFFERENT'|'MANUAL'|'LOCAL_MISSING';
  refundState:string|null;taxSatang:number|null;payout:SettlementPayout|null;invoiceId:string|null;companyId:string|null;accountId:string|null;localHash:string|null;disputed:boolean|null};
const localSource=(a:BillingAccount,i:BillingInvoice)=>configurationHash([a.id,a.companyId,a.customerId,a.stripeAccountId,a.livemode,i.id,i.billingAccountId,
  i.providerInvoiceId,i.providerChargeId,i.subscriptionId,i.totalSatang,i.paidSatang,i.taxSatang,i.providerStatus,i.refundedSatang,i.disputed]);

@Injectable()
export class BillingSettlementService{
  constructor(private readonly prisma:PrismaService,private readonly stripe:StripeClient,private readonly admin:BillingAdminService,private readonly configuration:BillingConfigurationService){}
  private where(){return {type:TYPE,companyId:null,stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode};}
  private async access(context:RequestContext,key='system.billing.financial.read',tx:Prisma.TransactionClient=this.prisma.client){
    const access=await this.admin.access(context,'system.billing.read',tx);await this.admin.access(context,'system.billing.financial.read',tx);await this.admin.access(context,key,tx);
    if(!access.platformScope)throw new ForbiddenException();return access;
  }
  private lock(tx:Prisma.TransactionClient){return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-settlement:${this.stripe.accountId}:${this.stripe.livemode}`},0))`;}
  private async row(id:string,tx:Prisma.TransactionClient=this.prisma.client){const row=await tx.billingOperation.findFirst({where:{...this.where(),id}});if(!row)throw new NotFoundException();return row;}
  private view(row:BillingOperation,context:RequestContext,manage:boolean):BillingSettlementRun{
    const p=row.proposedJson as Source,r=row.resultJson as Progress,available=!row.leaseUntil||row.leaseUntil<=new Date();
    return {id:row.id,mode:row.livemode?'LIVE':'TEST',state:row.state,version:row.version,reason:row.reason,windowStart:new Date(p.since*1000).toISOString(),windowEnd:new Date(p.until*1000).toISOString(),
      createdAt:row.createdAt.toISOString(),observedAt:row.observedAt?.toISOString()??null,pages:r.pages,seen:r.seen,matched:r.matched,different:r.different,manual:r.manual,missing:r.missing,
      totals:r.totals,errorCode:row.errorCode,retryAt:r.retryAt,canCancel:manage&&!['SUCCEEDED','CANCELLED'].includes(row.state),
      canResume:manage&&this.stripe.enabled&&row.initiatorUserId===context.userId&&available&&['UNKNOWN','BLOCKED'].includes(row.state)&&row.errorCode!=='PAGE_LIMIT_REACHED'&&row.expiresAt>new Date()&&(!r.retryAt||Date.parse(r.retryAt)<=Date.now()),
      canRun:manage&&this.stripe.enabled&&available&&['QUEUED','RUNNING'].includes(row.state)&&(!r.retryAt||Date.parse(r.retryAt)<=Date.now())};
  }
  async get(context:RequestContext,id:string){const access=await this.access(context),row=await this.row(id);return this.view(row,context,access.capabilities.includes(RUN));}
  async list(context:RequestContext,cursor?:string){
    const access=await this.access(context),after=cursor?await this.row(cursor):null;
    const rows=await this.prisma.client.billingOperation.findMany({where:{...this.where(),...after?{OR:[{createdAt:{lt:after.createdAt}},{createdAt:after.createdAt,id:{lt:after.id}}]}:{}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    return {items:rows.slice(0,25).map(row=>this.view(row,context,access.capabilities.includes(RUN))),nextCursor:rows.length>25?rows[24]!.id:null,canCreate:this.stripe.enabled&&access.capabilities.includes(RUN)};
  }
  async findings(context:RequestContext,id:string,cursor?:string):Promise<BillingSettlementFindings>{
    await this.access(context);const run=await this.row(id),where={type:FINDING,referenceId:id,companyId:null,stripeAccountId:run.stripeAccountId,livemode:run.livemode};
    const anchor=cursor?await this.prisma.client.billingOperation.findFirst({where:{...where,id:cursor}}):null;
    if(cursor&&!anchor)throw new NotFoundException();
    const rows=await this.prisma.client.billingOperation.findMany({where:{...where,...anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{}},
      orderBy:[{createdAt:'desc'},{id:'desc'}],take:26});
    const companies=await this.prisma.client.company.findMany({where:{id:{in:[...new Set(rows.flatMap(r=>{const o=r.proposedJson as unknown as Observation;return o.companyId?[o.companyId]:[];}))]}},select:{id:true,name:true}});
    const issues=await this.prisma.client.billingIssue.findMany({where:{companyId:null,stripeAccountId:run.stripeAccountId,livemode:run.livemode,referenceId:id,kind:{in:['SETTLEMENT_REVIEW','SETTLEMENT_SCAN_FAILED']}},orderBy:{createdAt:'desc'},select:{id:true}});
    return {items:rows.slice(0,25).map(row=>{
      const o=row.proposedJson as unknown as Observation,m=o.movement;
      return {id:row.id,runId:id,classification:o.classification,companyId:o.companyId,companyName:companies.find(c=>c.id===o.companyId)?.name??null,invoiceId:o.invoiceId,
        observedAt:row.observedAt!.toISOString(),createdAt:new Date(m.created*1000).toISOString(),availableAt:new Date(m.availableOn*1000).toISOString(),
        refundState:o.refundState,kind:m.type,currency:m.currency.toUpperCase(),amountSatang:m.amount,feeSatang:m.fee,netSatang:m.net,taxSatang:o.taxSatang,availability:m.status,
        payout:o.payout?{status:o.payout.status,expectedArrivalAt:new Date(o.payout.arrivalAt*1000).toISOString(),automatic:o.payout.automatic,
          reconciliation:o.payout.reconciliation,constituentCount:o.payout.constituentCount}:null};
    }),nextCursor:rows.length>25?rows[24]!.id:null,caseIds:issues.map(i=>i.id)};
  }
  async create(context:RequestContext,input:{windowStart:string;windowEnd:string;reason:string},key:string){
    assertKeys(input,['windowStart','windowEnd','reason']);await this.access(context,RUN);
    if(!this.stripe.enabled)throw billingError('BILLING_NOT_CONFIGURED','ยังไม่ได้เปิดการเชื่อมต่อ Stripe');
    const p:Source={since:Date.parse(input.windowStart)/1000,until:Date.parse(input.windowEnd)/1000,membershipId:context.membershipId,actorCompanyId:context.companyId};
    if(![input.windowStart,input.windowEnd].every(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(v))||
      ![p.since,p.until].every(Number.isSafeInteger)||p.since<0||p.since>=p.until||p.until-p.since>31*86400||p.until>Math.floor(Date.now()/1000)-60||
      typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||typeof key!=='string'||!/^[a-zA-Z0-9_-]{16,120}$/.test(key))throw new BadRequestException();
    const reason=input.reason.trim(),hash=configurationHash([TYPE,p,reason,context.userId]);
    const row=await this.prisma.client.$transaction(async tx=>{
      await lockPlanTermCompany(tx,context.companyId);await this.configuration.operationActor({id:context.requestId} as BillingOperation,context.userId,context.membershipId,context.companyId,RUN,tx);await this.lock(tx);await this.access(context,RUN,tx);
      const old=await tx.billingOperation.findUnique({where:{stripeAccountId_livemode_idempotencyKey:{stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode,idempotencyKey:key}}});
      if(old){if(old.type!==TYPE||old.requestHash!==hash||old.initiatorUserId!==context.userId)throw billingError('CONTROL_IDEMPOTENCY_CONFLICT','คำขอต่างจากงานเดิม');return old;}
      if(await tx.billingOperation.count({where:{...this.where(),state:{in:['QUEUED','RUNNING']}}})>=5)throw billingError('CONTROL_SCAN_BUSY','มีงานตรวจที่ยังไม่จบ กรุณาเปิดงานเดิมก่อน');
      const saved=await tx.billingOperation.create({data:{...this.where(),state:'QUEUED',proposedJson:json(p),reason,sourceVersion:0,initiatorUserId:context.userId,
        requestHash:hash,idempotencyKey:key,expiresAt:new Date(Date.now()+31*86400000),resultJson:json(empty())}});await this.audit(tx,saved,'created',context.userId);return saved;
    });return this.view(row,context,true);
  }
  private async actor(row:BillingOperation,tx:Prisma.TransactionClient){
    const p=row.proposedJson as Source;
    if(row.type!==TYPE||row.stripeAccountId!==this.stripe.accountId||row.livemode!==this.stripe.livemode||row.companyId!==null||row.requestHash!==configurationHash([TYPE,p,row.reason,row.initiatorUserId]))throw stale();
    if(!await tx.companyMembership.findFirst({where:{id:p.membershipId,userId:row.initiatorUserId,companyId:p.actorCompanyId},select:{id:true}}))throw new ForbiddenException();
    const context=await this.configuration.operationActor(row,row.initiatorUserId,p.membershipId,p.actorCompanyId,RUN,tx);
    await this.access(context,RUN,tx);return context;
  }
  async action(context:RequestContext,id:string,action:'resume'|'cancel'|'run',version:number){
    await this.access(context,RUN);if(!['resume','cancel','run'].includes(action)||!Number.isSafeInteger(version)||version<0)throw new BadRequestException();
    if(action==='run'){const row=await this.row(id);if(row.version!==version||!this.view(row,context,true).canRun)throw stale();await this.execute(row);return this.get(context,id);}
    const row=await this.prisma.client.$transaction(async tx=>{
      await lockPlanTermCompany(tx,context.companyId);await this.configuration.operationActor({id:context.requestId} as BillingOperation,context.userId,context.membershipId,context.companyId,RUN,tx);await this.lock(tx);await this.access(context,RUN,tx);const row=await this.row(id,tx),view=this.view(row,context,true);
      if(row.version!==version||!(action==='cancel'?view.canCancel:view.canResume))throw stale();
      if(action==='resume'){await this.actor(row,tx);if(await tx.billingOperation.count({where:{...this.where(),state:{in:['QUEUED','RUNNING']}}})>=5)throw billingError('CONTROL_SCAN_BUSY','เปิดงานเดิมหรือตรวจใหม่หลังงานที่รอจบแล้ว');}
      const saved=await tx.billingOperation.update({where:{id},data:{state:action==='cancel'?'CANCELLED':'QUEUED',leaseToken:null,leaseUntil:null,
        resultJson:json({...row.resultJson as object,failures:0,retryAt:null}),version:{increment:1}}});
      if(action==='cancel')await resolveBillingIssue(tx,{companyId:null,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'SETTLEMENT_SCAN_FAILED',referenceId:id},'SETTLEMENT_CANCELLED_INCOMPLETE');
      await this.audit(tx,saved,action,context.userId);return saved;
    });return this.view(row,context,true);
  }
  private audit(tx:Prisma.TransactionClient,row:BillingOperation,action:string,userId?:string){return tx.auditLog.create({data:{companyId:null,actorUserId:userId??null,
    ...userId?{}:{actorType:'SERVICE',actorRefId:'billing-settlement-worker'},action:`billing.settlement.${action}`,targetType:'BillingOperation',targetId:row.id,requestId:row.id,
    riskLevel:'HIGH',result:'SUCCESS',metadataJson:{mode:row.livemode?'LIVE':'TEST',version:row.version,state:row.state}}});}
  private async observation(movement:SettlementMovement):Promise<Observation>{
    const result:Observation={movement,classification:'MANUAL',refundState:null,taxSatang:null,payout:null,invoiceId:null,companyId:null,accountId:null,localHash:null,disputed:null};
    if(movement.currency!=='thb'||(movement.balanceType&&movement.balanceType!=='payments'))return result;
    if(['payout','payout_failure','payout_cancel'].includes(movement.type)){
      result.payout=await settlementPayout(this.stripe,movement);result.classification=result.payout.reconciliation==='MATCHED'?'MATCHED':'MANUAL';return result;
    }
    if(movement.type!=='charge'&&movement.type!=='refund')return result;
    const sourceId=movement.sourceId;
    if(!nativeId(sourceId,movement.type==='charge'?chargeIdPrefix:refundIdPrefix))throw new StripeRequestError('REJECTED','settlement_source_invalid');
    const value=await this.stripe.request('GET',`/${movement.type==='charge'?'charges':'refunds'}/${sourceId}`);
    if(value.id!==sourceId||value.object!==movement.type||(movement.type==='charge'?value.livemode!==this.stripe.livemode:value.livemode!==undefined&&value.livemode!==this.stripe.livemode)||value.currency!==movement.currency||stripeId(value.balance_transaction)!==movement.id||
      !Number.isSafeInteger(value.amount)||value.amount<1||movement.amount!==(movement.type==='charge'?value.amount:-value.amount))throw new StripeRequestError('REJECTED','settlement_source_invalid');
    if(movement.type==='refund'){if(!['pending','requires_action','succeeded','failed','canceled'].includes(value.status))throw new StripeRequestError('REJECTED','settlement_refund_state');result.refundState=value.status;}
    const chargeId=movement.type==='charge'?sourceId:stripeId(value.charge);
    if(!nativeId(chargeId,chargeIdPrefix))throw new StripeRequestError('REJECTED','settlement_source_invalid');
    const matches=await this.prisma.client.$queryRaw<Array<{id:string}>>`SELECT i.id FROM "BillingInvoice" i JOIN "BillingAccount" a ON a.id=i."billingAccountId"
      WHERE i."providerChargeId"=${chargeId} AND a."stripeAccountId"=${this.stripe.accountId} AND a.livemode=${this.stripe.livemode} LIMIT 2`;
    if(matches.length>1)throw new StripeRequestError('REJECTED','settlement_mapping_ambiguous');
    if(!matches[0])return {...result,classification:'LOCAL_MISSING'};
    const row=await this.prisma.client.billingInvoice.findUniqueOrThrow({where:{id:matches[0].id}});
    const account=await this.prisma.client.billingAccount.findUniqueOrThrow({where:{id:row.billingAccountId}}),charge=movement.type==='charge'?value:await this.stripe.request('GET',`/charges/${chargeId}`);
    try{assertMappedCharge(charge,account,row);}catch{throw new StripeRequestError('REJECTED','settlement_charge_mismatch');}
    const invoice=await originalInvoice(this.stripe,account,row);await assertOriginalInvoiceCharge(this.stripe,account,row,charge);
    if(!Array.isArray(invoice.total_taxes)||invoice.total_taxes.some((t:{amount:unknown})=>!t||!Number.isSafeInteger(t.amount)||(t.amount as number)<0)||
      invoice.total_taxes.reduce((sum:number,t:{amount:number})=>sum+t.amount,0)!==row.taxSatang)throw new StripeRequestError('REJECTED','settlement_tax_mismatch');
    return {...result,classification:movement.type==='refund'&&result.refundState!=='succeeded'?'MANUAL':row.refundedSatang===charge.amount_refunded&&row.disputed===charge.disputed?'MATCHED':'DIFFERENT',
      taxSatang:movement.type==='charge'?row.taxSatang:null,invoiceId:row.id,companyId:account.companyId,accountId:account.id,localHash:localSource(account,row),disputed:charge.disputed};
  }
  private async execute(candidate:BillingOperation){
    const lease=randomUUID(),now=new Date();
    const got=await this.prisma.client.billingOperation.updateMany({where:{...this.where(),id:candidate.id,version:candidate.version,state:{in:['QUEUED','RUNNING']},
      OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{state:'RUNNING',leaseToken:lease,leaseUntil:new Date(now.getTime()+120000),version:{increment:1}}});if(!got.count)return;
    const p=candidate.proposedJson as Source,progress=candidate.resultJson as Progress;
    try{
      await this.actor(candidate,this.prisma.client);if(candidate.expiresAt<=new Date())throw new StripeRequestError('REJECTED','settlement_request_expired');
      if(progress.pages>=2000)throw new StripeRequestError('REJECTED','PAGE_LIMIT_REACHED');await this.stripe.assertAccount();
      const page=settlementPage(await this.stripe.request('GET','/balance_transactions',{created:{gte:p.since,lt:p.until},limit:25,...progress.cursor?{starting_after:progress.cursor}:{}}),p,progress.cursor);
      if(page.rows.length>25)throw new StripeRequestError('REJECTED','settlement_page_invalid');
      const observed:Observation[]=[];for(const movement of page.rows){
        observed.push(await this.observation(movement));if(Date.now()-now.getTime()>75000)break;
      }
      const hasMore=page.hasMore||observed.length<page.rows.length,nextCursor=hasMore?observed.at(-1)!.movement.id:null;
      await this.prisma.client.$transaction(async tx=>{
        for(const companyId of [...new Set([p.actorCompanyId,...observed.flatMap(o=>o.companyId?[o.companyId]:[])])].sort())await lockPlanTermCompany(tx,companyId);
        await this.lock(tx);const row=await this.row(candidate.id,tx);await this.actor(row,tx);
        if(row.expiresAt<=new Date()||row.requestHash!==candidate.requestHash||row.state!=='RUNNING'||row.leaseToken!==lease||!row.leaseUntil||row.leaseUntil<=new Date())throw stale();
        const prior=await tx.billingOperation.count({where:{type:FINDING,referenceId:row.id,stripeAccountId:row.stripeAccountId,livemode:row.livemode,
          idempotencyKey:{in:observed.map(o=>`settlement:${row.id}:${o.movement.id}`)}}});if(prior)throw new StripeRequestError('REJECTED','settlement_page_duplicate');
        for(const accountId of [...new Set(observed.flatMap(o=>o.accountId?[o.accountId]:[]))].sort())await tx.$queryRaw`SELECT id FROM "BillingAccount" WHERE id=${accountId} FOR SHARE`;
        for(const invoiceId of observed.flatMap(o=>o.invoiceId?[o.invoiceId]:[]).sort())await tx.$queryRaw`SELECT id FROM "BillingInvoice" WHERE id=${invoiceId} FOR SHARE`;
        for(const o of observed){if(o.invoiceId){const invoice=await tx.billingInvoice.findUnique({where:{id:o.invoiceId}});
          const account=invoice?await tx.billingAccount.findUnique({where:{id:invoice.billingAccountId}}):null;
          if(!invoice||!account||localSource(account,invoice)!==o.localHash)throw new StripeRequestError('REJECTED','settlement_mapping_changed');}
          await tx.billingOperation.create({data:{companyId:null,stripeAccountId:row.stripeAccountId,livemode:row.livemode,type:FINDING,referenceId:row.id,state:'SUCCEEDED',
            sourceVersion:progress.pages,requestHash:configurationHash(o),idempotencyKey:`settlement:${row.id}:${o.movement.id}`,proposedJson:json(o),initiatorUserId:row.initiatorUserId,
            reason:'Original Stripe balance observation',observedAt:new Date(),expiresAt:row.expiresAt}});}
        const counts={...progress,totals:{...progress.totals},cursor:nextCursor,pages:progress.pages+1,seen:progress.seen+observed.length,failures:0,retryAt:null};
        for(const o of observed){const m=o.movement,t=counts.totals;
          if(m.currency!=='thb'||m.balanceType&&m.balanceType!=='payments')t.excluded++;
          else{t.fees=String(BigInt(t.fees)+BigInt(m.fee));t.netMovement=String(BigInt(t.netMovement)+BigInt(m.net));
            if(m.type==='charge'){t.grossCharges=String(BigInt(t.grossCharges)+BigInt(m.amount));if(o.taxSatang===null)t.unknownTaxCharges++;else t.knownTax=String(BigInt(t.knownTax)+BigInt(o.taxSatang));}
            if(m.type==='payout')t.payouts=String(BigInt(t.payouts)-BigInt(m.amount));
            if(['payout_failure','payout_cancel'].includes(m.type))t.payoutReversals=String(BigInt(t.payoutReversals)+BigInt(m.amount));}
          if(o.classification==='MATCHED')counts.matched++;else if(o.classification==='DIFFERENT')counts.different++;else if(o.classification==='LOCAL_MISSING')counts.missing++;else counts.manual++;}
        const saved=await tx.billingOperation.updateMany({where:{id:row.id,version:row.version,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{state:hasMore?'QUEUED':'SUCCEEDED',resultJson:json(counts),
          observedAt:new Date(),errorCode:null,leaseToken:null,leaseUntil:null,version:{increment:1}}});if(!saved.count)throw stale();
        if(!hasMore)await resolveBillingIssue(tx,{companyId:null,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'SETTLEMENT_SCAN_FAILED',referenceId:row.id},'SETTLEMENT_SCAN_COMPLETED');
        if(counts.different||counts.missing||counts.manual)await detectBillingIssue(tx,{companyId:null,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'SETTLEMENT_REVIEW',referenceId:row.id});
        await this.audit(tx,await this.row(row.id,tx),'observed');
      });
    }catch(error){
      await this.prisma.client.$transaction(async tx=>{
        await this.lock(tx);const row=await this.row(candidate.id,tx);
        const rejected=error instanceof HttpException&&error.getStatus()<500||error instanceof StripeRequestError&&(error.outcome==='REJECTED'||error.code==='mode_mismatch'),r=row.resultJson as Progress,failures=r.failures+1;
        const wait=Math.min(3600,Math.max(error instanceof StripeRequestError?error.retryAfterSeconds:60,60*2**Math.min(failures-1,6)));
        const code=error instanceof ForbiddenException?'CONTROL_PERMISSION_CHANGED':error instanceof StripeRequestError&&error.code==='PAGE_LIMIT_REACHED'?'PAGE_LIMIT_REACHED':rejected?'SETTLEMENT_SOURCE_REVIEW':'SETTLEMENT_PROVIDER_UNAVAILABLE';
        const saved=await tx.billingOperation.updateMany({where:{id:row.id,state:'RUNNING',leaseToken:lease,leaseUntil:{gt:new Date()}},data:{state:rejected?'BLOCKED':failures>=5?'UNKNOWN':'QUEUED',
          resultJson:json({...r,failures,retryAt:rejected?null:new Date(Date.now()+wait*1000).toISOString()}),errorCode:code,leaseToken:null,leaseUntil:null,version:{increment:1}}});
        if(saved.count){await detectBillingIssue(tx,{companyId:null,stripeAccountId:row.stripeAccountId,livemode:row.livemode,kind:'SETTLEMENT_SCAN_FAILED',referenceId:row.id});await this.audit(tx,await this.row(row.id,tx),'review');}
      });
    }
  }
  /**
   * Executive spec §14.1 (Q21): one balance scan per finished Bangkok day, queued by the worker that already drains
   * these jobs. It runs only while the provider-scan schedule (CONFIGURE_PROVIDER_SCANS) is published and enabled, as
   * that schedule's owner, whose permission `actor()` checks again on every page. The key is the day, so a second
   * call, a second task and a restart all find the same job.
   */
  async scheduleDaily(){
    const day=86400,until=Math.floor((Date.now()/1000+7*3600)/day)*day-7*3600,key=`scheduled-settlement:${until}`;
    const unique={stripeAccountId_livemode_idempotencyKey:{stripeAccountId:this.stripe.accountId,livemode:this.stripe.livemode,idempotencyKey:key}};
    if(await this.prisma.client.billingOperation.findUnique({where:unique,select:{id:true}}))return;
    await this.prisma.client.$transaction(async tx=>{
      await this.lock(tx);if(await tx.billingOperation.findUnique({where:unique,select:{id:true}}))return;
      const publication=await tx.billingOperation.findFirst({where:{...this.where(),type:'CONFIGURE_PROVIDER_SCANS',state:'SUCCEEDED'},orderBy:[{sourceVersion:'desc'},{id:'desc'}]});
      if(!publication||!scheduleConfig(publication.proposedJson)?.enabled)return;
      let context:RequestContext;
      try{context=await this.admin.authorizeOperation(publication,RUN,tx);await this.access(context,RUN,tx);}catch{return;}
      if(await tx.billingOperation.count({where:{...this.where(),state:{in:['QUEUED','RUNNING']}}})>=5)return;
      // ponytail: a day the worker missed is read by the next job (from where the last scheduled one ended, 31 days at most);
      // a failed job keeps its own window for the admin, so one bad day never stops the days after it.
      const last=await tx.billingOperation.findFirst({where:{...this.where(),idempotencyKey:{startsWith:'scheduled-settlement:'}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{proposedJson:true}});
      const since=Math.max(until-31*day,Math.min(until-day,last?(last.proposedJson as Source).until:until-day));
      const p:Source={since,until,membershipId:context.membershipId,actorCompanyId:context.companyId,scheduleId:publication.id},reason=`อ่านยอดอัตโนมัติรายวัน · การตั้งค่ารุ่น ${publication.sourceVersion+1}`;
      const saved=await tx.billingOperation.create({data:{...this.where(),state:'QUEUED',proposedJson:json(p),reason,sourceVersion:0,initiatorUserId:context.userId,
        requestHash:configurationHash([TYPE,p,reason,context.userId]),idempotencyKey:key,expiresAt:new Date(Date.now()+31*day*1000),resultJson:json(empty())}});
      await this.audit(tx,saved,'scheduled');
    });
  }
  async drain(){
    if(!this.stripe.enabled)return {processed:0,failed:0};
    await this.scheduleDaily();
    const rows=await this.prisma.client.billingOperation.findMany({where:{...this.where(),state:{in:['QUEUED','RUNNING']},OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},orderBy:[{updatedAt:'asc'},{id:'asc'}],take:5});
    const row=rows.find(r=>!(r.resultJson as Progress).retryAt||Date.parse((r.resultJson as Progress).retryAt!)<=Date.now());if(!row)return {processed:0,failed:0};
    try{await this.execute(row);return {processed:1,failed:0};}catch{return {processed:1,failed:1};}
  }
}
