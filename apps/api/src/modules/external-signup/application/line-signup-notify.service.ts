import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { pushLineMessages } from '../../auth/infrastructure/system-line-push';
import { buildProfileGuardNudgeCard } from '../../line-ai/domain/logic/line-business-card.logic';
import { bangkokDayKey } from '../domain/business-hours.logic';
import { SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';
import { SIGNUP_QUEUE_PATH, SignupAdminNotifyService, shortLineIdHash } from './signup-admin-notify.service';
import { SignupOpsAlertService } from './signup-ops-alert.service';

/**
 * Reserved for the signup drain, like its two siblings: the generic workflow drain must exclude
 * every one of these or it claims them and publishes them into a void.
 */
export const LINE_SIGNUP_PUSH_EVENT_TYPE = 'push.line_signup.requested';
/** §7/§8 "ติดต่อเจ้าหน้าที่" — the operators being told a human is waiting. */
export const LINE_SUPPORT_NOTICE_EVENT_TYPE = 'notify.line_support_request.requested';

/**
 * LINE said "not now, come back at T" rather than "this failed". Carries LINE's own schedule so the
 * drain can honour it instead of climbing a ladder that would DEAD the row inside two minutes.
 */
export class LinePushThrottledError extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(message);
    this.name = 'LinePushThrottledError';
  }
}

/** Which message the queued push is. Also the audit/telemetry name L-D counts by. */
export type LineSignupPushKind = 'approved' | 'attached' | 'rejected' | 'profile_guard';

/** §3.6: seven days of real use, or five successful reads — whichever comes first. */
export const PROFILE_GUARD_AFTER_DAYS = 7;
export const PROFILE_GUARD_AFTER_READS = 5;

/** Owner copy (§7). No plus sign in customer text; write "และ". */
export function approvedMessageTh(companyName: string): string {
  return `🎉 ร้าน ${companyName} พร้อมใช้แล้วค่ะ ทดลองฟรี 30 วัน ให้ AI อ่านรูปได้ 15 ครั้ง `
    + 'ลองส่งรูปใบเสร็จมาในแชทนี้ได้เลย หรือกดเปิดหน้าเว็บนะคะ';
}

export function attachedMessageTh(companyName: string): string {
  return `🎉 เพิ่มร้าน ${companyName} ให้บัญชีของคุณแล้วค่ะ สลับร้านได้ในเมนู หรือกดเปิดหน้าเว็บนะคะ`;
}

export function rejectedMessageTh(displayName: string | null, companyName: string): string {
  const greeting = displayName?.trim() ? `เรียน คุณ${displayName.trim()} ` : '';
  return `${greeting}ขอบคุณที่สนใจมั่งมีพลัสค่ะ ตอนนี้เรายังไม่สามารถเปิดร้าน ${companyName} ให้ได้ ต้องขออภัยด้วยนะคะ `
    + 'หากต้องการสอบถามหรือส่งข้อมูลเพิ่มเติม ติดต่อทีมงานได้ที่ โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com '
    + '(จันทร์–เสาร์ 9:00–18:00) ทีมงานยินดีพิจารณาให้อีกครั้งค่ะ';
}

/**
 * P10-L §7. Every push this flow sends, and the only place it sends them.
 *
 * Enqueue-then-drain, like the Flow B claim email: the applicant's HTTP response and the admin's
 * decision must never wait on LINE, and the outbox `eventKey` is what makes "exactly once" a
 * database fact rather than a promise. Both provisioning paths — the normal finish and the
 * stranded-row close-out — enqueue the same key, so a retry adds no second message.
 *
 * The push budget (§7: ≤2 in the first 7 days, ≤6 over 30) is a property of this list. Adding a
 * kind here without adding a row to that table is how a shop starts getting spam.
 */
