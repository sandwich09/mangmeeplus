import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { startBillingBrowser } from './billing-browser-smoke';

export async function checkBillingAdjustments(input:{prisma:PrismaService;companyId:string;foreignCompanyId:string;userId:string;membershipId:string;
  provider:Record<string,Record<string,any>[]>;browser?:Awaited<ReturnType<typeof startBillingBrowser>>;
  request:(path:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<{status:number;body:any}>;
  transport:(hook:((url:URL,init?:RequestInit)=>Promise<Response|undefined>)|undefined)=>void;
  intercept:(hook:((path:string,method:string)=>Promise<void>)|undefined)=>void}) {
  const db=input.prisma.client,run=randomUUID().replaceAll('-',''),cases:string[]=[],writes:string[]=[];
  const account=await db.billingAccount.findFirstOrThrow({where:{companyId:input.companyId}});
  const row=await db.billingInvoice.findFirstOrThrow({where:{billingAccountId:account.id,applyStatus:'APPLIED'}});
  const customerBase=`/v1/companies/${input.companyId}/billing`,adminBase=`/v1/system/billing/companies/${input.companyId}`;
  const detail=(base=customerBase,kind='refunds',cursor?:string)=>`${base}/invoices/${row.id}/adjustments/${kind}${cursor?`?cursor=${cursor}`:''}`;
  const before={term:await db.companyPlanTerm.findUnique({where:{companyId:input.companyId}}),grants:await db.billingReceiptGrant.findMany({where:{companyId:input.companyId},orderBy:{id:'asc'}})};
  const statuses=['pending','requires_action','succeeded','failed','canceled',null];
  const refunds=Array.from({length:27},(_,n)=>({id:`re_${run}${n}`,object:'refund',charge:row.providerChargeId,currency:'thb',amount:100,created:Math.floor(Date.now()/1000)-n,
    status:statuses[n%statuses.length],metadata:{secret:'must-not-leak'},instructions_email:'private@example.test'}));
  const notes=Array.from({length:27},(_,n)=>({id:`cn_${run}${n}`,object:'credit_note',invoice:row.providerInvoiceId,customer:account.customerId,livemode:false,
    currency:'thb',amount:100,number:`SYNTHETIC-CN-${n}`,status:n%2?'void':'issued',created:Math.floor(Date.now()/1000)-n,pdf:`https://pay.stripe.com/credit_notes/${run}${n}/pdf`,metadata:{secret:'must-not-leak'}}));
  let fail=false,incomplete=false,hook:((path:string)=>Promise<void>)|undefined;
  input.transport(async(url,init)=>{
    const path=url.pathname.slice(3),kind=path.startsWith('/refunds')?'refunds':path.startsWith('/credit_notes')?'notes':null;if(!kind)return undefined;
    assert.equal(init?.method,'GET');if(hook)await hook(path);
    if(fail)return new Response('{}',{status:503});
    const pool=kind==='refunds'?refunds:notes;
    if(path.split('/').length===3){const value=pool.find(v=>v.id===path.split('/').at(-1));return new Response(JSON.stringify(value??{}),{status:value?200:404});}
    assert.equal(url.searchParams.get(kind==='refunds'?'charge':'invoice'),kind==='refunds'?row.providerChargeId:row.providerInvoiceId);
    assert.equal(url.searchParams.get('limit'),'25');
    const cursor=url.searchParams.get('starting_after'),start=cursor?pool.findIndex(v=>v.id===cursor)+1:0;
    return new Response(JSON.stringify({object:'list',data:pool.slice(start,incomplete?start:start+25),has_more:incomplete||pool.length>start+25}));
  });
  input.intercept(async(path,method)=>{if(method!=='GET')writes.push(`${method} ${path}`);});
  const request=async(path:string,method='GET',body?:unknown)=>{
    let result=await input.request(path,method,body,{'x-company-id':input.companyId});
    if(result.status===429){await new Promise(resolve=>setTimeout(resolve,(result.body.retryAfterSeconds??60)*1000+200));result=await input.request(path,method,body,{'x-company-id':input.companyId});}
    return result;
  };
  // Isolated runs create only their own read/document fixture permissions.
  for(const key of ['system.billing.read','system.billing.financial.read','system.billing.document.read']) await db.permission.upsert({where:{key},create:{key,description:key},update:{}});
  const role=await db.role.create({data:{scopeKey:'system',isSystem:true,key:`ADJUSTMENTS_${run}`,name:'Synthetic adjustment reader',permissions:{create:
    (await db.permission.findMany({where:{key:{in:['system.billing.read','system.billing.financial.read']}}})).map(p=>({permissionId:p.id}))}}});
  const scope=await db.billingOperatorScope.create({data:{userId:input.userId,companyId:input.companyId,stripeAccountId:account.stripeAccountId,livemode:false,createdByUserId:input.userId}});
  try {
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:role.id}});
    const first=await request(detail());assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.items.length,25);
    assert.deepEqual(first.body.items.slice(0,6).map((i:any)=>i.status),['pending','requires_action','succeeded','failed','canceled','unknown']);
    assert.doesNotMatch(JSON.stringify(first.body),/metadata|private@|https:|customerId|charge|secret/);
    const last=await request(detail(customerBase,'refunds',first.body.nextCursor));assert.equal(last.body.items.length,2);assert.equal(last.body.nextCursor,null);
    const credit=await request(detail(customerBase,'credit-notes'));assert.equal(credit.body.items.length,25);assert.equal(credit.body.items[1].status,'void');
    assert.equal((await request(detail(customerBase,'credit-notes',credit.body.nextCursor))).body.items.length,2);
    cases.push('adjustment-original-invoice-refund-statuses-credit-notes-25-plus-2-redacted-current-pages');
    const foreign=await input.request(detail(`/v1/companies/${input.foreignCompanyId}/billing`));assert.notEqual(foreign.status,200);
    refunds[24]!.charge='ch_foreign';assert.notEqual((await request(detail(customerBase,'refunds',first.body.nextCursor))).status,200);refunds[24]!.charge=row.providerChargeId;
    notes[24]!.invoice='in_foreign';assert.notEqual((await request(detail(customerBase,'credit-notes',credit.body.nextCursor))).status,200);notes[24]!.invoice=row.providerInvoiceId;
    for(const [key,bad] of [['customer','cus_wrong'],['livemode',true],['invoice','in_wrong']] as const){const saved=(notes[0] as any)[key];(notes[0] as any)[key]=bad;
      assert.notEqual((await request(detail(customerBase,'credit-notes'))).status,200);(notes[0] as any)[key]=saved;}
    incomplete=true;assert.notEqual((await request(detail())).status,200);incomplete=false;
    const savedId=refunds[1]!.id;refunds[1]!.id=refunds[0]!.id;assert.notEqual((await request(detail())).status,200);refunds[1]!.id=savedId;
    cases.push('adjustment-foreign-company-cursors-provider-binding-duplicates-incomplete-page-rejected');
    const finance=await request(detail(adminBase));assert.equal(finance.status,200);assert.equal(finance.body.canOpenDocuments,false);
    assert.equal((await request(`${adminBase}/documents/${row.id}/open`,'POST',{kind:'receipt'})).status,403);
    const permission=await db.permission.findUniqueOrThrow({where:{key:'system.billing.document.read'}});
    await db.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
    for(const kind of ['invoice','receipt','pdf','credit-note']){
      const result=await request(`${adminBase}/documents/${row.id}/open`,'POST',{kind,...kind==='credit-note'?{creditNoteId:notes[0]!.id}:{}});
      assert.equal(result.status,200,JSON.stringify(result.body));assert.match(result.body.url,/^https:\/\/(invoice|pay)\.stripe\.com\//);
    }
    const unsafe=notes[0]!.pdf;notes[0]!.pdf='https://pay.stripe.com.attacker.example/file';
    assert.notEqual((await request(`${customerBase}/documents/${row.id}/open`,'POST',{kind:'credit-note',creditNoteId:notes[0]!.id})).status,200);notes[0]!.pdf=unsafe;
    const audit=await db.auditLog.findMany({where:{targetId:row.id,action:'billing.operator_document.opened'}});assert.equal(audit.length,4);assert.doesNotMatch(JSON.stringify(audit.map(a=>a.metadataJson)),/https:|metadata|secret/);
    cases.push('adjustment-finance-read-document-separation-four-provider-documents-audit-unsafe-url');
    hook=async()=>{hook=undefined;await db.billingOperatorScope.update({where:{id:scope.id},data:{revokedAt:new Date()}});};
    assert.equal((await request(detail(adminBase))).status,404);await db.billingOperatorScope.update({where:{id:scope.id},data:{revokedAt:null}});
    hook=async()=>{hook=undefined;await db.companyMembership.update({where:{id:input.membershipId},data:{status:'DISABLED'}});};
    assert.equal((await request(detail())).status,403);await db.companyMembership.update({where:{id:input.membershipId},data:{status:'ACTIVE'}});
    hook=async()=>{hook=undefined;await db.company.update({where:{id:input.companyId},data:{status:'DISABLED'}});};
    assert.equal((await request(detail())).status,403);await db.company.update({where:{id:input.companyId},data:{status:'ACTIVE'}});
    hook=async()=>{hook=undefined;await db.rolePermission.delete({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}}});};
    assert.equal((await request(`${adminBase}/documents/${row.id}/open`,'POST',{kind:'credit-note',creditNoteId:notes[0]!.id})).status,403);
    await db.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
    cases.push('adjustment-post-provider-membership-scope-and-document-permission-revocation');
    if(input.browser){
      const {page,origin,evidenceDir}=input.browser;await page.setViewportSize({width:390,height:844});
      // Respect the same customer command budget after the preceding negative API cases.
      await new Promise(resolve=>setTimeout(resolve,61000));
      await page.goto(`${origin}/companies/${input.companyId}/billing?channel=line`,{waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'ประวัติ',exact:true}).click();
      await page.getByRole('link',{name:'ดูเอกสาร',exact:true}).first().click();
      await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).waitFor();await page.getByText('ต้องทำขั้นตอนเพิ่มเติม',{exact:false}).first().waitFor();
      await page.getByRole('button',{name:'รายการหน้าถัดไป',exact:true}).click();await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).getByRole('article').nth(1).waitFor();assert.equal(await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).getByRole('article').count(),2);
      await page.getByRole('button',{name:'กลับไปหน้าแรก',exact:true}).click();await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).getByRole('article').nth(24).waitFor();assert.equal(await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).getByRole('article').count(),25);
      fail=true;await page.getByRole('button',{name:'อัปเดตข้อมูล',exact:true}).click();await page.getByRole('alert').filter({hasText:'อ่านข้อมูลจาก Stripe ไม่สำเร็จ'}).waitFor();assert.equal(await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).count(),0);
      fail=false;await page.getByRole('button',{name:'ลองอ่านข้อมูลอีกครั้ง',exact:true}).click();await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).waitFor();
      await page.getByRole('combobox',{name:'รายการที่ต้องการดู',exact:true}).click();await page.getByRole('option',{name:'เอกสารปรับยอด',exact:true}).click();await page.getByText(notes[0]!.number,{exact:true}).waitFor();
      await page.screenshot({path:`${evidenceDir}/customer-adjustments-mobile.png`,fullPage:true});
      await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).waitFor();
      await page.getByRole('link',{name:'กลับไปประวัติการชำระเงิน',exact:true}).click();await page.getByRole('region',{name:'ประวัติการชำระเงิน'}).waitFor();
      await page.goBack({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'เอกสารการชำระเงิน',exact:true}).waitFor();
      await page.goto(`${origin}/system/billing/companies/${input.companyId}?view=payments`,{waitUntil:'domcontentloaded'});
      await page.getByRole('link',{name:'ดูเอกสารและยอดเงิน',exact:true}).first().click();await page.getByText('ประวัติคืนเงินและเอกสารปรับยอด',{exact:true}).click();await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).waitFor();
      await page.getByRole('combobox',{name:'รายการที่ต้องการดู',exact:true}).click();await page.getByRole('option',{name:'เอกสารปรับยอด',exact:true}).click();await page.getByText(notes[0]!.number,{exact:true}).waitFor();
      const target=`https://pay.stripe.com/credit_notes/${run}0/pdf`;await page.route(target,route=>route.fulfill({contentType:'text/html',body:'Synthetic Stripe credit-note PDF'}));
      await page.getByRole('button',{name:'เปิด PDF เอกสารปรับยอด',exact:true}).first().click();await page.waitForURL(target);await page.goBack({waitUntil:'domcontentloaded'});
      await page.getByText('ประวัติคืนเงินและเอกสารปรับยอด',{exact:true}).click();
      await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${evidenceDir}/admin-adjustments-mobile.png`,fullPage:true});await page.unroute(target);
      cases.push('browser-line-origin-refund-history-pagination-error-retry-reload-back-and-admin-credit-note-document-return');
      try {
        await db.companyPlanTerm.update({where:{companyId:input.companyId},data:{termEndsAt:new Date(0)}});
        assert.equal((await request(detail())).status,200);
        assert.equal((await input.request(`/v1/companies/${input.companyId}/expenses`)).body.code,'company_term_expired');
        await db.company.update({where:{id:input.companyId},data:{status:'DISABLED'}});
        await db.companyPlanTerm.update({where:{companyId:input.companyId},data:{termDisabledAt:new Date()}});
        assert.equal((await request(detail())).status,200);
        await page.goto(`${origin}/companies/${input.companyId}/billing/invoices/${row.id}?channel=line`,{waitUntil:'domcontentloaded'});
        await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).waitFor();
        await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'รายละเอียดการปรับยอด'}).waitFor();
        await page.getByRole('link',{name:'กลับไปประวัติการชำระเงิน',exact:true}).click();await page.getByRole('region',{name:'ประวัติการชำระเงิน'}).waitFor();
        cases.push('adjustment-expired-and-term-disabled-owner-keeps-web-line-document-return-business-stays-blocked');
      } finally {
        await db.company.update({where:{id:input.companyId},data:{status:'ACTIVE'}});
        await db.companyPlanTerm.update({where:{companyId:input.companyId},data:{termEndsAt:before.term!.termEndsAt,termDisabledAt:before.term!.termDisabledAt,updatedAt:before.term!.updatedAt}});
      }
    }
    assert.deepEqual(await db.companyPlanTerm.findUnique({where:{companyId:input.companyId}}),before.term);
    assert.deepEqual(await db.billingReceiptGrant.findMany({where:{companyId:input.companyId},orderBy:{id:'asc'}}),before.grants);assert.deepEqual(writes,[]);
    assert.equal((await db.billingInvoice.findUniqueOrThrow({where:{id:row.id}})).evidenceHash,row.evidenceHash);
    cases.push('adjustment-observation-and-document-access-never-mutates-provider-money-grants-or-paid-term');
    return cases;
  } catch(error) {
    if(input.browser)try{const page=input.browser.page;console.error('adjustment-safe-browser-state',JSON.stringify({path:new URL(page.url()).pathname,
      headings:await page.getByRole('heading',{level:1}).allTextContents(),alerts:await page.getByRole('alert').allTextContents()}));
      await page.screenshot({path:`${input.browser.evidenceDir}/adjustment-failure.png`,fullPage:true});}catch{/* Preserve the original test failure. */}
    throw error;
  } finally {
    hook=undefined;input.transport(undefined);input.intercept(undefined);
    await db.companyMembership.update({where:{id:input.membershipId},data:{status:'ACTIVE'}});
    await db.company.update({where:{id:input.companyId},data:{status:'ACTIVE'}});
    await db.membershipRole.deleteMany({where:{roleId:role.id}});await db.rolePermission.deleteMany({where:{roleId:role.id}});await db.role.delete({where:{id:role.id}});
    await db.billingOperatorScope.delete({where:{id:scope.id}});
  }
}
