import { DeleteObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { workerLog } from '../../common/log.js';

const CLAIM_PATH = '/internal/storage-cleanup/object-versions/claim';
const TASK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CLAIM_TOKEN = /^[A-Za-z0-9-]{1,128}$/;
const COMPANY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const OBJECT_PATH = /^[A-Za-z0-9._/-]{1,1024}$/;
const VERSION_ID = /^[A-Za-z0-9._~+/=-]{1,1024}$/;

export const OBJECT_VERSION_CLEANUP_SOURCES = [
  'ATTACHMENT_FINALIZATION',
  'REPORT_EXPORT',
  'SUBSTITUTE_RECEIPT_CERTIFIED',
  'SUBSTITUTE_RECEIPT_ISSUED',
] as const;

type CleanupSource = (typeof OBJECT_VERSION_CLEANUP_SOURCES)[number];

export type ObjectVersionCleanupWorkerConfig = {
  internalApiUrl: string;
  workerToken: string;
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type ObjectVersionCleanupTask = {
  id: string;
  claimToken: string;
  attempt: number;
  companyId: string;
  bucket: string;
  path: string;
  expectedVersion: string;
  source: CleanupSource;
};

type FetchLike = typeof fetch;
type S3DeleteClient = { send(command: DeleteObjectCommand): Promise<unknown> };

export function createObjectVersionCleanupS3Client(config: ObjectVersionCleanupWorkerConfig): S3Client {
  const s3Config: S3ClientConfig = {
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.forcePathStyle !== undefined ? { forcePathStyle: config.forcePathStyle } : {}),
    ...(config.accessKeyId && config.secretAccessKey
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
  };
  return new S3Client(s3Config);
}

export async function drainObjectVersionCleanup(
  config: ObjectVersionCleanupWorkerConfig,
  dependencies: { s3?: S3DeleteClient; fetchImpl?: FetchLike } = {},
): Promise<{ claimed: number; completed: number; failed: number; stale: number; reclaimed: number; dead: number }> {
  assertWorkerConfig(config);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const s3 = dependencies.s3 ?? createObjectVersionCleanupS3Client(config);
  const claim = await postJson(fetchImpl, config, CLAIM_PATH, { batchSize: 10 });
  const claimed = parseClaimResponse(claim);
  let completed = 0;
  let failed = 0;
  let stale = 0;
  let infrastructureFailure: Error | undefined;

  for (const rawTask of claimed.tasks) {
    let taskIdentity: { id: string; claimToken: string; attempt: number };
    try {
      taskIdentity = parseTaskIdentity(rawTask);
    } catch (error) {
      workerLog('error', { event: 'object_version_cleanup_claim_invalid', error: safeErrorName(error) });
      infrastructureFailure ??= new Error('Object-version cleanup claim identity is invalid.');
      continue;
    }

    let task: ObjectVersionCleanupTask;
    try {
      task = parseObjectVersionCleanupTask(rawTask, config.bucket);
    } catch (error) {
      workerLog('error', {
        event: 'object_version_cleanup_payload_rejected',
        taskId: taskIdentity.id,
        attempt: taskIdentity.attempt,
        error: safeErrorName(error),
      });
      try {
        const result = await postJson(
          fetchImpl,
          config,
          `/internal/storage-cleanup/object-versions/${encodeURIComponent(taskIdentity.id)}/fail`,
          { claimToken: taskIdentity.claimToken, errorCode: 'cleanup_payload_invalid' },
        );
        if (parseWritten(result)) failed += 1;
        else stale += 1;
      } catch (reportError) {
        infrastructureFailure ??= asError(reportError);
      }
      continue;
    }

    let outcome: 'deleted' | 'already_absent' = 'deleted';
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: task.bucket,
        Key: task.path,
        VersionId: task.expectedVersion,
      }));
    } catch (error) {
      if (isNoSuchVersion(error)) {
        outcome = 'already_absent';
      } else {
        const errorCode = cleanupFailureCode(error);
        workerLog('warn', {
          event: 'object_version_cleanup_delete_failed',
          taskId: task.id,
          attempt: task.attempt,
          source: task.source,
          errorCode,
        });
        try {
          const result = await postJson(
            fetchImpl,
            config,
            `/internal/storage-cleanup/object-versions/${encodeURIComponent(task.id)}/fail`,
            { claimToken: task.claimToken, errorCode },
          );
          if (parseWritten(result)) failed += 1;
          else stale += 1;
        } catch (reportError) {
          infrastructureFailure ??= asError(reportError);
        }
        continue;
      }
    }

    try {
      const result = await postJson(
        fetchImpl,
        config,
        `/internal/storage-cleanup/object-versions/${encodeURIComponent(task.id)}/complete`,
        { claimToken: task.claimToken },
      );
      if (parseWritten(result)) {
        completed += 1;
        workerLog('info', {
          event: 'object_version_cleanup_completed',
          taskId: task.id,
          attempt: task.attempt,
          source: task.source,
          outcome,
        });
      } else {
        stale += 1;
        workerLog('warn', { event: 'object_version_cleanup_lease_lost', taskId: task.id, attempt: task.attempt });
      }
    } catch (reportError) {
      infrastructureFailure ??= asError(reportError);
    }
  }

  if (infrastructureFailure) throw infrastructureFailure;
  return {
    claimed: claimed.tasks.length,
    completed,
    failed,
    stale,
    reclaimed: claimed.reclaimed,
    dead: claimed.dead,
  };
}

