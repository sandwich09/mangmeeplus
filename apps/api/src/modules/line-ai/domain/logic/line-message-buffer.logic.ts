import { lineReplyLanguage, type LineReplyLanguage } from './line-language.logic';
/**
 * Pure buffering/segmentation logic for LINE AI multi-bubble utterances.
 * No NestJS, Prisma, HTTP, or timer imports — the caller passes time in.
 * Spec: docs/specs/line-ai-message-buffering-spec.md
 */
import { createHmac } from 'node:crypto';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import type { LineSystemCard } from './line-system-card.logic';
import { drawLineSystemCard } from './line-system-card-limits.logic';
import { lineMessagePreview } from './line-message-preview.logic';

export type LineBufferTextItem = {
  kind: 'text' | 'command';
  webhookEventId: string;
  replyToken: string;
  text: string;
  language?: 'th' | 'en';
  /** Exact draft preview targeted by a validated LINE postback. */
  quotedMessageId?: string;
  counterpartyControl?: import('../../application/line-counterparty.service').CounterpartyControl;
  packagePurchaseControl?: import('../../application/line-package-purchase.service').PackagePurchaseControl;
  expenseActionControl?: import('../../application/line-expense-action.service').ExpenseActionControl;
  draftUpdatePreviewId?: string;
  workflowControl?: import('@watchdog-bms/contracts').LineWorkflowControl;
  workflowStart?: import('@watchdog-bms/contracts').LineWorkflowId;
  fixedReadControl?: import('@watchdog-bms/contracts').LineFixedReadControl;
  reimbursementChoiceControl?: import('../../application/line-reimbursement-draft.service').LineReimbursementChoiceControl;
  reimbursementDraftControl?: import('../../application/line-reimbursement-draft.service').LineReimbursementDraftControl;
  answerDeliveryControl?: import('./line-delivery-plan.logic').LineAnswerDeliveryControl;
  /** Frozen, API-owned coalesced input restored only by durable recovery. */
  inputEvidence?: import('@watchdog-bms/contracts').LineAiInputEvidenceV2;
  lineMessageId?: string;
  /** LINE event timestamp (ms) — used to heal cross-POST arrival reordering. */
  timestamp: number;
  /** Wall-clock (ms) when durable acceptance succeeded/reclaimed. Anchors the debounce boundary
   *  and the API trace to first durable acceptance (spec §10/§12). */
  acceptedAt: number;
  /** Process-local arrival sequence — tie-break for identical timestamps. */
  seq: number;
  /** In memory only: an orphan-sweep replay of a message accepted earlier (Owner 2026-09-30). */
  admitOverCap?: true;
};

export type LineBufferMediaItem = {
  language?: 'th' | 'en';
  kind: 'media';
  webhookEventId: string;
  replyToken: string;
  lineMessageId: string;
  messageType: 'image' | 'file';
  fileName?: string;
  fileSize?: number;
  timestamp: number;
  acceptedAt: number;
  seq: number;
  /** Company selected when durable acceptance completed. A later company switch must not move this media. */
  companyIdAtAcceptance?: string;
  /** True when the assistant was paused at durable acceptance; a later resume must not replay it into AI. */
  assistantPausedAtAcceptance?: true;
  /** In memory only: an orphan-sweep replay of a photo accepted earlier (Owner 2026-09-30). */
  admitOverCap?: true;
};

export type LineBufferItem = LineBufferTextItem | LineBufferMediaItem;

/**
 * A batch splits into ordered groups. Commands are always their own group so a
 * company switch applies exactly between the utterances it was typed between.
 * A content group with media consumes the group's text as caption (spec §8).
 */
export type LineBatchGroup =
  | { kind: 'command'; item: LineBufferTextItem }
  | { kind: 'text'; textItems: LineBufferTextItem[] }
  | { kind: 'media'; mediaItems: LineBufferMediaItem[]; textItems: LineBufferTextItem[] };

/** Hard caps per open buffer and per pending batch (spec §6/§7). */
export const LINE_BUFFER_MAX_ITEMS = 20;
export const LINE_BUFFER_MAX_TEXT_CHARS = 4000;
/** A `received` event-log row older than this is an orphan (crash lost the
 *  in-memory buffer) and a redelivered copy may be reprocessed (spec §9). */
