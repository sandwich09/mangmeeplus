'use client';

import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import { prepareAttachmentUpload, uploadErrorMessage } from '@/common/files/upload-file.logic';

import { useState, useEffect, useCallback } from 'react';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import {
  listBankAccounts, listStatementImports,
  extractStatementFile, previewStatementImport, commitStatementImport, voidStatementImport,
} from './banking.api';
import {
  parseDelimitedStatement, sha256Hex, bytesToBase64, classifyStatementFile,
  extractErrorMessage, IMPORT_STATUS_LABELS, SOURCE_KIND_LABELS, LOW_CONFIDENCE_THRESHOLD,
  statementExtractErrorCode,
  statementRowErrorMessage,
  MAX_STATEMENT_BINARY_BYTES, MAX_STATEMENT_TEXT_BYTES, STATEMENT_UPLOAD_ACCEPT,
} from './banking.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { LoadingState } from '@/common/components/state/LoadingState';
import { useToast } from '@/common/components/toast';
import { useInputPrompt } from '@/common/components/modal';

function err(e: unknown) { return apiErrorMessage(e); }
function statementExtractError(e: unknown) {
  const code = statementExtractErrorCode(e);
  return code ? extractErrorMessage(code) : apiErrorMessage(e);
}
const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const ghostClass = 'rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

function money(v: string | number | undefined) {
  return Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{message}</div>;
}

