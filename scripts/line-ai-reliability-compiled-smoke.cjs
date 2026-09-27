/** Repeatable deterministic integration proof, after building API + Gateway + contracts/config.
 * Requires migrated isolated local PostgreSQL and Redis; binds localhost ports18991/18992.
 * Exercises compiled Nest ValidationPipe, HTTP, API-issued grants, durable reservations,
 * provider wrapper, settlements and replay denial. Provider Responses are explicit fixtures;
 * this is NOT a semantic-quality, real-vendor, deployed-environment or LINE acceptance test.
 * Usage: AI_BUDGET_RESERVATION_TEST_DATABASE_URL=<isolated URL> node scripts/line-ai-reliability-compiled-smoke.cjs
 */
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {writeFileSync,readFileSync}=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {resolve}=require('node:path');
const root=resolve(__dirname,'..');
// Explicit synthetic local services only; the test creates and deletes its own tagged rows.
const databaseUrl=process.env.AI_BUDGET_RESERVATION_TEST_DATABASE_URL;
assert.ok(databaseUrl, 'AI_BUDGET_RESERVATION_TEST_DATABASE_URL_REQUIRED');
const database=new URL(databaseUrl);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(database.hostname)
 && /^\/watchdog_(?:bms_)?ai_reliability_[a-z0-9_]+$/.test(database.pathname), 'DEDICATED_LOCAL_TEST_DATABASE_REQUIRED');
const redisUrl=process.env.LINE_RELIABILITY_TEST_REDIS_URL??'redis://127.0.0.1:16389/12';
const redis=new URL(redisUrl);
assert.ok(redis.protocol==='redis:' && ['127.0.0.1','localhost','[::1]'].includes(redis.hostname)
 && redis.port && redis.port!=='6379' && /^\/(?:[1-9]|1[0-5])$/.test(redis.pathname), 'DEDICATED_LOCAL_TEST_REDIS_REQUIRED');
Object.assign(process.env,{APP_ENV:'local',NODE_ENV:'test',SERVICE_NAME:'compiled-v2-proof',
 DATABASE_URL:databaseUrl,REDIS_URL:redisUrl,
 AI_GATEWAY_INTERNAL_URL:'http://127.0.0.1:18992/v1',ERP_CORE_INTERNAL_URL:'http://127.0.0.1:18991/v1',AI_GATEWAY_INTERNAL_SECRET:'synthetic-local-compiled-v2-proof-only',
 MODEL_PROVIDER:'openai',OPENAI_API_KEY:'synthetic-provider-fixture-only',OPENAI_MODEL:'gpt-4.1-mini',OPENAI_PROCESSING_REGION:'global',
 APPROVED_AI_MODEL_IDS:'gpt-4.1-mini',APPROVED_AI_PROVIDERS:'openai',APPROVED_AI_REGIONS:'global',
 LINE_AI_AGENT_ORCHESTRATION_ENABLED:'true',LINE_AI_AGENT_RUNTIME:'strands-local',LINE_AI_RELIABILITY_V2_MODE:'off',
 AI_GATEWAY_TRANSPORT:'http',RATE_LIMIT_ENABLED:'false',S3_BUCKET:'local-proof',S3_ENDPOINT:'http://127.0.0.1:9',S3_PUBLIC_ENDPOINT:'http://127.0.0.1:9',
 S3_ACCESS_KEY_ID:'synthetic',S3_SECRET_ACCESS_KEY:'synthetic',AWS_EC2_METADATA_DISABLED:'true',S3_FORCE_PATH_STYLE:'true',AI_MONTHLY_BUDGET_SATANG:'1000000',AI_MONTHLY_BUDGET_SATANG_CEILING:'1000000'});
