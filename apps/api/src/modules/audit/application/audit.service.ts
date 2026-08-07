import { Inject, Injectable } from '@nestjs/common';
import { LOGGER_TOKEN, type AppLogger } from '../../../common/logger/logger.service';
import type { AuditLogEntry, AuditLogRecord } from '../domain/models/audit-log.model';
import type { AuditTransactionClient, IAuditRepository } from '../domain/ports/audit-repository.port';

export const AUDIT_REPOSITORY_TOKEN = 'AUDIT_REPOSITORY_TOKEN';

/** Alarm-keyed event name for an audit row that could not be persisted (L-10/L-14). */
export const AUDIT_PERSIST_FAILED_EVENT = 'audit.persist.failed';

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const MAX_METADATA_STRING_LENGTH = 512;
const MAX_METADATA_ARRAY_LENGTH = 50;
const SENSITIVE_METADATA_KEY =
  /authorization|password|token|secret|cookie|credential|api[_-]?key|raw(prompt|body|payload)|full(payload|body)|document(body|content)|body|content/i;

function sanitizeMetadata(value: unknown, key = ''): unknown {
  if (key && SENSITIVE_METADATA_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') {
    return value.length > MAX_METADATA_STRING_LENGTH
      ? `${value.slice(0, MAX_METADATA_STRING_LENGTH)}...${TRUNCATED}`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_METADATA_ARRAY_LENGTH).map((item) => sanitizeMetadata(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeMetadata(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function prepare(entry: AuditLogEntry): AuditLogEntry {
  return entry.metadataJson
    ? { ...entry, metadataJson: sanitizeMetadata(entry.metadataJson) as Record<string, unknown> }
    : entry;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_REPOSITORY_TOKEN) private readonly repo: IAuditRepository,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
  ) {}

  /**
   * Three delivery modes, deliberately different on failure (L-10):
   *
   * - `log(entry)` — post-commit. **Never throws.** Callers `await` it after their
   *   mutation already committed, so a throw here would turn a successful financial
   *   mutation into a 500 and invite a double submit. One insert, exactly one retry,
   *   then an `audit.persist.failed` error event; the promise still resolves. That
   *   non-throwing guarantee is what makes `await`-ing at every CRITICAL/HIGH
   *   financial site safe.
   * - `log(entry, tx)` — in-transaction. **Throws**, so a failed audit write rolls the
   *   mutation back atomically. No retry: the transaction is already poisoned.
   * - `logOrThrow(entry)` — pre-effect, fail-closed. See below.
   */
  async log(entry: AuditLogEntry, tx?: AuditTransactionClient): Promise<void> {
    if (tx) return this.repo.log(prepare(entry), tx);

    // The outer catch also covers prepare(), so no post-commit caller can be
    // 500'd by its own audit metadata.
    try {
      return await this.insertWithRetry(entry);
    } catch (error) {
      this.emitPersistFailure(entry, error);
    }
  }

  /**
   * M-02: fail-closed provenance. Same one insert + one retry as `log`, but the failure
   * **propagates**, so a caller that must not proceed without a durable row (the AI tool
   * boundary: `internal-tools.controller`) 500s instead of executing the tool.
   *
   * Use only *before* the side effect. After a commit use `log`, whose non-throwing
   * guarantee is what makes awaiting at every CRITICAL/HIGH financial site safe (L-10).
   */
  async logOrThrow(entry: AuditLogEntry): Promise<void> {
    try {
      return await this.insertWithRetry(entry);
    } catch (error) {
      this.emitPersistFailure(entry, error);
      throw error;
    }
  }

  /** One insert, exactly one retry: the common failure is a transient connection error. */
  private async insertWithRetry(entry: AuditLogEntry): Promise<void> {
    const sanitized = prepare(entry);
    try {
      return await this.repo.log(sanitized);
    } catch {
      // Fall through to the single retry.
    }
    return this.repo.log(sanitized);
  }

  private emitPersistFailure(entry: AuditLogEntry, error: unknown): void {
    this.logger.error(
      {
        event: AUDIT_PERSIST_FAILED_EVENT,
        // L-14: root-level riskLevel — the production metric filter keys on `$.riskLevel`,
        // so without it the one event L-10 exists to surface would page nobody.
        riskLevel: 'CRITICAL',
        action: entry.action,
        targetType: entry.targetType,
        requestId: entry.requestId,
        err: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
      },
      AUDIT_PERSIST_FAILED_EVENT,
    );
  }

  async getCompanyLogs(params: {
    companyId: string;
    actorUserId?: string;
    targetType?: string;
    categories?: string[];
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ data: AuditLogRecord[]; total: number }> {
    return this.repo.getCompanyLogs(params);
  }
}
