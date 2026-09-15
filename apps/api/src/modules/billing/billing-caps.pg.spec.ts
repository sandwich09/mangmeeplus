import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../../generated/prisma/client';
import {PrismaBranchRepository} from '../data-model-core/infrastructure/repositories/prisma-branch.repository';
import {SetEmployeeStatusUseCase} from '../employee-access/application/use-cases/set-employee-status.use-case';
import {CreateEmployeeUseCase} from '../employee-access/application/use-cases/create-employee.use-case';
import {assertEmployeeLimit} from '../system-partner-management/application/plan-term-limit';
import {applyCapacity,capacityOptions,capacityValid} from './application/billing-capacity';
import {billingOffer} from '@watchdog-bms/contracts';
import {lockPlanTermCompany} from '../system-partner-management/application/lock-plan-term-company';
import {PrismaReimbursementRepository} from '../reimbursements/infrastructure/prisma-reimbursement.repository';
import {GenerateIdentityReconciliationUseCase} from '../system-identity-reconciliation/application/use-cases/generate-identity-reconciliation.use-case';
import {ResolveIdentityReconciliationUseCase} from '../system-identity-reconciliation/application/use-cases/resolve-identity-reconciliation.use-case';

const databaseUrl=process.env.BILLING_TEST_DATABASE_URL;
test('paid capacity is serialized in PostgreSQL across existing create/reactivation/draft paths',{skip:!databaseUrl},async t=>{
  const url=new URL(databaseUrl!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.ok(['/mangmee_billing_20260912','/watchdog_postmark_ci'].includes(url.pathname));
  const client=new PrismaClient({adapter:new PrismaPg({connectionString:databaseUrl!})}),prisma={client} as any;
  const companyId=`billing-cap-${randomUUID()}`,users=Array.from({length:5},()=>randomUUID()),roleIds:string[]=[];
  try{
    await client.company.create({data:{id:companyId,name:'Synthetic capacity test'}});
    await client.companyPlanTerm.create({data:{companyId,tierKey:'STARTER_249',branchLimit:1,employeeLimit:2,monthlySlipLimit:30,termStartAt:new Date(),termEndsAt:new Date(Date.now()+86400000)}});
    const repo=new PrismaBranchRepository(prisma);
    await t.test('two different new branches cannot take the same last slot',async()=>{
      const results=await Promise.allSettled(['A','B'].map(code=>repo.create({companyId,code,name:code,type:'BRANCH'})));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await client.branch.count({where:{companyId,status:'ACTIVE'}}),1);
      const failed=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failed.reason.getStatus(),422);
    });
    const active=await client.branch.findFirstOrThrow({where:{companyId,status:'ACTIVE'}});
    const disabled=await client.branch.create({data:{companyId,code:'OLD',name:'Old branch',status:'DISABLED'}});
    await t.test('branch reactivation counts seats and leaves existing active edits usable',async()=>{
      await assert.rejects(repo.update({id:disabled.id,companyId,status:'ACTIVE'}),e=>(e as any).getStatus()===422);
      await repo.update({id:active.id,companyId,status:'ACTIVE',name:'Existing branch'});
      await assert.rejects(repo.update({id:disabled.id,companyId:`other-${companyId}`,status:'ACTIVE'}));
      assert.equal((await client.branch.findUniqueOrThrow({where:{id:disabled.id}})).status,'DISABLED');
    });
    await client.user.createMany({data:users.map(id=>({id,displayName:'Synthetic capacity user'}))});
    const owner=await client.role.create({data:{companyId,scopeKey:companyId,key:'OWNER',name:'Owner'}}),staff=await client.role.create({data:{companyId,scopeKey:companyId,key:'STAFF',name:'Staff'}});
    const fake=await client.role.create({data:{companyId,scopeKey:companyId,key:'SYSTEM_ADMIN',name:'Company role only'}});roleIds.push(owner.id,staff.id,fake.id);
    let platform=await client.role.findFirst({where:{key:'SYSTEM_ADMIN',scopeKey:'system',companyId:null,isSystem:true,status:'ACTIVE'}});
    if(!platform){platform=await client.role.create({data:{key:'SYSTEM_ADMIN',scopeKey:'system',companyId:null,isSystem:true,name:'Synthetic platform'}});roleIds.push(platform.id);}
    await client.companyMembership.create({data:{companyId,userId:users[0]!,roles:{create:{roleId:owner.id}}}});
    const fakeMember=await client.companyMembership.create({data:{companyId,userId:users[1]!,roles:{create:{roleId:fake.id}}}});
    await client.companyMembership.create({data:{companyId,userId:users[2]!,roles:{create:{roleId:platform.id}}}});
    await t.test('only an actual platform role is excluded and OWNER counts as a purchased seat',async()=>{
      await assert.rejects(assertEmployeeLimit(prisma,companyId),e=>(e as any).getStatus()===422);
      await client.companyMembership.update({where:{id:fakeMember.id},data:{status:'DISABLED'}});
      await assertEmployeeLimit(prisma,companyId);
    });
    const profiles:{id:string;membershipId:string}[]=[];
    for(const [index,userId] of users.slice(3).entries()){
      const member=await client.companyMembership.create({data:{companyId,userId,status:'DISABLED',roles:{create:{roleId:staff.id}}}});
      profiles.push(await client.employeeAccessProfile.create({data:{companyId,userId,membershipId:member.id,displayName:'Synthetic candidate',status:'DISABLED',
        identityType:'PASSPORT',identityLast4:'0000',identityHash:`synthetic-${index}`,identityEncryptedRef:'synthetic-only',phoneNumber:`synthetic-${index}`,createdByUserId:users[0]!}}));
    }
    await t.test('two employee reactivations compete for one actual seat',async()=>{
      const uc=new SetEmployeeStatusUseCase(prisma),results=await Promise.allSettled(profiles.map(p=>uc.execute({companyId,employeeId:p.id,status:'ACTIVE',requestingUserId:users[0]!,requesterPermissions:['access.employee.disable','access.role.manage'],requestId:randomUUID(),reason:'Synthetic capacity proof'})));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const failed=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failed.reason.getStatus(),422);
      assert.equal(await client.employeeAccessProfile.count({where:{companyId,status:'ACTIVE'}}),1);
    });
    await t.test('different draft completions cannot both pass the same pre-activation count',async()=>{
      await client.companyMembership.updateMany({where:{id:{in:profiles.map(p=>p.membershipId)}},data:{status:'DRAFT'}});
      await client.employeeAccessProfile.updateMany({where:{id:{in:profiles.map(p=>p.id)}},data:{status:'DRAFT'}});
      const uc=new CreateEmployeeUseCase(prisma,{} as any),results=await Promise.allSettled(profiles.map(p=>uc.completeDraft({companyId,employeeId:p.id,requestingUserId:users[0]!,requestId:randomUUID()})));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const failed=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failed.reason.getStatus(),422);
      assert.equal(await client.employeeAccessProfile.count({where:{companyId,status:'ACTIVE'}}),1);
      const accepted=await client.employeeAccessProfile.findFirstOrThrow({where:{companyId,status:'ACTIVE'}});
      await uc.completeDraft({companyId,employeeId:accepted.id,requestingUserId:users[0]!,requestId:randomUUID()});
    });
    await t.test('retained selection preserves OWNER, scopes, inactive rows and conversation history; stale sources change nothing',async()=>{
      await client.companyPlanTerm.update({where:{companyId},data:{branchLimit:5,employeeLimit:10}});
      await client.branch.update({where:{id:active.id},data:{type:'HEAD_OFFICE'}});
      await repo.update({id:disabled.id,companyId,status:'ACTIVE'});
      await client.companyMembership.updateMany({where:{id:{in:profiles.map(p=>p.membershipId)}},data:{status:'ACTIVE'}});
      await client.employeeAccessProfile.updateMany({where:{id:{in:profiles.map(p=>p.id)}},data:{status:'ACTIVE'}});
      const conversation=await client.aiConversation.create({data:{companyId,userId:users[4]!}});
      const offer=billingOffer('STARTER_249','year'),options=await capacityOptions(client,companyId,offer);
      const ownerMember=options.memberships.find(m=>m.owner)!;
      const selection={sourceHash:options.sourceHash,branchIds:[active.id],memberships:[{id:ownerMember.id,defaultBranchId:null}]};
      assert.equal(capacityValid(options,selection),true);
      await client.branch.update({where:{id:disabled.id},data:{name:'Changed before payment'}});
      await assert.rejects(client.$transaction(async tx=>{await lockPlanTermCompany(tx,companyId);await applyCapacity(tx,companyId,offer,selection,users[0]!,randomUUID());}));
      assert.equal(await client.employeeAccessProfile.count({where:{companyId,status:'ACTIVE'}}),2);
      const fresh=await capacityOptions(client,companyId,offer);
      await client.$transaction(async tx=>{await lockPlanTermCompany(tx,companyId);await applyCapacity(tx,companyId,offer,{...selection,sourceHash:fresh.sourceHash},users[0]!,randomUUID());});
      assert.equal((await client.branch.findUniqueOrThrow({where:{id:disabled.id}})).status,'DISABLED');
      assert.equal(await client.employeeAccessProfile.count({where:{companyId,status:'SUSPENDED'}}),2);
      assert.equal((await client.companyMembership.findUniqueOrThrow({where:{id:fakeMember.id}})).status,'DISABLED');
      assert.equal(await client.companyMembership.count({where:{companyId,status:'ACTIVE'}}),2,'OWNER and exact platform membership stay active');
      assert.ok(await client.aiConversation.findUnique({where:{id:conversation.id}}));
      assert.equal(await client.user.count({where:{id:{in:users},status:'ACTIVE'}}),5);
    });
    await t.test('branch closure and new claims use the same company boundary; existing in-flight claims cannot be stranded',async()=>{
      await repo.update({id:disabled.id,companyId,status:'ACTIVE'});
      const claims=new PrismaReimbursementRepository(prisma,{} as any),data={companyId,branchId:disabled.id,requesterUserId:users[0]!,requesterDisplayNameSnapshot:'Owner',reason:'Synthetic race',categoryKey:'other',amount:'10.0000',currency:'THB',incurredDate:new Date(),receiptRequirementStatus:'WAIVED_BY_POLICY' as const,createdByUserId:users[0]!,lines:[]};
      const created=await claims.createRequest(data);
      await assert.rejects(repo.update({id:disabled.id,companyId,status:'DISABLED'}),e=>(e as any).getResponse().code==='branch_has_open_reimbursements');
      const options=await capacityOptions(client,companyId,billingOffer('STARTER_249','year'));
      assert.equal(options.branches.find(b=>b.id===disabled.id)!.required,true);
      await client.reimbursementRequest.update({where:{id:created.id},data:{status:'CANCELLED'}});
      const results=await Promise.allSettled([repo.update({id:disabled.id,companyId,status:'DISABLED'}),claims.createRequest(data)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const branch=await client.branch.findUniqueOrThrow({where:{id:disabled.id}}),open=await client.reimbursementRequest.count({where:{companyId,branchId:disabled.id,status:'DRAFT'}});
      assert.ok(branch.status==='ACTIVE'||open===0);
      await assert.rejects(claims.createRequest({...data,branchId:active.id,requesterUserId:users[4]!}),e=>(e as any).getResponse().code==='reimbursement_requester_unavailable');
      await assert.rejects(repo.update({id:active.id,companyId,status:'DISABLED'}),e=>(e as any).getResponse().code==='branch_head_office_required');
      await assert.rejects(repo.create({companyId,code:'SECOND_HQ',name:'Duplicate HQ',type:'HEAD_OFFICE'}),e=>(e as any).getResponse().code==='branch_head_office_exists');
    });
    await t.test('system identity repair cannot bypass head-office, live-work, replacement identity or fresh-source boundaries',async()=>{
      await client.reimbursementRequest.updateMany({where:{companyId,status:'DRAFT'},data:{status:'CANCELLED'}});
      await client.branch.update({where:{id:active.id},data:{taxBranchCode:'00000',isVatEstablishment:true}});
      await client.branch.update({where:{id:disabled.id},data:{status:'ACTIVE',taxBranchCode:'00000',isVatEstablishment:true}});
      await client.branch.create({data:{companyId,code:'OTHER_ID',name:'Other tax branch',taxBranchCode:'00002',isVatEstablishment:true}});
      const generator=new GenerateIdentityReconciliationUseCase(prisma),resolver=new ResolveIdentityReconciliationUseCase(prisma,{log:async(data:any,tx:any)=>tx.auditLog.create({data})} as any);
      await generator.execute(companyId);
      const item=await client.companyIdentityReconciliationItem.findFirstOrThrow({where:{companyId,kind:'BRANCH_DUP',discriminator:'00000',status:'PENDING'}});
      const context={companyId,userId:users[0]!,requestId:randomUUID()} as any;
      const command={commandId:randomUUID(),expectedSourceFingerprint:item.sourceFingerprint,action:'ARCHIVE' as const,targetBranchId:disabled.id};
      await assert.rejects(resolver.resolveBranchDuplicate(context,item.id,{...command,targetBranchId:active.id}),e=>(e as any).getResponse().code==='branch_head_office_required');
      await assert.rejects(resolver.resolveBranchDuplicate(context,item.id,{...command,action:'EDIT_CODE',newCode:'00002'}),e=>(e as any).getStatus()===409);
      const claim=await client.reimbursementRequest.create({data:{companyId,branchId:disabled.id,requesterUserId:users[0]!,requesterDisplayNameSnapshot:'Owner',reason:'Synthetic open claim',categoryKey:'other',amount:10,outstandingAmount:10,incurredDate:new Date(),createdByUserId:users[0]!}});
      await assert.rejects(resolver.resolveBranchDuplicate(context,item.id,command),e=>(e as any).getResponse().code==='branch_has_open_reimbursements');
      await client.branch.update({where:{id:disabled.id},data:{taxBranchCode:'00003'}});
      await assert.rejects(resolver.resolveBranchDuplicate(context,item.id,command),e=>(e as any).getStatus()===409);
      await client.branch.update({where:{id:disabled.id},data:{taxBranchCode:'00000'}});
      await client.reimbursementRequest.update({where:{id:claim.id},data:{status:'CANCELLED'}});
      assert.equal((await resolver.resolveBranchDuplicate(context,item.id,command)).replayed,false);
      assert.equal((await resolver.resolveBranchDuplicate(context,item.id,command)).replayed,true);
      assert.equal((await client.branch.findUniqueOrThrow({where:{id:active.id}})).status,'ACTIVE');
      assert.equal((await client.branch.findUniqueOrThrow({where:{id:disabled.id}})).status,'ARCHIVED');
    });
    await t.test('commercial suspension can be reversed through existing employee flows only with usable and authorized branch scope',async()=>{
      const status=new SetEmployeeStatusUseCase(prisma),complete=new CreateEmployeeUseCase(prisma,{} as any);
      const first=profiles[0]!,second=profiles[1]!,command={companyId,employeeId:first.id,status:'ACTIVE' as const,requestingUserId:users[0]!,requesterPermissions:['access.role.manage'],requestId:randomUUID(),reason:'Restore after scope review'};
      await client.companyMembership.update({where:{id:first.membershipId},data:{branchScopeMode:'DEFAULT_BRANCH_ONLY',defaultBranchId:disabled.id}});
      await assert.rejects(status.execute(command),e=>(e as any).getResponse().code==='EMPLOYEE_BRANCH_SCOPE_UNAVAILABLE');
      await client.companyMembership.update({where:{id:first.membershipId},data:{branchScopeMode:'SELECTED_BRANCHES',defaultBranchId:active.id,branchScopes:{create:{branchId:active.id}}}});
      await assert.rejects(status.execute({...command,requesterBranchIds:[disabled.id]}),e=>(e as any).getStatus()===403);
      assert.equal((await client.employeeAccessProfile.findUniqueOrThrow({where:{id:first.id}})).status,'SUSPENDED');
      await status.execute({...command,requesterBranchIds:[active.id]});
      assert.equal((await client.companyMembership.findUniqueOrThrow({where:{id:first.membershipId}})).status,'ACTIVE');
      await client.employeeAccessProfile.update({where:{id:second.id},data:{status:'DRAFT'}});
      await client.companyMembership.update({where:{id:second.membershipId},data:{status:'DRAFT',branchScopeMode:'DEFAULT_BRANCH_ONLY',defaultBranchId:disabled.id}});
      await assert.rejects(complete.completeDraft({companyId,employeeId:second.id,requestingUserId:users[0]!,requestId:randomUUID()}),e=>(e as any).getResponse().code==='EMPLOYEE_BRANCH_SCOPE_UNAVAILABLE');
      await client.companyMembership.update({where:{id:second.membershipId},data:{defaultBranchId:active.id}});
      await complete.completeDraft({companyId,employeeId:second.id,requestingUserId:users[0]!,requesterBranchIds:[active.id],requestId:randomUUID()});
      assert.equal((await client.employeeAccessProfile.findUniqueOrThrow({where:{id:second.id}})).status,'ACTIVE');
      assert.equal(await client.aiConversation.count({where:{companyId,userId:users[4]!}}),1);
    });
  }finally{
    await client.reimbursementRequest.deleteMany({where:{companyId}});await client.aiConversation.deleteMany({where:{companyId}});
    await client.employeeAccessProfile.deleteMany({where:{companyId}});await client.auditLog.deleteMany({where:{companyId}});
    await client.companyMembership.deleteMany({where:{companyId}});await client.role.deleteMany({where:{id:{in:roleIds}}});
    await client.companyPlanTerm.deleteMany({where:{companyId}});await client.branch.deleteMany({where:{companyId}});await client.company.deleteMany({where:{id:companyId}});
    await client.user.deleteMany({where:{id:{in:users}}});await client.$disconnect();
  }
});
