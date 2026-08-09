import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectLegalHoldCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import s3Presigner = require('@aws-sdk/s3-request-presigner');
import { AppConfigService } from '../../../../common/config/app-config.service';
import { downloadContentDisposition, inlineDownloadContentType } from '../../domain/logic/attachment.logic';
import type {
  AttachmentStoragePort,
  CreateUploadIntentInput,
  UploadIntent,
  CreateDownloadUrlInput,
  SignedDownloadUrl,
  GetObjectMetadataInput,
  StoredObjectMetadata,
  GetObjectInput,
  StoredObject,
  PutObjectInput,
  PutObjectResult,
  DeleteObjectInput,
  GetExactObjectVersionInventoryInput,
  ExactObjectVersionInventory,
  StoredObjectVersionInventoryEntry,
} from '../../domain/ports/attachment-storage.port';

const DEFAULT_INVENTORY_PAGE_SIZE = 100;
const MAX_INVENTORY_PAGE_SIZE = 100;
const DEFAULT_INVENTORY_MAX_PAGES = 10;
const MAX_INVENTORY_PAGES = 20;

@Injectable()
export class S3StorageAdapter implements AttachmentStoragePort {
  private readonly client: S3Client;
  private readonly presigningClient: S3Client;

  constructor(private readonly config: AppConfigService) {
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint || undefined,
      forcePathStyle: config.s3ForcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      // Static keys are for local MinIO. Undefined falls back to the SDK default
      // chain, which is how the ECS task role supplies credentials in production.
      credentials: config.s3AccessKeyId && config.s3SecretAccessKey
        ? { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
        : undefined,
    });
    this.presigningClient = new S3Client({
      region: config.s3Region,
      endpoint: config.s3PublicEndpoint || config.s3Endpoint,
      forcePathStyle: config.s3ForcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: config.s3AccessKeyId && config.s3SecretAccessKey
        ? { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
        : undefined,
    });
  }

  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const expiresInSeconds = input.expiresInSeconds ?? 300;
    const uploadUrl = await s3Presigner.getSignedUrl(
      this.presigningClient,
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        ContentLength: input.byteSize,
        IfNoneMatch: '*',
      }),
      { expiresIn: expiresInSeconds },
    );

    return {
      uploadUrl,
      uploadMethod: 'PUT',
      uploadHeaders: { 'Content-Type': input.mimeType, 'If-None-Match': '*' },
      objectKey: input.objectKey,
      bucket: this.config.s3Bucket,
      storageProvider: 's3',
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedDownloadUrl> {
    const expiresInSeconds = input.expiresInSeconds ?? 900;
    const url = await s3Presigner.getSignedUrl(
      this.presigningClient,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        ...(input.objectVersionId ? { VersionId: input.objectVersionId } : {}),
        ResponseContentDisposition: downloadContentDisposition(input),
        ResponseContentType: inlineDownloadContentType(input.mimeType),
      }),
      { expiresIn: expiresInSeconds },
    );

    return {
      url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const checksumSha256 = createHash('sha256').update(input.bytes).digest();
    const checksumBase64 = checksumSha256.toString('base64');
    const result = await this.client.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: input.objectKey,
      Body: input.bytes,
      ContentType: input.mimeType,
      ContentLength: input.bytes.byteLength,
      ChecksumSHA256: checksumBase64,
      IfNoneMatch: '*',
    }));
    if (result.ChecksumSHA256 && result.ChecksumSHA256 !== checksumBase64) {
      throw new Error('S3 returned a checksum that does not match the uploaded bytes.');
    }
    if (!result.VersionId) throw new Error('S3 bucket versioning is required for immutable evidence.');
    return {
      bucket: this.config.s3Bucket,
      objectKey: input.objectKey,
      storageProvider: 's3',
      byteSize: input.bytes.byteLength,
      checksumSha256: checksumSha256.toString('hex'),
      objectVersionId: result.VersionId,
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      ...(input.objectVersionId ? { VersionId: input.objectVersionId } : {}),
    }));
  }

  async getExactObjectVersionInventory(
    input: GetExactObjectVersionInventoryInput,
  ): Promise<ExactObjectVersionInventory> {
    const pageSize = boundedPositiveInteger(
      input.pageSize,
      DEFAULT_INVENTORY_PAGE_SIZE,
      MAX_INVENTORY_PAGE_SIZE,
      'pageSize',
    );
    const maxPages = boundedPositiveInteger(
      input.maxPages,
      DEFAULT_INVENTORY_MAX_PAGES,
      MAX_INVENTORY_PAGES,
      'maxPages',
    );
    const versions: StoredObjectVersionInventoryEntry[] = [];
    const deleteMarkers: ExactObjectVersionInventory['deleteMarkers'] = [];
    const seenVersionIds = new Set<string>();
    const seenPageMarkers = new Set<string>();
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    const objectLockConfiguration = await this.getBucketObjectLockConfiguration(input.bucket);

    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.client.send(new ListObjectVersionsCommand({
        Bucket: input.bucket,
        Prefix: input.objectKey,
        MaxKeys: pageSize,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
      }));

      if (typeof result.IsTruncated !== 'boolean') {
        throw new Error('S3 object-version inventory did not declare whether the response was truncated.');
      }

      for (const listedVersion of result.Versions ?? []) {
        const { key, versionId, isLatest } = exactInventoryIdentity(listedVersion, 'object version');
        if (key !== input.objectKey) continue;
        assertUniqueVersionId(seenVersionIds, versionId);

        const metadata = await this.client.send(new HeadObjectCommand({
          Bucket: input.bucket,
          Key: input.objectKey,
          VersionId: versionId,
        }));
        if (metadata.DeleteMarker === true) {
          throw new Error(`S3 listed object version "${versionId}" as a delete marker during metadata verification.`);
        }
        if (metadata.VersionId !== undefined && metadata.VersionId !== versionId) {
          throw new Error(`S3 returned metadata for a different object version than "${versionId}".`);
        }

        const objectLock = objectLockConfiguration === 'ENABLED'
          ? await this.getVerifiedObjectLockMetadata(input.bucket, input.objectKey, versionId)
          : {
              objectLockMode: undefined,
              objectLockRetainUntil: undefined,
              objectLockLegalHoldStatus: undefined,
            };

        versions.push({
          versionId,
          isLatest,
          lastModified: listedVersion.LastModified,
          byteSize: listedVersion.Size,
          eTag: listedVersion.ETag,
          ...objectLock,
          objectLockMetadataVerified: true,
        });
      }

      for (const listedMarker of result.DeleteMarkers ?? []) {
        const { key, versionId, isLatest } = exactInventoryIdentity(listedMarker, 'delete marker');
        if (key !== input.objectKey) continue;
        assertUniqueVersionId(seenVersionIds, versionId);
        deleteMarkers.push({
          versionId,
          isLatest,
          lastModified: listedMarker.LastModified,
        });
      }

      if (!result.IsTruncated) {
        return {
          bucket: input.bucket,
          objectKey: input.objectKey,
          objectLockConfiguration,
          versions,
          deleteMarkers,
          pagesScanned: page,
          complete: true,
        };
      }
      if (page === maxPages) {
        throw new Error(`S3 object-version inventory exceeded the ${maxPages}-page safety bound.`);
      }
      if (!result.NextKeyMarker) {
        throw new Error('S3 object-version inventory was truncated without a next key marker.');
      }

      const nextPageMarker = `${result.NextKeyMarker}\u0000${result.NextVersionIdMarker ?? ''}`;
      if (seenPageMarkers.has(nextPageMarker)) {
        throw new Error('S3 object-version inventory pagination did not make progress.');
      }
      seenPageMarkers.add(nextPageMarker);
      keyMarker = result.NextKeyMarker;
      versionIdMarker = result.NextVersionIdMarker;
    }

    throw new Error('S3 object-version inventory ended without proving completion.');
  }

  private async getBucketObjectLockConfiguration(
    bucket: string,
  ): Promise<ExactObjectVersionInventory['objectLockConfiguration']> {
    try {
      const result = await this.client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
      if (result.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled') {
        throw new Error('S3 returned an incomplete bucket Object Lock configuration.');
      }
      return 'ENABLED';
    } catch (error) {
      if (isObjectLockNotConfiguredError(error)) return 'DISABLED';
      throw error;
    }
  }

  private async getVerifiedObjectLockMetadata(
    bucket: string,
    objectKey: string,
    versionId: string,
  ): Promise<Pick<
    StoredObjectVersionInventoryEntry,
    'objectLockMode' | 'objectLockRetainUntil' | 'objectLockLegalHoldStatus'
  >> {
    let objectLockMode: StoredObjectVersionInventoryEntry['objectLockMode'];
    let objectLockRetainUntil: Date | undefined;
    try {
      const result = await this.client.send(new GetObjectRetentionCommand({
        Bucket: bucket,
        Key: objectKey,
        VersionId: versionId,
      }));
      if (!result.Retention?.Mode || !result.Retention.RetainUntilDate) {
        throw new Error(`S3 returned incomplete retention metadata for object version "${versionId}".`);
      }
      objectLockMode = result.Retention.Mode;
      objectLockRetainUntil = result.Retention.RetainUntilDate;
    } catch (error) {
      if (!isObjectLockNotConfiguredError(error)) throw error;
    }

    let objectLockLegalHoldStatus: StoredObjectVersionInventoryEntry['objectLockLegalHoldStatus'];
    try {
      const result = await this.client.send(new GetObjectLegalHoldCommand({
        Bucket: bucket,
        Key: objectKey,
        VersionId: versionId,
      }));
      if (result.LegalHold?.Status !== 'ON' && result.LegalHold?.Status !== 'OFF') {
        throw new Error(`S3 returned incomplete legal-hold metadata for object version "${versionId}".`);
      }
      objectLockLegalHoldStatus = result.LegalHold.Status;
    } catch (error) {
      if (!isObjectLockNotConfiguredError(error)) throw error;
      objectLockLegalHoldStatus = 'OFF';
    }

    return { objectLockMode, objectLockRetainUntil, objectLockLegalHoldStatus };
  }

  async getObjectMetadata(input: GetObjectMetadataInput): Promise<StoredObjectMetadata> {
    try {
      const metadata = await this.client.send(new HeadObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        ...(input.objectVersionId ? { VersionId: input.objectVersionId } : {}),
        ChecksumMode: 'ENABLED',
      }));
      return {
        byteSize: metadata.ContentLength ?? 0,
        mimeType: metadata.ContentType,
        checksumSha256: metadata.ChecksumSHA256 ? Buffer.from(metadata.ChecksumSHA256, 'base64').toString('hex') : undefined,
        objectVersionId: metadata.VersionId,
        exists: true,
      };
    } catch (error) {
      if (isMissingObjectError(error)) {
        return { byteSize: 0, exists: false };
      }
      throw error;
    }
  }

  async getObject(input: GetObjectInput): Promise<StoredObject> {
    const object = await this.client.send(new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      ...(input.objectVersionId ? { VersionId: input.objectVersionId } : {}),
    }));
    if (!object.Body) throw new Error('Stored object has no body');
    return {
      bytes: Buffer.from(await object.Body.transformToByteArray()),
      mimeType: object.ContentType,
    };
  }
}