export const LINE_BUFFER_ORPHAN_REPROCESS_MS = 2 * 60 * 1000;
/** Shutdown drain bound — must finish inside the ECS stop grace period. */
export const LINE_BUFFER_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;
/** Keep quick turns to native loading only; one status appears only for genuinely slow work. */
export const LINE_WAIT_STATUS_DELAY_MS = 5_000;
/** LINE's loading indicator lives at most 60 s per request. This slow-turn status lands just before
 *  that window lapses and its delivery restarts loading, so a turn heading toward the 120 s timeout
 *  never goes silent between spinner expiry and the terminal answer. */
export const LINE_WAIT_STATUS_SLOW_DELAY_MS = 55_000;
/** Let the status bubble reach the device before restoring loading; final delivery can cancel this. */
export const LINE_LOADING_RESTART_DELAY_MS = 300;
/** A second best-effort keepalive covers slow device delivery clearing the first restart. */
export const LINE_LOADING_KEEPALIVE_DELAY_MS = 1_300;
/** Design lock 2026-10-04 §8: the scanning context names no time nobody knows — not on the card, and
 *  not in this sentence, which is the card's canonical text and what is sent where the card cannot be
 *  drawn. (It used to promise "ปกติไม่เกิน 1 นาที".) Same shape as the file sentence below. */
export const LINE_MEDIA_RECEIVED_TEXT = 'ได้รับรูปแล้วค่ะ 🧾 กำลังอ่านเอกสารอยู่ เสร็จแล้วน้องจะสรุปให้ทางแชตนี้นะคะ ระหว่างนี้คุยกับน้องต่อได้เลยค่ะ';
/**
 * §17.1 / capture appendix §3: a `file` message is a DOCUMENT, and its read is async — so the
 * acknowledgement may neither call it a รูป nor promise the one-minute turnaround the photo lane
 * measures. The result arrives as its own push when the read job finishes.
 */
export const LINE_FILE_RECEIVED_TEXT = 'ได้รับไฟล์แล้วค่ะ 📄 กำลังอ่านเอกสารอยู่ เสร็จแล้วน้องจะสรุปให้ทางแชตนี้นะคะ ระหว่างนี้คุยกับน้องต่อได้เลยค่ะ';
export const LINE_MEDIA_SLOW_STATUS_TEXT = 'น้องมั่งมียังอ่านเอกสารอยู่นะคะ รูปนี้ใช้เวลานานกว่าปกติ ขออีกสักครู่ค่ะ 🙏';
export const LINE_SLOW_TURN_STATUS_TEXT = 'น้องมั่งมียังหาคำตอบอยู่นะคะ คำถามนี้ใช้เวลานานกว่าปกติ ขออีกสักครู่ค่ะ 🙏';

const LINE_WAIT_STATUS_RULES: Array<[RegExp, string[]]> = [
  [/รายงาน|report/, ['กำลังจัดเตรียมรายงานให้นะคะ 📄', 'รับเรื่องแล้วค่ะ ขอรวบรวมรายงานให้ครบก่อนนะคะ ✨']],
  [/สรุป|ภาพรวม|summary|brief/, ['กำลังสรุปข้อมูลให้อ่านง่ายอยู่นะคะ 📊', 'ขอจัดข้อมูลสำคัญให้กระชับอีกนิดนะคะ 💚']],
  [/เปรียบเทียบ|เทียบ|ต่างกัน|versus|\bvs\.?\b/, ['กำลังเปรียบเทียบข้อมูลให้นะคะ 🔎', 'ขอเช็กความต่างให้ครบก่อนนะคะ']],
  [/คำนวณ|รวมทั้งหมด|ค่าเฉลี่ย|เปอร์เซ็นต์|เท่าไหร่|กี่บาท|กี่รายการ|calculate|average|percent/, ['กำลังคำนวณตัวเลขให้นะคะ 🧮', 'ขอตรวจตัวเลขให้เรียบร้อยก่อนนะคะ']],
  [/วิเคราะห์|แนวโน้ม|สาเหตุ|ผิดปกติ|analyse|analyze|trend/, ['กำลังวิเคราะห์ข้อมูลให้อยู่นะคะ 📈', 'น้องมั่งมีกำลังไล่ดูรายละเอียดให้อยู่นะคะ']],
  [/ค้นหา|ค้นข้อมูล|search|find|lookup/, ['กำลังค้นข้อมูลที่เกี่ยวข้องให้อยู่นะคะ 🔍', 'รับเรื่องแล้วค่ะ กำลังค้นข้อมูลให้นะคะ']],
  [/ข้อมูล|ยอดขาย|ค่าใช้จ่าย|ลูกค้า|สต็อก|สินค้าคงคลัง|ภาษี|ใบแจ้งหนี้|สถานะ|รายการ|อนุมัติ|บัญชี/, ['กำลังตรวจสอบข้อมูลในระบบให้นะคะ 💻', 'รับเรื่องแล้วค่ะ ขอเช็กข้อมูลให้ครบก่อนนะคะ']],
];

