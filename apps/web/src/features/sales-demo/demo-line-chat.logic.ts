import { authedApiFetch } from '@/common/api/authed-fetch';

export const DEMO_QUICK_REPLIES = [
  'ส่งรูปใบเสร็จ', 'เดือนนี้จ่ายไปเท่าไหร่', 'ขอเบิกค่าน้ำมัน 500 บาท',
  'มีอะไรรออนุมัติบ้าง', 'ออก 50 ทวิ ให้ช่างแอร์',
];
export const DEMO_GREETING = 'สวัสดีค่ะ น้องมั่งมีเองนะคะ ลองถามเรื่องรายจ่ายของร้าน หรือส่งรูปใบเสร็จให้น้องอ่านได้เลยค่ะ';
export const DEMO_RATE_LIMIT = 'ส่งถี่เกินไปค่ะ รอสักครู่แล้วลองใหม่นะคะ';
export type DemoAction =
  | { type: 'message'; label: string; text: string }
  | { type: 'postback'; label: string; data: string; displayText?: string }
  | { type: 'uri'; label: string; uri: string }
  | { type: 'camera' | 'cameraRoll'; label?: string };
type QuickReply = { items: { action: DemoAction }[] };
export type DemoMessage =
  | { type: 'text'; text: string; quickReply?: QuickReply }
  | { type: 'image'; originalContentUrl?: string; previewImageUrl?: string; fileName?: string }
  | { type: 'flex'; altText: string; canonicalText?: string; contents: unknown; quickReply?: QuickReply }
  | { type: 'file'; fileName: string };
export type DemoChatItem = { id: string; direction: 'in' | 'out'; createdAt: string; messages: DemoMessage[] };
export type DemoChatPage = {
  items: DemoChatItem[]; cursor: string | null; waiting: boolean;
  credit: { remaining: number; total: number }; reads: { used: number; limit: number };
};
export type DemoSend = { text: string } | { postbackData: string; displayText?: string } | File;
export type PendingDemoMessage = {
  localId: string; serverId?: string; createdAt: string; payload: DemoSend; text: string;
  status: 'sending' | 'sent' | 'failed';
};
const basePath = (companyId: string) => `/v1/companies/${encodeURIComponent(companyId)}/demo-chat`;

export function loadDemoMessages(companyId: string, after?: string | null, signal?: AbortSignal): Promise<DemoChatPage> {
  return authedApiFetch(`${basePath(companyId)}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`, { signal, suppressErrorToast: true });
}

export function sendDemoMessage(companyId: string, payload: DemoSend): Promise<{ id: string }> {
  const file = payload instanceof File;
  const body = file ? new FormData() : JSON.stringify(payload);
  if (body instanceof FormData) body.append('file', payload as File);
  return authedApiFetch(`${basePath(companyId)}/${file ? 'files' : 'messages'}`, { method: 'POST', body, suppressErrorToast: true });
}

export function mergeDemoItems(current: DemoChatItem[], incoming: DemoChatItem[]): DemoChatItem[] {
  const items = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function reconcileDemoPending(pending: PendingDemoMessage[], items: DemoChatItem[]) {
  const ids = new Set(items.filter(item => item.direction === 'in').map(item => item.id));
  return pending.filter(item => !item.serverId || !ids.has(item.serverId));
}

export function demoPollDelay(waiting: boolean, lastSend: number, now = Date.now()) {
  return waiting || now - lastSend < 60_000 ? 1500 : 10_000;
}

/** Each open starts with history, then one cursor request at a time; closing aborts the read. */
export function pollDemoChat(
  companyId: string, onPage: (page: DemoChatPage) => void, onError: (error: unknown) => void,
  lastSend: { current: number },
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cursor: string | null | undefined;
  let waiting = false;
  let inFlight = false;
  let refreshRequested = false;
  let expired = false;
  async function read() {
    inFlight = true;
    try {
      const page = await loadDemoMessages(companyId, cursor, controller.signal);
      if (controller.signal.aborted) return;
      cursor = page.cursor;
      waiting = page.waiting;
      onPage(page);
    } catch (error) {
      if (controller.signal.aborted) return;
      expired = (error as { status?: number })?.status === 410;
      onError(error);
    } finally {
      inFlight = false;
      if (!controller.signal.aborted && !expired) {
        timer = setTimeout(() => void read(), refreshRequested ? 0 : demoPollDelay(waiting, lastSend.current));
        refreshRequested = false;
      }
    }
  }
  void read();
  return {
    stop() { controller.abort(); clearTimeout(timer); },
    wake() {
      if (controller.signal.aborted || expired) return;
      clearTimeout(timer);
      if (inFlight) refreshRequested = true;
      else void read();
    },
  };
}

export function latestDemoActions(items: DemoChatItem[]): DemoAction[] {
  const latest = items.findLast(item => item.direction === 'out');
  return latest?.messages.flatMap(message => 'quickReply' in message ? message.quickReply?.items.map(item => item.action) ?? [] : []) ?? [];
}

export function demoFileError(file: File): string | null {
  const supported = /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(file.type)
    || (!file.type && /\.(jpe?g|png|webp|heic|pdf)$/i.test(file.name));
  if (!supported) return 'เลือกไฟล์รูป JPG, PNG, WebP, HEIC หรือ PDF';
  return file.size > 10 * 1024 * 1024 ? 'ไฟล์ใหญ่เกิน 10 MB เลือกไฟล์ที่เล็กลง' : null;
}

export function demoSendBlocked(busy: boolean, expired: boolean, remaining?: number) {
  return busy || expired || remaining === 0;
}

export function safeDemoUrl(uri: string, origin: string): URL | null {
  try {
    const url = new URL(uri, origin);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

export function handleDemoAction(action: DemoAction, handlers: {
  send: (payload: DemoSend) => void; pickFile: () => void; navigate: (href: string) => void;
  external: (href: string) => void; origin: string;
}) {
  switch (action.type) {
    case 'message': handlers.send({ text: action.text }); break;
    case 'postback': handlers.send({ postbackData: action.data, displayText: action.displayText ?? action.label }); break;
    case 'camera': case 'cameraRoll': handlers.pickFile(); break;
    case 'uri': {
      const url = safeDemoUrl(action.uri, handlers.origin);
      if (!url) return;
      // A real LINE message sends a shop page through the LIFF start page (`liff.line.me/<id>/start?to=<path>`),
      // which needs LINE Login. The demo visitor is already signed in here, so open the page itself.
      const to = url.hostname === 'liff.line.me' && /^\/[^/]+\/start$/.test(url.pathname) ? url.searchParams.get('to') : null;
      if (to?.startsWith('/companies/')) { handlers.navigate(to); break; }
      // LINE's "leave the in-app browser" flag means nothing on the web page the demo runs in.
      url.searchParams.delete('openExternalBrowser');
      if (url.origin === handlers.origin) handlers.navigate(`${url.pathname}${url.search}${url.hash}`);
      else handlers.external(url.href);
    }
  }
}
