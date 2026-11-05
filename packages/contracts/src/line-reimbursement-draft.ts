import type { LineAiInputEvidenceV2, LineAiSourceRefV2 } from './line-ai-input-evidence.js';
import { validateLineAiSourceRefV2 } from './line-ai-input-evidence.js';
import type { ReimbursementReceiptRequirementStatus, ReimbursementSourceSnapshot } from './reimbursements.js';

export const REIMBURSEMENT_MANUAL_CATEGORIES = [
  { key: 'travel', label: 'เดินทาง' },
  { key: 'meals', label: 'อาหาร' },
  { key: 'supplies', label: 'วัสดุอุปกรณ์' },
  { key: 'accommodation', label: 'ที่พัก' },
  { key: 'other', label: 'อื่น ๆ' },
] as const;

export const LINE_REIMBURSEMENT_DRAFT_LIMITS = {
  proposalBytes: 128 * 1024,
  actionPayloadBytes: 128 * 1024,
  resultBytes: 4 * 1024,
  maxLineChanges: 50,
  maxLines: 50,
  maxProofRefs: 8,
  titleUtf16: 200,
  reasonUtf16: 1_000,
  missingReceiptReasonUtf16: 500,
  descriptionUtf16: 500,
  purposeUtf16: 500,
  categoryKeyUtf16: 80,
  categoryLabelUtf16: 160,
} as const;

export type LineReimbursementDraftOwnerV1 = {
  companyId: string;
  actorUserId: string;
  membershipId: string;
  channel: 'line';
  messagingChannelId: string;
  channelKind: 'USER';
  chatKeyHash: string;
  ownerEpoch: number;
};

export type LineReimbursementFieldProofV1 =
  | { kind: 'USER_TEXT'; refs: LineAiSourceRefV2[]; candidateId?: string }
  | { kind: 'RECORD'; recordRef: string; revision: string; fieldPath: string }
  | { kind: 'ATTACHMENT'; attachmentRef: string; revision: string; page: number; extractionRef: string; fieldPath: string }
  | { kind: 'USER_CHOICE'; choiceId: string; choiceRevision: string }
  | { kind: 'SERVER_DEFAULT'; key: 'ACTOR_AS_REQUESTER' | 'COMPANY_CURRENCY' | 'CLAIM_DATE_TODAY' };

export type LineReimbursementProposedValueV1<T> = { value: T; proof: LineReimbursementFieldProofV1 };

export type LineReimbursementProposedClaimLineV1 = {
  incurredDate?: LineReimbursementProposedValueV1<string>;
  description?: LineReimbursementProposedValueV1<string>;
  purpose?: LineReimbursementProposedValueV1<string>;
  categoryChoiceId?: string;
  amount?: LineReimbursementProposedValueV1<string>;
  attachmentChoiceId?: string | null;
  linkedExpenseChoiceId?: string | null;
};

export type LineReimbursementDraftProposalV1 = {
  schemaVersion: 1;
  taskId: string;
  taskRevision: number;
  operation: 'CREATE' | 'UPDATE';
  targetRef?: string;
  fields: {
    title?: LineReimbursementProposedValueV1<string>;
    reason?: LineReimbursementProposedValueV1<string>;
    missingReceiptReason?: LineReimbursementProposedValueV1<string | null>;
  };
  requesterChoiceId?: string;
  branchChoiceId?: string;
  lineChanges?: Array<
    | { operation: 'ADD'; values: LineReimbursementProposedClaimLineV1 }
    | { operation: 'SET'; lineRef: string; values: LineReimbursementProposedClaimLineV1 }
    | { operation: 'REMOVE'; lineRef: string; proof: LineReimbursementFieldProofV1 }
  >;
};

export type LineReimbursementDraftLineV1 = {
  lineRef: string;
  lineNo: number;
  incurredDate: string;
  description: string;
  purpose?: string;
  categoryKey: string;
  categoryLabel?: string;
  amount: string;
  attachmentId?: string;
  linkedExpenseId?: string;
  sourceExpenseSnapshot?: ReimbursementSourceSnapshot;
};

