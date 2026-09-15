import { lineMessagingCredentialsFixture } from '../common/config/line-messaging-credentials.fixture';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import type { PrismaService } from '../common/database/prisma.service';
import { ConfirmEmailVerificationUseCase } from '../modules/auth/application/use-cases/confirm-email-verification.use-case';
import { ResendEmailVerificationUseCase } from '../modules/auth/application/use-cases/resend-email-verification.use-case';
import { hashToken } from '../modules/auth/domain/logic/secure-token.logic';
import type { startBillingBrowser } from './billing-browser-smoke';

/** Real HTTP/PG/browser; only Postmark/LINE transport and an explicit service outage are simulated. */
export async function checkEmailVerification(input:{app:INestApplication;prisma:PrismaService;userId:string;membershipId:string;
  request:(path:string,method?:string,body?:unknown,extra?:Record<string,string>)=>Promise<{status:number;body:any}>;
  browser:Awaited<ReturnType<typeof startBillingBrowser>>;
  transport:(hook?:((url:URL,init?:RequestInit)=>Response|undefined))=>void}) {
  const {app,prisma,browser}=input,db=prisma.client,tag=randomUUID().replaceAll('-',''),mail:any[]=[];
  const visitorIp=`2001:db8:${tag.slice(0,4)}:${tag.slice(4,8)}::3`;
  const request:typeof input.request=(path,method,body,extra)=>input.request(path,method,body,{'x-forwarded-for':visitorIp,...extra});
  const user=await db.user.findUniqueOrThrow({where:{id:input.userId}}),member=await db.companyMembership.findUniqueOrThrow({where:{id:input.membershipId},include:{roles:true}});
  const term=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId:member.companyId}}),roleId=member.roles[0]!.roleId;
  const addedPermissions:string[]=[];
  const service=app.get(ConfirmEmailVerificationUseCase),originalExecute=service.execute,subjectIds:string[]=[];
  const page=browser.page,urls:string[]=[],confirmRequests:string[]=[];
  page.on('request',r=>{urls.push(r.url());if(r.url().endsWith('/auth/account/email/verify'))confirmRequests.push(r.postDataJSON()?.token);});
  const response=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  const lastProof=()=>{const text=String(mail.at(-1)?.TextBody),found=text.match(/https:\/\/[^\s]+\/verify-email#[^\s]+/);assert.ok(found);const url=new URL(found[0]);return {url,raw:new URLSearchParams(url.hash.slice(1)).get('token')!};};
  const open=async(raw:string,legacy=false)=>{await page.goto(`${browser.origin}/verify-email${legacy?'?':'#'}token=${encodeURIComponent(raw)}`,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'ยืนยันอีเมลนี้',exact:true}).waitFor();};
  const confirm=async()=>{const received=page.waitForResponse(r=>r.url().endsWith('/auth/account/email/verify')&&r.request().method()==='POST');await page.getByRole('button',{name:/^(ยืนยันอีเมลนี้|ลองยืนยันอีกครั้ง)$/}).click();return received;};
  const pending=async(raw:string)=>db.emailVerificationToken.findUniqueOrThrow({where:{tokenHash:hashToken(raw)}});
  const requestEmail=async(suffix:string)=>{const email=`verify-${tag}-${suffix}@example.test`;const result=await request('/v1/auth/account/email','POST',{newEmail:email});assert.equal(result.status,202);return email;};
  try {
    await page.setViewportSize({width:390,height:844});await page.context().setExtraHTTPHeaders({'x-forwarded-for':visitorIp});
    await db.companyPlanTerm.update({where:{companyId:member.companyId},data:{termEndsAt:new Date(Date.now()+86400000)}});
    for(const key of ['company.setup.read','account.password.change']){const permission=await db.permission.upsert({where:{key},update:{},create:{key,description:key}});
      if(!await db.rolePermission.findUnique({where:{roleId_permissionId:{roleId,permissionId:permission.id}}})){await db.rolePermission.create({data:{roleId,permissionId:permission.id}});addedPermissions.push(permission.id);}}
    input.transport((url,init)=>{
      if(url.origin==='https://api.line.me')return response({});
      if(url.origin!=='https://api.postmarkapp.com')return;
      assert.equal(url.pathname,'/email');const body=JSON.parse(String(init?.body));assert.equal(body.Tag,'email_verification');
      assert.match(body.To,new RegExp(`^verify-${tag}-`));assert.equal(body.TrackOpens,false);assert.equal(body.TrackLinks,'None');mail.push(body);
      return response({ErrorCode:0,MessageID:randomUUID(),SubmittedAt:new Date().toISOString()});
    });
    const otherPurpose=`reset-only-${tag}`;await db.passwordResetToken.create({data:{userId:user.id,tokenHash:hashToken(otherPurpose),expiresAt:new Date(Date.now()+60000)}});
    assert.equal((await request('/v1/auth/account/email/verify','POST',{token:otherPurpose})).status,403);
    assert.equal((await db.passwordResetToken.findUniqueOrThrow({where:{tokenHash:hashToken(otherPurpose)}})).status,'PENDING');
    const email=await requestEmail('first'),first=lastProof();await open(first.raw);await page.reload();await page.getByRole('button',{name:'ยืนยันอีเมลนี้',exact:true}).waitFor();
    assert.equal(confirmRequests.length,0);assert.equal((await pending(first.raw)).status,'PENDING');assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).email,user.email);
    service.execute=async()=>{throw new ServiceUnavailableException('Synthetic verification service outage');};
    assert.equal((await confirm()).status(),503);await page.locator('main').getByRole('alert').getByText(/ยังไม่ทราบผล/).waitFor();assert.equal((await pending(first.raw)).status,'PENDING');
    service.execute=originalExecute;assert.equal((await confirm()).status(),200);await page.getByRole('heading',{name:'ยืนยันอีเมลสำเร็จ',exact:true}).waitFor();assert.equal((await pending(first.raw)).status,'USED');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'verification fits mobile width');
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.locator('main').screenshot({path:`${browser.evidenceDir}/email-verification-success-mobile.png`});
    assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).email,email);assert.ok(!urls.some(url=>url.includes(first.raw)));
    assert.equal((await request('/v1/auth/account/email/verify','POST',{token:first.raw})).status,403);
    const nextEmail=await requestEmail('next'),old=lastProof();assert.equal((await request('/v1/auth/account/email/resend','POST',{})).status,202);const next=lastProof();assert.notEqual(old.raw,next.raw);
    assert.equal((await pending(old.raw)).status,'REVOKED');assert.equal((await request('/v1/auth/account/email/verify','POST',{token:old.raw})).status,403);
    await open(next.raw);service.execute=async args=>{await originalExecute.call(service,args);throw new ServiceUnavailableException('Synthetic response lost after commit');};
    assert.equal((await confirm()).status(),503);service.execute=originalExecute;await page.locator('main').getByRole('alert').getByText(/ยังไม่ทราบผล/).waitFor();
    assert.equal((await pending(next.raw)).status,'USED');assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).email,nextEmail);
    await page.getByRole('link',{name:'ไปหน้าเข้าสู่ระบบ',exact:true}).click();
    // /login is transient for this signed-in account. Let its server/client redirect finish
    // before navigating again, or that pending redirect can overwrite the profile visit in CI.
    await page.waitForURL(`${browser.origin}/companies/${member.companyId}/dashboard`);
    await page.goto(`${browser.origin}/companies/${member.companyId}/settings/profile`,{waitUntil:'domcontentloaded'});await page.getByText(nextEmail,{exact:true}).first().waitFor();
    assert.equal((await request('/v1/auth/account/security')).body.email,nextEmail);
    await open(next.raw);assert.equal((await confirm()).status(),403);await page.locator('main').getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'ลองยืนยันอีกครั้ง',exact:true}).count(),0);
    await page.goto(`${browser.origin}/verify-email?token=one#token=two`,{waitUntil:'domcontentloaded'});await page.locator('main').getByRole('alert').waitFor();assert.equal(await page.locator('main').getByRole('button').count(),0);
    const legacyRaw=`legacy-${tag}`;await db.emailVerificationToken.create({data:{userId:user.id,newEmail:nextEmail,tokenHash:hashToken(legacyRaw),expiresAt:new Date(Date.now()+60000)}});
    await open(legacyRaw,true);assert.ok(!new URL(page.url()).searchParams.has('token'));const afterLegacy=urls.length;await page.reload();await page.getByRole('button',{name:'ยืนยันอีเมลนี้',exact:true}).waitFor();
    assert.ok(!urls.slice(afterLegacy).some(url=>url.includes(legacyRaw)));assert.equal((await pending(legacyRaw)).status,'PENDING');
    await db.emailVerificationToken.update({where:{tokenHash:hashToken(legacyRaw)},data:{expiresAt:new Date(0)}});assert.equal((await confirm()).status(),403);await page.locator('main').getByRole('alert').waitFor();
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.locator('main').screenshot({path:`${browser.evidenceDir}/email-verification-recovery-mobile.png`});

    // Mutate after the real precheck but before entering the real PostgreSQL transaction.
    const delayed=(before:()=>Promise<void>)=>({client:new Proxy(db,{get(target,key){if(key==='$transaction')return async(fn:any)=>{await before();return target.$transaction(fn);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}})}) as unknown as PrismaService;
    for(const fault of ['suspend','expire','revoke','duplicate'] as const){
      const id=`verify-race-${tag}-${fault}`,raw=`proof-${id}`,newEmail=`${id}@example.test`;subjectIds.push(id);
      await db.user.create({data:{id,status:'ACTIVE',displayName:'Synthetic verification race'}});
      await db.emailVerificationToken.create({data:{userId:id,newEmail,tokenHash:hashToken(raw),expiresAt:new Date(Date.now()+60000)}});
      const before=async()=>{
        if(fault==='suspend')await db.user.update({where:{id},data:{status:'SUSPENDED'}});
        if(fault==='expire')await db.emailVerificationToken.update({where:{tokenHash:hashToken(raw)},data:{expiresAt:new Date(0)}});
        if(fault==='revoke')await db.emailVerificationToken.update({where:{tokenHash:hashToken(raw)},data:{status:'REVOKED'}});
        if(fault==='duplicate'){const other=`${id}-other`;subjectIds.push(other);await db.user.create({data:{id:other,displayName:'Synthetic contender',email:newEmail}});}
      };
      await assert.rejects(new ConfirmEmailVerificationUseCase(lineMessagingCredentialsFixture(undefined), delayed(before)).execute({token:raw}),error=>(error as any).getStatus?.()===(fault==='duplicate'?409:403));
      assert.equal((await db.user.findUniqueOrThrow({where:{id}})).email,null);assert.notEqual((await pending(raw)).status,'USED');
    }
    const raceId=`verify-double-${tag}`,raceRaw=`proof-${raceId}`;subjectIds.push(raceId);await db.user.create({data:{id:raceId,displayName:'Synthetic double confirmation'}});
    await db.emailVerificationToken.create({data:{userId:raceId,newEmail:`${raceId}@example.test`,tokenHash:hashToken(raceRaw),expiresAt:new Date(Date.now()+60000)}});
    const doubleService=new ConfirmEmailVerificationUseCase(lineMessagingCredentialsFixture(undefined), prisma),double=await Promise.allSettled([doubleService.execute({token:raceRaw}),doubleService.execute({token:raceRaw})]);
    assert.equal(double.filter(result=>result.status==='fulfilled').length,1);assert.equal((await pending(raceRaw)).status,'USED');
    assert.equal((double.find(result=>result.status==='rejected') as PromiseRejectedResult).reason.getStatus(),403);
    for(const fault of ['new-request','confirmed','suspend'] as const){
      const id=`verify-resend-${tag}-${fault}`,raw=`proof-${id}`;subjectIds.push(id);await db.user.create({data:{id,displayName:'Synthetic resend race'}});
      const oldToken=await db.emailVerificationToken.create({data:{userId:id,newEmail:`${id}@example.test`,tokenHash:hashToken(raw),expiresAt:new Date(Date.now()+60000)}});let sent=0;
      const before=async()=>{
        if(fault==='suspend'){await db.user.update({where:{id},data:{status:'SUSPENDED'}});return;}
        await db.emailVerificationToken.update({where:{id:oldToken.id},data:{status:fault==='confirmed'?'USED':'REVOKED'}});
        if(fault==='new-request')await db.emailVerificationToken.create({data:{userId:id,newEmail:`new-${id}@example.test`,tokenHash:hashToken(`new-${raw}`),expiresAt:new Date(Date.now()+60000)}});
      };
      await assert.rejects(new ResendEmailVerificationUseCase(delayed(before),{sendEmailVerification:async()=>{sent++;}} as any).execute({userId:id}),error=>(error as any).getStatus?.()===404);
      assert.equal(sent,0);assert.equal(await db.emailVerificationToken.count({where:{userId:id}}),fault==='new-request'?2:1);
    }
    return ['email-verification-postmark-fragment-open-reload-no-mutation','browser-email-explicit-confirm-service-error-retry-single-use',
      'browser-email-resend-revokes-old-proof-lost-response-account-return','browser-email-legacy-conflicting-used-expired-recovery-mobile',
      'email-verification-purpose-double-claim-current-user-expiry-revocation-and-unique-conflict','email-resend-stale-source-confirmed-or-suspended-cannot-mint-or-send'];
  } catch(error) {
    await page.screenshot({path:`${browser.evidenceDir}/email-verification-failure.png`,fullPage:true});
    throw error;
  } finally {
    service.execute=originalExecute;input.transport(undefined);await page.context().setExtraHTTPHeaders({});
    await db.auditLog.deleteMany({where:{actorUserId:{in:subjectIds}}});await db.user.deleteMany({where:{id:{in:subjectIds}}});
    await db.emailVerificationToken.deleteMany({where:{userId:user.id}});await db.passwordResetToken.deleteMany({where:{userId:user.id,tokenHash:hashToken(`reset-only-${tag}`)}});
    await db.user.update({where:{id:user.id},data:{email:user.email,emailVerifiedAt:user.emailVerifiedAt}});
    await db.companyPlanTerm.update({where:{companyId:member.companyId},data:{termEndsAt:term.termEndsAt}});
    await db.rolePermission.deleteMany({where:{roleId,permissionId:{in:addedPermissions}}});
    await db.emailSendAttempt.deleteMany({where:{recipient:{startsWith:`verify-${tag}-`}}});
  }
}
