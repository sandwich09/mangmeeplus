import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext } from '@playwright/test';
import type { PrismaService } from '../common/database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { BillingOperationsService } from '../modules/billing/application/billing-operations.service';
import type { startBillingBrowser } from './billing-browser-smoke';

/** Actual HTTP/auth/PG/worker/Next. Only Stripe transport and explicitly named race faults are synthetic. */
export async function checkBillingApplyRetry(input:{
  prisma:PrismaService;operations:BillingOperationsService;companyIds:string[];stripeAccountId:string;origin:string;
  request:(path:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<{status:number;body:any}>;
  signToken:(sid:string,userId:string)=>string;recordLegal:(userId:string,membershipId:string,companyId:string)=>Promise<void>;
  repairCapacity:()=>Promise<void>;intercept:(hook?:(path:string,method:string)=>Promise<void>)=>void;
  charge:Record<string,any>;
  browser?:Awaited<ReturnType<typeof startBillingBrowser>>;
}) {
  const {prisma,operations,browser}=input,db=prisma.client,companyId=input.companyIds[0]!,actorCompany=input.companyIds[1]!;
  const tag=randomUUID(),userId=`apply-operator-${tag}`,roleId=randomUUID(),base='/v1/system/billing';
  const account=await db.billingAccount.findFirstOrThrow({where:{companyId,stripeAccountId:input.stripeAccountId,livemode:false}});
  const original=await db.billingInvoice.findFirstOrThrow({where:{billingAccountId:account.id,applyStatus:'HELD'}});
  const term=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId:actorCompany}});
  const settings=await db.billingSettings.findUniqueOrThrow({where:{id:`${input.stripeAccountId}:test`}});
  const policy=await db.billingPolicyRevision.findUniqueOrThrow({where:{id:settings.policyRevisionId!}});
  let closedRevision:string|undefined;
  const invoices:string[]=[],cases:string[]=[];let context:BrowserContext|undefined,foreignAccount:string|undefined;
  const calls:{path:string;method:string}[]=[],scope={userId,companyId,stripeAccountId:input.stripeAccountId,livemode:false};
  let fault:((path:string,method:string)=>Promise<void>)|undefined;
  input.intercept(async(path,method)=>{calls.push({path,method});await fault?.(path,method);});
  const clone=async(extra:Partial<Prisma.BillingInvoiceUncheckedCreateInput>={})=>{
    const row=await db.billingInvoice.create({data:{billingAccountId:account.id,providerInvoiceId:`in_apply${randomUUID().replaceAll('-','')}`,
      subscriptionId:original.subscriptionId,offerSnapshot:original.offerSnapshot as Prisma.InputJsonValue,
      ...(original.contractSnapshot?{contractSnapshot:original.contractSnapshot as Prisma.InputJsonValue}:{}),policyRevisionId:original.policyRevisionId,
      currency:original.currency,totalSatang:original.totalSatang,paidSatang:original.paidSatang,periodStart:original.periodStart,periodEnd:original.periodEnd,
      providerStatus:'paid',evidenceHash:tag,applyStatus:'HELD',...extra}});invoices.push(row.id);return row;
  };
  try{
    // Synthetic publication snapshot: keep the original consent's immutable revision intact.
    const max=await db.billingPolicyRevision.aggregate({where:{stripeAccountId:input.stripeAccountId,livemode:false},_max:{version:true}});
    // Campaigns live beside the policy (promotionJson): a revision made from another one must carry them, or they vanish.
    const closed=await db.billingPolicyRevision.create({data:{stripeAccountId:input.stripeAccountId,livemode:false,version:(max._max.version??0)+1,
      state:'ACTIVE',policyJson:{...(policy.policyJson as Prisma.JsonObject),salesCompanyIds:[]},promotionJson:(policy.promotionJson??undefined) as Prisma.InputJsonValue|undefined,createdByUserId:policy.createdByUserId}});closedRevision=closed.id;
    await db.billingSettings.update({where:{id:settings.id},data:{policyRevisionId:closed.id,version:{increment:1}}});
    assert.equal((await input.request(`/v1/companies/${companyId}/billing`)).body.purchaseEligibility,'COMPANY_SALES_CLOSED');
    await db.user.create({data:{id:userId,displayName:'Synthetic apply operator',email:`${userId}@example.test`}});
    const permissions=await Promise.all(['account.session.read','system.billing.read','system.billing.apply.retry'].map(key=>db.permission.upsert({where:{key},update:{},create:{key,description:key}})));
    await db.role.create({data:{id:roleId,key:`APPLY_${tag}`,name:'Synthetic apply support',scopeKey:'system',isSystem:true,
      permissions:{create:permissions.map(p=>({permissionId:p.id}))}}});
    const member=await db.companyMembership.create({data:{companyId:actorCompany,userId,roles:{create:{roleId}}}});
    // Only the separate operator's term is active; the customer's quoted term remains unchanged.
    await db.companyPlanTerm.update({where:{companyId:actorCompany},data:{termEndsAt:new Date(Date.now()+86400000)}});
    await input.recordLegal(userId,member.id,actorCompany);
    const sid=randomUUID();await db.authSession.create({data:{userId,tokenId:sid,expiresAt:new Date(Date.now()+3600000)}});
    const token=input.signToken(sid,userId),request=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>input.request(path,method,body,{...headers,authorization:`Bearer ${token}`});
    assert.equal((await request('/v1/auth/me')).status,200);
    const list=`${base}/companies/${companyId}/apply-invoices`,read=(id=original.id)=>request(`${list}/${id}`);
    const preview=async(id=original.id)=>{const invoice=await read(id);assert.equal(invoice.status,200,JSON.stringify(invoice));
      return request(`${base}/operations/preview`,'POST',{type:'RETRY_APPLY',companyId,expectedVersion:invoice.body.accountVersion,
        referenceId:id,invoiceSourceHash:invoice.body.sourceHash,reason:'ตรวจสิทธิ์ของใบเสร็จเดิมที่เลือก'});};
    const submit=(op:any)=>request(`${base}/operations`,'POST',{previewId:op.id,previewHash:op.previewHash,expectedVersion:op.version},{'idempotency-key':`billing-op-${op.id}`});
    const readOp=(id:string)=>request(`${base}/operations/${id}`);
    const change=(op:any,action:string)=>request(`${base}/operations/${op.id}/${action}`,'POST',{expectedVersion:op.version});
    assert.equal((await input.request(list)).status,403,'customer OWNER cannot operate billing');
    assert.equal((await request(list)).status,404,'global capability still requires company scope');
    await db.billingOperatorScope.create({data:{...scope,createdByUserId:userId}});
    await db.billingOperatorScope.update({where:{userId_stripeAccountId_livemode_companyId:scope},data:{livemode:true}});
    assert.equal((await request(list)).status,404,'LIVE scope cannot authorize TEST invoices');
    await db.billingOperatorScope.update({where:{userId_stripeAccountId_livemode_companyId:{...scope,livemode:true}},data:{livemode:false}});
    assert.equal((await request(`${base}/companies/${companyId}`)).body.financial,null);
    const source=(await read()).body;assert.equal(source.canRetry,true);assert.equal(source.paymentVerified,true);
    assert.doesNotMatch(JSON.stringify(source),/totalSatang|paidSatang|providerInvoiceId|in_|cus_|contractSnapshot|evidenceHash|@example/);
    foreignAccount=(await db.billingAccount.create({data:{companyId:actorCompany,stripeAccountId:input.stripeAccountId,livemode:false}})).id;
    const foreign=await clone({billingAccountId:foreignAccount}),applied=await clone({applyStatus:'APPLIED',appliedAt:new Date(),
      periodStart:new Date(original.periodStart.getTime()-2*366*86400000),periodEnd:new Date(original.periodStart.getTime()-366*86400000)});
    const unpaid=await clone({providerStatus:'open',paidSatang:0});
    for(let i=0;i<26;i++)await clone();
    assert.equal((await read(foreign.id)).status,404);assert.equal((await request(`${list}?cursor=${foreign.id}`)).status,404);
    assert.equal((await request(`${base}/companies/${actorCompany}/apply-invoices/${foreign.id}`)).status,404);
    const first=(await request(list)).body;assert.equal(first.items.length,25);assert.ok(first.nextCursor);
    const second=(await request(`${list}?cursor=${first.nextCursor}`)).body;
    assert.equal(second.items.length,3);assert.equal(second.nextCursor,null);
    assert.equal(new Set([...first.items,...second.items].map(v=>v.id)).size,28);
    assert.equal((await read(applied.id)).body.canRetry,false);assert.equal((await preview(unpaid.id)).status,409);
    const command={type:'RETRY_APPLY',companyId,expectedVersion:source.accountVersion,reason:'ต้องมีรายการต้นทาง'};
    assert.equal((await request(`${base}/operations/preview`,'POST',command)).body.code,'CONTROL_INVOICE_TARGET_REQUIRED');
    assert.equal((await request(`${base}/operations/preview`,'POST',{...command,referenceId:original.id,invoiceSourceHash:'stale'})).status,409);
    assert.equal((await request(`${base}/operations/preview`,'POST',{...command,referenceId:foreign.id,invoiceSourceHash:source.sourceHash})).status,404);
    assert.equal((await request(`${base}/operations/preview`,'POST',{...command,referenceId:original.id,invoiceSourceHash:source.sourceHash,amountSatang:1})).status,400);
    cases.push('apply-invoice-owner-delegate-company-mode-safe-projection-and-25-plus-one-pagination');
    if(browser){
      context=await browser.page.context().browser()!.newContext({viewport:{width:390,height:844}});
      context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
      await context.addCookies([{name:'watchdog_token',value:token,url:browser.origin,httpOnly:true,sameSite:'Lax'},
        {name:'watchdog_csrf',value:'synthetic-apply-csrf',url:browser.origin,sameSite:'Lax'}]);
      const page=await context.newPage();
      await page.goto(`${browser.origin}/system/billing/companies/${companyId}`,{waitUntil:'domcontentloaded'});
      await page.getByRole('link',{name:'ปรับแพ็กเกจและตรวจสอบ',exact:true}).click();
      await page.getByRole('link',{name:'เปิดตรวจการเปิดแพ็กเกจ',exact:true}).click();
      await page.getByRole('region',{name:'ใบเสร็จที่รอใช้สิทธิ์'}).locator('article').last().waitFor();
      await expect(page.getByRole('region',{name:'ใบเสร็จที่รอใช้สิทธิ์'}).locator('article')).toHaveCount(25);
      await page.getByRole('button',{name:'รายการหน้าถัดไป',exact:true}).click();
      await page.getByRole('button',{name:'กลับหน้าแรก',exact:true}).waitFor();
      await expect(page.getByRole('region',{name:'ใบเสร็จที่รอใช้สิทธิ์'}).locator('article')).toHaveCount(3);
      await page.getByRole('button',{name:'กลับหน้าแรก',exact:true}).click();
    }
    await db.billingInvoice.deleteMany({where:{id:{in:invoices.filter(id=>id!==applied.id)}}});
    const stale=(await preview()).body;
    const applyPermission=permissions.find(p=>p.key==='system.billing.apply.retry')!,grant={roleId,permissionId:applyPermission.id};
    await db.rolePermission.delete({where:{roleId_permissionId:grant}});
    assert.equal((await read()).body.canRetry,false);assert.deepEqual((await readOp(stale.id)).body.allowedActions,[]);
    assert.deepEqual((await request(`${base}/operations?companyId=${companyId}&referenceId=${original.id}`)).body.items.find((v:any)=>v.id===stale.id).allowedActions,[]);
    assert.equal((await preview()).status,403);await db.rolePermission.create({data:grant});
    await db.billingInvoice.update({where:{id:original.id},data:{version:{increment:1}}});
    assert.equal((await submit(stale)).status,409);
    const changed=(await submit((await preview()).body)).body;assert.equal(changed.state,'QUEUED');
    await db.billingInvoice.update({where:{id:original.id},data:{version:{increment:1}}});
    calls.length=0;await operations.drain();assert.equal(calls.length,0);
    const blocked=(await readOp(changed.id)).body;assert.equal(blocked.errorCode,'CONTROL_INVOICE_SOURCE_CHANGED');
    assert.equal((await change(blocked,'retry')).status,409);assert.equal((await change(blocked,'cancel')).body.state,'CANCELLED');
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{referenceId:changed.id,kind:'CONTROL_OPERATION_REVIEW'}})).state,'RESOLVED');
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{referenceId:original.id,kind:'PAID_HELD'}})).state,'OPEN');
    cases.push('apply-invoice-source-changes-block-submit-and-execute-cancel-preserves-paid-case');
    const legacy=await db.billingOperation.create({data:{companyId,stripeAccountId:input.stripeAccountId,livemode:false,type:'RETRY_APPLY',state:'QUEUED',
      sourceVersion:account.version,requestHash:tag,reason:'คำสั่งเก่ายังไม่มีใบเสร็จ',initiatorUserId:userId,expiresAt:new Date(Date.now()+600000),
      proposedJson:{accountId:account.id,membershipId:member.id,actorCompanyId:actorCompany}}});
    calls.length=0;await operations.drain();assert.equal(calls.length,0);
    const legacyView=(await readOp(legacy.id)).body;assert.equal(legacyView.errorCode,'CONTROL_INVOICE_TARGET_REQUIRED');
    assert.deepEqual(legacyView.allowedActions,['cancel']);assert.equal((await change(legacyView,'retry')).status,409);
    assert.equal((await change(legacyView,'cancel')).body.state,'CANCELLED');
    cases.push('apply-invoice-legacy-targetless-command-read-cancel-no-automatic-latest-selection');
    // The other applied invoice and COMPLETED checkout must never certify this selected HELD invoice.
    assert.equal((await db.billingAttempt.findUniqueOrThrow({where:{id:original.sourceAttemptId!}})).status,'COMPLETED');
    let op:any;
    if(context){
      const page=context.pages()[0]!;await page.goto(`${browser!.origin}${list.replace('/v1','')}/${original.id}`,{waitUntil:'domcontentloaded'});
      await page.getByText('บันทึกเหตุผล (ระบบใส่ให้แล้ว)',{exact:true}).click();
      await page.getByRole('textbox',{name:'เหตุผลการตรวจสอบ',exact:true}).fill('ตรวจสิทธิ์จากใบเสร็จเดิมผ่านเว็บ');
      await page.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true}).click();
      await page.getByRole('status').filter({hasText:'ตรวจข้อมูลก่อนยืนยัน'}).waitFor();
      await page.getByText('ประวัติและข้อมูลอ้างอิง',{exact:true}).click();
      const href=await page.getByRole('link',{name:'เปิดรายละเอียดการดำเนินการนี้',exact:true}).getAttribute('href');assert.ok(href);
      op=(await readOp(href.split('/').at(-1)!)).body;
      await page.getByRole('button',{name:'ยืนยันแก้ไขรายการนี้',exact:true}).click();
      await page.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'}).waitFor();
    }else {op=(await preview()).body;assert.equal((await submit(op)).body.state,'QUEUED');}
    assert.equal((await submit(op)).body.id,op.id,'exact idempotency replay');
    await db.billingOperatorScope.update({where:{userId_stripeAccountId_livemode_companyId:scope},data:{revokedAt:new Date()}});
    calls.length=0;await operations.drain();assert.equal(calls.length,0);
    assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:op.id}})).errorCode,'CONTROL_PERMISSION_CHANGED');
    assert.equal((await read()).status,404);
    await db.billingOperatorScope.update({where:{userId_stripeAccountId_livemode_companyId:scope},data:{revokedAt:null}});
    op=(await readOp(op.id)).body;assert.equal((await change(op,'retry')).body.state,'QUEUED');
    calls.length=0;await operations.drain();
    op=(await readOp(op.id)).body;assert.equal(op.state,'UNKNOWN');assert.equal(op.errorCode,'CONTROL_INVOICE_NOT_APPLIED');
    assert.equal(op.observed.invoiceId,original.id);assert.equal(op.observed.invoiceApplyState,'HELD');
    assert.equal(await db.billingReceiptGrant.count({where:{companyId}}),0);
    assert.ok(calls.some(c=>c.path===`/invoices/${original.providerInvoiceId}`));assert.ok(calls.every(c=>c.method==='GET'));
    assert.equal(calls.some(c=>c.path===`/invoices/${applied.providerInvoiceId}`),false);
    cases.push('apply-invoice-current-authority-and-selected-held-outcome-ignore-other-applied-invoice');
    const previousDispute=input.charge.disputed;delete input.charge.disputed;
    try{
      assert.equal((await change(op,'retry')).body.state,'QUEUED');await operations.drain();op=(await readOp(op.id)).body;
      assert.equal(op.state,'UNKNOWN');assert.equal(await db.billingReceiptGrant.count({where:{companyId}}),0);
      assert.equal((await db.billingInvoice.findUniqueOrThrow({where:{id:original.id}})).disputed,false);
    }finally{input.charge.disputed=previousDispute;}
    cases.push('apply-invoice-missing-financial-evidence-remains-unknown-no-default-non-disputed-grant');
    if(context){
      const page=context.pages()[0]!;await page.getByRole('button',{name:'อัปเดตข้อมูล',exact:true}).click();
      await page.getByRole('status').filter({hasText:'ยังยืนยันผลไม่ได้'}).waitFor();
      await page.getByRole('link',{name:'เปิดรายละเอียดการดำเนินการนี้',exact:true}).click();await page.waitForURL(`${browser!.origin}/system/billing/operations/${op.id}`);
      await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('status').filter({hasText:'ยังยืนยันผลไม่ได้'}).waitFor();
    }
    await input.repairCapacity();
    if(context){const page=context.pages()[0]!;await page.getByRole('button',{name:'ลองดำเนินการอีกครั้ง',exact:true}).click();
      await page.getByRole('status').filter({hasText:'รอระบบดำเนินการ'}).waitFor();}
    else assert.equal((await change(op,'retry')).body.state,'QUEUED');
    let lost=false;fault=async path=>{if(!lost&&path===`/invoices/${original.providerInvoiceId}`){lost=true;
      await db.billingOperation.update({where:{id:op.id},data:{leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+60000),version:{increment:1}}});}};
    await operations.drain();fault=undefined;assert.equal(lost,true);
    assert.equal((await db.billingInvoice.findUniqueOrThrow({where:{id:original.id}})).applyStatus,'APPLIED');
    assert.equal((await readOp(op.id)).body.state,'RUNNING','lost operation lease cannot certify or resolve');
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{referenceId:op.id,kind:'CONTROL_OPERATION_REVIEW'}})).state,'OPEN');
    await db.billingOperation.update({where:{id:op.id},data:{leaseUntil:new Date(0)}});
    calls.length=0;await operations.drain();assert.equal(calls.length,0,'already-applied original is observed without provider work');
    op=(await readOp(op.id)).body;assert.equal(op.state,'SUCCEEDED');assert.equal(op.observed.invoiceApplyState,'APPLIED');
    const grants=await db.billingReceiptGrant.findMany({where:{companyId}});assert.equal(grants.length,1);assert.equal(grants[0]!.units,1200);
    assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:account.id}})).paidThrough?.toISOString(),original.periodEnd.toISOString());
    assert.equal(await db.auditLog.count({where:{action:'billing.invoice.applied',targetId:original.id}}),1);
    assert.equal(await db.auditLog.count({where:{action:'billing.operation.observed',targetId:op.id,metadataJson:{path:['after'],equals:'SUCCEEDED'}}}),1);
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{referenceId:op.id,kind:'CONTROL_OPERATION_REVIEW'}})).state,'RESOLVED');
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{referenceId:original.id,kind:'PAID_HELD'}})).state,'RESOLVED');
    assert.equal((await read()).body.canRetry,false);assert.equal((await preview()).status,409);
    cases.push('apply-invoice-capacity-repair-original-grant-once-stale-operation-lease-no-false-completion');
    cases.push('apply-invoice-replacement-worker-observes-original-paid-source-without-provider-io');
    if(context){
      const page=context.pages()[0]!;await page.getByRole('button',{name:'อัปเดตสถานะ',exact:true}).click();
      await page.getByRole('status').filter({hasText:'ดำเนินการเสร็จแล้ว'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      await page.screenshot({path:`${browser!.evidenceDir}/admin-apply-retry-mobile.png`,fullPage:true});
      await page.getByRole('link',{name:'เปิดรายการชำระเดิม',exact:true}).click();
      await page.getByRole('heading',{name:'รายการนี้เปิดแพ็กเกจแล้ว',exact:true}).waitFor();
      await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'รายการนี้เปิดแพ็กเกจแล้ว',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true}).count(),0);
      await page.getByRole('link',{name:'ดูแพ็กเกจปัจจุบันของบริษัท',exact:true}).click();
      await page.getByRole('region',{name:'ข้อมูลการชำระเงินบริษัท'}).waitFor();
      cases.push('browser-apply-invoice-list-detail-preview-submit-unknown-reload-retry-success-original-company-return');
    }
    cases.push('apply-invoice-original-paid-capacity-repair-and-grant-survive-closed-sales-cohort');
    return cases;
  }catch(error){if(context){const page=context.pages()[0];if(page){await page.screenshot({path:`${browser!.evidenceDir}/apply-retry-failure.png`,fullPage:true});
    console.error('Apply retry browser failure',await page.locator('main').last().innerText());}}throw error;
  }finally{
    input.intercept();await context?.close();
    await db.billingSettings.update({where:{id:settings.id},data:{policyRevisionId:settings.policyRevisionId,version:{increment:1}}});
    if(closedRevision)await db.billingPolicyRevision.delete({where:{id:closedRevision}});
    await db.billingInvoice.deleteMany({where:{id:{in:invoices}}});
    if(foreignAccount)await db.billingAccount.delete({where:{id:foreignAccount}});
    const ownOperations=await db.billingOperation.findMany({where:{initiatorUserId:userId,stripeAccountId:input.stripeAccountId},select:{id:true}});
    await db.billingIssue.deleteMany({where:{referenceId:{in:ownOperations.map(o=>o.id)}}});
    await db.billingOperation.deleteMany({where:{initiatorUserId:userId,stripeAccountId:input.stripeAccountId}});
    await db.billingOperatorScope.deleteMany({where:{userId}});
    await db.auditLog.deleteMany({where:{actorUserId:userId}});
    await db.companyMembership.deleteMany({where:{userId}});await db.role.deleteMany({where:{id:roleId}});await db.user.deleteMany({where:{id:userId}});
    await db.companyPlanTerm.update({where:{companyId:actorCompany},data:{termEndsAt:term.termEndsAt}});
  }
}
