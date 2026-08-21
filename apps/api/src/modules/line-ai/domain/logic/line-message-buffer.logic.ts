/**
 * Pure buffering/segmentation logic for LINE AI multi-bubble utterances.
 * No NestJS, Prisma, HTTP, or timer imports — the caller passes time in.
 * Spec: docs/specs/line-ai-message-buffering-spec.md
 */
import { createHmac } from 'node:crypto';

export type LineBufferTextItem = {
  kind: 'text' | 'command';
  webhookEventId: string;
  replyToken: string;
  text: string;
  lineMessageId?: string;
  /** LINE event timestamp (ms) — used to heal cross-POST arrival reordering. */
  timestamp: number;
  /** Wall-clock (ms) when durable acceptance succeeded/reclaimed. Anchors the debounce boundary,
   *  the long-wait status timer, and the API trace to first durable acceptance (spec §10/§12). */
  acceptedAt: number;
  /** Process-local arrival sequence — tie-break for identical timestamps. */
  seq: number;
};

export type LineBufferMediaItem = {
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
export const LINE_WAIT_STATUS_DELAY_MS = 2_000;

const LINE_WAIT_STATUS_RULES: Array<[RegExp, string]> = [
  [/รายงาน|report/, 'กำลังจัดเตรียมรายงานให้นะคะ...'],
  [/สรุป|ภาพรวม|summary|brief/, 'กำลังสรุปข้อมูลให้อ่านง่ายอยู่นะคะ...'],
  [/เปรียบเทียบ|เทียบ|ต่างกัน|versus|\bvs\.?\b/, 'กำลังเปรียบเทียบข้อมูลให้นะคะ...'],
  [/คำนวณ|รวมทั้งหมด|ค่าเฉลี่ย|เปอร์เซ็นต์|เท่าไหร่|กี่บาท|กี่รายการ|calculate|average|percent/, 'กำลังคำนวณตัวเลขให้นะคะ...'],
  [/วิเคราะห์|แนวโน้ม|สาเหตุ|ผิดปกติ|analyse|analyze|trend/, 'กำลังวิเคราะห์ข้อมูลให้อยู่นะคะ...'],
  [/ค้นหา|ค้นข้อมูล|search|find|lookup/, 'กำลังค้นข้อมูลที่เกี่ยวข้องให้อยู่นะคะ...'],
  [/ข้อมูล|ยอดขาย|ค่าใช้จ่าย|ลูกค้า|สต็อก|สินค้าคงคลัง|ภาษี|ใบแจ้งหนี้|สถานะ|รายการ|อนุมัติ/, 'กำลังตรวจสอบข้อมูลในระบบให้นะคะ...'],
];

/** One truthful waiting line selected from the request; no model call needed. */
export function lineWaitStatusText(messageText: string, kind: 'text' | 'media' = 'text'): string {
  if (kind === 'media') return 'ได้รับรูปแล้วค่ะ 🧾 กำลังอ่านเอกสารอยู่ ระหว่างนี้คุยกับน้องต่อได้เลยนะคะ';
  const normalized = messageText.trim().toLowerCase();
  return LINE_WAIT_STATUS_RULES.find(([pattern]) => pattern.test(normalized))?.[1]
    ?? 'ขอคิดสักครู่นะคะ 😊';
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

export function bufferAtCapacity(items: LineBufferItem[]): boolean {
  return items.length >= LINE_BUFFER_MAX_ITEMS || joinedTextLength(items) >= LINE_BUFFER_MAX_TEXT_CHARS;
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
 * 1,500 ms conservative candidate, and the implemented 2,500 ms control (spec §10). The control is
 * present so ~1/3 of assigned traffic stays on the current behaviour for a matched comparison.
 */
export const LINE_AI_DEBOUNCE_COHORTS_MS = [1_000, 1_500, 2_500] as const;

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
