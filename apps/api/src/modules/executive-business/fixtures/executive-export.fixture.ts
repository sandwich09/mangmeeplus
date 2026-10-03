import { EXECUTIVE_WORDS as W, EXECUTIVE_REPORT_LABELS as L, executiveExportColumns } from '@watchdog-bms/contracts';
import { xlsxThaiDate, type WorkbookCell } from '../../../common/export/xlsx.logic';
import { buildExecutiveWorkbook } from '../domain/executive-export.logic';

export const FICTIONAL_EXECUTIVE_COMPANIES = ['ร้านสมมติใบชา', 'ร้านสมมติสายลม', 'ร้านสมมติแสงดาว'];
/** Entirely invented, rebuilt through the production writer; reproducible and contains no contacts. */
export function fictionalExecutiveWorkbook(): Buffer {
  const rows: WorkbookCell[][] = FICTIONAL_EXECUTIVE_COMPANIES.map((name, i) => [name, null, W.unknown, W.unknown, W.unknown, xlsxThaiDate('2026-09-01T00:00:00Z'),
    L.companyStatus.ACTIVE!, W.unknown, L.planState.NO_PACKAGE!, L.discovery.UNKNOWN!, null, L.signupRail.UNKNOWN!, L.referringSales.NONE!, null, null, null,
    L.paidEver.NO!, L.usageGroup.NOT_PAID!, L.receiptAdoption[i === 0 ? 'EVER' : i === 1 ? 'NEVER' : 'UNKNOWN']!, i === 0 ? 7 : i === 1 ? 0 : null,
    i === 0 ? 2 : 0, i === 0 ? 1 : 0, i === 0 ? 1 : 0, i === 0 ? 2 : 0, 0, { value: 0, style: 3 }, { value: 0, style: 3 }, { value: 0, style: 3 }, { value: 0, style: 3 }, { value: 0, style: 3 }, null, null, null, null,
    i === 2 ? L.receiptAdoption.UNKNOWN! : '']);
  return buildExecutiveWorkbook({ title: W.usage, month: '2026-09', metadata: [W.export.sentBy('ผู้ส่งออกสมมติ', '3 ต.ค. 2569 09:30 น.'), W.excluded, W.receiptDefinition, W.export.bucketsDefinition],
    columns: executiveExportColumns('usage', 'adoption'), rows,
    kpis: [{ label: W.companyCount, value: 3, formula: "COUNTA('รายบริษัท'!A7:A9)" }, { label: W.lifetimeReceipts, value: 7, formula: "SUM('รายบริษัท'!T7:T9)" }, { label: W.active, value: 1, formula: 'COUNTIF(\'รายบริษัท\'!V7:V9,">0")' }],
    panels: [{ title: W.adoptionTitle, kind: 'doughnut', labels: ['EVER', 'NEVER', 'UNKNOWN', 'NOT_ENTITLED'].map(key => L.receiptAdoption[key]!), values: [1, 1, 1, 0], formulas: ['EVER', 'NEVER', 'UNKNOWN', 'NOT_ENTITLED'].map(key => `COUNTIF('รายบริษัท'!S7:S9,"${L.receiptAdoption[key]}")`) },
      { title: W.lifetimeReceipts, kind: 'bar', labels: W.export.buckets, values: [1, 0, 1], formulas: ['COUNTIFS(\'รายบริษัท\'!T7:T9,"=0",\'รายบริษัท\'!T7:T9,"<>")', 'COUNTIFS(\'รายบริษัท\'!T7:T9,">=1",\'รายบริษัท\'!T7:T9,"<=5")', 'COUNTIF(\'รายบริษัท\'!T7:T9,">=6")'], status: W.export.bucketsDefinition },
      { title: W.paidUsage, kind: 'bar', labels: [L.usageGroup.NOT_PAID!], values: [3], formulas: [`COUNTIF('รายบริษัท'!R7:R9,"${L.usageGroup.NOT_PAID}")`] },
      { title: W.receiptCount, kind: 'bar', labels: FICTIONAL_EXECUTIVE_COMPANIES, values: [2, 0, 0] }] });
}
