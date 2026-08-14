'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ForbiddenState } from '@/common/components/state';
import { MangmeeBranchChip, MangmeeCard, cx } from '@/common/components/mangmee';
import { createBroadcastDraft, generateBroadcast, listBroadcastCampaigns, listBroadcastChannels, previewBroadcast, sendBroadcast } from './broadcast.api';
import type { CrmCampaignPreview } from '@watchdog-bms/contracts';
import { broadcastBlockReason, type BroadcastCampaign, type BroadcastCandidate, type BroadcastColorId, type BroadcastPreflight, type BroadcastSegmentId, type BroadcastToneId } from './broadcast.model';
import { formatThaiDate } from '@/common/i18n/thai-date';

const tones: Array<{ id: BroadcastToneId; emoji: string; label: string }> = [
  { id: 'fun', emoji: '🎉', label: 'สนุก สดใส' }, { id: 'friendly', emoji: '😊', label: 'เป็นกันเอง' },
  { id: 'premium', emoji: '✨', label: 'พรีเมียม' }, { id: 'polite', emoji: '🙏', label: 'สุภาพ' },
  { id: 'concise', emoji: '⚡', label: 'สั้น กระชับ' },
];
const colors: Array<{ id: BroadcastColorId; label: string; gradient: string; fg: string }> = [
  { id: 'green', label: 'เขียว', gradient: 'linear-gradient(135deg,#064E3B,#10B981)', fg: '#fff' },
  { id: 'pink', label: 'ชมพู', gradient: 'linear-gradient(135deg,#BE185D,#F9A8D4)', fg: '#fff' },
  { id: 'gold', label: 'ทอง', gradient: 'linear-gradient(135deg,#92400E,#FBBF24)', fg: '#fff' },
  { id: 'pastel', label: 'พาสเทล', gradient: 'linear-gradient(135deg,#DDD6FE,#FBCFE8)', fg: '#4C1D95' },
  { id: 'dark', label: 'เข้ม', gradient: 'linear-gradient(135deg,#111827,#374151)', fg: '#fff' },
];
const statusLabel: Record<BroadcastCampaign['status'], string> = { DRAFT: 'ฉบับร่าง', READY: 'พร้อมส่ง', SCHEDULED: 'ตั้งเวลา', QUEUED: 'เข้าคิว', SENDING: 'กำลังส่ง', COMPLETED: 'ส่งแล้ว', PARTIAL: 'สำเร็จบางส่วน', FAILED: 'ล้มเหลว', CANCELLED: 'ยกเลิก' };

function errorText(error: unknown) { return apiErrorMessage(error); }
function audienceText(count?: number) { return count === undefined || count < 0 ? 'ตรวจตอนส่ง' : `${count.toLocaleString('th-TH')} คน`; }
function Card({ title, children }: { title: string; children: React.ReactNode }) { return <MangmeeCard className="px-5 py-5"><h2 className="text-sm font-bold text-gray-500">{title}</h2>{children}</MangmeeCard>; }

