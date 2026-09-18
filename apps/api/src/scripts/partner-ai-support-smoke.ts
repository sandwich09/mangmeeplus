import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';
import {admitCompanyOcr} from '../modules/line-ai/application/company-ocr-governance';
import {bangkokMonthKey} from '../modules/line-ai/application/company-ai-usage-meter';

/** Exercises support facts over real admission/grants; does not simulate a paid invoice. */
export async function checkPartnerAiSupport(input:Parameters<typeof checkBillingConfigurationDrafts>[0],companyId:string,accountId:string){
  const {prisma,request,browser}=input,db=prisma.client,now=new Date(),monthKey=bangkokMonthKey(now),cases:string[]=[];
  const term=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),identityId=randomUUID(),grantIds:string[]=[];
  const read=async()=>{const r=await request(`/v1/system/partners/${companyId}/timeline`);assert.equal(r.status,200,JSON.stringify(r));return r.body.entries.filter((e:any)=>e.kind==='ai_refusal');};
  const grant=async(kind:'INITIAL'|'REPEAT')=>{const g=await db.billingReceiptGrant.create({data:{companyId,billingAccountId:accountId,kind,sourceKey:`TEST_ONLY_SUPPORT_${randomUUID()}`,sourceHash:'TEST_ONLY',units:2,policyRevisionId:'TEST_ONLY',availableAt:now,expiresAt:term.termEndsAt,serviceStart:now,serviceEnd:term.termEndsAt}});grantIds.push(g.id);};
  try{
    await db.externalIdentity.create({data:{id:identityId,userId:input.userIds[0]!,provider:'LINE',providerChannelId:process.env.LINE_MESSAGING_CHANNEL_ID!,providerUserId:`U${randomUUID().replaceAll('-','')}`}});
    await db.companyPlanTerm.update({where:{companyId},data:{billingReceiptAccountId:accountId,monthlySlipLimit:1}});
    await db.companyAiConfiguration.create({data:{companyId,monthlyBudgetSatang:20000,ocrEnabled:true,receiptQuotaEnforced:true}});
    await grant('INITIAL');
    const admit=()=>admitCompanyOcr(prisma,{companyId,sourceRoute:'receipt-ocr-line',requestId:randomUUID(),monthKey,enforceReceiptQuota:true});
    assert.equal((await admit()).allowed,true);assert.deepEqual(await read(),[],'purchased units remain even after the legacy monthly limit');
    assert.equal((await admit()).allowed,true);let facts=await read();assert.equal(facts.length,1);assert.equal(facts[0].label,'ตอนนี้ยังอ่านใบเสร็จด้วย AI ไม่ได้');assert.equal(facts[0].detail,'ใช้จำนวนใบเสร็จที่มีอยู่ครบแล้ว');
    if(browser){await browser.page.goto(`${browser.origin}/system/partners/${companyId}`,{waitUntil:'domcontentloaded'});await browser.page.getByText(facts[0].label,{exact:true}).waitFor();}
    await grant('REPEAT');assert.deepEqual(await read(),[]);assert.equal((await admit()).allowed,true);
    if(browser){await browser.page.getByRole('button',{name:'โหลดประวัติร้านล่าสุด',exact:true}).click();await browser.page.getByText('ตอนนี้ยังอ่านใบเสร็จด้วย AI ไม่ได้',{exact:true}).waitFor({state:'hidden'});}
    cases.push('admin-ai-support-paid-admission-exhaustion-and-additional-grant-do-not-use-legacy-monthly-cap-or-block-all-chat');

    await db.companyAiMonthlyUsage.create({data:{companyId,monthKey,costSatang:20000}});facts=await read();assert.equal(facts[0].detail,'เครดิต AI ของเดือนนี้หมดแล้ว');assert.equal(facts[0].label,'ตอนนี้ AI ยังทำงานให้ร้านไม่ได้');
    if(browser){await browser.page.getByRole('button',{name:'โหลดประวัติร้านล่าสุด',exact:true}).click();await browser.page.getByText(facts[0].detail,{exact:true}).waitFor();}
    await db.companyAiConfiguration.update({where:{companyId},data:{monthlyBudgetSatang:30000}});assert.deepEqual(await read(),[]);
    await db.companyAiConfiguration.update({where:{companyId},data:{ocrEnabled:false}});facts=await read();assert.equal(facts[0].label,'ตอนนี้ยังอ่านใบเสร็จด้วย AI ไม่ได้');assert.equal(facts[0].detail,'ผู้ดูแลปิดการอ่านเอกสารด้วย AI ไว้');
    if(browser){const page=browser.page;await page.getByRole('button',{name:'โหลดประวัติร้านล่าสุด',exact:true}).click();const label=page.getByText(facts[0].detail,{exact:true});await label.waitFor();await page.getByText('ตอนนี้ AI ยังทำงานให้ร้านไม่ได้',{exact:true}).waitFor({state:'hidden'});
      await label.evaluate(el=>el.closest('section')?.scrollIntoView({block:'start'}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${browser.evidenceDir}/admin-ai-support-status-mobile.png`,fullPage:false});}
    await db.company.update({where:{id:companyId},data:{status:'DISABLED'}});facts=await read();assert.equal(facts[0].detail,'ร้านถูกพักใช้งาน');
    cases.push('admin-ai-support-current-budget-ocr-switch-and-company-hold-have-distinct-explanations');
    if(browser)cases.push('browser-admin-ai-support-reloads-current-grant-budget-and-ocr-facts-without-restart');
    return cases;
  }finally{
    await db.company.update({where:{id:companyId},data:{status:'ACTIVE'}});
    await db.companyPlanTerm.update({where:{companyId},data:{billingReceiptAccountId:term.billingReceiptAccountId,monthlySlipLimit:term.monthlySlipLimit}});
    await db.companyOcrUsageEvent.deleteMany({where:{companyId}});await db.companyOcrMonthlyUsage.deleteMany({where:{companyId}});
    await db.companyAiMonthlyUsage.deleteMany({where:{companyId}});await db.companyAiConfiguration.deleteMany({where:{companyId}});
    await db.billingReceiptGrant.deleteMany({where:{id:{in:grantIds}}});await db.externalIdentity.deleteMany({where:{id:identityId}});
  }
}
