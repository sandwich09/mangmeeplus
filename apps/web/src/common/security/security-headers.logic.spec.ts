import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentSecurityPolicy,
  buildS3EndpointOrigin,
  buildS3UploadOrigin,
} from './security-headers.logic';

function directives(csp: string): Map<string, string> {
  return new Map(csp.split('; ').map((directive): [string, string] => {
    const [name, ...values] = directive.split(' ');
    return [name, values.join(' ')];
  }));
}

describe('buildContentSecurityPolicy', () => {
  it('keeps the production policy byte-identical by default', () => {
    assert.equal(
      buildContentSecurityPolicy('N', ['http://localhost:3001']),
      "default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http://localhost:3001; font-src 'self' data:; connect-src 'self' http://localhost:3001; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self' blob:; upgrade-insecure-requests",
    );
  });

  it('adds the development sources needed by React and local storage', () => {
    const csp = buildContentSecurityPolicy('N', [], true);

    assert.ok(csp.includes("script-src 'self' 'nonce-N' 'strict-dynamic' 'unsafe-eval'"));
    assert.ok(csp.includes("img-src 'self' data: blob: https: http:"));
    assert.ok(csp.includes("connect-src 'self' http: https:"));
    assert.equal(csp.includes('upgrade-insecure-requests'), false);
    assert.ok(csp.includes("'nonce-N'"));
  });

  it('changes exactly the four documented directives in development', () => {
    const prod = directives(buildContentSecurityPolicy('N', ['http://localhost:3001']));
    const dev = directives(buildContentSecurityPolicy('N', ['http://localhost:3001'], true));
    const changed = [...new Set([...prod.keys(), ...dev.keys()])]
      .filter((name) => prod.get(name) !== dev.get(name))
      .sort();

    assert.deepEqual(changed, ['connect-src', 'img-src', 'script-src', 'upgrade-insecure-requests']);
  });

  it('still drops invalid and non-http connect URLs', () => {
    const csp = buildContentSecurityPolicy('N', [
      undefined,
      'not a URL',
      'ftp://files.example.com/path',
      'https://api.example.com/v1',
    ]);

    assert.equal(directives(csp).get('connect-src'), "'self' https://api.example.com");
  });

  it('adds only the exact configured S3 upload origin in production', () => {
    const uploadOrigin = buildS3UploadOrigin('watchdog-bms-uat-311414082667', 'ap-southeast-1');
    const csp = buildContentSecurityPolicy('N', [uploadOrigin]);

    assert.equal(
      directives(csp).get('connect-src'),
      "'self' https://watchdog-bms-uat-311414082667.s3.ap-southeast-1.amazonaws.com",
    );
    const connectSources = directives(csp).get('connect-src')?.split(' ') ?? [];
    assert.equal(connectSources.includes('https:'), false);
    assert.equal(connectSources.includes('*.amazonaws.com'), false);
  });

  it('rejects unsafe bucket or region values instead of widening CSP', () => {
    assert.equal(buildS3UploadOrigin('bucket; connect-src https:', 'ap-southeast-1'), undefined);
    assert.equal(buildS3UploadOrigin('valid-bucket', 'region; img-src'), undefined);
    assert.equal(buildS3UploadOrigin(undefined, 'ap-southeast-1'), undefined);
  });

  it('adds a valid configured storage endpoint origin to connect-src and img-src', () => {
    const endpointOrigin = buildS3EndpointOrigin('http://localhost:19000/storage/path');
    const csp = buildContentSecurityPolicy('N', [endpointOrigin]);

    assert.equal(directives(csp).get('connect-src'), "'self' http://localhost:19000");
    assert.equal(directives(csp).get('img-src'), "'self' data: blob: https: http://localhost:19000");
  });

  it('rejects malformed or non-http storage endpoints instead of widening CSP', () => {
    assert.equal(buildS3EndpointOrigin('https://storage.example.com; connect-src https:'), undefined);
    assert.equal(buildS3EndpointOrigin('ftp://storage.example.com'), undefined);
    assert.equal(
      directives(buildContentSecurityPolicy('N', [
        buildS3EndpointOrigin('https://storage.example.com; connect-src https:'),
      ])).get('connect-src'),
      "'self'",
    );
  });
});
