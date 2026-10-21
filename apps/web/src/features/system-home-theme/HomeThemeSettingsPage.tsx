'use client';

import { useEffect, useState } from 'react';
import { HOME_EVENTS, type HomeEvent, type HomeThemeSetting, type SetHomeTheme } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { PageHeader } from '@/common/components/page/PageHeader';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { ActionGroup } from '@/common/components/actions/ActionGroup';

const path = '/system/home-theme';
const descriptions: Record<HomeEvent, string> = {
  default: 'ปิดธีมเทศกาล กลับไปใช้สีและหน้าตาปกติ',
  halloween: 'สีม่วงพลัม พร้อมผีน้อย ฟักทอง และค้างคาวเคลื่อนไหว',
};

export default function HomeThemeSettingsPage() {
  const [saved, setSaved] = useState<HomeThemeSetting | null>(null);
  const [selected, setSelected] = useState<HomeEvent>('default');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const apply = (value: HomeThemeSetting) => { setSaved(value); setSelected(value.event); };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setNotice('');
    authedApiFetch<HomeThemeSetting>(path, { cache: 'no-store', signal: controller.signal, suppressErrorToast: true })
      .then(value => { if (!controller.signal.aborted) { apply(value); setConflict(false); setForbidden(false); } })
      .catch(err => {
        if (controller.signal.aborted) return;
        const denied = (err as { status?: number }).status === 403;
        setForbidden(denied);
        setError(denied ? 'คุณไม่มีสิทธิ์เปลี่ยนธีมหน้าแรก ติดต่อผู้ดูแลระบบ' : apiErrorMessage(err));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const save = async () => {
    if (!saved || saving || conflict || forbidden) return;
    setSaving(true); setError(null); setNotice('');
    try {
      const body: SetHomeTheme = { event: selected, expectedVersion: saved.version };
      apply(await authedApiFetch<HomeThemeSetting>(path, { method: 'PUT', body: JSON.stringify(body), suppressErrorToast: true }));
      setNotice('บันทึกธีมแล้ว ผู้เข้าชมจะเห็นเมื่อเปิดหรือโหลดหน้าแรกใหม่');
    } catch (err) {
      const stale = (err as { status?: number }).status === 409;
      const denied = (err as { status?: number }).status === 403;
      setConflict(stale); setForbidden(denied);
      setError(stale ? 'มีผู้ดูแลเปลี่ยนธีมแล้ว โหลดค่าล่าสุดก่อนเลือกและบันทึกอีกครั้ง'
        : denied ? 'คุณไม่มีสิทธิ์เปลี่ยนธีมหน้าแรก ติดต่อผู้ดูแลระบบ' : apiErrorMessage(err));
    } finally { setSaving(false); }
  };

  return <main className="mangmee-content">
    <PageHeader title="ธีมหน้าแรก" description="เลือกธีมแล้วบันทึก มีผลเฉพาะหน้าแรกของเว็บไซต์ เนื้อหาและหน้าใช้งานอื่นคงเดิม"
      actions={<a href="/" target="_blank" rel="noopener noreferrer" className="mangmee-btn mangmee-btn-secondary">เปิดหน้าแรก</a>} />
    {loading ? <p role="status" className="py-8 text-gray-600">กำลังโหลดการตั้งค่า…</p> : <>
      {error && <div role="alert" className="mb-4 space-y-3 text-red-700">
        <p>{error}</p>
        {!forbidden && <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={saving} onClick={() => setReload(value => value + 1)}>
          {conflict ? 'โหลดค่าล่าสุด' : 'ลองโหลดใหม่'}
        </button>}
      </div>}
      {saved && !forbidden && <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={saving || conflict} className="space-y-4">
          <legend className="mb-3 font-semibold text-gray-900">เลือกธีมที่ต้องการแสดง</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(HOME_EVENTS).map(([id, title]) => <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-5 ${selected === id ? 'border-brand-600 bg-brand-50' : 'border-gray-200 bg-white'}`}>
              <input type="radio" name="home-theme" value={id} checked={selected === id} onChange={() => { setSelected(id as HomeEvent); setNotice(''); }} className="mt-1 h-5 w-5 accent-brand-700" />
              <span className="min-w-0"><span className="block font-semibold text-gray-900">{title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-gray-600">{descriptions[id as HomeEvent]}</span>
              </span>
            </label>)}
          </div>
        </fieldset>
        <p className="my-4 text-sm text-gray-600">กำลังแสดง: {HOME_EVENTS[saved.event]} · เปลี่ยนตัวเลือกแล้วกดบันทึกเพื่อเริ่มใช้</p>
        <FormActionBar summary={conflict ? 'โหลดค่าล่าสุดก่อนบันทึก' : notice
          ? <p role="status" className="text-brand-800">{notice}</p>
          : 'หน้าที่เปิดค้างอยู่ต้องโหลดใหม่เพื่อเห็นธีมล่าสุด'}>
          <ActionGroup>
            <button type="submit" disabled={saving || conflict} aria-busy={saving} className="mangmee-btn mangmee-btn-primary">
              {saving ? 'กำลังบันทึก…' : 'บันทึกธีม'}
            </button>
          </ActionGroup>
        </FormActionBar>
      </form>}
    </>}
  </main>;
}