const ra=createRequire(root+'/apps/api/package.json'),rg=createRequire(root+'/apps/ai-gateway/package.json');
const ac=root+'/apps/api/dist/apps/api/src/',gc=root+'/apps/ai-gateway/dist/apps/ai-gateway/src/';
ra('reflect-metadata');
const {NestFactory}=ra('@nestjs/core'),{ValidationPipe}=ra('@nestjs/common');
const {PrismaService}=ra(ac+'common/database/prisma.service.js');
const {LineAiBudgetAuthorityService}=ra(ac+'modules/line-ai/application/line-ai-budget-authority.service.js');
const {LineConversationContextService}=ra(ac+'modules/line-ai/application/line-conversation-context.service.js');
const {AiGatewayClient}=ra(ac+'modules/line-ai/infrastructure/ai-gateway.client.js');
const contracts=ra('@watchdog-bms/contracts');
let api,gw,db,companyId,userId; const originalFetch=globalThis.fetch; const providerCalls=[],http=[];
const rawText='ทำไมธุรกิจควรแยกกำไรออกจากเงินสด';
let semantic;
globalThis.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.origin==='https://api.openai.com') {
  assert.equal(url.pathname,'/v1/responses'); const body=JSON.parse(init.body); providerCalls.push(body);
  assert.ok(providerCalls.length<=2,'UNEXPECTED_EXTRA_MODEL_CALL');
  const text=providerCalls.length===1?JSON.stringify({intent:'BUSINESS_READ_QUESTION',confidence:0.99,language:'th',semanticSubrequests:semantic}):JSON.stringify({answers:[{index:0,status:'handled',text:'กำไรเป็นผลจากรายรับหักค่าใช้จ่าย ส่วนเงินสดคือเงินที่มีพร้อมใช้',sourceRefIds:[]}]});
  return new Response(JSON.stringify({status:'completed',output_text:text,usage:{input_tokens:48,output_tokens:14,input_tokens_details:{cached_tokens:0}}}),{status:200,headers:{'content-type':'application/json'}});
 }
 assert.ok(['http://127.0.0.1:18991','http://127.0.0.1:18992'].includes(url.origin),'EXTERNAL_HTTP_BLOCKED '+url.origin);
 http.push(url.pathname); return originalFetch(input,init);
};
(async()=>{
 api=await NestFactory.create(ra(ac+'app.module.js').AppModule,{logger:false,abortOnError:false});
 api.setGlobalPrefix('v1');api.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await api.listen(18991,'127.0.0.1');
 gw=await NestFactory.create(rg(gc+'app.module.js').AppModule,{logger:false,abortOnError:false});
 gw.setGlobalPrefix('v1');gw.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await gw.listen(18992,'127.0.0.1');
 const headers={'content-type':'application/json','x-internal-secret':process.env.AI_GATEWAY_INTERNAL_SECRET};
 const capRes=await fetch('http://127.0.0.1:18992/v1/internal/ai/line-reliability-capabilities',{method:'POST',headers,body:'{}'});const capability=await capRes.json();assert.equal(capRes.status,200);assert.equal(capability.ready,true,JSON.stringify(capability));
 db=api.get(PrismaService).client;const tag='compiled-v2-'+randomUUID().slice(0,8);companyId=tag;userId=tag+'-user'; const membershipId=tag+'-member',modelId='gpt-4.1-mini';
 await db.company.create({data:{id:companyId,name:companyId}});await db.user.create({data:{id:userId,displayName:'Synthetic compiled proof',status:'ACTIVE'}});
 await db.companyMembership.create({data:{id:membershipId,companyId,userId,status:'ACTIVE'}});await db.lineChannelBinding.create({data:{companyId,messagingChannelId:tag+'-oa'}});
 await db.companyAiConfiguration.create({data:{companyId,modelId,monthlyBudgetSatang:1000000,budgetMode:'SPLIT',chatMonthlyBudgetSatang:500000,ocrMonthlyBudgetSatang:500000}});
 const owner={companyId,userId,membershipId,channel:'line',channelKind:'USER',messagingChannelId:tag+'-oa',chatKeyHash:'a'.repeat(64)};
 const ctx=await api.get(LineConversationContextService).admit(owner);
 const event=await db.lineWebhookEventLog.create({data:{companyId,webhookEventId:tag+'-event',eventType:'message',status:'received'}});
 const built=await contracts.createLineAiInputEvidence({turnKey:tag+'-turn',parts:[{partId:'part-0',eventIdHash:'b'.repeat(64),acceptedAtMs:Date.now(),rawText}]});assert.ok(built);
 const p=built.inputEvidence.parts[0];semantic=[{index:0,kind:'general',goal:'อธิบายความต่างระหว่างกำไรกับเงินสด',requiredEvidence:[],requestedFilters:{},dependsOn:[],evidenceRefs:[{partId:p.partId,startUtf16:0,endUtf16:p.rawText.length,rawSha256:p.rawSha256}]}];
 const authority=api.get(LineAiBudgetAuthorityService);
 let grant=await authority.issue({authorityKind:'webhook_event',authorityId:event.id,owner:{kind:'PRIVATE',owner,epoch:ctx.lifecycleEpoch},turnKey:built.inputEvidence.turnKey,attemptKey:tag+'-attempt',inputDigest:built.inputEvidence.joinedSha256,requestKind:'TEXT',admittedAtMs:Date.now(),coalescingExtraMs:0,lane:'public',model:{provider:'openai',modelId,region:'global'},modelContextTokens:1047576,modelMaxOutputTokens:32768,tariff:{version:'synthetic-deterministic-integration:1',provider:'openai',modelId,region:'global',thbPerUsd:33,usdPerMTok:{input:0.4,output:1.6,cacheRead:0.1,cacheWrite:0.4}},allowedProfileIds:['line-intake-text/2']});assert.ok(grant,'API_ISSUED_GRANT');
 const client=api.get(AiGatewayClient),valueCandidates=await contracts.extractValueCandidatesV2(built.inputEvidence,'2026-09-27');
 const intake=await client.requestLineIntakeRoute({requestId:tag+'-intake',companyId,userId,messageText:built.messageText,inputEvidence:built.inputEvidence,valueCandidates,contractCapabilities:['input-evidence-v2','budget-envelope-v2'],budgetGrantV2:grant,permissions:['ai.tool.invoke'],locale:'th-TH'});
 assert.equal(intake.status,'ROUTED',JSON.stringify(intake));assert.equal(intake.semanticSubrequests[0].kind,'general');
 grant=await authority.narrow(grant,'general',['line-answer/2']);assert.ok(grant);assert.equal(grant.nextOrdinal,1);
 const body={requestId:tag+'-answer',webhookEventId:event.webhookEventId,messageText:built.messageText,inputEvidence:built.inputEvidence,valueCandidates,budgetGrantV2:grant,contractCapabilities:['input-evidence-v2','budget-envelope-v2'],semanticSubrequests:intake.semanticSubrequests,userContext:{lineUserId:tag+'-line',internalUserId:userId,companyId,membershipId,permissions:['ai.tool.invoke'],roles:[],branchIds:[],locationIds:[],locale:'th-TH',chatKeyHash:owner.chatKeyHash}};
 const res=await fetch('http://127.0.0.1:18992/v1/internal/ai/line-turn',{method:'POST',headers,body:JSON.stringify(body)});const answer=await res.json();assert.equal(res.status,200);assert.equal(answer.semanticCoverage?.[0]?.status,'handled',JSON.stringify(answer));
 const rows=await db.aiBudgetReservation.findMany({where:{companyId},orderBy:{invocationKey:'asc'}});assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>Number(r.invocationKey.split('#').at(-1))),[0,1]);assert.ok(rows.every(r=>r.status==='SETTLED'),JSON.stringify(rows.map(r=>({status:r.status,ordinal:Number(r.invocationKey.split('#').at(-1))}))));
 const usage=await db.aiUsageEvent.findMany({where:{companyId}});assert.equal(usage.length,2);assert.equal(providerCalls.length,2);assert.equal(http.filter(p=>p.endsWith('/budget-step')).length,2);assert.equal(http.filter(p=>p.endsWith('/budget-settle')).length,2);
 const retry=await fetch('http://127.0.0.1:18992/v1/internal/ai/line-turn',{method:'POST',headers,body:JSON.stringify(body)});const duplicate=await retry.json();assert.equal(providerCalls.length,2,'REPLAY_MUST_NOT_REDISPATCH_PROVIDER');
 const result={passed:true,provenance:'deterministic provider fixture; actual compiled Nest API/Gateway HTTP + real PostgreSQL; no real vendor quality claim',capability,modelCalls:providerCalls.length,ordinals:rows.map(r=>Number(r.invocationKey.split('#').at(-1))),reservationStates:rows.map(r=>r.status),usageRows:usage.length,duplicateError:duplicate.errorCode??null,httpPaths:http,sourceHashes:Object.fromEntries(['common/usage/ai-budget-provider.js','modules/line-ai/application/use-cases/line-ai-turn.use-case.js'].map(p=>[p,createHash('sha256').update(readFileSync(gc+p)).digest('hex')]))};
 if(process.env.LINE_RELIABILITY_TEST_RESULT_PATH) writeFileSync(process.env.LINE_RELIABILITY_TEST_RESULT_PATH,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{globalThis.fetch=originalFetch;if(db&&companyId){await db.lineWebhookEventLog.deleteMany({where:{companyId}});await db.company.deleteMany({where:{id:companyId}});if(userId)await db.user.deleteMany({where:{id:userId}})}if(gw)await gw.close();if(api)await api.close()});
