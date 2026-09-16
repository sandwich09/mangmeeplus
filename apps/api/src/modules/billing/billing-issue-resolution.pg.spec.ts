import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { BillingAdminService } from './application/billing-admin.service';
import { BillingOperationsService } from './application/billing-operations.service';
import { resolveAppliedInvoiceIssues } from './application/billing-issues';
import type { RequestContext } from '../auth/domain/models/request-context.model';

const databaseUrl = process.env.BILLING_ISSUE_TEST_DATABASE_URL;
test('paid-application resolution binds original evidence, scope and audited repair on PostgreSQL', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.ok(['/mangmee_ux','/mangmee_billing_20260912','/watchdog_postmark_ci'].includes(url.pathname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const run = randomUUID(), companyId = `issue-fix-${run}`, other = `issue-other-${run}`, userId = `issue-admin-${run}`, stripeAccountId = `acct_issue_${run}`;
  const identity = { companyId, stripeAccountId, livemode: false };
  let roleId = '';
  try {
    await client.company.createMany({data:[{id:companyId,name:'Isolated paid issue'},{id:other,name:'Other isolated company'}]});
    const account = await client.billingAccount.create({data:identity});
    const otherAccount = await client.billingAccount.create({data:{...identity,companyId:other}});
    const invoice = await client.billingInvoice.create({data:{billingAccountId:account.id,providerInvoiceId:`in_${run}`,offerSnapshot:{},policyRevisionId:run,currency:'THB',totalSatang:49900,paidSatang:49900,
      periodStart:new Date(),periodEnd:new Date(Date.now()+86400000),providerStatus:'paid',evidenceHash:'synthetic-verified-fixture',applyStatus:'HELD'}});
    const issue = await client.billingIssue.create({data:{...identity,kind:'PAID_NOT_APPLIED',referenceId:invoice.providerInvoiceId,note:'Preserve operator note'}});
    const held = await client.billingIssue.create({data:{...identity,kind:'PAID_HELD',referenceId:invoice.id}});
    const excluded = await Promise.all([
      { ...identity, kind:'FINANCIAL_REVIEW', referenceId:invoice.id },
      { ...identity, kind:'PAID_HELD', referenceId:'other-invoice' },
      { ...identity, kind:'PAID_NOT_APPLIED', referenceId:invoice.providerInvoiceId, livemode:true },
      { ...identity, kind:'PAID_HELD', referenceId:invoice.id, stripeAccountId:`${stripeAccountId}_other`, companyId:other },
    ].map(data=>client.billingIssue.create({data})));
    await t.test('held, missing, mismatched account and incomplete evidence never resolve issues',async()=>{
      await client.$transaction(tx=>resolveAppliedInvoiceIssues(tx,account,invoice.id));
      await client.billingInvoice.update({where:{id:invoice.id},data:{applyStatus:'APPLIED'}});
      await client.$transaction(tx=>resolveAppliedInvoiceIssues(tx,account,invoice.id));
      await client.billingInvoice.update({where:{id:invoice.id},data:{appliedAt:new Date(),evidenceHash:''}});
      await client.$transaction(tx=>resolveAppliedInvoiceIssues(tx,account,invoice.id));
      await client.billingInvoice.update({where:{id:invoice.id},data:{evidenceHash:invoice.evidenceHash}});
      await client.billingInvoice.update({where:{id:invoice.id},data:{paidSatang:1}});
      await client.$transaction(tx=>resolveAppliedInvoiceIssues(tx,account,invoice.id));
      assert.equal((await client.billingIssue.findUniqueOrThrow({where:{id:issue.id}})).state,'OPEN');
      await client.billingInvoice.update({where:{id:invoice.id},data:{paidSatang:49900}});
      await client.$transaction(tx=>resolveAppliedInvoiceIssues(tx,otherAccount,invoice.id));
      await client.$transaction(tx=>resolveAppliedInvoiceIssues(tx,{...account,livemode:true},invoice.id));
      assert.equal((await client.billingIssue.findUniqueOrThrow({where:{id:issue.id}})).state,'OPEN');
    });
    const permissions = await Promise.all(['system.billing.read','system.billing.issue.manage','system.billing.apply.retry'].map(key=>client.permission.upsert({where:{key},create:{key,description:key},update:{}})));
    const role = await client.role.create({data:{key:`ISSUE_FIX_${run}`,name:'Isolated operator',scopeKey:'system',isSystem:true,permissions:{create:permissions.map(p=>({permissionId:p.id}))}}}); roleId=role.id;
    await client.user.create({data:{id:userId,displayName:'Isolated operator'}});
    const member = await client.companyMembership.create({data:{userId,companyId,roles:{create:{roleId}}}});
    await client.billingOperatorScope.create({data:{...identity,userId,createdByUserId:userId}});
    const context:RequestContext = {userId,companyId,membershipId:member.id,authSubject:userId,authProvider:'system',requestId:run,roles:[],scopes:{},permissions:permissions.map(p=>p.key)};
    const billing = {stripe:{accountId:stripeAccountId,livemode:false,enabled:true},account:(id:string)=>client.billingAccount.findFirst({where:{...identity,companyId:id}})};
    const admin = new BillingAdminService({client} as never,billing as never);
    const operations = new BillingOperationsService({client} as never,admin,billing as never,{reconcileAccount:()=>{throw new Error('already-applied retry must not call Stripe or regrant');}} as never,{} as never);
    await t.test('detail maps provider/local references only within authorized company/account/mode',async()=>{
      assert.equal((await admin.issue(context,issue.id)).relatedInvoiceId,invoice.id);
      assert.equal((await admin.issue(context,held.id)).relatedInvoiceId,invoice.id);
      await assert.rejects(admin.issue(context,excluded[2]!.id));
      await assert.rejects(admin.issue(context,excluded[3]!.id));
      const wrong = await client.billingIssue.create({data:{...identity,companyId:other,kind:'PAID_HELD',referenceId:randomUUID()}});
      await assert.rejects(admin.issue(context,wrong.id));
      await client.billingInvoice.create({data:{...invoice,id:randomUUID(),billingAccountId:otherAccount.id,offerSnapshot:{},contractSnapshot:{}}});
      await client.billingIssue.update({where:{id:held.id},data:{referenceId:'unmatched'}});
      assert.equal((await admin.issue(context,held.id)).relatedInvoiceId,null);
      await client.billingIssue.update({where:{id:held.id},data:{referenceId:invoice.id}});
      assert.equal((await admin.issue(context,issue.id)).state,'OPEN','read has no closure side effect');
    });
    await t.test('transaction rollback cannot publish resolution or its audit',async()=>{
      await assert.rejects(client.$transaction(async tx=>{await resolveAppliedInvoiceIssues(tx,account,invoice.id);throw Error('rollback resolution');}),/rollback resolution/);
      assert.equal((await client.billingIssue.findUniqueOrThrow({where:{id:issue.id}})).state,'OPEN');
      assert.equal(await client.auditLog.count({where:{targetId:{in:[issue.id,held.id]},action:'billing.issue.resolved'}}),0);
    });
    await t.test('confirmed original-invoice command closes stale issues without granting again',async()=>{
      const beforeAccount=await client.billingAccount.findUniqueOrThrow({where:{id:account.id}});
      const source = await operations.applyInvoice(context,companyId,invoice.id);
      assert.equal(source.canRetry,true);
      const preview=await operations.preview(context,{type:'RETRY_APPLY',companyId,expectedVersion:source.accountVersion,referenceId:invoice.id,invoiceSourceHash:source.sourceHash,reason:'Verify previously applied invoice'});
      assert.equal((await admin.issue(context,issue.id)).state,'OPEN','preview cannot close');
      const input={previewId:preview.id,previewHash:preview.previewHash,expectedVersion:preview.version},key=`issue-proof-${run}`;
      const submitted=await operations.submit(context,input,key);
      assert.equal(submitted.state,'QUEUED');
      assert.equal((await operations.submit(context,input,key)).id,submitted.id);
      assert.deepEqual(await operations.drain(),{processed:1,failed:0});
      assert.equal((await operations.get(context,submitted.id)).state,'SUCCEEDED');
      assert.equal((await operations.applyInvoice(context,companyId,invoice.id)).canRetry,false,'clean applied invoice is final');
      for(const id of [issue.id,held.id])assert.equal((await admin.issue(context,id)).state,'RESOLVED');
      assert.equal((await admin.issue(context,issue.id)).note,'Preserve operator note');
      assert.equal(await client.billingReceiptGrant.count({where:{companyId}}),0);
      assert.deepEqual(await client.billingAccount.findUniqueOrThrow({where:{id:account.id}}),beforeAccount);
      assert.ok((await client.billingIssue.findMany({where:{id:{in:excluded.map(i=>i.id)}}})).every(i=>i.state==='OPEN'));
      await Promise.all([1,2].map(()=>client.$transaction(tx=>resolveAppliedInvoiceIssues(tx,account,invoice.id))));
      assert.equal(await client.auditLog.count({where:{targetId:{in:[issue.id,held.id]},action:'billing.issue.resolved'}}),2);
      assert.deepEqual(await operations.drain(),{processed:0,failed:0});
    });
    await t.test('failed repair stays open and only verified recovery closes the original problem',async()=>{
      const retryInvoice=await client.billingInvoice.create({data:{...invoice,id:randomUUID(),providerInvoiceId:`in_retry_${run}`,offerSnapshot:{},contractSnapshot:{},applyStatus:'HELD',appliedAt:null}});
      const retryIssue=await client.billingIssue.create({data:{...identity,kind:'PAID_HELD',referenceId:retryInvoice.id}});
      const source=await operations.applyInvoice(context,companyId,retryInvoice.id);
      const input={type:'RETRY_APPLY' as const,companyId,expectedVersion:source.accountVersion,referenceId:source.id,invoiceSourceHash:source.sourceHash,reason:'Recover original held source'};
      await assert.rejects(operations.preview({...context,permissions:['system.billing.read']},input));
      const preview=await operations.preview(context,input);
      const submitted=await operations.submit(context,{previewId:preview.id,previewHash:preview.previewHash,expectedVersion:preview.version},`retry-proof-${run}`);
      assert.deepEqual(await operations.drain(),{processed:0,failed:1});
      const failed=await operations.get(context,submitted.id);assert.equal(failed.state,'UNKNOWN');
      assert.equal((await admin.issue(context,retryIssue.id)).state,'OPEN');
      assert.equal(await client.billingReceiptGrant.count({where:{companyId}}),0);
      // Simulated independent verified application; re-observation must not call the provider again.
      await client.billingInvoice.update({where:{id:retryInvoice.id},data:{applyStatus:'APPLIED',appliedAt:new Date()}});
      await operations.transition(context,submitted.id,failed.version,'retry');
      assert.deepEqual(await operations.drain(),{processed:1,failed:0});
      assert.equal((await admin.issue(context,retryIssue.id)).state,'RESOLVED');
      assert.equal((await operations.get(context,submitted.id)).state,'SUCCEEDED');
      assert.equal(await client.billingIssue.count({where:{...identity,referenceId:submitted.id,state:{not:'RESOLVED'}}}),0);
    });
  } finally {
    await client.auditLog.deleteMany({where:{companyId:{in:[companyId,other]}}});
    await client.billingOperation.deleteMany({where:{stripeAccountId}});
    await client.billingIssue.deleteMany({where:{stripeAccountId:{startsWith:stripeAccountId}}});
    const accounts=await client.billingAccount.findMany({where:{companyId:{in:[companyId,other]}},select:{id:true}});
    await client.billingInvoice.deleteMany({where:{billingAccountId:{in:accounts.map(a=>a.id)}}});
    await client.billingAccount.deleteMany({where:{companyId:{in:[companyId,other]}}});
    await client.billingOperatorScope.deleteMany({where:{userId}});
    await client.companyMembership.deleteMany({where:{userId}});
    if(roleId)await client.role.delete({where:{id:roleId}});
    await client.user.deleteMany({where:{id:userId}});
    await client.company.deleteMany({where:{id:{in:[companyId,other]}}});
    await client.$disconnect();
  }
});
