import {ensureBillingCompanyProof} from './billing-configuration-drafts-smoke';
import { BILLING_TEST_ADDRESS } from './billing-profile-fixture';
import assert from 'node:assert/strict';
import {checkBillingFeatureControls} from './billing-feature-controls-smoke';
import {checkBillingFreeDays} from './billing-free-days-smoke';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';
import {receiptQuotaSnapshot} from '../modules/line-ai/application/company-ocr-governance';
import {assertBranchLimit,assertEmployeeLimit} from '../modules/system-partner-management/application/plan-term-limit';
import {lockPlanTermCompany} from '../modules/system-partner-management/application/lock-plan-term-company';
import {effectivePlanCapacity} from '../modules/system-partner-management/domain/logic/plan-capacity';
import {termProjectionHash} from '../modules/billing/domain/paid-invoice';
import {GetCompanyPlanTermUseCase,SetCompanyPlanTermUseCase} from '../modules/system-partner-management/application/use-cases/company-plan-term.use-cases';

/** Synthetic paid rows, actual HTTP/PostgreSQL/Next browser and shared admission; no native payment. */
export async function checkBillingPlanAdjustments(input:Parameters<typeof checkBillingConfigurationDrafts>[0]){
  const {prisma,request,approveRequest,password,browser,secondBrowser,stripeAccountId}=input,db=prisma.client;
  const companyId=`admin-plan-${randomUUID()}`,base='/v1/system/billing',path=`${base}/companies/${companyId}/plan-adjustments`;
  const now=new Date(),end=new Date(now.getTime()+30*86400000),giftEnd=new Date(now.getTime()+86400000);
  const cases:string[]=[],command=(op:any,action:string,actor=request)=>actor(`${base}/plan-adjustments/${op.id}/${action}`,'POST',
    {expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`plan-command-${op.id}`});
  let accountId:string|undefined,ownerRoleId:string|undefined,partnerRoleId:string|undefined,providerWrites=0;
  input.transport(async(url,init)=>{if(url.hostname==='api.stripe.com'&&init?.method&&init.method!=='GET'){providerWrites++;throw Error('Plan adjustment cannot write to Stripe');}return undefined;});
  try{
    await db.company.create({data:{id:companyId,name:'ร้านทดสอบสิทธิ์แพ็กเกจ',addressJson:BILLING_TEST_ADDRESS}});
    const sessionPermission=await db.permission.findUniqueOrThrow({where:{key:'account.session.read'}});
    const planPermission=await db.permission.findUniqueOrThrow({where:{key:'company.plan.manage'}});
    const role=await db.role.create({data:{companyId,scopeKey:companyId,key:'OWNER',name:'Synthetic plan owner',permissions:{create:[{permissionId:sessionPermission.id},{permissionId:planPermission.id}]}}});ownerRoleId=role.id;
    const owner=await db.companyMembership.create({data:{companyId,userId:input.userIds[0]!,roles:{create:{roleId:role.id}}}});
    await input.recordLegal(input.userIds[0]!,owner.id,companyId);
    const account=await db.billingAccount.create({data:{companyId,stripeAccountId,livemode:false,paidThrough:end,nextChargeAt:end,baseSubscriptionId:`sub_PlanFixture${randomUUID()}`}});accountId=account.id;
    const baseline=await db.companyPlanTerm.create({data:{companyId,tierKey:'BASIC_499',branchLimit:2,employeeLimit:5,monthlySlipLimit:50,termStartAt:now,termEndsAt:end,billingReceiptAccountId:account.id}});
    const purchase=await db.billingReceiptGrant.create({data:{companyId,billingAccountId:account.id,kind:'INITIAL',sourceKey:'TEST_ONLY_PAID_PLAN',sourceHash:'TEST_ONLY',units:50,
      serviceStart:now,serviceEnd:end,availableAt:now,expiresAt:end,policyRevisionId:'TEST_ONLY'}});
    await db.branch.createMany({data:[{companyId,code:'HQ',name:'สำนักงานใหญ่ทดสอบ',type:'HEAD_OFFICE'},{companyId,code:'SECOND',name:'สาขาทดสอบ',type:'BRANCH'}]});
    const review=async()=>{const r=await request(path);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
    const preview=async(extra:Record<string,unknown>={})=>request(`${path}/preview`,'POST',{type:'GRANT_OVERRIDE',tierKey:'PRO_999',branchLimit:5,employeeLimit:10,expiresAt:giftEnd.toISOString(),reason:'ช่วยร้านตามคำขอที่ตรวจแล้ว',sourceHash:(await review()).sourceHash,...extra});
    const customer=async()=>{const r=await request(`/v1/companies/${companyId}/billing`,'GET',undefined,{'x-company-id':companyId});assert.equal(r.status,200,JSON.stringify(r));assert.doesNotMatch(JSON.stringify(r.body),/ช่วยร้านตามคำขอที่ตรวจแล้ว|requesterName|approverName/);return r.body;};
    const approve=async(op:any)=>{const s=await command(op,'submit');assert.equal(s.status,200,JSON.stringify(s));const r=await command(s.body,'approve',approveRequest);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
    const originalAccount=await db.billingAccount.findUniqueOrThrow({where:{id:account.id}});
    const partnerPermissions=await Promise.all(['system.partner_dashboard.read','system.partner_company.update','system.company_onboarding.read','system.partner_feature.manage'].map(key=>db.permission.upsert({where:{key},create:{key,description:key},update:{}})));
    const partnerRole=await db.role.create({data:{key:`PLAN_REVIEW_${randomUUID()}`,scopeKey:'system',isSystem:true,companyId:null,name:'Synthetic plan Admin UI',permissions:{create:partnerPermissions.map(p=>({permissionId:p.id}))}}});partnerRoleId=partnerRole.id;
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:partnerRole.id}});
    if(process.env.BILLING_FEATURE_CONTROLS_ONLY==='1')return await checkBillingFeatureControls(input,companyId);
    const termHttp=await request(`/v1/system/partners/${companyId}/plan-term`);assert.equal(termHttp.status,200,JSON.stringify(termHttp));assert.equal(termHttp.body.term.paidPlan,true);
    const direct=await request(`/v1/system/partners/${companyId}/plan-term`,'PUT',{commandId:randomUUID(),reason:'ตรวจแพ็กเกจที่ชำระ',expectedVersion:(await new GetCompanyPlanTermUseCase(prisma).execute(companyId)).sourceVersion!,tierKey:'PRO_999',branchLimit:5,employeeLimit:10,monthlySlipLimit:100});assert.equal(direct.status,409,JSON.stringify(direct));assert.equal(direct.body.code,'paid_plan_review_required');
    const legacy=await db.packageChangeRequest.create({data:{companyId,requestedByUserId:input.userIds[0]!,requestedTierKey:'PRO_999'}});
    const queue=await request('/v1/system/package-change-requests');assert.equal(queue.status,200,JSON.stringify(queue));assert.equal(queue.body.items.find((i:any)=>i.id===legacy.id).billingReviewPath,`/system/billing/companies/${companyId}/plan-adjustments`);
    const legacyDecision=await request(`/v1/system/package-change-requests/${legacy.id}/decision`,'POST',{action:'APPROVE'});assert.equal(legacyDecision.status,409,JSON.stringify(legacyDecision));assert.equal((await db.packageChangeRequest.findUniqueOrThrow({where:{id:legacy.id}})).status,'OPEN');
    cases.push('admin-paid-plan-legacy-partner-and-line-queue-use-reviewed-path-without-changing-purchased-term');

    assert.equal((await review()).canCreate,true);assert.equal((await review()).unchanged.remainingReceipts,50);
    for(const extra of [{reason:''},{reason:'x'.repeat(501)},{branchLimit:0},{employeeLimit:1.5},{branchLimit:2147483648},{tierKey:'FREE_TRIAL_15'},{source:'STRIPE'},{expiresAt:'not-a-date'}])assert.equal((await preview(extra)).status,400);
    assert.equal((await preview({expiresAt:new Date(end.getTime()+1).toISOString()})).status,409);
    const first=await preview();assert.equal(first.status,200,JSON.stringify(first));
    await db.authSession.updateMany({where:{userId:{in:input.userIds.slice(0,2)}},data:{billingReauthenticatedAt:null,billingCredentialVersion:null}});
    assert.equal((await command(first.body,'submit')).status,409);
    for(const actor of [request,approveRequest])await ensureBillingCompanyProof(actor,companyId,password);
    const submitted=await command(first.body,'submit');assert.equal(submitted.status,200);assert.equal((await command(first.body,'submit')).body.id,first.body.id);
    assert.ok(submitted.body.allowedActions.includes('approve'));
    const applied=await command(submitted.body,'approve');assert.equal(applied.status,200,JSON.stringify(applied));assert.equal(applied.body.state,'SUCCEEDED');
    assert.equal(applied.body.approvalMode,'SINGLE_ADMIN');assert.equal(applied.body.approverUserId,input.userIds[0]);
    assert.equal((await command(submitted.body,'approve')).body.state,'SUCCEEDED');
    assert.equal(await db.auditLog.count({where:{companyId,action:'billing.plan_adjustment.approve'}}),1);
    const approvalAudit=await db.auditLog.findFirstOrThrow({where:{targetId:first.body.id,action:'billing.plan_adjustment.approve'}});assert.equal((approvalAudit.metadataJson as any).approvalMode,'SINGLE_ADMIN');
    assert.equal((await customer()).tierKey,'BASIC_499');assert.equal((await customer()).effectiveCapacity.tierKey,'PRO_999');assert.equal((await customer()).usage.remaining,50);
    assert.equal((await new GetCompanyPlanTermUseCase(prisma).execute(companyId)).term?.effectiveCapacity?.tierKey,'PRO_999');
    assert.equal((await receiptQuotaSnapshot(prisma,companyId,'2026-09')).tierKey,'PRO_999');
    assert.equal(termProjectionHash(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}})),termProjectionHash(baseline));
    await assert.rejects(new SetCompanyPlanTermUseCase(prisma).execute({companyId,tierKey:'PRO_999',branchLimit:5,employeeLimit:10,monthlySlipLimit:100,requestingAdminUserId:input.userIds[0]!,requestId:randomUUID(),commandId:randomUUID(),reason:'ตรวจแพ็กเกจที่ชำระ',expectedVersion:(await new GetCompanyPlanTermUseCase(prisma).execute(companyId)).sourceVersion!}), (e:any)=>e.getStatus()===409&&e.getResponse().code==='paid_plan_review_required');
    cases.push('admin-paid-plan-current-proof-single-admin-confirmation-replay-and-shared-web-line-projection');
    await assertBranchLimit(prisma,companyId);await assertEmployeeLimit(prisma,companyId);
    const lower=await preview({tierKey:'STARTER_249',branchLimit:1,employeeLimit:1,reason:'ลดเพดานโดยเก็บรายการเดิม'});assert.equal(lower.status,200);
    const lowered=await approve(lower.body);assert.equal(lowered.referenceId,first.body.id);assert.equal(lowered.activeBranches,2);
    await assert.rejects(assertBranchLimit(prisma,companyId),(e:any)=>e.getResponse().code==='plan_branch_limit_exceeded');await assert.rejects(assertEmployeeLimit(prisma,companyId),(e:any)=>e.getStatus()===422&&/1 คน/.test(e.message));
    assert.equal(await db.branch.count({where:{companyId,status:'ACTIVE'}}),2);assert.equal(await db.companyMembership.count({where:{companyId,status:'ACTIVE'}}),1);
    const revoke=await preview({type:'REVOKE_OVERRIDE',tierKey:undefined,branchLimit:undefined,employeeLimit:undefined,expiresAt:undefined,overrideId:lower.body.id});assert.equal(revoke.status,200);
    await approve(revoke.body);assert.equal((await customer()).effectiveCapacity.tierKey,'BASIC_499');await assertEmployeeLimit(prisma,companyId);
    assert.equal((await preview({type:'REVOKE_OVERRIDE',tierKey:undefined,branchLimit:undefined,employeeLimit:undefined,expiresAt:undefined,overrideId:first.body.id})).status,409);
    cases.push('admin-paid-plan-replacement-reduction-revocation-preserves-existing-capacity-and-never-revives-old-gift');
    const future=await preview();assert.equal(future.status,200);await approve(future.body);
    // Simulate a later paid projection at its own seam: the gift must survive only to its original end.
    await db.companyPlanTerm.update({where:{companyId},data:{tierKey:'PRO_999',branchLimit:8,employeeLimit:15,monthlySlipLimit:100,termEndsAt:new Date(end.getTime()+365*86400000)}});
    const upgraded=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}});assert.equal(effectivePlanCapacity(upgraded).branchLimit,5);
    assert.equal(effectivePlanCapacity(upgraded,giftEnd).branchLimit,8);assert.equal(effectivePlanCapacity(upgraded,giftEnd).temporary,undefined);
    await db.companyPlanTerm.update({where:{companyId},data:{tierKey:baseline.tierKey,branchLimit:baseline.branchLimit,employeeLimit:baseline.employeeLimit,monthlySlipLimit:baseline.monthlySlipLimit,termEndsAt:end}});
    cases.push('admin-paid-plan-expiry-seam-exposes-latest-paid-baseline-without-extending-gift');
    const stalePreview=await preview();assert.equal(stalePreview.status,200);
    const extra=await db.branch.create({data:{companyId,code:'STALE',name:'สาขาที่เพิ่มระหว่างตรวจ'}});
    assert.equal((await command(stalePreview.body,'submit')).status,409);assert.equal((await command(stalePreview.body,'cancel')).status,200);await db.branch.delete({where:{id:extra.id}});
    const hold=await preview();await db.company.update({where:{id:companyId},data:{status:'DISABLED'}});assert.equal((await command(hold.body,'submit')).status,409);
    assert.equal((await command(hold.body,'cancel')).status,200);await db.company.update({where:{id:companyId},data:{status:'ACTIVE'}});
    const expired=await preview();await db.billingOperation.update({where:{id:expired.body.id},data:{expiresAt:new Date(Date.now()-1)}});assert.equal((await command(expired.body,'submit')).status,409);assert.equal((await command(expired.body,'cancel')).status,200);
    assert.equal((await request(`${base}/companies/${input.companyId}/plan-adjustments?cursor=${first.body.id}`)).status,404);assert.equal((await request(`${path}?cursor[]=bad`)).status,400);
    cases.push('admin-paid-plan-stale-count-held-expired-review-cancel-and-company-cursor-boundaries');
    const permission=await preview(),permissionSubmit=await command(permission.body,'submit');assert.equal(permissionSubmit.status,200);
    const roles=await db.membershipRole.findMany({where:{membershipId:input.membershipId}});
    try{await db.membershipRole.deleteMany({where:{membershipId:input.membershipId}});assert.equal((await command(permissionSubmit.body,'approve',approveRequest)).status,403);}
    finally{await db.membershipRole.createMany({data:roles});}
    assert.equal((await command(permissionSubmit.body,'cancel')).status,200);
    const audit=await preview(),auditSubmit=await command(audit.body,'submit');assert.equal(auditSubmit.status,200);
    const beforeAudit=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),trigger=`plan_audit_${randomUUID().replace(/-/g,'')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.plan_adjustment.approve' AND NEW."targetId"='${audit.body.id}' THEN RAISE EXCEPTION 'synthetic plan audit failure'; END IF; RETURN NEW; END $$`);
    try{await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
      assert.equal((await command(auditSubmit.body,'approve',approveRequest)).status,500);assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),beforeAudit);
      assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:audit.body.id}})).state,'AWAITING_APPROVAL');
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);}
    assert.equal((await command(auditSubmit.body,'cancel')).status,200);
    cases.push('admin-paid-plan-final-requester-authority-and-atomic-audit-failure-rollback');
    // Shared Company lock serializes the same admission check used by branch creation/reactivation.
    const last=await preview({branchLimit:3});await approve(last.body);
    const add=()=>db.$transaction(async tx=>{await lockPlanTermCompany(tx,companyId);await assertBranchLimit({client:tx},companyId);return tx.branch.create({data:{companyId,code:randomUUID(),name:'สาขาสุดท้ายทดสอบ'}});});
    const race=await Promise.allSettled([add(),add()]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.branch.count({where:{companyId,status:'ACTIVE'}}),3);
    cases.push('admin-paid-plan-shared-company-lock-final-branch-slot-race');
    if(browser&&secondBrowser){
      const page=browser.page,other=browser.page,url=`${browser.origin}/system/billing/companies/${companyId}/plan-adjustments`;
      const click=async(p:typeof page,name:string,suffix:string)=>{for(let tries=0;;tries++){const pending=p.waitForResponse(r=>r.url().endsWith(suffix));await p.getByRole('button',{name,exact:true}).click();const r=await pending;
        if(r.status()!==429){assert.equal(r.status(),200,JSON.stringify(await r.json()));return;}assert.ok(tries<2);const body=await r.json();assert.ok(body.retryAfterSeconds<=60);await p.getByRole('alert').getByText(/รอ/).waitFor();await new Promise(resolve=>setTimeout(resolve,Math.min(60,body.retryAfterSeconds+1)*1000));}};
      for(const actor of [request,approveRequest])await ensureBillingCompanyProof(actor,companyId,password);
      await page.setViewportSize({width:390,height:844});
      await page.goto(`${browser.origin}/system/partners/${companyId}`,{waitUntil:'domcontentloaded'});
      await page.getByRole('link',{name:'ปรับแพ็กเกจชั่วคราวและดูประวัติ',exact:true}).click();await page.waitForURL(url);

      await page.getByRole('textbox',{name:'จำนวนสาขาสูงสุด',exact:true}).fill('1');await page.getByRole('textbox',{name:'จำนวนผู้ใช้สูงสุด รวมเจ้าของ',exact:true}).fill('2');
      await page.getByRole('textbox',{name:'เหตุผลที่ปรับสิทธิ์',exact:true}).fill('ปรับจากหน้าเว็บโดยเก็บสาขาเดิม');
      await click(page,'ตรวจสิทธิ์ก่อนส่งคำขอ',`/companies/${companyId}/plan-adjustments/preview`);await page.waitForURL(/\/system\/billing\/plan-adjustments\//);
      const opId=new URL(page.url()).pathname.split('/').pop()!;await page.getByText(/จำนวนที่ใช้อยู่เกินเพดานใหม่/).waitFor();
      await click(page,'บันทึกคำขอก่อนยืนยัน',`/plan-adjustments/${opId}/submit`);await page.getByRole('heading',{name:'รอยืนยันรายการ',exact:true}).waitFor();
      await other.goto(page.url(),{waitUntil:'domcontentloaded'});const approvePath=`/plan-adjustments/${opId}/approve`;
      await other.route(`**${approvePath}`,async route=>{const r=await route.fetch();assert.equal(r.status(),200);await route.abort('connectionreset');},{times:1});
      const failed=other.waitForEvent('requestfailed',r=>r.url().endsWith(approvePath));await other.getByRole('button',{name:'อนุมัติและปรับสิทธิ์',exact:true}).click();await failed;
      await click(other,'อนุมัติและปรับสิทธิ์',approvePath);await other.getByRole('heading',{name:'ปรับสิทธิ์แล้ว',exact:true}).waitFor();await other.getByText('ยืนยันโดยผู้ดูแลระบบคนเดียว',{exact:true}).waitFor();
      assert.equal(await db.auditLog.count({where:{targetId:opId,action:'billing.plan_adjustment.approve'}}),1);
      await other.getByRole('link',{name:'กลับไปประวัติการปรับแพ็กเกจ',exact:true}).click();await other.waitForURL(url);await other.getByRole('region',{name:'ประวัติการปรับแพ็กเกจ',exact:true}).waitFor();
      await other.reload({waitUntil:'domcontentloaded'});await other.getByText('เหตุผล: ปรับจากหน้าเว็บโดยเก็บสาขาเดิม',{exact:true}).waitFor();assert.equal(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await other.evaluate(()=>scrollTo(0,0));await other.screenshot({path:`${browser.evidenceDir}/admin-plan-adjustments-mobile.png`});
      for(const channel of ['web','line']){await page.goto(`${browser.origin}/companies/${companyId}/billing?channel=${channel}`,{waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'สิทธิ์แพ็กเกจชั่วคราว',exact:true}).waitFor();await page.getByText(/ใบเสร็จคงเหลือ 50 ใบ/).waitFor();}
      cases.push('browser-admin-plan-impact-single-admin-confirmation-response-loss-history-reload-and-web-line-current-rights');
    }
    const finalTerm=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}});assert.equal(termProjectionHash(finalTerm),termProjectionHash(baseline));
    assert.deepEqual(await db.billingAccount.findUniqueOrThrow({where:{id:account.id}}),originalAccount);assert.deepEqual(await db.billingReceiptGrant.findUniqueOrThrow({where:{id:purchase.id}}),purchase);
    assert.equal(await db.billingInvoice.count({where:{billingAccountId:account.id}}),0);assert.equal(providerWrites,0);
    cases.push('admin-paid-plan-preserves-paid-hash-dates-collection-receipts-and-fiscal-evidence');
    cases.push(...await checkBillingFreeDays(input,companyId,account.id));
    cases.push(...await checkBillingFeatureControls(input,companyId));return cases;
  }finally{
    input.transport();if(partnerRoleId){await db.membershipRole.deleteMany({where:{roleId:partnerRoleId}});await db.rolePermission.deleteMany({where:{roleId:partnerRoleId}});await db.role.deleteMany({where:{id:partnerRoleId}});}
    await db.packageChangeRequest.deleteMany({where:{companyId}});await db.companyPlanTerm.deleteMany({where:{companyId}});await db.billingReceiptGrant.deleteMany({where:{companyId}});await db.billingOperation.deleteMany({where:{companyId}});await db.auditLog.deleteMany({where:{companyId}});
    if(accountId)await db.billingAccount.deleteMany({where:{id:accountId}});await db.membershipRole.deleteMany({where:{membership:{companyId}}});await db.companyMembership.deleteMany({where:{companyId}});
    if(ownerRoleId){await db.rolePermission.deleteMany({where:{roleId:ownerRoleId}});await db.role.deleteMany({where:{id:ownerRoleId}});}
    await db.branch.deleteMany({where:{companyId}});await db.company.deleteMany({where:{id:companyId}});
  }
}
