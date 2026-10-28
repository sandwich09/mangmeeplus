// Mirrors the API's GET /v1/auth/me response shape
export type WebSession = {
  userId: string;
  displayName: string | null;
  companyId: string;
  membershipId: string;
  roles: string[];
  roleNames?: Record<string, string>;
  /** Display-only package availability; never grants the reader a permission. */
  availablePermissions?: string[];
  /** Company features, independent of roles; null is the server's legacy all-entitled sentinel. */
  entitledFeatureKeys?: string[] | null;
  permissions: string[];
  /** Server-verified source-only expense draft mode; absent is false. */
  freeExpenseDrafts?: boolean;
  scopes?: { branchIds?: string[] };
  authProvider: 'watchdog' | 'line' | 'dev';
  /** Set while a temporary password is pending: the API 403s this session out of every business route. */
  mustChangePassword: boolean;
  /** This exact password-login session proved the current credential and may complete the forced change. */
  canSkipCurrentPassword: boolean;
  /** Current access token is blocked from business routes until the legal release is acknowledged. */
  legalAcceptanceRequired: boolean;
  /**
   * The company's screen setting "แสดงเมนูบันทึกด้วยมือบนเว็บ". Not an authority: read it only through
   * `canOpenManualWeb`. Optional because an older API answers without it, and a missing value shows
   * the entrances.
   */
  manualExpenseWebEntry?: boolean;
  /** Menu visibility only. A missing value from an older API keeps the new menu hidden. */
  disbursementVoucherWebEntry?: boolean;
};

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: WebSession }
  | { status: 'error'; error: string };