export type LineReimbursementDraftSnapshotV1 = {
  requesterUserId: string;
  requesterDisplayName: string;
  branchId: string;
  /** Display only: the branch's name for the customer-facing preview. */
  branchName?: string;
  currency: string;
  title?: string;
  reason: string;
  missingReceiptReason?: string;
  lines: LineReimbursementDraftLineV1[];
  amount: string;
  categoryKey: string;
  categoryLabel?: string;
  incurredDate: string;
  receiptRequirementStatus: ReimbursementReceiptRequirementStatus;
  status: 'DRAFT';
  signatureImpact: 'NONE' | 'INVALIDATED';
};

export type LineReimbursementDraftPreviewV1 = {
  schemaVersion: 1;
  actionId: string;
  previewRevision: number;
  operation: 'CREATE' | 'UPDATE';
  expiresAt: string;
  expectedRequestUpdatedAt?: string;
  targetRef?: string;
  before?: LineReimbursementDraftSnapshotV1;
  after: LineReimbursementDraftSnapshotV1;
  diff: Array<{ fieldPath: string; before?: unknown; after?: unknown }>;
  warnings: string[];
  confirmationDigest: string;
};

export type LineReimbursementDraftReceiptV1 = {
  schemaVersion: 1;
  actionId: string;
  operation: 'CREATE' | 'UPDATE';
  requestId: string;
  committedState: 'DRAFT';
  amount: string;
  currency: string;
  confirmationDigest: string;
  committedAt: string;
  appliedRequestUpdatedAt: string;
  currentState?: string;
  currentRequestUpdatedAt?: string;
  /** The claim's document number once it has one (set at submit); the receipt never prints `requestId`. */
  requestNo?: string;
};

export type LineReimbursementDraftResponseV1 =
  | { status: 'needs_fields'; actionId: string; fieldPaths: string[]; actionRevision: number }
  | { status: 'needs_target'; actionId: string; actionRevision: number }
  | { status: 'preview'; preview: LineReimbursementDraftPreviewV1 }
  | { status: 'applied'; receipt: LineReimbursementDraftReceiptV1 }
  | { status: 'cancelled'; actionId: string }
  | { status: 'expired'; actionId: string }
  | { status: 'stale'; actionId: string; errorCode?: 'source_changed' | 'state_not_editable' }
  | { status: 'blocked'; errorCode: LineReimbursementDraftBlockedCode; fieldPaths?: string[]; limit?: number; retryAfter?: number }
  | { status: 'result_unknown'; actionId: string };

export type LineReimbursementDraftBlockedCode =
  | 'forbidden' | 'feature_disabled' | 'unsupported_channel' | 'write_quiesced'
  | 'invalid_provenance' | 'evidence_overflow' | 'field_too_long' | 'invalid_field'
  | 'source_changed' | 'invalid_source' | 'state_not_editable'
  | 'preview_not_fully_delivered' | 'rate_limited' | 'store_unavailable' | 'schema_unsupported';

export type LineReimbursementDraftControlV1 = {
  action: 'reimbursement_draft_confirm' | 'reimbursement_draft_cancel';
  actionId: string;
  previewRevision: number;
  confirmationDigest: string;
};

export type LineReimbursementValidatedFieldReceiptV1 = {
  fieldPath: string;
  valueDigest: string;
  proof: LineReimbursementFieldProofV1;
  validatedAt: string;
};

export type LineReimbursementSourceProofV1 = {
  schemaVersion: 1;
  receipts: LineReimbursementValidatedFieldReceiptV1[];
};

type ParseContext = {
  evidence: LineAiInputEvidenceV2;
  candidateValues?: Readonly<Record<string, string>>;
  candidateSources?: Readonly<Record<string, LineAiSourceRefV2>>;
};

