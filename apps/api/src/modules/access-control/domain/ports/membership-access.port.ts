export interface IMembershipAccessPort {
  getActiveMembership(userId: string, companyId?: string): Promise<{
    membershipId: string;
    companyId: string;
    status: string;
  } | null>;
}

export const MEMBERSHIP_ACCESS_TOKEN = 'MEMBERSHIP_ACCESS_TOKEN';
