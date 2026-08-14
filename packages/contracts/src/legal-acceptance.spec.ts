import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CURRENT_LEGAL_DOCUMENTS,
  LEGAL_ACCEPTANCE_STATEMENT_VERSION,
  legalAcceptanceCapacity,
  legalAcceptanceStatements,
} from './legal-acceptance.js';

describe('legal acceptance release', () => {
  it('uses immutable versioned Thai artifacts and SHA-256 byte hashes', () => {
    assert.equal(CURRENT_LEGAL_DOCUMENTS.terms.version, 'v3');
    assert.equal(CURRENT_LEGAL_DOCUMENTS.privacy.version, 'v3');
    assert.equal(CURRENT_LEGAL_DOCUMENTS.terms.displayVersionTh, 'ฉบับที่ 1 (1.0)');
    assert.equal(CURRENT_LEGAL_DOCUMENTS.privacy.displayVersionTh, 'ฉบับที่ 1 (1.0)');
    assert.match(CURRENT_LEGAL_DOCUMENTS.terms.version, /^v\d+$/);
    assert.match(CURRENT_LEGAL_DOCUMENTS.privacy.version, /^v\d+$/);
    for (const document of Object.values(CURRENT_LEGAL_DOCUMENTS)) {
      assert.match(document.href, new RegExp(`/legal/releases/${document.version}/.+-th\\.html$`));
      assert.match(document.artifactSha256, /^[a-f0-9]{64}$/);
      assert.equal(document.releaseFingerprintSha256, document.artifactSha256);
    }
    assert.equal(CURRENT_LEGAL_DOCUMENTS.terms.latestHref, '/terms');
    assert.equal(CURRENT_LEGAL_DOCUMENTS.privacy.latestHref, '/privacy');
    assert.equal(LEGAL_ACCEPTANCE_STATEMENT_VERSION, 'v1');
  });

  it('derives capacity from server roles rather than accepting a client-selected capacity', () => {
    assert.equal(legalAcceptanceCapacity(['SYSTEM_ADMIN', 'OWNER']), 'SYSTEM_OPERATOR');
    assert.equal(legalAcceptanceCapacity(['OWNER']), 'AUTHORIZED_REPRESENTATIVE');
    assert.equal(legalAcceptanceCapacity(['EMPLOYEE']), 'INVITED_MEMBER');
  });

  it('keeps acceptance, acknowledgment and authority statements semantically separate', () => {
    const statements = legalAcceptanceStatements('INVITED_MEMBER', 'บริษัทตัวอย่าง', 'th');
    assert.match(statements.terms, /ฉันยอมรับข้อกำหนดการใช้งาน/);
    assert.match(statements.privacy, /ฉันยืนยันว่าได้รับและมีโอกาสอ่านประกาศความเป็นส่วนตัว/);
    assert.doesNotMatch(statements.privacy, /ยินยอม/);
    assert.match(statements.capacity, /ได้รับอนุญาตจาก บริษัทตัวอย่าง/);
  });
});
