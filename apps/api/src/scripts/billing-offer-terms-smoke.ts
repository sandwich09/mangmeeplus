import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {BillingPolicy} from '@watchdog-bms/contracts';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';

export async function checkBillingOfferTerms(input:Parameters<typeof checkBillingConfigurationDrafts>[0]){
  const {request,approveRequest,browser,provider}=input,db=input.prisma.client,base='/v1/system/billing',run=randomUUID().replaceAll('-',''),cases:string[]=[];
  const settings=async()=>(await request(`${base}/settings`)).body,initial=await settings(),viewport=browser?.page.viewportSize();
  const terms={monthlyPriceSatang:109901,annualPriceSatang:1099001,monthlyReceiptAllowance:125,branchLimit:7,employeeLimit:25};
  const priceId=`price_TermsPro${run}`,companyId=`offer-terms-${run}`,customerId=`cus_terms${run}`;
  const financial=async()=>({term:await db.companyPlanTerm.findUnique({where:{companyId:input.companyId}}),invoices:await db.billingInvoice.findMany({where:{billingAccountId:{in:(await db.billingAccount.findMany({where:{companyId:input.companyId},select:{id:true}})).map(row=>row.id)}},orderBy:{id:'asc'}}),grants:await db.billingReceiptGrant.findMany({where:{companyId:input.companyId},orderBy:{id:'asc'}})});
  const before=await financial();let mismatch=false,accountId='',writes=0;const ownedSessions=new Map<string,Record<string,any>>();
  const response=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
  const policy:BillingPolicy={...initial.policy,offerTerms:{...initial.policy.offerTerms,PRO_999:terms},priceIds:{...initial.policy.priceIds,'PRO_999:year':priceId}};
  input.transport(async(url,init)=>{
    if(url.hostname!=='api.stripe.com')return undefined;const path=url.pathname.slice(3),method=init?.method??'GET',form=new URLSearchParams(String(init?.body??''));
    if(method==='GET'&&path===`/prices/${priceId}`)return response({id:priceId,object:'price',livemode:false,active:true,type:'recurring',product:'prod_Pro',currency:'thb',unit_amount:mismatch?terms.annualPriceSatang+1:terms.annualPriceSatang,
      recurring:{interval:'year',interval_count:1,usage_type:'licensed'},billing_scheme:'per_unit',tax_behavior:'inclusive'});
    if(method==='POST'&&path==='/customers'&&form.get('metadata[billingAccountId]')===(await db.billingAccount.findFirst({where:{companyId}}))?.id){
      accountId=form.get('metadata[billingAccountId]')!;const customer={id:customerId,object:'customer',livemode:false,email:form.get('email'),metadata:{billingAccountId:accountId}};provider.customers!.push(customer);writes++;return response(customer);
    }
    if(method==='POST'&&path==='/checkout/sessions'&&form.get('mode')==='subscription'&&form.get('customer')===customerId){
      const key=new Headers(init?.headers).get('idempotency-key')!;if(ownedSessions.has(key))return response(ownedSessions.get(key));
      assert.equal(form.get('line_items[0][price]'),priceId);assert.equal(form.get('line_items[0][quantity]'),'1');
      const session={id:`cs_terms${run}`,object:'checkout.session',livemode:false,mode:'subscription',status:'open',customer:customerId,subscription:null,client_reference_id:form.get('client_reference_id'),
        metadata:{billingAccountId:accountId,billingAttemptId:form.get('metadata[billingAttemptId]')},url:'https://checkout.stripe.com/c/pay/synthetic-terms'};
      ownedSessions.set(key,session);provider.sessions!.push(session);writes++;return response(session);
    }
    return undefined;
  });
  const proof=async(actor=request)=>{if(!(await actor(`${base}/settings`)).body.reauthenticatedUntil)assert.equal((await actor(`${base}/reauthenticate`,'POST',{password:input.password})).status,200);};
  const preview=async(next:unknown)=>{const s=await settings();return request(`${base}/configuration-changes/preview`,'POST',{type:'PUBLISH_POLICY',expectedVersion:s.version,policy:next,gates:s.gates,reason:'ทดสอบราคาและใบเสร็จตามรายการซื้อใหม่'});};
  const publish=async(next:BillingPolicy)=>{const p=await preview(next);assert.equal(p.status,200,JSON.stringify(p));await proof();const submitted=await request(`${base}/configuration-changes/${p.body.id}/submit`,'POST',
    {expectedVersion:p.body.version,previewHash:p.body.previewHash},{'idempotency-key':`terms-${p.body.id}`});assert.equal(submitted.status,200,JSON.stringify(submitted));await proof(approveRequest);
    const approved=await approveRequest(`${base}/configuration-changes/${p.body.id}/approve`,'POST',{expectedVersion:submitted.body.version,previewHash:submitted.body.previewHash});assert.equal(approved.body.state,'SUCCEEDED',JSON.stringify(approved));return approved.body;};
  const press=async(page:NonNullable<typeof browser>['page'],name:string,path:string)=>{
    for(let i=0;i<3;i++){
      const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(path)),page.getByRole('button',{name,exact:true}).click()]);
      const body=await response.json();if(response.status()===200)return;
      assert.equal(response.status(),429,JSON.stringify(body));assert.equal(body.code,'BILLING_RATE_LIMIT');
      assert.ok(Number.isInteger(body.retryAfterSeconds)&&body.retryAfterSeconds>=1&&body.retryAfterSeconds<=60);
      await page.getByRole('alert').filter({hasText:`กรุณารอ ${body.retryAfterSeconds} วินาที`}).waitFor();
      if(path.endsWith('/configuration-drafts')){
        assert.equal(await page.getByLabel('มืออาชีพ (PRO) · ราคารายปี (บาท)',{exact:true}).inputValue(),'10990.01');
        assert.equal(await page.getByLabel('มืออาชีพ (PRO) · ใบเสร็จที่ได้เมื่อซื้อรายเดือน',{exact:true}).inputValue(),'125');
      }
      await new Promise(resolve=>setTimeout(resolve,(body.retryAfterSeconds+1)*1000));
    }
    assert.fail('Original offer configuration command did not recover within the actual rate limit');
  };
  try{
    for(const offerTerms of [false,[],{PRO_999:{}},{ENTERPRISE_1999:terms},{PRO_999:{...terms,branchLimit:1001}},{PRO_999:{...terms,employeeLimit:0}},{PRO_999:{...terms,monthlyReceiptAllowance:0}},{PRO_999:{...terms,annualPriceSatang:0.5}}])assert.equal((await preview({...policy,offerTerms})).status,400);
    mismatch=true;assert.equal((await preview(policy)).body.code,'BILLING_PRICE_MISMATCH');mismatch=false;
    assert.equal(writes,0);assert.deepEqual(await financial(),before);cases.push('offer-terms-strict-typed-allowlist-bounds-and-provider-price-mismatch-before-publication');
    if(browser){const page=browser.page;await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/billing/settings`,{waitUntil:'domcontentloaded'});
      await page.getByText('ราคาและสิทธิ์ของแพ็กเกจ',{exact:true}).click();
      const field=page.getByLabel('มืออาชีพ (PRO) · ราคารายปี (บาท)',{exact:true});await field.fill('10990.001');
      await page.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true}).fill('ปรับราคาและจำนวนใบเสร็จสำหรับรายการซื้อใหม่');
      const count=await db.billingOperation.count({where:{stripeAccountId:input.stripeAccountId,type:'PUBLISH_POLICY'}});
      await page.getByRole('button',{name:'บันทึกฉบับร่าง',exact:true}).click();assert.equal(await field.evaluate((element:HTMLInputElement)=>element.validity.valid),false);
      assert.equal(await db.billingOperation.count({where:{stripeAccountId:input.stripeAccountId,type:'PUBLISH_POLICY'}}),count);
      await field.fill('10990.01');await page.getByLabel('มืออาชีพ (PRO) · ราคารายเดือน (บาท)',{exact:true}).fill('1099.01');
      await page.getByLabel('มืออาชีพ (PRO) · ใบเสร็จที่ได้เมื่อซื้อรายเดือน',{exact:true}).fill('125');
      await page.getByLabel('มืออาชีพ (PRO) · จำนวนสาขาสูงสุด',{exact:true}).fill('7');
      await page.getByLabel('มืออาชีพ (PRO) · จำนวนผู้ใช้สูงสุด รวมเจ้าของ',{exact:true}).fill('25');
      await page.getByText('เชื่อมราคาและ Portal ของ Stripe',{exact:true}).click();await page.getByLabel('มืออาชีพ (PRO) · รายปี · ราคาเก็บเงิน',{exact:true}).fill(priceId);
      await press(page,'บันทึกฉบับร่าง','/configuration-drafts');await page.getByRole('status').filter({hasText:'ฉบับร่างที่บันทึกไว้'}).waitFor();
      const href=await page.getByRole('link',{name:'เปิดลิงก์คำขอนี้',exact:true}).getAttribute('href');assert.ok(href);await page.goto(`${browser.origin}${href}`,{waitUntil:'domcontentloaded'});
      await page.getByText('ราคาและสิทธิ์ของแพ็กเกจ',{exact:true}).click();assert.equal(await field.inputValue(),'10990.01');
      assert.equal(await page.getByLabel('มืออาชีพ (PRO) · จำนวนสาขาสูงสุด',{exact:true}).inputValue(),'7');
      assert.equal(await page.getByLabel('มืออาชีพ (PRO) · จำนวนผู้ใช้สูงสุด รวมเจ้าของ',{exact:true}).inputValue(),'25');
      await page.getByText('ซื้อรายปีได้ 1,500 ใบทันที',{exact:true}).waitFor();
      await page.screenshot({fullPage:true,path:`${browser.evidenceDir}/admin-offer-terms-mobile.png`});
      await press(page,'ตรวจผลกระทบการตั้งค่า','/configuration-changes/preview');await page.getByRole('status').filter({hasText:'ตรวจผลกระทบก่อนส่ง'}).waitFor();
      await proof();await press(page,'บันทึกคำขอก่อนยืนยัน','/submit');await page.getByRole('status').filter({hasText:'รอยืนยันรายการ'}).waitFor();
      const original=await page.getByRole('link',{name:'เปิดลิงก์คำขอนี้',exact:true}).getAttribute('href');assert.ok(original);const id=original.split('/').at(-1)!;
      const op=(await request(`${base}/configuration-changes/${id}`)).body;const impact=op.impact.prices.find((p:any)=>p.offerKey==='PRO_999:year');
      assert.equal(impact.afterTotalSatang,1099001);assert.equal(impact.afterReceiptAllowance,1500);assert.equal(impact.beforeReceiptAllowance,1200);
      assert.ok(op.allowedActions.includes('approve'));
      await proof(approveRequest);const other=input.secondBrowser!.pages()[0]!;await other.goto(`${browser.origin}${original}`,{waitUntil:'domcontentloaded'});
      await press(other,'อนุมัติและใช้ค่าชุดนี้','/approve');await other.getByRole('status').filter({hasText:'การตั้งค่านี้มีผลแล้ว'}).waitFor();
      await page.goto(`${browser.origin}${original}`,{waitUntil:'domcontentloaded'});await page.getByRole('status').filter({hasText:'การตั้งค่านี้มีผลแล้ว'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${browser.evidenceDir}/admin-offer-terms-approved-mobile.png`,fullPage:true});
      cases.push('browser-offer-terms-invalid-input-draft-reload-exact-money-quota-independent-approval-and-mobile-return');
    }else await publish(policy);
    assert.deepEqual((await settings()).policy.offerTerms,policy.offerTerms);assert.deepEqual(await financial(),before);assert.equal(writes,0);
    const catalogResponse=await request('/v1/billing/catalog');assert.equal(catalogResponse.status,200,JSON.stringify(catalogResponse));const catalog=catalogResponse.body,offer=catalog.offers.find((o:any)=>o.offerKey==='PRO_999'&&o.interval==='year');
    assert.equal(offer.priceSatang,1099001);assert.equal(offer.receiptAllowance,1500);assert.equal(offer.branchLimit,7);assert.equal(offer.employeeLimit,25);
    assert.equal(catalog.offers.filter((o:any)=>o.offerKey==='ENTERPRISE_1999').every((o:any)=>o.availability==='COMING_SOON'),true);assert.equal(catalog.trial.monthlySlipLimit,15);
    cases.push('offer-terms-public-catalog-revision-shared-default-trial-and-enterprise-lock-without-financial-mutation');

    if(browser&&process.env.MANGMEE_MARKETING_DIR){const {checkBillingMarketing}=await import('./billing-marketing-smoke');cases.push(...(await checkBillingMarketing({page:browser.page,appOrigin:browser.origin,directory:process.env.MANGMEE_MARKETING_DIR,evidenceDir:browser.evidenceDir,expectedPro:{monthlySatang:109901,annualSatang:1099001,annualReceipts:1500,branches:7,members:25}})).map(name=>`offer-terms-${name}`));await browser.page.setViewportSize({width:390,height:844});}
    input.companyIds.push(companyId);await db.company.create({data:{id:companyId,name:'ร้านทดสอบราคาและสิทธิ์ใหม่'}});
    const owner=await db.membershipRole.findFirstOrThrow({where:{membershipId:input.membershipId,role:{key:'OWNER'}}});
    const member=await db.companyMembership.create({data:{companyId,userId:input.userIds[0]!,roles:{create:{roleId:owner.roleId}}}});await input.recordLegal(input.userIds[0]!,member.id,companyId);
    await db.companyPlanTerm.create({data:{companyId,tierKey:'FREE_TRIAL_15',branchLimit:1,employeeLimit:2,monthlySlipLimit:15,termStartAt:new Date(Date.now()-86400000),termEndsAt:new Date(Date.now()+29*86400000)}});
    const own=`/v1/companies/${companyId}/billing`,newQuote=async()=>{const r=await request(`${own}/quote`,'POST',{offerKey:'PRO_999',interval:'year',billingEmail:'owner@example.test'});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
    const quotaCapacity=(await request(`${own}/capacity?offerKey=PRO_999&interval=year`)).body;assert.equal(quotaCapacity.branchLimit,7);assert.equal(quotaCapacity.employeeLimit,25);
    const quote=await newQuote();assert.equal(quote.offer.branchLimit,7);assert.equal(quote.offer.employeeLimit,25);assert.equal(quote.totalSatang,1099001);assert.equal(quote.purchase.receiptUnitsAdded,1500);assert.equal(quote.purchase.projectedRemainingReceipts,1500);
    if(browser){const page=browser.page;for(const channel of ['web','line']){await page.goto(`${browser.origin}/companies/${companyId}/billing?offer=PRO_999&interval=year&channel=${channel}`,{waitUntil:'domcontentloaded'});
        await page.getByRole('button', { name: /^(เลือกแพ็กเกจ|ซื้อหรือเปลี่ยนแพ็กเกจ)$/, exact: true }).click();await page.getByRole('button',{name:'เลือกแพ็กเกจนี้',exact:true}).click();await page.getByRole('heading',{name:/ยืนยันซื้อ/}).waitFor();
        assert.match(await page.locator('main').last().innerText(),/1,500/);assert.match(await page.locator('main').last().innerText(),/10,990\.01/);}
      cases.push('browser-web-and-line-entry-show-current-approved-price-and-1500-upfront-receipts');}
    const unused=await newQuote(),body={quoteId:quote.quoteId,consentRevision:quote.consentRevision,accepted:true,channel:'line'},key=randomUUID();
    const checkout=await request(`${own}/checkout`,'POST',body,{'idempotency-key':key});assert.equal(checkout.status,200,JSON.stringify(checkout));assert.equal(checkout.body.state,'OPEN');
    assert.equal((await request(`${own}/checkout`,'POST',body,{'idempotency-key':key})).body.attemptId,checkout.body.attemptId);assert.equal(writes,2);assert.equal(await db.billingReceiptGrant.count({where:{companyId}}),0);
    await publish(initial.policy);assert.equal((await request(`${own}/checkout`,'POST',{...body,quoteId:unused.quoteId},{'idempotency-key':randomUUID()})).status,409);
    const session=[...ownedSessions.values()][0]!,start=Math.floor(Date.now()/1000)-1,end=start+365*86400,subId=`sub_terms${run}`,invoiceId=`in_terms${run}`,intentId=`pi_terms${run}`,chargeId=`ch_terms${run}`;
    Object.assign(session,{status:'complete',subscription:subId});
    provider.subscriptions!.push({id:subId,object:'subscription',livemode:false,customer:customerId,metadata:session.metadata,status:'active',cancel_at_period_end:false,collection_method:'charge_automatically',billing_mode:{type:'classic'},billing_cycle_anchor:start,
      items:{data:[{id:`si_terms${run}`,price:priceId,quantity:1,current_period_start:start,current_period_end:end}]}});
    provider.invoices!.push({id:invoiceId,object:'invoice',livemode:false,customer:customerId,parent:{subscription_details:{subscription:subId}},status:'paid',collection_method:'charge_automatically',currency:'thb',billing_reason:'subscription_create',amount_remaining:0,total:1099001,amount_paid:1099001,starting_balance:0,number:'SYNTHETIC-TERMS',created:start});
    provider.lines!.push({id:`il_terms${run}`,invoice:invoiceId,parent:{type:'subscription_item_details',subscription_item_details:{subscription:subId,subscription_item:`si_terms${run}`,proration:false}},pricing:{price_details:{price:priceId}},currency:'thb',quantity:1,livemode:false,period:{start,end}});
    provider.payments!.push({id:`inpay_terms${run}`,object:'invoice_payment',livemode:false,status:'paid',invoice:invoiceId,payment:{type:'payment_intent',payment_intent:intentId},amount_paid:1099001,currency:'thb'});
    const charge={id:chargeId,livemode:false,status:'succeeded',paid:true,captured:true,currency:'thb',amount:1099001,customer:customerId,payment_intent:intentId,payment_method_details:{type:'card'},amount_refunded:0,disputed:false};provider.charges!.push(charge);
    provider.intents!.push({id:intentId,livemode:false,status:'succeeded',currency:'thb',amount_received:1099001,customer:customerId,latest_charge:charge});
    await input.reconcile(accountId);await input.reconcile(accountId);
    const originalGrant=await db.billingReceiptGrant.findFirstOrThrow({where:{companyId,kind:'INITIAL'}});assert.equal(originalGrant.units,1500);
    assert.equal((await request(own)).body.usage.remaining,1500);assert.equal((await db.billingInvoice.findFirstOrThrow({where:{providerInvoiceId:invoiceId,billingAccountId:accountId}})).applyStatus,'APPLIED');
    const paidTerm=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}});assert.equal(paidTerm.branchLimit,7);assert.equal(paidTerm.employeeLimit,25);
    const syntheticGift={operationId:randomUUID(),accountId,tierKey:'PRO_999',branchLimit:9,employeeLimit:40,effectiveAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
    await db.companyPlanTerm.update({where:{companyId},data:{capacityOverride:syntheticGift}}); // TEST_ONLY existing gift; reviewed Admin creation is proved separately.
    cases.push('offer-terms-issued-checkout-replay-and-paid-historical-1500-grant-survive-published-default-reversion');
    const repeated=await newQuote();assert.equal(repeated.offer.branchLimit,7);assert.equal(repeated.offer.employeeLimit,25);
    const retainedCapacity=(await request(`${own}/capacity?offerKey=PRO_999&interval=year`)).body;assert.equal(retainedCapacity.branchLimit,7);assert.equal(retainedCapacity.employeeLimit,25);
    assert.equal(repeated.offer.receiptAllowance,1200);assert.equal(repeated.purchase.receiptUnitsAdded,1200);assert.equal(repeated.purchase.projectedRemainingReceipts,2700);assert.equal(repeated.totalSatang,999000);
    const repeat=await request(`${own}/checkout`,'POST',{quoteId:repeated.quoteId,consentRevision:repeated.consentRevision,accepted:true,channel:'web'},{'idempotency-key':randomUUID()});assert.equal(repeat.status,200,JSON.stringify(repeat));
    const repeatSession=provider.sessions!.find(s=>s.metadata?.billingAttemptId===repeat.body.attemptId)!;input.repeatFixture.complete(repeatSession);await input.reconcile(accountId);await input.reconcile(accountId);
    assert.equal((await request(own)).body.usage.remaining,2700);assert.deepEqual(await db.billingReceiptGrant.findUniqueOrThrow({where:{id:originalGrant.id}}),{...originalGrant,expiresAt:new Date(repeated.purchase.projectedPaidThrough)});
    const repeatTerm=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}});assert.equal(repeatTerm.branchLimit,7);assert.equal(repeatTerm.employeeLimit,25);assert.equal(repeatTerm.monthlySlipLimit,100);assert.deepEqual(repeatTerm.capacityOverride,syntheticGift);
    cases.push('offer-terms-repeat-adds-current-1200-to-original-1500-without-resizing-original-grant-and-extends-original-expiry');
    cases.push('capacity-published-lower-limits-preserve-paid-baseline-and-original-gift-expiry-on-repeat');
    if(browser){const page=browser.page,route='**/api/v1/system/billing/configuration-changes/preview';await page.goto(`${browser.origin}/system/billing/settings`,{waitUntil:'domcontentloaded'});
      await page.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true}).fill('ตรวจร่างต่อหลังกลับเข้าหน้าเดิม');
      let release!:()=>void,arrive!:(value:any)=>void;const held=new Promise<void>(r=>release=r);let late:any;
      await page.route(route,async r=>{const res=await r.fetch(),body=await res.json();arrive({status:res.status(),body});if(res.status()===200)await held;await r.fulfill({response:res});});
      try{for(let i=0;i<3;i++){const waiting=new Promise<any>(r=>arrive=r);await page.getByRole('button',{name:'ตรวจผลกระทบการตั้งค่า',exact:true}).click();const r=await waiting;
          if(r.status===200){late=r.body;break;}assert.equal(r.status,429);assert.ok(r.body.retryAfterSeconds<=60);await page.getByRole('alert').filter({hasText:'รอ'}).waitFor();await new Promise(resolve=>setTimeout(resolve,(r.body.retryAfterSeconds+1)*1000));}
        assert.ok(late);await page.getByRole('link',{name:'กลับหน้าดูแลการชำระเงิน',exact:true}).click();await page.waitForURL(new RegExp('/system/billing$'));release();
        await page.getByRole('heading',{name:'แพ็กเกจและการชำระเงิน',exact:true}).waitFor();assert.ok(page.url().endsWith('/system/billing'));
      }finally{release();await page.unroute(route);}
      await page.goto(`${browser.origin}/system/billing/settings`,{waitUntil:'domcontentloaded'});await page.getByRole('link').filter({hasText:'ตรวจร่างต่อหลังกลับเข้าหน้าเดิม'}).click();await page.waitForURL(new RegExp(late.id));
      await press(page,'ยกเลิกคำขอนี้','/cancel');await page.getByRole('status').filter({hasText:'ยกเลิกคำขอนี้แล้ว'}).waitFor();
      cases.push('browser-configuration-late-real-preview-after-leave-original-history-return-and-cancel');
    }
    assert.deepEqual(await financial(),before);cases.push('offer-terms-retains-other-company-paid-invoices-terms-and-receipt-grants');return cases;
  }catch(error){if(browser)console.error(JSON.stringify({stage:'offer-terms',completed:cases,path:new URL(browser.page.url()).pathname,alerts:await browser.page.getByRole('alert').allTextContents()}));throw error;
  }finally{input.transport();if(browser&&viewport)await browser.page.setViewportSize(viewport);}
}
