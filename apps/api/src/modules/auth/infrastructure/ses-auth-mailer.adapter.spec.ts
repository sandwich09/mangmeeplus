import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SesAuthMailerAdapter, sesConfigurationSet } from './ses-auth-mailer.adapter';

const CLAIM_INPUT = {
  toEmail: 'somchai@example.com',
  companyName: 'ร้านมั่งมี',
  rawToken: 'raw-token-value',
  expiresAt: new Date('2026-09-03T04:00:00.000Z'),
};

function harness(response: { MessageId?: string } = { MessageId: 'ses-message-1' }) {
  const inputs: any[] = [];
  const client = { send: async (command: any) => { inputs.push(command.input); return response; } } as any;
  const config = { sesFromAddress: 'contact@mangmeeplus.com', sesWebBaseUrl: 'https://uat.mangmeeplus.com' } as any;
  return { adapter: new SesAuthMailerAdapter(config, client), inputs };
}

/** The env var is read at send time, so each case has to own it. */
async function withConfigurationSet<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.SES_CONFIGURATION_SET;
  if (value === undefined) delete process.env.SES_CONFIGURATION_SET;
  else process.env.SES_CONFIGURATION_SET = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.SES_CONFIGURATION_SET;
    else process.env.SES_CONFIGURATION_SET = previous;
  }
}

describe('sesConfigurationSet', () => {
  it('is undefined when unset or blank, so the send keeps its pre-existing shape', () => {
    assert.equal(sesConfigurationSet({} as NodeJS.ProcessEnv), undefined);
    assert.equal(sesConfigurationSet({ SES_CONFIGURATION_SET: '   ' } as NodeJS.ProcessEnv), undefined);
    assert.equal(
      sesConfigurationSet({ SES_CONFIGURATION_SET: ' mangmee-transactional ' } as NodeJS.ProcessEnv),
      'mangmee-transactional',
    );
  });
});

describe('SesAuthMailerAdapter.sendAccountClaim', () => {
  it('omits ConfigurationSetName entirely when the env is unset', async () => {
    const h = harness();
    await withConfigurationSet(undefined, () => h.adapter.sendAccountClaim(CLAIM_INPUT));
    assert.equal('ConfigurationSetName' in h.inputs[0], false);
  });

  it('attaches the configuration set when the env names one — no events without it', async () => {
    const h = harness();
    await withConfigurationSet('mangmee-transactional', () => h.adapter.sendAccountClaim(CLAIM_INPUT));
    assert.equal(h.inputs[0].ConfigurationSetName, 'mangmee-transactional');
    assert.equal(h.inputs[0].Destination.ToAddresses[0], 'somchai@example.com');
  });

  it('returns the SES MessageId, the join key a later bounce event arrives with', async () => {
    const h = harness();
    const messageId = await withConfigurationSet('mangmee-transactional', () => h.adapter.sendAccountClaim(CLAIM_INPUT));
    assert.equal(messageId, 'ses-message-1');
  });

  it('returns null rather than undefined when SES answers without a MessageId', async () => {
    const h = harness({});
    assert.equal(await withConfigurationSet(undefined, () => h.adapter.sendAccountClaim(CLAIM_INPUT)), null);
  });

  it('sends every message type through the same configuration set, so reputation is measured once', async () => {
    const h = harness();
    await withConfigurationSet('mangmee-transactional', async () => {
      await h.adapter.sendEmailVerification({ toEmail: 'a@b.co', rawToken: 't', expiresAt: new Date() });
      await h.adapter.sendPasswordResetLink({ toEmail: 'a@b.co', rawToken: 't', expiresAt: new Date() });
    });
    assert.deepEqual(
      h.inputs.map((input) => input.ConfigurationSetName),
      ['mangmee-transactional', 'mangmee-transactional'],
    );
  });
});