const HASH = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ID = /^[\x21-\x7e]{1,200}$/u;
const MONEY = /^\d{1,14}(?:\.\d{1,4})?$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const bounded = (value: unknown, max: number, allowEmpty = true): value is string => typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);

function parseProof(value: unknown, context: ParseContext, fieldPath: string, proposedValue: unknown): LineReimbursementFieldProofV1 | undefined {
  if (!object(value) || typeof value['kind'] !== 'string') return undefined;
  if (value['kind'] === 'USER_TEXT') {
    if (!exact(value, ['kind', 'refs', 'candidateId']) || !Array.isArray(value['refs']) || value['refs'].length < 1
      || value['refs'].length > LINE_REIMBURSEMENT_DRAFT_LIMITS.maxProofRefs) return undefined;
    const refs: LineAiSourceRefV2[] = [];
    const text: string[] = [];
    let priorPart = -1, priorEnd = -1;
    for (const ref of value['refs']) {
      const excerpt = validateLineAiSourceRefV2(ref, context.evidence);
      if (!excerpt || !object(ref)) return undefined;
      const source = ref as LineAiSourceRefV2;
      const partIndex = context.evidence.parts.findIndex(part => part.partId === source.partId);
      if (partIndex < priorPart || partIndex === priorPart && source.startUtf16 < priorEnd) return undefined;
      priorPart = partIndex; priorEnd = source.endUtf16;
      refs.push(source);
      text.push(excerpt);
    }
    const candidateId = value['candidateId'];
    const candidateRequired = fieldPath.endsWith('.amount') || fieldPath.endsWith('.incurredDate');
    if (candidateRequired && (typeof candidateId !== 'string' || !HASH.test(candidateId)
      || context.candidateValues?.[candidateId] !== proposedValue)) return undefined;
    if (candidateRequired) {
      const source = context.candidateSources?.[candidateId as string];
      if (!source || refs.length !== 1 || !refs.some(ref => ref.partId === source.partId && ref.rawSha256 === source.rawSha256
        && ref.startUtf16 === source.startUtf16 && ref.endUtf16 === source.endUtf16)) return undefined;
    }
    if (candidateId !== undefined && (typeof candidateId !== 'string' || !HASH.test(candidateId))) return undefined;
    if (!candidateRequired && proposedValue !== null && typeof proposedValue === 'string' && text.join('\n') !== proposedValue) return undefined;
    return { kind: 'USER_TEXT', refs, ...(typeof candidateId === 'string' ? { candidateId } : {}) };
  }
  if (value['kind'] === 'RECORD') {
    if (!exact(value, ['kind', 'recordRef', 'revision', 'fieldPath']) || !bounded(value['recordRef'], 200, false)
      || !bounded(value['revision'], 200, false) || !bounded(value['fieldPath'], 200, false)) return undefined;
    return value as LineReimbursementFieldProofV1;
  }
  if (value['kind'] === 'ATTACHMENT') {
    if (!exact(value, ['kind', 'attachmentRef', 'revision', 'page', 'extractionRef', 'fieldPath'])
      || !bounded(value['attachmentRef'], 200, false) || !bounded(value['revision'], 200, false)
      || !Number.isSafeInteger(value['page']) || Number(value['page']) < 1 || Number(value['page']) > 10_000
      || !bounded(value['extractionRef'], 200, false) || !bounded(value['fieldPath'], 200, false)) return undefined;
    return value as LineReimbursementFieldProofV1;
  }
  if (value['kind'] === 'USER_CHOICE') {
    if (!exact(value, ['kind', 'choiceId', 'choiceRevision']) || !bounded(value['choiceId'], 200, false) || !bounded(value['choiceRevision'], 200, false)) return undefined;
    return value as LineReimbursementFieldProofV1;
  }
  if (value['kind'] === 'SERVER_DEFAULT') {
    if (!exact(value, ['kind', 'key']) || !['ACTOR_AS_REQUESTER', 'COMPANY_CURRENCY', 'CLAIM_DATE_TODAY'].includes(String(value['key']))) return undefined;
    return value as LineReimbursementFieldProofV1;
  }
  return undefined;
}

