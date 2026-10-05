import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
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
import { S3StorageAdapter } from './s3-storage.adapter';
import { LocalStorageAdapter } from './local-storage.adapter';
import { selectAttachmentStorage } from '../../data-model-core.module';
import type { AppConfigService } from '../../../../common/config/app-config.service';

const config = {
  s3Bucket: 'watchdog-evidence',
  s3Region: 'ap-southeast-1',
  s3Endpoint: undefined,
  s3PublicEndpoint: undefined,
  s3ForcePathStyle: undefined,
  s3AccessKeyId: undefined,
  s3SecretAccessKey: undefined,
} as Pick<AppConfigService, 's3Bucket' | 's3Region' | 's3Endpoint' | 's3PublicEndpoint' | 's3ForcePathStyle' | 's3AccessKeyId' | 's3SecretAccessKey'>;

describe('S3StorageAdapter', () => {
  it('creates presigned PUT upload intents', async () => {
    const signedUrl = mock.method(s3Presigner, 'getSignedUrl', async (_client: S3Client, command: PutObjectCommand, options: { expiresIn?: number }) => {
      assert.ok(command instanceof PutObjectCommand);
      assert.deepEqual(command.input, {
        Bucket: 'watchdog-evidence',
        Key: 'co-1/receipt.pdf',
        ContentType: 'application/pdf',
        ContentLength: 123,
        IfNoneMatch: '*',
      });
      assert.equal(options.expiresIn, 120);
      return 'https://s3.example.test/upload';
    });

    const storage = new S3StorageAdapter(config as AppConfigService);
    const intent = await storage.createUploadIntent({
      companyId: 'co-1',
      objectKey: 'co-1/receipt.pdf',
      mimeType: 'application/pdf',
      byteSize: 123,
      expiresInSeconds: 120,
    });

    assert.equal(signedUrl.mock.callCount(), 1);
    assert.equal(intent.uploadUrl, 'https://s3.example.test/upload');
    assert.equal(intent.uploadMethod, 'PUT');
    assert.deepEqual(intent.uploadHeaders, { 'Content-Type': 'application/pdf', 'If-None-Match': '*' });
    assert.equal(intent.objectKey, 'co-1/receipt.pdf');
    assert.equal(intent.bucket, 'watchdog-evidence');
    assert.equal(intent.storageProvider, 's3');

    signedUrl.mock.restore();
  });

  it('signs with the configured S3 keys instead of the SDK default credential chain', async () => {
    const storage = new S3StorageAdapter({ ...config, s3AccessKeyId: 'watchdog', s3SecretAccessKey: 'watchdog_local_secret' } as AppConfigService);
    const { client } = storage as unknown as { client: S3Client };

    const credentials = await client.config.credentials();
    assert.equal(credentials.accessKeyId, 'watchdog');
    assert.equal(credentials.secretAccessKey, 'watchdog_local_secret');
    assert.equal(await client.config.requestChecksumCalculation(), 'WHEN_REQUIRED');
  });

  it('binds exact length and create-only headers without signing an empty-body checksum', async () => {
    const storage = new S3StorageAdapter({
      ...config,
      s3AccessKeyId: 'watchdog',
      s3SecretAccessKey: 'watchdog_local_secret',
    } as AppConfigService);
    const intent = await storage.createUploadIntent({
      companyId: 'co-1',
      objectKey: 'pending/co-1/receipt.pdf',
      mimeType: 'application/pdf',
      byteSize: 123,
      expiresInSeconds: 300,
    });
    const url = new URL(intent.uploadUrl);
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? '';

    assert.match(signedHeaders, /content-length/);
    assert.match(signedHeaders, /if-none-match/);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(url.searchParams.has('x-amz-checksum-crc32'), false);
  });

  it('creates presigned GET download URLs', async () => {
    const signedUrl = mock.method(s3Presigner, 'getSignedUrl', async (_client: S3Client, command: GetObjectCommand, options: { expiresIn?: number }) => {
      assert.ok(command instanceof GetObjectCommand);
      assert.deepEqual(command.input, {
        Bucket: 'watchdog-evidence',
        Key: 'co-1/receipt.pdf',
        VersionId: 'version-1',
        ResponseContentDisposition: 'attachment; filename="download"',
        ResponseContentType: 'application/octet-stream',
      });
      assert.equal(options.expiresIn, 900);
      return 'https://s3.example.test/download';
    });

    const storage = new S3StorageAdapter(config as AppConfigService);
    const result = await storage.createDownloadUrl({
      bucket: 'watchdog-evidence',
      objectKey: 'co-1/receipt.pdf',
      objectVersionId: 'version-1',
    });

    assert.equal(signedUrl.mock.callCount(), 1);
    assert.equal(result.url, 'https://s3.example.test/download');

    signedUrl.mock.restore();
  });

  it('presigns an inline GET when a preview asks for one', async () => {
    const dispositions: Array<string | undefined> = [];
    const signedUrl = mock.method(s3Presigner, 'getSignedUrl', async (_client: S3Client, command: GetObjectCommand) => {
      dispositions.push(command.input.ResponseContentDisposition);
      return 'https://s3.example.test/download';
    });

    const storage = new S3StorageAdapter(config as AppConfigService);
    await storage.createDownloadUrl({
      bucket: 'watchdog-evidence', objectKey: 'co-1/receipt.png', mimeType: 'image/png', fileName: 'receipt.png', disposition: 'inline',
    });
    // A type the browser could sniff as a document is refused inline even when asked for.
    await storage.createDownloadUrl({
      bucket: 'watchdog-evidence', objectKey: 'co-1/receipt.svg', mimeType: 'image/svg+xml', fileName: 'receipt.svg', disposition: 'inline',
    });

    assert.deepEqual(dispositions, ['inline; filename="receipt.png"', 'attachment; filename="receipt.svg"']);
    signedUrl.mock.restore();
  });

  it('signs a Thai file name as an ASCII header, because the storage service answers 400 to anything outside ISO-8859-1', async () => {
    const dispositions: Array<string | undefined> = [];
    const signedUrl = mock.method(s3Presigner, 'getSignedUrl', async (_client: S3Client, command: GetObjectCommand) => {
      dispositions.push(command.input.ResponseContentDisposition);
      return 'https://s3.example.test/download';
    });

    const storage = new S3StorageAdapter(config as AppConfigService);
    // The name the system gives a printed claim form; a signed copy comes back under it (UAT 2026-10-05).
    const fileName = 'ใบเบิกค่าใช้จ่าย RB-202610-00001.pdf';
    await storage.createDownloadUrl({ bucket: 'watchdog-evidence', objectKey: 'co-1/claim.pdf', mimeType: 'application/pdf', fileName, disposition: 'inline' });
    await storage.createDownloadUrl({ bucket: 'watchdog-evidence', objectKey: 'co-1/claim.pdf', mimeType: 'application/pdf', fileName: "สลิป (1)'*.pdf" });

    for (const disposition of dispositions) assert.match(disposition!, /^[\x20-\x7e]+$/);
    assert.equal(dispositions[0], `inline; filename="________________ RB-202610-00001.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    // Characters RFC 5987 does not allow bare in the extended form are escaped too.
    assert.equal(dispositions[1], "attachment; filename=\"____ (1)'*.pdf\"; filename*=UTF-8''%E0%B8%AA%E0%B8%A5%E0%B8%B4%E0%B8%9B%20%281%29%27%2A.pdf");
    assert.equal(decodeURIComponent(dispositions[0]!.split("filename*=UTF-8''")[1]!), fileName);
    signedUrl.mock.restore();
  });

  it('presigns upload and download URLs against the configured public endpoint', async () => {
    const storage = new S3StorageAdapter({
      ...config,
      s3Endpoint: 'http://minio:9000',
      s3PublicEndpoint: 'http://127.0.0.1:19000',
      s3ForcePathStyle: true,
      s3AccessKeyId: 'watchdog',
      s3SecretAccessKey: 'watchdog_local_secret',
    } as AppConfigService);

    const upload = await storage.createUploadIntent({
      companyId: 'co-1',
      objectKey: 'co-1/receipt.pdf',
      mimeType: 'application/pdf',
      byteSize: 123,
    });
    const download = await storage.createDownloadUrl({
      bucket: 'watchdog-evidence',
      objectKey: 'co-1/receipt.pdf',
    });

    assert.equal(new URL(upload.uploadUrl).origin, 'http://127.0.0.1:19000');
    assert.equal(new URL(download.url).origin, 'http://127.0.0.1:19000');
  });

  it('keeps presigned URLs byte-identical to the existing client when the public endpoint is unset', async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-07-29T00:00:00.000Z') });
    const storage = new S3StorageAdapter({
      ...config,
      s3AccessKeyId: 'watchdog',
      s3SecretAccessKey: 'watchdog_local_secret',
    } as AppConfigService);
    const { client } = storage as unknown as { client: S3Client };

    try {
      const existingUploadUrl = await s3Presigner.getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: 'watchdog-evidence',
          Key: 'co-1/receipt.pdf',
          ContentType: 'application/pdf',
          ContentLength: 123,
          IfNoneMatch: '*',
        }),
        { expiresIn: 300 },
      );
      const existingDownloadUrl = await s3Presigner.getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: 'watchdog-evidence',
          Key: 'co-1/receipt.pdf',
          ResponseContentDisposition: 'attachment; filename="download"',
          ResponseContentType: 'application/octet-stream',
        }),
        { expiresIn: 900 },
      );
      const upload = await storage.createUploadIntent({
        companyId: 'co-1',
        objectKey: 'co-1/receipt.pdf',
        mimeType: 'application/pdf',
        byteSize: 123,
      });
      const download = await storage.createDownloadUrl({
        bucket: 'watchdog-evidence',
        objectKey: 'co-1/receipt.pdf',
      });

      assert.equal(upload.uploadUrl, existingUploadUrl);
      assert.equal(download.url, existingDownloadUrl);
      assert.equal(new URL(upload.uploadUrl).origin, 'https://watchdog-evidence.s3.ap-southeast-1.amazonaws.com');
      assert.equal(new URL(download.url).origin, 'https://watchdog-evidence.s3.ap-southeast-1.amazonaws.com');
    } finally {
      mock.timers.reset();
    }
  });

  it('puts server-generated bytes', async () => {
    const bytes = Buffer.from('artifact');
    const checksum = createHash('sha256').update(bytes).digest();
    const send = mock.method(S3Client.prototype, 'send', async function (command: PutObjectCommand) {
      assert.ok(command instanceof PutObjectCommand);
      assert.deepEqual(command.input, {
        Bucket: 'watchdog-evidence',
        Key: 'co-1/evidence.svg',
        Body: bytes,
        ContentType: 'image/svg+xml',
        ContentLength: 8,
        ChecksumSHA256: checksum.toString('base64'),
        IfNoneMatch: '*',
      });
      return { ChecksumSHA256: checksum.toString('base64'), VersionId: 'version-1' };
    });

    const stored = await new S3StorageAdapter(config as AppConfigService).putObject({
      objectKey: 'co-1/evidence.svg',
      mimeType: 'image/svg+xml',
      bytes,
    });

    assert.equal(send.mock.callCount(), 1);
    assert.deepEqual(stored, {
      bucket: 'watchdog-evidence',
      objectKey: 'co-1/evidence.svg',
      storageProvider: 's3',
      byteSize: 8,
      checksumSha256: checksum.toString('hex'),
      objectVersionId: 'version-1',
    });
    send.mock.restore();
  });

  it('fails closed when the provider does not return an immutable object version', async () => {
    const bytes = Buffer.from('artifact');
    const checksumBase64 = createHash('sha256').update(bytes).digest('base64');
    const send = mock.method(S3Client.prototype, 'send', async () => ({ ChecksumSHA256: checksumBase64 }));

    await assert.rejects(
      () => new S3StorageAdapter(config as AppConfigService).putObject({
        objectKey: 'co-1/evidence.svg',
        mimeType: 'image/svg+xml',
        bytes,
      }),
      /versioning is required/i,
    );
    send.mock.restore();
  });

  it('deletes stored objects', async () => {
    const send = mock.method(S3Client.prototype, 'send', async function (command: DeleteObjectCommand) {
      assert.ok(command instanceof DeleteObjectCommand);
      assert.deepEqual(command.input, {
        Bucket: 'watchdog-evidence',
        Key: 'co-1/evidence.svg',
      });
      return {};
    });

    await new S3StorageAdapter(config as AppConfigService).deleteObject({
      bucket: 'watchdog-evidence',
      objectKey: 'co-1/evidence.svg',
    });

    assert.equal(send.mock.callCount(), 1);
    send.mock.restore();
  });

  it('inventories only the exact key across pages, including delete markers and object-lock metadata', async () => {
    const retainedUntil = new Date('2026-09-01T00:00:00.000Z');
    let listPage = 0;
    const send = mock.method(S3Client.prototype, 'send', async function (command: unknown): Promise<any> {
      if (command instanceof GetObjectLockConfigurationCommand) {
        assert.deepEqual(command.input, { Bucket: 'watchdog-evidence' });
        return { ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' } };
      }
      if (command instanceof ListObjectVersionsCommand) {
        listPage += 1;
        if (listPage === 1) {
          assert.deepEqual(command.input, {
            Bucket: 'watchdog-evidence',
            Prefix: 'co-1/receipt.pdf',
            MaxKeys: 2,
          });
          return {
            IsTruncated: true,
            NextKeyMarker: 'co-1/receipt.pdf',
            NextVersionIdMarker: 'version-2',
            Versions: [
              {
                Key: 'co-1/receipt.pdf',
                VersionId: 'version-2',
                IsLatest: false,
                LastModified: new Date('2026-08-02T00:00:00.000Z'),
                Size: 20,
                ETag: 'etag-2',
              },
              {
                Key: 'co-1/receipt.pdf.backup',
                VersionId: 'sibling-version',
                IsLatest: true,
              },
            ],
            DeleteMarkers: [{
              Key: 'co-1/receipt.pdf',
              VersionId: 'delete-marker-1',
              IsLatest: true,
              LastModified: new Date('2026-08-03T00:00:00.000Z'),
            }],
          };
        }
        assert.deepEqual(command.input, {
          Bucket: 'watchdog-evidence',
          Prefix: 'co-1/receipt.pdf',
          MaxKeys: 2,
          KeyMarker: 'co-1/receipt.pdf',
          VersionIdMarker: 'version-2',
        });
        return {
          IsTruncated: false,
          Versions: [{
            Key: 'co-1/receipt.pdf',
            VersionId: 'version-1',
            IsLatest: false,
            LastModified: new Date('2026-08-01T00:00:00.000Z'),
            Size: 10,
            ETag: 'etag-1',
          }],
        };
      }
      if (command instanceof HeadObjectCommand) {
        assert.equal(command.input.Bucket, 'watchdog-evidence');
        assert.equal(command.input.Key, 'co-1/receipt.pdf');
        return { VersionId: command.input.VersionId };
      }
      if (command instanceof GetObjectRetentionCommand) {
        assert.equal(command.input.Bucket, 'watchdog-evidence');
        assert.equal(command.input.Key, 'co-1/receipt.pdf');
        if (command.input.VersionId === 'version-2') {
          return { Retention: { Mode: 'COMPLIANCE', RetainUntilDate: retainedUntil } };
        }
        throw Object.assign(new Error('No retention'), { name: 'NoSuchObjectLockConfiguration' });
      }
      assert.ok(command instanceof GetObjectLegalHoldCommand);
      assert.equal(command.input.Bucket, 'watchdog-evidence');
      assert.equal(command.input.Key, 'co-1/receipt.pdf');
      return { LegalHold: { Status: command.input.VersionId === 'version-2' ? 'ON' : 'OFF' } };
    });

    const inventory = await new S3StorageAdapter(config as AppConfigService).getExactObjectVersionInventory({
      bucket: 'watchdog-evidence',
      objectKey: 'co-1/receipt.pdf',
      pageSize: 2,
      maxPages: 2,
    });

    assert.deepEqual(inventory, {
      bucket: 'watchdog-evidence',
      objectKey: 'co-1/receipt.pdf',
      objectLockConfiguration: 'ENABLED',
      versions: [
        {
          versionId: 'version-2',
          isLatest: false,
          lastModified: new Date('2026-08-02T00:00:00.000Z'),
          byteSize: 20,
          eTag: 'etag-2',
          objectLockMode: 'COMPLIANCE',
          objectLockRetainUntil: retainedUntil,
          objectLockLegalHoldStatus: 'ON',
          objectLockMetadataVerified: true,
        },
        {
          versionId: 'version-1',
          isLatest: false,
          lastModified: new Date('2026-08-01T00:00:00.000Z'),
          byteSize: 10,
          eTag: 'etag-1',
          objectLockMode: undefined,
          objectLockRetainUntil: undefined,
          objectLockLegalHoldStatus: 'OFF',
          objectLockMetadataVerified: true,
        },
      ],
      deleteMarkers: [{
        versionId: 'delete-marker-1',
        isLatest: true,
        lastModified: new Date('2026-08-03T00:00:00.000Z'),
      }],
      pagesScanned: 2,
      complete: true,
    });
    assert.equal(send.mock.callCount(), 9);
    send.mock.restore();
  });

  it('fails closed when the bucket Object Lock configuration cannot be read', async () => {
    const send = mock.method(S3Client.prototype, 'send', async function (command: unknown): Promise<any> {
      assert.ok(command instanceof GetObjectLockConfigurationCommand);
      throw Object.assign(new Error('Access denied'), { name: 'AccessDenied' });
    });

    await assert.rejects(
      () => new S3StorageAdapter(config as AppConfigService).getExactObjectVersionInventory({
        bucket: 'watchdog-evidence',
        objectKey: 'co-1/receipt.pdf',
      }),
      /access denied/i,
    );
    assert.equal(send.mock.callCount(), 1);
    send.mock.restore();
  });

  it('fails closed when an enabled bucket does not permit exact retention inspection', async () => {
    const send = mock.method(S3Client.prototype, 'send', async function (command: unknown): Promise<any> {
      if (command instanceof GetObjectLockConfigurationCommand) {
        return { ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' } };
      }
      if (command instanceof ListObjectVersionsCommand) {
        return {
          IsTruncated: false,
          Versions: [{
            Key: 'co-1/receipt.pdf',
            VersionId: 'version-1',
            IsLatest: true,
          }],
        };
      }
      if (command instanceof HeadObjectCommand) return { VersionId: 'version-1' };
      assert.ok(command instanceof GetObjectRetentionCommand);
      throw Object.assign(new Error('Access denied'), { name: 'AccessDenied' });
    });

    await assert.rejects(
      () => new S3StorageAdapter(config as AppConfigService).getExactObjectVersionInventory({
        bucket: 'watchdog-evidence',
        objectKey: 'co-1/receipt.pdf',
      }),
      /access denied/i,
    );
    assert.equal(send.mock.callCount(), 4);
    send.mock.restore();
  });

  it('fails closed instead of returning a partial inventory at the page bound', async () => {
    const send = mock.method(S3Client.prototype, 'send', async function (command: unknown): Promise<any> {
      if (command instanceof GetObjectLockConfigurationCommand) {
        throw Object.assign(new Error('disabled'), { name: 'ObjectLockConfigurationNotFoundError' });
      }
      assert.ok(command instanceof ListObjectVersionsCommand);
      return {
        IsTruncated: true,
        NextKeyMarker: 'co-1/receipt.pdf',
        NextVersionIdMarker: 'version-1',
      };
    });

    await assert.rejects(
      () => new S3StorageAdapter(config as AppConfigService).getExactObjectVersionInventory({
        bucket: 'watchdog-evidence',
        objectKey: 'co-1/receipt.pdf',
        maxPages: 1,
      }),
      /exceeded the 1-page safety bound/i,
    );
    assert.equal(send.mock.callCount(), 2);
    send.mock.restore();
  });

  it('fails closed when S3 claims another page without a continuation marker', async () => {
    const send = mock.method(S3Client.prototype, 'send', async function (command: unknown): Promise<any> {
      if (command instanceof GetObjectLockConfigurationCommand) {
        throw Object.assign(new Error('disabled'), { name: 'ObjectLockConfigurationNotFoundError' });
      }
      assert.ok(command instanceof ListObjectVersionsCommand);
      return { IsTruncated: true };
    });

    await assert.rejects(
      () => new S3StorageAdapter(config as AppConfigService).getExactObjectVersionInventory({
        bucket: 'watchdog-evidence',
        objectKey: 'co-1/receipt.pdf',
        maxPages: 2,
      }),
      /truncated without a next key marker/i,
    );
    assert.equal(send.mock.callCount(), 2);
    send.mock.restore();
  });

  it('rejects invalid inventory bounds before calling S3', async () => {
    const send = mock.method(S3Client.prototype, 'send', async (): Promise<any> => ({}));

    await assert.rejects(
      () => new S3StorageAdapter(config as AppConfigService).getExactObjectVersionInventory({
        bucket: 'watchdog-evidence',
        objectKey: 'co-1/receipt.pdf',
        pageSize: 101,
      }),
      /pageSize must be an integer between 1 and 100/i,
    );
    assert.equal(send.mock.callCount(), 0);
    send.mock.restore();
  });

  it('reads object metadata through HeadObject', async () => {
    const send = mock.method(S3Client.prototype, 'send', async function (_command: HeadObjectCommand) {
      assert.ok(_command instanceof HeadObjectCommand);
      assert.deepEqual(_command.input, {
        Bucket: 'watchdog-evidence',
        Key: 'co-1/receipt.pdf',
        ChecksumMode: 'ENABLED',
      });
      return {
        ContentLength: 456,
        ContentType: 'application/pdf',
        ChecksumSHA256: Buffer.alloc(32, 1).toString('base64'),
        VersionId: 'version-1',
      };
    });

    const metadata = await new S3StorageAdapter(config as AppConfigService).getObjectMetadata({
      bucket: 'watchdog-evidence',
      objectKey: 'co-1/receipt.pdf',
    });

    assert.equal(send.mock.callCount(), 1);
    assert.deepEqual(metadata, {
      byteSize: 456,
      mimeType: 'application/pdf',
      checksumSha256: Buffer.alloc(32, 1).toString('hex'),
      objectVersionId: 'version-1',
      exists: true,
    });

    send.mock.restore();
  });

  it('returns missing metadata for S3 not found errors', async () => {
    const notFound = Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    const send = mock.method(S3Client.prototype, 'send', async () => {
      throw notFound;
    });

    const metadata = await new S3StorageAdapter(config as AppConfigService).getObjectMetadata({
      bucket: 'watchdog-evidence',
      objectKey: 'missing.pdf',
    });

    assert.equal(send.mock.callCount(), 1);
    assert.deepEqual(metadata, { byteSize: 0, exists: false });

    send.mock.restore();
  });

  it('reads object bytes through GetObject', async () => {
    const send = mock.method(S3Client.prototype, 'send', async function (command: GetObjectCommand) {
      assert.ok(command instanceof GetObjectCommand);
      assert.deepEqual(command.input, {
        Bucket: 'watchdog-evidence',
        Key: 'co-1/receipt.png',
        VersionId: 'version-1',
      });
      return {
        Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) },
        ContentType: 'image/png',
      };
    });

    const object = await new S3StorageAdapter(config as AppConfigService).getObject({
      bucket: 'watchdog-evidence',
      objectKey: 'co-1/receipt.png',
      objectVersionId: 'version-1',
    });

    assert.deepEqual(object, { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' });
    send.mock.restore();
  });
});

describe('selectAttachmentStorage', () => {
  it('selects S3 storage when a bucket is configured', () => {
    const local = new LocalStorageAdapter();
    const s3 = new S3StorageAdapter(config as AppConfigService);

    assert.equal(selectAttachmentStorage({ s3Bucket: 'watchdog-evidence' }, local, s3), s3);
  });

  it('selects local storage when no bucket is configured', () => {
    const local = new LocalStorageAdapter();
    const s3 = new S3StorageAdapter(config as AppConfigService);

    assert.equal(selectAttachmentStorage({ s3Bucket: '' }, local, s3), local);
  });
});
