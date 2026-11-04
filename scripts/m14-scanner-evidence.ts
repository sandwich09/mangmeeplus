// ponytail: minimal script; runs via `pnpm security:m14-evidence` (tsx)
//
// M-14 isolated-environment corpus. Drives the SHIPPED upload controls — the same
// `inspectAttachmentBytes` content policy and the same `AttachmentMalwareScanner`
// INSTREAM client that `CompleteAttachmentUploadUseCase` calls — against a real clamd,
// so the evidence is about production code rather than a re-implementation.
//
// Start an isolated scanner first (no production connectivity, freshclam off):
//   docker run -d --name watchdog-m14-clamav --platform linux/amd64 \
//     -e CLAMAV_NO_FRESHCLAMD=true -p 127.0.0.1:13310:3310 clamav/clamav:stable
//   CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=13310 pnpm security:m14-evidence
//
// Exits non-zero on any unmet expectation. Every case states the layer it proves:
// META = MIME/size allowlist, CONTENT = magic/active-content/parser bounds, AV = clamd.
import { connect } from 'node:net';
import {
  inspectAttachmentBytes,
  validateAttachmentMeta,
} from '../apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts';
import { AttachmentMalwareScanner } from '../apps/api/src/modules/data-model-core/infrastructure/attachment-malware-scanner.ts';

const HOST = process.env.CLAMAV_HOST ?? '127.0.0.1';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);
const TIMEOUT_MS = Number(process.env.CLAMAV_TIMEOUT_MS ?? 30_000);

const scanner = new AttachmentMalwareScanner({
  clamAvHost: HOST,
  clamAvPort: PORT,
  clamAvTimeoutMs: TIMEOUT_MS,
  isProduction: true,
} as never);

// Split so this file never contains a scannable EICAR signature of its own.
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-', 'ANTIVIRUS-TEST-FILE!$H+H*'].join('');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (payload = '') => Buffer.concat([PNG_MAGIC, Buffer.from(`IHDR${payload}IEND`, 'latin1')]);
const jpeg = (payload = '') =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(payload, 'latin1'), Buffer.from([0xff, 0xd9])]);
const pdf = (body: string) => Buffer.from(`%PDF-1.4\n${body}\n%%EOF\n`, 'latin1');

