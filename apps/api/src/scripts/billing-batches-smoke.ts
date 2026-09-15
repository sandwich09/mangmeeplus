import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';

/** Real command admission, PostgreSQL rollback, existing worker and browser; Stripe stays simulated. */
export async function checkBillingBatches(input:Parameters<typeof checkBillingConfigurationDrafts>[0]){
  const {prisma,browser,stripeAccountId}=input,db=prisma.client,base='/v1/system/billing/batches',run=randomUUID(),ids:string[]=[],extraCaseIds:string[]=[],cases:string[]=[];
  const companies=Array.from({length:27},(_,n)=>({id:`batch-${run}-${String(n).padStart(2,'0')}`,name:n===0?'=บริษัททดสอบสูตร':`บริษัททดสอบกลุ่ม ${run} ${n}`})),companyIds=companies.map(c=>c.id),viewport=browser?.page.viewportSize();
  const baseline=async()=>({term:await db.companyPlanTerm.findUnique({where:{companyId:input.companyId}}),grants:await db.billingReceiptGrant.findMany({where:{companyId:input.companyId},orderBy:{id:'asc'}})}),before=await baseline();
  const request:typeof input.request=async(...args)=>{for(let i=0;i<3;i++){const r=await input.request(...args);if(r.status!==429)return r;assert.ok(Number.isInteger(r.body.retryAfterSeconds)&&r.body.retryAfterSeconds>=1&&r.body.retryAfterSeconds<=60);await new Promise(resolve=>setTimeout(resolve,(r.body.retryAfterSeconds+1)*1000));}throw Error('Operator limit did not recover');};
  let onAccount:(()=>Promise<void>)|undefined;input.transport(async(url,init)=>{if(url.pathname==='/v1/account'&&(init?.method??'GET')==='GET')await onAccount?.();return undefined;});
  const get=async(id:string)=>{const r=await request(`${base}/${id}`);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const selected=async(indices=[0,1])=>({companies:await Promise.all(indices.map(async n=>{const row=await db.billingAccount.findFirstOrThrow({where:{companyId:companyIds[n],stripeAccountId,livemode:false}});return {companyId:row.companyId,expectedVersion:row.version};})),reason:'ตรวจรายการเดิมที่เลือก'});
  const preview=async(indices=[0,1])=>{const r=await request(`${base}/preview`,'POST',await selected(indices));assert.equal(r.status,200,JSON.stringify(r));ids.push(r.body.id);return r.body;};
  const submit=async(op:any)=>{const r=await request(`${base}/${op.id}/submit`,'POST',{expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`batch-submit-${op.id}`});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const cancel=async(op:any)=>{const r=await request(`${base}/${op.id}/cancel`,'POST',{expectedVersion:op.version});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const child=(op:any,n=0)=>op.items.find((i:any)=>i.companyId===companyIds[n]).operationId as string;
  const retire=async(op:any)=>{await db.billingOperation.updateMany({where:{id:{in:op.items.map((i:any)=>i.operationId).filter(Boolean)}},data:{state:'CANCELLED',leaseToken:null,leaseUntil:null}});};
  try{
    await db.company.createMany({data:companies});await db.billingAccount.createMany({data:companyIds.map(companyId=>({companyId,stripeAccountId,livemode:false}))});
    const value=await selected(),count=()=>db.billingOperation.count({where:{type:'BULK_RECONCILE',stripeAccountId}}),start=await count();
    for(const bad of [{...value,companies:[]},{...value,companies:Array(26).fill(value.companies[0])},{...value,companies:[value.companies[0],value.companies[0]]},{...value,mode:'LIVE'},
      {...value,companies:[{...value.companies[0],expectedVersion:1.2}]},{...value,companies:[{...value.companies[0],sessionId:'cs_foreign'}]}])assert.equal((await request(`${base}/preview`,'POST',bad)).status,400);
    assert.equal(await count(),start);assert.equal((await request(`${base}/preview`,'POST',{...value,companies:[{companyId:'missing-company',expectedVersion:0}]})).status,404);
    let op=await preview();assert.equal(op.progress,'PREVIEW');assert.equal(op.items.length,2);assert.ok(op.items.every((i:any)=>i.operationId===null&&i.pendingAttempt===null));
    assert.doesNotMatch(JSON.stringify(op),/customerId|providerInvoice|paidSatang|checkoutSession|stripeAccountId/);
    assert.equal((await request(`${base}/${op.id}?mode=LIVE`)).status,400);
    assert.equal((await input.approveRequest(`${base}/${op.id}/submit`,'POST',{expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`other-submit-${op.id}`})).status,409);
    const [submitted,replayed]=await Promise.all([submit(op),submit(op)]);assert.equal(submitted.pending,2);assert.equal(replayed.id,op.id);
    assert.equal(await db.billingOperation.count({where:{id:{in:submitted.items.map((i:any)=>i.operationId)}}}),2);
    assert.equal((await request(`${base}/${op.id}/submit`,'POST',{expectedVersion:op.version,previewHash:'changed'},{'idempotency-key':`batch-submit-${op.id}`})).status,409);
    const competing=await preview();assert.equal((await request(`${base}/${competing.id}/submit`,'POST',{expectedVersion:competing.version,previewHash:competing.previewHash},{'idempotency-key':`competing-${competing.id}`})).status,409);
    assert.ok((await get(competing.id)).items.every((i:any)=>i.operationId===null));await cancel(competing);
    await db.billingOperation.update({where:{id:op.id},data:{livemode:true}});assert.equal((await request(`${base}/${op.id}`)).status,404);await db.billingOperation.update({where:{id:op.id},data:{livemode:false}});
    await cancel(submitted);cases.push('batch-strict-bounds-original-selection-concurrent-idempotent-atomic-children-competing-queue-foreign-actor-mode-and-safe-preview');

    op=await preview();await db.billingAccount.updateMany({where:{companyId:companyIds[1],stripeAccountId},data:{version:{increment:1}}});
    assert.equal((await request(`${base}/${op.id}/submit`,'POST',{expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`stale-${op.id}`})).status,409);
    assert.ok((await get(op.id)).items.every((i:any)=>i.operationId===null));await cancel(op);
    op=await preview();await db.billingOperation.update({where:{id:op.id},data:{expiresAt:new Date(0)}});assert.equal((await get(op.id)).canSubmit,false);await cancel(await get(op.id));
    op=await preview();const trigger=`batch_audit_${run.replace(/-/g,'')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.batch.queued' AND NEW."targetId"='${op.id}' THEN RAISE EXCEPTION 'synthetic batch audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
    try{assert.equal((await request(`${base}/${op.id}/submit`,'POST',{expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`rollback-${op.id}`})).status,500);assert.ok((await get(op.id)).items.every((i:any)=>i.operationId===null));}
    finally{await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);}
    await cancel(op);cases.push('batch-stale-company-and-expired-preview-retain-cancel-path-real-audit-failure-rolls-back-all-children');

    op=await submit(await preview());const first=child(op),second=child(op,1),blockedAccount=await db.billingAccount.findFirstOrThrow({where:{companyId:companyIds[1],stripeAccountId}});
    await db.billingAccount.update({where:{id:blockedAccount.id},data:{leaseToken:run,leaseUntil:new Date(Date.now()+60000)}});
    await input.drainOperations();let observed=await get(op.id);assert.equal(observed.checked,1);assert.equal(observed.review,1);assert.equal(observed.progress,'REVIEW');assert.ok(observed.items.find((i:any)=>i.operationId===second).reviewCaseId);
    const success=await db.billingOperation.findUniqueOrThrow({where:{id:first}});
    await db.billingAccount.update({where:{id:blockedAccount.id},data:{leaseToken:null,leaseUntil:null}});
    const retry=(await request(`/v1/system/billing/operations/${second}`)).body;assert.equal((await request(`/v1/system/billing/operations/${second}/retry`,'POST',{expectedVersion:retry.version})).status,200);
    await input.drainOperations();observed=await get(op.id);assert.equal(observed.checked,2);assert.equal(observed.progress,'CHECKED');assert.deepEqual(await db.billingOperation.findUniqueOrThrow({where:{id:first}}),success);
    const file=await request(`${base}/${op.id}/export`);assert.equal(file.status,200);assert.equal(file.body.rowCount,2);assert.ok(file.body.csv.startsWith('\uFEFF'));assert.match(file.body.csv,/'=บริษัททดสอบสูตร/);
    cases.push('batch-original-worker-partial-unknown-case-retry-only-original-unresolved-child-and-safe-thai-csv');

    op=await submit(await preview());await db.billingOperation.update({where:{id:child(op)},data:{state:'RUNNING',leaseToken:run,leaseUntil:new Date(Date.now()+60000)}});
    const stopped=await cancel(op);assert.equal(stopped.stopped,1);assert.equal(stopped.pending,1);assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:child(op)}})).leaseToken,run);
    await db.billingOperation.update({where:{id:child(op)},data:{leaseUntil:new Date(0)}});await input.drainOperations();assert.equal((await get(op.id)).progress,'PARTIAL');
    cases.push('batch-stop-only-undispatched-company-preserves-running-lease-and-never-calls-partial-work-complete');

    op=await submit(await preview([0]));await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});
    try{await input.drainOperations();assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:child(op)}})).state,'BLOCKED');}
    finally{await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminRoleId}});}await retire(op);
    op=await submit(await preview([0]));onAccount=async()=>{onAccount=undefined;await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});};
    try{await input.drainOperations();assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:child(op)}})).state,'BLOCKED');}
    finally{onAccount=undefined;await db.membershipRole.upsert({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}},create:{membershipId:input.membershipId,roleId:input.adminRoleId},update:{}});}await retire(op);
    cases.push('batch-child-rechecks-current-initiator-before-worker-and-after-provider-io');

    op=await submit(await preview([0]));const replacement=randomUUID();onAccount=async()=>{onAccount=undefined;await db.billingOperation.update({where:{id:child(op)},data:{leaseToken:replacement,leaseUntil:new Date(Date.now()+60000),version:{increment:1}}});};
    await input.drainOperations();assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:child(op)}})).leaseToken,replacement);assert.equal((await get(op.id)).checked,0);
    await db.billingOperation.update({where:{id:child(op)},data:{leaseUntil:new Date(0)}});await input.drainOperations();assert.equal((await get(op.id)).checked,1);
    cases.push('batch-original-child-replacement-lease-blocks-stale-publication-and-recovers-once');

    op=await submit(await preview([0]));const observedTrigger=`batch_observed_${run.replace(/-/g,'')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${observedTrigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.operation.observed' AND NEW."targetId"='${child(op)}' THEN RAISE EXCEPTION 'synthetic observed audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${observedTrigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${observedTrigger}"()`);
    try{await input.drainOperations();const failed=await get(op.id);assert.equal(failed.checked,0);assert.equal(failed.review,1);assert.equal(failed.items[0].observedAt,null);}
    finally{await db.$executeRawUnsafe(`DROP TRIGGER "${observedTrigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${observedTrigger}"()`);}
    const retained=(await request(`/v1/system/billing/operations/${child(op)}`)).body;assert.equal((await request(`/v1/system/billing/operations/${child(op)}/retry`,'POST',{expectedVersion:retained.version})).status,200);
    await input.drainOperations();assert.equal((await get(op.id)).checked,1);
    const exportTrigger=`batch_export_${run.replace(/-/g,'')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${exportTrigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.batch.exported' AND NEW."targetId"='${op.id}' THEN RAISE EXCEPTION 'synthetic export audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${exportTrigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${exportTrigger}"()`);
    try{const denied=await request(`${base}/${op.id}/export`);assert.equal(denied.status,500);assert.equal(denied.body.csv,undefined);}
    finally{await db.$executeRawUnsafe(`DROP TRIGGER "${exportTrigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${exportTrigger}"()`);}
    assert.equal((await request(`${base}/${op.id}/export`)).status,200);
    cases.push('batch-real-observed-and-export-audit-failures-cannot-publish-success-or-release-file-original-retry-recovers');

    op=await preview();const roleId=randomUUID(),permissions=await db.permission.findMany({where:{key:{in:['system.billing.read','system.billing.reconcile.run','system.billing.export']}}});
    const priorRoles=await db.membershipRole.findMany({where:{membershipId:input.membershipId,role:{isSystem:true,scopeKey:'system',companyId:null}}});
    await db.role.create({data:{id:roleId,key:`BATCH_SCOPED_${run}`,scopeKey:'system',companyId:null,isSystem:true,name:'Synthetic batch operator',permissions:{create:permissions.map(p=>({permissionId:p.id}))}}});
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId}});await db.membershipRole.deleteMany({where:{membershipId:input.membershipId,roleId:{in:priorRoles.map(r=>r.roleId)}}});
    try{
      for(const companyId of companyIds.slice(0,2))await db.billingOperatorScope.create({data:{userId:input.userIds[0]!,companyId,stripeAccountId,livemode:false,createdByUserId:input.userIds[0]!}});
      assert.equal((await request(`${base}/${op.id}`)).status,200);
      const exportPermission=permissions.find(p=>p.key==='system.billing.export')!;await db.rolePermission.delete({where:{roleId_permissionId:{roleId,permissionId:exportPermission.id}}});
      assert.equal((await get(op.id)).canExport,false);assert.equal((await request(`${base}/${op.id}/export`)).status,403);
      await db.rolePermission.create({data:{roleId,permissionId:exportPermission.id}});
      await db.billingOperatorScope.updateMany({where:{userId:input.userIds[0],companyId:companyIds[1],stripeAccountId},data:{revokedAt:new Date()}});
      assert.equal((await request(`${base}/${op.id}`)).status,404);assert.equal((await request(`${base}/${op.id}/export`)).status,404);
      assert.equal((await request(`${base}/preview`,'POST',await selected())).status,404);
    }finally{await db.membershipRole.createMany({data:priorRoles.map(r=>({membershipId:r.membershipId,roleId:r.roleId})),skipDuplicates:true});await db.membershipRole.deleteMany({where:{roleId}});await db.rolePermission.deleteMany({where:{roleId}});await db.role.delete({where:{id:roleId}});await db.billingOperatorScope.deleteMany({where:{companyId:{in:companyIds},stripeAccountId}});}
    await cancel(op);cases.push('batch-current-scope-on-every-selected-company-read-submit-and-export-without-finance-leak');

    op=await preview(Array.from({length:25},(_,n)=>n));assert.equal(op.items.length,25);await cancel(op);
    while(ids.length<26)await cancel(await preview([2]));
    const history=(await request(base)).body;assert.equal(history.items.length,25);assert.ok(history.nextCursor);
    const more=(await request(`${base}?cursor=${history.nextCursor}`)).body;assert.ok(more.items.length>0);assert.ok(more.items.every((i:any)=>!history.items.some((h:any)=>h.id===i.id)));
    assert.equal((await request(`${base}?cursor=${randomUUID()}`)).status,404);assert.equal((await request(`${base}?all=true`)).status,400);
    cases.push('batch-max-25-companies-and-bounded-25-plus-one-parent-history-cursor-without-duplicate-results');

    if(browser){const page=browser.page;await page.setViewportSize({width:390,height:844});
      const press=async(name:string,route:string)=>{for(let i=0;i<3;i++){const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes(route));await page.getByRole('button',{name,exact:true}).click();const res=await response,value=await res.json();if(res.status()===429){assert.ok(value.retryAfterSeconds<=60);await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();await new Promise(r=>setTimeout(r,(value.retryAfterSeconds+1)*1000));continue;}assert.equal(res.status(),200,JSON.stringify(value));return value;}throw Error('Browser rate limit did not recover');};
      const delayed=async(pattern:string,method:string,label:string,leave:()=>Promise<void>)=>{
        let release!:()=>void,arrive!:(v:any)=>void,finish!:()=>void;const held=new Promise<void>(r=>release=r),done=new Promise<void>(r=>finish=r);
        await page.route(pattern,async r=>{if(r.request().method()!==method){await r.continue();return;}const res=await r.fetch(),value=await res.json();arrive({status:res.status(),value});if(res.status()===200)await held;await r.fulfill({response:res});if(res.status()===200)finish();});
        try{let accepted=false;for(let i=0;i<3;i++){const response=new Promise<any>(r=>arrive=r);await page.getByRole('button',{name:label,exact:true}).click();const result=await response;if(result.status===200){accepted=true;break;}
          assert.equal(result.status,429,JSON.stringify(result));assert.ok(Number.isInteger(result.value.retryAfterSeconds)&&result.value.retryAfterSeconds>=1&&result.value.retryAfterSeconds<=60);await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();await new Promise(r=>setTimeout(r,(result.value.retryAfterSeconds+1)*1000));}
          assert.ok(accepted,'delayed real request must pass its bounded rate limit');await leave();release();await done;
        }finally{release();await page.unroute(pattern);}
      };
      await page.goto(`${browser.origin}/system/billing`,{waitUntil:'domcontentloaded'});await page.getByRole('link',{name:'ตรวจหลายบริษัท',exact:true}).click();await page.getByLabel('ค้นหาบริษัท',{exact:true}).fill(`batch-${run}`);
      await page.getByRole('button',{name:'ค้นหา',exact:true}).click();await page.getByRole('checkbox',{name:companies[0]!.name,exact:true}).check();
      await page.getByRole('button',{name:'บริษัทหน้าถัดไป',exact:true}).click();await page.getByRole('checkbox',{name:companies[26]!.name,exact:true}).check();await page.getByLabel('เหตุผลการตรวจ',{exact:true}).fill('ตรวจจากมือถือและกลับงานเดิม');
      op=await press('ตรวจบริษัทที่เลือกก่อนยืนยัน','/batches/preview');ids.push(op.id);await page.waitForURL(new RegExp(op.id));await page.reload();await page.getByRole('heading',{name:'ตรวจบริษัทที่เลือกก่อนยืนยัน',exact:true}).waitFor();
      await press('ยืนยันตรวจ 2 บริษัท','/submit');await page.getByRole('heading',{name:'รอผลตรวจรายบริษัท',exact:true}).waitFor();await input.drainOperations();await page.getByRole('button',{name:'โหลดผลล่าสุด',exact:true}).click();await page.getByRole('heading',{name:'ได้ผลตรวจครบแล้ว',exact:true}).waitFor();
      const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'ดาวน์โหลดผลตรวจ',exact:true}).click();const download=await downloading,csv=await readFile((await download.path())!,'utf8');assert.match(csv,/'=บริษัททดสอบสูตร/);assert.ok(csv.includes(companies[26]!.name));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${browser.evidenceDir}/admin-batch-result-mobile.png`,fullPage:true});
      await page.getByRole('article',{name:companies[0]!.name,exact:true}).getByRole('link',{name:'เปิดคำขอเดิม',exact:true}).click();await page.getByRole('link',{name:'กลับงานตรวจหลายบริษัท',exact:true}).click();await page.waitForURL(new RegExp(op.id));
      await page.getByRole('article',{name:companies[0]!.name,exact:true}).getByRole('link',{name:'เปิดบริษัท',exact:true}).click();await page.getByRole('heading',{name:'การชำระเงินของบริษัท',exact:true}).waitFor();
      cases.push('browser-batch-mobile-search-pagination-selection-preview-reload-queue-worker-download-original-child-and-company-return');

      await page.goto(`${browser.origin}/system/billing/batches`,{waitUntil:'domcontentloaded'});await page.getByLabel('ค้นหาบริษัท',{exact:true}).fill(companyIds[0]!);await page.getByRole('button',{name:'ค้นหา',exact:true}).click();
      await page.getByRole('checkbox',{name:companies[0]!.name,exact:true}).check();await page.getByLabel('เหตุผลการตรวจ',{exact:true}).fill('เก็บงานเมื่อออกจากหน้าจอ');
      let release!:()=>void,arrive!:(v:any)=>void;const held=new Promise<void>(r=>release=r),route='**/api/v1/system/billing/batches/preview';
      await page.route(route,async r=>{const res=await r.fetch(),value=await res.json();arrive({status:res.status(),value});if(res.status()===200){ids.push(value.id);await held;}await r.fulfill({response:res});});
      let late:any;
      try{for(let i=0;i<3;i++){const response=new Promise<any>(r=>arrive=r);await page.getByRole('button',{name:'ตรวจบริษัทที่เลือกก่อนยืนยัน',exact:true}).click();const r=await response;if(r.status===200){late=r.value;break;}assert.equal(r.status,429);assert.ok(r.value.retryAfterSeconds<=60);await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();await new Promise(resolve=>setTimeout(resolve,(r.value.retryAfterSeconds+1)*1000));}assert.ok(late);
        await page.getByRole('link',{name:'บริษัท',exact:true}).click();await page.waitForURL(new RegExp('/system/billing$'));release();await page.getByRole('heading',{name:'ดูแลแพ็กเกจและการชำระเงิน',exact:true}).waitFor();assert.ok(page.url().endsWith('/system/billing'));
      }finally{release();await page.unroute(route);}
      await page.getByRole('link',{name:'ตรวจหลายบริษัท',exact:true}).click();await page.getByRole('article').filter({hasText:'เก็บงานเมื่อออกจากหน้าจอ'}).getByRole('link',{name:'เปิดงานตรวจเดิม',exact:true}).click();await page.waitForURL(new RegExp(late.id));
      await press('ยกเลิกคำขอนี้','/cancel');await page.getByRole('heading',{name:'หยุดคำขอแล้ว',exact:true}).waitFor();await page.screenshot({path:`${browser.evidenceDir}/admin-batch-stopped-mobile.png`,fullPage:true});
      cases.push('browser-batch-late-real-preview-cannot-navigate-after-leave-original-history-recovers-and-cancels');

      let downloads=0;const recordDownload=()=>{downloads++;};page.on('download',recordDownload);
      try{await delayed(`**/api/v1/system/billing/batches/${late.id}/export`,'GET','ดาวน์โหลดผลตรวจ',async()=>{await page.getByRole('link',{name:'บริษัท',exact:true}).click();await page.waitForURL(new RegExp('/system/billing$'));});
        await page.getByRole('heading',{name:'ดูแลแพ็กเกจและการชำระเงิน',exact:true}).waitFor();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));assert.equal(downloads,0);
      }finally{page.off('download',recordDownload);}
      cases.push('browser-batch-late-real-export-after-leave-never-downloads-file-on-destination');

      op=await submit(await preview([2]));const originalChild=child(op,2);await page.goto(`${browser.origin}/system/billing/operations/${originalChild}?batch=${op.id}`,{waitUntil:'domcontentloaded'});
      await page.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'}).waitFor();
      await delayed(`**/api/v1/system/billing/operations/${originalChild}/cancel`,'POST','ยกเลิกคำสั่งตรวจสอบ',async()=>{await page.getByRole('link',{name:'กลับงานตรวจหลายบริษัท',exact:true}).click();await page.waitForURL(new RegExp(op.id));});
      await page.getByRole('heading',{name:'หยุดคำขอแล้ว',exact:true}).waitFor();assert.ok(page.url().endsWith(op.id));
      await page.getByRole('link',{name:'เปิดคำขอเดิม',exact:true}).click();await page.getByRole('status').filter({hasText:'ยกเลิกคำสั่งตรวจสอบแล้ว'}).waitFor();
      assert.equal(await db.auditLog.count({where:{targetId:originalChild,action:'billing.operation.cancel'}}),1);
      cases.push('browser-original-batch-child-late-cancel-retains-once-only-outcome-and-current-parent-return');

      const caseRow=await db.billingIssue.create({data:{companyId:companyIds[2],stripeAccountId,livemode:false,kind:'RECONCILIATION_FAILED',referenceId:`case-${run}`}});extraCaseIds.push(caseRow.id);
      await page.goto(`${browser.origin}/system/billing/issues/${caseRow.id}`,{waitUntil:'domcontentloaded'});await page.getByLabel('บันทึกการดำเนินการ',{exact:true}).fill('รับงานเดิมก่อนออกจากหน้าจอ');
      await delayed(`**/api/v1/system/billing/issues/${caseRow.id}`,'PATCH','รับเคสนี้',async()=>{await page.getByRole('link',{name:'คิวตรวจสอบ',exact:true}).click();await page.waitForURL(new RegExp('/system/billing/issues$'));});
      await page.getByRole('heading',{name:'คิวตรวจสอบการชำระเงิน',exact:true}).waitFor();assert.ok(page.url().endsWith('/system/billing/issues'));
      await page.goto(`${browser.origin}/system/billing/issues/${caseRow.id}`,{waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'รายละเอียดเคส',exact:true}).getByText(/รับงานแล้ว/).first().waitFor();assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:caseRow.id}})).assigneeUserId,input.userIds[0]);
      cases.push('browser-original-case-late-real-save-cannot-overwrite-queue-and-original-assignment-survives-return');

      op=await submit(await preview([2]));const tabChild=child(op,2);await page.goto(`${browser.origin}/system/billing/operations/${tabChild}?batch=${op.id}`,{waitUntil:'domcontentloaded'});await page.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'}).waitFor();
      await delayed(`**/api/v1/system/billing/operations/${tabChild}/cancel`,'POST','ยกเลิกคำสั่งตรวจสอบ',async()=>{
        const opened=page.context().waitForEvent('page');await page.getByRole('link',{name:'กลับไปบริษัท',exact:true}).click({modifiers:[process.platform==='darwin'?'Meta':'Control']});const other=await opened;await other.waitForLoadState('domcontentloaded');await other.close();assert.ok(page.url().includes(tabChild));
      });await page.getByRole('status').filter({hasText:'ยกเลิกคำสั่งตรวจสอบแล้ว'}).waitFor();
      cases.push('browser-opening-original-company-in-another-tab-keeps-current-command-result-and-controls-live');
    }
    assert.deepEqual(await baseline(),before);cases.push('batch-no-new-charge-refund-paid-day-quota-or-capacity-edit');return cases;
  }catch(error){console.error(JSON.stringify({stage:'batches',completed:cases,path:browser?new URL(browser.page.url()).pathname:null}));if(browser)await browser.page.screenshot({path:`${browser.evidenceDir}/batch-failure.png`,fullPage:true});throw error;
  }finally{
    onAccount=undefined;input.transport();if(browser&&viewport)await browser.page.setViewportSize(viewport);
    const parents=await db.billingOperation.findMany({where:{id:{in:ids}}}),childIds=parents.flatMap(row=>((row.proposedJson as any).items??[]).map((item:any)=>item.childId));
    await db.auditLog.deleteMany({where:{targetId:{in:[...ids,...childIds,...extraCaseIds]}}});await db.billingIssue.deleteMany({where:{companyId:{in:companyIds},stripeAccountId}});
    await db.billingOperation.deleteMany({where:{id:{in:[...ids,...childIds]}}});await db.billingAccount.deleteMany({where:{companyId:{in:companyIds},stripeAccountId}});await db.company.deleteMany({where:{id:{in:companyIds}}});
  }
}
