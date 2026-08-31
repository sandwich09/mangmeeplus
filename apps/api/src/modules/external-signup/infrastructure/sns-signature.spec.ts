import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import {
  parseSnsEnvelope,
  resetSnsCertificateCache,
  snsCanonicalString,
  snsHttpsUrl,
  verifySnsSignature,
  type SnsEnvelope,
} from './sns-signature';

const CERT_URL = 'https://sns.ap-southeast-1.amazonaws.com/SimpleNotificationService-abc123.pem';
const TOPIC_ARN = 'arn:aws:sns:ap-southeast-1:311414082667:mangmee-ses-events';

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function notification(overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
  return {
    Type: 'Notification',
    MessageId: 'sns-1',
    TopicArn: TOPIC_ARN,
    Message: '{"eventType":"Delivery"}',
    Timestamp: '2026-08-31T04:00:00.000Z',
    SignatureVersion: '1',
    Signature: 'unsigned',
    SigningCertURL: CERT_URL,
    ...overrides,
  };
}

/** Signs the canonical string the verifier will rebuild — the real AWS signing procedure. */
function signed(envelope: SnsEnvelope, privateKeyPem: KeyObject | string = keyPair.privateKey): SnsEnvelope {
  const algorithm = envelope.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  const signer = createSign(algorithm);
  signer.update(snsCanonicalString(envelope), 'utf8');
  signer.end();
  return { ...envelope, Signature: signer.sign(privateKeyPem, 'base64') };
}

function fetcher(pem = publicKeyPem) {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url: string) => { calls.push(url); return pem; },
  };
}

describe('snsCanonicalString', () => {
  it('emits the signed fields in AWS order, name and value each on their own line', () => {
    assert.equal(
      snsCanonicalString(notification({ Subject: 'hi' })),
      'Message\n{"eventType":"Delivery"}\nMessageId\nsns-1\nSubject\nhi\n'
      + 'Timestamp\n2026-08-31T04:00:00.000Z\nTopicArn\n' + TOPIC_ARN + '\nType\nNotification\n',
    );
  });

  it('omits an absent Subject entirely rather than signing an empty value', () => {
    assert.equal(snsCanonicalString(notification()).includes('Subject'), false);
  });

  it('uses the confirmation field set — SubscribeURL and Token, no Subject', () => {
    const canonical = snsCanonicalString(notification({
      Type: 'SubscriptionConfirmation', Token: 'tok-1', SubscribeURL: `${CERT_URL}?Action=Confirm`, Subject: 'ignored',
    }));
    assert.match(canonical, /SubscribeURL\n/);
    assert.match(canonical, /Token\ntok-1\n/);
    assert.equal(canonical.includes('Subject'), false);
  });
});

describe('parseSnsEnvelope', () => {
  it('rejects anything without the full signed field set or with an unknown type', () => {
    assert.equal(parseSnsEnvelope(null), null);
    assert.equal(parseSnsEnvelope('{}'), null);
    assert.equal(parseSnsEnvelope({ ...notification(), Signature: undefined }), null);
    assert.equal(parseSnsEnvelope({ ...notification(), Type: 'SomethingElse' }), null);
    assert.notEqual(parseSnsEnvelope(notification()), null);
  });
});

describe('snsHttpsUrl', () => {
  it('accepts only https on an sns.<region>.amazonaws.com host', () => {
    assert.notEqual(snsHttpsUrl('https://sns.us-east-1.amazonaws.com/x'), null);
    assert.equal(snsHttpsUrl('http://sns.ap-southeast-1.amazonaws.com/x'), null, 'plain http');
    assert.equal(snsHttpsUrl('https://sns.ap-southeast-1.amazonaws.com.evil.tld/x'), null, 'suffix host');
    assert.equal(snsHttpsUrl('https://evil.tld/sns.ap-southeast-1.amazonaws.com'), null, 'host in path');
    assert.equal(snsHttpsUrl('https://attacker.example.com/x'), null);
    assert.equal(snsHttpsUrl('not a url'), null);
  });

  it('requires a .pem path when asked, so a certificate fetch cannot be pointed at anything else', () => {
    assert.notEqual(snsHttpsUrl(CERT_URL, true), null);
    assert.equal(snsHttpsUrl('https://sns.ap-southeast-1.amazonaws.com/not-a-cert', true), null);
  });
});

