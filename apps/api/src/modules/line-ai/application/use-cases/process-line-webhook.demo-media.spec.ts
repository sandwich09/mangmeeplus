import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ProcessLineWebhookUseCase } from './process-line-webhook.use-case';

it('demo-att media reads only the chat company attachment and never LINE credentials or fetch', async () => {
  const bytes = Buffer.from('owned-by-one'); let reads = 0; let query: any;
  const subject: any = Object.create(ProcessLineWebhookUseCase.prototype);
  subject.config = { uploadMaxBytes: 1000 };
  subject.lineCredentials = { get: async () => assert.fail('virtual media must not read LINE credentials') };
  subject.prisma = { client: { company: { findUnique: async () => ({ reportClassification: 'DEMO' }) }, attachmentObject: { findFirst: async ({ where }: any) => {
    query = where;
    return where.companyId === 'one' && where.id === 'owned' ? { bucket: 'b', objectKey: 'one/owned', objectVersionId: 'v1', originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: bytes.length, checksumSha256: createHash('sha256').update(bytes).digest('hex') } : null;
  } } } };
  subject.demoAttachmentStorage = { getObject: async (input: any) => { assert.equal(input.objectKey, 'one/owned'); reads++; return { bytes }; } };
  const result = await subject.downloadLineMedia('demo-att:owned', 'image', 'untrusted.jpg', bytes.length, 'Vdemoone');
  assert.equal(result.ok, true); assert.equal(result.media.fileName, 'receipt.jpg'); assert.equal(result.media.bytes, bytes);
  assert.equal(result.media.contentBase64, bytes.toString('base64')); assert.equal(query.status, 'ACTIVE'); assert.equal(query.deletedAt, null);
  assert.deepEqual(query.metadataJson, { path: ['demoChat'], equals: true });
  assert.equal((await subject.downloadLineMedia('demo-att:owned', 'image', undefined, undefined, 'Vdemotwo')).ok, false);
  assert.equal((await subject.downloadLineMedia('demo-att:owned', 'image')).ok, false);
  assert.equal((await subject.downloadLineMedia('line-real-id', 'image', undefined, undefined, 'Vdemoone')).ok, false);
  assert.equal((await subject.downloadLineMedia('demo-att:owned', 'image', undefined, 1001, 'Vdemoone')).reason, 'oversize_declared');
  assert.equal(reads, 1);
});

it('DEMO gets the reliability-v2 owner with rollout settings off; CUSTOMER keeps rollout rules', async () => {
  const subject: any = Object.create(ProcessLineWebhookUseCase.prototype);
  subject.config = { lineAiReliabilityV2Mode: 'off', lineAiDeliveryPlanV2Enabled: false, lineAiReliabilityV2CompanyIds: [], lineAiDeliveryPlanV2WriteCompanyIds: [] };
  let classification = 'DEMO';
  subject.prisma = { client: { company: { findUnique: async () => ({ reportClassification: classification }) } } };
  const event = { lineUserId: 'Vdemoone', messagingChannelId: 'demo-web' };
  subject.deliveryAccess = new WeakMap([[event, { membershipId: 'member' }]]);
  assert.equal((await subject.conversationOwner('one', 'owner', event)).companyId, 'one');
  classification = 'CUSTOMER'; assert.equal(await subject.conversationOwner('one', 'owner', event), null);
});
