// Mirrors the API's GET /v1/auth/me response shape
export type WebSession = {
  userId: string;
  displayName: string | null;
  companyId: string;
  membershipId: string;
  roles: string[];
  permissions: string[];
  authProvider: 'watchdog' | 'line' | 'dev';
  /** Set while a temporary password is pending: the API 403s this session out of every business route. */
  mustChangePassword: boolean;
};

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: WebSession }
  | { status: 'error'; error: string };
