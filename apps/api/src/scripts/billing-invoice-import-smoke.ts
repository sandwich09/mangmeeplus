import { billingRateLimitWindowSeconds } from '../modules/billing/billing-rate-limit-window';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {billingOffer,BILLING_DRAFT_POLICY} from '@watchdog-bms/contracts';
import {termProjectionHash} from '../modules/billing/domain/paid-invoice';
import {hashBilling} from '../modules/billing/domain/billing-policy';
import {appendPackageInterval,packageAnchorDay} from '../modules/billing/domain/billing-package';
import type {ProviderScansSmokeInput} from './billing-provider-scans-smoke';

/** Actual Admin HTTP/PG/worker/browser; only provider transport and named race faults are synthetic. */
export async function checkBillingInvoiceImport(input:ProviderScansSmokeInput&{roleId:string;adminId:string}) {
  const db=input.prisma.client,tag=randomUUID().replaceAll('-',''),companyId=`invoice-import-${tag}`,customerId=`cus_import${tag}`,base='/v1/system/billing',cases:string[]=[];
  const request:typeof input.request=async(...args)=>{for(let n=0;;n++){const r=await input.request(...args);if(r.status!==429||n>=2)return r;
    assert.ok(r.body.retryAfterSeconds<=60);await new Promise(resolve=>setTimeout(resolve,Math.min(60,r.body.retryAfterSeconds+1)*1000));}};
  await db.company.create({data:{id:companyId,name:'Synthetic invoice import'}});
  const term=await db.companyPlanTerm.create({data:{companyId,tierKey:'FREE_TRIAL_15',branchLimit:1,employeeLimit:2,monthlySlipLimit:15,termStartAt:new Date(Date.now()-40*86400000),termEndsAt:new Date(Date.now()-10*86400000)}});
  const account=await db.billingAccount.create({data:{companyId,stripeAccountId:input.stripeAccountId,livemode:false,customerId,baseSubscriptionId:'sub_CurrentUnrelated',subscriptionState:'canceled'}});
  const permission=await db.permission.upsert({where:{key:'system.billing.apply.retry'},update:{},create:{key:'system.billing.apply.retry',description:'Apply existing payment'}});
  await db.rolePermission.create({data:{roleId:input.roleId,permissionId:permission.id}});
  const objects=new Map<string,any>(),calls:string[]=[];let fault:((path:string)=>Promise<Response|undefined>)|undefined;
  const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}}),list=(data:any[])=>({object:'list',data,has_more:false});
  input.transport(async(url,init)=>{
    if(url.origin!=='https://api.stripe.com')return;
    assert.equal(init?.method,'GET','Import must not mutate Stripe');const path=url.pathname.slice(3);calls.push(path);
    const broken=await fault?.(path);if(broken)return broken;
    if(path==='/account')return response({id:input.stripeAccountId});
    if(path==='/subscriptions')return response(list([...objects.values()].filter(v=>v.object==='subscription')));
    if(path==='/invoice_payments')return response(list([...objects.values()].filter(v=>v.object==='invoice_payment'&&v.invoice===url.searchParams.get('invoice'))));
    if(objects.has(path))return response(objects.get(path));
    throw new Error(`Unhandled synthetic invoice import route ${path}`);
  });
  const finding=async(repeat=false)=>{
    const id=randomUUID().replaceAll('-',''),attemptId=randomUUID(),scanId=randomUUID(),findingId=randomUUID(),created=Math.floor(Date.now()/1000)-90*86400,paidAt=created+3;
    const invoiceId=`in_${id}`,subId=`sub_${id}`,sessionId=`cs_${id}`,intentId=`pi_${id}`,chargeId=`ch_${id}`,amount=999000,policy='synthetic-import-policy';
    const snapshot:any={quote:{quoteId:randomUUID(),companyId,consentRevision:'import-consent',policyRevision:policy,offer:billingOffer('PRO_999','year'),totalSatang:amount,taxSatang:0},
      policy:BILLING_DRAFT_POLICY,priceId:'price_original',termHash:termProjectionHash(term),...(repeat?{repeat:{subscriptionId:'sub_CurrentUnrelated',paidThrough:new Date((paidAt+240*86400)*1000).toISOString(),productId:'prod_original',anchorDay:packageAnchorDay(new Date((paidAt+240*86400)*1000))}}:{})};
    const attempt=await db.billingAttempt.create({data:{id:attemptId,billingAccountId:account.id,initiatingUserId:input.userId,quoteId:snapshot.quote.quoteId,channel:'web',
      idempotencyKey:randomUUID(),requestHash:randomUUID(),quoteSnapshot:snapshot,policyRevisionId:policy,consentRevision:'import-consent',consentAt:new Date((created-3)*1000),
      checkoutSessionId:sessionId,subscriptionId:repeat?null:subId,status:'COMPLETED'}});
    const metadata={billingAccountId:account.id,billingAttemptId:attemptId};
    const invoice:any={id:invoiceId,object:'invoice',created,livemode:false,customer:customerId,status:'paid',currency:'thb',total:amount,amount_paid:amount,amount_remaining:0,starting_balance:0,
      billing_reason:repeat?'manual':'subscription_create',collection_method:repeat?'send_invoice':'charge_automatically',parent:repeat?null:{subscription_details:{subscription:subId}},metadata,
      status_transitions:{paid_at:paidAt},customer_email:'private-import@example.test',hosted_invoice_url:'https://invoice.stripe.com/private'};
    const session:any={id:sessionId,object:'checkout.session',livemode:false,mode:repeat?'payment':'subscription',status:'complete',payment_status:'paid',customer:customerId,client_reference_id:attemptId,metadata,
      subscription:repeat?null:subId,invoice:invoiceId,payment_intent:intentId,invoice_creation:{enabled:true},currency:'thb',amount_total:amount,total_details:{amount_tax:0,amount_discount:0,amount_shipping:0},created};
    const subscription={id:subId,object:'subscription',livemode:false,customer:customerId,metadata,status:'canceled'};
    const charge={id:chargeId,livemode:false,status:'succeeded',paid:true,captured:true,currency:'thb',amount,customer:customerId,payment_intent:intentId,payment_method_details:{type:'card'},amount_refunded:0,disputed:false};
    const line=repeat?{parent:{type:'invoice_item_details',invoice_item_details:{invoice_item:'ii_original',subscription:null,proration:false}},pricing:{price_details:{price:'price_inline',product:'prod_original'}},amount,currency:'thb',livemode:false,quantity:1,period:{start:paidAt,end:paidAt}}:
      {parent:{type:'subscription_item_details',subscription_item_details:{subscription:subId,subscription_item:'si_original',proration:false}},pricing:{price_details:{price:'price_original'}},currency:'thb',livemode:false,quantity:1,period:{start:created,end:created+30*86400}};
    objects.set(`/invoices/${invoiceId}`,invoice);objects.set(`/checkout/sessions/${sessionId}`,session);if(!repeat)objects.set(`/subscriptions/${subId}`,subscription);
    objects.set(`/invoices/${invoiceId}/lines`,list([line]));objects.set(`/checkout/sessions/${sessionId}/line_items`,list([{quantity:1,currency:'thb',amount_total:amount,amount_tax:0,amount_discount:0,
      price:{id:'price_inline',product:'prod_original',type:'one_time',recurring:null,livemode:false,currency:'thb',unit_amount:amount}}]));
    objects.set(`/payment_intents/${intentId}`,{id:intentId,livemode:false,status:'succeeded',currency:'thb',amount_received:amount,customer:customerId,latest_charge:chargeId});objects.set(`/charges/${chargeId}`,charge);
    objects.set(`payment:${id}`,{object:'invoice_payment',livemode:false,status:'paid',invoice:invoiceId,payment:{type:'payment_intent',payment_intent:intentId},amount_paid:amount,currency:'thb'});
    const observation={accountId:account.id,customerId,providerInvoiceId:invoiceId,created,status:'paid',currency:'thb',total:amount,paid:amount,classification:'LOCAL_MISSING'};
    await db.billingOperation.create({data:{id:scanId,companyId,stripeAccountId:input.stripeAccountId,livemode:false,type:'SCAN_PROVIDER_INVOICES',state:'SUCCEEDED',sourceVersion:0,
      proposedJson:{accountId:account.id,customerId,since:created-60,until:created+60,membershipId:input.membershipId,actorCompanyId:input.membershipId},resultJson:{pages:1,seen:1,imported:1,known:0,ignored:0,incompatible:0,retryAt:null,missing:1},
      reason:'Synthetic retained discovery',initiatorUserId:input.userId,requestHash:randomUUID(),expiresAt:new Date(Date.now()+86400000)}});
    await db.billingOperation.create({data:{id:findingId,companyId,stripeAccountId:input.stripeAccountId,livemode:false,type:'OBSERVE_PROVIDER_INVOICE',state:'SUCCEEDED',referenceId:scanId,sourceVersion:0,
      proposedJson:observation,requestHash:hashBilling([scanId,observation]),reason:'Synthetic immutable observation',initiatorUserId:input.userId,expiresAt:new Date(Date.now()+86400000)}});
    return {id:findingId,scanId,attempt,invoice,session,charge,subscription,line,snapshot};
  };
  const view=async(id:string)=>{const r=await request(`${base}/companies/${companyId}/invoice-findings/${id}`);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const preview=async(id:string,extra:Record<string,unknown>={})=>{const v=await view(id);return request(`${base}/operations/preview`,'POST',{type:'IMPORT_INVOICE',companyId,referenceId:id,findingSourceHash:v.sourceHash,expectedVersion:v.accountVersion,reason:'ตรวจหลักฐานเดิมเพื่อกู้ใบแจ้งหนี้',...extra});};
  const submit=(p:any)=>request(`${base}/operations`,'POST',{previewId:p.id,previewHash:p.previewHash,expectedVersion:p.version},{'idempotency-key':`import-${p.id}`});
  const read=async(id:string)=>{const r=await request(`${base}/operations/${id}`);assert.equal(r.status,200);return r.body;};
  const run=async(id:string)=>{const p=await preview(id);assert.equal(p.status,200,JSON.stringify(p));const queued=await submit(p.body);assert.equal(queued.status,202,JSON.stringify(queued));await input.drainOperations!();return read(p.body.id);};
  const cancel=async(id:string)=>{const r=await read(id);assert.equal((await request(`${base}/operations/${id}/cancel`,'POST',{expectedVersion:r.version})).status,200);};
  const unchanged=async()=>{assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),term);assert.equal(await db.billingReceiptGrant.count({where:{companyId}}),0);
    assert.equal(await db.billingSubscriptionContract.count({where:{billingAccountId:account.id}}),0);assert.equal(await db.outboxEvent.count({where:{companyId}}),0);
    const a=await db.billingAccount.findUniqueOrThrow({where:{id:account.id}});for(const key of ['baseSubscriptionId','activeAttemptId','contractAttemptId','paidThrough','nextChargeAt','subscriptionState'] as const)assert.deepEqual(a[key],account[key]);};
  try{
    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminId}}});
    const first=await finding();assert.equal((await request(`${base}/companies/${companyId}/invoice-findings/${first.id}`)).status,404);
    await db.billingOperatorScope.create({data:{userId:input.userId,companyId,stripeAccountId:input.stripeAccountId,livemode:false,createdByUserId:input.userId}});
    assert.equal((await view(first.id)).canImport,true);assert.equal(await db.companyMembership.count({where:{companyId,userId:input.userId}}),0);
    await db.rolePermission.delete({where:{roleId_permissionId:{roleId:input.roleId,permissionId:permission.id}}});assert.equal((await view(first.id)).canImport,false);assert.equal((await preview(first.id)).status,403);
    await db.rolePermission.create({data:{roleId:input.roleId,permissionId:permission.id}});
    assert.equal((await preview(first.id,{providerInvoiceId:first.invoice.id})).status,400);assert.equal((await preview(first.id,{findingSourceHash:'wrong'})).status,409);
    const result=await run(first.id);assert.equal(result.state,'SUCCEEDED',JSON.stringify(result));assert.equal(result.observed.invoiceApplyState,'HELD');
    assert.equal((await view(first.id)).localInvoiceId,result.observed.invoiceId);assert.doesNotMatch(JSON.stringify(await view(first.id)),/cus_|in_|cs_|private-import|stripeAccountId/);
    assert.equal(await db.auditLog.count({where:{companyId,action:'billing.invoice.imported'}}),1);await unchanged();
    cases.push('invoice-import-scoped-nonmember-read-only-strict-input-and-old-subscription-verified-held-without-rights-or-current-contract-change');
    const historical=await finding();historical.line.period.end=historical.line.period.start+365*86400;const imported=await run(historical.id);
    assert.equal(imported.state,'SUCCEEDED');const target=await request(`${base}/companies/${companyId}/apply-invoices/${imported.observed.invoiceId}`);assert.equal(target.status,200);
    const apply=await request(`${base}/operations/preview`,'POST',{type:'RETRY_APPLY',companyId,expectedVersion:target.body.accountVersion,referenceId:target.body.id,invoiceSourceHash:target.body.sourceHash,reason:'ตรวจว่าสัญญาเก่าไม่แทนที่แพ็กเกจปัจจุบัน'});
    assert.equal(apply.status,200,JSON.stringify(apply));assert.equal((await submit(apply.body)).status,202);await input.drainOperations!();assert.equal((await read(apply.body.id)).state,'UNKNOWN');await cancel(apply.body.id);await unchanged();
    cases.push('invoice-import-follow-on-exact-apply-holds-old-subscription-with-future-paid-end-instead-of-replacing-current-contract');
    await db.billingAccount.update({where:{id:account.id},data:{baseSubscriptionId:historical.subscription.id,paidThrough:new Date((historical.line.period.end+365*86400)*1000)}});
    const overlapView=(await request(`${base}/companies/${companyId}/apply-invoices/${target.body.id}`)).body;
    const overlap=await request(`${base}/operations/preview`,'POST',{type:'RETRY_APPLY',companyId,expectedVersion:overlapView.accountVersion,referenceId:overlapView.id,invoiceSourceHash:overlapView.sourceHash,reason:'ตรวจใบแจ้งหนี้ที่ซ้อนกับช่วงซึ่งจ่ายไว้แล้ว'});
    assert.equal(overlap.status,200);assert.equal((await submit(overlap.body)).status,202);await input.drainOperations!();assert.equal((await read(overlap.body.id)).state,'UNKNOWN');await cancel(overlap.body.id);
    assert.equal((await db.billingInvoice.findUniqueOrThrow({where:{id:overlapView.id}})).applyStatus,'HELD');
    await db.billingAccount.update({where:{id:account.id},data:{baseSubscriptionId:account.baseSubscriptionId,paidThrough:account.paidThrough}});
    // Valid current-contract evidence may backfill its existing contract record; that is distinct from import.
    await db.billingSubscriptionContract.deleteMany({where:{billingAccountId:account.id}});await unchanged();
    cases.push('invoice-import-follow-on-apply-does-not-certify-an-unapplied-overlapping-period-as-granted');



    const repeat=await finding(true);repeat.charge.amount_refunded=100;repeat.charge.disputed=true;const repeated=await run(repeat.id);
    assert.equal(repeated.state,'SUCCEEDED',JSON.stringify(repeated));const ledger=await db.billingInvoice.findUniqueOrThrow({where:{id:repeated.observed.invoiceId}});
    assert.equal(ledger.subscriptionId,null);assert.equal(ledger.sourceAttemptId,repeat.attempt.id);assert.equal(ledger.refundedSatang,100);assert.equal(ledger.disputed,true);
    assert.equal(ledger.periodEnd.getTime(),appendPackageInterval(new Date(repeat.snapshot.repeat.paidThrough),'year',repeat.snapshot.repeat.anchorDay).getTime());assert.equal(await db.billingIssue.count({where:{companyId,kind:'FINANCIAL_REVIEW',referenceId:ledger.id,state:'OPEN'}}),1);
    await unchanged();cases.push('invoice-import-original-repeat-verified-service-period-and-refund-dispute-remain-held-with-no-provider-mutation');

    for(const mutate of [(f:any)=>{f.invoice.customer='cus_other';},(f:any)=>{f.session.metadata.billingAttemptId='foreign';},(f:any)=>{f.line.pricing.price_details.price='price_other';},(f:any)=>{delete f.charge.amount_refunded;},(f:any)=>{f.invoice.amount_paid=0;}]){
      const f=await finding();mutate(f);const r=await run(f.id);assert.equal(r.state,'UNKNOWN');assert.equal((await view(f.id)).localInvoiceId,null);await cancel(r.id);
    }
    cases.push('invoice-import-foreign-customer-contract-price-and-incomplete-payment-chain-refused-with-reachable-original-review');

    const changed=await finding(),p=(await preview(changed.id)).body;await db.billingAccount.update({where:{id:account.id},data:{customerId:'cus_replaced'}});
    assert.equal((await submit(p)).status,409);assert.equal((await view(changed.id)).canImport,false);await cancel(p.id);await db.billingAccount.update({where:{id:account.id},data:{customerId}});
    const revoked=await finding();fault=async path=>{if(path===`/charges/${revoked.charge.id}`)await db.rolePermission.delete({where:{roleId_permissionId:{roleId:input.roleId,permissionId:permission.id}}});return undefined;};
    const revokedResult=await run(revoked.id);assert.equal(revokedResult.state,'BLOCKED');assert.equal((await view(revoked.id)).localInvoiceId,null);fault=undefined;

    assert.ok(input.second);const actor=await db.companyMembership.findUniqueOrThrow({where:{id:input.membershipId}}),replacementRole=await db.role.create({data:{key:`IMPORT_REPLACEMENT_${tag}`,name:'Synthetic replacement operator',scopeKey:'system',isSystem:true,
      permissions:{create:(await db.permission.findMany({where:{key:{in:['account.session.read','system.billing.read','system.billing.apply.retry']}}})).map(p=>({permissionId:p.id}))}}});
    const replacement=await db.companyMembership.create({data:{companyId:actor.companyId,userId:input.second.userId,roles:{create:{roleId:replacementRole.id}}}}),sid=randomUUID();
    await input.second.recordLegal(replacement.id);await db.authSession.create({data:{userId:input.second.userId,tokenId:sid,expiresAt:new Date(Date.now()+3600000)}});
    try{
      await db.billingOperatorScope.create({data:{userId:input.second.userId,companyId,stripeAccountId:input.stripeAccountId,livemode:false,createdByUserId:input.userId}});
      const headers={authorization:`Bearer ${input.second.signToken(sid)}`},readReplacement=await input.request(`${base}/operations/${revokedResult.id}`,'GET',undefined,headers);
      assert.equal(readReplacement.status,200);assert.deepEqual(readReplacement.body.allowedActions,['cancel']);
      assert.equal((await input.request(`${base}/operations/${revokedResult.id}/retry`,'POST',{expectedVersion:readReplacement.body.version},headers)).status,409);
      assert.equal((await input.request(`${base}/operations/${revokedResult.id}/cancel`,'POST',{expectedVersion:readReplacement.body.version},headers)).status,200);
    }finally{await db.billingOperatorScope.deleteMany({where:{userId:input.second.userId,companyId}});await db.companyMembership.delete({where:{id:replacement.id}});await db.rolePermission.deleteMany({where:{roleId:replacementRole.id}});await db.role.delete({where:{id:replacementRole.id}});}
    await db.rolePermission.create({data:{roleId:input.roleId,permissionId:permission.id}});

    cases.push('invoice-import-customer-change-before-submit-and-revoked-operator-during-payment-read-prevent-commit');

    const atomic=await finding(),fn=`import_audit_${tag}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.invoice.imported' AND NEW."companyId"='${companyId}' THEN RAISE EXCEPTION 'synthetic import audit failure'; END IF; RETURN NEW; END $$`);
    let atomicId='';try{await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);const r=await run(atomic.id);atomicId=r.id;assert.equal(r.state,'UNKNOWN');assert.equal((await view(atomic.id)).localInvoiceId,null);}
    finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);}
    const uncertain=await read(atomicId);assert.equal((await request(`${base}/operations/${atomicId}/retry`,'POST',{expectedVersion:uncertain.version})).status,200);await input.drainOperations!();assert.equal((await read(atomicId)).state,'SUCCEEDED');await unchanged();
    cases.push('invoice-import-real-postgresql-audit-failure-rolls-back-ledger-and-review-original-command-retry-once');


    for(const kind of ['operation','account','customer'] as const){
      const f=await finding();let operationId='';const p=(await preview(f.id)).body;operationId=p.id;assert.equal((await submit(p)).status,202);
      fault=async path=>{if(path===`/charges/${f.charge.id}`){
        if(kind==='operation')await db.billingOperation.update({where:{id:operationId},data:{leaseToken:randomUUID(),version:{increment:1}}});
        if(kind==='account')await db.billingAccount.update({where:{id:account.id},data:{leaseToken:randomUUID(),version:{increment:1}}});
        if(kind==='customer')await db.billingAccount.update({where:{id:account.id},data:{customerId:'cus_after_read'}});
      }return undefined;};
      await input.drainOperations!();assert.equal((await view(f.id)).localInvoiceId,null);fault=undefined;
      await db.billingAccount.update({where:{id:account.id},data:{customerId,leaseToken:null,leaseUntil:null}});
      if(kind==='operation')await db.billingOperation.update({where:{id:operationId},data:{state:'UNKNOWN',leaseToken:null,leaseUntil:null,version:{increment:1}}});
      await cancel(operationId);
    }
    const concurrent=await finding(),cp=(await preview(concurrent.id)).body;assert.equal((await submit(cp)).status,202);await Promise.all([input.drainOperations!(),input.drainOperations!()]);
    const cr=await read(cp.id);assert.equal(cr.state,'SUCCEEDED');const beforeCalls=calls.length;
    await db.billingOperation.update({where:{id:cp.id},data:{state:'UNKNOWN',version:{increment:1}}});const observed=await read(cp.id);
    assert.equal((await request(`${base}/operations/${cp.id}/retry`,'POST',{expectedVersion:observed.version})).status,200);await input.drainOperations!();assert.equal((await read(cp.id)).state,'SUCCEEDED');assert.equal(calls.length,beforeCalls);
    assert.equal(await db.billingInvoice.count({where:{billingAccountId:account.id,providerInvoiceId:concurrent.invoice.id}}),1);await unchanged();
    cases.push('invoice-import-account-operation-lease-and-customer-change-fences-concurrent-workers-and-verified-local-replay-with-no-provider-io');

    if(input.browser){
      const f=await finding(),{page,origin,evidenceDir}=input.browser;await new Promise(resolve=>setTimeout(resolve,(billingRateLimitWindowSeconds(60)+1)*1000));
      await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/system/billing/companies/${companyId}/invoice-findings/${f.id}`,{waitUntil:'domcontentloaded'});
      await page.getByText('บันทึกเหตุผล (ระบบใส่ให้แล้ว)',{exact:true}).click();
      try { await page.getByLabel('เหตุผลการตรวจสอบ',{exact:true}).waitFor(); }
      catch(error) {
        console.log(JSON.stringify({invoiceFinding:await view(f.id),path:new URL(page.url()).pathname,screen:(await page.locator('main').innerText().catch(()=>page.locator('body').innerText())).slice(0,5000)}));
        await page.screenshot({path:`${evidenceDir}/invoice-import-finding-failed.png`,fullPage:true});throw error;
      }
      await page.getByLabel('เหตุผลการตรวจสอบ',{exact:true}).fill('กู้ใบแจ้งหนี้จากผลตรวจเดิมผ่านเว็บ');const previewResponse=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/system/billing/operations/preview'));await page.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true}).click();const previewResult=await previewResponse;assert.equal(previewResult.status(),200,JSON.stringify(await previewResult.json()));try{await page.getByRole('status').filter({hasText:/^ตรวจข้อมูลก่อนยืนยัน$/}).waitFor();}catch(error){console.log(JSON.stringify({preview:await previewResult.json(),panel:await page.getByRole('region',{name:'คำสั่งตรวจสอบการชำระเงิน',exact:true}).innerText()}));await page.screenshot({path:`${evidenceDir}/invoice-import-preview-failed.png`,fullPage:true});throw error;}
      let lost=false,commandId='';await page.route('**/system/billing/operations',async route=>{if(route.request().method()!=='POST'||lost){await route.continue();return;}const res=await route.fetch();assert.equal(res.status(),202);commandId=(await res.json()).id;lost=true;await route.abort('failed');});
      await page.getByRole('button',{name:'ยืนยันแก้ไขรายการนี้',exact:true}).click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'ยืนยันแก้ไขรายการนี้',exact:true}).click();await expect(page.getByRole('status').filter({hasText:/^รอระบบตรวจสอบ$/})).toBeVisible();
      let unavailable=true;fault=async path=>unavailable&&path===`/invoices/${f.invoice.id}`?new Response('{}',{status:503}):undefined;
      await input.drainOperations!();await page.getByText('ประวัติและข้อมูลอ้างอิง',{exact:true}).click();await page.getByRole('link',{name:'เปิดรายละเอียดการดำเนินการนี้',exact:true}).click();await page.waitForURL(`**/operations/${commandId}`);await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('status').filter({hasText:/^ยังยืนยันผลไม่ได้$/}).waitFor();
      unavailable=false;const resumed=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/${commandId}/retry`));await page.getByRole('button',{name:'ลองดำเนินการอีกครั้ง',exact:true}).click();assert.equal((await resumed).status(),200);await input.drainOperations!();
      await page.getByRole('button',{name:'อัปเดตสถานะ',exact:true}).click();await page.getByRole('status').filter({hasText:/^ดำเนินการเสร็จแล้ว$/}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.addStyleTag({content:'nextjs-portal { display:none; }'});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidenceDir}/admin-invoice-import-mobile.png`,fullPage:true});
      await page.getByRole('link',{name:'ตรวจการเปิดแพ็กเกจจากใบที่บันทึก',exact:true}).click();await page.waitForURL('**/apply-invoices/*');await page.goBack({waitUntil:'domcontentloaded'});
      await page.getByRole('link',{name:'เปิดผลตรวจใบแจ้งหนี้เดิม',exact:true}).click();await page.waitForURL(`**/invoice-findings/${f.id}`);await page.getByRole('link',{name:'กลับงานตรวจต้นทาง',exact:true}).click();await page.waitForURL(`**/invoice-scans/${f.scanId}`);
      await page.getByRole('link',{name:'กลับไปบริษัทเดิม',exact:true}).click();await page.waitForURL(`**/companies/${companyId}`);fault=undefined;await unchanged();
      cases.push('browser-invoice-import-lost-submit-response-same-command-unknown-retry-reload-and-original-invoice-finding-scan-company-return');
    }
    return cases;
  }finally{
    input.transport();await db.billingOperatorScope.deleteMany({where:{companyId}});await db.auditLog.deleteMany({where:{companyId}});await db.billingIssue.deleteMany({where:{companyId}});
    await db.billingOperation.deleteMany({where:{companyId}});await db.billingSubscriptionContract.deleteMany({where:{billingAccountId:account.id}});await db.billingInvoice.deleteMany({where:{billingAccountId:account.id}});await db.billingAttempt.deleteMany({where:{billingAccountId:account.id}});
    await db.companyPlanTerm.deleteMany({where:{companyId}});await db.billingAccount.delete({where:{id:account.id}});await db.company.delete({where:{id:companyId}});
    await db.membershipRole.upsert({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminId}},update:{},create:{membershipId:input.membershipId,roleId:input.adminId}});
  }
}
