'use client';

import type React from 'react';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CrmAiCustomerRisk,
  CrmAiSentiment,
  CrmAiStatus,
  CrmAiTurnClass,
  CrmConversationSummaryResult,
  CrmInsightsResult,
  CrmReplyDraftResult,
  CrmTrustFactor,
  CrmTrustReadResult,
  CrmTrustTier,
} from '@watchdog-bms/contracts';
import {
  getAiTrust,
  requestAiInsights,
  requestAiReplyDraft,
  requestAiSummary,
  sendAiFeedback,
  type CrmAiFeedbackInput,
} from './crm-ai-assist.api';

type SectionKind = CrmAiFeedbackInput['kind'];
type Rating = CrmAiFeedbackInput['rating'];

const TRUST_LABEL: Record<CrmTrustTier, string> = {
  NEW: 'ใหม่',
  BUILDING: 'กำลังสร้างประวัติ',
  TRUSTED: 'น่าเชื่อถือ',
};

const TRUST_STYLE: Record<CrmTrustTier, { bg: string; color: string; border: string }> = {
  NEW: { bg: '#F9FAFB', color: '#475467', border: '#EAECF0' },
  BUILDING: { bg: '#FFFAEB', color: '#B54708', border: '#FEDF89' },
  TRUSTED: { bg: '#ECFDF3', color: '#027A48', border: '#ABEFC6' },
};

const INTENT_LABEL: Record<CrmAiTurnClass, string> = {
  QUESTION: 'คำถาม',
  BOOKING_REQUEST: 'ขอจอง',
  CONFIRMATION: 'ยืนยัน',
  COMPLAINT: 'ร้องเรียน',
  SPAM: 'สแปม',
  NEEDS_HUMAN: 'ต้องให้คนดูแล',
};

const SENTIMENT_LABEL: Record<CrmAiSentiment, string> = {
  POSITIVE: 'บวก',
  NEUTRAL: 'กลาง',
  NEGATIVE: 'ลบ',
};

const RISK_LABEL: Record<CrmAiCustomerRisk, string> = {
  LOW: 'เสี่ยงต่ำ',
  MEDIUM: 'เสี่ยงกลาง',
  HIGH: 'เสี่ยงสูง',
};

function statusMessage(status: CrmAiStatus, retryable?: boolean): string {
  if (status === 'uncertain') return 'AI ไม่แน่ใจ ลองใหม่อีกครั้ง';
  if (status === 'unavailable') return retryable ? 'AI ไม่พร้อมใช้งานชั่วคราว ลองใหม่ได้อีกครั้ง' : 'AI ไม่พร้อมใช้งานชั่วคราว';
  if (status === 'refused') return 'AI ไม่สามารถสร้างคำตอบนี้ได้';
  return '';
}

function timeLabel(iso: string | null): string {
  if (!iso) return 'ยังไม่คำนวณ';
  return formatThaiDateTime(iso);
}

function factorLabel(factor: CrmTrustFactor): string {
  const labels: Record<string, string> = {
    base: 'ฐานเริ่มต้น',
    tenure30d: 'เป็นลูกค้า 30 วัน',
    tenure90d: 'เป็นลูกค้า 90 วัน',
    lineLinked: 'ยืนยัน LINE',
    consentGranted: 'ให้ความยินยอม',
    financialIdentity: 'เชื่อมข้อมูลบัญชี',
    engagement: 'มีการคุยต่อเนื่อง',
    keptAppointment: 'มาตามนัด',
    noShow: 'ไม่มาตามนัด',
    level2_requires_verified_identity_and_event: 'จำกัดระดับจนกว่าจะยืนยันตัวตนและมีเหตุการณ์จริง',
  };
  return labels[factor.key] ?? factor.key;
}

function Chip({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'amber' | 'red' | 'purple' }) {
  const styles = {
    gray: { bg: '#F2F4F7', color: '#344054' },
    green: { bg: '#ECFDF3', color: '#027A48' },
    amber: { bg: '#FFFAEB', color: '#B54708' },
    red: { bg: '#FEF3F2', color: '#B42318' },
    purple: { bg: '#F4F3FF', color: '#6941C6' },
  }[tone];
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: styles.bg, color: styles.color }}>
      {children}
    </span>
  );
}

