// Item 15A defaults (spec: crm-line-oa-customer-os-spec.md section 22)

/** Reopen the same conversation when a customer writes back within this window. */
export const CONVERSATION_REOPEN_WINDOW_DAYS = 7;

/** First-response SLA defaults when a company has no CrmInboxPolicy row. */
export const DEFAULT_FIRST_RESPONSE_MINUTES = 30;
export const DEFAULT_BUSINESS_HOURS = { start: '09:00', end: '18:00', timezone: 'Asia/Bangkok' } as const;

/** Policy upper bound — a day of SLA minutes; also bounds the due-time walk. */
export const MAX_FIRST_RESPONSE_MINUTES = 1440;

/** Bounded conversation list preview text length. */
export const MESSAGE_PREVIEW_MAX_LENGTH = 200;

/** LINE text message hard limit is 5000 chars; keep outbound inside it. */
export const OUTBOUND_TEXT_MAX_LENGTH = 5000;

/** Free-form triage tags per conversation — bounded so tagsJson stays small. */
export const CONVERSATION_MAX_TAGS = 10;
export const CONVERSATION_TAG_MAX_LENGTH = 40;

/** URL-safe webhook key bytes (base64url encoded → 32 chars). */
export const WEBHOOK_KEY_BYTES = 24;

export const CRM_LINE_WEBHOOK_PATH_PREFIX = '/v1/crm/line/webhook/';

// --- MVP1-0 pilot setup (Dev A A2) ----------------------------------------
// Feature entitlement key that actually gates the CRM LINE inbox today. The whole
// crm.* permission prefix is stripped unless this key is enabled (see
// employee-access/domain/logic/feature-gate.logic.ts PREFIX_FEATURE_RULES). The
// plan's dedicated `crm_line_inbox`/`crm_scheduling` flags are Phase-9 vocabulary
// that nothing honours yet — enabling only those would strip the inbox, so the
// pilot setup enables `crm`.
export const CRM_INBOX_ENTITLEMENT_KEY = 'crm';

/**
 * Canonical Thai PDPA privacy notice for the CRM LINE OA pilot — single source of
 * truth reused by the OA intake, the settings surface, and the Phase-8B LIFF
 * registration consent. A shared constant (not a per-company field) until Phase-9
 * per-company branding ships. Carries the five PDPA-required elements the pilot
 * setup verifies: data controller, collection purpose, retention window,
 * data-subject rights, and a contact channel.
 */
export const PDPA_CONSENT_NOTICE_TH = [
  'ประกาศความเป็นส่วนตัว (PDPA)',
  '',
  'ผู้ควบคุมข้อมูลส่วนบุคคล: ร้านค้า/กิจการที่ท่านติดต่อผ่าน LINE Official Account นี้',
  'วัตถุประสงค์: เราเก็บชื่อ รูปโปรไฟล์ LINE ข้อความ และไฟล์ที่ท่านส่ง เพื่อตอบกลับ ดูแลบริการ ออกใบเสนอราคา/ใบแจ้งหนี้ และนัดหมายตามที่ท่านร้องขอ',
  'ระยะเวลาเก็บรักษา: ข้อความเก็บไม่เกิน 24 เดือน ไฟล์/รูปภาพเก็บไม่เกิน 12 เดือน ยกเว้นหลักฐานการเงิน/ภาษีที่ต้องเก็บตามกฎหมาย',
  'สิทธิของเจ้าของข้อมูล: ท่านมีสิทธิขอเข้าถึง แก้ไข ถอนความยินยอม หรือขอให้ลบข้อมูลของท่านได้',
  'ช่องทางติดต่อ: แจ้งความประสงค์ได้โดยพิมพ์ข้อความในแชทนี้ หรือติดต่อผู้ดูแลร้านค้า',
] as const;

export const PDPA_CONSENT_NOTICE_TEXT = PDPA_CONSENT_NOTICE_TH.join('\n');

// --- PDPA retention / purge (Dev A A6) ------------------------------------
// Owner decision 2026-07-09: text messages purged after 24 months, media blobs
// after 12 months; anything linked to a finance document (payment proof, tax
// evidence) is NEVER auto-purged (legal retention); admin manual purge + on-demand
// erasure are always audited. See mvp-1-crm-line-bill-capture-sequence memory.
export const PDPA_TEXT_RETENTION_MONTHS = 24;
export const PDPA_MEDIA_RETENTION_MONTHS = 12;

