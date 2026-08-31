import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { SesEventsUseCase, expectedSesEventsTopicArn } from './ses-event.use-case';
import { resetSnsCertificateCache, snsCanonicalString, type SnsEnvelope } from '../infrastructure/sns-signature';

const TOPIC_ARN = 'arn:aws:sns:ap-southeast-1:311414082667:mangmee-ses-events';
const CERT_URL = 'https://sns.ap-southeast-1.amazonaws.com/SimpleNotificationService-abc123.pem';
const SES_MESSAGE_ID = '0100018f-ses-message-id';

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function envelope(message: unknown, overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
  const unsigned: SnsEnvelope = {
    Type: 'Notification',
    MessageId: 'sns-1',
    TopicArn: TOPIC_ARN,
    Message: typeof message === 'string' ? message : JSON.stringify(message),
    Timestamp: '2026-08-31T04:00:00.000Z',
    SignatureVersion: '1',
    Signature: 'unsigned',
    SigningCertURL: CERT_URL,
    ...overrides,
  };
  const signer = createSign('RSA-SHA1');
  signer.update(snsCanonicalString(unsigned), 'utf8');
  signer.end();
  return { ...unsigned, Signature: signer.sign(keyPair.privateKey, 'base64') };
}

function bounceEvent(bounceType: string, messageId = SES_MESSAGE_ID) {
  return {
    eventType: 'Bounce',
    bounce: {
      bounceType,
      bounceSubType: 'General',
      bouncedRecipients: [{ emailAddress: 'typo@exmaple.com', diagnosticCode: `smtp; 550 5.1.1 user unknown ${'x'.repeat(400)}` }],
    },
    mail: { messageId },
  };
}

function harness(options: { state?: string | null } = {}) {
  const advanced: any[] = [];
  const audits: any[] = [];
  const fetched: string[] = [];
  const logs: any[] = [];

  const row = options.state === null ? null : { id: 'signup-1', state: options.state ?? 'EMAIL_PENDING' };
  const prisma = {
    client: {
      companySignupRequest: { findUnique: async () => row },
      auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
    },
  } as any;
  const core = {
    advance: async (id: string, to: string, correlationRequestId: string, failureCode?: string) => {
      advanced.push({ id, to, correlationRequestId, failureCode });
      return {};
    },
  } as any;
  const httpGet = async (url: string) => { fetched.push(url); return publicKeyPem; };
  const logger = {
    warn: (fields: any) => logs.push(fields),
    info: (fields: any) => logs.push(fields),
    debug: (fields: any) => logs.push(fields),
    error: (fields: any) => logs.push(fields),
  } as any;

  resetSnsCertificateCache();
  return { useCase: new SesEventsUseCase(prisma, core, httpGet, logger), advanced, audits, fetched, logs };
}

/** The env var is the fail-closed switch, so every case has to state which side of it it is on. */
async function withTopicArn<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.SES_EVENTS_TOPIC_ARN;
  if (value === undefined) delete process.env.SES_EVENTS_TOPIC_ARN;
  else process.env.SES_EVENTS_TOPIC_ARN = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.SES_EVENTS_TOPIC_ARN;
    else process.env.SES_EVENTS_TOPIC_ARN = previous;
  }
}

describe('expectedSesEventsTopicArn', () => {
  it('is undefined when unset or blank, which is what makes the endpoint fail closed', () => {
    assert.equal(expectedSesEventsTopicArn({} as NodeJS.ProcessEnv), undefined);
    assert.equal(expectedSesEventsTopicArn({ SES_EVENTS_TOPIC_ARN: '  ' } as NodeJS.ProcessEnv), undefined);
    assert.equal(
      expectedSesEventsTopicArn({ SES_EVENTS_TOPIC_ARN: ` ${TOPIC_ARN} ` } as NodeJS.ProcessEnv),
      TOPIC_ARN,
    );
  });
});

describe('SesEventsUseCase gate', () => {
  it('refuses everything while SES_EVENTS_TOPIC_ARN is unset (fail closed)', async () => {
    const h = harness();
    await withTopicArn(undefined, async () => {
      await assert.rejects(
        () => h.useCase.handle(envelope(bounceEvent('Permanent')), 'req-1'),
        (error: unknown) => error instanceof ForbiddenException
          && String((error as ForbiddenException).message).includes('ses_events_topic_not_configured'),
      );
    });
    assert.deepEqual(h.advanced, []);
    assert.deepEqual(h.fetched, [], 'and never fetches a signing certificate');
  });

  it('refuses a message from any other topic before touching the signature', async () => {
    const h = harness();
    await withTopicArn(TOPIC_ARN, async () => {
      await assert.rejects(
        () => h.useCase.handle(envelope(bounceEvent('Permanent'), { TopicArn: `${TOPIC_ARN}-other` }), 'req-1'),
        ForbiddenException,
      );
    });
    assert.deepEqual(h.fetched, []);
  });

  it('rejects a bad signature with 403 and changes nothing', async () => {
    const h = harness();
    await withTopicArn(TOPIC_ARN, async () => {
      const tampered = { ...envelope(bounceEvent('Permanent')), Message: JSON.stringify(bounceEvent('Permanent', 'other')) };
      await assert.rejects(() => h.useCase.handle(tampered, 'req-1'), ForbiddenException);
    });
    assert.deepEqual(h.advanced, []);
    assert.equal(h.logs.some((line) => line.event === 'ses.sns.signature_invalid'), true);
  });

  it('rejects a body that is not an SNS envelope at all', async () => {
    const h = harness();
    await withTopicArn(TOPIC_ARN, async () => {
      await assert.rejects(() => h.useCase.handle({ hello: 'world' }, 'req-1'));
    });
  });
});