export function BroadcastPage({ companyId }: { companyId: string }) {
  const [workspace, setWorkspace] = useState<{ preflight: BroadcastPreflight; campaigns: BroadcastCampaign[] } | null>(null);
  const [loading, setLoading] = useState(true), [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState(''), [price, setPrice] = useState(''), [keyPoint, setKeyPoint] = useState('');
  const [tone, setTone] = useState<BroadcastToneId>('friendly'), [color, setColor] = useState<BroadcastColorId>('green');
  const [segmentId, setSegmentId] = useState<BroadcastSegmentId>('all'), [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<BroadcastCandidate[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false), [success, setSuccess] = useState<string | null>(null);
  const [pendingCampaignId, setPendingCampaignId] = useState<string | null>(null), [preview, setPreview] = useState<CrmCampaignPreview | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setForbidden(false);
    try {
      const [campaigns, channels] = await Promise.all([listBroadcastCampaigns(companyId), listBroadcastChannels(companyId)]);
      const channel = channels.find((item) => item.status !== 'DISABLED');
      setWorkspace({ preflight: { channelId: channel?.id, channelConnected: Boolean(channel), canCreate: true, canSend: true, quotaRemaining: Number.MAX_SAFE_INTEGER, segments: [
        { id: 'all', label: 'ลูกค้าทั้งหมด', description: 'ตรวจจำนวนจริงก่อนส่ง', count: -1 }, { id: 'vip', label: 'VIP', description: 'ลูกค้าระดับ VIP', count: -1 },
        { id: 'regular', label: 'ลูกค้าประจำ', description: 'ลูกค้าระดับประจำ', count: -1 }, { id: 'new', label: 'ลูกค้าใหม่', description: 'ลูกค้าใหม่และลูกค้ามุ่งหวัง', count: -1 },
      ] }, campaigns: campaigns.map((item) => ({ ...item, segmentLabel: 'กลุ่มผู้รับที่บันทึกไว้' })) });
    }
    // `authedApiFetch` throws a plain Error carrying `status`, never an `ApiError` — reading the
    // wrong shape meant this forbidden state never rendered.
    catch (e) { if ((e as { status?: number } | null)?.status === 403) setForbidden(true); else setError(errorText(e)); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);

  const segment = workspace?.preflight.segments.find((item) => item.id === segmentId) ?? workspace?.preflight.segments[0];
  const blockReason = useMemo(() => workspace ? broadcastBlockReason({ message, recipientCount: segment?.count ?? 0, channelConnected: workspace.preflight.channelConnected, canSend: workspace.preflight.canSend, quotaRemaining: workspace.preflight.quotaRemaining, busy }) : 'กำลังโหลดข้อมูล', [workspace, message, segment?.count, busy]);

  async function generate() {
    if (!topic.trim()) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const result = await generateBroadcast(companyId, { topic: topic.trim(), price: price.trim() || undefined, keyPoint: keyPoint.trim() || undefined, tone });
      if (result.status !== 'ok') throw new Error('AI ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง');
      setCandidates(result.candidates); setSelected(null);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  async function prepareSend() {
    if (blockReason || !workspace?.preflight.channelId || !segment) return;
    setBusy(true); setError(null);
    try {
      const draft = await createBroadcastDraft(companyId, { name: topic.trim() || message.slice(0, 60), channelId: workspace.preflight.channelId, segment: segment.id === 'all' ? {} : { tier: segment.id === 'vip' ? 'VIP' : segment.id === 'regular' ? 'REGULAR' : 'LEAD' }, messageText: message.trim(), imageUrl: candidates.find((item) => item.id === selected)?.imageUrl });
      const nextPreview = await previewBroadcast(companyId, draft.id);
      setPendingCampaignId(draft.id); setPreview(nextPreview); setConfirming(true);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function confirmSend() {
    if (!pendingCampaignId || !preview?.quotaSufficient) return;
    setBusy(true); setError(null);
    try {
      const sent = await sendBroadcast(companyId, pendingCampaignId);
      setSuccess(`รับรายการส่งแล้ว ${sent.recipientCount.toLocaleString('th-TH')} คน`); setConfirming(false); setMessage(''); setCandidates([]); await load();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  if (forbidden) return <ForbiddenState description="บัญชีของคุณไม่มีสิทธิ์ดูหรือส่งบรอดแคสต์" />;
  if (loading && !workspace) return <div className="mangmee-page"><div className="h-8 w-48 animate-pulse rounded bg-gray-200"/><div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="h-80 animate-pulse rounded-2xl bg-gray-100"/><div className="h-80 animate-pulse rounded-2xl bg-gray-100"/></div></div>;
  if (!workspace) return <div className="mangmee-page"><div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">{error}<button type="button" onClick={() => void load()} className="ml-3 font-bold underline">ลองใหม่</button></div></div>;

  const colorMeta = colors.find((item) => item.id === color)!;
  return <div className="mangmee-page">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-extrabold text-gray-900">บรอดแคสต์</h1><p className="mt-2 text-gray-500">สร้างข้อความและส่งผ่าน LINE OA ด้วยข้อมูลผู้รับจริง</p></div><MangmeeBranchChip /></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}<button type="button" onClick={() => setError(null)} className="float-right font-bold">×</button></div>}
    {success && <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">✓ {success}</div>}
    {!workspace.preflight.channelConnected && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">ยังไม่ได้เชื่อมต่อ LINE OA จึงบันทึกร่างได้แต่ยังส่งไม่ได้</div>}
    <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_1fr]">
      <div className="space-y-4">
        <Card title="1 · ข้อมูลหลัก"><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2 text-sm font-semibold">โปรโมชัน / หัวข้อ *<input className="mangmee-input mt-1" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="เช่น โปรต่อขนตา Volume ลด 20%" /></label><label className="text-sm font-semibold">ราคา / ส่วนลด<input className="mangmee-input mt-1" value={price} onChange={(e) => setPrice(e.target.value)} /></label><label className="text-sm font-semibold">จุดขายหลัก<input className="mangmee-input mt-1" value={keyPoint} onChange={(e) => setKeyPoint(e.target.value)} /></label></div></Card>
        <Card title="2 · เลือกโทนเนื้อหา"><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{tones.map((item) => <button type="button" key={item.id} onClick={() => setTone(item.id)} className={cx('rounded-xl border-2 p-3 text-center text-sm font-bold', tone === item.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200')}><span className="block text-xl">{item.emoji}</span>{item.label}</button>)}</div></Card>
        <Card title="3 · โทนสีโปสเตอร์"><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{colors.map((item) => <button type="button" aria-label={item.label} key={item.id} onClick={() => setColor(item.id)} className={cx('h-14 rounded-xl border-[3px]', color === item.id ? 'border-brand-600' : 'border-transparent')} style={{ background: item.gradient }} />)}</div></Card>
        <Card title="4 · กลุ่มผู้รับ"><div className="mt-3 grid gap-2 sm:grid-cols-2">{workspace.preflight.segments.map((item) => <button type="button" key={item.id} onClick={() => setSegmentId(item.id)} className={cx('rounded-xl border-2 p-3 text-left', segmentId === item.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200')}><b className="text-base text-brand-700">{audienceText(item.count)}</b><span className="ml-2 font-bold">{item.label}</span><span className="block text-xs text-gray-500">{item.description}</span></button>)}</div><div className="mt-3 text-xs text-gray-500">ระบบจะตรวจจำนวนผู้รับ, consent และโควตาจริงก่อนยืนยันส่ง</div></Card>
        <button type="button" onClick={() => void generate()} disabled={busy || !topic.trim()} className="rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300">{busy ? 'กำลังสร้าง...' : '✨ ให้ AI ช่วยสร้างเนื้อหา 3 แบบ'}</button>
      </div>
      <div className="space-y-4">
        <Card title="ตัวเลือกจาก AI / เขียนเอง">{candidates.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-violet-300 bg-violet-50 p-8 text-center text-sm text-violet-700">กรอกข้อมูลแล้วให้ AI สร้าง 3 ตัวเลือก หรือพิมพ์ข้อความเองด้านล่าง</div> : <div className="mt-3 space-y-3">{candidates.map((item) => <button type="button" key={item.id} onClick={() => { setSelected(item.id); setMessage(item.body); }} className={cx('w-full overflow-hidden rounded-xl border-2 text-left', selected === item.id ? 'border-brand-500' : 'border-gray-200')}><span className="flex min-h-28 items-center justify-center p-4 text-center text-lg font-extrabold" style={{ background: colorMeta.gradient, color: colorMeta.fg }}>{item.headline}</span><span className="block p-3 text-sm text-gray-700">{item.body}</span></button>)}</div>}</Card>
        <Card title="ข้อความที่จะส่ง"><textarea aria-label="ข้อความที่จะส่ง" className="mangmee-input mt-3 min-h-32 resize-y" value={message} onChange={(e) => { setMessage(e.target.value); setSelected(null); }} placeholder="พิมพ์ข้อความที่จะส่ง…" maxLength={5000}/><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-gray-500">ผู้รับ: <b className="text-brand-600">{audienceText(segment?.count)}</b></span><button type="button" disabled={Boolean(blockReason)} title={blockReason ?? undefined} onClick={() => void prepareSend()} className="rounded-xl bg-brand-500 px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300">{busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบก่อนส่ง'}</button></div>{blockReason && <p className="mt-2 text-right text-xs text-amber-700">{blockReason}</p>}</Card>
        <Card title="แคมเปญที่ผ่านมา">{workspace.campaigns.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-gray-300 p-7 text-center text-sm text-gray-400">ยังไม่มีแคมเปญ</div> : <div className="mt-3 divide-y divide-gray-100">{workspace.campaigns.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate font-semibold text-gray-800">{item.name}</p><p className="text-xs text-gray-400">{item.segmentLabel} · {formatThaiDate(item.createdAt)}</p></div><div className="text-right text-xs"><b>{item.recipientCount.toLocaleString('th-TH')} คน</b><p className="text-brand-600">{statusLabel[item.status]}</p></div></div>)}</div>}</Card>
      </div>
    </div>
    {confirming && preview && <div role="dialog" aria-modal="true" aria-labelledby="broadcast-confirm-title" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h2 id="broadcast-confirm-title" className="text-xl font-extrabold">ยืนยันส่งบรอดแคสต์?</h2><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p className="rounded-lg bg-green-50 p-3">ส่งได้ <b>{preview.eligibleCount.toLocaleString('th-TH')}</b> คน</p><p className="rounded-lg bg-gray-50 p-3">ตัด consent <b>{preview.excludedConsentCount.toLocaleString('th-TH')}</b></p><p className="rounded-lg bg-gray-50 p-3">ติดต่อไม่ได้ <b>{preview.excludedUnreachableCount.toLocaleString('th-TH')}</b></p><p className="rounded-lg bg-gray-50 p-3">โควตา <b>{preview.quotaRemaining?.toLocaleString('th-TH') ?? '—'}</b></p></div>{!preview.quotaSufficient && <p className="mt-3 text-sm font-semibold text-red-700">โควตา LINE OA ไม่เพียงพอ จึงยังส่งไม่ได้</p>}<p className="mt-3 text-sm text-gray-600">เมื่อยืนยัน ระบบจะนำรายการเข้าคิว LINE OA และไม่สามารถย้อนกลับได้</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-xl border border-gray-300 px-4 py-2 font-semibold">เก็บเป็นฉบับร่าง</button><button type="button" onClick={() => void confirmSend()} disabled={busy || !preview.quotaSufficient || preview.eligibleCount === 0} className="rounded-xl bg-brand-500 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? 'กำลังนำเข้าคิว...' : 'ยืนยันส่ง'}</button></div></div></div>}
  </div>;
}
