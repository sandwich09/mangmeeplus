import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReimbursementProjectionReconcilerService } from '../modules/reimbursements/application/services/reimbursement-projection-reconciler.service';

async function main(): Promise<void> {
  Logger.overrideLogger(false);
  const context = await NestFactory.createApplicationContext(AppModule);
  try {
    const reconciler = context.get(ReimbursementProjectionReconcilerService);
    const limit = Number.parseInt(process.env.REIMBURSEMENT_RECONCILE_LIMIT ?? '100', 10);
    const result = await reconciler.execute(Number.isFinite(limit) && limit > 0 ? limit : 100);
    console.log(JSON.stringify(result));
    if (result.failed.length) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
