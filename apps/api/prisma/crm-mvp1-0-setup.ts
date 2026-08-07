// MVP1-0 pilot-tenant setup + verification (Dev A A2).
//
// Verifies (and with --apply, configures) a company for the CRM LINE OA inbox
// pilot: CRM feature entitlement enabled, LINE OA channel present, PDPA notice
// complete. Idempotent. The PASS/WARN/FAIL rules live in the unit-tested pure
// logic (crm-inbox/domain/logic/mvp1-0-setup.logic.ts); this file only loads the
// tenant snapshot and applies the entitlement fix.
//
// Usage (from apps/api):
//   DATABASE_URL=... pnpm exec tsx prisma/crm-mvp1-0-setup.ts <companyId>          # verify only
//   DATABASE_URL=... pnpm exec tsx prisma/crm-mvp1-0-setup.ts <companyId> --apply  # enable crm entitlement
//   DATABASE_URL=... MVP10_COMPANY_ID=<id> pnpm exec tsx prisma/crm-mvp1-0-setup.ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { CRM_INBOX_ENTITLEMENT_KEY, PDPA_CONSENT_NOTICE_TEXT } from '../src/modules/crm-inbox/domain/crm-inbox.constants';
import { evaluateMvp10Setup, type Mvp10SetupState, type SetupCheckStatus } from '../src/modules/crm-inbox/domain/logic/mvp1-0-setup.logic';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const companyId = args.find((a) => !a.startsWith('--')) ?? process.env['MVP10_COMPANY_ID'];

if (!companyId) {
  console.error('Usage: tsx prisma/crm-mvp1-0-setup.ts <companyId> [--apply]  (or set MVP10_COMPANY_ID)');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
const prisma = new PrismaClient({ adapter });

async function loadState(): Promise<Mvp10SetupState> {
  const [company, entitlementRows, channels] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId! }, select: { name: true, status: true } }),
    prisma.companyFeatureEntitlement.findMany({ where: { companyId: companyId! }, select: { featureKey: true, enabled: true } }),
    prisma.companyMessagingChannel.findMany({ where: { companyId: companyId! }, select: { status: true } }),
  ]);

  // null = no rows at all (legacy fail-open), mirroring loadEntitledFeatureKeys().
  const entitledFeatureKeys =
    entitlementRows.length === 0 ? null : new Set(entitlementRows.filter((r) => r.enabled).map((r) => r.featureKey));
  const crmEntitlementDisabled = entitlementRows.some((r) => r.featureKey === CRM_INBOX_ENTITLEMENT_KEY && !r.enabled);

  return {
    companyId: companyId!,
    company,
    entitledFeatureKeys,
    crmEntitlementDisabled,
    channels: channels.map((c) => ({ status: c.status })),
    pdpaNoticeText: PDPA_CONSENT_NOTICE_TEXT,
  };
}

const ICON: Record<SetupCheckStatus, string> = { PASS: '✓', WARN: '!', FAIL: '✗' };

async function main() {
  if (apply) {
    const company = await prisma.company.findUnique({ where: { id: companyId! }, select: { id: true } });
    if (!company) throw new Error(`Company not found: ${companyId}`);
    await prisma.companyFeatureEntitlement.upsert({
      where: { companyId_featureKey: { companyId: companyId!, featureKey: CRM_INBOX_ENTITLEMENT_KEY } },
      update: { enabled: true },
      create: { companyId: companyId!, featureKey: CRM_INBOX_ENTITLEMENT_KEY, enabled: true },
    });
    console.log(`[apply] entitlement "${CRM_INBOX_ENTITLEMENT_KEY}" enabled for ${companyId}\n`);
  }

  const report = evaluateMvp10Setup(await loadState());
  console.log(`MVP1-0 setup — company ${report.companyId}${apply ? ' (after --apply)' : ''}`);
  for (const c of report.checks) console.log(`  ${ICON[c.status]} [${c.status}] ${c.key}: ${c.message}`);
  console.log(report.ready ? '\nREADY: no blocking failures.' : '\nNOT READY: fix the ✗ items above (try --apply).');
  if (!report.ready) process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
