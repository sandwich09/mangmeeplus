/**
 * AgentCore Runtime invoke adapter – AI Runtime Production Integration spec §9.2.
 * Makes SigV4-signed HTTP POST to the AgentCore runtime endpoint.
 * Credential resolution reuses BedrockRuntimeClient provider chain (env vars, AWS profile, IMDS).
 * No new deps: uses @aws-sdk/client-bedrock-runtime (installed) + node:crypto + native fetch.
 *
 * ponytail: endpoint URL format must be confirmed against AWS AgentCore docs at deploy time.
 * LINE and web must never call this adapter or the runtime endpoint directly.
 */
import { Injectable } from '@nestjs/common';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import type { AiUsageEntry } from '@watchdog-bms/contracts';
import type { AgentCoreInvokeInput, AgentCoreInvokeResult, IAgentCoreRuntime } from './runtime.port';

type AwsCreds = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

const SERVICE = 'bedrock-agentcore';

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function isAnswerPresentation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const presentation = value as Record<string, unknown>;
  if (presentation['kind'] !== 'answer_cards' || !Array.isArray(presentation['cards'])) return false;
  const cards = presentation['cards'];
  if (cards.length === 0 || cards.length > 12) return false;
  return cards.every((card) => {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
    const item = card as Record<string, unknown>;
    if (typeof item['text'] !== 'string' || !item['text']) return false;
    if (item['title'] !== undefined && typeof item['title'] !== 'string') return false;
    if (item['sourceLabels'] !== undefined && (!Array.isArray(item['sourceLabels']) || !item['sourceLabels'].every((label) => typeof label === 'string'))) return false;
    if (item['webLink'] !== undefined) {
      const link = item['webLink'];
      if (!link || typeof link !== 'object' || Array.isArray(link)) return false;
      const record = link as Record<string, unknown>;
      if (typeof record['label'] !== 'string' || typeof record['path'] !== 'string') return false;
    }
    return true;
  });
}

const USAGE_COUNTERS = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheWriteInputTokens', 'durationMs'] as const;

function isUsageEntry(value: unknown): value is AiUsageEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry['tag'] !== 'string' || typeof entry['modelId'] !== 'string' || typeof entry['ok'] !== 'boolean') return false;
  return USAGE_COUNTERS.every((key) => typeof entry[key] === 'number' && Number.isFinite(entry[key]));
}

/** Bounded passthrough, same posture as the `toolsInvoked` coercion in the turn use case: the
 *  artifact is deployed separately, so its usage rows are untrusted JSON. Only contract fields
 *  cross, malformed entries are dropped rather than poisoning the API's meter, and an artifact
 *  that reports nothing leaves the field absent. */
function coerceUsage(value: unknown): AiUsageEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isUsageEntry).map((entry) => ({
    tag: entry.tag,
    modelId: entry.modelId,
    ok: entry.ok,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadInputTokens: entry.cacheReadInputTokens,
    cacheWriteInputTokens: entry.cacheWriteInputTokens,
    durationMs: entry.durationMs,
  }));
}
@Injectable()
export class AgentCoreRuntimeClient implements IAgentCoreRuntime {
  private readonly region: string;
  private readonly runtimeArn: string;
  private readonly qualifier: string;
  private readonly timeoutMs: number;
  private readonly credProvider: () => Promise<AwsCreds>;

  constructor(config: AiGatewayConfigService) {
    this.region = config.agentcoreRegion ?? config.bedrockRegion ?? 'ap-southeast-1';
    this.runtimeArn = config.agentcoreRuntimeArn ?? '';
    this.qualifier = config.agentcoreRuntimeQualifier ?? 'DEFAULT';
    this.timeoutMs = config.agentcoreInvokeTimeoutMs;
    // Reuse BedrockRuntimeClient credential chain (env vars, AWS profile, IMDS)
    this.credProvider = new BedrockRuntimeClient({ region: this.region }).config
      .credentials as unknown as () => Promise<AwsCreds>;
  }

