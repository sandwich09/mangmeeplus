import {ensureBillingCompanyProof} from './billing-configuration-drafts-smoke';
import { checkAdminCollectionControl } from './billing-admin-collection-smoke';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { billingOffer } from '@watchdog-bms/contracts';
import type { checkBillingConfigurationDrafts } from './billing-configuration-drafts-smoke';
import { appendPackageInterval } from '../modules/billing/domain/billing-package';
import { upgradeHistory } from '../modules/billing/application/billing-upgrade';
import { termProjectionHash } from '../modules/billing/domain/paid-invoice';

/** Real approved Admin commands and DB/HTTP/browser; Stripe schedule transport is simulated. */
export async function checkBillingFreeDays(input: Parameters<typeof checkBillingConfigurationDrafts>[0], companyId: string, accountId: string) {
  const { prisma, request, approveRequest, browser, secondBrowser, provider, repeatFixture: fixture } = input, db = prisma.client;
  const base = '/v1/system/billing', company = `${base}/companies/${companyId}`, customer = `/v1/companies/${companyId}/billing`;
  const tag = randomUUID().replaceAll('-', ''), start = new Date(Math.floor(Date.now()/1000)*1000), end = new Date(start.getTime()+30*86400000);
  const priceId = `price_FreeDays${tag}`, zeroId = `price_FreeDaysZero${tag}`, subId = `sub_FreeDays${tag}`, customerId = `cus_FreeDays${tag}`;
  const ownerEmail = (await db.user.findUniqueOrThrow({where:{id:input.userIds[0]!}})).email;
  const offer = { ...billingOffer('BASIC_499','month'), availability:'AVAILABLE', reason:null };
  const policy = { ...(await request(`${base}/settings`)).body.policy, zeroPriceIds:{'BASIC_499:month':zeroId}, taxTreatment:'NOT_VAT_REGISTERED',taxRateId:null };
  const snapshot = {quote:{offer,totalSatang:offer.priceSatang,taxSatang:0,subtotalSatang:offer.priceSatang},policy,priceId,settingsVersion:0};
  const sub:any = {id:subId,object:'subscription',livemode:false,customer:customerId,metadata:{billingAccountId:accountId},status:'active',
    billing_mode:{type:'classic'},collection_method:'charge_automatically',billing_cycle_anchor:start.getTime()/1000,cancel_at:null,cancel_at_period_end:false,
    automatic_tax:{enabled:false},discounts:[],default_tax_rates:[],items:{has_more:false,data:[{id:`si_${tag}`,price:priceId,quantity:1,tax_rates:[],current_period_start:start.getTime()/1000,current_period_end:end.getTime()/1000}]}};
  provider.subscriptions!.push(sub);
  const ids:string[]=[]; let invoiceId:string|undefined;
  const get=(id:string)=>request(`${base}/plan-adjustments/${id}`);
  const cmd=(op:any,action:string,actor=request)=>actor(`${base}/plan-adjustments/${op.id}/${action}`,'POST',{expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`free-days-${op.id}`});
  const preview=async(days=7)=>request(`${company}/plan-adjustments/preview`,'POST',{type:'GRANT_FREE_DAYS',days,reason:'ชดเชยวันใช้งานตามที่ตรวจแล้ว',sourceHash:(await request(`${company}/plan-adjustments`)).body.sourceHash});
  const paidInvoice:any={id:`in_${tag}`,object:'invoice',customer:customerId,status:'paid',total:offer.priceSatang};
  const nativeInvoices=[paidInvoice];
  const charge:any={id:`ch_${tag}`,object:'charge',livemode:false,customer:customerId,amount:offer.priceSatang,currency:'thb',status:'succeeded',paid:true,captured:true,amount_refunded:0,disputed:false};
  const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  input.transport(async(url,init)=>{
    if(url.hostname!=='api.stripe.com')return;
    const path=url.pathname.replace(/^\/v1/,'');
    if(path===`/customers/${customerId}`&&(!init?.method||init.method==='GET'))return response({id:customerId,object:'customer',livemode:false,email:ownerEmail,metadata:{billingAccountId:accountId}});
    if(path===`/prices/${priceId}`||path===`/prices/${zeroId}`)return response({id:path.endsWith(zeroId)?zeroId:priceId,object:'price',product:`prod_${tag}`,livemode:false,active:true,type:'recurring',currency:'thb',
      unit_amount:path.endsWith(zeroId)?0:offer.priceSatang,recurring:{interval:'month',interval_count:1,usage_type:'licensed'},billing_scheme:'per_unit',tax_behavior:'inclusive'});
    if(path===`/subscriptions/${subId}`&&(!init?.method||init.method==='GET'))return response(sub);
    if(path==='/subscriptions'&&url.searchParams.get('customer')===customerId)return response({object:'list',data:[sub],has_more:false});
    if(path==='/invoices'&&url.searchParams.get('subscription')===subId)return response({object:'list',data:nativeInvoices,has_more:false});
    if(path===`/charges/${charge.id}`)return response(charge);
    return undefined;
  });
  try {
    const term=await db.companyPlanTerm.update({where:{companyId},data:{termStartAt:start,termEndsAt:end}});
    await db.billingAccount.update({where:{id:accountId},data:{customerId,baseSubscriptionId:subId,subscriptionState:'active',paidThrough:end,nextChargeAt:end,termProjectionHash:termProjectionHash(term)}});
    await db.billingSubscriptionContract.create({data:{billingAccountId:accountId,sourceAttemptId:`fixture-${tag}`,effectiveAt:start,snapshotJson:snapshot}});
    const invoice=await db.billingInvoice.create({data:{billingAccountId:accountId,providerInvoiceId:paidInvoice.id,subscriptionId:subId,providerChargeId:charge.id,
      offerSnapshot:offer,contractSnapshot:snapshot,policyRevisionId:'SYNTHETIC_FREE_DAYS',currency:'thb',totalSatang:offer.priceSatang,paidSatang:offer.priceSatang,
      periodStart:start,periodEnd:end,providerStatus:'paid',evidenceHash:'SYNTHETIC_PAID_SOURCE',applyStatus:'APPLIED',appliedAt:start}});invoiceId=invoice.id;
    await db.billingReceiptGrant.updateMany({where:{billingAccountId:accountId,kind:'INITIAL'},data:{sourceKey:invoice.id,serviceStart:start,serviceEnd:end,availableAt:start,expiresAt:end}});
    const grantsBefore=await db.billingReceiptGrant.findMany({where:{billingAccountId:accountId},orderBy:{id:'asc'}});
    const aiBefore=await db.companyAiConfiguration.findUnique({where:{companyId}});
    for(const actor of [request,approveRequest])await ensureBillingCompanyProof(actor,companyId,input.password);
    assert.notEqual((await preview(0)).status,200);
    let result=await preview();assert.equal(result.status,200,JSON.stringify(result));let op=result.body;ids.push(op.id);
    assert.equal(op.dayExtension.days,7);assert.equal(op.dayExtension.after,new Date(end.getTime()+7*86400000).toISOString());
    result=await cmd(op,'submit');assert.equal(result.status,200,JSON.stringify(result));op=result.body;
    assert.ok(op.allowedActions.includes('approve'),'platform administrator can confirm own gift');
    result=await cmd(op,'approve');assert.equal(result.status,200,JSON.stringify(result));op=result.body;assert.equal(op.state,'QUEUED');assert.equal(op.approvalMode,'SINGLE_ADMIN');
    const customerPending=await request(customer,'GET',undefined,{'x-company-id':companyId});assert.equal(customerPending.status,200,JSON.stringify(customerPending));assert.equal(customerPending.body.collection.action,'EXTEND_TERM');
    assert.equal((await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}})).termEndsAt.toISOString(),end.toISOString());
    fixture.lose('scheduleUpdate');await input.reconcile(accountId);
    assert.equal((await get(op.id)).body.state,'UNKNOWN');
    assert.equal((await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}})).termEndsAt.toISOString(),end.toISOString());
    const writes=fixture.calls.get('scheduleUpdate');await input.reconcile(accountId);
    assert.equal((await get(op.id)).body.state,'SUCCEEDED',JSON.stringify((await get(op.id)).body));assert.equal(fixture.calls.get('scheduleUpdate'),writes,'positive observation does not repeat mutation');
    const after=await db.billingAccount.findUniqueOrThrow({where:{id:accountId}});assert.equal(after.paidThrough!.toISOString(),op.dayExtension.after);assert.equal(after.nextChargeAt!.toISOString(),op.dayExtension.after);
    const upgrade=await upgradeHistory(db,after,billingOffer('PRO_999','month'),policy,start.toISOString());assert.equal(upgrade.amountSatang,50000,'free days must not create upgrade credit or extend the paid proration denominator');
    const grantsAfter=await db.billingReceiptGrant.findMany({where:{billingAccountId:accountId},orderBy:{id:'asc'}});
    assert.deepEqual(grantsAfter.map(g=>[g.id,g.units,g.serviceStart,g.serviceEnd,g.sourceHash]),grantsBefore.map(g=>[g.id,g.units,g.serviceStart,g.serviceEnd,g.sourceHash]));
    assert.deepEqual(await db.companyAiConfiguration.findUnique({where:{companyId}}),aiBefore);
    assert.deepEqual(await db.billingInvoice.findUniqueOrThrow({where:{id:invoice.id}}),invoice);
    assert.equal(await db.auditLog.count({where:{targetId:op.id,action:'billing.free_days.applied'}}),1);
    assert.equal((await cmd(op,'approve')).body.state,'SUCCEEDED');
    assert.equal((await cmd(op,'approve',approveRequest)).status,409,'a different actor cannot replay the original confirmation');

    let cancel=await request(`${customer}/collection/preview`,'POST',{action:'CANCEL_RENEWAL'},{'x-company-id':companyId});assert.equal(cancel.status,200,JSON.stringify(cancel));
    const cancelled=await request(`${customer}/collection/${cancel.body.id}/submit`,'POST',{expectedVersion:cancel.body.version,previewHash:cancel.body.previewHash,accepted:true},{'x-company-id':companyId,'idempotency-key':`cancel-free-${tag}`});assert.equal(cancelled.status,200,JSON.stringify(cancelled));
    await input.reconcile(accountId);assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:accountId}})).cancelAtPeriodEnd,true);
    let gift=await preview(2);assert.equal(gift.status,200,JSON.stringify(gift));ids.push(gift.body.id);
    gift=await cmd(gift.body,'submit');assert.equal(gift.status,200,JSON.stringify(gift));gift=await cmd(gift.body,'approve',approveRequest);assert.equal(gift.status,200,JSON.stringify(gift));
    await input.reconcile(accountId);assert.equal((await get(gift.body.id)).body.state,'SUCCEEDED',JSON.stringify((await get(gift.body.id)).body));
    const stillCancelled=await db.billingAccount.findUniqueOrThrow({where:{id:accountId}});assert.equal(stillCancelled.cancelAtPeriodEnd,true);assert.equal(stillCancelled.nextChargeAt,null);assert.equal(sub.cancel_at,stillCancelled.paidThrough!.getTime()/1000);
    const resume=await request(`${customer}/collection/preview`,'POST',{action:'RESUME_RENEWAL'},{'x-company-id':companyId});assert.equal(resume.status,200,JSON.stringify(resume));
    assert.equal((await request(`${customer}/collection/${resume.body.id}/submit`,'POST',{expectedVersion:resume.body.version,previewHash:resume.body.previewHash,accepted:true},{'x-company-id':companyId,'idempotency-key':`resume-free-${tag}`})).status,200);
    await input.reconcile(accountId);assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:accountId}})).nextChargeAt!.toISOString(),stillCancelled.paidThrough!.toISOString());
    // Seed an already accepted customer downgrade; exercise the real Admin retiming and customer cancellation paths.
    const beforePending=await db.billingAccount.findUniqueOrThrow({where:{id:accountId}}),pendingId=randomUUID();
    const targetSnapshot={...snapshot,priceId:`price_StarterGift${tag}`,quote:{...snapshot.quote,offer:{...billingOffer('STARTER_249','month'),availability:'AVAILABLE',reason:null},totalSatang:24900,subtotalSatang:24900}};
    const pendingSource={accountId,action:'SCHEDULE_DOWNGRADE',subscriptionId:subId,paidThrough:beforePending.paidThrough!.toISOString(),snapshot:targetSnapshot,
      change:{previousId:null,currentSnapshot:snapshot},sourceTermHash:beforePending.termProjectionHash};
    const originalPending=await db.billingOperation.create({data:{id:pendingId,type:'CUSTOMER_SCHEDULE_DOWNGRADE',state:'SUCCEEDED',companyId,stripeAccountId:input.stripeAccountId,livemode:false,
      initiatorUserId:input.userIds[0]!,sourceVersion:beforePending.version,requestHash:'synthetic-accepted-downgrade',reason:'ลูกค้าเลือกแพ็กเกจรอบถัดไป',proposedJson:pendingSource,
      expiresAt:new Date(Date.now()+600000),resultJson:{scheduleId:sub.schedule}}});
    await db.billingSubscriptionContract.create({data:{billingAccountId:accountId,sourceAttemptId:pendingId,effectiveAt:beforePending.paidThrough!,snapshotJson:{...targetSnapshot,planChangeId:pendingId}}});
    await db.billingAccount.update({where:{id:accountId},data:{pendingPlanChangeId:pendingId,version:{increment:1}}});
    const nativeSchedule=fixture.schedules.find(row=>row.id===sub.schedule)!;nativeSchedule.phases[1].items[0].price=targetSnapshot.priceId;
    let retime=await preview(1);assert.equal(retime.status,200,JSON.stringify(retime));retime=await cmd(retime.body,'submit');assert.equal(retime.status,200,JSON.stringify(retime));
    retime=await cmd(retime.body,'approve',approveRequest);assert.equal(retime.status,200,JSON.stringify(retime));await input.reconcile(accountId);
    assert.equal((await get(retime.body.id)).body.state,'SUCCEEDED',JSON.stringify((await get(retime.body.id)).body));
    const retimed=await db.billingAccount.findUniqueOrThrow({where:{id:accountId}});assert.ok(retimed.pendingPlanChangeId);assert.notEqual(retimed.pendingPlanChangeId,pendingId);
    const preserved=await db.billingOperation.findUniqueOrThrow({where:{id:pendingId}});assert.equal(preserved.state,'SUPERSEDED');assert.deepEqual(preserved.proposedJson,originalPending.proposedJson);
    const successor=await db.billingOperation.findUniqueOrThrow({where:{id:retimed.pendingPlanChangeId!}});assert.equal(successor.referenceId,pendingId);
    assert.equal((successor.proposedJson as any).paidThrough,retimed.paidThrough!.toISOString());assert.deepEqual((successor.proposedJson as any).snapshot,targetSnapshot);
    const cancelDowngrade=await request(`${customer}/collection/preview`,'POST',{action:'CANCEL_DOWNGRADE'},{'x-company-id':companyId});assert.equal(cancelDowngrade.status,200,JSON.stringify(cancelDowngrade));
    assert.equal((await request(`${customer}/collection/${cancelDowngrade.body.id}/submit`,'POST',{expectedVersion:cancelDowngrade.body.version,previewHash:cancelDowngrade.body.previewHash,accepted:true},
      {'x-company-id':companyId,'idempotency-key':`cancel-downgrade-gift-${tag}`})).status,200);
    await input.reconcile(accountId);assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:accountId}})).pendingPlanChangeId,null);
    const originalSettings=await db.billingSettings.findUniqueOrThrow({where:{stripeAccountId_livemode:{stripeAccountId:input.stripeAccountId,livemode:false}}});
    const quoteRevision=await db.billingPolicyRevision.create({data:{stripeAccountId:input.stripeAccountId,livemode:false,state:'ACTIVE',createdByUserId:input.userIds[0]!,
      version:1+(await db.billingPolicyRevision.aggregate({where:{stripeAccountId:input.stripeAccountId,livemode:false},_max:{version:true}}))._max.version!,
      policyJson:{...policy,priceIds:{...policy.priceIds,'BASIC_499:month':priceId}}}});
    try{
      await db.billingSettings.update({where:{id:originalSettings.id},data:{policyRevisionId:quoteRevision.id,version:{increment:1}}});
      const repeat=await request(`${customer}/quote`,'POST',{offerKey:'BASIC_499',interval:'month',billingEmail:'synthetic-gift@example.test'},{'x-company-id':companyId});
      assert.equal(repeat.status,200,JSON.stringify(repeat));assert.equal(repeat.body.billingEmail,ownerEmail,'quote derives the verified owner email, including after gifted days');
      const currentEnd=(await db.billingAccount.findUniqueOrThrow({where:{id:accountId}})).paidThrough!;
      assert.equal(repeat.body.purchase.projectedPaidThrough,appendPackageInterval(currentEnd,'month').toISOString(),'repeat must use the shifted anniversary, not lose gift days');
    }finally{
      await db.billingSettings.update({where:{id:originalSettings.id},data:{policyRevisionId:originalSettings.policyRevisionId,version:originalSettings.version,updatedAt:originalSettings.updatedAt}});
      await db.billingQuote.deleteMany({where:{companyId,policyRevisionId:quoteRevision.id}});await db.billingPolicyRevision.delete({where:{id:quoteRevision.id}});
    }
    if(browser&&secondBrowser){
      const page=browser.page,other=browser.page;
      await page.goto(`${browser.origin}/system/billing/companies/${companyId}/plan-adjustments`,{waitUntil:'domcontentloaded'});
      const panel=page.getByRole('region',{name:'แถมวันใช้งาน',exact:true});
      await panel.getByLabel('จำนวนวันแถม',{exact:true}).fill('3');await panel.getByLabel('เหตุผลที่แถมวัน',{exact:true}).fill('แถมวันจากหน้าเว็บ');
      await panel.getByRole('button',{name:'ตรวจวันใช้งานก่อนส่งคำขอ',exact:true}).click();await page.waitForURL(/\/system\/billing\/plan-adjustments\//);
      const id=new URL(page.url()).pathname.split('/').pop()!;ids.push(id);
      await page.getByRole('button',{name:'บันทึกคำขอก่อนยืนยัน',exact:true}).click();await page.getByRole('heading',{name:'รอยืนยันรายการ',exact:true}).waitFor();
      await other.goto(page.url(),{waitUntil:'domcontentloaded'});await other.getByRole('button',{name:'อนุมัติและปรับสิทธิ์',exact:true}).click();
      await other.getByRole('heading',{name:'รอปรับวันกับ Stripe',exact:true}).waitFor();
      await input.reconcile(accountId);await other.reload({waitUntil:'domcontentloaded'});await other.getByRole('heading',{name:'เพิ่มวันใช้งานแล้ว',exact:true}).waitFor();
      assert.ok(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await other.screenshot({path:`${browser.evidenceDir}/admin-free-days-20260915.png`,fullPage:true});
    }
    const collectionCases=await checkAdminCollectionControl(input,companyId,accountId,sub,nativeInvoices);
    // Observe a previously completed provider mutation after the original term has expired.
    const lateBefore=await db.billingAccount.findUniqueOrThrow({where:{id:accountId}});
    let late=await preview(2);assert.equal(late.status,200,JSON.stringify(late));late=await cmd(late.body,'submit');assert.equal(late.status,200,JSON.stringify(late));
    late=await cmd(late.body,'approve',approveRequest);assert.equal(late.status,200,JSON.stringify(late));
    fixture.lose('scheduleUpdate');await input.reconcile(accountId);assert.equal((await get(late.body.id)).body.state,'UNKNOWN');
    const lateWrites=fixture.calls.get('scheduleUpdate'),lateNow=lateBefore.paidThrough!.getTime()+60000,RealDate=Date;
    await db.company.update({where:{id:companyId},data:{status:'DISABLED',disabledAt:new Date(lateNow)}});
    await db.companyPlanTerm.update({where:{companyId},data:{termDisabledAt:new Date(lateNow)}});
    sub.items.data[0].current_period_start=lateBefore.paidThrough!.getTime()/1000;
    sub.items.data[0].current_period_end=Date.parse(late.body.dayExtension.after)/1000;
    globalThis.Date=new Proxy(RealDate,{construct(target,args){return Reflect.construct(target,args.length?args:[lateNow]);},get(target,key){return key==='now'?()=>lateNow:Reflect.get(target,key);}});
    try{await input.reconcile(accountId);}finally{globalThis.Date=RealDate;}
    assert.equal((await get(late.body.id)).body.state,'SUCCEEDED',JSON.stringify((await get(late.body.id)).body));
    assert.equal(fixture.calls.get('scheduleUpdate'),lateWrites,'late observation must not repeat provider writes');
    assert.equal((await db.company.findUniqueOrThrow({where:{id:companyId}})).status,'ACTIVE');
    assert.equal((await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}})).termDisabledAt,null);
    const lateGrants=await db.billingReceiptGrant.findMany({where:{billingAccountId:accountId},orderBy:{id:'asc'}});
    assert.deepEqual(lateGrants.map(g=>[g.id,g.units,g.serviceStart,g.serviceEnd,g.sourceHash]),grantsBefore.map(g=>[g.id,g.units,g.serviceStart,g.serviceEnd,g.sourceHash]));
    assert.ok(lateGrants.filter(g=>g.kind!=='ADMIN_ADJUSTMENT'&&!g.revokedAt).every(g=>g.expiresAt.toISOString()===late.body.dayExtension.after));
    assert.deepEqual(await db.companyAiConfiguration.findUnique({where:{companyId}}),aiBefore);
    return [...collectionCases,'admin-gift-days-delayed-observation-revives-auto-expired-service-and-preserves-existing-receipts','admin-gift-days-repeat-quote-keeps-shifted-calendar-anniversary','admin-gift-days-retimes-accepted-downgrade-with-immutable-original-and-customer-return','admin-gift-days-preserves-cancelled-renewal-resume-and-purchased-upgrade-credit','admin-gift-days-reviewed-independent-approval-and-customer-pending-status','admin-gift-days-lost-provider-update-positive-recovery-once-no-receipt-ai-money-change',...(browser?['browser-admin-gift-days-preview-approval-schedule-observation-history']:[])];
  } finally {
    input.transport();provider.subscriptions=provider.subscriptions!.filter(s=>s.id!==subId);
    await db.billingIssue.deleteMany({where:{companyId}});
    if(invoiceId)await db.billingInvoice.deleteMany({where:{id:invoiceId}});
    await db.billingSubscriptionContract.deleteMany({where:{billingAccountId:accountId}});
  }
}
