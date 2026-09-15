import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { DEFAULT_JWT_AUDIENCE, DEFAULT_JWT_ISSUER } from '@watchdog-bms/config';
import { hashPassword, verifyPassword } from '../modules/auth/domain/logic/password-credential.logic';
import { hashToken } from '../modules/auth/domain/logic/secure-token.logic';
import { ConfirmPasswordResetUseCase } from '../modules/auth/application/use-cases/confirm-password-reset.use-case';
import type { BrowserContext } from '@playwright/test';
import type { checkEmailVerification } from './email-verification-smoke';

export async function checkEmailPasswordReset(input:Parameters<typeof checkEmailVerification>[0]){
  const {prisma,app,browser}=input,db=prisma.client,tag=randomUUID().replaceAll('-',''),ids:string[]=[],mail:any[]=[],cases:string[]=[];
  const parent=await db.companyMembership.findUniqueOrThrow({where:{id:input.membershipId},include:{roles:true}}),companyId=parent.companyId;
  let sequence=0;let providerFailure:boolean|'UNKNOWN'=false;
  const ip=()=>`2001:db8:${tag.slice(0,4)}:${tag.slice(4,8)}::${(++sequence).toString(16)}`;
  const request:typeof input.request=(path,method,body,extra)=>input.request(path,method,body,{'x-forwarded-for':ip(),...extra});
  const ask=(username:string,extra?:Record<string,string>)=>request('/v1/auth/password/email-reset-request','POST',{username},extra);
  const confirm=(token:string,newPassword='New-Password-42')=>request('/v1/auth/password/email-reset-confirm','POST',{token,newPassword});
  const subject=async()=>{const id=`email-reset-${tag}-${ids.length}`,email=`${id}@example.test`;ids.push(id);
    const user=await db.user.create({data:{id,username:id,email,emailVerifiedAt:new Date(),displayName:'Synthetic email owner',credential:{create:{passwordHash:hashPassword('Old-Password-42')}}}});
    await db.companyMembership.create({data:{userId:id,companyId,roles:{create:{roleId:parent.roles[0]!.roleId}}}});return user;};
  const waitForMail=async(email:string)=>{for(let n=0;n<60;n++){const found=mail.slice().reverse().find(m=>m.To===email);if(found)return found;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Synthetic mail was not dispatched');};
  const proof=async(email:string)=>{const message=await waitForMail(email),found=String(message.TextBody).match(/https:\/\/[^\s]+\/reset-password#[^\s]+/);assert.ok(found);
    const url=new URL(found[0]),raw=new URLSearchParams(url.hash.slice(1)).get('token')!;assert.match(raw,/^er1\./);return raw;};
  const token=(raw:string)=>db.passwordResetToken.findUniqueOrThrow({where:{tokenHash:hashToken(raw)}});
  const service=app.get(ConfirmPasswordResetUseCase),originalPrisma=(service as any).prisma;
  let visitor:BrowserContext|undefined;
  input.transport((url,init)=>{
    if(url.origin!=='https://api.postmarkapp.com')return;
    assert.equal(url.pathname,'/email');const body=JSON.parse(String(init?.body));assert.equal(body.Tag,'password_reset');assert.ok(body.To.startsWith(`email-reset-${tag}-`));
    assert.equal(body.TrackOpens,false);assert.equal(body.TrackLinks,'None');mail.push(body);if(providerFailure==='UNKNOWN')throw Error('synthetic lost provider response');
    return new Response(JSON.stringify(providerFailure?{ErrorCode:422,Message:'synthetic rejection'}:{ErrorCode:0,MessageID:randomUUID(),SubmittedAt:new Date().toISOString()}),{status:providerFailure?422:200,headers:{'content-type':'application/json'}});
  });
  try{
    const user=await subject(),unknown=await ask(`missing-${tag}`),known=await ask(`  ${user.email!.toUpperCase()}  `);assert.equal(known.status,200);assert.deepEqual(known,unknown);
    const raw=await proof(user.email!),stored=await token(raw);assert.equal(stored.status,'PENDING');assert.ok(verifyPassword('Old-Password-42',(await db.userCredential.findUniqueOrThrow({where:{userId:user.id}})).passwordHash));assert.doesNotMatch(raw,/Old-Password|example\.test/);
    const beforeMail=mail.length;await ask(user.username!);assert.equal(mail.length,beforeMail);assert.equal(await db.passwordResetToken.count({where:{userId:user.id}}),1);
    cases.push('email-only-verified-identity-generic-normalized-request-and-account-cooldown-across-aliases');
    const oldSid=randomUUID();await db.authSession.create({data:{userId:user.id,tokenId:oldSid,expiresAt:new Date(Date.now()+3600000)}});
    const oldJwt=new JwtService().sign({sub:user.id,sid:oldSid},{secret:process.env.WATCHDOG_JWT_SECRET_ARN,issuer:DEFAULT_JWT_ISSUER,audience:DEFAULT_JWT_AUDIENCE,algorithm:'HS256',expiresIn:3600});
    assert.equal((await confirm(raw,'Old-Password-42')).body.code,'password_reuse');assert.equal((await token(raw)).status,'PENDING');
    const results=await Promise.all([confirm(raw),confirm(raw)]);assert.ok(results.every(r=>r.status===200));assert.deepEqual(results[0]!.body,{completed:true});
    assert.equal((await token(raw)).status,'USED');assert.ok(verifyPassword('New-Password-42',(await db.userCredential.findUniqueOrThrow({where:{userId:user.id}})).passwordHash));
    assert.equal(await db.auditLog.count({where:{targetId:stored.id,action:'auth.password.reset_confirm'}}),1);
    assert.equal((await request('/v1/auth/me','GET',undefined,{authorization:`Bearer ${oldJwt}`})).status,401);
    assert.equal(await db.authSession.count({where:{userId:user.id,status:'ACTIVE'}}),0);assert.equal((await confirm(raw,'Different-Password-55')).status,403);
    await db.userCredential.update({where:{userId:user.id},data:{passwordHash:hashPassword('New-Password-42')}});assert.equal((await confirm(raw)).status,403);
    cases.push('same-password-refusal-atomic-double-confirm-lost-response-replay-all-sessions-revoked-no-auto-login-and-later-rotation');

    for(const fault of ['unverified','disabled','credential-disabled','membership-disabled'] as const){const u=await subject();
      if(fault==='unverified')await db.user.update({where:{id:u.id},data:{emailVerifiedAt:null}});
      if(fault==='disabled')await db.user.update({where:{id:u.id},data:{status:'SUSPENDED'}});
      if(fault==='credential-disabled')await db.userCredential.update({where:{userId:u.id},data:{status:'DISABLED'}});
      if(fault==='membership-disabled')await db.companyMembership.updateMany({where:{userId:u.id},data:{status:'DISABLED'}});
      assert.deepEqual(await ask(u.email!),unknown);assert.equal(await db.passwordResetToken.count({where:{userId:u.id}}),0);
    }
    const ambiguous=await subject(),other=await subject();await db.user.update({where:{id:other.id},data:{username:ambiguous.email}});
    assert.deepEqual(await ask(ambiguous.email!),unknown);assert.equal(await db.passwordResetToken.count({where:{userId:{in:[ambiguous.id,other.id]}}}),0);
    cases.push('unverified-disabled-credential-membership-and-ambiguous-identifiers-do-not-mint-proofs');
    for(const fault of ['email','credential','suspended','membership','expired','revoked'] as const){const u=await subject();await ask(u.email!);const r=await proof(u.email!);
      const mutate=async()=>{
        if(fault==='email')await db.user.update({where:{id:u.id},data:{emailVerifiedAt:new Date(Date.now()+1)}});
        if(fault==='credential')await db.userCredential.update({where:{userId:u.id},data:{passwordHash:hashPassword('Changed-Password-42')}});
        if(fault==='suspended')await db.user.update({where:{id:u.id},data:{status:'SUSPENDED'}});
        if(fault==='membership')await db.companyMembership.updateMany({where:{userId:u.id},data:{status:'DISABLED'}});
        if(fault==='expired')await db.passwordResetToken.update({where:{tokenHash:hashToken(r)},data:{expiresAt:new Date(0)}});
        if(fault==='revoked')await db.passwordResetToken.update({where:{tokenHash:hashToken(r)},data:{status:'REVOKED'}});
      };
      (service as any).prisma={client:{passwordResetToken:db.passwordResetToken,$transaction:async(fn:any)=>{await mutate();return db.$transaction(fn);}}};
      try{assert.equal((await confirm(r)).status,403);}finally{(service as any).prisma=originalPrisma;}
      assert.notEqual((await token(r)).status,'USED');
    }
    cases.push('current-email-credential-security-membership-expiry-and-revocation-races-refused-inside-transaction');
    const retry=await subject();await ask(retry.email!);const old=await proof(retry.email!);await db.passwordResetToken.update({where:{tokenHash:hashToken(old)},data:{createdAt:new Date(Date.now()-61000)}});
    const count=mail.length;await ask(retry.email!);for(let n=0;mail.length===count&&n<60;n++)await new Promise(resolve=>setTimeout(resolve,50));const fresh=await proof(retry.email!);
    assert.notEqual(fresh,old);assert.equal((await token(old)).status,'REVOKED');assert.equal((await confirm(old)).status,403);assert.equal((await confirm(fresh)).status,200);
    const limit=await subject();await db.passwordResetToken.createMany({data:Array.from({length:5},(_,i)=>({userId:limit.id,tokenHash:hashToken(`${limit.id}-${i}`),expiresAt:new Date(),createdAt:new Date(Date.now()-120000-i)}))});
    assert.deepEqual(await ask(limit.email!),unknown);assert.equal(await db.passwordResetToken.count({where:{userId:limit.id}}),5);
    const budgetIp=ip();for(let n=0;n<3;n++)assert.equal((await ask(`unknown-${tag}`,{'x-forwarded-for':budgetIp})).status,200);
    assert.equal((await ask(`unknown-${tag}`,{'x-forwarded-for':budgetIp})).status,429);
    cases.push('explicit-reissue-revokes-old-link-hourly-account-budget-and-real-ip-rate-limit');

    const rejected=await subject();providerFailure=true;assert.deepEqual(await ask(rejected.email!),unknown);await proof(rejected.email!);
    for(let n=0;n<60;n++){const delivery=await db.emailSendAttempt.findFirst({where:{recipient:rejected.email!,status:'PERMANENT'}});if(delivery)break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal((await db.emailSendAttempt.findFirstOrThrow({where:{recipient:rejected.email!}})).status,'PERMANENT');providerFailure=false;
    const uncertain=await subject();providerFailure='UNKNOWN';assert.deepEqual(await ask(uncertain.email!),unknown);await proof(uncertain.email!);
    for(let n=0;n<60;n++){if(await db.emailSendAttempt.findFirst({where:{recipient:uncertain.email!,status:'UNKNOWN'}}))break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal((await db.emailSendAttempt.findFirstOrThrow({where:{recipient:uncertain.email!}})).status,'UNKNOWN');providerFailure=false;
    const suppressed=await subject();await ask(suppressed.email!);const prior=await proof(suppressed.email!);await db.passwordResetToken.update({where:{tokenHash:hashToken(prior)},data:{createdAt:new Date(Date.now()-61000)}});
    await db.emailSuppression.create({data:{providerServerId:9191301,stream:'outbound',recipient:suppressed.email!,reason:'HardBounce'}});
    assert.deepEqual(await ask(suppressed.email!),unknown);assert.equal((await token(prior)).status,'PENDING');assert.equal(await db.passwordResetToken.count({where:{userId:suppressed.id}}),1);
    const rollback=await subject();await ask(rollback.email!);const rollbackRaw=await proof(rollback.email!),rollbackToken=await token(rollbackRaw),fn=`reset_audit_${tag}`;
    const credential=await db.userCredential.findUniqueOrThrow({where:{userId:rollback.id}});
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='auth.password.reset_confirm' AND NEW."targetId"='${rollbackToken.id}' THEN RAISE EXCEPTION 'synthetic reset audit failure'; END IF; RETURN NEW; END $$`);
    try{await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      assert.equal((await confirm(rollbackRaw)).status,500);assert.equal((await token(rollbackRaw)).status,'PENDING');assert.deepEqual(await db.userCredential.findUniqueOrThrow({where:{userId:rollback.id}}),credential);
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);}
    assert.equal((await confirm(rollbackRaw)).status,200);cases.push('provider-rejection-stays-generic-with-durable-attempt-and-audit-failure-rolls-back-reset');
    const web=await subject();visitor=await browser.page.context().browser()!.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-forwarded-for':ip()}});
    const page=await visitor.newPage(),urls:string[]=[];let posts=0;page.on('request',(r:any)=>{urls.push(r.url());if(r.url().endsWith('/email-reset-confirm'))posts++;});
    await page.goto(`${browser.origin}/forgot-password`,{waitUntil:'domcontentloaded'});await page.getByLabel('ชื่อผู้ใช้หรืออีเมลบัญชี',{exact:true}).fill(web.email!);
    await page.screenshot({path:`${browser.evidenceDir}/email-password-reset-request-mobile.png`,fullPage:true});
    await page.getByRole('button',{name:'ส่งลิงก์กู้รหัสผ่าน',exact:true}).click();await page.getByRole('heading',{name:'ตรวจสอบอีเมลของคุณ',exact:true}).waitFor();
    const webRaw=await proof(web.email!),url=`${browser.origin}/reset-password#token=${encodeURIComponent(webRaw)}`;
    const pageResponse=await page.goto(url,{waitUntil:'domcontentloaded'});assert.equal(pageResponse!.headers()['referrer-policy'],'no-referrer');
    await page.reload({waitUntil:'domcontentloaded'});await page.getByLabel('รหัสผ่านใหม่',{exact:true}).waitFor();assert.equal(posts,0);assert.equal((await token(webRaw)).status,'PENDING');
    await page.getByLabel('รหัสผ่านใหม่',{exact:true}).fill('Browser-New-Password-42');await page.getByLabel('ยืนยันรหัสผ่านใหม่',{exact:true}).fill('Different-Password-42');
    await page.getByRole('button',{name:'บันทึกรหัสผ่านใหม่',exact:true}).click();await page.getByRole('alert').filter({hasText:'ไม่ตรงกัน'}).waitFor();assert.equal(posts,0);
    await page.getByLabel('ยืนยันรหัสผ่านใหม่',{exact:true}).fill('Browser-New-Password-42');await page.screenshot({path:`${browser.evidenceDir}/email-password-reset-form-mobile.png`,fullPage:true});let lost=false;
    await page.route('**/api/v1/auth/password/email-reset-confirm',async(route:any)=>{if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
    await page.getByRole('button',{name:'บันทึกรหัสผ่านใหม่',exact:true}).click();await page.getByRole('alert').filter({hasText:'ยังยืนยันผลไม่ได้'}).waitFor();assert.equal((await token(webRaw)).status,'USED');
    await page.unroute('**/api/v1/auth/password/email-reset-confirm');await page.getByRole('button',{name:'บันทึกรหัสผ่านใหม่',exact:true}).click();
    await page.getByRole('heading',{name:'ตั้งรหัสผ่านใหม่สำเร็จ',exact:true}).waitFor();assert.equal(await db.authSession.count({where:{userId:web.id,status:'ACTIVE'}}),0);
    assert.ok(!urls.some(value=>value.includes(webRaw)));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`${browser.evidenceDir}/email-password-reset-success-mobile.png`,fullPage:true});
    await page.getByRole('link',{name:'กลับไปหน้าเข้าสู่ระบบ',exact:true}).click();await page.waitForURL('**/login');
    await page.locator('#login-identifier').fill(web.username!);await page.locator('#login-password').fill('Browser-New-Password-42');
    const loginResponse=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');
    await page.getByRole('button',{name:/^(เข้าสู่ระบบ|Sign in)$/i}).click();const login=await loginResponse;assert.equal(login.status(),200);
    // Full-page login navigation may discard Chrome's response body; the real gate and session are the evidence.
    await page.waitForURL('**/legal-acceptance?**');
    assert.ok((await visitor.cookies(browser.origin)).some(cookie=>cookie.name.startsWith('watchdog_token')&&cookie.httpOnly));
    assert.equal(await db.authSession.count({where:{userId:web.id,status:'ACTIVE'}}),1,'only explicit login creates a session');
    for(const name of ['termsAccepted','privacyAcknowledged','deletionAcknowledged'])await page.locator(`input[name="${name}"]`).check();
    await page.getByRole('button',{name:/ยืนยันและเริ่มใช้งาน|Confirm and start/i}).click();await page.waitForURL(url=>url.pathname.startsWith(`/companies/${companyId}/`));
    assert.equal(await db.externalIdentity.count({where:{userId:web.id,provider:'LINE'}}),0);
    await page.goto(`${browser.origin}/reset-password#token=expired`,{waitUntil:'domcontentloaded'});await page.getByLabel('รหัสผ่านใหม่',{exact:true}).fill('Browser-New-Password-42');await page.getByLabel('ยืนยันรหัสผ่านใหม่',{exact:true}).fill('Browser-New-Password-42');
    await page.getByRole('button',{name:'บันทึกรหัสผ่านใหม่',exact:true}).click();await page.getByRole('link',{name:'ขอลิงก์กู้รหัสผ่านใหม่',exact:true}).click();await page.getByLabel('ชื่อผู้ใช้หรืออีเมลบัญชี',{exact:true}).waitFor();
    cases.push('browser-email-choice-fragment-scanner-get-mismatch-lost-response-same-intent-retry-mobile-login-and-recovery-return');
    return cases;
  }catch(error){if(visitor)await visitor.pages()[0]?.screenshot({path:`${browser.evidenceDir}/email-password-reset-failure.png`,fullPage:true});throw error;}
  finally{(service as any).prisma=originalPrisma;await visitor?.close();input.transport(undefined);
    await db.emailSuppression.deleteMany({where:{recipient:{startsWith:`email-reset-${tag}-`}}});await db.emailSendAttempt.deleteMany({where:{recipient:{startsWith:`email-reset-${tag}-`}}});await db.auditLog.deleteMany({where:{actorUserId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});}
}
