import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingCases} from './billing-cases-smoke';
import {checkBillingMailRecovery} from './billing-mail-recovery-smoke';
import {AppConfigService} from '../common/config/app-config.service';
import {encryptCredential} from '../modules/system-partner-management/domain/logic/credential-cipher.logic';

export async function checkBillingDeliveryRecovery(input:Parameters<typeof checkBillingCases>[0]){
  const {request,delegated,companyId,stripeAccountId,browser,targetId,targetRoleId,otherCompanyId,notificationFixture}=input,db=input.prisma.client,run=randomUUID();
  const base='/v1/system/billing',deliveryBase=`${base}/companies/${companyId}/deliveries`;
  const existing=await db.billingAccount.findFirst({where:{companyId,stripeAccountId,livemode:false}});
  const account=existing??await db.billingAccount.create({data:{companyId,stripeAccountId,livemode:false}});
  const settings=await db.billingSettings.findUniqueOrThrow({where:{id:`${stripeAccountId}:test`}});
  const invoice=await db.billingInvoice.create({data:{billingAccountId:account.id,providerInvoiceId:`in_notice_${run}`,offerSnapshot:{},contractSnapshot:{},policyRevisionId:settings.policyRevisionId!,
    currency:'THB',totalSatang:1,paidSatang:1,periodStart:new Date(),periodEnd:new Date(Date.now()+86400000),providerStatus:'paid',applyStatus:'APPLIED',appliedAt:new Date(),evidenceHash:'synthetic-original-notification-source'}});
  const event=await db.notificationEvent.create({data:{companyId,triggerKey:'billing.package_updated',sourceModule:'billing',sourceType:'invoice',sourceId:invoice.id,title:`Synthetic recovery ${run}`,body:'ตรวจสถานะแพ็กเกจ',
    severity:'INFO',dedupKey:`notice-recovery-${run}`,payloadJson:{},sourceRefsJson:{}}});
  const recipient=await db.notificationRecipient.create({data:{companyId,userId:input.userIds[0]!,eventId:event.id,recipientReason:'owner'}});
  const permission=await db.permission.findUniqueOrThrow({where:{key:'system.billing.notification.retry'}}),rolePermission={roleId:targetRoleId,permissionId:permission.id};
  await db.rolePermission.create({data:rolePermission});
  const scope=await db.billingOperatorScope.findUniqueOrThrow({where:{userId_stripeAccountId_livemode_companyId:{userId:targetId,stripeAccountId,livemode:false,companyId}}});
  const queue=()=>db.notificationDelivery.create({data:{companyId,recipientId:recipient.id,channel:'LINE',status:'SKIPPED',errorCode:'LINE_CONFIGURATION_MISSING'}});
  const sends=()=>notificationFixture.line.filter(item=>item.body.includes(event.title));
  const get=(id:string)=>delegated(`${deliveryBase}/${id}`);
  const preview=async(id:string,actor=delegated)=>{const result=await actor(`${base}/operations/preview`,'POST',{type:'RETRY_NOTIFICATION',companyId,expectedVersion:account.version,referenceId:id,reason:'กู้คืนรายการส่งเดิมหลังตรวจการตั้งค่า'});assert.equal(result.status,200,JSON.stringify(result));return result.body;};
  const submit=(op:any,actor=delegated)=>actor(`${base}/operations`,'POST',{previewId:op.id,previewHash:op.previewHash,expectedVersion:op.version},{'idempotency-key':`notice-repair-${op.id}`});
  const state=()=>db.billingAccount.findUniqueOrThrow({where:{id:account.id}}),beforeAccount=await state(),beforeGrants=await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}});
  const viewport=browser?.page.viewportSize();
  let credentialId:string|undefined;
  try{
    const row=await queue(),view=await get(row.id);assert.equal(view.status,200,JSON.stringify(view));assert.equal(view.body.canRetry,true);
    assert.doesNotMatch(JSON.stringify(view.body),/@example\.test|providerUserId|channelAccessToken|"metadataJson"/);
    assert.equal((await delegated(`${base}/companies/${otherCompanyId}/deliveries/${row.id}`)).status,404);
    // Fault injection is confined to the isolated smoke DB; publication authorization has its own real HTTP proof.
    assert.equal(await db.platformLineCredential.count({where:{credentialKind:'LINE_MESSAGING_API'}}),0);
    const config=new AppConfigService(),publishedToken=`synthetic-repaired-${run}`;
    const encrypted=(expiresAt:Date)=>encryptCredential(JSON.stringify({schemaVersion:1,channelId:config.lineMessagingChannelId,
      channelSecret:'b'.repeat(32),accessToken:publishedToken,tokenExpiresAt:expiresAt.toISOString()}),config.credentialEncryptionKey);
    const publication=await db.platformLineCredential.create({data:{credentialKind:'LINE_MESSAGING_API',encryptedSecretJson:'synthetic-corrupt',runtimePublishedAt:new Date()}});
    credentialId=publication.id;
    const beforeReadSends=notificationFixture.line.length;
    for(const fault of ['corrupt','expired']){
      if(fault==='expired')await db.platformLineCredential.update({where:{id:publication.id},data:{encryptedSecretJson:encrypted(new Date(0)),secretVersion:{increment:1}}});
      const unavailable=await get(row.id);assert.equal(unavailable.status,200,JSON.stringify(unavailable));assert.equal(unavailable.body.recoveryBlockedReason,'LINE_CONFIGURATION_MISSING');assert.equal(unavailable.body.canRetry,false);
      const list=await delegated(deliveryBase);assert.equal(list.status,200,JSON.stringify(list));assert.ok(list.body.items.some((item:any)=>item.id===row.id&&item.recoveryBlockedReason==='LINE_CONFIGURATION_MISSING'));
      assert.doesNotMatch(JSON.stringify([unavailable.body,list.body]),/synthetic-repaired|synthetic-corrupt|encryptedSecretJson|channelSecret|accessToken/);
      const refused=await delegated(`${base}/operations/preview`,'POST',{type:'RETRY_NOTIFICATION',companyId,expectedVersion:account.version,referenceId:row.id,reason:'ตรวจรายการเดิมขณะข้อมูลรับรองไม่พร้อม'});
      assert.equal(refused.body.code,'CONTROL_NOTIFICATION_REVIEW');assert.ok(refused.status>=400&&refused.status<500);
      if(browser){
        const page=browser.page;await page.setViewportSize({width:390,height:844});
        await page.goto(`${browser.origin}/system/billing/companies/${companyId}/deliveries/${row.id}`,{waitUntil:'domcontentloaded'});
        await page.getByRole('heading',{name:'TEST · LINE · SKIPPED',exact:true}).waitFor();await page.getByText(/ให้ผู้ดูแลระบบตรวจการเชื่อมต่อ LINE/).first().waitFor();
        assert.equal(await page.getByRole('button',{name:'ตรวจสอบผลกระทบ',exact:true}).count(),0);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(fault==='expired')await page.screenshot({path:`${browser.evidenceDir}/admin-delivery-config-unavailable-mobile.png`,fullPage:true});
      }
    }
    assert.equal(notificationFixture.line.length,beforeReadSends);assert.deepEqual(await db.notificationDelivery.findUniqueOrThrow({where:{id:row.id}}),row,'read/denied preview must preserve the original journal');
    await db.platformLineCredential.update({where:{id:publication.id},data:{encryptedSecretJson:encrypted(new Date(Date.now()+86400000)),secretVersion:{increment:1}}});
    assert.equal((await get(row.id)).body.canRetry,true);
    if(browser){await browser.page.getByRole('button',{name:'โหลดรายการส่งล่าสุด',exact:true}).click();await browser.page.getByText('พร้อมให้ตรวจสอบก่อนนำรายการเดิมกลับเข้าคิว',{exact:true}).waitFor();}
    const op=await preview(row.id),rival=await preview(row.id,request);const queued=await submit(op);assert.equal(queued.status,202,JSON.stringify(queued));
    assert.equal((await submit(op)).body.id,op.id);assert.equal((await submit(rival,request)).status,409);
    await input.drainOperations();assert.equal((await delegated(`${base}/operations/${op.id}`)).body.state,'SUCCEEDED');
    const beforeSends=sends().length;notificationFixture.loseNextLine(event.title);await input.drainNotifications();
    let sent=await db.notificationDelivery.findUniqueOrThrow({where:{id:row.id}});assert.equal(sent.attemptCount,1);assert.equal(sent.status,'QUEUED');
    await db.notificationDelivery.update({where:{id:row.id},data:{nextAttemptAt:new Date(0)}});await input.drainNotifications();
    sent=await db.notificationDelivery.findUniqueOrThrow({where:{id:row.id}});assert.equal(sent.status,'SENT');assert.equal(sends().length,beforeSends+2);
    assert.equal(sends()[beforeSends]!.key,sends()[beforeSends+1]!.key);
    assert.equal(sends()[beforeSends]!.authorization,`Bearer ${publishedToken}`);assert.equal(sends()[beforeSends+1]!.authorization,`Bearer ${publishedToken}`);
    assert.equal((await get(row.id)).body.recoveryBlockedReason,'ALREADY_ACCEPTED');
    assert.deepEqual((await delegated(`${base}/operations?companyId=${companyId}&referenceId=${row.id}`)).body.items.map((r:any)=>r.referenceId),[row.id,row.id]);
    assert.equal((await submit(op)).body.id,op.id);assert.equal((await db.notificationDelivery.findUniqueOrThrow({where:{id:row.id}})).status,'SENT');
    await request(`${base}/operations/${rival.id}/cancel`,'POST',{expectedVersion:rival.version});

    const denied=await queue(),deniedOp=await preview(denied.id);await submit(deniedOp);await input.drainOperations();
    await db.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:new Date(0)}});
    const beforeDenied=sends().length;await input.drainNotifications();assert.equal(sends().length,beforeDenied);
    const blocked=await db.notificationDelivery.findUniqueOrThrow({where:{id:denied.id}});assert.equal(blocked.status,'FAILED');assert.equal(blocked.errorCode,'CONTROL_PERMISSION_CHANGED');assert.equal(blocked.nextAttemptAt,null);
    await db.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:scope.expiresAt}});
    const repair=await preview(denied.id);await submit(repair);await input.drainOperations();await input.drainNotifications();assert.equal((await get(denied.id)).body.state,'SENT');
    const resolved=await db.billingIssue.findFirstOrThrow({where:{stripeAccountId,kind:'NOTIFICATION_REVIEW',referenceId:denied.id}});assert.equal(resolved.state,'RESOLVED');
    assert.equal(await db.auditLog.count({where:{targetId:resolved.id,action:'billing.issue.resolved'}}),1);

    const changedAfterQueue=await queue(),changedOp=await preview(changedAfterQueue.id);await submit(changedOp);await input.drainOperations();
    await db.notificationEvent.update({where:{id:event.id},data:{body:'เปลี่ยนข้อความหลังอนุมัติให้นำเข้าคิว'}});
    const beforeChangedSend=sends().length;await input.drainNotifications();assert.equal(sends().length,beforeChangedSend);
    assert.equal((await get(changedAfterQueue.id)).body.errorCode,'LINE_BINDING_CHANGED');
    await db.notificationEvent.update({where:{id:event.id},data:{body:event.body}});

    const stale=await queue(),staleOp=await preview(stale.id);
    await db.notificationEvent.update({where:{id:event.id},data:{body:'ข้อความต้นทางเปลี่ยนหลัง preview'}});
    assert.equal((await submit(staleOp)).status,409,'review must bind the original content');
    const prefs=await db.notificationPreference.findUnique({where:{companyId_userId:{companyId,userId:input.userIds[0]!}}});
    if(!prefs){const pref=await db.notificationPreference.create({data:{companyId,userId:input.userIds[0]!,enabledChannelsJson:['web'],enabledTriggerKeysJson:['billing.package_updated']}});
      assert.equal((await get(stale.id)).body.recoveryBlockedReason,'PREFERENCE_SUPPRESSED');await db.notificationPreference.delete({where:{id:pref.id}});}
    const aged=await queue();await db.notificationDelivery.update({where:{id:aged.id},data:{status:'FAILED',attemptCount:5}});assert.equal((await get(aged.id)).body.recoveryBlockedReason,'LINE_RETRY_EXHAUSTED');
    await db.notificationEvent.update({where:{id:event.id},data:{body:event.body}});
    await db.notificationDelivery.update({where:{id:aged.id},data:{attemptCount:1,metadataJson:{billing:{...(sent.metadataJson as any).billing,firstStartedAt:new Date(Date.now()-24*3600000).toISOString()}}}});
    assert.equal((await get(aged.id)).body.recoveryBlockedReason,'LINE_UNKNOWN_REVIEW');
    await request(`${base}/operations/${staleOp.id}/cancel`,'POST',{expectedVersion:staleOp.version});

    if(browser){
      const page=browser.page,item=await queue();await page.setViewportSize({width:390,height:844});
      await page.goto(`${browser.origin}/system/billing/companies/${companyId}/deliveries/${item.id}`,{waitUntil:'domcontentloaded'});
      await page.getByLabel('เหตุผลการตรวจสอบ',{exact:true}).fill('ตรวจแล้วนำรายการเดิมกลับเข้าคิวจากเว็บ');await page.getByRole('button',{name:'ตรวจสอบผลกระทบ',exact:true}).click();
      await page.getByRole('button',{name:'ยืนยันส่งคำสั่งตรวจสอบ',exact:true}).click();await page.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'}).waitFor();
      await page.getByRole('link',{name:'เปิดลิงก์คำสั่งนี้',exact:true}).click();await page.waitForURL(/\/system\/billing\/operations\//);await page.reload();
      await input.drainOperations();await page.getByRole('button',{name:'โหลดคำสั่งล่าสุด',exact:true}).click();await page.getByRole('status').filter({hasText:'นำรายการเดิมกลับเข้าคิวแล้ว'}).waitFor();
      await input.drainNotifications();await page.getByRole('link',{name:'เปิดรายการส่งเดิม',exact:true}).click();await page.waitForURL(/\/deliveries\//);await page.getByRole('heading',{name:'TEST · LINE · SENT',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${browser.evidenceDir}/admin-delivery-recovery-mobile.png`,fullPage:true});
    }
    const mailCases=await checkBillingMailRecovery({...input,invoiceId:invoice.id});
    assert.deepEqual(await state(),beforeAccount);assert.deepEqual(await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}}),beforeGrants);
    return ['admin-delivery-corrupt-expired-published-credentials-readable-blocked-and-original-recovery','admin-delivery-scoped-source-preview-concurrency-replay-and-lost-line-response','admin-delivery-revoked-operator-before-send-parks-original-and-new-review-recovers',
      'admin-delivery-content-preference-accepted-budget-and-aged-key-fences',...(browser?['browser-admin-original-delivery-preview-command-reload-return-and-mobile']:[]),...mailCases];
  }finally{
    if(credentialId)await db.platformLineCredential.delete({where:{id:credentialId}});
    if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await db.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:scope.expiresAt}});await db.rolePermission.delete({where:{roleId_permissionId:rolePermission}});
    const deliveries=await db.notificationDelivery.findMany({where:{recipientId:recipient.id},select:{id:true}}),ids=deliveries.map(d=>d.id);
    const ops=await db.billingOperation.findMany({where:{stripeAccountId,referenceId:{in:ids}},select:{id:true}});
    const issues=await db.billingIssue.findMany({where:{stripeAccountId,referenceId:{in:[...ids,...ops.map(o=>o.id)]}},select:{id:true}});
    await db.auditLog.deleteMany({where:{targetId:{in:[...ids,...ops.map(o=>o.id),...issues.map(i=>i.id)]}}});await db.billingIssue.deleteMany({where:{id:{in:issues.map(i=>i.id)}}});
    await db.billingOperation.deleteMany({where:{id:{in:ops.map(o=>o.id)}}});await db.notificationEvent.delete({where:{id:event.id}});await db.billingInvoice.delete({where:{id:invoice.id}});
    if(!existing)await db.billingAccount.delete({where:{id:account.id}});
  }
}
