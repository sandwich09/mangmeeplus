/** Stable dot-separated audit action taxonomy for WatchDog-BMS (spec §19.8). */
export const AuditAction = {
  AUTH_LOGIN_EXCHANGE: 'auth.login.exchange',
  AUTH_LOGIN_DENIED: 'auth.login.denied',
  AUTH_SESSION_REFRESH: 'auth.session.refresh',
  AUTH_SESSION_LOGOUT: 'auth.session.logout',
  AUTH_SESSION_REVOKE_OTHERS: 'auth.session.revoke_others',
  AUTH_EMAIL_CHANGE_REQUEST: 'auth.email.change_request',
  AUTH_EMAIL_VERIFIED: 'auth.email.verified',
  AUTH_PASSWORD_RESET_REQUEST: 'auth.password.reset_request',
  AUTH_PASSWORD_RESET_CONFIRM: 'auth.password.reset_confirm',
  AUTH_PASSWORD_RESET_FAILURE: 'auth.password.reset_failure',
  AUTH_IDENTITY_LINK: 'auth.identity.link',
  AUTH_IDENTITY_UNLINK: 'auth.identity.unlink',
  /** Spec §4F: one account's companies and email moved into the account that owns its LINE identity. */
  AUTH_ACCOUNT_MERGE: 'auth.account.merge',
  /** P12-3a desktop QR login: the phone approved a transaction, and the desktop redeemed it. */
  AUTH_LINE_QR_APPROVE: 'auth.line_qr.approve',
  AUTH_LINE_QR_REDEEM: 'auth.line_qr.redeem',
  /** P12-3b LINE → web deep-link handoff: a link was minted for a recipient, and a tap spent it. */
  AUTH_LINE_HANDOFF_ISSUE: 'auth.line_handoff.issue',
  AUTH_LINE_HANDOFF_EXCHANGE: 'auth.line_handoff.exchange',
  /** P10-L §3.5: a LIFF "start" tap exchanged an ID token for a handoff into one company. */
  AUTH_LINE_LIFF_SESSION: 'auth.line.liff_session',
  /** PDPA objection route (M-05 register §3.1): user toggled the LINE AI assistant. */
  AUTH_AI_ASSISTANT_PREFERENCE_UPDATE: 'auth.ai_assistant.preference_update',
  /** P10-L §3.6 progressive profiling: the user set their own recovery phone number. */
  AUTH_ACCOUNT_CONTACT_UPDATE: 'auth.account.contact_update',
  /** P10-L §15.4: a LINE-first account gained its first password. Not a reset — there was none. */
  AUTH_PASSWORD_SET: 'auth.password.set',
  AUTH_COMPANY_SWITCH: 'auth.company.switch',
  PLATFORM_ACCESS_STATE_UPDATE: 'platform.access.state_update',
  ADMIN_USER_INVITE: 'admin.user.invite',
  ADMIN_USER_DISABLE: 'admin.user.disable',
  ADMIN_ROLE_ASSIGN: 'admin.role.assign',
  ADMIN_ROLE_REVOKE: 'admin.role.revoke',
  ADMIN_PERMISSION_GRANT: 'admin.permission.grant',
  ADMIN_PERMISSION_REVOKE: 'admin.permission.revoke',
  AUDIT_LOG_READ: 'audit.log.read',
  AI_ACTOR_DELEGATION_CONSUME: 'ai.actor_delegation.consume',
  AI_TOOL_INVOKE: 'ai.tool.invoke',
  AI_TOOL_INVOKE_DENIED: 'ai.tool.invoke.denied',
  AI_TOOL_INVOKE_FAILED: 'ai.tool.invoke.failed',
  /**
   * Hold-reconciliation spec §4.2 — a System Admin's decision about held AI credit. These three are
   * the ONLY way money leaves or enters a stranded hold outside provider evidence, so each one is a
   * CRITICAL row carrying the reason, and `partner-ai-adjustment-history.ts` renders them in Thai.
   */
  AI_CREDIT_HOLD_RELEASED: 'ai.credit_hold.released',
  AI_CREDIT_HOLD_CHARGED_AT_BOUND: 'ai.credit_hold.charged_at_bound',
  AI_CREDIT_BREACH_ACKNOWLEDGED: 'ai.credit_breach.acknowledged',
  // Item 10C Employee Access and Role Management
  ACCESS_EMPLOYEE_CREATE: 'access.employee.create',
  ACCESS_EMPLOYEE_UPDATE: 'access.employee.update',
  ACCESS_EMPLOYEE_DISABLE: 'access.employee.disable',
  ACCESS_EMPLOYEE_DRAFT_DELETE: 'access.employee.draft.delete',
  ACCESS_EMPLOYEE_CREDENTIAL_ISSUE: 'access.employee.credential.issue',
  ACCESS_EMPLOYEE_LINE_LINK_ISSUE: 'access.employee.line_link.issue',
  ACCESS_EMPLOYEE_LINE_LINK_REVOKE: 'access.employee.line_link.revoke',
  ACCESS_EMPLOYEE_LINE_LINK_SUCCESS: 'access.employee.line_link.success',
  ACCESS_EMPLOYEE_LINE_LINK_FAILURE: 'access.employee.line_link.failure',
  ACCESS_CRM_CUSTOMER_SELF_REGISTER_SUCCESS: 'access.crm_customer.self_register.success',
  ACCESS_CRM_CUSTOMER_SELF_REGISTER_FAILURE: 'access.crm_customer.self_register.failure',
  // CUST-08 customer self-service PDPA request lifecycle
  ACCESS_CRM_CUSTOMER_SELF_CONSENT_WITHDRAW: 'access.crm_customer.self_consent.withdraw',
  ACCESS_CRM_CUSTOMER_SELF_EXPORT: 'access.crm_customer.self_data.export',
  ACCESS_CRM_CUSTOMER_SELF_ERASURE_REQUEST: 'access.crm_customer.self_erasure.request',
  /** L-11: append-only correction event describing a PDPA field-level redaction of prior audit rows. */
  PDPA_AUDIT_REDACTED: 'pdpa.audit.redacted',
  // Buyer expense capture (contract appendix §2/§9). Ids and enum values only in metadata —
  // never a file name, a caption or anything transcribed off a customer's document.
  EXPENSE_CAPTURE_GROUP_CREATE: 'expense.capture_group.create',
  EXPENSE_CAPTURE_GROUP_FILE_ADD: 'expense.capture_group.file_add',
  EXPENSE_CAPTURE_GROUP_FILE_DETACH: 'expense.capture_group.file_detach',
  EXPENSE_CAPTURE_GROUP_CLOSE: 'expense.capture_group.close',
  EXPENSE_CAPTURE_GROUP_CONVERT: 'expense.capture_group.convert',
  ACCESS_ROLE_CREATE: 'access.role.create',
  ACCESS_ROLE_UPDATE: 'access.role.update',
  ACCESS_ROLE_DISABLE: 'access.role.disable',
  ACCESS_EMPLOYEE_ROLE_ASSIGN: 'access.employee.role.assign',
  ACCESS_ROLE_TEMPLATE_APPLY: 'access.role_template.apply',
  ACCESS_ROLE_TEMPLATE_CREATE: 'access.role_template.create',
  ACCESS_ROLE_TEMPLATE_UPDATE: 'access.role_template.update',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];
