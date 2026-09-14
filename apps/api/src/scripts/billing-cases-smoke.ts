import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfiguration} from './billing-configuration-smoke';
import {detectBillingIssue} from '../modules/billing/application/billing-issues';

export async function checkBillingCases(input:Parameters<typeof checkBillingConfiguration>[0]&{
  delegated:Parameters<typeof checkBillingConfiguration>[0]['request'];approveRequest:Parameters<typeof checkBillingConfiguration>[0]['request'];
  targetId:string;targetRoleId:string;otherCompanyId:string;
}) {
  const {request,approveRequest,delegated,companyId,stripeAccountId,targetId,targetRoleId,otherCompanyId,browser}=input,client=input.prisma.client;
  const base='/v1/system/billing',run=randomUUID(),identity={companyId,stripeAccountId,livemode:false,kind:'CASE_FOLLOWUP',referenceId:run};
  const permission=await client.permission.findUniqueOrThrow({where:{key:'system.billing.issue.manage'}});
  const rolePermission={roleId:targetRoleId,permissionId:permission.id};await client.rolePermission.create({data:rolePermission});
  const issue=await client.$transaction(tx=>detectBillingIssue(tx,identity));
  const other=await client.$transaction(tx=>detectBillingIssue(tx,{...identity,companyId:otherCompanyId,referenceId:`other-${run}`}));
  const detail=()=>request(`${base}/issues/${issue.id}`);
  const update=(value:unknown,otherActor=false)=> (otherActor?approveRequest:request)(`${base}/issues/${issue.id}`,'PATCH',value);
  const beforeAccounts=await client.billingAccount.findMany({where:{stripeAccountId},orderBy:{id:'asc'}});
  const beforeGrants=await client.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}});
  const scope=await client.billingOperatorScope.findUniqueOrThrow({where:{userId_stripeAccountId_livemode_companyId:{companyId,userId:targetId,stripeAccountId,livemode:false}}});
  const viewport=browser?.page.viewportSize();
  try {
    assert.equal((await delegated(`${base}/issues/${other.id}`)).status,404);
    const candidates=await request(`${base}/issues/${issue.id}/operators?search=${targetId}`);assert.equal(candidates.status,200,JSON.stringify(candidates.body));assert.equal(candidates.body.items[0]?.id,targetId);
    const initial=(await detail()).body;
    const desired={expectedVersion:initial.version,state:'WAITING_PROVIDER',note:'ส่งต่อพร้อมกำหนดผู้สำรองและเวลาติดตาม',assigneeUserId:targetId,backupUserId:input.userIds[1],priority:'CRITICAL',followUpAt:new Date(Date.now()+86400000).toISOString()};
    if(browser) {
      const page=browser.page;await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/billing/issues/${issue.id}`,{waitUntil:'domcontentloaded'});
      await page.getByLabel('ค้นหาผู้รับผิดชอบ',{exact:true}).fill(targetId);await page.getByRole('button',{name:'ค้นหาเจ้าหน้าที่ที่มีสิทธิ์',exact:true}).click();
      await page.getByLabel('ผู้รับผิดชอบที่เลือก',{exact:true}).selectOption(targetId);
      await page.getByLabel('ค้นหาผู้รับผิดชอบ',{exact:true}).fill(input.userIds[1]!);await page.getByRole('button',{name:'ค้นหาเจ้าหน้าที่ที่มีสิทธิ์',exact:true}).click();
      await page.getByLabel('ผู้สำรองที่เลือก',{exact:true}).selectOption(input.userIds[1]!);
      await page.getByLabel('สถานะ',{exact:true}).selectOption('WAITING_PROVIDER');await page.getByLabel('ความเร่งด่วน',{exact:true}).selectOption('CRITICAL');
      const future=await page.evaluate(()=>{const d=new Date(Date.now()+86400000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);});
      await page.getByLabel('เวลาติดตามภายใน',{exact:true}).fill(future);await page.getByLabel('บันทึกการดำเนินการ',{exact:true}).fill(desired.note);
      await page.getByRole('button',{name:'บันทึกสถานะ',exact:true}).click();await page.getByText('รอผู้ให้บริการ · เวอร์ชัน 1',{exact:true}).waitFor();
    }else assert.equal((await update(desired)).status,200);
    const assigned=(await detail()).body;assert.equal(assigned.assigneeUserId,targetId);assert.equal(assigned.backupUserId,input.userIds[1]);assert.equal(assigned.priority,'CRITICAL');assert.ok(assigned.followUpAt);
    await client.$transaction(tx=>detectBillingIssue(tx,identity));const again=(await detail()).body;
    for(const field of ['state','assigneeUserId','backupUserId','note','priority','followUpAt','version','episode'])assert.deepEqual(again[field],assigned[field]);
    assert.equal((await update(desired)).status,409,'old version cannot overwrite current assignment');
    assert.equal((await request(`${base}/issues/${other.id}`,'PATCH',{...desired,expectedVersion:0,backupUserId:null})).body.code,'CONTROL_ASSIGNEE_REVIEW');
    await client.role.update({where:{id:targetRoleId},data:{companyId,scopeKey:companyId,isSystem:false}});
    assert.equal((await detail()).body.assigneeAvailable,false);assert.equal((await request(`${base}/issues/${issue.id}/operators?search=${targetId}`)).body.items.length,0);
    assert.equal((await update({...desired,expectedVersion:assigned.version})).body.code,'CONTROL_ASSIGNEE_REVIEW');
    await client.role.update({where:{id:targetRoleId},data:{companyId:null,scopeKey:'system',isSystem:true}});
    await client.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:new Date(Date.now()-1000)}});
    assert.equal((await update({...desired,expectedVersion:assigned.version})).body.code,'CONTROL_ASSIGNEE_REVIEW');
    if(browser) {
      const page=browser.page;await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await page.getByText(/ผู้รับผิดชอบ .*ไม่มีสิทธิ์แล้ว เลือกคนใหม่หรือคืนคิว/).waitFor();
      await page.getByLabel('บันทึกการดำเนินการ',{exact:true}).fill('คืนคิวเพราะขอบเขตเดิมหมดอายุ');await page.getByRole('button',{name:'คืนเคสเข้าคิว',exact:true}).click();
      await page.getByText('รอรับงาน · เวอร์ชัน 2',{exact:true}).waitFor();
    }else assert.equal((await update({expectedVersion:assigned.version,state:'OPEN',assigneeUserId:null,backupUserId:null,note:'คืนคิวเพราะขอบเขตเดิมหมดอายุ'})).status,200);
    await client.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:scope.expiresAt}});
    await client.billingIssue.update({where:{id:issue.id},data:{followUpAt:new Date(Date.now()-60000)}});
    const returned=(await detail()).body;assert.equal(returned.assigneeUserId,null);assert.equal(returned.backupUserId,null);assert.equal(returned.overdue,true);
    assert.ok((await request(`${base}/issues?queue=UNASSIGNED`)).body.items.some((i:any)=>i.id===issue.id));
    assert.ok((await request(`${base}/issues?queue=OVERDUE`)).body.items.some((i:any)=>i.id===issue.id));
    if(browser) {
      const page=browser.page;await page.getByRole('link',{name:'คิวตรวจสอบ',exact:true}).click();await page.waitForURL(`${browser.origin}/system/billing/issues`);
      await page.getByLabel('กรองคิว',{exact:true}).selectOption('OVERDUE');await page.locator(`a[href="/system/billing/issues/${issue.id}?queue=OVERDUE"]`).click();await page.waitForURL(`${browser.origin}/system/billing/issues/${issue.id}?queue=OVERDUE`);
      await page.getByText(/เลยเวลาติดตาม/).waitFor();assert.equal(await page.getByRole('button',{name:'หน้าถัดไป',exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${browser.evidenceDir}/admin-case-followup-mobile.png`,fullPage:true});
    }
    const raceBody={expectedVersion:returned.version,state:'ASSIGNED',assigneeUserId:targetId,backupUserId:null,note:'รับงานหลังคืนคิว'};
    const race=await Promise.all([update(raceBody),update({...raceBody,assigneeUserId:input.userIds[1]},true)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    const current=(await detail()).body;await client.billingIssue.update({where:{id:issue.id},data:{state:'RESOLVED',resolvedAt:new Date()}});
    await client.$transaction(tx=>detectBillingIssue(tx,identity));const reopened=(await detail()).body;assert.equal(reopened.episode,2);assert.equal(reopened.state,'OPEN');assert.equal(reopened.assigneeUserId,null);
    assert.equal((await update({...raceBody,expectedVersion:current.version})).status,409);
    assert.equal(await client.auditLog.count({where:{targetId:issue.id,action:'billing.issue.reopened'}}),1);
    assert.deepEqual(await client.billingAccount.findMany({where:{stripeAccountId},orderBy:{id:'asc'}}),beforeAccounts);
    assert.deepEqual(await client.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}}),beforeGrants);
    return ['admin-case-redetection-preserves-owner-note-priority-and-followup','admin-case-reassignment-backup-scope-revocation-and-return-queue',
      'admin-case-overdue-without-worker-concurrent-edit-and-reopen-episode',...(browser?['browser-admin-case-reassign-backup-followup-expired-owner-return-queue-and-mobile']:[])];
  }finally {
    if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await client.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:scope.expiresAt}});
    await client.role.update({where:{id:targetRoleId},data:{companyId:null,scopeKey:'system',isSystem:true}});
    await client.rolePermission.delete({where:{roleId_permissionId:rolePermission}});
    await client.auditLog.deleteMany({where:{targetType:'BillingIssue',targetId:{in:[issue.id,other.id]}}});await client.billingIssue.deleteMany({where:{id:{in:[issue.id,other.id]}}});
  }
}
