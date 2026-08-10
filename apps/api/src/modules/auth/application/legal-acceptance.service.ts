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
  legalAcceptanceCapacity,
  legalAcceptanceStatements,
  type AcceptLegalDocumentsInput,
  type AcceptLegalDocumentsResponse,
  type LegalAcceptanceCapacity,
  type LegalAcceptanceLocale,
  type LegalAcceptanceStatusResponse,
} from '@watchdog-bms/contracts';
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const LEGAL_ACCEPTANCE_CAPACITIES: readonly LegalAcceptanceCapacity[] = [
  'AUTHORIZED_REPRESENTATIVE',
  'INVITED_MEMBER',
  'SYSTEM_OPERATOR',
];
const LEGAL_ACCEPTANCE_LOCALES: readonly LegalAcceptanceLocale[] = ['th', 'en'];
const STATEMENT_TEMPLATE_COMPANY_SENTINEL = '__MANGMEEPLUS_COMPANY_NAME__';

/** Changes automatically when any shared clickwrap sentence changes, even without a manual bump. */
export function legalStatementTemplateFingerprint(): string {
  return sha256(JSON.stringify(LEGAL_ACCEPTANCE_CAPACITIES.flatMap((capacity) =>
    LEGAL_ACCEPTANCE_LOCALES.map((locale) => ({
      capacity,
      locale,
      statements: legalAcceptanceStatements(capacity, STATEMENT_TEMPLATE_COMPANY_SENTINEL, locale),
    })),
  )));
}

type DisplayChallengeContext = LegalAcceptanceLocator & {
  companyName: string;
  capacity: LegalAcceptanceCapacity;
  locale: LegalAcceptanceLocale;
};

export function legalDisplayChallenge(context: DisplayChallengeContext): string {
  const statements = legalAcceptanceStatements(context.capacity, context.companyName, context.locale);
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
    statements.terms,
    statements.privacy,
    statements.capacity,
  ]));
}

/**
 * One acceptance scope belongs to one user and one exact released document pair. Company,
 * membership and capacity are captured as evidence at acceptance time, but switching context does
 * not ask the same user again. Immutable URLs and byte hashes still fail closed on any copy change.
 */
export function legalReleaseScopeRef(
  userId: string,
  release: {
    statementVersion: string;
    termsVersion: string;
    termsArtifactUrl: string;
    termsFingerprint: string;
    privacyVersion: string;
    privacyArtifactUrl: string;
    privacyFingerprint: string;
    statementTemplateFingerprint: string;
  } = {
    statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
    termsVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
    termsArtifactUrl: CURRENT_LEGAL_DOCUMENTS.terms.href,
    termsFingerprint: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
    privacyVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
    privacyArtifactUrl: CURRENT_LEGAL_DOCUMENTS.privacy.href,
    privacyFingerprint: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
    statementTemplateFingerprint: legalStatementTemplateFingerprint(),
  },
): string {
  const releaseHash = sha256(JSON.stringify([
    release.statementVersion,
    release.termsVersion,
    release.termsArtifactUrl,
    release.termsFingerprint,
    release.privacyVersion,
    release.privacyArtifactUrl,
    release.privacyFingerprint,
    release.statementTemplateFingerprint,
  ]));
  return `user:${userId}:release:${releaseHash}`;
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
    const records = systemOperator ? [] : await this.loadCurrentRecords(locator.userId);
    const acceptedAt = this.isCoherentCurrentPair(records, locator.userId)
      ? latestAcceptedAt(records)
      : null;

    return {
      required: !systemOperator && acceptedAt === null,
      acceptedAt,
      companyId: membership.companyId,
      companyName: membership.company.name,
      membershipId: membership.id,
      capacity,
      statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
      terms: CURRENT_LEGAL_DOCUMENTS.terms,
      privacy: CURRENT_LEGAL_DOCUMENTS.privacy,
      statements: {
        th: legalAcceptanceStatements(capacity, membership.company.name, 'th'),
        en: legalAcceptanceStatements(capacity, membership.company.name, 'en'),
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

  async isRequired(locator: LegalAcceptanceLocator): Promise<boolean> {
    return (await this.getStatus(locator)).required;
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
    const statements = legalAcceptanceStatements(capacity, membership.company.name, input.locale);
    // The authority statement is part of each clickwrap evidence row, so either document row
    // remains independently intelligible if records are later exported for a legal claim.
    const termsStatement = `${statements.terms}\n${statements.capacity}`;
    const privacyStatement = `${statements.privacy}\n${statements.capacity}`;
    const acceptedAt = new Date();
    const batchId = randomUUID();
    const acceptanceScope = legalReleaseScopeRef(actor.userId);

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.legalDocumentActionRecord.findMany({
          where: {
            scopeRef: acceptanceScope,
            statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
            OR: [
              {
                ...TERMS_ACTION,
                releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
              },
              {
                ...PRIVACY_ACTION,
                releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
              },
            ],
          },
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

        if (this.isCoherentCurrentPair(existing, actor.userId)) {
          return this.response(existing, membership.companyId);
        }
        if (existing.length !== 0) {
          throw new ConflictException({
            code: 'legal_acceptance_incomplete',
            message: 'The legal acceptance evidence is incomplete. Contact support before retrying.',
          });
        }

        const hasPriorAcceptance = await tx.legalDocumentActionRecord.count({
          // Acceptance is once per user and released document pair. Company, membership and
          // capacity remain immutable evidence snapshots but do not make the same user re-accept.
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
        if (this.isCoherentCurrentPair(current, actor.userId)) {
          return this.response(current, membership.companyId);
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
    if (input.termsAccepted !== true || input.privacyAcknowledged !== true || input.capacityConfirmed !== true) {
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
        company: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        companyId: true,
        company: { select: { name: true } },
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
      where: {
        scopeRef: legalReleaseScopeRef(userId),
        statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
        OR: [
          {
            ...TERMS_ACTION,
            releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
          },
          {
            ...PRIVACY_ACTION,
            releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
          },
        ],
      },
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

  private isCoherentCurrentPair(
    records: CurrentAcceptanceRecord[],
    expectedUserId: string,
  ): boolean {
    if (records.length !== 2) return false;
    const terms = records.find((record) =>
      record.documentType === TERMS_ACTION.documentType
      && record.action === TERMS_ACTION.action
      && record.documentVersion === TERMS_ACTION.documentVersion,
    );
    const privacy = records.find((record) =>
      record.documentType === PRIVACY_ACTION.documentType
      && record.action === PRIVACY_ACTION.action
      && record.documentVersion === PRIVACY_ACTION.documentVersion,
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
        || record.statementVersion !== LEGAL_ACCEPTANCE_STATEMENT_VERSION
        || (record.locale !== 'th' && record.locale !== 'en')
        || record.statementSha256 !== sha256(record.statementText)
      ) return false;

      const expectedFingerprint = record.documentType === 'TERMS_OF_USE'
        ? CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256
        : CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256;
      const expectedArtifactUrl = record.documentType === 'TERMS_OF_USE'
        ? CURRENT_LEGAL_DOCUMENTS.terms.href
        : CURRENT_LEGAL_DOCUMENTS.privacy.href;
      if (
        record.artifactUrl !== expectedArtifactUrl
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
