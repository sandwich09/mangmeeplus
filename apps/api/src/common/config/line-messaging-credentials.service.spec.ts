import { it } from 'node:test';
import assert from 'node:assert/strict';
import { LineMessagingCredentialsService } from './line-messaging-credentials.service';
import { encryptCredential } from '../../modules/system-partner-management/domain/logic/credential-cipher.logic';
const config={credentialEncryptionKey:Buffer.alloc(32,7),lineMessagingChannelId:'channel',lineMessagingChannelSecret:'env-secret',lineMessagingChannelAccessToken:'env-token'};
const payload=()=>({schemaVersion:1,channelId:'channel',channelSecret:'new-secret',accessToken:'new-token',tokenExpiresAt:new Date(Date.now()+60000).toISOString()});
it('uses unpublished environment only; each request resolves the current published revision and exact signature observation',async()=>{
 let row:any=null;const db={platformLineCredential:{findUnique:async()=>row,updateMany:async({where,data}:any)=>{if(row.secretVersion===where.secretVersion&&!row.inboundVerifiedAt)Object.assign(row,data);}}};
 const service=new LineMessagingCredentialsService({client:db} as any,config as any);
 assert.equal((await service.get()).accessToken,'env-token');row={secretVersion:4,encryptedSecretJson:'invalid-legacy',runtimePublishedAt:null};assert.equal((await service.get()).source,'ENVIRONMENT');
 row={...row,runtimePublishedAt:new Date(),encryptedSecretJson:encryptCredential(JSON.stringify(payload()),config.credentialEncryptionKey)};
 const first=await service.get();assert.equal(first.accessToken,'new-token');assert.equal(first.version,4);
 row.secretVersion=5;await service.observeSignature(first);assert.equal(row.inboundVerifiedAt,undefined);await service.observeSignature(await service.get());assert.ok(row.inboundVerifiedAt);
});
for(const fault of ['decrypt','database','wrong-channel','expired','unsupported'])it(`fails closed for published ${fault} without environment fallback`,async()=>{
 const value=payload();if(fault==='wrong-channel')value.channelId='other';if(fault==='expired')value.tokenExpiresAt=new Date(0).toISOString();if(fault==='unsupported')value.schemaVersion=2;
 const service=new LineMessagingCredentialsService({client:{platformLineCredential:{findUnique:async()=>{if(fault==='database')throw Error('private-db-detail');return {secretVersion:1,runtimePublishedAt:new Date(),encryptedSecretJson:fault==='decrypt'?'bad':encryptCredential(JSON.stringify(value),config.credentialEncryptionKey)};}}}} as any,config as any);
 if(fault==='expired'){const incoming=await service.get(undefined,'INBOUND');assert.equal(incoming.channelSecret,'new-secret');assert.equal(incoming.accessToken,undefined);}
 await assert.rejects(service.get(),error=>(error as any).getStatus?.()===503&&!String(error).includes('private-db-detail'));
});
