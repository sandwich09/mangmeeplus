'use client';

import { SIGNATURE_FILE_TYPES_LABEL, THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SubstituteReceiptEvidenceSummary, SubstituteReceiptPaperPreview, SubstituteReceiptPaperSigner } from '@watchdog-bms/contracts';
import { MangmeeCard } from '@/common/components/mangmee';
import { focusExpenseField } from './expense-focus.logic';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { ChoiceRow } from '@/common/components/field';
import { Notice } from '@/common/components/notice';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { DocumentPreviewModal } from '@/common/components/document-preview';
import { acceptSubstitutePaper, downloadSubstituteReceiptFormPdf, listSubstituteReceiptHistory, previewSubstitutePaper, submitSubstitutePaperFile } from './expenses.api';
import { btnClass, dateShort, ghostClass, inputClass, err, WholeWords } from './ExpensesUi';

const blankSigner = (): SubstituteReceiptPaperSigner => ({ name: '', position: '', signedOn: '' });
const stepHeadingClass = 'text-sm font-semibold text-gray-900';
const errorLineClass = 'mt-1 block text-sm font-normal text-error-700';
const requiredMark = <span className="ml-1 text-error-700" aria-hidden="true">*</span>;
/** The three things the person who accepts the paper states, in the order the server records them. */
const ACCEPT_CHECKS = [
  'ข้อมูลตรงกับกระดาษ มีชื่อ วันที่ และลายเซ็นครบทั้งสองช่อง',
  'ผู้รับรองการจ่ายรู้ว่าจ่ายจริง และผู้อนุมัติบนกระดาษมีอำนาจอนุมัติของร้าน',
  'ร้านเก็บกระดาษตัวจริงไว้',
];

/**
 * The paper route in two real steps, each showing its own state: print the form, then send back the
 * signed copy; and for the person who accepts it: read every page, then accept. A main button is
 * never dimmed without a word: pressed too early it names what is still missing.
 * `backAction` is the wizard's way back; it sits in this panel's own button group.
 */
