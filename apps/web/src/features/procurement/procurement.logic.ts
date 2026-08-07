export const PROCUREMENT_TABS = ['suppliers', 'pr', 'po', 'gr'] as const;
export type ProcurementTab = (typeof PROCUREMENT_TABS)[number];

/**
 * Each panel starts by loading its list endpoint, so its read permission is the
 * minimum usable tab permission. Action-only permissions must not expose a panel
 * whose first request would answer 403.
 */
const PROCUREMENT_TAB_PERMISSIONS: Record<ProcurementTab, readonly string[]> = {
  suppliers: ['procurement.supplier.read'],
  pr: ['procurement.purchase_request.read'],
  po: ['procurement.purchase_order.read'],
  gr: ['procurement.goods_receipt.read'],
};

export function visibleProcurementTabs(permissions: readonly string[]): ProcurementTab[] {
  return PROCUREMENT_TABS.filter((tab) =>
    PROCUREMENT_TAB_PERMISSIONS[tab].some((key) => permissions.includes(key)),
  );
}

/** Unknown or hidden `?tab=` values fall back to the first panel this session can load. */
export function parseProcurementTab(
  value: string | null | undefined,
  visible: readonly ProcurementTab[] = PROCUREMENT_TABS,
): ProcurementTab {
  return visible.includes(value as ProcurementTab) ? (value as ProcurementTab) : (visible[0] ?? 'suppliers');
}
