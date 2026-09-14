import assert from 'node:assert/strict';
import { checkBillingPortal } from './billing-portal-smoke';
import { randomUUID } from 'node:crypto';
import type { checkBillingConfigurationDrafts } from './billing-configuration-drafts-smoke';

export async function checkBillingReadiness(input:Parameters<typeof checkBillingConfigurationDrafts>[0]){
  const {request,browser,stripeAccountId,companyId}=input,db=input.prisma.client,base='/v1/system/billing/configuration-checks',cases:string[]=[];
  const settings=await db.billingSettings.findUniqueOrThrow({where:{id:`${stripeAccountId}:test`}});
  const get=async(id:string)=>{const r=await request(`${base}/${id}`);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const create=async(reason='ตรวจการตั้งค่าก่อนเปิดรับรายการ',key=randomUUID())=>{
    const s=await db.billingSettings.findUniqueOrThrow({where:{id:settings.id}}),body={expectedVersion:s.version,reason};
    const r=await request(base,'POST',body,{'idempotency-key':key});assert.equal(r.status,202,JSON.stringify(r));return {row:r.body,key,body};
  };
  const act=async(row:any,action='run')=>{const r=await request(`${base}/${row.id}/${action}`,'POST',{expectedVersion:row.version});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  let writes=0,reads=0;
  const transport=(hook?:Parameters<typeof input.transport>[0])=>input.transport(async(url,init)=>{if(init?.method&&init.method!=='GET')writes++;else reads++;return hook?.(url,init);});
  const financial=async()=>{const accounts=await db.billingAccount.findMany({where:{stripeAccountId},orderBy:{id:'asc'}});return {accounts,
    invoices:await db.billingInvoice.findMany({where:{billingAccountId:{in:accounts.map(a=>a.id)}},orderBy:{id:'asc'}}),
    grants:await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}}),term:await db.companyPlanTerm.findUnique({where:{companyId}})};};
  const before=await financial(),viewport=browser?.page.viewportSize();transport();
  try{
    const first=await create(),replay=await request(base,'POST',first.body,{'idempotency-key':first.key});assert.equal(replay.body.id,first.row.id);
    assert.equal((await request(base,'POST',{...first.body,reason:'changed'},{'idempotency-key':first.key})).status,409);
    assert.equal((await request(base,'POST',first.body,{'idempotency-key':randomUUID()})).body.code,'CONTROL_CONFIGURATION_CHECK_ACTIVE');
    assert.equal((await request(base,'POST',{...first.body,unexpected:true},{'idempotency-key':randomUUID()})).status,400);
    assert.equal((await request(`${base}?cursor=${randomUUID()}`)).status,404);
    const completed=await act(first.row);assert.equal(completed.state,'SUCCEEDED');assert.equal(completed.result,'MATCH');assert.equal(completed.isCurrent,true);
    assert.equal(completed.items.find((i:any)=>i.kind==='PRICE'&&i.offerKey==='PRO_999:year').state,'MATCH');
    assert.equal(completed.items.find((i:any)=>i.kind==='PRICE'&&i.offerKey==='PRO_999:month').state,'NOT_CONFIGURED');
    assert.equal((await act(first.row)).version,completed.version);assert.equal((await request(base,'POST',first.body,{'idempotency-key':first.key})).body.id,first.row.id);
    cases.push('original-request-idempotency-strict-input-single-active-cursor-binding-and-current-match');

    const error=await create('ตรวจกรณี Stripe ขัดข้อง');transport(url=>Promise.resolve(url.pathname==='/v1/account'?json({error:{code:'api_error'}},503):undefined));
    const unavailable=await act(error.row);assert.equal(unavailable.result,'UNAVAILABLE');assert.ok(unavailable.reviewCaseId);
    const issueId=unavailable.reviewCaseId;assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:issueId}})).state,'OPEN');
    const wrong=await create('ตรวจบัญชีที่เชื่อมผิด');const paths:string[]=[];transport(async url=>{paths.push(url.pathname);if(url.pathname==='/v1/account')return json({id:'acct_wrong'});});
    const difference=await act(wrong.row);assert.equal(difference.result,'DIFFERENT');assert.deepEqual(paths,['/v1/account']);assert.equal(difference.reviewCaseId,issueId);
    cases.push('provider-unavailable-versus-wrong-account-no-cross-account-reads-and-deduplicated-review-case');
    for(const [name,override] of [
      ['price',async(url:URL)=>url.pathname==='/v1/prices/price_ProYear'?json({id:'price_ProYear',object:'price',livemode:true}):undefined],
      ['prepaid',async(url:URL)=>url.pathname==='/v1/prices/price_ZeroProYear'?json({id:'price_ZeroProYear',product:'prod_wrong'}):undefined],
      ['portal',async(url:URL)=>url.pathname.startsWith('/v1/billing_portal/configurations/')?json({id:'bpc_Synthetic',object:'billing_portal.configuration',livemode:true,active:true}):undefined],
    ] as const){const op=await create(`ตรวจความต่าง ${name}`);transport(override);const result=await act(op.row);assert.equal(result.result,'DIFFERENT');assert.equal(result.reviewCaseId,issueId);}
    cases.push('paid-price-mode-prepaid-product-and-portal-mode-drift');
    transport();const stale=await create('การตั้งค่าเปลี่ยนก่อนตรวจ'),beforeReads=reads;
    await db.billingSettings.update({where:{id:settings.id},data:{version:{increment:1}}});
    assert.equal((await act(stale.row)).state,'BLOCKED');assert.equal(reads,beforeReads);assert.equal((await get(first.row.id)).isCurrent,false);
    await act(await get(stale.row.id),'cancel');
    const during=await create('การตั้งค่าเปลี่ยนระหว่างตรวจ');let changed=false;
    transport(async()=>{if(!changed){changed=true;await db.billingSettings.update({where:{id:settings.id},data:{version:{increment:1}}});}return undefined;});
    assert.equal((await act(during.row)).state,'BLOCKED');assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:issueId}})).state,'OPEN');
    cases.push('source-version-fences-before-and-after-provider-read-retain-review-and-cancel-blocked');
    const revoked=await create('สิทธิ์ผู้เริ่มตรวจถูกถอด');let revokedRole=false;
    transport(async()=>{if(!revokedRole){revokedRole=true;await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});}return undefined;});
    try{assert.equal((await request(`${base}/${revoked.row.id}/run`,'POST',{expectedVersion:revoked.row.version})).status,403);
      assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:revoked.row.id}})).state,'BLOCKED');
    }finally{await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminRoleId}});}
    transport();cases.push('current-platform-permission-rechecked-after-provider-read');
    const lease=await create('เรียกตรวจซ้ำพร้อมกัน');let release!:()=>void,started!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}),began=new Promise<void>(resolve=>{started=resolve;});
    transport(async url=>{if(url.pathname==='/v1/account'){started();await held;}return undefined;});
    const running=request(`${base}/${lease.row.id}/run`,'POST',{expectedVersion:lease.row.version});await began;
    try{assert.equal((await request(`${base}/${lease.row.id}/run`,'POST',{expectedVersion:lease.row.version})).status,409);
      assert.equal((await request(`${base}/${lease.row.id}/cancel`,'POST',{expectedVersion:(await get(lease.row.id)).version})).status,409);
      await db.billingOperation.update({where:{id:lease.row.id},data:{leaseUntil:new Date(Date.now()-1)}});
    }finally{release();}
    assert.equal((await running).body.state,'RUNNING');transport();
    assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:issueId}})).state,'OPEN');
    assert.equal((await act(await get(lease.row.id))).result,'MATCH');assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:issueId}})).state,'RESOLVED');
    cases.push('single-live-lease-expired-writer-refused-manual-reclaim-and-current-match-resolves-case');

    const cancelled=await create('ยกเลิกก่อนเริ่มตรวจ'),cancelledRow=await act(cancelled.row,'cancel');assert.equal(cancelledRow.state,'CANCELLED');
    const worker=await create('ให้ตัวตรวจเบื้องหลังทำต่อ');await input.drainOperations();assert.equal((await get(worker.row.id)).result,'MATCH');
    cases.push('queued-cancellation-and-bounded-worker-drain');
    const bad=await create('ตรวจความต่างก่อนทดสอบบันทึกผล'),fn=`readiness_audit_${randomUUID().replaceAll('-','')}`;
    transport(async url=>url.pathname==='/v1/account'?json({id:'acct_wrong'}):undefined);await act(bad.row);transport();
    const rollback=await create('จำลองบันทึกประวัติไม่สำเร็จ');
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.configuration_check.observed' AND NEW."targetId"='${rollback.row.id}' THEN RAISE EXCEPTION 'synthetic configuration audit failure'; END IF; RETURN NEW; END $$`);
    try{await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      assert.equal((await act(rollback.row)).state,'BLOCKED');assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:issueId}})).state,'OPEN');
      assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:rollback.row.id}})).resultJson,null);
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);}
    cases.push('audit-failure-rolls-back-observation-and-case-resolution');
    const revision=await db.billingPolicyRevision.findUniqueOrThrow({where:{id:settings.policyRevisionId!}});
    try{await db.billingPolicyRevision.update({where:{id:revision.id},data:{policyJson:{broken:true}}});
      const admin=await request('/v1/system/billing/settings');assert.equal(admin.status,200);assert.equal(admin.body.policyRevisionId,null);
      const catalog=await request('/v1/billing/catalog');assert.equal(catalog.status,200);assert.ok(catalog.body.offers.every((o:any)=>o.availability!=='AVAILABLE'));
      const op=await create('นโยบายเสียหายและต้องซ่อม');assert.equal((await act(op.row)).result,'NOT_CONFIGURED');
      const draft=await request('/v1/system/billing/configuration-drafts','POST',{type:'PUBLISH_POLICY',expectedVersion:0,reason:'แก้จากร่างที่ตรวจได้',policy:revision.policyJson,gates:admin.body.gates},{'idempotency-key':randomUUID()});
      assert.equal(draft.status,200,JSON.stringify(draft));
    }finally{await db.billingPolicyRevision.update({where:{id:revision.id},data:{policyJson:revision.policyJson!}});}
    cases.push('corrupt-policy-closes-sales-keeps-admin-repair-and-observation-available');

    if(browser){
      const page=browser.page;await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/billing/configuration-checks`,{waitUntil:'domcontentloaded'});
      await page.getByRole('textbox',{name:'เหตุผลการตรวจ',exact:true}).fill('ตรวจผ่านเว็บสำหรับผู้ดูแล');
      let lost=false;await page.route('**/api/v1/system/billing/configuration-checks',async route=>{if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
      await page.getByRole('button',{name:'เริ่มตรวจการเชื่อมต่อ',exact:true}).click();await page.getByRole('link',{name:'เปิดรายการที่กำลังตรวจ',exact:true}).waitFor();
      await page.unroute('**/api/v1/system/billing/configuration-checks');await page.getByRole('link',{name:'เปิดรายการที่กำลังตรวจ',exact:true}).click();
      await page.waitForURL('**/system/billing/configuration-checks/*');const url=page.url();
      await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'ตรวจรายการนี้ตอนนี้',exact:true}).click();
      await page.getByRole('status').filter({hasText:'ตรงตามที่ตั้งไว้'}).waitFor();await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('status').filter({hasText:'ตรงตามที่ตั้งไว้'}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.ok(await page.getByRole('button',{name:'โหลดผลล่าสุด',exact:true}).evaluate(node=>node.getBoundingClientRect().height>=44));
      await page.screenshot({path:`${browser.evidenceDir}/admin-configuration-check-mobile.png`,fullPage:true});
      await page.route('**/api/v1/system/billing/configuration-checks/*',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
      await page.getByRole('button',{name:'โหลดผลล่าสุด',exact:true}).click();await page.getByRole('alert').filter({hasText:'โหลดผลตรวจไม่ได้'}).waitFor();
      assert.equal(await page.getByRole('region',{name:'ผลตรวจการเชื่อมต่อ',exact:true}).count(),0);
      await page.unroute('**/api/v1/system/billing/configuration-checks/*');await page.getByRole('button',{name:'โหลดผลล่าสุด',exact:true}).click();await page.getByRole('status').filter({hasText:'ตรงตามที่ตั้งไว้'}).waitFor();
      assert.equal(page.url(),url);await page.getByRole('link',{name:'กลับประวัติการตรวจ',exact:true}).click();await page.getByRole('region',{name:'ประวัติการตรวจ',exact:true}).waitFor();
      await page.getByRole('textbox',{name:'เหตุผลการตรวจ',exact:true}).fill('ตรวจหลังมีผู้เปลี่ยนค่า');
      await page.route('**/api/v1/system/billing/configuration-checks',async route=>{if(route.request().method()==='POST')await db.billingSettings.update({where:{id:settings.id},data:{version:{increment:1}}});await route.continue();});
      const rejected=page.waitForResponse(r=>r.url().endsWith('/api/v1/system/billing/configuration-checks')&&r.request().method()==='POST');
      await page.getByRole('button',{name:'เริ่มตรวจการเชื่อมต่อ',exact:true}).click();const rejection=await rejected;assert.equal(rejection.status(),409);assert.equal((await rejection.json()).code,'CONTROL_PREVIEW_STALE');
      await page.unroute('**/api/v1/system/billing/configuration-checks');await page.getByRole('alert').filter({hasText:'การตั้งค่าเปลี่ยนแล้ว'}).waitFor();
      await page.getByRole('textbox',{name:'เหตุผลการตรวจ',exact:true}).fill('ใช้ค่าล่าสุดหลังตรวจพบการเปลี่ยน');
      await page.getByRole('button',{name:'เริ่มตรวจการเชื่อมต่อ',exact:true}).click();await page.waitForURL('**/system/billing/configuration-checks/*');
      await page.getByRole('button',{name:'ยกเลิกรายการตรวจนี้',exact:true}).click();await page.getByRole('status').filter({hasText:'ยกเลิกแล้ว'}).waitFor();
      cases.push('browser-lost-create-response-original-link-reload-run-history-mobile-44px-and-failed-refresh-clears-result');
    }
    assert.deepEqual(await financial(),before);assert.equal(writes,0);cases.push('configuration-observation-never-mutates-provider-money-or-customer-rights');
    cases.push(...await checkBillingPortal(input)); return cases;
  }catch(error){if(browser){console.error(JSON.stringify({readinessBrowserUrl:browser.page.url(),alerts:await browser.page.getByRole('alert').allTextContents()}));await browser.page.screenshot({path:`${browser.evidenceDir}/admin-configuration-check-failure.png`,fullPage:true});}throw error;}finally{input.transport();if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await db.billingSettings.update({where:{id:settings.id},data:{version:settings.version,updatedAt:settings.updatedAt}});}
}
