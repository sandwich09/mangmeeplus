import type {
  AcceptLegalDocumentsInput,
  LegalAcceptanceStatusResponse,
} from '@watchdog-bms/contracts';

/** Build the immutable audit payload from the release returned by the API, never from UI labels. */
export function buildLegalAcceptanceInput(
  status: LegalAcceptanceStatusResponse,
): AcceptLegalDocumentsInput {
  return {
    termsVersion: status.terms.version,
    privacyVersion: status.privacy.version,
    statementVersion: status.statementVersion,
    termsAccepted: true,
    privacyAcknowledged: true,
    capacityConfirmed: true,
    // The current immutable Terms and Privacy artifacts are Thai. English
    // acceptance stays disabled until separately versioned English artifacts exist.
    locale: 'th',
    displayChallenge: status.displayChallenges.th,
  };
}
