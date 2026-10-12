import { formatCompanyLegalAddressForPrint, type CompanyLegalAddress } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client.js';

/** Once per request, including a whole page of handoffs. The address is the worded print form: it is stored on the certificate as text. */
export async function currentWhtPayerDetails(db: Pick<Prisma.TransactionClient, 'company' | 'companyTaxProfile'>, companyId: string) {
  const [company, profile] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { taxId: true, addressJson: true } }),
    db.companyTaxProfile.findUnique({ where: { companyId }, select: { taxId: true } }),
  ]);
  return { taxId: profile?.taxId ?? company?.taxId ?? null, address: formatCompanyLegalAddressForPrint(company?.addressJson as CompanyLegalAddress | null) };
}
