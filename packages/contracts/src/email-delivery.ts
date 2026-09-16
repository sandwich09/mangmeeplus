export const EMAIL_DELIVERY_PURPOSES = ['account_claim', 'email_verification', 'password_reset', 'billing_status'] as const;
export type EmailDeliveryPurpose = typeof EMAIL_DELIVERY_PURPOSES[number];
export const EMAIL_DELIVERY_STATES = ['READY', 'SENDING', 'UNKNOWN', 'ACCEPTED', 'RETRY', 'CONFIG', 'PERMANENT', 'SUPPRESSED'] as const;
export type EmailDeliveryState = typeof EMAIL_DELIVERY_STATES[number] | 'UNRECOGNIZED';

export interface SystemEmailDeliveryDto {
  observedAt: string;
  windowStartedAt: string;
  configured: boolean;
  outboundSelected: boolean;
  totals: null | { attempts: number; intents: number; accepted: number; delivered: number; suppressed: number; possibleDuplicates: number };
  pending: null | { attempts: number; oldestCreatedAt: string | null; needsReview: number; overdueRecovery: number };
  callbacks: null | { received: number; pending: number; failed: number; latestReceivedAt: string | null };
  items: Array<{
    id: string; purpose: EmailDeliveryPurpose | 'other'; state: EmailDeliveryState; generation: number;
    createdAt: string; submittedAt: string | null; deliveredAt: string | null; suppressedAt: string | null;
    deadlineAt: string | null; nextRecoveryAt: string | null; possibleDuplicate: boolean; needsReview: boolean;
    signupHistoryPath: string | null; billingHistoryPath: string | null;
  }>;
  nextCursor: string | null;
}

export interface SystemEmailConnectionDto {
  observedAt: string;
  status: 'MATCHED' | 'NEEDS_REVIEW' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  facts: null | {
    server: 'MATCHED' | 'MISMATCH' | 'UNKNOWN'; stream: 'MATCHED' | 'MISMATCH' | 'UNKNOWN';
    mode: 'LIVE' | 'SANDBOX' | 'UNKNOWN'; transactional: boolean | null; archived: boolean | null;
  };
}

export interface EmailHistoryPolicyInput {
  scopeKey: string; version: number; retentionDays: number; enabled: boolean; reason: string; commandId: string;
}
export interface EmailHistoryPolicyDto {
  configured: boolean; canManage: boolean; scopeKey: string | null; version: number; retentionDays: number; enabled: boolean;
  eligibleCount: number; lastCleanupAt: string | null; lastArchivedCount: number;
  history: Array<{ id: string; createdAt: string; actorName: string | null; reason: string;
    before: { enabled: boolean; retentionDays: number }; after: { enabled: boolean; retentionDays: number } }>;
}