function proposed<T>(value: unknown, context: ParseContext, fieldPath: string, validate: (candidate: unknown) => candidate is T): LineReimbursementProposedValueV1<T> | undefined {
  if (!object(value) || !exact(value, ['value', 'proof']) || !validate(value['value'])) return undefined;
  const proof = parseProof(value['proof'], context, fieldPath, value['value']);
  return proof ? { value: value['value'], proof } : undefined;
}

function line(value: unknown, context: ParseContext, path: string): LineReimbursementProposedClaimLineV1 | undefined {
  const keys = ['incurredDate', 'description', 'purpose', 'categoryChoiceId', 'amount', 'attachmentChoiceId', 'linkedExpenseChoiceId'];
  if (!object(value) || !exact(value, keys)) return undefined;
  const result: LineReimbursementProposedClaimLineV1 = {};
  if (value['incurredDate'] != null) {
    const item = proposed(value['incurredDate'], context, `${path}.incurredDate`, (candidate): candidate is string => typeof candidate === 'string' && DATE.test(candidate));
    if (!item) return undefined; result.incurredDate = item;
  }
  if (value['description'] != null) {
    const item = proposed(value['description'], context, `${path}.description`, (candidate): candidate is string => bounded(candidate, LINE_REIMBURSEMENT_DRAFT_LIMITS.descriptionUtf16, false));
    if (!item) return undefined; result.description = item;
  }
  if (value['purpose'] != null) {
    const item = proposed(value['purpose'], context, `${path}.purpose`, (candidate): candidate is string => bounded(candidate, LINE_REIMBURSEMENT_DRAFT_LIMITS.purposeUtf16));
    if (!item) return undefined; result.purpose = item;
  }
  if (value['amount'] != null) {
    const item = proposed(value['amount'], context, `${path}.amount`, (candidate): candidate is string => typeof candidate === 'string' && MONEY.test(candidate));
    if (!item) return undefined; result.amount = item;
  }
  for (const key of ['categoryChoiceId', 'attachmentChoiceId', 'linkedExpenseChoiceId'] as const) {
    const item = value[key];
    if (item !== undefined && item !== null && !bounded(item, 200, false)) return undefined;
    if (item !== undefined) Object.assign(result, { [key]: item });
  }
  return result;
}

