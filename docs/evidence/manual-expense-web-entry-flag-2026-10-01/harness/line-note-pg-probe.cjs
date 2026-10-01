
const assert=require('node:assert/strict');
const {writeFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const {resolve}=require('node:path');
const req=createRequire(resolve('apps/api/package.json'));
req('reflect-metadata'); const {NestFactory}=req('@nestjs/core');
const root=resolve('apps/api/dist/manual-flag-e2e/apps/api/src');
const {AppModule}=require(root+'/app.module.js');
const {PrismaService}=require(root+'/common/database/prisma.service.js');
const {PermissionResolverService}=require(root+'/modules/access-control/application/permission-resolver.service.js');
const {CaptureLineExpenseNoteUseCase}=require(root+'/modules/expenses/application/use-cases/expense-document.use-case.js');
(async()=>{
 const url=new URL(process.env.DATABASE_URL);assert.equal(url.host,'127.0.0.1:25463');assert.equal(url.pathname,'/manual_flag_e2e');
 const app=await NestFactory.createApplicationContext(AppModule,{logger:false});const db=app.get(PrismaService).client;const resolver=app.get(PermissionResolverService);const capture=app.get(CaptureLineExpenseNoteUseCase);const companyId='seed-local-company',userId='seed-qa-user-staff';const results=[];
 try{for(const enabled of [true,false]){await db.companyFeatureEntitlement.update({where:{companyId_featureKey:{companyId,featureKey:'expenses.manual'}},data:{enabled}});const access=await resolver.resolveAccess(userId,companyId);const ctx={...access,companyId,userId,requestId:'manual-flag-line-note-pg',scopes:{}};const count=await db.expenseRecord.count({where:{companyId}});for(let attempt=1;attempt<=2;attempt++){try{await capture.execute(ctx,{messageText:'ค่ากาแฟ 65 บาท',captureHints:{amount:'65',description:'ค่ากาแฟ',expenseDate:'2026-10-01',vatMode:'NO_VAT'},lineMessageId:'manual-e2e-note-'+enabled,lineEventId:'manual-e2e-event-'+enabled,branchId:'seed-local-branch-ho'});results.push({enabled,attempt,status:'created'});}catch(e){results.push({enabled,attempt,status:e.getStatus?.(),message:e.message,permissions:access.permissions.filter(p=>p.startsWith('expense.'))});}}const after=await db.expenseRecord.count({where:{companyId}});assert.equal(after,count,'failed note must have no draft side effects');}writeFileSync('/tmp/manual-flag-e2e-20261001/evidence/line-note-pg.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({permissions,...r})=>r),null,2));assert(results.every(r=>r.status===400&&r.message==='Invalid draft idempotency key'));}
 finally{await db.companyFeatureEntitlement.update({where:{companyId_featureKey:{companyId,featureKey:'expenses.manual'}},data:{enabled:true}});await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
