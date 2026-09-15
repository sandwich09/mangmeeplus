import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SetSharedLineCredentialUseCase } from './set-shared-line-credential.use-case';
import { decryptCredential } from '../../domain/logic/credential-cipher.logic';
import { hashPassword } from '../../../auth/domain/logic/password-credential.logic';

const key=Buffer.alloc(32,7),password='SyntheticPassword1!',context={permissions:['system.shared_line_credential.manage'],userId:'u',companyId:'c',membershipId:'m',sessionId:'s',requestId:'r'} as any;
const cmd=()=>({channelId:'1234567890',channelSecret:'a'.repeat(32),accessToken:'synthetic-token-value',expectedVersion:0,rotationId:randomUUID(),reason:'Rotate test credential',password});
function fixture(){let row:any=null,allowed=true;const audit:any[]=[];const credential={status:'ACTIVE',mustChangePassword:false,updatedAt:new Date(),passwordHash:hashPassword(password)};
  const db:any={companyMembership:{findFirst:async()=>allowed?{id:'m'}:null},authSession:{findFirst:async()=>({id:'s'})},userCredential:{findUnique:async()=>({...credential})},
    platformLineCredential:{findUnique:async()=>row,create:async({data}:any)=>row={id:'id',secretVersion:1,createdAt:new Date(),updatedAt:new Date(),...data},
      update:async({data}:any)=>row={...row,...data,secretVersion:row.secretVersion+1}},auditLog:{create:async({data}:any)=>audit.push(data)},$executeRaw:async()=>{},$queryRaw:async()=>{}};
  db.$transaction=async(fn:any)=>fn(db);
  return {service:new SetSharedLineCredentialUseCase({client:db} as any,{credentialEncryptionKey:key,lineMessagingChannelId:'1234567890'} as any),
    read:()=>row,audit,revoke:()=>{allowed=false;},credential};
}
describe('shared Messaging publication',()=>{
 it('encrypts publication, distinguishes token/signature and replays the exact save without another provider read',async()=>{
   const f=fixture(),savedFetch=globalThis.fetch,input=cmd();let calls=0;
   globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.line.me/v2/oauth/verify');assert.equal(new URLSearchParams(String(init?.body)).get('access_token'),input.accessToken);return Response.json({client_id:input.channelId,expires_in:86400});};
   try{const result=await f.service.execute(context,input);assert.equal(result.version,1);assert.equal(result.inboundVerifiedAt,null);assert.ok(result.tokenValidatedAt);
     assert.equal(JSON.parse(decryptCredential(f.read().encryptedSecretJson,key)).accessToken,input.accessToken);
     assert.doesNotMatch(JSON.stringify([result,f.audit]),/synthetic-token-value|aaaaaaaaaaaaaaaa/);
     assert.deepEqual(await f.service.execute(context,input),result);assert.equal(calls,1);assert.equal(f.audit.length,1);
     await assert.rejects(f.service.execute(context,{...input,accessToken:'a-different-synthetic-token'}),{status:409});assert.equal(calls,1);
   }finally{globalThis.fetch=savedFetch;}
 });
 it('denies copied role context, different channel and wrong password before provider I/O',async()=>{
   const f=fixture(),old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
   try{await assert.rejects(f.service.execute({...context,permissions:[]},cmd()),{status:403});
     await assert.rejects(f.service.execute(context,{...cmd(),channelId:'other'}),{status:409});
     await assert.rejects(f.service.execute(context,{...cmd(),password:'wrong'}),{status:403});
     f.revoke();await assert.rejects(f.service.execute(context,cmd()),{status:403});assert.equal(calls,0);assert.equal(f.read(),null);
   }finally{globalThis.fetch=old;}
 });
 for(const failure of ['wrong-channel','bad-expiry','unavailable','revoked','credential-changed'])it(`does not publish after ${failure}`,async()=>{
   const f=fixture(),old=globalThis.fetch;globalThis.fetch=async()=>{
     if(failure==='unavailable')throw Error('synthetic transport fault');if(failure==='revoked')f.revoke();
     if(failure==='credential-changed')f.credential.updatedAt=new Date(Date.now()+1000);
     return Response.json({client_id:failure==='wrong-channel'?'foreign':'1234567890',expires_in:failure==='bad-expiry'?0:86400});};
   try{await assert.rejects(f.service.execute(context,cmd()));assert.equal(f.read(),null);assert.equal(f.audit.length,0);}finally{globalThis.fetch=old;}
 });
});
