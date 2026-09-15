/**
 * The one pending draft-edit preview a chat may hold (draft-control spec §5.4/§7).
 *
 * Key: `line-ai:draft-preview:<companyId>:<chatKeyHash>`, TTL 600s, newest replaces oldest — one
 * question in flight per chat, so a "ยืนยัน" can only ever mean the change the chat was last shown.
 *
 * Two deliberate choices:
 *
 * - The key uses the chat **hash**, not the raw LINE chat id. The spec writes `<chatKey>`; every
 *   other LINE surface in this repo already keeps raw LINE/group ids out of stores the model or a
 *   log can reach, and the tool lane only ever holds the hash anyway. Same uniqueness, less PII.
 * - It **fails closed in production**: without a shared store the preview would land in one task's
 *   memory and the confirm would arrive at another, so the user would be told "รายการเปลี่ยนไปแล้ว"
 *   for a change nobody made. No store ⇒ no preview offered ⇒ the honest web-link reply. Outside
 *   production a per-process map keeps the LINE fake harness able to drive J3 end to end.
 *
 * The payload carries ids, hashes and the patch — never message text, never an image, never a
 * vendor's PII beyond what the record already holds (PDPA §9).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import type { LineDraftUpdatePreview } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type { LineDraftPatch } from '../../domain/logic/line-draft-update.logic';

/** Spec §5.4: ten minutes. Long enough to read the card on a phone, short enough that a stale
 *  proposal cannot be confirmed against a record someone has since reworked in web. */
export const LINE_DRAFT_PREVIEW_TTL_SECONDS = 600;
/** How long "you already confirmed this" stays sayable. A UI courtesy, not a correctness device. */
export const LINE_DRAFT_APPLIED_TTL_SECONDS = 120;

export type StoredDraftPreview = {
  previewId: string;
  companyId: string;
  userId: string;
  chatKeyHash: string;
  expenseId: string;
  /** The row revision the preview was computed against; the confirm refuses anything else. */
  expenseUpdatedAt: string;
  /** Only a committed edit can authorize the short-lived already-applied confirmation. */
  appliedExpenseUpdatedAt?: string;
  patch: LineDraftPatch;
  preview: LineDraftUpdatePreview;
  /** The turn that created it, so a card is only attached to the turn that asked for it. */
  requestId: string;
};

/** The Redis surface this store needs; ioredis satisfies it and specs inject a two-method fake. */
export type DraftPreviewRedis = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(key: string): Promise<number>;
  quit(): Promise<unknown>;
};

