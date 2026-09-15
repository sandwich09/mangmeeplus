import {ensureBillingCompanyProof} from './billing-configuration-drafts-smoke';
import {checkManualReceiptAdjustments} from './manual-receipt-adjustments-smoke';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';
import {admitCompanyOcr} from '../modules/line-ai/application/company-ocr-governance';
import {bangkokMonthKey} from '../modules/line-ai/application/company-ai-usage-meter';

/** Actual HTTP/DB/browser; paid source rows and OCR provider boundary are explicitly synthetic. */
export async function checkBillingReceiptAdjustments(input:Parameters<typeof checkBillingConfigurationDrafts>[0]){
  const {prisma,request,approveRequest,password,browser,secondBrowser,stripeAccountId}=input,db=prisma.client;
  const companyId=`admin-receipts-${randomUUID()}`,base='/v1/system/billing',path=`${base}/companies/${companyId}/receipt-adjustments`;
  const now=new Date(),end=new Date(now.getTime()+30*86400000),monthKey=bangkokMonthKey();
  const cases:string[]=[],command=(op:any,action:string,actor=request)=>actor(`${base}/receipt-adjustments/${op.id}/${action}`,'POST',
    {expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`receipt-command-${op.id}`});
  let accountId:string|undefined,ownerRoleId:string|undefined,providerWrites=0;
  input.transport(async(url,init)=>{if(url.hostname==='api.stripe.com'&&init?.method&&init.method!=='GET'){providerWrites++;throw Error('Receipt adjustment cannot write to Stripe');}return undefined;});
  try {
    await db.company.create({data:{id:companyId,name:'ร้านทดสอบสิทธิ์ใบเสร็จ'}});
    const sessionPermission=await db.permission.findUniqueOrThrow({where:{key:'account.session.read'}});
    const ownerRole=await db.role.create({data:{companyId,scopeKey:companyId,key:'OWNER',name:'Synthetic receipt owner',permissions:{create:{permissionId:sessionPermission.id}}}});ownerRoleId=ownerRole.id;
    const owner=await db.companyMembership.create({data:{companyId,userId:input.userIds[0]!,roles:{create:{roleId:ownerRole.id}}}});
    await input.recordLegal(input.userIds[0]!,owner.id,companyId);
    cases.push(...await checkManualReceiptAdjustments(input,companyId));
    const account=await db.billingAccount.create({data:{companyId,stripeAccountId,livemode:false,paidThrough:end,nextChargeAt:end,baseSubscriptionId:`sub_ReceiptFixture${randomUUID()}`}});accountId=account.id;
    await db.companyPlanTerm.create({data:{companyId,tierKey:'PRO_999',branchLimit:5,employeeLimit:10,monthlySlipLimit:100,
      termStartAt:now,termEndsAt:end,billingReceiptAccountId:account.id}});
    const purchased=await db.billingReceiptGrant.create({data:{companyId,billingAccountId:account.id,kind:'INITIAL',sourceKey:'TEST_ONLY_ORIGINAL_PURCHASE',sourceHash:'TEST_ONLY',units:2,
      serviceStart:now,serviceEnd:end,availableAt:now,expiresAt:end,policyRevisionId:'TEST_ONLY'}});
    const admission=(sourceRoute:'receipt-ocr-web'|'receipt-ocr-line')=>admitCompanyOcr(prisma,{companyId,sourceRoute,requestId:randomUUID(),monthKey,enforceReceiptQuota:true});
    assert.equal((await admission('receipt-ocr-web')).allowed,true);assert.equal((await admission('receipt-ocr-line')).allowed,true);assert.equal((await admission('receipt-ocr-web')).allowed,false);
    const originalTerm=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),originalAccount=await db.billingAccount.findUniqueOrThrow({where:{id:account.id}});
    const customer=async()=>{const r=await request(`/v1/companies/${companyId}/billing`,'GET',undefined,{'x-company-id':companyId});assert.equal(r.status,200,JSON.stringify(r));assert.doesNotMatch(JSON.stringify(r.body),/ช่วยร้านตามคำขอที่ตรวจแล้ว|requesterName|approverName/);return r.body;};
    const review=async()=>{const r=await request(path);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
    const preview=async(extra:Record<string,unknown>={})=>request(`${path}/preview`,'POST',{type:'GRANT_RECEIPTS',units:5,expiresAt:end.toISOString(),reason:'ช่วยร้านตามคำขอที่ตรวจแล้ว',sourceHash:(await review()).sourceHash,...extra});
    assert.equal((await review()).canCreate,true);
    await db.companyAiConfiguration.create({data:{companyId,ocrEnabled:false,ocrMonthlyLimit:1,monthlyBudgetSatang:1}});
    await db.companyAiMonthlyUsage.create({data:{companyId,monthKey,costSatang:1}});
    assert.deepEqual((await review()).readWarnings,['OCR_DISABLED','OCR_LIMIT_REACHED','AI_BUDGET_REACHED']);
    await db.companyAiConfiguration.delete({where:{companyId}});await db.companyAiMonthlyUsage.delete({where:{companyId_monthKey:{companyId,monthKey}}});
    cases.push('admin-paid-receipts-review-shows-current-disabled-read-limit-and-budget-impact');
    for(const extra of [{reason:''},{reason:'x'.repeat(501)},{units:0},{units:1.5},{units:2147483648},{source:'STRIPE'},{expiresAt:'10/12/2027'},{expiresAt:'not-a-date'},{type:'REVOKE_RECEIPTS',units:undefined,expiresAt:undefined,grantId:'wrong-id'}])assert.equal((await preview(extra)).status,400);
    assert.equal((await preview({expiresAt:new Date(end.getTime()+1000).toISOString()})).status,409);
    const first=await preview();assert.equal(first.status,200,JSON.stringify(first));
    // Other scenarios in the combined run can leave this same synthetic session's proof valid.
    await db.authSession.updateMany({where:{userId:{in:input.userIds.slice(0,2)}},data:{billingReauthenticatedAt:null,billingCredentialVersion:null}});
    assert.equal((await command(first.body,'submit')).status,409,'current password proof required');
    for(const actor of [request,approveRequest])await ensureBillingCompanyProof(actor,companyId,password);
    const submitted=await command(first.body,'submit');assert.equal(submitted.status,200,JSON.stringify(submitted));
    assert.equal(submitted.body.state,'AWAITING_APPROVAL');assert.equal((await command(first.body,'submit')).body.id,first.body.id);
    assert.equal((await command(submitted.body,'approve')).status,403);
    const applied=await command(submitted.body,'approve',approveRequest);assert.equal(applied.status,200,JSON.stringify(applied));assert.equal(applied.body.state,'SUCCEEDED');
    const grantId=applied.body.grant.id;assert.equal(applied.body.observedRemaining,5);assert.equal((await customer()).usage.remaining,5);
    assert.equal((await command(submitted.body,'approve',approveRequest)).body.state,'SUCCEEDED');
    assert.equal(await db.billingReceiptGrant.count({where:{companyId,kind:'ADMIN_ADJUSTMENT'}}),1);
    assert.equal(await db.auditLog.count({where:{companyId,action:'billing.receipt_adjustment.approve'}}),1);
    cases.push('admin-paid-receipts-reason-validation-expiry-password-independent-approval-replay');
    assert.equal((await admission('receipt-ocr-web')).allowed,true);assert.equal((await admission('receipt-ocr-line')).allowed,true);
    assert.equal((await review()).remaining,3);assert.equal((await customer()).usage.remaining,3);
    const revoke=await preview({type:'REVOKE_RECEIPTS',units:undefined,expiresAt:undefined,grantId,reason:'ถอนเฉพาะใบที่ยังไม่ใช้'});assert.equal(revoke.status,200);
    const revokeSubmit=await command(revoke.body,'submit');assert.equal(revokeSubmit.status,200);
    const revoked=await command(revokeSubmit.body,'approve',approveRequest);assert.equal(revoked.status,200);assert.equal(revoked.body.observedRemaining,0);
    assert.equal((await customer()).usage.remaining,0);
    assert.equal(revoked.body.grant.used,2);assert.equal(revoked.body.grant.remaining,0);
    assert.equal((await admission('receipt-ocr-web')).allowed,false);assert.equal((await admission('receipt-ocr-line')).allowed,false);
    assert.equal((await preview({type:'REVOKE_RECEIPTS',units:undefined,expiresAt:undefined,grantId:purchased.id})).status,404);
    assert.equal(await db.companyOcrUsageEvent.count({where:{companyId,billingReceiptGrantId:grantId}}),2);
    cases.push('admin-paid-receipts-web-line-admission-and-revoke-preserve-consumption-and-paid-grant');
    const stalePreview=await preview();assert.equal(stalePreview.status,200);
    await db.company.update({where:{id:companyId},data:{status:'DISABLED'}});
    assert.equal((await command(stalePreview.body,'submit')).status,409);
    assert.equal((await command(stalePreview.body,'cancel')).status,200);
    await db.company.update({where:{id:companyId},data:{status:'ACTIVE'}});
    const expiredPreview=await preview();assert.equal(expiredPreview.status,200);
    await db.billingOperation.update({where:{id:expiredPreview.body.id},data:{expiresAt:new Date(Date.now()-1000)}});
    assert.equal((await command(expiredPreview.body,'submit')).status,409);assert.equal((await command(expiredPreview.body,'cancel')).status,200);
    const foreign=await request(`${base}/companies/${input.companyId}/receipt-adjustments?cursor=${first.body.id}`);assert.equal(foreign.status,404);
    assert.equal((await request(`${path}?cursor[]=bad`)).status,400);
    cases.push('admin-paid-receipts-hold-stale-expired-review-cancel-and-foreign-history');
    const permissionPreview=await preview();assert.equal(permissionPreview.status,200);
    const permissionSubmit=await command(permissionPreview.body,'submit');assert.equal(permissionSubmit.status,200);
    const memberships=await db.membershipRole.findMany({where:{membershipId:input.membershipId}});
    try {
      await db.membershipRole.deleteMany({where:{membershipId:input.membershipId}});
      assert.equal((await command(permissionSubmit.body,'approve',approveRequest)).status,403);
      assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:permissionSubmit.body.id}})).state,'AWAITING_APPROVAL');
    }finally{await db.membershipRole.createMany({data:memberships});}
    assert.equal((await command(permissionSubmit.body,'cancel')).status,200);
    cases.push('admin-paid-receipts-approval-rechecks-withdrawn-requester-authority');
    const auditPreview=await preview(),auditSubmit=await command(auditPreview.body,'submit');assert.equal(auditSubmit.status,200);
    const trigger=`receipt_audit_${randomUUID().replace(/-/g,'')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.receipt_adjustment.approve' AND NEW."targetId"='${auditSubmit.body.id}' THEN RAISE EXCEPTION 'synthetic receipt audit failure'; END IF; RETURN NEW; END $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
      assert.equal((await command(auditSubmit.body,'approve',approveRequest)).status,500);
      assert.equal(await db.billingReceiptGrant.count({where:{sourceKey:auditSubmit.body.id}}),0);
      assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:auditSubmit.body.id}})).state,'AWAITING_APPROVAL');
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${trigger}"()`);}
    assert.equal((await command(auditSubmit.body,'cancel')).status,200);
    cases.push('admin-paid-receipts-audit-failure-rolls-back-grant-and-operation');
    if(browser&&secondBrowser){
      const page=browser.page,other=secondBrowser.pages()[0]!,url=`${browser.origin}/system/billing/companies/${companyId}/receipt-adjustments`;
      await db.companyAiConfiguration.create({data:{companyId,ocrEnabled:false}});
      await page.setViewportSize({width:390,height:844});await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.getByText('ร้านนี้ปิดการอ่านเอกสารด้วย AI อยู่',{exact:true}).waitFor();
      await page.getByRole('textbox',{name:'เพิ่มใบเสร็จจำนวน',exact:true}).fill('7');
      await page.getByRole('textbox',{name:'เหตุผลที่ปรับใบเสร็จ',exact:true}).fill('เพิ่มจากหน้าเว็บให้เจ้าของร้าน');
      for(let tries=0;;tries++){
        const response=page.waitForResponse(r=>r.url().endsWith(`/companies/${companyId}/receipt-adjustments/preview`));
        await page.getByRole('button',{name:'ตรวจจำนวนก่อนส่งคำขอ',exact:true}).click();const result=await response;
        if(result.status()!==429){assert.equal(result.status(),200,JSON.stringify(await result.json()));break;}
        assert.ok(tries<2);const body=await result.json();assert.ok(Number.isInteger(body.retryAfterSeconds)&&body.retryAfterSeconds<=60);
        await page.getByRole('alert').getByText(/รอ/).waitFor();
        assert.equal(await page.getByRole('textbox',{name:'เหตุผลที่ปรับใบเสร็จ',exact:true}).inputValue(),'เพิ่มจากหน้าเว็บให้เจ้าของร้าน');
        await new Promise(resolve=>setTimeout(resolve,Math.min(60,body.retryAfterSeconds+1)*1000));
      }
      await page.waitForURL(/\/system\/billing\/receipt-adjustments\//);
      const opId=new URL(page.url()).pathname.split('/').pop()!;
      for(let tries=0;;tries++){
        const response=page.waitForResponse(r=>r.url().endsWith(`/receipt-adjustments/${opId}/submit`));
        await page.getByRole('button',{name:'ส่งคำขอให้ผู้อนุมัติ',exact:true}).click();const result=await response;
        if(result.status()!==429){assert.equal(result.status(),200);break;}
        assert.ok(tries<2);const body=await result.json();assert.ok(Number.isInteger(body.retryAfterSeconds)&&body.retryAfterSeconds<=60);
        await page.getByRole('alert').getByText(/รอ/).waitFor();
        await new Promise(resolve=>setTimeout(resolve,Math.min(60,body.retryAfterSeconds+1)*1000));
      }
      await page.getByRole('heading',{name:'รอผู้อนุมัติอีกคน',exact:true}).waitFor();assert.equal((await review()).remaining,0);
      await other.goto(page.url(),{waitUntil:'domcontentloaded'});
      const approvePath=`/receipt-adjustments/${opId}/approve`;
      await other.route(`**${approvePath}`,async route=>{const r=await route.fetch();assert.equal(r.status(),200);await route.abort('connectionreset');},{times:1});
      const failed=other.waitForEvent('requestfailed',r=>r.url().endsWith(approvePath));
      await other.getByRole('button',{name:'อนุมัติและปรับใบเสร็จ',exact:true}).click();await failed;
      await other.getByRole('button',{name:'อนุมัติและปรับใบเสร็จ',exact:true}).click();
      await other.getByRole('heading',{name:'ปรับใบเสร็จแล้ว',exact:true}).waitFor();
      assert.equal(await db.billingReceiptGrant.count({where:{companyId,sourceKey:opId}}),1);assert.equal((await review()).remaining,7);
      await other.getByText('ร้านนี้ปิดการอ่านเอกสารด้วย AI อยู่',{exact:true}).waitFor();assert.equal((await admission('receipt-ocr-web')).allowed,false);
      await db.companyAiConfiguration.update({where:{companyId},data:{ocrEnabled:true}});
      await other.getByRole('link',{name:'กลับไปประวัติการเพิ่มใบเสร็จ',exact:true}).click();
      await other.waitForURL(url);await other.getByRole('region',{name:'ประวัติการเพิ่มใบเสร็จ',exact:true}).waitFor();
      await other.getByText('เหตุผล: เพิ่มจากหน้าเว็บให้เจ้าของร้าน',{exact:true}).waitFor();await other.reload({waitUntil:'domcontentloaded'});
      await other.getByRole('region',{name:'ประวัติการเพิ่มใบเสร็จ',exact:true}).waitFor();
      assert.equal(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await other.screenshot({path:`${browser.evidenceDir}/admin-receipt-adjustments-mobile.png`});
      await other.getByRole('region',{name:'ประวัติการเพิ่มใบเสร็จ',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));
      await other.screenshot({path:`${browser.evidenceDir}/admin-receipt-adjustments-history-mobile.png`});
      for(const channel of ['web','line']){await page.goto(`${browser.origin}/companies/${companyId}/billing?channel=${channel}`,{waitUntil:'domcontentloaded'});await page.getByText(/ใบเสร็จคงเหลือ 7 ใบ/).waitFor();}
      cases.push('browser-customer-web-and-line-billing-entry-see-admin-granted-balance');
      cases.push('browser-admin-receipts-preview-independent-approval-response-loss-history-reload-mobile');
    }
    assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),originalTerm);
    assert.deepEqual(await db.billingAccount.findUniqueOrThrow({where:{id:account.id}}),originalAccount);
    assert.deepEqual(await db.billingReceiptGrant.findUniqueOrThrow({where:{id:purchased.id}}),purchased);
    assert.equal(await db.billingInvoice.count({where:{billingAccountId:account.id}}),0);assert.equal(providerWrites,0);
    cases.push('admin-paid-receipts-preserve-package-collection-original-purchase-and-no-fiscal-document');
    return cases;
  }finally{
    input.transport();await db.companyOcrUsageEvent.deleteMany({where:{companyId}});await db.companyPlanTerm.deleteMany({where:{companyId}});
    await db.billingReceiptGrant.deleteMany({where:{companyId}});await db.billingOperation.deleteMany({where:{companyId}});await db.auditLog.deleteMany({where:{companyId}});
    if(accountId)await db.billingAccount.deleteMany({where:{id:accountId}});
    await db.membershipRole.deleteMany({where:{membership:{companyId}}});await db.companyMembership.deleteMany({where:{companyId}});
    if(ownerRoleId){await db.rolePermission.deleteMany({where:{roleId:ownerRoleId}});await db.role.deleteMany({where:{id:ownerRoleId}});}
    await db.company.deleteMany({where:{id:companyId}});
  }
}
