import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';
import {STRIPE_API_VERSION} from '@watchdog-bms/contracts';

/** Actual HTTP/PG/UI with an original-invoice provider simulation; never calls a native money endpoint. */
export async function checkBillingRefunds(input:Parameters<typeof checkBillingConfigurationDrafts>[0]){
  const bounded=<T>(work:Promise<T>,stage:string)=>new Promise<T>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Refund browser timed out: ${stage}`)),30000);
    work.then(resolve,reject).finally(()=>clearTimeout(timer));
  });
  const {request,approveRequest,browser,companyId,stripeAccountId,password}=input,db=input.prisma.client,base='/v1/system/billing',run=randomUUID().replace(/-/g,'');
  const cases:string[]=[],settings=async()=>(await request(`${base}/settings`)).body,initial=await settings();
  const originalAccount=await db.billingAccount.findFirstOrThrow({where:{companyId,stripeAccountId,livemode:false}}),customerId=originalAccount.customerId??`cus_Refund${run}`;
  const account=await db.billingAccount.update({where:{id:originalAccount.id},data:{customerId}});
  const local=await db.billingInvoice.create({data:{billingAccountId:account.id,providerInvoiceId:`in_Refund${run}`,providerChargeId:`ch_Refund${run}`,subscriptionId:`sub_Refund${run}`,
    providerNumber:'TEST-REFUND-001',offerSnapshot:{offerKey:'PRO_999',interval:'year'},policyRevisionId:initial.policyRevisionId,currency:'THB',totalSatang:999000,paidSatang:999000,taxSatang:0,
    periodStart:new Date(),periodEnd:new Date(Date.now()+365*86400000),providerStatus:'paid',evidenceHash:'synthetic-refund-paid-proof',applyStatus:'HELD'}});
  const grants=await db.billingReceiptGrant.findMany({where:{billingAccountId:account.id},orderBy:{id:'asc'}}),term=await db.companyPlanTerm.findUnique({where:{companyId}});
  const prefix=`${base}/companies/${companyId}/invoices/${local.id}`,lineId=`il_Refund${run}`,intentId=`pi_Refund${run}`;
  const notes:any[]=[],refunds:any[]=[],requests:{key:string;body:string}[]=[],cache=new Map<string,any>();
  let behavior:'ok'|'lose-after'|'lose-before'|'lose-lease'|'pending'|'failed'='ok',corrupt:'none'|'tax'|'charge'|'duplicate'='none';
  const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const list=(rows:any[])=>({object:'list',data:rows,has_more:false});
  const charge=()=>({id:local.providerChargeId,object:'charge',livemode:false,customer:customerId,currency:'thb',status:'succeeded',paid:true,captured:true,amount:local.paidSatang,
    amount_refunded:refunds.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount,0),disputed:false,payment_intent:intentId,payment_method_details:{type:'card'},receipt_url:'https://pay.stripe.com/receipts/synthetic'});
  const invoice=()=>({id:local.providerInvoiceId,object:'invoice',livemode:false,customer:customerId,currency:'thb',status:'paid',total:local.paidSatang,amount_paid:local.paidSatang,
    amount_remaining:0,starting_balance:0,paid_out_of_band:false,post_payment_credit_notes_amount:notes.filter(n=>n.status==='issued').reduce((sum,n)=>sum+n.amount,0),
    parent:{subscription_details:{subscription:local.subscriptionId}},total_taxes:[],hosted_invoice_url:'https://invoice.stripe.com/i/synthetic',invoice_pdf:'https://pay.stripe.com/invoice/synthetic.pdf'});
  const note=(params:URLSearchParams,id:string)=>{
    const amount=Number(params.get('amount'));return {id,object:'credit_note',livemode:false,customer:customerId,invoice:local.providerInvoiceId,currency:'thb',status:'issued',type:'post_payment',
      amount,total:amount,pre_payment_amount:0,post_payment_amount:amount,total_excluding_tax:amount,amount_shipping:0,discount_amount:0,discount_amounts:[],total_taxes:[],
      customer_balance_transaction:null,out_of_band_amount:0,number:`TEST-CN-${notes.length+1}`,created:Math.floor(Date.now()/1000),memo:params.get('memo')??null,
      metadata:{billingRefundOperationId:params.get('metadata[billingRefundOperationId]'),billingAccountId:params.get('metadata[billingAccountId]'),billingSourceHash:params.get('metadata[billingSourceHash]')},
      lines:list([{id:`cnli_Refund${run}`,object:'credit_note_line_item',livemode:false,type:'invoice_line_item',invoice_line_item:lineId,amount,discount_amount:0,discount_amounts:[],taxes:[]}]),refunds:[],pdf:'https://pay.stripe.com/credit_notes/synthetic.pdf'};
  };
  const issue=(params:URLSearchParams,status='succeeded')=>{
    const n=note(params,`cn_${randomUUID().replace(/-/g,'')}`),id=`re_${randomUUID().replace(/-/g,'')}`;
    const r={id,object:'refund',livemode:false,charge:local.providerChargeId,payment_intent:intentId,currency:'thb',amount:n.amount,status,created:Math.floor(Date.now()/1000)};
    (n as any).refunds=[{refund:id,amount_refunded:n.amount,payment_record_refund:null,type:'refund'}];notes.push(n);refunds.push(r);return n;
  };
  input.transport(async(url,init)=>{
    if(url.hostname!=='api.stripe.com')return undefined;const path=url.pathname.replace('/v1',''),method=init?.method??'GET';
    const native=path===`/invoices/${local.providerInvoiceId}`||path===`/charges/${local.providerChargeId}`||path===`/payment_intents/${intentId}`||path===`/invoices/${local.providerInvoiceId}/lines`||
      path==='/credit_notes'||path==='/credit_notes/preview'||path==='/refunds'||path==='/invoice_payments'||refunds.some(r=>path===`/refunds/${r.id}`)||notes.some(n=>path===`/credit_notes/${n.id}`);
    if(method!=='GET'&&path!=='/credit_notes')throw Error('Unexpected native mutation in refund scenario');
    if(!native)return undefined;assert.equal(new Headers(init?.headers).get('Stripe-Version'),STRIPE_API_VERSION);
    if(method==='POST'){
      assert.equal(path,'/credit_notes');const params=new URLSearchParams(String(init?.body)),key=new Headers(init?.headers).get('Idempotency-Key')!;
      assert.ok(key?.startsWith('billing-refund-'));assert.equal(params.get('invoice'),local.providerInvoiceId);assert.equal(params.get('amount'),params.get('refund_amount'));
      assert.equal(params.get('credit_amount'),'0');assert.equal(params.get('out_of_band_amount'),'0');assert.ok(['none','credit_note'].includes(params.get('email_type')!));
      assert.equal(String(init?.body).includes('PRIVATE_REFUND'),false);const prior=requests.find(r=>r.key===key);if(prior)assert.equal(prior.body,init?.body);
      requests.push({key,body:String(init?.body)});if(cache.has(key))return response(cache.get(key));if(behavior==='lose-before')throw Error('Synthetic write transport uncertainty');
      const created=issue(params,behavior==='pending'?'pending':behavior==='failed'?'failed':'succeeded');cache.set(key,created);
      if(behavior==='lose-lease'){
        const replacement='synthetic-replacement-refund-lease',expired=new Date(Date.now()-1000);
        await db.billingOperation.update({where:{id:params.get('metadata[billingRefundOperationId]')!},data:{leaseToken:replacement,leaseUntil:expired,version:{increment:1}}});
        await db.billingAccount.update({where:{id:account.id},data:{leaseToken:replacement,leaseUntil:expired}});
      }
      if(behavior==='lose-after')throw Error('Synthetic response lost after Stripe stored note');return response(created);
    }
    assert.equal(method,'GET');
    if(path===`/invoices/${local.providerInvoiceId}`)return response(invoice());
    if(path===`/charges/${local.providerChargeId}`)return response({...charge(),...corrupt==='charge'?{payment_intent:'pi_Foreign'}:{}});
    if(path===`/payment_intents/${intentId}`)return response({id:intentId,object:'payment_intent',livemode:false,customer:customerId,currency:'thb',status:'succeeded',amount_received:local.paidSatang,latest_charge:local.providerChargeId});
    if(path==='/invoice_payments')return response(list([{id:`inpay_Refund${run}`,object:'invoice_payment',livemode:false,invoice:local.providerInvoiceId,status:'paid',currency:'thb',amount_paid:local.paidSatang,payment:{type:'payment_intent',payment_intent:intentId}}]));
    if(path===`/invoices/${local.providerInvoiceId}/lines`)return response(list([{id:lineId,livemode:false,currency:'thb',amount:local.paidSatang}]));
    if(path==='/credit_notes/preview'){
      if(Number(url.searchParams.get('amount'))>local.paidSatang-notes.reduce((sum,n)=>sum+n.amount,0))return response({error:{type:'invalid_request_error'}},400);
      const value=note(url.searchParams,'cn_Preview');if(corrupt==='tax')value.total_excluding_tax--;return response(value);
    }
    if(path==='/credit_notes')return response(corrupt==='duplicate'&&notes.length?{...list([notes[0],notes[0]]),has_more:true}:list(notes));
    if(path==='/refunds')return response(list(refunds));
    return response(refunds.find(r=>path===`/refunds/${r.id}`)??notes.find(n=>path===`/credit_notes/${n.id}`));
  });
  const proof=async(actor=request)=>{if(!(await actor(`${base}/settings`)).body.reauthenticatedUntil)assert.equal((await actor(`${base}/reauthenticate`,'POST',{password})).status,200);};
  const publish=async(enabled=true,restore=false)=>{const s=await settings();await proof();await proof(approveRequest);
    const p=await request(`${base}/configuration-changes/preview`,'POST',{type:'PUBLISH_POLICY',expectedVersion:s.version,policy:restore?initial.policy:{...s.policy,refundLimitSatang:5000},gates:restore?initial.gates:{...s.gates,refunds:enabled},reason:'วงเงินจำลองสำหรับทดสอบการคืนเงิน'});assert.equal(p.status,200,JSON.stringify(p));
    const submitted=await request(`${base}/configuration-changes/${p.body.id}/submit`,'POST',{expectedVersion:p.body.version,previewHash:p.body.previewHash},{'idempotency-key':`refund-policy-${p.body.id}`});assert.equal(submitted.status,200,JSON.stringify(submitted));
    assert.equal((await approveRequest(`${base}/configuration-changes/${submitted.body.id}/approve`,'POST',{expectedVersion:submitted.body.version,previewHash:submitted.body.previewHash})).status,200);};
  const get=async(id:string)=>(await request(`${base}/refunds/${id}`)).body;
  const preview=async(amount=1000)=>{const r=await request(`${prefix}/refund-review`);assert.equal(r.status,200,JSON.stringify(r));return request(`${prefix}/refund-preview`,'POST',{amountSatang:amount,reason:'PRIVATE_REFUND เหตุผลภายในจำลอง',memo:'คืนเงินตามที่ตกลง',notifyCustomer:false,sourceHash:r.body.sourceHash});};
  const command=(op:any,action:string,actor=request)=>actor(`${base}/refunds/${op.id}/${action}`,'POST',{expectedVersion:op.version,...action==='run'?{}:{previewHash:op.previewHash}},action==='submit'?{'idempotency-key':`refund-submit-${op.id}`} : undefined);
  const queued=async()=>{const p=await preview();assert.equal(p.status,200,JSON.stringify(p));await proof();await proof(approveRequest);
    const s=await command(p.body,'submit');assert.equal(s.status,200,JSON.stringify(s));const a=await command(s.body,'approve',approveRequest);assert.equal(a.status,200,JSON.stringify(a));return a.body;};
  const execute=async(op:any,actor=request)=>{const r=await command(op,'run',actor);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  try{
    const off=await request(`${prefix}/refund-review`);assert.equal(off.status,200,JSON.stringify(off));assert.equal(off.body.canCreate,false);assert.equal((await preview()).body.code,'CONTROL_REFUND_CONFIG_REQUIRED');
    await publish();assert.equal((await preview(5001)).body.code,'CONTROL_REFUND_LIMIT');
    const good=await preview();assert.equal(good.status,200,JSON.stringify(good));assert.equal(good.body.amountSatang,1000);assert.equal(good.body.taxSatang,0);
    const invalid=await request(`${prefix}/refund-preview`,'POST',{amountSatang:1000,sourceHash:off.body.sourceHash,reason:'bad',memo:'',notifyCustomer:false,providerInvoiceId:'in_Foreign'});assert.equal(invalid.status,400);
    await proof();const submitted=await command(good.body,'submit');assert.equal(submitted.status,200,JSON.stringify(submitted));assert.equal((await command(good.body,'submit')).body.id,good.body.id);
    const another=await preview();assert.equal(another.status,200);
    assert.equal((await request(`${base}/refunds/${another.body.id}/submit`,'POST',{expectedVersion:another.body.version,previewHash:another.body.previewHash},{'idempotency-key':`refund-submit-${good.body.id}`})).body.code,'CONTROL_IDEMPOTENCY_CONFLICT');
    assert.equal((await command(another.body,'cancel')).body.state,'CANCELLED');assert.equal((await command(another.body,'cancel')).body.state,'CANCELLED');
    assert.equal((await command(submitted.body,'approve')).status,403);await proof(approveRequest);
    const approved=await command(submitted.body,'approve',approveRequest);assert.equal(approved.status,200,JSON.stringify(approved));assert.equal((await command(submitted.body,'approve',approveRequest)).body.id,good.body.id);
    assert.equal((await request(`/v1/companies/${companyId}/billing/quote`,'POST',{offerKey:'PRO_999',interval:'year',billingEmail:'refund-test@example.invalid'})).body.code,'BILLING_REFUND_PENDING');
    const ownerStatus=await request(`/v1/companies/${companyId}/billing`);assert.equal(ownerStatus.status,200);assert.equal(ownerStatus.body.refundReviewPending,true);
    assert.ok(!ownerStatus.body.allowedActions.includes('new_sales')&&!ownerStatus.body.allowedActions.includes('plan_changes'));
    assert.ok(!JSON.stringify(ownerStatus.body).includes('PRIVATE_REFUND')&&!JSON.stringify(ownerStatus.body).includes(good.body.id));
    if(browser){
      const page=browser.page;await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/companies/${companyId}/billing?channel=line`,{waitUntil:'domcontentloaded'});
      await page.getByRole('status').filter({hasText:'กำลังตรวจสอบคำขอคืนเงิน'}).waitFor();assert.equal(await page.getByRole('region',{name:'เลือกแพ็กเกจ',exact:true}).count(),0);
      assert.equal(await page.getByText('PRIVATE_REFUND',{exact:false}).count(),0);await page.getByRole('link',{name:'ติดต่อทีมมั่งมี',exact:true}).first().waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${browser.evidenceDir}/owner-refund-pending-mobile.png`,fullPage:true});
    }
    const before=requests.length,responses=await Promise.all([command(approved.body,'run'),command(approved.body,'run')]);assert.ok(responses.some(r=>r.status===200));assert.equal(requests.length,before+1);
    assert.equal((await get(good.body.id)).state,'SUCCEEDED');assert.equal((await get(good.body.id)).bankReceiptConfirmed,false);
    assert.equal((await request(`/v1/companies/${companyId}/billing`)).body.refundReviewPending,false);
    if(browser){await browser.page.reload({waitUntil:'domcontentloaded'});await browser.page.getByRole('region',{name:'สถานะแพ็กเกจ',exact:true}).waitFor();assert.equal(await browser.page.getByRole('status').filter({hasText:'กำลังตรวจสอบคำขอคืนเงิน'}).count(),0);}
    cases.push('refund-owner-status-web-line-entry-hides-new-sales-and-private-reason-with-observed-return');
    cases.push('refund-approved-bound-current-proof-independent-approval-command-replay-concurrent-run-once');
    corrupt='tax';assert.equal((await preview()).body.code,'CONTROL_REFUND_SOURCE_CHANGED');corrupt='charge';assert.equal((await request(`${prefix}/refund-review`)).status>=400,true);corrupt='duplicate';assert.equal((await request(`${prefix}/refund-review`)).body.code,'CONTROL_REFUND_SOURCE_CHANGED');corrupt='none';
    cases.push('refund-original-payment-chain-tax-preview-and-complete-page-duplicates-rejected-before-money');
    const stalePreview=await preview();assert.equal(stalePreview.status,200);
    await db.billingInvoice.update({where:{id:local.id},data:{version:{increment:1}}});assert.equal((await command(stalePreview.body,'submit')).body.code,'CONTROL_PREVIEW_STALE');
    assert.equal((await command(stalePreview.body,'cancel')).body.state,'CANCELLED');
    const expired=await preview();await db.billingOperation.update({where:{id:expired.body.id},data:{expiresAt:new Date(Date.now()-1000)}});
    assert.equal((await command(expired.body,'submit')).body.code,'CONTROL_PREVIEW_STALE');assert.equal((await command(expired.body,'cancel')).body.state,'CANCELLED');
    const expiredApproval=await queued(),expiryPosts=requests.length;
    await db.billingOperation.update({where:{id:expiredApproval.id},data:{expiresAt:new Date(Date.now()-1000)}});
    assert.equal((await execute(expiredApproval)).state,'BLOCKED');assert.equal(requests.length,expiryPosts);
    assert.equal((await command(await get(expiredApproval.id),'cancel')).body.state,'CANCELLED');
    cases.push('refund-approved-but-expired-command-cannot-dispatch-and-retains-cancel-review');
    const revoke=await queued(),memberships=await db.membershipRole.findMany({where:{membershipId:input.membershipId}});
    const authority=await db.rolePermission.findMany({where:{roleId:{in:memberships.map(m=>m.roleId)},permission:{key:'system.billing.refund.manage'}}});assert.ok(authority.length);
    await db.rolePermission.deleteMany({where:{OR:authority.map(a=>({roleId:a.roleId,permissionId:a.permissionId}))}});
    const revokePosts=requests.length;
    try{assert.equal((await execute(revoke,approveRequest)).state,'BLOCKED');assert.equal(requests.length,revokePosts);}
    finally{await db.rolePermission.createMany({data:authority,skipDuplicates:true});}
    assert.equal((await command(await get(revoke.id),'cancel')).body.state,'CANCELLED');
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{kind:'CONTROL_OPERATION_REVIEW',referenceId:revoke.id}})).state,'RESOLVED');
    const credentialOp=await queued(),credential=await db.userCredential.findUniqueOrThrow({where:{userId:input.userIds[1]!}});
    await db.userCredential.update({where:{userId:credential.userId},data:{updatedAt:new Date(Date.now()+1000)}});
    try{assert.equal((await execute(credentialOp)).state,'BLOCKED');assert.equal(requests.length,revokePosts);}
    finally{await db.userCredential.update({where:{userId:credential.userId},data:{updatedAt:credential.updatedAt}});}
    assert.equal((await command(await get(credentialOp.id),'cancel')).body.state,'CANCELLED');
    cases.push('refund-stale-expired-review-revoked-requester-and-changed-approver-credential-block-money-with-cancel-path');
    const scoped=await preview();await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});
    const scope=await db.billingOperatorScope.create({data:{userId:input.userIds[0]!,companyId,stripeAccountId,livemode:false,createdByUserId:input.userIds[1]!}});
    try{
      assert.equal((await request(`${base}/settings`)).status,403);
      assert.equal((await request(`${base}/companies/${companyId}/reauthenticate`,'POST',{password})).status,200);
      const submittedScoped=await command(scoped.body,'submit');assert.equal(submittedScoped.status,200,JSON.stringify(submittedScoped));await proof(approveRequest);
      const approvedScoped=await command(submittedScoped.body,'approve',approveRequest);assert.equal(approvedScoped.status,200,JSON.stringify(approvedScoped));
      assert.equal((await execute(approvedScoped.body)).state,'SUCCEEDED');
      await db.billingOperatorScope.update({where:{id:scope.id},data:{revokedAt:new Date()}});assert.equal((await request(`${base}/refunds/${scoped.body.id}`)).status,404);
    }finally{await db.billingOperatorScope.delete({where:{id:scope.id}});await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminRoleId}});}
    cases.push('refund-scoped-finance-submits-executes-without-platform-settings-and-withdrawn-scope-hides-original');
    const lost=await queued();behavior='lose-after';const lostBefore=requests.length;assert.equal((await execute(lost)).state,'UNKNOWN');assert.equal(requests.length,lostBefore+1);
    await db.billingOperation.update({where:{id:lost.id},data:{expiresAt:new Date(Date.now()-1000)}});
    const s=await settings();await proof();const closed=await request(`${base}/settings/emergency-close`,'POST',{gates:{...s.gates,refunds:false},expectedVersion:s.version,reason:'ปิดคำขอใหม่ระหว่างตรวจผลเดิม'},{'idempotency-key':`refund-close-${run}`});assert.equal(closed.status,200,JSON.stringify(closed));
    behavior='ok';assert.equal((await execute(await get(lost.id),approveRequest)).state,'SUCCEEDED');assert.equal(requests.length,lostBefore+1);
    await publish();cases.push('refund-lost-provider-response-recovers-original-note-with-gate-closed-and-no-second-post');
    const aged=await queued();behavior='lose-before';assert.equal((await execute(aged)).state,'UNKNOWN');const agedRow=await db.billingOperation.findUniqueOrThrow({where:{id:aged.id}});
    await db.billingOperation.update({where:{id:aged.id},data:{resultJson:{...(agedRow.resultJson as any),dispatchedAt:new Date(Date.now()-24*3600000).toISOString()}}});behavior='ok';
    const agedBefore=requests.length,unconfirmed=await execute(await get(aged.id));assert.equal(unconfirmed.errorCode,'CONTROL_REFUND_AGED_UNKNOWN');assert.equal(requests.length,agedBefore);
    const p=agedRow.proposedJson as any,params=new URLSearchParams();for(const [key,value] of Object.entries(p.params)){if(key==='metadata')for(const [m,v] of Object.entries(value as object))params.set(`metadata[${m}]`,String(v));else params.set(key,String(value));}issue(params);
    assert.equal((await execute(await get(aged.id))).state,'SUCCEEDED');assert.equal(requests.length,agedBefore);
    cases.push('refund-aged-unknown-never-blind-replays-and-positive-original-discovery-completes');
    const pending=await queued();behavior='pending';let pendingView=await execute(pending);assert.equal(pendingView.state,'QUEUED');assert.equal(pendingView.refundState,'pending');assert.ok(pendingView.creditNoteId);
    const pendingPosts=requests.length;pendingView=await execute(pendingView);assert.equal(requests.length,pendingPosts);assert.equal(pendingView.refundState,'pending');
    refunds.find(r=>r.id===pendingView.refundId).status='succeeded';assert.equal((await execute(pendingView)).state,'SUCCEEDED');
    const failed=await queued();behavior='failed';const failedView=await execute(failed);assert.equal(failedView.state,'FAILED');assert.equal(failedView.refundState,'failed');assert.ok(failedView.reviewCaseId);
    assert.equal((await request(`${base}/issues/${failedView.reviewCaseId}`)).body.operationType,'REFUND');const failurePosts=requests.length;assert.equal((await execute(failedView)).state,'FAILED');assert.equal(requests.length,failurePosts);behavior='ok';
    cases.push('refund-issued-document-pending-failed-and-bank-status-remain-separate-with-original-case');
    const auditOp=await queued(),trigger=`refund_audit_${run}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.refund.observed' AND NEW."targetId"='${auditOp.id}' THEN RAISE EXCEPTION 'synthetic refund audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
    const invoiceBefore=await db.billingInvoice.findUniqueOrThrow({where:{id:local.id}}),auditPosts=requests.length;
    try{assert.equal((await execute(auditOp)).state,'UNKNOWN');assert.deepEqual(await db.billingInvoice.findUniqueOrThrow({where:{id:local.id}}),invoiceBefore);}
    finally{await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);}
    assert.equal((await execute(await get(auditOp.id))).state,'SUCCEEDED');assert.equal(requests.length,auditPosts+1);
    cases.push('refund-real-postgres-audit-rollback-retains-unknown-and-observes-original-on-retry');
    const leaseOp=await queued(),leasePosts=requests.length;behavior='lose-lease';
    assert.equal((await command(leaseOp,'run')).status,409);behavior='ok';
    assert.equal((await get(leaseOp.id)).state,'RUNNING');assert.equal((await db.billingAccount.findUniqueOrThrow({where:{id:account.id}})).leaseToken,'synthetic-replacement-refund-lease');
    assert.equal((await execute(await get(leaseOp.id))).state,'SUCCEEDED');assert.equal(requests.length,leasePosts+1);
    cases.push('refund-lost-account-operation-lease-cannot-publish-success-or-clear-replacement-and-original-recovery-writes-once');
    const workerOp=await queued(),workerPosts=requests.length,drained=await input.drainOperations() as {status:number};assert.equal(drained.status,200);assert.equal((await get(workerOp.id)).state,'SUCCEEDED');assert.equal(requests.length,workerPosts+1);
    cases.push('refund-worker-drain-executes-approved-original-once-and-pending-create-blocks-new-sales');
    if(browser){
      const page=browser.page;let readLimited=false;
      const openReview=async(target:typeof page,navigate:()=>Promise<unknown>)=>{
        for(let tries=0;tries<3;tries++){
          const responses:Promise<{status:number;body:any}>[]=[];
          const collect=(r:any)=>{if(r.request().method()==='GET'&&new URL(r.url()).pathname.endsWith(`/invoices/${local.id}/refund-review`))responses.push(r.json().then((body:any)=>({status:r.status(),body})).catch(()=>({status:r.status(),body:null})));};
          target.on('response',collect);
          try{
            if(tries===0)await navigate();else await target.getByRole('button',{name:'โหลดรายการล่าสุด',exact:true}).click();
            const form=target.getByLabel('จำนวนเงินที่ต้องการคืน (บาท)',{exact:true}),limited=target.getByRole('alert').filter({hasText:'กรุณารอ'});
            await form.or(limited).first().waitFor();const observed=await bounded(Promise.all(responses),'review response bodies');
            // A superseded development-mode read may receive429 while the current read succeeds.
            if(await form.isVisible()){assert.ok(observed.some(r=>r.status===200&&r.body?.invoiceId===local.id&&r.body?.companyId===companyId&&r.body?.canCreate===true),'Visible original form needs actual successful review HTTP evidence');return;}
            const seconds=Number((await limited.innerText()).match(/กรุณารอ (\d+) วินาที/)?.[1]);
            assert.ok(Number.isInteger(seconds)&&seconds>=1&&seconds<=60);
            assert.ok(observed.some(r=>r.status===429&&r.body?.code==='BILLING_RATE_LIMIT'&&r.body.retryAfterSeconds===seconds),'Visible wait must match an actual original review response');readLimited=true;
            await new Promise(r=>setTimeout(r,Math.min(60,seconds+1)*1000));
          }finally{target.off('response',collect);}
        }
        assert.fail('Original refund review must recover through the visible bounded wait/reload path');
      };
      await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/billing/companies/${companyId}/invoices/${local.id}`,{waitUntil:'domcontentloaded'});
      await openReview(page,()=>page.getByRole('link',{name:'ตรวจหรือสร้างคำขอคืนเงิน',exact:true}).click());await page.getByLabel('จำนวนเงินที่ต้องการคืน (บาท)',{exact:true}).fill('10.001');
      await page.getByLabel('เหตุผลภายใน (ลูกค้าไม่เห็น)',{exact:true}).fill('PRIVATE_REFUND ทดสอบผ่านหน้าเว็บ');await page.getByRole('button',{name:'ตรวจยอดและผลกระทบ',exact:true}).click();
      assert.equal(await page.getByLabel('จำนวนเงินที่ต้องการคืน (บาท)',{exact:true}).evaluate(n=>(n as HTMLInputElement).validity.valid),false);
      await page.getByLabel('จำนวนเงินที่ต้องการคืน (บาท)',{exact:true}).fill('10.00');
      await page.getByLabel('ให้ Stripe ส่งอีเมลเอกสารปรับยอดให้ลูกค้า',{exact:true}).check();
      let release!:()=>void,createdId='',limited=false;const held=new Promise<void>(r=>{release=r;});
      try{
        for(let tries=0;tries<3;tries++){
          let accepted!:(result:{status:number;body:any;error?:unknown})=>void;
          const ready=new Promise<{status:number;body:any;error?:unknown}>(r=>{accepted=r;});
          await page.route('**/refund-preview',async route=>{
            try{
              const response=await route.fetch(),result={status:response.status(),body:await response.json()};
              if(result.status===200){accepted(result);await held;await route.fulfill({response});}
              else{await route.fulfill({response});accepted(result);}
            }catch(error){accepted({status:0,body:null,error});await route.abort().catch(()=>{});}
          },{times:1});
          await page.getByRole('button',{name:'ตรวจยอดและผลกระทบ',exact:true}).click();const result=await bounded(ready,'held preview response');if(result.error)throw result.error;
          if(result.status===200){createdId=result.body.id;break;}
          assert.equal(result.status,429,JSON.stringify(result));assert.equal(result.body.code,'BILLING_RATE_LIMIT');
          const seconds=result.body.retryAfterSeconds;assert.ok(Number.isInteger(seconds)&&seconds>=1&&seconds<=60);
          await page.getByRole('alert').filter({hasText:`กรุณารอ ${seconds} วินาที`}).waitFor();limited=true;
          assert.equal(await page.getByLabel('จำนวนเงินที่ต้องการคืน (บาท)',{exact:true}).inputValue(),'10.00');
          assert.equal(await page.getByLabel('ให้ Stripe ส่งอีเมลเอกสารปรับยอดให้ลูกค้า',{exact:true}).isChecked(),true);
          await new Promise(r=>setTimeout(r,Math.min(60,seconds+1)*1000));
        }
        assert.ok(createdId,'A successful original preview must be retained after bounded rate-limit recovery');
        await page.getByRole('link',{name:'กลับไปบริษัท',exact:true}).click();await page.waitForURL(`${browser.origin}/system/billing/companies/${companyId}`);
        const delivered=page.waitForResponse(r=>r.url().endsWith('/refund-preview'));release();await bounded((await delivered).finished(),'late response finished');await bounded(page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))),'late navigation render');
        assert.equal(new URL(page.url()).pathname,`/system/billing/companies/${companyId}`);
      }finally{release();await page.unroute('**/refund-preview');}
      await openReview(page,()=>page.goto(`${browser.origin}/system/billing/companies/${companyId}/invoices/${local.id}/refund`,{waitUntil:'domcontentloaded'}));
      await page.getByRole('region',{name:'คำขอคืนเงินเดิม',exact:true}).getByRole('link').filter({hasText:'PRIVATE_REFUND ทดสอบผ่านหน้าเว็บ'}).click();
      await page.getByRole('region',{name:'ผลกระทบการคืนเงิน',exact:true}).waitFor();const id=new URL(page.url()).pathname.split('/').at(-1)!;assert.equal(id,createdId);
      const browserCommand=async(target:typeof page,label:string,action:string)=>{
        for(let tries=0;tries<3;tries++){
          const [response]=await Promise.all([target.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/refunds/${id}/${action}`)),target.getByRole('button',{name:label,exact:true}).click()]);
          if(response.status()===200)return;
          const body=await response.json();assert.equal(response.status(),429,JSON.stringify(body));assert.equal(body.code,'BILLING_RATE_LIMIT');
          const seconds=body.retryAfterSeconds;assert.ok(Number.isInteger(seconds)&&seconds>=1&&seconds<=60);limited=true;
          await target.getByRole('alert').filter({hasText:`กรุณารอ ${seconds} วินาที`}).waitFor();await new Promise(r=>setTimeout(r,Math.min(60,seconds+1)*1000));
        }
        assert.fail('Refund browser command did not recover within the actual rate limit');
      };
      await proof();await proof(approveRequest);await browserCommand(page,'ส่งคำขอให้ผู้อนุมัติ','submit');await page.getByRole('status').filter({hasText:'รอผู้อนุมัติอีกคน'}).waitFor();
      const other=input.secondBrowser!.pages()[0]!;await other.goto(page.url(),{waitUntil:'domcontentloaded'});await browserCommand(other,'อนุมัติคำขอคืนเงิน','approve');await other.getByRole('status').filter({hasText:'รับคำขอแล้ว'}).waitFor();
      await browserCommand(other,'ตรวจและดำเนินการคำขอเดิม','run');await other.getByRole('status').filter({hasText:'Stripe ดำเนินการคืนเงินสำเร็จ'}).waitFor();assert.equal((await get(id)).state,'SUCCEEDED');
      assert.equal((await get(id)).notifyCustomer,true);assert.equal(new URLSearchParams(requests.at(-1)!.body).get('email_type'),'credit_note');
      assert.equal(new URLSearchParams(requests[0]!.body).get('email_type'),'none');
      await other.reload({waitUntil:'domcontentloaded'});await other.getByRole('region',{name:'ผลกระทบการคืนเงิน',exact:true}).waitFor();assert.equal(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await other.screenshot({path:`${browser.evidenceDir}/admin-refund-result-mobile.png`,fullPage:true});
      await openReview(other,()=>other.getByRole('link',{name:'กลับไปคำขอของใบแจ้งหนี้นี้',exact:true}).click());await other.getByRole('region',{name:'คำขอคืนเงินเดิม',exact:true}).waitFor();
      await page.goto(`${browser.origin}/system/billing/issues/${failedView.reviewCaseId}`,{waitUntil:'domcontentloaded'});await page.getByRole('link',{name:'เปิดคำสั่งเดิมของเคสนี้',exact:true}).click();await page.getByRole('status').filter({hasText:'คืนเงินไม่สำเร็จ'}).waitFor();
      await page.screenshot({path:`${browser.evidenceDir}/admin-refund-failed-mobile.png`,fullPage:true});
      cases.push('browser-original-invoice-refund-form-precision-independent-approval-execution-reload-case-and-return-mobile');
      cases.push('browser-refund-late-preview-does-not-navigate-after-leaving-and-invoice-history-recovers-the-original');
      cases.push('browser-refund-customer-document-email-choice-is-independently-reviewed-and-private-reason-never-sent');
      if(readLimited)cases.push('browser-refund-rate-limited-initial-read-reloads-original-invoice-after-bounded-wait');
      if(limited)cases.push('browser-refund-real-rate-limit-preserves-inputs-shows-bounded-wait-and-retries-original-review');
    }
    assert.deepEqual(await db.billingReceiptGrant.findMany({where:{billingAccountId:account.id},orderBy:{id:'asc'}}),grants);assert.deepEqual(await db.companyPlanTerm.findUnique({where:{companyId}}),term);
    cases.push('refund-never-revokes-or-mints-package-days-receipt-quota-or-company-capacity');await publish(false,true);return cases;
  }catch(error){if(browser){console.error(JSON.stringify({stage:'refunds',completed:cases,path:new URL(browser.page.url()).pathname,alerts:await browser.page.getByRole('alert').allTextContents()}));await browser.page.screenshot({path:`${browser.evidenceDir}/refund-command-failure.png`,fullPage:true});}throw error;}
  finally{
    input.transport();await db.billingInvoice.delete({where:{id:local.id}});await db.billingAccount.update({where:{id:account.id},data:{customerId:originalAccount.customerId,leaseToken:originalAccount.leaseToken,leaseUntil:originalAccount.leaseUntil,nextReconcileAt:originalAccount.nextReconcileAt,updatedAt:originalAccount.updatedAt}});
  }
}
