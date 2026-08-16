import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { buildLineAiReconciliationReport } from '../modules/line-ai/domain/logic/line-ai-reconciliation.logic';

const PAGE_SIZE = 1_000;
const MAX_ROWS = 100_000;

function parseArgs(argv: string[]): { from: Date; to: Date; companyId?: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--') continue;
    if (!key?.startsWith('--') || !argv[index + 1]) throw new Error('LINE_AI_RECONCILIATION_ARGUMENT_INVALID');
    values.set(key, argv[index + 1]);
    index += 1;
  }
  const from = new Date(values.get('--from') ?? '');
  const to = new Date(values.get('--to') ?? '');
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error('LINE_AI_RECONCILIATION_WINDOW_INVALID');
  }
  const companyId = values.get('--company-id');
  return { from, to, ...(companyId ? { companyId } : {}) };
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('LINE_AI_RECONCILIATION_DATABASE_URL_REQUIRED');
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const rows: Array<{ webhookEventId: string; status: string; errorCode: string | null; payloadPresent: boolean }> = [];
  let cursor: string | undefined;
  try {
    while (true) {
      const page = await prisma.lineWebhookEventLog.findMany({
        where: {
          createdAt: { gte: options.from, lt: options.to },
          ...(options.companyId ? { companyId: options.companyId } : {}),
        },
        select: { id: true, webhookEventId: true, status: true, errorCode: true, payloadJson: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const item of page) {
        rows.push({
          webhookEventId: item.webhookEventId,
          status: item.status,
          errorCode: item.errorCode,
          payloadPresent: item.payloadJson !== null,
        });
      }
      if (rows.length > MAX_ROWS) throw new Error('LINE_AI_RECONCILIATION_ROW_LIMIT_EXCEEDED');
      if (page.length < PAGE_SIZE) break;
      cursor = page.at(-1)?.id;
    }
    const report = buildLineAiReconciliationReport(rows);
    console.log(JSON.stringify({
      event: 'line_ai_reconciliation_complete',
      window: { from: options.from.toISOString(), to: options.to.toISOString() },
      companyScoped: Boolean(options.companyId),
      ...report,
    }, null, 2));
    if (!report.reconciled) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  console.error(JSON.stringify({
    event: 'line_ai_reconciliation_failed',
    errorCode: message.startsWith('LINE_AI_RECONCILIATION_')
      ? message
      : 'LINE_AI_RECONCILIATION_QUERY_FAILED',
  }));
  process.exitCode = 1;
});
