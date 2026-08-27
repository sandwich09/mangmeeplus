'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import type { ReportDatasetDefinitionDto, ReportDatasetStatus, ReportExportRequestDto, ReportFieldType, ReportFilterValue, ReportResultDto, ReportRunHistoryItemDto, ReportViewDto } from '@watchdog-bms/contracts';
import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast';
import {
  createReportExport,
  createReportView,
  downloadReportExport,
  listReportCatalog,
  listReportExports,
  listReportRuns,
  listReportViews,
  runReportQuery,
} from './reports.api';
import { isReportsFeatureDisabled, reportExportErrorText, reportExportStatusText, reportFreshnessText, reportRunStatusText, reportWarningText } from './reports-ui.logic';
import { todayCivilDate } from '@watchdog-bms/contracts';

const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:cursor-not-allowed disabled:opacity-50';
const ghostClass = 'mangmee-btn mangmee-btn-secondary disabled:cursor-not-allowed disabled:opacity-50';
const dangerClass = 'mangmee-btn mangmee-btn-danger disabled:cursor-not-allowed disabled:opacity-50';

const STATUS_LABEL: Record<ReportDatasetStatus, string> = {
  ENABLED: 'เปิดใช้งาน',
  FORBIDDEN: 'ไม่มีสิทธิ์',
  UNAVAILABLE: 'ไม่พร้อมใช้งาน',
  DISABLED: 'ปิดใช้งาน',
};

const STATUS_TONE: Record<ReportDatasetStatus, string> = {
  ENABLED: 'text-[#027A48]',
  FORBIDDEN: 'text-red-700',
  UNAVAILABLE: 'text-amber-700',
  DISABLED: 'text-gray-400',
};

const CATEGORY_LABEL: Record<string, string> = {
  FINANCIAL: 'การเงิน', SALES: 'การขาย', INVENTORY: 'สินค้าคงคลัง', EXPENSE: 'ค่าใช้จ่าย', TAX: 'ภาษี',
  BANK: 'ธนาคาร', CRM: 'ลูกค้าสัมพันธ์', PROCUREMENT: 'จัดซื้อ', OPERATIONS: 'การดำเนินงาน', AI: 'ผู้ช่วย AI', CUSTOM: 'กำหนดเอง',
};

function err(e: unknown) {
  return apiErrorMessage(e);
}

function defaultFilters(dataset?: ReportDatasetDefinitionDto): Record<string, ReportFilterValue> {
  const today = todayCivilDate();
  const filters: Record<string, ReportFilterValue> = {};
  for (const filter of dataset?.supportedFilters ?? []) {
    if (filter.key === 'periodKey') filters[filter.key] = today.slice(0, 7);
    else if (filter.key === 'fromDate') filters[filter.key] = `${today.slice(0, 8)}01`;
    else if (filter.key === 'toDate' || filter.key === 'asOfDate') filters[filter.key] = today;
    else if (filter.options?.length) filters[filter.key] = filter.options[0] ?? '';
  }
  return filters;
}

function valueText(value: unknown, type?: ReportFieldType) {
  if (value === null || value === undefined || value === '') return '-';
  if (type === 'date') return formatThaiDate(value as string, '-');
  if (type === 'datetime') return formatThaiDateTime(value as string, '-');
  if (typeof value === 'number') return value.toLocaleString('th-TH');
  return String(value);
}