const LINE_GENERIC_WAIT_STATUSES = [
  'น้องมั่งมีกำลังดูให้อยู่นะคะ ขอบคุณที่รอนะคะ 💚',
  'รับเรื่องแล้วนะคะ กำลังจัดคำตอบให้ชัด ๆ อยู่ค่ะ ✨',
  'กำลังเรียบเรียงคำตอบให้อยู่นะคะ 😊',
  'น้องมั่งมียังอยู่นะคะ กำลังหาคำตอบที่เหมาะที่สุดให้ค่ะ 🌱',
];

function stableStatusVariant(variants: string[], seed: string): string {
  let hash = 2_166_136_261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return variants[(hash >>> 0) % variants.length];
}

/** One truthful, varied waiting line selected from the request; no model call needed. */
export function lineWaitStatusText(messageText: string, turnSeed = messageText, language: LineReplyLanguage = lineReplyLanguage(messageText)): string {
  if (language === 'en') return stableStatusVariant(['I’m checking that for you; thank you for waiting.', 'I’m preparing your answer; please wait a moment.'], turnSeed);
  const normalized = messageText.trim().toLowerCase();
  const variants = LINE_WAIT_STATUS_RULES.find(([pattern]) => pattern.test(normalized))?.[1]
    ?? LINE_GENERIC_WAIT_STATUSES;
  return stableStatusVariant(variants, turnSeed);
}

/** The header of a waiting card. `ข้อมูลที่คุณขอ` only when the message asked for something the rules
 *  above recognise as data; any other message is simply being answered. */
export function lineWaitCardHeader(messageText: string, language: LineReplyLanguage = lineReplyLanguage(messageText)): readonly [string, string] {
  if (language === 'en') return ['Your request', 'Checking the details'];
  const normalized = messageText.trim().toLowerCase();
  return LINE_WAIT_STATUS_RULES.some(([pattern]) => pattern.test(normalized)) ? ['ข้อมูลที่คุณขอ', 'กำลังตรวจสอบ'] : ['ข้อความของคุณ', 'กำลังหาคำตอบ'];
}

/** One waiting bubble. `card` is what the locked design shows at that moment; `text` is the same
 *  moment as a sentence, sent wherever the card cannot be drawn. */
export type LineWaitStage = { delayMs: number; text: string; card?: Pick<LineSystemCard, 'mascot' | 'header' | 'banner' | 'text'> };

/**
 * The ONE arrival acknowledgement for a media group (UAT 2026-09-29 "ส่งรูปที่ 2 ต่อกันแล้วเงียบไป": each
 * photo used to be acknowledged only when its own read started, so the second photo of a burst sat
 * unanswered until the first was done). One photo or one file keeps its sentence; a burst names its
 * count and promises every answer in order — without the one-minute figure a queue of reads cannot keep.
 */
