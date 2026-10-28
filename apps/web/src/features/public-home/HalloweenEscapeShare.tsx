'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { copyText, supportsFileShare, type PreparedHalloweenImage } from './home-halloween-share';
import { escapeCaption, prepareEscapeShareImage } from './home-halloween-escape-share';

type ShareState = { kind: 'sharing' | 'done' | 'cancelled' | 'failed'; message: string };

export function HalloweenEscapeShare({ escaped, secondsLeft }: { escaped: boolean; secondsLeft: number }) {
  const [prepared, setPrepared] = useState<PreparedHalloweenImage | null>(null);
  const [error, setError] = useState('');
  const [state, setState] = useState<ShareState | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const copyField = useRef<HTMLTextAreaElement>(null);
  const sharing = useRef(false);
  const caption = useMemo(() => escapeCaption(escaped, secondsLeft), [escaped, secondsLeft]);
  const nativeShare = prepared ? supportsFileShare(prepared.file) : false;

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    let image: PreparedHalloweenImage | undefined;
    setPrepared(null); setError(''); setState(null); setManualCopy(false); sharing.current = false;
    void prepareEscapeShareImage(escaped, secondsLeft).then(result => {
      if (active) { image = result; setPrepared(result); }
      else URL.revokeObjectURL(result.url);
    }).catch(() => { if (active) setError('เตรียมภาพไม่ได้ ลองอีกครั้ง'); });
    return () => { active = false; if (generation.current === current) generation.current++; if (image) URL.revokeObjectURL(image.url); };
  }, [escaped, secondsLeft, attempt]);

  function download(forApp?: string) {
    if (!prepared) return;
    const anchor = document.createElement('a');
    anchor.href = prepared.url; anchor.download = prepared.name; anchor.click();
    setState({ kind: 'done', message: forApp ? `บันทึกภาพแล้ว เลือกภาพนี้ใน ${forApp}` : 'เริ่มดาวน์โหลดภาพแล้ว' });
  }

  function copyCaption() {
    const current = generation.current;
    void copyText(caption).then(copied => {
      if (generation.current !== current) return;
      setManualCopy(!copied);
      setState({ kind: copied ? 'done' : 'failed', message: copied ? 'คัดลอกข้อความและลิงก์แล้ว' : 'เลือกข้อความด้านล่างแล้วคัดลอก' });
      if (!copied) requestAnimationFrame(() => { copyField.current?.focus(); copyField.current?.select(); });
    });
  }

  function share(forApp?: string) {
    if (!prepared || sharing.current) return;
    if (!nativeShare) { copyCaption(); return download(forApp); }
    sharing.current = true;
    const current = generation.current;
    let pending: Promise<void>;
    try {
      pending = navigator.share({ files: [prepared.file], title: 'คฤหาสน์ไร้ทางออก', text: caption, url: 'https://mangmeeplus.com/halloween' });
      setState({ kind: 'sharing', message: forApp ? `เลือก ${forApp} จากเมนูแชร์` : 'เลือกแอปที่ต้องการแชร์' });
    } catch { sharing.current = false; return download(forApp); }
    void pending.then(() => {
      if (generation.current === current) setState({ kind: 'done', message: 'ส่งภาพไปยังแอปที่เลือกแล้ว ตรวจสอบก่อนโพสต์' });
    }).catch(reason => {
      if (generation.current !== current) return;
      if (reason instanceof DOMException && reason.name === 'AbortError') setState({ kind: 'cancelled', message: 'ปิดเมนูแชร์แล้ว ภาพยังอยู่ที่เดิม' });
      else { copyCaption(); download(forApp); }
    }).finally(() => { if (generation.current === current) sharing.current = false; });
  }

  return <section className="home-halloween-share" data-halloween-share aria-label="แชร์ผลการหนีคฤหาสน์">
    <div className="home-halloween-share-actions">
      <button className="home-halloween-share-primary" type="button" onClick={() => share()} disabled={!prepared || state?.kind === 'sharing'} aria-busy={!prepared && !error || state?.kind === 'sharing'}>
        {!prepared ? error ? 'เตรียมภาพไม่ได้' : 'กำลังเตรียมภาพ…' : state?.kind === 'sharing' ? 'กำลังเปิดเมนูแชร์…' : nativeShare ? 'แชร์ภาพ' : 'บันทึกภาพเพื่อแชร์'}
      </button>
      <button type="button" onClick={() => download()} disabled={!prepared}>บันทึกภาพ</button>
      <button type="button" onClick={copyCaption}>คัดลอกข้อความและลิงก์</button>
    </div>
    <div className="home-halloween-share-platforms" aria-label="เลือกแอปแชร์">
      {['Facebook', 'Instagram', 'TikTok'].map(app => <button key={app} type="button" onClick={() => share(app)} disabled={!prepared || state?.kind === 'sharing'} aria-label={`แชร์ภาพด้วย ${app}`} title={`แชร์ภาพด้วย ${app}`}><img src={`/home/${app.toLowerCase()}.webp`} alt="" /></button>)}
    </div>
    {error && <div className="home-halloween-share-preparation-error"><p className="home-halloween-share-status is-failed" role="status">{error}</p><button className="home-halloween-share-retry" type="button" onClick={() => setAttempt(value => value + 1)}>ลองอีกครั้ง</button></div>}
    {state && <p className={`home-halloween-share-status is-${state.kind}`} role="status" aria-live="polite">{state.message}</p>}
    {manualCopy && <label className="home-halloween-share-manual">ข้อความสำหรับคัดลอก<textarea ref={copyField} readOnly value={caption} onFocus={event => event.currentTarget.select()} /></label>}
  </section>;
}
