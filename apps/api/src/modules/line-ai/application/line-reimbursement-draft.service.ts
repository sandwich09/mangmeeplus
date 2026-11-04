import { Injectable } from '@nestjs/common';
import type {
  CreateReimbursementRequestInput,
  RequestContext,
  UpdateReimbursementDraftInput,
} from '@watchdog-bms/contracts';
import {
  LineReimbursementDraftUseCase,
  type LineReimbursementActionKey,
  type LineReimbursementDraftResult,
} from '../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
import type { ReimbursementDraftActionOwner } from '../../reimbursements/domain/models/reimbursement.model';
import type { LineConversationOwner } from './line-conversation-context.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export type LineReimbursementDraftControl = {
  action: 'reimbursement_draft_confirm' | 'reimbursement_draft_cancel';
  actionId: string;
  previewRevision: number;
  confirmationDigest: string;
};

export type LineReimbursementChoiceControl = { action: 'reimbursement_choice'; actionId: string; revision: string; choice: string };

export function parseLineReimbursementChoiceControl(raw: unknown): LineReimbursementChoiceControl | null {
  if (typeof raw !== 'string' || raw.length > 350) return null;
  const params = new URLSearchParams(raw), keys = [...params.keys()];
  const actionId = params.get('actionId'), revision = params.get('revision'), choice = params.get('choice');
  if (keys.length !== 4 || new Set(keys).size !== 4 || keys.some(key => !['action', 'actionId', 'revision', 'choice'].includes(key))
    || params.get('action') !== 'reimbursement_choice' || !actionId || !UUID.test(actionId) || !revision || !HASH.test(revision)
    || !choice || !['no-receipt', 'photo', 'new-line'].includes(choice) && !HASH.test(choice)) return null;
  return { action: 'reimbursement_choice', actionId, revision, choice };
}

export type ResolvedLineReimbursementDraftProposal = {
  key: LineReimbursementActionKey;
  sourceProof: unknown;
  targetRef?: string;
} & (
  | { status: 'needs_fields'; accepted: unknown; fieldPaths: string[]; requestId?: string; expectedRequestUpdatedAt?: string }
  | { status: 'ready'; operation: 'CREATE'; request: CreateReimbursementRequestInput }
  | { status: 'ready'; operation: 'UPDATE'; requestId: string; expectedRequestUpdatedAt: string; request: UpdateReimbursementDraftInput }
);

function exactObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseLineReimbursementDraftControl(value: unknown): LineReimbursementDraftControl | null {
  let raw: Record<string, unknown>;
  if (typeof value === 'string') {
    if (!value || value.length > 300) return null;
    const params = new URLSearchParams(value);
    const keys = [...params.keys()];
    if (keys.some((key) => !['action', 'actionId', 'previewRevision', 'confirmationDigest'].includes(key))
      || new Set(keys).size !== 4 || keys.some((key) => params.getAll(key).length !== 1)) return null;
    raw = Object.fromEntries(params.entries());
  } else if (exactObject(value)) raw = value;
  else return null;
  if (Object.keys(raw).length !== 4 || !['action', 'actionId', 'previewRevision', 'confirmationDigest'].every((key) => key in raw)
    || !['reimbursement_draft_confirm', 'reimbursement_draft_cancel'].includes(String(raw['action']))
    || typeof raw['actionId'] !== 'string' || !UUID.test(raw['actionId'])
    || typeof raw['confirmationDigest'] !== 'string' || !HASH.test(raw['confirmationDigest'])) return null;
  const previewRevision = typeof raw['previewRevision'] === 'string' && /^\d+$/.test(raw['previewRevision'])
    ? Number(raw['previewRevision']) : raw['previewRevision'];
  if (!Number.isSafeInteger(previewRevision) || Number(previewRevision) < 1) return null;
  return {
    action: raw['action'] as LineReimbursementDraftControl['action'], actionId: raw['actionId'],
    previewRevision: Number(previewRevision), confirmationDigest: raw['confirmationDigest'],
  };
}

@Injectable()
export class LineReimbursementDraftService {
  constructor(private readonly drafts: LineReimbursementDraftUseCase) {}