export function lineMediaGroupAckText(mediaTypes: ReadonlyArray<'image' | 'file'>, language: LineReplyLanguage = 'th'): string {
  if (language === 'en') return 'Document received; I’ll send the reading results here when ready.';
  const photos = mediaTypes.filter((type) => type === 'image').length;
  const files = mediaTypes.length - photos;
  if (mediaTypes.length <= 1) return files ? LINE_FILE_RECEIVED_TEXT : LINE_MEDIA_RECEIVED_TEXT;
  if (!files) return `ได้รับรูปแล้ว ${photos} รูปค่ะ 🧾 น้องจะอ่านให้ทีละรูปตามลำดับ แล้วสรุปให้ครบทุกรูปนะคะ ระหว่างนี้คุยกับน้องต่อได้เลยค่ะ`;
  if (!photos) return `ได้รับไฟล์แล้ว ${files} ไฟล์ค่ะ 📄 กำลังอ่านเอกสารอยู่ เสร็จแล้วน้องจะสรุปให้ทางแชตนี้ครบทุกไฟล์นะคะ ระหว่างนี้คุยกับน้องต่อได้เลยค่ะ`;
  return `ได้รับรูป ${photos} รูปและไฟล์ ${files} ไฟล์แล้วค่ะ 🧾 น้องจะอ่านให้ทีละรายการ แล้วสรุปให้ครบทุกรายการในแชตนี้นะคะ ระหว่างนี้คุยกับน้องต่อได้เลยค่ะ`;
}

/**
 * The same acknowledgement as the locked "กำลังสแกน" card (design lock §8): what is being read, and
 * where the result will come. A file is never called a picture, a burst names its count, and nothing
 * here says how far the read is or when it ends — the server knows neither.
 */
export function lineMediaGroupAckStage(mediaTypes: ReadonlyArray<'image' | 'file'>, language: LineReplyLanguage = 'th'): LineWaitStage {
  if (language === 'en') { const text = lineMediaGroupAckText(mediaTypes, language); return { delayMs: 0, text, card: { mascot: 'scanning', header: { lines: ['Your document', 'Reading document'] }, text } }; }
  const photos = mediaTypes.filter((type) => type === 'image').length;
  const files = mediaTypes.length - photos;
  const what = mediaTypes.length <= 1 ? (files ? 'ไฟล์' : 'รูป')
    : !files ? `รูป ${photos} รูป` : !photos ? `ไฟล์ ${files} ไฟล์` : `รูป ${photos} รูปและไฟล์ ${files} ไฟล์`;
  const result = mediaTypes.length <= 1 ? 'อ่านเสร็จแล้ว น้องจะส่งสรุปให้ในแชตนี้ค่ะ'
    : !files ? 'น้องจะอ่านให้ทีละรูปตามลำดับ แล้วส่งสรุปให้ครบทุกรูปในแชตนี้ค่ะ'
      : !photos ? 'อ่านเสร็จแล้ว น้องจะส่งสรุปให้ครบทุกไฟล์ในแชตนี้ค่ะ'
        : 'น้องจะอ่านให้ทีละรายการ แล้วส่งสรุปให้ครบทุกรายการในแชตนี้ค่ะ';
  return { delayMs: 0, text: lineMediaGroupAckText(mediaTypes), card: scanningCard(what, `${result} ระหว่างนี้คุยกับน้องต่อได้เลย`) };
}

/** The locked scanning card: its header never changes, the banner names what is being read. */
function scanningCard(what: string, text: string): NonNullable<LineWaitStage['card']> {
  return { mascot: 'scanning', header: { lines: ['เอกสารที่ส่งมา', 'กำลังสแกน'] }, banner: { tone: 'scanning', text: `กำลังอ่านข้อมูลจาก${what}` }, text };
}

/** A waiting bubble as it is sent: the stage's card where LINE can fetch its pictures, its sentence otherwise. */
export function lineWaitStageMessage(stage: LineWaitStage, webBaseUrl: string | undefined): LineReplyMessage {
  const contents = stage.card && drawLineSystemCard({ ...stage.card, textStyle: 'waiting' }, webBaseUrl);
  if (!stage.card || !contents) return { type: 'text', text: stage.text.slice(0, 5000) };
  const said = [stage.card.banner?.text, stage.card.text].filter(Boolean).join(' ');
  return { type: 'flex', altText: lineMessagePreview(said), canonicalText: stage.text, contents };
}

