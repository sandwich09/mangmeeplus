import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUploadFile } from './expense-upload.logic';

describe('classifyUploadFile', () => {
  const cases = [
    ['receipt.jpeg', 'image/jpeg', 'image'],
    ['receipt.jpg', 'image/jpeg', 'image'],
    ['receipt.png', 'image/png', 'image'],
    ['receipt.pdf', 'application/pdf', 'pdf'],
    ['receipt.heic', 'image/heic', 'heic'],
    ['receipt.heif', 'image/heif', 'heic'],
    ['AIR_DROP.HEIC', '', 'heic'],
    ['receipt.jpg', '', 'image'],
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
});
