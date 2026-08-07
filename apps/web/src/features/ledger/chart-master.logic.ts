import type {
  ChartOfAccountSummary,
  ChartTemplateApplyMode,
  ChartTemplatePreviewResult,
} from '@watchdog-bms/contracts';

export function filterChartAccounts(
  accounts: ChartOfAccountSummary[],
  filters: { search: string; accountClass: string; status: string },
): ChartOfAccountSummary[] {
  const search = filters.search.trim().toLocaleLowerCase('th-TH');
  return accounts.filter((account) => {
    if (filters.accountClass && account.accountClass !== filters.accountClass) return false;
    if (filters.status && account.status !== filters.status) return false;
    if (!search) return true;
    return [
      account.code,
      account.nameTh,
      account.nameEn,
      account.reportGroup,
      account.sourceGroup1,
      account.sourceGroup2,
    ].some((value) => value?.toLocaleLowerCase('th-TH').includes(search));
  });
}

export function chartApplyBlocker(input: {
  canManage: boolean;
  preview: ChartTemplatePreviewResult | null;
  mode: ChartTemplateApplyMode;
  confirmed: boolean;
}): string | null {
  if (!input.canManage) return 'คุณมีสิทธิ์ดูผังบัญชี แต่ไม่มีสิทธิ์แก้ไข Master Data';
  if (!input.preview) return 'กรุณาตรวจสอบผลกระทบก่อนนำ Template มาใช้';
  if (input.preview.rows.some((row) => row.differingFields.includes('globalAccount'))) {
    return 'มีบัญชีกลางของระบบใช้รหัสเดียวกับ Template ต้องแก้ความขัดแย้งนี้ก่อน';
  }
  if (input.mode === 'REPLACE_UNUSED' && input.preview.inUseConflicts > 0) {
    return 'ยังแทนที่ไม่ได้ เพราะมีบัญชีขัดแย้งที่ถูกใช้งานแล้ว';
  }
  const conflicts = input.preview.unusedConflicts + input.preview.inUseConflicts;
  if (conflicts > 0 && !input.confirmed) {
    return input.mode === 'MISSING_ONLY'
      ? 'กรุณายืนยันว่าจะเพิ่มเฉพาะบัญชีที่ขาด และคงบัญชีขัดแย้งไว้'
      : 'กรุณายืนยันการแทนที่บัญชีขัดแย้งที่ยังไม่ถูกใช้งาน';
  }
  return null;
}

export function requestIdFromError(error: unknown): string | null {
  const details = (error as { details?: { requestId?: unknown } } | null)?.details;
  return typeof details?.requestId === 'string' ? details.requestId : null;
}
