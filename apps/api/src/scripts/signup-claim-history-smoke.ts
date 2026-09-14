import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { EmailSendAttempt } from '../generated/prisma/client';
import type { startBillingBrowser } from './billing-browser-smoke';

export async function checkSignupClaimHistory(input:{prisma:PrismaService;userId:string;membershipId:string;
  request:(path:string,method?:string,body?:unknown)=>Promise<{status:number;body:any}>;browser?:Awaited<ReturnType<typeof startBillingBrowser>>}) {
  const {prisma,userId,membershipId,request,browser}=input,db=prisma.client,run=randomUUID(),roleId=randomUUID(),requests:string[]=[];
  const member=await db.companyMembership.findUniqueOrThrow({where:{id:membershipId}});
  const originalTerm=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId:member.companyId}});
  let adminId:string|undefined,createdAdmin=false;
  const create=async()=>{const row=await db.companySignupRequest.create({data:{externalSignupId:`claim-history-${randomUUID()}`,payloadHash:run,companyName:`Synthetic claim history ${run}`,
    ownerDisplayName:'Synthetic applicant',contactEmail:`claim-${run}@example.test`,consentVersion:'synthetic-history',state:'EMAIL_PENDING',claimWindowStartedAt:new Date()}});requests.push(row.id);return row;};
  const history=(id:string,cursor?:string)=>request(`/v1/system/signup-requests/${id}/claim-deliveries${cursor?`?cursor=${cursor}`:''}`);
  try {
    await db.companyPlanTerm.update({where:{companyId:member.companyId},data:{termEndsAt:new Date(Date.now()+86400000)}});
    const signup=await create(),foreign=await create();
    assert.equal((await history(signup.id)).status,403);
    const permission=await db.permission.upsert({where:{key:'system.company_onboarding.read'},update:{},create:{key:'system.company_onboarding.read',description:'Read onboarding'}});
    await db.role.create({data:{id:roleId,key:`CLAIM_HISTORY_${run}`,scopeKey:'system',isSystem:true,name:'Synthetic claim reader',permissions:{create:{permissionId:permission.id}}}});
    await db.membershipRole.create({data:{membershipId,roleId}});
    assert.equal((await history(signup.id)).status,403,'read permission without SYSTEM_ADMIN is insufficient');
    const existing=await db.role.findUnique({where:{scopeKey_key:{scopeKey:'system',key:'SYSTEM_ADMIN'}}});
    const admin=existing??await db.role.create({data:{key:'SYSTEM_ADMIN',scopeKey:'system',isSystem:true,name:'Synthetic platform role'}});
    adminId=admin.id;createdAdmin=!existing;await db.membershipRole.create({data:{membershipId,roleId:admin.id}});
    assert.equal((await history(signup.id)).body.items.length,0);
    const at=new Date(),attempts:EmailSendAttempt[]=[];
    for(let index=1;index<=27;index++)attempts.push(await db.emailSendAttempt.create({data:{intentKey:`claim-history:${signup.id}`,generation:index,purpose:'account_claim',signupRequestId:signup.id,
      provider:'postmark',providerServerId:123456,stream:'outbound',recipient:signup.contactEmail!,status:index===27?'UNKNOWN':'ACCEPTED',
      providerMessageId:index===27?null:randomUUID(),createdAt:at,submittedAt:index===27?null:at,deliveredAt:index===1?at:null,suppressedAt:index===2?at:null,
      nextRecoveryAt:index===27?new Date(at.getTime()+60000):null,deadlineAt:new Date(at.getTime()+3600000),possibleDuplicate:index===27,errorCode:index===27?'private-diagnostic-claim-link':index===26?'historical-transport-error':null}}));
    await db.companySignupRequest.update({where:{id:signup.id},data:{latestClaimEmailAttemptId:attempts[26]!.id,claimEmailLastSentAt:at,claimEmailSesMessageId:'private-legacy-message-id'}});
    const foreignAttempt=await db.emailSendAttempt.create({data:{intentKey:`claim-history:${foreign.id}`,generation:1,purpose:'account_claim',signupRequestId:foreign.id,
      provider:'postmark',providerServerId:123456,stream:'outbound',recipient:foreign.contactEmail!}});
    const otherPurpose=await db.emailSendAttempt.create({data:{intentKey:`claim-history-other:${signup.id}`,generation:1,purpose:'password_reset',signupRequestId:signup.id,
      provider:'postmark',providerServerId:123456,stream:'outbound',recipient:signup.contactEmail!}});
    assert.equal((await history(signup.id,foreignAttempt.id)).status,404);assert.equal((await history(signup.id,otherPurpose.id)).status,404);
    assert.equal((await request(`/v1/system/signup-requests/${signup.id}/claim-deliveries?cursor[]=${attempts[0]!.id}`)).status,400);
    assert.equal((await request(`/v1/system/signup-requests/${signup.id}/claim-deliveries?recipient=private`)).status,400);
    const snapshot=async()=>JSON.stringify({request:await db.companySignupRequest.findUnique({where:{id:signup.id}}),attempts:await db.emailSendAttempt.findMany({where:{signupRequestId:signup.id},orderBy:{id:'asc'}}),
      tokens:await db.accountClaimToken.count({where:{signupRequestId:signup.id}}),outbox:await db.outboxEvent.count({where:{aggregateId:signup.id}})});
    const before=await snapshot(),first=await history(signup.id);assert.equal(first.status,200);assert.equal(first.body.items.length,25);assert.ok(first.body.nextCursor);
    assert.equal(first.body.hasLegacySesReference,true);assert.equal(first.body.lastClaimSentAt,at.toISOString());
    assert.doesNotMatch(JSON.stringify(first.body),/@example|recipient|MessageId|message-id|providerServerId|intentKey|private-diagnostic|HtmlBody|token|https:/);
    const second=await history(signup.id,first.body.nextCursor);assert.equal(second.status,200);assert.equal(second.body.items.length,2);
    const rows=[...first.body.items,...second.body.items];assert.equal(new Set(rows.map(row=>row.id)).size,27);
    const latest=rows.find(row=>row.latest);assert.equal(latest.id,attempts[26]!.id);assert.equal(latest.state,'UNKNOWN');assert.equal(latest.submittedAt,null);assert.equal(latest.possibleDuplicate,true);
    assert.equal(rows.find(row=>row.id===attempts[0]!.id).deliveredAt,at.toISOString());
    assert.equal(rows.find(row=>row.id===attempts[25]!.id).needsReview,false,'historical transport error cannot override observed acceptance');
    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId,roleId:admin.id}}});assert.equal((await history(signup.id)).status,403);
    await db.membershipRole.create({data:{membershipId,roleId:admin.id}});
    assert.equal(await snapshot(),before,'history reads cannot send, rotate proofs, extend windows or provision');
    for(const state of ['EMAIL_FAILED','EXPIRED'] as const){await db.companySignupRequest.update({where:{id:signup.id},data:{state}});assert.equal((await history(signup.id)).body.state,state);}
    if(browser){
      const page=browser.page;await page.setViewportSize({width:390,height:844});
      await page.goto(`${browser.origin}/system/signup-requests`,{waitUntil:'domcontentloaded'});
      await page.locator(`a[href="/system/signup-requests/${signup.id}/mail"]`).click();await page.waitForURL(`**/system/signup-requests/${signup.id}/mail`);
      await page.getByRole('button',{name:'ประวัติหน้าถัดไป',exact:true}).click();await page.getByRole('button',{name:'ประวัติหน้าแรก',exact:true}).click();
      await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'สถานะคำขอสมัคร'}).getByText(/EXPIRED/).waitFor();
      await page.getByRole('button',{name:'โหลดประวัติล่าสุด',exact:true}).click();await page.getByRole('region',{name:'สถานะคำขอสมัคร'}).getByText(/EXPIRED/).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'history must fit the mobile viewport');
      await page.getByRole('region',{name:'สถานะคำขอสมัคร'}).screenshot({path:`${browser.evidenceDir}/admin-claim-history-mobile.png`});
      await page.getByRole('link',{name:'กลับคิวสมัคร',exact:true}).click();await page.waitForURL('**/system/signup-requests');
    }
    return ['claim-history-current-global-role-and-revocation','claim-history-request-purpose-cursor-redaction-and-recorded-delivery-facts',
      'claim-history-read-only-no-provision-send-proof-or-window-change',...(browser?['browser-claim-history-queue-pagination-reload-expired-and-return-mobile']:[])];
  } finally {
    await db.companyPlanTerm.update({where:{companyId:member.companyId},data:{termEndsAt:originalTerm.termEndsAt}});
    await db.emailSendAttempt.deleteMany({where:{signupRequestId:{in:requests}}});await db.companySignupRequest.deleteMany({where:{id:{in:requests}}});
    await db.membershipRole.deleteMany({where:{membershipId,roleId:{in:[roleId,...adminId?[adminId]:[]]}}});
    await db.role.deleteMany({where:{id:{in:[roleId,...createdAdmin&&adminId?[adminId]:[]]}}});
  }
}
