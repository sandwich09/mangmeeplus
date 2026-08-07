import type { Prisma } from '../../../../generated/prisma/client';
import type { AuditLogEntry, AuditLogRecord } from '../models/audit-log.model';

/**
 * Prisma interactive-transaction client — the argument a `$transaction(async (tx) => …)`
 * callback receives. Passing one makes the audit row part of the caller's transaction.
 */
export type AuditTransactionClient = Prisma.TransactionClient;

export interface IAuditRepository {
  /** Writes the audit row on `tx` when given, otherwise on the root client. Throws on failure. */
  log(entry: AuditLogEntry, tx?: AuditTransactionClient): Promise<void>;
  getCompanyLogs(params: {
    companyId: string;
    actorUserId?: string;
    targetType?: string;
    categories?: string[];
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ data: AuditLogRecord[]; total: number }>;
}
