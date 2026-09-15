import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';

/** Real HTTP/PG/Next with GET-only simulated Stripe balance evidence. */
export async function checkBillingSettlement(input:Parameters<typeof checkBillingConfigurationDrafts>[0]){
  const {request,approveRequest,browser,companyId,stripeAccountId}=input,db=input.prisma.client,base='/v1/system/billing/settlements',tag=randomUUID().replace(/-/g,''),cases:string[]=[];
  const account=await db.billingAccount.findFirstOrThrow({where:{companyId,stripeAccountId,livemode:false}}),customer=account.customerId??`cus_Settlement${tag}`;
  await db.billingAccount.update({where:{id:account.id},data:{customerId:customer}});
  const settings=await db.billingSettings.findFirstOrThrow({where:{stripeAccountId,livemode:false}}),stamp=Math.floor(Date.now()/1000)-3600;
  assert.ok(settings.policyRevisionId);
  const invoice=await db.billingInvoice.create({data:{billingAccountId:account.id,providerInvoiceId:`in_Settlement${tag}`,providerChargeId:`ch_Settlement${tag}`,subscriptionId:`sub_Settlement${tag}`,
    providerNumber:'TEST-SETTLEMENT',offerSnapshot:{offerKey:'PRO_999',interval:'year'},policyRevisionId:settings.policyRevisionId,currency:'THB',totalSatang:10700,paidSatang:10700,taxSatang:700,
    periodStart:new Date(stamp*1000),periodEnd:new Date((stamp+86400)*1000),providerStatus:'paid',evidenceHash:'synthetic-settlement-source',applyStatus:'HELD'}});
  const movement=(i:number,values:Record<string,unknown>={})=>({id:`txn_${tag}_${i}`,object:'balance_transaction',source:null,type:'stripe_fee',reporting_category:'fee',currency:'thb',amount:-10,fee:0,net:-10,
    status:'available',created:stamp,available_on:stamp+60,...values});
  const chargeRow=movement(0,{source:invoice.providerChargeId,type:'charge',reporting_category:'charge',amount:10700,fee:300,net:10400});
  const payoutRow=movement(1,{source:`po_${tag}`,type:'payout',reporting_category:'payout',amount:-10400,fee:0,net:-10400});
  const refundRow=movement(2,{source:`re_${tag}`,type:'refund',reporting_category:'refund',amount:-1000,fee:0,net:-1000});
  const missingRow=movement(3,{source:`ch_Missing${tag}`,type:'charge',reporting_category:'charge',amount:1000,fee:30,net:970});
  const usdRow=movement(4,{currency:'usd',amount:999,net:999});
  const originalRows=[chargeRow,payoutRow,refundRow,missingRow,usdRow,...Array.from({length:22},(_,i)=>movement(i+5))];
  let wrongPayment=false,rows=originalRows,reads=0,writes=0,missingTax=false,wrongMode=false,lose=false,repeat=false,payoutStatus='paid';
  let intercept:((url:URL)=>Promise<void>)|undefined;
  const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  const list=(data:unknown[],has_more=false)=>({object:'list',data,has_more});
  input.transport(async(url,init)=>{
    if(init?.method!=='GET'){writes++;return undefined;}reads++;await intercept?.(url);
    const path=url.pathname.replace('/v1','');
    if(path==='/balance_transactions'){
      if(lose){lose=false;throw new Error('synthetic unavailable before balance page');}
      if(url.searchParams.has('payout')){assert.equal(url.searchParams.get('payout'),`po_${tag}`);return response(list([chargeRow]));}
      assert.equal(url.searchParams.get('limit'),'25');const cursor=url.searchParams.get('starting_after'),start=cursor&&!repeat?rows.findIndex(r=>r.id===cursor)+1:0;
      return response(list(rows.slice(start,start+25),start+25<rows.length));
    }
    if(path===`/payouts/po_${tag}`)return response({id:`po_${tag}`,object:'payout',livemode:wrongMode,currency:'thb',amount:10400,status:payoutStatus,arrival_date:stamp+86400,automatic:true,method:'standard',reconciliation_status:'completed',balance_transaction:payoutRow.id});
    if(path===`/charges/${invoice.providerChargeId}`||path===`/charges/ch_Missing${tag}`){const missing=path.includes('/ch_Missing');return response({id:missing?`ch_Missing${tag}`:invoice.providerChargeId,object:'charge',livemode:wrongMode,customer,currency:'thb',
      amount:missing?1000:10700,amount_refunded:1000,disputed:false,status:'succeeded',paid:true,captured:true,payment_intent:`pi_${tag}`,payment_method_details:{type:'card'},balance_transaction:missing?missingRow.id:chargeRow.id});}
    if(path==='/invoice_payments')return response(list([{id:`inpay_${tag}`,object:'invoice_payment',livemode:false,status:'paid',invoice:wrongPayment?'in_Foreign':invoice.providerInvoiceId,
      payment:{type:'payment_intent',payment_intent:`pi_${tag}`},amount_paid:10700,currency:'thb'}]));
    if(path===`/payment_intents/pi_${tag}`)return response({id:`pi_${tag}`,object:'payment_intent',livemode:false,currency:'thb',status:'succeeded',customer,amount_received:10700,latest_charge:invoice.providerChargeId});
    // Refund objects do not require a livemode field in Stripe's documented shape.
    if(path===`/refunds/re_${tag}`)return response({id:`re_${tag}`,object:'refund',charge:invoice.providerChargeId,currency:'thb',amount:1000,status:'succeeded',balance_transaction:refundRow.id});
    if(path===`/invoices/${invoice.providerInvoiceId}`)return response({id:invoice.providerInvoiceId,object:'invoice',livemode:false,customer,currency:'thb',status:'paid',total:10700,amount_paid:10700,
      parent:{subscription_details:{subscription:invoice.subscriptionId}},total_taxes:missingTax?undefined:[{amount:700}]});
    return undefined;
  });
  const ids:string[]=[],body={windowStart:new Date((stamp-60)*1000).toISOString(),windowEnd:new Date((stamp+120)*1000).toISOString(),reason:`ตรวจยอดจำลอง ${tag}`};
  const create=async()=>{const key=randomUUID(),r=await request(base,'POST',body,{'idempotency-key':key});assert.equal(r.status,200,JSON.stringify(r));ids.push(r.body.id);return {row:r.body,key};};
  const get=async(id:string)=>{const r=await request(`${base}/${id}`);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const act=async(row:any,action='run',actor=request)=>{const r=await actor(`${base}/${row.id}/${action}`,'POST',{expectedVersion:row.version});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const cancel=async(id:string)=>{const r=await get(id);if(r.canCancel)await act(r,'cancel');};
  const financial=async()=>({invoice:await db.billingInvoice.findUniqueOrThrow({where:{id:invoice.id}}),grants:await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}}),term:await db.companyPlanTerm.findUnique({where:{companyId}})});
  const before=await financial(),viewport=browser?.page.viewportSize();
  try{
    const first=await create();assert.equal((await request(base,'POST',body,{'idempotency-key':first.key})).body.id,first.row.id);
    assert.equal((await request(base,'POST',{...body,reason:'different'},{'idempotency-key':first.key})).status,409);
    assert.equal((await request(base,'POST',{...body,accountId:account.id},{'idempotency-key':randomUUID()})).status,400);
    assert.equal((await request(base,'POST',{...body,windowEnd:new Date().toISOString()},{'idempotency-key':randomUUID()})).status,400);
    assert.equal((await request(`${base}?cursor=${randomUUID()}`)).status,404);
    const partial=await act(first.row);assert.equal(partial.state,'QUEUED');assert.equal(partial.seen,25);assert.equal(partial.totals.knownTax,'700');assert.equal(partial.totals.unknownTaxCharges,1);assert.equal(partial.totals.excluded,1);
    const finished=await act(partial);assert.equal(finished.state,'SUCCEEDED');assert.equal(finished.seen,27);assert.equal(finished.pages,2);assert.equal(finished.totals.grossCharges,'11700');
    assert.equal(finished.totals.fees,'330');assert.equal(finished.totals.netMovement,'-250');assert.equal(finished.totals.payouts,'10400');assert.equal(finished.different,2);assert.equal(finished.missing,1);
    const findings=(await request(`${base}/${first.row.id}/findings`)).body;assert.equal(findings.items.length,25);assert.ok(findings.nextCursor);assert.equal(findings.caseIds.length,1);
    const page2=(await request(`${base}/${first.row.id}/findings?cursor=${findings.nextCursor}`)).body;assert.equal(page2.items.length,2);
    const all=[...findings.items,...page2.items];assert.equal(new Set(all.map(f=>f.id)).size,27);assert.ok(all.some(f=>f.payout?.reconciliation==='MATCHED'));assert.ok(all.some(f=>f.invoiceId===invoice.id));
    assert.ok(!JSON.stringify([finished,findings,page2]).includes(invoice.providerInvoiceId));assert.ok(!JSON.stringify(findings).includes(customer));
    assert.equal((await request(`${base}/${first.row.id}/findings?cursor=${first.row.id}`)).status,404);
    cases.push('settlement-original-pages-checkpoint-exact-gross-tax-fee-net-payout-unknown-tax-and-scoped-local-findings');

    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});
    try{assert.equal((await request(base)).status,403);assert.equal((await request(`${base}/${first.row.id}`)).status,403);assert.equal((await request(`${base}/${first.row.id}/findings`)).status,403);}
    finally{await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminRoleId}});}
    const scopeOp=await create();intercept=async url=>{if(url.pathname==='/v1/balance_transactions'){intercept=undefined;await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});}};
    try{const result=await act(scopeOp.row,'run',approveRequest);assert.equal(result.state,'BLOCKED');assert.equal(result.seen,0);}
    finally{await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminRoleId}});intercept=undefined;}
    await cancel(scopeOp.row.id);cases.push('settlement-platform-finance-scope-denies-company-only-and-rechecks-initiator-after-provider-read');

    for(const fault of ['mode','tax','arithmetic','payment'] as const){const item=await create();wrongMode=fault==='mode';wrongPayment=fault==='payment';missingTax=fault==='tax';rows=fault==='arithmetic'?[{...chargeRow,net:1}]:[chargeRow];
      try{const result=await act(item.row);assert.equal(result.state,'BLOCKED',fault);assert.equal(result.seen,0);assert.equal(await db.billingOperation.count({where:{type:'OBSERVE_PROVIDER_BALANCE',referenceId:item.row.id}}),0);}
      finally{wrongMode=false;wrongPayment=false;missingTax=false;rows=originalRows;}await cancel(item.row.id);}
    const duplicate=await create(),prefix=await act(duplicate.row);repeat=true;try{assert.equal((await act(prefix)).state,'BLOCKED');assert.equal((await get(prefix.id)).seen,25);}finally{repeat=false;}await cancel(prefix.id);
    cases.push('settlement-foreign-mode-missing-tax-malformed-arithmetic-and-repeated-pages-never-publish-complete');

    const source=await create();rows=[chargeRow];intercept=async url=>{if(url.pathname===`/v1/invoices/${invoice.providerInvoiceId}`){intercept=undefined;await db.billingInvoice.update({where:{id:invoice.id},data:{refundedSatang:1}});}};
    try{assert.equal((await act(source.row)).state,'BLOCKED');assert.equal((await get(source.row.id)).seen,0);}finally{await db.billingInvoice.update({where:{id:invoice.id},data:{refundedSatang:0,updatedAt:before.invoice.updatedAt}});intercept=undefined;}
    await cancel(source.row.id);rows=originalRows;cases.push('settlement-current-invoice-mapping-fence-rejects-financial-change-during-provider-observation');

    const lease=await create();intercept=async url=>{if(url.pathname==='/v1/balance_transactions'){intercept=undefined;await db.billingOperation.update({where:{id:lease.row.id},data:{leaseToken:'replacement-settlement-worker',leaseUntil:new Date(Date.now()+60000),version:{increment:1}}});}};
    const lost=await act(lease.row);assert.equal(lost.state,'RUNNING');assert.equal(lost.seen,0);assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:lost.id}})).leaseToken,'replacement-settlement-worker');
    await db.billingOperation.update({where:{id:lost.id},data:{leaseUntil:new Date(Date.now()-1)}});const recovered=await act(await get(lost.id));assert.equal(recovered.seen,25);await cancel(lost.id);
    const stopped=await create();intercept=async url=>{if(url.pathname==='/v1/balance_transactions'){intercept=undefined;await act(await get(stopped.row.id),'cancel',approveRequest);}};
    assert.equal((await act(stopped.row)).state,'CANCELLED');assert.equal((await get(stopped.row.id)).seen,0);intercept=undefined;
    cases.push('settlement-lost-lease-preserves-replacement-and-cancel-during-read-publishes-no-findings');

    const audit=await create(),trigger=`settlement_audit_${tag}`;rows=[chargeRow];
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.settlement.observed' AND NEW."targetId"='${audit.row.id}' THEN RAISE EXCEPTION 'synthetic settlement audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
    try{const result=await act(audit.row);assert.equal(result.state,'QUEUED');assert.equal(result.seen,0);assert.ok(result.retryAt);assert.equal(await db.billingOperation.count({where:{referenceId:audit.row.id,type:'OBSERVE_PROVIDER_BALANCE'}}),0);}
    finally{await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);}
    const current=await db.billingOperation.findUniqueOrThrow({where:{id:audit.row.id}});await db.billingOperation.update({where:{id:current.id},data:{resultJson:{...current.resultJson as object,retryAt:null}}});
    assert.equal((await act(await get(audit.row.id))).state,'SUCCEEDED');assert.equal(await db.billingOperation.count({where:{referenceId:audit.row.id,type:'OBSERVE_PROVIDER_BALANCE'}}),1);
    cases.push('settlement-real-postgres-audit-rollback-retains-checkpoint-and-same-run-retry-records-once');

    const outage=await create();lose=true;const wait=await act(outage.row);assert.equal(wait.state,'QUEUED');assert.ok(wait.retryAt);assert.equal(wait.seen,0);assert.equal(wait.canRun,false);await cancel(wait.id);
    const pending=await create();rows=[payoutRow];payoutStatus='pending';const pendingResult=await act(pending.row);assert.equal(pendingResult.state,'SUCCEEDED');const pf=(await request(`${base}/${pending.row.id}/findings`)).body.items[0];assert.equal(pf.payout.status,'pending');assert.equal(pf.payout.reconciliation,'PENDING');
    payoutStatus='failed';const failed=await create();await act(failed.row);assert.equal((await request(`${base}/${failed.row.id}/findings`)).body.items[0].payout.reconciliation,'FAILED');payoutStatus='paid';rows=originalRows;
    cases.push('settlement-provider-loss-backoff-and-delayed-or-failed-payout-remain-distinct-from-bank-confirmation');

    const worker=await create();rows=[chargeRow];await input.drainProviderScans();assert.equal((await get(worker.row.id)).state,'SUCCEEDED');assert.equal((await get(worker.row.id)).seen,1);
    const ceiling=await create(),ceilRow=await db.billingOperation.findUniqueOrThrow({where:{id:ceiling.row.id}});
    await db.billingOperation.update({where:{id:ceilRow.id},data:{resultJson:{...ceilRow.resultJson as object,pages:2000}}});
    const cap=await act(await get(ceilRow.id));assert.equal(cap.state,'BLOCKED');assert.equal(cap.errorCode,'PAGE_LIMIT_REACHED');assert.equal(cap.canResume,false);await cancel(cap.id);
    const unknown=await create(),unknownRow=await db.billingOperation.findUniqueOrThrow({where:{id:unknown.row.id}});
    await db.billingOperation.update({where:{id:unknownRow.id},data:{resultJson:{...unknownRow.resultJson as object,failures:4}}});lose=true;
    const paused=await act(await get(unknown.row.id));assert.equal(paused.state,'UNKNOWN');assert.equal(paused.canResume,false);
    const pausedRow=await db.billingOperation.findUniqueOrThrow({where:{id:paused.id}});await db.billingOperation.update({where:{id:paused.id},data:{resultJson:{...pausedRow.resultJson as object,retryAt:null}}});
    const resume=await act(await get(paused.id),'resume');assert.equal((await act(resume)).state,'SUCCEEDED');rows=originalRows;
    cases.push('settlement-existing-worker-page-cap-and-bounded-unknown-resume-preserve-original-window');

    const active=[];for(let i=0;i<5;i++)active.push((await create()).row);assert.equal((await request(base,'POST',body,{'idempotency-key':randomUUID()})).body.code,'CONTROL_SCAN_BUSY');
    for(const row of active)await cancel(row.id);cases.push('settlement-bounded-active-admission-and-every-partial-run-retains-cancel-path');

    if(browser){const page=browser.page;await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/billing/settlements`,{waitUntil:'domcontentloaded'});
      await page.getByLabel('เริ่มช่วงเวลา',{exact:true}).fill(new Date((stamp-60)*1000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));
      await page.getByLabel('สิ้นสุดช่วงเวลา',{exact:true}).fill(new Date((stamp+120)*1000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));
      await page.getByLabel('เหตุผล',{exact:true}).fill(body.reason);
      const originalWindow=await Promise.all(['เริ่มช่วงเวลา','สิ้นสุดช่วงเวลา'].map(name=>page.getByLabel(name,{exact:true}).inputValue()));
      let browserRun='';
      for(let attempt=0;attempt<3;attempt++){
        const created=page.waitForResponse(r=>r.url().endsWith('/settlements')&&r.request().method()==='POST');
        await page.getByRole('button',{name:'เริ่มตรวจยอด',exact:true}).click();const result=await created,value=await result.json();
        if(result.status()===429){
          assert.equal(value.code,'BILLING_RATE_LIMIT');assert.ok(Number.isInteger(value.retryAfterSeconds)&&value.retryAfterSeconds>=1&&value.retryAfterSeconds<=60);
          await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();assert.equal(await page.getByLabel('เหตุผล',{exact:true}).inputValue(),body.reason);
          assert.deepEqual(await Promise.all(['เริ่มช่วงเวลา','สิ้นสุดช่วงเวลา'].map(name=>page.getByLabel(name,{exact:true}).inputValue())),originalWindow);
          await new Promise(resolve=>setTimeout(resolve,(value.retryAfterSeconds+1)*1000));continue;
        }
        assert.equal(result.status(),200,JSON.stringify(value));browserRun=value.id;break;
      }
      assert.ok(browserRun,'Original settlement creation must recover within bounded retries');ids.push(browserRun);
      await page.waitForURL(`${browser.origin}/system/billing/settlements/${browserRun}`);
      const browserNext=async()=>{
        for(let attempt=0;attempt<3;attempt++){
          const done=page.waitForResponse(r=>r.url().endsWith(`/${browserRun}/run`)&&r.request().method()==='POST');
          await page.getByRole('button',{name:'ตรวจรายการถัดไป',exact:true}).click();const res=await done,value=await res.json();
          if(res.status()===429){assert.ok(value.retryAfterSeconds<=60);await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();await new Promise(r=>setTimeout(r,(value.retryAfterSeconds+1)*1000));continue;}
          assert.equal(res.status(),200,JSON.stringify(value));await page.getByText(`ตรวจแล้ว ${value.seen} รายการ`,{exact:false}).waitFor();return value;
        }throw new Error('browser settlement rate limit did not recover within bounded retries');
      };
      const firstPage=await browserNext();assert.equal(firstPage.seen,25);await page.getByText('ยอดด้านล่างเฉพาะรายการที่ตรวจแล้ว ยังไม่ใช่ผลครบทั้งช่วง',{exact:true}).waitFor();
      const finalPage=await browserNext();assert.equal(finalPage.seen,27);await page.getByRole('status').filter({hasText:'ตรวจครบช่วงที่เลือก'}).waitFor();
      await page.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();await page.getByRole('button',{name:'กลับหน้าแรก',exact:true}).waitFor();
      await page.getByRole('button',{name:'กลับหน้าแรก',exact:true}).click();await page.getByRole('region',{name:'รายการยอดที่ตรวจแล้ว'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/mangmee-billing-browser-evidence/admin-settlement-result-mobile.png',fullPage:false});
      await page.getByRole('link',{name:'เปิดเคสที่ต้องตรวจ',exact:true}).click();await page.getByRole('link',{name:'เปิดงานตรวจยอดของเคสนี้',exact:true}).click();await page.waitForURL(`${browser.origin}/system/billing/settlements/${browserRun}`);
      await page.getByRole('link',{name:'กลับรายการงานตรวจ',exact:true}).click();await page.getByRole('heading',{name:'งานตรวจที่ผ่านมา',exact:true}).waitFor();
      let release!:()=>void,arrived!:(value:any)=>void,delivered!:()=>void,lateId='';
      const held=new Promise<void>(r=>{release=r;}),sent=new Promise<void>(r=>{delivered=r;});
      await page.route('**/settlements',async route=>{
        if(route.request().method()!=='POST'){await route.continue();return;}
        try{const res=await route.fetch(),value=await res.json();arrived({status:res.status(),body:value});
          if(res.status()===200){ids.push(value.id);await held;}await route.fulfill({response:res});if(res.status()===200)delivered();
        }catch(error){arrived({status:0,body:String(error)});await route.abort().catch(()=>{});delivered();}
      });
      try{
        await page.getByLabel('เหตุผล',{exact:true}).fill(`ตรวจหลังกลับหน้าบริษัท ${tag}`);
        for(let attempt=0;attempt<3;attempt++){
          const accepted=new Promise<any>(r=>{arrived=r;});await page.getByRole('button',{name:'เริ่มตรวจยอด',exact:true}).click();const response=await accepted;
          if(response.status===429){assert.ok(response.body.retryAfterSeconds<=60);await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();await new Promise(r=>setTimeout(r,(response.body.retryAfterSeconds+1)*1000));continue;}
          assert.equal(response.status,200,JSON.stringify(response));lateId=response.body.id;break;
        }
        assert.ok(lateId);await page.getByRole('link',{name:'บริษัท',exact:true}).click();await page.waitForURL(`${browser.origin}/system/billing`);release();await sent;
        await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));assert.equal(page.url(),`${browser.origin}/system/billing`);
        await page.goto(`${browser.origin}/system/billing/settlements`,{waitUntil:'domcontentloaded'});await page.locator(`a[href="/system/billing/settlements/${lateId}"]`).click();
        await page.getByRole('button',{name:'หยุดงานตรวจนี้',exact:true}).click();await page.getByRole('status').filter({hasText:'หยุดตรวจแล้ว'}).waitFor();
        assert.equal((await get(lateId)).state,'CANCELLED');
      }finally{release();await page.unroute('**/settlements');}
      cases.push('browser-settlement-late-created-response-cannot-navigate-after-leave-and-original-history-cancel-recovers');
      await page.goto(`${browser.origin}/system/billing/settlements/${pending.row.id}`,{waitUntil:'domcontentloaded'});await page.getByText('Stripe ยังไม่เริ่มโอน',{exact:true}).waitFor();
      await page.getByRole('link',{name:'เปิดรายงาน Stripe เพื่อตรวจต่อ',exact:true}).waitFor();await page.screenshot({path:'/tmp/mangmee-billing-browser-evidence/admin-settlement-pending-mobile.png',fullPage:true});
      cases.push('browser-settlement-create-retained-partial-next-page-complete-mobile-case-original-run-history-and-delayed-payout-path');
    }
    assert.deepEqual(await financial(),before);assert.equal(writes,0);assert.ok(reads>0);cases.push('settlement-get-only-never-mutates-financial-evidence-paid-days-quota-or-capacity');return cases;
  }finally{
    input.transport();if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await db.billingOperation.deleteMany({where:{type:'OBSERVE_PROVIDER_BALANCE',referenceId:{in:ids}}});
    await db.billingIssue.deleteMany({where:{stripeAccountId,livemode:false,referenceId:{in:ids},kind:{in:['SETTLEMENT_REVIEW','SETTLEMENT_SCAN_FAILED']}}});
    await db.billingOperation.deleteMany({where:{id:{in:ids},type:'SCAN_PROVIDER_BALANCE'}});
    await db.billingInvoice.delete({where:{id:invoice.id}});await db.billingAccount.update({where:{id:account.id},data:{customerId:account.customerId,updatedAt:account.updatedAt}});
  }
}
