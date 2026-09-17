import { Inject, Injectable } from '@nestjs/common';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { webLink } from '../../../common/http/web-link';
import { PrismaOutboxRepository } from '../../data-model-core/infrastructure/repositories/prisma-outbox.repository';
import { CreateOrUpdateNotificationEventUseCase } from '../../dashboard-notifications/application/use-cases/notification.use-cases';
import { bangkokMonthKey, resolvePlatformAiBudget } from '../../line-ai/application/company-ai-usage-meter';
import { readAiBudgetReadiness } from '../../line-ai/application/company-ai-budget-readiness';
import { TRIAL_COUNTER_TIER_KEY } from '../../system-partner-management/domain/logic/receipt-quota.logic';
import { bangkokDayKey } from '../domain/business-hours.logic';
import { LINE_SIGNUP_PUSH_EVENT_TYPE } from './line-signup-notify.service';
import { SIGNUP_QUEUE_PATH, SUPPORT_QUEUE_PATH, SignupAdminNotifyService } from './signup-admin-notify.service';

/** Reserved for the signup drain, like its three siblings — the generic drain must exclude it. */
export const SIGNUP_OPS_ALERT_EVENT_TYPE = 'notify.signup_ops_alert.requested';

/** Spec §15.6. Four conditions an operator has to hear about the day they happen, and no more. */
export type SignupOpsAlertKind =
  | 'auto_cap_reached'
  | 'line_push_failed'
  | 'provisioning_failed'
  | 'trial_budget_exhausted'
  | 'line_push_stuck'
  // line-support-request-spec-th §2.2.3: a customer was told "รับเรื่องแล้ว" and NO channel
  // delivered anything — no admin LINE push landed and the support letter did not go out.
  | 'support_unreachable';

/** A customer's one owed message has been unsent for this long — long past "the OA blinked". */
export const STUCK_PUSH_AFTER_MS = 60 * 60_000;
/** Or it has been deferred this many times, which no transient failure does. */
export const STUCK_PUSH_ATTEMPTS = 3;

const ALERT_TRIGGER = 'signup_ops_alert';

/** Owner copy. No plus sign in any user-facing text: write "และ". */
export function signupOpsAlertTitleTh(kind: SignupOpsAlertKind): string {
  switch (kind) {
    case 'auto_cap_reached':
      return 'เพดานอนุมัติอัตโนมัติต่อวันเต็มแล้ว';
    case 'line_push_failed':
      return 'ส่งข้อความ LINE ให้ลูกค้าไม่สำเร็จ';
    case 'provisioning_failed':
      return 'เปิดร้านให้ลูกค้าไม่สำเร็จ';
    case 'trial_budget_exhausted':
      return 'ร้านทดลองใช้งบ AI หมดหลายร้านวันนี้';
    case 'line_push_stuck':
      return 'ข้อความ พร้อมใช้แล้ว ค้างส่งไม่ออก';
    case 'support_unreachable':
      return 'มีลูกค้ารอคุยกับเจ้าหน้าที่ แต่แจ้งทีมงานไม่ได้';
  }
}

export function signupOpsAlertBodyTh(kind: SignupOpsAlertKind): string {
  switch (kind) {
    case 'auto_cap_reached':
      return 'คำขอที่เหลือของวันนี้จะเข้าคิวให้ตรวจเอง เปิดคิวเพื่อดูค่ะ';
    case 'line_push_failed':
      return 'ลูกค้าอาจไม่ได้รับข้อความ พร้อมใช้ หรือ ปฏิเสธ เปิดคิวเพื่อตรวจสอบค่ะ';
    case 'provisioning_failed':
      return 'มีคำขอที่เปิดร้านไม่สำเร็จ เปิดแท็บ มีปัญหา ในคิวเพื่อกดลองใหม่ค่ะ';
    case 'trial_budget_exhausted':
      return 'ร้านทดลองที่ใช้งบ AI ครบแล้วเกินเกณฑ์ที่ตั้งไว้ เปิดคิวเพื่อตรวจสอบค่ะ';
    case 'line_push_stuck':
      return 'มีร้านที่ยังไม่ได้รับข้อความว่าเปิดร้านให้แล้ว อาจถึงโควตาข้อความของ OA เปิดคิวเพื่อตรวจสอบค่ะ';
    case 'support_unreachable':
      return 'คำขออยู่ในหน้า คำขอคุยกับเจ้าหน้าที่ แล้ว แต่ไม่มีช่องทางไหนแจ้งสำเร็จ เปิดหน้าคำขอเพื่อตอบลูกค้าค่ะ';
  }
}

