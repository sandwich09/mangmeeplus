import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { billingOffer, type BillingPolicy } from '@watchdog-bms/contracts';
import type { PrismaService } from '../common/database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { termProjectionHash } from '../modules/billing/domain/paid-invoice';
import type { startBillingBrowser } from './billing-browser-smoke';

type Request = (path: string, method?: string, body?: unknown, extra?: Record<string,string>) => Promise<{status:number;body:any}>;

/** Real authenticated HTTP/PG/browser probes; paid history is an isolated fixture, never provider money. */
export async function checkBillingPurchaseRecovery(input: {request:Request;prisma:PrismaService;companyId:string;userId:string;
  stripeAccountId:string;browser?:Awaited<ReturnType<typeof startBillingBrowser>>}) {
  const {prisma,companyId,userId,stripeAccountId,browser}=input, db=prisma.client, base=`/v1/companies/${companyId}/billing`;
  const passed:string[]=[], failures:{name:string;message:string}[]=[];
  const probe=async(name:string,work:()=>Promise<void>)=>{try{await work();passed.push(name);}catch(error){failures.push({name,message:error instanceof Error?error.message:String(error)});}};
  const request:Request=async(...args)=>{for(let n=0;;n++){const r=await input.request(...args);if(r.status!==429||n===2)return r;await new Promise(resolve=>setTimeout(resolve,(r.body.retryAfterSeconds??10)*1000+100));}};
  const read=async()=>{const r=await request(base);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
  const quote=(purchaseMode='CARD_ONCE',offerKey='PRO_999',interval='year',purchaseIntent?:'FULL_PACKAGE')=>request(`${base}/quote`,'POST',{offerKey,interval,purchaseMode,purchaseIntent});
  const blocked=async(code:string)=>{const view=await read();assert.ok(!view.allowedActions.includes('new_sales'),'predictably blocked purchase must not offer new_sales');assert.equal(view.purchaseBlockCode,code);};
  const term=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}});
  const revision=await db.billingPolicyRevision.findFirstOrThrow({where:{stripeAccountId,livemode:false,state:'ACTIVE'}});
  const policy={...revision.policyJson as unknown as BillingPolicy,priceIds:{'STARTER_249:month':'price_StarterMonth','BASIC_499:month':'price_BasicMonth','PRO_999:year':'price_ProYear'}};
  await db.billingPolicyRevision.update({where:{id:revision.id},data:{policyJson:policy as unknown as Prisma.InputJsonValue}});
  await probe('trial-expired-first-purchase',async()=>{assert.equal((await read()).purchaseSource,'TRIAL');assert.equal((await quote()).body.purchase.kind,'INITIAL');});
  await db.companyPlanTerm.update({where:{companyId},data:{termEndsAt:new Date(Date.now()+86400000)}});
  await probe('trial-active-first-purchase',async()=>{assert.equal((await read()).accessState,'ACTIVE');assert.equal((await quote()).status,200);});
  await db.companyPlanTerm.update({where:{companyId},data:{termEndsAt:term.termEndsAt,termDisabledAt:new Date()}});
  await db.company.update({where:{id:companyId},data:{status:'DISABLED'}});
  await probe('trial-machine-expiry-billing-recovery-business-stays-locked',async()=>{assert.equal((await read()).accessState,'EXPIRED');assert.equal((await quote()).status,200);assert.equal((await request(`/v1/companies/${companyId}/expenses`)).body.code,'company_term_expired');});
  await db.companyPlanTerm.update({where:{companyId},data:{termDisabledAt:null}});
  await probe('manual-hold-cannot-buy-through-expiry-route',async()=>{assert.equal((await request(base)).status,403);assert.equal((await quote()).status,403);});
  await db.company.update({where:{id:companyId},data:{status:'ACTIVE'}});
  const account=await db.billingAccount.create({data:{companyId,stripeAccountId,livemode:false}});
  const preRecipientQuote=await quote();assert.equal(preRecipientQuote.status,200);
  const op=await db.billingOperation.create({data:{companyId,stripeAccountId,livemode:false,type:'UPDATE_BILLING_EMAIL',state:'UNKNOWN',
    proposedJson:{accountId:account.id,target:{source:'CUSTOMER_OTP'}},sourceVersion:account.version,reason:'synthetic-recovery-probe',initiatorUserId:userId,requestHash:randomUUID(),expiresAt:new Date(Date.now()+86400000)}});
  await db.billingAccount.update({where:{id:account.id},data:{activeEmailOperationId:op.id}});
  await probe('recipient-pending-status-agrees-with-quote',async()=>{assert.equal((await quote()).body.code,'BILLING_EMAIL_UPDATE_PENDING');await blocked('BILLING_EMAIL_UPDATE_PENDING');});
  await db.billingAccount.update({where:{id:account.id},data:{activeEmailOperationId:null}});
  await db.billingOperation.update({where:{id:op.id},data:{proposedJson:{accountId:account.id,target:{source:'ADMIN'}}}});
  await probe('admin-recipient-pending-also-fences-purchase',async()=>{await blocked('BILLING_EMAIL_UPDATE_PENDING');assert.equal((await quote()).body.code,'BILLING_EMAIL_UPDATE_PENDING');});
  await probe('admin-recipient-change-after-quote-refuses-checkout-before-attempt',async()=>{const before=await db.billingAttempt.count({where:{billingAccountId:account.id}});const r=await request(`${base}/checkout`,'POST',{quoteId:preRecipientQuote.body.quoteId,accepted:true,consentRevision:preRecipientQuote.body.consentRevision,channel:'web'},{'idempotency-key':randomUUID()});assert.equal(r.body.code,'BILLING_EMAIL_UPDATE_PENDING',JSON.stringify(r));assert.equal(await db.billingAttempt.count({where:{billingAccountId:account.id}}),before);});
  // Never sent and expired: it holds no purchase. Once dispatched it holds again, whatever its age.
  await db.billingOperation.update({where:{id:op.id},data:{state:'QUEUED',expiresAt:new Date(Date.now()-1000)}});
  await probe('admin-recipient-change-never-sent-and-expired-holds-no-purchase-until-dispatched',async()=>{const free=await quote();assert.equal(free.status,200,JSON.stringify(free.body));
    await db.billingOperation.update({where:{id:op.id},data:{resultJson:{dispatchedAt:new Date().toISOString()}}});await blocked('BILLING_EMAIL_UPDATE_PENDING');assert.equal((await quote()).body.code,'BILLING_EMAIL_UPDATE_PENDING');});
  await db.billingOperation.update({where:{id:op.id},data:{state:'SUCCEEDED'}});
  const settings=await db.billingSettings.findUniqueOrThrow({where:{id:`${stripeAccountId}:test`}});
  await db.billingSettings.update({where:{id:settings.id},data:{gatesJson:{...settings.gatesJson as object,new_sales:false}}});
  await probe('closed-sales-specific-reason',()=>blocked('BILLING_SALES_CLOSED'));
  await db.billingSettings.update({where:{id:settings.id},data:{gatesJson:settings.gatesJson as Prisma.InputJsonValue}});
  await db.billingPolicyRevision.update({where:{id:revision.id},data:{policyJson:{...policy,portalConfigurationId:null} as unknown as Prisma.InputJsonValue}});
  await probe('incomplete-policy-specific-reason',()=>blocked('CONTROL_POLICY_NOT_READY'));
  await db.billingPolicyRevision.update({where:{id:revision.id},data:{policyJson:policy as unknown as Prisma.InputJsonValue}});
  await db.companyFeatureEntitlement.create({data:{companyId,featureKey:'expenses',enabled:true}});
  await probe('partial-feature-provenance-refuses-before-money',async()=>{await blocked('BILLING_ENTITLEMENT_REVIEW_REQUIRED');assert.equal((await quote()).body.code,'BILLING_ENTITLEMENT_REVIEW_REQUIRED');});
  await db.companyFeatureEntitlement.deleteMany({where:{companyId}});
  const start=new Date(Date.now()-60000),end=new Date(Date.now()+86400000),offer=billingOffer('STARTER_249','month',policy),attemptId=randomUUID();
  const snapshot={quote:{offer,purchaseMode:'CARD_ONCE'},policy};
  const paidTerm=await db.companyPlanTerm.update({where:{companyId},data:{tierKey:offer.offerKey,branchLimit:offer.branchLimit,employeeLimit:offer.employeeLimit,
    monthlySlipLimit:offer.monthlySlipLimit,termStartAt:start,termEndsAt:end,billingReceiptAccountId:account.id}});
  await db.billingAccount.update({where:{id:account.id},data:{renewalMode:'CARD_ONCE',contractAttemptId:attemptId,paidThrough:end,billingAnchorDay:start.getUTCDate(),termProjectionHash:termProjectionHash(paidTerm)}});
  const invoice=await db.billingInvoice.create({data:{billingAccountId:account.id,sourceAttemptId:attemptId,providerInvoiceId:`in_recovery${randomUUID().replaceAll('-','')}`,
    offerSnapshot:offer as unknown as Prisma.InputJsonValue,contractSnapshot:snapshot as unknown as Prisma.InputJsonValue,policyRevisionId:revision.id,currency:'THB',totalSatang:24900,paidSatang:24900,
    periodStart:start,periodEnd:end,providerStatus:'paid',applyStatus:'APPLIED',appliedAt:start,evidenceHash:'synthetic-recovery-paid-history'}});
  await db.billingReceiptGrant.create({data:{companyId,billingAccountId:account.id,sourceKey:invoice.id,sourceHash:'synthetic-recovery-grant',kind:'INITIAL',units:30,serviceStart:start,
    serviceEnd:end,availableAt:start,expiresAt:end,policyRevisionId:revision.id}});
  await probe('active-one-time-full-and-differential-both-supported',async()=>{const diff=await quote('CARD_ONCE','BASIC_499','month');assert.equal(diff.status,200,JSON.stringify(diff.body));assert.equal(diff.body.purchase.kind,'UPGRADE');
    const full=await quote('CARD_ONCE','BASIC_499','month','FULL_PACKAGE');assert.equal(full.status,200,JSON.stringify(full.body));assert.equal(full.body.purchase.kind,'FULL_PACKAGE_UPGRADE');assert.equal(full.body.totalSatang,49900);});
  await db.billingSettings.update({where:{id:settings.id},data:{gatesJson:{...settings.gatesJson as object,plan_changes:false}}});
  await probe('active-one-time-change-gate-closes-upgrade-but-keeps-repeat',async()=>{const view=await read();assert.equal(view.packageChangesEnabled,false);assert.ok(view.allowedActions.includes('new_sales'));assert.equal((await quote('CARD_ONCE','STARTER_249','month')).status,200);for(const intent of [undefined,'FULL_PACKAGE'] as const)assert.equal((await quote('CARD_ONCE','BASIC_499','month',intent)).body.code,'BILLING_REPEAT_NOT_READY');});
  await db.billingSettings.update({where:{id:settings.id},data:{gatesJson:settings.gatesJson as Prisma.InputJsonValue}});
  await db.billingInvoice.update({where:{id:invoice.id},data:{refundedSatang:24900}});
  await probe('refunded-active-source-blocks-before-full-or-differential-click',async()=>{for(const intent of [undefined,'FULL_PACKAGE'] as const)assert.equal((await quote('CARD_ONCE','BASIC_499','month',intent)).body.code,'BILLING_PACKAGE_STATE_INVALID');await blocked('BILLING_PACKAGE_STATE_INVALID');});
  await db.billingInvoice.update({where:{id:invoice.id},data:{refundedSatang:0,contractSnapshot:{}}});
  await probe('malformed-paid-snapshot-is-review-not-500',async()=>{assert.equal((await quote('CARD_ONCE','BASIC_499','month')).body.code,'BILLING_PACKAGE_STATE_INVALID');await blocked('BILLING_PACKAGE_STATE_INVALID');});
  await db.billingInvoice.update({where:{id:invoice.id},data:{contractSnapshot:snapshot as unknown as Prisma.InputJsonValue}});
  const expire=async(at:Date)=>{const t=await db.companyPlanTerm.update({where:{companyId},data:{termEndsAt:at}});await db.billingAccount.update({where:{id:account.id},data:{paidThrough:at,termProjectionHash:termProjectionHash(t)}});await db.billingInvoice.update({where:{id:invoice.id},data:{periodEnd:at}});await db.billingReceiptGrant.updateMany({where:{billingAccountId:account.id,sourceKey:invoice.id},data:{serviceEnd:at,expiresAt:at}});};
  const soon=new Date(Date.now()+1500);await expire(soon);
  let expiringQuote:any;
  await probe('one-time-quote-does-not-outlive-source-term',async()=>{const r=await quote('CARD_ONCE','STARTER_249','month');assert.equal(r.status,200,JSON.stringify(r.body));expiringQuote=r.body;assert.ok(Date.parse(r.body.expiresAt)<=soon.getTime());});
  // Keep the pre-expiry quote even when the above expectation failed on the baseline.
  if(!expiringQuote)expiringQuote=(await quote('CARD_ONCE','STARTER_249','month')).body;
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,soon.getTime()-Date.now())+50));
  await probe('expired-source-quote-cannot-open-collectible-checkout',async()=>{const before=await db.billingAttempt.count({where:{billingAccountId:account.id}});const r=await request(`${base}/checkout`,'POST',{
    quoteId:expiringQuote.quoteId,consentRevision:expiringQuote.consentRevision,accepted:true,channel:'web'},{'idempotency-key':randomUUID()});assert.equal(r.body.code,'BILLING_QUOTE_STALE',JSON.stringify(r.body));assert.equal(await db.billingAttempt.count({where:{billingAccountId:account.id}}),before);});
  // A baseline defect may have opened a real local intent; retain evidence but stop it owning later probes.
  await db.billingAccount.update({where:{id:account.id},data:{activeAttemptId:null}});
  await probe('expired-one-time-switches-to-restart-all-enabled-modes',async()=>{const s=await read();assert.ok(s.allowedActions.includes('new_sales'));assert.deepEqual(s.availablePurchaseModes,['CARD_AUTO','CARD_ONCE','PROMPTPAY_ONCE','PROMPTPAY_RENEW']);assert.equal((await quote()).body.purchase.kind,'RESTART');});
  await db.billingAccount.update({where:{id:account.id},data:{baseSubscriptionId:'sub_recovery',renewalMode:'CARD_AUTO',subscriptionState:'canceled',customerId:'cus_recovery'}});
  const issue=await db.billingIssue.create({data:{companyId,stripeAccountId,livemode:false,kind:'FINANCIAL_REVIEW',referenceId:invoice.id}});
  await probe('expired-terminal-subscription-local-financial-review-preflight',async()=>{assert.equal((await quote()).body.code,'BILLING_RESTART_REVIEW');await blocked('BILLING_RESTART_REVIEW');});
  await db.billingIssue.update({where:{id:issue.id},data:{state:'RESOLVED'}});
  await db.billingInvoice.update({where:{id:invoice.id},data:{refundedSatang:1}});
  await probe('historical-refund-still-blocks-subscription-restart',()=>blocked('BILLING_RESTART_REVIEW'));
  await db.billingInvoice.update({where:{id:invoice.id},data:{refundedSatang:0}});
  await db.billingAccount.update({where:{id:account.id},data:{subscriptionState:'past_due'}});
  await probe('expired-payable-subscription-has-specific-recovery-reason',()=>blocked('BILLING_RESTART_REVIEW'));
  await db.billingAccount.update({where:{id:account.id},data:{baseSubscriptionId:null,customerId:null,renewalMode:'CARD_ONCE',subscriptionState:'NONE'}});
  if(browser){
    const {page}=browser,href=`${browser.origin}/companies/${companyId}/billing`;
    page.setDefaultTimeout(10000); await page.setViewportSize({width:390,height:844});
    page.on('response',async response=>{if(response.status()===403&&new URL(response.url()).pathname.startsWith('/api/')){const body=await response.json().catch(()=>({}));console.log(JSON.stringify({layer:'purchase-recovery-browser-denial',path:new URL(response.url()).pathname,code:body.code??null}));}});
    const choose=()=>page.getByRole('button',{name:/^(ซื้อหรือเปลี่ยนแพ็กเกจ|เลือกแพ็กเกจ)$/});
    await probe('browser-history-outage-does-not-erase-purchase-and-retries',async()=>{await page.route(`**/api${base}/history`,r=>r.fulfill({status:503,json:{code:'temporary_outage'}}));await page.goto(href);await choose().waitFor();await page.getByRole('button',{name:'ประวัติ',exact:true}).click();await page.getByRole('alert').filter({hasText:'ประวัติ'}).waitFor();await page.unroute(`**/api${base}/history`);await page.getByRole('button',{name:'ลองโหลดประวัติใหม่',exact:true}).click();await page.getByRole('alert').filter({hasText:'ประวัติ'}).waitFor({state:'hidden'});});
    await page.unroute(`**/api${base}/history`);
    await probe('browser-pending-history-does-not-delay-purchase-entry',async()=>{
      let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
      await page.route(`**/api${base}/history`,async route=>{await held;await route.continue();});
      try{await page.goto(href);await choose().waitFor();await choose().click();await page.getByRole('heading',{name:'เติบโต (BASIC)',exact:true}).waitFor();}
      finally{release();await page.unroute(`**/api${base}/history`);}
    });
    await expire(new Date(Date.now()+86400000));
    await probe('browser-active-one-time-full-and-differential-review-with-explicit-consent',async()=>{
      for(const full of [false,true]){
        await page.goto(href);await choose().click();await page.getByRole('radio',{name:'บัตร · จ่ายครั้งเดียว',exact:true}).check();
        const card=page.locator('article').filter({has:page.getByRole('heading',{name:'เติบโต (BASIC)',exact:true})});
        const priced=page.waitForResponse(response=>new URL(response.url()).pathname===`/api${base}/quote`&&response.request().method()==='POST');
        await card.getByRole('button',{name:full?/^ซื้อ เติบโต \(BASIC\) เต็มแพ็ก/: 'อัปเกรดจ่ายส่วนต่าง'}).click();
        const response=await priced,body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));
        assert.equal(body.purchase.kind,full?'FULL_PACKAGE_UPGRADE':'UPGRADE');if(full)assert.equal(body.totalSatang,49900);
        await page.getByRole('heading',{name:/ยืนยันซื้อ เติบโต \(BASIC\)/}).waitFor();
        const consent=page.getByRole('checkbox',{name:'ฉันตรวจสอบข้อมูลและยืนยันเงื่อนไขจ่ายครั้งเดียว',exact:true});
        const checkout=page.getByRole('button',{name:'ยืนยันและไปชำระที่ Stripe',exact:true});
        assert.equal(await consent.isChecked(),false);assert.equal(await checkout.isDisabled(),true);await consent.check();
        assert.equal(await checkout.isEnabled(),true);assert.equal(await db.billingAttempt.count({where:{billingAccountId:account.id}}),0);
        await page.screenshot({path:`${browser.evidenceDir}/purchase-${full?'full':'differential'}-review-mobile.png`,fullPage:true});
      }
    });
    await db.billingSettings.update({where:{id:settings.id},data:{gatesJson:{...settings.gatesJson as object,plan_changes:false}}});
    await probe('browser-one-time-change-gate-disables-full-and-differential-not-repeat',async()=>{await page.goto(href);await choose().click();await page.getByRole('radio',{name:'บัตร · จ่ายครั้งเดียว',exact:true}).check();const basic=page.locator('article').filter({has:page.getByRole('heading',{name:'เติบโต (BASIC)',exact:true})});for(const button of await basic.getByRole('button').all())assert.equal(await button.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'ซื้อแพ็กเกจเดิมเพิ่ม',exact:true}).isEnabled(),true);});
    await db.billingSettings.update({where:{id:settings.id},data:{gatesJson:settings.gatesJson as Prisma.InputJsonValue}});
    await probe('browser-expiry-refreshes-mode-availability-without-reload',async()=>{await expire(new Date(Date.now()+8000));await page.goto(href);await choose().click();await page.getByRole('radio',{name:'บัตร · ต่ออายุอัตโนมัติ',exact:true}).check();const card=page.locator('article').filter({has:page.getByRole('heading',{name:'เติบโต (BASIC)',exact:true})});await card.getByRole('button').first().waitFor();assert.equal(await card.getByRole('button').first().isDisabled(),true);await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(el=>/^(ซื้อหรือเปลี่ยนแพ็กเกจ|เลือกแพ็กเกจ)$/.test(el.textContent?.trim()??''))||Array.from(document.querySelectorAll('article')).some(el=>el.textContent?.includes('เติบโต (BASIC)')&&!(el.querySelector('button') as HTMLButtonElement)?.disabled),undefined,{timeout:16000});if(await choose().isVisible())await choose().click();await page.getByRole('radio',{name:'บัตร · ต่ออายุอัตโนมัติ',exact:true}).check();await card.getByRole('button').first().waitFor();assert.equal(await card.getByRole('button').first().isEnabled(),true);assert.equal(new URL(page.url()).pathname,new URL(href).pathname);});
    await db.billingOperation.update({where:{id:op.id},data:{state:'UNKNOWN'}});
    await probe('browser-focus-sees-new-recipient-block-and-keeps-exit',async()=>{await db.billingAccount.update({where:{id:account.id},data:{activeEmailOperationId:op.id}});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('alert').filter({hasText:'เปลี่ยนอีเมลรับเอกสาร'}).waitFor();assert.equal(await page.getByRole('button',{name:'จัดการผู้รับเอกสาร',exact:true}).isVisible(),true);await page.screenshot({path:`${browser.evidenceDir}/purchase-recipient-block-mobile.png`,fullPage:true});});
    await db.billingAccount.update({where:{id:account.id},data:{activeEmailOperationId:null}});
    await db.billingOperation.update({where:{id:op.id},data:{state:'SUCCEEDED'}});
    await probe('browser-focus-recovers-after-operation-completion',async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('alert').filter({hasText:'เปลี่ยนอีเมลรับเอกสาร'}).waitFor({state:'hidden'});if(await choose().isVisible())await choose().click();const card=page.locator('article').filter({has:page.getByRole('heading',{name:'เติบโต (BASIC)',exact:true})});await card.getByRole('button').first().waitFor();assert.equal(await card.getByRole('button').first().isEnabled(),true);assert.equal(new URL(page.url()).pathname,new URL(href).pathname);await page.screenshot({path:`${browser.evidenceDir}/purchase-recovered-mobile.png`,fullPage:true});});
  }
  if(browser){
    const {page}=browser,href=`${browser.origin}/companies/${companyId}/billing`;
    await probe('browser-focus-during-read-keeps-the-newest-operation-state',async()=>{
      await db.billingOperation.update({where:{id:op.id},data:{state:'UNKNOWN'}});await db.billingAccount.update({where:{id:account.id},data:{activeEmailOperationId:op.id}});
      let release!:()=>void,captured!:()=>void;const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>captured=r);
      await page.route(`**/api${base}`,async route=>{await page.unroute(`**/api${base}`);const response=await route.fetch();captured();await held;await route.fulfill({response});});
      try{
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('status read was not captured')),10000))]);
        await db.billingAccount.update({where:{id:account.id},data:{activeEmailOperationId:null}});await db.billingOperation.update({where:{id:op.id},data:{state:'SUCCEEDED'}});
        const fresh=page.waitForResponse(async response=>new URL(response.url()).pathname===`/api${base}`&&response.status()===200&&(await response.json()).purchaseBlockCode===null);
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));release();await fresh;
        await page.getByRole('heading',{name:'เติบโต (BASIC)',exact:true}).waitFor();
        await page.getByRole('alert').filter({hasText:'เปลี่ยนอีเมลรับเอกสาร'}).waitFor({state:'hidden'});
        assert.equal(new URL(page.url()).pathname,new URL(href).pathname);
      }finally{release();await page.unroute(`**/api${base}`);}
    });
    await probe('browser-old-load-cannot-reopen-after-newer-permission-denial',async()=>{
      await page.goto(href);await page.getByRole('button',{name:/^(ซื้อหรือเปลี่ยนแพ็กเกจ|เลือกแพ็กเกจ)$/}).waitFor();
      let release!:()=>void,captured!:()=>void;const held=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>captured=resolve);
      const catalogPath='/api/v1/billing/catalog';
      await page.route(`**${catalogPath}`,async route=>{const response=await route.fetch();captured();await held;await route.fulfill({response});});
      try{
        const permitted=page.waitForResponse(response=>new URL(response.url()).pathname===`/api${base}`&&response.status()===200);
        await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await permitted;
        await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('catalog read was not captured')),10000))]);
        await page.route(`**/api${base}`,route=>route.fulfill({status:403,json:{code:'permission_denied'}}));
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('alert').filter({hasText:'สิทธิ์จัดการแพ็กเกจ'}).waitFor();
        const completed=page.waitForResponse(response=>new URL(response.url()).pathname===catalogPath&&response.status()===200);release();await (await completed).finished();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await page.getByRole('button',{name:/^(ซื้อหรือเปลี่ยนแพ็กเกจ|เลือกแพ็กเกจ)$/}).count(),0);
      }finally{release();await page.unroute(`**${catalogPath}`);await page.unroute(`**/api${base}`);}
    });
    await probe('browser-history-permission-denial-still-fails-closed',async()=>{
      await page.route(`**/api${base}/history`,route=>route.fulfill({status:403,json:{code:'permission_denied'}}));
      try{await page.goto(href);await page.getByRole('alert').filter({hasText:'สิทธิ์จัดการแพ็กเกจ'}).waitFor();assert.equal(await page.getByRole('button',{name:/^(ซื้อหรือเปลี่ยนแพ็กเกจ|เลือกแพ็กเกจ)$/}).count(),0);}
      finally{await page.unroute(`**/api${base}/history`);}
    });
  }
  console.log(JSON.stringify({layer:'purchase-recovery-real-HTTP-PG-browser',passed,failures,realProviderPayment:false}));
  assert.equal(failures.length,0,JSON.stringify(failures));return passed;
}
