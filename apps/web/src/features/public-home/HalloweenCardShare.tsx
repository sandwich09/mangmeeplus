'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GhostCard } from './home-halloween-cards';
import { HALLOWEEN_HOME_URL } from './home-halloween-cards';
import { copyText, halloweenCaption, prepareHalloweenImage, supportsFileShare, type PreparedHalloweenImage } from './home-halloween-share';

type ShareState = { kind: 'sharing' | 'done' | 'cancelled' | 'failed' | 'share-failed'; message: string };

export function HalloweenCardShare({ card }: { card: GhostCard }) {
  const [preparedImages, setPrepared] = useState<PreparedHalloweenImage | null>(null);
  const prepared = preparedImages?.cardId === card.id ? preparedImages : null;
  const [preparationError, setPreparationError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ShareState | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const generation = useRef(0);
  const copyField = useRef<HTMLTextAreaElement>(null);
  const sharing = useRef(false);
  const failedShareTarget = useRef<string | undefined>(undefined);
  const caption = useMemo(() => halloweenCaption(card), [card]);
  const supportsShare = prepared ? supportsFileShare(prepared.file) : false;

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    sharing.current = false;
    failedShareTarget.current = undefined;
    setManualCopy(false);
    setCopyStatus('');
    let image: PreparedHalloweenImage | undefined;
    setPrepared(null);
    setPreparationError('');
    setState(null);
    void prepareHalloweenImage(card).then(result => {
      if (active) { image = result; setPrepared(result); }
      else URL.revokeObjectURL(result.url);
    }).catch(() => {
      if (active) setPreparationError('เตรียมภาพไม่ได้ ลองอีกครั้ง');
    });
    return () => { active = false; if (generation.current === current) generation.current++; if (image) URL.revokeObjectURL(image.url); };
  }, [card, attempt]);

  function retryPreparation() {
    setState(null);
    setAttempt(value => value + 1);
  }

  function saveOriginalImage() {
    const anchor = document.createElement('a');
    anchor.href = card.image;
    anchor.download = `mangmee-${card.id}.png`;
    anchor.click();
    setState({ kind: 'done', message: 'เริ่มดาวน์โหลดภาพการ์ดแล้ว' });
  }

  function downloadPreparedImage(forApp?: string) {
    if (!prepared) return;
    const anchor = document.createElement('a');
    anchor.href = prepared.url;
    anchor.download = prepared.name;
    anchor.click();
    setState({ kind: 'done', message: forApp ? `เริ่มดาวน์โหลดแล้ว เพิ่มภาพนี้ใน ${forApp}` : 'เริ่มดาวน์โหลดภาพแล้ว แชร์จากแอปที่ต้องการ' });
    failedShareTarget.current = undefined;
  }

  function prepareCaptionCopy() {
    const current = generation.current;
    setCopyStatus('');
    void copyText(caption).then(copied => {
      if (generation.current !== current) return;
      setManualCopy(!copied);
      setCopyStatus(copied ? 'คัดลอกข้อความและลิงก์แล้ว วางในแอปที่เลือกได้' : 'คัดลอกข้อความอัตโนมัติไม่ได้ เลือกข้อความด้านล่างแล้วคัดลอก');
    });
  }

  async function share(forApp?: string, downloadOnly = false) {
    if (!prepared || sharing.current) return;
    const current = generation.current;
    prepareCaptionCopy();
    if (!supportsShare || downloadOnly) return downloadPreparedImage(forApp);
    sharing.current = true;
    failedShareTarget.current = undefined;
    try {
      // Call in this click handler before awaiting, while user activation is available.
      const pending = navigator.share({ files: [prepared.file], title: `การ์ดของ${card.name}`, text: caption, url: HALLOWEEN_HOME_URL });
      setState({ kind: 'sharing', message: forApp ? `เลือก ${forApp} จากเมนูแชร์` : 'เลือกแอปที่ต้องการแชร์' });
      await pending;
      if (generation.current !== current) return;
      setState({ kind: 'done', message: 'ส่งภาพไปยังแอปที่เลือกแล้ว ตรวจสอบก่อนโพสต์' });
    } catch (error) {
      if (generation.current !== current) return;
      if (error instanceof DOMException && error.name === 'AbortError') setState({ kind: 'cancelled', message: 'ปิดเมนูแชร์แล้ว การ์ดยังอยู่ที่เดิม' });
      else {
        failedShareTarget.current = forApp;
        setState({ kind: 'share-failed', message: forApp ? `แชร์ไม่สำเร็จ กดบันทึกภาพเพื่อแชร์ แล้วเลือกภาพใน ${forApp}` : 'แชร์ไม่สำเร็จ กดบันทึกภาพเพื่อแชร์ แล้วเลือกแอปที่ต้องการ' });
      }
    } finally { if (generation.current === current) sharing.current = false; }
  }

  async function copyCaption() {
    const current = generation.current;
    const copied = await copyText(caption);
    if (generation.current !== current) return;
    setCopyStatus('');
    if (copied) {
      setManualCopy(false);
      setState({ kind: 'done', message: 'คัดลอกข้อความและลิงก์แล้ว' });
    } else {
      setManualCopy(true);
      setState({ kind: 'failed', message: 'เลือกข้อความด้านล่างแล้วคัดลอก' });
      requestAnimationFrame(() => { if (generation.current === current) { copyField.current?.focus(); copyField.current?.select(); } });
    }
  }

  return <section className="home-halloween-share" data-halloween-share aria-label="แชร์การ์ดฮาโลวีน">
    <div className="home-halloween-share-actions">
      <button className="home-halloween-share-primary" type="button" onClick={() => state?.kind === 'share-failed' ? share(failedShareTarget.current, true) : share()} disabled={!prepared || state?.kind === 'sharing'} aria-busy={!prepared && !preparationError || state?.kind === 'sharing'}>
        {!prepared ? preparationError ? 'เตรียมภาพไม่ได้' : 'กำลังเตรียมภาพ…' : state?.kind === 'sharing' ? 'กำลังเปิดเมนูแชร์…' : state?.kind === 'share-failed' || !supportsShare ? 'บันทึกภาพเพื่อแชร์' : 'แชร์ภาพ'}
      </button>
      <button type="button" onClick={saveOriginalImage}>บันทึกภาพ</button>
      <button type="button" onClick={copyCaption}>คัดลอกข้อความและลิงก์</button>
    </div>
    <div className="home-halloween-share-platforms" aria-label="เลือกแอปแชร์">
      <button type="button" onClick={() => share('Facebook')} disabled={!prepared || state?.kind === 'sharing'} aria-label="แชร์ภาพด้วย Facebook" title="แชร์ภาพด้วย Facebook"><img src="/home/facebook.webp" alt="" /></button>
      <button type="button" onClick={() => share('Instagram')} disabled={!prepared || state?.kind === 'sharing'} aria-label="แชร์ภาพด้วย Instagram" title="แชร์ภาพด้วย Instagram"><img src="/home/instagram.webp" alt="" /></button>
      <button type="button" onClick={() => share('TikTok')} disabled={!prepared || state?.kind === 'sharing'} aria-label="แชร์ภาพด้วย TikTok" title="แชร์ภาพด้วย TikTok"><img src="/home/tiktok.webp" alt="" /></button>
    </div>
    {preparationError ? <div className="home-halloween-share-preparation-error"><p className="home-halloween-share-status is-failed" role="status">{preparationError}</p><button className="home-halloween-share-retry" type="button" onClick={retryPreparation}>ลองอีกครั้ง</button></div>
      : !prepared ? <p className="home-halloween-share-status" role="status">กำลังเตรียมภาพสำหรับแชร์</p>
        : !supportsShare ? <p className="home-halloween-share-status">แชร์ภาพไม่ได้ในอุปกรณ์นี้ กดบันทึกภาพเพื่อแชร์ แล้วเลือกแอปที่ต้องการ</p>
          : null}
    {state && <p className={`home-halloween-share-status is-${state.kind}`} role="status" aria-live="polite">{state.message}</p>}
    {copyStatus && <p className="home-halloween-share-status" role="status" aria-live="polite">{copyStatus}</p>}
    {manualCopy && <label className="home-halloween-share-manual">ข้อความสำหรับคัดลอก<textarea ref={copyField} readOnly value={caption} onFocus={event => event.currentTarget.select()} /></label>}
  </section>;
}
