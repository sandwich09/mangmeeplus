'use client';

import { SIGNATURE_FILE_TYPES_LABEL } from '@watchdog-bms/contracts';

import { useEffect, useRef, useState } from 'react';
import type { SubstituteReceiptEvidenceSummary, SubstituteReceiptPaperPreview, SubstituteReceiptPaperSigner } from '@watchdog-bms/contracts';
import { MangmeeCard } from '@/common/components/mangmee';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { DocumentPreviewModal } from '@/common/components/document-preview';
import { acceptSubstitutePaper, downloadSubstituteReceiptFormPdf, listSubstituteReceiptHistory, previewSubstitutePaper, submitSubstitutePaperFile } from './expenses.api';
import { btnClass, ghostClass, inputClass, ErrorBanner, err, WholeWords } from './ExpensesUi';

const blankSigner = (): SubstituteReceiptPaperSigner => ({ name: '', position: '', signedOn: '' });
export function SubstitutePaperSigningPanel({ companyId, evidence, canPrepare, canAccept, allowSamePerson, onChange }: {
  companyId: string; evidence: SubstituteReceiptEvidenceSummary; canPrepare: boolean; canAccept: boolean; allowSamePerson: boolean;
  onChange: (evidence: SubstituteReceiptEvidenceSummary) => void;
}) {
  const [payer, setPayer] = useState(blankSigner);
  const [approver, setApprover] = useState(blankSigner);
  const [samePerson, setSamePerson] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [matches, setMatches] = useState(false);
  const [checks, setChecks] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<SubstituteReceiptPaperPreview | null>(null);
  const [viewedHash, setViewedHash] = useState<string | null>(null);
  const revision = `${evidence.id}:${evidence.updatedAt}`;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  useEffect(() => { setViewedHash(null); setPreview(null); setChecks([false, false, false]); setFile(null); setMatches(false); }, [revision]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(err(error)); } finally { setBusy(false); }
  };
  const signerFields = (role: string, value: SubstituteReceiptPaperSigner, change: (value: SubstituteReceiptPaperSigner) => void) => (
    <fieldset className="space-y-3 rounded-xl border border-gray-200 p-4"><legend className="px-2 font-bold">{role}ตามฉบับกระดาษ</legend>
      <label className="block text-sm">ชื่อ–นามสกุล *<input className={inputClass} aria-label={`ชื่อ${role}`} value={value.name} maxLength={200} required onChange={(event) => change({ ...value, name: event.target.value })} /></label>
      <label className="block text-sm">ตำแหน่ง (ถ้ามี)<input className={inputClass} aria-label={`ตำแหน่ง${role}`} value={value.position} maxLength={120} onChange={(event) => change({ ...value, position: event.target.value })} /></label>
      <label className="block text-sm">วันที่ลงนาม *<ThemedDate className={inputClass} aria-label={`วันที่${role}ลงนาม`} value={value.signedOn} required onChange={(event) => change({ ...value, signedOn: event.target.value })} /></label>
    </fieldset>
  );
  const submission = evidence.paperSubmission;
  const ready = file && matches && [payer, approver].every((person) => person.name.trim() && person.signedOn);
  return <MangmeeCard className="space-y-5 p-5">
    <div><h2 className="text-xl font-bold">ลงนามบนกระดาษ</h2><p className="mt-2 text-sm text-gray-600">{evidence.documentNumber} · {submission ? 'รอตรวจรับฉบับลงนาม' : 'รออัปโหลดฉบับลงนาม'}</p></div>
    {error && <div role="alert"><ErrorBanner message={error} /></div>}
    {!submission ? <>
      <p className="text-sm leading-6">แบบฟอร์มเว้นชื่อ ตำแหน่ง ลายเซ็น และวันที่ของผู้รับรองการจ่ายและผู้อนุมัติ ให้กรอกและเซ็นจริงได้ทั้งผู้มีบัญชีและไม่มีบัญชีในระบบ ตำแหน่งเว้นว่างได้หากไม่มี</p>
      <p className="text-sm text-gray-600">ผู้รับรองต้องทราบข้อเท็จจริงของการจ่าย หากพนักงานสำรองเงินส่วนตัว ให้พนักงานผู้จ่ายเป็นผู้รับรอง ผู้อนุมัติต้องมีอำนาจตามที่บริษัทกำหนด</p>
      {canPrepare ? <>
        <button className={ghostClass} type="button" disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(async () => {
          await downloadSubstituteReceiptFormPdf(companyId, evidence.expenseId, evidence.id, evidence.documentNumber);
          const history = await listSubstituteReceiptHistory(companyId, evidence.expenseId);
          const current = history.find((item) => item.id === evidence.id);
          if (current) onChange(current);
        })}>1. ดาวน์โหลดแบบฟอร์มไปกรอกและเซ็น</button>
        <p className="text-sm text-gray-600">หากแก้ข้อมูลที่หน้ารายการค่าใช้จ่าย ให้ดาวน์โหลดแบบฟอร์มล่าสุดไปลงนามใหม่ เอกสารใช้เลขเดิม และฉบับที่เคยเซ็นจะอยู่ในประวัติ</p>
        <h3 className="font-bold">2. อัปโหลดฉบับที่กรอกและลงนามครบทั้งสองส่วน</h3>
        <ThemedFile file={file} accept={ATTACHMENT_UPLOAD_ACCEPT} aria-label="ฉบับลงนามบนกระดาษ" onChange={(picked) => { setFile(picked); setMatches(false); }} />
        <p className="text-xs text-gray-500">PDF ไม่เกิน 5 หน้า หรือ<WholeWords text={SIGNATURE_FILE_TYPES_LABEL} /> ขนาดไม่เกิน <span className="whitespace-nowrap">10 เมกะไบต์</span> ให้เห็นครบทุกหน้าและอ่านได้ชัดเจน</p>
        <div className="grid gap-4 md:grid-cols-2">{signerFields('ผู้รับรองการจ่าย', payer, setPayer)}{signerFields('ผู้อนุมัติ', approver, setApprover)}</div>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" type="checkbox" checked={samePerson} onChange={(event) => setSamePerson(event.target.checked)} /><span>ผู้ลงนามทั้งสองส่วนเป็นคนเดียวกัน (ต้องผ่านนโยบายบริษัท)</span></label>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" type="checkbox" checked={matches} onChange={(event) => setMatches(event.target.checked)} /><span>ยืนยันว่าไฟล์เป็นเอกสารเลขที่ {evidence.documentNumber} ข้อมูลตรงกับแบบฟอร์ม และมีชื่อ วันที่ ลายเซ็นครบทั้งสองส่วน โดยตำแหน่ง (ถ้ามี) ตรงกับกระดาษ</span></label>
        <button className={btnClass} type="button" disabled={busy || !ready || !evidence.paperFormPrepared} aria-busy={Boolean(busy)} onClick={() => void run(async () => {
          if (!file) return;
          onChange(await submitSubstitutePaperFile(companyId, evidence.expenseId, evidence.id, file, { payer, approver, samePerson, formMatchesAcknowledged: true, expectedEvidenceUpdatedAt: evidence.updatedAt }));
        })}>ยื่นฉบับลงนามเพื่อตรวจรับ</button>
        <p className="text-sm text-gray-600">ยื่นแล้วจะรอตรวจรับ ยังไม่ออกเอกสารหรือบันทึกจ่ายเงิน กรุณาเก็บต้นฉบับกระดาษ</p>
      </> : <p>รอผู้จัดทำอัปโหลดฉบับลงนาม</p>}
    </> : <>
      <dl className="grid gap-3 rounded-xl bg-gray-50 p-4 text-sm md:grid-cols-2">
        <div><dt className="font-bold">ผู้รับรองการจ่ายบนกระดาษ</dt><dd>{[submission.payer.name, submission.payer.position, submission.payer.signedOn].filter(Boolean).join(' · ')}</dd></div>
        <div><dt className="font-bold">ผู้อนุมัติบนกระดาษ</dt><dd>{[submission.approver.name, submission.approver.position, submission.approver.signedOn].filter(Boolean).join(' · ')}</dd></div>
      </dl>
      <p className="text-sm">{submission.samePerson ? 'ลงนามทั้งสองฐานะโดยคนเดียว' : 'ผู้รับรองและผู้อนุมัติเป็นคนละคน'} · ชื่อข้างต้นถอดจากกระดาษ ไม่ใช่ตัวตนบัญชีผู้อัปโหลด</p>
      <h3 className="font-bold">1. เปิดตรวจเอกสารและยืนยันว่าอ่านครบทุกหน้า</h3>
      <p className="text-sm text-gray-600">ในหน้าต่างเอกสาร ให้เปิดทุกหน้าด้วยปุ่ม “หน้าถัดไป” แล้วกด “อ่านครบทุกหน้าและตรวจเทียบข้อมูลแล้ว” การกดปิดอย่างเดียวยังไม่ถือว่ายืนยันการตรวจ</p>
      <button className={viewedHash ? ghostClass : btnClass} type="button" disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(async () => {
        setViewedHash(null); setChecks([false, false, false]);
        const currentRevision = revision;
        const result = await previewSubstitutePaper(companyId, evidence.expenseId, evidence.id);
        if (revisionRef.current !== currentRevision) return;
        setPreview(result);
      })}>ตรวจสอบเอกสารฉบับเต็มและข้อมูลที่ถอดจากกระดาษ</button>
      {canAccept ? <>
        <p role="status" className={`rounded-xl px-4 py-3 text-sm font-semibold ${viewedHash ? 'bg-brand-50 text-brand-700' : 'bg-warning-50 text-warning-700'}`}>
          {viewedHash ? 'ยืนยันการอ่านเอกสารแล้ว — ตรวจและเลือกคำยืนยันทั้ง 3 ข้อด้านล่างเพื่อดำเนินการต่อ' : 'ยังเลือกคำยืนยันไม่ได้ — เปิดเอกสารและกดยืนยันว่าอ่านครบทุกหน้าตามข้อ 1 ก่อน'}
        </p>
        <h3 className="font-bold">2. ยืนยันการตรวจรับ</h3>
        {['ข้อมูลตรงกันและมีชื่อ วันที่ และลายเซ็นครบทั้งสองส่วน โดยตำแหน่ง (ถ้ามี) ตรงกับกระดาษ', 'ตรวจแล้วว่าผู้รับรองทราบข้อเท็จจริง และผู้อนุมัติบนกระดาษมีอำนาจตามนโยบายบริษัท', 'บริษัทเก็บต้นฉบับกระดาษไว้เพื่อตรวจสอบและใช้เป็นหลักฐานประกอบ'].map((label, index) => <label key={label} className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" type="checkbox" disabled={!viewedHash || busy} checked={checks[index]} onChange={(event) => setChecks((current) => current.map((value, item) => item === index ? event.target.checked : value))} /><span>{label}</span></label>)}
        {viewedHash && !checks.every(Boolean) && <p role="status" className="text-sm text-warning-700">ยังขาดคำยืนยันอีก {checks.filter((checked) => !checked).length} ข้อ จึงจะตรวจรับและจัดเก็บฉบับสมบูรณ์ได้</p>}
        {submission.samePerson && !allowSamePerson && <ErrorBanner message="นโยบายบริษัทหรือสิทธิ์ของคุณไม่อนุญาตให้ตรวจรับฉบับที่ลงนามสองฐานะโดยคนเดียว" />}
        <button className={btnClass} type="button" disabled={busy || !viewedHash || !checks.every(Boolean) || (submission.samePerson && !allowSamePerson)} aria-busy={Boolean(busy)} onClick={() => void run(async () => {
          if (!viewedHash) return;
          onChange(await acceptSubstitutePaper(companyId, evidence.expenseId, evidence.id, { previewChecksumSha256: viewedHash, expectedEvidenceUpdatedAt: evidence.updatedAt, factsAndSignaturesAcknowledged: true, approverAuthorityAcknowledged: true, originalRetainedAcknowledged: true }));
        })}>ตรวจรับและจัดเก็บฉบับสมบูรณ์</button>
        <p className="text-sm text-gray-600">ระบบบันทึกคุณเป็นผู้ตรวจรับ ไม่ใช่ผู้เซ็นแทนบนกระดาษ{evidence.fundingSource === 'COMPANY' ? ' และบันทึกการจ่ายของบริษัทหากยังไม่ได้บันทึก' : ' การรับเอกสารนี้ไม่ใช่การคืนเงินให้พนักงาน'}</p>
      </> : <p className="text-sm">รอผู้มีสิทธิ์ตามนโยบายบริษัทตรวจรับ เอกสารยังไม่สมบูรณ์</p>}
      <p className="text-sm text-gray-500">หากข้อมูลใบแทนไม่ถูกต้อง ใช้ปุ่ม “แก้ไขข้อมูลใบแทน” ในส่วน “จัดการข้อมูล” แล้วลงนามฟอร์มล่าสุดโดยใช้เลขเดิม</p>
    </>}
    {preview && <SubstitutePaperDocumentPreview documentNumber={evidence.documentNumber} preview={preview}
      onClose={() => setPreview(null)} onReviewed={() => {
        if (revisionRef.current !== revision) return;
        setViewedHash(preview.previewChecksumSha256); setPreview(null);
      }} />}
  </MangmeeCard>;
}

