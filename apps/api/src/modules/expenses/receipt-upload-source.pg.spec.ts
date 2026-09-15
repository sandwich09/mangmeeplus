/** Shared web/LINE upload: real PostgreSQL source conflicts, atomic replacement and recovery; storage is simulated. */
import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ConflictException,ForbiddenException} from '@nestjs/common';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../../generated/prisma/client';
import {PrismaExpenseRepository} from './infrastructure/prisma-expense.repository';
import {PrismaAttachmentRepository} from '../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import {PermissionResolverService} from '../access-control/application/permission-resolver.service';
import {PrismaPermissionResolverRepository} from '../access-control/infrastructure/prisma-permission-resolver.repository';
import {CompleteReceiptUploadUseCase} from './application/use-cases/expense-upload.use-case';

const databaseUrl=process.env.RECEIPT_UPLOAD_SOURCE_TEST_DATABASE_URL;
async function fixture(channel:'WEB_UPLOAD'|'LINE_UPLOAD',run:(h:any)=>Promise<void>) {
  const url=new URL(databaseUrl!);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.ok(/^\/watchdog_bms(_[a-z0-9_]+)?$/.test(url.pathname)||url.port==='15432'&&url.pathname==='/mangmee_billing_20260912');
  const client=new PrismaClient({adapter:new PrismaPg({connectionString:databaseUrl!})});
  const tag=`upload-source-${randomUUID()}`,companyId=`${tag}-company`,userId=`${tag}-user`,expenseId=`${tag}-expense`,oldId=`${tag}-old`,newId=`${tag}-new`;
  const repo=new PrismaExpenseRepository({client} as any),attachments=new PrismaAttachmentRepository({client} as any);
  let uploads=0,beforeStorage:(()=>Promise<void>)|undefined;
  const makeAttachment=(id:string)=>client.attachmentObject.create({data:{id,companyId,uploadedByUserId:userId,storageProvider:'local',bucket:'synthetic-local-test',objectKey:id,
    originalFileName:'receipt.jpg',mimeType:'image/jpeg',byteSize:123,metadataJson:{lineReceiptExpenseId:expenseId}}});
  const complete=new CompleteReceiptUploadUseCase(repo,{execute:async(_ctx:any,cmd:any)=>{
    uploads++;const original=await client.attachmentObject.findUniqueOrThrow({where:{id:cmd.attachmentId}});assert.equal(original.status,'PENDING_UPLOAD');
    await beforeStorage?.();return client.attachmentObject.update({where:{id:cmd.attachmentId},data:{status:'ACTIVE',checksumSha256:'synthetic-receipt-bytes'}});
  }} as any,{log:async()=>{}} as any,{append:async()=>{}} as any,attachments,{client} as any,new PermissionResolverService(new PrismaPermissionResolverRepository({client} as any)));
  try {
    await client.company.create({data:{id:companyId,name:'Synthetic upload source'}});await client.user.create({data:{id:userId,displayName:'Synthetic owner'}});
    const branch=await client.branch.create({data:{companyId,code:'HOME',name:'Home',type:'HEAD_OFFICE'}});
    const other=await client.branch.create({data:{companyId,code:'OTHER',name:'Other',type:'BRANCH'}});
    const permissions=await client.permission.findMany({where:{key:{in:['expense.receipt.upload','expense.receipt.line_upload','attachment.create']}}});
    assert.equal(permissions.length,3,'local permission seed is required');
    const role=await client.role.create({data:{companyId,scopeKey:companyId,key:tag,name:'Synthetic upload role',permissions:{create:permissions.map(p=>({permissionId:p.id}))}}});
    const membership=await client.companyMembership.create({data:{companyId,userId,defaultBranchId:branch.id,branchScopeMode:'SELECTED_BRANCHES',branchScopes:{create:{branchId:branch.id}},roles:{create:{roleId:role.id}}}});
    await makeAttachment(oldId);await makeAttachment(newId);await client.attachmentObject.update({where:{id:oldId},data:{status:'ACTIVE'}});
    await client.expenseRecord.create({data:{id:expenseId,companyId,branchId:branch.id,createdByUserId:userId,captureSource:channel,
      ...(channel==='LINE_UPLOAD'?{lineMessageId:`${tag}-message`}:{}),expenseDate:new Date('2026-09-15'),status:'DRAFT',primaryAttachmentId:oldId,updatedAt:new Date('2026-09-15T00:00:00Z')}});
    await repo.linkAttachment(expenseId,oldId,'expense.receipt.primary',companyId,userId);
    const ctx={companyId,userId,membershipId:membership.id,authSubject:userId,requestId:tag,roles:['OWNER'],scopes:{branchIds:[branch.id]},permissions:['expense.receipt.upload','expense.receipt.line_upload','attachment.create'],authProvider:channel==='LINE_UPLOAD'?'line':'watchdog'} as any;
    const snapshot=async()=>({expense:await client.expenseRecord.findUniqueOrThrow({where:{id:expenseId}}),links:await client.attachmentLink.findMany({where:{companyId,targetId:expenseId},orderBy:{id:'asc'}}),old:await client.attachmentObject.findUniqueOrThrow({where:{id:oldId}})});
    await run({client,repo,complete,ctx,companyId,userId,roleId:role.id,membershipId:membership.id,expenseId,oldId,newId,otherBranchId:other.id,snapshot,makeAttachment,
      uploadCount:()=>uploads,beforeStorage:(fn:()=>Promise<void>)=>{beforeStorage=fn;}});
  } finally {
    await client.expenseDuplicateCandidate.deleteMany({where:{companyId}});
    await client.attachmentLink.deleteMany({where:{companyId}});await client.expenseRecord.deleteMany({where:{companyId}});
    await client.attachmentObject.deleteMany({where:{companyId}});await client.branch.deleteMany({where:{companyId}});
    await client.companyMembership.deleteMany({where:{companyId}});await client.role.deleteMany({where:{companyId}});
    await client.company.deleteMany({where:{id:companyId}});await client.user.deleteMany({where:{id:userId}});await client.$disconnect();
  }
}

