import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { BillingOperationsService } from '../modules/billing/application/billing-operations.service';
import type { startBillingBrowser } from './billing-browser-smoke';

/** Original full-package journal, actual Admin HTTP/PG/browser; transport faults only. */
export async function checkRepeatApply(input:{prisma:PrismaService;operations:BillingOperationsService;companyId:string;userId:string;membershipId:string;invoiceId:string;
  request:(path:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<{status:number;body:any}>;
  browser?:Awaited<ReturnType<typeof startBillingBrowser>>;session:Record<string,any>;loseResume:()=>void;purchaseCount:()=>number;invoiceCount:()=>number;}) {
  const {prisma,request,browser,companyId}=input,db=prisma.client,roleId=randomUUID(),ids:string[]=[],base='/v1/system/billing';
  const account=await db.billingAccount.findFirstOrThrow({where:{companyId}}),original=await db.billingInvoice.findUniqueOrThrow({where:{id:input.invoiceId}});
  const before=await db.billingReceiptGrant.findMany({where:{billingAccountId:account.id},orderBy:{id:'asc'}}),purchases=input.purchaseCount(),invoices=input.invoiceCount();
  const identity={userId:input.userId,companyId,stripeAccountId:account.stripeAccountId,livemode:account.livemode};
  const priorScope=await db.billingOperatorScope.findUnique({where:{userId_stripeAccountId_livemode_companyId:identity}});
  const originalSessionInvoice=input.session.invoice,viewport=browser?.page.viewportSize();
  const read=(id:string)=>request(`${base}/operations/${id}`),cases:string[]=[];
  try{
    const permissions=await Promise.all(['system.billing.read','system.billing.apply.retry'].map(key=>db.permission.upsert({where:{key},update:{},create:{key,description:key}})));
    await db.role.create({data:{id:roleId,key:`REPEAT_APPLY_${roleId}`,name:'Synthetic repeat apply support',scopeKey:'system',isSystem:true,
      permissions:{create:permissions.map(p=>({permissionId:p.id}))}}});
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId}});
    if(!priorScope)await db.billingOperatorScope.create({data:{...identity,createdByUserId:input.userId}});
    const invoicePath=`${base}/companies/${companyId}/apply-invoices/${original.id}`,invoice=(await request(invoicePath)).body;
    assert.equal(invoice.canRetry,true);assert.equal(invoice.applyState,'PENDING');assert.equal(original.subscriptionId,null);
    let op:any;
    if(browser){
      const page=browser.page;await page.setViewportSize({width:390,height:844});
      await page.goto(`${browser.origin}${invoicePath.replace('/v1','')}`,{waitUntil:'domcontentloaded'});
      await page.getByText('บันทึกเหตุผล (ระบบใส่ให้แล้ว)',{exact:true}).click();
      await page.getByRole('textbox',{name:'เหตุผลการตรวจสอบ',exact:true}).fill('ตามผลแพ็กเกจที่ซื้อซ้ำจากใบเสร็จเดิม');
      await page.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true}).click();
      await page.getByRole('status').filter({hasText:'ตรวจข้อมูลก่อนยืนยัน'}).waitFor();
      await page.getByText('ประวัติและข้อมูลอ้างอิง',{exact:true}).click();
      const href=await page.getByRole('link',{name:'เปิดรายละเอียดการดำเนินการนี้',exact:true}).getAttribute('href');assert.ok(href);
      op=(await read(href.split('/').at(-1)!)).body;ids.push(op.id);
      await page.getByRole('button',{name:'ยืนยันแก้ไขรายการนี้',exact:true}).click();
      await page.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'}).waitFor();
      await page.getByRole('link',{name:'เปิดรายละเอียดการดำเนินการนี้',exact:true}).click();await page.waitForURL(`${browser.origin}/system/billing/operations/${op.id}`);
    }else{
      const preview=await request(`${base}/operations/preview`,'POST',{type:'RETRY_APPLY',companyId,referenceId:original.id,
        invoiceSourceHash:invoice.sourceHash,expectedVersion:invoice.accountVersion,reason:'ตามผลแพ็กเกจเดิมที่ซื้อซ้ำ'});
      assert.equal(preview.status,200,JSON.stringify(preview));op=preview.body;ids.push(op.id);
      assert.equal((await request(`${base}/operations`,'POST',{previewId:op.id,previewHash:op.previewHash,expectedVersion:op.version},{'idempotency-key':`repeat-apply-${op.id}`})).status,202);
    }
    const retry=async()=>{
      op=(await read(op.id)).body;
      if(browser){const page=browser.page;await page.getByRole('button',{name:'อัปเดตสถานะ',exact:true}).click();
        await page.getByRole('status').filter({hasText:'ยังยืนยันผลไม่ได้'}).waitFor();
        await page.getByRole('button',{name:'ลองดำเนินการอีกครั้ง',exact:true}).click();
        await page.getByRole('status').filter({hasText:'รอระบบดำเนินการ'}).waitFor();
      }else assert.equal((await request(`${base}/operations/${op.id}/retry`,'POST',{expectedVersion:op.version})).body.state,'QUEUED');
    };
    // A changed hosted source cannot redirect recovery to a different already-paid invoice.
    input.session.invoice='in_differentOriginal';await input.operations.drain();input.session.invoice=originalSessionInvoice;
    op=(await read(op.id)).body;assert.equal(op.state,'UNKNOWN');
    assert.deepEqual(await db.billingReceiptGrant.findMany({where:{billingAccountId:account.id},orderBy:{id:'asc'}}),before);
    assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:account.id}})).paidThrough?.toISOString(),account.paidThrough?.toISOString());
    cases.push('repeat-apply-original-checkout-invoice-binding-refuses-redirect-without-grant');
    await retry();input.loseResume();await input.operations.drain();op=(await read(op.id)).body;
    assert.equal(op.state,'UNKNOWN');assert.equal(op.observed.invoiceId,original.id);assert.equal(op.observed.invoiceApplyState,'PENDING');
    assert.equal(input.purchaseCount(),purchases);assert.equal(input.invoiceCount(),invoices);
    assert.deepEqual(await db.billingReceiptGrant.findMany({where:{billingAccountId:account.id},orderBy:{id:'asc'}}),before);
    if(browser){const page=browser.page;await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('status').filter({hasText:'ยังยืนยันผลไม่ได้'}).waitFor();}
    await retry();await input.operations.drain();op=(await read(op.id)).body;
    assert.equal(op.state,'SUCCEEDED');assert.equal(op.observed.invoiceId,original.id);assert.equal(op.observed.invoiceApplyState,'APPLIED');
    const grants=await db.billingReceiptGrant.findMany({where:{billingAccountId:account.id,sourceKey:original.id}});assert.equal(grants.length,1);assert.equal(grants[0]!.units,1200);
    assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:account.id}})).paidThrough?.toISOString(),original.periodEnd.toISOString());
    assert.equal(input.purchaseCount(),purchases);assert.equal(input.invoiceCount(),invoices);
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{referenceId:op.id,kind:'CONTROL_OPERATION_REVIEW'}})).state,'RESOLVED');
    assert.equal((await request(invoicePath)).body.canRetry,false);
    cases.push('repeat-apply-original-schedule-resume-response-loss-same-operation-one-purchase-grant');
    if(browser){
      const page=browser.page;await page.getByRole('button',{name:'อัปเดตสถานะ',exact:true}).click();
      await page.getByRole('status').filter({hasText:'ดำเนินการเสร็จแล้ว'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      await page.screenshot({path:`${browser.evidenceDir}/admin-repeat-apply-mobile.png`,fullPage:true});
      await page.getByRole('link',{name:'เปิดรายการชำระเดิม',exact:true}).click();
      await page.getByRole('heading',{name:'รายการนี้เปิดแพ็กเกจแล้ว',exact:true}).waitFor();
      await page.getByRole('link',{name:'ดูแพ็กเกจปัจจุบันของบริษัท',exact:true}).click();await page.getByRole('region',{name:'ข้อมูลการชำระเงินบริษัท'}).waitFor();
      cases.push('browser-repeat-apply-preview-unknown-reload-retry-original-invoice-company-return');
    }
    return cases;
  }finally{
    input.session.invoice=originalSessionInvoice;
    if(viewport&&browser)await browser.page.setViewportSize(viewport);
    await db.billingIssue.deleteMany({where:{referenceId:{in:ids},kind:'CONTROL_OPERATION_REVIEW'}});
    await db.billingOperation.deleteMany({where:{id:{in:ids}}});
    if(!priorScope)await db.billingOperatorScope.deleteMany({where:identity});
    await db.membershipRole.deleteMany({where:{membershipId:input.membershipId,roleId}});await db.role.deleteMany({where:{id:roleId}});
  }
}
