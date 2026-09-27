import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import type { RequestContext } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaReimbursementRepository } from './infrastructure/prisma-reimbursement.repository';
import { LineReimbursementDraftUseCase } from './application/use-cases/line-reimbursement-draft.use-case';
import type { ReimbursementDraftActionOwner, ReimbursementDraftPreparedCommand } from './domain/models/reimbursement.model';

const databaseUrl = process.env['BILLING_TEST_DATABASE_URL'];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe('LINE reimbursement draft actions on actual PostgreSQL', { skip: !databaseUrl }, () => {
  it('serializes duplicate create, update CAS, cancel race, lost response and source revocation', async () => {
    const parsed = new URL(databaseUrl!);
    assert.equal(parsed.hostname, '127.0.0.1');
    assert.equal(parsed.port, '15439');
    assert.equal(parsed.pathname, '/watchdog_bms_ai_reliability_20260927');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 20 }) });
    const tag = `line-reimbursement-${randomUUID()}`;
    const companyId = `${tag}-company`, userId = `${tag}-user`, membershipId = `${tag}-membership`;
    const channelId = `${tag}-oa`, chatKeyHash = sha(`${tag}:chat`), ownerEpoch = 3;
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    let branchId = '';
    const owner: ReimbursementDraftActionOwner = {
      companyId, actorUserId: userId, membershipId, channel: 'line', channelKind: 'USER',
      messagingChannelId: channelId, chatKeyHash, ownerEpoch,
    };
    const ctx: RequestContext = {
      requestId: `${tag}-request`, authSubject: userId, authProvider: 'line', companyId, userId, membershipId,
      roles: ['STAFF'], permissions: ['line.ai.query', 'ai.tool.invoke', 'reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.read_own'], scopes: {},
    };
    const now = () => new Date();
    const actionInput = (id = randomUUID(), operation: 'CREATE' | 'UPDATE' = 'CREATE') => ({
      ...owner, id, taskId: randomUUID(), actionOrdinal: 1, intentKeyHash: sha(`${tag}:${id}:intent`), operation,
      expiresAt: new Date(Date.now() + 120_000),
    });
    const command = (operation: 'CREATE' | 'UPDATE', amount: string, update?: { requestId: string; expectedUpdatedAt: Date }, attachment?: { id: string; checksumSha256: string | null; originalFileName: string }): ReimbursementDraftPreparedCommand => ({
      schemaVersion: 1, operation,
      ...(update ? { requestId: update.requestId, expectedRequestUpdatedAt: update.expectedUpdatedAt.toISOString() } : {}),
      requesterUserId: userId, requesterDisplayNameSnapshot: 'PG claim owner', branchId,
      reason: 'customer visit', currency: 'THB', receiptRequirementStatus: attachment ? 'ATTACHED' : 'REQUIRED',
      header: { amount, categoryKey: 'travel', incurredDate: '2026-09-20T00:00:00.000Z' },
      lines: [{ lineNo: 1, incurredDate: '2026-09-20T00:00:00.000Z', description: 'taxi', categoryKey: 'travel',
        categoryLabelSnapshot: 'เดินทาง', amount, ...(attachment ? { attachmentId: attachment.id,
          attachmentSnapshot: { id: attachment.id, uploadedByUserId: userId, checksumSha256: attachment.checksumSha256, fileName: attachment.originalFileName } } : {}) }],
      policyProof: { currency: 'THB', requireReceipt: true, allowMissingReceiptWithReason: false }, invalidateSignatures: operation === 'UPDATE',
    });
    const makePreview = async (input: ReturnType<typeof actionInput>, prepared: ReimbursementDraftPreparedCommand) => {
      const opened = await repo.findOrCreateDraftAction(input);
      const confirmationDigest = sha(`${input.id}:confirmation`);
      const saved = await repo.saveDraftActionPreview({ owner, actionId: input.id, expectedUpdatedAt: opened.updatedAt,
        commandJson: prepared, previewJson: { schemaVersion: 1, actionId: input.id, previewRevision: 1, confirmationDigest },
        sourceProofJson: { validated: true }, confirmationDigest, previewRevision: 1,
        requestId: prepared.requestId, expectedRequestUpdatedAt: prepared.expectedRequestUpdatedAt ? new Date(prepared.expectedRequestUpdatedAt) : undefined,
        expiresAt: new Date(Date.now() + 60_000) });
      assert.ok(saved);
      assert.equal(await repo.markDraftActionWebRendered({ owner, actionId: input.id, previewRevision: 1,
        confirmationDigest, receiptId: `web:${sha(input.id)}`, now: now() }), true);
      return { confirmationDigest };
    };
    const apply = (input: ReturnType<typeof actionInput>, confirmationDigest: string, requestId: string = input.id) => repo.applyDraftActionAtomic({
      owner, actionId: input.id, previewRevision: 1, confirmationDigest, requestId,
      traceRequestId: `${tag}:${input.id}`, now: now(), sharedMessagingChannelId: channelId,
    });

    try {
      await client.company.create({ data: { id: companyId, name: 'PG reimbursement writer' } });
      await client.user.create({ data: { id: userId, displayName: 'PG claim owner' } });
      branchId = (await client.branch.create({ data: { companyId, code: `PG${tag.slice(-8)}`, name: 'PG branch', type: 'BRANCH' } })).id;
      await client.companyMembership.create({ data: { id: membershipId, companyId, userId, status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: branchId } });
      await client.aiConversation.create({ data: { id: `line-v2:${sha(tag)}`, companyId, userId, membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: channelId, chatKeyHash, lifecycleEpoch: ownerEpoch } });

      // Duplicate webhook/process workers share the one API-owned action and never create another row.
      const duplicate = actionInput();
      const duplicates = await Promise.all(Array.from({ length: 8 }, () => repo.findOrCreateDraftAction(duplicate)));
      assert.deepEqual(new Set(duplicates.map((item) => item.id)), new Set([duplicate.id]));
      assert.equal(await client.reimbursementDraftAction.count({ where: { companyId, intentKeyHash: duplicate.intentKeyHash } }), 1);
      assert.equal(await repo.cancelDraftCollection({ owner, actionId: duplicate.id, sharedMessagingChannelId: channelId }), 'cancelled');

      // UPDATE keeps the preview's exact request revision; a web winner is never overwritten.
      const request = await client.reimbursementRequest.create({ data: { companyId, branchId, requesterUserId: userId,
        requesterDisplayNameSnapshot: 'PG claim owner', reason: 'original', categoryKey: 'travel', categoryLabelSnapshot: 'เดินทาง',
        amount: '100.0000', outstandingAmount: '100.0000', currency: 'THB', incurredDate: new Date('2026-09-20T00:00:00.000Z'),
        receiptRequirementStatus: 'REQUIRED', createdByUserId: userId } });
      await client.reimbursementLine.upsert({ where: { reimbursementRequestId_lineNo: { reimbursementRequestId: request.id, lineNo: 1 } },
        create: { companyId, reimbursementRequestId: request.id, lineNo: 1, incurredDate: new Date('2026-09-20T00:00:00.000Z'),
          description: 'original taxi', categoryKey: 'travel', categoryLabelSnapshot: 'เดินทาง', amount: '100.0000' },
        update: { description: 'original taxi', amount: '100.0000' } });
      const updateAction = actionInput(randomUUID(), 'UPDATE');
      const updateProof = await makePreview(updateAction, command('UPDATE', '125.0000', { requestId: request.id, expectedUpdatedAt: request.updatedAt }));
      const webRevision = new Date(request.updatedAt.getTime() + 1_000);
      await client.reimbursementRequest.update({ where: { id: request.id }, data: { reason: 'web winner', updatedAt: webRevision } });
      assert.deepEqual(await apply(updateAction, updateProof.confirmationDigest, request.id), { kind: 'stale' });
      const afterCas = await client.reimbursementRequest.findUniqueOrThrow({ where: { id: request.id }, include: { lines: true } });
      assert.equal(afterCas.reason, 'web winner'); assert.equal(afterCas.amount.toString(), '100'); assert.equal(afterCas.lines[0]!.description, 'original taxi');
      await repo.markDraftActionStale({ owner, actionId: updateAction.id, previewRevision: 1, confirmationDigest: updateProof.confirmationDigest });
      await client.reimbursementClaimSignature.create({ data: { companyId, reimbursementRequestId: request.id,
        role: 'REQUESTER', signatureAttachmentId: `${tag}-signature`, signedByUserId: userId } });
      const successfulUpdate = actionInput(randomUUID(), 'UPDATE');
      const successfulProof = await makePreview(successfulUpdate, command('UPDATE', '125.0000', { requestId: request.id, expectedUpdatedAt: afterCas.updatedAt }));
      assert.equal((await apply(successfulUpdate, successfulProof.confirmationDigest, request.id)).kind, 'applied');
      const afterUpdate = await client.reimbursementRequest.findUniqueOrThrow({ where: { id: request.id }, include: { lines: true, claimSignatures: true } });
      assert.equal(afterUpdate.amount.toString(), '125'); assert.equal(afterUpdate.lines[0]!.amount.toString(), '125');
      assert.equal(afterUpdate.claimSignatures.length, 0, 'material LINE update invalidates the prior claim signature atomically');

      // Confirm and cancel take the same row lock; one terminal decision wins with at most one request.
      const raced = actionInput(), racedProof = await makePreview(raced, command('CREATE', '80.0000'));
      const raceResults = await Promise.all([
        apply(raced, racedProof.confirmationDigest),
        repo.cancelDraftAction({ owner, actionId: raced.id, previewRevision: 1, confirmationDigest: racedProof.confirmationDigest,
          now: now(), sharedMessagingChannelId: channelId }),
      ]);
      const racedRow = await client.reimbursementDraftAction.findUniqueOrThrow({ where: { id: raced.id } });
      assert.ok(['APPLIED', 'CANCELLED'].includes(racedRow.status));
      assert.equal(await client.reimbursementRequest.count({ where: { companyId, id: raced.id } }), racedRow.status === 'APPLIED' ? 1 : 0);
      assert.ok(raceResults.length === 2);

      // Simulated lost HTTP response: replaying the same confirm returns the receipt and one audit/request.
      const lost = actionInput(), lostProof = await makePreview(lost, command('CREATE', '90.0000'));
      const committed = await apply(lost, lostProof.confirmationDigest);
      assert.equal(committed.kind, 'applied');
      const recovered = await apply(lost, lostProof.confirmationDigest);
      assert.equal(recovered.kind, 'already_applied');
      assert.equal((recovered as any).request.id, lost.id);
      assert.equal(await client.reimbursementRequest.count({ where: { companyId, id: lost.id } }), 1);
      assert.equal(await client.auditLog.count({ where: { companyId, targetType: 'reimbursement_request', targetId: lost.id,
        action: 'reimbursement.request.create_line_ai' } }), 1);

      // Source evidence revoked after preview makes the action STALE and creates no placeholder request.
      const attachment = await client.attachmentObject.create({ data: { companyId, branchId, uploadedByUserId: userId, status: 'ACTIVE',
        storageProvider: 'local', bucket: 'synthetic', objectKey: `${tag}/receipt`, originalFileName: 'receipt.png', mimeType: 'image/png', byteSize: 10,
        checksumSha256: sha('receipt') } });
      const revoked = actionInput(), revokedProof = await makePreview(revoked, command('CREATE', '70.0000', undefined, attachment));
      await client.attachmentObject.update({ where: { id: attachment.id }, data: { status: 'DELETED' } });
      const useCase = new LineReimbursementDraftUseCase(repo, { validate: async () => undefined } as any, {
        lineAiReimbursementDraftWriteEnabled: true, reimbursementWriteQuiesce: false, lineMessagingChannelId: channelId,
      } as any);
      assert.deepEqual(await useCase.get({ ctx, owner, actionId: revoked.id }),
        { status: 'stale', actionId: revoked.id, errorCode: 'source_changed' },
        'delivery re-reads current attachment/source state instead of trusting the saved preview');
      const revokedResult = await useCase.confirm({ ctx, owner, actionId: revoked.id, previewRevision: 1,
        confirmationDigest: revokedProof.confirmationDigest, now: now() });
      assert.deepEqual(revokedResult, { status: 'stale', actionId: revoked.id, errorCode: 'source_changed' });
      assert.equal((await client.reimbursementDraftAction.findUniqueOrThrow({ where: { id: revoked.id } })).status, 'STALE');
      assert.equal(await client.reimbursementRequest.count({ where: { companyId, id: revoked.id } }), 0);
    } finally {
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    }
  });
});
