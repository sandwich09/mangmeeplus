import {BillingAdminService} from './application/billing-admin.service';
import type {RequestContext} from '../auth/domain/models/request-context.model';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../../generated/prisma/client';
import {detectBillingIssue,resolveBillingIssue} from './application/billing-issues';
import {issueOperators} from './application/billing-issue-ownership';

const databaseUrl=process.env.BILLING_TEST_DATABASE_URL;
test('billing case detection and ownership on real PostgreSQL',{skip:!databaseUrl},async t=>{
  const url=new URL(databaseUrl!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.ok(['/mangmee_billing_20260912','/watchdog_postmark_ci'].includes(url.pathname));
  const client=new PrismaClient({adapter:new PrismaPg({connectionString:databaseUrl!})});
  const run=randomUUID(),companyId=`case-${run}`,other=`case-other-${run}`,userId=`case-operator-${run}`,stripeAccountId=`acct_case_${run}`;
  const identity={stripeAccountId,livemode:false,companyId,kind:'PAID_HELD',referenceId:run};
  const detect=(value=identity,reopen=true)=>client.$transaction(tx=>detectBillingIssue(tx,value,reopen));
  let issueId='',roleId='';
  try{
    await client.company.createMany({data:[{id:companyId,name:'Synthetic issue company'},{id:other,name:'Synthetic other issue company'}]});
    await t.test('concurrent detections create one episode and one audit',async()=>{
      const [a,b]=await Promise.all([detect(),detect()]);assert.equal(a.id,b.id);issueId=a.id;
      assert.equal(a.episode,1);assert.equal(a.priority,'HIGH');assert.equal(await client.auditLog.count({where:{targetId:a.id,action:'billing.issue.detected'}}),1);
    });
    await t.test('redetection preserves assigned state, note, priority, follow-up and operator version',async()=>{
      const followUpAt=new Date(Date.now()+60000);
      const before=await client.billingIssue.update({where:{id:issueId},data:{state:'WAITING_CUSTOMER',assigneeUserId:userId,backupUserId:'synthetic-backup',note:'คงบันทึกเจ้าหน้าที่',priority:'CRITICAL',followUpAt,version:3}});
      await Promise.all([detect(),detect()]);const after=await client.billingIssue.findUniqueOrThrow({where:{id:issueId}});
      for(const key of ['state','assigneeUserId','backupUserId','note','priority','version','episode'] as const)assert.equal(after[key],before[key]);
      assert.equal(after.followUpAt?.getTime(),followUpAt.getTime());assert.ok(after.lastSeenAt>=before.lastSeenAt);
    });
    await t.test('resolved recurrence opens one new unassigned episode without losing the audit',async()=>{
      await client.billingIssue.update({where:{id:issueId},data:{state:'RESOLVED',resolvedAt:new Date()}});
      await Promise.all([detect(),detect()]);const row=await client.billingIssue.findUniqueOrThrow({where:{id:issueId}});
      assert.equal(row.state,'OPEN');assert.equal(row.episode,2);assert.equal(row.version,4);assert.equal(row.assigneeUserId,null);assert.equal(row.followUpAt,null);assert.equal(row.note,'คงบันทึกเจ้าหน้าที่');
      assert.equal(await client.auditLog.count({where:{targetId:issueId,action:'billing.issue.reopened'}}),1);
    });
    await t.test('unchanged reviewed financial evidence stays resolved, changed evidence reopens',async()=>{
      await client.billingIssue.update({where:{id:issueId},data:{state:'RESOLVED',resolvedAt:new Date()}});
      assert.equal((await detect(identity,false)).state,'RESOLVED');assert.equal((await detect()).episode,3);
      await assert.rejects(detect({...identity,companyId:other}),/issue_company_mismatch/);
      assert.equal((await client.billingIssue.findUniqueOrThrow({where:{id:issueId}})).companyId,companyId);
    });
    await t.test('detection rollback leaves neither issue nor episode audit',async()=>{
      const target={...identity,referenceId:`rollback-${run}`};
      await assert.rejects(client.$transaction(async tx=>{await detectBillingIssue(tx,target);throw Error('synthetic rollback');}),/synthetic rollback/);
      assert.equal(await client.billingIssue.count({where:{referenceId:target.referenceId}}),0);
    });
    await t.test('verified service resolution is audited once and preserves operator history',async()=>{
      const before=await client.billingIssue.findUniqueOrThrow({where:{id:issueId}});
      await Promise.all([1,2].map(()=>client.$transaction(tx=>resolveBillingIssue(tx,identity,'SYNTHETIC_PROVIDER_EVIDENCE'))));
      const after=await client.billingIssue.findUniqueOrThrow({where:{id:issueId}});
      assert.equal(after.state,'RESOLVED');assert.equal(after.version,before.version+1);assert.equal(after.note,before.note);assert.equal(after.episode,before.episode);
      assert.equal(await client.auditLog.count({where:{targetId:issueId,action:'billing.issue.resolved'}}),1);
    });
    await t.test('candidate role and mode/company scope are checked from current rows',async()=>{
      const permissions=await Promise.all(['system.billing.read','system.billing.issue.manage'].map(key=>client.permission.upsert({where:{key},update:{},create:{key,description:key}})));
      const role=await client.role.create({data:{key:`BILLING_CASE_${run}`,name:'Synthetic case operator',scopeKey:'system',isSystem:true,permissions:{create:permissions.map(p=>({permissionId:p.id}))}}});roleId=role.id;
      await client.user.create({data:{id:userId,displayName:'Synthetic case operator'}});
      await client.companyMembership.create({data:{userId,companyId,roles:{create:{roleId}}}});
      const list=()=>issueOperators(client,identity,{ids:[userId]});assert.equal((await list()).items.length,0);
      await client.billingOperatorScope.create({data:{userId,stripeAccountId,companyId,livemode:true,createdByUserId:userId}});assert.equal((await list()).items.length,0);
      const scope=await client.billingOperatorScope.create({data:{userId,stripeAccountId,companyId,livemode:false,createdByUserId:userId}});assert.equal((await list()).items[0]?.id,userId);
      assert.equal((await issueOperators(client,{...identity,companyId:other},{ids:[userId]})).items.length,0);
      assert.equal((await issueOperators(client,{...identity,companyId:null},{ids:[userId]})).items.length,0);
      await client.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await list()).items.length,0);
      await client.billingOperatorScope.update({where:{id:scope.id},data:{expiresAt:null,revokedAt:new Date()}});assert.equal((await list()).items.length,0);
      await client.billingOperatorScope.update({where:{id:scope.id},data:{revokedAt:null}});
      await client.role.update({where:{id:roleId},data:{companyId,scopeKey:companyId,isSystem:false}});assert.equal((await list()).items.length,0);
      await client.role.update({where:{id:roleId},data:{companyId:null,scopeKey:'system',isSystem:true}});
      await client.user.update({where:{id:userId},data:{status:'SUSPENDED'}});assert.equal((await list()).items.length,0);
    });
    await t.test('support outcome transaction rolls back on audit failure and cannot change payment or case state',async()=>{
      await client.user.update({where:{id:userId},data:{status:'ACTIVE'}});
      const member=await client.companyMembership.findFirstOrThrow({where:{userId,companyId}});
      const context:RequestContext={userId,companyId,membershipId:member.id,authSubject:userId,authProvider:'system',requestId:run,roles:[],scopes:{},permissions:['system.billing.read','system.billing.issue.manage']};
      const billing={stripe:{accountId:stripeAccountId,livemode:false,enabled:true}};
      const admin=new BillingAdminService({client} as never,billing as never);
      const source=await client.billingIssue.findUniqueOrThrow({where:{id:issueId}});
      let reached!:()=>void,release!:()=>void;
      const entered=new Promise<void>(resolve=>{reached=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
      const waitingClient=new Proxy(client,{get(target,key){if(key==='$transaction')return (fn:any)=>target.$transaction(tx=>fn(new Proxy(tx,{get(inner,prop){
        if(prop==='$executeRaw')return async(...args:any[])=>{reached();await gate;return (inner.$executeRaw as any)(...args);};return Reflect.get(inner,prop);}})));return Reflect.get(target,key);}});
      const waiting=new BillingAdminService({client:waitingClient} as never,billing as never);
      const oldCount=await client.billingOperation.count({where:{stripeAccountId,type:'RECORD_SUPPORT_OUTCOME'}});
      const pending=waiting.previewSupportOutcome(context,issueId,{expectedVersion:source.version,kind:'REVIEW_REQUESTED',note:'revoked during wait'},randomUUID());
      await entered;await client.user.update({where:{id:userId},data:{status:'SUSPENDED'}});release();
      await assert.rejects(pending);assert.equal(await client.billingOperation.count({where:{stripeAccountId,type:'RECORD_SUPPORT_OUTCOME'}}),oldCount);
      await client.user.update({where:{id:userId},data:{status:'ACTIVE'}});
      const preview=await admin.previewSupportOutcome(context,issueId,{expectedVersion:source.version,kind:'REVIEW_REQUESTED',note:'ต้องตรวจหลักฐานเดิมก่อน ห้ามถือว่าชำระแล้ว'},randomUUID());
      const failingClient=new Proxy(client,{get(target,key){if(key==='$transaction')return (fn:any)=>target.$transaction(tx=>fn(new Proxy(tx,{get(inner,prop){
        if(prop==='auditLog')return new Proxy(inner.auditLog,{get(log,method){if(method==='create')return ()=>{throw new Error('synthetic audit persistence failure');};return Reflect.get(log,method);}});
        return Reflect.get(inner,prop);}})));return Reflect.get(target,key);}});
      const failing=new BillingAdminService({client:failingClient} as never,billing as never);
      const command={expectedVersion:preview.version,previewHash:preview.previewHash};
      await assert.rejects(failing.commitSupportOutcome(context,issueId,preview.id,command),/synthetic audit/);
      assert.deepEqual(await client.billingIssue.findUnique({where:{id:issueId}}),source);
      assert.equal((await admin.supportOutcome(context,issueId,preview.id)).state,'PREVIEW');
      const results=await Promise.all([admin.commitSupportOutcome(context,issueId,preview.id,command),admin.commitSupportOutcome(context,issueId,preview.id,command)]);
      assert.ok(results.every(r=>r.state==='SUCCEEDED'&&r.id===preview.id));
      const after=await client.billingIssue.findUniqueOrThrow({where:{id:issueId}});
      assert.equal(after.version,source.version+1);assert.equal(after.state,source.state);assert.equal(after.episode,source.episode);assert.equal(after.note,source.note);
      assert.equal(await client.auditLog.count({where:{targetId:issueId,action:'billing.support_outcome.recorded'}}),1);
      assert.equal((await admin.supportOutcomes(context,issueId)).items[0]?.id,preview.id);
      await assert.rejects(admin.previewSupportOutcome(context,issueId,{expectedVersion:source.version,kind:'REPLY_RECORDED',note:'stale'},randomUUID()));
    });
    assert.equal(await client.billingAccount.count({where:{stripeAccountId}}),0,'case operations create no billing account');
  }finally{
    await client.billingOperatorScope.deleteMany({where:{stripeAccountId}});await client.auditLog.deleteMany({where:{companyId:{in:[companyId,other]}}});
    await client.billingOperation.deleteMany({where:{stripeAccountId,type:'RECORD_SUPPORT_OUTCOME'}});
    await client.billingIssue.deleteMany({where:{stripeAccountId}});await client.companyMembership.deleteMany({where:{companyId:{in:[companyId,other]}}});
    if(roleId)await client.role.delete({where:{id:roleId}});await client.user.deleteMany({where:{id:userId}});await client.company.deleteMany({where:{id:{in:[companyId,other]}}});await client.$disconnect();
  }
});