let failed = 0;
const record = (name: string, layer: string, ok: boolean, detail: string) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${layer}] ${name} :: ${detail}`);
};

// META — the MIME/size allowlist, before any bytes are read.
const metaCases: Array<[string, string, number, boolean]> = [
  ['pdf within limits accepted', 'application/pdf', 1024, true],
  ['svg MIME refused', 'image/svg+xml', 1024, false],
  ['html MIME refused', 'text/html', 1024, false],
  ['office MIME refused', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024, false],
  ['26 MB refused', 'application/pdf', 26 * 1024 * 1024, false],
  ['zero bytes refused', 'application/pdf', 0, false],
];
for (const [name, mime, size, expectAllowed] of metaCases) {
  const error = validateAttachmentMeta(mime, size);
  record(name, 'META', (error === null) === expectAllowed, error ?? 'allowed');
}

// CONTENT — magic bytes, polyglot/active content, and parser bounds.
const contentCases: Array<[string, string, Buffer, RegExp | null]> = [
  ['clean pdf passes', 'application/pdf', pdf('1 0 obj\n<< /Type /Catalog >>\nendobj'), null],
  ['clean png passes', 'image/png', png(), null],
  ['clean jpeg passes', 'image/jpeg', jpeg('JFIF'), null],
  ['eicar inside a pdf container', 'application/pdf', pdf(EICAR), /Malware test signature/],
  ['jpeg + html script polyglot', 'image/jpeg', jpeg('<script>alert(1)</script>'), /Active content/],
  ['svg body declared as png', 'image/png', Buffer.from('<svg onload="alert(1)"/>', 'latin1'), /File signature/],
  ['svg smuggled into a real png', 'image/png', png('<svg onload="alert(1)"/>'), /Active content/],
  ['javascript: URI in a pdf', 'application/pdf', pdf('/URI (javascript:alert(1))'), /Active content/],
  ['pdf /OpenAction + /JavaScript', 'application/pdf', pdf('<< /OpenAction << /S /JavaScript >> >>'), /Active PDF content/],
  ['pdf /Launch action', 'application/pdf', pdf('<< /Launch (/bin/sh) >>'), /Active PDF content/],
  ['pdf /EmbeddedFile', 'application/pdf', pdf('<< /Type /EmbeddedFile >>'), /Embedded files are not supported/],
  ['pdf object-count bomb', 'application/pdf', pdf('0 obj\nendobj\n'.repeat(100_001)), /parser safety limit/],
  ['truncated jpeg without EOI', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), /File signature/],
];
for (const [name, mime, bytes, expected] of contentCases) {
  const error = inspectAttachmentBytes(mime, bytes);
  const ok = expected === null ? error === null : error !== null && expected.test(error);
  record(name, 'CONTENT', ok, error ?? 'accepted');
}

// AV — the live clamd INSTREAM path, including the 64 KB chunking loop.
const clamVersion = () => new Promise<string>((resolve, reject) => {
  const socket = connect({ host: HOST, port: PORT });
  const chunks: Buffer[] = [];
  socket.setTimeout(TIMEOUT_MS);
  socket.once('connect', () => socket.end('zVERSION\0'));
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim()));
  socket.once('timeout', () => socket.destroy(new Error('VERSION timed out')));
  socket.once('error', reject);
});

const scan = async (bytes: Buffer): Promise<string> => {
  try {
    await scanner.assertClean(bytes);
    return 'CLEAN';
  } catch (error) {
    return (error as Error).message;
  }
};

// A 5 MB body forces ~80 INSTREAM chunks, so a clean verdict here is evidence the
// chunking loop frames every chunk correctly — a mis-framed stream reads as CLEAN
// only if clamd saw the whole file, and clamd rejects a malformed stream outright.
const largeClean = pdf('1 0 obj\n<< /Type /Catalog >>\nendobj\n'.repeat(150_000));
//
// The three container cases below expect CLEAN *from clamd*, and that is ClamAV behaving as
// designed, not a gap in this client: EICAR is a whole-file signature (the 68-byte string plus
// at most trailing whitespace), so ClamAV deliberately does not match it as a substring of a
// larger file. Verified independently of our INSTREAM code with clamdscan inside the container:
//   /tmp/raw.txt: Eicar-Test-Signature FOUND
//   /tmp/in.pdf:  OK
// This is exactly why `inspectAttachmentBytes` carries its own EICAR check — the CONTENT rows
// above show it rejecting the same PDF-wrapped payload that clamd passes. The layers are
// complementary, and an embedded test signature never reaches ACTIVE.
const avCases: Array<[string, Buffer, string]> = [
  ['clean pdf scans CLEAN', pdf('1 0 obj\n<< /Type /Catalog >>\nendobj'), 'CLEAN'],
  [`clean ${(largeClean.length / 1024 / 1024).toFixed(1)} MB pdf scans CLEAN (multi-chunk INSTREAM)`, largeClean, 'CLEAN'],
  ['raw eicar detected', Buffer.from(EICAR, 'latin1'), 'MALWARE_DETECTED'],
  ['eicar + trailing whitespace still detected', Buffer.from(`${EICAR}\n`, 'latin1'), 'MALWARE_DETECTED'],
  ['eicar in a pdf container: clamd passes it, CONTENT layer rejects it', pdf(EICAR), 'CLEAN'],
  ['eicar in a real png: clamd passes it, CONTENT layer rejects it', png(EICAR), 'CLEAN'],
  ['eicar in a real jpeg: clamd passes it, CONTENT layer rejects it', jpeg(EICAR), 'CLEAN'],
];
async function main(): Promise<void> {
  console.log(`\nscanner: ${await clamVersion()} at ${HOST}:${PORT}\n`);

  for (const [name, bytes, expected] of avCases) {
    const result = await scan(bytes);
    record(name, 'AV', result === expected, result);
  }

  // AV fail-closed: an unreachable scanner must never read as clean.
  const deadScanner = new AttachmentMalwareScanner({
    clamAvHost: HOST,
    clamAvPort: 1,
    clamAvTimeoutMs: 2_000,
    isProduction: true,
  } as never);
  const deadResult = await deadScanner
    .assertClean(Buffer.from('sample'))
    .then(() => 'CLEAN')
    .catch((error: Error) => error.message);
  record('unreachable scanner fails closed', 'AV', deadResult !== 'CLEAN', deadResult);

  console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
