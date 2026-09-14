import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../common/database/prisma.service';
import { FEATURE_PACKAGE_PRESETS } from '@watchdog-bms/contracts';
import { ROLE_GRANTS } from '../modules/auth/permission-registry';
import { EmailDeliveryService } from '../modules/auth/application/email-delivery.service';
import { SubmitCompanySignupUseCase, type MxResolver } from '../modules/external-signup/application/submit-company-signup.use-case';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../modules/data-model-core/domain/ports/attachment-storage.port';
import { LocalStorageAdapter } from '../modules/data-model-core/infrastructure/storage/local-storage.adapter';
import type { startBillingBrowser } from './billing-browser-smoke';

/** Only DNS and provider transport are simulated; the selected object store uses real local bytes. */
export async function checkSignupJourney(input:{app:INestApplication;prisma:PrismaService;origin:string;userId:string;membershipId:string;
  request:(path:string,method?:string,body?:unknown,extra?:Record<string,string>)=>Promise<{status:number;body:any}>;
  drain:()=>Promise<{status:number;body:any}>;browser:Awaited<ReturnType<typeof startBillingBrowser>>;
  transport:(hook:((url:URL,init?:RequestInit)=>Response|undefined)|undefined)=>void}) {
  const {app,prisma,request,browser}=input,db=prisma.client,tag=randomUUID().replaceAll('-',''),mail:Array<{input:any;result:any}>=[];
  const companyName=`Synthetic signup ${tag}`,username=`signup.${tag.slice(0,16)}`,recipient=`signup-${tag}@example.test`,password=`Signup!${tag}`;
  const member=await db.companyMembership.findUniqueOrThrow({where:{id:input.membershipId}}),term=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId:member.companyId}});
  const mx=app.get(SubmitCompanySignupUseCase) as unknown as {mxResolver:MxResolver},oldMx=mx.mxResolver;
  const storage=app.get<AttachmentStoragePort>(ATTACHMENT_STORAGE),local=app.get(LocalStorageAdapter),restoreStorage:Array<()=>void>=[];
  const createdRoles:string[]=[],memberRoles:string[]=[];let signupId:string|undefined,createdCompany:string|undefined,createdUser:string|undefined;
  const gateKey={gateKey:'expenses',routeKey:'DEFAULT'},oldGate=await db.featureLaunchGate.findUnique({where:{gateKey_routeKey:gateKey}});let changedGate=false;
  // The local reverse-proxy peer is trusted; each run represents a different synthetic visitor.
  // Keep real Redis limits enabled without sharing a previous run's public-signup IP bucket.
  const visitorIp=`2001:db8:${tag.slice(0,24).match(/.{4}/g)!.join(':')}`;
  const customer=await browser.page.context().browser()!.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-forwarded-for':visitorIp}}),page=await customer.newPage();
  const requestUrls:string[]=[],checkedProofs:string[]=[];
  page.on('request',r=>{requestUrls.push(r.url());if(r.url().endsWith('/signup-claims/info'))checkedProofs.push(r.postDataJSON()?.token);});
  const reply=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  const pub=async(path:string,body?:unknown)=>{const res=await fetch(`${input.origin}/v1/public/${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-forwarded-for':visitorIp},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};};
  try {
    await db.companyPlanTerm.update({where:{companyId:member.companyId},data:{termEndsAt:new Date(Date.now()+86400000)}});
    mx.mxResolver=async()=>[{exchange:'synthetic.example.test',priority:10}];
    for(const name of ['createUploadIntent','createDownloadUrl','putObject','deleteObject','getObjectMetadata','getObject','getExactObjectVersionInventory'] as const){
      const original=storage[name];restoreStorage.push(()=>{(storage as any)[name]=original;});(storage as any)[name]=local[name].bind(local);
    }
    for(const [key,grants] of [['OWNER',ROLE_GRANTS.OWNER!],['SYSTEM_ADMIN',['system.company_onboarding.read','system.company_onboarding.create']]] as const){
      let role=await db.role.findUnique({where:{scopeKey_key:{scopeKey:'system',key}}});
      if(!role){
        await db.permission.createMany({data:grants.map(key=>({key,description:key})),skipDuplicates:true});
        const permissions=await db.permission.findMany({where:{key:{in:[...grants]}}});
        role=await db.role.create({data:{key,scopeKey:'system',isSystem:true,name:key,permissions:{create:permissions.map(p=>({permissionId:p.id}))}}});createdRoles.push(role.id);
      }
      if(key==='SYSTEM_ADMIN'){await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:role.id}});memberRoles.push(role.id);}
    }
    let loseFirst=true;
    input.transport((url,init)=>{
      if(url.origin==='https://synthetic-ai.example.test')return new Response(JSON.stringify({message:'Synthetic OCR unavailable'}),{status:503,headers:{'content-type':'application/json'}});
      if(url.origin!=='https://api.postmarkapp.com')return;
      assert.equal(new Headers(init?.headers).get('X-Postmark-Server-Token'),'POSTMARK_API_TEST');
      if(url.pathname==='/email'){
        const payload=JSON.parse(String(init?.body));assert.equal(payload.Tag,'account_claim');assert.equal(payload.To,recipient);
        assert.equal(payload.TrackOpens,false);assert.equal(payload.TrackLinks,'None');assert.equal(payload.Attachments,undefined);
        const result={MessageID:randomUUID(),SubmittedAt:new Date().toISOString(),ErrorCode:0};mail.push({input:payload,result});
        if(loseFirst){loseFirst=false;throw new Error('Synthetic accepted claim response lost');}return reply(result);
      }
      assert.equal(url.pathname,'/messages/outbound');
      const matches=mail.filter(m=>m.input.Metadata.sendAttemptId===url.searchParams.get('metadata_sendAttemptId'));
      return reply({TotalCount:matches.length,Messages:matches.map(m=>({MessageID:m.result.MessageID,MessageStream:m.input.MessageStream,Metadata:m.input.Metadata,Recipients:[m.input.To],ReceivedAt:m.result.SubmittedAt}))});
    });
    await page.goto(`${browser.origin}/signup`,{waitUntil:'domcontentloaded'});
    await page.getByLabel('ชื่อร้าน หรือบริษัท',{exact:true}).fill(companyName);await page.getByLabel('ชื่อ',{exact:true}).fill('สมชาย');
    await page.getByLabel('นามสกุล',{exact:true}).fill('ทดสอบ');await page.locator('input[name="contactEmail"]').fill(recipient);
    await page.locator('input[name="phoneNumber"]').fill('0812345678');
    const submitted=page.waitForResponse(r=>r.url().endsWith('/public/company-signups')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'ส่งคำขอสมัคร',exact:true}).click();const submission=await submitted;assert.equal(submission.status(),202);
    signupId=(await submission.json()).requestId;assert.ok(signupId);
    const signup=await db.companySignupRequest.findUniqueOrThrow({where:{id:signupId}});assert.equal(signup.state,'PENDING_REVIEW');assert.equal(signup.companyId,null);assert.equal(mail.length,0);
    const duplicate=await pub('company-signups',submission.request().postDataJSON());assert.equal(duplicate.status,202);assert.equal(duplicate.body.requestId,signupId);
    const approved=await request(`/v1/system/signup-requests/${signupId}/decision`,'POST',{action:'APPROVE',businessCategory:'OTHER'});assert.equal(approved.status,200);assert.equal(approved.body.state,'EMAIL_PENDING');
    assert.equal((await input.drain()).status,201);assert.equal(mail.length,1);
    const attempt=await db.emailSendAttempt.findUniqueOrThrow({where:{id:mail[0]!.input.Metadata.sendAttemptId}});assert.equal(attempt.status,'UNKNOWN');
    const originalProofs=await db.accountClaimToken.findMany({where:{signupRequestId:signupId}});assert.equal(originalProofs.length,1);
    await db.emailSendAttempt.update({where:{id:attempt.id},data:{nextRecoveryAt:new Date(0)}});
    await app.get(EmailDeliveryService).reconcileUnknown(attempt.id);
    await db.outboxEvent.updateMany({where:{aggregateId:signupId,eventType:'email.account_claim.requested'},data:{availableAt:new Date(0)}});
    await input.drain();assert.equal(mail.length,1);assert.deepEqual(await db.accountClaimToken.findMany({where:{signupRequestId:signupId}}),originalProofs);
    const history=await request(`/v1/system/signup-requests/${signupId}/claim-deliveries`);assert.equal(history.status,200);assert.equal(history.body.items[0].state,'ACCEPTED');
    assert.equal((await db.companySignupRequest.findUniqueOrThrow({where:{id:signupId}})).companyId,null);
    const mailUrl=(index:number)=>new URL(String(mail[index]!.input.TextBody).match(/https:\/\/[^\s]+\/claim-account\?[^\s]+/)![0]);
    const expiredUrl=mailUrl(0),expiredRaw=new URLSearchParams(expiredUrl.hash.slice(1)).get('token')!;
    assert.ok(expiredRaw);assert.ok(!JSON.stringify(originalProofs).includes(expiredRaw));
    const activationWindow=(await db.companySignupRequest.findUniqueOrThrow({where:{id:signupId}})).claimWindowStartedAt;
    await db.accountClaimToken.update({where:{id:originalProofs[0]!.id},data:{expiresAt:new Date(0)}});
    await page.goto(`${browser.origin}${expiredUrl.pathname}${expiredUrl.search}${expiredUrl.hash}`,{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'ลิงก์ไม่พร้อมใช้งาน',exact:true}).waitFor();
    await page.getByRole('link',{name:'ไปหน้าตรวจสอบสถานะคำขอ',exact:true}).click();await page.waitForURL(`**/signup/status/${signupId}`);
    const resend=page.waitForResponse(r=>r.url().endsWith(`/company-signups/${signupId}/resend-claim`));
    await page.getByRole('button',{name:'ขอลิงก์ตั้งรหัสผ่านใหม่',exact:true}).click();assert.equal((await resend).status(),202);
    await input.drain();assert.equal(mail.length,2);
    const resent=await db.companySignupRequest.findUniqueOrThrow({where:{id:signupId}});assert.deepEqual(resent.claimWindowStartedAt,activationWindow);assert.equal(resent.companyId,null);
    assert.equal((await pub('signup-claims/info',{token:expiredRaw})).body.valid,false);
    const claimUrl=mailUrl(1),raw=new URLSearchParams(claimUrl.hash.slice(1)).get('token')!;assert.notEqual(raw,expiredRaw);
    assert.equal(claimUrl.searchParams.has('token'),false);
    assert.ok(requestUrls.every(url=>!url.includes(expiredRaw)));
    // Already-issued legacy mail still opens, then reloads without sending its proof in the URL.
    const legacy=new URL(expiredUrl);legacy.hash='';legacy.searchParams.set('token',expiredRaw);
    await page.goto(`${browser.origin}${legacy.pathname}${legacy.search}`,{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'ลิงก์ไม่พร้อมใช้งาน',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.has('token'),false);
    const sinceLegacy=requestUrls.length;await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'ลิงก์ไม่พร้อมใช้งาน',exact:true}).waitFor();
    assert.ok(requestUrls.slice(sinceLegacy).every(url=>!url.includes(expiredRaw)));
    await page.goto(`${browser.origin}${claimUrl.pathname}${claimUrl.search}${claimUrl.hash}`,{waitUntil:'domcontentloaded'});
    await page.locator('input[name="username"]').waitFor();await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('input[name="username"]').fill(username);assert.equal(await db.accountClaimToken.count({where:{signupRequestId:signupId,usedAt:{not:null}}}),0);
    assert.ok(checkedProofs.includes(raw));assert.ok(requestUrls.every(url=>!url.includes(raw)));
    await page.locator('input[name="new-password"]').fill(password);await page.locator('input[name="confirm-password"]').fill(password);
    const claimed=page.waitForResponse(r=>r.url().endsWith('/api/auth/signup-claim'));await page.locator('form button[type="submit"]').click();const claimResponse=await claimed;
    assert.equal(claimResponse.status(),200);await page.waitForURL('**/signup/welcome');
    assert.ok((await customer.cookies(browser.origin)).some(cookie=>cookie.name.startsWith('watchdog_token')&&cookie.httpOnly),'claim BFF must establish an HttpOnly session');
    const after=await db.companySignupRequest.findUniqueOrThrow({where:{id:signupId}});createdCompany=after.companyId??undefined;assert.ok(createdCompany);createdUser=after.ownerUserId??undefined;
    assert.equal(after.companyId,createdCompany);assert.equal(after.pendingPasswordHash,null);assert.equal(after.state,'LINE_LINK_PENDING');assert.ok(createdUser);
    const newTerm=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId:createdCompany}});
    assert.equal(newTerm.tierKey,'FREE_TRIAL_15');assert.equal(newTerm.monthlySlipLimit,15);assert.equal(newTerm.branchLimit,1);assert.equal(newTerm.employeeLimit,2);
    assert.ok(newTerm.termEndsAt.getTime()-newTerm.termStartAt.getTime()>=29*86400000);
    const enabled=await db.companyFeatureEntitlement.findMany({where:{companyId:createdCompany,enabled:true}});
    assert.deepEqual(enabled.map(r=>r.featureKey).sort(),[...FEATURE_PACKAGE_PRESETS.starter.featureKeys].sort());
    assert.equal(await db.externalIdentity.count({where:{userId:createdUser,provider:'LINE'}}),0);
    assert.equal((await pub('signup-claims/info',{token:raw})).body.valid,false);
    await page.getByRole('heading',{name:`${companyName} พร้อมใช้งานแล้ว`,exact:true}).waitFor();
    await page.getByRole('link',{name:'ไว้ทีหลัง — เข้าใช้งานเลย',exact:true}).click();
    await page.waitForURL('**/legal-acceptance?**');
    for(const name of ['termsAccepted','privacyAcknowledged','deletionAcknowledged'])await page.locator(`input[name="${name}"]`).check();
    await page.getByRole('button',{name:/ยืนยันและเริ่มใช้งาน|Confirm and start/i}).click();
    await page.waitForURL(url=>url.pathname==='/signup/welcome'||url.pathname.startsWith(`/companies/${createdCompany}/`));
    if(new URL(page.url()).pathname==='/signup/welcome')await page.getByRole('link',{name:'ไว้ทีหลัง — เข้าใช้งานเลย',exact:true}).click();
    await page.waitForURL(`**/companies/${createdCompany}/**`);
    await page.goto(`${browser.origin}/companies/${createdCompany}/expenses/upload`,{waitUntil:'domcontentloaded'});
    const file=await sharp({create:{width:32,height:32,channels:3,background:'#ffffff'}}).png().toBuffer();
    await page.locator('fieldset:not([disabled]) input[type="file"]').first().setInputFiles({name:'synthetic-receipt.png',mimeType:'image/png',buffer:file});
    await db.featureLaunchGate.upsert({where:{gateKey_routeKey:gateKey},create:{...gateKey,state:'CLOSED'},update:{state:'CLOSED'}});changedGate=true;
    const denied=page.waitForResponse(r=>r.url().endsWith('/expenses/receipt-uploads'));
    await page.getByRole('button',{name:'ให้ AI อ่านใบเสร็จ',exact:true}).click();assert.equal((await denied).status(),403);
    assert.equal(await db.expenseRecord.count({where:{companyId:createdCompany}}),0);
    const generation=(oldGate?.generation??0)+1,seq=(oldGate?.lastSeq??0)+1;
    await db.featureLaunchGate.update({where:{gateKey_routeKey:gateKey},data:{state:'OPEN',generation,lastSeq:seq}});
    await db.featureLaunchGateTransition.create({data:{...gateKey,seq,generation,commandId:tag,action:'OPEN',actorUserId:input.userId,payloadFingerprint:tag,
      ...resolveDeploymentIdentity(process.env),expectedGeneration:generation-1,routeClass:'ORDINARY',reason:'Synthetic local signup fixture'}});
    const uploaded=page.waitForResponse(r=>/\/receipt-uploads\/[^/]+\/complete$/.test(new URL(r.url()).pathname));
    const uploadIntent=page.waitForResponse(r=>r.url().endsWith('/expenses/receipt-uploads'));
    await page.getByRole('button',{name:'ให้ AI อ่านใบเสร็จ',exact:true}).click();assert.equal((await uploadIntent).status(),201);assert.equal((await uploaded).status(),201);
    const receipt=await db.expenseRecord.findFirstOrThrow({where:{companyId:createdCompany}});
    const attachment=await db.attachmentObject.findFirstOrThrow({where:{companyId:createdCompany,status:'ACTIVE'}});
    assert.equal(attachment.uploadedByUserId,createdUser);assert.deepEqual((await local.getObject({bucket:attachment.bucket,objectKey:attachment.objectKey})).bytes,file);
    await page.waitForURL(`**/companies/${createdCompany}/expenses/${receipt.id}`);
    const receiptButton=()=>page.getByRole('button',{name:/^synthetic-receipt\.png/});
    await receiptButton().waitFor();
    assert.equal(await receiptButton().isEnabled(),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.screenshot({path:`${browser.evidenceDir}/signup-first-receipt-mobile.png`});
    const receiptUrl=page.url(),session=await db.authSession.findFirstOrThrow({where:{userId:createdUser,status:'ACTIVE'}});
    assert.equal((await customer.request.post(`${browser.origin}/api/auth/logout`,{headers:{Origin:browser.origin}})).status(),204);
    assert.notEqual((await db.authSession.findUniqueOrThrow({where:{id:session.id}})).status,'ACTIVE');
    assert.equal((await customer.cookies(browser.origin)).some(cookie=>cookie.name.startsWith('watchdog_token')),false);
    await page.goto(receiptUrl,{waitUntil:'domcontentloaded'});await page.waitForURL('**/login?**');
    await page.locator('#login-identifier').fill(username);await page.locator('#login-password').fill(password);
    await page.getByRole('button',{name:/^(เข้าสู่ระบบ|Sign in)$/i}).click();await page.waitForURL(receiptUrl);
    await receiptButton().waitFor();assert.equal(await receiptButton().isEnabled(),true);
    assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId:createdCompany}}),newTerm);
    assert.equal(await db.expenseRecord.count({where:{companyId:createdCompany}}),1);
    assert.equal(await db.externalIdentity.count({where:{userId:createdUser,provider:'LINE'}}),0);
    assert.ok((await db.authSession.findFirstOrThrow({where:{userId:createdUser,status:'ACTIVE'}})).id!==session.id);
    await page.screenshot({path:`${browser.evidenceDir}/signup-returning-receipt-mobile.png`});
    return ['signup-web-real-form-idempotent-manual-review-no-early-company','signup-postmark-unknown-original-lookup-replay-no-extra-proof-or-send',
      'signup-single-use-claim-real-BFF-session-seven-menus-trial15-without-line','browser-signup-claim-welcome-skip-line-legal-and-receipt-entry-mobile',
      'signup-first-receipt-closed-gate-retry-real-stored-bytes-and-unavailable-extraction-recovery',
      'signup-logout-revokes-session-real-login-returns-to-saved-receipt-with-unchanged-trial',
      'signup-expired-link-status-resend-new-proof-no-window-extension-or-early-provision',
      'signup-fragment-proof-absent-from-request-URLs-real-POST-and-legacy-link-reload'];
  } catch(error) {
    process.stderr.write(`Signup journey failure: ${error instanceof Error?error.message:'unknown'}\n`);
    await page.screenshot({path:`${browser.evidenceDir}/signup-journey-failure.png`}).catch(()=>{});throw error;
  } finally {
    input.transport(undefined);mx.mxResolver=oldMx;restoreStorage.forEach(fn=>fn());await customer.close();
    if(changedGate){await db.featureLaunchGateTransition.deleteMany({where:{...gateKey,commandId:tag}});
      if(oldGate)await db.featureLaunchGate.update({where:{gateKey_routeKey:gateKey},data:{state:oldGate.state,generation:oldGate.generation,lastSeq:oldGate.lastSeq}});
      else await db.featureLaunchGate.delete({where:{gateKey_routeKey:gateKey}});}
    await db.companyPlanTerm.update({where:{companyId:member.companyId},data:{termEndsAt:term.termEndsAt}});
    if(signupId){const row=await db.companySignupRequest.findUnique({where:{id:signupId}});createdCompany??=row?.companyId??undefined;createdUser??=row?.ownerUserId??undefined;
      await db.outboxEvent.deleteMany({where:{aggregateId:signupId}});await db.emailSendAttempt.deleteMany({where:{signupRequestId:signupId}});await db.companySignupRequest.deleteMany({where:{id:signupId}});}
    if(createdCompany){for(const attachment of await db.attachmentObject.findMany({where:{companyId:createdCompany,storageProvider:'local'}}))await local.deleteObject({bucket:attachment.bucket,objectKey:attachment.objectKey});
      await db.companyOnboardingRun.deleteMany({where:{companyId:createdCompany}});await db.company.delete({where:{id:createdCompany}});}
    if(createdUser)await db.user.delete({where:{id:createdUser}});
    await db.membershipRole.deleteMany({where:{membershipId:input.membershipId,roleId:{in:memberRoles}}});await db.role.deleteMany({where:{id:{in:createdRoles}}});
  }
}
