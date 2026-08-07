// ---- CRM Customer AI Agent Family (spec §25) — API ↔ AI Gateway contract ----
//
// Frozen I/O between the ERP Core API (which assembles bounded context and owns
// every deterministic autonomy gate) and the AI Gateway `crm-customer-ai` module
// (which only classifies / composes). The gateway holds zero ERP tools and never
// touches the database; the API keeps the source records and re-validates before
// any send. Kept separate from the employee LINE-AI contracts by design.

import type { ProviderError } from './line-ai.js';
import type { AiModelPolicy, AiUsageEntry } from './ai-lineage.js';
import type { CrmConsentStatus } from './crm.js';

/** Semantic classification of a single customer turn. Model-driven — the API/gateway
 *  never uses keyword or phrase lists to decide these (spec §24). */
export const CRM_AI_TURN_CLASSES = [
  'QUESTION',
  'BOOKING_REQUEST',
  'CONFIRMATION',
  'COMPLAINT',
  'SPAM',
  'NEEDS_HUMAN',
] as const;
export type CrmAiTurnClass = (typeof CRM_AI_TURN_CLASSES)[number];

export const CRM_AI_MAX_WINDOW = 20;

/** Shared outcome envelope, aligned with the gateway's typed-unavailable behavior:
 *  - `ok`          usable result present
 *  - `uncertain`   low confidence; caller must fall back to staff draft
 *  - `refused`     legacy gateway signal; API routes it to human review (reply/AUTONOMOUS only)
 *  - `unavailable` provider disabled/down/not-yet-implemented; `error` may carry detail
 *  Each Result below is a discriminated union on `status`; not every status appears in
 *  every result (intake and trust never refuse). Every result additionally carries the
 *  optional `usage` rows the gateway measured for that call (metering spec §7.1) — attached
 *  at the intersection so both arms report them. */
export type CrmAiStatus = 'ok' | 'uncertain' | 'refused' | 'unavailable';

/** One turn in the bounded conversation window (oldest → newest, ≤20). AI-authored
 *  turns are marked `AI` so the model can see its own prior replies. */
export type CrmAiWindowMessage = {
  role: 'CUSTOMER' | 'STAFF' | 'AI';
  text: string;
  at: string; // ISO 8601
};

/** Customer-safe catalog context assembled by ERP Core from active, explicitly
 * published Product rows. AI Gateway treats this as bounded data and never reads DB. */
export type CrmAiCatalogItem = {
  id: string;
  sku: string;
  name: string;
  kind: 'STOCKABLE' | 'SERVICE' | 'NON_STOCK';
  description?: string;
  category?: string;
  unit: string;
  salePrice?: string;
  bookingDurationMinutes?: number;
};

// ---- Intake: semantic turn classification ----

export type CrmCustomerIntakeRequest = {
  requestId: string;
  /** Server-derived tenant scope: feeds the per-company rate limit, model-policy resolution,
   *  and usage attribution. Required on every CRM request; never taken from a customer payload. */
  companyId: string;
  /** API-resolved CompanyAiConfiguration; never accepted from an end-user payload. */
  modelPolicy?: AiModelPolicy;
  window: CrmAiWindowMessage[]; // ≤20
  // Reuses the canonical CRM consent enum (crm.ts) — including NOT_REQUIRED — so the API
  // passes a customer's consentStatus straight through with no lossy remapping.
  consent: CrmConsentStatus;
};

/** Discriminated on `status` so callers narrow the payload; `requestId` echoes the request
 *  it answers (correlation for batched/queued calls). Intake never refuses. */
export type CrmCustomerIntakeResult = { requestId: string; usage?: AiUsageEntry[] } & (
  | { status: 'ok'; turnClass: CrmAiTurnClass; confidence: number }
  | { status: 'uncertain' }
  | { status: 'unavailable'; error: ProviderError }
);

// ---- Staff-assisted customer profile extraction ----

/** Free-form staff note -> editable customer-form suggestion. The gateway only
 * extracts bounded fields; ERP Core still owns duplicate checks and mutation. */
export type CrmCustomerProfileExtractRequest = {
  requestId: string;
  companyId: string;
  modelPolicy?: AiModelPolicy;
  text: string;
  locale?: string;
};

export type CrmCustomerProfileExtractResult = { requestId: string; usage?: AiUsageEntry[] } & (
  | {
      status: 'ok';
      suggested: {
        displayName?: string;
        primaryPhone?: string;
        primaryEmail?: string;
        notes?: string;
      };
      confidence: number;
    }
  | { status: 'uncertain' }
  | { status: 'unavailable'; error: ProviderError }
);

// ---- Booking slot extraction: semantic request → normalized fields ----

export type CrmBookingExtractRequest = {
  requestId: string;
  companyId: string;
  modelPolicy?: AiModelPolicy;
  window: CrmAiWindowMessage[]; // ≤20
  consent: CrmConsentStatus;
  todayBangkok: string; // yyyy-mm-dd
  catalog: CrmAiCatalogItem[]; // published SERVICE rows only
};