export function StatementImportPanel({ companyId }: { companyId: string }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<any | null>(null);
  const [extraction, setExtraction] = useState<any | null>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'flag'>('skip');
  const [commitResult, setCommitResult] = useState<any | null>(null);

  const [imports, setImports] = useState<any[]>([]);
  const [importsLoading, setImportsLoading] = useState(true);

  useEffect(() => {
    setAccountsLoading(true);
    setImportsLoading(true);
    void (async () => {
      let hasAccounts = false;
      try {
        const r = await listBankAccounts(companyId);
        const list = r.data ?? r ?? [];
        hasAccounts = list.length > 0;
        setAccounts(list);
        if (list.length > 0) setBankAccountId((prev) => prev || list[0].id);
      } catch (e) { setError(err(e)); }
      finally {
        setAccountsLoading(false);
        if (!hasAccounts) setImportsLoading(false);
      }
    })();
  }, [companyId]);

  const loadImports = useCallback(async () => {
    if (!bankAccountId) return;
    setImportsLoading(true);
    try { const r = await listStatementImports(companyId, bankAccountId); setImports(r.data ?? r ?? []); }
    catch (e) { setError(err(e)); }
    finally { setImportsLoading(false); }
  }, [companyId, bankAccountId]);

  useEffect(() => { loadImports(); }, [loadImports]);

  const resetInput = () => { setRawText(''); setFileName(undefined); setPreview(null); setExtraction(null); setCommitResult(null); };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setPreview(null); setExtraction(null); setCommitResult(null);
    const fileKind = classifyStatementFile(file.name, file.type);
    if (fileKind === 'unsupported') {
      setFileName(undefined);
      setRawText('');
      setError('รองรับเฉพาะ CSV, TSV, TXT, PDF, PNG, JPG/JPEG, HEIC/HEIF และ GIF โดยนามสกุลต้องตรงกับชนิดไฟล์');
      return;
    }
    const maxBytes = fileKind === 'extractable' ? MAX_STATEMENT_BINARY_BYTES : MAX_STATEMENT_TEXT_BYTES;
    if (file.size <= 0 || file.size > maxBytes) {
      setFileName(undefined);
      setRawText('');
      setError(`ไฟล์ต้องมีขนาดไม่เกิน ${maxBytes / (1024 * 1024)} MB`);
      return;
    }
    setFileName(file.name);
    if (fileKind === 'extractable') {
      setRawText(''); setBusy(true);
      try {
        const prepared = await prepareAttachmentUpload(file);
        const fileBase64 = bytesToBase64(new Uint8Array(await prepared.arrayBuffer()));
        const ex = await extractStatementFile(companyId, bankAccountId, { fileBase64, mimeType: prepared.type, fileName: prepared.name });
        setExtraction(ex);
        const result = await previewStatementImport(companyId, bankAccountId, { rows: ex.rows });
        setPreview({ ...result, parsedRows: ex.rows });
      } catch (e) { setError(statementExtractError(e)); }
      finally { setBusy(false); }
      return;
    }
    try {
      setRawText(await file.text());
    } catch (cause) {
      setError(uploadErrorMessage(cause));
    }
  };

  const handlePreview = async () => {
    setError(null); setBusy(true); setCommitResult(null); setExtraction(null);
    try {
      const { rows } = parseDelimitedStatement(rawText);
      if (rows.length === 0) throw new Error('ไม่พบข้อมูลรายการ ตรวจสอบว่ามีแถวหัวตารางและข้อมูลอย่างน้อย 1 แถว');
      const result = await previewStatementImport(companyId, bankAccountId, { rows });
      setPreview({ ...result, parsedRows: rows });
    } catch (e) { setError(err(e)); }
    finally { setBusy(false); }
  };

  const handleCommit = async () => {
    if (!preview) return;
    setError(null); setBusy(true);
    try {
      const result = await commitStatementImport(companyId, bankAccountId, {
        rows: preview.parsedRows,
        originalFileName: fileName,
        fileHash: extraction ? undefined : await sha256Hex(rawText),
        duplicatePolicy,
        provenance: extraction
          ? {
              sourceKind: extraction.sourceKind,
              extractionModelId: extraction.extractionModelId,
              extractionModelLineage: extraction.extractionModelLineage,
            }
          : { sourceKind: 'csv_xlsx' },
      });
      setCommitResult(result);
      setPreview(null); setRawText(''); setFileName(undefined); setExtraction(null);
      await loadImports();
    } catch (e) { setError(err(e)); }
    finally { setBusy(false); }
  };

  const handleVoidImport = async (importId: string) => {
    const reason = await promptInput({ title: 'ยกเลิกการนำเข้า', label: 'เหตุผลยกเลิกการนำเข้า' });
    if (!reason) return;
    setError(null); setBusy(true);
    try { await voidStatementImport(companyId, importId, reason); await loadImports(); toast.success('ยกเลิกการนำเข้าเรียบร้อยแล้ว'); }
    catch (e) { setError(err(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 max-w-2xl">
        <div>
          <label className="block text-xs text-gray-600 mb-1">บัญชีธนาคาร</label>
          <ThemedSelect className={inputClass} value={bankAccountId} disabled={accountsLoading} onChange={(e) => { setBankAccountId(e.target.value); resetInput(); }}>
            {accountsLoading ? <option value="">กำลังโหลด...</option> : accounts.map((a: any) => <option key={a.id} value={a.id}>{a.displayName} ({a.bankName})</option>)}
          </ThemedSelect>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="rounded border border-gray-200 p-4 space-y-3 bg-gray-50">
        <h3 className="text-sm font-medium text-gray-900">นำเข้ารายการเดินบัญชี (CSV / PDF / รูปถ่าย หรือวางจาก Excel)</h3>
        <p className="text-xs text-gray-500">
          แนะนำไฟล์ CSV จากธนาคาร (K BIZ, SCB Business Anywhere ฯลฯ) เพราะตัวเลขตรงจากธนาคาร —
          หรือคัดลอกตารางจาก Excel มาวางในช่องด้านล่าง ถ้ามีแค่ PDF/รูปถ่าย statement ระบบจะอ่านให้แล้วต้องตรวจทานก่อนยืนยัน
        </p>
        <ThemedFile
          accept={STATEMENT_UPLOAD_ACCEPT}
          file={fileName ?? null}
          onChange={(file) => { if (file) void handleFile(file); else setFileName(undefined); }}
        />
        {busy && !preview && <div className="text-sm text-gray-500">กำลังอ่านไฟล์...</div>}
        <textarea
          className={inputClass + ' font-mono h-36'}
          placeholder={'วันที่,รายการ,ถอน,ฝาก,ยอดคงเหลือ\n2026-07-01,โอนเข้า,,1500.00,10500.00'}
          value={rawText}
          onChange={(e) => { setRawText(e.target.value); setFileName(undefined); setPreview(null); setCommitResult(null); }}
        />
        <div className="flex gap-2 items-center">
          <button className={btnClass} disabled={busy || !rawText.trim() || !bankAccountId} aria-busy={Boolean(busy)} onClick={handlePreview}>ตรวจสอบตัวอย่าง</button>
          {fileName && <span className="text-xs text-gray-500">ไฟล์: {fileName}</span>}
        </div>
      </div>

      {preview && (
        <div className="rounded border border-gray-200 p-4 space-y-3">
          {extraction && (
            <div className="rounded bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              {SOURCE_KIND_LABELS[extraction.sourceKind] ?? extraction.sourceKind}
              {extraction.extractionModelId ? ` (โมเดล: ${extraction.extractionModelId})` : ''}
              {' — ถ้ามีไฟล์ CSV จากธนาคาร แนะนำให้ใช้ CSV เพราะตัวเลขตรงจากธนาคาร'}
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-sm">
            <span>ทั้งหมด <b>{preview.totalRows}</b> แถว</span>
            <span className="text-green-700">ถูกต้อง <b>{preview.validRows}</b></span>
            <span className={preview.duplicateRows > 0 ? 'text-yellow-700' : 'text-gray-500'}>ซ้ำกับที่มีอยู่ <b>{preview.duplicateRows}</b></span>
            <span className={preview.errorRows > 0 ? 'text-red-600' : 'text-gray-500'}>ผิดพลาด <b>{preview.errorRows}</b></span>
            {(preview.balanceChainBreaks?.length ?? 0) > 0 && (
              <span className="text-orange-600">ยอดคงเหลือไม่ต่อเนื่อง <b>{preview.balanceChainBreaks.length}</b> จุด</span>
            )}
          </div>
          <div className="overflow-x-auto rounded border border-gray-200 max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide sticky top-0">
                <tr>
                  <th className="px-3 py-2">#</th><th className="px-3 py-2">วันที่</th>
                  <th className="px-3 py-2">รายการ</th><th className="px-3 py-2 text-right">จำนวนเงิน</th>
                  <th className="px-3 py-2 text-right">ยอดคงเหลือ</th><th className="px-3 py-2">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((r: any) => {
                  const confidence = extraction?.sourceKind === 'ocr' ? extraction.rowConfidences?.[r.rowNumber - 1] : undefined;
                  const lowConfidence = typeof confidence === 'number' && confidence < LOW_CONFIDENCE_THRESHOLD;
                  const chainBreak = preview.balanceChainBreaks?.includes(r.rowNumber);
                  return (
                    <tr key={r.rowNumber} className={r.errors?.length ? 'bg-red-50' : r.isDuplicate ? 'bg-yellow-50' : lowConfidence || chainBreak ? 'bg-orange-50' : ''}>
                      <td className="px-3 py-2 text-gray-400">{r.rowNumber}</td>
                      <td className="px-3 py-2">{r.postedDate ? formatThaiDate(r.postedDate) : '-'}</td>
                      <td className="px-3 py-2">{r.description || '-'}</td>
                      <td className={`px-3 py-2 text-right font-medium ${Number(r.signedAmount) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{money(r.signedAmount)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{r.runningBalanceAmount ? money(r.runningBalanceAmount) : '-'}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.errors?.length ? <span className="text-red-600">{r.errors.map(statementRowErrorMessage).join(', ')}</span>
                          : r.isDuplicate ? <span className="text-yellow-700">ซ้ำ</span>
                          : <span className="text-green-700">พร้อมนำเข้า</span>}
                        {chainBreak && <span className="text-orange-600"> · ยอดคงเหลือไม่ต่อเนื่อง</span>}
                        {lowConfidence && <span className="text-orange-600"> · ความมั่นใจต่ำ ({Math.round(confidence * 100)}%)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" checked={duplicatePolicy === 'skip'} onChange={() => setDuplicatePolicy('skip')} />
              ข้ามแถวที่ซ้ำ (แนะนำ)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" checked={duplicatePolicy === 'flag'} onChange={() => setDuplicatePolicy('flag')} />
              นำเข้าแถวซ้ำพร้อมทำเครื่องหมาย
            </label>
            <button className={btnClass + ' bg-green-600 hover:bg-green-700'} disabled={busy || preview.validRows === 0} aria-busy={Boolean(busy)} onClick={handleCommit}>
              ยืนยันนำเข้า {preview.validRows} แถว
            </button>
            <button className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={resetInput}>เริ่มใหม่</button>
          </div>
        </div>
      )}

      {commitResult && (
        <div className="rounded bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          นำเข้าสำเร็จ {commitResult.lines?.length ?? 0} รายการ (การนำเข้า #{commitResult.import?.id?.slice(0, 8)})
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-900">ประวัติการนำเข้า</h3>
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">ไฟล์</th><th className="px-4 py-3">จำนวนแถว</th>
                <th className="px-4 py-3">นำเข้าเมื่อ</th><th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">การกระทำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {importsLoading ? <tr><td colSpan={5}><LoadingState label="กำลังโหลด..." /></td></tr>
                : imports.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ยังไม่มีการนำเข้า</td></tr> : imports.map((im: any) => (
                <tr key={im.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{im.originalFileName ?? <span className="text-gray-400 font-mono text-xs">{im.id.slice(0, 8)}</span>}</td>
                  <td className="px-4 py-3">{im.lineCount}{im.duplicateLineCount > 0 ? <span className="text-yellow-700 text-xs"> (ซ้ำ {im.duplicateLineCount})</span> : null}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{im.committedAt ? formatThaiDateTime(im.committedAt) : '-'}</td>
                  <td className="px-4 py-3 text-xs">{IMPORT_STATUS_LABELS[im.status] ?? im.status}</td>
                  <td className="px-4 py-3">
                    {im.status === 'COMMITTED' && (
                      <button className={ghostClass + ' text-xs py-1 px-2 text-red-600'} disabled={busy} aria-busy={Boolean(busy)} onClick={() => handleVoidImport(im.id)}>ยกเลิกการนำเข้า</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {inputPromptDialog}
    </div>
  );
}
