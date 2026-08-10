import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_LEGAL_DOCUMENTS,
  LEGAL_ACCEPTANCE_STATEMENT_VERSION,
  legalAcceptanceStatements,
  type LegalAcceptanceStatusResponse,
} from '@watchdog-bms/contracts';
import { buildLegalAcceptanceInput } from './legal-acceptance.logic';

function status(): LegalAcceptanceStatusResponse {
  return {
    required: true,
    acceptedAt: null,
    companyId: 'company-1',
    companyName: 'บริษัท ตัวอย่าง จำกัด',
    membershipId: 'membership-1',
    capacity: 'AUTHORIZED_REPRESENTATIVE',
    statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
    terms: CURRENT_LEGAL_DOCUMENTS.terms,
    privacy: CURRENT_LEGAL_DOCUMENTS.privacy,
    statements: {
      th: legalAcceptanceStatements('AUTHORIZED_REPRESENTATIVE', 'บริษัท ตัวอย่าง จำกัด', 'th'),
      en: legalAcceptanceStatements('AUTHORIZED_REPRESENTATIVE', 'บริษัท ตัวอย่าง จำกัด', 'en'),
    },
    displayChallenges: {
      th: 'a'.repeat(64),
      en: 'b'.repeat(64),
    },
  };
}

describe('buildLegalAcceptanceInput', () => {
  it('pairs the displayed Thai statements with the same immutable artifacts users open', () => {
    const displayed = status();
    assert.equal(displayed.terms.href, '/legal/releases/v2/terms-th.html');
    assert.equal(displayed.privacy.href, '/legal/releases/v2/privacy-th.html');
    assert.ok(displayed.statements.th.terms.includes(displayed.terms.displayVersionTh));
    assert.ok(displayed.statements.th.privacy.includes(displayed.privacy.displayVersionTh));
    assert.match(displayed.terms.artifactSha256, /^[a-f0-9]{64}$/);
    assert.match(displayed.privacy.artifactSha256, /^[a-f0-9]{64}$/);
  });

  it('records explicit terms acceptance, privacy acknowledgment and authority confirmation separately', () => {
    assert.deepEqual(buildLegalAcceptanceInput(status()), {
      termsVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
      privacyVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
      statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
      termsAccepted: true,
      privacyAcknowledged: true,
      capacityConfirmed: true,
      locale: 'th',
      displayChallenge: 'a'.repeat(64),
    });
  });
});
