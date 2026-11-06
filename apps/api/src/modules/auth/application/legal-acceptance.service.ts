import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  CURRENT_LEGAL_DOCUMENTS,
  LEGAL_ACCEPTANCE_STATEMENT_VERSION,
  LEGAL_DATA_DELETION_HREF,
  legalAcceptanceCapacity,
  legalAcceptanceStatements,
  type AcceptLegalDocumentsInput,
  type AcceptLegalDocumentsResponse,
  type LegalAcceptanceCapacity,
  type LegalAcceptanceLocale,
  type LegalAcceptanceStatusResponse,
} from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/application/audit.service';

type LegalAcceptanceLocator = {
  userId: string;
  companyId: string;
  membershipId: string;
};

export type LegalAcceptanceActor = LegalAcceptanceLocator & {
  authProvider: string;
  sessionTokenId: string;
  requestId: string;
  userAgent?: string;
};

type CurrentAcceptanceRecord = {
  batchId: string;
  documentType: 'TERMS_OF_USE' | 'PRIVACY_NOTICE';
  action: 'ACCEPTED' | 'ACKNOWLEDGED';
  documentVersion: string;
  artifactUrl: string;
  releaseFingerprintSha256: string;
  statementVersion: string;
  statementText: string;
  statementSha256: string;
  acceptedByUserId: string;
  companyId: string;
  membershipId: string;
  actorCapacity: LegalAcceptanceCapacity;
  locale: string;
  displayChallenge: string;
  acceptedAt: Date;
};

type LegalAcceptanceInputWithChallenge = AcceptLegalDocumentsInput & {
  displayChallenge: string;
};

export type LegalAcceptanceStatusWithChallenges = LegalAcceptanceStatusResponse & {
  displayChallenges: Record<LegalAcceptanceLocale, string>;
};

const TERMS_ACTION = {
  documentType: 'TERMS_OF_USE' as const,
  action: 'ACCEPTED' as const,
  documentVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
};

const PRIVACY_ACTION = {
  documentType: 'PRIVACY_NOTICE' as const,
  action: 'ACKNOWLEDGED' as const,
  documentVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
};

