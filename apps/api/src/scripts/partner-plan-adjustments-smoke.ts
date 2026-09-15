import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';
import {assertBranchLimit} from '../modules/system-partner-management/application/plan-term-limit';
import {receiptQuotaSnapshot} from '../modules/line-ai/application/company-ocr-governance';

/** Actual local API/database/browser; no payment, mail or LINE transport is needed. */
export async function checkPartnerPlanAdjustments(input:Parameters<typeof checkBillingConfigurationDrafts>[0]) {
  const {prisma,request,approveRequest,browser}=input,db=prisma.client,companyId=`manual-plan-${randomUUID()}`,base=`/v1/system/partners/${companyId}/plan-term`,cases:string[]=[];
  const roles:string[]=[],members:string[]=[],foreignAudits:string[]=[],viewport=browser?.page.viewportSize();let accountId:string|undefined;
  const read=async()=>{const r=await request(base);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const body=async(extra:Record<string,unknown>={})=>({commandId:randomUUID(),expectedVersion:(await read()).sourceVersion,reason:'ผู้ดูแลช่วยร้านเริ่มใช้งาน',...extra});
  const renew=async(value:any,actor=request)=>actor(`${base}/renew`,'POST',value);
  try {
    await db.company.create({data:{id:companyId,name:'ร้านทดสอบประวัติแพ็กเกจ',status:'ACTIVE'}});
    const keys=['system.partner_dashboard.read','system.partner_company.update','system.company_onboarding.read'];
    const permissions=await Promise.all(keys.map(key=>db.permission.upsert({where:{key},create:{key,description:key},update:{}})));
    const role=await db.role.create({data:{key:`MANUAL_PLAN_${randomUUID()}`,scopeKey:'system',companyId:null,isSystem:true,name:'Synthetic manual plan operator',permissions:{create:permissions.map(p=>({permissionId:p.id}))}}});roles.push(role.id);
    const actorMemberships=await db.companyMembership.findMany({where:{companyId:input.companyId,userId:{in:input.userIds}},select:{id:true}});
    await db.membershipRole.createMany({data:actorMemberships.map(m=>({membershipId:m.id,roleId:role.id}))});
    const ownerRole=await db.role.create({data:{key:'OWNER',scopeKey:companyId,companyId,name:'Synthetic owner'}});roles.push(ownerRole.id);
    const owner=await db.companyMembership.create({data:{companyId,userId:input.userIds[0]!,roles:{create:{roleId:ownerRole.id}}}});members.push(owner.id);
    await input.recordLegal(input.userIds[0]!,owner.id,companyId);
    await db.branch.createMany({data:[{companyId,code:'HQ',name:'สำนักงานใหญ่',type:'HEAD_OFFICE'},{companyId,code:'BR',name:'สาขาเดิม',type:'BRANCH'}]});
    const absent=await read();assert.equal(absent.term,null);assert.equal(absent.activeBranches,2);assert.equal(absent.activeMembers,1);
    const create=await body({tierKey:'FREE_TRIAL_15',branchLimit:2,employeeLimit:2,monthlySlipLimit:15,termDays:30});
    for(const extra of [{reason:''},{reason:'x'.repeat(501)},{commandId:undefined},{expectedVersion:undefined},{source:'STRIPE'}])
      assert.ok([400,422].includes((await request(base,'PUT',{...create,...extra})).status));
    const created=await request(base,'PUT',create);assert.equal(created.status,200,JSON.stringify(created));assert.equal(created.body.term.monthlySlipLimit,15);
    assert.equal((await request(base,'PUT',create)).body.replayed,true);assert.equal(await db.auditLog.count({where:{companyId,action:'system.company_plan_term.set'}}),1);
    cases.push('manual-plan-required-reason-command-and-explicit-absent-source-create-replay');

    const original=await body({days:14}),before=await read();
    const [first,repeat]=await Promise.all([renew(original),renew(original)]);assert.equal(first.status,200,JSON.stringify(first));assert.equal(repeat.status,200,JSON.stringify(repeat));
    const after=await read();assert.equal(Date.parse(after.term.termEndsAt)-Date.parse(before.term.termEndsAt),14*86400000);assert.equal(after.term.renewCount,1);
    assert.equal((await renew({...original,days:15})).status,409);assert.equal((await renew(original,approveRequest)).status,409);
    assert.equal((await renew({...original,commandId:randomUUID()})).status,409);assert.equal(await db.auditLog.count({where:{companyId,action:'system.company_plan_term.renew'}}),1);
    cases.push('manual-renew-concurrent-original-command-one-extension-fresh-http-correlation-and-actor-body-source-conflicts');

    const change=await body({tierKey:'STARTER_249',branchLimit:1,employeeLimit:2,monthlySlipLimit:30});
    const [a,b]=await Promise.all([request(base,'PUT',change),request(base,'PUT',{...change,commandId:randomUUID(),monthlySlipLimit:40})]);
    assert.deepEqual([a.status,b.status].sort(),[200,409]);assert.equal(await db.branch.count({where:{companyId,status:'ACTIVE'}}),2);await assert.rejects(assertBranchLimit(prisma,companyId));
    const prior=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),fault=await body({days:9}),trigger=`manual_audit_${randomUUID().replaceAll('-','')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='system.company_plan_term.renew' AND NEW."companyId"='${companyId}' THEN RAISE EXCEPTION 'synthetic manual audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
    try{assert.equal((await renew(fault)).status,500);assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),prior);}
    finally{await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);}
    assert.equal((await renew(fault)).status,200);
    cases.push('manual-plan-current-source-cas-retains-resources-and-real-audit-failure-rolls-back-days');

    const legacy=await db.packageChangeRequest.create({data:{companyId,requestedByUserId:input.userIds[0]!,requestedTierKey:'BASIC_499'}});
    const beforeLine=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),lineTrigger=`manual_line_${randomUUID().replaceAll('-','')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${lineTrigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='signup.line.package_change_decided' AND NEW."companyId"='${companyId}' THEN RAISE EXCEPTION 'synthetic LINE decision audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${lineTrigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${lineTrigger}"()`);
    try{assert.equal((await request(`/v1/system/package-change-requests/${legacy.id}/decision`,'POST',{action:'APPROVE'})).status,500);
      assert.equal((await db.packageChangeRequest.findUniqueOrThrow({where:{id:legacy.id}})).status,'OPEN');assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),beforeLine);
      assert.equal(await db.auditLog.count({where:{companyId,metadataJson:{path:['packageChangeRequestId'],equals:legacy.id}}}),0);
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER "${lineTrigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${lineTrigger}"()`);}
    const [line,lineReplay]=await Promise.all([request(`/v1/system/package-change-requests/${legacy.id}/decision`,'POST',{action:'APPROVE'}),request(`/v1/system/package-change-requests/${legacy.id}/decision`,'POST',{action:'APPROVE'})]);
    assert.equal(lineReplay.status,200);assert.equal(await db.auditLog.count({where:{companyId,metadataJson:{path:['packageChangeRequestId'],equals:legacy.id}}}),1);
    cases.push('manual-line-request-term-and-both-audits-commit-together-or-rollback-open-concurrent-replay-once');
assert.equal(line.status,200,JSON.stringify(line));
    const history=await request(`${base}/history`);assert.equal(history.status,200,JSON.stringify(history));const source=history.body.items.find((i:any)=>i.requestId===legacy.id);assert.equal(source.source,'LINE_PACKAGE_REQUEST');assert.equal(source.actorId,input.userIds[0]);assert.ok(source.reason);
    assert.equal((await receiptQuotaSnapshot(prisma,companyId,'2026-09')).planLimit,50);
    const current=await read(),stale=await body({tierKey:'PRO_999',branchLimit:5,employeeLimit:10,monthlySlipLimit:100});
    const account=await db.billingAccount.create({data:{companyId,stripeAccountId:input.stripeAccountId,livemode:false}});accountId=account.id;
    await db.companyPlanTerm.update({where:{companyId},data:{billingReceiptAccountId:account.id}});
    assert.equal((await request(base,'PUT',stale)).body.code,'partner_plan_term_changed');
    assert.equal((await request(base,'PUT',{...stale,commandId:randomUUID(),expectedVersion:(await read()).sourceVersion})).body.code,'paid_plan_review_required');
    assert.equal((await read()).term.tierKey,current.term.tierKey);await db.companyPlanTerm.update({where:{companyId},data:{billingReceiptAccountId:null}});
    assert.equal((await request(`${base}/history?cursor=foreign-cursor`)).status,404);
    const foreign=await db.auditLog.create({data:{companyId:input.companyId,actorUserId:input.userIds[0],action:'system.company_plan_term.set',targetType:'company_plan_term',targetId:input.companyId,requestId:randomUUID(),result:'SUCCESS'}});foreignAudits.push(foreign.id);
    assert.equal((await request(`${base}/history?cursor=${foreign.id}`)).status,404);
    const historyIds=Array.from({length:26},()=>randomUUID());
    await db.auditLog.createMany({data:historyIds.map(id=>({id,companyId,actorUserId:input.userIds[0],action:'system.company_plan_term.set',targetType:'company_plan_term',targetId:companyId,requestId:randomUUID(),result:'SUCCESS' as const,createdAt:new Date('2026-01-01'),metadataJson:{from:{monthlySlipLimit:15},to:{monthlySlipLimit:30},password:'do-not-expose',nativeCustomerId:'do-not-expose'}}))});
    const firstPage=await request(`${base}/history`);assert.equal(firstPage.body.items.length,25);assert.ok(firstPage.body.nextCursor);assert.doesNotMatch(JSON.stringify(firstPage.body),/do-not-expose|fingerprint|expectedVersion/);
    const secondPage=await request(`${base}/history?cursor=${firstPage.body.nextCursor}`);assert.equal(secondPage.status,200);assert.ok(secondPage.body.items.length>0);assert.ok(secondPage.body.items.every((v:any)=>!firstPage.body.items.some((i:any)=>i.id===v.id)));
    await db.auditLog.deleteMany({where:{id:{in:historyIds}}});
    cases.push('manual-plan-original-line-request-provenance-shared-quota-and-concurrent-paid-conversion-refused');
    cases.push('manual-plan-safe-history-25-row-pages-and-foreign-company-cursor-refusal');

    if(browser){const page=browser.page;await page.setViewportSize({width:390,height:844});
      await page.goto(`${browser.origin}/system/partners/${companyId}`,{waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'แก้ไขแพ็กเกจ',exact:true}).click();await page.getByLabel('เหตุผลที่ปรับแพ็กเกจ',{exact:true}).fill('ช่วยร้านจากการติดต่อฝ่ายบริการ');await page.locator('#plan-monthlySlipLimit').fill('65');
      const route=`**/api/v1/system/partners/${companyId}/plan-term`;let dropped=false,commandId='';
      await page.route(route,async r=>{if(r.request().method()!=='PUT'||dropped){await r.continue();return;}const payload=r.request().postDataJSON(),res=await r.fetch();assert.equal(res.status(),200);commandId=payload.commandId;dropped=true;await r.abort('failed');});
      try{await page.getByRole('button',{name:'บันทึก',exact:true}).click();await page.getByRole('button',{name:'ตรวจและลองคำขอเดิม',exact:true}).waitFor();assert.equal(await page.locator('#plan-monthlySlipLimit').isDisabled(),true);
        await page.getByRole('button',{name:'ตรวจและลองคำขอเดิม',exact:true}).click();await page.getByRole('button',{name:'แก้ไขแพ็กเกจ',exact:true}).waitFor();
        assert.equal(await db.auditLog.count({where:{companyId,metadataJson:{path:['commandId'],equals:commandId}}}),1);
      }finally{await page.unroute(route);}
      await page.getByRole('button',{name:'ต่ออายุ',exact:true}).click();await page.getByLabel('เหตุผลที่ต่ออายุ',{exact:true}).fill('ชดเชยวันที่ร้านเริ่มใช้ไม่ได้');
      const dialog=page.getByRole('dialog'),renewRoute=`**/api/v1/system/partners/${companyId}/plan-term/renew`;let lostRenew=false,renewCommand='';const beforeRenew=(await read()).term;
      await page.route(renewRoute,async r=>{if(lostRenew){await r.continue();return;}const payload=r.request().postDataJSON(),res=await r.fetch();assert.equal(res.status(),200);renewCommand=payload.commandId;lostRenew=true;await r.abort('failed');});
      try{await dialog.getByRole('button',{name:'ต่ออายุ',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'ยังยืนยันผลไม่ได้'}).waitFor();
        await dialog.getByRole('button',{name:'ตรวจและลองคำขอเดิม',exact:true}).click();await dialog.waitFor({state:'hidden'});
        assert.equal(await db.auditLog.count({where:{companyId,metadataJson:{path:['commandId'],equals:renewCommand}}}),1);
        assert.equal(Date.parse((await read()).term.termEndsAt)-Date.parse(beforeRenew.termEndsAt),30*86400000);
      }finally{await page.unroute(renewRoute);}
      await page.reload();const panel=page.getByRole('region',{name:'ประวัติการปรับแพ็กเกจและวันใช้งาน',exact:true});await panel.getByText('เหตุผล: ชดเชยวันที่ร้านเริ่มใช้ไม่ได้',{exact:true}).waitFor();
      await panel.getByText('เหตุผล: ช่วยร้านจากการติดต่อฝ่ายบริการ',{exact:true}).waitFor();await panel.evaluate(el=>el.scrollIntoView({block:'start'}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${browser.evidenceDir}/admin-manual-plan-history-mobile.png`,fullPage:false});
      await page.goto(`${browser.origin}/system/partners/${companyId}`,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'แก้ไขแพ็กเกจ',exact:true}).click();await page.getByLabel('เหตุผลที่ปรับแพ็กเกจ',{exact:true}).fill('ตรวจข้อมูลเดิมที่เปิดค้างไว้');
      assert.equal((await renew(await body({days:1}))).status,200);await page.getByRole('button',{name:'บันทึก',exact:true}).click();await page.getByRole('button',{name:'แก้ไขแพ็กเกจ',exact:true}).waitFor();
      assert.equal(await page.getByLabel('เหตุผลที่ปรับแพ็กเกจ',{exact:true}).count(),0);
      cases.push('browser-manual-plan-immutable-response-loss-retry-once-reason-renew-history-reload-stale-recovery-and-mobile');
    }
    assert.equal(await db.billingInvoice.count({where:{billingAccountId:accountId}}),0);assert.equal(await db.billingReceiptGrant.count({where:{companyId}}),0);
    return cases;
  }finally{
    if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await db.packageChangeRequest.deleteMany({where:{companyId}});await db.auditLog.deleteMany({where:{OR:[{companyId},{id:{in:foreignAudits}}]}});await db.companyPlanTerm.deleteMany({where:{companyId}});
    if(accountId)await db.billingAccount.deleteMany({where:{id:accountId}});await db.membershipRole.deleteMany({where:{OR:[{roleId:{in:roles}},{membershipId:{in:members}}]}});
    await db.companyMembership.deleteMany({where:{companyId}});await db.rolePermission.deleteMany({where:{roleId:{in:roles}}});await db.role.deleteMany({where:{id:{in:roles}}});
    await db.branch.deleteMany({where:{companyId}});await db.company.deleteMany({where:{id:companyId}});
  }
}
