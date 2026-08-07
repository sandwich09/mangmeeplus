import type { LoggerService } from '@nestjs/common';
import { redactLogValue } from '@watchdog-bms/config';
import pino from 'pino';

export const LOGGER_TOKEN = Symbol('LOGGER');

const SENSITIVE_FIELDS = [
  'authorization',
  'password',
  'token',
  'secret',
  'cookie',
  'key',
  'prompt',
  'credential',
  'actorDelegation',
  'actorDelegations',
];

// Direct top-level paths so root-level sensitive fields are redacted in addition to nested ones.
const SENSITIVE_PATHS = [
  ...SENSITIVE_FIELDS.flatMap(k => [k, `req.headers.${k}`, `*.${k}`]),
  'req.headers["x-actor-delegation"]',
];

export { SENSITIVE_FIELDS, SENSITIVE_PATHS };

export function createLogger(opts: {
  level: string;
  redactionEnabled: boolean;
  serviceName: string;
}, destination?: pino.DestinationStream) {
  return pino({
    level: opts.level,
    // ponytail: JSON always; skip pino-pretty to avoid extra dep
    // L-09: `redact.paths` is exact-path matching with a single-level `*`, so its depth ceiling is
    // 2 — it cannot see `err.meta.password` or `payload.data.apiKey`, and it never matches
    // `apiKey`/`idToken`/`channelSecret` because it compares whole path segments, not substrings.
    // `formatters.log` runs first in pino's `asJson` (before serializers and redact stringifiers),
    // so routing the whole object through the shared recursive key-pattern redactor closes both
    // gaps. `redact.paths` is kept for the hyphenated header paths a key-name pattern cannot see
    // (`req.headers["x-actor-delegation"]`); the two are complementary, not duplicated.
    redact: opts.redactionEnabled ? { paths: SENSITIVE_PATHS, censor: '[REDACTED]' } : undefined,
    ...(opts.redactionEnabled
      ? {
          formatters: { log: redactLogValue },
          // The 2nd `logger.x(obj, msg)` argument bypasses formatters.log; scrub it too so a DSN
          // in an error message can never ride the message channel out.
          serializers: { msg: redactLogValue },
        }
      : {}),
    base: { service: opts.serviceName },
  }, destination);
}

export type AppLogger = ReturnType<typeof createLogger>;

type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Bridges Nest's `LoggerService` onto the app pino logger so module `new Logger()` calls are
 * emitted as redacted JSON instead of being dropped by `logger: false` (main.ts).
 * Nest appends the class context as the last string argument; `error()` may add a stack before it.
 */
export class NestPinoLoggerBridge implements LoggerService {
  constructor(private readonly logger: AppLogger) {}

  log(message: unknown, ...params: unknown[]): void { this.write('info', message, params); }
  warn(message: unknown, ...params: unknown[]): void { this.write('warn', message, params); }
  error(message: unknown, ...params: unknown[]): void { this.write('error', message, params); }
  debug(message: unknown, ...params: unknown[]): void { this.write('debug', message, params); }
  verbose(message: unknown, ...params: unknown[]): void { this.write('trace', message, params); }
  fatal(message: unknown, ...params: unknown[]): void { this.write('fatal', message, params); }

  private write(level: PinoLevel, message: unknown, params: unknown[]): void {
    const rest = [...params];
    const context = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    // Nest's ExceptionsHandler passes (error, context) in some versions, (message, stack, context) in others.
    const err = (message instanceof Error ? message : rest.find((p) => p instanceof Error)) as Error | undefined;
    const stack = rest.find((p) => typeof p === 'string') as string | undefined;
    const extra = {
      ...(context !== undefined ? { context } : {}),
      ...(err ? { err: { name: err.name, message: err.message, stack: err.stack } } : {}),
      ...(stack !== undefined ? { stack } : {}),
    };
    // Error own-properties are non-enumerable: spreading one would emit a content-free line.
    if (message instanceof Error) {
      this.logger[level]({ ...extra, msg: message.message });
      return;
    }
    if (message !== null && typeof message === 'object') {
      this.logger[level]({ ...(message as Record<string, unknown>), ...extra });
      return;
    }
    this.logger[level]({ ...extra, msg: String(message) });
  }
}
