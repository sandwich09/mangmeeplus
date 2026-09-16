import {ensureBillingCompanyProof} from './billing-configuration-drafts-smoke';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';
import {admitCompanyOcr} from '../modules/line-ai/application/company-ocr-governance';
import {grantPaidPackageReceipts} from '../modules/billing/application/billing-receipt-grants';

/** Reuses the paid adjustment fixture's isolated company and current scoped actors before any paid account exists. */
export async function checkManualReceiptAdjustments(input:Parameters<typeof checkBillingConfigurationDrafts>[0],companyId:string){
  const {prisma,request,approveRequest,password,browser,secondBrowser}=input,db=prisma.client;
  const base='/v1/system/billing',path=`${base}/companies/${companyId}/receipt-adjustments`,now=new Date(),end=new Date(now.getTime()+30*86400000);
  const giftEnd=new Date(now.getTime()+10*86400000),cases:string[]=[];
  const review=async()=>{const r=await request(path);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const preview=async()=>{const r=await request(`${path}/preview`,'POST',{type:'GRANT_RECEIPTS',units:2,expiresAt:giftEnd.toISOString(),sourceHash:(await review()).sourceHash,reason:'ช่วยร้านทดลองตามคำขอ'});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const command=(op:any,action:string,actor=request)=>actor(`${base}/receipt-adjustments/${op.id}/${action}`,'POST',{expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`manual-gift-${op.id}`});
  const customer=async()=>{const r=await request(`/v1/companies/${companyId}/billing`,'GET',undefined,{'x-company-id':companyId});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  let accountId:string|undefined;
  try{
    await db.companyPlanTerm.create({data:{companyId,tierKey:'FREE_TRIAL_15',monthlySlipLimit:15,branchLimit:1,employeeLimit:2,termStartAt:now,termEndsAt:end}});
    for(let i=0;i<15;i++)assert.equal((await admitCompanyOcr(prisma,{companyId,sourceRoute:'receipt-ocr-web',requestId:randomUUID(),enforceReceiptQuota:true})).allowed,true);
    assert.equal((await review()).remaining,0);assert.equal((await review()).canCreate,true);
    for(const actor of [request,approveRequest])await ensureBillingCompanyProof(actor,companyId,password);
    const first=await preview(),sent=await command(first,'submit');assert.equal(sent.status,200,JSON.stringify(sent));
    const approved=await Promise.all([command(sent.body,'approve',approveRequest),command(sent.body,'approve',approveRequest)]);
    for(const result of approved)assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(await db.billingAccount.count({where:{companyId}}),0);assert.equal(await db.billingReceiptGrant.count({where:{companyId,billingAccountId:null}}),1);
    assert.equal(await db.auditLog.count({where:{companyId,action:'billing.receipt_adjustment.approve'}}),1);
    assert.equal((await customer()).usage.remaining,2);assert.equal((await customer()).usage.monthlyAllowance.limit,15);
    for(const sourceRoute of ['receipt-ocr-web','receipt-ocr-line'] as const)assert.equal((await admitCompanyOcr(prisma,{companyId,sourceRoute,requestId:randomUUID(),enforceReceiptQuota:true})).allowed,true);
    assert.equal((await customer()).usage.remaining,0);assert.equal((await review()).remaining,0);
    cases.push('admin-manual-receipts-base15-plus-approved-gift-without-account-concurrent-replay-and-shared-web-line-balance');
    let browserGiftId:string|undefined;
    if(browser&&secondBrowser){
      const page=browser.page,other=secondBrowser.pages()[0]!;
      await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/billing/companies/${companyId}/receipt-adjustments`,{waitUntil:'domcontentloaded'});
      await page.getByRole('textbox',{name:'เพิ่มใบเสร็จจำนวน',exact:true}).fill('4');
      await page.getByRole('textbox',{name:'เหตุผลที่ปรับใบเสร็จ',exact:true}).fill('เพิ่มใบเสริมให้ร้านทดลองจากเว็บ');
      await page.getByRole('button',{name:'ตรวจจำนวนก่อนส่งคำขอ',exact:true}).click();await page.waitForURL(/\/system\/billing\/receipt-adjustments\//);
      browserGiftId=new URL(page.url()).pathname.split('/').pop()!;
      await page.getByRole('button',{name:'บันทึกคำขอก่อนยืนยัน',exact:true}).click();await page.getByRole('heading',{name:'รอยืนยันรายการ',exact:true}).waitFor();
      await other.goto(page.url(),{waitUntil:'domcontentloaded'});await other.getByRole('button',{name:'อนุมัติและปรับใบเสร็จ',exact:true}).waitFor();
      await other.getByLabel('รหัสผ่านปัจจุบัน',{exact:true}).fill(password);
      const passwordResult=other.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`${base}/companies/${companyId}/reauthenticate`));
      await other.getByRole('button',{name:'ยืนยันรหัสผ่าน',exact:true}).click();
      const passwordResponse=await passwordResult;assert.equal(passwordResponse.status(),200,JSON.stringify(await passwordResponse.json()));
      await other.getByText('ยืนยันรหัสผ่านแล้ว ดำเนินการต่อได้ภายใน 5 นาที',{exact:true}).waitFor();
      let committed=false,approvalFailure:unknown;
      let finishApproval!:()=>void;const approvalHandled=new Promise<void>(resolve=>{finishApproval=resolve;});
      await other.route(`**/receipt-adjustments/${browserGiftId}/approve`,async route=>{const response=await route.fetch();if(response.status()!==200){approvalFailure={status:response.status(),body:await response.json()};await route.fulfill({response});finishApproval();return;}committed=true;await route.abort();finishApproval();},{times:1});
      await other.getByRole('button',{name:'อนุมัติและปรับใบเสร็จ',exact:true}).click();await Promise.race([approvalHandled,new Promise((_,reject)=>setTimeout(()=>reject(Error('approval route did not complete')),30000))]);
      assert.equal(committed,true,JSON.stringify(approvalFailure));await other.getByRole('alert').filter({hasText:'เชื่อมต่อระบบไม่ได้'}).waitFor();
      await other.getByRole('button',{name:'อนุมัติและปรับใบเสร็จ',exact:true}).click();await other.getByRole('heading',{name:'ปรับใบเสร็จแล้ว',exact:true}).waitFor();
      assert.equal(await db.billingReceiptGrant.count({where:{companyId,sourceKey:browserGiftId}}),1);assert.equal((await customer()).usage.remaining,4);
      await other.setViewportSize({width:390,height:844});await other.screenshot({path:`${browser.evidenceDir}/admin-manual-receipts-mobile.png`,fullPage:true});
      for(const channel of ['web','line']){
        await page.goto(`${browser.origin}/companies/${companyId}/billing?channel=${channel}`,{waitUntil:'domcontentloaded'});
        await page.getByText(/ใบเสร็จคงเหลือ 4 ใบ/).waitFor();await page.getByText(/โควตาปกติ 15 ใบต่อเดือน.*ผู้ดูแลเพิ่มให้ เหลือ 4 ใบ/).waitFor();
      }
      await page.screenshot({path:`${browser.evidenceDir}/manual-receipts-owner-mobile.png`,fullPage:true});
      cases.push('browser-manual-receipts-create-independent-approval-lost-result-retry-once-and-separate-monthly-gift-web-line-copy');
    }
    const pending=await preview(),pendingSent=await command(pending,'submit');assert.equal(pendingSent.status,200);
    const account=await db.billingAccount.create({data:{companyId,stripeAccountId:input.stripeAccountId,livemode:false,paidThrough:end,nextChargeAt:end}});accountId=account.id;
    await db.$transaction(tx=>grantPaidPackageReceipts(tx,{companyId,billingAccountId:account.id,sourceKey:'TEST_ONLY_MANUAL_CONVERSION',policyRevisionId:'TEST_ONLY',kind:'INITIAL',units:30,serviceStart:now,serviceEnd:end,availableAt:now,expiresAt:end}));
    assert.equal((await command(pendingSent.body,'approve',approveRequest)).status,409);assert.equal((await command(pendingSent.body,'cancel')).status,200);
    assert.equal((await command(sent.body,'approve',approveRequest)).status,200,'committed original manual command remains replayable after paid conversion');
    assert.equal((await customer()).usage.remaining,browserGiftId?34:30);assert.equal((await customer()).usage.cadence,'PAID_GRANTS');
    assert.equal(await db.billingInvoice.count({where:{billingAccountId:account.id}}),0);
    cases.push('admin-manual-receipts-paid-conversion-stales-pending-review-retains-original-replay-and-gift-without-trial-base-carry');
    return cases;
  }finally{
    await db.companyOcrUsageEvent.deleteMany({where:{companyId}});await db.companyOcrMonthlyUsage.deleteMany({where:{companyId}});
    await db.companyPlanTerm.deleteMany({where:{companyId}});await db.billingReceiptGrant.deleteMany({where:{companyId}});
    await db.billingOperation.deleteMany({where:{companyId}});await db.auditLog.deleteMany({where:{companyId}});
    if(accountId)await db.billingAccount.deleteMany({where:{id:accountId}});
  }
}
