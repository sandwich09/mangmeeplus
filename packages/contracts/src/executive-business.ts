/** Executive accounts: BE spec §16.1 API07–10/API14/API15 and §17. */
export const EXECUTIVE_ROLE_KEYS = ['MANGMEE_EXECUTIVE', 'MANGMEE_EXECUTIVE_EXPORT', 'MANGMEE_EXECUTIVE_CONTACT'] as const;
export const EXECUTIVE_PERMISSION_KEYS = ['system.executive.read', 'system.executive.export', 'system.executive.contact.read', 'system.executive_user.manage'] as const;
export const EXECUTIVE_ACCOUNT_STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type ExecutiveAccountStatus = typeof EXECUTIVE_ACCOUNT_STATUSES[number];
export type ExecutiveUserAccess = { canExport: boolean; canSeeContacts: boolean };
export type ExecutiveUserCreateBody = ExecutiveUserAccess & {
  username: string; displayName: string; phoneNumber?: string; email?: string;
};
export type ExecutiveUserListQuery = { q?: string; status?: ExecutiveAccountStatus; page?: number; pageSize?: number };
export type ExecutiveUserView = ExecutiveUserAccess & {
  userId: string; username: string; displayName: string; phoneNumber: string | null; email: string | null;
  status: ExecutiveAccountStatus; canRead: boolean; lastWebEntryAt: string | null; temporaryPasswordExpiresAt: string | null;
};
export type ExecutiveUserListDto = {
  items: ExecutiveUserView[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type ExecutiveUserCredential = { userId: string; username: string; temporaryPassword: string; expiresAt: string };
export type ExecutiveUserCreateResult = { user: ExecutiveUserView; credential: ExecutiveUserCredential };
export type ExecutiveUserReasonBody = { reason: string };
export type ExecutiveUserStatusBody = ExecutiveUserReasonBody & { status: 'ACTIVE' | 'SUSPENDED' };
export type ExecutiveUserAccessBody = ExecutiveUserReasonBody & ExecutiveUserAccess;