export function parseObjectVersionCleanupTask(raw: unknown, configuredBucket: string): ObjectVersionCleanupTask {
  const identity = parseTaskIdentity(raw);
  if (!raw || typeof raw !== 'object') throw new Error('cleanup task is not an object');
  const payload = (raw as Record<string, unknown>)['payload'];
  if (!payload || typeof payload !== 'object') throw new Error('cleanup payload is not an object');
  const value = payload as Record<string, unknown>;
  if (value['schemaVersion'] !== 1) throw new Error('cleanup payload schema is unsupported');
  const companyId = requireString(value['companyId'], COMPANY_ID, 'companyId');
  const bucket = requireString(value['bucket'], BUCKET, 'bucket');
  if (bucket !== configuredBucket) throw new Error('cleanup bucket is outside worker authority');
  const path = requireString(value['path'], OBJECT_PATH, 'path');
  if (path.includes('..') || path.includes('//') || path.includes('\\')) throw new Error('cleanup path is invalid');
  const expectedVersion = requireString(value['expectedVersion'], VERSION_ID, 'expectedVersion');
  if (expectedVersion === 'null' || expectedVersion === 'undefined') throw new Error('cleanup version is not exact');
  const source = value['source'];
  if (!OBJECT_VERSION_CLEANUP_SOURCES.includes(source as CleanupSource)) throw new Error('cleanup source is invalid');
  const expectedPrefix = source === 'ATTACHMENT_FINALIZATION'
    ? `evidence/${companyId}/`
    : source === 'REPORT_EXPORT'
      ? `report-export/${companyId}/`
      : `${companyId}/generated/expense-substitute/`;
  if (!path.startsWith(expectedPrefix) || path.length === expectedPrefix.length) {
    throw new Error('cleanup path is outside source authority');
  }
  return { ...identity, companyId, bucket, path, expectedVersion, source: source as CleanupSource };
}

function parseTaskIdentity(raw: unknown): { id: string; claimToken: string; attempt: number } {
  if (!raw || typeof raw !== 'object') throw new Error('cleanup task is not an object');
  const value = raw as Record<string, unknown>;
  const id = requireString(value['id'], TASK_ID, 'id');
  const claimToken = requireString(value['claimToken'], CLAIM_TOKEN, 'claimToken');
  const attempt = value['attempt'];
  if (!Number.isInteger(attempt) || (attempt as number) < 1 || (attempt as number) > 1000) {
    throw new Error('cleanup attempt is invalid');
  }
  return { id, claimToken, attempt: attempt as number };
}

function parseClaimResponse(raw: unknown): { tasks: unknown[]; reclaimed: number; dead: number } {
  if (!raw || typeof raw !== 'object') throw new Error('cleanup claim response is invalid');
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value['tasks']) || value['tasks'].length > 25) throw new Error('cleanup claim tasks are invalid');
  const reclaimed = nonnegativeInteger(value['reclaimed'], 'reclaimed');
  const dead = nonnegativeInteger(value['dead'], 'dead');
  return { tasks: value['tasks'], reclaimed, dead };
}

function parseWritten(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>)['written'] !== 'boolean') {
    throw new Error('cleanup acknowledgement response is invalid');
  }
  return (raw as Record<string, unknown>)['written'] as boolean;
}

async function postJson(
  fetchImpl: FetchLike,
  config: ObjectVersionCleanupWorkerConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetchImpl(`${config.internalApiUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Token': config.workerToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Cleanup internal endpoint returned ${response.status}`);
  return response.json();
}

function assertWorkerConfig(config: ObjectVersionCleanupWorkerConfig): void {
  if (!config.internalApiUrl.startsWith('http://') && !config.internalApiUrl.startsWith('https://')) {
    throw new Error('cleanup internal API URL is invalid');
  }
  if (!config.workerToken) throw new Error('cleanup worker token is required');
  requireString(config.bucket, BUCKET, 'configured bucket');
  if (!config.region.trim()) throw new Error('cleanup S3 region is required');
  if (Boolean(config.accessKeyId) !== Boolean(config.secretAccessKey)) {
    throw new Error('cleanup S3 credentials must be configured as a pair');
  }
}

function requireString(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`cleanup ${field} is invalid`);
  return value;
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`cleanup ${field} is invalid`);
  return value as number;
}

function isNoSuchVersion(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as Record<string, unknown>;
  return value['name'] === 'NoSuchVersion' || value['Code'] === 'NoSuchVersion' || value['code'] === 'NoSuchVersion';
}

function cleanupFailureCode(error: unknown): string {
  const name = safeErrorName(error).toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 120) || 'unknown';
  return `s3_delete_failed:${name}`;
}

function safeErrorName(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error';
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>)['name'] === 'string') {
    return ((error as Record<string, unknown>)['name'] as string).slice(0, 120);
  }
  return 'UnknownError';
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