/**
 * P10-L §15.6 — the ops rail for this flow.
 *
 * One alert per condition per Bangkok day, and the outbox `eventKey` is what makes that a database
 * fact rather than an intention: fifty failed pushes in an afternoon append one row. The rail
 * itself is the SYSTEM_ADMIN pattern the pending-review announcement already uses (dashboard event,
 * then one LINE push to the admins who linked one), so operators learn nothing new to read.
 *
 * `raise` NEVER throws. Every caller is on a path that matters more than the alert — a provisioning
 * transaction, a customer's push, a public submit — and an ops warning must not be the reason any
 * of them fails.
 */
@Injectable()
export class SignupOpsAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: PrismaOutboxRepository,
    private readonly notifications: CreateOrUpdateNotificationEventUseCase,
    private readonly adminNotify: SignupAdminNotifyService,
    private readonly config: AppConfigService,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  async raise(kind: SignupOpsAlertKind, now = new Date()): Promise<void> {
    const dayKey = bangkokDayKey(now);
    try {
      await this.outbox.append({
        eventType: SIGNUP_OPS_ALERT_EVENT_TYPE,
        aggregateType: 'SignupOpsAlert',
        aggregateId: `${kind}:${dayKey}`,
        eventKey: signupOpsAlertEventKey(kind, dayKey),
        priority: 'HIGH',
        // Ids and a day only. Nothing about the shop or the person the condition happened to.
        payloadJson: { schemaVersion: 1, occurredAt: now.toISOString(), data: { kind, dayKey } },
      });
    } catch (error) {
      this.logger.warn({
        event: 'signup.ops_alert.enqueue_failed',
        riskLevel: 'LOW',
        kind,
        errorCode: (error as Error).message,
      }, 'signup.ops_alert.enqueue_failed');
    }
  }

  /**
   * Consumer, driven by the signup outbox drain. Idempotency has one source, exactly as the
   * pending-review announcement does: the notification use-case dedupes on its own key (here with
   * the Bangkok day as `periodKey`) and the LINE fan-out only runs when that call actually opened
   * something.
   */
  async deliver(kind: SignupOpsAlertKind, dayKey: string): Promise<void> {
    // Same directory and the same fan-out the pending-review announcement uses (L-B): one message
    // per admin however many LINE identity rows they hold, and a dead OA never reaches the drain.
    const admins = await this.adminNotify.activeSystemAdmins();
    if (admins.length === 0) return;

    const title = signupOpsAlertTitleTh(kind);
    const body = signupOpsAlertBodyTh(kind);
    // The one alert whose action is not in the signup queue: an unreachable support request is
    // answered from the support inbox, and pointing an operator at the wrong page is the same
    // failure as not telling them.
    const href = kind === 'support_unreachable' ? SUPPORT_QUEUE_PATH : SIGNUP_QUEUE_PATH;
    let opened = false;
    for (const [companyId, userIds] of groupByCompany(admins)) {
      const result = await this.notifications.execute({
        companyId,
        triggerKey: ALERT_TRIGGER,
        sourceModule: 'external_signup',
        sourceType: 'signup_ops_alert',
        sourceId: kind,
        // One per day, whatever the cooldown rule says: the day IS the period.
        periodKey: dayKey,
        severity: 'action',
        title,
        body,
        deepLinkHref: href,
        recipientUserIds: userIds,
      });
      if (!result.skipped) opened = true;
    }
    if (!opened) return;

    await this.adminNotify.pushToLinkedAdmins(
      admins.map((admin) => admin.userId),
      `⚠️ ${title}\n${body}\n${webLink(href)}`,
    );
  }

  /**
   * §15.6 (d). "Trial shops that hit their AI budget today" has no event of its own anywhere —
   * refusals are a log line, not a row — so it is COUNTED from the meters that do exist, on the
   * sweep that already runs every 15 minutes. A daily threshold is a daily-granularity question,
   * and reading state answers it without adding a write to the hot budget path.
   *
   * A shop is counted once however many times it was refused: the input is the month's spend
   * aggregate, not the refusals.
   */
  async sweepTrialBudgets(now = new Date()): Promise<{ exhausted: number; raised: boolean }> {
    const threshold = this.config.lineSignupAdminAlertBudgetExhaustedPerDay;
    const trials = await this.prisma.client.companyPlanTerm.findMany({
      where: { tierKey: TRIAL_COUNTER_TIER_KEY, termEndsAt: { gt: now } },
      select: { companyId: true },
      take: 500,
    });
    if (trials.length === 0) return { exhausted: 0, raised: false };

    const companyIds = trials.map((trial) => trial.companyId);
    // From the caller's clock, not a second one: a sweep given `now` must count that month.
    const monthKey = bangkokMonthKey(now);
    const [usage, configurations, platform] = await Promise.all([
      this.prisma.client.companyAiMonthlyUsage.findMany({
        where: { companyId: { in: companyIds }, monthKey },
        select: { companyId: true, costSatang: true },
      }),
      this.prisma.client.companyAiConfiguration.findMany({
        where: { companyId: { in: companyIds } },
        // The split-policy columns too (spec §11.4): a company can be out of money in one bucket
        // with its total still open, and this sweep used to be blind to that.
        select: {
          companyId: true, monthlyBudgetSatang: true, budgetMode: true, chatMonthlyBudgetSatang: true,
          ocrMonthlyBudgetSatang: true, budgetConfigVersion: true, pendingBudgetPolicy: true,
        },
      }),
      // The DB settings row, which is what a company actually inherits — the ENV value is only the
      // fallback when no row exists, and reading it directly made this sweep disagree with the five
      // enforcement seams the moment an operator changed the platform default (§11.4).
      resolvePlatformAiBudget(this.prisma, this.config, true),
    ]);
    const rowByCompany = new Map(configurations.map((row) => [row.companyId, row]));

    let exhausted = 0;
    // The USAGE rows, not the trial list: a company with no usage row this month has spent nothing,
    // so no share of its budget was "hit". Iterating the trials instead would count every trial the
    // moment the platform default sat at 0 satang (`0 >= 0`) — a daily false alarm about shops that
    // have not used AI at all.
    for (const { companyId, costSatang } of usage) {
      const row = rowByCompany.get(companyId);
      const totalSatang = row?.monthlyBudgetSatang ?? platform.monthlyBudgetSatang;
      // ponytail: the TOTAL comparison stays right here, on the two bulk reads. This sweep looks at
      // up to 500 trials every 15 minutes, and routing every one of them through the per-company
      // projection would turn 3 queries into ~2000. Only a company whose stored policy is SPLIT, or
      // whose pending policy might be unreadable, can be out of money with the total still open —
      // those few pay for the projection. Batch the bucket aggregates if trial counts ever grow.
      if (costSatang >= totalSatang) { exhausted += 1; continue; }
      if ((row?.budgetMode ?? 'SHARED') === 'SHARED' && row?.pendingBudgetPolicy == null) continue;
      const money = await readAiBudgetReadiness(this.prisma.client, { companyId, monthKey, row, totalSatang });
      // `EXHAUSTED` is a budget that ran out — the condition §15.6 (d) is about. `CLOSED` is an
      // operator's own cap of 0: a decision, not an incident, and announcing it daily would train
      // them to ignore this alert. `policyInvalid` refuses AI for the WHOLE company, so it counts.
      if (money.policyInvalid
        || money.total === 'EXHAUSTED' || money.chat === 'EXHAUSTED' || money.ocr === 'EXHAUSTED') {
        exhausted += 1;
      }
    }

    if (exhausted < threshold) return { exhausted, raised: false };
    await this.raise('trial_budget_exhausted', now);
    return { exhausted, raised: true };
  }

  /**
   * L-B follow-up (a). A throttled push is DEFERRED, never terminalized — which is right, because
   * it is the one message this flow owes a customer. The cost is that it also never becomes DEAD,
   * and `countDead()` is the only outbox alarm there is: a shop's "พร้อมใช้แล้ว" stuck behind the
   * OA's monthly quota is, today, completely silent.
   *
   * So the rows themselves are the signal: a signup push still unsent an hour later, or deferred
   * three times, is not a blip. Counted on the same 15-minute sweep, announced once a day.
   */
  async sweepStuckPushes(now = new Date()): Promise<{ stuck: number; raised: boolean }> {
    const stuck = await this.prisma.client.outboxEvent.count({
      where: {
        eventType: LINE_SIGNUP_PUSH_EVENT_TYPE,
        status: { in: ['PENDING', 'FAILED'] },
        OR: [
          { createdAt: { lt: new Date(now.getTime() - STUCK_PUSH_AFTER_MS) } },
          { attempts: { gte: STUCK_PUSH_ATTEMPTS } },
        ],
      },
    });
    if (stuck === 0) return { stuck, raised: false };
    await this.raise('line_push_stuck', now);
    return { stuck, raised: true };
  }
}

export function signupOpsAlertEventKey(kind: SignupOpsAlertKind, dayKey: string): string {
  return `notify:signup_ops_alert:${kind}:${dayKey}`;
}

function groupByCompany(rows: Array<{ companyId: string; userId: string }>): Map<string, string[]> {
  const byCompany = new Map<string, string[]>();
  for (const row of rows) {
    const existing = byCompany.get(row.companyId);
    if (existing) existing.push(row.userId);
    else byCompany.set(row.companyId, [row.userId]);
  }
  return byCompany;
}