  propose(input: {
    ctx: RequestContext;
    owner: LineConversationOwner;
    ownerEpoch: number;
    proposal: ResolvedLineReimbursementDraftProposal;
    now?: Date;
  }): Promise<LineReimbursementDraftResult> {
    const owner = this.owner(input.owner, input.ownerEpoch);
    const proposal = input.proposal;
    if (proposal.status === 'needs_fields') return this.drafts.collect({
      ctx: input.ctx, owner, key: proposal.key, accepted: proposal.accepted, sourceProof: proposal.sourceProof,
      fieldPaths: proposal.fieldPaths, requestId: proposal.requestId,
      expectedRequestUpdatedAt: proposal.expectedRequestUpdatedAt, now: input.now,
    });
    if (proposal.operation === 'CREATE') return this.drafts.preview({
      ctx: input.ctx, owner, key: proposal.key, operation: 'CREATE', request: proposal.request,
      sourceProof: proposal.sourceProof, targetRef: proposal.targetRef,
    }, input.now);
    return this.drafts.preview({
      ctx: input.ctx, owner, key: proposal.key, operation: 'UPDATE', requestId: proposal.requestId,
      expectedRequestUpdatedAt: proposal.expectedRequestUpdatedAt, request: proposal.request,
      sourceProof: proposal.sourceProof, targetRef: proposal.targetRef,
    }, input.now);
  }

  async confirm(input: {
    ctx: RequestContext;
    owner: LineConversationOwner;
    ownerEpoch: number;
    control: unknown;
    deliveryPlanId: string;
    now?: Date;
  }): Promise<LineReimbursementDraftResult> {
    const control = parseLineReimbursementDraftControl(input.control);
    if (!control || control.action !== 'reimbursement_draft_confirm') return { status: 'blocked', errorCode: 'invalid_field' };
    const owner = this.owner(input.owner, input.ownerEpoch);
    const now = input.now ?? new Date();
    if (!await this.drafts.markLineDelivered({ ctx: input.ctx, owner, actionId: control.actionId,
      previewRevision: control.previewRevision, confirmationDigest: control.confirmationDigest,
      deliveryPlanId: input.deliveryPlanId, now })) {
      const current = await this.drafts.get({ ctx: input.ctx, owner, actionId: control.actionId, now });
      return current.status === 'stale' ? current : { status: 'blocked', errorCode: 'preview_not_fully_delivered' };
    }
    return this.drafts.confirm({ ctx: input.ctx, owner, actionId: control.actionId,
      previewRevision: control.previewRevision, confirmationDigest: control.confirmationDigest, now });
  }

  cancel(input: {
    ctx: RequestContext;
    owner: LineConversationOwner;
    ownerEpoch: number;
    control: unknown;
    now?: Date;
  }): Promise<LineReimbursementDraftResult> {
    const control = parseLineReimbursementDraftControl(input.control);
    if (!control || control.action !== 'reimbursement_draft_cancel') return Promise.resolve({ status: 'blocked', errorCode: 'invalid_field' });
    return this.drafts.cancel({ ctx: input.ctx, owner: this.owner(input.owner, input.ownerEpoch), actionId: control.actionId,
      previewRevision: control.previewRevision, confirmationDigest: control.confirmationDigest, now: input.now });
  }

  cancelCollection(input: {
    ctx: RequestContext;
    owner: LineConversationOwner;
    ownerEpoch: number;
    actionId: string;
  }): Promise<LineReimbursementDraftResult> {
    return this.drafts.cancelCollection({ ctx: input.ctx, owner: this.owner(input.owner, input.ownerEpoch), actionId: input.actionId });
  }

  /** The chat's one open draft action (COLLECTING or PREVIEW), same owner/permission checks as every other read. */
  active(input: { ctx: RequestContext; owner: LineConversationOwner; ownerEpoch: number }) {
    return this.drafts.active(input.ctx, this.owner(input.owner, input.ownerEpoch));
  }

  get(input: { ctx: RequestContext; owner: LineConversationOwner; ownerEpoch: number; actionId: string }): Promise<LineReimbursementDraftResult> {
    return this.drafts.get({ ctx: input.ctx, owner: this.owner(input.owner, input.ownerEpoch), actionId: input.actionId });
  }

  replay(input: { ctx: RequestContext; owner: LineConversationOwner; ownerEpoch: number; actionId: string }): Promise<LineReimbursementDraftResult> {
    return this.drafts.replay(input.ctx, this.owner(input.owner, input.ownerEpoch), input.actionId);
  }

  private owner(owner: LineConversationOwner, ownerEpoch: number): ReimbursementDraftActionOwner {
    return { companyId: owner.companyId, actorUserId: owner.userId, membershipId: owner.membershipId,
      channel: owner.channel, channelKind: owner.channelKind, messagingChannelId: owner.messagingChannelId,
      chatKeyHash: owner.chatKeyHash, ownerEpoch };
  }
}
