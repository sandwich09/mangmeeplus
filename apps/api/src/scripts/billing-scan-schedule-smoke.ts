import { billingRateLimitWindowSeconds } from '../modules/billing/billing-rate-limit-window';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {STRIPE_API_VERSION} from '@watchdog-bms/contracts';
import {hashPassword} from '../modules/auth/domain/logic/password-credential.logic';
import type {ProviderScansSmokeInput} from './billing-provider-scans-smoke';

export async function checkBillingScanSchedule(input:ProviderScansSmokeInput&{roleId:string;adminId:string}) {
  const db=input.prisma.client,base='/v1/system/billing/provider-scans',path=`${base}/schedule`,tag=randomUUID().replaceAll('-',''),password=`Synthetic!${tag}`,cases:string[]=[];
  const request:typeof input.request=async(...args)=>{
    for(let attempt=0;;attempt++){
      const result=await input.request(...args);if(result.status!==429||attempt>=2)return result;
      assert.ok(result.body.retryAfterSeconds<=60);await new Promise(resolve=>setTimeout(resolve,Math.min(60,result.body.retryAfterSeconds+1)*1000));
    }
  };
  const current=async()=>{const result=await request(path);assert.equal(result.status,200,JSON.stringify(result));return result.body;};
  const automatic=()=>db.billingOperation.findMany({where:{stripeAccountId:input.stripeAccountId,type:'SCAN_PROVIDER_EVENTS',sourceVersion:{gt:0}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const preview=async(extra:Record<string,unknown>={},key=randomUUID())=>request(`${path}/preview`,'POST',{enabled:true,intervalHours:24,initialLookbackHours:48,reason:'ตรวจตามรอบจำลอง',expectedVersion:(await current()).revision,...extra},{'idempotency-key':key});
  const act=(row:any,action='publish',send=request)=>send(`${path}/operations/${row.id}/${action}`,'POST',{expectedVersion:row.version,previewHash:row.previewHash});
  const read=(id:string)=>request(`${path}/operations/${id}`),reauth=(send=request)=>send('/v1/system/billing/reauthenticate','POST',{password});
  const accountIds=(await db.billingAccount.findMany({where:{stripeAccountId:input.stripeAccountId}})).map(row=>row.id);
  const snapshots=async()=>({terms:await db.companyPlanTerm.findMany({where:{companyId:(await db.companyMembership.findUniqueOrThrow({where:{id:input.membershipId}})).companyId}}),
    invoices:await db.billingInvoice.count({where:{billingAccountId:{in:accountIds}}}),grants:await db.billingReceiptGrant.count({where:{billingAccountId:{in:accountIds}}})});
  const settings=await db.billingSettings.findFirstOrThrow({where:{stripeAccountId:input.stripeAccountId,livemode:false}});
  const before=await snapshots();let reads=0,respond=()=>new Response(JSON.stringify({object:'list',data:[],has_more:false})),secondMember:string|undefined;
  input.transport((url,init)=>{
    if(url.origin!=='https://api.stripe.com'||url.pathname!=='/v1/events')return;
    reads++;assert.equal(init?.method,'GET');assert.equal(new Headers(init?.headers).get('stripe-version'),STRIPE_API_VERSION);
    assert.equal(url.searchParams.get('limit'),'100');assert.ok(Number(url.searchParams.get('created[gte]'))>=Math.floor(Date.now()/1000)-29*86400);
    assert.ok(Number(url.searchParams.get('created[lte]'))<=Math.floor(Date.now()/1000)-60);return respond();
  });
  const originalCredential=await db.userCredential.findUnique({where:{userId:input.userId}});
  await db.userCredential.upsert({where:{userId:input.userId},update:{passwordHash:hashPassword(password)},create:{userId:input.userId,passwordHash:hashPassword(password)}});
  try{
    assert.equal((await current()).enabled,false);await input.drain();assert.equal(reads,0);assert.equal((await automatic()).length,0);
    for(const extra of [{intervalHours:0},{intervalHours:169},{initialLookbackHours:673},{enabled:'true'},{secretKey:'forged'}])assert.equal((await preview(extra)).status,400);
    const runPermission=await db.permission.findUniqueOrThrow({where:{key:'system.billing.reconcile.run'}});
    await db.rolePermission.delete({where:{roleId_permissionId:{roleId:input.roleId,permissionId:runPermission.id}}});
    assert.equal((await current()).canManage,false);assert.equal((await preview()).status,403);
    await db.rolePermission.create({data:{roleId:input.roleId,permissionId:runPermission.id}});
    const key=randomUUID(),first=(await preview({},key)).body;assert.equal(first.state,'PREVIEW');assert.equal((await preview({},key)).body.id,first.id);
    assert.equal((await preview({reason:'changed'},key)).status,409);assert.equal((await act(first)).body.code,'CONTROL_REAUTH_REQUIRED');
    assert.equal((await reauth()).status,200);
    const competitor=(await preview()).body,won=await Promise.all([act(first),act(competitor)]);assert.deepEqual(won.map(r=>r.status).sort(),[200,409]);
    const publication=won.find(r=>r.status===200)!.body;assert.equal((await act(publication)).body.id,publication.id);
    assert.equal((await current()).revision,1);assert.equal(await db.auditLog.count({where:{targetId:publication.id,action:'billing.discovery.schedule_published'}}),1);
    await db.billingOperation.update({where:{id:competitor.id===publication.id?first.id:competitor.id},data:{livemode:true}});
    const foreign=competitor.id===publication.id?first.id:competitor.id;
    assert.equal((await read(foreign)).status,404);assert.equal((await request(`${path}/history?cursor=${foreign}`)).status,404);
    await db.billingOperation.update({where:{id:foreign},data:{livemode:false}});
    cases.push('scheduled-discovery-default-off-strict-input-password-proof-revision-race-idempotent-publication-and-mode-scope');

    await db.billingSettings.update({where:{id:settings.id},data:{gatesJson:{...(settings.gatesJson as object),new_sales:false,notification_delivery:false}}});
    await Promise.all([input.drain(),input.drain()]);let runs=await automatic();assert.equal(runs.length,1);assert.equal(runs[0]!.state,'SUCCEEDED');assert.equal(reads,1);
    const initial=runs[0]!,initialWindow=initial.proposedJson as {since:number;until:number};assert.equal(initialWindow.until-initialWindow.since,48*3600);
    await input.drain();assert.equal(reads,1);assert.equal((await automatic()).length,1);
    await db.billingOperation.update({where:{id:initial.id},data:{createdAt:new Date(Date.now()-25*3600000)}});
    await input.drain();runs=await automatic();assert.equal(runs.length,2);assert.equal((runs[0]!.proposedJson as any).since,initialWindow.until-300);
    assert.equal((await current()).lastCompletedWindowEnd,new Date((runs[0]!.proposedJson as any).until*1000).toISOString());
    assert.doesNotMatch(JSON.stringify(await current()),/stripeAccountId|evt_|sk_test|membershipId|cursor|actorCompanyId/);
    cases.push('scheduled-discovery-concurrent-workers-one-run-initial-window-cadence-overlap-sales-closed-and-redacted-current-read');

    // Past completed coverage represents downtime; the retained issue must survive later successful scans.
    const old=runs[0]!;await db.billingOperation.update({where:{id:old.id},data:{createdAt:new Date(Date.now()-25*3600000),proposedJson:{...(old.proposedJson as object),until:Math.floor(Date.now()/1000)-35*86400}}});
    // Keep that completed run newest in the stable ordering used by the scheduler.
    await db.billingOperation.update({where:{id:initial.id},data:{createdAt:new Date(Date.now()-26*3600000)}});
    await input.drain();const clipped=(await automatic())[0]!;assert.ok((clipped.proposedJson as any).since>=Math.floor(Date.now()/1000)-28*86400-1);
    const gap=await db.billingIssue.findFirstOrThrow({where:{kind:'PROVIDER_SCAN_COVERAGE_GAP',referenceId:clipped.id}});assert.equal(gap.state,'OPEN');
    assert.equal(clipped.state,'SUCCEEDED');
    const off=(await preview({enabled:false})).body;assert.equal((await act(off)).status,200);const count=reads;await input.drain();assert.equal(reads,count);assert.equal((await current()).nextDueAt,null);
    assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:gap.id}})).state,'OPEN');
    cases.push('scheduled-discovery-downtime-clips-retention-records-unresolved-coverage-gap-and-off-stops-new-runs');

    const expired=(await preview()).body;await db.billingOperation.update({where:{id:expired.id},data:{expiresAt:new Date(Date.now()-1)}});
    assert.equal((await act(expired)).status,409);assert.equal((await read(expired.id)).body.canPublish,false);assert.equal((await act(expired,'cancel')).status,200);
    assert.equal((await act(expired,'cancel')).body.state,'CANCELLED');
    const rollback=(await preview()).body,fn=`scan_schedule_${tag}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.discovery.schedule_published' AND NEW."targetId"='${rollback.id}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    try{
      await db.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      const revision=(await current()).revision;assert.equal((await act(rollback)).status,500);assert.equal((await current()).revision,revision);
      assert.equal((await read(rollback.id)).body.state,'PREVIEW');
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);}
    await db.userCredential.update({where:{userId:input.userId},data:{passwordHash:hashPassword(password)}});
    assert.equal((await act(rollback)).body.code,'CONTROL_REAUTH_REQUIRED');assert.equal((await reauth()).status,200);
    assert.equal((await act(rollback)).status,200);
    cases.push('scheduled-discovery-expired-preview-cancel-and-real-postgresql-audit-failure-rolls-back-publication');

    // A revoked responsible operator cannot cause provider reads; a new authorized operator can take responsibility.
    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminId}}});
    const beforeRevoked=reads;await input.drain();assert.equal(reads,beforeRevoked);assert.equal((await request(path)).status,404);
    const blocked=await db.billingIssue.findFirstOrThrow({where:{kind:'PROVIDER_SCAN_SCHEDULE_BLOCKED',referenceId:rollback.id}});assert.equal(blocked.state,'OPEN');
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminId}});
    respond=()=>new Response(JSON.stringify({object:'list',data:[],has_more:true}));await input.drain();const broken=(await automatic())[0]!;assert.equal(broken.state,'BLOCKED');
    const busyReads=reads;await input.drain();assert.equal(reads,busyReads);assert.equal((await current()).blockedReason,'CONTROL_SCAN_PENDING');
    assert.ok(input.second);const second=input.second,member=await db.companyMembership.findUniqueOrThrow({where:{id:input.membershipId}}),sid=randomUUID();
    const replacement=await db.companyMembership.create({data:{companyId:member.companyId,userId:second.userId,roles:{create:[{roleId:input.adminId},{roleId:input.roleId}]}}});secondMember=replacement.id;
    await second.recordLegal(replacement.id);await db.authSession.create({data:{userId:second.userId,tokenId:sid,expiresAt:new Date(Date.now()+3600000)}});
    await db.userCredential.create({data:{userId:second.userId,passwordHash:hashPassword(password)}});
    const replacementRequest:typeof request=(url,method,body,headers)=>request(url,method,body,{...headers,authorization:`Bearer ${second.signToken(sid)}`});
    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminId}}});
    const brokenView=(await replacementRequest(`${base}/${broken.id}`)).body;assert.equal(brokenView.canResume,false);assert.equal(brokenView.canCancel,true);
    assert.equal((await replacementRequest(`${base}/${broken.id}/cancel`,'POST',{expectedVersion:brokenView.version})).status,200);
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{kind:'PROVIDER_SCAN_FAILED',referenceId:broken.id}})).state,'RESOLVED');
    const nextVersion=(await replacementRequest(path)).body.revision;
    const takeover=(await replacementRequest(`${path}/preview`,'POST',{enabled:true,intervalHours:1,initialLookbackHours:48,expectedVersion:nextVersion,reason:'ผู้ดูแลใหม่รับผิดชอบรอบตรวจ'},{'idempotency-key':randomUUID()})).body;
    assert.equal((await reauth(replacementRequest)).status,200);assert.equal((await act(takeover,'publish',replacementRequest)).status,200);
    respond=()=>new Response(JSON.stringify({object:'list',data:[],has_more:false}));await input.drain();const replacementRun=(await automatic())[0]!;
    assert.equal(replacementRun.initiatorUserId,second.userId);assert.equal(replacementRun.state,'SUCCEEDED');
    assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:broken.id}})).state,'CANCELLED');
    assert.equal((await db.billingIssue.findUniqueOrThrow({where:{id:gap.id}})).state,'OPEN');
    await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminId}});
    cases.push('scheduled-discovery-revoked-owner-no-provider-read-blocked-run-new-admin-cancel-republish-and-retained-gap');

    // Five manual jobs share the admission ceiling. A poll may process one existing job, but cannot add an automatic sixth.
    const manualIds=Array.from({length:5},()=>randomUUID());
    await db.billingOperation.createMany({data:manualIds.map(id=>({...replacementRun,id,sourceVersion:0,state:'QUEUED',idempotencyKey:null,
      proposedJson:replacementRun.proposedJson!,resultJson:replacementRun.resultJson!,createdAt:new Date(Date.now()-200000),updatedAt:new Date(Date.now()-200000)}))});
    await db.billingOperation.update({where:{id:replacementRun.id},data:{createdAt:new Date(Date.now()-2*3600000)}});
    const cap=(await automatic()).length;await input.drain();assert.equal((await automatic()).length,cap);
    await db.billingOperation.updateMany({where:{id:{in:manualIds}},data:{state:'CANCELLED'}});
    // OFF publication with an existing queued run leaves that run available to finish.
    const queued=await db.billingOperation.create({data:{...replacementRun,id:randomUUID(),state:'QUEUED',idempotencyKey:null,proposedJson:replacementRun.proposedJson!,resultJson:replacementRun.resultJson!}});
    const stop=(await preview({enabled:false})).body;assert.equal((await act(stop)).status,200);await input.drain();assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:queued.id}})).state,'SUCCEEDED');
    cases.push('scheduled-discovery-shared-five-run-cap-and-off-preserves-existing-work');

    // No successful first scan: cancelling cannot silently replace its uninspected range with a short fresh lookback.
    await db.billingOperation.updateMany({where:{stripeAccountId:input.stripeAccountId,type:'SCAN_PROVIDER_EVENTS',sourceVersion:{gt:0}},data:{state:'CANCELLED'}});
    const unfinished=(await automatic())[0]!;
    await db.billingOperation.update({where:{id:unfinished.id},data:{proposedJson:{...(unfinished.proposedJson as object),since:Math.floor(Date.now()/1000)-35*86400}}});
    const catchup=(await preview({enabled:true,initialLookbackHours:1})).body;assert.equal((await act(catchup)).status,200);
    const admissionFunction=`scan_admission_${tag}`,beforeAdmission=(await automatic()).length;
    await db.$executeRawUnsafe(`CREATE FUNCTION ${admissionFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.discovery.scheduled' AND NEW."requestId"='${catchup.id}' THEN RAISE EXCEPTION 'synthetic scheduling audit failure'; END IF; RETURN NEW; END $$`);
    try{
      await db.$executeRawUnsafe(`CREATE TRIGGER ${admissionFunction} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${admissionFunction}()`);
      assert.equal((await input.drain()).status,500);assert.equal((await automatic()).length,beforeAdmission);
    }finally{await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${admissionFunction} ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION ${admissionFunction}()`);}
    await Promise.all([input.drain(),input.drain()]);const recoveredFirst=(await automatic())[0]!;
    assert.ok((recoveredFirst.proposedJson as any).since<Math.floor(Date.now()/1000)-27*86400);
    assert.equal(await db.billingIssue.count({where:{kind:'PROVIDER_SCAN_COVERAGE_GAP',referenceId:recoveredFirst.id}}),1);
    assert.equal((await automatic()).length,beforeAdmission+1);
    // Corrupt persisted configuration remains repairable and does not stop already queued manual discovery.
    await db.billingOperation.update({where:{id:catchup.id},data:{proposedJson:{enabled:true,intervalHours:0}}});
    assert.equal((await current()).blockedReason,'CONTROL_SCHEDULE_INVALID');
    const manual=await db.billingOperation.create({data:{...replacementRun,id:randomUUID(),sourceVersion:0,state:'QUEUED',idempotencyKey:null,proposedJson:replacementRun.proposedJson!,resultJson:replacementRun.resultJson!}});
    await input.drain();assert.equal((await db.billingOperation.findUniqueOrThrow({where:{id:manual.id}})).state,'SUCCEEDED');
    assert.equal(await db.billingIssue.count({where:{kind:'PROVIDER_SCAN_SCHEDULE_BLOCKED',referenceId:catchup.id,state:'OPEN'}}),1);
    const repaired=(await preview({enabled:false})).body;assert.equal((await act(repaired)).status,200);assert.equal((await current()).blockedReason,null);
    assert.equal((await db.billingIssue.findFirstOrThrow({where:{kind:'PROVIDER_SCAN_SCHEDULE_BLOCKED',referenceId:catchup.id}})).state,'RESOLVED');
    cases.push('scheduled-discovery-first-failure-range-retained-admission-audit-rollback-corrupt-config-manual-continuity-and-repair');

    const prototype=await db.billingOperation.findUniqueOrThrow({where:{id:expired.id}}),tied=new Date(Date.now()-86400000);
    await db.billingOperation.createMany({data:Array.from({length:27},()=>({...prototype,id:randomUUID(),state:'CANCELLED',idempotencyKey:null,proposedJson:prototype.proposedJson!,resultJson:prototype.resultJson!,createdAt:tied}))});
    const page1=(await request(`${path}/history`)).body,page2=(await request(`${path}/history?cursor=${page1.nextCursor}`)).body;
    assert.equal(page1.items.length,25);assert.equal(new Set([...page1.items,...page2.items].map(r=>r.id)).size,page1.items.length+page2.items.length);assert.equal(page2.nextCursor,null);
    cases.push('scheduled-discovery-history-25-plus-one-timestamp-ties-and-stable-cursor');

    if(input.browser){
      // Let the preceding HTTP security cases leave the real 30-command operator bucket naturally.
      await new Promise(resolve=>setTimeout(resolve,(billingRateLimitWindowSeconds(60)+1)*1000));
      const {page,origin,evidenceDir}=input.browser;await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/system/billing/provider-scans?schedule=${expired.id}`,{waitUntil:'domcontentloaded'});
      const panel=page.getByRole('region',{name:'การตรวจ Stripe ตามรอบ',exact:true}),article=panel.getByRole('article',{name:'ฉบับตั้งค่าที่เลือก',exact:true});
      await panel.getByRole('button',{name:'นำค่ามาตรวจใหม่',exact:true}).click();await expect(panel.getByLabel('เหตุผลปรับรอบตรวจ',{exact:true})).toHaveValue(expired.reason);
      await panel.getByRole('button',{name:'ตรวจการตั้งค่าก่อนยืนยัน',exact:true}).click();await page.waitForURL(url=>Boolean(url.searchParams.get('schedule'))&&url.searchParams.get('schedule')!==expired.id);
      await panel.getByRole('button',{name:'ยกเลิกฉบับตั้งค่า',exact:true}).click();await expect(article.getByRole('status')).toHaveText('ยกเลิกฉบับตั้งค่าแล้ว');
      await panel.getByLabel('เปิดการตรวจตามรอบ',{exact:true}).check();await panel.getByLabel('เหตุผลปรับรอบตรวจ',{exact:true}).fill('เปิดตรวจจากเว็บและกู้คำตอบที่หาย');
      const previewResponse=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`${path}/preview`));await panel.getByRole('button',{name:'ตรวจการตั้งค่าก่อนยืนยัน',exact:true}).click();
      const browserPreview=await (await previewResponse).json();await page.waitForURL(`**?schedule=${browserPreview.id}`);
      await panel.getByLabel('รหัสผ่านปัจจุบันเพื่อเผยแพร่',{exact:true}).fill(password);
      let lost=false;await page.route(`**/schedule/operations/${browserPreview.id}/publish`,async route=>{
        if(lost){await route.continue();return;}const response=await route.fetch();assert.equal(response.status(),200);lost=true;await route.abort('failed');
      });
      await panel.getByRole('button',{name:'ยืนยันเผยแพร่รอบตรวจ',exact:true}).click();await panel.getByRole('alert').waitFor();assert.equal((await read(browserPreview.id)).body.state,'SUCCEEDED');
      await panel.getByRole('button',{name:'ยืนยันเผยแพร่รอบตรวจ',exact:true}).click();await expect(article.getByRole('status')).toHaveText('เผยแพร่การตั้งค่าแล้ว');
      assert.equal(await db.auditLog.count({where:{targetId:browserPreview.id,action:'billing.discovery.schedule_published'}}),1);
      await input.drain();await page.reload({waitUntil:'domcontentloaded'});await expect(article.getByRole('status')).toHaveText('เผยแพร่การตั้งค่าแล้ว');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.addStyleTag({content:'nextjs-portal { display: none; }'});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidenceDir}/admin-provider-schedule-mobile.png`,fullPage:true});
      await panel.getByRole('link',{name:'เปิดงานตรวจอัตโนมัติล่าสุด',exact:true}).click();await page.waitForURL('**/system/billing/provider-scans/*');
      await page.getByRole('link',{name:'กลับรายการงานตรวจ',exact:true}).click();await page.waitForURL('**/system/billing/provider-scans');
      await page.goto(`${origin}/system/billing/issues/${gap.id}`,{waitUntil:'domcontentloaded'});
      await page.getByRole('link',{name:'ตรวจงานค้นหารายการ Stripe',exact:true}).click();await page.waitForURL('**/system/billing/provider-scans');
      await page.goto(`${origin}/system/billing/provider-scans?schedule=${randomUUID()}`,{waitUntil:'domcontentloaded'});await panel.getByRole('alert').waitFor();
      await panel.getByRole('link',{name:'กลับประวัติรอบตรวจ',exact:true}).click();await page.waitForURL('**/system/billing/provider-scans');
      cases.push('browser-schedule-stale-copy-cancel-password-publish-committed-response-loss-same-record-retry-reload-mobile-run-return');
    }
    assert.deepEqual(await snapshots(),before);return cases;
  }finally{
    input.transport();
    await db.billingSettings.update({where:{id:settings.id},data:{gatesJson:settings.gatesJson!}});
    if(originalCredential)await db.userCredential.update({where:{userId:input.userId},data:{passwordHash:originalCredential.passwordHash,updatedAt:originalCredential.updatedAt}});
    else await db.userCredential.deleteMany({where:{userId:input.userId}});
    await db.authSession.updateMany({where:{userId:input.userId},data:{billingReauthenticatedAt:null,billingCredentialVersion:null}});
    if(input.second){await db.userCredential.deleteMany({where:{userId:input.second.userId}});await db.authSession.deleteMany({where:{userId:input.second.userId}});}
    if(secondMember)await db.companyMembership.deleteMany({where:{id:secondMember}});
  }
}
