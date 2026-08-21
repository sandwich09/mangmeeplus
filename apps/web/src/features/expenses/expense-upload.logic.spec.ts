import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUploadFile, detectReceiptImageByteKind, RECEIPT_UPLOAD_ACCEPT } from './expense-upload.logic';

describe('classifyUploadFile', () => {
  const cases = [
    ['receipt.jpeg', 'image/jpeg', 'image'],
    ['receipt.jpg', 'image/jpeg', 'image'],
    ['receipt.png', 'image/png', 'image'],
    ['receipt.pdf', 'application/pdf', 'pdf'],
    ['receipt.heic', 'image/heic', 'heic'],
    ['receipt.heif', 'image/heif', 'heic'],
    ['receipt.gif', 'image/gif', 'image'],
    ['receipt.jpe', 'image/jpeg', 'image'],
    ['receipt.jpg', 'image/jpg', 'image'],
    ['AIR_DROP.HEIC', '', 'heic'],
    ['receipt.jpg', '', 'image'],
    ['receipt.gif', '', 'image'],
    ['receipt.jpg', 'application/pdf', 'unsupported'],
    ['receipt.pdf', 'image/jpeg', 'unsupported'],
    ['receipt.svg', 'image/svg+xml', 'unsupported'],
    ['malware.exe', 'application/octet-stream', 'unsupported'],
  ] as const;

  for (const [name, type, expected] of cases) {
    it(`${name} (${type || 'no MIME'}) is ${expected}`, () => {
      assert.equal(classifyUploadFile(name, type), expected);
    });
  }

  it('offers every supported reimbursement receipt source to the file picker', () => {
    for (const value of ['.pdf', '.png', '.jpg', '.jpeg', '.jpe', '.heic', '.heif', '.gif', 'image/gif']) {
      assert.ok(RECEIPT_UPLOAD_ACCEPT.split(',').includes(value));
    }
  });
});

describe('detectReceiptImageByteKind', () => {
  it('recognizes verified JPEG and PNG containers', () => {
    assert.equal(detectReceiptImageByteKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), 'jpeg');
    assert.equal(detectReceiptImageByteKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  });

  it('detects iPhone HEIC bytes even when file metadata says JPG', () => {
    const renamedHeic = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63]);
    assert.equal(detectReceiptImageByteKind(renamedHeic), 'heic');
  });

  it('does not pass a truncated JPEG through to the backend', () => {
    assert.equal(detectReceiptImageByteKind(Uint8Array.from([0xff, 0xd8, 0x00, 0x01])), 'unknown');
  });
});