/**
 * Waiting ladder for one dispatched turn (latency spec §10). With the spinner on, quick text turns
 * stay bubble-free (Owner 2026-08-27 "ลดข้อความซ้อน") and only a genuinely slow turn gets ONE status
 * before the 60 s loading window lapses; with the spinner off, the topic status at 5 s is the only
 * early "working" signal and the slow status still follows. A media GROUP acknowledges once, on arrival
 * (`lineMediaGroupAckText`), so its turns keep only the slow-read nudge. Text delays anchor to the last
 * bubble's durable acceptance, not processing start.
 */
export function lineWaitStages(input: {
  kind: 'text' | 'media';
  language?: LineReplyLanguage;
  /** A file's read is async and finishes with its own push, so a file turn has no slow nudge. */
  mediaType?: 'image' | 'file';
  messageText: string;
  seed: string;
  loadingEnabled: boolean;
  latestAcceptedAt: number;
  now: number;
}): LineWaitStage[] {
  const language = input.language ?? lineReplyLanguage(input.messageText);
  if (language === 'en') {
    if (input.kind === 'media' && input.mediaType === 'file') return [];
    const stage = (delayMs: number, text: string): LineWaitStage => ({ delayMs: Math.max(0, input.latestAcceptedAt + delayMs - input.now), text, card: { mascot: 'general', header: { lines: ['Your request', input.kind === 'media' ? 'Reading document' : 'Checking the details'] }, text } });
    const slow = stage(LINE_WAIT_STATUS_SLOW_DELAY_MS, input.kind === 'media' ? 'I’m still reading the document; please wait a little longer.' : 'I’m still checking your question; please wait a little longer.');
    return input.loadingEnabled || input.kind === 'media' ? [slow] : [stage(LINE_WAIT_STATUS_DELAY_MS, lineWaitStatusText(input.messageText, input.seed, language)), slow];
  }
  if (input.kind === 'media') {
    // The slow-turn nudge is written for a photo the customer is watching for; for a file it would be
    // a second promise nobody is waiting on.
    // It is the same read as the acknowledgement's, a minute on: the scanning card, with the nudge as its sentence.
    return input.mediaType === 'file' ? []
      : [{ delayMs: LINE_WAIT_STATUS_SLOW_DELAY_MS, text: LINE_MEDIA_SLOW_STATUS_TEXT, card: scanningCard('รูป', LINE_MEDIA_SLOW_STATUS_TEXT) }];
  }
  const anchored = (delayMs: number) => Math.max(0, input.latestAcceptedAt + delayMs - input.now);
  // The locked "กำลังตรวจสอบ" card: the sentence is the stage's own, the header says what is being worked on.
  const checking = (text: string): LineWaitStage['card'] => ({ mascot: 'general', header: { lines: lineWaitCardHeader(input.messageText) }, text });
  const slowStage = { delayMs: anchored(LINE_WAIT_STATUS_SLOW_DELAY_MS), text: LINE_SLOW_TURN_STATUS_TEXT, card: checking(LINE_SLOW_TURN_STATUS_TEXT) };
  const early = lineWaitStatusText(input.messageText, input.seed);
  return input.loadingEnabled
    ? [slowStage]
    : [
      { delayMs: anchored(LINE_WAIT_STATUS_DELAY_MS), text: early, card: checking(early) },
      slowStage,
    ];
}

export type LineBufferFlushTiming = {
  /** Quiet time after the last bubble before flushing. 0 disables buffering. */
  debounceMs: number;
  /** Upper bound from the FIRST buffered bubble — prevents starvation. */
  maxWaitMs: number;
};

function textLength(item: LineBufferItem): number {
  return item.kind === 'media' ? 0 : item.text.length + 1; // +1 for the join separator
}

export function joinedTextLength(items: LineBufferItem[]): number {
  return items.reduce((total, item) => total + textLength(item), 0);
}

export function bufferAtCapacity(items: LineBufferItem[], maxTextChars = LINE_BUFFER_MAX_TEXT_CHARS): boolean {
  return items.length >= LINE_BUFFER_MAX_ITEMS || joinedTextLength(items) >= maxTextChars;
}

