import { createHash } from 'node:crypto';
import type { CrmCampaignStatus } from '@watchdog-bms/contracts';

const TRANSITIONS: Record<CrmCampaignStatus, CrmCampaignStatus[]> = {
  DRAFT: ['READY', 'CANCELLED'], READY: ['SCHEDULED', 'QUEUED', 'CANCELLED'],
  SCHEDULED: ['QUEUED', 'CANCELLED'], QUEUED: ['SENDING', 'CANCELLED'],
  SENDING: ['COMPLETED', 'PARTIAL', 'FAILED'], PARTIAL: ['QUEUED', 'CANCELLED'],
  COMPLETED: [], FAILED: ['QUEUED', 'CANCELLED'], CANCELLED: [],
};

export function canTransitionCampaign(from: CrmCampaignStatus, to: CrmCampaignStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function campaignContentHash(messageText: string, imageUrl?: string): string {
  return createHash('sha256').update(JSON.stringify({ messageText: messageText.trim(), imageUrl: imageUrl ?? null })).digest('hex');
}

export function recipientEligibility(input: { consentStatus: string; identityStatus: string; unfollowedAt?: Date | null; marketingRequiresExplicitConsent?: boolean }):
  'ELIGIBLE' | 'SKIPPED_CONSENT' | 'SKIPPED_UNREACHABLE' {
  if (input.consentStatus === 'REVOKED') return 'SKIPPED_CONSENT';
  if (input.marketingRequiresExplicitConsent && input.consentStatus !== 'GRANTED') return 'SKIPPED_CONSENT';
  if (input.identityStatus !== 'ACTIVE' || input.unfollowedAt) return 'SKIPPED_UNREACHABLE';
  return 'ELIGIBLE';
}

export function finalCampaignStatus(delivered: number, failed: number): CrmCampaignStatus {
  if (delivered > 0 && failed === 0) return 'COMPLETED';
  if (delivered > 0) return 'PARTIAL';
  return 'FAILED';
}
