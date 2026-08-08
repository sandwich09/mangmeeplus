'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { listBankAccounts, getMatchCandidates, confirmMatch, ignoreLine, voidMatch } from './banking.api';
import {
  rankCandidatesForLine, suggestedAllocation, confirmedMatchedTotal,
  LINE_STATUS_LABELS, SOURCE_TYPE_LABELS,
} from './banking.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useToast } from '@/common/components/toast';
import { useInputPrompt } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state';

function err(e: unknown) { return apiErrorMessage(e); }
const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const ghostClass = 'rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

const MAX_CANDIDATES_SHOWN = 8;

function money(v: string | number | undefined) {
  return Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{message}</div>;
}

function LineStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    UNMATCHED: 'bg-gray-100 text-gray-700',
    SUGGESTED: 'bg-blue-100 text-blue-700',
    PARTIALLY_MATCHED: 'bg-yellow-100 text-yellow-800',
    MATCHED: 'bg-green-100 text-green-700',
    IGNORED: 'bg-gray-100 text-gray-500',
    VOIDED: 'bg-red-50 text-red-400',
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[status] ?? 'bg-gray-100 text-gray-600'}`}>{LINE_STATUS_LABELS[status] ?? status}</span>;
}

export function MatchingPanel({ companyId }: { companyId: string }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [bankAccountId, setBankAccountId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [lines, setLines] = useState<any[]>([]);
  const [matchesByLine, setMatchesByLine] = useState<Record<string, any[]>>({});
  const [candidates, setCandidates] = useState<any[]>([]);
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  useEffect(() => {
    setAccountsLoading(true);
    listBankAccounts(companyId)
      .then((r) => {
        const list = r.data ?? r ?? [];
        setAccounts(list);
        if (list.length > 0) setBankAccountId((prev) => prev || list[0].id);
      })
      .catch((e) => setError(err(e)))
      .finally(() => setAccountsLoading(false));
  }, [companyId]);

  const load = useCallback(async () => {
    if (!bankAccountId) return;
    setLoading(true); setError(null);
    try {
      const r = await getMatchCandidates(companyId, bankAccountId);
      setLines(r.lines ?? []);
      setMatchesByLine(r.matchesByLine ?? {});
      setCandidates(r.candidates ?? []);
    } catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId, bankAccountId]);

  useEffect(() => { load(); }, [load]);

  const handleConfirm = async (line: any, candidate: any) => {
    const key = `${line.id}:${candidate.sourceType}:${candidate.sourceId}`;
    const matched = confirmedMatchedTotal(matchesByLine[line.id] ?? []);
    const amount = allocations[key] ?? suggestedAllocation(line.signedAmount, matched, candidate.remainingUnmatchedAmount);
    setBusy(true); setError(null);
    try {
      await confirmMatch(companyId, line.id, {
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        sourceDisplayNumber: candidate.sourceDisplayNumber,
        allocatedAmount: amount,
        currency: line.currency,
      });
      await load();
      toast.success('จับคู่รายการเรียบร้อยแล้ว');
    } catch (e) { setError(err(e)); }
    finally { setBusy(false); }
  };

  const handleIgnore = async (lineId: string) => {
    const reason = await promptInput({
      title: 'ข้ามรายการนี้',
      label: 'เหตุผลที่ข้ามรายการนี้ (เช่น รายการภายใน, ค่าธรรมเนียมรอปรับปรุง)',
    });
    if (!reason) return;
    setBusy(true); setError(null);
    try { await ignoreLine(companyId, lineId, reason); await load(); toast.success('ข้ามรายการเรียบร้อยแล้ว'); }
    catch (e) { setError(err(e)); }
    finally { setBusy(false); }
  };

  const handleUnmatch = async (matchId: string) => {
    setBusy(true); setError(null);
    try { await voidMatch(companyId, matchId); await load(); toast.success('ยกเลิกการจับคู่เรียบร้อยแล้ว'); }
    catch (e) { setError(err(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 max-w-2xl">
        <div>
          <label className="block text-xs text-gray-600 mb-1">บัญชีธนาคาร</label>
          <ThemedSelect className={inputClass} value={bankAccountId} disabled={accountsLoading} onChange={(e) => { setBankAccountId(e.target.value); setOpenLineId(null); }}>
            {accountsLoading ? <option value="">กำลังโหลด...</option> : accounts.map((a: any) => <option key={a.id} value={a.id}>{a.displayName} ({a.bankName})</option>)}
          </ThemedSelect>
        </div>
        <div className="flex items-end">
          <button className={ghostClass} disabled={loading} onClick={load}>รีเฟรช</button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">วันที่</th><th className="px-4 py-3">รายการ</th>
                <th className="px-4 py-3 text-right">จำนวนเงิน</th><th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">การกระทำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ไม่มีรายการค้างจับคู่ 🎉</td></tr>
              ) : lines.map((line: any) => {
                const isOpen = openLineId === line.id;
                const lineMatches = (matchesByLine[line.id] ?? []).filter((m: any) => m.status === 'CONFIRMED');
                const matched = confirmedMatchedTotal(matchesByLine[line.id] ?? []);
                const ranked = rankCandidatesForLine(line, candidates).slice(0, MAX_CANDIDATES_SHOWN);
                return (
                  <Fragment key={line.id}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpenLineId(isOpen ? null : line.id)}>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{line.postedDate ? formatThaiDate(line.postedDate) : '-'}</td>
                      <td className="px-4 py-3">{line.description}</td>
                      <td className={`px-4 py-3 text-right font-medium ${Number(line.signedAmount) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{money(line.signedAmount)}</td>
                      <td className="px-4 py-3"><LineStatusBadge status={line.status} /></td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-blue-600">{isOpen ? '▲ ปิด' : '▼ จับคู่'}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} className="px-4 py-3 bg-gray-50">
                          <div className="space-y-3">
                            {lineMatches.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-gray-600">จับคู่แล้ว {money(matched)} บาท</div>
                                {lineMatches.map((m: any) => (
                                  <div key={m.id} className="flex items-center gap-3 text-sm bg-white rounded border border-gray-200 px-3 py-2">
                                    <span>{SOURCE_TYPE_LABELS[m.sourceType] ?? m.sourceType}</span>
                                    {m.sourceDisplayNumber && <span className="text-gray-500 text-xs">{m.sourceDisplayNumber}</span>}
                                    <span className="font-medium">{money(m.allocatedAmount)}</span>
                                    <button className={ghostClass + ' text-xs py-0.5 px-2 text-red-600 ml-auto'} disabled={busy} onClick={() => handleUnmatch(m.id)}>ยกเลิกการจับคู่</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="text-xs font-medium text-gray-600">รายการที่อาจตรงกัน</div>
                            {ranked.length === 0 ? (
                              <div className="text-sm text-gray-400">ไม่พบรายการชำระเงินที่ทิศทางตรงกัน — บันทึกการชำระในโมดูลต้นทางก่อน หรือข้ามรายการนี้พร้อมเหตุผล</div>
                            ) : ranked.map((c: any) => {
                              const key = `${line.id}:${c.sourceType}:${c.sourceId}`;
                              const prefill = suggestedAllocation(line.signedAmount, matched, c.remainingUnmatchedAmount);
                              return (
                                <div key={key} className="flex flex-wrap items-center gap-3 gap-y-2 text-sm bg-white rounded border border-gray-200 px-3 py-2">
                                  <span className="text-xs rounded bg-blue-50 text-blue-700 px-2 py-0.5">{SOURCE_TYPE_LABELS[c.sourceType] ?? c.sourceType}</span>
                                  {c.sourceDisplayNumber && <span className="font-mono text-xs text-gray-500">{c.sourceDisplayNumber}</span>}
                                  {c.counterpartyName && <span>{c.counterpartyName}</span>}
                                  <span className="text-gray-500 text-xs">{c.paymentDate ? formatThaiDate(c.paymentDate) : '-'}</span>
                                  <span className="font-medium">คงเหลือ {money(c.remainingUnmatchedAmount)}</span>
                                  <div className="ml-auto flex basis-full items-center justify-end gap-2 sm:basis-auto">
                                    <input
                                      className={inputClass + ' w-28 text-right py-1'}
                                      value={allocations[key] ?? prefill}
                                      onChange={(e) => setAllocations((a) => ({ ...a, [key]: e.target.value }))}
                                    />
                                    <button className={btnClass + ' text-xs py-1 px-3'} disabled={busy} onClick={() => handleConfirm(line, c)}>จับคู่</button>
                                  </div>
                                </div>
                              );
                            })}
                            <div>
                              <button className={ghostClass + ' text-xs py-1 px-2'} disabled={busy} onClick={() => handleIgnore(line.id)}>ข้ามรายการนี้ (ระบุเหตุผล)</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {inputPromptDialog}
    </div>
  );
}
