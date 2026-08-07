import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignContentHash, canTransitionCampaign, finalCampaignStatus, recipientEligibility } from './crm-campaign.logic';

test('campaign transitions are terminal-safe and partial sends can resume', () => {
  assert.equal(canTransitionCampaign('READY', 'QUEUED'), true);
  assert.equal(canTransitionCampaign('COMPLETED', 'QUEUED'), false);
  assert.equal(canTransitionCampaign('PARTIAL', 'QUEUED'), true);
});

test('final boundary excludes revoked and unreachable identities', () => {
  assert.equal(recipientEligibility({ consentStatus: 'REVOKED', identityStatus: 'ACTIVE' }), 'SKIPPED_CONSENT');
  assert.equal(recipientEligibility({ consentStatus: 'GRANTED', identityStatus: 'BLOCKED' }), 'SKIPPED_UNREACHABLE');
  assert.equal(recipientEligibility({ consentStatus: 'GRANTED', identityStatus: 'ACTIVE' }), 'ELIGIBLE');
  assert.equal(recipientEligibility({ consentStatus: 'UNKNOWN', identityStatus: 'ACTIVE', marketingRequiresExplicitConsent: true }), 'SKIPPED_CONSENT');
});

test('content hash is stable and results reconcile to a terminal status', () => {
  assert.equal(campaignContentHash(' hello '), campaignContentHash('hello'));
  assert.equal(finalCampaignStatus(2, 0), 'COMPLETED');
  assert.equal(finalCampaignStatus(2, 1), 'PARTIAL');
  assert.equal(finalCampaignStatus(0, 1), 'FAILED');
});