function isMissingObjectError(error: unknown): boolean {
  const maybeError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return maybeError.$metadata?.httpStatusCode === 404 || maybeError.name === 'NotFound' || maybeError.name === 'NoSuchKey';
}

function isObjectLockNotConfiguredError(error: unknown): boolean {
  const maybeError = error as { name?: string; Code?: string; code?: string };
  const code = maybeError.name ?? maybeError.Code ?? maybeError.code;
  return code === 'ObjectLockConfigurationNotFoundError' || code === 'NoSuchObjectLockConfiguration';
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}.`);
  }
  return resolved;
}

function exactInventoryIdentity(
  entry: { Key?: string; VersionId?: string; IsLatest?: boolean },
  kind: string,
): { key: string; versionId: string; isLatest: boolean } {
  if (!entry.Key || !entry.VersionId || typeof entry.IsLatest !== 'boolean') {
    throw new Error(`S3 returned an incomplete ${kind} entry during exact inventory.`);
  }
  return { key: entry.Key, versionId: entry.VersionId, isLatest: entry.IsLatest };
}

function assertUniqueVersionId(seen: Set<string>, versionId: string): void {
  if (seen.has(versionId)) {
    throw new Error(`S3 returned duplicate version id "${versionId}" during exact inventory.`);
  }
  seen.add(versionId);
}
