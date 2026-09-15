import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';

/** Actual HTTP/PG/browser; provider Checkout/collection behavior is simulated, no native charge. */
export async function checkBillingCheckoutExpiry(input:Parameters<typeof checkBillingConfigurationDrafts>[0]){
  const {prisma,companyId,stripeAccountId,browser}=input,db=prisma.client,base='/v1/system/billing',ids:string[]=[],attemptIds:string[]=[],cases:string[]=[];
  const original=await db.billingAccount.findFirstOrThrow({where:{companyId,stripeAccountId,livemode:false}}),customer=original.customerId??`cus_Expiry${randomUUID().replace(/-/g,'')}`;
  const previousFailure=await db.billingIssue.findFirst({where:{companyId,stripeAccountId,livemode:false,kind:'RECONCILIATION_FAILED',referenceId:original.id}});
  const settings=await db.billingSettings.findFirstOrThrow({where:{stripeAccountId,livemode:false}});
  const baseline=async()=>({invoices:(await db.billingInvoice.findMany({where:{billingAccountId:original.id},orderBy:{id:'asc'}})).map(({updatedAt,financialObservedAt,...financial})=>financial),grants:await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}}),term:await db.companyPlanTerm.findUnique({where:{companyId}})}),before=await baseline();
  const sessions=new Map<string,any>(),subscriptions=new Map<string,any>(),posts:{id:string;key:string}[]=[];
  let onRead:((session:any)=>Promise<void>)|undefined,onPost:((session:any)=>Promise<void>)|undefined,unavailable=false,lose=false,complete=false,unpauseUnavailable=false;
  const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  input.transport(async(url,init)=>{
    const path=url.pathname.replace('/v1',''),method=init?.method??'GET',id=/^\/checkout\/sessions\/([^/]+)/.exec(path)?.[1],session=id?sessions.get(id):null;
    if(session){
      if(method==='GET'){await onRead?.(session);if(unavailable)throw Error('Synthetic read unavailable');return response(session);}
      assert.equal(path,`/checkout/sessions/${id}/expire`);assert.equal(method,'POST');const key=new Headers(init?.headers).get('idempotency-key')!;
      assert.ok(key.startsWith('billing-checkout-expiry-'));posts.push({id:id!,key});await onPost?.(session);
      if(complete){complete=false;session.status='complete';session.payment_status='paid';}
      else if(session.status==='open')session.status='expired';else return response({error:{type:'invalid_request_error',code:'checkout_session_not_open'}},400);
      if(lose){lose=false;throw Error('Synthetic lost expiry response after native commit');}return response(session);
    }
    const sub=subscriptions.get(path.slice('/subscriptions/'.length));
    if(path.startsWith('/subscriptions/')&&sub){if(method==='POST'){if(unpauseUnavailable)throw Error('Synthetic collection recovery unavailable');assert.equal(new URLSearchParams(String(init?.body)).get('pause_collection'),'');sub.pause_collection=null;}return response(sub);}
    if(path==='/invoices'&&subscriptions.has(url.searchParams.get('subscription')??''))return response({object:'list',data:[],has_more:false});
    return undefined;
  });
  const request:typeof input.request=async(...args)=>{for(let i=0;i<3;i++){const r=await input.request(...args);if(r.status!==429)return r;assert.ok(Number.isInteger(r.body.retryAfterSeconds)&&r.body.retryAfterSeconds>=1&&r.body.retryAfterSeconds<=60);await new Promise(resolve=>setTimeout(resolve,(r.body.retryAfterSeconds+1)*1000));}throw Error('Operator limit did not recover');};
  const make=async(kind:'initial'|'restart'|'repeat'|'upgrade'='initial',channel='web')=>{
    const id=randomUUID(),quoteId=randomUUID(),sid=`cs_Expiry${id.replace(/-/g,'')}`,subId=`sub_Expiry${id.replace(/-/g,'')}`;
    const repeat=['repeat','upgrade'].includes(kind),snapshot={quote:{quoteId,companyId,policyRevision:settings.policyRevisionId,consentRevision:'synthetic',totalSatang:999000,offer:{interval:'year',priceSatang:999000}},
      ...(repeat?{repeat:{subscriptionId:subId}}:{}),...(kind==='upgrade'?{upgrade:{amountSatang:999000}}:{}),...(kind==='restart'?{restart:{subscriptionId:original.baseSubscriptionId??'sub_Old'}}:{})};
    const row=await db.billingAttempt.create({data:{id,billingAccountId:original.id,initiatingUserId:input.userIds[0]!,quoteId,channel,idempotencyKey:randomUUID(),requestHash:'synthetic-expiry',quoteSnapshot:snapshot,
      policyRevisionId:settings.policyRevisionId!,consentRevision:'synthetic',consentAt:new Date(),status:'OPEN',checkoutSessionId:sid,...repeat?{collectionJson:{commands:{},beforeInvoiceIds:[],heldAt:Math.floor(Date.now()/1000)-30}}:{}}});attemptIds.push(id);
    const session={id:sid,object:'checkout.session',livemode:false,customer,mode:repeat?'payment':'subscription',status:'open',payment_status:'unpaid',subscription:null,client_reference_id:id,
      metadata:{billingAccountId:original.id,billingAttemptId:id},currency:'thb',amount_total:999000,created:Math.floor(Date.now()/1000)-30,expires_at:Math.floor(Date.now()/1000)+1800,url:'https://checkout.stripe.com/c/pay/synthetic'};sessions.set(sid,session);
    if(repeat)subscriptions.set(subId,{id:subId,object:'subscription',livemode:false,customer,status:'active',metadata:{billingAccountId:original.id,mangmeeCollectionAttempt:id},billing_mode:{type:'classic'},collection_method:'charge_automatically',items:{data:[{quantity:1}],has_more:false},pause_collection:{behavior:'keep_as_draft'}});
    await db.billingAccount.update({where:{id:original.id},data:{customerId:customer,activeAttemptId:id,baseSubscriptionId:repeat?subId:original.baseSubscriptionId,activeCollectionOperationId:null,leaseToken:null,leaseUntil:null}});
    return {row,session,sub:subscriptions.get(subId),path:`${base}/companies/${companyId}/checkouts/${id}`};
  };
  const preview=async(item:Awaited<ReturnType<typeof make>>)=>{const reviewed=await request(item.path);assert.equal(reviewed.status,200,JSON.stringify(reviewed));assert.equal(reviewed.body.canExpire,true);
    const r=await request(`${item.path}/preview`,'POST',{reason:'ยุติหน้าชำระจำลอง',sourceHash:reviewed.body.sourceHash});assert.equal(r.status,200,JSON.stringify(r));ids.push(r.body.id);return r.body;};
  const get=async(id:string)=>{const r=await request(`${base}/checkout-expiry/${id}`);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const command=async(op:any,action='submit',actor=request)=>{const r=await actor(`${base}/checkout-expiry/${op.id}/${action}`,'POST',{expectedVersion:op.version,...action==='run'?{}:{previewHash:op.previewHash}},action==='submit'?{'idempotency-key':`expiry-submit-${op.id}`}:{ });assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const viewport=browser?.page.viewportSize();
  try{
    let item=await make(),op=await preview(item);const initialCount=posts.length;
    const bad=await request(`${item.path}/preview`,'POST',{reason:'bad',sourceHash:'abc',sessionId:item.session.id});assert.equal(bad.status,400);
    assert.equal((await request(`${base}/companies/${companyId}/checkouts?cursor=${randomUUID()}`)).status,404);
    assert.equal((await request(`${base}/companies/${randomUUID()}/checkouts/${item.row.id}`)).status,404);
    const queued=await command(op);assert.equal((await command(op)).id,op.id);assert.equal(queued.state,'QUEUED');
    const conflict=await preview(item);assert.equal((await request(`${base}/checkout-expiry/${conflict.id}/submit`,'POST',{expectedVersion:conflict.version,previewHash:conflict.previewHash},{'idempotency-key':`different-key-${conflict.id}`})).status,409);await command(conflict,'cancel');
    const result=await command(queued,'run');assert.equal(result.state,'SUCCEEDED');assert.equal(result.providerState,'expired');assert.equal(result.reconciliationPending,false);assert.equal(posts.length,initialCount+1);
    assert.equal((await db.billingAttempt.findUniqueOrThrow({where:{id:item.row.id}})).status,'EXPIRED');
    const owner=await request(`/v1/companies/${companyId}/billing/attempts/${item.row.id}`);assert.equal(owner.status,200);assert.equal(owner.body.state,'EXPIRED');const resume=await request(`/v1/companies/${companyId}/billing/attempts/${item.row.id}/resume`,'POST',{});assert.equal(resume.status,200);assert.equal(resume.body.checkoutUrl,null);assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:original.id}})).activeAttemptId,null);
    assert.ok(!JSON.stringify([result,(await request(item.path)).body]).includes(customer));assert.ok(!JSON.stringify(result).includes(item.session.id));
    cases.push('checkout-expiry-original-preview-submit-dedupe-conflict-strict-input-current-company-redaction-and-reconciled-expiry');

    for(const kind of ['restart','repeat','upgrade'] as const){item=await make(kind,kind==='repeat'?'web':'line');op=await command(await preview(item));const r=await command(op,'run');assert.equal(r.providerState,'expired');assert.equal(r.reconciliationPending,false,JSON.stringify(r));if(item.sub)assert.equal(item.sub.pause_collection,null);}
    cases.push('checkout-expiry-web-line-restart-repeat-upgrade-native-expiry-restores-original-collection-without-paid-grant');

    item=await make();op=await command(await preview(item));complete=true;const paid=await command(op,'run');assert.equal(paid.providerState,'complete');assert.equal(paid.paymentState,'paid');assert.equal(paid.reconciliationPending,true);assert.equal(paid.state,'SUCCEEDED');
    // Missing original paid invoice must remain pending; completing a Checkout alone never grants.
    assert.deepEqual(await baseline(),before);
    cases.push('checkout-expiry-concurrent-completion-is-paid-observation-not-cancellation-and-missing-invoice-keeps-repair-binding');

    item=await make();op=await command(await preview(item));lose=true;const recovered=await command(op,'run');assert.equal(recovered.providerState,'expired');assert.equal(posts.filter(p=>p.id===item.session.id).length,1);
    item=await make();op=await command(await preview(item));onPost=async()=>{unavailable=true;};let unknown=await command(op,'run');assert.equal(unknown.state,'UNKNOWN');onPost=undefined;unavailable=false;
    await db.billingOperation.update({where:{id:op.id},data:{expiresAt:new Date(Date.now()-1000),resultJson:{dispatchedAt:new Date(Date.now()-25*3600000).toISOString(),providerKey:`billing-checkout-expiry-${op.id}`}}});
    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});
    try{const current=await input.approveRequest(`${base}/checkout-expiry/${op.id}`);assert.equal(current.status,200);const done=await command(current.body,'run',input.approveRequest);assert.equal(done.providerState,'expired');}finally{await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminRoleId}});}
    assert.equal(posts.filter(p=>p.id===item.session.id).length,1);
    cases.push('checkout-expiry-lost-native-response-and-aged-positive-original-discovery-after-requester-revocation-never-repost');

    item=await make();op=await command(await preview(item));await db.billingOperation.update({where:{id:op.id},data:{state:'UNKNOWN',resultJson:{dispatchedAt:new Date(Date.now()-25*3600000).toISOString(),providerKey:`billing-checkout-expiry-${op.id}`}}});
    const aged=await command(await get(op.id),'run');assert.equal(aged.state,'UNKNOWN');assert.equal(posts.filter(p=>p.id===item.session.id).length,0);assert.ok(aged.reviewCaseId);
    item.session.status='expired';assert.equal((await command(await get(op.id),'run')).providerState,'expired');
    cases.push('checkout-expiry-aged-unknown-open-session-keeps-case-without-post-and-later-original-expiry-recovers');

    item=await make();op=await command(await preview(item));await db.billingOperation.update({where:{id:op.id},data:{expiresAt:new Date(Date.now()-1000)}});
    const expired=await command(await get(op.id),'run');assert.equal(expired.state,'BLOCKED');assert.equal(posts.filter(p=>p.id===item.session.id).length,0);await command(expired,'cancel');
    item=await make();op=await command(await preview(item));onRead=async()=>{onRead=undefined;await db.billingAccount.update({where:{id:original.id},data:{activeAttemptId:null}});};
    const changed=await command(op,'run');assert.equal(changed.state,'BLOCKED');assert.equal(posts.filter(p=>p.id===item.session.id).length,0);await command(changed,'cancel');
    cases.push('checkout-expiry-expired-review-and-changed-source-block-new-post-and-preserve-cancel-new-review-path');

    item=await make();op=await command(await preview(item));onRead=async()=>{onRead=undefined;await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});};
    try{await input.drainOperations();const current=await input.approveRequest(`${base}/checkout-expiry/${op.id}`);assert.equal(current.body.state,'BLOCKED');assert.equal(posts.filter(p=>p.id===item.session.id).length,0);await command(current.body,'cancel',input.approveRequest);}
    finally{await db.membershipRole.upsert({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}},create:{membershipId:input.membershipId,roleId:input.adminRoleId},update:{}});}
    cases.push('checkout-expiry-existing-worker-rechecks-withdrawn-initiator-before-native-command');

    item=await make();op=await command(await preview(item));const replacement=randomUUID();onPost=async()=>{onPost=undefined;await db.billingAccount.update({where:{id:original.id},data:{leaseToken:replacement,leaseUntil:new Date(Date.now()+60000)}});await db.billingOperation.update({where:{id:op.id},data:{leaseToken:replacement,leaseUntil:new Date(Date.now()+60000),version:{increment:1}}});};
    assert.equal((await request(`${base}/checkout-expiry/${op.id}/run`,'POST',{expectedVersion:op.version})).status,409);
    assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:original.id}})).leaseToken,replacement);assert.notEqual((await get(op.id)).state,'SUCCEEDED');
    await db.billingAccount.update({where:{id:original.id},data:{leaseUntil:new Date(0)}});await db.billingOperation.update({where:{id:op.id},data:{leaseUntil:new Date(0)}});assert.equal((await command(await get(op.id),'run')).providerState,'expired');
    assert.equal(posts.filter(p=>p.id===item.session.id).length,1);
    cases.push('checkout-expiry-replacement-lease-survives-stale-worker-and-original-recovery-publishes-once');

    item=await make();op=await command(await preview(item));const trigger=`expiry_audit_${randomUUID().replace(/-/g,'')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.checkout_expiry.observed' AND NEW."targetId"='${op.id}' THEN RAISE EXCEPTION 'synthetic expiry audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
    try{const r=await command(op,'run');assert.equal(r.state,'UNKNOWN');assert.equal(r.providerState,null);}finally{await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);}
    assert.equal((await command(await get(op.id),'run')).providerState,'expired');assert.equal(posts.filter(p=>p.id===item.session.id).length,1);
    cases.push('checkout-expiry-real-postgres-audit-rollback-retains-unknown-and-original-retry-observes-without-second-post');

    item=await make('repeat','line');op=await command(await preview(item));unpauseUnavailable=true;const pending=await command(op,'run');unpauseUnavailable=false;assert.equal(pending.providerState,'expired');assert.equal(pending.reconciliationPending,true);assert.ok(item.sub.pause_collection);
    await db.billingAccount.update({where:{id:original.id},data:{nextReconcileAt:new Date(0)}});await input.scanAccounts();assert.equal((await get(op.id)).reconciliationPending,false);assert.equal(item.sub.pause_collection,null);
    cases.push('checkout-expiry-native-closure-and-local-collection-recovery-distinct-with-existing-worker-return');

    if(browser){const page=browser.page;await page.setViewportSize({width:390,height:844});item=await make('repeat','line');
      const press=async(name:string,route:string)=>{for(let i=0;i<3;i++){const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes(route));await page.getByRole('button',{name,exact:true}).click();const res=await waiting,value=await res.json();if(res.status()===429){assert.ok(value.retryAfterSeconds<=60);await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();await new Promise(r=>setTimeout(r,(value.retryAfterSeconds+1)*1000));continue;}assert.equal(res.status(),200,JSON.stringify(value));return value;}throw Error('Browser rate limit did not recover');};
      await page.goto(`${browser.origin}/system/billing/companies/${companyId}/checkouts/${item.row.id}`,{waitUntil:'domcontentloaded'});await page.getByLabel('เหตุผลที่ต้องยุติหน้าชำระ').fill('ตรวจยุติรายการจากมือถือ');
      op=await press('ตรวจผลกระทบก่อนยืนยัน','/preview');ids.push(op.id);await page.waitForURL(new RegExp(op.id));await page.reload();await page.getByRole('heading',{name:'ตรวจผลกระทบก่อนยืนยัน',exact:true}).waitFor();
      await press('ยืนยันยุติหน้าชำระ','/submit');await page.getByRole('heading',{name:'รับคำขอแล้ว รอดำเนินการ',exact:true}).waitFor();unpauseUnavailable=true;
      await press('ตรวจและดำเนินการคำขอเดิม','/run');unpauseUnavailable=false;await page.getByRole('status').filter({hasText:'ยังตรวจสถานะในระบบไม่ครบ'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${browser.evidenceDir}/admin-checkout-expiry-pending-mobile.png`,fullPage:true});
      await db.billingAccount.update({where:{id:original.id},data:{nextReconcileAt:new Date(0)}});await input.scanAccounts();await page.getByRole('button',{name:'โหลดรายการล่าสุด',exact:true}).click();await page.getByRole('status').filter({hasText:'ระบบตรวจสถานะรายการเดิมแล้ว'}).waitFor();
      await page.getByRole('link',{name:'เปิดหน้าชำระเดิมและประวัติคำขอ',exact:true}).click();await page.waitForURL(new RegExp(item.row.id));await page.getByRole('link',{name:/ตรวจผลจาก Stripe แล้ว/}).click();await page.waitForURL(new RegExp(op.id));
      await page.getByRole('link',{name:'กลับไปบริษัท',exact:true}).click();await page.waitForURL(new RegExp(`/companies/${companyId}$`));
      cases.push('browser-checkout-expiry-mobile-preview-reload-submit-native-result-pending-local-worker-recovery-history-original-company-return');
      item=await make();await page.goto(`${browser.origin}/system/billing/companies/${companyId}/checkouts/${item.row.id}`,{waitUntil:'domcontentloaded'});await page.getByLabel('เหตุผลที่ต้องยุติหน้าชำระ').fill('เก็บคำขอเมื่อออกจากหน้าจอ');
      let release!:()=>void;const held=new Promise<void>(r=>release=r),route='**/api/v1/system/billing/companies/*/checkouts/*/preview';let received!:(v:any)=>void;
      await page.route(route,async r=>{const res=await r.fetch();const value=await res.json();received({status:res.status(),value});if(res.status()!==200){await r.fulfill({response:res});return;}ids.push(value.id);await held;await r.fulfill({response:res});});
      try{for(let i=0;i<3;i++){const arrived=new Promise<any>(r=>received=r);await page.getByRole('button',{name:'ตรวจผลกระทบก่อนยืนยัน',exact:true}).click();const res=await arrived;if(res.status===200)break;assert.equal(res.status,429);assert.ok(res.value.retryAfterSeconds<=60);await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();await new Promise(r=>setTimeout(r,(res.value.retryAfterSeconds+1)*1000));if(i===2)throw Error('Preview rate limit did not recover');}await page.getByRole('link',{name:'กลับไปบริษัท',exact:true}).click();await page.waitForURL(new RegExp(`/companies/${companyId}$`));release();await page.getByRole('heading',{name:'การชำระเงินของบริษัท',exact:true}).waitFor();assert.ok(page.url().endsWith(`/companies/${companyId}`));}
      finally{release();await page.unroute(route);}
      await page.goto(`${browser.origin}/system/billing/companies/${companyId}/checkouts/${item.row.id}`,{waitUntil:'domcontentloaded'});await page.getByRole('link',{name:/ตรวจผลกระทบก่อนยืนยัน/}).click();await page.getByRole('heading',{name:'ตรวจผลกระทบก่อนยืนยัน',exact:true}).waitFor();await press('ยกเลิกคำขอที่ยังไม่ส่ง','/cancel');await page.getByRole('heading',{name:'ยกเลิกคำขอแล้ว',exact:true}).waitFor();
      await page.screenshot({path:`${browser.evidenceDir}/admin-checkout-expiry-cancel-mobile.png`,fullPage:true});
      cases.push('browser-checkout-expiry-late-preview-after-leave-keeps-location-and-original-history-cancels-undispatched-request');
    }
    assert.deepEqual(await baseline(),before);cases.push('checkout-expiry-never-rewrites-paid-invoices-days-receipt-quota-or-capacity');return cases;
  }catch(error){if(browser)console.error('Checkout expiry browser',browser.page.url(),await browser.page.locator('body').innerText());throw error;}
  finally{
    onRead=undefined;onPost=undefined;unavailable=false;input.transport();if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await db.billingAccount.update({where:{id:original.id},data:{customerId:original.customerId,activeAttemptId:original.activeAttemptId,baseSubscriptionId:original.baseSubscriptionId,activeCollectionOperationId:original.activeCollectionOperationId,leaseToken:null,leaseUntil:null}});
    if(!previousFailure)await db.billingIssue.deleteMany({where:{companyId,stripeAccountId,livemode:false,kind:'RECONCILIATION_FAILED',referenceId:original.id}});
    await db.auditLog.deleteMany({where:{OR:[{targetId:{in:ids}},{targetId:{in:attemptIds}}]}});await db.billingIssue.deleteMany({where:{companyId,referenceId:{in:[...ids,...attemptIds]}}});await db.billingOperation.deleteMany({where:{id:{in:ids}}});await db.billingAttempt.deleteMany({where:{id:{in:attemptIds}}});
  }
}
