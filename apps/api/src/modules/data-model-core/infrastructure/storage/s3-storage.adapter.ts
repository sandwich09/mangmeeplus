import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
} from '../../domain/ports/attachment-storage.port';

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