function currentLegalContentWhere(userId: string) {
  // Acceptance validity is content-based. scopeRef and statementVersion remain evidence/stale-form
  // controls; filtering on them here would make an unchanged artifact pair require acceptance again.
  return {
    acceptedByUserId: userId,
    OR: [
      {
        documentType: TERMS_ACTION.documentType,
        action: TERMS_ACTION.action,
        releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
      },
      {
        documentType: PRIVACY_ACTION.documentType,
        action: PRIVACY_ACTION.action,
        releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
      },
    ],
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const LEGAL_ACCEPTANCE_LOCALES: readonly LegalAcceptanceLocale[] = ['th', 'en'];

/** Changes automatically when any shared clickwrap sentence changes, even without a manual bump. */
export function legalStatementTemplateFingerprint(): string {
  return sha256(JSON.stringify(LEGAL_ACCEPTANCE_LOCALES.map((locale) => ({
    locale,
    statements: legalAcceptanceStatements(locale),
  }))));
}

type DisplayChallengeContext = LegalAcceptanceLocator & {
  companyName: string;
  capacity: LegalAcceptanceCapacity;
  locale: LegalAcceptanceLocale;
};

export function legalDisplayChallenge(context: DisplayChallengeContext): string {
  const statements = legalAcceptanceStatements(context.locale);
  return sha256(JSON.stringify([
    'MANGMEEPLUS_LEGAL_DISPLAY_CHALLENGE_V1',
    context.membershipId,
    context.userId,
    context.companyId,
    context.companyName,
    context.capacity,
    context.locale,
    LEGAL_ACCEPTANCE_STATEMENT_VERSION,
    legalStatementTemplateFingerprint(),
    CURRENT_LEGAL_DOCUMENTS.terms.type,
    CURRENT_LEGAL_DOCUMENTS.terms.version,
    CURRENT_LEGAL_DOCUMENTS.terms.href,
    CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
    CURRENT_LEGAL_DOCUMENTS.privacy.type,
    CURRENT_LEGAL_DOCUMENTS.privacy.version,
    CURRENT_LEGAL_DOCUMENTS.privacy.href,
    CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
    LEGAL_DATA_DELETION_HREF,
    statements.terms,
    statements.privacy,
    statements.deletion,
  ]));
}

/** One acceptance scope belongs to one user and one exact immutable legal-content hash pair. */
export function legalReleaseScopeRef(
  userId: string,
  release: {
    termsFingerprint: string;
    privacyFingerprint: string;
  } = {
    termsFingerprint: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
    privacyFingerprint: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
  },
): string {
  const releaseHash = sha256(JSON.stringify([
    release.termsFingerprint,
    release.privacyFingerprint,
  ]));
  return `user:${userId}:release:${releaseHash}`;
}

/**
 * P10-L (LEGAL-LIFF-01). The in-app challenge is bound to a membership, and a LIFF signup has no
 * account yet — so this is the same idea at RELEASE scope: it changes whenever the artifacts, their
 * versions or any displayed sentence change, which is exactly what "the text you agreed to" means
 * before there is a company to bind it to. Never interchangeable with `legalDisplayChallenge`:
 * a different domain-separation prefix keeps one from being replayed as the other.
 */
const LEGAL_LIFF_RELEASE_CHALLENGE_V1 = 'MANGMEEPLUS_LEGAL_LIFF_RELEASE_CHALLENGE_V1';

export type CurrentLegalRelease = Readonly<{
  documentVersion: string;
  statementSha256: string;
  releaseFingerprintSha256: string;
  displayChallenge: string;
}>;

/** What a LIFF page embeds and echoes back, and the only values a submit is allowed to store. */
export type LegalSignupEvidence = Readonly<{
  documentVersion: string;
  statementSha256: string;
  releaseFingerprintSha256: string;
  displayChallenge: string;
  locale: string;
  userAgent?: string | null;
  /** Server clock at submit — never the client's (spec §3.2). */
  legalAcceptedAt: Date;
}>;

function statementBlock(locale: LegalAcceptanceLocale): string {
  const statements = legalAcceptanceStatements(locale);
  return [statements.terms, statements.privacy, statements.deletion].join('\n');
}

export function currentLegalRelease(locale: LegalAcceptanceLocale = 'th'): CurrentLegalRelease {
  const block = statementBlock(locale);
  // The same pair hash `legalReleaseScopeRef` folds into its scope: one number for "this exact
  // pair of immutable artifacts", so the two can never disagree about what a release is.
  const releaseFingerprintSha256 = sha256(JSON.stringify([
    CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
    CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
  ]));
  const documentVersion = CURRENT_LEGAL_DOCUMENTS.terms.version;
  return {
    documentVersion,
    statementSha256: sha256(block),
    releaseFingerprintSha256,
    displayChallenge: sha256(JSON.stringify([
      LEGAL_LIFF_RELEASE_CHALLENGE_V1,
      locale,
      LEGAL_ACCEPTANCE_STATEMENT_VERSION,
      legalStatementTemplateFingerprint(),
      documentVersion,
      CURRENT_LEGAL_DOCUMENTS.privacy.version,
      releaseFingerprintSha256,
      LEGAL_DATA_DELETION_HREF,
      block,
    ])),
  };
}

/** All four values, or none: a partial match is a stale page, not a negotiation. */
export function legalEvidenceMatchesCurrentRelease(evidence: LegalSignupEvidence): boolean {
  if (evidence.locale !== 'th' && evidence.locale !== 'en') return false;
  const release = currentLegalRelease(evidence.locale);
  return evidence.documentVersion === release.documentVersion
    && evidence.statementSha256 === release.statementSha256
    && evidence.releaseFingerprintSha256 === release.releaseFingerprintSha256
    && evidence.displayChallenge === release.displayChallenge;
}

function latestAcceptedAt(records: CurrentAcceptanceRecord[]): string | null {
  if (records.length !== 2) return null;
  return new Date(Math.max(...records.map((record) => record.acceptedAt.getTime()))).toISOString();
}

@Injectable()
export class LegalAcceptanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getStatus(locator: LegalAcceptanceLocator): Promise<LegalAcceptanceStatusResponse> {
    const membership = await this.loadMembership(locator);
    const roles = membership.roles.map((entry) => entry.role.key).sort();
    const capacity = legalAcceptanceCapacity(roles);
    const systemOperator = roles.includes('SYSTEM_ADMIN');
    const demo = membership.company.reportClassification === 'DEMO';
    const records = systemOperator || demo ? [] : await this.loadCurrentRecords(locator.userId);
    const currentPair = this.findCoherentCurrentPair(records, locator.userId);
    const acceptedAt = latestAcceptedAt(currentPair);

    return {
      required: !systemOperator && !demo && acceptedAt === null,
      acceptedAt,
      companyId: membership.companyId,
      companyName: membership.company.name,
      membershipId: membership.id,
      capacity,
      statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
      terms: CURRENT_LEGAL_DOCUMENTS.terms,
      privacy: CURRENT_LEGAL_DOCUMENTS.privacy,
      statements: {
        th: legalAcceptanceStatements('th'),
        en: legalAcceptanceStatements('en'),
      },
      displayChallenges: {
        th: legalDisplayChallenge({
          ...locator,
          companyName: membership.company.name,
          capacity,
          locale: 'th',
        }),
        en: legalDisplayChallenge({
          ...locator,
          companyName: membership.company.name,
          capacity,
          locale: 'en',
        }),
      },
    };
  }

  /** Public AI needs the same current coherent acceptance, without loading a company or role. */
  async isPublicAiAcceptanceRequired(userId: string): Promise<boolean> {
    return latestAcceptedAt(this.findCoherentCurrentPair(await this.loadCurrentRecords(userId), userId)) === null;
  }

  async isRequired(locator: LegalAcceptanceLocator): Promise<boolean> {
    return (await this.getStatus(locator)).required;
  }

  /** What a pre-account surface (the LIFF signup page) must display and echo back. */
  currentRelease(locale: LegalAcceptanceLocale = 'th'): CurrentLegalRelease {
    return currentLegalRelease(locale);
  }

  /**
   * P10-L §6: replay clickwrap evidence captured on LIFF into the SAME table the in-app gate
   * reads, inside the provisioning transaction, so a shop created from LINE can send a receipt
   * immediately instead of meeting an acceptance card the flow already collected.
   *
   * Two rows, not one: `getStatus` only counts an acceptance when a coherent terms/privacy PAIR
   * exists under one batch, so writing a single row would leave the gate shut — the customer-facing
   * promise "send a receipt right now" would be a lie. The row contents are built here rather than
   * copied from the request, because the coherence check recomputes `sha256(statementText)` per row.
   *
   * Idempotent: an existing record for this user and release is left alone (a second shop for the
   * same owner, or a provisioning retry). A release that moved between submit and provisioning
   * writes NOTHING — the stale evidence is not evidence for the current text, and the ordinary
   * legal gate then does its job at first login.
   */
  async recordFromEvidence(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      companyId: string;
      membershipId: string;
      evidence: LegalSignupEvidence;
      requestId: string;
    },
  ): Promise<{ written: boolean; reason?: 'release_changed' | 'already_recorded' }> {
    if (!legalEvidenceMatchesCurrentRelease(input.evidence)) return { written: false, reason: 'release_changed' };
    const locale = input.evidence.locale as LegalAcceptanceLocale;

    const scopeRef = legalReleaseScopeRef(input.userId);
    // Read-then-write rather than catching P2002: a unique violation inside a Postgres transaction
    // aborts the whole provisioning, and "this owner already accepted" is not a failure.
    const [alreadyRecorded, priorAcceptances] = await Promise.all([
      tx.legalDocumentActionRecord.count({ where: { scopeRef } }),
      tx.legalDocumentActionRecord.count({ where: { acceptedByUserId: input.userId } }),
    ]);
    if (alreadyRecorded > 0) return { written: false, reason: 'already_recorded' };

    const statements = legalAcceptanceStatements(locale);
    const termsStatement = statements.terms;
    // Same pairing as `accept()`: the deletion procedure is a live page with no frozen artifact, so
    // its acknowledgment is evidenced on the privacy row it belongs to.
    const privacyStatement = `${statements.privacy}\n${statements.deletion}`;
    const common = {
      batchId: randomUUID(),
      scopeRef,
      statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
      acceptedByUserId: input.userId,
      companyId: input.companyId,
      membershipId: input.membershipId,
      actorCapacity: legalAcceptanceCapacity(['OWNER']),
      rolesJson: ['OWNER'],
      // Distinct from the session values this column otherwise carries ('watchdog', 'line', 'dev'):
      // those name how someone was logged in, and nobody was logged in here. This names the surface
      // the clickwrap was given on, which is what a PDPA reader has to be able to tell apart.
      // `getStatus` never filters on this column, so widening it changes no acceptance decision.
      authProvider: 'LINE_LIFF_SIGNUP',
      // There is no session: the shop is being created, and nobody has logged in yet.
      sessionTokenId: null,
      requestId: input.requestId,
      locale,
      displayChallenge: input.evidence.displayChallenge,
      surface: priorAcceptances > 0 ? 'MATERIAL_UPDATE' as const : 'FIRST_ACCEPTANCE' as const,
      userAgent: input.evidence.userAgent?.slice(0, 512) ?? null,
      // Spec §6: the moment the shop owner tapped accept, NOT the moment we provisioned.
      acceptedAt: input.evidence.legalAcceptedAt,
    };

    await tx.legalDocumentActionRecord.createMany({
      data: [
        {
          ...common,
          ...TERMS_ACTION,
          artifactUrl: CURRENT_LEGAL_DOCUMENTS.terms.href,
          releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
          statementText: termsStatement,
          statementSha256: sha256(termsStatement),
        },
        {
          ...common,
          ...PRIVACY_ACTION,
          artifactUrl: CURRENT_LEGAL_DOCUMENTS.privacy.href,
          releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
          statementText: privacyStatement,
          statementSha256: sha256(privacyStatement),
        },
      ],
    });
    return { written: true };
  }

  async accept(
    actor: LegalAcceptanceActor,
    input: LegalAcceptanceInputWithChallenge,
  ): Promise<AcceptLegalDocumentsResponse> {
    const credential = await this.prisma.client.userCredential.findUnique({
      where: { userId: actor.userId },
      select: { mustChangePassword: true },
    });
    if (credential?.mustChangePassword) {
      throw new ForbiddenException({
        code: 'password_change_required',
        message: 'Change the temporary password before accepting legal documents.',
      });
    }

    this.assertCurrentInput(input);
    const membership = await this.loadMembership(actor);
    const roles = membership.roles.map((entry) => entry.role.key).sort();
    if (roles.includes('SYSTEM_ADMIN')) {
      throw new BadRequestException({
        code: 'legal_acceptance_not_required',
        message: 'Platform system operators are not customer clickwrap parties.',
      });
    }
    const capacity = legalAcceptanceCapacity(roles);
    const expectedDisplayChallenge = legalDisplayChallenge({
      ...actor,
      companyName: membership.company.name,
      capacity,
      locale: input.locale,
    });
    if (input.displayChallenge !== expectedDisplayChallenge) {
      throw new ConflictException({
        code: 'legal_acceptance_challenge_stale',
        message: 'Your company role or the displayed legal text changed. Reload and review it again.',
        current: await this.getStatus(actor),
      });
    }
    const statements = legalAcceptanceStatements(input.locale);
    const termsStatement = statements.terms;
    // `LegalDocumentType` has no data deletion member: the deletion procedure is a live page rather
    // than a frozen artifact, so its acknowledgment is evidenced on the privacy notice row it
    // belongs to, keeping that row intelligible on its own if records are exported for a claim.
    const privacyStatement = `${statements.privacy}\n${statements.deletion}`;
    const acceptedAt = new Date();
    const batchId = randomUUID();
    const acceptanceScope = legalReleaseScopeRef(actor.userId);

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.legalDocumentActionRecord.findMany({
          where: currentLegalContentWhere(actor.userId),
          select: {
            batchId: true,
            documentType: true,
            action: true,
            documentVersion: true,
            artifactUrl: true,
            releaseFingerprintSha256: true,
            statementVersion: true,
            statementText: true,
            statementSha256: true,
            acceptedByUserId: true,
            companyId: true,
            membershipId: true,
            actorCapacity: true,
            locale: true,
            displayChallenge: true,
            acceptedAt: true,
          },
        }) as CurrentAcceptanceRecord[];

        const currentPair = this.findCoherentCurrentPair(existing, actor.userId);
        if (currentPair.length === 2) {
          return this.response(currentPair, membership.companyId);
        }
        if (existing.length !== 0) {
          throw new ConflictException({
            code: 'legal_acceptance_incomplete',
            message: 'The legal acceptance evidence is incomplete. Contact support before retrying.',
          });
        }

        const hasPriorAcceptance = await tx.legalDocumentActionRecord.count({
          // Acceptance is once per user and immutable content-hash pair. Context and UI statement
          // changes remain evidence snapshots but do not make the same user re-accept.
          where: { acceptedByUserId: actor.userId },
        }) > 0;
        const surface = hasPriorAcceptance ? 'MATERIAL_UPDATE' as const : 'FIRST_ACCEPTANCE' as const;
        const common = {
          batchId,
          scopeRef: acceptanceScope,
          statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
          acceptedByUserId: actor.userId,
          companyId: membership.companyId,
          membershipId: membership.id,
          actorCapacity: capacity,
          rolesJson: roles,
          authProvider: actor.authProvider,
          sessionTokenId: actor.sessionTokenId,
          requestId: actor.requestId,
          locale: input.locale,
          displayChallenge: expectedDisplayChallenge,
          surface,
          userAgent: actor.userAgent?.slice(0, 512) ?? null,
          acceptedAt,
        };

        const termsRecord = await tx.legalDocumentActionRecord.create({
          data: {
            ...common,
            ...TERMS_ACTION,
            artifactUrl: CURRENT_LEGAL_DOCUMENTS.terms.href,
            releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
            statementText: termsStatement,
            statementSha256: sha256(termsStatement),
          },
        });
        const privacyRecord = await tx.legalDocumentActionRecord.create({
          data: {
            ...common,
            ...PRIVACY_ACTION,
            artifactUrl: CURRENT_LEGAL_DOCUMENTS.privacy.href,
            releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
            statementText: privacyStatement,
            statementSha256: sha256(privacyStatement),
          },
        });

        await this.audit.log({
          companyId: membership.companyId,
          actorUserId: actor.userId,
          action: 'auth.legal.terms.accepted',
          targetType: 'LegalDocumentActionRecord',
          targetId: termsRecord.id,
          requestId: actor.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            batchId,
            membershipId: membership.id,
            documentVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
            actorCapacity: capacity,
          },
        }, tx);
        await this.audit.log({
          companyId: membership.companyId,
          actorUserId: actor.userId,
          action: 'auth.legal.privacy.acknowledged',
          targetType: 'LegalDocumentActionRecord',
          targetId: privacyRecord.id,
          requestId: actor.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            batchId,
            membershipId: membership.id,
            documentVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
            actorCapacity: capacity,
          },
        }, tx);

        return {
          acceptedAt: acceptedAt.toISOString(),
          companyId: membership.companyId,
          termsVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
          privacyVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
        };
      });
    } catch (error) {
      // Two tabs may submit the same immutable release together. The unique index makes one
      // transaction win; once both rows are visible the loser is a successful idempotent retry.
      if ((error as { code?: string }).code === 'P2002') {
        const current = await this.loadCurrentRecords(
          actor.userId,
        );
        const currentPair = this.findCoherentCurrentPair(current, actor.userId);
        if (currentPair.length === 2) {
          return this.response(currentPair, membership.companyId);
        }
      }
      throw error;
    }
  }

  private assertCurrentInput(input: AcceptLegalDocumentsInput): void {
    if (
      input.termsVersion !== CURRENT_LEGAL_DOCUMENTS.terms.version
      || input.privacyVersion !== CURRENT_LEGAL_DOCUMENTS.privacy.version
      || input.statementVersion !== LEGAL_ACCEPTANCE_STATEMENT_VERSION
    ) {
      throw new ConflictException({
        code: 'legal_document_version_stale',
        message: 'The legal documents changed. Reload and review the current versions before accepting.',
        current: {
          termsVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
          privacyVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
          statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
        },
      });
    }
    if (input.termsAccepted !== true || input.privacyAcknowledged !== true || input.deletionAcknowledged !== true) {
      throw new BadRequestException({
        code: 'legal_acceptance_confirmation_required',
        message: 'All required confirmations must be explicitly checked.',
      });
    }
    if (input.locale !== 'th') {
      throw new BadRequestException({
        code: 'legal_acceptance_locale_unavailable',
        message: 'Only the Thai legal artifacts are available for acceptance in this release.',
      });
    }
    if (!/^[a-f0-9]{64}$/.test(input.displayChallenge)) {
      throw new BadRequestException({
        code: 'legal_acceptance_challenge_invalid',
        message: 'The legal display challenge is invalid.',
      });
    }
  }

  private async loadMembership(locator: LegalAcceptanceLocator) {
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: {
        id: locator.membershipId,
        userId: locator.userId,
        companyId: locator.companyId,
        status: 'ACTIVE',
        OR: [
          { company: { status: 'ACTIVE' } },
          // Legal acceptance is part of authenticated recovery, not business access.
          { company: { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } } },
        ],
      },
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true, reportClassification: true } },
        roles: { select: { role: { select: { key: true } } } },
      },
    });
    if (!membership) {
      throw new ForbiddenException({
        code: 'company_access_unavailable',
        message: 'This account has no active company access.',
      });
    }
    return membership;
  }

  private async loadCurrentRecords(
    userId: string,
  ): Promise<CurrentAcceptanceRecord[]> {
    return this.prisma.client.legalDocumentActionRecord.findMany({
      where: currentLegalContentWhere(userId),
      select: {
        batchId: true,
        documentType: true,
        action: true,
        documentVersion: true,
        artifactUrl: true,
        releaseFingerprintSha256: true,
        statementVersion: true,
        statementText: true,
        statementSha256: true,
        acceptedByUserId: true,
        companyId: true,
        membershipId: true,
        actorCapacity: true,
        locale: true,
        displayChallenge: true,
        acceptedAt: true,
      },
    }) as Promise<CurrentAcceptanceRecord[]>;
  }

  private findCoherentCurrentPair(
    records: CurrentAcceptanceRecord[],
    expectedUserId: string,
  ): CurrentAcceptanceRecord[] {
    const batches = new Map<string, CurrentAcceptanceRecord[]>();
    for (const record of records) {
      const batch = batches.get(record.batchId) ?? [];
      batch.push(record);
      batches.set(record.batchId, batch);
    }
    return [...batches.values()]
      .filter((batch) => this.isCoherentCurrentPair(batch, expectedUserId))
      .sort((left, right) => (
        Math.max(...right.map((record) => record.acceptedAt.getTime()))
        - Math.max(...left.map((record) => record.acceptedAt.getTime()))
      ))[0] ?? [];
  }

  private isCoherentCurrentPair(
    records: CurrentAcceptanceRecord[],
    expectedUserId: string,
  ): boolean {
    if (records.length !== 2) return false;
    const terms = records.find((record) =>
      record.documentType === TERMS_ACTION.documentType
      && record.action === TERMS_ACTION.action,
    );
    const privacy = records.find((record) =>
      record.documentType === PRIVACY_ACTION.documentType
      && record.action === PRIVACY_ACTION.action,
    );
    if (!terms || !privacy || !terms.batchId || terms.batchId !== privacy.batchId) return false;
    if (terms.acceptedAt.getTime() !== privacy.acceptedAt.getTime() || terms.locale !== privacy.locale) return false;
    if (
      terms.companyId !== privacy.companyId
      || terms.membershipId !== privacy.membershipId
      || terms.actorCapacity !== privacy.actorCapacity
      || terms.displayChallenge !== privacy.displayChallenge
    ) return false;

    for (const record of records) {
      if (
        record.acceptedByUserId !== expectedUserId
        || !record.statementVersion
        || (record.locale !== 'th' && record.locale !== 'en')
        || record.statementSha256 !== sha256(record.statementText)
      ) return false;

      const expectedFingerprint = record.documentType === 'TERMS_OF_USE'
        ? CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256
        : CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256;
      const expectedArtifactUrl = record.documentType === 'TERMS_OF_USE'
        ? `/legal/releases/${record.documentVersion}/terms-th.html`
        : `/legal/releases/${record.documentVersion}/privacy-th.html`;
      if (
        !/^v\d+$/.test(record.documentVersion)
        || record.artifactUrl !== expectedArtifactUrl
        || record.releaseFingerprintSha256 !== expectedFingerprint
      ) {
        return false;
      }
    }
    return true;
  }

  private response(
    records: CurrentAcceptanceRecord[],
    companyId: string,
  ): AcceptLegalDocumentsResponse {
    return {
      acceptedAt: latestAcceptedAt(records)!,
      companyId,
      termsVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
      privacyVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
    };
  }
}
