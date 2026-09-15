import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { checkBillingConfigurationDrafts } from './billing-configuration-drafts-smoke';

/** Real reviewed HTTP/PG operations; only the Stripe transport is simulated. */
export async function checkAdminCollectionControl(input:Parameters<typeof checkBillingConfigurationDrafts>[0],companyId:string,accountId:string,sub:any,invoices:any[]){
  const {prisma,request,approveRequest,repeatFixture:fixture,browser,secondBrowser}=input,db=prisma.client;
  const base='/v1/system/billing',company=`${base}/companies/${companyId}`,customer=`/v1/companies/${companyId}/billing`,tag=randomUUID();
  const get=async(id:string)=>(await request(`${base}/plan-adjustments/${id}`)).body;
  const cmd=(row:any,action:string,actor=request)=>actor(`${base}/plan-adjustments/${row.id}/${action}`,'POST',
    {expectedVersion:row.version,previewHash:row.previewHash},{'idempotency-key':`collection-${row.id}`});
  const preview=async(action='PAUSE',resumesAt?:string)=>request(`${company}/plan-adjustments/preview`,'POST',{
    type:'CHANGE_COLLECTION',collectionAction:action,...action==='PAUSE'?{resumesAt:resumesAt??new Date(Math.floor(Date.now()/1000)*1000+86400000).toISOString()}:{},
    reason:'ตรวจการพักเก็บเงินตามคำขอ',sourceHash:(await request(`${company}/plan-adjustments`)).body.sourceHash});
  const approve=async(action:string)=>{let r=await preview(action);assert.equal(r.status,200,JSON.stringify(r));r=await cmd(r.body,'submit');assert.equal(r.status,200,JSON.stringify(r));
    r=await cmd(r.body,'approve',approveRequest);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const proof=async()=>{for(const actor of [request,approveRequest])assert.equal((await actor(`${company}/reauthenticate`,'POST',{password:input.password})).status,200);};
  const unchanged=async()=>({term:await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),grants:await db.billingReceiptGrant.findMany({where:{billingAccountId:accountId},orderBy:{id:'asc'}}),
    invoices:await db.billingInvoice.findMany({where:{billingAccountId:accountId},orderBy:{id:'asc'}}),ai:await db.companyAiConfiguration.findUnique({where:{companyId}})});
  const before=await unchanged(),invoiceCount=invoices.length;
  invoices.push(...['open','draft'].map((status,index)=>({id:`in_control_${tag}_${status}`,object:'invoice',livemode:false,customer:sub.customer,subscription:sub.id,
    status,currency:'thb',amount_remaining:10000+index*5000,auto_advance:status==='open',attempt_count:0})));
  const invoiceSource=structuredClone(invoices),results:string[]=[];
  try{
    await proof();assert.notEqual((await preview('INVALID')).status,200);assert.notEqual((await preview('PAUSE',new Date(Date.now()-60000).toISOString())).status,200);
    assert.notEqual((await preview('RESUME')).status,200,'cannot resume an unpaused subscription');
    let p=await preview();assert.equal(p.status,200,JSON.stringify(p));
    assert.equal(p.body.collectionChange.openInvoices,1);assert.equal(p.body.collectionChange.draftInvoices,1);assert.equal(p.body.collectionChange.outstandingSatang,25000);
    p=await cmd(p.body,'submit');assert.equal(p.status,200);assert.equal((await cmd(p.body,'approve')).status,403);
    p=await cmd(p.body,'approve',approveRequest);assert.equal(p.status,200,JSON.stringify(p));
    const pending=await request(customer,'GET',undefined,{'x-company-id':companyId});assert.equal(pending.status,200);assert.equal(pending.body.collection.action,'ADMIN_PAUSE_COLLECTION');
    assert.equal((await request(`${customer}/collection/${p.body.id}/submit`,'POST',{expectedVersion:p.body.version,previewHash:p.body.previewHash,accepted:true},
      {'x-company-id':companyId,'idempotency-key':`owner-${tag}`})).status,400);
    fixture.lose('hold');await input.reconcile(accountId);assert.equal((await get(p.body.id)).state,'UNKNOWN');assert.equal(sub.pause_collection?.behavior,'keep_as_draft');assert.equal(sub.metadata.mangmeeCollectionControl,p.body.id);
    assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:accountId}})).collectionPauseJson,null);
    if(browser){
      const issue=await db.billingIssue.findFirstOrThrow({where:{companyId,kind:'CUSTOMER_COLLECTION_REVIEW',referenceId:p.body.id}});
      await browser.page.goto(`${browser.origin}/system/billing/issues/${issue.id}`,{waitUntil:'domcontentloaded'});
      await browser.page.getByRole('link',{name:'เปิดคำขอผู้ดูแลเดิมของเคสนี้',exact:true}).click();
      await browser.page.waitForURL(`**/system/billing/plan-adjustments/${p.body.id}`);
      await browser.page.getByRole('heading',{name:'ยังยืนยันผลไม่ได้ โหลดสถานะรายการเดิมเพื่อตรวจอีกครั้ง',exact:true}).waitFor();
    }
    const writes=fixture.calls.get('hold');await input.reconcile(accountId);assert.equal((await get(p.body.id)).state,'SUCCEEDED');assert.equal(fixture.calls.get('hold'),writes);
    const paused=await request(customer,'GET',undefined,{'x-company-id':companyId});assert.equal(paused.body.collectionPause.behavior,'keep_as_draft');assert.equal(paused.body.nextChargeAt,null);
    assert.ok(!paused.body.allowedActions.includes('new_sales'));assert.deepEqual(await unchanged(),before);assert.deepEqual(invoices,invoiceSource);
    results.push('admin-collection-pause-independent-approval-old-invoice-impact-owner-denial-and-lost-response-observed-once');

    let edited=await preview('PAUSE',new Date(Math.floor(Date.now()/1000)*1000+2*86400000).toISOString());assert.equal(edited.status,200,JSON.stringify(edited));
    assert.equal(edited.body.collectionChange.before.resumesAt,paused.body.collectionPause.resumesAt);
    edited=await cmd(edited.body,'submit');assert.equal(edited.status,200);edited=await cmd(edited.body,'approve',approveRequest);assert.equal(edited.status,200);
    await input.reconcile(accountId);assert.equal((await get(edited.body.id)).state,'SUCCEEDED');
    assert.equal(sub.pause_collection.resumes_at,Date.parse(edited.body.collectionChange.after.resumesAt)/1000,'edit the pause date without briefly resuming collection');
    results.push('admin-collection-change-resume-date-preserves-continuous-pause-and-original-history');

    const resume=await approve('RESUME'),trigger=`collection_audit_${tag.replaceAll('-','')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.collection_control.applied' AND NEW."targetId"='${resume.id}' THEN RAISE EXCEPTION 'synthetic collection audit failure'; END IF; RETURN NEW; END $$`);
    try{await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
      await input.reconcile(accountId);assert.equal((await get(resume.id)).state,'UNKNOWN');assert.ok((await db.billingAccount.findUniqueOrThrow({where:{id:accountId}})).collectionPauseJson);
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);}
    const resumeWrites=fixture.calls.get('resume');await input.reconcile(accountId);assert.equal((await get(resume.id)).state,'SUCCEEDED');assert.equal(fixture.calls.get('resume'),resumeWrites);
    assert.equal((await request(customer,'GET',undefined,{'x-company-id':companyId})).body.collectionPause,null);
    assert.deepEqual(await unchanged(),before);assert.deepEqual(invoices,invoiceSource);
    results.push('admin-collection-resume-audit-rollback-original-positive-recovery-no-draft-charge-or-service-change');

    const stale=await approve('PAUSE'),holdsBefore=fixture.calls.get('hold');sub.cancel_at_period_end=true;
    await input.reconcile(accountId);assert.equal((await get(stale.id)).state,'BLOCKED');assert.equal(fixture.calls.get('hold'),holdsBefore);sub.cancel_at_period_end=false;
    assert.equal((await cmd(await get(stale.id),'cancel')).status,200);
    const revoked=await approve('PAUSE');
    const permission=await db.permission.findUniqueOrThrow({where:{key:'system.billing.collection.manage'}});
    const actorRoles=(await db.membershipRole.findMany({where:{membershipId:input.membershipId},select:{roleId:true}})).map(row=>row.roleId);
    const grants=await db.rolePermission.findMany({where:{roleId:{in:actorRoles},permissionId:permission.id}});assert.ok(grants.length);
    try{await db.rolePermission.deleteMany({where:{roleId:{in:actorRoles},permissionId:permission.id}});await input.reconcile(accountId);
      assert.equal((await get(revoked.id)).state,'BLOCKED');assert.equal(fixture.calls.get('hold'),holdsBefore);
    }finally{await db.rolePermission.createMany({data:grants});}
    assert.equal((await cmd(await get(revoked.id),'cancel')).status,200);
    results.push('admin-collection-provider-drift-and-worker-permission-revocation-block-before-write-and-withdraw-safely');
    const automatic=await approve('PAUSE');fixture.lose('hold');await input.reconcile(accountId);assert.equal((await get(automatic.id)).state,'UNKNOWN');
    const automaticWrites=fixture.calls.get('hold'),later=Date.parse(automatic.collectionChange.after.resumesAt)+1000,RealDate=Date;
    sub.pause_collection=null; // Stripe automatically resumes at the approved resumes_at.
    globalThis.Date=new Proxy(RealDate,{construct(target,args){return Reflect.construct(target,args.length?args:[later]);},get(target,key){return key==='now'?()=>later:Reflect.get(target,key);}});
    try{await input.reconcile(accountId);}finally{globalThis.Date=RealDate;}
    assert.equal((await get(automatic.id)).state,'SUCCEEDED');assert.equal(fixture.calls.get('hold'),automaticWrites);
    assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:accountId}})).collectionPauseJson,null);
    results.push('admin-collection-late-observation-after-automatic-resume-never-repauses-or-collects-drafts');
    if(browser&&secondBrowser){
      await proof();const page=browser.page,other=secondBrowser.pages()[0]!;
      await page.goto(`${browser.origin}/system/billing/companies/${companyId}/plan-adjustments`,{waitUntil:'domcontentloaded'});
      const panel=page.getByRole('region',{name:'พักหรือกลับมาเก็บเงิน',exact:true});
      await panel.getByLabel('รายการที่ต้องการ',{exact:true}).selectOption('PAUSE');
      await panel.getByLabel('กลับมาเก็บเงินเมื่อไร (เวลาประเทศไทย)',{exact:true}).fill(new Date(Date.now()+86400000+7*3600000).toISOString().slice(0,16));
      await panel.getByLabel('เหตุผลที่ปรับการเก็บเงิน',{exact:true}).fill('พักเก็บเงินจากหน้าเว็บ');
      await panel.getByRole('button',{name:'ตรวจผลต่อบิลก่อนส่งคำขอ',exact:true}).click();await page.waitForURL(/\/system\/billing\/plan-adjustments\//);
      await page.getByText('บิลเดิมที่ยังเปิด 1 รายการ',{exact:false}).waitFor();await page.getByRole('button',{name:'ส่งคำขอให้ผู้อนุมัติ',exact:true}).click();
      await page.getByRole('heading',{name:'รอผู้อนุมัติอีกคน',exact:true}).waitFor();await other.goto(page.url(),{waitUntil:'domcontentloaded'});
      await other.getByRole('button',{name:'อนุมัติปรับการเก็บเงิน',exact:true}).click();await other.getByRole('heading',{name:'รอตรวจการเก็บเงินกับ Stripe',exact:true}).waitFor();
      await input.reconcile(accountId);await other.reload({waitUntil:'domcontentloaded'});await other.getByRole('heading',{name:'ยืนยันการปรับเก็บเงินแล้ว',exact:true}).waitFor();
      assert.ok(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await other.screenshot({path:`${browser.evidenceDir}/admin-collection-control-20260915.png`,fullPage:true});
      await page.goto(`${browser.origin}/companies/${companyId}/billing`,{waitUntil:'domcontentloaded'});await page.getByText('พักเก็บเงินอยู่ตามสถานะที่ตรวจล่าสุด',{exact:true}).waitFor();
      const resumeBrowser=await approve('RESUME');await input.reconcile(accountId);assert.equal((await get(resumeBrowser.id)).state,'SUCCEEDED');
      results.push('browser-admin-collection-pause-invoice-review-independent-approval-owner-status-and-resume');
    }
    assert.deepEqual(await unchanged(),before);assert.deepEqual(invoices,invoiceSource);
    return results;
  }finally{invoices.splice(invoiceCount);}
}
