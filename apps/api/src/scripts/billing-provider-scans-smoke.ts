import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { STRIPE_API_VERSION } from '@watchdog-bms/contracts';
import type { PrismaService } from '../common/database/prisma.service';
import type { startBillingBrowser } from './billing-browser-smoke';
import type { StripeClient } from '../modules/billing/infrastructure/stripe.client';

export type ProviderScansSmokeInput={prisma:PrismaService;stripe:StripeClient;userId:string;membershipId:string;stripeAccountId:string;
  request:(path:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<{status:number;body:any}>;
  drain:()=>Promise<{status:number;body:any}>;browser?:Awaited<ReturnType<typeof startBillingBrowser>>;
  transport:(hook?:((url:URL,init?:RequestInit)=>Promise<Response|undefined>|Response|undefined))=>void;
  second?:{userId:string;signToken:(sid:string)=>string;recordLegal:(membershipId:string)=>Promise<void>};
};
export async function checkBillingProviderScans(input:ProviderScansSmokeInput) {
  const {prisma,request,browser}=input,db=prisma.client,tag=randomUUID().replaceAll('-',''),prefix=`evt_scan${tag}`,base='/v1/system/billing/provider-scans';
  const member=await db.companyMembership.findUniqueOrThrow({where:{id:input.membershipId}}),term=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId:member.companyId}});
  const roleId=randomUUID(),ids:string[]=[];let adminId:string|undefined,createdAdmin=false;
  const accountIds=(await db.billingAccount.findMany({where:{stripeAccountId:input.stripeAccountId}})).map(row=>row.id);
  const financialSnapshot=async()=>({invoices:await db.billingInvoice.findMany({where:{billingAccountId:{in:accountIds}},orderBy:{id:'asc'}}),
    grants:await db.billingReceiptGrant.findMany({where:{billingAccountId:{in:accountIds}},orderBy:{id:'asc'}})});
  const originalFinancials=await financialSnapshot();
  const since=new Date(Date.now()-86400000).toISOString(),until=new Date(Date.now()-120000).toISOString(),created=Math.floor(Date.now()/1000)-400;
  const body={windowStart:since,windowEnd:until,reason:'ตรวจเหตุการณ์ที่ตกหล่นจำลอง'},read=(id:string)=>request(`${base}/${id}`);
  const event=(suffix:string,extra:Record<string,unknown>={})=>({id:`${prefix}${suffix}`,object:'event',created,api_version:STRIPE_API_VERSION,livemode:false,type:'invoice.paid',data:{object:{id:`in_scan${tag}`,customer_email:'private@example.test'}},...extra});
  let pages:string[]=[],pageReply:(url:URL)=>Promise<Response>|Response=()=>new Response(JSON.stringify({object:'list',data:[],has_more:false}));
  const create=async(extra:Record<string,unknown>={},key=randomUUID())=>{const result=await request(base,'POST',{...body,...extra},{'idempotency-key':key});if(result.status===201&&!ids.includes(result.body.id))ids.push(result.body.id);return result;};
  const cancel=async(id:string)=>{const value=(await read(id)).body;if(value.canCancel)assert.equal((await request(`${base}/${id}/cancel`,'POST',{expectedVersion:value.version})).status,200);};
  const due=async(id:string)=>{const row=await db.billingOperation.findUniqueOrThrow({where:{id}});await db.billingOperation.update({where:{id},data:{resultJson:{...(row.resultJson as object),retryAt:new Date(0).toISOString()}}});};
  try{
    assert.equal((await request('/v1/internal/billing/provider-scans/drain','POST',{})).status,401);
    assert.equal((await request('/v1/internal/billing/provider-scans/drain','POST',{}, {'x-worker-token':'wrong'})).status,401);
    assert.equal((await request(base)).status,403);
    await db.companyPlanTerm.update({where:{companyId:member.companyId},data:{termEndsAt:new Date(Date.now()+86400000)}});
    const permissions=await Promise.all(['system.billing.read','system.billing.reconcile.run'].map(key=>db.permission.upsert({where:{key},update:{},create:{key,description:key}})));
    await db.role.create({data:{id:roleId,key:`SCAN_${tag}`,scopeKey:'system',isSystem:true,name:'Synthetic scan operator',permissions:{create:permissions.map(p=>({permissionId:p.id}))}}});
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId}});
    assert.equal((await request(base)).status,404);
    const existing=await db.role.findUnique({where:{scopeKey_key:{scopeKey:'system',key:'SYSTEM_ADMIN'}}});
    const admin=existing??await db.role.create({data:{key:'SYSTEM_ADMIN',scopeKey:'system',isSystem:true,name:'Synthetic platform admin'}});adminId=admin.id;createdAdmin=!existing;
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:admin.id}});
    const enabledDescriptor=Object.getOwnPropertyDescriptor(input.stripe,'enabled');
    Object.defineProperty(input.stripe,'enabled',{get:()=>false,configurable:true});
    try{assert.equal((await request(base)).body.canCreate,false);assert.equal((await create()).status,409);}
    finally{if(enabledDescriptor)Object.defineProperty(input.stripe,'enabled',enabledDescriptor);else Reflect.deleteProperty(input.stripe,'enabled');}
    if(process.env.BILLING_INVOICE_SCANS_ONLY==='1'){
      const {checkBillingInvoiceScans}=await import('./billing-invoice-scans-smoke');
      try{return await checkBillingInvoiceScans({...input,roleId,adminId:admin.id});}
      finally{ids.push(...(await db.billingOperation.findMany({where:{stripeAccountId:input.stripeAccountId,type:{in:['SCAN_PROVIDER_EVENTS','SCAN_PROVIDER_INVOICES','OBSERVE_PROVIDER_INVOICE']}}})).map(row=>row.id));}
    }
    if(process.env.BILLING_SCAN_SCHEDULE_ONLY==='1'){
      const {checkBillingScanSchedule}=await import('./billing-scan-schedule-smoke');
      try{return await checkBillingScanSchedule({...input,roleId,adminId:admin.id});}
      finally{ids.push(...(await db.billingOperation.findMany({where:{stripeAccountId:input.stripeAccountId,type:{in:['SCAN_PROVIDER_EVENTS','CONFIGURE_PROVIDER_SCANS']}}})).map(row=>row.id));}
    }
    input.transport(async(url,init)=>{
      if(url.origin!=='https://api.stripe.com'||url.pathname!=='/v1/events')return;
      assert.equal(init?.method,'GET');assert.equal(new Headers(init?.headers).get('stripe-version'),STRIPE_API_VERSION);
      assert.equal(url.searchParams.get('limit'),'100');assert.equal(url.searchParams.get('created[gte]'),String(Math.floor(Date.parse(since)/1000)));
      pages.push(url.searchParams.get('starting_after')??'FIRST');return pageReply(url);
    });
    assert.equal((await create({customerId:'cus_forged'})).status,400);
    assert.equal((await create({windowStart:new Date(Date.now()-31*86400000).toISOString()})).status,400);
    const key=randomUUID(),first=await create({},key);assert.equal(first.status,201);assert.equal((await create({},key)).body.id,first.body.id);
    assert.equal((await create({reason:'changed'},key)).status,409);assert.equal(pages.length,0);
    let loseSecond=true,raced=false;
    pageReply=async url=>{
      if(!url.searchParams.has('starting_after')){
        if(!raced){raced=true;const raw=JSON.stringify(event('A')),timestamp=Math.floor(Date.now()/1000),signature=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.${raw}`).digest('hex');
          const received=await request('/v1/public/stripe-events','POST',JSON.parse(raw),{'stripe-signature':`t=${timestamp},v1=${signature}`});assert.equal(received.status,200);}
        return new Response(JSON.stringify({object:'list',data:[event('A'),event('B',{api_version:'2024-01-01'}),event('C',{type:'unrelated.created'})],has_more:true}));
      }
      assert.equal(url.searchParams.get('starting_after'),`${prefix}C`);
      if(loseSecond){loseSecond=false;return new Response('{}',{status:429,headers:{'Retry-After':'600'}});}
      return new Response(JSON.stringify({object:'list',data:[event('D')],has_more:false}));
    };
    assert.equal((await input.drain()).status,200);
    let view=(await read(first.body.id)).body;assert.equal(view.pages,1);assert.equal(view.known,1);assert.equal(view.imported,0);assert.equal(view.incompatible,1);assert.equal(view.ignored,1);
    assert.doesNotMatch(JSON.stringify(view),/evt_scan|in_scan|private@|cursor|stripeAccountId|evidenceHash/);
    const snapshot=await db.billingProviderEvent.findFirstOrThrow({where:{eventId:`${prefix}A`}});
    await input.drain();view=(await read(first.body.id)).body;assert.equal(view.pages,1);assert.equal(view.state,'QUEUED');assert.ok(Date.parse(view.retryAt)>Date.now()+590000);
    const before=pages.length;await input.drain();assert.equal(pages.length,before);await due(first.body.id);
    await Promise.all([input.drain(),input.drain()]);view=(await read(first.body.id)).body;assert.equal(view.state,'SUCCEEDED');assert.equal(view.pages,2);assert.equal(view.imported,1);assert.equal(pages.length,before+1);
    assert.deepEqual(await db.billingProviderEvent.findUniqueOrThrow({where:{id:snapshot.id}}),snapshot);
    assert.equal(await db.billingIssue.count({where:{kind:'PROVIDER_SCAN_VERSION_UNSUPPORTED',referenceId:first.body.id}}),1);
    await db.billingOperation.update({where:{id:first.body.id},data:{livemode:true}});assert.equal((await read(first.body.id)).status,404);
    assert.equal((await request(`${base}?cursor=${first.body.id}`)).status,404);await db.billingOperation.update({where:{id:first.body.id},data:{livemode:false}});
    const heldLease=await create();pageReply=async()=>{await db.billingOperation.update({where:{id:heldLease.body.id},data:{leaseToken:randomUUID(),version:{increment:1}}});return new Response(JSON.stringify({object:'list',data:[event('LEASELOST')],has_more:false}));};
    await input.drain();assert.equal((await read(heldLease.body.id)).body.pages,0);assert.equal(await db.billingProviderEvent.count({where:{eventId:`${prefix}LEASELOST`}}),0);await cancel(heldLease.body.id);
    const racedCancel=await create();pageReply=async()=>{await cancel(racedCancel.body.id);return new Response(JSON.stringify({object:'list',data:[event('CANCELLED')],has_more:false}));};
    await input.drain();assert.equal((await read(racedCancel.body.id)).body.state,'CANCELLED');assert.equal(await db.billingProviderEvent.count({where:{eventId:`${prefix}CANCELLED`}}),0);
    const revoked=await create();await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:admin.id}}});
    assert.equal((await read(revoked.body.id)).status,404);const beforeRevoked=pages.length;await input.drain();assert.equal(pages.length,beforeRevoked);
    assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:revoked.body.id}})).state,'BLOCKED');
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:admin.id}});await due(revoked.body.id);
    const resume=(await read(revoked.body.id)).body;assert.equal(resume.canResume,true);assert.equal((await request(`${base}/${revoked.body.id}/resume`,'POST',{expectedVersion:resume.version})).status,200);
    pageReply=async()=>{await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:admin.id}}});return new Response(JSON.stringify({object:'list',data:[event('REVOKED')],has_more:false}));};
    await input.drain();assert.equal(await db.billingProviderEvent.count({where:{eventId:`${prefix}REVOKED`}}),0);
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:admin.id}});await cancel(revoked.body.id);
    for(const bad of [{object:'list',data:[event('WRONG',{livemode:true})],has_more:false},{object:'list',data:[],has_more:true},{object:'list',data:[event('DUP'),event('DUP')],has_more:false}]){
      const row=await create();pageReply=()=>new Response(JSON.stringify(bad));await input.drain();assert.equal((await read(row.body.id)).body.state,'BLOCKED');assert.equal((await read(row.body.id)).body.pages,0);await cancel(row.body.id);
    }
    const expired=await create(),original=await db.billingOperation.findUniqueOrThrow({where:{id:expired.body.id}});
    await db.billingOperation.update({where:{id:expired.body.id},data:{proposedJson:{...(original.proposedJson as object),since:Math.floor(Date.now()/1000)-30*86400}}});
    const beforeExpired=pages.length;await input.drain();assert.equal(pages.length,beforeExpired);assert.equal((await read(expired.body.id)).body.errorCode,'RETENTION_WINDOW_EXPIRED');assert.equal((await read(expired.body.id)).body.canResume,false);await cancel(expired.body.id);
    const ceiling=await create(),ceilingRow=await db.billingOperation.findUniqueOrThrow({where:{id:ceiling.body.id}});
    await db.billingOperation.update({where:{id:ceiling.body.id},data:{resultJson:{...(ceilingRow.resultJson as object),pages:2000}}});
    const beforeCeiling=pages.length;await input.drain();assert.equal(pages.length,beforeCeiling);assert.equal((await read(ceiling.body.id)).body.errorCode,'PAGE_LIMIT_REACHED');assert.equal((await read(ceiling.body.id)).body.canResume,false);await cancel(ceiling.body.id);
    const sample=await db.billingOperation.findUniqueOrThrow({where:{id:first.body.id}}),pagination=Array.from({length:27},()=>randomUUID());ids.push(...pagination);
    await db.billingOperation.createMany({data:pagination.map(id=>({id,type:'SCAN_PROVIDER_EVENTS',state:'SUCCEEDED',stripeAccountId:input.stripeAccountId,livemode:false,
      proposedJson:sample.proposedJson!,sourceVersion:0,reason:'Synthetic pagination',initiatorUserId:input.userId,requestHash:id,expiresAt:sample.expiresAt,resultJson:sample.resultJson!}))});
    const list=(await request(base)).body,next=(await request(`${base}?cursor=${list.nextCursor}`)).body;assert.equal(list.items.length,25);
    assert.equal(new Set([...list.items,...next.items].map(row=>row.id)).size,ids.length);
    await db.billingOperation.updateMany({where:{id:{in:pagination.slice(0,5)}},data:{state:'QUEUED'}});assert.equal((await create()).status,409);
    await db.billingOperation.updateMany({where:{id:{in:pagination.slice(0,5)}},data:{state:'SUCCEEDED'}});
    if(browser){
      const page=browser.page;await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/billing/provider-events`,{waitUntil:'domcontentloaded'});
      await page.getByRole('link',{name:'ค้นหาเหตุการณ์ที่ตกหล่น',exact:true}).click();await page.waitForURL('**/system/billing/provider-scans');
      await page.getByLabel('เหตุผล',{exact:true}).fill('ตรวจจากหน้าจอจริง');
      const created=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(base)&&r.request().method()==='POST');await page.getByRole('button',{name:'เริ่มค้นหาเหตุการณ์',exact:true}).click();
      const response=await created;assert.equal(response.status(),201);const id=(await response.json()).id;ids.push(id);await page.waitForURL(`**/system/billing/provider-scans/${id}`);
      // UI chooses its own actual one-day window; the provider boundary checks the bounded shape.
      let unavailable=true;
      input.transport(async(url,init)=>{if(url.origin!=='https://api.stripe.com'||url.pathname!=='/v1/events')return;
        assert.equal(init?.method,'GET');assert.equal(new Headers(init?.headers).get('stripe-version'),STRIPE_API_VERSION);
        return unavailable?new Response('{}',{status:503}):new Response(JSON.stringify({object:'list',data:[],has_more:false}));});
      for(let retry=0;retry<5;retry++){await input.drain();await due(id);}
      const failureCase=await db.billingIssue.findFirstOrThrow({where:{kind:'PROVIDER_SCAN_FAILED',referenceId:id}});assert.notEqual(failureCase.state,'RESOLVED');
      await page.getByRole('button',{name:'โหลดงานล่าสุด',exact:true}).click();await page.getByRole('heading',{name:'ต้องตรวจสอบก่อนทำต่อ',exact:true}).waitFor();
      await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'ทำงานเดิมต่อ',exact:true}).waitFor();
      const resumed=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/${id}/resume`));await page.getByRole('button',{name:'ทำงานเดิมต่อ',exact:true}).click();assert.equal((await resumed).status(),200);unavailable=false;
      await input.drain();await page.getByRole('button',{name:'โหลดงานล่าสุด',exact:true}).click();await page.getByRole('heading',{name:'ตรวจครบช่วงที่เลือก',exact:true}).waitFor();
      await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'ตรวจครบช่วงที่เลือก',exact:true}).waitFor();
      assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:failureCase.id}})).state,'RESOLVED');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.addStyleTag({content:'nextjs-portal { display: none; }'});
      await page.getByRole('region',{name:'ผลการค้นหาเหตุการณ์',exact:true}).screenshot({path:`${browser.evidenceDir}/admin-provider-discovery-mobile.png`});
      await page.getByRole('link',{name:'กลับรายการงานตรวจ',exact:true}).click();await page.getByRole('button',{name:'งานหน้าถัดไป',exact:true}).waitFor();
      if(!await page.getByRole('link',{name:'ตรวจครบช่วงที่เลือก · ตรวจจากหน้าจอจริง',exact:true}).count())await page.getByRole('button',{name:'งานหน้าถัดไป',exact:true}).click();
      await page.getByRole('link',{name:'ตรวจครบช่วงที่เลือก · ตรวจจากหน้าจอจริง',exact:true}).click();await page.waitForURL(`**/system/billing/provider-scans/${id}`);
      await page.getByRole('link',{name:'เหตุการณ์ที่รับไว้',exact:true}).click();await page.waitForURL('**/system/billing/provider-events');
      await page.goto(`${browser.origin}/system/billing/issues/${failureCase.id}`,{waitUntil:'domcontentloaded'});
      await page.getByRole('link',{name:'เปิดงานค้นหาเหตุการณ์ของเคสนี้',exact:true}).click();await page.waitForURL(`**/system/billing/provider-scans/${id}`);
    }
    assert.deepEqual(await financialSnapshot(),originalFinancials,'discovery cannot rewrite invoices or receipt grants');
    return ['provider-discovery-platform-scope-strict-window-idempotent-redacted-admission','provider-discovery-webhook-race-original-evidence-and-financials-preserved',
      'provider-discovery-page-checkpoint-429-backoff-resume-worker-race','provider-discovery-cancel-lost-lease-and-revoked-actor-before-read-or-commit',
      'provider-discovery-invalid-mode-duplicate-empty-page-and-retention-remain-incomplete','provider-discovery-cursor-scope-pagination-and-active-admission-cap',
      ...(browser?['browser-provider-discovery-create-unknown-resume-reload-return-mobile']:[])];
  }finally{
    input.transport();await db.billingIssue.deleteMany({where:{referenceId:{in:ids}}});await db.auditLog.deleteMany({where:{targetId:{in:ids}}});await db.billingOperation.deleteMany({where:{id:{in:ids}}});
    await db.billingProviderEvent.deleteMany({where:{stripeAccountId:input.stripeAccountId,eventId:{startsWith:prefix}}});
    await db.membershipRole.deleteMany({where:{membershipId:input.membershipId,roleId:{in:[roleId,...adminId?[adminId]:[]]}}});await db.role.deleteMany({where:{id:{in:[roleId,...createdAdmin&&adminId?[adminId]:[]]}}});
    await db.companyPlanTerm.update({where:{companyId:member.companyId},data:{termEndsAt:term.termEndsAt}});
  }
}
