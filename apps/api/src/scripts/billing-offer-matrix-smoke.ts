import {appendPackageInterval} from '../modules/billing/domain/billing-package';
import {parseBillingPolicy} from '../modules/billing/domain/billing-policy';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {BILLING_DRAFT_POLICY, BILLING_PAID_TIERS} from '@watchdog-bms/contracts';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';

/** Twelve initial purchases through real HTTP/PG and optional browser; provider transport only is simulated. */
export async function checkBillingOfferMatrix(input:Parameters<typeof checkBillingConfigurationDrafts>[0]) {
  const {request,provider,browser}=input,db=input.prisma.client,tag=randomUUID().replaceAll('-',''),cases:string[]=[];
  const before=await db.billingSettings.findUniqueOrThrow({where:{id:`${input.stripeAccountId}:test`}});
  const prices=new Map<string,{amount:number;interval:'month'|'year';product:string}>(),priceIds:Record<string,string>={},zeroPriceIds:Record<string,string>={};
  const terms={STARTER_249:{label:'เริ่มต้น (STARTER)',month:24900,year:249000,units:30,branches:1,members:2},BASIC_499:{label:'เติบโต (BASIC)',month:49900,year:499000,units:50,branches:2,members:5},PRO_999:{label:'มืออาชีพ (PRO)',month:99900,year:999000,units:100,branches:5,members:10}};
  for(const tier of BILLING_PAID_TIERS)for(const interval of ['month','year'] as const)for(const zero of [false,true]) {
    const id=`price_Matrix${tier.replaceAll('_','')}${interval}${zero?'Zero':''}${tag}`;
    (zero?zeroPriceIds:priceIds)[`${tier}:${interval}`]=id;
    prices.set(id,{amount:zero?0:terms[tier][interval],interval,product:`prod_Matrix${tier}`});
  }
  const companies=new Set<string>(),customers=new Map<string,string>(),sessions=new Map<string,Record<string,any>>();
  const response=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  input.transport(async(url,init)=>{
    if(url.hostname!=='api.stripe.com')return undefined;
    const path=url.pathname.slice(3),method=init?.method??'GET',form=new URLSearchParams(String(init?.body??''));
    const price=prices.get(path.replace('/prices/',''));
    if(method==='GET'&&price)return response({id:path.split('/').at(-1),object:'price',livemode:false,active:true,type:'recurring',product:price.product,
      currency:'thb',unit_amount:price.amount,recurring:{interval:price.interval,interval_count:1,usage_type:'licensed'},billing_scheme:'per_unit',tax_behavior:'inclusive'});
    if(method==='POST'&&path==='/customers') {
      const accountId=form.get('metadata[billingAccountId]')!;
      const account=await db.billingAccount.findUnique({where:{id:accountId}});
      if(!account||!companies.has(account.companyId))return undefined;
      const customerId=customers.get(accountId)??`cus_Matrix${tag}${customers.size}`;
      if(!customers.has(accountId))provider.customers!.push({id:customerId,object:'customer',livemode:false,email:form.get('email'),metadata:{billingAccountId:accountId}});
      customers.set(accountId,customerId);return response(provider.customers!.find(customer=>customer.id===customerId));
    }
    if(method==='POST'&&path==='/checkout/sessions'&&[...customers.values()].includes(form.get('customer')??'')) {
      const key=new Headers(init?.headers).get('idempotency-key')!;
      if(sessions.has(key))return response(sessions.get(key));
      assert.equal(form.get('mode'),'subscription');assert.equal(form.get('line_items[0][quantity]'),'1');
      assert.ok(prices.has(form.get('line_items[0][price]')!));
      const session={id:`cs_Matrix${tag}${sessions.size}`,object:'checkout.session',livemode:false,mode:'subscription',status:'open',subscription:null,
        customer:form.get('customer'),client_reference_id:form.get('client_reference_id'),metadata:{billingAccountId:form.get('metadata[billingAccountId]'),billingAttemptId:form.get('metadata[billingAttemptId]')},
        url:`https://checkout.stripe.com/c/pay/matrix-${tag}`};
      sessions.set(key,session);provider.sessions!.push(session);return response(session);
    }
    return undefined;
  });
  const policy={...BILLING_DRAFT_POLICY,priceIds,zeroPriceIds,portalConfigurationId:'bpc_Synthetic'};
  parseBillingPolicy(policy); // Fixture mistakes must fail explicitly, before storing an unusable revision.
  const revision=await db.billingPolicyRevision.create({data:{stripeAccountId:input.stripeAccountId,livemode:false,
    version:1+(await db.billingPolicyRevision.aggregate({where:{stripeAccountId:input.stripeAccountId,livemode:false},_max:{version:true}}))._max.version!,state:'ACTIVE',createdByUserId:input.userIds[0]!,
    policyJson:policy}});
  // TEST_ONLY fixture activation. Independent Admin preview/approval/rollback is proved by the configuration suite.
  await db.billingSettings.update({where:{id:before.id},data:{policyRevisionId:revision.id,gatesJson:{...(before.gatesJson as Record<string,boolean>),new_sales:true},version:{increment:1}}});
  const owner=await db.membershipRole.findFirstOrThrow({where:{membershipId:input.membershipId,role:{key:'OWNER'}}});
  try {
    for(const tier of BILLING_PAID_TIERS)for(const interval of ['month','year'] as const)for(const channel of ['web','line'] as const) {
      const name=`${tier}-${interval}-${channel}`,companyId=`matrix-${tag}-${name}`,own=`/v1/companies/${companyId}/billing`;
      companies.add(companyId);input.companyIds.push(companyId);
      await db.company.create({data:{id:companyId,name:`ร้านทดสอบ ${name}`}});
      const member=await db.companyMembership.create({data:{companyId,userId:input.userIds[0]!,roles:{create:{roleId:owner.roleId}}}});
      await input.recordLegal(input.userIds[0]!,member.id,companyId);
      await db.companyPlanTerm.create({data:{companyId,tierKey:'FREE_TRIAL_15',branchLimit:1,employeeLimit:2,monthlySlipLimit:15,
        termStartAt:new Date(Date.now()-86400000),termEndsAt:new Date(Date.now()+29*86400000)}});
      let attempt:any,quote:any;
      if(browser) {
        const page=browser.page;await page.setViewportSize({width:390,height:844});
        await page.goto(`${browser.origin}/companies/${companyId}/billing?offer=${tier}&interval=${interval}&channel=${channel}`,{waitUntil:'domcontentloaded'});
        await page.getByRole('button', { name: /^(เลือกแพ็กเกจ|ซื้อหรือเปลี่ยนแพ็กเกจ)$/, exact: true }).click();
        assert.equal(await page.getByRole('button',{name:interval==='year'?'รายปี':'รายเดือน',exact:true}).getAttribute('aria-pressed'),'true');
        await page.getByRole('article').filter({has:page.getByRole('heading',{name:terms[tier].label,exact:true})}).getByRole('button',{name:'เลือกแพ็กเกจนี้',exact:true}).click();
        await page.getByRole('heading',{name:`ยืนยันซื้อ ${terms[tier].label} ${interval==='year'?'รายปี':'รายเดือน'}`,exact:true}).waitFor();
        await page.getByRole('checkbox').check();await page.getByRole('button',{name:'ยืนยันและไปชำระที่ Stripe',exact:true}).click();
        await page.waitForURL('https://checkout.stripe.com/**');
        const account=await db.billingAccount.findFirstOrThrow({where:{companyId,stripeAccountId:input.stripeAccountId,livemode:false}});
        attempt=await db.billingAttempt.findFirstOrThrow({where:{billingAccountId:account.id}});
        quote=(await db.billingQuote.findUniqueOrThrow({where:{id:attempt.quoteId}})).snapshotJson as any;quote=quote.quote;
      } else {
        const q=await request(`${own}/quote`,'POST',{offerKey:tier,interval,billingEmail:'owner@example.test'});assert.equal(q.status,200,JSON.stringify(q));quote=q.body;
        const check=await request(`${own}/checkout`,'POST',{quoteId:quote.quoteId,consentRevision:quote.consentRevision,accepted:true,channel},{'idempotency-key':randomUUID()});
        assert.equal(check.status,200,JSON.stringify(check));attempt=await db.billingAttempt.findUniqueOrThrow({where:{id:check.body.attemptId}});
      }
      const expected=terms[tier],units=expected.units*(interval==='year'?12:1),amount=expected[interval];
      assert.equal(quote.totalSatang,amount);assert.equal(quote.purchase.receiptUnitsAdded,units);assert.equal(quote.purchase.trialCarryover.receiptUnits,15);assert.equal(quote.purchase.projectedRemainingReceipts,units+15);
      assert.equal(quote.offer.branchLimit,expected.branches);assert.equal(quote.offer.employeeLimit,expected.members);
      const body={quoteId:quote.quoteId,consentRevision:quote.consentRevision,accepted:true,channel};
      const replay=await request(`${own}/checkout`,'POST',body,{'idempotency-key':attempt.idempotencyKey});assert.equal(replay.body.attemptId,attempt.id);
      assert.equal([...sessions.values()].filter(session=>session.metadata.billingAttemptId===attempt.id).length,1);
      assert.equal(await db.billingReceiptGrant.count({where:{companyId}}),0,'Checkout return alone cannot unlock');
      assert.equal((await request(`${own}/attempts/${attempt.id}`)).body.paymentState,'PENDING');
      const session=[...sessions.values()].find(session=>session.metadata.billingAttemptId===attempt.id)!,accountId=session.metadata.billingAccountId;
      const key=`${tag}${cases.length}`,start=Math.floor(Date.now()/1000)-1,endDate=appendPackageInterval(new Date(start*1000),interval);
      const end=Math.floor(endDate.getTime()/1000),subId=`sub_Matrix${key}`,invoiceId=`in_Matrix${key}`,itemId=`si_Matrix${key}`,intentId=`pi_Matrix${key}`,chargeId=`ch_Matrix${key}`,priceId=priceIds[`${tier}:${interval}`];
      Object.assign(session,{status:'complete',subscription:subId});
      provider.subscriptions!.push({id:subId,object:'subscription',livemode:false,customer:session.customer,metadata:session.metadata,status:'active',cancel_at_period_end:false,
        collection_method:'charge_automatically',billing_mode:{type:'classic'},billing_cycle_anchor:start,items:{data:[{id:itemId,price:priceId,quantity:1,current_period_start:start,current_period_end:end}]}});
      provider.invoices!.push({id:invoiceId,object:'invoice',livemode:false,customer:session.customer,parent:{subscription_details:{subscription:subId}},status:'paid',status_transitions:{paid_at:start},collection_method:'charge_automatically',
        currency:'thb',billing_reason:'subscription_create',amount_remaining:0,total:amount,amount_paid:amount,starting_balance:0,number:`TEST-${name}`,created:start,
        hosted_invoice_url:'https://invoice.stripe.com/i/matrix',invoice_pdf:'https://invoice.stripe.com/i/matrix/pdf'});
      provider.lines!.push({id:`il_Matrix${key}`,invoice:invoiceId,parent:{type:'subscription_item_details',subscription_item_details:{subscription:subId,subscription_item:itemId,proration:false}},
        pricing:{price_details:{price:priceId}},currency:'thb',quantity:1,livemode:false,period:{start,end}});
      provider.payments!.push({id:`inpay_Matrix${key}`,object:'invoice_payment',livemode:false,status:'paid',invoice:invoiceId,payment:{type:'payment_intent',payment_intent:intentId},amount_paid:amount,currency:'thb'});
      const charge={id:chargeId,livemode:false,status:'succeeded',paid:true,captured:true,currency:'thb',amount,customer:session.customer,payment_intent:intentId,payment_method_details:{type:'card'},
        amount_refunded:0,disputed:false,receipt_url:'https://pay.stripe.com/receipts/matrix'};provider.charges!.push(charge);
      provider.intents!.push({id:intentId,livemode:false,status:'succeeded',currency:'thb',amount_received:amount,customer:session.customer,latest_charge:charge});
      await input.reconcile(accountId);await input.reconcile(accountId);
      const grants=await db.billingReceiptGrant.findMany({where:{companyId}});assert.equal(grants.length,2);assert.equal(grants.find(grant=>grant.kind==='INITIAL')?.units,units);
      const trial=grants.find(grant=>grant.kind==='TRIAL_CARRYOVER');assert.equal(trial?.units,15);assert.equal(trial?.expiresAt.toISOString(),endDate.toISOString());
      const term=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}});assert.equal(term.tierKey,tier);assert.equal(term.branchLimit,expected.branches);assert.equal(term.employeeLimit,expected.members);
      assert.equal(term.termEndsAt?.toISOString(),endDate.toISOString());assert.equal((await request(own)).body.usage.remaining,units+15);
      const paid=(await request(`${own}/attempts/${attempt.id}`)).body;assert.equal(paid.paymentState,'PAID');assert.equal(paid.applyState,'APPLIED');
      for(const kind of ['invoice','pdf','receipt'])assert.equal((await request(`${own}/documents/${paid.invoiceReference}/open`,'POST',{kind})).status,200);
      if(browser) {
        const page=browser.page;await page.goto(`${browser.origin}/companies/${companyId}/billing/return?attempt=${attempt.id}`,{waitUntil:'domcontentloaded'});
        await page.getByRole('heading',{name:'ชำระแล้ว เปิดใช้งานแล้ว',exact:true}).waitFor();await page.getByRole('button',{name:'ประวัติ',exact:true}).click();await page.getByRole('link',{name:'ดูเอกสาร',exact:true}).first().waitFor();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:`${browser.evidenceDir}/matrix-${name}.png`,fullPage:false});
      }
      cases.push(`${browser?'browser-':''}offer-matrix-${name}-original-checkout-unpaid-replay-paid-once-quota-capacity-term-documents`);
    }
    return cases;
  } finally {
    input.transport(undefined);
    await db.billingSettings.update({where:{id:before.id},data:{policyRevisionId:before.policyRevisionId,gatesJson:before.gatesJson!,version:{increment:1}}});
  }
}
