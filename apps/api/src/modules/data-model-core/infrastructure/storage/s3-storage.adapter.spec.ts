import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
