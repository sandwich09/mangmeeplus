import { BILLING_TEST_ADDRESS } from './billing-profile-fixture';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { billingOffer, type BillingPolicy } from '@watchdog-bms/contracts';
import type { PrismaService } from '../common/database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { BillingSnapshot } from '../modules/billing/application/billing.service';
import { termProjectionHash, paidInvoiceEvidence } from '../modules/billing/domain/paid-invoice';
import { grantPaidPackageReceipts, paidReceiptBalance } from '../modules/billing/application/billing-receipt-grants';
import { upgradeHistory } from '../modules/billing/application/billing-upgrade';
import { appendPackageInterval } from '../modules/billing/domain/billing-package';
import type { repeatProviderFixture } from './billing-repeat-smoke';
import type { startBillingBrowser } from './billing-browser-smoke';

type Obj = Record<string,any>;
export async function checkBillingPlanChange(input: {
  request:(path:string,method?:string,body?:unknown,extra?:Record<string,string>)=>Promise<{status:number;body:any}>;
  prisma:PrismaService; companyIds:string[]; userId:string; provider:Record<string,Obj[]>;
  fixture:ReturnType<typeof repeatProviderFixture>; reconcile:(id:string)=>Promise<unknown>; browser?:Awaited<ReturnType<typeof startBillingBrowser>>;
  cadence?: boolean;
}) {
  const {prisma,provider,fixture,browser}=input, client=prisma.client, cases:string[]=[], suffix=randomUUID().replaceAll('-','');
  const companyId=`billing-plan-change-${suffix}`; input.companyIds.push(companyId);
  const base=`/v1/companies/${companyId}/billing`;
  const request:typeof input.request=async(...args)=>{
    for(let n=0;n<3;n++){const r=await input.request(...args);if(r.status!==429||n===2)return r;
      assert.ok(r.body.retryAfterSeconds>=1&&r.body.retryAfterSeconds<=60);await new Promise(r2=>setTimeout(r2,Math.min(60,r.body.retryAfterSeconds+1)*1000));}
    throw new Error('rate limit retry exhausted');
  };
  const source=await client.billingAccount.findFirstOrThrow({where:{companyId:input.companyIds[0]}});
  const template=await client.billingInvoice.findFirstOrThrow({where:{billingAccountId:source.id,subscriptionId:{not:null}},orderBy:{periodStart:'asc'}});
  const original=await client.billingAttempt.findUniqueOrThrow({where:{id:template.sourceAttemptId!}});
  const snapshot=structuredClone(original.quoteSnapshot) as unknown as BillingSnapshot;
  const policy:BillingPolicy={...snapshot.policy,priceIds:{'BASIC_499:month':'price_BasicMonth','STARTER_249:month':'price_StarterMonth','PRO_999:month':'price_ProMonth','STARTER_249:year':'price_StarterYear','BASIC_499:year':'price_BasicYear','PRO_999:year':'price_ProYear'},
    zeroPriceIds:{'BASIC_499:month':'price_ZeroBasicMonth','STARTER_249:month':'price_ZeroStarterMonth','PRO_999:month':'price_ZeroProMonth','STARTER_249:year':'price_ZeroStarterYear','BASIC_499:year':'price_ZeroBasicYear','PRO_999:year':'price_ZeroProYear'}};
  const settings=await client.billingSettings.findUniqueOrThrow({where:{stripeAccountId_livemode:{stripeAccountId:source.stripeAccountId,livemode:false}}});
  const revision=await client.billingPolicyRevision.create({data:{stripeAccountId:source.stripeAccountId,livemode:false,version:settings.version+2000,state:'ACTIVE',policyJson:policy as unknown as Prisma.InputJsonValue,createdByUserId:input.userId}});
  await client.billingSettings.update({where:{id:settings.id},data:{policyRevisionId:revision.id,version:{increment:1}}});
  await client.company.create({data:{id:companyId,name:'Synthetic scheduled change',addressJson:BILLING_TEST_ADDRESS}});
  const role=await client.role.create({data:{companyId,scopeKey:companyId,key:'OWNER',name:'Synthetic upgrade owner'}});
  const permission=await client.permission.findUniqueOrThrow({where:{key:'account.session.read'}});
  await client.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
  const member=await client.companyMembership.create({data:{companyId,userId:input.userId,roles:{create:{roleId:role.id}}}});
  const offer={...billingOffer('BASIC_499',input.cadence ? 'month' : 'year'),availability:'AVAILABLE' as const,reason:null};
  const initialPrice = input.cadence ? 'price_BasicMonth' : 'price_BasicYear', initialAmount = offer.priceSatang;
  const now=Math.floor(Date.now()/1000), start=input.cadence ? now-10*86400 : now+3600-365*86400, end=input.cadence ? appendPackageInterval(new Date(start*1000),'month').getTime()/1000 : now+3600;
  const attemptId=randomUUID(),quoteId=randomUUID(),customerId=`cus_upgrade${suffix}`,subId=`sub_upgrade${suffix}`;
  const account=await client.billingAccount.create({data:{companyId,stripeAccountId:source.stripeAccountId,livemode:false,customerId,baseSubscriptionId:subId,
    contractAttemptId:attemptId,subscriptionState:'active',paidThrough:new Date(end*1000),nextChargeAt:new Date(end*1000)}});
  const term=await client.companyPlanTerm.create({data:{companyId,tierKey:offer.offerKey,branchLimit:offer.branchLimit,employeeLimit:offer.employeeLimit,
    monthlySlipLimit:offer.monthlySlipLimit,termStartAt:new Date(start*1000),termEndsAt:new Date(end*1000),billingReceiptAccountId:account.id}});
  Object.assign(snapshot,{priceId:initialPrice,policy,termHash:termProjectionHash(term),termVersion:term.updatedAt.toISOString()});
  Object.assign(snapshot.quote,{quoteId,companyId,companyName:'Synthetic scheduled change',policyRevision:revision.id,offer,subtotalSatang:initialAmount,taxSatang:0,totalSatang:initialAmount});
  const json=snapshot as unknown as Prisma.InputJsonValue;
  await client.billingAccount.update({where:{id:account.id},data:{termProjectionHash:snapshot.termHash,
    // R-A5: repeat/upgrade judge recipient drift against this column, set as the first payment would have.
    recipientEmail:snapshot.quote.billingEmail,recipientSource:'ACCOUNT_EMAIL'}});
  await client.billingQuote.create({data:{id:quoteId,companyId,initiatingUserId:input.userId,policyRevisionId:revision.id,expiresAt:new Date(start*1000),snapshotJson:json}});
  await client.billingAttempt.create({data:{id:attemptId,billingAccountId:account.id,initiatingUserId:input.userId,quoteId,channel:'web',idempotencyKey:randomUUID(),
    requestHash:'synthetic-upgrade-history',quoteSnapshot:json,policyRevisionId:revision.id,consentRevision:policy.consentRevision,consentAt:new Date(start*1000),status:'COMPLETED',subscriptionId:subId}});
  await client.billingSubscriptionContract.create({data:{billingAccountId:account.id,sourceAttemptId:attemptId,effectiveAt:new Date(start*1000),snapshotJson:json}});
  provider.customers!.push({id:customerId,object:'customer',livemode:false,email:snapshot.quote.billingEmail,metadata:{billingAccountId:account.id}});
  const sub:Obj={id:subId,object:'subscription',livemode:false,customer:customerId,status:'active',metadata:{billingAccountId:account.id,billingAttemptId:attemptId},
    cancel_at_period_end:false,collection_method:'charge_automatically',billing_mode:{type:'classic'},billing_cycle_anchor:start,items:{data:[{id:`si_${suffix}`,price:initialPrice,quantity:1,current_period_start:start,current_period_end:end}]}};
  const invoice:Obj={id:`in_upgrade${suffix}`,object:'invoice',livemode:false,customer:customerId,parent:{subscription_details:{subscription:subId}},status:'paid',collection_method:'charge_automatically',currency:'thb',
    billing_reason:'subscription_create',amount_remaining:0,total:initialAmount,amount_paid:initialAmount,starting_balance:0,created:start};
  const line:Obj={invoice:invoice.id,parent:{type:'subscription_item_details',subscription_item_details:{subscription:subId,subscription_item:`si_${suffix}`,proration:false}},
    pricing:{price_details:{price:initialPrice}},currency:'thb',quantity:1,livemode:false,period:{start,end}};
  const charge:Obj={id:`ch_upgrade${suffix}`,livemode:false,status:'succeeded',paid:true,captured:true,currency:'thb',amount:initialAmount,customer:customerId,payment_intent:`pi_upgrade${suffix}`,
    payment_method_details:{type:'card'},amount_refunded:0,disputed:false};
  const intent:Obj={id:charge.payment_intent,livemode:false,status:'succeeded',currency:'thb',amount_received:initialAmount,customer:customerId,latest_charge:charge};
  const payment:Obj={object:'invoice_payment',livemode:false,status:'paid',invoice:invoice.id,payment:{type:'payment_intent',payment_intent:intent.id},amount_paid:initialAmount,currency:'thb'};
  provider.subscriptions!.push(sub);provider.invoices!.push(invoice);provider.lines!.push(line);provider.charges!.push(charge);provider.intents!.push(intent);provider.payments!.push(payment);
  const evidence=paidInvoiceEvidence(invoice,sub,[line],[payment],intent,charge,snapshot,false);
  const stored=await client.billingInvoice.create({data:{billingAccountId:account.id,sourceAttemptId:attemptId,providerInvoiceId:invoice.id,subscriptionId:subId,providerChargeId:charge.id,
    offerSnapshot:offer as unknown as Prisma.InputJsonValue,contractSnapshot:json,policyRevisionId:revision.id,currency:'THB',totalSatang:initialAmount,paidSatang:initialAmount,taxSatang:0,
    periodStart:new Date(start*1000),periodEnd:new Date(end*1000),providerStatus:'paid',applyStatus:'APPLIED',appliedAt:new Date(start*1000),evidenceHash:evidence.evidenceHash}});
  const first=await client.$transaction(tx=>grantPaidPackageReceipts(tx,{companyId,billingAccountId:account.id,sourceKey:stored.id,policyRevisionId:revision.id,kind:'INITIAL',units:offer.receiptAllowance,
    serviceStart:new Date(start*1000),serviceEnd:new Date(end*1000),availableAt:new Date(start*1000),expiresAt:new Date(end*1000)}));
  await client.branch.createMany({ data: [{ companyId, code: 'hq', name: 'สำนักงานใหญ่ทดสอบ', type: 'HEAD_OFFICE' },
    { companyId, code: 'branch2', name: 'สาขาที่จะพัก', type: 'BRANCH' }] });
  const read = async () => (await request(base)).body;
  const options = async () => (await request(`${base}/capacity?offerKey=STARTER_249&interval=year`)).body;
  const choose = (o:Obj) => ({ sourceHash:o.sourceHash, branchIds:o.branches.filter((b:Obj)=>b.headOffice).map((b:Obj)=>b.id),
    memberships:o.memberships.map((m:Obj)=>({id:m.id,defaultBranchId:null})) });
  const preview = async (action='SCHEDULE_DOWNGRADE', extra:Obj={}) => request(`${base}/collection/preview`, 'POST', {
    action, ...(action==='SCHEDULE_DOWNGRADE' ? {offerKey:'STARTER_249',interval:'year',capacity:choose(await options())} : {}), ...extra });
  const submit = (o:Obj) => request(`${base}/collection/${o.id}/submit`, 'POST', {expectedVersion:o.version,previewHash:o.previewHash,accepted:true},{'idempotency-key':`billing-collection-${o.id}`});
  const get = async (o:Obj) => (await request(`${base}/collection/${o.id}`)).body;
  const reconcile = () => input.reconcile(account.id);
  const accept = async(action:string) => {const p=await preview(action);assert.equal(p.status,200,JSON.stringify(p));const q=await submit(p.body);assert.equal(q.status,200,JSON.stringify(q));await reconcile();const result=await get(p.body);assert.equal(result.state,'SUCCEEDED',JSON.stringify(result));return result;};
  if (input.cadence) {
    const before = await read();
    const quote = async(tier='BASIC_499', interval='year') => request(`${base}/quote`,'POST',{offerKey:tier,interval,billingEmail:'owner@example.test'});
    const buy = async(q:Obj) => { assert.equal(q.status,200,JSON.stringify(q));const result=await request(`${base}/checkout`,'POST',{quoteId:q.body.quoteId,consentRevision:q.body.consentRevision,accepted:true,channel:'web'},{'idempotency-key':randomUUID()});assert.equal(result.body.state,'OPEN',JSON.stringify(result));return provider.sessions!.find(s=>s.metadata.billingAttemptId===result.body.attemptId)!; };
    const capacity = async(tier:string, interval:string) => choose((await request(`${base}/capacity?offerKey=${tier}&interval=${interval}`)).body);
    // Existing scheduled monthly change must not be silently overwritten by annual purchase.
    const pending=await preview('SCHEDULE_DOWNGRADE',{interval:'month',capacity:await capacity('STARTER_249','month')});
    assert.equal(pending.status,200,JSON.stringify(pending));await submit(pending.body);await reconcile();
    assert.equal((await quote()).body.code,'BILLING_CADENCE_PENDING_CHANGE');
    await accept('CANCEL_DOWNGRADE');
    const schedule=fixture.schedules.find(s=>s.subscription===subId)!;
    assert.equal(schedule.phases[1].items[0].price,'price_BasicMonth');
    const q=await quote();assert.equal(q.status,200,JSON.stringify(q));
    assert.equal(q.body.purchase.previousInterval,'month');assert.equal(q.body.totalSatang,499000);
    assert.equal(q.body.purchase.receiptUnitsAdded,600);
    const extended=appendPackageInterval(new Date(before.paidThrough),'year');
    assert.equal(q.body.purchase.projectedPaidThrough,extended.toISOString());
    const expired=await buy(q);expired.status='expired';await reconcile();
    assert.equal((await read()).paidThrough,before.paidThrough);assert.equal((await read()).usage.remaining,before.usage.remaining);
    assert.equal(schedule.phases[1].items[0].price,'price_BasicMonth');assert.equal(sub.pause_collection,null);
    cases.push('annual-conversion-pending-change-explicit-cancel-expired-checkout-preserves-monthly-contract');
    const paid=await buy(await quote());fixture.complete(paid);fixture.lose('scheduleUpdate');await reconcile();
    assert.equal((await read()).paidThrough,before.paidThrough);
    await reconcile();await reconcile();
    const after=await read();assert.equal(after.paidThrough,extended.toISOString());assert.equal(after.nextChargeAt,after.paidThrough);
    assert.equal(after.interval,'year');assert.equal(after.usage.remaining,before.usage.remaining+600);
    assert.equal(await client.billingReceiptGrant.count({where:{companyId}}),2);
    assert.equal(schedule.phases[1].items[0].price,'price_BasicYear');assert.equal(schedule.phases[1].start_date,extended.getTime()/1000);
    assert.equal(schedule.phases[1].end_date,appendPackageInterval(extended,'year').getTime()/1000);
    assert.equal(provider.subscriptions!.filter(s=>s.customer===customerId).length,1);
    const carried=await client.billingReceiptGrant.findUniqueOrThrow({where:{id:first.id}});assert.equal(carried.expiresAt.toISOString(),after.paidThrough);
    cases.push('annual-conversion-full-price-immediate-quota-calendar-year-carry-once-lost-schedule-response-one-subscription');
    const up=await quote('PRO_999');assert.equal(up.status,200,JSON.stringify(up));assert.equal(up.body.purchase.kind,'UPGRADE');
    assert.equal(up.body.upgrade.segments.length,2);assert.equal(up.body.upgrade.segments[1].amountSatang,500000);
    assert.equal(up.body.upgrade.segments[1].receiptUnitsAdded,600);assert.ok(up.body.upgrade.segments[0].amountSatang>0&&up.body.upgrade.segments[0].amountSatang<=50000);
    fixture.complete(await buy(up));await reconcile();assert.equal((await read()).tierKey,'PRO_999');assert.equal((await read()).paidThrough,after.paidThrough);
    const upgradedBalance=(await read()).usage.remaining;
    fixture.complete(await buy(await quote('PRO_999')));await reconcile();
    assert.equal((await read()).usage.remaining,upgradedBalance+1200);
    assert.equal((await read()).paidThrough,appendPackageInterval(new Date(after.paidThrough),'year').toISOString(), 'native anchor reset must not shorten later prepaid extensions');
    cases.push('annual-conversion-mixed-month-and-year-upgrade-correct-price-quota-subsequent-annual-repeat');
    const last=await read(), count=await client.billingReceiptGrant.count({where:{companyId}});
    const monthly=await preview('SCHEDULE_DOWNGRADE',{offerKey:'PRO_999',interval:'month',capacity:await capacity('PRO_999','month')});
    assert.equal(monthly.status,200,JSON.stringify(monthly));await submit(monthly.body);await reconcile();
    const scheduled=await read();assert.equal(scheduled.pendingPlanChange.targetOffer.interval,'month');
    assert.equal(scheduled.pendingPlanChange.effectiveAt,last.paidThrough);assert.equal(scheduled.pendingPlanChange.nextRenewalTotalSatang,99900);
    assert.equal(scheduled.usage.remaining,last.usage.remaining);assert.equal(await client.billingReceiptGrant.count({where:{companyId}}),count);
    assert.equal(schedule.phases[1].items[0].price,'price_ProMonth');
    assert.equal(schedule.phases[1].end_date,appendPackageInterval(new Date(last.paidThrough),'month').getTime()/1000);
    await accept('CANCEL_DOWNGRADE');assert.equal(schedule.phases[1].items[0].price,'price_ProYear');
    cases.push('annual-to-monthly-scheduled-at-all-paid-time-end-no-charge-or-quota-change-cancel-restores-annual');
    return cases;
  }
  const before = await read(), grantsBefore=await client.billingReceiptGrant.count({where:{companyId}});
  assert.equal((await preview('SCHEDULE_DOWNGRADE',{offerKey:'ENTERPRISE_1999'})).status,409);
  assert.equal((await preview('SCHEDULE_DOWNGRADE',{offerKey:'PRO_999'})).status,409);
  const wrong=choose(await options());wrong.branchIds=[randomUUID()];
  assert.equal((await preview('SCHEDULE_DOWNGRADE',{capacity:wrong})).status,409);
  const stale=(await preview()).body;assert.ok(stale.id);
  assert.equal((await request(`/v1/companies/${input.companyIds[0]}/billing/collection/${stale.id}`)).status,404);
  await submit(stale);
  const hq=await client.branch.findFirstOrThrow({where:{companyId,type:'HEAD_OFFICE'}});
  await client.branch.update({where:{id:hq.id},data:{name:'สำนักงานใหญ่เปลี่ยนชื่อ'}});
  await reconcile();const blocked=await get(stale);assert.equal(blocked.state,'BLOCKED');
  assert.equal((await request(`${base}/collection/${stale.id}/withdraw`,'POST',{expectedVersion:blocked.version})).body.state,'CANCELLED');
  cases.push('downgrade-owner-tenant-target-capacity-and-stale-selection-before-provider');
  const firstPreview=(await preview()).body, competing=(await preview()).body;
  assert.equal((await submit(firstPreview)).body.state,'QUEUED');assert.equal((await submit(competing)).status,409);
  assert.equal((await submit(firstPreview)).body.id,firstPreview.id);
  fixture.lose('scheduleCreate');await reconcile();assert.equal((await get(firstPreview)).state,'UNKNOWN');
  fixture.lose('collection');await reconcile();assert.equal((await get(firstPreview)).state,'UNKNOWN');
  await reconcile();const scheduled=await get(firstPreview);assert.equal(scheduled.state,'SUCCEEDED',JSON.stringify(scheduled));
  assert.equal(fixture.schedules.filter(s=>s.subscription===subId).length,1);
  const schedule=fixture.schedules.find(s=>s.subscription===subId)!;
  assert.equal(schedule.phases[0].items[0].price,'price_BasicYear');assert.equal(schedule.phases[1].items[0].price,'price_StarterYear');
  assert.equal(schedule.phases[1].start_date,end);assert.equal((await read()).tierKey,'BASIC_499');
  assert.equal((await read()).paidThrough,before.paidThrough);assert.equal(await client.billingReceiptGrant.count({where:{companyId}}),grantsBefore);
  assert.equal(await client.branch.count({where:{companyId,status:'ACTIVE'}}),2);
  cases.push('ordinary-downgrade-lost-create-update-same-command-one-subscription-no-charge-or-cap-change');
  await accept('CANCEL_RENEWAL');assert.equal((await read()).pendingPlanChange.id,scheduled.id);assert.equal(schedule.phases.length,1);
  await accept('RESUME_RENEWAL');assert.equal(schedule.phases[1].items[0].price,'price_StarterYear');
  await accept('CANCEL_DOWNGRADE');assert.equal((await read()).pendingPlanChange,null);assert.equal(schedule.phases[1].items[0].price,'price_BasicYear');
  let active=await accept('SCHEDULE_DOWNGRADE');
  cases.push('downgrade-cancel-resume-preserves-target-explicit-cancel-restores-accepted-price');
  // TEST_ONLY publication fixture: the already accepted downgrade must keep its original capacity contract.
  const changedPolicy:BillingPolicy={...policy,offerTerms:{...policy.offerTerms,STARTER_249:{monthlyPriceSatang:24900,
    annualPriceSatang:249000,monthlyReceiptAllowance:30,branchLimit:2,employeeLimit:3}}};
  const changedRevision=await client.billingPolicyRevision.create({data:{stripeAccountId:source.stripeAccountId,livemode:false,
    version:revision.version+1,state:'ACTIVE',policyJson:changedPolicy as unknown as Prisma.InputJsonValue,createdByUserId:input.userId}});
  await client.billingSettings.update({where:{id:settings.id},data:{policyRevisionId:changedRevision.id,version:{increment:1}}});
  const newCapacity=await options();assert.equal(newCapacity.branchLimit,2);assert.equal(newCapacity.employeeLimit,3);
  const quote=async(tier:string)=>{const q=await request(`${base}/quote`,'POST',{offerKey:tier,interval:'year',billingEmail:'owner@example.test'});assert.equal(q.status,200,JSON.stringify(q));return q.body;};
  const checkout=(q:Obj)=>request(`${base}/checkout`,'POST',{quoteId:q.quoteId,consentRevision:q.consentRevision,accepted:true,channel:'web'},{'idempotency-key':randomUUID()});
  const session=(id:string)=>provider.sessions!.find(s=>s.metadata.billingAttemptId===id)!;
  const repeatQuote=await quote('BASIC_499');assert.equal(repeatQuote.pendingPlanChange.operationId,active.id);
  assert.equal(repeatQuote.pendingPlanChange.oldEffectiveAt,before.paidThrough);
  assert.equal(repeatQuote.pendingPlanChange.offer.branchLimit,1);assert.equal(repeatQuote.pendingPlanChange.offer.employeeLimit,2);
  const aborted=await checkout(repeatQuote);assert.equal(aborted.body.state,'OPEN',JSON.stringify(aborted));session(aborted.body.attemptId).status='expired';await reconcile();
  assert.equal((await read()).pendingPlanChange.id,active.id);assert.equal((await read()).paidThrough,before.paidThrough);
  const bought=await checkout(await quote('BASIC_499'));assert.equal(bought.body.state,'OPEN',JSON.stringify(bought));fixture.complete(session(bought.body.attemptId));await reconcile();
  const extended=await read();assert.equal(extended.usage.remaining,1200);assert.equal(extended.tierKey,'BASIC_499');assert.notEqual(extended.pendingPlanChange.id,active.id);
  assert.equal(extended.pendingPlanChange.effectiveAt,extended.paidThrough);assert.equal(schedule.phases[1].items[0].price,'price_StarterYear');
  assert.equal((await get(active)).state,'SUPERSEDED');active=extended.pendingPlanChange;
  cases.push('downgrade-repeat-expiry-restores-old-date-paid-repeat-adds-quota-extends-date-preserves-target');
  const upgradedQuote=await quote('PRO_999');assert.equal(upgradedQuote.purchase.kind,'UPGRADE');assert.equal(upgradedQuote.pendingPlanChange.newEffectiveAt,extended.paidThrough);
  const upgraded=await checkout(upgradedQuote);assert.equal(upgraded.body.state,'OPEN',JSON.stringify(upgraded));fixture.complete(session(upgraded.body.attemptId));await reconcile();
  const pro=await read();assert.equal(pro.tierKey,'PRO_999');assert.equal(pro.paidThrough,extended.paidThrough);assert.equal(pro.pendingPlanChange.targetOffer.offerKey,'STARTER_249');
  assert.equal(schedule.phases[1].items[0].price,'price_StarterYear');active=pro.pendingPlanChange;
  cases.push('downgrade-pending-upgrade-charges-delta-retains-lower-target-and-paid-end');
  assert.equal(pro.pendingPlanChange.targetOffer.branchLimit,1);assert.equal(pro.pendingPlanChange.targetOffer.employeeLimit,2);
  cases.push('downgrade-accepted-capacity-survives-catalog-change-repeat-and-upgrade');
  // Restore the catalog before checking existing-operation browser recovery.
  await client.billingSettings.update({where:{id:settings.id},data:{policyRevisionId:revision.id,version:{increment:1}}});
  if(browser){
    const page=browser.page;await page.setViewportSize({width:390,height:844});
    await page.goto(`${browser.origin}/companies/${companyId}/billing`,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'การต่ออายุและชำระเงิน',exact:true}).click();
    await page.getByRole('button',{name:'ยกเลิกการเปลี่ยนแพ็กเกจ',exact:true}).click();
    await page.getByRole('button',{name:'ยืนยันยกเลิกการเปลี่ยนแพ็กเกจ',exact:true}).click();await page.getByRole('status').filter({hasText:'รอตรวจยืนยันการต่ออายุ'}).waitFor();await reconcile();
    await page.getByRole('button',{name:'ตรวจผลการต่ออายุ',exact:true}).click();
    await page.getByRole('status').filter({hasText:'ยืนยันยกเลิกการเปลี่ยนแพ็กเกจแล้ว'}).waitFor();
    await page.reload();await page.getByRole('button',{name:'การต่ออายุและชำระเงิน',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:/^ตรวจลดเป็น/}).count(),0);
    assert.equal(await page.getByText('ข้อมูลอ้างอิง',{exact:true}).count(),0);
    await page.getByRole('button',{name:'แพ็กเกจ',exact:true}).click();
    await page.getByRole('button',{name:'ซื้อหรือเปลี่ยนแพ็กเกจ',exact:true}).click();
    const plans=page.getByRole('region',{name:'เลือกแพ็กเกจ',exact:true});
    await plans.locator('article').filter({has:page.getByRole('heading',{name:'เริ่มต้น (STARTER)',exact:true})}).getByRole('button',{name:'เลือกแพ็กเกจนี้',exact:true}).click();
    const picker=page.getByRole('region',{name:'เลือกสาขาและผู้ใช้',exact:true});
    await picker.waitFor();assert.ok((await picker.textContent())!.includes('วันนี้ยังไม่เรียกเก็บเงิน'));
    await picker.getByLabel('ฉันตรวจสอบรายการที่คงไว้และรายการที่จะพักแล้ว',{exact:true}).check();
    const previewResponse=page.waitForResponse(r=>r.url().endsWith('/collection/preview')&&r.request().method()==='POST');
    await picker.getByRole('button',{name:'ตรวจสอบการเปลี่ยนแพ็กเกจ',exact:true}).click();
    const response=await previewResponse;let existing=await response.json();assert.equal(response.status(),200,JSON.stringify(existing));
    assert.equal(existing.action,'SCHEDULE_DOWNGRADE');assert.equal(existing.targetOffer.offerKey,'STARTER_249');assert.equal(existing.targetOffer.interval,'year');
    assert.equal(existing.effectiveAt,(await read()).paidThrough);assert.equal((await read()).tierKey,'PRO_999');
    await page.waitForURL(`**/billing?collection=${existing.id}`);
    const originalId=existing.id;
    const withdrawResponse=page.waitForResponse(r=>r.url().endsWith(`/collection/${originalId}/withdraw`)&&r.request().method()==='POST');
    await page.getByRole('button',{name:'กลับไปเลือกสาขาและผู้ใช้',exact:true}).click();
    const withdrawn=await withdrawResponse;assert.equal(withdrawn.status(),200);assert.equal((await withdrawn.json()).state,'CANCELLED');
    await picker.waitFor();assert.equal(await picker.getByLabel('ฉันตรวจสอบรายการที่คงไว้และรายการที่จะพักแล้ว',{exact:true}).isChecked(),false);
    assert.equal((await read()).tierKey,'PRO_999');
    await picker.getByLabel('ฉันตรวจสอบรายการที่คงไว้และรายการที่จะพักแล้ว',{exact:true}).check();
    const revisedResponse=page.waitForResponse(r=>r.url().endsWith('/collection/preview')&&r.request().method()==='POST');
    await picker.getByRole('button',{name:'ตรวจสอบการเปลี่ยนแพ็กเกจ',exact:true}).click();
    const revised=await revisedResponse;assert.equal(revised.status(),200);existing=await revised.json();assert.notEqual(existing.id,originalId);
    await page.waitForURL(`**/billing?collection=${existing.id}`);
    cases.push('downgrade-preview-back-edit-withdraws-original-before-new-review');
    // Reload keeps the original review and does not create another request or charge.
    await page.reload();await page.getByRole('heading',{name:'การเปลี่ยนแพ็กเกจ',exact:true}).waitFor();
    assert.ok((await page.getByRole('region',{name:'จัดการการต่ออายุ',exact:true}).textContent())!.includes('วันนี้ยังไม่เรียกเก็บเงิน'));
    // The preceding API and browser cases share the real command limit; retry this same review only after its cooldown.
    for(let n=0;n<3;n++){
      const submittedResponse=page.waitForResponse(r=>r.url().endsWith(`/collection/${existing.id}/submit`)&&r.request().method()==='POST');
      await page.getByRole('button',{name:'ยืนยันเปลี่ยนแพ็กเกจรอบถัดไป',exact:true}).click();
      const submitted=await submittedResponse,body=await submitted.json();
      if(submitted.status()!==429||n===2){assert.equal(submitted.status(),200,JSON.stringify(body));assert.equal(body.id,existing.id);break;}
      assert.ok(body.retryAfterSeconds>=1&&body.retryAfterSeconds<=60);
      await new Promise(resolve=>setTimeout(resolve,Math.min(60,body.retryAfterSeconds+1)*1000));
    }
    await page.getByRole('status').filter({hasText:'รอตรวจยืนยันการต่ออายุ'}).waitFor();await reconcile();
    await page.getByRole('button',{name:'ตรวจผลการต่ออายุ',exact:true}).click();
    await page.getByRole('status').filter({hasText:'ยืนยันเปลี่ยนแพ็กเกจรอบถัดไปแล้ว'}).waitFor();
    await page.getByRole('link',{name:'ดูรายการเปลี่ยนแพ็กเกจ',exact:true}).waitFor();
    assert.equal(await page.getByText(existing.id,{exact:true}).count(),0);
    await page.screenshot({path:'docs/evidence/billing-integration-2026-09-13/downgrade-mobile.png',fullPage:true});
    active=(await read()).pendingPlanChange;cases.push('downgrade-mobile-card-capacity-preview-reload-confirm-no-immediate-charge-retained-rights');
  }
  const boundary=Date.parse(active.effectiveAt)/1000;
  // Provider Test Clock equivalent: advance only while reconciling, keeping real HTTP/auth and timers intact.
  const atBoundary=async(work:()=>Promise<unknown>)=>{const RealDate=Date;globalThis.Date=new Proxy(RealDate,{construct(target,args){return Reflect.construct(target,args.length?args:[(boundary+10)*1000]);},get(target,key){return key==='now'?()=> (boundary+10)*1000:Reflect.get(target,key);}});try{return await work();}finally{globalThis.Date=RealDate;}};
  const nextEnd=Math.floor(appendPackageInterval(new Date(boundary*1000),'year').getTime()/1000);
  const renewalId=`in_lower${suffix}`,pi=`pi_lower${suffix}`,ch=`ch_lower${suffix}`;
  const lower:Obj={...invoice,id:renewalId,status:'open',billing_reason:'subscription_cycle',total:249000,amount_paid:0,amount_remaining:249000,created:boundary};
  provider.invoices!.push(lower);provider.lines!.push({...line,invoice:renewalId,pricing:{price_details:{price:'price_StarterYear'}},period:{start:boundary,end:nextEnd}});
  sub.status='past_due';sub.latest_invoice=renewalId;sub.billing_cycle_anchor=boundary;Object.assign(sub.items.data[0],{price:'price_StarterYear',current_period_start:boundary,current_period_end:nextEnd});
  schedule.current_phase={start_date:boundary};
  await atBoundary(reconcile);assert.equal((await read()).tierKey,'PRO_999');assert.equal((await read()).graceEndsAt,new Date((boundary+7*86400)*1000).toISOString());
  assert.equal(await client.billingReceiptGrant.count({where:{companyId,kind:'RENEWAL'}}),0);
  cases.push('failed-lower-renewal-grace-retains-old-tier-without-free-target-quota');
  await client.branch.update({where:{id:hq.id},data:{name:'สำนักงานใหญ่ก่อนชำระรอบใหม่'}});
  const lowerCharge:Obj={...charge,id:ch,payment_intent:pi,amount:249000,receipt_url:'https://pay.stripe.com/receipts/lower-synthetic'};
  const lowerIntent:Obj={...intent,id:pi,amount_received:249000,latest_charge:lowerCharge};
  provider.charges!.push(lowerCharge);provider.intents!.push(lowerIntent);provider.payments!.push({...payment,invoice:renewalId,payment:{type:'payment_intent',payment_intent:pi},amount_paid:249000});
  Object.assign(lower,{status:'paid',amount_paid:249000,amount_remaining:0});sub.status='active';await atBoundary(reconcile);
  const held=await read();assert.equal(held.applyState,'HELD');assert.equal(held.nextChargeAt,new Date(nextEnd*1000).toISOString(),'after phase transition next collection is the actual next provider period, not the old paid-through');assert.equal(held.tierKey,'PRO_999');assert.equal(held.graceEndsAt,new Date((boundary+7*86400)*1000).toISOString(),'paid-held must retain grace provenance until original grant expiry is restored');assert.equal(held.planCapacityRepair.operationId,active.id);
  const freshSelection=choose(await options()),repairKey=randomUUID(),repairBody={expectedVersion:held.planCapacityRepair.version,selection:freshSelection,accepted:true};
  const repair=await request(`${base}/collection/${active.id}/capacity`,'POST',repairBody,{'idempotency-key':repairKey});assert.equal(repair.status,200,JSON.stringify(repair));
  await atBoundary(reconcile);await atBoundary(reconcile);
  const final=await read();assert.equal(final.tierKey,'STARTER_249');assert.equal(final.pendingPlanChange,null);assert.equal((await paidReceiptBalance(client,companyId,account.id,new Date((boundary+10)*1000))).remaining,360);
  assert.equal(await client.billingReceiptGrant.count({where:{companyId,kind:'RENEWAL'}}),1);assert.equal(await client.branch.count({where:{companyId,status:'ACTIVE'}}),1);
  assert.equal((await request(`${base}/collection/${active.id}/capacity`,'POST',repairBody,{'idempotency-key':repairKey})).body.operationId,repair.body.operationId);
  assert.equal((await get(active)).state,'APPLIED');
  cases.push('paid-lower-renewal-stale-selection-held-original-invoice-repair-atomic-cap-and-one-grant');
  return cases;
}
