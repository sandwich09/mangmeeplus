'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SalesDemoLinkItem } from '@watchdog-bms/contracts';
import { demoLinkDraftErrors, localInputValue, type DemoLinkDraft as Draft } from './demo-links.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { TextField } from '@/common/components/field';
import { Modal } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { deleteSalesDemoLink, listSalesDemoLinks, resetSalesDemoLink, updateSalesDemoLink } from './sales.api';
import { SalesDemoLinkDialog } from './SalesDemoLinkDialog';
import { SalesEmpty, SalesNotice } from './SalesConsoleParts';

type Confirm = { kind: 'reset' | 'delete'; link: SalesDemoLinkItem };

const STATUS = {
  WAITING: { label: 'ยังไม่มีคนเปิด', tone: 'slate' },
  OPENED: { label: 'เปิดใช้แล้ว', tone: 'brand' },
  EXPIRED: { label: 'หมดอายุ', tone: 'danger' },
} as const;

export default function SalesDemoLinksPage() {
  const [links, setLinks] = useState<SalesDemoLinkItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SalesDemoLinkItem | null>(null);
  const [draft, setDraft] = useState<Draft>({ aiCredit: '', readLimit: '', expiresAt: '' });
  const [draftErrors, setDraftErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try { const next = await listSalesDemoLinks({ signal }); if (!signal?.aborted) { setLinks(next); setError(null); } }
    catch (cause) { if (!signal?.aborted) setError(apiErrorMessage(cause)); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  function openEdit(link: SalesDemoLinkItem) {
    setDraft({ aiCredit: String(link.aiCredit), readLimit: String(link.readLimit), expiresAt: localInputValue(link.expiresAt) });
    setDraftErrors({}); setActionError(null); setEditing(link);
  }

  async function run(action: () => Promise<unknown>, done: () => void) {
    if (busy) return;
    setBusy(true); setActionError(null);
    try { await action(); done(); await load(); }
    catch (cause) { setActionError(apiErrorMessage(cause)); }
    finally { setBusy(false); }
  }

  function save() {
    if (!editing) return;
    const errors = demoLinkDraftErrors(draft);
    setDraftErrors(errors);
    if (Object.keys(errors).length) return;
    const expiresAt = new Date(draft.expiresAt).toISOString();
    const body = {
      ...(Number(draft.aiCredit) !== editing.aiCredit ? { aiCredit: Number(draft.aiCredit) } : {}),
      ...(Number(draft.readLimit) !== editing.readLimit ? { readLimit: Number(draft.readLimit) } : {}),
      ...(draft.expiresAt !== localInputValue(editing.expiresAt) ? { expiresAt } : {}),
    };
    if (!Object.keys(body).length) { setEditing(null); return; }
    void run(() => updateSalesDemoLink(editing.id, body), () => setEditing(null));
  }

  const field = (key: keyof Draft) => ({
    value: draft[key], error: draftErrors[key], disabled: busy,
    onChange: (event: { target: { value: string } }) => { setDraft(current => ({ ...current, [key]: event.target.value })); setDraftErrors(current => ({ ...current, [key]: undefined })); },
  });

  return (
    <MangmeePage
      eyebrow="ทีมขายมั่งมี"
      title="ลิงก์เดโม่"
      description="ลิงก์ร้านตัวอย่างที่สร้างไว้ แก้เครดิต จำนวนเอกสาร และเวลาหมดอายุได้"
      actions={<button type="button" className="mangmee-btn mangmee-btn-primary" onClick={() => setCreating(true)}>สร้างลิงก์เดโม่</button>}
    >
      {error && <SalesNotice tone="error">{error}</SalesNotice>}
      {links === null ? (error ? null : <LoadingState label="กำลังโหลดลิงก์…" />)
        : links.length === 0 ? <SalesEmpty>ยังไม่มีลิงก์เดโม่</SalesEmpty>
          : <MangmeeCard>
            {links.map(link => (
              <div key={link.id} className="grid gap-3 border-t border-gray-100 px-4 py-4 first:border-t-0 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <MangmeeBadge tone={STATUS[link.status].tone}>{STATUS[link.status].label}</MangmeeBadge>
                    <span className="text-sm text-gray-600">สร้างโดย {link.createdByName} · {formatThaiDateTime(link.createdAt)}</span>
                  </div>
                  <p className="font-semibold text-gray-900">หมดอายุ {formatThaiDateTime(link.expiresAt)}</p>
                  <p className="text-sm text-gray-600">
                    เครดิต {link.creditUsed ?? 0}/{link.aiCredit} · อ่านเอกสาร {link.readsUsed ?? 0}/{link.readLimit}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {link.status !== 'EXPIRED' && <button type="button" className="mangmee-btn mangmee-btn-secondary min-w-[6.5rem]" onClick={() => openEdit(link)}>แก้ไข</button>}
                  {link.status === 'OPENED' && <button type="button" className="mangmee-btn mangmee-btn-secondary min-w-[6.5rem]" onClick={() => { setActionError(null); setConfirm({ kind: 'reset', link }); }}>ล้างร้าน</button>}
                  <button type="button" className="mangmee-btn mangmee-btn-danger min-w-[6.5rem]" onClick={() => { setActionError(null); setConfirm({ kind: 'delete', link }); }}>ลบลิงก์</button>
                </div>
              </div>
            ))}
          </MangmeeCard>}

      {creating && <SalesDemoLinkDialog onClose={() => { setCreating(false); void load(); }} />}

      <Modal open={editing !== null} onClose={busy ? () => {} : () => setEditing(null)} title="แก้ไขลิงก์เดโม่" size="sm" footer={<>
        <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} onClick={() => setEditing(null)}>ยกเลิก</button>
        <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={save}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
      </>}>
        <div className="space-y-4">
          <TextField label="เครดิต AI" type="number" inputMode="numeric" min={1} max={300} step={1} {...field('aiCredit')} />
          <TextField label="อ่านเอกสารได้ (ใบ)" type="number" inputMode="numeric" min={1} max={50} step={1} {...field('readLimit')} />
          <TextField label="หมดอายุ" type="datetime-local" {...field('expiresAt')} />
          {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
        </div>
      </Modal>

      <Modal open={confirm !== null} onClose={busy ? () => {} : () => setConfirm(null)} size="sm"
        title={confirm?.kind === 'reset' ? 'ล้างร้านตัวอย่าง' : 'ลบลิงก์เดโม่'} footer={<>
          <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>ยกเลิก</button>
          <button type="button" className={`mangmee-btn ${confirm?.kind === 'delete' ? 'mangmee-btn-danger' : 'mangmee-btn-primary'}`} disabled={busy} aria-busy={busy}
            onClick={() => confirm && void run(() => confirm.kind === 'reset' ? resetSalesDemoLink(confirm.link.id) : deleteSalesDemoLink(confirm.link.id), () => setConfirm(null))}>
            {busy ? 'กำลังทำ…' : confirm?.kind === 'reset' ? 'ล้างร้าน' : 'ลบลิงก์'}
          </button>
        </>}>
        <p className="text-sm leading-relaxed text-gray-700">
          {confirm?.kind === 'reset'
            ? 'ข้อมูลในร้านตัวอย่างจะหายทั้งหมด ลิงก์ยังใช้ได้ คนเปิดครั้งถัดไปได้ร้านใหม่'
            : 'ลิงก์จะเปิดไม่ได้ทันที และข้อมูลในร้านตัวอย่างจะหายทั้งหมด'}
        </p>
        {actionError && <p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p>}
      </Modal>
    </MangmeePage>
  );
}