export function parseLineReimbursementDraftProposalV1(value: unknown, context: ParseContext): LineReimbursementDraftProposalV1 | undefined {
  if (!object(value) || !exact(value, ['schemaVersion', 'taskId', 'taskRevision', 'operation', 'targetRef', 'fields', 'requesterChoiceId', 'branchChoiceId', 'lineChanges'])
    || value['schemaVersion'] !== 1 || typeof value['taskId'] !== 'string' || !UUID.test(value['taskId'])
    || !Number.isSafeInteger(value['taskRevision']) || Number(value['taskRevision']) < 0
    || !['CREATE', 'UPDATE'].includes(String(value['operation']))
    || new TextEncoder().encode(JSON.stringify(value)).byteLength > LINE_REIMBURSEMENT_DRAFT_LIMITS.proposalBytes
    || !object(value['fields']) || !exact(value['fields'], ['title', 'reason', 'missingReceiptReason'])) return undefined;

  const operation = value['operation'] as 'CREATE' | 'UPDATE';
  if (operation === 'UPDATE' ? !bounded(value['targetRef'], 200, false) : value['targetRef'] !== undefined) return undefined;
  if (operation === 'UPDATE' && (value['requesterChoiceId'] !== undefined || value['branchChoiceId'] !== undefined)) return undefined;
  for (const key of ['requesterChoiceId', 'branchChoiceId'] as const) if (value[key] !== undefined && !bounded(value[key], 200, false)) return undefined;

  const fields: LineReimbursementDraftProposalV1['fields'] = {};
  const fieldSpecs = [
    ['title', LINE_REIMBURSEMENT_DRAFT_LIMITS.titleUtf16, true],
    ['reason', LINE_REIMBURSEMENT_DRAFT_LIMITS.reasonUtf16, false],
    ['missingReceiptReason', LINE_REIMBURSEMENT_DRAFT_LIMITS.missingReceiptReasonUtf16, true],
  ] as const;
  for (const [key, max, allowEmpty] of fieldSpecs) {
    const raw = value['fields'][key];
    // A bare null is "not given" (models send it for unknown fields); clearing uses {value: null, proof}.
    if (raw == null) continue;
    const item = proposed(raw, context, `fields.${key}`, (candidate): candidate is string | null =>
      (key === 'missingReceiptReason' && candidate === null) || bounded(candidate, max, allowEmpty));
    if (!item) return undefined;
    Object.assign(fields, { [key]: item });
  }

  const rawChanges = value['lineChanges'];
  if (rawChanges !== undefined && (!Array.isArray(rawChanges) || rawChanges.length > LINE_REIMBURSEMENT_DRAFT_LIMITS.maxLineChanges)) return undefined;
  const changes: NonNullable<LineReimbursementDraftProposalV1['lineChanges']> = [];
  const touched = new Set<string>();
  for (const [index, raw] of (rawChanges ?? []).entries()) {
    if (!object(raw) || typeof raw['operation'] !== 'string') return undefined;
    if (raw['operation'] === 'ADD') {
      if (!exact(raw, ['operation', 'values'])) return undefined;
      const values = line(raw['values'], context, `lineChanges.${index}.values`); if (!values) return undefined;
      changes.push({ operation: 'ADD', values }); continue;
    }
    if (!bounded(raw['lineRef'], 200, false) || touched.has(raw['lineRef'])) return undefined;
    touched.add(raw['lineRef']);
    if (raw['operation'] === 'SET') {
      if (!exact(raw, ['operation', 'lineRef', 'values'])) return undefined;
      const values = line(raw['values'], context, `lineChanges.${index}.values`);
      if (!values || Object.keys(values).length === 0) return undefined;
      changes.push({ operation: 'SET', lineRef: raw['lineRef'], values }); continue;
    }
    if (raw['operation'] === 'REMOVE') {
      if (!exact(raw, ['operation', 'lineRef', 'proof'])) return undefined;
      // The user's source span names the row to remove in human terms; it must not equal the
      // opaque API-issued lineRef. Target resolution binds that ref separately.
      const proof = parseProof(raw['proof'], context, `lineChanges.${index}.remove`, null); if (!proof) return undefined;
      changes.push({ operation: 'REMOVE', lineRef: raw['lineRef'], proof }); continue;
    }
    return undefined;
  }
  if (operation === 'CREATE' && changes.some((change) => change.operation !== 'ADD')) return undefined;

  return {
    schemaVersion: 1, taskId: value['taskId'], taskRevision: Number(value['taskRevision']), operation,
    ...(typeof value['targetRef'] === 'string' ? { targetRef: value['targetRef'] } : {}), fields,
    ...(typeof value['requesterChoiceId'] === 'string' ? { requesterChoiceId: value['requesterChoiceId'] } : {}),
    ...(typeof value['branchChoiceId'] === 'string' ? { branchChoiceId: value['branchChoiceId'] } : {}),
    ...(rawChanges !== undefined ? { lineChanges: changes } : {}),
  };
}

export function parseLineReimbursementDraftControlV1(value: unknown): LineReimbursementDraftControlV1 | undefined {
  if (!object(value) || !exact(value, ['action', 'actionId', 'previewRevision', 'confirmationDigest'])
    || !['reimbursement_draft_confirm', 'reimbursement_draft_cancel'].includes(String(value['action']))
    || typeof value['actionId'] !== 'string' || !UUID.test(value['actionId'])
    || !Number.isSafeInteger(value['previewRevision']) || Number(value['previewRevision']) < 1
    || typeof value['confirmationDigest'] !== 'string' || !HASH.test(value['confirmationDigest'])) return undefined;
  return value as LineReimbursementDraftControlV1;
}

