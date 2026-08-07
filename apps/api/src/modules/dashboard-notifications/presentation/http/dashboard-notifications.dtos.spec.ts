import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  DailyOwnerSummaryDto, GenerateDashboardSnapshotDto,
  UpdateNotificationPreferenceDto, UpdateNotificationRuleDto,
} from './dashboard-notifications.dtos';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const accepts = (metatype: any, body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype });

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

  it('accepts the {periodKey} the daily-owner-summary job posts', async () => {
    assert.equal((await accepts(DailyOwnerSummaryDto, { periodKey: '2026-07-29' })).periodKey, '2026-07-29');
    assert.equal((await accepts(DailyOwnerSummaryDto, {})).periodKey, undefined, 'absent means today');
    await rejects(DailyOwnerSummaryDto, { periodKey: '29/07/2026' });
    await rejects(DailyOwnerSummaryDto, { periodKey: '2026-07-29', companyId: 'other' });
  });
});
