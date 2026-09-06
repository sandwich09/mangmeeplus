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
export const SUPPORT_REQUEST_RESUME_ACTION = 'system.support_request.resume_ai';
