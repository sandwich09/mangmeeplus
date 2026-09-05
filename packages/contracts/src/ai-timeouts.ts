/**
 * The one place the AI Gateway's document pipeline and its API-side callers agree on how long a
 * document read may take.
 *
 * They have to agree, because they fail in opposite directions. If the CALLER aborts first it sees
 * a transport error while the gateway is still working: the response body never arrives, so no
 * `AiUsageEvent` is written, and on the web lane the OCR admission is refunded as a retryable
 * failure — real provider spend then misses BOTH meters, and the trial AI budget is calibrated from
 * exactly those meters. Waiting strictly longer than the gateway's own worst case means a transport
 * timeout only ever happens when the gateway really is gone.
 */

/**
 * One provider call's ceiling inside the gateway (`DOCUMENT_OCR_TIMEOUT_MS` there). A dense
 * real-photo receipt regularly takes a document read past the 15s ERP tool-call budget
 * (prod failures 2026-07-14), so document routes get their own.
 */
export const AI_DOCUMENT_OCR_TIMEOUT_MS = 45_000;

/**
 * Worst-case provider calls in `/internal/ai/receipt-ocr`: stage-1 read, stage-2 understand, one
 * vision re-read when the total or the printed VAT is missing, then stage-2 again on that re-read.
 */
export const AI_RECEIPT_OCR_MAX_PROVIDER_CALLS = 4;

/** Worst case in `/internal/ai/bank-statement-extract`: stage-1 read, then one extraction call. */
export const AI_BANK_STATEMENT_MAX_PROVIDER_CALLS = 2;

/**
 * Headroom over the provider chain for the gateway's own JSON parsing, the HTTP hop and scheduling.
 * Generous on purpose: being a few seconds short costs an unmetered provider call, while being a
 * few seconds long costs only a slower failure on a request that has already failed.
 */
export const AI_GATEWAY_TRANSPORT_MARGIN_MS = 15_000;

/** The caller-side ceiling for a gateway route whose chain is at most `maxProviderCalls` deep. */
export const aiGatewayClientTimeoutMs = (maxProviderCalls: number): number =>
  maxProviderCalls * AI_DOCUMENT_OCR_TIMEOUT_MS + AI_GATEWAY_TRANSPORT_MARGIN_MS;

/** 4 x 45s + 15s = 195s. Used by BOTH receipt callers — the web client and the LINE gateway client. */
export const AI_RECEIPT_OCR_CLIENT_TIMEOUT_MS = aiGatewayClientTimeoutMs(AI_RECEIPT_OCR_MAX_PROVIDER_CALLS);
