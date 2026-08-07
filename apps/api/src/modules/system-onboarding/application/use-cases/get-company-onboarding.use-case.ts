import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

export type CompanyOnboardingRunDto = {
  id: string;
  companyId: string;
  ownerUserId: string;
  status: string;
  modulePackage: string | null;
  handoffUrl: string | null;
  lineAddUrl: string | null;
  lineLinkUrl: string | null;
  createdBySystemAdminUserId: string;
  completedAt: string | null;
  createdAt: string;
};

@Injectable()
export class GetCompanyOnboardingUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(onboardingRunId: string): Promise<CompanyOnboardingRunDto> {
    const run = await this.prisma.client.companyOnboardingRun.findUnique({
      where: { id: onboardingRunId },
    });
    if (!run) throw new NotFoundException(`Onboarding run "${onboardingRunId}" not found.`);

    return {
      id: run.id,
      companyId: run.companyId,
      ownerUserId: run.ownerUserId,
      status: run.status,
      modulePackage: run.modulePackage,
      handoffUrl: run.handoffUrl,
      lineAddUrl: run.lineAddUrl,
      lineLinkUrl: run.lineLinkUrl,
      createdBySystemAdminUserId: run.createdBySystemAdminUserId,
      completedAt: run.completedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
    };
  }
}
