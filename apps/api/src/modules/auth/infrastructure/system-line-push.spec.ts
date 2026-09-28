import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINE_RETRY_AFTER_MAX_SECONDS,
  buildTemporaryPasswordFlexMessage,
  parseLineRetryAfterSeconds,
  pushLineMessages,
} from './system-line-push';

describe('pushLineMessages exit (R-B1)', () => {
  it('opens web links outside LINE and keeps LIFF links and the caller retry key as they were', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ key: string | null; body: string }> = [];
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        calls.push({ key: new Headers(init?.headers).get('X-Line-Retry-Key'), body: String(init?.body) });
        return new Response('', { status: 200 });
      }) as typeof fetch;
      const messages = [{ type: 'flex', altText: 'แพ็กเกจ', contents: { type: 'bubble', footer: { type: 'box', contents: [
        { type: 'button', action: { type: 'uri', label: 'ดูแพ็กเกจ', uri: 'https://app/companies/c/billing' } },
        { type: 'button', action: { type: 'uri', label: 'เลือกแพ็กเกจ', uri: 'https://liff.line.me/1-a/start' } },
      ] } } }];
      const snapshot = structuredClone(messages);
      assert.deepEqual(await pushLineMessages({ token: 't', lineUserId: 'U1', messages, retryKey: 'key-1' }), { ok: true });
      assert.equal(calls[0]!.key, 'key-1');
      assert.match(calls[0]!.body, /"uri":"https:\/\/app\/companies\/c\/billing\?openExternalBrowser=1"/);
      assert.match(calls[0]!.body, /"uri":"https:\/\/liff\.line\.me\/1-a\/start"/);
      assert.deepEqual(messages, snapshot);
    } finally { globalThis.fetch = originalFetch; }
  });
});

describe('temporary password flex card', () => {
  const card = buildTemporaryPasswordFlexMessage('Tmp_9xYz', ['ใช้ได้ถึง 27 ส.ค. 2569 21:55']) as any;

  it('puts the password in the one-tap copy button and shows it in the body as the retype fallback', () => {
    assert.deepEqual(card.contents.footer.contents[0].action, {
      type: 'clipboard', label: 'คัดลอกรหัส', clipboardText: 'Tmp_9xYz',
    });
    assert.ok(JSON.stringify(card.contents.body).includes('Tmp_9xYz'));
    assert.ok(JSON.stringify(card.contents.body).includes('ใช้ได้ถึง'));
  });

  it('NEVER leaks the password into the altText notification preview', () => {
    assert.equal(card.altText.includes('Tmp_9xYz'), false);
    assert.ok(card.altText.length > 0);
  });
});


describe('parseLineRetryAfterSeconds', () => {
  it('takes LINE own schedule when it is a schedule anyone would choose', () => {
    assert.equal(parseLineRetryAfterSeconds('17'), 17);
    assert.equal(parseLineRetryAfterSeconds(String(LINE_RETRY_AFTER_MAX_SECONDS)), LINE_RETRY_AFTER_MAX_SECONDS);
  });

  it('ignores a header it does not understand', () => {
    for (const value of [null, '', 'soon', '0', '-5']) {
      assert.equal(parseLineRetryAfterSeconds(value), undefined, JSON.stringify(value));
    }
  });

  // The monthly-quota 429 can name weeks. Obeying it literally parks "ร้านของคุณพร้อมใช้แล้ว"
  // until the quota resets — a deferral nobody chose, on the one message this flow exists to send.
  it('clamps a quota-length deferral to six hours', () => {
    assert.equal(parseLineRetryAfterSeconds('2592000'), LINE_RETRY_AFTER_MAX_SECONDS);
    assert.equal(parseLineRetryAfterSeconds(String(LINE_RETRY_AFTER_MAX_SECONDS + 1)), LINE_RETRY_AFTER_MAX_SECONDS);
  });
});

import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import { encryptCredential } from '../../system-partner-management/domain/logic/credential-cipher.logic';
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
