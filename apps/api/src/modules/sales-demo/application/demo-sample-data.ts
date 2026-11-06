import { createHash } from 'node:crypto';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { createLogger } from '../../../common/logger/logger.service';
import { AuditService } from '../../audit/application/audit.service';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository';
import { PrismaExpenseRepository } from '../../expenses/infrastructure/prisma-expense.repository';
import { demoSampleRows } from './demo-data/sample-rows';
import { demoId, writeReceiptExpenses, type DemoInput } from './demo-data/expense-writes';
import { writeDemoClaims } from './demo-data/reimbursement-writes';
import { writeDemoCertificate } from './demo-data/withholding-writes';

export { demoSampleRows } from './demo-data/sample-rows';

/** A caller-owned transaction stays atomic, including repository methods that open transactions.
 * Those callbacks join this transaction instead of trying to start a nested Prisma transaction.
 */
function transactionService(tx: Prisma.TransactionClient): PrismaService {
  const client = new Proxy(tx, {
    get(target, property) {
      if (property === '$transaction') {
        return (run: (db: Prisma.TransactionClient) => Promise<unknown>) => run(target);
      }
      return Reflect.get(target, property);
    },
  });
  return { client } as unknown as PrismaService;
}

export async function populateDemoCompany(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { companyId: string; ownerUserId: string; branchId: string; now: Date },
): Promise<void> {
  const rows = demoSampleRows(input.now);
  const populate = async (tx: Prisma.TransactionClient) => {
    // Serialize retries on the whole copy. A failed write rolls back every seeded row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${demoId(input.companyId, 'populate')}))`;
    const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId } });
    if (company.reportClassification !== 'DEMO') throw new Error('Sample data requires a DEMO company');
    await tx.branch.findFirstOrThrow({ where: { id: input.branchId, companyId: input.companyId, code: 'HO', status: 'ACTIVE' } });
    const owner = await tx.companyMembership.findFirstOrThrow({ where: {
      companyId: input.companyId, userId: input.ownerUserId, status: 'ACTIVE',
      roles: { some: { role: { scopeKey: 'system', key: 'OWNER' } } },
    } });
    if (await tx.expenseRecord.findUnique({ where: { id: demoId(input.companyId, 'expense-0-1') } })) return;
    const service = transactionService(tx);
    const auditRepo = new PrismaAuditRepository(service);
    const audit = new AuditService({
      log: (entry, db) => auditRepo.log({ ...entry, actorUserId: input.ownerUserId,
        metadataJson: { ...entry.metadataJson, reason: 'demo_seed' } }, db),
      getCompanyLogs: params => auditRepo.getCompanyLogs(params),
    }, createLogger({ level: 'error', redactionEnabled: true, serviceName: 'demo-sample-data' }));
    const expenses = new PrismaExpenseRepository(service);
    const ctx: RequestContext = {
      companyId: input.companyId, userId: input.ownerUserId, authSubject: input.ownerUserId,
      membershipId: owner.id, roles: ['OWNER'], permissions: ['expense.payment.record', 'reimbursement.payment.record'],
      scopes: {}, authProvider: 'system', requestId: demoId(input.companyId, 'seed'),
    };
    await tx.user.update({ where: { id: input.ownerUserId }, data: { displayName: 'คุณมั่งมี (ตัวอย่าง)' } });
    await tx.branch.update({ where: { id: input.branchId }, data: { name: 'สาขาหลัก' } });
    await writeStaff(tx, input, rows.staff);
    const categories = await tx.expenseCategory.findMany({ where: { companyId: input.companyId } });
    const categoryMap = new Map(categories.map(category => [category.accountHintKey!, category]));
    for (const row of rows.expenses) {
      if (!categoryMap.has(row.accountHintKey)) throw new Error(`Demo expense category missing: ${row.accountHintKey}`);
    }
    await tx.accountingCounterparty.createMany({ data: rows.counterparties.map(row => ({
      id: demoId(input.companyId, row.key), companyId: input.companyId,
      type: 'VENDOR', displayName: row.displayName, legalName: row.displayName, taxId: row.taxId,
      entityKind: row.entityKind, branchCode: row.entityKind === 'JURISTIC' ? '00000' : null,
      billingAddressJson: { line1: '1 ถนนตัวอย่าง', district: 'เขตตัวอย่าง', province: 'กรุงเทพมหานคร', postalCode: '10110' },
      createdByUserId: input.ownerUserId,
    })) });
    await writeReceiptExpenses(tx, expenses, audit, ctx, input, rows, categoryMap);
    await writeDemoClaims(tx, service, expenses, audit, ctx, input, rows, categoryMap);
    await writeDemoCertificate(tx, service, audit, input, rows);
  };
  if ('$transaction' in prisma) {
    await prisma.$transaction(populate, { timeout: 30_000 });
  } else {
    await populate(prisma);
  }
}

async function writeStaff(tx: Prisma.TransactionClient, input: DemoInput, staff: ReturnType<typeof demoSampleRows>['staff']) {
  const roles = await tx.role.findMany({ where: { scopeKey: 'system', key: { in: staff.map(person => person.role) } } });
  const roleIds = new Map(roles.map(role => [role.key, role.id]));
  for (const person of staff) {
    if (!roleIds.has(person.role)) throw new Error(`Demo staff role missing: ${person.role}`);
  }
  await tx.user.createMany({ data: staff.map(person => ({
    id: demoId(input.companyId, `user-${person.role}`), displayName: person.displayName, status: 'ACTIVE',
  })) });
  await tx.companyMembership.createMany({ data: staff.map(person => ({
    id: demoId(input.companyId, `membership-${person.role}`), companyId: input.companyId,
    userId: demoId(input.companyId, `user-${person.role}`), status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: input.branchId,
  })) });
  await tx.membershipRole.createMany({ data: staff.map(person => ({
    membershipId: demoId(input.companyId, `membership-${person.role}`), roleId: roleIds.get(person.role)!,
  })) });
  await tx.employeeAccessProfile.createMany({ data: staff.map((person, index) => ({
    id: demoId(input.companyId, `profile-${person.role}`), companyId: input.companyId,
    userId: demoId(input.companyId, `user-${person.role}`), membershipId: demoId(input.companyId, `membership-${person.role}`),
    displayName: person.displayName, jobTitle: person.jobTitle, identityType: 'PASSPORT',
    identityLast4: String(index + 1).padStart(4, '0'),
    identityHash: createHash('sha256').update(demoId(input.companyId, person.role)).digest('hex'),
    identityEncryptedRef: 'demo_seed', phoneNumber: String(index + 1).padStart(10, '0'),
    status: 'ACTIVE', createdByUserId: input.ownerUserId,
  })) });
}
