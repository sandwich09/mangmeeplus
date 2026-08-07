import type { ReportDatasetDefinitionDto, ReportPermissionMode, RequestContext } from '@watchdog-bms/contracts';

export function hasAllPermissions(ctx: Pick<RequestContext, 'permissions'>, permissions: string[]): boolean {
  return permissions.every((permission) => ctx.permissions.includes(permission));
}

export function hasSourcePermission(
  ctx: Pick<RequestContext, 'permissions'>,
  permissions: string[],
  mode: ReportPermissionMode,
): boolean {
  if (permissions.length === 0) return true;
  return mode === 'any'
    ? permissions.some((permission) => ctx.permissions.includes(permission))
    : hasAllPermissions(ctx, permissions);
}

export function visibleDatasetStatus(
  ctx: Pick<RequestContext, 'permissions'>,
  definition: Pick<ReportDatasetDefinitionDto, 'requiredReportPermissions' | 'requiredSourcePermissions' | 'sourcePermissionMode'>,
): ReportDatasetDefinitionDto['status'] {
  if (!hasAllPermissions(ctx, definition.requiredReportPermissions.filter((permission) => permission !== 'report.query.run'))) {
    return 'FORBIDDEN';
  }
  return hasSourcePermission(ctx, definition.requiredSourcePermissions, definition.sourcePermissionMode) ? 'ENABLED' : 'FORBIDDEN';
}

export function canRunReport(ctx: Pick<RequestContext, 'permissions'>, definition: ReportDatasetDefinitionDto): boolean {
  return hasAllPermissions(ctx, definition.requiredReportPermissions)
    && hasSourcePermission(ctx, definition.requiredSourcePermissions, definition.sourcePermissionMode);
}
