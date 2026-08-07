/**
 * Pure buffering/segmentation logic for LINE AI multi-bubble utterances.
 * No NestJS, Prisma, HTTP, or timer imports — the caller passes time in.
 * Spec: docs/specs/line-ai-message-buffering-spec.md
 */

export type LineBufferTextItem = {
  kind: 'text' | 'command';
  webhookEventId: string;
  replyToken: string;
  text: string;
  lineMessageId?: string;
  /** LINE event timestamp (ms) — used to heal cross-POST arrival reordering. */
  timestamp: number;
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
  seq: number;
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