describe('receipt upload source completion on PostgreSQL',{skip:!databaseUrl},()=>{
  for(const channel of ['WEB_UPLOAD','LINE_UPLOAD'] as const) {
    it(`${channel} refuses changes during storage without linking or retiring either receipt`,async()=>{
      for(const change of ['review','primary','branch'] as const)await fixture(channel,async h=>{
        let changed:any;
        h.beforeStorage(async()=>{
          await h.client.expenseRecord.update({where:{id:h.expenseId},data:{updatedAt:new Date('2026-09-15T00:00:01Z'),
            ...(change==='review'?{status:'CONFIRMED',confirmedAt:new Date('2026-09-15T00:00:01Z')}:change==='primary'?{primaryAttachmentId:null}:{branchId:h.otherBranchId})}});
          changed=await h.snapshot();
        });
        await assert.rejects(()=>h.complete.execute(h.ctx,{expenseId:h.expenseId,attachmentId:h.newId}),ConflictException);
        assert.deepEqual(await h.snapshot(),changed);
        assert.equal((await h.client.attachmentObject.findUniqueOrThrow({where:{id:h.newId}})).status,'ACTIVE','verified bytes stay available; no business link is fabricated');
      });
    });
    it(`${channel} rolls back a failure after retiring the old receipt and recovers through the existing upload path`,async()=>fixture(channel,async h=>{
      const before=await h.snapshot(),originalCheck=h.repo.runDuplicateCheck.bind(h.repo);
      h.repo.runDuplicateCheck=async()=>{throw new Error('synthetic failure after link and retirement');};
      await assert.rejects(()=>h.complete.execute(h.ctx,{expenseId:h.expenseId,attachmentId:h.newId}),/synthetic failure/);
      assert.deepEqual(await h.snapshot(),before,'primary, original active file and all links roll back together');
      h.repo.runDuplicateCheck=originalCheck;
      const attachmentId=channel==='LINE_UPLOAD'?h.newId:`${h.newId}-reviewed-reupload`;
      if(channel==='WEB_UPLOAD')await h.makeAttachment(attachmentId);
      const result=await h.complete.execute(h.ctx,{expenseId:h.expenseId,attachmentId});
      assert.equal(result.primaryAttachmentId,attachmentId);assert.equal(result.status,'NEEDS_REVIEW');
      assert.equal('attachments' in result,false);assert.equal('payments' in result,false,'completion keeps the existing minimal response contract');
      const after=await h.snapshot();assert.equal(after.old.status,'DELETED');assert.equal(after.links.length,1);assert.equal(after.links[0].attachmentId,attachmentId);
      assert.equal(h.uploadCount(),channel==='LINE_UPLOAD'?1:2,'LINE uses the original ACTIVE reservation; web uses its existing reviewed re-upload');
    }));
    it(`${channel} rechecks current membership, permission, user, company and branch after storage`,async()=>{
      for(const change of ['membership','permission','user','company','branch'] as const)await fixture(channel,async h=>{
        const before=await h.snapshot();
        h.beforeStorage(async()=>{
          if(change==='membership')await h.client.companyMembership.update({where:{id:h.membershipId},data:{status:'SUSPENDED'}});
          if(change==='permission')await h.client.rolePermission.deleteMany({where:{roleId:h.roleId}});
          if(change==='user')await h.client.user.update({where:{id:h.userId},data:{status:'DISABLED'}});
          if(change==='company')await h.client.company.update({where:{id:h.companyId},data:{status:'SUSPENDED'}});
          if(change==='branch')await h.client.membershipBranchScope.updateMany({where:{membershipId:h.membershipId},data:{branchId:h.otherBranchId}});
        });
        await assert.rejects(()=>h.complete.execute(h.ctx,{expenseId:h.expenseId,attachmentId:h.newId}),ForbiddenException);
        assert.deepEqual(await h.snapshot(),before);assert.equal(h.uploadCount(),1);
      });
    });
    it(`${channel} checks its internal source callback after storage and before any business write`,async()=>fixture(channel,async h=>{
      const before=await h.snapshot();let checked=0;
      await assert.rejects(()=>h.complete.execute(h.ctx,{expenseId:h.expenseId,attachmentId:h.newId},{beforeCommit:async()=>{
        checked++;assert.equal(h.uploadCount(),1);throw new ForbiddenException('original LINE source changed');
      }}),ForbiddenException);
      assert.equal(checked,1);assert.deepEqual(await h.snapshot(),before);
    }));
    it(`${channel} rejects an out-of-scope branch before storage`,async()=>fixture(channel,async h=>{
      const before=await h.snapshot();await assert.rejects(()=>h.complete.execute({...h.ctx,scopes:{branchIds:[]}}, {expenseId:h.expenseId,attachmentId:h.newId}),/outside your assigned branch scope/);
      assert.equal(h.uploadCount(),0);assert.deepEqual(await h.snapshot(),before);
    }));
  }
});
