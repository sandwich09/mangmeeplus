// HTTP-boundary validation for the dashboard and notification bodies (G1).
//
// The internal (worker-token) endpoints are included: they are @Public() but the
// global ValidationPipe still runs, and apps/workers posts a real body to two of
// them. A DTO narrower than what the worker sends would break the cron silently
// — the worker only logs the status code.
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { NotificationChannel } from '@watchdog-bms/contracts';

const NOTIFICATION_CHANNELS = ['web', 'line'] as const;
const DIGEST_FREQUENCIES = ['none', 'daily', 'weekly'] as const;
const RULE_STATUSES = ['enabled', 'disabled'] as const;
const DASHBOARD_PERIOD_KINDS = ['today', 'week', 'month', 'quarter', 'last_month', 'custom'] as const;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateNotificationPreferenceDto {
  // NotificationPreferencesPage saves with `{ ...pref, enabledChannels }`, so the
  // whole preference — userId included — comes back on every toggle. The use case
  // has always ignored it and keys the row on ctx.userId; accepted here so the page
  // keeps working, never read.
  @IsString() @IsOptional() @MaxLength(64) userId?: string;
  @IsArray() @IsIn(NOTIFICATION_CHANNELS, { each: true }) @IsOptional() enabledChannels?: NotificationChannel[];
  @IsArray() @IsString({ each: true }) @IsOptional() enabledTriggerKeys?: string[];
  @Matches(HH_MM) @IsOptional() quietHoursStart?: string;
  @Matches(HH_MM) @IsOptional() quietHoursEnd?: string;
  @IsString() @IsOptional() @MaxLength(64) timezone?: string;
  @IsIn(DIGEST_FREQUENCIES) @IsOptional() digestFrequency?: (typeof DIGEST_FREQUENCIES)[number];
}

export class UpdateNotificationRuleDto {
  @IsObject() @IsOptional() conditionJson?: Record<string, unknown>;
  @IsObject() @IsOptional() recipientPolicyJson?: Record<string, unknown>;
  @IsObject() @IsOptional() channelPolicyJson?: Record<string, unknown>;
  @IsInt() @Min(0) @Max(10_080) @IsOptional() cooldownMinutes?: number;
  @IsIn(DIGEST_FREQUENCIES) @IsOptional() digestPolicy?: (typeof DIGEST_FREQUENCIES)[number];
  @IsIn(RULE_STATUSES) @IsOptional() status?: (typeof RULE_STATUSES)[number];
}

/** POST .../dashboard/snapshots/generate — both the user route and the worker one. */
export class GenerateDashboardSnapshotDto {
  @IsIn(DASHBOARD_PERIOD_KINDS) @IsOptional() periodKind?: (typeof DASHBOARD_PERIOD_KINDS)[number];
  // Absent = the caller's own scope (company-wide when unrestricted). Out-of-scope values are
  // rejected with 403 by the use case, not here; this is length/type validation only.
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
}

/** POST /internal/companies/:companyId/notifications/daily-owner-summary */
export class DailyOwnerSummaryDto {
  // Defaults to today when absent; apps/workers always sends it.
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsNotEmpty() @IsOptional() periodKey?: string;
}


/** GET .../dashboard/expense-months — query years are Gregorian, not Buddhist. */
export class ExpenseMonthsQueryDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
}
