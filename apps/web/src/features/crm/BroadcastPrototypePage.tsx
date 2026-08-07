'use client';

import type React from 'react';
import { useState } from 'react';
import { PrototypeDataNotice } from '@/common/components/prototype-data-notice';
import { MangmeeBranchChip, MangmeeCard, cx } from '@/common/components/mangmee';
import {
  GENERIC_UPLOAD_ERROR_MESSAGE,
  IMAGE_UPLOAD_ACCEPT,
  uploadFileValidationError,
} from '@/common/files/upload-file.logic';
import {
  BROADCAST_COLOR_TONES,
  BROADCAST_SEGMENTS,
  BROADCAST_TONES,
  PAST_CAMPAIGNS,
  genBroadcast,
  getSegmentCount,
  getSegmentLabel,
  type BroadcastColorId,
  type BroadcastSegmentId,
  type BroadcastToneId,
} from './broadcast-prototype.model';

function StepCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <MangmeeCard className="px-[22px] py-5">
      <div className="text-[13.5px] font-bold text-gray-500">{title}</div>
      {children}
    </MangmeeCard>
  );
}

function Field({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-[5px] text-[13.5px] font-semibold text-gray-700">{label}</div>
      <input
        className="mangmee-input text-[15px]"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function BroadcastPrototypePage() {
  const [topic, setTopic] = useState('');
  const [price, setPrice] = useState('');
  const [keyPoint, setKeyPoint] = useState('');
  const [tone, setTone] = useState<BroadcastToneId>('friendly');
  const [color, setColor] = useState<BroadcastColorId>('green');
  const [seg, setSeg] = useState<BroadcastSegmentId>('all');
  const [genDone, setGenDone] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [image, setImage] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);

  const colorMeta = BROADCAST_COLOR_TONES.find((c) => c.id === color) ?? BROADCAST_COLOR_TONES[0]!;
  const reach = getSegmentCount(seg);
  const canGen = topic.trim().length > 0;
  const canSend = msg.trim().length > 0 && !sent;
  const options = genDone ? genBroadcast(topic, price, keyPoint, tone) : [];

  // Any core-input or tone change invalidates the previous generation, like the prototype.
  const setCoreField = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setGenDone(false);
    setSent(false);
  };

  const runGen = () => {
    if (!canGen) return;
    setGenDone(true);
    setPicked(null);
    setSent(false);
    setMode('ai');
  };

  const onUploadImg = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = uploadFileValidationError(file, 'image');
    if (validationError || file.size > 5 * 1024 * 1024) {
      setUploadError(validationError ?? 'รูปภาพต้องมีขนาดไม่เกิน 5 MB');
      event.target.value = '';
      return;
    }
    setUploadError('');
    const reader = new FileReader();
    reader.onload = () => {
      setImage(String(reader.result));
      setUploadName(file.name);
    };
    reader.onerror = () => setUploadError(GENERIC_UPLOAD_ERROR_MESSAGE);
    reader.readAsDataURL(file);
  };

  return (
    <div className="mangmee-page">
      <PrototypeDataNotice />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold leading-tight text-gray-900">บรอดแคสต์</h1>
          <p className="mt-3 text-base font-medium text-gray-500">
            ส่งข้อความ/โปรโมชันหาลูกค้าผ่าน LINE OA · ให้ AI ช่วยคิดเนื้อหา + โปสเตอร์ · ทุกสาขา (รวม)
          </p>
        </div>
        <MangmeeBranchChip />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* LEFT — inputs */}
        <div className="flex min-w-0 flex-col gap-4">
          <StepCard title="1 · ข้อมูลหลัก (ผู้ดูแลกรอก)">
            <div className="mt-3 flex flex-col gap-3">
              <Field
                label="โปรโมชัน / หัวข้อ *"
                value={topic}
                placeholder="เช่น โปรต่อขนตา Volume ลด 20% เดือนนี้"
                onChange={setCoreField(setTopic)}
              />
              <div className="flex flex-col gap-3 sm:flex-row">
                <Field label="ราคา / ส่วนลด" value={price} placeholder="เช่น 1,990 บาท" onChange={setCoreField(setPrice)} />
                <Field label="จุดขายหลัก (ถ้ามี)" value={keyPoint} placeholder="เช่น ติดทน 6 สัปดาห์" onChange={setCoreField(setKeyPoint)} />
              </div>
            </div>
          </StepCard>

          <StepCard title="2 · เลือกโทนเนื้อหา">
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {BROADCAST_TONES.map((t) => {
                const on = tone === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTone(t.id);
                      setGenDone(false);
                      setSent(false);
                    }}
                    className={cx(
                      'flex items-center gap-[9px] rounded-xl border-2 px-[15px] py-[11px] text-left',
                      on ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white',
                    )}
                  >
                    <span className="text-xl">{t.emoji}</span>
                    <span className="min-w-0">
                      <span className={cx('block text-[14.5px] font-bold', on ? 'text-brand-700' : 'text-gray-800')}>
                        {t.label}
                      </span>
                      <span className="block text-xs text-gray-400">{t.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </StepCard>

          <StepCard title="3 · โทนสีรูปภาพ (โปสเตอร์)">
            <div className="mt-3 grid grid-cols-2 gap-[9px] sm:grid-cols-5">
              {BROADCAST_COLOR_TONES.map((c) => {
                const on = color === c.id;
                return (
                  <div key={c.id} className="min-w-0">
                    <button
                      type="button"
                      aria-label={c.label}
                      onClick={() => setColor(c.id)}
                      className="h-[46px] w-full rounded-[11px] border-[3px]"
                      style={{
                        background: c.grad,
                        borderColor: on ? 'var(--color-brand-600)' : 'transparent',
                        boxShadow: on ? '0 0 0 2px #fff inset' : 'none',
                      }}
                    />
                    <div className={cx('mt-[5px] text-center text-xs', on ? 'font-bold text-brand-700' : 'font-medium text-gray-500')}>
                      {c.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </StepCard>

          <StepCard title="4 · กลุ่มผู้รับ">
            <div className="mt-3 flex flex-wrap gap-2.5">
              {BROADCAST_SEGMENTS.map((sg) => {
                const on = seg === sg.id;
                return (
                  <button
                    key={sg.id}
                    type="button"
                    onClick={() => {
                      setSeg(sg.id);
                      setSent(false);
                    }}
                    className={cx(
                      'min-w-[140px] flex-1 rounded-[14px] border-2 px-4 py-3.5 text-left',
                      on ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white',
                    )}
                  >
                    <div className={cx('text-[22px] font-extrabold', on ? 'text-brand-700' : 'text-gray-800')}>
                      {getSegmentCount(sg.id)}
                    </div>
                    <div className="mt-0.5 text-sm font-bold text-gray-800">{sg.label}</div>
                  </button>
                );
              })}
            </div>
          </StepCard>

          <button
            type="button"
            onClick={runGen}
            disabled={!canGen}
            className={cx(
              'self-start rounded-xl px-[22px] py-3 text-[15px] font-bold text-white',
              !canGen && 'cursor-not-allowed bg-gray-300',
            )}
            style={canGen ? { background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)' } : undefined}
          >
            ✨ ให้ AI ช่วยสร้างเนื้อหา + โปสเตอร์
          </button>
        </div>

        {/* RIGHT — results + compose */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="mangmee-segmented flex w-full">
            <button
              type="button"
              onClick={() => {
                setMode('ai');
                setSent(false);
              }}
              className={cx('mangmee-tab flex-1 text-center', mode === 'ai' && 'mangmee-tab-active')}
            >
              ✨ ตัวเลือกจาก AI
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('manual');
                setPicked(null);
                setSent(false);
              }}
              className={cx('mangmee-tab flex-1 text-center', mode === 'manual' && 'mangmee-tab-active')}
            >
              ✍️ เขียนเอง + รูปของฉัน
            </button>
          </div>

          {mode === 'ai' && !genDone && (
            <div className="rounded-2xl border border-dashed border-[#C4B5FD] bg-[#F0EBFF] px-6 py-10 text-center">
              <div className="text-[34px]">✨</div>
              <div className="mt-2 text-[15px] font-bold text-[#6D28D9]">กรอกข้อมูลหลักด้านซ้าย แล้วกด &quot;ให้ AI ช่วยสร้าง&quot;</div>
              <div className="mt-1 text-[13px] text-gray-500">AI จะเสนอเนื้อหา 3 แบบ + โปสเตอร์ตามโทนที่เลือก</div>
            </div>
          )}

          {mode === 'ai' && genDone && (
            <div className="flex flex-col gap-3.5">
              <div className="text-[13.5px] text-gray-500">AI แนะนำ 3 ตัวเลือก — แตะ &quot;เลือกใช้&quot; อันที่ชอบ</div>
              {options.map((option, i) => {
                const on = picked === i;
                return (
                  <div
                    key={i}
                    className={cx(
                      'overflow-hidden rounded-[14px] border-2 bg-white',
                      on ? 'border-brand-500 shadow-[0_0_0_3px_var(--color-brand-100)]' : 'border-gray-200',
                    )}
                  >
                    <div
                      className="flex h-[150px] flex-col items-center justify-center p-3.5 text-center"
                      style={{ background: colorMeta.grad }}
                    >
                      <div className="text-[19px] font-extrabold leading-tight" style={{ color: colorMeta.fg }}>
                        {option.headline}
                      </div>
                      {price.trim() && (
                        <div
                          className="mt-2 rounded-[20px] bg-[rgba(255,255,255,0.25)] px-3.5 py-1 text-[15px] font-bold"
                          style={{ color: colorMeta.fg }}
                        >
                          {price.trim()}
                        </div>
                      )}
                    </div>
                    <div className="px-4 pt-3.5 text-sm leading-relaxed text-gray-700">{option.body}</div>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(i);
                        setMode('ai');
                        setMsg(option.body);
                        setSent(false);
                      }}
                      className={cx(
                        'm-3 w-[calc(100%-24px)] rounded-[10px] p-2.5 text-center text-[14.5px] font-bold',
                        on ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700',
                      )}
                    >
                      {on ? '✓ เลือกใช้แล้ว' : 'เลือกใช้อันนี้'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {mode === 'manual' && (
            <MangmeeCard className="px-[22px] py-5">
              <div className="text-[13.5px] font-bold text-gray-500">รูปภาพจากเครื่อง</div>
              {image ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local dataURL preview */}
                  <img src={image} alt={uploadName} className="mt-2.5 max-h-[200px] w-full rounded-xl object-cover" />
                  <div className="mt-2 flex flex-wrap items-center justify-between text-[13px] text-gray-500">
                    <span className="min-w-0 truncate">{uploadName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setImage(null);
                        setUploadName('');
                      }}
                      className="font-semibold text-[#D92D20]"
                    >
                      ลบรูป
                    </button>
                  </div>
                </>
              ) : (
                <label className="mt-2.5 flex h-[120px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-500">
                  <span className="text-[26px]">🖼️</span>
                  เลือกรูปจากเครื่อง
                  <input type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={onUploadImg} className="hidden" />
                </label>
              )}
              {uploadError && <p className="mt-2 text-xs font-semibold text-error-600">{uploadError}</p>}
            </MangmeeCard>
          )}

          <MangmeeCard className="px-[22px] py-5">
            <div className="text-[13.5px] font-bold text-gray-500">ข้อความที่จะส่ง</div>
            <textarea
              value={msg}
              onChange={(event) => {
                setMsg(event.target.value);
                setSent(false);
              }}
              placeholder="เลือกจาก AI หรือพิมพ์เอง…"
              className="mangmee-input mt-2.5 min-h-[120px] resize-y text-[15px] leading-relaxed"
            />
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500">
                ส่งถึง <span className="font-extrabold text-brand-600">{reach}</span> คน · {getSegmentLabel(seg)}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!msg.trim()) return;
                  setSent(true);
                }}
                disabled={!canSend}
                className={cx(
                  'rounded-xl px-[26px] py-[13px] text-base font-bold text-white',
                  canSend ? 'bg-brand-500' : 'cursor-not-allowed bg-gray-300',
                )}
              >
                ส่งบรอดแคสต์
              </button>
            </div>
            {sent && (
              <div className="mt-3.5 rounded-xl border border-[#A6F4C5] bg-[#ECFDF3] px-[15px] py-3 text-sm font-semibold text-[#039855]">
                ✓ ส่งบรอดแคสต์ถึง {reach} คนเรียบร้อยแล้ว
              </div>
            )}
          </MangmeeCard>

          <MangmeeCard className="px-[22px] py-5">
            <div className="text-base font-bold text-gray-800">แคมเปญที่ผ่านมา</div>
            <div className="mt-3.5 flex flex-col gap-3.5">
              {PAST_CAMPAIGNS.map((campaign) => (
                <div key={campaign.name} className="flex items-start gap-[11px]">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: campaign.c }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-semibold text-gray-800">{campaign.name}</div>
                    <div className="mt-0.5 text-[12.5px] text-gray-400">
                      {campaign.seg} · {campaign.date}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-bold text-gray-700">{campaign.reach} คน</div>
                    <div className="text-xs text-[#039855]">เปิด {campaign.open}</div>
                  </div>
                </div>
              ))}
            </div>
          </MangmeeCard>
        </div>
      </div>
    </div>
  );
}
