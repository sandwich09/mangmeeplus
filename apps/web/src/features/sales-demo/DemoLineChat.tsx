'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useBodyScrollLock } from '@/common/hooks/use-body-scroll-lock';
import { useDialogFocus } from '@/common/hooks/use-dialog-focus';
import { emitToast } from '@/common/feedback/toast-bus';
import { HOME_CONTACT_URL } from '@/features/public-home/home-content';
import {
  DEMO_GREETING, DEMO_QUICK_REPLIES, DEMO_RATE_LIMIT, demoFileError, demoSendBlocked,
  handleDemoAction, latestDemoActions, mergeDemoItems, pollDemoChat, reconcileDemoPending, safeDemoUrl, sendDemoMessage,
  type DemoAction, type DemoChatItem, type DemoChatPage, type DemoMessage, type DemoSend, type PendingDemoMessage,
} from './demo-line-chat.logic';
import { DemoFlexMessage } from './DemoFlexMessage';
import './demo-line-chat.css';

// The mascot cut-out, cropped to her face inside a round LINE-style avatar.
function Avatar() {
  return <span className="demo-chat-avatar"><img src="/assets/line/system-card-mascot-general-20261005.png" alt="มั่งมี" /></span>;
}
function fileChip(name: string) {
  return <p className="demo-chat-file">{/\.pdf$/i.test(name) ? '📄' : '📷'} {name}</p>;
}
function ChatMessage({ message, onAction, disabled, previews }: { message: DemoMessage; onAction: (action: DemoAction) => void; disabled: boolean; previews: Map<string, string> }) {
  if (message.type === 'flex') return <DemoFlexMessage message={message} onAction={onAction} disabled={disabled} />;
  if (message.type === 'image') {
    const local = message.fileName ? previews.get(message.fileName) : undefined;
    const remote = message.previewImageUrl ?? message.originalContentUrl;
    const preview = local ?? (remote ? safeDemoUrl(remote, 'https://mangmeeplus.com')?.href : undefined);
    if (preview) return <img className="demo-chat-image" src={preview} alt={message.fileName ?? 'รูปในบทสนทนา'} loading="lazy" />;
    return message.fileName ? fileChip(message.fileName) : null;
  }
  if (message.type === 'file') return previews.has(message.fileName) && !/\.pdf$/i.test(message.fileName)
    ? <img className="demo-chat-image" src={previews.get(message.fileName)} alt={message.fileName} /> : fileChip(message.fileName);
  return <p className="demo-chat-text">{message.text}</p>;
}

