import { billingRateLimitWindowSeconds } from '../modules/billing/billing-rate-limit-window';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {STRIPE_API_VERSION} from '@watchdog-bms/contracts';
import type {ProviderScansSmokeInput} from './billing-provider-scans-smoke';

export async function checkBillingInvoiceScans(input:ProviderScansSmokeInput&{roleId:string;adminId:string}) {
  const db=input.prisma.client,tag=randomUUID().replaceAll('-',''),companyId=`invoice-history-${tag}`,customerId=`cus_history${tag}`,prefix=`in_history${tag}`;
  const base=`/v1/system/billing/companies/${companyId}/invoice-scans`,cases:string[]=[];
  const browserResponses:{path:string;status:number}[]=[];
  const request:typeof input.request=async(...args)=>{
    for(let tries=0;;tries++){const result=await input.request(...args);if(result.status!==429||tries>=2)return result;
      assert.ok(result.body.retryAfterSeconds<=60);await new Promise(resolve=>setTimeout(resolve,Math.min(60,result.body.retryAfterSeconds+1)*1000));}
  };
  await db.company.create({data:{id:companyId,name:'Synthetic invoice history'}});
  const term=await db.companyPlanTerm.create({data:{companyId,tierKey:'FREE_TRIAL_15',branchLimit:1,employeeLimit:2,monthlySlipLimit:15,termStartAt:new Date(Date.now()-40*86400000),termEndsAt:new Date(Date.now()-10*86400000)}});
  const account=await db.billingAccount.create({data:{companyId,stripeAccountId:input.stripeAccountId,livemode:false,customerId}});
  const sourceWindow={windowStart:new Date(Date.now()-400*86400000).toISOString(),windowEnd:new Date(Date.now()-120000).toISOString(),reason:'ตรวจใบแจ้งหนี้ย้อนหลังจำลอง'};
  const invoice=(suffix:string,extra:Record<string,unknown>={})=>({id:`${prefix}${suffix}`,object:'invoice',created:Math.floor(Date.now()/1000)-90*86400,customer:customerId,livemode:false,
    status:'paid',currency:'thb',total:99900,amount_paid:99900,customer_email:'private-invoice@example.test',hosted_invoice_url:'https://invoice.stripe.com/private-do-not-store',...extra});
  const local=async(suffix:string,extra:Record<string,unknown>={})=>db.billingInvoice.create({data:{billingAccountId:account.id,providerInvoiceId:`${prefix}${suffix}`,offerSnapshot:{offerKey:'PRO_999'},
    policyRevisionId:'synthetic-history-policy',currency:'THB',totalSatang:99900,paidSatang:99900,periodStart:new Date(Date.now()-90*86400000),periodEnd:new Date(Date.now()-60*86400000),
    providerStatus:'paid',evidenceHash:tag,applyStatus:'HELD',...extra}});
  const mapped=await local('A'),different=await local('B',{providerStatus:'open',paidSatang:0});
  const ledger=()=>db.billingInvoice.findMany({where:{billingAccountId:account.id},orderBy:{id:'asc'}});let expectedLedger=await ledger();
  const create=(extra:Record<string,unknown>={},key=randomUUID())=>request(base,'POST',{...sourceWindow,...extra},{'idempotency-key':key});
  const read=async(id:string)=>{const r=await request(`${base}/${id}`);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const findings=(id:string,cursor?:string)=>request(`${base}/${id}/findings${cursor?`?cursor=${cursor}`:''}`);
  const cancel=async(id:string)=>{const row=await read(id);if(row.canCancel)assert.equal((await request(`${base}/${id}/cancel`,'POST',{expectedVersion:row.version})).status,200);};
  const due=async(id:string)=>{const row=await db.billingOperation.findUniqueOrThrow({where:{id}});await db.billingOperation.update({where:{id},data:{resultJson:{...(row.resultJson as object),retryAt:new Date(0).toISOString()}}});};
  let calls:string[]=[],reply:(url:URL)=>Promise<Response>|Response=()=>new Response(JSON.stringify({object:'list',data:[],has_more:false}));
  input.transport((url,init)=>{
    if(url.origin!=='https://api.stripe.com')return;
    if(url.pathname==='/v1/events')return new Response(JSON.stringify({object:'list',data:[],has_more:false}));
    if(url.pathname!=='/v1/invoices')return;
    assert.equal(init?.method,'GET');assert.equal(new Headers(init?.headers).get('stripe-version'),STRIPE_API_VERSION);
    assert.equal(url.searchParams.get('customer'),customerId);assert.equal(url.searchParams.get('limit'),'100');calls.push(url.searchParams.get('starting_after')??'FIRST');return reply(url);
  });
  try{
    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminId}}});
    assert.equal((await request(base)).status,404);
    await db.billingOperatorScope.create({data:{userId:input.userId,companyId,stripeAccountId:input.stripeAccountId,livemode:false,createdByUserId:input.userId}});
    assert.equal((await request(base)).status,200);assert.equal(await db.companyMembership.count({where:{companyId,userId:input.userId}}),0);
    assert.equal((await request('/v1/system/billing/provider-scans')).status,404);
    for(const extra of [{customerId:'cus_foreign'},{windowStart:'1969-01-01T00:00:00Z'},{windowEnd:new Date().toISOString()}])assert.equal((await create(extra)).status,400);
    const runPermission=await db.permission.findUniqueOrThrow({where:{key:'system.billing.reconcile.run'}});
    await db.rolePermission.delete({where:{roleId_permissionId:{roleId:input.roleId,permissionId:runPermission.id}}});
    assert.equal((await request(base)).body.canCreate,false);assert.equal((await create()).status,403);await db.rolePermission.create({data:{roleId:input.roleId,permissionId:runPermission.id}});
    const key=randomUUID(),first=await create({},key);assert.equal(first.status,201);assert.equal(first.body.kind,'INVOICES');assert.equal((await create({},key)).body.id,first.body.id);
    assert.equal((await create({reason:'different'},key)).status,409);assert.equal(calls.length,0);
    cases.push('invoice-discovery-scoped-nonmember-expired-company-read-only-capability-strict-window-no-provider-id-and-idempotency');

    let transient=true;const many=[invoice('A'),invoice('B'),...Array.from({length:24},(_,i)=>invoice(`C${i}`))];
    reply=async url=>{
      if(!url.searchParams.has('starting_after'))return new Response(JSON.stringify({object:'list',data:many,has_more:true}));
      assert.equal(url.searchParams.get('starting_after'),`${prefix}C23`);
      if(transient){transient=false;return new Response('{}',{status:429,headers:{'retry-after':'600'}});}
      await local('LATE');expectedLedger=await ledger();return new Response(JSON.stringify({object:'list',data:[invoice('LATE')],has_more:false}));
    };
    assert.equal((await input.drain()).status,200);let view=await read(first.body.id);assert.equal(view.pages,1);assert.deepEqual(view.invoiceFindings,{matched:1,missing:24,different:1});
    await input.drain();view=await read(first.body.id);assert.equal(view.pages,1);assert.ok(Date.parse(view.retryAt)>Date.now()+590000);
    const callsBefore=calls.length;await input.drain();assert.equal(calls.length,callsBefore);await due(first.body.id);
    await Promise.all([input.drain(),input.drain()]);view=await read(first.body.id);assert.equal(view.state,'SUCCEEDED');assert.equal(view.pages,2);assert.equal(view.seen,27);
    assert.deepEqual(view.invoiceFindings,{matched:2,missing:24,different:1});assert.equal(calls.length,callsBefore+1);
    const review=await db.billingIssue.findFirstOrThrow({where:{companyId,kind:'PROVIDER_INVOICE_REVIEW',referenceId:account.id}});assert.equal(review.state,'OPEN');
    const a=(await findings(first.body.id)).body,b=(await findings(first.body.id,a.nextCursor)).body;assert.equal(a.items.length,25);assert.equal(b.items.length,2);assert.equal(b.nextCursor,null);
    assert.equal(new Set([...a.items,...b.items].map(r=>r.id)).size,27);assert.doesNotMatch(JSON.stringify([view,a,b]),/cus_history|in_history|private-invoice|invoice.stripe.com|totalSatang|paidSatang/);
    const saved=await db.billingOperation.findMany({where:{companyId,type:'OBSERVE_PROVIDER_INVOICE'}});assert.equal(saved.length,27);assert.doesNotMatch(JSON.stringify(saved),/private-invoice|private-do-not-store/);
    assert.deepEqual(await ledger(),expectedLedger);assert.equal(await db.billingReceiptGrant.count({where:{companyId}}),0);
    cases.push('invoice-discovery-old-dates-two-pages-durable-429-backoff-concurrent-local-mapping-one-review-case-and-no-grants');
    cases.push('invoice-discovery-25-plus-one-findings-timestamp-ties-private-provider-fields-redacted-and-minimum-storage');

    const second=(await create()).body;assert.equal((await findings(second.id,a.items[0].id)).status,404);
    await db.billingOperation.update({where:{id:first.body.id},data:{livemode:true}});assert.equal((await request(`${base}/${first.body.id}`)).status,404);assert.equal((await findings(first.body.id)).status,404);
    await db.billingOperation.update({where:{id:first.body.id},data:{livemode:false}});
    assert.equal((await request(`/v1/system/billing/companies/${(await db.companyMembership.findUniqueOrThrow({where:{id:input.membershipId}})).companyId}/invoice-scans/${first.body.id}`)).status,404);
    reply=async()=>{await cancel(second.id);return new Response(JSON.stringify({object:'list',data:[invoice('CANCELLED')],has_more:false}));};
    await input.drain();assert.equal((await read(second.id)).state,'CANCELLED');assert.equal((await findings(second.id)).body.items.length,0);
    const lost=(await create()).body;reply=async()=>{await db.billingOperation.update({where:{id:lost.id},data:{leaseToken:randomUUID(),version:{increment:1}}});return new Response(JSON.stringify({object:'list',data:[invoice('LEASELOST')],has_more:false}));};
    await input.drain();assert.equal((await findings(lost.id)).body.items.length,0);await cancel(lost.id);
    cases.push('invoice-discovery-company-mode-cursor-boundaries-and-cancel-or-lost-lease-prevent-page-commit');

    const changed=(await create()).body;await db.billingAccount.update({where:{id:account.id},data:{customerId:`cus_changed${tag}`}});
    const beforeChanged=calls.length;await input.drain();assert.equal(calls.length,beforeChanged);view=await read(changed.id);assert.equal(view.state,'BLOCKED');assert.equal(view.errorCode,'CONTROL_SOURCE_CHANGED');assert.equal(view.canResume,false);
    await cancel(changed.id);await db.billingAccount.update({where:{id:account.id},data:{customerId}});
    const changedDuring=(await create()).body;reply=async()=>{await db.billingAccount.update({where:{id:account.id},data:{customerId:`cus_changed${tag}`}});return new Response(JSON.stringify({object:'list',data:[invoice('MOVED')],has_more:false}));};
    await input.drain();assert.equal((await read(changedDuring.id)).state,'BLOCKED');assert.equal((await findings(changedDuring.id)).body.items.length,0);await cancel(changedDuring.id);
    await db.billingAccount.update({where:{id:account.id},data:{customerId}});
    const revoked=(await create()).body;reply=async()=>{await db.rolePermission.delete({where:{roleId_permissionId:{roleId:input.roleId,permissionId:runPermission.id}}});return new Response(JSON.stringify({object:'list',data:[invoice('REVOKED')],has_more:false}));};
    await input.drain();assert.equal((await read(revoked.id)).state,'BLOCKED');assert.equal((await findings(revoked.id)).body.items.length,0);
    await db.rolePermission.create({data:{roleId:input.roleId,permissionId:runPermission.id}});await cancel(revoked.id);
    cases.push('invoice-discovery-current-customer-before-read-and-commit-and-revoked-actor-fence-original-run');
    for(const bad of [[invoice('FOREIGN',{customer:'cus_foreign'})],[invoice('MODE',{livemode:true})],[invoice('DUP'),invoice('DUP')],[invoice('TOTAL',{total:'99900'})]]){
      const row=(await create()).body;reply=()=>new Response(JSON.stringify({object:'list',data:bad,has_more:false}));await input.drain();assert.equal((await read(row.id)).state,'BLOCKED');assert.equal((await findings(row.id)).body.items.length,0);await cancel(row.id);
    }
    // Both discovery types share admission.
    const sample=await db.billingOperation.findUniqueOrThrow({where:{id:first.body.id}}),events=Array.from({length:5},()=>randomUUID());
    await db.billingOperation.createMany({data:events.map(id=>({...sample,id,companyId:null,type:'SCAN_PROVIDER_EVENTS',state:'QUEUED',idempotencyKey:null,
      proposedJson:sample.proposedJson!,resultJson:sample.resultJson!,createdAt:new Date(Date.now()-500000),updatedAt:new Date(Date.now()-500000)}))});
    assert.equal((await create()).status,409);await db.billingOperation.updateMany({where:{id:{in:events}},data:{state:'CANCELLED'}});
    cases.push('invoice-discovery-invalid-provider-pages-fail-closed-and-shared-event-invoice-five-job-admission');

    const future=(await create()).body,futureRow=await db.billingOperation.findUniqueOrThrow({where:{id:future.id}});
    await db.billingOperation.update({where:{id:future.id},data:{proposedJson:{...(futureRow.proposedJson as object),until:Math.floor(Date.now()/1000)+3600}}});
    const beforeFuture=calls.length;await input.drain();assert.equal(calls.length,beforeFuture);assert.equal((await read(future.id)).canResume,false);await cancel(future.id);
    const atomic=(await create()).body,fn=`invoice_audit_${tag}`;reply=()=>new Response(JSON.stringify({object:'list',data:[invoice('ATOMIC')],has_more:false}));
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.discovery.invoice_completed' AND NEW."targetId"='${atomic.id}' THEN RAISE EXCEPTION 'synthetic invoice audit failure'; END IF; RETURN NEW; END $$`);
    try{
      await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      await input.drain();assert.equal((await read(atomic.id)).pages,0);assert.equal((await findings(atomic.id)).body.items.length,0);
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);}
    await due(atomic.id);await input.drain();assert.equal((await read(atomic.id)).state,'SUCCEEDED');assert.equal((await findings(atomic.id)).body.items.length,1);
    assert.equal(await db.auditLog.count({where:{targetId:atomic.id,action:'billing.discovery.invoice_completed'}}),1);
    cases.push('invoice-discovery-invalid-stored-window-refused-and-real-postgresql-audit-failure-rolls-back-findings-and-checkpoint');

    if(input.browser){
      await new Promise(resolve=>setTimeout(resolve,(billingRateLimitWindowSeconds(60)+1)*1000));
      const {page,origin,evidenceDir}=input.browser;await page.setViewportSize({width:390,height:844});
      page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.includes('/system/billing'))browserResponses.push({path,status:response.status()});});
      const detail=await request(`/v1/system/billing/companies/${companyId}`);assert.equal(detail.status,200,JSON.stringify({status:detail.status,code:detail.body?.code}));assert.equal(detail.body.accountId,account.id);
      const [navigation,companyResponse]=await Promise.all([
        page.goto(`${origin}/system/billing/companies/${companyId}`,{waitUntil:'domcontentloaded'}),
        page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/system/billing/companies/${companyId}`&&response.request().method()==='GET'),
      ]);
      assert.ok(navigation?.ok(),'Admin company document must load successfully');assert.equal(companyResponse.status(),200);
      assert.equal((await companyResponse.json()).accountId,account.id);
      await page.getByRole('region',{name:'ข้อมูลการชำระเงินบริษัท',exact:true}).waitFor();
      await page.getByRole('link',{name:'ปรับแพ็กเกจและตรวจสอบ',exact:true}).click();
      await page.getByText('ตรวจข้อมูลกับ Stripe เพิ่มเติม',{exact:true}).click();
      await page.getByRole('link',{name:'ค้นหาใบแจ้งหนี้ที่ยังไม่เข้ามั่งมี',exact:true}).click();await page.waitForURL(`**/companies/${companyId}/invoice-scans`);
      await page.getByLabel('เหตุผล',{exact:true}).fill('ตรวจประวัติจากเว็บและกู้ผลที่ค้าง');let lostResponse=false,createdId='';
      await page.route(`**/companies/${companyId}/invoice-scans`,async route=>{
        if(route.request().method()!=='POST'||lostResponse){await route.continue();return;}
        const response=await route.fetch();assert.equal(response.status(),201);createdId=(await response.json()).id;lostResponse=true;await route.abort('failed');
      });
      await page.getByRole('button',{name:'เริ่มตรวจใบแจ้งหนี้',exact:true}).click();await page.locator('main').getByRole('alert').waitFor();
      await page.getByRole('button',{name:'เริ่มตรวจใบแจ้งหนี้',exact:true}).click();await page.waitForURL(`**/invoice-scans/${createdId}`);
      let unavailable=true;reply=url=>!url.searchParams.has('starting_after')?new Response(JSON.stringify({object:'list',data:[invoice('A'),invoice('WEB')],has_more:true})):
        unavailable?new Response('{}',{status:503}):new Response(JSON.stringify({object:'list',data:[],has_more:false}));
      await input.drain();for(let i=0;i<5;i++){await input.drain();await due(createdId);}
      await page.getByRole('button',{name:'โหลดงานล่าสุด',exact:true}).click();await page.getByRole('heading',{name:'ต้องตรวจสอบก่อนทำต่อ',exact:true}).waitFor();
      await page.reload({waitUntil:'domcontentloaded'});const resumed=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/${createdId}/resume`));await page.getByRole('button',{name:'ทำงานเดิมต่อ',exact:true}).click();assert.equal((await resumed).status(),200);unavailable=false;await input.drain();
      await page.getByRole('button',{name:'โหลดงานล่าสุด',exact:true}).click();await page.getByRole('heading',{name:'ตรวจครบช่วงที่เลือก',exact:true}).waitFor();
      const panel=page.getByRole('region',{name:'รายการใบแจ้งหนี้ที่ตรวจพบ',exact:true});await panel.getByRole('link',{name:'ตรวจใบแจ้งหนี้เดิมและผลให้สิทธิ์',exact:true}).click();
      await page.waitForURL(`**/apply-invoices/${mapped.id}`);await page.goBack({waitUntil:'domcontentloaded'});await page.waitForURL(`**/invoice-scans/${createdId}`);
      await panel.getByRole('link',{name:'เปิดเคสตรวจใบแจ้งหนี้ของบริษัท',exact:true}).first().click();await page.waitForURL(`**/system/billing/issues/${review.id}`);
      await page.getByRole('link',{name:'ตรวจใบแจ้งหนี้ของบริษัท',exact:true}).click();await page.waitForURL(`**/companies/${companyId}/invoice-scans`);
      await page.getByRole('link',{name:'ตรวจครบช่วงที่เลือก · ตรวจประวัติจากเว็บและกู้ผลที่ค้าง',exact:true}).click();await page.waitForURL(`**/invoice-scans/${createdId}`);
      await expect(page.getByRole('heading',{name:'ตรวจครบช่วงที่เลือก',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.addStyleTag({content:'nextjs-portal { display: none; }'});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidenceDir}/admin-invoice-discovery-mobile.png`,fullPage:true});
      const timeline=await request(`/v1/system/billing/companies/${companyId}/timeline`);assert.equal(timeline.status,200);assert.ok(timeline.body.items.every((row:any)=>row.type!=='OBSERVE_PROVIDER_INVOICE'));
      assert.equal(timeline.body.items.find((row:any)=>row.reference===`OPERATION:${createdId}`)?.href,`/system/billing/companies/${companyId}/invoice-scans/${createdId}`);
      await page.getByRole('link',{name:'กลับไปบริษัทเดิม',exact:true}).click();await page.waitForURL(`**/system/billing/companies/${companyId}`);
      cases.push('browser-invoice-discovery-create-response-loss-same-command-unknown-resume-reload-findings-invoice-case-company-and-timeline-return');
    }
    assert.equal(await db.billingIssue.count({where:{companyId,kind:'PROVIDER_INVOICE_REVIEW'}}),1);assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:review.id}})).state,'OPEN');
    assert.deepEqual(await ledger(),expectedLedger);assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),term);assert.equal(await db.billingReceiptGrant.count({where:{companyId}}),0);
    assert.equal(await db.billingProviderEvent.count({where:{stripeAccountId:input.stripeAccountId,objectId:{startsWith:prefix}}}),0);return cases;
  }catch(error){
    try{if(input.browser){const {page,evidenceDir}=input.browser;
      console.error('Invoice history browser diagnostic',JSON.stringify({path:new URL(page.url()).pathname,responses:browserResponses,
        headings:await page.locator('h1,h2').allTextContents(),alerts:await page.getByRole('alert').allTextContents(),links:await page.locator('main a').allTextContents()}));
      await page.screenshot({path:`${evidenceDir}/invoice-discovery-failure.png`,fullPage:true});}}catch{console.error('Invoice history diagnostics unavailable');}
    throw error;
  }finally{
    input.transport();await db.billingOperatorScope.deleteMany({where:{companyId}});await db.auditLog.deleteMany({where:{companyId}});await db.billingIssue.deleteMany({where:{companyId}});
    await db.billingInvoice.deleteMany({where:{billingAccountId:account.id}});await db.companyPlanTerm.deleteMany({where:{companyId}});await db.billingAccount.delete({where:{id:account.id}});await db.company.delete({where:{id:companyId}});
    await db.membershipRole.upsert({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminId}},update:{},create:{membershipId:input.membershipId,roleId:input.adminId}});
  }
}
