/**
 * The one pending draft-edit preview a chat may hold (draft-control spec §5.4/§7).
 *
 * Key: `line-ai:draft-preview:<companyId>:<chatKeyHash>`, TTL 600s, newest replaces oldest unless
 * a card is being confirmed/cancelled — then its claim keeps that exact preview current.
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
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { LineWorkflowControl, LineDraftUpdatePreview, VendorCounterpartyAutoSaveResult } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type { LineDraftPatch } from '../../domain/logic/line-draft-update.logic';

/** Spec §5.4: ten minutes. Long enough to read the card on a phone, short enough that a stale
 *  proposal cannot be confirmed against a record someone has since reworked in web. */
export const LINE_DRAFT_PREVIEW_TTL_SECONDS = 600;
/** An in-flight postback may finish after the preview's own ten-minute display window. */
export const LINE_DRAFT_PREVIEW_CLAIM_TTL_SECONDS = 1_800;
/** How long "you already confirmed this" stays sayable. A UI courtesy, not a correctness device. */
export const LINE_DRAFT_APPLIED_TTL_SECONDS = 120;

export const LINE_DRAFT_RECOVERY_TTL_SECONDS = 7 * 86400;
export type LineActionRecovery = { companyId: string; userId: string; tokenHash: string;
  act: Extract<LineWorkflowControl, { action: 'wf_open' }>['act']; id: string; pm?: string; pd?: string; pa?: string };

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
  vendorCounterpartyAutoSave?: VendorCounterpartyAutoSaveResult;
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
  eval?(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
  quit(): Promise<unknown>;
};

@Injectable()
export class LineDraftPreviewStore<T extends { previewId: string; companyId: string; chatKeyHash: string } = StoredDraftPreview> {
  private readonly logger = new Logger(LineDraftPreviewStore.name);
  private client: DraftPreviewRedis | null = null;
  private clientFailed = false;
  private readonly local = new Map<string, { value: string; expiresAt: number }>();
  private readonly localClaims = new Map<string, { token: string; expiresAt: number }>();

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

