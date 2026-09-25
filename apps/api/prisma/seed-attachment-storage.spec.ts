import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { inspectAttachmentBytes } from '../src/modules/data-model-core/domain/logic/attachment.logic';
import {
  buildSeedPaymentProofPng,
  buildSeedSupportingPdf,
  putSeedAttachmentObject,
} from './seed-attachment-storage';

describe('seed preview attachment fixtures', () => {
  it('builds the same valid passive PNG on every run', async () => {
    const bytes = buildSeedPaymentProofPng();
    const metadata = await sharp(bytes).metadata();

    assert.deepEqual(bytes, buildSeedPaymentProofPng());
    // Pin the picture, not the compressed bytes: `deflateSync` output depends on the zlib Node was
    // built with (official builds bundle Chromium's zlib, Homebrew's node links the system zlib, and
    // the two compress this image one byte apart), while the decoded pixels are identical everywhere.
    assert.equal(createHash('sha256').update(await sharp(bytes).raw().toBuffer()).digest('hex'), '351357072108eb11c0947878822938ec8260842bcde85bfb4126b2a1c3c6ec1e');
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 400);
    assert.equal(inspectAttachmentBytes('image/png', bytes), null);
  });

  it('builds the same valid one-page passive PDF on every run', async () => {
    const bytes = buildSeedSupportingPdf();
    const pdf = await PDFDocument.load(bytes);

    assert.deepEqual(bytes, buildSeedSupportingPdf());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), '58e1ebbf33493a9e87a65ebb4708f30392ab421a2531631f5dd60fe6dd85aaed');
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(inspectAttachmentBytes('application/pdf', bytes), null);
  });

  it('reuses an identical S3 object version instead of uploading on every seed', async () => {
    const envKeys = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE'] as const;
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    const originalSend = S3Client.prototype.send;
    const bytes = buildSeedPaymentProofPng();
    let current: { VersionId: string; ContentLength: number; ContentType: string; ChecksumSHA256: string; Metadata: Record<string, string> } | null = null;
    let puts = 0;

    process.env['S3_BUCKET'] = 'seed-test-bucket';
    process.env['S3_ENDPOINT'] = 'http://127.0.0.1:9';
    process.env['S3_REGION'] = 'local';
    process.env['S3_ACCESS_KEY_ID'] = 'seed-test';
    process.env['S3_SECRET_ACCESS_KEY'] = 'seed-test-secret';
    process.env['S3_FORCE_PATH_STYLE'] = 'true';
    (S3Client.prototype as any).send = async (command: HeadObjectCommand | PutObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        if (!current) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return current;
      }
      if (command instanceof PutObjectCommand) {
        puts += 1;
        current = {
          VersionId: `version-${puts}`,
          ContentLength: command.input.ContentLength!,
          ContentType: command.input.ContentType!,
          ChecksumSHA256: command.input.ChecksumSHA256!,
          Metadata: command.input.Metadata!,
        };
        return { VersionId: current.VersionId, ChecksumSHA256: current.ChecksumSHA256 };
      }
      throw new Error('Unexpected S3 command in seed idempotence test');
    };

    try {
      const input = { objectKey: 'seed/idempotent-payment.png', mimeType: 'image/png', bytes };
      const first = await putSeedAttachmentObject(input);
      const second = await putSeedAttachmentObject(input);
      assert.equal(puts, 1);
      assert.equal(first.objectVersionId, 'version-1');
      assert.equal(second.objectVersionId, first.objectVersionId);
      assert.equal(second.checksumSha256, createHash('sha256').update(bytes).digest('hex'));
    } finally {
      (S3Client.prototype as any).send = originalSend;
      for (const key of envKeys) {
        const value = previousEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
