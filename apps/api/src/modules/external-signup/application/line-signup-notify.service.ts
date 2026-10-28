import { LineMessagingCredentialsService } from '../../../common/config/line-messaging-credentials.service';
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import { countReceiptOcrAdmissions } from '../../line-ai/application/company-ocr-governance';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { pushLineMessages } from '../../auth/infrastructure/system-line-push';
import { buildProfileGuardNudgeCard } from '../../line-ai/domain/logic/line-business-card.logic';
import { AUTH_MAILER_TOKEN, type AuthMailerPort } from '../../auth/domain/ports/auth-mailer.port';
import { SIGNUP_SOURCE_LINE_OA } from '../domain/company-signup.logic';
import type { Prisma } from '../../../generated/prisma/client';
import {
  SUPPORT_MAILBOX_EMAIL, SUPPORT_QUEUE_PATH, SignupAdminNotifyService,
} from './signup-admin-notify.service';
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
export type LineSignupPushKind = 'approved' | 'attached' | 'rejected' | 'profile_guard' | 'requested_info';

/** §3.6: seven days of real use, or five successful reads — whichever comes first. */
export const PROFILE_GUARD_AFTER_DAYS = 7;
export const PROFILE_GUARD_AFTER_READS = 5;

/** §3 PDPA: a settled request is deleted 90 days after it settled, message text and all. */
export const SUPPORT_REQUEST_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Opening confirmation only; the current access policy decides what this shop can use. */
export function approvedMessageTh(companyName: string, withButton = true): string {
  return `เปิดร้าน ${companyName} ให้แล้วค่ะ ` + (withButton
    ? 'เปิดหน้าร้านได้จากปุ่มด้านล่างค่ะ'
    : 'เข้าหน้าร้านได้ในเว็บแอปมั่งมีพลัสค่ะ');
}

export function attachedMessageTh(companyName: string, withButton = true): string {
  return `เพิ่มร้าน ${companyName} ให้บัญชีของคุณแล้วค่ะ `
    + (withButton ? 'เปิดหน้าร้านได้จากปุ่มด้านล่างค่ะ' : 'เข้าหน้าร้านได้ในเว็บแอปมั่งมีพลัสค่ะ')
    + ' สลับร้านได้ในเมนู บริษัทของฉัน';
}

export function rejectedMessageTh(displayName: string | null, companyName: string): string {
  const greeting = displayName?.trim() ? `เรียน คุณ${displayName.trim()} ` : '';
  return `${greeting}ขอบคุณที่สนใจมั่งมีพลัสค่ะ ตอนนี้เรายังไม่สามารถเปิดร้าน ${companyName} ให้ได้ ต้องขออภัยด้วยนะคะ `
    + 'หากต้องการสอบถามหรือส่งข้อมูลเพิ่มเติม ติดต่อทีมงานได้ที่ โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com '
    + '(จันทร์–เสาร์ 9:00–18:00) ทีมงานยินดีพิจารณาให้อีกครั้งค่ะ';
}