/** How many of `incoming` (order-preserving prefix) still fit into `pending`. */
export function fittingPrefixCount(pending: LineBufferItem[], incoming: LineBufferItem[]): number {
  let count = 0;
  let items = pending.length;
  let chars = joinedTextLength(pending);
  for (const item of incoming) {
    if (items + 1 > LINE_BUFFER_MAX_ITEMS || chars + textLength(item) > LINE_BUFFER_MAX_TEXT_CHARS) break;
    items += 1;
    chars += textLength(item);
    count += 1;
  }
  return count;
}

/**
 * API-owned buffer/ingress trace leg for one dispatched LINE turn (latency/autonomy §12). It carries
 * ONLY the ingress/buffer/queue timings the buffer owns (durable-acceptance anchor, buffer wait, queue
 * wait) — NOT any lumped "dispatch" duration, and deliberately NOT the runtime-owned
 * `LineAiStageDurations`. The precise downstream durations are the separate `line.ai.stage` seams. It
 * is ONE leg of a correlation chain joined by `webhookEventId`; the other legs are emitted where the
 * API actually observes each stage, and are true to what each store holds:
 *   - `line.ai.accepted` / this trace `acceptedAtMs` → durable acceptance;
 *   - `line.ai.loading_started` / `line.ai.loading_accepted` → 1:1 loading milestones (server-side);
 *   - `line.ai.stage` (webhookEventId) → distinct API-observed stage durations: intake_route,
 *     gateway_turn, capture_execute, render, persistence, line_delivery (emitted by
 *     ProcessLineWebhookUseCase, not lumped here). `capture_execute` wraps only the real expense-capture
 *     use case and `render` only trusted message construction, so a turn emits the stages it actually
 *     ran; `persistence` covers the full AI turn AND the best-effort intake memory write (greeting,
 *     reimbursement, clarify, capture), so an intake-only turn no longer reports zero database time;
 *     spec §11.1 also names `reimbursement_execute`, which is absent on purpose while this release
 *     creates no reimbursement (see ProcessLineWebhookUseCase.timeStage);
 *   - `line.ai.turn_summary` (webhookEventId + requestId) → intent, refused/refusalReason/errorCode,
 *     model provider + ids (from lineage/usage), model-call and tool-call counts, deliveryResult, and
 *     usage token totals. `fallbackReason` is a DISTINCT field, always null (not observable, never
 *     conflated with refusal/error); lane and cost are also explicit null (lanes are Phase 4; cost is
 *     metered separately in recordCompanyAiUsage);
 *   - persisted `AiTurn` (webhookEventId) → intent/agent, refused/refusalReason/errorCode, and
 *     `observabilityJson` (runtime `stageDurationsMs`, `modelCallCount`). It does NOT store lane,
 *     usage/cost, or requestId;
 *   - gateway `ai.turn.complete` (requestId) → per-model-call durations/tokens/throttle;
 *   - `line.ai.terminal` (webhookEventId) → the terminal outcome CLASS (delivered / refused /
 *     unavailable / …), not the raw reply-vs-push mode — that lives in `line.ai.turn_summary`.
 * Every event above carries no raw message text or LINE user id. Remaining Phase-0 limitation:
 * finer sub-durations INSIDE the gateway turn (per model call / per tool) belong to the runtime
 * `stageDurationsMs` and gateway leg, and true fused-plan-vs-lane timing is Phase 3+; not claimed here.
 */
export type LineAiApiTraceSegment = 'text' | 'command' | 'media';

export type LineAiApiTrace = {
  webhookEventId: string;
  chat: 'one_to_one' | 'group';
  segment: LineAiApiTraceSegment;
  /** Immutable durable-acceptance milestone (epoch ms) — the anchor every duration is measured from. */
  acceptedAtMs: number;
  /** First buffered bubble (accepted) → flush. */
  bufferWaitMs: number;
  /** Flush → worker dequeue (turn start). */
  queueWaitMs: number;
  /** Whether accept-time loading was requested for this turn (Phase 1, 1:1 non-command only). */
  loadingRequested: boolean;
};

