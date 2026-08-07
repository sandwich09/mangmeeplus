import { redactLogValue } from '@watchdog-bms/config';

/**
 * L-09: the whole workers log pipeline.
 *
 * ponytail: no pino here. Workers depend on `@watchdog-bms/config` + `bullmq` + `ioredis` only,
 * and the spec forbids a new runtime dependency; every workers call site is a single structured
 * line, which is ~20 lines of stdlib rather than a logger framework. Reach for pino only if
 * workers ever need child loggers, transports, or sampling.
 *
 * Behaviour: one JSON line per event, deep-redacted by the same shared redactor the API and the
 * AI Gateway use, gated on LOG_LEVEL. LOG_FORMAT is not honoured because production requires
 * `json` and that is the only format emitted.
 */
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type WorkerLogLevel = (typeof LEVELS)[number];

// Read per call, not at import: workers are long-lived and specs flip these without a module reload.
function levelThreshold(): number {
  const index = LEVELS.indexOf(process.env['LOG_LEVEL'] as WorkerLogLevel);
  return index === -1 ? LEVELS.indexOf('info') : index;
}

export function workerLog(level: WorkerLogLevel, fields: Record<string, unknown>): void {
  if (LEVELS.indexOf(level) < levelThreshold()) return;
  const line = {
    level,
    service: process.env['SERVICE_NAME'] ?? 'watchdog-workers',
    time: new Date().toISOString(),
    ...fields,
  };
  const payload = process.env['LOG_REDACTION_ENABLED'] === 'false' ? line : redactLogValue(line);
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  write(JSON.stringify(payload));
}