export function requestedInfoMessageTh(companyName: string, requestedInformation: string): string {
  return `ทีมงานขอข้อมูลเพิ่มสำหรับร้าน ${companyName}: ${requestedInformation}`;
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
  constructor(private readonly lineCredentials: LineMessagingCredentialsService,
    private readonly prisma: PrismaService,
    private readonly outbox: PrismaOutboxRepository,
    private readonly config: AppConfigService,
    /** The operator directory and the admin LINE fan-out already live here; L-16: one copy. */
    private readonly adminNotify: SignupAdminNotifyService,
    private readonly opsAlerts: SignupOpsAlertService,
    /** §2.2 delta: the support mailbox is the rail that actually reaches an operator today. */
    @Inject(AUTH_MAILER_TOKEN) private readonly mailer: AuthMailerPort,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  /**
   * One row per (application, kind). `approved` and `attached` are the same event seen from two
   * sides, so they share a key: a request cannot be both, and if the source ever disagreed with
   * itself the shop would still get one message.
   */
  async enqueue(
    signupRequestId: string,
    kind: LineSignupPushKind,
    now = new Date(),
    options: { reviewVersion?: number; tx?: Prisma.TransactionClient } = {},
  ): Promise<void> {
    await this.outbox.append({
      eventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
      aggregateType: 'CompanySignupRequest',
      aggregateId: signupRequestId,
      eventKey: lineSignupPushEventKey(signupRequestId, kind, options.reviewVersion),
      priority: 'HIGH',
      payloadJson: {
        schemaVersion: 1,
        occurredAt: now.toISOString(),
        // No name, no LINE id, no phone: the consumer reads the row (P11 F-EM-3, evidence PII-free).
        data: {
          signupRequestId,
          kind,
          ...(options.reviewVersion === undefined ? {} : { reviewVersion: options.reviewVersion }),
        },
      },
    }, options.tx);
  }

  /**
   * Consumer, driven by the signup outbox drain.
   *
   * Reads the application fresh, so a decision reversed between enqueue and send does not deliver a
   * stale promise. A LINE failure throws, which the drain records as a FAILED outbox row — this is
   * the one message a customer is owed, so it must be visible when it does not arrive.
   */
  async deliver(signupRequestId: string, kind: LineSignupPushKind, reviewVersion?: number): Promise<void> {
    const request = await this.prisma.client.companySignupRequest.findUnique({
      where: { id: signupRequestId },
      select: {
        state: true, source: true, companyName: true, companyId: true,
        lineProviderUserId: true, lineDisplayName: true, attachUserId: true,
        reviewResolution: true, resolutionNote: true, version: true,
      },
    });
    if (!request) throw new Error('signup_request_not_found');
    if (request.source !== SIGNUP_SOURCE_LINE_OA || !request.lineProviderUserId) return;
    // The decision moved on. Nothing to send and nothing to retry: a rejected application that was
    // reopened must not receive its rejection, and vice versa.
    if (kind === 'requested_info') {
      if (!['RECEIVED', 'VALIDATED', 'PENDING_REVIEW'].includes(request.state)
        || request.reviewResolution !== 'REQUEST_INFO'
        || request.version !== reviewVersion || !request.resolutionNote) return;
    } else if (kind === 'rejected' ? request.state !== 'REJECTED' : request.state !== 'COMPLETED') return;

    const token = (await this.lineCredentials.get()).accessToken;
    if (!token) {
      // Not a failure to retry — an unconfigured channel will still be unconfigured next time.
      this.logger.warn({ event: 'signup.line.push_skipped_no_token', riskLevel: 'LOW' }, 'signup.line.push_skipped_no_token');
      return;
    }

    const messages = kind === 'requested_info'
      ? [{ type: 'text', text: requestedInfoMessageTh(request.companyName, request.resolutionNote!) }]
      : kind === 'rejected'
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
      retryKey: lineSignupPushRetryKey(signupRequestId, kind, reviewVersion),
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
   * §7/§8, re-keyed by line-support-request-spec-th §2.2.4. Queued rather than pushed inline
   * because the customer has already been answered and must not wait on the operator rail.
   *
   * The key is the REQUEST, not the day. The old `…:<companyId|anon>:<day>` key meant a customer
   * whose morning request had been answered and closed could not reach anyone again until tomorrow;
   * "one request, one notice" is both stricter where it matters (a repeat tap while OPEN is
   * answered "ยังอยู่ในคิวค่ะ" and enqueues nothing) and correct where the old key was not.
   */
  async enqueueSupportRequest(supportRequestId: string, now = new Date()): Promise<void> {
    await this.outbox.append({
      eventType: LINE_SUPPORT_NOTICE_EVENT_TYPE,
      aggregateType: 'LineSupportRequest',
      aggregateId: supportRequestId,
      eventKey: lineSupportNoticeEventKey(supportRequestId),
      priority: 'HIGH',
      payloadJson: {
        schemaVersion: 2,
        occurredAt: now.toISOString(),
        // An id and nothing else: the consumer reads the row, so no LINE id, name or message text
        // ever enters the outbox (P11 F-EM-3, evidence PII-free).
        data: { supportRequestId },
      },
    });
  }

  /**
   * Consumer for the above.
   *
   * Owner 2026-09-05: the /system inbox is the PRIMARY channel and the row is already in it before
   * this runs — so this method's job is the optional extras and, above all, an honest count. It
   * fans out to two rails: the support mailbox (operators are not LINE-linked, so this is the one
   * that usually matters) and a LINE push to any admin who did link. Neither may throw: the
   * request is safe in the database either way.
   *
   * "Unreachable" means BOTH rails delivered nothing. Then, and only then, a warn plus a
   * once-a-day ops alert — the inbox row itself does not count as having told anybody.
   */
  async deliverSupportNotice(supportRequestId: string): Promise<void> {
    const request = await this.prisma.client.lineSupportRequest.findUnique({
      where: { id: supportRequestId },
      select: {
        companyId: true, lineUserIdHash: true, lastMessageText: true, signupRequestId: true,
      },
    });
    if (!request) return;

    const [company, signup] = await Promise.all([
      request.companyId
        ? this.prisma.client.company.findUnique({ where: { id: request.companyId }, select: { name: true } })
        : Promise.resolve(null),
      request.signupRequestId
        ? this.prisma.client.companySignupRequest.findUnique({
          where: { id: request.signupRequestId }, select: { companyName: true, state: true },
        })
        : Promise.resolve(null),
    ]);
    const who = supportAskerLabelTh(company?.name ?? null, signup?.companyName ?? null, signup?.state === 'COMPLETED');
    const base = (this.config.sesWebBaseUrl ?? '').replace(/\/+$/, '');
    // The inbox is where an operator acts, so every channel points at it — not at the partner page
    // and not at the signup queue, both of which lose the request's own state.
    const href = `${base}${SUPPORT_QUEUE_PATH}`;

    const emailSent = await this.sendSupportMailbox(supportRequestId, {
      who,
      actionUrl: href,
      ...(request.lastMessageText ? { lastMessageText: request.lastMessageText } : {}),
    });

    const admins = await this.adminNotify.activeSystemAdmins();
    const lineNotifiedCount = admins.length === 0 ? 0 : await this.adminNotify.pushToLinkedAdmins(
      admins.map((admin) => admin.userId),
      [
        `📮 ลูกค้าขอคุยกับเจ้าหน้าที่: ${who}`,
        ...(request.lastMessageText ? [`“${request.lastMessageText}”`] : []),
        href,
      ].join('\n'),
      // An operator who is also the person asking would otherwise be told, in their own chat, that
      // somebody wants to talk to them.
      { skipProviderUserIdHash: request.lineUserIdHash },
    );

    // `notifiedAt` is what separates "nobody could be told" from "the drain has not run yet" — the
    // inbox renders a red chip on the first and a quiet "กำลังแจ้ง…" on the second.
    await this.prisma.client.lineSupportRequest.update({
      where: { id: supportRequestId },
      data: { lineNotifiedCount, emailSent, notifiedAt: new Date() },
    });

    if (lineNotifiedCount > 0 || emailSent) {
      this.logger.info({
        event: 'signup.support.notified',
        supportRequestId,
        lineNotifiedCount,
        emailSent,
      }, 'signup.support.notified');
      return;
    }
    this.logger.warn({
      event: 'signup.support.unreachable',
      riskLevel: 'HIGH',
      supportRequestId,
      adminCount: admins.length,
    }, 'signup.support.unreachable');
    await this.opsAlerts.raise('support_unreachable');
  }

  /** Best effort by contract: a missing provider, a bad address or an SES outage is a `false`. */
  private async sendSupportMailbox(
    supportRequestId: string,
    input: { who: string; actionUrl: string; lastMessageText?: string },
  ): Promise<boolean> {
    try {
      return await this.mailer.sendSupportRequestNotice({ toEmail: SUPPORT_MAILBOX_EMAIL, ...input });
    } catch (error) {
      this.logger.warn({
        event: 'signup.support.email_failed',
        riskLevel: 'LOW',
        supportRequestId,
        errorCode: (error as Error).message,
      }, 'signup.support.email_failed');
      return false;
    }
  }

  /** Assistant-pause expiry is not evidence that a person's support issue was resolved. */
  async sweepExpiredSupportRequests(_now = new Date(), _take = 200): Promise<{ expired: number }> {
    return { expired: 0 };
  }

  /**
   * §3 PDPA. A settled request keeps two pieces of personal data — the raw `lineUserId` and up to
   * 200 characters the customer typed — and neither has a purpose 90 days after the conversation
   * ended. The whole row goes: there is nothing left in it worth keeping without them, and a
   * scrubbed shell would only be a slower way to reach the same state.
   *
   * Counts from `closedAt`, not `requestedAt`: only an explicitly closed case is settled. OPEN and
   * ANSWERED rows are never touched, however old — either can still be somebody waiting.
   */
  async purgeSettledSupportRequests(now = new Date(), take = 500): Promise<{ purged: number }> {
    const cutoff = new Date(now.getTime() - SUPPORT_REQUEST_RETENTION_MS);
    const due = await this.prisma.client.lineSupportRequest.findMany({
      where: { status: 'CLOSED', closedAt: { lte: cutoff } },
      orderBy: { requestedAt: 'asc' },
      select: { id: true },
      take,
    });
    if (due.length === 0) return { purged: 0 };
    const deleted = await this.prisma.client.lineSupportRequest.deleteMany({
      where: { id: { in: due.map((row) => row.id) } },
    });
    return { purged: deleted.count };
  }

  /**
   * §3.4/§7, R-C4 (§18.2): the button opens the CENTRAL LIFF start URL. No token travels in the
   * message (LINE-ONBOARD-01; a 15-minute token would be dead before a push retried for hours) —
   * the handoff is minted when the button is tapped, and the start page lands a plan manager on the
   * package page (R-C3). Two taps from the push, by design (DQ3).
   */
  private readyMessage(kind: LineSignupPushKind, companyName: string): unknown {
    const liffId = this.config.lineLiffId;
    const text = kind === 'attached' ? attachedMessageTh(companyName, !!liffId) : approvedMessageTh(companyName, !!liffId);
    if (!liffId) return { type: 'text', text };
    return {
      type: 'flex',
      altText: text.slice(0, 400),
      contents: {
        type: 'bubble', size: 'kilo',
        body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
          { type: 'text', text: kind === 'attached' ? 'เพิ่มร้านแล้ว' : 'เปิดร้านแล้ว', weight: 'bold', size: 'md', color: '#101828', wrap: true },
          { type: 'text', text, size: 'sm', color: '#475467', wrap: true },
        ] },
        footer: { type: 'box', layout: 'vertical', contents: [
          { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'เปิดหน้าร้าน', uri: `https://liff.line.me/${liffId}/start` } },
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

  /** The retained receipt/image reads, excluding bank-statement accounting imports. */
  private async hasEnoughReads(companyId: string): Promise<boolean> {
    return await countReceiptOcrAdmissions(this.prisma.client, companyId) >= PROFILE_GUARD_AFTER_READS;
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

export function lineSupportNoticeEventKey(supportRequestId: string): string {
  return `notify:line_support:req:${supportRequestId}`;
}

/**
 * §2.2.1. What the operator is told they are looking at. A shop has a name; someone still in the
 * funnel is named by the shop they APPLIED for, which is the only name that exists for them — and
 * is what the UAT evidence needed, where the notice confidently named a shop the asker had left.
 *
 * Never a LINE id or a LINE display name: §3 keeps raw identifiers out of operator surfaces.
 *
 * `appliedShopOpened`: that application COMPLETED, so a shop exists and it is its name — never
 * "ผู้ที่ยังไม่ได้เปิดร้าน" (review 2026-09-29; LIFF asks filed before the row carried the company).
 */
export function supportAskerLabelTh(companyName: string | null, appliedCompanyName: string | null, appliedShopOpened = false): string {
  if (companyName) return companyName;
  if (appliedCompanyName) return appliedShopOpened ? appliedCompanyName : `ผู้ที่ยังไม่ได้เปิดร้าน (มีคำขอสมัคร: ${appliedCompanyName})`;
  return 'ผู้ที่ยังไม่ได้เปิดร้าน';
}

export function lineSignupPushEventKey(
  signupRequestId: string,
  kind: LineSignupPushKind,
  reviewVersion?: number,
): string {
  // `approved` and `attached` share a slot: one provisioning, one "your shop is ready" message.
  const slot = kind === 'attached' ? 'approved' : kind;
  return `push:line_signup:${slot}:${signupRequestId}${kind === 'requested_info' ? `:v${reviewVersion ?? 'missing'}` : ''}`;
}

/**
 * LINE requires `X-Line-Retry-Key` to be a UUID, and it has to be the SAME uuid every time this
 * event is redelivered — so it is derived from the event key rather than generated. Same shape as
 * an RFC 4122 v5 name-based uuid: sha256 of the name, with the version and variant bits stamped in.
 */
export function lineSignupPushRetryKey(
  signupRequestId: string,
  kind: LineSignupPushKind,
  reviewVersion?: number,
): string {
  const bytes = createHash('sha256').update(lineSignupPushEventKey(signupRequestId, kind, reviewVersion), 'utf8').digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
