export const CURRENT_LEGAL_DOCUMENTS = {
  terms: {
    type: 'TERMS_OF_USE',
    version: 'v1',
    displayVersionTh: 'เวอร์ชัน 1 (v1)',
    displayVersionEn: 'Version 1 (v1)',
    effectiveDate: '2026-08-10',
    href: '/legal/releases/v1/terms-th.html',
    latestHref: '/terms',
    titleTh: 'ข้อกำหนดการใช้งาน MangmeePlus',
    titleEn: 'MangmeePlus Terms of Use',
    // SHA-256 of the exact UTF-8 bytes served from `href`. The release file is append-only:
    // changing it requires a new version, URL and hash rather than overwriting this artifact.
    artifactSha256: 'd1de74bdef45404d1c8b0e2f8d3d93c31ffd612ccea4d9ee90dcc1b4c35184c7',
    /** @deprecated Use artifactSha256. Kept temporarily for mixed-version consumers. */
    releaseFingerprintSha256: 'd1de74bdef45404d1c8b0e2f8d3d93c31ffd612ccea4d9ee90dcc1b4c35184c7',
  },
  privacy: {
    type: 'PRIVACY_NOTICE',
    version: 'v1',
    displayVersionTh: 'เวอร์ชัน 1 (v1)',
    displayVersionEn: 'Version 1 (v1)',
    effectiveDate: '2026-08-10',
    href: '/legal/releases/v1/privacy-th.html',
    latestHref: '/privacy',
    titleTh: 'ประกาศความเป็นส่วนตัว MangmeePlus',
    titleEn: 'MangmeePlus Privacy Notice',
    artifactSha256: '7b274807143af68ee51fa7bc3ec71174206a810eb9ff0de209ee81c10cb874a4',
    /** @deprecated Use artifactSha256. Kept temporarily for mixed-version consumers. */
    releaseFingerprintSha256: '7b274807143af68ee51fa7bc3ec71174206a810eb9ff0de209ee81c10cb874a4',
  },
} as const;

export const LEGAL_ACCEPTANCE_STATEMENT_VERSION = 'v1';

export type LegalAcceptanceLocale = 'th' | 'en';
export type LegalAcceptanceCapacity =
  | 'AUTHORIZED_REPRESENTATIVE'
  | 'INVITED_MEMBER'
  | 'SYSTEM_OPERATOR';

export type LegalAcceptanceStatements = {
  terms: string;
  privacy: string;
  capacity: string;
};

export type LegalAcceptanceStatusResponse = {
  required: boolean;
  acceptedAt: string | null;
  companyId: string;
  companyName: string;
  membershipId: string;
  capacity: LegalAcceptanceCapacity;
  statementVersion: string;
  terms: typeof CURRENT_LEGAL_DOCUMENTS.terms;
  privacy: typeof CURRENT_LEGAL_DOCUMENTS.privacy;
  statements: Record<LegalAcceptanceLocale, LegalAcceptanceStatements>;
  /** Server challenge over the exact localized statements and current membership context. */
  displayChallenges: Record<LegalAcceptanceLocale, string>;
};

export type AcceptLegalDocumentsInput = {
  termsVersion: string;
  privacyVersion: string;
  statementVersion: string;
  termsAccepted: true;
  privacyAcknowledged: true;
  capacityConfirmed: true;
  locale: LegalAcceptanceLocale;
  /** Echo of the challenge returned for the locale the user actually reviewed. */
  displayChallenge: string;
};

export type AcceptLegalDocumentsResponse = {
  acceptedAt: string;
  companyId: string;
  termsVersion: string;
  privacyVersion: string;
};

export function legalAcceptanceCapacity(roles: readonly string[]): LegalAcceptanceCapacity {
  if (roles.includes('SYSTEM_ADMIN')) return 'SYSTEM_OPERATOR';
  if (roles.includes('OWNER')) return 'AUTHORIZED_REPRESENTATIVE';
  return 'INVITED_MEMBER';
}

function displayVersion(
  locale: LegalAcceptanceLocale,
  document: { displayVersionTh: string; displayVersionEn: string },
): string {
  return locale === 'th' ? document.displayVersionTh : document.displayVersionEn;
}

export function legalAcceptanceStatements(
  capacity: LegalAcceptanceCapacity,
  companyName: string,
  locale: LegalAcceptanceLocale,
): LegalAcceptanceStatements {
  const termsVersion = displayVersion(locale, CURRENT_LEGAL_DOCUMENTS.terms);
  const privacyVersion = displayVersion(locale, CURRENT_LEGAL_DOCUMENTS.privacy);

  if (locale === 'en') {
    const capacityStatement = capacity === 'AUTHORIZED_REPRESENTATIVE'
      ? `I confirm that I am authorized to subscribe to the service and accept these Terms on behalf of ${companyName}.`
      : capacity === 'SYSTEM_OPERATOR'
        ? 'I confirm that I am authorized to use the platform administration account within my assigned duties.'
        : `I confirm that ${companyName} has authorized me to use the service within my assigned role and permissions.`;
    return {
      terms: `I accept the MangmeePlus Terms of Use, version ${termsVersion}.`,
      privacy: `I acknowledge that I have received and had an opportunity to read the MangmeePlus Privacy Notice, version ${privacyVersion}.`,
      capacity: capacityStatement,
    };
  }

  const capacityStatement = capacity === 'AUTHORIZED_REPRESENTATIVE'
    ? `ฉันยืนยันว่ามีอำนาจสมัครใช้บริการและยอมรับข้อกำหนดนี้แทน ${companyName}`
    : capacity === 'SYSTEM_OPERATOR'
      ? 'ฉันยืนยันว่าได้รับมอบหมายให้ใช้บัญชีผู้ดูแลระบบตามขอบเขตหน้าที่ของฉัน'
      : `ฉันยืนยันว่าได้รับอนุญาตจาก ${companyName} ให้ใช้บริการตามบทบาทและสิทธิที่กิจการกำหนด`;
  return {
    terms: `ฉันยอมรับข้อกำหนดการใช้งาน MangmeePlus ${termsVersion}`,
    privacy: `ฉันยืนยันว่าได้รับและมีโอกาสอ่านประกาศความเป็นส่วนตัว MangmeePlus ${privacyVersion} แล้ว`,
    capacity: capacityStatement,
  };
}