function FeedbackButtons({
  kind,
  requestId,
  busy,
  onSend,
}: {
  kind: SectionKind;
  requestId: string | null;
  busy: boolean;
  onSend: (kind: SectionKind, rating: Rating, requestId: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {(['UP', 'DOWN'] as const).map((rating) => (
        <button
          key={rating}
          type="button"
          aria-label={rating === 'UP' ? 'ให้คะแนนดี' : 'ให้คะแนนไม่ดี'}
          disabled={!requestId || busy} aria-busy={Boolean(busy)} data-loading-indicator
          onClick={() => requestId && onSend(kind, rating, requestId)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <span aria-hidden="true" className="action-loading-spinner h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" /> : rating === 'UP' ? '👍' : '👎'}
        </button>
      ))}
    </div>
  );
}

function Section({
  title,
  kind,
  requestId,
  feedbackBusy,
  onFeedback,
  children,
}: {
  title: string;
  kind: SectionKind;
  requestId: string | null;
  feedbackBusy: boolean;
  onFeedback: (rating: Rating, requestId: string) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-gray-100 pt-4">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold text-gray-900">{title}</h3>
        <FeedbackButtons kind={kind} requestId={requestId} busy={feedbackBusy} onSend={(_kind, rating, id) => onFeedback(rating, id)} />
      </div>
      {children}
    </section>
  );
}

export function InboxAiPanel({
  companyId,
  conversationId,
  permissions,
  setComposeText,
}: {
  companyId: string;
  conversationId: string;
  permissions: string[];
  setComposeText: (text: string) => void;
}) {
  const canAssist = permissions.includes('crm.ai.assist');
  const canReply = permissions.includes('crm.inbox.reply');
  const [trust, setTrust] = useState<CrmTrustReadResult | null>(null);
  const [trustOpen, setTrustOpen] = useState(false);
  const [trustLoading, setTrustLoading] = useState(false);
  const [trustError, setTrustError] = useState<string | null>(null);

  const [summary, setSummary] = useState<Extract<CrmConversationSummaryResult, { status: 'ok' }> | null>(null);
  const [summaryRequestId, setSummaryRequestId] = useState<string | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  const [draft, setDraft] = useState<Extract<CrmReplyDraftResult, { status: 'ok' }> | null>(null);
  const [draftRequestId, setDraftRequestId] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const [insights, setInsights] = useState<Extract<CrmInsightsResult, { status: 'ok' }> | null>(null);
  const [insightsRequestId, setInsightsRequestId] = useState<string | null>(null);
  const [insightsMessage, setInsightsMessage] = useState<string | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);

  const [feedbackBusy, setFeedbackBusy] = useState<SectionKind | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const trustToken = useRef(0);

  useEffect(() => {
    setTrust(null);
    setTrustOpen(false);
    setTrustError(null);
    setSummary(null);
    setSummaryRequestId(null);
    setSummaryMessage(null);
    setDraft(null);
    setDraftRequestId(null);
    setDraftMessage(null);
    setCopyMessage(null);
    setInsights(null);
    setInsightsRequestId(null);
    setInsightsMessage(null);
    setFeedbackMessage(null);

    if (!canAssist) return;
    const token = ++trustToken.current;
    setTrustLoading(true);
    getAiTrust(companyId, conversationId)
      .then((next) => {
        if (token === trustToken.current) setTrust(next);
      })
      .catch(() => {
        if (token === trustToken.current) setTrustError('โหลดระดับความน่าเชื่อถือไม่สำเร็จ');
      })
      .finally(() => {
        if (token === trustToken.current) setTrustLoading(false);
      });
  }, [canAssist, companyId, conversationId]);

  const runSummary = useCallback(async () => {
    setSummaryBusy(true);
    setSummaryMessage(null);
    try {
      const result = await requestAiSummary(companyId, conversationId);
      setSummaryRequestId(result.requestId);
      if (result.status === 'ok') setSummary(result);
      else setSummaryMessage(statusMessage(result.status, result.status === 'unavailable' ? result.error.retryable : undefined));
    } catch {
      setSummaryMessage('เรียก AI ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSummaryBusy(false);
    }
  }, [companyId, conversationId]);

  const runDraft = useCallback(async () => {
    setDraftBusy(true);
    setDraftMessage(null);
    setCopyMessage(null);
    try {
      const result = await requestAiReplyDraft(companyId, conversationId);
      setDraftRequestId(result.requestId);
      if (result.status === 'ok') setDraft(result);
      else setDraftMessage(statusMessage(result.status, result.status === 'unavailable' ? result.error.retryable : undefined));
    } catch {
      setDraftMessage('เรียก AI ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setDraftBusy(false);
    }
  }, [companyId, conversationId]);

  const runInsights = useCallback(async () => {
    setInsightsBusy(true);
    setInsightsMessage(null);
    try {
      const result = await requestAiInsights(companyId, conversationId);
      setInsightsRequestId(result.requestId);
      if (result.status === 'ok') setInsights(result);
      else setInsightsMessage(statusMessage(result.status, result.status === 'unavailable' ? result.error.retryable : undefined));
    } catch {
      setInsightsMessage('เรียก AI ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setInsightsBusy(false);
    }
  }, [companyId, conversationId]);

  const sendFeedback = useCallback(
    async (kind: SectionKind, rating: Rating, requestId: string) => {
      setFeedbackBusy(kind);
      setFeedbackMessage(null);
      try {
        await sendAiFeedback(companyId, conversationId, { kind, rating, requestId });
        setFeedbackMessage('บันทึก feedback แล้ว');
      } catch {
        setFeedbackMessage('บันทึก feedback ไม่สำเร็จ');
      } finally {
        setFeedbackBusy(null);
      }
    },
    [companyId, conversationId],
  );

  const copyDraft = useCallback(async () => {
    if (!draft) return;
    try {
      await navigator.clipboard?.writeText(draft.draftText);
      setCopyMessage('คัดลอกแล้ว');
    } catch {
      setCopyMessage('คัดลอกไม่สำเร็จ');
    }
  }, [draft]);

  const trustStyle = useMemo(() => TRUST_STYLE[trust?.tier ?? 'NEW'], [trust?.tier]);
  const factors = trust?.factors ?? [];

  if (!canAssist) return null;

  return (
    <div className="space-y-4">
      <section style={{ background: 'linear-gradient(160deg,#F4F3FF,#FCF4FF)', border: '1px solid #E9D7FE', borderRadius: 14, padding: '14px 15px' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-bold" style={{ color: '#6941C6' }}>ความน่าเชื่อถือลูกค้า</div>
            <div className="mt-2">
              <span className="inline-flex items-center rounded-full border px-3 py-1.5 text-[13px] font-bold" style={{ background: trustStyle.bg, color: trustStyle.color, borderColor: trustStyle.border }}>
                {trustLoading ? 'กำลังโหลด...' : TRUST_LABEL[trust?.tier ?? 'NEW']}
              </span>
            </div>
          </div>
          <button type="button" onClick={() => setTrustOpen((v) => !v)} className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-600 shadow-sm">
            รายละเอียด
          </button>
        </div>
        {trustError && <div className="mt-2 text-[12.5px] text-red-600">{trustError}</div>}
        {trustOpen && (
          <div className="mt-3 rounded-[10px] bg-white/70 p-3 text-[12.5px] leading-relaxed text-gray-600">
            <div>คะแนนที่บันทึก: {trust?.trustScore ?? 'ยังไม่มี'}</div>
            <div>คำนวณล่าสุด: {timeLabel(trust?.computedAt ?? null)}</div>
            {factors.length > 0 && (
              <ul className="mt-2 space-y-1">
                {factors.map((factor) => (
                  <li key={`${factor.key}:${factor.points}`} className="flex justify-between gap-3">
                    <span>{factorLabel(factor)}</span>
                    <span className="font-semibold">{factor.points > 0 ? '+' : ''}{factor.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <Section title="สรุปบทสนทนา" kind="SUMMARY" requestId={summaryRequestId} feedbackBusy={feedbackBusy === 'SUMMARY'} onFeedback={(rating, id) => void sendFeedback('SUMMARY', rating, id)}>
        {summary?.summaryText && <div className="whitespace-pre-wrap rounded-[10px] bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed text-gray-700">{summary.summaryText}</div>}
        {summaryMessage && <div className="mb-2 text-[12.5px] text-amber-700">{summaryMessage}</div>}
        <button type="button" onClick={() => void runSummary()} disabled={summaryBusy} aria-busy={Boolean(summaryBusy)} className="rounded-[9px] bg-brand-500 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
          {summaryBusy ? 'กำลังสรุป...' : summary ? 'สร้างใหม่' : 'สรุปบทสนทนา'}
        </button>
      </Section>

      <Section title="ร่างคำตอบ" kind="REPLY_DRAFT" requestId={draftRequestId} feedbackBusy={feedbackBusy === 'REPLY_DRAFT'} onFeedback={(rating, id) => void sendFeedback('REPLY_DRAFT', rating, id)}>
        {draft?.draftText && <div className="whitespace-pre-wrap rounded-[10px] bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed text-gray-700">{draft.draftText}</div>}
        {draftMessage && <div className="mb-2 text-[12.5px] text-amber-700">{draftMessage}</div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void runDraft()} disabled={draftBusy} aria-busy={Boolean(draftBusy)} className="rounded-[9px] bg-brand-500 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
            {draftBusy ? 'กำลังร่าง...' : draft ? 'สร้างใหม่' : 'ร่างคำตอบ'}
          </button>
          {draft && canReply && (
            <button type="button" onClick={() => setComposeText(draft.draftText)} className="rounded-[9px] border border-brand-200 bg-brand-25 px-3 py-2 text-[13px] font-semibold text-brand-600">
              แทรกลงช่องพิมพ์
            </button>
          )}
          {draft && (
            <button type="button" onClick={() => void copyDraft()} className="rounded-[9px] border border-gray-200 bg-white px-3 py-2 text-[13px] font-semibold text-gray-700">
              คัดลอก
            </button>
          )}
        </div>
        {copyMessage && <div className="mt-1.5 text-[12px] text-gray-500">{copyMessage}</div>}
      </Section>

      <Section title="Insights" kind="INSIGHTS" requestId={insightsRequestId} feedbackBusy={feedbackBusy === 'INSIGHTS'} onFeedback={(rating, id) => void sendFeedback('INSIGHTS', rating, id)}>
        {insights && (
          <div className="space-y-2 rounded-[10px] bg-gray-50 px-3 py-2.5 text-[13px] text-gray-700">
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="purple">{INTENT_LABEL[insights.intent] ?? insights.intent}</Chip>
              <Chip tone={insights.sentiment === 'POSITIVE' ? 'green' : insights.sentiment === 'NEGATIVE' ? 'red' : 'gray'}>
                {SENTIMENT_LABEL[insights.sentiment] ?? insights.sentiment}
              </Chip>
              <Chip tone={insights.risk === 'HIGH' ? 'red' : insights.risk === 'MEDIUM' ? 'amber' : 'green'}>
                {RISK_LABEL[insights.risk] ?? insights.risk}
              </Chip>
            </div>
            <div><span className="font-semibold">คะแนนความสนใจ (advisory):</span> {insights.leadScore}</div>
            <div><span className="font-semibold">Next best action:</span> {insights.nextBestAction}</div>
          </div>
        )}
        {insightsMessage && <div className="mb-2 text-[12.5px] text-amber-700">{insightsMessage}</div>}
        <button type="button" onClick={() => void runInsights()} disabled={insightsBusy} aria-busy={Boolean(insightsBusy)} className="rounded-[9px] bg-brand-500 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
          {insightsBusy ? 'กำลังวิเคราะห์...' : insights ? 'วิเคราะห์ใหม่' : 'ดู Insights'}
        </button>
      </Section>

      {feedbackMessage && <div className="text-[12.5px] text-gray-500">{feedbackMessage}</div>}
    </div>
  );
}
