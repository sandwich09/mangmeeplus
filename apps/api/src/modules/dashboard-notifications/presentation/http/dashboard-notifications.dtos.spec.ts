import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  DailyOwnerSummaryDto, GenerateDashboardSnapshotDto, ExpenseMonthsQueryDto,
  UpdateNotificationPreferenceDto, UpdateNotificationRuleDto,
} from './dashboard-notifications.dtos';
import { IMPLEMENTED_TRIGGER_KEYS, notificationRuleDisplayName } from '../../domain/models/notification.model';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const accepts = (metatype: any, body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype });

it('HOME-RANGE passes validated custom dates through both reads and manual refresh as inclusive Bangkok days', async () => {
  const { DashboardController } = await import('./dashboard.controller');
  const calls: any[] = [];
  const controller = new DashboardController({ execute: async (...args: any[]) => { calls.push(args); return {}; } } as any);
  const ctx = { companyId: 'c1' } as any;
  const query = await pipe.transform({ periodKind: 'custom', branchId: 'b1', customStart: '2026-09-01', customEnd: '2026-09-30' }, { type: 'query', metatype: GenerateDashboardSnapshotDto });
  await controller.getDashboard(ctx, 'c1', query);
  await controller.getLatestSnapshot(ctx, 'c1', query);
  await controller.generateSnapshotManual(ctx, 'c1', query);
  for (const [, companyId, options] of calls) {
    assert.equal(companyId, 'c1'); assert.equal(options.branchId, 'b1'); assert.equal(options.periodKind, 'custom');
    assert.equal(options.periodStart.toISOString(), '2026-08-31T17:00:00.000Z');
    assert.equal(options.periodEnd.toISOString(), '2026-09-30T16:59:59.999Z');
  }
  assert.equal(calls[2][2].forceGenerate, true);
  await assert.rejects(() => controller.getDashboard(ctx, 'other', query), (error: any) => error.getStatus() === 403);
  for (const invalid of [{ customStart: '2026-09-30', customEnd: '2026-09-01' }, { customStart: '2026-02-30', customEnd: '2026-03-01' }, { customStart: '2026-09-01', customEnd: '2099-01-01' }, { customStart: '2026-09-01' }]) {
    await assert.rejects(() => controller.getDashboard(ctx, 'c1', { periodKind: 'custom', ...invalid }), (error: any) => error.getStatus?.() === 400 || error.name === 'InvalidCivilDateError');
  }
  for (const invalid of [{ customStart: ['2026-09-01'] }, { customEnd: 'oops' }]) await rejects(GenerateDashboardSnapshotDto, { periodKind: 'custom', ...invalid });
  assert.equal(calls.length, 3, 'invalid ranges never reach the snapshot builder');
});

async function rejects(metatype: any, body: Record<string, unknown>, label?: string) {
  await assert.rejects(
    () => pipe.transform(body, { type: 'body', metatype }),
    BadRequestException,
    label ?? `expected rejection for ${JSON.stringify(body)}`,
  );
}

describe('UpdateNotificationPreferenceDto', () => {
  // NotificationPreferencesPage.save() posts the whole preference back, userId included.
  const wholePreference = {
    userId: 'usr_1',
    enabledChannels: ['web', 'line'],
    enabledTriggerKeys: ['expense.submitted'],
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: 'Asia/Bangkok',
    digestFrequency: 'daily',
  };

  it('accepts the full preference object the settings page round-trips', async () => {
    const out = await accepts(UpdateNotificationPreferenceDto, wholePreference);
    assert.deepEqual(out.enabledChannels, ['web', 'line']);
    assert.equal(out.userId, 'usr_1', 'accepted for page compatibility; the use case keys on ctx.userId');
  });

  it('rejects unknown channels, digest frequencies, and malformed quiet hours', async () => {
    await rejects(UpdateNotificationPreferenceDto, { ...wholePreference, enabledChannels: ['web', 'sms'] });
    await rejects(UpdateNotificationPreferenceDto, { ...wholePreference, digestFrequency: 'hourly' });
    await rejects(UpdateNotificationPreferenceDto, { ...wholePreference, quietHoursStart: '25:00' });
    await rejects(UpdateNotificationPreferenceDto, { ...wholePreference, quietHoursEnd: '7am' });
  });

  it('rejects tenant fields', async () => {
    await rejects(UpdateNotificationPreferenceDto, { ...wholePreference, companyId: 'other' });
  });
});

describe('UpdateNotificationRuleDto', () => {
  it('accepts the {status} toggle the rules page sends', async () => {
    assert.equal((await accepts(UpdateNotificationRuleDto, { status: 'disabled' })).status, 'disabled');
  });

  it('accepts the policy objects and a cooldown', async () => {
    const out = await accepts(UpdateNotificationRuleDto, {
      conditionJson: { amountAbove: '10000' }, recipientPolicyJson: { roles: ['OWNER'] },
      channelPolicyJson: { channels: ['line'] }, cooldownMinutes: 60, digestPolicy: 'daily',
    });
    assert.equal(out.cooldownMinutes, 60);
  });

  it('rejects unknown statuses, negative cooldowns, and identity fields', async () => {
    await rejects(UpdateNotificationRuleDto, { status: 'paused' });
    await rejects(UpdateNotificationRuleDto, { cooldownMinutes: -1 });
    await rejects(UpdateNotificationRuleDto, { status: 'enabled', triggerKey: 'other.trigger' });
    await rejects(UpdateNotificationRuleDto, { status: 'enabled', companyId: 'other' });
  });
});