export function DemoLineChat({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(true);
  const [items, setItems] = useState<DemoChatItem[]>([]);
  const [pending, setPending] = useState<PendingDemoMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<DemoChatPage | null>(null);
  const [expired, setExpired] = useState(false);
  const [readLimit, setReadLimit] = useState(false);
  const [text, setText] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<DemoChatItem[]>([]);
  const lastSend = useRef(-Infinity);
  const poll = useRef<ReturnType<typeof pollDemoChat> | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const swipeStart = useRef<number | null>(null);
  // Files sent from this browser keep a local preview; history from another visit shows a file chip.
  const previews = useRef(new Map<string, string>());
  useBodyScrollLock(open && !wide);
  useDialogFocus(open && !wide, windowRef);
  const blocked = demoSendBlocked(busy, expired, page?.credit.remaining);
  const readsReached = readLimit || !!page && page.reads.used >= page.reads.limit;

  useEffect(() => {
    mounted.current = true;
    setReady(true);
    const media = window.matchMedia('(min-width: 768px)');
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener('change', sync);
    const urls = previews.current;
    return () => {
      mounted.current = false; media.removeEventListener('change', sync);
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  function handleError(error: unknown) {
    const failure = error as { status?: number; code?: string };
    if (failure?.status === 410) { setExpired(true); poll.current?.stop(); }
    else if (failure?.status === 403 && failure.code === 'demo_read_limit_reached') setReadLimit(true);
    else if (failure?.status === 429) emitToast({ tone: 'warning', message: DEMO_RATE_LIMIT });
    else return false;
    return true;
  }

  useEffect(() => {
    if (!open || expired) return;
    poll.current = pollDemoChat(companyId, result => {
      itemsRef.current = mergeDemoItems(itemsRef.current, result.items);
      setItems(itemsRef.current);
      setPending(current => reconcileDemoPending(current, itemsRef.current));
      setPage(result);
      setLoadError(false);
    }, error => { if (!handleError(error)) setLoadError(true); }, lastSend);
    return () => { poll.current?.stop(); poll.current = null; };
  }, [open, companyId, expired]);

  // Follow new messages only while the reader is at the bottom (or just sent one): polling
  // returns the same history every few seconds and must not pull a reader who scrolled up.
  const atBottom = useRef(true);
  const followNext = useRef(false);
  const shown = `${items.length}:${pending.length}:${page?.waiting === true}`;
  useEffect(() => {
    const box = scrollRef.current;
    if (!open || !box || !(atBottom.current || followNext.current)) return;
    followNext.current = false;
    box.scrollTop = box.scrollHeight;
  }, [shown, open]);

  useEffect(() => {
    if (!open || wide || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const resize = () => {
      windowRef.current?.style.setProperty('--demo-chat-viewport-height', `${viewport.height}px`);
      windowRef.current?.style.setProperty('--demo-chat-keyboard-bottom', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    };
    resize();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    return () => { viewport.removeEventListener('resize', resize); viewport.removeEventListener('scroll', resize); };
  }, [open, wide]);

  async function send(payload: DemoSend, retry?: PendingDemoMessage) {
    followNext.current = true;
    if (sending.current || blocked) return;
    if (payload instanceof File) {
      if (readsReached) return;
      const error = demoFileError(payload);
      setFileError(error);
      if (error) return;
      if (!previews.current.has(payload.name) && payload.type.startsWith('image/') && typeof URL.createObjectURL === 'function') {
        previews.current.set(payload.name, URL.createObjectURL(payload));
      }
    } else if ('text' in payload && (!payload.text.trim() || payload.text.length > 1000)) return;
    sending.current = true;
    setBusy(true);
    const optimistic: PendingDemoMessage = retry ?? {
      localId: crypto.randomUUID(), createdAt: new Date().toISOString(), payload,
      text: payload instanceof File ? payload.name : 'text' in payload ? payload.text : payload.displayText ?? 'ส่งคำตอบ',
      status: 'sending',
    };
    setPending(current => retry ? current.map(item => item.localId === retry.localId ? { ...item, status: 'sending' } : item) : [...current, optimistic]);
    lastSend.current = Date.now();
    poll.current?.wake();
    try {
      const result = await sendDemoMessage(companyId, payload);
      if (!mounted.current) return;
      setPending(current => reconcileDemoPending(current.map(item => item.localId === optimistic.localId ? { ...item, serverId: result.id, status: 'sent' } : item), itemsRef.current));
      setPage(current => current ? { ...current, waiting: true } : current);
    } catch (error) {
      if (!mounted.current) return;
      handleError(error);
      setPending(current => current.map(item => item.localId === optimistic.localId ? { ...item, status: 'failed' } : item));
    } finally {
      sending.current = false;
      if (mounted.current) { setBusy(false); poll.current?.wake(); }
    }
  }

  function navigate(href: string) {
    router.push(href);
    if (!wide) setOpen(false);
  }
  function action(action: DemoAction) {
    handleDemoAction(action, {
      send: payload => { void send(payload); },
      pickFile: () => { if (!blocked && !readsReached) fileRef.current?.click(); },
      navigate, external: href => { window.open(href, '_blank', 'noopener,noreferrer'); }, origin: window.location.origin,
    });
  }
  function submitText() {
    if (blocked || !text.trim() || text.length > 1000) return;
    void send({ text: text.trim() });
    setText('');
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (wide || event.key !== 'Tab') return;
    const controls = windowRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],textarea:not([disabled]),[tabindex="0"]');
    const first = controls?.[0], last = controls?.[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === windowRef.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const firstMessage = items.length > 0 || pending.length > 0;
  const actions: DemoAction[] = firstMessage ? latestDemoActions(items) : DEMO_QUICK_REPLIES.map(label => ({ type: 'message', label, text: label }));
  const conversation = [
    ...items.map(item => ({ ...item, pending: undefined as PendingDemoMessage | undefined })),
    ...pending.map(item => ({ id: item.localId, createdAt: item.createdAt, direction: 'in' as const, messages: [item.payload instanceof File ? { type: 'image' as const, fileName: item.payload.name } : { type: 'text' as const, text: item.text }] as DemoMessage[], pending: item })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!ready) return null;
  return createPortal(<>
    {!open && <button type="button" className="mangmee-btn mangmee-btn-primary demo-chat-launcher" aria-label="แชท LINE (จำลอง)" title="แชท LINE (จำลอง)" aria-expanded={false} aria-controls="demo-line-chat" onClick={() => { atBottom.current = true; setOpen(true); setUnread(false); }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 4 3.6 7.3 8.3 7.9L10 22l5-3.6c4.1-1 7-3.8 7-7.4 0-4.4-4.5-8-10-8Z" /></svg>
      <span className="demo-chat-launcher-label">แชท LINE (จำลอง)</span>
      {unread && <span className="demo-chat-unread" aria-label="มีข้อความใหม่" />}
    </button>}
    {open && <>
      {!wide && <div className="demo-chat-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <div id="demo-line-chat" className="demo-chat-window" ref={windowRef} role={wide ? 'region' : 'dialog'} aria-modal={!wide || undefined} aria-label="แชท LINE จำลองกับมั่งมี Plus" tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="demo-chat-header" onTouchStart={event => { swipeStart.current = event.touches[0].clientY; }} onTouchEnd={event => {
          if (!wide && swipeStart.current !== null && event.changedTouches[0].clientY - swipeStart.current > 60) setOpen(false);
          swipeStart.current = null;
        }}>
          <div className="demo-chat-heading"><div><strong>มั่งมี Plus</strong><span className="demo-chat-pill">แชทจำลอง</span></div>
            <p className="demo-chat-credit">{page ? `เครดิต ${page.credit.remaining}/${page.credit.total} · อ่านเอกสาร ${readsReached ? Math.max(3, page.reads.used) : page.reads.used}/3` : 'กำลังโหลดเครดิต…'}</p>
          </div>
          <button type="button" className="mangmee-btn mangmee-btn-quiet demo-chat-icon" aria-label="ย่อแชทจำลอง" onClick={() => setOpen(false)}>—</button>
          <button type="button" className="mangmee-btn mangmee-btn-quiet demo-chat-icon" aria-label="ปิดแชทจำลอง" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="demo-chat-messages" ref={scrollRef} onScroll={event => { const box = event.currentTarget; atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80; }} role="log" aria-label="บทสนทนาจำลอง" aria-live="polite" aria-relevant="additions">
          {!page && !loadError && <p role="status">กำลังโหลดบทสนทนา…</p>}
          {page && !firstMessage && <div className="demo-chat-assistant"><Avatar /><p className="demo-chat-text">{DEMO_GREETING}</p></div>}
          {conversation.map(item => <div key={item.id} className={item.direction === 'in' ? 'demo-chat-customer' : 'demo-chat-assistant'}>
            {item.direction === 'out' && <Avatar />}
            <div className="demo-chat-message-body">{item.messages.map((message, index) => <ChatMessage key={index} message={message} onAction={action} disabled={blocked} previews={previews.current} />)}
              {item.pending?.status === 'failed' && <button type="button" className="mangmee-btn mangmee-btn-quiet demo-chat-retry" disabled={blocked || readsReached && item.pending.payload instanceof File} onClick={() => void send(item.pending!.payload, item.pending)}>ส่งไม่สำเร็จ แตะเพื่อส่งอีกครั้ง</button>}
              {item.pending?.status === 'sending' && <span className="demo-chat-send-status" role="status">กำลังส่ง…</span>}
            </div>
          </div>)}
          {page?.waiting && <div className="demo-chat-assistant"><Avatar /><p className="demo-chat-typing" role="status" aria-label="น้องมั่งมีกำลังพิมพ์"><span aria-hidden="true">● ● ●</span></p></div>}
        </div>
        <footer className="demo-chat-footer">
          {expired ? <div className="demo-chat-expired"><p>ลิงก์เดโม่นี้หมดอายุแล้วค่ะ</p><a className="mangmee-btn mangmee-btn-secondary" href={HOME_CONTACT_URL} target="_blank" rel="noopener noreferrer">คุยกับทีมดูแล</a></div> : <>
            {loadError && <div className="demo-chat-notice" role="alert"><span>โหลดแชทไม่สำเร็จ ลองอีกครั้ง</span><button className="mangmee-btn mangmee-btn-quiet" type="button" onClick={() => poll.current?.wake()}>ลองอีกครั้ง</button></div>}
            {(page?.credit.remaining === 0 || readsReached) && <div className="demo-chat-notice" role="status"><span>{page?.credit.remaining === 0 ? 'เครดิตทดลองหมดแล้ว' : 'อ่านเอกสารครบ 3 ใบแล้ว'}</span><button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => navigate('/')}>เปิดร้านจริงฟรี</button></div>}
            {fileError && <p role="alert" className="demo-chat-file-error">{fileError}</p>}
            {actions.length > 0 && <div className="demo-chat-replies" aria-label="คำถามลัด" aria-busy={busy}>{actions.map((item, index) => <button key={index} type="button" className="mangmee-btn mangmee-btn-secondary" disabled={item.type !== 'uri' && (blocked || readsReached && ['camera', 'cameraRoll'].includes(item.type))} onClick={() => action(item)}>{item.label ?? 'แนบรูป'}</button>)}</div>}
            <div className="demo-chat-input-bar" aria-busy={busy}>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void send(file); }} />
              <button type="button" className="mangmee-btn mangmee-btn-quiet demo-chat-icon" aria-label="แนบรูปหรือ PDF" disabled={blocked || readsReached} onClick={() => fileRef.current?.click()}>＋</button>
              <textarea aria-label="พิมพ์ข้อความ" placeholder="พิมพ์ข้อความ" rows={1} maxLength={1000} value={text} disabled={expired || page?.credit.remaining === 0} onChange={event => setText(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitText(); }
              }} />
              <button type="button" className="mangmee-btn mangmee-btn-primary demo-chat-send" disabled={blocked || !text.trim()} aria-busy={busy} onClick={submitText}>ส่ง</button>
            </div>
          </>}
        </footer>
      </div>
    </>}
  </>, document.body);
}