describe('verifySnsSignature', () => {
  it('accepts a SignatureVersion 1 (SHA1withRSA) message', async () => {
    resetSnsCertificateCache();
    const http = fetcher();
    assert.equal(await verifySnsSignature(signed(notification()), http.fetch), true);
    assert.deepEqual(http.calls, [CERT_URL]);
  });

  it('accepts a SignatureVersion 2 (SHA256withRSA) message', async () => {
    resetSnsCertificateCache();
    assert.equal(
      await verifySnsSignature(signed(notification({ SignatureVersion: '2' })), fetcher().fetch),
      true,
    );
  });

  it('rejects a message whose body was changed after signing', async () => {
    resetSnsCertificateCache();
    const envelope = signed(notification());
    assert.equal(
      await verifySnsSignature({ ...envelope, Message: '{"eventType":"Bounce"}' }, fetcher().fetch),
      false,
    );
  });

  it('rejects a signature made with a different key', async () => {
    resetSnsCertificateCache();
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    assert.equal(await verifySnsSignature(signed(notification(), other.privateKey), fetcher().fetch), false);
  });

  it('rejects an unknown SignatureVersion instead of guessing an algorithm', async () => {
    resetSnsCertificateCache();
    const http = fetcher();
    assert.equal(await verifySnsSignature(signed(notification({ SignatureVersion: '3' })), http.fetch), false);
    assert.deepEqual(http.calls, [], 'and never fetches a certificate for it');
  });

  it('refuses to fetch a certificate from a host that is not SNS', async () => {
    resetSnsCertificateCache();
    const http = fetcher();
    const envelope = signed(notification({ SigningCertURL: 'https://attacker.example.com/cert.pem' }));
    assert.equal(await verifySnsSignature(envelope, http.fetch), false);
    assert.deepEqual(http.calls, [], 'no request leaves the process');
  });

  it('treats a failed certificate fetch as "not verified", never as an exception', async () => {
    resetSnsCertificateCache();
    const failing = async () => { throw new Error('sns_fetch_status_500'); };
    assert.equal(await verifySnsSignature(signed(notification()), failing), false);
  });

  it('caches the certificate in-process, so a burst of events costs one fetch', async () => {
    resetSnsCertificateCache();
    const http = fetcher();
    await verifySnsSignature(signed(notification()), http.fetch);
    await verifySnsSignature(signed(notification({ MessageId: 'sns-2' })), http.fetch);
    assert.deepEqual(http.calls, [CERT_URL]);
  });

  it('verifies against the X.509 certificate SNS actually serves, not only a bare public key', async () => {
    resetSnsCertificateCache();
    const material = selfSignedCertificate();
    if (!material) return; // openssl unavailable — the bare-key cases above still cover the path
    const envelope = signed(notification(), material.privateKeyPem);
    assert.equal(await verifySnsSignature(envelope, fetcher(material.certificatePem).fetch), true);
  });
});

/** A real self-signed certificate, so the `X509Certificate` branch is exercised, not just stubbed. */
function selfSignedCertificate(): { privateKeyPem: string; certificatePem: string } | null {
  let output: string;
  try {
    output = execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', '/dev/stdout', '-out', '/dev/stdout', '-days', '1', '-subj', '/CN=sns.test',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const key = output.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/)?.[0];
  const cert = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  return key && cert ? { privateKeyPem: `${key}\n`, certificatePem: `${cert}\n` } : null;
}
