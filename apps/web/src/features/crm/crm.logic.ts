export const CRM_TABS = ['overview', 'leads', 'pipeline', 'followups'] as const;
export type CrmTab = (typeof CRM_TABS)[number];

/**
 * A CRM tab is visible only when the session can read the endpoint that powers it.
 * ภาพรวม can still be useful with either its report summary or AI priorities.
 */
const CRM_TAB_PERMISSIONS: Record<CrmTab, readonly string[]> = {
  overview: ['crm.report.read', 'crm.ai.read'],
  leads: ['crm.lead.read'],
  pipeline: ['crm.opportunity.read'],
  followups: ['crm.follow_up.read'],
};

export function visibleCrmTabs(permissions: readonly string[]): CrmTab[] {
  return CRM_TABS.filter((tab) => CRM_TAB_PERMISSIONS[tab].some((key) => permissions.includes(key)));
}

/** Unknown or hidden deep links fall back to the first tab this session can use. */
export function parseCrmTab(
  value: string | null | undefined,
  visible: readonly CrmTab[] = CRM_TABS,
): CrmTab {
  return visible.includes(value as CrmTab) ? (value as CrmTab) : (visible[0] ?? 'overview');
}
