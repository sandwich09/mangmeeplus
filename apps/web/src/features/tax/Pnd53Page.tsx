'use client';

import { useCallback, useEffect, useState } from 'react';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ForbiddenState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import {
  exportPnd53, generatePnd53, listPnd53Issues, listPnd53Periods, markPnd53Filed, resolvePnd53Issue, syncPnd53,
  type TaxPeriod, type TaxExportArtifact, type ReviewIssue,
} from './tax.api';

function download(artifact: TaxExportArtifact) {
  const bytes = Uint8Array.from(atob(artifact.contentBase64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = artifact.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function Pnd53Page({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const canRead = permissions.includes('wht.pnd53.read');
  const canPrepare = permissions.includes('wht.pnd53.prepare');
  const [periods, setPeriods] = useState<TaxPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodId, setPeriodId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [totals, setTotals] = useState<{ totalGross: string; totalWithheld: string } | null>(null);
  const [issues, setIssues] = useState<ReviewIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issueNotes, setIssueNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const result = await listPnd53Periods(companyId);
    setPeriods(result.items);
    setPeriodId((current) => result.items.some((period) => period.id === current)
      ? current : (result.items[0]?.id ?? ''));
  }, [companyId]);
  useEffect(() => {
    if (!canRead) return;
    void refresh().catch((cause) => setError(apiErrorMessage(cause))).finally(() => setLoading(false));
  }, [canRead, refresh]);
  useEffect(() => {
    if (!canRead || !periodId) { setIssues([]); return; }
    let active = true;
    setIssuesLoading(true);
    void listPnd53Issues(companyId, periodId)
      .then((items) => { if (active) setIssues(items); })
      .catch((cause) => { if (active) setError(apiErrorMessage(cause)); })
      .finally(() => { if (active) setIssuesLoading(false); });
    return () => { active = false; };
  }, [canRead, companyId, periodId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (cause) { setError(apiErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  if (!canRead) return <ForbiddenState />;

  return <MangmeePage eyebrow="การเงินและบัญชี" title="ภ.ง.ด.53"
    description="จัดทำและส่งออกแบบหัก ณ ที่จ่ายสำหรับผู้รับเงินนิติบุคคล">
    <MangmeeCard className="space-y-4 p-5">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      <div className="flex flex-wrap gap-2">
        {canPrepare && <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={busy}
          onClick={() => void run(async () => { await syncPnd53(companyId); await refresh(); if (periodId) setIssues(await listPnd53Issues(companyId, periodId)); setMessage('ซิงค์ข้อมูลหัก ณ ที่จ่ายแล้ว'); })}>
          ซิงค์ข้อมูล
        </button>}
      </div>
      {loading && <p role="status" className="text-sm text-gray-500">กำลังโหลดงวด ภ.ง.ด.53...</p>}
      <label className="block text-sm font-medium">
        งวดภาษี
        <select className="mangmee-input mt-1" value={periodId} disabled={busy || loading} onChange={(event) => { setPeriodId(event.target.value); setTotals(null); }}>
          {periods.length === 0 && <option value="">ยังไม่มีงวด ภ.ง.ด.53</option>}
          {periods.map((period) => <option key={period.id} value={period.id}>{period.periodKey} · {period.status}</option>)}
        </select>
      </label>
      {canPrepare && periodId && <div className="flex flex-wrap gap-2">
        <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={busy}
          onClick={() => void run(async () => {
            const report = await generatePnd53(companyId, periodId) as { totalGross: string; totalWithheld: string };
            setTotals(report);
            setMessage('คำนวณ ภ.ง.ด.53 แล้ว');
          })}>คำนวณรายงาน</button>
        <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy || issuesLoading || issues.length > 0} aria-busy={busy || issuesLoading}
          onClick={() => void run(async () => {
            const result = await exportPnd53(companyId, periodId, 'PDF');
            download(result.artifact);
            await refresh();
            setMessage(`ส่งออก ภ.ง.ด.53 เลขที่ ${result.exportNumber} แล้ว`);
          })}>ออกแบบ ภ.ง.ด.53 พร้อมใบแนบ</button>
        {periods.find((period) => period.id === periodId)?.status === 'EXPORTED' && <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} aria-busy={busy}
          onClick={() => { if (!window.confirm('ยืนยันว่าได้นำแบบ ภ.ง.ด.53 ไปยื่นแล้ว?')) return;
            void run(async () => { await markPnd53Filed(companyId, periodId); await refresh(); setMessage('บันทึกสถานะยื่นแบบแล้ว'); }); }}>
          บันทึกว่ายื่นแบบแล้ว
        </button>}
      </div>}
      {issuesLoading && <p role="status" className="text-sm text-gray-500">กำลังตรวจรายการที่ต้องแก้ไข...</p>}
      {issues.length > 0 && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="รายการที่ต้องแก้ไขก่อนออกแบบ">
        <p className="font-semibold">แก้ไขรายการต้นทางและซิงค์อีกครั้งก่อนออกแบบ ({issues.length} รายการ)</p>
        {issues.map((issue) => <div key={issue.id} className="space-y-2 border-t border-amber-200 pt-2 text-sm">
          <p>{issue.description}</p>
          {canPrepare && <div className="flex flex-wrap gap-2">
            <input className="mangmee-input flex-1" aria-label={`เหตุผลปิดข้อทักท้วง ${issue.issueCode}`} placeholder="เหตุผลที่ตรวจและแก้ไขแล้ว"
              value={issueNotes[issue.id] ?? ''} onChange={(event) => setIssueNotes((current) => ({ ...current, [issue.id]: event.target.value }))} />
            <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy || !issueNotes[issue.id]?.trim()} aria-busy={busy}
              onClick={() => void run(async () => { await resolvePnd53Issue(companyId, issue.id, issueNotes[issue.id]!); setIssues(await listPnd53Issues(companyId, periodId)); setMessage('บันทึกการตรวจรายการแล้ว'); })}>
              บันทึกว่าแก้ไขแล้ว
            </button>
          </div>}
        </div>)}
      </section>}
      {totals && <p className="text-sm">ยอดเงินได้ {Number(totals.totalGross).toLocaleString('th-TH')} บาท · ภาษีหัก {Number(totals.totalWithheld).toLocaleString('th-TH')} บาท</p>}
      <p className="text-xs text-gray-500">แบบ PDF อ้างอิงต้นฉบับกรมสรรพากร ตรวจข้อมูลและลงลายมือชื่อก่อนนำไปยื่น</p>
    </MangmeeCard>
  </MangmeePage>;
}
