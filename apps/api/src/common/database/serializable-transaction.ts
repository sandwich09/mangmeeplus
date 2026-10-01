import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from './prisma.service';

/** Retry only transactions PostgreSQL rolled back for a serialization/deadlock conflict.
 * The callback must contain transactional DB work only; never send external side effects here.
 */
export async function serializableTransaction<T>(
  client: Pick<PrismaService['client'], '$transaction'>, work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await client.$transaction(work, { isolationLevel: 'Serializable' }); }
    catch (error) {
      if (attempt >= 4 || (error as { code?: string }).code !== 'P2034') throw error;
    }
  }
}