/** Default rows processed per purge sweep batch (bounds one worker pass). */
export const PDPA_PURGE_BATCH_LIMIT = 500;

/** Marker written into a purged message's contentJson so the row stays but the text is gone. */
export const PDPA_PURGED_CONTENT_MARKER = { purged: true } as const;

/** Display name a customer's record shows after a PDPA erasure request. */
export const PDPA_ERASED_DISPLAY_NAME = 'ลูกค้าที่ขอลบข้อมูล (PDPA)';

// --- New-conversation notification scan (Dev A A4) ------------------------
// The scanner runs every ~60s; a window of a few minutes (> the scan interval)
// means each genuinely-new conversation lands in the query once or twice, and the
// notification-center dedup + cooldown collapses that to a single alert. A still-
// unassigned conversation ageing past this window is picked up by the SLA breach
// path instead, so no schema "notified" flag is needed.
export const NEW_CONVERSATION_SCAN_WINDOW_MS = 5 * 60_000;
export const NEW_CONVERSATION_SCAN_LIMIT = 200;

// --- Delivery/media durability retries (Dev A A5) -------------------------
// Reply-send retry: a failed staff reply (429 / 5xx / network) is re-pushed by a
// scanner with exponential backoff; terminal errors (401 bad token, 4xx) go FAILED.
export const REPLY_SEND_MAX_ATTEMPTS = 5;
export const REPLY_SEND_BACKOFF_BASE_MS = 30_000;
export const REPLY_SEND_BACKOFF_MAX_MS = 3_600_000;
// A message left PENDING with no scheduled retry (e.g. the API died mid-send) is
// adopted by the scanner once it is older than this grace window.
export const REPLY_SEND_ORPHAN_GRACE_MS = 60_000;
/** LINE retry keys expire after 24 hours; never start a provider retry past that window. */
export const REPLY_SEND_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RETRY_SCAN_LIMIT = 100;

// GC4 autonomy jobs: immediate execution is best-effort; the sweep adopts an
// orphan after two minutes and retries transient failures with bounded backoff.
export const AUTONOMY_JOB_STALE_MS = 2 * 60_000;
export const AUTONOMY_JOB_MAX_ATTEMPTS = 3;
export const AUTONOMY_JOB_BACKOFF_BASE_MS = 60_000;

// Media/profile durability: re-fetch inbound media / re-enrich LINE profiles that the
// inline background fetch missed (API restart) or that failed transiently. Bounded to
// a window so the sweep both makes progress and stops once LINE's content window (days)
// has passed — a very old un-fetched blob is unrecoverable anyway.
export const MEDIA_FETCH_GRACE_MS = 30_000;
export const MEDIA_FETCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PROFILE_ENRICH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Placeholder name given to a new LINE customer before profile enrichment lands. */
export const CUSTOMER_PLACEHOLDER_NAME = 'ลูกค้า LINE';
/** Media fetch errors that are terminal — the retry scanner must not re-attempt them. */
export const TERMINAL_MEDIA_ERROR_CODES: readonly string[] = [
  'content_too_large',
  'media_type_unsupported',
  'media_security_rejected',
];

// --- Payment-proof queue (Dev A A3) ---------------------------------------
// Flagging an inbound image as a payment proof creates an AttachmentLink. That both
// feeds the finance queue AND makes the attachment finance-linked → PDPA-exempt (A6).
export const PAYMENT_PROOF_LINK_PURPOSE = 'payment_proof';
export const PAYMENT_PROOF_LINK_TARGET_TYPE = 'crm_conversation';
export const PAYMENT_PROOF_QUEUE_LIMIT = 100;

// --- Appointment reminders (Dev A A7) -------------------------------------
// Lead time before an appointment at which the reminder fires. The scanner runs
// every minute and marks reminderSentAt, so a booking is reminded exactly once when
// it enters the [now, now+lead] window. Times are rendered in Asia/Bangkok.
export const BOOKING_REMINDER_LEAD_MS = 60 * 60 * 1000; // 1 hour before
export const BOOKING_REMINDER_SCAN_LIMIT = 200;
export const BOOKING_REMINDER_CLAIM_STALE_MS = 2 * 60_000;
export const BOOKING_REMINDER_MAX_ATTEMPTS = 5;
export const BOOKING_TIMEZONE = 'Asia/Bangkok';
