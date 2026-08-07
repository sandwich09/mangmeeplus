import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalAttachmentExtension,
  detectAttachmentMimeType,
  downloadContentDisposition,
  inlineDownloadContentType,
  inspectAttachmentBytes,
  normalizeAttachmentMimeType,
  validateAttachmentFileName,
  validateAttachmentMeta,
  MAX_ATTACHMENT_BYTES,
} from './attachment.logic';

describe('attachment.logic', () => {
  describe('validateAttachmentMeta', () => {
    it('accepts valid PDF within size limit', () => {
      assert.equal(validateAttachmentMeta('application/pdf', 1024), null);
    });
    it('rejects disallowed MIME type', () => {
      assert.notEqual(validateAttachmentMeta('application/exe', 100), null);
    });
    it('rejects size > 25 MB', () => {
      assert.notEqual(validateAttachmentMeta('application/pdf', MAX_ATTACHMENT_BYTES + 1), null);
    });
    it('rejects zero size', () => {
      assert.notEqual(validateAttachmentMeta('image/jpeg', 0), null);
    });
    it('rejects SVG, Office, and CSV active-content containers', () => {
      for (const mime of ['image/svg+xml', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
        assert.notEqual(validateAttachmentMeta(mime, 100), null);
      }
    });
  });

  describe('validateAttachmentFileName', () => {
    it('accepts every allowed extension/MIME pair case-insensitively', () => {
      for (const [fileName, mimeType] of [
        ['receipt.pdf', 'application/pdf'],
        ['receipt.PNG', 'image/png'],
        ['receipt.jpg', 'image/jpeg'],
        ['receipt.JPEG', 'image/jpeg'],
      ]) {
        assert.equal(validateAttachmentFileName(fileName, mimeType), null);
      }
    });

    it('rejects missing, unsupported, and MIME-mismatched extensions', () => {
      for (const [fileName, mimeType] of [
        ['receipt', 'application/pdf'],
        [undefined, 'application/pdf'],
        ['receipt.svg', 'image/png'],
        ['receipt.jpg.exe', 'image/jpeg'],
        ['receipt.pdf', 'image/jpeg'],
        ['receipt.jpg', 'application/pdf'],
      ] as const) {
        assert.match(validateAttachmentFileName(fileName, mimeType)!, /extension/i);
      }
    });
  });

  describe('inspectAttachmentBytes', () => {
    it('accepts a passive PNG with matching magic bytes', () => {
      assert.equal(inspectAttachmentBytes('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), null);
    });
    it('rejects MIME spoofing and polyglot active content', () => {
      assert.match(inspectAttachmentBytes('application/pdf', Buffer.from('not a pdf'))!, /signature/i);
      assert.match(inspectAttachmentBytes('application/pdf', Buffer.from('%PDF-1.7\\n/JavaScript alert(1)'))!, /active/i);
    });
    it('rejects EICAR before an object can become ACTIVE', () => {
      assert.match(inspectAttachmentBytes('application/pdf', Buffer.from('%PDF-1.7 EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))!, /malware/i);
    });
  });

  describe('inlineDownloadContentType', () => {
    it('passes through renderable types (incl. system-generated SVG artifacts)', () => {
      assert.equal(inlineDownloadContentType('image/svg+xml'), 'image/svg+xml');
      assert.equal(inlineDownloadContentType('image/png'), 'image/png');
      assert.equal(inlineDownloadContentType('image/jpeg'), 'image/jpeg');
      assert.equal(inlineDownloadContentType('application/pdf'), 'application/pdf');
    });
    it('forces octet-stream for scriptable, unknown, or missing types', () => {
      assert.equal(inlineDownloadContentType('text/html'), 'application/octet-stream');
      assert.equal(inlineDownloadContentType('image/svg+xml; charset=utf-8'), 'application/octet-stream');
      assert.equal(inlineDownloadContentType(undefined), 'application/octet-stream');
      assert.equal(inlineDownloadContentType(null), 'application/octet-stream');
    });
  });

  describe('downloadContentDisposition', () => {
    it('stays attachment unless inline is asked for', () => {
      assert.equal(downloadContentDisposition({ mimeType: 'image/png', fileName: 'receipt.png' }), 'attachment; filename="receipt.png"');
      assert.equal(downloadContentDisposition({ disposition: 'attachment', mimeType: 'image/png', fileName: 'receipt.png' }), 'attachment; filename="receipt.png"');
      // The default every existing caller gets, byte for byte.
      assert.equal(downloadContentDisposition({}), 'attachment; filename="download"');
    });

    it('serves inline only for types a browser renders as a picture', () => {
      for (const mimeType of ['image/png', 'image/jpeg', 'application/pdf']) {
        assert.equal(downloadContentDisposition({ disposition: 'inline', mimeType, fileName: 'f' }), 'inline; filename="f"', mimeType);
      }
    });

    it('falls back to attachment for sniffable, active, unknown, or missing types', () => {
      // image/svg+xml is image/* but is a script-carrying document when opened inline.
      for (const mimeType of ['image/svg+xml', 'text/html', 'application/octet-stream', 'image/png; charset=utf-8', undefined, null]) {
        assert.equal(downloadContentDisposition({ disposition: 'inline', mimeType, fileName: 'f' }), 'attachment; filename="f"', String(mimeType));
      }
    });

    it('keeps the header un-splittable whichever disposition wins', () => {
      assert.equal(
        downloadContentDisposition({ disposition: 'inline', mimeType: 'image/png', fileName: 'a"b\r\nc.png' }),
        'inline; filename="a_b__c.png"',
      );
    });
  });

  describe('provider metadata normalization', () => {
    it('detects every allowed byte signature and normalizes generic LINE content types', () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const pdf = Buffer.from('%PDF-1.7');
      assert.equal(detectAttachmentMimeType(jpeg), 'image/jpeg');
      assert.equal(detectAttachmentMimeType(png), 'image/png');
      assert.equal(detectAttachmentMimeType(pdf), 'application/pdf');
      assert.equal(normalizeAttachmentMimeType('application/octet-stream', pdf), 'application/pdf');
      assert.equal(normalizeAttachmentMimeType('IMAGE/JPG; charset=binary', jpeg), 'image/jpeg');
      assert.equal(canonicalAttachmentExtension('image/jpeg'), 'jpg');
      assert.equal(canonicalAttachmentExtension('application/zip'), null);
    });
  });
});