export type CrmBookingExtractResult = { requestId: string; usage?: AiUsageEntry[] } & (
  | {
      status: 'ok';
      catalogItemId?: string;
      serviceName?: string;
      date: string; // yyyy-mm-dd
      timeHHmm?: string; // HH:mm, 24h
      durationMinutes?: number;
      confidence: number;
    }
  | { status: 'unclear'; confidence: number }
);

// ---- Reply draft: staff-assist or autonomous composition ----

export type CrmAiReplyMode = 'STAFF_ASSIST' | 'AUTONOMOUS';

/** Brand voice source is existing data only (owner decision 2026-07-09): `Company`
 *  has no businessType/description column, so message templates carry the business
 *  context implicitly (few-shot voice) alongside the brand + channel display name. */
export type CrmAiBrandIdentity = {
  brandName: string; // Company.brandName ?? name
  channelDisplayName: string; // CompanyMessagingChannel.displayName
};

export type CrmAiTemplateExample = {
  title: string;
  body: string;
};

export type CrmReplyDraftRequest = {
  requestId: string;
  companyId: string;
  modelPolicy?: AiModelPolicy;
  mode: CrmAiReplyMode;
  window: CrmAiWindowMessage[]; // ≤20
  brand: CrmAiBrandIdentity;
  templates: CrmAiTemplateExample[]; // staff assist: active; autonomous: current-version AI-approved only
  catalog: CrmAiCatalogItem[]; // published products/services only
  locale?: string; // default th-TH
  tone?: string; // additive 2026-07-09 (plan Phase 4 "tone adjust"); omitted = house style
};

/** Discriminated on `status`. `refused` is retained for rolling compatibility and is
 *  treated by the API as a human-review signal. STAFF_ASSIST never refuses — it
 *  degrades to `uncertain` so staff compose from scratch. */
export type CrmReplyDraftResult = { requestId: string; usage?: AiUsageEntry[] } & (
  | { status: 'ok'; draftText: string; confidence: number; needsHumanSignal?: boolean }
  | { status: 'uncertain' }
  | { status: 'refused'; confidence: number }
  | { status: 'unavailable'; error: ProviderError }
);

// ---- Trust score: deterministic signals → bounded score + reasoning ----
//
// Signals are computed API-side from CRM tables only. Booking/no-show counts are
// zero until the appointments module exists (MVP1-6 / Phase 8C).

export type CrmTrustNarrativeSignals = {
  tenureDays: number;
  inboundMessageCount: number;
  bookingsCount: number;
  noShowCount: number;
};

export type CrmTrustScoreRequest = {
  requestId: string;
  companyId: string;
  modelPolicy?: AiModelPolicy;
  signals: CrmTrustNarrativeSignals;
  priorScore?: number; // 0..100
};

/** Discriminated on `status`; trust never refuses. `score` is advisory 0..100. */
export type CrmTrustScoreResult = { requestId: string; usage?: AiUsageEntry[] } & (
  | { status: 'ok'; score: number; reasoning?: string }
  | { status: 'uncertain' }
  | { status: 'unavailable'; error: ProviderError }
);

export type CrmTrustFactor = { key: string; points: number };
export type CrmTrustTier = 'NEW' | 'BUILDING' | 'TRUSTED';
export type CrmTrustReadResult = {
  trustScore: number | null;
  tier: CrmTrustTier;
  factors: CrmTrustFactor[] | null;
  computedAt: string | null;
};

// ---- Conversation summary (staff assist; additive 2026-07-09) ----

export type CrmConversationSummaryRequest = {
  requestId: string;
  companyId: string;
  modelPolicy?: AiModelPolicy;
  window: CrmAiWindowMessage[]; // ≤20
};

export type CrmConversationSummaryResult = { requestId: string; usage?: AiUsageEntry[] } & (
  | { status: 'ok'; summaryText: string; confidence: number }
  | { status: 'uncertain' }
  | { status: 'unavailable'; error: ProviderError }
);

// ---- Insights: intent / sentiment / advisory lead score / next action (additive 2026-07-09) ----
// Mirrors prisma enums CrmSentiment / CrmRiskLevel (contracts must not import prisma).

export const CRM_AI_SENTIMENTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const;
export type CrmAiSentiment = (typeof CRM_AI_SENTIMENTS)[number];
export const CRM_AI_CUSTOMER_RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type CrmAiCustomerRisk = (typeof CRM_AI_CUSTOMER_RISKS)[number];

export type CrmInsightsRequest = {
  requestId: string;
  companyId: string;
  modelPolicy?: AiModelPolicy;
  window: CrmAiWindowMessage[]; // ≤20
  consent: CrmConsentStatus;
};

export type CrmInsightsResult = { requestId: string; usage?: AiUsageEntry[] } & (
  | {
      status: 'ok';
      intent: CrmAiTurnClass;
      sentiment: CrmAiSentiment;
      risk: CrmAiCustomerRisk;
      leadScore: number; // 0..100 advisory — consumers must never gate on it
      nextBestAction: string;
      confidence: number;
    }
  | { status: 'uncertain' }
  | { status: 'unavailable'; error: ProviderError }
);