  async invoke(input: AgentCoreInvokeInput): Promise<AgentCoreInvokeResult> {
    if (!this.runtimeArn) {
      throw Object.assign(new Error('AGENTCORE_RUNTIME_ARN not configured'), { code: 'RUNTIME_NOT_CONFIGURED' });
    }

    // AWS AgentCore: full ARN URL-encoded in path, qualifier as query string.
    // URL uses single-encoded ARN; SigV4 canonical URI uses double-encoded ARN (botocore behaviour).
    // Session ID must be >= 33 chars (AgentCore constraint) – use a UUID per invocation.
    const singleEncodedArn = encodeURIComponent(this.runtimeArn);
    const urlPath = `/runtimes/${singleEncodedArn}/invocations`;
    const canonicalPath = `/runtimes/${singleEncodedArn.replace(/%/g, '%25')}/invocations`;
    const canonicalQs = `qualifier=${encodeURIComponent(this.qualifier)}`;
    const host = `bedrock-agentcore.${this.region}.amazonaws.com`;
    const url = `https://${host}${urlPath}?${canonicalQs}`;
    const sessionId = randomUUID();
    const body = JSON.stringify(input);

    const creds = await this.credProvider();

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(Object.assign(new Error('AgentCore invoke timed out'), { code: 'TIMEOUT' })),
        this.timeoutMs,
      ),
    );

    const response = await Promise.race([
      this.signedPost(url, host, canonicalPath, canonicalQs, sessionId, body, creds),
      timeout,
    ]);

    if (!response.ok) {
      if (response.status === 404)
        throw Object.assign(new Error('AgentCore runtime not found'), { code: 'RUNTIME_NOT_FOUND' });
      if (response.status === 429)
        throw Object.assign(new Error('AgentCore throttled'), { code: 'THROTTLED' });
      if (response.status === 400)
        throw Object.assign(new Error('AgentCore invalid payload'), { code: 'INVALID_PAYLOAD' });
      throw Object.assign(new Error(`AgentCore invoke failed: ${response.status}`), { code: 'INVOKE_ERROR' });
    }

    const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !raw ||
      typeof raw['replyText'] !== 'string' ||
      typeof raw['plan'] !== 'object' ||
      !Array.isArray(raw['sourceRefs']) ||
      !Array.isArray(raw['webLinks']) ||
      !Array.isArray(raw['toolsInvoked']) ||
      (raw['presentation'] !== undefined && !isAnswerPresentation(raw['presentation']))
    ) {
      throw Object.assign(new Error('Malformed AgentCore response'), { code: 'MALFORMED_RESPONSE' });
    }

    const { usage: rawUsage, ...rest } = raw;
    const usage = coerceUsage(rawUsage);
    return { ...rest, ...(usage ? { usage } : {}) } as unknown as AgentCoreInvokeResult;
  }

  private async signedPost(
    url: string,
    host: string,
    canonicalPath: string,
    canonicalQs: string,
    sessionId: string,
    body: string,
    creds: AwsCreds,
  ): Promise<Response> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256hex(body);

    const rawHdrs: [string, string][] = [
      ['content-type', 'application/json'],
      ['host', host],
      ['x-amz-date', amzDate],
      ['x-amzn-bedrock-agentcore-runtime-session-id', sessionId],
    ];
    if (creds.sessionToken) rawHdrs.push(['x-amz-security-token', creds.sessionToken]);
    rawHdrs.sort(([a], [b]) => a.localeCompare(b));

    const signedHeaders = rawHdrs.map(([k]) => k).join(';');
    const canonicalHeaders = rawHdrs.map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
    const canonicalRequest = ['POST', canonicalPath, canonicalQs, canonicalHeaders, signedHeaders, payloadHash].join('\n');

    const credScope = `${dateStamp}/${this.region}/${SERVICE}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256hex(canonicalRequest)].join('\n');
    const sigKey = hmac(
      hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, dateStamp), this.region), SERVICE),
      'aws4_request',
    );
    const signature = hmac(sigKey, stringToSign).toString('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(url, {
      method: 'POST',
      headers: Object.fromEntries([...rawHdrs, ['Authorization', authorization]]),
      body,
    });
  }
}