/** Assemble one API trace (ingress/buffer/queue only — NO lumped dispatch duration; the precise
 *  downstream seams are the `line.ai.stage` events). Clamps a negative/undefined interval to 0 so a
 *  clock skew or an absent accept-time never reports a nonsensical duration. Pure. */
export function buildLineAiApiTrace(input: {
  webhookEventId: string;
  oneToOne: boolean;
  segment: LineAiApiTraceSegment;
  /** Durable-acceptance instant of the batch's first bubble (the timing anchor). */
  firstAcceptedAtMs: number | null;
  flushedAtMs: number;
  dequeuedAtMs: number;
  loadingRequested: boolean;
}): LineAiApiTrace {
  const clamp = (ms: number) => (Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0);
  return {
    webhookEventId: input.webhookEventId,
    chat: input.oneToOne ? 'one_to_one' : 'group',
    segment: input.segment,
    acceptedAtMs: input.firstAcceptedAtMs ?? 0,
    bufferWaitMs: input.firstAcceptedAtMs === null ? 0 : clamp(input.flushedAtMs - input.firstAcceptedAtMs),
    queueWaitMs: clamp(input.dequeuedAtMs - input.flushedAtMs),
    loadingRequested: input.loadingRequested,
  };
}

/**
 * Concurrent debounce cohorts for the latency/autonomy experiment: 1,000 ms primary candidate,
 * 1,500 ms conservative candidate, and the implemented 2,000 ms control (spec §10). The control is
 * present so ~1/3 of assigned traffic stays on the current behaviour for a matched comparison.
 */
export const LINE_AI_DEBOUNCE_COHORTS_MS = [1_000, 1_500, 2_000] as const;

/**
 * Stable, privacy-safe debounce-cohort assignment (spec §10). When the experiment is off, has no
 * secret, or the (company, chat) key is unknown, EVERY chat keeps `configuredMs` — so the default
 * path is unchanged. When on, an experiment-secret HMAC of the assignment key deterministically picks
 * one concurrent cohort. Only the resulting millisecond value leaves this function: neither the raw
 * identifiers nor the HMAC bytes are returned, so a caller has nothing identifier-shaped to log.
 */
export function debounceCohortMs(input: {
  enabled: boolean;
  secret: string | undefined;
  assignmentKey: string;
  configuredMs: number;
}): number {
  if (!input.enabled || !input.secret || !input.assignmentKey) return input.configuredMs;
  const digest = createHmac('sha256', input.secret).update(input.assignmentKey).digest();
  return LINE_AI_DEBOUNCE_COHORTS_MS[digest.readUInt32BE(0) % LINE_AI_DEBOUNCE_COHORTS_MS.length];
}

/** Milliseconds until the buffer should flush; <= 0 means flush now. */
export function nextFlushDelayMs(firstItemAtMs: number, nowMs: number, timing: LineBufferFlushTiming): number {
  const maxWaitRemaining = firstItemAtMs + timing.maxWaitMs - nowMs;
  return Math.min(timing.debounceMs, Math.max(0, maxWaitRemaining));
}

export function sortBatchItems(items: LineBufferItem[]): LineBufferItem[] {
  return [...items].sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
}

export function segmentBatch(sortedItems: LineBufferItem[]): LineBatchGroup[] {
  const groups: LineBatchGroup[] = [];
  let content: LineBufferItem[] = [];

  const closeContent = () => {
    if (content.length === 0) return;
    const mediaItems = content.filter((item): item is LineBufferMediaItem => item.kind === 'media');
    const textItems = content.filter((item): item is LineBufferTextItem => item.kind === 'text');
    groups.push(mediaItems.length > 0 ? { kind: 'media', mediaItems, textItems } : { kind: 'text', textItems });
    content = [];
  };

  for (const item of sortedItems) {
    if (item.kind === 'command') {
      closeContent();
      groups.push({ kind: 'command', item });
    } else {
      content.push(item);
    }
  }
  closeContent();
  return groups;
}

/** Bubble boundaries become newlines; normalizeLineText collapses them later. */
export function joinGroupText(textItems: LineBufferTextItem[]): string {
  return textItems.map((item) => item.text).join('\n');
}
