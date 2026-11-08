import { BadRequestException, GoneException, HttpException, HttpStatus, Injectable, InternalServerErrorException } from '@nestjs/common';
import { TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { AppConfigService } from '../../../common/config/app-config.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { generateLineHandoffToken, hashLineHandoffToken } from '../../auth/domain/logic/line-handoff.logic';
import { IssueTokenUseCase } from '../../auth/application/use-cases/issue-token.use-case';
import type { ExchangeLineHandoffTokenResult } from '../../auth/application/use-cases/exchange-line-handoff-token.use-case';
import { CreateCompanyOnboardingUseCase } from '../../system-onboarding/application/use-cases/create-company-onboarding.use-case';
import { assertPlatformTenant } from '../../sales-console/application/sales-context';
import { createHash } from 'node:crypto';
import { applyAiCreditGrant } from '../../line-ai/application/ai-credit-ledger';
import { populateDemoCompany } from './demo-sample-data';

export const DEMO_LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function expired(): GoneException {
  return new GoneException({ code: 'demo_link_expired' });
}

@Injectable()
export class SalesDemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly rateLimits: RedisRateLimitService,
    private readonly onboarding: CreateCompanyOnboardingUseCase,
    private readonly issueToken: IssueTokenUseCase,
  ) {}

  async mint(context: RequestContext, aiCredit = 50): Promise<{ url: string; expiresAt: string; aiCredit: number }> {
    if (!Number.isInteger(aiCredit) || aiCredit < 1 || aiCredit > 300) throw new BadRequestException('เครดิตทดลองต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 300 ลองใส่ใหม่อีกครั้ง');
    assertPlatformTenant(context);
    await this.quota('demo-link-mint-user', context.userId, 30);
    if (!this.config.webBaseUrl) throw new InternalServerErrorException('Web base URL is not configured.');
    const token = generateLineHandoffToken(DEMO_LINK_TTL_MS);
    await this.prisma.client.$transaction(async tx => {
      const link = await tx.salesDemoLink.create({ data: {
        tokenHash: token.tokenHash, createdByUserId: context.userId, expiresAt: token.expiresAt, aiCreditUnits: aiCredit,
      } });
      await tx.auditLog.create({ data: {
        actorUserId: context.userId, companyId: context.companyId,
        action: 'sales.demo_link.create', targetType: 'sales_demo_link', targetId: link.id,
        requestId: context.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { expiresAt: token.expiresAt.toISOString(), aiCredit },
      } });
    });
    return { url: `${this.config.webBaseUrl.replace(/\/$/, '')}/d/${token.rawToken}`, expiresAt: token.expiresAt.toISOString(), aiCredit };
  }

  async open(token: string, ip: string): Promise<ExchangeLineHandoffTokenResult> {
    await this.quota('demo-open-ip', ip, 20);
    const tokenHash = hashLineHandoffToken(token);
    return this.prisma.client.$transaction(async tx => {
      // Serialize every opener of this link through commit. A crash rolls back the company,
      // sample rows and session together. The CAS below also fences a changed/revoked link.
      await tx.$queryRaw`SELECT "id" FROM "SalesDemoLink" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const link = await tx.salesDemoLink.findUnique({ where: { tokenHash } });
      if (!link || link.revokedAt || link.expiresAt <= new Date()) throw expired();
      let companyId = link.companyId;
      if (!companyId) {
        // Spend only on a new company, after token validation and inside the per-link lock.
        await this.quota('demo-new-company-global', 'all', 60);
        const created = await this.onboarding.execute({
          companyName: 'ครัวมั่งมี (ร้านตัวอย่าง)', ownerDisplayName: 'คุณมั่งมี (ตัวอย่าง)',
          ownerAuth: { kind: 'demo' }, allowDuplicateCompanyName: true,
          planTier: 'ENTERPRISE_1999', planExpiresAt: link.expiresAt,
          entitledFeatureKeys: TIER_FEATURE_PRESETS.ENTERPRISE_1999, reportClassification: 'DEMO',
          requestingAdminUserId: link.createdByUserId, requestId: `demo-open-${link.id}`,
          webBaseUrl: this.config.webBaseUrl ?? '', apiBaseUrl: this.config.publicApiBaseUrl ?? '',
        }, tx);
        companyId = created.companyId;
        const now = new Date();
        await tx.externalIdentity.create({ data: { userId: created.ownerId, provider: 'LINE', providerChannelId: 'demo-web', providerUserId: `Vdemo${companyId}`, status: 'ACTIVE' } });
        await tx.lineChannelBinding.create({ data: { companyId, messagingChannelId: 'demo-web', status: 'ACTIVE' } });
        await tx.companyAiConfiguration.upsert({ where: { companyId },
          create: { companyId, ocrMonthlyLimit: 3, aiCreditCutoverAt: now },
          update: { ocrMonthlyLimit: 3, aiCreditCutoverAt: now } });
        await applyAiCreditGrant(tx, { companyId, billingAccountId: null, sourceKind: 'SALES_EVENT',
          units: link.aiCreditUnits * 100, sourceKey: `sales-demo:${link.id}`,
          sourceHash: createHash('sha256').update(JSON.stringify([link.id, companyId, link.aiCreditUnits * 100])).digest('hex'), at: now });
        const branch = await tx.branch.findFirstOrThrow({ where: { companyId, code: 'HO' }, select: { id: true } });
        await populateDemoCompany(tx, { companyId, ownerUserId: created.ownerId, branchId: branch.id, now: new Date() });
        const claimed = await tx.salesDemoLink.updateMany({
          where: { id: link.id, companyId: null, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { companyId, openedAt: new Date() },
        });
        if (claimed.count !== 1) throw expired();
      }
      const owner = await tx.companyMembership.findFirst({
        where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' },
          company: { status: 'ACTIVE', reportClassification: 'DEMO' },
          roles: { some: { role: { key: 'OWNER', status: 'ACTIVE' } } } },
        select: { userId: true },
      });
      if (!owner || link.expiresAt <= new Date()) throw expired();
      const tokens = await this.issueToken.execute(owner.userId, 'demo', { expiresAt: link.expiresAt, companyId, tx });
      return { ...tokens, companyId, targetPath: `/companies/${companyId}/dashboard`,
        mustChangePassword: false, legalAcceptanceRequired: false };
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  private async quota(scope: string, key: string, max: number): Promise<void> {
    const decision = await this.rateLimits.consume(scope, key, max, 3600);
    if (!decision.allowed) throw new HttpException({ code: 'demo_rate_limited', retryAfterSeconds: decision.retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