export function SubstitutePaperDocumentPreview({ documentNumber, preview, onClose, onReviewed }: {
  documentNumber: string; preview: SubstituteReceiptPaperPreview; onClose: () => void; onReviewed?: () => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [loadedPages, setLoadedPages] = useState<number[]>([]);
  const [pdfUrl, setPdfUrl] = useState('');
  useEffect(() => {
    const prefix = 'data:application/pdf;base64,';
    if (!preview.pdfDataUrl.startsWith(prefix)) return;
    const bytes = Uint8Array.from(atob(preview.pdfDataUrl.slice(prefix.length)), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  const pages = preview.pageImageDataUrls;
  return <DocumentPreviewModal source={{ name: `${documentNumber} · หน้า ${pageIndex + 1} / ${pages.length}`, mimeType: 'image/jpeg', url: pages[pageIndex] ?? '' }}
    closeLabel="ปิด" loadingLabel="กำลังเปิดเอกสาร" errorLabel="เปิดเอกสารไม่ได้" retryLabel="ลองอีกครั้ง" openNewTabLabel="เปิดในแท็บใหม่"
    hideOpenNewTab zoomInLabel="ขยาย" zoomOutLabel="ย่อ" resetZoomLabel="ขนาดปกติ"
    onClose={onClose} onViewed={() => setLoadedPages((loaded) => loaded.includes(pageIndex) ? loaded : [...loaded, pageIndex])}
    footer={<>
      {onReviewed && <p role="status" className="w-full text-sm text-gray-600">
        เปิดแล้ว {loadedPages.length} / {pages.length} หน้า · {loadedPages.length === pages.length && pages.length > 0
          ? 'เมื่ออ่านและตรวจเทียบครบแล้ว กดปุ่มยืนยันด้านล่างเพื่อกลับไปเลือกคำยืนยันการตรวจรับ'
          : 'เปิดเอกสารให้ครบทุกหน้าก่อน จึงจะกดยืนยันการอ่านได้'}
      </p>}
      <button className={ghostClass} type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((page) => page - 1)}>หน้าก่อน</button>
      <button className={ghostClass} type="button" disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex((page) => page + 1)}>หน้าถัดไป</button>
      {pdfUrl && <a className={ghostClass} href={pdfUrl} download={`${documentNumber}.pdf`}>ดาวน์โหลด PDF</a>}
      {onReviewed && <button className={btnClass} type="button" disabled={!pages.length || loadedPages.length !== pages.length} onClick={onReviewed}>อ่านครบทุกหน้าและตรวจเทียบข้อมูลแล้ว</button>}
    </>} />;
}
