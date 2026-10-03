import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
  createLineAiInputEvidence,
  extractValueCandidatesV2,
  type AiBudgetGrantV2,
  type LineAiInputEvidenceV2,
  type LineAiValueCandidatesV2,
} from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaReimbursementRepository } from '../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { LineReimbursementDraftUseCase } from '../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
import { LineReimbursementDraftService } from './line-reimbursement-draft.service';
import { LineReimbursementDraftAdapterService } from './line-reimbursement-draft-adapter.service';
import { LineConversationContextService, lineConversationId } from './line-conversation-context.service';
import { freezeAcceptedLedgerRequest } from './line-ledger-accepted-request';
import { ProcessLineWebhookUseCase } from './use-cases/process-line-webhook.use-case';
import { buildLineDeliveryPlan, deliveryHash, initialDeliveryBatchStates, lineDeliveryPlanId } from '../domain/logic/line-delivery-plan.logic';
import type { ErpToolContext } from '../domain/ports/erp-read-tool.port';

const databaseUrl = process.env['BILLING_TEST_DATABASE_URL'];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe('LINE reimbursement runtime adapter on actual PostgreSQL', { skip: !databaseUrl }, () => {
  it('keeps one current action, rejects transplanted/stale choices, blocks overflow, and writes no request before confirm', async () => {
    const parsed = new URL(databaseUrl!);
    assert.equal(parsed.hostname, '127.0.0.1');
    assert.ok(parsed.pathname.endsWith('_ci') || parsed.port === '15439' && parsed.pathname === '/watchdog_bms_ai_reliability_20260927', `refusing to write to ${parsed.pathname}: only a disposable local *_ci database`);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, max: 12 }) });
    const tag = `reimbursement-adapter-${randomUUID()}`;
    const companyId = `${tag}-company`, channelId = `${tag}-oa`;
    const prisma = { client } as any;
    const repo = new PrismaReimbursementRepository(prisma, {} as any);
    const config = { lineAiReimbursementDraftWriteEnabled: true, reimbursementWriteQuiesce: false,
      lineMessagingChannelId: channelId } as any;
    const drafts = new LineReimbursementDraftUseCase(repo, { validate: async () => undefined } as any, config);
    const service = new LineReimbursementDraftService(drafts);
    const actors = new Map<string, {
      userId: string; membershipId: string; chatKeyHash: string; grant: AiBudgetGrantV2;
      evidence: LineAiInputEvidenceV2; candidates: LineAiValueCandidatesV2; ctx: ErpToolContext;
    }>();
    const authority = { resolvePrivateOwner: async (_grant: AiBudgetGrantV2, _digest: string,
      scope: { companyId: string; userId: string; membershipId?: string }) => {
      const actor = actors.get(scope.userId);
      return actor && scope.companyId === companyId && scope.membershipId === actor.membershipId
        ? { kind: 'PRIVATE' as const, owner: { companyId, userId: actor.userId, membershipId: actor.membershipId,
            channel: 'line' as const, channelKind: 'USER' as const, messagingChannelId: channelId,
            chatKeyHash: actor.chatKeyHash }, epoch: 1, taskRevision: 7 }
        : null;
    } } as any;
    const adapter = new LineReimbursementDraftAdapterService(prisma, repo, authority, service, drafts);
    let primaryBranchId = '';

    const makeActor = async (suffix: string) => {
      const userId = `${tag}-user-${suffix}`, membershipId = `${tag}-membership-${suffix}`;
      const chatKeyHash = sha(`${tag}:chat:${suffix}`).slice(0, 16), turnKey = `turn:${suffix}:${randomUUID()}`;
      const built = await createLineAiInputEvidence({ turnKey, parts: [
        { partId: `${suffix}-reason`, eventIdHash: sha(`${suffix}:reason`), acceptedAtMs: 1, rawText: 'customer visit' },
        { partId: `${suffix}-date`, eventIdHash: sha(`${suffix}:date`), acceptedAtMs: 2, rawText: '2026-09-20' },
        { partId: `${suffix}-description`, eventIdHash: sha(`${suffix}:description`), acceptedAtMs: 3, rawText: 'taxi' },
        { partId: `${suffix}-amount`, eventIdHash: sha(`${suffix}:amount`), acceptedAtMs: 4, rawText: '100.00' },
      ] });
      assert.ok(built);
      const candidates = await extractValueCandidatesV2(built.inputEvidence, '2026-09-27');
      assert.ok(candidates);
      const authorityId = `${tag}-ledger-${suffix}`;
      const grant: AiBudgetGrantV2 = { version: 2, turnKey, authorityKind: 'ledger_entry', authorityId,
        channelOwnerDigest: sha(`${tag}:owner:${suffix}`), attemptKey: `attempt:${suffix}`, monthKey: '2026-09',
        payerCompanyId: companyId, model: { provider: 'openai', modelId: 'gpt-test', region: 'global' },
        allowedProfileIds: ['line-control/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
        maxTurnSlots: 4, maxRepairs: 1, admittedAtMs: Date.now() - 1_000,
        workDeadlineAtMs: Date.now() + 60_000, finalDeadlineAtMs: Date.now() + 63_000,
        nonce: `nonce:${suffix}`, issuerVersion: 'adapter-pg-test', nextOrdinal: 0, membershipEpoch: 1,
        taskRevision: 7, signature: sha(`${tag}:signature:${suffix}`) };
      await client.user.create({ data: { id: userId, displayName: `Claim owner ${suffix}` } });
      await client.companyMembership.create({ data: { id: membershipId, companyId, userId, status: 'ACTIVE',
        branchScopeMode: 'ALL_BRANCHES', defaultBranchId: primaryBranchId } });
      const conversationOwner = { companyId, userId, membershipId, channel: 'line' as const,
        channelKind: 'USER' as const, messagingChannelId: channelId, chatKeyHash };
      await client.aiConversation.create({ data: { id: lineConversationId(conversationOwner),
        companyId, userId, membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: channelId,
        chatKeyHash, lifecycleEpoch: 1 } });
      await client.lineLedgerDelivery.create({ data: { id: authorityId, companyId, userId,
        webhookEventId: `${tag}-event-${suffix}`, entryId: `${tag}-entry-${suffix}`, status: 'PREPARING',
        expiresAt: new Date(Date.now() + 120_000), acceptedRequestJson: { request: {
          requestId: `${tag}-request-${suffix}`, intakeIntent: 'REIMBURSEMENT_REQUEST_START',
          inputEvidence: built.inputEvidence, budgetGrantV2: grant,
          userContext: { companyId, internalUserId: userId, membershipId },
          semanticSubrequests: [
            { index: 0, kind: 'write', goal: 'reimbursement create draft', requiredEvidence: [], requestedFilters: {}, dependsOn: [] },
          ],
        } } } });
      const ctx: ErpToolContext = { requestId: `${tag}-request-${suffix}`, companyId, userId, membershipId,
        permissions: ['line.ai.query', 'ai.tool.invoke', 'reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.read_own'],
        roles: ['STAFF'], branchIds: undefined, locationIds: undefined, locale: 'th-TH',
        inputEvidence: built.inputEvidence, valueCandidatesV2: candidates, budgetGrantV2: grant };
      const actor = { userId, membershipId, chatKeyHash, grant, evidence: built.inputEvidence, candidates, ctx };
      actors.set(userId, actor);
      return actor;
    };
    const data = (result: Awaited<ReturnType<LineReimbursementDraftAdapterService['getOptions']>>) => result.data as any;
    const fullRef = (evidence: LineAiInputEvidenceV2, partId: string) => {
      const part = evidence.parts.find(item => item.partId === partId)!;
      return { partId, startUtf16: 0, endUtf16: part.rawText.length, rawSha256: part.rawSha256 };
    };

    try {
      await client.company.create({ data: { id: companyId, name: 'PG reimbursement adapter' } });
      primaryBranchId = (await client.branch.create({ data: { companyId, code: 'PG00', name: 'Branch 00', type: 'BRANCH' } })).id;
      await client.branch.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ companyId,
        code: `PG${String(index + 1).padStart(2, '0')}`, name: `Branch ${String(index + 1).padStart(2, '0')}`, type: 'BRANCH' as const })) });
      const first = await makeActor('first'), second = await makeActor('second');
      const stageOwner = { companyId, userId: first.userId, membershipId: first.membershipId, channel: 'line', channelKind: 'USER', messagingChannelId: channelId, chatKeyHash: first.chatKeyHash };
      const staged = await client.attachmentObject.create({ data: { companyId, status: 'ACTIVE', storageProvider: 'db', bucket: 'synthetic', objectKey: `${tag}/receipt`, originalFileName: 'my receipt.png', mimeType: 'image/png', byteSize: 1, uploadedByUserId: first.userId, checksumSha256: sha('receipt'), metadataJson: { lineReimbursementOwner: stageOwner, lineReimbursementEpoch: 1 } } });
      const otherStage = await client.attachmentObject.create({ data: { companyId, status: 'ACTIVE', storageProvider: 'db', bucket: 'synthetic', objectKey: `${tag}/other`, originalFileName: 'other receipt.png', mimeType: 'image/png', byteSize: 1, uploadedByUserId: first.userId, checksumSha256: sha('other'), metadataJson: { lineReimbursementOwner: { ...stageOwner, chatKeyHash: second.chatKeyHash }, lineReimbursementEpoch: 1 } } });

      const firstRow = await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: first.grant.authorityId } });
      const originalAccepted = firstRow.acceptedRequestJson as any;
      const multiple = structuredClone(originalAccepted);
      multiple.request.semanticSubrequests.push({ ...multiple.request.semanticSubrequests[0], index: 1, goal: 'another reimbursement' });
      await client.lineLedgerDelivery.update({ where: { id: firstRow.id }, data: { acceptedRequestJson: multiple } });
      const collision = await adapter.getOptions(first.ctx, { operation: 'CREATE', subrequestIndex: 0 });
      assert.equal(collision.errorCode, 'FINANCIAL_ACTION_SELECTION_REQUIRED');
      assert.equal(await client.reimbursementDraftAction.count({ where: { companyId } }), 0);
      await client.lineLedgerDelivery.update({ where: { id: firstRow.id }, data: { acceptedRequestJson: originalAccepted } });
      const firstPage = await adapter.getOptions(first.ctx, { operation: 'CREATE', subrequestIndex: 0 });
      assert.equal(firstPage.status, 'ok');
      assert.equal(data(firstPage).options.pages.branch.returned, 20);
      assert.equal(data(firstPage).options.pages.branch.hasMore, true);
      assert.equal(data(firstPage).options.choices.some((choice: any) => 'raw' in choice), false,
        'public choices never disclose domain identifiers');
      for (const kind of ['BRANCH', 'REQUESTER', 'CATEGORY', 'SOURCE', 'ATTACHMENT', 'TARGET', 'LINE']) {
        assert.ok(data(firstPage).options.choices.filter((choice: any) => choice.kind === kind).length <= 20);
      }
      const firstAction = data(firstPage).actionLocator;
      const displayOwner = { companyId, userId: first.userId, membershipId: first.membershipId, channel: 'line' as const, channelKind: 'USER' as const, messagingChannelId: channelId, chatKeyHash: first.chatKeyHash };
      const displayCtx = { authProvider: 'line' as const, requestId: first.ctx.requestId!, authSubject: first.userId, userId: first.userId, companyId, membershipId: first.membershipId, permissions: first.ctx.permissions, roles: first.ctx.roles ?? [], scopes: {} };
      const displayOptions = await adapter.readDisplayOptions({ ctx: displayCtx, owner: displayOwner, ownerEpoch: 1, actionId: firstAction.actionId });
      assert.deepEqual(displayOptions, data(firstPage).options, 'user sees the same exact current API options as the model');
      assert.equal(await adapter.readDisplayOptions({ ctx: { ...displayCtx, scopes: { branchIds: [] } }, owner: displayOwner, ownerEpoch: 1, actionId: firstAction.actionId }), null, 'revoked branch scope cannot print stale options');
      assert.equal(await adapter.readDisplayOptions({ ctx: displayCtx, owner: { ...displayOwner, chatKeyHash: 'f'.repeat(64) }, ownerEpoch: 1, actionId: firstAction.actionId }), null, 'another owner cannot print this action');
      const firstChoice = data(firstPage).options.choices.find((choice: any) => choice.kind === 'BRANCH');
      assert.ok(firstChoice);

      const secondPage = await adapter.getOptions(first.ctx, { operation: 'CREATE', subrequestIndex: 0,
        taskId: firstAction.taskId, actionId: firstAction.actionId,
        continuation: data(firstPage).options.pages.branch.continuation });
      assert.equal(secondPage.status, 'ok');
      assert.deepEqual(data(secondPage).actionLocator, firstAction);
      assert.ok(data(secondPage).options.choices.filter((choice: any) => choice.kind === 'BRANCH').length <= 20);
      const selectedBranch = data(secondPage).options.choices.find((choice: any) => choice.kind === 'BRANCH');
      assert.ok(selectedBranch);
      const selected = await adapter.getOptions(first.ctx, { operation: 'CREATE', subrequestIndex: 0,
        taskId: firstAction.taskId, actionId: firstAction.actionId, branchChoiceId: selectedBranch.choiceId });
      assert.equal(selected.status, 'ok');
      assert.equal(await client.reimbursementDraftAction.count({ where: { companyId, actorUserId: first.userId } }), 1,
        'retry/continuation must reuse the one current action');
      assert.ok(data(selected).options.choices.some((choice: any) => choice.kind === 'ATTACHMENT' && choice.label === 'my receipt.png'));
      assert.equal(data(selected).options.choices.some((choice: any) => choice.label === 'other receipt.png'), false);
      assert.ok((await client.attachmentObject.findUniqueOrThrow({ where: { id: staged.id } })).branchId, 'explicit branch choice scopes this owner fresh upload');
      assert.equal((await client.attachmentObject.findUniqueOrThrow({ where: { id: otherStage.id } })).branchId, null, 'another chat staging object remains untouched');
      const selectedData = data(selected), requesterChoiceId = selectedData.options.selected.requesterChoiceId;
      assert.ok(requesterChoiceId);

      const secondOptions = await adapter.getOptions(second.ctx, { operation: 'CREATE', subrequestIndex: 0 });
      const transplanted = await adapter.getOptions(second.ctx, { operation: 'CREATE', subrequestIndex: 0,
        ...data(secondOptions).actionLocator, branchChoiceId: selectedBranch.choiceId });
      assert.equal((data(transplanted).reimbursementDraft as any).status, 'stale', 'another action cannot transplant an opaque choice');

      const amount = first.candidates.amounts.find(item => item.source.partId === 'first-amount')!;
      const date = first.candidates.dates.find(item => item.source.partId === 'first-date' && item.isoDate === '2026-09-20')!;
      assert.ok(amount && date);
      const category = selectedData.options.choices.find((choice: any) => choice.kind === 'CATEGORY' && choice.label === 'เดินทาง');
      assert.ok(category);
      const proposal = { schemaVersion: 1, taskId: firstAction.taskId,
        taskRevision: selectedData.options.taskRevision, operation: 'CREATE',
        branchChoiceId: selectedData.options.selected.branchChoiceId, requesterChoiceId,
        fields: { reason: { value: 'customer visit', proof: { kind: 'USER_TEXT', refs: [fullRef(first.evidence, 'first-reason')] } } },
        lineChanges: [{ operation: 'ADD', values: {
          incurredDate: { value: date.isoDate, proof: { kind: 'USER_TEXT', refs: [date.source], candidateId: date.candidateId } },
          description: { value: 'taxi', proof: { kind: 'USER_TEXT', refs: [fullRef(first.evidence, 'first-description')] } },
          categoryChoiceId: category.choiceId,
          amount: { value: amount.value, proof: { kind: 'USER_TEXT', refs: [amount.source], candidateId: amount.candidateId } },
        } }],
      };
      const overflow = await adapter.preview({ ...first.ctx, valueCandidatesV2: { ...first.candidates,
        completeness: 'overflow', amounts: [], dates: [], periods: [] } }, { action: firstAction, proposal }, 'CREATE');
      assert.equal((overflow.data as any).reimbursementDraft.errorCode, 'evidence_overflow');
      const preview = await adapter.preview(first.ctx, { action: firstAction, proposal }, 'CREATE');
      assert.equal((preview.data as any).reimbursementDraft.status, 'preview');
      assert.equal(preview.sourceRefs[0]?.sourceType, 'ACTION');
      assert.equal(preview.sourceRefs[0]?.entityId, firstAction.actionId);
      assert.equal(await client.reimbursementRequest.count({ where: { companyId } }), 0);
      assert.equal(await client.auditLog.count({ where: { companyId } }), 0);

      const secondBranch = data(secondOptions).options.choices.find((choice: any) => choice.kind === 'BRANCH'
        && choice.label.startsWith('Branch 00'));
      assert.ok(secondBranch);
      await client.branch.update({ where: { id: primaryBranchId }, data: { name: 'Reordered branch' } });
      const stale = await adapter.getOptions(second.ctx, { operation: 'CREATE', subrequestIndex: 0,
        ...data(secondOptions).actionLocator, branchChoiceId: secondBranch.choiceId });
      assert.equal((data(stale).reimbursementDraft as any).status, 'stale');
      assert.equal(await client.reimbursementRequest.count({ where: { companyId } }), 0);
      assert.equal(await client.auditLog.count({ where: { companyId } }), 0);

      // Start a separate UPDATE after cancelling the collection. Removing line 1 before setting
      // line 2 proves stable line refs survive array reordering and the replacement is dense.
      const secondOwner = { companyId, actorUserId: second.userId, membershipId: second.membershipId,
        channel: 'line' as const, channelKind: 'USER' as const, messagingChannelId: channelId,
        chatKeyHash: second.chatKeyHash, ownerEpoch: 1 };
      assert.equal(await repo.cancelDraftCollection({ owner: secondOwner,
        actionId: data(secondOptions).actionLocator.actionId, sharedMessagingChannelId: channelId }), 'cancelled');
      const target = await client.reimbursementRequest.create({ data: { companyId, branchId: primaryBranchId,
        requesterUserId: second.userId, requesterDisplayNameSnapshot: 'Claim owner second', reason: 'original reason',
        categoryKey: 'travel', categoryLabelSnapshot: 'เดินทาง', amount: '300.0000', outstandingAmount: '300.0000',
        currency: 'THB', incurredDate: new Date('2026-09-19T00:00:00.000Z'), receiptRequirementStatus: 'REQUIRED',
        createdByUserId: second.userId } });
      await client.reimbursementLine.updateMany({ where: { reimbursementRequestId: target.id, lineNo: 1 }, data: {
        incurredDate: new Date('2026-09-18T00:00:00.000Z'), description: 'first line', categoryKey: 'travel',
        categoryLabelSnapshot: 'เดินทาง', amount: '100.0000' } });
      await client.reimbursementLine.create({ data: { companyId, reimbursementRequestId: target.id, lineNo: 2,
        incurredDate: new Date('2026-09-19T00:00:00.000Z'), description: 'second line', categoryKey: 'meals',
        categoryLabelSnapshot: 'อาหาร', amount: '200.0000' } });
      const updateParent = await client.lineLedgerDelivery.findUniqueOrThrow({ where: { id: second.grant.authorityId } });
      const updateAccepted = structuredClone(updateParent.acceptedRequestJson) as any;
      updateAccepted.request.requestId += '-update';
      second.ctx.requestId = updateAccepted.request.requestId;
      await client.lineLedgerDelivery.update({ where: { id: updateParent.id }, data: { acceptedRequestJson: updateAccepted } });
      const updateOptions = await adapter.getOptions(second.ctx, { operation: 'UPDATE', subrequestIndex: 0 });
      assert.equal(updateOptions.status, 'ok');
      const targetChoice = data(updateOptions).options.choices.find((choice: any) => choice.kind === 'TARGET');
      assert.ok(targetChoice);
      const updateSelected = await adapter.getOptions(second.ctx, { operation: 'UPDATE', subrequestIndex: 0,
        ...data(updateOptions).actionLocator, targetRef: targetChoice.choiceId });
      const updateData = data(updateSelected);
      const lineChoices = updateData.options.choices.filter((choice: any) => choice.kind === 'LINE');
      assert.equal(lineChoices.length, 2);
      const line1 = lineChoices.find((choice: any) => choice.details.lineNo === 1);
      const line2 = lineChoices.find((choice: any) => choice.details.lineNo === 2);
      assert.ok(line1 && line2);
      const updateProposal = { schemaVersion: 1, taskId: updateData.actionLocator.taskId,
        taskRevision: updateData.options.taskRevision, operation: 'UPDATE', targetRef: targetChoice.choiceId,
        fields: { reason: { value: 'customer visit', proof: { kind: 'USER_TEXT', refs: [fullRef(second.evidence, 'second-reason')] } } },
        lineChanges: [
          { operation: 'REMOVE', lineRef: line1.choiceId, proof: { kind: 'USER_TEXT', refs: [fullRef(second.evidence, 'second-reason')] } },
          { operation: 'SET', lineRef: line2.choiceId, values: {
            description: { value: 'taxi', proof: { kind: 'USER_TEXT', refs: [fullRef(second.evidence, 'second-description')] } },
          } },
        ],
      };
      const updatePreview = await adapter.preview(second.ctx,
        { action: updateData.actionLocator, proposal: updateProposal }, 'UPDATE');
      const updateResult = (updatePreview.data as any).reimbursementDraft;
      assert.equal(updateResult.status, 'preview');
      assert.equal(updateResult.preview.after.lines.length, 1);
      assert.equal(updateResult.preview.after.lines[0].lineNo, 1);
      assert.equal(updateResult.preview.after.lines[0].description, 'taxi');
      assert.equal(updateResult.preview.after.lines[0].amount, '200.0000');
      const unchanged = await client.reimbursementRequest.findUniqueOrThrow({ where: { id: target.id }, include: { lines: true } });
      assert.equal(unchanged.reason, 'original reason');
      assert.equal(unchanged.lines.length, 2, 'preview never applies the replacement');

      // A later exact task selection uses only its stored clause for money, while authority
      // still receives the live selection grant/digest. No user retypes the known fields.
      const retainedActor = await makeActor('retained');
      const originalInput = (await createLineAiInputEvidence({ turnKey: retainedActor.evidence.turnKey, parts: [
        ...retainedActor.evidence.parts.map(part => ({ ...part, acceptedAtMs: Date.parse('2026-09-27T01:00:00Z') })),
        { partId: 'sibling', eventIdHash: sha('sibling'), acceptedAtMs: Date.parse('2026-09-27T01:00:00Z'), rawText: 'other claim 999.00 2026-09-21' },
      ] }))!;
      const retainedRefs = originalInput.inputEvidence.parts.slice(0, 4).map(part => fullRef(originalInput.inputEvidence, part.partId));
      const originalSemantic = [{ index: 0, kind: 'write' as const, writeIntent: 'REIMBURSEMENT_REQUEST_START' as const,
        goal: 'customer visit taxi', requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: retainedRefs },
        { index: 1, kind: 'write' as const, writeIntent: 'REIMBURSEMENT_REQUEST_START' as const, goal: 'other claim', requiredEvidence: [], requestedFilters: {}, dependsOn: [], evidenceRefs: [fullRef(originalInput.inputEvidence, 'sibling')] }];
      const retainedOwner = { companyId, userId: retainedActor.userId, membershipId: retainedActor.membershipId, channel: 'line' as const,
        channelKind: 'USER' as const, messagingChannelId: channelId, chatKeyHash: retainedActor.chatKeyHash };
      const originalRequest = { requestId: `${tag}-original-retained`, webhookEventId: `${tag}-original-event`,
        ...originalInput, messagePreviewHash: sha(originalInput.messageText).slice(0, 16), budgetGrantV2: retainedActor.grant,
        semanticSubrequests: originalSemantic, userContext: { companyId, internalUserId: retainedActor.userId, membershipId: retainedActor.membershipId,
          lineUserId: '[REDACTED]', permissions: retainedActor.ctx.permissions, roles: ['STAFF'], locale: 'th-TH' } };
      const frozen = freezeAcceptedLedgerRequest({ request: originalRequest, ownerEpoch: 1,
        conversationId: lineConversationId(retainedOwner), accessFingerprint: 'retained-fp' },
        { companyId, userId: retainedActor.userId, webhookEventId: originalRequest.webhookEventId, turnId: originalRequest.requestId,
          chatKey: `${tag}:chat:retained`, messagingChannelId: channelId });
      await client.lineLedgerDelivery.update({ where: { id: retainedActor.grant.authorityId }, data: { acceptedRequestJson: frozen as any, webhookEventId: originalRequest.webhookEventId } });
      const taskId = randomUUID();
      const tasks = [{ taskId, revision: 5, state: 'active', kind: 'write', userGoal: 'two claims',
        subrequests: originalSemantic.map(item => ({ index: item.index, kind: item.kind, goal: item.goal, status: 'pending' })),
        sourceRevisionLocators: [{ sourceType: 'LINE_ACCEPTED_TASK_0_0', sourceId: retainedActor.grant.authorityId, revision: frozen.digest }, { sourceType: 'LINE_ACCEPTED_TASK_1_1', sourceId: retainedActor.grant.authorityId, revision: frozen.digest }] }];
      await client.aiConversation.update({ where: { id: lineConversationId(retainedOwner) }, data: { taskStateJson: { version: 2, tasks }, stateExpiresAt: new Date(Date.now() + 60_000) } });
      const selectedInput = (await createLineAiInputEvidence({ turnKey: 'selection-turn', parts: [{ partId: 'control', eventIdHash: sha('select'), acceptedAtMs: Date.now(), rawText: `/task choose ${taskId} 4 0` }] }))!;
      const selectedCandidates = (await extractValueCandidatesV2(selectedInput.inputEvidence, '2026-09-27'))!;
      const selectedGrant = { ...retainedActor.grant, turnKey: 'selection-turn', authorityId: `${tag}-selected-ledger`, signature: sha('selected-grant') };
      const selectedRequest = { ...originalRequest, requestId: `${tag}-selected-request`, ...selectedInput, budgetGrantV2: selectedGrant,
        semanticSubrequests: [{ ...originalSemantic[0]!, evidenceRefs: [fullRef(selectedInput.inputEvidence, 'control')] }],
        retainedTaskSource: { taskRef: { taskId, taskRevision: 4, subrequestIndex: 0 }, inputEvidence: originalInput.inputEvidence, semanticSubrequest: originalSemantic[0] } };
      await client.lineLedgerDelivery.create({ data: { id: selectedGrant.authorityId, companyId, userId: retainedActor.userId,
        webhookEventId: `${tag}-selected-event`, entryId: `${tag}-selected-entry`, status: 'PREPARING', expiresAt: new Date(Date.now() + 60_000),
        acceptedRequestJson: { request: selectedRequest } as any } });
      const selectedCtx = { ...retainedActor.ctx, requestId: selectedRequest.requestId, inputEvidence: selectedInput.inputEvidence, valueCandidatesV2: selectedCandidates, budgetGrantV2: selectedGrant };
      const historical = (await extractValueCandidatesV2(originalInput.inputEvidence, '2026-09-27'))!;
      const selectedOptions = await adapter.getOptions(selectedCtx, { operation: 'CREATE', subrequestIndex: 0 });
      assert.equal(selectedOptions.status, 'ok');
      const branchChoice = data(selectedOptions).options.choices.find((item: any) => item.kind === 'BRANCH' && item.label.startsWith('Branch 01'));
      const chosen = data(await adapter.getOptions(selectedCtx, { operation: 'CREATE', subrequestIndex: 0, ...data(selectedOptions).actionLocator, branchChoiceId: branchChoice.choiceId }));
      const historicalAmount = historical.amounts.find(item => item.source.partId === 'retained-amount')!;
      const historicalDate = historical.dates.find(item => item.source.partId === 'retained-date')!;
      const retainedProposal = { ...proposal, taskId: chosen.actionLocator.taskId, taskRevision: chosen.options.taskRevision,
        branchChoiceId: chosen.options.selected.branchChoiceId, requesterChoiceId: chosen.options.selected.requesterChoiceId,
        fields: { reason: { value: 'customer visit', proof: { kind: 'USER_TEXT', refs: [fullRef(originalInput.inputEvidence, 'retained-reason')] } } },
        lineChanges: [{ operation: 'ADD', values: {
          incurredDate: { value: historicalDate.isoDate, proof: { kind: 'USER_TEXT', refs: [historicalDate.source], candidateId: historicalDate.candidateId } },
          description: { value: 'taxi', proof: { kind: 'USER_TEXT', refs: [fullRef(originalInput.inputEvidence, 'retained-description')] } },
          categoryChoiceId: chosen.options.choices.find((item: any) => item.kind === 'CATEGORY' && item.label === 'เดินทาง').choiceId,
          amount: { value: historicalAmount.value, proof: { kind: 'USER_TEXT', refs: [historicalAmount.source], candidateId: historicalAmount.candidateId } },
        } }] };
      const siblingProposal = structuredClone(retainedProposal);
      siblingProposal.fields.reason = { value: 'other claim 999.00 2026-09-21', proof: { kind: 'USER_TEXT', refs: [fullRef(originalInput.inputEvidence, 'sibling')] } };
      const rejectedSibling = await adapter.preview(selectedCtx, { action: chosen.actionLocator, proposal: siblingProposal }, 'CREATE');
      assert.equal((rejectedSibling.data as any).reimbursementDraft.errorCode, 'invalid_provenance');
      const retainedPreview = await adapter.preview(selectedCtx, { action: chosen.actionLocator, proposal: retainedProposal }, 'CREATE');
      assert.equal((retainedPreview.data as any).reimbursementDraft.status, 'preview');
      assert.equal((retainedPreview.data as any).reimbursementDraft.preview.after.lines[0].amount, '100.0000');
      assert.equal(await client.reimbursementRequest.count({ where: { companyId } }), 1, 'only the explicit UPDATE fixture exists; retained preview never commits');
      const context = new LineConversationContextService(prisma);
      const event = { webhookEventId: selectedRequest.webhookEventId, lineUserId: `${tag}:chat:retained`, messagingChannelId: channelId,
        replyToken: 'synthetic', ...selectedInput };
      const binding = { owner: retainedOwner, id: lineConversationId(retainedOwner), epoch: 1 };
      const flow: any = Object.create(ProcessLineWebhookUseCase.prototype);
      Object.assign(flow, { prisma, contextV2: context, boundConversations: new WeakMap([[event, binding]]),
        semanticTaskMappings: new WeakMap([[event, [{ index: 0, taskId, subrequestIndex: 0, kind: 'write', goal: 'customer visit taxi' }]]]),
        retainedTaskSources: new WeakMap(), deliveryAccess: new WeakMap([[event, { fingerprint: 'retained-fp' }]]),
        deliverReply: async () => undefined });
      await flow.settleSemanticTask(event, [{ index: 0, status: 'needs_user', question: 'confirm preview' }], [chosen.actionLocator.actionId]);
      const taskBeforeConfirm = (await context.projection(retainedOwner))!.tasks[0]!;
      assert.equal(taskBeforeConfirm.sourceRevisionLocators!.length, 2);
      const domainCtx = { requestId: selectedCtx.requestId!, authSubject: retainedActor.userId, authProvider: 'line' as const,
        companyId, userId: retainedActor.userId, membershipId: retainedActor.membershipId, roles: ['STAFF'], permissions: selectedCtx.permissions, scopes: {} };
      const confirmPreview = async (preview: any, parentId: string) => {
        const now = new Date().toISOString(), expiresAt = new Date(Date.now() + 60_000).toISOString();
        const planId = lineDeliveryPlanId('LEDGER', parentId);
        const control = { action: 'reimbursement_draft_confirm' as const, actionId: preview.actionId,
          previewRevision: preview.previewRevision, confirmationDigest: preview.confirmationDigest };
        const plan = buildLineDeliveryPlan({ producerKind: 'LEDGER', producerId: parentId, createdAt: now, readyAt: now,
          expiresAt, firstDispatchDeadlineAt: expiresAt, businessResult: null,
          authorization: { v: 2, kind: 'PRIVATE', issuedAt: now, expiresAt, actor: { userId: retainedActor.userId, companyId,
            membershipId: retainedActor.membershipId, requestId: domainCtx.requestId, accessFingerprint: 'retained-fp', channelId,
            channel: 'line', channelKind: 'USER', recipientHash: sha(event.lineUserId), chatKeyHash: retainedActor.chatKeyHash,
            conversationId: binding.id, ownerEpoch: 1 }, proofs: [] },
          control: { kind: 'REIMBURSEMENT_DRAFT_CONFIRM', actionId: preview.actionId, previewRevision: preview.previewRevision,
            confirmationDigest: preview.confirmationDigest, expiresAt, requiredItemIds: [`${planId}:item:0`] },
          answer: { status: 'COMPLETE', pendingSubrequestIds: [], items: [{ kind: 'decision_diff', text: JSON.stringify(preview.after), required: true, sourceProofIds: [] }] },
          controlMessage: { type: 'text', text: 'confirm the displayed draft', quickReply: { items: [{ type: 'action', action: {
            type: 'postback', label: 'confirm', data: new URLSearchParams(Object.fromEntries(Object.entries(control).map(([key, value]) => [key, String(value)]))).toString() } }] } } });
        const states = initialDeliveryBatchStates(plan).map(state => ({ ...state, status: 'ACCEPTED' as const, acceptedAt: now }));
        await client.lineDeliveryPlan.create({ data: { id: planId, ledgerDeliveryId: parentId, companyId, userId: retainedActor.userId, status: 'ACCEPTED',
          acceptedAt: new Date(), expiresAt: new Date(expiresAt), purgeAt: new Date(expiresAt), planJson: plan as any,
          planHash: deliveryHash(plan), batchStateJson: states as any } });
        const confirmed = await service.confirm({ ctx: domainCtx, owner: retainedOwner, ownerEpoch: 1, control, deliveryPlanId: planId });
        assert.equal(confirmed.status, 'applied');
        return confirmed;
      };
      await confirmPreview((retainedPreview.data as any).reimbursementDraft.preview, selectedGrant.authorityId);
      const offeredSecond = await flow.remainingTaskChoiceMessages(event);
      assert.equal(offeredSecond.length, 1);
      await flow.finishReimbursementTask(retainedOwner, 1, chosen.actionLocator.actionId, true);
      let taskAfterConfirm = (await context.projection(retainedOwner))!.tasks[0]!;
      assert.deepEqual(taskAfterConfirm.subrequests.map(item => item.status), ['handled', 'pending']);
      assert.equal(taskAfterConfirm.sourceRevisionLocators!.length, 2);
      await flow.finishReimbursementTask(retainedOwner, 0, chosen.actionLocator.actionId, false);
      assert.deepEqual((await context.projection(retainedOwner))!.tasks[0]!.subrequests.map(item => item.status), ['handled', 'pending'], 'stale cancellation never completes the sibling');
      const nextInput = (await createLineAiInputEvidence({ turnKey: 'second-selection-turn', parts: [{ partId: 'control-2', eventIdHash: sha('select-2'),
        acceptedAtMs: Date.now(), rawText: offeredSecond[0].quickReply.items[0].action.text }] }))!;
      const nextEvent = { ...event, webhookEventId: `${tag}-second-selection`, ...nextInput };
      flow.boundConversations.set(nextEvent, binding); flow.deliveryAccess.set(nextEvent, { fingerprint: 'retained-fp' });
      assert.equal(await flow.prepareRetainedTaskSelection(nextEvent), false);
      const secondRetained = flow.retainedTaskSources.get(nextEvent).source;
      assert.equal(secondRetained.semanticSubrequest.index, 1);
      const nextSemantic = [{ ...originalSemantic[1]!, index: 0, taskRef: secondRetained.taskRef,
        evidenceRefs: [fullRef(nextInput.inputEvidence, 'control-2')] }];
      assert.equal(await flow.preserveSemanticTask(nextEvent, nextSemantic), true);
      const nextGrant = { ...selectedGrant, turnKey: nextInput.inputEvidence.turnKey, authorityId: `${tag}-second-selection-ledger`, signature: sha('second-selection-grant') };
      const nextRequest = { ...selectedRequest, requestId: `${tag}-second-selection-request`, ...nextInput, budgetGrantV2: nextGrant,
        semanticSubrequests: nextSemantic, retainedTaskSource: secondRetained };
      await client.lineLedgerDelivery.create({ data: { id: nextGrant.authorityId, companyId, userId: retainedActor.userId,
        webhookEventId: nextEvent.webhookEventId, entryId: `${tag}-second-selection-entry`, status: 'PREPARING', expiresAt: new Date(Date.now() + 60_000),
        acceptedRequestJson: { request: nextRequest } as any } });
      const nextCtx = { ...selectedCtx, requestId: nextRequest.requestId, inputEvidence: nextInput.inputEvidence,
        valueCandidatesV2: (await extractValueCandidatesV2(nextInput.inputEvidence, '2026-09-27'))!, budgetGrantV2: nextGrant };
      const nextOptions = data(await adapter.getOptions(nextCtx, { operation: 'CREATE', subrequestIndex: 0 }));
      assert.notEqual(nextOptions.actionLocator.actionId, chosen.actionLocator.actionId);
      const nextBranch = nextOptions.options.choices.find((item: any) => item.kind === 'BRANCH' && item.label.startsWith('Branch 01'));
      const nextChosen = data(await adapter.getOptions(nextCtx, { operation: 'CREATE', subrequestIndex: 0,
        ...nextOptions.actionLocator, branchChoiceId: nextBranch.choiceId }));
      const nextAmount = historical.amounts.find(item => item.source.partId === 'sibling' && item.value === '999')!;
      const nextDate = historical.dates.find(item => item.source.partId === 'sibling' && item.isoDate === '2026-09-21')!;
      assert.ok(nextAmount && nextDate);
      const nextProposal = { ...retainedProposal, taskId: nextChosen.actionLocator.taskId, taskRevision: nextChosen.options.taskRevision,
        branchChoiceId: nextChosen.options.selected.branchChoiceId, requesterChoiceId: nextChosen.options.selected.requesterChoiceId,
        fields: { reason: siblingProposal.fields.reason }, lineChanges: [{ operation: 'ADD', values: {
          incurredDate: { value: nextDate.isoDate, proof: { kind: 'USER_TEXT', refs: [nextDate.source], candidateId: nextDate.candidateId } },
          description: siblingProposal.fields.reason,
          categoryChoiceId: nextChosen.options.choices.find((item: any) => item.kind === 'CATEGORY' && item.label === 'เดินทาง').choiceId,
          amount: { value: nextAmount.value, proof: { kind: 'USER_TEXT', refs: [nextAmount.source], candidateId: nextAmount.candidateId } } } }] };
      const nextPreview = await adapter.preview(nextCtx, { action: nextChosen.actionLocator, proposal: nextProposal }, 'CREATE');
      assert.equal((nextPreview.data as any).reimbursementDraft.preview.after.lines[0].amount, '999.0000');
      await flow.settleSemanticTask(nextEvent, [{ index: 0, status: 'needs_user', question: 'confirm preview' }], [nextChosen.actionLocator.actionId]);
      await confirmPreview((nextPreview.data as any).reimbursementDraft.preview, nextGrant.authorityId);
      await flow.finishReimbursementTask(retainedOwner, 1, nextChosen.actionLocator.actionId, true);
      taskAfterConfirm = (await context.projection(retainedOwner))!.tasks[0]!;
      assert.deepEqual(taskAfterConfirm.subrequests.map(item => item.status), ['handled', 'handled']);
      const savedClaims = await client.reimbursementRequest.findMany({ where: { companyId, requesterUserId: retainedActor.userId }, orderBy: { amount: 'asc' } });
      assert.deepEqual(savedClaims.map(item => item.amount.toFixed(4)), ['100.0000', '999.0000']);
      const changed = structuredClone(frozen); changed.digest = sha('tampered');
      await client.lineLedgerDelivery.update({ where: { id: retainedActor.grant.authorityId }, data: { acceptedRequestJson: changed as any } });
      assert.equal((await adapter.getOptions(selectedCtx, { operation: 'CREATE', subrequestIndex: 0 })).errorCode, 'INVALID_REIMBURSEMENT_AUTHORITY');

    } finally {
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: { startsWith: `${tag}-user-` } } });
      await client.$disconnect();
    }
  });
});
