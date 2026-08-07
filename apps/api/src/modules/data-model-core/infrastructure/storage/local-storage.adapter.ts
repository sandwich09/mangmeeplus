import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const LOCAL_STORAGE_DIR = join(tmpdir(), 'watchdog-bms-local-storage');

@Injectable()
export class LocalStorageAdapter implements AttachmentStoragePort {
  private readonly bucket = 'local-attachments';
  private readonly provider = 'local';

  async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const expiresInSeconds = input.expiresInSeconds ?? 300;
    return {
      uploadUrl: `/local-storage/upload/${opaqueLocalToken(input.objectKey)}`,
      uploadMethod: 'PUT',
      uploadHeaders: { 'Content-Type': input.mimeType, 'If-None-Match': '*' },
      objectKey: input.objectKey,
      bucket: this.bucket,
      storageProvider: this.provider,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<SignedDownloadUrl> {
    const expiresInSeconds = input.expiresInSeconds ?? 900;
    return {
      url: `/local-storage/download/${opaqueLocalToken(input.objectKey)}${localDownloadQuery(input.mimeType, input.objectVersionId)}`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    await this.storeUpload(opaqueLocalToken(input.objectKey), input.bytes);
    const checksumSha256 = createHash('sha256').update(input.bytes).digest('hex');
    return {
      bucket: this.bucket,
      objectKey: input.objectKey,
      storageProvider: this.provider,
      byteSize: input.bytes.byteLength,
      checksumSha256,
      objectVersionId: checksumSha256,
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    if (input.bucket !== this.bucket) throw new Error(`Unknown local storage bucket: ${input.bucket}`);
    await rm(localObjectPath(input.objectKey), { force: true });
  }

  async getObjectMetadata(input: GetObjectMetadataInput): Promise<StoredObjectMetadata> {
    if (input.bucket !== this.bucket) return { byteSize: 0, exists: false };
    try {
      const metadata = await stat(localObjectPath(input.objectKey));
      const checksumSha256 = createHash('sha256').update(await readFile(localObjectPath(input.objectKey))).digest('hex');
      if (input.objectVersionId && input.objectVersionId !== checksumSha256) return { byteSize: 0, exists: false };
      return { byteSize: metadata.size, checksumSha256, objectVersionId: checksumSha256, exists: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { byteSize: 0, exists: false };
      throw error;
    }
  }

  async getObject(input: GetObjectInput): Promise<StoredObject> {
    if (input.bucket !== this.bucket) throw new Error(`Unknown local storage bucket: ${input.bucket}`);
    const bytes = await readFile(localObjectPath(input.objectKey));
    if (input.objectVersionId && createHash('sha256').update(bytes).digest('hex') !== input.objectVersionId) {
      throw new Error('Local object version does not match immutable evidence.');
    }
    return { bytes };
  }

  async storeUpload(token: string, bytes: Buffer): Promise<void> {
    await mkdir(LOCAL_STORAGE_DIR, { recursive: true });
    await writeFile(join(LOCAL_STORAGE_DIR, token), bytes, { flag: 'wx' });
  }

  async readStoredToken(token: string, objectVersionId?: string): Promise<Buffer> {
    const bytes = await readFile(join(LOCAL_STORAGE_DIR, token));
    if (objectVersionId && createHash('sha256').update(bytes).digest('hex') !== objectVersionId) {
      throw new Error('Local object version does not match immutable evidence.');
    }
    return bytes;
  }
}

function opaqueLocalToken(objectKey: string): string {
  return createHash('sha256').update(objectKey).digest('hex').slice(0, 32);
}

function localObjectPath(objectKey: string): string {
  return join(LOCAL_STORAGE_DIR, opaqueLocalToken(objectKey));
}

function localDownloadQuery(mimeType?: string, objectVersionId?: string): string {
  const query = new URLSearchParams();
  if (mimeType) query.set('contentType', mimeType);
  if (objectVersionId) query.set('versionId', objectVersionId);
  const value = query.toString();
  return value ? `?${value}` : '';
}