@Injectable()
export class LineSignupNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: PrismaOutboxRepository,
    private readonly config: AppConfigService,
    /** The operator directory and the admin LINE fan-out already live here; L-16: one copy. */
    private readonly adminNotify: SignupAdminNotifyService,
    private readonly opsAlerts: SignupOpsAlertService,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  /**
   * One row per (application, kind). `approved` and `attached` are the same event seen from two
   * sides, so they share a key: a request cannot be both, and if the source ever disagreed with
   * itself the shop would still get one message.
   */
  async enqueue(signupRequestId: string, kind: LineSignupPushKind, now = new Date()): Promise<void> {
    await this.outbox.append({
      eventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
      aggregateType: 'CompanySignupRequest',
      aggregateId: signupRequestId,
      eventKey: lineSignupPushEventKey(signupRequestId, kind),
      priority: 'HIGH',
      payloadJson: {
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        // No name, no LINE id, no phone: the consumer reads the row (P11 F-EM-3, evidence PII-free).
        data: { signupRequestId, kind },
      },
    });
  }

  /**
   * Consumer, driven by the signup outbox drain.
   *
   * Reads the application fresh, so a decision reversed between enqueue and send does not deliver a
   * stale promise. A LINE failure throws, which the drain records as a FAILED outbox row — this is
   * the one message a customer is owed, so it must be visible when it does not arrive.
   */
  async deliver(signupRequestId: string, kind: LineSignupPushKind): Promise<void> {
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { id: signupRequestId },
      select: {
        state: true, source: true, companyName: true, companyId: true,
        lineProviderUserId: true, lineDisplayName: true, attachUserId: true,
      },
    });
    if (!request) throw new Error('signup_request_not_found');
    if (request.source !== SIGNUP_SOURCE_LINE_OA || !request.lineProviderUserId) return;
    // The decision moved on. Nothing to send and nothing to retry: a rejected application that was
    // reopened must not receive its rejection, and vice versa.
    if (kind === 'rejected' ? request.state !== 'REJECTED' : request.state !== 'COMPLETED') return;

    const token = this.config.lineMessagingChannelAccessToken;
    if (!token) {
      // Not a failure to retry — an unconfigured channel will still be unconfigured next time.
      this.logger.warn({ event: 'signup.line.push_skipped_no_token', riskLevel: 'LOW' }, 'signup.line.push_skipped_no_token');
      return;
    }

    const messages = kind === 'rejected'
      ? [{ type: 'text', text: rejectedMessageTh(request.lineDisplayName, request.companyName) }]
      : kind === 'profile_guard'
        ? [buildProfileGuardNudgeCard()]
        : [this.readyMessage(kind, request.companyName)];

    const outcome = await pushLineMessages({
      token,
      lineUserId: request.lineProviderUserId,
      messages,
      // Same key on every redelivery of this row, so a network retry LINE already accepted does not
      // become a second message in the shop's chat.
      retryKey: lineSignupPushRetryKey(signupRequestId, kind),
    });
    if (!outcome.ok) {
      this.logger.error({
        event: 'signup.line.push_failed',
        riskLevel: 'HIGH',
        signupRequestId,
        kind,
        errorCode: outcome.error,
        ...(outcome.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: outcome.retryAfterSeconds }),
      }, 'signup.line.push_failed');
      // §15.6 (b): a rate limit (429) or a dead OA means customers are not hearing that their shop
      // is open, and nothing else in the system says so out loud. Raised BEFORE the throttle throw
      // below, which returns early — a quota outage is exactly the day ops most needs telling.
      await this.opsAlerts.raise('line_push_failed');
      // The OA's monthly message quota answers 429 with a retry-after measured in hours. That is
      // the one failure this row must OUTLIVE: "ร้านของคุณพร้อมใช้แล้ว" is the message the whole
      // flow exists to send, and a quota outage must not turn it into a DEAD outbox row.
      if (outcome.retryAfterSeconds !== undefined) {
        throw new LinePushThrottledError(outcome.error, outcome.retryAfterSeconds);
      }
      throw new Error(outcome.error);
    }
  }

  /**
   * §7/§8. Queued rather than pushed inline, for two reasons: the customer has already been
   * answered and must not wait on the operator rail, and the outbox key is what makes "at most one
   * alert per shop per day" — and per unlinked stranger per day — a database fact.
   */
  async enqueueSupportRequest(lineUserId: string, companyId: string | null, now = new Date()): Promise<void> {
    await this.outbox.append({
      eventType: LINE_SUPPORT_NOTICE_EVENT_TYPE,
      aggregateType: 'LineSupportRequest',
      aggregateId: companyId ?? 'unlinked',
      // A shop is named by its id; a stranger by a short hash of their LINE id, which keeps the raw
      // id out of a table the whole platform can read (the audit rail redacts it for the same reason).
      eventKey: `notify:line_support:${companyId ?? `anon:${shortHash(lineUserId)}`}:${bangkokDayKey(now)}`,
      priority: 'HIGH',
      payloadJson: {
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        // The asker's identity fingerprint, never the id itself: the delivery step needs to know
 //        which admin chat to SKIP, and a hash answers that without putting a LINE id in the outbox.
        data: { ...(companyId ? { companyId } : {}), askerHash: shortHash(lineUserId) },
      },
    });
  }

  /** Consumer for the above. Best-effort per admin; a dead OA is logged, never retried forever. */
  async deliverSupportNotice(companyId: string | null, askerHash?: string): Promise<void> {
    const admins = await this.adminNotify.activeSystemAdmins();
    if (admins.length === 0) return;
    const company = companyId
      ? await this.prisma.client.company.findUnique({ where: { id: companyId }, select: { name: true } })
      : null;
    const base = (this.config.sesWebBaseUrl ?? '').replace(/\/+$/, '');
    // No company yet means the person is somewhere in the signup funnel, so the queue is the page
    // an operator can actually act on.
    const href = companyId ? `${base}/system/partners/${companyId}` : `${base}${SIGNUP_QUEUE_PATH}`;
    const who = company?.name ?? (companyId ?? 'ผู้ที่ยังไม่ได้เปิดร้าน');
    await this.adminNotify.pushToLinkedAdmins(
      admins.map((admin) => admin.userId),
      `📮 ลูกค้าขอคุยกับเจ้าหน้าที่: ${who}\n${href}`,
      // An operator who is also the person asking would otherwise be told, in their own chat, that
      // somebody wants to talk to them.
      ...(askerHash ? [{ skipProviderUserIdHash: askerHash }] : []),
    );
  }

  /**
   * §3.4/§7: "เริ่มใช้งาน" opens the CENTRAL LIFF start URL. No token travels in the message
   * (LINE-ONBOARD-01) — the handoff is minted when the button is tapped.
   */
  private readyMessage(kind: LineSignupPushKind, companyName: string): unknown {
    const text = kind === 'attached' ? attachedMessageTh(companyName) : approvedMessageTh(companyName);
    const liffId = this.config.lineLiffId;
    if (!liffId) return { type: 'text', text };
    return {
      type: 'flex',
      altText: text.slice(0, 400),
      contents: {
        type: 'bubble', size: 'kilo',
        body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
          { type: 'text', text: 'พร้อมใช้งานแล้ว', weight: 'bold', size: 'md', color: '#101828', wrap: true },
          { type: 'text', text, size: 'sm', color: '#475467', wrap: true },
        ] },
        footer: { type: 'box', layout: 'vertical', contents: [
          { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'เริ่มใช้งาน', uri: `https://liff.line.me/${liffId}/start` } },
        ] },
      },
    };
  }

  /**
   * §3.6 "กันหลุด". One card, once, to a shop that has no other way back in — an owner with an
   * email or a phone already has a recovery route and is left alone.
   *
   * `profileGuardNudgedAt` is claimed with a CAS on its own null value BEFORE the row is queued, so
   * two concurrent sweeps queue exactly one; the outbox key is the second, independent guarantee.
   */
  async sweepProfileGuardNudges(now = new Date(), take = 100): Promise<{ queued: number }> {
    const cutoff = new Date(now.getTime() - PROFILE_GUARD_AFTER_DAYS * 86_400_000);
    const unNudged = {
      source: SIGNUP_SOURCE_LINE_OA,
      state: 'COMPLETED' as const,
      profileGuardNudgedAt: null,
      companyId: { not: null },
      // A phone given at signup already answers the question the card asks (§3.2).
      phoneNumber: null,
    };
    const select = { id: true, companyId: true, approvedAt: true, createdAt: true } as const;
    // Two bounded reads rather than one, because the two ways a row becomes due are not the same
    // question. The day-7 branch is expressible in SQL, so it is asked in SQL and ordered
    // oldest-first: without that, a batch of shops that opened this morning could fill `take` every
    // pass and a shop that has been waiting eight days would never be looked at.
    const timeDue = await this.prisma.client.companySignupRequest.findMany({
      where: {
        ...unNudged,
        // `approvedAt` IS the moment this shop opened: for this source, approval and provisioning
        // are the same step (§5). `createdAt` only covers a row that somehow lost its stamp.
        OR: [{ approvedAt: { lte: cutoff } }, { approvedAt: null, createdAt: { lte: cutoff } }],
      },
      orderBy: [{ approvedAt: 'asc' }, { createdAt: 'asc' }],
      select,
      take,
    });
    // The five-reads branch is a count in another table, so it cannot be a WHERE clause. Bounded and
    // ordered the same way; anything it misses becomes unconditionally due above within the week.
    const maybeReadDue = timeDue.length >= take ? [] : await this.prisma.client.companySignupRequest.findMany({
      where: { ...unNudged, approvedAt: { gt: cutoff } },
      orderBy: [{ approvedAt: 'asc' }],
      select,
      take: take - timeDue.length,
    });

    let queued = 0;
    for (const request of [...timeDue, ...maybeReadDue]) {
      const timeQualified = (request.approvedAt ?? request.createdAt) <= cutoff;
      if (!timeQualified && !await this.hasEnoughReads(request.companyId!)) continue;
      if (await this.ownerAlreadyRecoverable(request.companyId!)) {
        // Nothing to ask for. Stamped anyway so the sweep stops reconsidering this row every 15 min.
        await this.prisma.client.companySignupRequest.updateMany({
          where: { id: request.id, profileGuardNudgedAt: null },
          data: { profileGuardNudgedAt: now },
        });
        continue;
      }
      const claimed = await this.prisma.client.companySignupRequest.updateMany({
        where: { id: request.id, profileGuardNudgedAt: null },
        data: { profileGuardNudgedAt: now },
      });
      if (claimed.count !== 1) continue;
      await this.enqueue(request.id, 'profile_guard', now);
      queued += 1;
    }
    return { queued };
  }

  /** The OCR admission counter L-A2 layered the plan ceiling into — one number for the whole system. */
  private async hasEnoughReads(companyId: string): Promise<boolean> {
    const used = await this.prisma.client.companyOcrMonthlyUsage.aggregate({
      where: { companyId },
      _sum: { usedCount: true },
    });
    return (used._sum.usedCount ?? 0) >= PROFILE_GUARD_AFTER_READS;
  }

  /** An owner with a verified email or a phone on file can already get back in without LINE. */
  private async ownerAlreadyRecoverable(companyId: string): Promise<boolean> {
    const owner = await this.prisma.client.companyMembership.findFirst({
      where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: 'OWNER' } } } },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { email: true, phoneNumber: true } } },
    });
    return Boolean(owner?.user.email || owner?.user.phoneNumber);
  }

}

/**
 * A LINE user id is a durable identifier for a person. The outbox is readable platform-wide, so the
 * once-per-day latch is keyed on a truncated digest instead — enough to be unique per person per
 * day, not enough to be an identifier anyone can join on.
 */
/** One definition, shared with the delivery-side exclusion (`shortLineIdHash`). */
const shortHash = shortLineIdHash;

export function lineSignupPushEventKey(signupRequestId: string, kind: LineSignupPushKind): string {
  // `approved` and `attached` share a slot: one provisioning, one "your shop is ready" message.
  const slot = kind === 'attached' ? 'approved' : kind;
  return `push:line_signup:${slot}:${signupRequestId}`;
}

/**
 * LINE requires `X-Line-Retry-Key` to be a UUID, and it has to be the SAME uuid every time this
 * event is redelivered — so it is derived from the event key rather than generated. Same shape as
 * an RFC 4122 v5 name-based uuid: sha256 of the name, with the version and variant bits stamped in.
 */
export function lineSignupPushRetryKey(signupRequestId: string, kind: LineSignupPushKind): string {
  const bytes = createHash('sha256').update(lineSignupPushEventKey(signupRequestId, kind), 'utf8').digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