export function SubstitutePaperSigningPanel({ companyId, evidence, canPrepare, canAccept, allowSamePerson, onChange, backAction }: {
  companyId: string; evidence: SubstituteReceiptEvidenceSummary; canPrepare: boolean; canAccept: boolean; allowSamePerson: boolean;
  onChange: (evidence: SubstituteReceiptEvidenceSummary) => void; backAction?: ReactNode;
}) {
  const [payer, setPayer] = useState(blankSigner);
  const [approver, setApprover] = useState(blankSigner);
  const [samePerson, setSamePerson] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [matches, setMatches] = useState(false);
  const [checks, setChecks] = useState([false, false, false]);
  const [attempted, setAttempted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusMissing = () => {
    setAttempted(true);
    requestAnimationFrame(() => focusExpenseField(panelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')));
  };
  /** The form was taken in this visit. (`paperFormPrepared` only says the server has fixed the form's content.) */
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<SubstituteReceiptPaperPreview | null>(null);
  const [viewedHash, setViewedHash] = useState<string | null>(null);
  const revision = `${evidence.id}:${evidence.updatedAt}`;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  useEffect(() => { setViewedHash(null); setPreview(null); setChecks([false, false, false]); setFile(null); setMatches(false); setAttempted(false); }, [revision]);  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(err(error)); } finally { setBusy(false); }
  };
  const signerFields = (role: string, value: SubstituteReceiptPaperSigner, change: (value: SubstituteReceiptPaperSigner) => void) => (
    <fieldset className="min-w-0 space-y-3">
      <legend className={stepHeadingClass}>{role} (ตามที่เขียนบนกระดาษ)</legend>
      <label className="block text-sm font-semibold text-gray-700">
        <span className="mb-1 block">ชื่อ–นามสกุล{requiredMark}</span>
        <input className={inputClass} aria-label={`ชื่อ${role}`} value={value.name} maxLength={200} required aria-invalid={attempted && !value.name.trim() || undefined} onChange={(event) => change({ ...value, name: event.target.value })} />
        {attempted && !value.name.trim() && <span role="alert" className={errorLineClass}>กรอกชื่อ{role}</span>}
      </label>
      <label className="block text-sm font-semibold text-gray-700">
        <span className="mb-1 block">ตำแหน่ง <span className="font-normal text-gray-500">(ถ้ามี)</span></span>
        <input className={inputClass} aria-label={`ตำแหน่ง${role}`} value={value.position} maxLength={120} onChange={(event) => change({ ...value, position: event.target.value })} />
      </label>
      <label className="block text-sm font-semibold text-gray-700">
        <span className="mb-1 block">วันที่เซ็น{requiredMark}</span>
        <ThemedDate className={inputClass} aria-label={`วันที่${role}เซ็น`} value={value.signedOn} required aria-invalid={attempted && !value.signedOn || undefined} onChange={(event) => change({ ...value, signedOn: event.target.value })} />
        {attempted && !value.signedOn && <span role="alert" className={errorLineClass}>เลือกวันที่{role}เซ็น</span>}
      </label>
    </fieldset>
  );
  const submission = evidence.paperSubmission;
  // What the send button still lacks. A name or a date says so under its own field; the rest is named above the button.
  const signersMissing = [payer, approver].some((person) => !person.name.trim() || !person.signedOn);
  const sendMissing = [
    ...(!evidence.paperFormPrepared ? ['ดาวน์โหลดแบบฟอร์มก่อน'] : []),
    ...(!file ? ['เลือกไฟล์ฉบับที่เซ็นแล้ว'] : []),
    ...(!matches ? ['ติ๊กว่าไฟล์นี้กรอกและเซ็นครบแล้ว'] : []),
  ];
  const sendIsMain = Boolean(file) || downloaded;
  const samePersonRefused = Boolean(submission?.samePerson && !allowSamePerson);
  const acceptMissing = [
    ...(!viewedHash ? ['อ่านเอกสารให้ครบทุกหน้า'] : []),
    ...(viewedHash && !checks.every(Boolean) ? [`ติ๊กอีก ${checks.filter((checked) => !checked).length} ข้อ`] : []),
  ];
  const missingLine = (missing: string[]) => attempted && missing.length > 0 && (
    <p role="alert" className="text-sm text-error-700"><span className="font-semibold">ยังขาด:</span> {missing.join(' · ')}</p>
  );
  const signerLine = (person: SubstituteReceiptPaperSigner) => [person.name, person.position, person.signedOn && `เซ็น ${dateShort(person.signedOn)}`].filter(Boolean).join(' · ');
  // With the wizard's way back in it, the group is the navigation of this step.
  const actions = (main: ReactNode) => (backAction
    ? <nav aria-label="การนำทางขั้นตอนเซ็น"><ActionGroup>{backAction}{main}</ActionGroup></nav>
    : main && <ActionGroup>{main}</ActionGroup>);
  return <div ref={panelRef}><MangmeeCard className="space-y-5 p-4 sm:p-5">
    <h2 className="text-base font-semibold text-gray-900">เซ็นบนกระดาษ</h2>
    {error && <Notice tone="error">{error}</Notice>}
    {!submission ? (canPrepare ? <>
      <section className="space-y-2" aria-invalid={attempted && !evidence.paperFormPrepared || undefined}>
        <h3 className={stepHeadingClass}>1 พิมพ์แบบฟอร์ม</h3>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-56 text-sm text-gray-600">พิมพ์ ให้ผู้รับรองการจ่าย (คนที่จ่ายเงินหรือรู้ว่าจ่ายจริง) และผู้อนุมัติกรอกชื่อ วันที่ และเซ็น</p>
          <ActionGroup>
            {/* The main button of this view until the person is at step 2 (a file is chosen); then the send button is. */}
            <button className={sendIsMain ? ghostClass : btnClass} type="button" disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(async () => {
              await downloadSubstituteReceiptFormPdf(companyId, evidence.expenseId, evidence.id, evidence.documentNumber);
              setDownloaded(true);
              const history = await listSubstituteReceiptHistory(companyId, evidence.expenseId);
              const current = history.find((item) => item.id === evidence.id);
              if (current) onChange(current);
            })}>ดาวน์โหลดแบบฟอร์ม</button>
          </ActionGroup>
        </div>
        {attempted && !evidence.paperFormPrepared && <p role="alert" className={errorLineClass}>ดาวน์โหลดแบบฟอร์มก่อน</p>}
        {downloaded && <p role="status" className="text-sm font-semibold text-brand-700">✓ ดาวน์โหลดแล้ว</p>}
      </section>
      <section className="space-y-4 border-t border-gray-100 pt-5">
        <h3 className={stepHeadingClass}>2 ส่งฉบับที่เซ็นแล้ว</h3>
        <div aria-invalid={attempted && !file || undefined}>
          <ThemedFile file={file} accept={ATTACHMENT_UPLOAD_ACCEPT} aria-label="ฉบับที่เซ็นบนกระดาษ" aria-describedby="substitute-paper-file-hint" onChange={(picked) => { setFile(picked); setMatches(false); }} />
          {attempted && !file && <p role="alert" className={errorLineClass}>เลือกไฟล์ฉบับที่เซ็นแล้ว</p>}
          {/* Its own line, not the picker's `hint`: each file-type name and the size must stay whole. */}
          <p id="substitute-paper-file-hint" className="mt-1 text-sm text-gray-500">PDF หรือ<WholeWords text={SIGNATURE_FILE_TYPES_LABEL} /> ขนาดไม่เกิน <span className="whitespace-nowrap">10 เมกะไบต์</span> ถ่ายให้เห็นครบทุกหน้า</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">{signerFields('ผู้รับรองการจ่าย', payer, setPayer)}{signerFields('ผู้อนุมัติ', approver, setApprover)}</div>
        <div className="grid gap-2">
          <ChoiceRow type="checkbox" checked={samePerson} onChange={(event) => setSamePerson(event.target.checked)}
            label="คนเดียวกันเซ็นทั้งสองช่อง" description={`ใช้ได้เมื่อร้านตั้งค่าเป็น “${THAI_SYSTEM_ROLE_NAMES.OWNER}เซ็นและอนุมัติเอง”`} />
          <div aria-invalid={attempted && !matches || undefined}><ChoiceRow type="checkbox" framed required aria-required="true" checked={matches} onChange={(event) => setMatches(event.target.checked)}
            label={<>ไฟล์นี้คือใบ <span className="mangmee-unit">{evidence.documentNumber}</span> ที่กรอกและเซ็นครบแล้ว{requiredMark}</>} />
          {attempted && !matches && <p role="alert" className={errorLineClass}>ติ๊กว่าไฟล์นี้กรอกและเซ็นครบแล้ว</p>}</div>
        </div>
      </section>
      <div className="space-y-3 border-t border-gray-100 pt-4">
        {missingLine(sendMissing)}
        {actions(
          <button className={sendIsMain ? btnClass : ghostClass} type="button" disabled={busy} aria-busy={Boolean(busy)} onClick={() => {
            if (sendMissing.length > 0 || signersMissing || !file) { focusMissing(); return; }
            void run(async () => {
              onChange(await submitSubstitutePaperFile(companyId, evidence.expenseId, evidence.id, file, { payer, approver, samePerson, formMatchesAcknowledged: true, expectedEvidenceUpdatedAt: evidence.updatedAt }));
            });
          }}>ส่งฉบับที่เซ็นแล้ว</button>,
        )}
      </div>
    </> : <>
      <p className="text-sm text-gray-600">ให้ผู้ตรวจค่าใช้จ่ายเปิดใบนี้เพื่อพิมพ์และส่งฉบับที่เซ็นแล้ว</p>
      {actions(null)}
    </>) : <>
      {/* What happened and what is next, said after the send (thai-ux-standard 6.1). */}
      <Notice tone="info">{canAccept ? 'ได้รับฉบับที่เซ็นแล้ว อ่านให้ครบแล้วตรวจรับ' : 'ส่งฉบับที่เซ็นแล้ว รอผู้อนุมัติตรวจรับ เก็บกระดาษตัวจริงไว้'}</Notice>
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <div className="min-w-0"><dt className="text-gray-500">ผู้รับรองการจ่าย (บนกระดาษ)</dt><dd className="break-words font-semibold text-gray-900">{signerLine(submission.payer)}</dd></div>
        <div className="min-w-0"><dt className="text-gray-500">ผู้อนุมัติ (บนกระดาษ)</dt><dd className="break-words font-semibold text-gray-900">{signerLine(submission.approver)}</dd></div>
      </dl>
      {submission.samePerson && <p className="text-sm text-gray-600">คนเดียวกันเซ็นทั้งสองช่อง</p>}
      {canAccept ? <>
        <section className="space-y-2 border-t border-gray-100 pt-5" aria-invalid={attempted && !viewedHash || undefined}>
          <h3 className={stepHeadingClass}>1 อ่านเอกสารให้ครบทุกหน้า</h3>
          <ActionGroup align="start">
            <button className={viewedHash ? ghostClass : btnClass} type="button" disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(async () => {
              setViewedHash(null); setChecks([false, false, false]);
              const currentRevision = revision;
              const result = await previewSubstitutePaper(companyId, evidence.expenseId, evidence.id);
              if (revisionRef.current !== currentRevision) return;
              setPreview(result);
            })}>{viewedHash ? 'เปิดเอกสารอีกครั้ง' : 'เปิดเอกสารที่ส่งมา'}</button>
          </ActionGroup>
          {attempted && !viewedHash && <p role="alert" className={errorLineClass}>อ่านเอกสารให้ครบทุกหน้า</p>}
          {viewedHash && <p role="status" className="text-sm font-semibold text-brand-700">✓ อ่านครบแล้ว</p>}
        </section>
        <section className="space-y-3 border-t border-gray-100 pt-5">
          <h3 className={stepHeadingClass}>2 ตรวจรับ</h3>
          {!viewedHash && <p className="text-sm text-gray-600">ติ๊กได้หลังอ่านเอกสารครบทุกหน้า</p>}
          <div className="grid gap-2">
            {ACCEPT_CHECKS.map((label, index) => (
              <div key={label} aria-invalid={attempted && !!viewedHash && !checks[index] || undefined}><ChoiceRow type="checkbox" framed disabled={!viewedHash || busy} checked={checks[index] ?? false}
                onChange={(event) => setChecks((current) => current.map((value, item) => (item === index ? event.target.checked : value)))} label={label} />
                {attempted && viewedHash && !checks[index] && <p role="alert" className={errorLineClass}>ติ๊กคำยืนยันข้อนี้</p>}</div>
            ))}
          </div>
          {samePersonRefused && <div aria-invalid={attempted || undefined} tabIndex={-1}><Notice tone="error">ใบนี้คนเดียวเซ็นทั้งสองช่อง ซึ่งการตั้งค่าของร้านหรือสิทธิ์ของคุณไม่ให้ตรวจรับ</Notice></div>}
          {missingLine(acceptMissing)}
          {actions(
            <button className={viewedHash ? btnClass : ghostClass} type="button" disabled={busy} aria-busy={Boolean(busy)} onClick={() => {
              if (samePersonRefused || acceptMissing.length > 0 || !viewedHash) { focusMissing(); return; }
              void run(async () => {
                onChange(await acceptSubstitutePaper(companyId, evidence.expenseId, evidence.id, { previewChecksumSha256: viewedHash, expectedEvidenceUpdatedAt: evidence.updatedAt, factsAndSignaturesAcknowledged: true, approverAuthorityAcknowledged: true, originalRetainedAcknowledged: true }));
              });
            }}>ตรวจรับและจัดเก็บฉบับสมบูรณ์</button>,
          )}
          <p className="text-sm text-gray-600">ระบบบันทึกว่าคุณเป็นผู้ตรวจรับ ไม่ใช่ผู้เซ็น{evidence.fundingSource === 'COMPANY' ? ' และบันทึกว่าร้านจ่ายแล้วถ้ายังไม่ได้บันทึก' : ' การตรวจรับไม่ใช่การจ่ายเงินคืนพนักงาน'}</p>
        </section>
      </> : actions(null)}
    </>}
    {preview && <SubstitutePaperDocumentPreview documentNumber={evidence.documentNumber} preview={preview}
      onClose={() => setPreview(null)} onReviewed={() => {
        if (revisionRef.current !== revision) return;
        setViewedHash(preview.previewChecksumSha256); setPreview(null);
      }} />}
  </MangmeeCard></div>;
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
  const readAll = pages.length > 0 && loadedPages.length === pages.length;
  // The footer holds buttons only, so the shared footer lays them out as one group. Why the last one
  // cannot be pressed yet is said by its own name: how many pages have been opened so far.
  return <DocumentPreviewModal source={{ name: `ใบรับรองแทนใบเสร็จ ${documentNumber} · หน้า ${pageIndex + 1} / ${pages.length}`, mimeType: 'image/jpeg', url: pages[pageIndex] ?? '' }}
    closeLabel="ปิด" loadingLabel="กำลังเปิดเอกสาร" errorLabel="เปิดเอกสารไม่ได้" retryLabel="ลองอีกครั้ง" openNewTabLabel="เปิดในแท็บใหม่"
    hideOpenNewTab zoomInLabel="ขยาย" zoomOutLabel="ย่อ" resetZoomLabel="ขนาดปกติ" mainAction="host"
    onClose={onClose} onViewed={() => setLoadedPages((loaded) => loaded.includes(pageIndex) ? loaded : [...loaded, pageIndex])}
    footer={<>
      {/* A page turn is offered only where there is a page to turn to. */}
      {pageIndex > 0 && <button className={ghostClass} type="button" onClick={() => setPageIndex((page) => page - 1)}>หน้าก่อน</button>}
      {pageIndex < pages.length - 1 && <button className={ghostClass} type="button" onClick={() => setPageIndex((page) => page + 1)}>หน้าถัดไป</button>}
      {pdfUrl && <a className={ghostClass} href={pdfUrl} download={`${documentNumber}.pdf`}>ดาวน์โหลด PDF</a>}
      {onReviewed && <button className={btnClass} type="button" disabled={!readAll} onClick={onReviewed}>{readAll ? 'อ่านครบทุกหน้าและตรวจเทียบข้อมูลแล้ว' : `เปิดอ่านแล้ว ${loadedPages.length} จาก ${pages.length} หน้า`}</button>}
    </>} />;
}
