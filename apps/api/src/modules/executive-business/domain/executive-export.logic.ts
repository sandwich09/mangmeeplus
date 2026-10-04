import { EXECUTIVE_EXPORT_SHEETS, EXECUTIVE_WORDS as W, executivePeriodLabel, executiveMonthLabel, type ExecutiveRangePeriod } from '@watchdog-bms/contracts';
import { buildWorkbook, columnName, xlsxThaiDate, type WorkbookCell, type WorkbookChart } from '../../../common/export/xlsx.logic';

export type ExportFigure = { label: string; value: number | null; formula?: string; status?: string; style?: number };
export type ExportPanel = { title: string; kind: WorkbookChart['kind']; labels: string[]; values: (number | null)[]; formulas?: string[]; status?: string; statuses?: string[]; colors?: string[]; style?: number };
export type ExportTable = { title: string; headers: string[]; rows: WorkbookCell[][] };
export type ExecutiveWorkbook = { title: string; month: string; period?: ExecutiveRangePeriod; metadata: string[]; columns: string[]; rows: WorkbookCell[][];
  kpis: ExportFigure[]; panels: ExportPanel[]; tables?: ExportTable[] };

export const exportMonth = executiveMonthLabel;
export function exportDateTime(at: Date | string): string {
  return xlsxThaiDate(at, true)!;
}
/** v4 geometry rebuilt from the structure-only reference; no template values or files are imported. */
export function buildExecutiveWorkbook(input: ExecutiveWorkbook): Buffer {
  if (input.rows.length > 10_000 || input.panels.length > 4 || input.kpis.length > 3) throw new Error('XLSX_LIMIT');
  const rows: WorkbookCell[][] = Array.from({ length: 48 }, () => Array.from({ length: 24 }, () => null));
  const merges = ['B2:W3', 'B4:W4', 'B43:W46', 'B48:W48'];
  const put = (r: number, c: number, value: WorkbookCell) => {
    while (rows.length < r) rows.push(Array.from({ length: 24 }, () => null));
    rows[r - 1]![c - 1] = value;
  };
  put(2, 2, { value: input.title, style: 1 }); put(4, 2, input.period ? executivePeriodLabel(input.period.from, input.period.to) : `${W.month} · ${exportMonth(input.month)}`);
  input.kpis.forEach((figure, i) => {
    const c = [2, 10, 18][i]!;
    put(7, c, { value: figure.value, ...(figure.formula ? { formula: figure.formula } : {}), style: figure.style === 3 ? 11 : figure.style ?? 7 });
    put(10, c, figure.label); put(11, c, figure.status ?? (figure.value === null ? W.unavailableFigure : ''));
    merges.push(`${columnName(c)}7:${columnName(c + 6)}9`, `${columnName(c)}10:${columnName(c + 6)}10`, `${columnName(c)}11:${columnName(c + 6)}11`);
  });
  put(43, 2, { value: input.metadata.join(' · '), style: 9 }); put(48, 2, { value: W.export.calculations, style: 2 });
  let next = 50;
  const charts: WorkbookChart[] = [];
  input.panels.forEach((panel, i) => {
    const left = i % 2 === 0, top = i < 2, c = left ? 2 : 13, r = top ? 13 : 29;
    const labels = panel.labels.length ? panel.labels : [''], values = panel.labels.length ? panel.values : [null];
    const status = panel.labels.length ? panel.status : W.noRows;
    put(r, c, { value: panel.title, style: 2 }); merges.push(`${columnName(c)}${r}:${columnName(left ? 11 : 23)}${r}`);
    put(top ? 27 : 41, c, status ?? ''); merges.push(`${columnName(c)}${top ? 27 : 41}:${columnName(left ? 11 : 23)}${top ? 27 : 41}`);
    put(next - 1, 2, panel.title);
    const start = next;
    labels.forEach((label, n) => {
      put(next, 2, label);
      put(next, 7, { value: values[n] ?? null, ...(panel.formulas?.[n] ? { formula: panel.formulas[n] } : {}), style: panel.style ?? 0 });
      put(next, 8, panel.statuses?.[n] ?? status ?? (values[n] === null ? W.unavailableFigure : '')); next++;
    });
    charts.push({ ...panel, labels, values, labelRange: `'${EXECUTIVE_EXPORT_SHEETS[0]}'!$B$${start}:$B$${next - 1}`, valueRange: `'${EXECUTIVE_EXPORT_SHEETS[0]}'!$G$${start}:$G$${next - 1}`,
      from: [c - 1, r], to: [left ? 11 : 23, top ? 26 : 40] });
    next += 2;
  });
  for (const table of input.tables ?? []) {
    put(next++, 2, table.title);
    rows[next++ - 1] = [null, ...table.headers.map(value => ({ value, style: 2 }))];
    for (const row of table.rows) rows[next++ - 1] = [null, ...row];
    next += 2;
  }
  // Source metadata has five rows; the header always starts at row 6, without merged source cells.
  const source: WorkbookCell[][] = [[{ value: input.title, style: 1 }], [input.period ? executivePeriodLabel(input.period.from, input.period.to) : `${W.month} · ${exportMonth(input.month)}`], [input.metadata[0] ?? ''], [input.metadata[1] ?? ''], [input.metadata.slice(2).join(' · ')], input.columns.map(value => ({ value, style: 2 })), ...input.rows];
  return buildWorkbook([
    { name: EXECUTIVE_EXPORT_SHEETS[0], rows, widths: Array.from({ length: 24 }, () => 7.11), freezeRows: 4, merges, printArea: 'A1:X46', charts },
    { name: EXECUTIVE_EXPORT_SHEETS[1], rows: source, widths: input.columns.map((_, i) => i === 0 ? 38 : i === 1 || i === 34 ? 32 : 24), freezeRows: 6, autoHeightRows: [3, 4, 5],
      filter: `A6:${columnName(input.columns.length)}${Math.max(6, source.length)}` },
  ]);
}
