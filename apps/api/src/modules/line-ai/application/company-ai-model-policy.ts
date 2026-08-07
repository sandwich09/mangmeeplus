import type { AiModelPolicy } from '@watchdog-bms/contracts';
import type { PrismaService } from '../../../common/database/prisma.service';

/** Resolves the system-admin managed tenant setting at call time; stale/unapproved rows fail closed. */
export async function resolveCompanyAiModelPolicy(
  prisma: PrismaService,
  companyId: string,
  approvedModelIds: string[],
): Promise<AiModelPolicy | undefined> {
  const repository = (prisma.client as any).companyAiConfiguration as
    | { findUnique(args: unknown): Promise<{ modelId: string | null } | null> }
    | undefined;
  // Direct unit-test fakes created before CompanyAiConfiguration existed omit this delegate.
  // The generated production PrismaClient always exposes it.
  if (!repository) return undefined;
  const model = await repository.findUnique({
    where: { companyId },
    select: { modelId: true },
  });
  // A row that only carries a budget leaves modelId null: inherit the platform default,
  // exactly like an absent row (metering spec §6.8). Non-null values still fail closed below.
  if (!model || model.modelId == null) return undefined;
  if (!approvedModelIds.includes(model.modelId)) throw new Error('TENANT_AI_MODEL_NOT_APPROVED');
  return { modelId: model.modelId };
}