  async save(entry: T, recovery?: LineActionRecovery): Promise<boolean> {
    // A NEW question retires the old answer. Belt to the apply path's braces: that path only
    // consults the applied memory when nothing is pending, but leaving a stale confirmation
    // sitting next to a live preview is a trap for the next reader of either.
    const key = previewKey(entry.companyId, entry.chatKeyHash);
    const value = JSON.stringify(entry);
    const redis = this.redis();
    if (this.hasLocalClaim(key)) return false;
    // No Redis CONFIGURED at all is the local-development shape, and the in-process map is what
    // lets the LINE fake harness drive J3 end to end.
    if (!redis) {
      this.local.delete(appliedKey(entry.companyId, entry.chatKeyHash));
      if (recovery) this.saveLocal(previewKey(entry.companyId, `recover:${entry.previewId}`), JSON.stringify(recovery), LINE_DRAFT_RECOVERY_TTL_SECONDS);
      return this.saveLocal(key, value);
    }
    try {
      if (redis.eval && recovery) {
        return Number(await redis.eval(
          "if redis.call('EXISTS',KEYS[2])==1 then return 0 end; redis.call('DEL',KEYS[3]); redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); redis.call('SET',KEYS[4],ARGV[3],'EX',ARGV[4]); return 1",
          4, key, claimKey(entry.companyId, entry.chatKeyHash), appliedKey(entry.companyId, entry.chatKeyHash),
          previewKey(entry.companyId, `recover:${entry.previewId}`), value, String(LINE_DRAFT_PREVIEW_TTL_SECONDS),
          JSON.stringify(recovery), String(LINE_DRAFT_RECOVERY_TTL_SECONDS),
        )) === 1;
      }
      if (redis.eval) {
        this.local.delete(appliedKey(entry.companyId, entry.chatKeyHash));
        return Number(await redis.eval(
          "if redis.call('EXISTS',KEYS[2])==1 then return 0 end; redis.call('DEL',KEYS[3]); redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[2]); return 1",
          3, key, claimKey(entry.companyId, entry.chatKeyHash), appliedKey(entry.companyId, entry.chatKeyHash),
          value, String(LINE_DRAFT_PREVIEW_TTL_SECONDS),
        )) === 1;
      }
      if (await redis.get(claimKey(entry.companyId, entry.chatKeyHash))) return false;
      await this.forget(entry.companyId, entry.chatKeyHash);
      if (recovery) await redis.set(previewKey(entry.companyId, `recover:${entry.previewId}`), JSON.stringify(recovery), 'EX', LINE_DRAFT_RECOVERY_TTL_SECONDS);
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

  async loadRecovery(companyId: string, previewId: string): Promise<LineActionRecovery | null> {
    return this.read<LineActionRecovery>(previewKey(companyId, `recover:${previewId}`));
  }

  async discardRecovery(companyId: string, previewId: string): Promise<void> {
    await this.discard(companyId, `recover:${previewId}`);
  }

  async load(companyId: string, chatKeyHash: string): Promise<T | null> {
    return this.read(previewKey(companyId, chatKeyHash));
  }

  /** Atomically reserve only the preview a card names, so fast-dispatched buttons cannot act on a
   *  replacement preview or consume one another's proposal. */
  async claimCurrent(companyId: string, chatKeyHash: string, previewId: string): Promise<{ entry: T; token: string } | null> {
    const key = previewKey(companyId, chatKeyHash);
    const token = randomUUID();
    const redis = this.redis();
    if (!redis) {
      const current = this.loadLocal(key);
      if (!current || this.hasLocalClaim(key)) return null;
      try {
        const entry = JSON.parse(current) as T;
        if (entry.previewId !== previewId) return null;
        this.localClaims.set(key, { token, expiresAt: Date.now() + LINE_DRAFT_PREVIEW_CLAIM_TTL_SECONDS * 1_000 });
        return { entry, token };
      } catch {
        this.local.delete(key);
        return null;
      }
    }
    if (!redis.eval) {
      const entry = await this.read(key);
      if (!entry || entry.previewId !== previewId || this.hasLocalClaim(key)) return null;
      this.localClaims.set(key, { token, expiresAt: Date.now() + LINE_DRAFT_PREVIEW_CLAIM_TTL_SECONDS * 1_000 });
      return { entry, token };
    }
    try {
      const raw = await redis.eval(
        "local raw=redis.call('GET',KEYS[1]); if not raw then return nil end; local ok,entry=pcall(cjson.decode,raw); if not ok or entry.previewId~=ARGV[1] then return nil end; if redis.call('SET',KEYS[2],ARGV[2],'NX','EX',ARGV[3]) then return raw end; return nil",
        2, key, claimKey(companyId, chatKeyHash), previewId, token, String(LINE_DRAFT_PREVIEW_CLAIM_TTL_SECONDS),
      );
      if (typeof raw !== 'string') return null;
      const entry = JSON.parse(raw) as T;
      return entry.previewId === previewId ? { entry, token } : null;
    } catch (err) {
      this.logger.warn({ msg: 'expense.line_ai.draft_preview.claim_failed', error: (err as Error).message });
      return null;
    }
  }

  async releaseClaim(companyId: string, chatKeyHash: string, token: string): Promise<void> {
    const redis = this.redis();
    if (!redis) {
      const key = previewKey(companyId, chatKeyHash);
      if (this.localClaims.get(key)?.token === token) this.localClaims.delete(key);
      return;
    }
    if (!redis.eval) {
      const key = previewKey(companyId, chatKeyHash);
      if (this.localClaims.get(key)?.token === token) this.localClaims.delete(key);
      return;
    }
    try {
      await redis.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
        1, claimKey(companyId, chatKeyHash), token,
      );
    } catch (err) {
      this.logger.warn({ msg: 'expense.line_ai.draft_preview.claim_release_failed', error: (err as Error).message });
    }
  }

  private async read<U = T>(key: string): Promise<U | null> {
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
      return JSON.parse(raw) as U;
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
  async remember(companyId: string, chatKeyHash: string, entry: T): Promise<void> {
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
  async loadApplied(companyId: string, chatKeyHash: string): Promise<T | null> {
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

  /** Remove a preview only when it is still the one whose delivery failed. */
  async discardIfCurrent(companyId: string, chatKeyHash: string, previewId: string): Promise<boolean> {
    const key = previewKey(companyId, chatKeyHash);
    let discardedLocal = false;
    const local = this.loadLocal(key);
    if (local) {
      try {
        if ((JSON.parse(local) as T).previewId === previewId) {
          this.local.delete(key);
          discardedLocal = true;
        }
      } catch { this.local.delete(key); }
    }
    const redis = this.redis();
    if (!redis) return discardedLocal;
    try {
      if (redis.eval) {
        return Number(await redis.eval(
          "local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end; local ok,entry=pcall(cjson.decode,raw); if ok and entry.previewId==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
          1, key, previewId,
        )) === 1 || discardedLocal;
      }
      // Test doubles without EVAL take this best-effort branch; production ioredis is atomic above.
      const raw = await redis.get(key);
      if (!raw || (JSON.parse(raw) as T).previewId !== previewId) return false;
      return (await redis.del(key)) === 1 || discardedLocal;
    } catch (err) {
      this.logger.warn({ msg: 'expense.line_ai.draft_preview.discard_current_failed', error: (err as Error).message });
      return false;
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

  private hasLocalClaim(key: string): boolean {
    const claim = this.localClaims.get(key);
    if (!claim) return false;
    if (claim.expiresAt > Date.now()) return true;
    this.localClaims.delete(key);
    return false;
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

function claimKey(companyId: string, chatKeyHash: string): string {
  return 'line-ai:draft-preview-claim:' + companyId + ':' + chatKeyHash;
}

/** Same company+CHAT scoping as the preview itself — a confirmation is as chat-bound as the card. */
export function appliedKey(companyId: string, chatKeyHash: string): string {
  return `line-ai:draft-applied:${companyId}:${chatKeyHash}`;
}