function downloadTextFile(fileName: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

export function ReportsWorkspacePage({ companyId }: { companyId: string }) {
  const requestedExportId = useSearchParams().get('exportId');
  const toast = useToast();
  const [datasets, setDatasets] = useState<ReportDatasetDefinitionDto[]>([]);
  const [views, setViews] = useState<ReportViewDto[]>([]);
  const [exports, setExports] = useState<ReportExportRequestDto[]>([]);
  const [runs, setRuns] = useState<ReportRunHistoryItemDto[]>([]);
  const [runCursor, setRunCursor] = useState<string>();
  const [selectedCode, setSelectedCode] = useState('');
  const [filters, setFilters] = useState<Record<string, ReportFilterValue>>({});
  const [chartKind, setChartKind] = useState('table');
  const [result, setResult] = useState<ReportResultDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyAction, setBusyAction] = useState<'view' | 'export' | 'runs' | 'download' | null>(null);
  const [historyOnly, setHistoryOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingView = useRef<ReportViewDto | null>(null);
  const focusedExport = useRef('');
  const requestedExport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!requestedExportId || focusedExport.current === requestedExportId || !requestedExport.current) return;
    focusedExport.current = requestedExportId;
    requestedExport.current.scrollIntoView({ block: 'center' });
  }, [requestedExportId, exports]);

  const selected = useMemo(() => datasets.find((dataset) => dataset.code === selectedCode), [datasets, selectedCode]);
  const enabledDatasets = useMemo(() => datasets.filter((dataset) => dataset.status === 'ENABLED'), [datasets]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const dataset of datasets) counts.set(dataset.category, (counts.get(dataset.category) ?? 0) + 1);
    return [...counts.entries()];
  }, [datasets]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [catalog, savedViews, recentExports, recentRuns] = await Promise.allSettled([
      listReportCatalog(companyId),
      listReportViews(companyId),
      listReportExports(companyId),
      listReportRuns(companyId),
    ]);
    try {
      setViews(savedViews.status === 'fulfilled' ? savedViews.value : []);
      setExports(recentExports.status === 'fulfilled' ? recentExports.value : []);
      setRuns(recentRuns.status === 'fulfilled' ? recentRuns.value.items : []);
      setRunCursor(recentRuns.status === 'fulfilled' ? recentRuns.value.nextCursor : undefined);
      if (catalog.status === 'rejected') {
        const disabled = isReportsFeatureDisabled(catalog.reason);
        setDatasets([]);
        setResult(null);
        setHistoryOnly(disabled);
        setError(disabled ? null : err(catalog.reason));
        return;
      }
      setHistoryOnly(false);
      setDatasets(catalog.value.datasets);
      const first = catalog.value.datasets.find((dataset) => dataset.status === 'ENABLED') ?? catalog.value.datasets[0];
      if (first) {
        setSelectedCode((current) => catalog.value.datasets.some((dataset) => dataset.code === current) ? current : first.code);
      }
    } catch (e) {
      setError(err(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const saved = pendingView.current?.datasetCode === selected.code ? pendingView.current : null;
    pendingView.current = null;
    setFilters(saved?.filters ?? defaultFilters(selected));
    setChartKind(saved?.chartConfig.chartKind ?? selected.supportedChartKinds[0] ?? 'table');
    setResult(null);
  }, [selectedCode]);

  async function run() {
    if (!selected) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await runReportQuery(companyId, { datasetCode: selected.code, filters, chartKind: chartKind as any, page: 1, pageSize: 100 }));
    } catch (e) {
      setError(err(e));
    } finally {
      setRunning(false);
    }
  }

  function updateFilter(key: string, value: ReportFilterValue) {
    setFilters((current) => ({ ...current, [key]: value }));
    setResult(null);
  }

  async function saveView() {
    if (!selected) return;
    setError(null);
    setBusyAction('view');
    try {
      const view = await createReportView(companyId, {
        datasetCode: selected.code,
        name: `${selected.title} ${todayCivilDate()}`,
        filters,
        chartConfig: { chartKind: chartKind as any },
      });
      setViews((items) => [view, ...items]);
      toast.success('บันทึกมุมมองเรียบร้อยแล้ว');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function requestExport(format: 'CSV') {
    if (!selected) return;
    setError(null);
    setBusyAction('export');
    try {
      const item = await createReportExport(companyId, { datasetCode: selected.code, filters, format });
      setExports((items) => [item, ...items]);
      if (item.status === 'READY') {
        const download = await downloadReportExport(companyId, item.id);
        downloadTextFile(download.request.fileName ?? 'report.csv', download.request.fileMimeType ?? 'text/csv', download.content);
        toast.success('ส่งออก CSV เรียบร้อยแล้ว');
      } else {
        toast.warning('รับคำขอส่งออก CSV แล้ว ไฟล์จะแสดงในประวัติเมื่อพร้อม');
      }
    } catch (e) {
      setError(err(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function loadMoreRuns() {
    if (!runCursor || busyAction !== null) return;
    setError(null);
    setBusyAction('runs');
    try {
      const page = await listReportRuns(companyId, 8, runCursor);
      setRuns((items) => [...items, ...page.items]);
      setRunCursor(page.nextCursor);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function downloadExport(item: ReportExportRequestDto) {
    if (busyAction !== null) return;
    setError(null);
    setBusyAction('download');
    try {
      const download = await downloadReportExport(companyId, item.id);
      downloadTextFile(download.request.fileName ?? 'report.csv', download.request.fileMimeType ?? 'text/csv', download.content);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusyAction(null);
    }
  }

  function applyView(view: ReportViewDto) {
    pendingView.current = view;
    setSelectedCode(view.datasetCode);
    setFilters(view.filters);
    setChartKind(view.chartConfig.chartKind ?? 'table');
    setResult(null);
  }

  return (
    <MangmeePage
      eyebrow="การเงินและบัญชี"
      title={historyOnly ? 'ประวัติรายงาน' : 'รายงาน'}
      description={historyOnly
        ? 'ไฟล์รายงานที่สร้างไว้ก่อนปิดฟีเจอร์ ดาวน์โหลดได้เท่าที่คุณมีสิทธิ์'
        : 'รายงานสำเร็จรูป มุมมองที่บันทึกไว้ และการส่งออกข้อมูลแบบตรวจสอบสิทธิ์'}
      actions={(
        <div className="flex flex-wrap gap-2">
          <button className={ghostClass} onClick={() => void refresh()} disabled={loading}>รีเฟรช</button>
          <button className={ghostClass} onClick={() => void saveView()} disabled={busyAction !== null || historyOnly || !selected || selected.status !== 'ENABLED'}>{busyAction === 'view' ? 'กำลังบันทึก...' : 'บันทึกมุมมอง'}</button>
          <button className={btnClass} onClick={() => void requestExport('CSV')} disabled={busyAction !== null || historyOnly || !result || !selected}>{busyAction === 'export' ? 'กำลังส่งออก...' : 'ส่งออก CSV'}</button>
        </div>
      )}
    >
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <MangmeeCard className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">รายการรายงาน</div>
            <div className="max-h-[520px] overflow-auto p-2">
              {datasets.map((dataset) => (
                <div
                  key={dataset.code}
                  className={`mb-2 rounded-lg border text-sm ${dataset.code === selectedCode ? 'border-brand-300 bg-brand-25' : 'border-gray-200 bg-white'}`}
                >
                  <button className="min-h-11 w-full px-3 py-2 text-left hover:bg-gray-50" onClick={() => setSelectedCode(dataset.code)}>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-gray-900">{dataset.title}</span>
                      <span className={`text-xs font-semibold ${STATUS_TONE[dataset.status]}`}>{STATUS_LABEL[dataset.status]}</span>
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">{CATEGORY_LABEL[dataset.category] ?? 'รายงาน'}</span>
                  </button>
                  <details className="px-3 pb-2 text-xs text-gray-500">
                    <summary className="flex min-h-11 cursor-pointer items-center">รายละเอียดสำหรับฝ่ายสนับสนุน</summary>
                    <div>{dataset.code} · {dataset.sourceModule}</div>
                  </details>
                </div>
              ))}
              {!loading && datasets.length === 0 && <div className="px-3 py-6 text-center text-sm text-gray-400">ยังไม่มีรายงานให้เลือก</div>}
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-4">
            <h2 className="text-sm font-semibold text-gray-900">มุมมองที่บันทึกไว้</h2>
            <div className="mt-3 space-y-2">
              {views.slice(0, 8).map((view) => (
                historyOnly ? (
                  <div key={view.id} className="min-h-11 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm" aria-disabled="true">
                    <span className="font-medium text-gray-700">{view.name}</span>
                    <span className="mt-1 block text-xs text-gray-500">เก็บไว้แล้ว · ใช้อีกครั้งได้เมื่อเปิดฟีเจอร์รายงาน</span>
                  </div>
                ) : (
                  <button key={view.id} className="block min-h-11 w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => applyView(view)}>
                    <span className="font-medium text-gray-900">{view.name}</span>
                    <span className="mt-1 block text-xs text-gray-500">{view.datasetCode} · {view.visibility}</span>
                  </button>
                )
              ))}
              {views.length === 0 && <p className="text-sm text-gray-400">ยังไม่มีมุมมองที่บันทึกไว้</p>}
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-4">
            <h2 className="text-sm font-semibold text-gray-900">ประวัติการเรียกรายงาน</h2>
            <div className="mt-3 space-y-2 text-sm">
              {runs.map((run) => (
                <div key={run.id} className="rounded-lg border border-gray-100 px-3 py-2">
                  <div className="flex justify-between gap-2"><span>{run.datasetTitle}</span><span>{reportRunStatusText(run.status)}</span></div>
                  <div className="text-xs text-gray-500">{run.rowCount.toLocaleString('th-TH')} แถว · {formatThaiDateTime(run.computedAt ?? run.createdAt, '-')}</div>
                </div>
              ))}
              {runs.length === 0 && <p className="text-sm text-gray-400">ยังไม่มีประวัติรายงานที่คุณดูได้</p>}
              {runCursor && <button className="min-h-11 text-sm font-semibold text-brand-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void loadMoreRuns()} disabled={busyAction !== null}>{busyAction === 'runs' ? 'กำลังโหลด...' : 'ดูประวัติเพิ่ม'}</button>}
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-4">
            <h2 className="text-sm font-semibold text-gray-900">ไฟล์รายงานที่ส่งออก</h2>
            {requestedExportId && !loading && !exports.some((item) => item.id === requestedExportId) && <p role="status" className="mt-2 rounded-lg bg-warning-50 p-3 text-sm text-warning-800">ไม่พบไฟล์จากการแจ้งเตือนนี้ในประวัติที่คุณเปิดได้ ข้อความแจ้งเตือนเป็นข้อมูล ณ วันที่สร้าง ไม่ได้ยืนยันว่าไฟล์ยังดาวน์โหลดได้ · ไฟล์อื่นด้านล่างไม่ใช่ไฟล์เดียวกัน</p>}
            <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1 text-sm">
              {exports.map((item) => (
                <div key={item.id} ref={item.id === requestedExportId ? requestedExport : undefined} className={`rounded-lg border px-3 py-2 ${item.id === requestedExportId ? 'border-brand-400 bg-brand-25' : 'border-gray-100'}`}>
                  {item.id === requestedExportId && <p className="font-semibold text-brand-700">ไฟล์จากการแจ้งเตือน</p>}
                  <div className="flex justify-between gap-2"><span>{item.datasetTitle ?? 'รายงานเดิม'}</span><span>{reportExportStatusText(item.status)}</span></div>
                  <div className="text-xs text-gray-500">
                    {item.format} · {item.rowCount} แถว · {formatThaiDateTime(item.createdAt, '-')}{reportExportErrorText(item, historyOnly) ? ` · ${reportExportErrorText(item, historyOnly)}` : ''}
                  </div>
                  {(item.warnings ?? []).length > 0 && <div className="mt-1 text-xs text-amber-700">ข้อมูลบางส่วน · {item.warnings!.map(reportWarningText).join(' · ')}</div>}
                  {item.status === 'READY' && (
                    <button className="mt-2 min-h-11 text-sm font-semibold text-brand-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void downloadExport(item)} disabled={busyAction !== null}>
                      {busyAction === 'download' ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลดไฟล์เดิม'}
                    </button>
                  )}
                </div>
              ))}
              {exports.length === 0 && <p className="text-sm text-gray-400">ยังไม่มีการส่งออกล่าสุด</p>}
            </div>
          </MangmeeCard>
        </aside>

        <section className="space-y-4">
          {selected && (
            <MangmeeCard className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{selected.title}</h2>
                  <p className="mt-1 text-sm text-gray-500">{selected.description}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">{CATEGORY_LABEL[selected.category] ?? 'รายงาน'}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">สดใหม่ {selected.freshnessSlaSeconds} วิ</span>
                    {selected.unavailableReason && <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{selected.unavailableReason}</span>}
                  </div>
                  <details className="mt-2 text-xs text-gray-500">
                    <summary className="flex min-h-11 cursor-pointer items-center">รายละเอียดสำหรับฝ่ายสนับสนุน</summary>
                    <div>{selected.code} · {selected.sourceModule}</div>
                  </details>
                </div>
                <button className={selected.status === 'ENABLED' ? btnClass : dangerClass} onClick={() => void run()} disabled={running || selected.status !== 'ENABLED'}>
                  {running ? 'กำลังทำงาน...' : selected.status === 'ENABLED' ? 'เรียกรายงาน' : STATUS_LABEL[selected.status]}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                {selected.supportedFilters.map((filter) => (
                  <label key={filter.key} className="flex min-w-44 flex-col gap-1 text-xs font-medium text-gray-600">
                    {filter.label}
                    {filter.options?.length ? (
                      <ThemedSelect className={inputClass} value={String(filters[filter.key] ?? '')} onChange={(e) => updateFilter(filter.key, e.target.value)}>
                        {filter.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </ThemedSelect>
                    ) : filter.type === 'date' ? (
                      <ThemedDate className={inputClass} value={String(filters[filter.key] ?? '')} onChange={(e) => updateFilter(filter.key, e.target.value)} />
                    ) : filter.key === 'periodKey' ? (
                      <ThemedDate mode="month" className={inputClass} value={String(filters[filter.key] ?? '')} onChange={(e) => updateFilter(filter.key, e.target.value)} />
                    ) : (
                      <input
                        className={inputClass}
                        value={String(filters[filter.key] ?? '')}
                        onChange={(e) => updateFilter(filter.key, e.target.value)}
                      />
                    )}
                  </label>
                ))}
                <label className="flex min-w-40 flex-col gap-1 text-xs font-medium text-gray-600">
                  รูปแบบ
                  <ThemedSelect className={inputClass} value={chartKind} onChange={(e) => { setChartKind(e.target.value); setResult(null); }}>
                    {selected.supportedChartKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </ThemedSelect>
                </label>
              </div>
            </MangmeeCard>
          )}

          {result && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MangmeeCard className="px-4 py-3">
                  <div className="text-xs font-medium uppercase text-gray-500">สถานะ</div>
                  <div className="mt-1 text-lg font-bold text-gray-900">{reportRunStatusText(result.status)}</div>
                </MangmeeCard>
                <MangmeeCard className="px-4 py-3">
                  <div className="text-xs font-medium uppercase text-gray-500">จำนวนแถว</div>
                  <div className="mt-1 text-lg font-bold text-gray-900">{result.total.toLocaleString('th-TH')}</div>
                </MangmeeCard>
                <MangmeeCard className="px-4 py-3">
                  <div className="text-xs font-medium uppercase text-gray-500">ความสดของข้อมูล</div>
                  <div className="mt-1 text-lg font-bold text-gray-900">{reportFreshnessText(result.freshness.freshnessStatus)}</div>
                </MangmeeCard>
                <MangmeeCard className="px-4 py-3">
                  <div className="text-xs font-medium uppercase text-gray-500">รหัสการรัน</div>
                  <div className="mt-1 truncate text-sm font-bold text-gray-900">{result.runId}</div>
                </MangmeeCard>
              </div>

              {result.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{result.warnings.map(reportWarningText).join(' · ')}</div>
              )}

              {result.chart && result.chart.kind !== 'table' && (
                <MangmeeCard className="p-4">
                  <h2 className="text-sm font-semibold text-gray-900">กราฟ</h2>
                  <div className="mt-3 grid gap-2">
                    {result.chart.labels.map((label, i) => {
                      const value = Number(result.chart?.series[0]?.values[i] ?? 0);
                      const max = Math.max(...(result.chart?.series[0]?.values.map((v) => Number(v ?? 0)) ?? [1]), 1);
                      return (
                        <div key={`${label}-${i}`} className="grid grid-cols-[160px_minmax(0,1fr)_80px] items-center gap-3 text-sm">
                          <span className="truncate text-gray-600">{label}</span>
                          <span className="h-2 rounded-full bg-brand-100"><span className="block h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} /></span>
                          <span className="text-right font-medium text-gray-900">{valueText(value)}</span>
                        </div>
                      );
                    })}
                  </div>
                </MangmeeCard>
              )}

              <MangmeeCard className="overflow-hidden">
                <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">ตารางผลลัพธ์</div>
                <div className="overflow-auto">
                  <table className="mangmee-table">
                    <thead>
                      <tr>{result.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {result.columns.map((column) => <td key={column.key}>{valueText(row[column.key], column.type)}</td>)}
                        </tr>
                      ))}
                      {result.rows.length === 0 && <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={Math.max(result.columns.length, 1)}>ไม่มีข้อมูลสำหรับรายงานนี้</td></tr>}
                    </tbody>
                  </table>
                </div>
              </MangmeeCard>
            </>
          )}

          {!result && !loading && !historyOnly && (
            <MangmeeCard className="px-4 py-10 text-center text-sm text-gray-400">
              เลือกชุดข้อมูลที่เปิดใช้งานแล้วกดเรียกรายงาน
            </MangmeeCard>
          )}

          {!loading && historyOnly && (
            <MangmeeCard className="px-4 py-10 text-center text-sm text-gray-600">
              ฟีเจอร์รายงานปิดอยู่ จึงสร้างหรือคำนวณรายงานใหม่ไม่ได้ แต่ยังดาวน์โหลดไฟล์เดิมที่คุณมีสิทธิ์ได้
            </MangmeeCard>
          )}

          <MangmeeCard className="p-4">
            <h2 className="text-sm font-semibold text-gray-900">ภาพรวมรายการรายงาน</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {categoryCounts.map(([category, count]) => <span key={category} className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">{category}: {count}</span>)}
              <span className="rounded-full bg-[#ECFDF3] px-2 py-1 text-[#027A48]">เปิดใช้งานแล้ว: {enabledDatasets.length}</span>
            </div>
          </MangmeeCard>
        </section>
      </div>
    </MangmeePage>
  );
}
