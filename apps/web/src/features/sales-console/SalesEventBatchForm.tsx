'use client';
import { useEffect, useRef, useState } from 'react';
import {
  billingPlanLabel, SALES_DEAL_BASE_TIERS, SALES_EVENT_NAME_MAX,
  type SalesEventAgentOption, type SalesEventBatchView,
} from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard } from '@/common/components/mangmee';
import { SwitchField, TextField } from '@/common/components/field';
import { createSalesEventBatch, searchSalesEventAgents, updateSalesEventBatch } from './sales.api';
import {
  discountTooHighMessage, emptyEventBatchForm, eventBatchFormFromView, eventBatchInputFromForm, firstEventBatchErrorField,
  SALES_EVENT_INTERVAL_LABELS, SALES_EVENT_INTERVALS, toggleValue, validateEventBatchForm,
  type SalesEventBatchFormErrors, type SalesEventBatchFormValues,
} from './sales-events.logic';
import { SalesNotice } from './SalesConsoleParts';

/**
 * The เซลล์ picker (spec §3.1, SED-18): a checkbox list of the lead's own team (everyone for
 * SYSTEM_ADMIN), searched on the server 50 at a time. Ticked people stay listed while the search moves on.
 */
function AgentPicker({
  selected, known, onToggle, error,
}: {
  selected: string[];
  known: Map<string, string>;
  onToggle: (agent: SalesEventAgentOption, on: boolean) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SalesEventAgentOption[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchError(null);
      searchSalesEventAgents(query, null, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) { setItems(result.items); setNextCursor(result.nextCursor); } })
        .catch((cause) => { if (!controller.signal.aborted) { setItems([]); setSearchError(apiErrorMessage(cause)); } });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const loadMore = () => {
    if (!nextCursor) return;
    searchSalesEventAgents(query, nextCursor)
      .then((result) => { setItems((previous) => [...(previous ?? []), ...result.items]); setNextCursor(result.nextCursor); })
      .catch((cause) => setSearchError(apiErrorMessage(cause)));
  };

  const listed = new Set((items ?? []).map((agent) => agent.userId));
  const pinned = selected.filter((userId) => !listed.has(userId));
  return (
    <fieldset className="grid gap-2" id="agentUserIds">
      <legend className="text-sm font-medium text-gray-700">เซลล์ผู้แจก</legend>
      <TextField label="ค้นหาชื่อเซลล์" name="eventAgentQuery" value={query} autoComplete="off"
        hint="เลือกได้เฉพาะเซลล์ในทีมของคุณ" onChange={(event) => setQuery(event.target.value)} />
      {pinned.map((userId) => (
        <SwitchField key={userId} name={`agent-${userId}`} label={known.get(userId) || 'เซลล์ที่เลือกไว้'} checked
          onChange={() => onToggle({ userId, displayName: known.get(userId) ?? '', salesCode: '' }, false)} />
      ))}
      {items === null && <p className="text-sm text-gray-500">กำลังโหลดรายชื่อเซลล์…</p>}
      {items?.map((agent) => (
        <SwitchField key={agent.userId} name={`agent-${agent.userId}`} label={agent.displayName || agent.salesCode}
          hint={`รหัสเซลล์ ${agent.salesCode}`} checked={selected.includes(agent.userId)}
          onChange={(event) => onToggle(agent, event.target.checked)} />
      ))}
      {items && items.length === 0 && !searchError && <p className="text-sm text-gray-500">ไม่พบเซลล์ที่ตรงกับคำค้นนี้</p>}
      {nextCursor && <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={loadMore}>โหลดรายชื่อเพิ่ม</button>}
      {searchError && <SalesNotice tone="error">{searchError}</SalesNotice>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-gray-500">เลือกไว้ {selected.length} คน</p>
    </fieldset>
  );
}

/**
 * One form for "สร้างชุดส่วนลด" and "แก้ไขชุด" (spec §3.1). Creating opens the batch at once — there is
 * no draft on the server; saving an edit is a new revision that applies to tickets handed out after it.
 */
export default function SalesEventBatchForm({
  batch, onSaved, onCancel,
}: { batch?: SalesEventBatchView; onSaved: (batch: SalesEventBatchView) => void; onCancel: () => void }) {
  const [values, setValues] = useState<SalesEventBatchFormValues>(() => (batch ? eventBatchFormFromView(batch) : emptyEventBatchForm(new Date())));
  const [errors, setErrors] = useState<SalesEventBatchFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = useRef(new Map((batch?.agents ?? []).map((agent) => [agent.userId, agent.displayName])));
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const set = <K extends keyof SalesEventBatchFormValues>(key: K, value: SalesEventBatchFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (errors[key]) setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const submit = async () => {
    const found = validateEventBatchForm(values, { now: new Date(), issuedCount: batch?.issuedCount, storedClaimEndsAt: batch?.claimEndsAt });
    setErrors(found);
    const first = firstEventBatchErrorField(found);
    if (first) {
      setFormError(null);
      const input = document.getElementById(first);
      input?.scrollIntoView({ block: 'center' });
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const input = eventBatchInputFromForm(values);
      const saved = batch
        ? await updateSalesEventBatch(batch.id, { ...input, expectedVersion: batch.version })
        : await createSalesEventBatch(input);
      if (mounted.current) onSaved(saved);
    } catch (cause) {
      if (!mounted.current) return;
      setFormError(discountTooHighMessage(cause)
        ?? (apiErrorCode(cause) === 'SALES_EVENT_BATCH_STALE' ? 'ชุดนี้ถูกแก้ไขจากที่อื่นแล้ว กรุณาปิดฟอร์มแล้วโหลดข้อมูลล่าสุดก่อนแก้อีกครั้ง' : apiErrorMessage(cause)));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <form className="grid gap-4" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {formError && <SalesNotice tone="error">{formError}</SalesNotice>}
      <MangmeeCard className="grid gap-4 p-4">
        <p className="text-[15px] font-bold text-gray-900">{batch ? 'แก้ไขชุดส่วนลด' : 'สร้างชุดส่วนลดใหม่'}</p>
        <TextField label="ชื่องาน" name="eventName" maxLength={SALES_EVENT_NAME_MAX} value={values.eventName}
          hint="ใช้จัดกลุ่มรายงาน เช่น งานแฟร์ร้านค้า ตุลาคม" error={errors.eventName}
          onChange={(event) => set('eventName', event.target.value)} />
        <TextField label="ชื่อชุด" name="batchName" maxLength={SALES_EVENT_NAME_MAX} value={values.batchName}
          hint="แยกชุดในงานเดียวกัน เช่น บูธหน้าเวที" error={errors.batchName}
          onChange={(event) => set('batchName', event.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="ส่วนลดบิลแรก (บาท)" name="discountBaht" inputMode="numeric" value={values.discountBaht}
            hint="จำนวนเต็มบาท ลดเฉพาะบิลแรกของร้านที่ซื้อแพ็กเกจใหม่ รอบต่ออายุชำระราคาเต็ม" error={errors.discountBaht}
            onChange={(event) => set('discountBaht', event.target.value)} />
          <TextField label="จำนวนแจกสูงสุด" name="issueCap" inputMode="numeric" value={values.issueCap}
            hint={batch ? `แจกไปแล้ว ${batch.issuedCount.toLocaleString('th-TH')} รายการ · ลดไม่ได้ต่ำกว่านี้` : 'นับตลอดอายุชุด ส่วนลดที่เพิกถอนหรือไม่ได้ใช้ไม่คืนจำนวน'}
            error={errors.issueCap} onChange={(event) => set('issueCap', event.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="เปิดรับ (เวลาประเทศไทย)" name="claimStartsAt" type="datetime-local" value={values.claimStartsAt}
            error={errors.claimStartsAt} onChange={(event) => set('claimStartsAt', event.target.value)} />
          <TextField label="ปิดรับ (เวลาประเทศไทย)" name="claimEndsAt" type="datetime-local" value={values.claimEndsAt}
            hint="ลูกค้าใช้ส่วนลดได้ถึง 30 วันหลังปิดรับ" error={errors.claimEndsAt}
            onChange={(event) => set('claimEndsAt', event.target.value)} />
        </div>
      </MangmeeCard>

      <MangmeeCard className="grid gap-3 p-4">
        <fieldset className="grid gap-1" id="tiers">
          <legend className="text-sm font-medium text-gray-700">แพ็กเกจที่ลดได้</legend>
          {SALES_DEAL_BASE_TIERS.map((tier) => (
            <SwitchField key={tier} name={`tier-${tier}`} label={billingPlanLabel(tier)} checked={values.tiers.includes(tier)}
              onChange={(event) => set('tiers', toggleValue(values.tiers, tier, event.target.checked))} />
          ))}
        </fieldset>
        <fieldset className="grid gap-1">
          <legend className="text-sm font-medium text-gray-700">รอบที่ลดได้</legend>
          {SALES_EVENT_INTERVALS.map((interval) => (
            <SwitchField key={interval} name={`interval-${interval}`} label={SALES_EVENT_INTERVAL_LABELS[interval]}
              checked={values.intervals.includes(interval)}
              onChange={(event) => set('intervals', toggleValue(values.intervals, interval, event.target.checked))} />
          ))}
        </fieldset>
        {errors.tiers && <p role="alert" className="text-sm text-red-700">{errors.tiers}</p>}
      </MangmeeCard>

      <MangmeeCard className="grid gap-3 p-4">
        <AgentPicker selected={values.agentUserIds} known={known.current} error={errors.agentUserIds}
          onToggle={(agent, on) => {
            if (agent.displayName) known.current.set(agent.userId, agent.displayName);
            set('agentUserIds', toggleValue(values.agentUserIds, agent.userId, on));
          }} />
      </MangmeeCard>

      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy}>
          {batch ? 'บันทึกการเปลี่ยนแปลง' : 'ยืนยันและเปิดแจกส่วนลด'}
        </button>
      </div>
    </form>
  );
}
