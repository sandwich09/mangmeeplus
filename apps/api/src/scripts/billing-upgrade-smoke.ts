import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { billingOffer, type BillingPolicy } from '@watchdog-bms/contracts';
import type { PrismaService } from '../common/database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { BillingSnapshot } from '../modules/billing/application/billing.service';
import { termProjectionHash, paidInvoiceEvidence } from '../modules/billing/domain/paid-invoice';
import { grantPaidPackageReceipts } from '../modules/billing/application/billing-receipt-grants';
import { upgradeHistory } from '../modules/billing/application/billing-upgrade';
import { admitCompanyOcr } from '../modules/line-ai/application/company-ocr-governance';
import type { repeatProviderFixture } from './billing-repeat-smoke';
import type { startBillingBrowser } from './billing-browser-smoke';

type Obj = Record<string,any>;
export async function checkBillingUpgrade(input: {
  request:(path:string,method?:string,body?:unknown,extra?:Record<string,string>)=>Promise<{status:number;body:any}>;
  prisma:PrismaService; companyIds:string[]; userId:string; provider:Record<string,Obj[]>;
  fixture:ReturnType<typeof repeatProviderFixture>; reconcile:(id:string)=>Promise<unknown>; browser?:Awaited<ReturnType<typeof startBillingBrowser>>;
}) {
  const {prisma,provider,fixture,browser}=input, client=prisma.client, cases:string[]=[], suffix=randomUUID().replaceAll('-','');
  const companyId=`billing-upgrade-${suffix}`; input.companyIds.push(companyId);
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
  const policy:BillingPolicy={...snapshot.policy,priceIds:{'STARTER_249:year':'price_StarterYear','BASIC_499:year':'price_BasicYear','PRO_999:year':'price_ProYear'},
    zeroPriceIds:{'STARTER_249:year':'price_ZeroStarterYear','BASIC_499:year':'price_ZeroBasicYear','PRO_999:year':'price_ZeroProYear'}};
  const settings=await client.billingSettings.findUniqueOrThrow({where:{stripeAccountId_livemode:{stripeAccountId:source.stripeAccountId,livemode:false}}});
  const revision=await client.billingPolicyRevision.create({data:{stripeAccountId:source.stripeAccountId,livemode:false,version:settings.version+1000,state:'ACTIVE',policyJson:policy as unknown as Prisma.InputJsonValue,createdByUserId:input.userId}});
  await client.billingSettings.update({where:{id:settings.id},data:{policyRevisionId:revision.id,version:{increment:1}}});
  await client.company.create({data:{id:companyId,name:'Synthetic prepaid upgrade'}});
  const role=await client.role.create({data:{companyId,scopeKey:companyId,key:'OWNER',name:'Synthetic upgrade owner'}});
  const permission=await client.permission.findUniqueOrThrow({where:{key:'account.session.read'}});
  await client.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
  const member=await client.companyMembership.create({data:{companyId,userId:input.userId,roles:{create:{roleId:role.id}}}});
  const offer={...billingOffer('STARTER_249','year'),availability:'AVAILABLE' as const,reason:null};
  const now=Math.floor(Date.now()/1000), start=now-180*86400,end=now+185*86400;
  const attemptId=randomUUID(),quoteId=randomUUID(),customerId=`cus_upgrade${suffix}`,subId=`sub_upgrade${suffix}`;
  const account=await client.billingAccount.create({data:{companyId,stripeAccountId:source.stripeAccountId,livemode:false,customerId,baseSubscriptionId:subId,
    contractAttemptId:attemptId,subscriptionState:'active',paidThrough:new Date(end*1000),nextChargeAt:new Date(end*1000)}});
  const term=await client.companyPlanTerm.create({data:{companyId,tierKey:offer.offerKey,branchLimit:offer.branchLimit,employeeLimit:offer.employeeLimit,
    monthlySlipLimit:offer.monthlySlipLimit,termStartAt:new Date(start*1000),termEndsAt:new Date(end*1000),billingReceiptAccountId:account.id}});
  Object.assign(snapshot,{priceId:'price_StarterYear',policy,termHash:termProjectionHash(term),termVersion:term.updatedAt.toISOString()});
  Object.assign(snapshot.quote,{quoteId,companyId,companyName:'Synthetic prepaid upgrade',policyRevision:revision.id,offer,subtotalSatang:249000,taxSatang:0,totalSatang:249000});
  const json=snapshot as unknown as Prisma.InputJsonValue;
  await client.billingAccount.update({where:{id:account.id},data:{termProjectionHash:snapshot.termHash}});
  await client.billingQuote.create({data:{id:quoteId,companyId,initiatingUserId:input.userId,policyRevisionId:revision.id,expiresAt:new Date(start*1000),snapshotJson:json}});
  await client.billingAttempt.create({data:{id:attemptId,billingAccountId:account.id,initiatingUserId:input.userId,quoteId,channel:'web',idempotencyKey:randomUUID(),
    requestHash:'synthetic-upgrade-history',quoteSnapshot:json,policyRevisionId:revision.id,consentRevision:policy.consentRevision,consentAt:new Date(start*1000),status:'COMPLETED',subscriptionId:subId}});
  await client.billingSubscriptionContract.create({data:{billingAccountId:account.id,sourceAttemptId:attemptId,effectiveAt:new Date(start*1000),snapshotJson:json}});
  provider.customers!.push({id:customerId,object:'customer',livemode:false,email:'owner@example.test',metadata:{billingAccountId:account.id}});
  const sub:Obj={id:subId,object:'subscription',livemode:false,customer:customerId,status:'active',metadata:{billingAccountId:account.id,billingAttemptId:attemptId},
    cancel_at_period_end:false,collection_method:'charge_automatically',billing_mode:{type:'classic'},billing_cycle_anchor:start,items:{data:[{id:`si_${suffix}`,price:'price_StarterYear',quantity:1,current_period_start:start,current_period_end:end}]}};
  const invoice:Obj={id:`in_upgrade${suffix}`,object:'invoice',livemode:false,customer:customerId,parent:{subscription_details:{subscription:subId}},status:'paid',collection_method:'charge_automatically',currency:'thb',
    billing_reason:'subscription_create',amount_remaining:0,total:249000,amount_paid:249000,starting_balance:0,created:start};
  const line:Obj={invoice:invoice.id,parent:{type:'subscription_item_details',subscription_item_details:{subscription:subId,subscription_item:`si_${suffix}`,proration:false}},
    pricing:{price_details:{price:'price_StarterYear'}},currency:'thb',quantity:1,livemode:false,period:{start,end}};
  const charge:Obj={id:`ch_upgrade${suffix}`,livemode:false,status:'succeeded',paid:true,captured:true,currency:'thb',amount:249000,customer:customerId,payment_intent:`pi_upgrade${suffix}`,
    payment_method_details:{type:'card'},amount_refunded:0,disputed:false};
  const intent:Obj={id:charge.payment_intent,livemode:false,status:'succeeded',currency:'thb',amount_received:249000,customer:customerId,latest_charge:charge};
  const payment:Obj={object:'invoice_payment',livemode:false,status:'paid',invoice:invoice.id,payment:{type:'payment_intent',payment_intent:intent.id},amount_paid:249000,currency:'thb'};
  provider.subscriptions!.push(sub);provider.invoices!.push(invoice);provider.lines!.push(line);provider.charges!.push(charge);provider.intents!.push(intent);provider.payments!.push(payment);
  const evidence=paidInvoiceEvidence(invoice,sub,[line],[payment],intent,charge,snapshot,false);
  const stored=await client.billingInvoice.create({data:{billingAccountId:account.id,sourceAttemptId:attemptId,providerInvoiceId:invoice.id,subscriptionId:subId,providerChargeId:charge.id,
    offerSnapshot:offer as unknown as Prisma.InputJsonValue,contractSnapshot:json,policyRevisionId:revision.id,currency:'THB',totalSatang:249000,paidSatang:249000,taxSatang:0,
    periodStart:new Date(start*1000),periodEnd:new Date(end*1000),providerStatus:'paid',applyStatus:'APPLIED',appliedAt:new Date(start*1000),evidenceHash:evidence.evidenceHash}});
  const first=await client.$transaction(tx=>grantPaidPackageReceipts(tx,{companyId,billingAccountId:account.id,sourceKey:stored.id,policyRevisionId:revision.id,kind:'INITIAL',units:360,
    serviceStart:new Date(start*1000),serviceEnd:new Date(end*1000),availableAt:new Date(start*1000),expiresAt:new Date(end*1000)}));
  await client.companyOcrUsageEvent.createMany({data:Array.from({length:310},(_,i)=>({companyId,billingReceiptGrantId:first.id,sourceRoute:'receipt-ocr-web',requestId:`upgrade-used-${suffix}-${i}`,monthKey:'2026-09'}))});
  const quote=async(tier='BASIC_499')=>{const q=await request(`${base}/quote`,'POST',{offerKey:tier,interval:'year',billingEmail:'owner@example.test'});assert.equal(q.status,200,JSON.stringify(q));return q.body;};
  const checkout=(q:Obj,key=randomUUID())=>request(`${base}/checkout`,'POST',{quoteId:q.quoteId,consentRevision:q.consentRevision,accepted:true,channel:'line'},{'idempotency-key':key});
  const read=async()=> (await request(base)).body;
  const session=(id:string)=>provider.sessions!.find(s=>s.metadata.billingAttemptId===id)!;
  const repeat=await checkout(await quote('STARTER_249'));assert.equal(repeat.body.state,'OPEN',JSON.stringify(repeat));fixture.complete(session(repeat.body.attemptId));await input.reconcile(account.id);
  const before=await read();assert.equal(before.usage.remaining,410);const paidThrough=before.paidThrough;
  const q=await quote();assert.equal(q.purchase.kind,'UPGRADE');assert.equal(q.purchase.projectedPaidThrough,paidThrough);assert.equal(q.upgrade.segments.length,2);
  assert.equal(q.upgrade.segments[1].amountSatang,250000);assert.equal(q.upgrade.segments[1].receiptUnitsAdded,240);
  assert.equal(q.totalSatang,q.upgrade.segments.reduce((n:number,s:Obj)=>n+s.amountSatang,0));assert.equal(q.upgrade.nextRenewalTotalSatang,499000);
  cases.push('upgrade-real-paid-history-initial-plus-repeat-all-prepaid-segments-quote');
  const checkoutsBefore=fixture.checkoutCalls();
  await client.billingReceiptGrant.update({where:{id:first.id},data:{revokedAt:new Date()}});
  assert.equal((await checkout(q)).status,409);assert.equal(fixture.checkoutCalls(),checkoutsBefore);
  await client.billingReceiptGrant.update({where:{id:first.id},data:{revokedAt:null}});
  const stale=await quote();await client.billingQuote.update({where:{id:stale.quoteId},data:{expiresAt:new Date(Date.now()-1)}});
  assert.equal((await checkout(stale)).status,409);assert.equal(fixture.checkoutCalls(),checkoutsBefore);
  charge.amount_refunded=1;assert.equal((await request(`${base}/quote`,'POST',{offerKey:'BASIC_499',interval:'year',billingEmail:'owner@example.test'})).status,409);charge.amount_refunded=0;
  assert.equal(fixture.checkoutCalls(),checkoutsBefore);
  cases.push('upgrade-stale-quote-revoked-paid-source-and-financial-drift-cannot-open-checkout');
  const expired=await checkout(q);assert.equal(expired.body.state,'OPEN');session(expired.body.attemptId).status='expired';await input.reconcile(account.id);
  assert.equal((await read()).tierKey,'STARTER_249');assert.equal((await read()).usage.remaining,410);assert.equal(sub.pause_collection,null);
  cases.push('upgrade-expired-payment-restores-collection-without-changing-access');
  const pendingQuote=await quote(),key=randomUUID();fixture.lose('checkout');const pending=await checkout(pendingQuote,key);assert.equal(pending.body.state,'UNKNOWN');
  assert.equal((await checkout(pendingQuote,key)).body.attemptId,pending.body.attemptId);await input.reconcile(account.id);
  assert.equal(provider.sessions!.filter(s=>s.metadata.billingAttemptId===pending.body.attemptId).length,1);assert.equal((await read()).tierKey,'STARTER_249');
  for(const sourceRoute of ['receipt-ocr-web','receipt-ocr-line'] as const) assert.equal((await admitCompanyOcr(prisma,{companyId,sourceRoute,requestId:`upgrade-pending-${suffix}-${sourceRoute}`,monthKey:'2026-09'})).allowed,true);
  fixture.complete(session(pending.body.attemptId));
  const paymentCharge=provider.charges!.at(-1)!,paidAmount=paymentCharge.amount;paymentCharge.amount=1;await input.reconcile(account.id);
  assert.equal((await read()).tierKey,'STARTER_249');assert.equal((await read()).usage.remaining,408);paymentCharge.amount=paidAmount;
  await client.billingReceiptGrant.update({where:{id:first.id},data:{revokedAt:new Date()}});await input.reconcile(account.id);
  assert.equal((await request(`${base}/attempts/${pending.body.attemptId}`)).body.paymentState,'PAID');assert.equal((await read()).tierKey,'STARTER_249');
  await client.billingReceiptGrant.update({where:{id:first.id},data:{revokedAt:null}});
  fixture.lose('scheduleUpdate');await input.reconcile(account.id);
  assert.equal((await read()).tierKey,'STARTER_249');assert.equal((await read()).usage.remaining,408);
  await input.reconcile(account.id);await input.reconcile(account.id);
  const basic=await read();assert.equal(basic.tierKey,'BASIC_499');assert.equal(basic.paidThrough,paidThrough);assert.equal(basic.usage.remaining,408+pendingQuote.purchase.receiptUnitsAdded);
  assert.equal(await client.companyOcrUsageEvent.count({where:{companyId}}),312);
  const current=await client.billingAccount.findUniqueOrThrow({where:{id:account.id}});
  const last=await client.billingSubscriptionContract.findFirstOrThrow({where:{billingAccountId:account.id},orderBy:[{effectiveAt:'desc'},{createdAt:'desc'}]});
  assert.equal((last.snapshotJson as unknown as BillingSnapshot).quote.totalSatang,499000);
  cases.push('upgrade-lost-checkout-and-schedule-response-no-double-payment-grant-or-time-extension');
  cases.push('upgrade-paid-source-change-and-wrong-charge-hold-unlock-and-preserve-web-line-use');
  let pro=await quote('PRO_999');assert.equal(pro.upgrade.segments[1].amountSatang,500000);assert.equal(pro.upgrade.segments[1].receiptUnitsAdded,600);
  const history=await upgradeHistory(client,current,billingOffer('PRO_999','year'),policy,pro.upgrade.prorationAt);
  assert.ok(history.segments.every(s=>s.oldOffer.offerKey==='BASIC_499'));
  let paid:{status:number;body:any};
  if(browser){const {page,origin}=browser;await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/companies/${companyId}/billing?offer=PRO_999&interval=year&channel=line`,{waitUntil:'domcontentloaded'});
    await page.getByLabel('อีเมลรับเอกสาร').fill('owner@example.test');await page.locator('article').filter({hasText:'Pro'}).getByRole('button',{name:'ตรวจสอบราคา',exact:true}).click();
    await page.getByText(/ชำระส่วนต่างและเริ่ม/).waitFor();await page.getByText(/รอบถัดไป.*9,990/).waitFor();
    await page.screenshot({path:`${browser.evidenceDir}/upgrade-review-mobile.png`,fullPage:true});
    await page.getByRole('checkbox').check();await page.getByRole('button',{name:'ยืนยันและไปชำระที่ Stripe',exact:true}).click();
    await page.getByRole('heading',{name:'Synthetic Stripe Checkout',exact:true}).waitFor();
    const reserved=await client.billingAccount.findUniqueOrThrow({where:{id:account.id}});
    const command=await client.billingAttempt.findUniqueOrThrow({where:{id:reserved.activeAttemptId!}});
    assert.equal(command.channel,'line');pro=(command.quoteSnapshot as unknown as BillingSnapshot).quote;
    paid={status:200,body:{state:command.status,attemptId:command.id}};
    cases.push('browser-line-upgrade-review-consent-actual-checkout-command');
  } else paid=await checkout(pro);
  assert.equal(paid.body.state,'OPEN',JSON.stringify(paid));fixture.complete(session(paid.body.attemptId));await input.reconcile(account.id);await input.reconcile(account.id);
  const final=await read();assert.equal(final.tierKey,'PRO_999');assert.equal(final.paidThrough,paidThrough);assert.equal(final.usage.remaining,basic.usage.remaining+pro.purchase.receiptUnitsAdded);
  assert.equal(await client.billingReceiptGrant.count({where:{billingAccountId:account.id,kind:'UPGRADE'}}),2);assert.equal(await client.auditLog.count({where:{companyId,action:'billing.package.upgraded'}}),2);
  assert.equal((await quote('PRO_999')).purchase.kind,'REPEAT');
  for(const kind of ['invoice','pdf','receipt']){const paidInvoice=await client.billingInvoice.findUniqueOrThrow({where:{sourceAttemptId:paid.body.attemptId}});assert.equal((await request(`${base}/documents/${paidInvoice.id}/open`,'POST',{kind})).status,200);}
  if(browser){await browser.page.goto(`${browser.origin}/companies/${companyId}/billing/return?attempt=${paid.body.attemptId}`,{waitUntil:'domcontentloaded'});await browser.page.getByRole('heading',{name:'ชำระแล้ว เปิดใช้งานแล้ว',exact:true}).waitFor();}
  cases.push('upgrade-starter-basic-pro-uses-last-paid-tier-retains-consumption-documents-and-full-renewal');
  // Scope drift rejects new changes; this fixture's OWNER is restored for deterministic cleanup.
  await client.membershipRole.delete({where:{membershipId_roleId:{membershipId:member.id,roleId:role.id}}});
  assert.equal((await request(`${base}/quote`,'POST',{offerKey:'PRO_999',interval:'year',billingEmail:'owner@example.test'})).status,403);
  await client.membershipRole.create({data:{membershipId:member.id,roleId:role.id}});
  return cases;
}
