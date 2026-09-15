import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../common/database/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';
import { LineMessagingCredentialsService } from '../common/config/line-messaging-credentials.service';
import { LineReplyAdapter } from '../modules/line-ai/infrastructure/line-reply.adapter';
import { ProcessLineWebhookUseCase } from '../modules/line-ai/application/use-cases/process-line-webhook.use-case';
import { ProcessQueuedDeliveryUseCase } from '../modules/dashboard-notifications/application/use-cases/notification.use-cases';
import { hashPassword } from '../modules/auth/domain/logic/password-credential.logic';
import type { startBillingBrowser } from './billing-browser-smoke';

/** Real Admin and signed HTTP receiver, DB and outbound adapters; only LINE transport is simulated. */
export async function checkLineRuntimeCredentials(input:{app:INestApplication;prisma:PrismaService;origin:string;userId:string;companyId:string;membershipId:string;
 request:(path:string,method?:string,body?:unknown,headers?:Record<string,string>)=>Promise<{status:number;body:any}>;
 browser:Awaited<ReturnType<typeof startBillingBrowser>>;
 transport:(hook:((url:URL,init?:RequestInit)=>Promise<Response|undefined>|Response|undefined)|undefined)=>void;}){
 const {app,prisma,request,browser}=input,db=prisma.client,config=app.get(AppConfigService),base='/v1/system/line/shared-credentials';
 assert.equal(await db.platformLineCredential.count(),0,'credential smoke requires isolated empty platform credential storage');
 const password=`Synthetic!${randomUUID()}`,channelId=config.lineMessagingChannelId!,secret='a'.repeat(32),token=`synthetic-token-${randomUUID()}`,pid=process.pid;
 const initialInvoices=await db.billingInvoice.findMany({orderBy:{id:'asc'}});
 const initialIdentity=await db.externalIdentity.findMany({where:{userId:input.userId},orderBy:{id:'asc'}}),calls:{path:string;token:string|null;retryKey:string|null;body:string}[]=[],cases:string[]=[];
 let responseFault='',providerHook:(()=>Promise<void>)|undefined;
 input.transport(async(url,init)=>{
   if(url.hostname!=='api.line.me'&&url.hostname!=='api-data.line.me')return undefined;
   const headers=new Headers(init?.headers),body=String(init?.body??'');calls.push({path:url.pathname,token:headers.get('authorization'),retryKey:headers.get('x-line-retry-key'),body});
   if(url.pathname==='/v2/oauth/verify'){
     assert.equal(new URLSearchParams(body).get('access_token'),token);await providerHook?.();
     if(responseFault==='unavailable')throw Error('synthetic timeout');
     return Response.json({client_id:responseFault==='wrong-channel'?'another-channel':channelId,expires_in:86400});
   }
   if(url.pathname.endsWith('/content'))return new Response(Buffer.from('synthetic receipt bytes'),{headers:{'content-type':'application/pdf'}});
   if(responseFault==='queued-unavailable'&&url.pathname==='/v2/bot/message/push')return Response.json({}, {status:503});
   return Response.json({});
 });
 const admin=await db.role.upsert({where:{scopeKey_key:{scopeKey:'system',key:'SYSTEM_ADMIN'}},update:{},create:{scopeKey:'system',key:'SYSTEM_ADMIN',name:'System Admin',isSystem:true}});
 const permission=await db.permission.upsert({where:{key:'system.shared_line_credential.manage'},update:{},create:{key:'system.shared_line_credential.manage',description:'Shared Messaging credentials'}});
 const existingGrant=await db.rolePermission.findUnique({where:{roleId_permissionId:{roleId:admin.id,permissionId:permission.id}}});
 const credential=await db.userCredential.create({data:{userId:input.userId,passwordHash:hashPassword(password)}});
 const term=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId:input.companyId}});
 await db.companyPlanTerm.update({where:{companyId:input.companyId},data:{termEndsAt:new Date(Date.now()+86400000)}});
 const body={channelId,channelSecret:secret,accessToken:token,password,expectedVersion:0,rotationId:randomUUID(),reason:'เปลี่ยนกุญแจ LINE ในระบบจำลอง'};
 const put=(data=body)=>request(`${base}/LINE_MESSAGING_API`,'PUT',data);
 const queued=await db.notificationEvent.create({data:{companyId:input.companyId,triggerKey:'stock_low',sourceModule:'inventory',sourceType:'stock',
   severity:'CRITICAL',title:'Synthetic queued notification',body:'Queued before credential publication',dedupKey:randomUUID(),
   recipients:{create:{companyId:input.companyId,userId:input.userId,recipientReason:'OWNER',deliveries:{create:{companyId:input.companyId,channel:'LINE'}}}}},
   include:{recipients:{include:{deliveries:true}}}});
 const delivery=queued.recipients[0]!.deliveries[0]!;
 try{
   assert.equal((await request(base)).status,403);
   if(!existingGrant)await db.rolePermission.create({data:{roleId:admin.id,permissionId:permission.id}});
   await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:admin.id}});
   assert.equal((await request(base)).body.source,'ENVIRONMENT');
   assert.equal((await request(`${base}/LINE_LOGIN`,'PUT',body)).status,400);
   assert.equal((await put({...body,channelId:'foreign'})).status,409);
   assert.equal((await put({...body,password:'wrong'})).status,403);assert.equal(calls.length,0);
   responseFault='wrong-channel';assert.equal((await put()).status,400);responseFault='unavailable';assert.equal((await put()).status,503);responseFault='';
   assert.equal(await db.platformLineCredential.count(),0);
   cases.push('line-credentials-current-platform-password-channel-token-failures-before-publication');
   const worker=app.get(ProcessQueuedDeliveryUseCase);responseFault='queued-unavailable';await worker.execute(input.companyId,delivery.id);responseFault='';
   const waiting=await db.notificationDelivery.findUniqueOrThrow({where:{id:delivery.id}});assert.equal(waiting.status,'QUEUED');assert.equal(waiting.errorCode,'HTTP_503');assert.equal(waiting.attemptCount,1);
   const oldQueueCall=calls.at(-1)!;assert.equal(oldQueueCall.token,`Bearer ${config.lineMessagingChannelAccessToken}`);
   const page=browser.page;await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/line-settings`,{waitUntil:'domcontentloaded'});
   await page.getByRole('heading',{name:'การเชื่อมต่อ LINE ของระบบ',exact:true}).waitFor();
   await page.getByLabel('Channel Secret ใหม่',{exact:true}).fill(secret);await page.getByLabel('Channel Access Token ใหม่',{exact:true}).fill(token);
   await page.getByLabel('เหตุผลการเปลี่ยน',{exact:true}).fill(body.reason);await page.getByLabel('รหัสผ่านปัจจุบันของผู้ดูแล',{exact:true}).fill(password);
   await page.getByRole('checkbox').check();await page.getByRole('button',{name:'ตรวจ token และบันทึกกุญแจ LINE',exact:true}).click();
   await page.getByRole('status').filter({hasText:'บันทึกกุญแจรุ่นใหม่แล้ว'}).waitFor();
   const published=await db.platformLineCredential.findUniqueOrThrow({where:{credentialKind:'LINE_MESSAGING_API'}}),meta=(await request(base)).body;
   assert.equal(meta.version,1);assert.equal(meta.source,'DATABASE');assert.equal(meta.inboundVerifiedAt,null);assert.ok(meta.tokenValidatedAt);
   assert.equal(await page.getByLabel('Channel Secret ใหม่',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('Channel Access Token ใหม่',{exact:true}).inputValue(),'');
   assert.equal((await app.get(LineMessagingCredentialsService).get()).accessToken,token);assert.equal(process.pid,pid);
   const webhook=async(signingSecret:string,path='/v1/line/webhook')=>{const payload=' {"events": [], "destination": "synthetic"}';return fetch(`${input.origin}${path}`,{method:'POST',headers:{'content-type':'application/json','x-line-signature':createHmac('sha256',signingSecret).update(payload).digest('base64')},body:payload});};
   assert.equal((await webhook(config.lineMessagingChannelSecret!)).status,401);assert.equal((await webhook(secret)).status,200);assert.equal((await webhook(secret,'/v1/webhooks/line')).status,200);
   assert.ok((await request(base)).body.inboundVerifiedAt);
   cases.push('browser-line-messaging-publication-without-restart-old-signature-denied-new-raw-signature-observed');
   const adapter=app.get(LineReplyAdapter),beforeAdapters=calls.length;assert.equal(await adapter.sendReply('synthetic-reply',[{type:'text',text:'Synthetic reply'}]),'ok');
   assert.equal(await adapter.sendPush(`U${'1'.repeat(32)}`,[{type:'text',text:'Synthetic push'}],randomUUID()),'ok');assert.equal(await adapter.startLoadingAnimation(`U${'1'.repeat(32)}`),true);
   await (app.get(ProcessLineWebhookUseCase) as any).downloadLineMedia('synthetic-image','file','synthetic.pdf');
   for(const path of ['/v2/bot/message/reply','/v2/bot/message/push','/v2/bot/chat/loading/start','/v2/bot/message/synthetic-image/content'])assert.equal(calls.slice(beforeAdapters).find(c=>c.path===path)?.token,`Bearer ${token}`);
   cases.push('line-published-revision-consumed-by-real-reply-push-loading-media-adapters');
   const beforeQueue=calls.length;
   await worker.execute(input.companyId,delivery.id);
   const sent=await db.notificationDelivery.findUniqueOrThrow({where:{id:delivery.id}}),queuedPush=calls.slice(beforeQueue);
   assert.equal(sent.status,'SENT');assert.equal(sent.attemptCount,2);assert.equal(queuedPush.length,1);
   assert.equal(queuedPush[0]!.token,`Bearer ${token}`);assert.equal(queuedPush[0]!.retryKey,oldQueueCall.retryKey);assert.equal(queuedPush[0]!.body,oldQueueCall.body);
   assert.equal(JSON.parse(queuedPush[0]!.body).to,initialIdentity[0]!.providerUserId);assert.ok(queuedPush[0]!.body.includes(queued.body));
   await worker.execute(input.companyId,delivery.id);assert.equal(calls.length,beforeQueue+1);
   const foreign=await db.notificationDelivery.create({data:{companyId:input.companyId,recipientId:delivery.recipientId,channel:'LINE'}});
   await db.externalIdentity.update({where:{id:initialIdentity[0]!.id},data:{providerChannelId:'synthetic-foreign-channel'}});
   try{await worker.execute(input.companyId,foreign.id);assert.equal(calls.length,beforeQueue+1);
     const skipped=await db.notificationDelivery.findUniqueOrThrow({where:{id:foreign.id}});assert.equal(skipped.status,'SKIPPED');assert.equal(skipped.errorCode,'NO_LINE_DELIVERY_TARGET');
   }finally{await db.externalIdentity.update({where:{id:initialIdentity[0]!.id},data:{providerChannelId:initialIdentity[0]!.providerChannelId,updatedAt:initialIdentity[0]!.updatedAt}});}
   cases.push('line-prepublication-queued-worker-current-token-original-recipient-retry-key-no-resend-or-cross-channel-fallback');
   const contenders=[{...body,expectedVersion:1,rotationId:randomUUID()},{...body,expectedVersion:1,rotationId:randomUUID()}];
   let arrivals=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
   providerHook=async()=>{if(++arrivals===2)release();await barrier;};
   const concurrent=await Promise.all(contenders.map(candidate=>put(candidate)));providerHook=undefined;
   assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,409]);assert.equal(arrivals,2);
   const winner=concurrent.findIndex(result=>result.status===200),replacement=contenders[winner]!,saved=concurrent[winner]!,count=calls.length;
   assert.deepEqual(await put(replacement),saved);assert.equal(calls.length,count);assert.equal((await put({...replacement,channelSecret:'b'.repeat(32)})).status,409);
   assert.equal((await request(base)).body.inboundVerifiedAt,null);
   await app.get(LineMessagingCredentialsService).observeSignature({source:'DATABASE',version:1});assert.equal((await request(base)).body.inboundVerifiedAt,null);
   cases.push('line-rotation-concurrent-save-one-publication-same-command-recovery-stale-save-and-observation-fences');
   // A provider read is the fault boundary; revoke the operator before the commit-time recheck.
   const version2=await db.platformLineCredential.findUniqueOrThrow({where:{id:published.id}});
   providerHook=async()=>{await db.membershipRole.deleteMany({where:{membershipId:input.membershipId,roleId:admin.id}});};
   // Keep the real ten-attempt control budget for this role-race scenario.
   const budget=await app.get((await import('../common/security/redis-rate-limit.service')).RedisRateLimitService).inspect('line-credential-publication',input.userId,10,300);
   assert.ok(budget.count<10,'keep the real publication budget');{
     assert.equal((await put({...replacement,expectedVersion:2,rotationId:randomUUID()})).status,403);
     assert.equal((await db.platformLineCredential.findUniqueOrThrow({where:{id:published.id}})).secretVersion,2);
     cases.push('line-role-revoked-during-provider-read-cannot-publish');
   }
   providerHook=undefined;
   await db.membershipRole.upsert({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:admin.id}},update:{},create:{membershipId:input.membershipId,roleId:admin.id}});
   await db.platformLineCredential.update({where:{id:published.id},data:{encryptedSecretJson:'synthetic corrupt storage'}});
   assert.equal((await request(base)).body.runtimeStatus,'UNAVAILABLE');assert.equal((await webhook(secret)).status,503);assert.equal(await adapter.sendReply('synthetic-reply',[{type:'text',text:'Must not send'}]),'failed_other');
   for(const path of ['/v1/auth/line/link-page','/v1/auth/line/link-page/employee']){
     const linkPage=await fetch(`${input.origin}${path}`);assert.equal(linkPage.status,200);assert.ok((await linkPage.text()).includes('data-oa-add-url=""'));
   }
   await db.platformLineCredential.update({where:{id:published.id},data:{encryptedSecretJson:version2.encryptedSecretJson}});
   cases.push('line-corrupt-published-credential-blocks-inbound-outbound-without-environment-fallback');
   await page.getByRole('button',{name:'โหลดสถานะ LINE ล่าสุด',exact:true}).click();await page.getByRole('region',{name:'สถานะ LINE ปัจจุบัน'}).getByText(/รุ่นที่บันทึก: 2/).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.screenshot({path:`${browser.evidenceDir}/line-runtime-credentials-mobile.png`,fullPage:true});
   assert.doesNotMatch(JSON.stringify(await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}))),new RegExp(token));
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'การเชื่อมต่อ LINE ของระบบ',exact:true}).waitFor();
   assert.equal(await page.getByLabel('Channel Secret ใหม่',{exact:true}).inputValue(),'');
   const logs=await db.auditLog.findMany({where:{actorUserId:input.userId,action:'system.shared_line_credential.published'}});assert.equal(logs.length,2);
   assert.ok(!JSON.stringify([meta,logs]).includes(secret));assert.ok(!JSON.stringify([meta,logs]).includes(token));
   assert.deepEqual(await db.externalIdentity.findMany({where:{userId:input.userId},orderBy:{id:'asc'}}),initialIdentity);
   assert.deepEqual(await db.billingInvoice.findMany({orderBy:{id:'asc'}}),initialInvoices);assert.equal(await db.billingReceiptGrant.count({where:{companyId:input.companyId}}),0);assert.equal(process.pid,pid);
   cases.push('browser-line-settings-reload-safe-metadata-audit-storage-and-unchanged-identity-money-quota');
   return cases;
 }finally{
   await db.notificationEvent.deleteMany({where:{id:queued.id}});
   input.transport(undefined);await db.platformLineCredential.deleteMany({where:{credentialKind:'LINE_MESSAGING_API'}});
   await db.membershipRole.deleteMany({where:{membershipId:input.membershipId,roleId:admin.id}});
   if(!existingGrant)await db.rolePermission.deleteMany({where:{roleId:admin.id,permissionId:permission.id}});
   await db.userCredential.deleteMany({where:{id:credential.id}});await db.companyPlanTerm.update({where:{companyId:input.companyId},data:{termEndsAt:term.termEndsAt}});
 }
}