describe('shop-facing notification rule names', () => {
  it('uses Thai names for known and future trigger keys without exposing the key', () => {
    assert.equal(notificationRuleDisplayName('stock_low'), 'สินค้าต่ำกว่าจุดสั่งซื้อ');
    // Sent to every active เจ้าของกิจการ and ผู้ดูแลบริษัท (DailyOwnerSummary), named from the one role list.
    assert.equal(notificationRuleDisplayName('daily_owner_summary'), 'สรุปประจำวันสำหรับเจ้าของกิจการและผู้ดูแลบริษัท');
    for (const triggerKey of [...IMPLEMENTED_TRIGGER_KEYS, 'future_internal_key']) {
      const label = notificationRuleDisplayName(triggerKey);
      assert.match(label, /[\u0E00-\u0E7F]/);
      assert.doesNotMatch(label, /[A-Za-z]/);
    }
  });
});

describe('internal worker bodies', () => {
  // apps/workers/src/modules/notifications/notification-worker.ts
  it('accepts the {periodKind} the snapshot job posts and the {} the manual button posts', async () => {
    assert.equal((await accepts(GenerateDashboardSnapshotDto, { periodKind: 'today' })).periodKind, 'today');
    assert.equal((await accepts(GenerateDashboardSnapshotDto, {})).periodKind, undefined);
  });

  it('rejects an unknown period kind before it reaches the snapshot builder', async () => {
    await rejects(GenerateDashboardSnapshotDto, { periodKind: 'yesterday' });
    await rejects(GenerateDashboardSnapshotDto, { periodKind: 'today', forceGenerate: true },
      'forceGenerate is set by the route, not the caller');
  });

  it('accepts an optional branchId and caps its length', async () => {
    assert.equal((await accepts(GenerateDashboardSnapshotDto, { periodKind: 'today', branchId: 'br_1' })).branchId, 'br_1');
    assert.equal((await accepts(GenerateDashboardSnapshotDto, {})).branchId, undefined, 'absent means the caller own scope');
    // Whether the branch is readable is a 403 from the use case; this boundary only bounds it.
    await rejects(GenerateDashboardSnapshotDto, { branchId: 'b'.repeat(65) });
    await rejects(GenerateDashboardSnapshotDto, { branchId: 42 });
  });

  it('accepts the {periodKey} the daily-owner-summary job posts', async () => {
    assert.equal((await accepts(DailyOwnerSummaryDto, { periodKey: '2026-07-29' })).periodKey, '2026-07-29');
    assert.equal((await accepts(DailyOwnerSummaryDto, {})).periodKey, undefined, 'absent means today');
    await rejects(DailyOwnerSummaryDto, { periodKey: '29/07/2026' });
    await rejects(DailyOwnerSummaryDto, { periodKey: '2026-07-29', companyId: 'other' });
  });
});


describe('HOME-1 ExpenseMonthsQueryDto', () => {
  it('transforms Gregorian years and rejects missing, fractional, out-of-range or unknown query values', async () => {
    for (const year of ['2000', '2026', '2100']) {
      const out = await pipe.transform({ year, branchId: 'b1' }, { type: 'query', metatype: ExpenseMonthsQueryDto });
      assert.equal(out.year, Number(year)); assert.equal(out.branchId, 'b1');
    }
    for (const query of [{}, { year: '2569' }, { year: '1999' }, { year: '2101' }, { year: '2026.5' }, { year: '' }, { year: 'oops' }, { year: ['2026'] }, { year: '2026', branchId: ['b1'] }, { year: '2026', companyId: 'other' }]) {
      await assert.rejects(() => pipe.transform(query, { type: 'query', metatype: ExpenseMonthsQueryDto }), BadRequestException);
    }
  });
});

it('HOME-1 routes the validated query through the dashboard guard and tenant check', async () => {
  const { DashboardController } = await import('./dashboard.controller');
  const { REQUIRED_PERMISSIONS_KEY } = await import('../../../../common/security/permissions.decorator');
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, DashboardController.prototype.getExpenseMonths), ['dashboard.read']);
  assert.equal(Reflect.getMetadata('path', DashboardController.prototype.getExpenseMonths), 'expense-months');
  const calls: any[] = [];
  const controller = new DashboardController({ getExpenseMonths: async (...args: any[]) => { calls.push(args); return { year: 2026, months: [], years: [2026] }; } } as any);
  const ctx = { companyId: 'c1' } as any;
  const query = await pipe.transform({ year: '2026', branchId: 'b1' }, { type: 'query', metatype: ExpenseMonthsQueryDto });
  await controller.getExpenseMonths(ctx, 'c1', query);
  assert.deepEqual(calls, [[ctx, 'c1', query]]);
  await assert.rejects(() => controller.getExpenseMonths(ctx, 'other', query), (error: any) => error.getStatus() === 403);
  assert.equal(calls.length, 1);
});
