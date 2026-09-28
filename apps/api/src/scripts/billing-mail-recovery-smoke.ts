import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingCases} from './billing-cases-smoke';

/** Real operator HTTP/DB/worker; only Postmark transport is simulated. */
export async function checkBillingMailRecovery(input:Parameters<typeof checkBillingCases>[0]&{invoiceId:string}){
  const {delegated,companyId,stripeAccountId,targetId,otherCompanyId,notificationFixture,browser}=input,db=input.prisma.client;
  const base='/v1/system/billing',deliveryBase=`${base}/companies/${companyId}/deliveries`,ids:string[]=[];
  const account=await db.billingAccount.findFirstOrThrow({where:{companyId,stripeAccountId,livemode:false}});
  const scope=await db.billingOperatorScope.findUniqueOrThrow({where:{userId_stripeAccountId_livemode_companyId:{userId:targetId,stripeAccountId,livemode:false,companyId}}});
  // The combined suite intentionally suppresses its original owner's address. Use a separate
  // synthetic OWNER recipient; never remove that suppression to make a recovery test pass.
  const role=await db.role.findFirstOrThrow({where:{companyId,key:'OWNER',status:'ACTIVE'}}),userId=`mail-owner-${randomUUID()}`;
  const user=await db.$transaction(async tx=>{const created=await tx.user.create({data:{id:userId,displayName:'Synthetic mail recovery owner',email:`${userId}@example.test`,emailVerifiedAt:new Date()}});
    await tx.companyMembership.create({data:{companyId,userId,roles:{create:{roleId:role.id}}}});return created;});
  const get=(id:string)=>delegated(`${deliveryBase}/email:${id}`);
  const latest=(id:string)=>db.emailSendAttempt.findFirstOrThrow({where:{intentKey:`billing-notice:${id}`},orderBy:{generation:'desc'}});
  const queue=async()=>{
    const outbox=await db.outboxEvent.create({data:{companyId,aggregateType:'BillingInvoice',aggregateId:input.invoiceId,eventType:'billing.status.email',eventKey:`mail-recovery:${randomUUID()}`,
      status:'DEAD',attempts:3,lastError:'authentication',payloadJson:{data:{recipientUserId:user.id}}}});ids.push(outbox.id);
    await db.emailSendAttempt.create({data:{id:randomUUID(),intentKey:`billing-notice:${outbox.id}`,generation:1,purpose:'billing_status',provider:'postmark',providerServerId:9191301,
      stream:'outbound',recipient:user.email!,status:'CONFIG',errorCode:'authentication'}});return outbox;
  };
  const preview=async(id:string,type='RETRY_NOTIFICATION')=>{const r=await delegated(`${base}/operations/preview`,'POST',{type,companyId,expectedVersion:account.version,referenceId:`email:${id}`,reason:'ตรวจสอบและกู้คืนอีเมลแพ็กเกจเดิม'});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const submit=async(op:any)=>{const r=await delegated(`${base}/operations`,'POST',{previewId:op.id,previewHash:op.previewHash,expectedVersion:op.version},{'idempotency-key':`mail-recovery-${op.id}`});assert.equal(r.status,202,JSON.stringify(r));return r.body;};
  const prepare=async(id:string)=>{const op=await preview(id);await submit(op);await input.drainOperations();assert.equal((await delegated(`${base}/operations/${op.id}`)).body.state,'SUCCEEDED');return op;};
  const sent=(id:string)=>notificationFixture.mail.filter(m=>m.input.Metadata.sendAttemptId===id).length;
  const viewport=browser?.page.viewportSize();
  try{
    const first=await queue(),old=await latest(first.id),view=await get(first.id);assert.equal(view.status,200,JSON.stringify(view));assert.equal(view.body.channel,'EMAIL');assert.equal(view.body.canRetry,true,JSON.stringify(view));
    assert.doesNotMatch(JSON.stringify(view.body),/@example\.test|serverToken|"headersJson"/);
    assert.equal((await delegated(`${base}/companies/${otherCompanyId}/deliveries/email:${first.id}`)).status,404);
    const op=await prepare(first.id),ready=await latest(first.id);assert.equal(ready.status,'READY');assert.equal(ready.generation,2);assert.equal(ready.dispatchStartedAt,null);
    assert.deepEqual(await db.emailSendAttempt.findUnique({where:{id:old.id}}),old);assert.equal((await submit(op)).id,op.id);
    await input.drainNotifications();assert.equal((await latest(first.id)).status,'ACCEPTED');assert.equal(sent(ready.id),1);await input.drainNotifications();assert.equal(sent(ready.id),1);
    assert.equal((await get(first.id)).body.recoveryBlockedReason,'ALREADY_ACCEPTED');assert.equal((await db.outboxEvent.findUniqueOrThrow({where:{id:first.id}})).attempts,3);

    // R-A7: a document-recipient row (no user) is reviewed and recovered from the recipient column.
    const storedRecipient=(await db.billingAccount.findUniqueOrThrow({where:{id:account.id}})).recipientEmail;
    await db.billingAccount.update({where:{id:account.id},data:{recipientEmail:user.email}});
    try{
      const column=await db.outboxEvent.create({data:{companyId,aggregateType:'BillingInvoice',aggregateId:input.invoiceId,eventType:'billing.status.email',eventKey:`mail-recovery:${randomUUID()}`,
        status:'DEAD',attempts:3,lastError:'authentication',payloadJson:{schemaVersion:2,data:{recipientUserId:null}}}});ids.push(column.id);
      await db.emailSendAttempt.create({data:{id:randomUUID(),intentKey:`billing-notice:${column.id}`,generation:1,purpose:'billing_status',provider:'postmark',providerServerId:9191301,
        stream:'outbound',recipient:user.email!,status:'CONFIG',errorCode:'authentication'}});
      const columnView=await get(column.id);assert.equal(columnView.status,200,JSON.stringify(columnView));
      assert.equal(columnView.body.recipientUserId,null);assert.equal(columnView.body.recipientName,null);assert.equal(columnView.body.canRetry,true,JSON.stringify(columnView.body));
      await prepare(column.id);const columnReady=await latest(column.id);assert.equal(columnReady.status,'READY');assert.equal(columnReady.recipient,user.email);
      await input.drainNotifications();assert.equal((await latest(column.id)).status,'ACCEPTED');assert.equal(sent(columnReady.id),1);
    }finally{await db.billingAccount.update({where:{id:account.id},data:{recipientEmail:storedRecipient}});}

    const denied=await queue();await prepare(denied.id);const reserved=await latest(denied.id);
    await db.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:new Date(0)}});await input.drainNotifications();assert.equal(sent(reserved.id),0);
    assert.equal((await db.outboxEvent.findUniqueOrThrow({where:{id:denied.id}})).status,'DEAD');assert.equal((await latest(denied.id)).status,'READY');
    await db.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:scope.expiresAt}});await prepare(denied.id);assert.equal((await latest(denied.id)).id,reserved.id);
    await input.drainNotifications();assert.equal(sent(reserved.id),1);assert.equal((await db.billingIssue.findFirstOrThrow({where:{referenceId:denied.id,kind:'NOTIFICATION_REVIEW'}})).state,'RESOLVED');

    const content=await queue();await prepare(content.id);const contentAttempt=await latest(content.id),company=await db.company.findUniqueOrThrow({where:{id:companyId}});
    try{
      await db.company.update({where:{id:companyId},data:{name:`${company.name} changed`}});await input.drainNotifications();assert.equal(sent(contentAttempt.id),0);
      assert.equal((await db.outboxEvent.findUniqueOrThrow({where:{id:content.id}})).lastError,'MAIL_BINDING_CHANGED');
    }finally{await db.company.update({where:{id:companyId},data:{name:company.name}});}
    await prepare(content.id);assert.equal((await latest(content.id)).id,contentAttempt.id);await input.drainNotifications();assert.equal(sent(contentAttempt.id),1);

    const lost=await queue();await prepare(lost.id);const lostAttempt=await latest(lost.id);notificationFixture.loseNextMail(lostAttempt.id);await input.drainNotifications();
    assert.equal((await latest(lost.id)).status,'UNKNOWN');assert.equal((await get(lost.id)).body.canRetry,false);
    await db.emailSendAttempt.update({where:{id:lostAttempt.id},data:{nextRecoveryAt:new Date(0)}});assert.equal((await get(lost.id)).body.canReconcile,true);
    const lookup=await preview(lost.id,'RECONCILE_NOTIFICATION');assert.equal(lookup.deliveryImpact.afterState,'OBSERVED');await submit(lookup);await input.drainOperations();
    const observed=(await delegated(`${base}/operations/${lookup.id}`)).body;assert.equal(observed.observed.deliveryState,'ACCEPTED');assert.equal(sent(lostAttempt.id),1);
    const acceptedView=(await get(lost.id)).body;assert.equal(acceptedView.errorCode,null);assert.equal(acceptedView.mailHistory[0].errorCode,'transport_unknown');
    assert.equal((await latest(lost.id)).id,lostAttempt.id);assert.equal((await db.outboxEvent.findUniqueOrThrow({where:{id:lost.id}})).status,'PUBLISHED');

    const unknown=await queue(),unknownAttempt=await latest(unknown.id);await db.emailSendAttempt.update({where:{id:unknownAttempt.id},data:{status:'UNKNOWN',dispatchStartedAt:new Date(),nextRecoveryAt:new Date(0)}});
    const empty=await preview(unknown.id,'RECONCILE_NOTIFICATION');await submit(empty);await input.drainOperations();
    assert.equal((await latest(unknown.id)).status,'RETRY');assert.equal((await get(unknown.id)).body.possibleDuplicate,true);assert.equal((await get(unknown.id)).body.recoveryBlockedReason,'MAIL_BACKOFF');
    await db.emailSendAttempt.update({where:{id:unknownAttempt.id},data:{nextRecoveryAt:new Date(0)}});
    const repeat=await preview(unknown.id);assert.equal(repeat.deliveryImpact.possibleDuplicate,true);await submit(repeat);await input.drainOperations();
    const next=await latest(unknown.id);assert.equal(next.possibleDuplicate,true);
    // A late positive for the old generation must fence the reserved successor before provider I/O.
    await db.emailSendAttempt.update({where:{id:unknownAttempt.id},data:{status:'ACCEPTED',providerMessageId:randomUUID(),submittedAt:new Date()}});
    await input.drainNotifications();assert.equal(sent(next.id),0);assert.equal((await latest(unknown.id)).errorCode,'prior_generation_accepted');
    assert.equal((await get(unknown.id)).body.state,'ACCEPTED');assert.equal((await get(unknown.id)).body.canReconcile,true);
    const late=await preview(unknown.id,'RECONCILE_NOTIFICATION');await submit(late);await input.drainOperations();
    assert.equal((await db.outboxEvent.findUniqueOrThrow({where:{id:unknown.id}})).status,'PUBLISHED');assert.equal(sent(next.id),0);

    const changed=await queue(),stale=await preview(changed.id),changedAttempt=await latest(changed.id);
    await db.emailSendAttempt.update({where:{id:changedAttempt.id},data:{recipient:'changed@example.test'}});
    const rejected=await delegated(`${base}/operations`,'POST',{previewId:stale.id,previewHash:stale.previewHash,expectedVersion:stale.version},{'idempotency-key':`mail-recovery-${stale.id}`});assert.equal(rejected.status,409);
    assert.equal((await get(changed.id)).body.recoveryBlockedReason,'MAIL_RECIPIENT_CHANGED');
    await delegated(`${base}/operations/${stale.id}/cancel`,'POST',{expectedVersion:stale.version});
    await db.emailSendAttempt.update({where:{id:changedAttempt.id},data:{recipient:user.email!,suppressedAt:new Date(),status:'SUPPRESSED'}});assert.equal((await get(changed.id)).body.recoveryBlockedReason,'PREFERENCE_SUPPRESSED');
    await db.emailSendAttempt.update({where:{id:changedAttempt.id},data:{suppressedAt:null,status:'CONFIG',generation:5}});assert.equal((await get(changed.id)).body.recoveryBlockedReason,'MAIL_RETRY_EXHAUSTED');
    await db.emailSendAttempt.update({where:{id:changedAttempt.id},data:{generation:1,deadlineAt:new Date(0)}});assert.equal((await get(changed.id)).body.recoveryBlockedReason,'MAIL_PROOF_EXPIRED');
    await db.emailSendAttempt.update({where:{id:changedAttempt.id},data:{deadlineAt:null,providerServerId:9191302,status:'UNKNOWN',dispatchStartedAt:new Date(),nextRecoveryAt:new Date(0)}});
    assert.equal((await get(changed.id)).body.recoveryBlockedReason,'MAIL_CONFIGURATION_CHANGED');assert.equal((await get(changed.id)).body.canReconcile,false);

    if(browser){const item=await queue(),page=browser.page;await page.setViewportSize({width:390,height:844});
      for(const ref of [`email:${item.id}`,encodeURIComponent(`email:${item.id}`)]){
        const response=await page.request.get(`${browser.origin}/api${deliveryBase}/${ref}`);
        assert.equal(response.status(),200,`mail BFF ${ref}: ${response.status()} ${await response.text()}`);
      }
      const deliveryResponse=page.waitForResponse(r=>r.url().includes('/api/v1/system/billing/companies/')&&r.url().includes('/deliveries/'));
      await page.goto(`${browser.origin}/system/billing/companies/${companyId}/deliveries/email:${item.id}`,{waitUntil:'domcontentloaded'});
      const loaded=await deliveryResponse;assert.equal(loaded.status(),200,`mail browser ${loaded.url()}: ${loaded.status()} ${await loaded.text()}`);
      await page.getByLabel('เหตุผลการตรวจสอบ',{exact:true}).fill('กู้คืนอีเมลเดิมผ่านหน้าเว็บ');await page.getByRole('button',{name:'ตรวจสอบผลกระทบ',exact:true}).click();
      await page.getByRole('button',{name:'ยืนยันส่งคำสั่งตรวจสอบ',exact:true}).click();await page.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'}).waitFor();
      await page.getByRole('link',{name:'เปิดลิงก์คำสั่งนี้',exact:true}).click();await page.waitForURL(/\/operations\//);await page.reload();await input.drainOperations();
      await page.getByRole('button',{name:'โหลดคำสั่งล่าสุด',exact:true}).click();await page.getByRole('status').filter({hasText:'นำรายการเดิมกลับเข้าคิวแล้ว'}).waitFor();
      const pending=await latest(item.id);notificationFixture.loseNextMail(pending.id);await input.drainNotifications();await db.emailSendAttempt.update({where:{id:pending.id},data:{nextRecoveryAt:new Date(0)}});
      await page.getByRole('link',{name:'เปิดรายการส่งเดิม',exact:true}).click();await page.waitForURL(/\/deliveries\//);await page.getByRole('heading',{name:'อีเมล · ยังยืนยันผลส่งไม่ได้',exact:true}).waitFor();
      await page.getByLabel('เหตุผลการตรวจสอบ',{exact:true}).fill('ตามผลรายการเดิมจาก Postmark');await page.getByRole('button',{name:'ตรวจสอบผลกระทบ',exact:true}).click();
      await page.getByText('อีเมล · ยังยืนยันผลส่งไม่ได้ → ตรวจผลเดิมก่อนส่งใหม่',{exact:true}).waitFor();await page.getByRole('button',{name:'ยืนยันส่งคำสั่งตรวจสอบ',exact:true}).click();await page.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'}).waitFor();
      await input.drainOperations();await page.getByRole('link',{name:'เปิดลิงก์คำสั่งนี้',exact:true}).click();await page.waitForURL(/\/operations\//);await page.reload();
      await page.getByText('สถานะรายการส่งที่ตรวจพบ: ผู้ให้บริการรับคำขอแล้ว',{exact:true}).waitFor();await page.getByRole('link',{name:'เปิดรายการส่งเดิม',exact:true}).click();await page.waitForURL(/\/deliveries\//);
      await page.getByRole('heading',{name:'อีเมล · ผู้ให้บริการรับคำขอแล้ว',exact:true}).waitFor();assert.equal(sent(pending.id),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${browser.evidenceDir}/admin-mail-recovery-mobile.png`,fullPage:true});
    }
    return ['admin-postmark-original-intent-ready-generation-replay-and-no-counter-reset','admin-postmark-revoked-operator-parks-ready-and-new-review-resumes-same-generation',
      'admin-postmark-unknown-scoped-lookup-without-resend-and-observed-resolution','admin-postmark-empty-lookup-duplicate-warning-and-late-positive-fence','admin-postmark-recipient-suppression-generation-cap-and-stale-preview',
      'admin-postmark-approved-content-expiry-and-server-mapping-fences','admin-postmark-document-recipient-row-reviewed-and-recovered-from-column',
      ...(browser?['browser-admin-mail-retry-and-lookup-command-reload-return-mobile']:[])];
  }finally{
    if(browser&&viewport)await browser.page.setViewportSize(viewport);await db.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:scope.expiresAt}});
    const ops=await db.billingOperation.findMany({where:{referenceId:{in:ids.map(id=>`email:${id}`)}},select:{id:true}}),references=[...ids,...ops.map(o=>o.id)];
    const issues=await db.billingIssue.findMany({where:{referenceId:{in:references}},select:{id:true}});
    await db.auditLog.deleteMany({where:{targetId:{in:[...references,...issues.map(i=>i.id)]}}});await db.billingIssue.deleteMany({where:{id:{in:issues.map(i=>i.id)}}});
    await db.billingOperation.deleteMany({where:{id:{in:ops.map(o=>o.id)}}});await db.emailSendAttempt.deleteMany({where:{intentKey:{in:ids.map(id=>`billing-notice:${id}`)}}});await db.outboxEvent.deleteMany({where:{id:{in:ids}}});
    await db.notificationRecipient.deleteMany({where:{companyId,userId}});
    await db.emailSendAttempt.deleteMany({where:{recipient:user.email!}});
    await db.outboxEvent.deleteMany({where:{companyId,eventType:'billing.status.email',payloadJson:{path:['data','recipientUserId'],equals:userId}}});
    await db.companyMembership.deleteMany({where:{companyId,userId}});await db.user.delete({where:{id:userId}});
  }
}
