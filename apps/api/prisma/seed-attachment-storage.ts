import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

export type SeedStoredAttachment = {
  storageProvider: 's3' | 'local';
  bucket: string;
  objectKey: string;
  objectVersionId: string;
  checksumSha256: string;
  byteSize: number;
};

const LOCAL_STORAGE_DIR = join(tmpdir(), 'watchdog-bms-local-storage');

/**
 * Put deterministic local-preview bytes into the same backing store the API will read.
 * A local seed must never mark an attachment ACTIVE when only its database metadata exists.
 */
export async function putSeedAttachmentObject(input: {
  objectKey: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<SeedStoredAttachment> {
  const checksum = createHash('sha256').update(input.bytes).digest();
  const checksumSha256 = checksum.toString('hex');
  const bucket = process.env['S3_BUCKET']?.trim();

  if (!bucket) {
    const token = opaqueLocalToken(input.objectKey);
    await mkdir(LOCAL_STORAGE_DIR, { recursive: true });
    await writeFile(join(LOCAL_STORAGE_DIR, token), input.bytes);
    return {
      storageProvider: 'local',
      bucket: 'local-attachments',
      objectKey: input.objectKey,
      objectVersionId: checksumSha256,
      checksumSha256,
      byteSize: input.bytes.byteLength,
    };
  }

  const accessKeyId = process.env['S3_ACCESS_KEY_ID']?.trim();
  const secretAccessKey = process.env['S3_SECRET_ACCESS_KEY']?.trim();
  const client = new S3Client({
    region: process.env['S3_REGION']?.trim() || 'ap-southeast-1',
    endpoint: process.env['S3_ENDPOINT']?.trim() || undefined,
    forcePathStyle: parseBoolean(process.env['S3_FORCE_PATH_STYLE']),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
  try {
    const existing = await findReusableSeedObjectVersion(client, {
      bucket,
      objectKey: input.objectKey,
      mimeType: input.mimeType,
      byteSize: input.bytes.byteLength,
      checksumSha256,
      checksumBase64: checksum.toString('base64'),
    });
    if (existing) {
      return {
        storageProvider: 's3',
        bucket,
        objectKey: input.objectKey,
        objectVersionId: existing,
        checksumSha256,
        byteSize: input.bytes.byteLength,
      };
    }

    const result = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: input.objectKey,
      Body: input.bytes,
      ContentType: input.mimeType,
      ContentLength: input.bytes.byteLength,
      ChecksumSHA256: checksum.toString('base64'),
      Metadata: { 'seed-sha256': checksumSha256 },
    }));
    if (result.ChecksumSHA256 && result.ChecksumSHA256 !== checksum.toString('base64')) {
      throw new Error(`Seed attachment checksum mismatch for ${input.objectKey}.`);
    }
    if (!result.VersionId) {
      throw new Error(`Versioned object storage is required for seed attachment ${input.objectKey}.`);
    }
    return {
      storageProvider: 's3',
      bucket,
      objectKey: input.objectKey,
      objectVersionId: result.VersionId,
      checksumSha256,
      byteSize: input.bytes.byteLength,
    };
  } finally {
    client.destroy();
  }
}

async function findReusableSeedObjectVersion(
  client: S3Client,
  expected: {
    bucket: string;
    objectKey: string;
    mimeType: string;
    byteSize: number;
    checksumSha256: string;
    checksumBase64: string;
  },
): Promise<string | null> {
  let head: HeadObjectCommandOutput;
  try {
    head = await client.send(new HeadObjectCommand({
      Bucket: expected.bucket,
      Key: expected.objectKey,
      ChecksumMode: 'ENABLED',
    }));
  } catch (error) {
    if (isMissingObjectError(error)) return null;
    throw error;
  }

  if (!head.VersionId) {
    throw new Error(`Versioned object storage is required for seed attachment ${expected.objectKey}.`);
  }
  if (head.ContentLength !== expected.byteSize || head.ContentType !== expected.mimeType) return null;

  if (head.ChecksumSHA256) {
    return head.ChecksumSHA256 === expected.checksumBase64 ? head.VersionId : null;
  }
  if (head.Metadata?.['seed-sha256']) {
    return head.Metadata['seed-sha256'] === expected.checksumSha256 ? head.VersionId : null;
  }

  // Objects uploaded before seed checksum metadata was introduced can still be reused safely.
  // Fetch that exact version once and compare the actual bytes; subsequent runs use metadata.
  const existing = await client.send(new GetObjectCommand({
    Bucket: expected.bucket,
    Key: expected.objectKey,
    VersionId: head.VersionId,
  }));
  if (!existing.Body) return null;
  const bytes = Buffer.from(await existing.Body.transformToByteArray());
  if (createHash('sha256').update(bytes).digest('hex') === expected.checksumSha256) return head.VersionId;
  return null;
}

/** A visible, deterministic passive PNG used by local image-preview paths. */
export function buildSeedPaymentProofPng(): Buffer {
  const width = 640;
  const height = 400;
  const rowBytes = 1 + (width * 3);
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    raw[row] = 0; // PNG filter: None
    for (let x = 0; x < width; x += 1) {
      let color: readonly [number, number, number] = [238, 242, 246];
      const onPaper = x >= 76 && x < 564 && y >= 18 && y < 382;
      if (onPaper) color = [255, 255, 255];
      if (x >= 76 && x < 564 && y >= 18 && y < 96) color = [19, 132, 93];
      if (x >= 112 && x < 348 && y >= 126 && y < 136) color = [71, 84, 103];
      if (x >= 112 && x < 298 && y >= 154 && y < 162) color = [152, 162, 179];
      if (x >= 112 && x < 332 && y >= 182 && y < 190) color = [152, 162, 179];
      if (x >= 112 && x < 372 && y >= 222 && y < 232) color = [71, 84, 103];
      if (x >= 112 && x < 296 && y >= 250 && y < 258) color = [152, 162, 179];
      if (x >= 108 && x < 392 && y >= 292 && y < 348) color = [236, 253, 245];
      if (x >= 132 && x < 366 && y >= 312 && y < 326) color = [19, 132, 93];
      if (x >= 430 && x < 526 && y >= 244 && y < 340) {
        const cellX = Math.floor((x - 430) / 8);
        const cellY = Math.floor((y - 244) / 8);
        color = ((cellX * 3 + cellY * 5 + cellX * cellY) % 7) < 3
          ? [17, 24, 39]
          : [255, 255, 255];
      }
      const offset = row + 1 + (x * 3);
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A deterministic, one-page passive PDF that real browser PDF viewers can open. */
export function buildSeedSupportingPdf(): Buffer {
  const content = [
    'BT',
    '/F1 20 Tf',
    '72 744 Td',
    '(LOCAL EXPENSE SUPPORTING DOCUMENT) Tj',
    '0 -38 Td',
    '/F1 12 Tf',
    '(Team meal - preview fixture) Tj',
    '0 -24 Td',
    '(Amount: THB 850.00) Tj',
    '0 -24 Td',
    '(This passive PDF is generated by the local seed.) Tj',
    'ET',
    '',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n% local seed fixture\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function opaqueLocalToken(objectKey: string): string {
  return createHash('sha256').update(objectKey).digest('hex').slice(0, 32);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.byteLength);
  return chunk;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function isMissingObjectError(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.$metadata?.httpStatusCode === 404
    || candidate.name === 'NotFound'
    || candidate.name === 'NoSuchKey';
}
