import DataRightsNewPage, { type DataRightsRemediationSeed } from '@/features/system-data-rights/DataRightsNewPage';
import { DATA_RIGHTS_CASE_TYPES, type DataRightsCaseType } from '@watchdog-bms/contracts';

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function SystemDataRightsNewRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const caseTypeValue = one(query.caseType);
  const remediation: DataRightsRemediationSeed = {
    priorCaseReference: one(query.priorCaseReference),
    caseType: caseTypeValue && DATA_RIGHTS_CASE_TYPES.includes(caseTypeValue as DataRightsCaseType)
      ? caseTypeValue as DataRightsCaseType
      : undefined,
    targetUserId: one(query.targetUserId),
    companyId: one(query.companyId),
    membershipId: one(query.membershipId),
  };
  return <DataRightsNewPage remediation={remediation} />;
}
