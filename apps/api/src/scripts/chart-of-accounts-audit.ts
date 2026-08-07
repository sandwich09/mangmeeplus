import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import {
  TH_SME_COA_V1,
  TH_SME_COA_V1_MAPPING_MANIFEST,
} from '../modules/ledger/domain/catalog/th-sme-chart-of-accounts-v1.js';
import {
  loadChartReadiness,
  loadChartTemplatePreview,
} from '../modules/ledger/application/services/chart-template-query.service.js';
import {
  buildChartAuditReport,
  chartAuditReportToCsv,
  DEFAULT_CONFLICT_SAMPLE_LIMIT,
  MAX_CONFLICT_SAMPLE_LIMIT,
  safeChartAuditErrorCode,
  summarizeChartAuditCompany,
  type ChartAuditCompany,
} from './chart-of-accounts-audit.logic.js';

function parseOptions(argv: string[]): { outputDir: string; conflictSampleLimit: number } {
  let outputDir = resolve(process.cwd(), 'chart-of-accounts-audit-evidence');
  let conflictSampleLimit = DEFAULT_CONFLICT_SAMPLE_LIMIT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--output-dir') {
      const value = argv[index + 1];
      if (!value) throw new Error('coa_audit_output_dir_required');
      outputDir = resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--conflict-sample-limit') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > MAX_CONFLICT_SAMPLE_LIMIT) {
        throw new Error(`coa_audit_conflict_sample_limit_must_be_0_to_${MAX_CONFLICT_SAMPLE_LIMIT}`);
      }
      conflictSampleLimit = value;
      index += 1;
      continue;
    }
    throw new Error(`coa_audit_unknown_argument_${argument}`);
  }
  return { outputDir, conflictSampleLimit };
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('coa_audit_database_url_required');
  const options = parseOptions(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const generatedAt = new Date().toISOString();

  try {
    const companies = await prisma.company.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const results: ChartAuditCompany[] = [];
    for (const company of companies) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          const preview = await loadChartTemplatePreview(tx, company.id);
          const readiness = await loadChartReadiness(tx, company.id, preview);
          return summarizeChartAuditCompany({
            companyId: company.id,
            preview,
            readiness,
            conflictSampleLimit: options.conflictSampleLimit,
          });
        }, { maxWait: 5_000, timeout: 120_000 });
        results.push(result);
      } catch (error) {
        results.push({
          companyId: company.id,
          status: 'ERROR',
          errorCode: safeChartAuditErrorCode(error),
        });
      }
    }

    const report = buildChartAuditReport({
      generatedAt,
      conflictSampleLimit: options.conflictSampleLimit,
      template: {
        key: TH_SME_COA_V1.key,
        version: TH_SME_COA_V1.version,
        accountsChecksum: TH_SME_COA_V1.accountsChecksum,
        mappingManifestVersion: TH_SME_COA_V1_MAPPING_MANIFEST.version,
        mappingManifestChecksum: TH_SME_COA_V1.mappingManifestChecksum,
      },
      companies: results,
    });
    const runId = generatedAt.replace(/[:.]/g, '-');
    const jsonPath = resolve(options.outputDir, `chart-of-accounts-audit-${runId}.json`);
    const csvPath = resolve(options.outputDir, `chart-of-accounts-audit-${runId}.csv`);
    await mkdir(options.outputDir, { recursive: true });
    await Promise.all([
      writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
      writeFile(csvPath, chartAuditReportToCsv(report), { encoding: 'utf8', flag: 'wx' }),
    ]);
    console.log(JSON.stringify({
      event: 'chart_of_accounts_audit_complete',
      jsonPath,
      csvPath,
      summary: report.summary,
    }));
    if (report.summary.failedCompanyCount > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    event: 'chart_of_accounts_audit_failed',
    errorCode: safeChartAuditErrorCode(error),
  }));
  process.exit(1);
});