describe('SesEventsUseCase subscription confirmation', () => {
  const confirmation = (subscribeUrl: string) => envelope('{}', {
    Type: 'SubscriptionConfirmation', Token: 'tok-1', SubscribeURL: subscribeUrl,
  });

  it('confirms by GETting a SubscribeURL on an SNS host', async () => {
    const h = harness();
    const url = 'https://sns.ap-southeast-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok-1';
    const result = await withTopicArn(TOPIC_ARN, () => h.useCase.handle(confirmation(url), 'req-1'));

    assert.deepEqual(result, { handled: 'confirmed' });
    assert.equal(h.fetched.includes(url), true);
  });

  it('refuses a SubscribeURL pointed anywhere but SNS, signature or not', async () => {
    const h = harness();
    await withTopicArn(TOPIC_ARN, async () => {
      await assert.rejects(
        () => h.useCase.handle(confirmation('https://attacker.example.com/confirm'), 'req-1'),
        ForbiddenException,
      );
    });
    assert.equal(h.fetched.includes('https://attacker.example.com/confirm'), false);
  });

  it('refuses a plain-http SubscribeURL', async () => {
    const h = harness();
    await withTopicArn(TOPIC_ARN, async () => {
      await assert.rejects(
        () => h.useCase.handle(confirmation('http://sns.ap-southeast-1.amazonaws.com/?Action=Confirm'), 'req-1'),
        ForbiddenException,
      );
    });
  });
});

describe('SesEventsUseCase SES events', () => {
  it('fails the awaiting-claim request on a permanent bounce and records why', async () => {
    const h = harness();
    const result = await withTopicArn(TOPIC_ARN, () => h.useCase.handle(envelope(bounceEvent('Permanent')), 'req-1'));

    assert.deepEqual(result, { handled: 'failed' });
    assert.deepEqual(h.advanced, [{
      id: 'signup-1', to: 'EMAIL_FAILED', correlationRequestId: 'req-1', failureCode: 'email_bounce_permanent',
    }]);
    const [audit] = h.audits;
    assert.equal(audit.action, 'signup.claim_email.bounced');
    assert.equal(audit.targetId, 'signup-1');
    assert.equal(audit.result, 'FAILED');
    assert.equal(audit.metadataJson.bouncedRecipient, 'typo@exmaple.com');
    assert.equal(audit.metadataJson.sesMessageId, SES_MESSAGE_ID);
    assert.equal(audit.metadataJson.diagnosticCode.length, 200, 'diagnostic code is truncated');
  });

  it('fails the request on a complaint too', async () => {
    const h = harness();
    const complaint = {
      eventType: 'Complaint',
      complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'someone@example.com' }] },
      mail: { messageId: SES_MESSAGE_ID },
    };
    const result = await withTopicArn(TOPIC_ARN, () => h.useCase.handle(envelope(complaint), 'req-1'));

    assert.deepEqual(result, { handled: 'failed' });
    assert.equal(h.advanced[0].failureCode, 'email_complaint');
    assert.equal(h.audits[0].action, 'signup.claim_email.complaint');
    assert.equal(h.audits[0].metadataJson.complaintFeedbackType, 'abuse');
  });

  it('leaves a request that already moved on exactly as it is (idempotent redelivery)', async () => {
    for (const state of ['EMAIL_VERIFIED', 'COMPLETED', 'EMAIL_FAILED', 'EXPIRED']) {
      const h = harness({ state });
      const result = await withTopicArn(TOPIC_ARN, () => h.useCase.handle(envelope(bounceEvent('Permanent')), 'req-1'));
      assert.deepEqual(result, { handled: 'ignored' }, state);
      assert.deepEqual(h.advanced, [], state);
      assert.deepEqual(h.audits, [], state);
    }
  });

  it('ignores an event for a message id this product never sent', async () => {
    const h = harness({ state: null });
    const result = await withTopicArn(TOPIC_ARN, () => h.useCase.handle(envelope(bounceEvent('Permanent', 'someone-elses')), 'req-1'));

    assert.deepEqual(result, { handled: 'ignored' });
    assert.deepEqual(h.advanced, []);
    assert.equal(h.logs.some((line) => line.event === 'ses.event.unknown_message'), true);
  });

  it('logs a transient bounce and changes nothing — SES is still retrying it', async () => {
    for (const bounceType of ['Transient', 'Undetermined']) {
      const h = harness();
      const result = await withTopicArn(TOPIC_ARN, () => h.useCase.handle(envelope(bounceEvent(bounceType)), 'req-1'));
      assert.deepEqual(result, { handled: 'ignored' }, bounceType);
      assert.deepEqual(h.advanced, [], bounceType);
      assert.equal(h.logs.some((line) => line.event === 'ses.bounce.transient'), true, bounceType);
    }
  });

  it('ignores delivery notices, the event every single send produces', async () => {
    const h = harness();
    const result = await withTopicArn(TOPIC_ARN, () => h.useCase.handle(
      envelope({ eventType: 'Delivery', mail: { messageId: SES_MESSAGE_ID } }), 'req-1',
    ));

    assert.deepEqual(result, { handled: 'ignored' });
    assert.deepEqual(h.advanced, []);
    assert.deepEqual(h.audits, []);
  });

  it('accepts the older identity-level shape, which names the field notificationType', async () => {
    const h = harness();
    const { eventType: _dropped, ...rest } = bounceEvent('Permanent');
    const result = await withTopicArn(TOPIC_ARN, () => h.useCase.handle(
      envelope({ ...rest, notificationType: 'Bounce' }), 'req-1',
    ));

    assert.deepEqual(result, { handled: 'failed' });
    assert.equal(h.advanced[0].to, 'EMAIL_FAILED');
  });
});