@Injectable()
export class LineDraftPreviewStore {
  private readonly logger = new Logger(LineDraftPreviewStore.name);
  private client: DraftPreviewRedis | null = null;
  private clientFailed = false;
  private readonly local = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    @Inject(AppConfigService)
    @Optional()
    private readonly config?: Pick<AppConfigService, 'redisUrl' | 'isProduction'>,
  ) {}

  /** Specs inject an in-memory fake; production lazily connects ioredis. */
  attachClient(client: DraftPreviewRedis): void {
    this.client = client;
    this.clientFailed = false;
  }

  /** True when a preview written now can be read back by the task that answers the postback. */
  get available(): boolean {
    return Boolean(this.client) || Boolean(this.config?.redisUrl) || !this.config?.isProduction;
  }

  async save(entry: StoredDraftPreview): Promise<boolean> {
    // A NEW question retires the old answer. Belt to the apply path's braces: that path only
    // consults the applied memory when nothing is pending, but leaving a stale confirmation
    // sitting next to a live preview is a trap for the next reader of either.
    await this.forget(entry.companyId, entry.chatKeyHash);
    const key = previewKey(entry.companyId, entry.chatKeyHash);
    const value = JSON.stringify(entry);
    const redis = this.redis();
    // No Redis CONFIGURED at all is the local-development shape, and the in-process map is what
    // lets the LINE fake harness drive J3 end to end.
    if (!redis) return this.saveLocal(key, value);
    try {
      await redis.set(key, value, 'EX', LINE_DRAFT_PREVIEW_TTL_SECONDS);
      return true;
    } catch (err) {
      // A CONFIGURED Redis that FAILED is a different thing, and falling back to the per-process
      // map here would hide it: UAT would look healthy while confirms landed on whichever task
      // happened to hold the preview. Refuse, loudly, in every environment.
      this.logger.warn({ msg: 'expense.line_ai.draft_preview.store_failed', error: (err as Error).message });
      return false;
    }
  }

  async load(companyId: string, chatKeyHash: string): Promise<StoredDraftPreview | null> {
    return this.read(previewKey(companyId, chatKeyHash));
  }

  private async read(key: string): Promise<StoredDraftPreview | null> {
    const redis = this.redis();
    let raw: string | null = null;
    if (redis) {
      try {
        raw = await redis.get(key);
      } catch (err) {
        this.logger.warn({ msg: 'expense.line_ai.draft_preview.read_failed', error: (err as Error).message });
        raw = null;
      }
    }
    raw ??= this.loadLocal(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredDraftPreview;
    } catch {
      // A payload this process cannot read is a payload it must not act on.
      this.local.delete(key);
      return null;
    }
  }

  /**
   * Remember, briefly, that this chat's preview was APPLIED. A person whose confirm looks slow taps
   * the button again; without this the second tap finds an empty slot and is told nothing was
   * pending, which is a lie about an edit they just made. Short TTL — this is a UI courtesy, and
   * the `updatedAt` guard is what actually prevents a second write.
   */
  async remember(companyId: string, chatKeyHash: string, entry: StoredDraftPreview): Promise<void> {
    const key = appliedKey(companyId, chatKeyHash);
    const value = JSON.stringify(entry);
    const redis = this.redis();
    if (!redis) {
      this.saveLocal(key, value, LINE_DRAFT_APPLIED_TTL_SECONDS);
      return;
    }
    try {
      await redis.set(key, value, 'EX', LINE_DRAFT_APPLIED_TTL_SECONDS);
    } catch (err) {
      // Losing this only costs the second tap its nicer wording.
      this.logger.warn({ msg: 'expense.line_ai.draft_preview.remember_failed', error: (err as Error).message });
    }
  }

  /** The preview this chat applied a moment ago, if any. */
  async loadApplied(companyId: string, chatKeyHash: string): Promise<StoredDraftPreview | null> {
    return this.read(appliedKey(companyId, chatKeyHash));
  }

  /** Drop the "already applied" memory — a new proposal has superseded it. */
  async forget(companyId: string, chatKeyHash: string): Promise<void> {
    const key = appliedKey(companyId, chatKeyHash);
    this.local.delete(key);
    const redis = this.redis();
    if (!redis) return;
    try {
      await redis.del(key);
    } catch (err) {
      // Its own short TTL is the backstop, and the apply path checks it only when nothing pends.
      this.logger.warn({ msg: 'expense.line_ai.draft_preview.forget_failed', error: (err as Error).message });
    }
  }

  async discard(companyId: string, chatKeyHash: string): Promise<void> {
    const key = previewKey(companyId, chatKeyHash);
    this.local.delete(key);
    const redis = this.redis();
    if (!redis) return;
    try {
      await redis.del(key);
    } catch (err) {
      // The TTL is the backstop; a failed delete cannot re-apply anything because the apply path
      // also checks the record's `updatedAt`, which the committed write has already moved.
      this.logger.warn({ msg: 'expense.line_ai.draft_preview.discard_failed', error: (err as Error).message });
    }
  }

  private saveLocal(key: string, value: string, ttlSeconds = LINE_DRAFT_PREVIEW_TTL_SECONDS): boolean {
    if (this.config?.isProduction) return false;
    if (this.local.size > 1_000) {
      const now = Date.now();
      for (const [candidate, entry] of this.local) if (entry.expiresAt <= now) this.local.delete(candidate);
    }
    this.local.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
    return true;
  }

  private loadLocal(key: string): string | null {
    const entry = this.local.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.local.delete(key);
      return null;
    }
    return entry.value;
  }

  private redis(): DraftPreviewRedis | null {
    if (this.client) return this.client;
    if (this.clientFailed || !this.config?.redisUrl) return null;
    try {
      this.client = new Redis(this.config.redisUrl, {
        enableOfflineQueue: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 3_000,
        commandTimeout: 2_000,
      }) as unknown as DraftPreviewRedis;
      (this.client as unknown as { on?: (event: string, fn: (err: Error) => void) => void }).on?.('error', (err) => {
        this.logger.warn({ msg: 'expense.line_ai.draft_preview.redis_error', error: err.message });
      });
    } catch (err) {
      this.clientFailed = true;
      this.logger.warn({ msg: 'expense.line_ai.draft_preview.unavailable', error: (err as Error).message });
      return null;
    }
    return this.client;
  }
}

export function previewKey(companyId: string, chatKeyHash: string): string {
  return `line-ai:draft-preview:${companyId}:${chatKeyHash}`;
}

/** Same company+CHAT scoping as the preview itself — a confirmation is as chat-bound as the card. */
export function appliedKey(companyId: string, chatKeyHash: string): string {
  return `line-ai:draft-applied:${companyId}:${chatKeyHash}`;
}