export function parseLineReimbursementSourceProofV1(value: unknown): LineReimbursementSourceProofV1 | undefined {
  if (!object(value) || !exact(value, ['schemaVersion', 'receipts']) || value['schemaVersion'] !== 1
    || !Array.isArray(value['receipts']) || value['receipts'].length < 1 || value['receipts'].length > 400) return undefined;
  const receipts: LineReimbursementValidatedFieldReceiptV1[] = [];
  const paths = new Set<string>();
  for (const raw of value['receipts']) {
    if (!object(raw) || !exact(raw, ['fieldPath', 'valueDigest', 'proof', 'validatedAt'])
      || !bounded(raw['fieldPath'], 200, false) || !/^[A-Za-z0-9_.\[\]-]+$/u.test(raw['fieldPath']) || paths.has(raw['fieldPath'])
      || typeof raw['valueDigest'] !== 'string' || !HASH.test(raw['valueDigest'])
      || typeof raw['validatedAt'] !== 'string' || !Number.isFinite(Date.parse(raw['validatedAt']))
      || !structuralFieldProof(raw['proof'])) return undefined;
    paths.add(raw['fieldPath']);
    receipts.push(raw as LineReimbursementValidatedFieldReceiptV1);
  }
  return { schemaVersion: 1, receipts };
}

function structuralFieldProof(value: unknown): value is LineReimbursementFieldProofV1 {
  if (!object(value) || typeof value['kind'] !== 'string') return false;
  if (value['kind'] === 'USER_TEXT') return exact(value, ['kind', 'refs', 'candidateId']) && Array.isArray(value['refs'])
    && value['refs'].length >= 1 && value['refs'].length <= LINE_REIMBURSEMENT_DRAFT_LIMITS.maxProofRefs
    && value['refs'].every((ref) => object(ref) && exact(ref, ['partId', 'startUtf16', 'endUtf16', 'rawSha256'])
      && bounded(ref['partId'], 128, false) && Number.isSafeInteger(ref['startUtf16']) && Number(ref['startUtf16']) >= 0
      && Number.isSafeInteger(ref['endUtf16']) && Number(ref['endUtf16']) > Number(ref['startUtf16'])
      && typeof ref['rawSha256'] === 'string' && HASH.test(ref['rawSha256']))
    && (value['candidateId'] === undefined || typeof value['candidateId'] === 'string' && HASH.test(value['candidateId']));
  if (value['kind'] === 'RECORD') return exact(value, ['kind', 'recordRef', 'revision', 'fieldPath'])
    && bounded(value['recordRef'], 200, false) && bounded(value['revision'], 200, false) && bounded(value['fieldPath'], 200, false);
  if (value['kind'] === 'ATTACHMENT') return exact(value, ['kind', 'attachmentRef', 'revision', 'page', 'extractionRef', 'fieldPath'])
    && bounded(value['attachmentRef'], 200, false) && bounded(value['revision'], 200, false)
    && Number.isSafeInteger(value['page']) && Number(value['page']) >= 1 && Number(value['page']) <= 10_000
    && bounded(value['extractionRef'], 200, false) && bounded(value['fieldPath'], 200, false);
  if (value['kind'] === 'USER_CHOICE') return exact(value, ['kind', 'choiceId', 'choiceRevision'])
    && bounded(value['choiceId'], 200, false) && bounded(value['choiceRevision'], 200, false);
  return value['kind'] === 'SERVER_DEFAULT' && exact(value, ['kind', 'key'])
    && ['ACTOR_AS_REQUESTER', 'COMPANY_CURRENCY', 'CLAIM_DATE_TODAY'].includes(String(value['key']));
}
