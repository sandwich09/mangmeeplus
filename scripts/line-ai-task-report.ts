#!/usr/bin/env node --import tsx
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '../apps/api/src/generated/prisma/client';
import { lineTaskSummary } from '../apps/api/src/modules/line-ai/application/line-ai-task-metrics';

/** No payloads or user text. A journey links the prior action's result to the next action's source. */
export async function lineAiTaskReport(client: PrismaClient, companyId: string, since: Date, until: Date) {
  const tasks = await client.lineAiTaskRun.findMany({ where: { companyId, startedAt: { gte: new Date(since.getTime() - 30 * 60_000), lt: until } }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
  const inactiveBefore = new Date(Date.now() - 30 * 60_000);
  for (const task of tasks) if (task.status === 'OPEN' && task.updatedAt < inactiveBefore) {
    const endedAt = new Date(task.updatedAt.getTime() + 30 * 60_000);
    const changed = await client.lineAiTaskRun.updateMany({ where: { id: task.id, status: 'OPEN', updatedAt: task.updatedAt },
      data: { status: 'ABANDONED', endedAt } });
    if (changed.count === 1) {
      task.status = 'ABANDONED'; task.endedAt = endedAt;
      console.error(JSON.stringify({ msg: 'line.ai.task_summary', ...await lineTaskSummary(client, task.id) }));
    }
  }
  const journeys = new Map<string, string>();
  const rows = [];
  for (const task of tasks) {
    const parent = task.sourceId ? tasks.slice().reverse().find(previous => previous.id !== task.id && previous.resultId === task.sourceId
      && previous.membershipId === task.membershipId && previous.chatKeyHash === task.chatKeyHash && previous.endedAt
      && previous.endedAt <= task.startedAt && task.startedAt.getTime() - previous.endedAt.getTime() <= 30 * 60_000) : undefined;
    const journeyId = parent ? journeys.get(parent.id) ?? parent.id : task.id;
    journeys.set(task.id, journeyId);
    if (task.startedAt < since) continue;
    rows.push({ ...await lineTaskSummary(client, task.id), journeyId, sourceType: task.sourceType, sourceId: task.sourceId,
      resultType: task.resultType, resultId: task.resultId });
  }
  return rows;
}

async function main() {
  const { values } = parseArgs({ options: { company: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('node --import tsx scripts/line-ai-task-report.ts --company ID [--since ISO] [--until ISO]'); return; }
  if (!values.company) throw new Error('--company is required');
  const until = values.until ? new Date(values.until) : new Date();
  const since = values.since ? new Date(values.since) : new Date(until.getTime() - 86400_000);
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until) throw new Error('Invalid report date range');
  const root = resolve(__dirname, '..');
  if (!process.env.DATABASE_URL) process.loadEnvFile(resolve(root, 'apps/api/.env'));
  const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try { console.log(JSON.stringify(await lineAiTaskReport(client, values.company, since, until), null, 2)); }
  finally { await client.$disconnect(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(__dirname, 'line-ai-task-report.ts')) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Task report failed'); process.exitCode = 1; });
}
