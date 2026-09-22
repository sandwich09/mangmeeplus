/**
 * The audit actions the /system support inbox writes (line-support-request-spec-th §2.3).
 *
 * Here rather than beside the use case because there are TWO routes to "ตอบแล้ว": the inbox button
 * and the partner page's message box (§2.2 delta รอบ 4 item 4), and they live in different modules.
 * Importing the constant from `SupportRequestAdminUseCase` made `system-partner-management` depend
 * on an `@Injectable()` file in `external-signup` while `external-signup` reaches the other way for
 * its own reasons — a cycle waiting to happen for the sake of a string. Two spellings of the action
 * would split the audit trail the inbox reads, so one place owns it and neither module owns that.
 */
export const SUPPORT_REQUEST_ANSWERED_ACTION = 'system.support_request.answered';
export const SUPPORT_REQUEST_PAUSE_ACTION = 'system.support_request.pause_ai';
export const SUPPORT_REQUEST_RESUME_ACTION = 'system.support_request.resume_ai';
export const SUPPORT_REQUEST_CLAIM_ACTION = 'system.support_request.claimed';
export const SUPPORT_REQUEST_RELEASE_ACTION = 'system.support_request.released';
export const SUPPORT_REQUEST_REPLY_ACTION = 'system.support_request.reply';
export const SUPPORT_REQUEST_RESOLVE_ACTION = 'system.support_request.resolved';
/** One support handoff pauses the LINE assistant for 24 hours unless either side resumes it first. */
export const SUPPORT_ASSISTANT_PAUSE_MS = 24 * 60 * 60 * 1000;
