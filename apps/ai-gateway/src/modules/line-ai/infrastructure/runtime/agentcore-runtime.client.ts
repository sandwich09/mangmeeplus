/**
 * AgentCore Runtime invoke adapter – AI Runtime Production Integration spec §9.2.
 * Makes SigV4-signed HTTP POST to the AgentCore runtime endpoint.
 * Credential resolution reuses BedrockRuntimeClient provider chain (env vars, AWS profile, IMDS).
 * No new deps: uses @aws-sdk/client-bedrock-runtime (installed) + node:crypto + native fetch.
 *
 * ponytail: endpoint URL format must be confirmed against AWS AgentCore docs at deploy time.
 * LINE and web must never call this adapter or the runtime endpoint directly.
 */
import { Inject, Injectable } from '@nestjs/common';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AiGatewayConfigService } from '../../../../common/config/ai-gateway-config.service';
import { AI_BUDGET_ESTIMATOR_VERSION_V2, AI_BUDGET_PROFILE_TABLE_DIGEST_V2, parseLineAiAnswerCardLayout, parseLineAiSemanticCoverage } from '@watchdog-bms/contracts';
import type {
  AiUsageEntry,
  LineAiExpectedRuntimeIdentity,
  LineAiRefusalReason,
  LineAiRuntimeIdentity,
  LineAiStageDurations,
} from '@watchdog-bms/contracts';
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

/** A card's `layout` is presentation metadata from a separately deployed artifact: re-parsed here with
 *  the contract's own validator, and a layout that does not parse is dropped — the card is then its
 *  `text`, which the check above already required. The answer itself is never refused for it. */
function withParsedCardLayouts(presentation: unknown): unknown {
  const record = presentation as { cards: Array<Record<string, unknown>> };
  return { ...record, cards: record.cards.map(({ layout: rawLayout, ...card }) => {
    const layout = rawLayout === undefined ? undefined : parseLineAiAnswerCardLayout(rawLayout);
    return layout ? { ...card, layout } : card;
  }) };
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

const REFUSAL_REASONS = new Set<LineAiRefusalReason>([
  'mutation_blocked', 'safety_crisis', 'privacy_rumor', 'unsupported_module', 'unsupported_yet',
  'forbidden', 'unlinked_user', 'ambiguous_company', 'tool_unavailable', 'feature_disabled',
  'ai_timeout', 'line_delivery_failure',
]);

function coerceRuntimeIdentity(value: unknown): LineAiRuntimeIdentity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const identity = value as Record<string, unknown>;
  if (
    typeof identity['sourceCommit'] !== 'string'
    || !/^[0-9a-f]{40}$/.test(identity['sourceCommit'])
    || typeof identity['artifactSha256'] !== 'string'
    || !/^[0-9a-f]{64}$/.test(identity['artifactSha256'])
    || typeof identity['serviceVersion'] !== 'string'
    || identity['serviceVersion'].length === 0
    || identity['serviceVersion'].length > 128
    || !Number.isInteger(identity['contractVersion'])
    || Number(identity['contractVersion']) <= 0
  ) return undefined;
  return {
    sourceCommit: identity['sourceCommit'],
    artifactSha256: identity['artifactSha256'],
    serviceVersion: identity['serviceVersion'],
    contractVersion: Number(identity['contractVersion']),
  };
}

const STAGE_KEYS = [
  'bodyReadMs', 'payloadValidationMs', 'orchestrationMs', 'runtimeTotalMs', 'agentcoreHttpMs',
] as const;

function coerceStageDurations(value: unknown): LineAiStageDurations | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const entries = STAGE_KEYS.flatMap((key) => {
    const duration = raw[key];
    return typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
      ? [[key, Math.round(duration)] as const]
      : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function coerceRefusalReason(value: unknown): LineAiRefusalReason | undefined {
  return typeof value === 'string' && REFUSAL_REASONS.has(value as LineAiRefusalReason)
    ? value as LineAiRefusalReason
    : undefined;
}

/** How long a YES of the budget capability probe is remembered by one gateway process. */
const BUDGET_V2_CAPABILITY_TTL_MS = 5 * 60_000;

@Injectable()
export class AgentCoreRuntimeClient implements IAgentCoreRuntime {
  private readonly region: string;
  private readonly runtimeArn: string;
  private readonly qualifier: string;
  private readonly timeoutMs: number;
  private readonly expectedRuntimeIdentity?: LineAiExpectedRuntimeIdentity;
  private readonly credProvider: () => Promise<AwsCreds>;
  /** Until when this process remembers that its runtime answered the budget probe with a yes. */
  private budgetV2CapableUntilMs = 0;

  constructor(@Inject(AiGatewayConfigService) config: AiGatewayConfigService) {
    this.region = config.agentcoreRegion ?? config.bedrockRegion ?? 'ap-southeast-1';
    this.runtimeArn = config.agentcoreRuntimeArn ?? '';
    this.qualifier = config.agentcoreRuntimeQualifier ?? 'DEFAULT';
    this.timeoutMs = config.agentcoreInvokeTimeoutMs;
    const sourceCommit = config.agentcoreExpectedSourceCommit;
    const artifactSha256 = config.agentcoreExpectedArtifactSha256;
    const contractVersion = config.agentcoreExpectedContractVersion;
    this.expectedRuntimeIdentity = sourceCommit && artifactSha256 && contractVersion
      ? { sourceCommit, artifactSha256, contractVersion }
      : undefined;
    // Reuse BedrockRuntimeClient credential chain (env vars, AWS profile, IMDS)
    this.credProvider = new BedrockRuntimeClient({ region: this.region }).config
      .credentials as unknown as () => Promise<AwsCreds>;
  }

  /** The separately deployed artifact reports its own catalog flag without running the model. */
  async lineDraftEditCapabilityEnabled(): Promise<boolean> {
    try {
      const result = await this.invoke({
        turnId: `line-edit-capability-${randomUUID()}`,
        companyId: 'line-edit-capability-probe', userId: 'line-edit-capability-probe',
        messageText: 'capability probe', locale: 'th-TH', permissions: [],
        lineDraftEditCapabilityProbe: true,
      });
      return result.lineDraftEditEnabled === true;
    } catch {
      return false;
    }
  }

  /**
   * Negotiates the actual separately deployed artifact without dispatching a model or private data.
   *
   * The probe is an invocation of the runtime, and it ran before EVERY LINE message: 1.5 of a turn's
   * seconds (UAT 2026-10-05, `line.ai.intake_timing` grantMs 1505). Its answer is about the artifact
   * behind this process's own pinned qualifier, which a release never changes under a serving process
   * (the next release pins a NEW process to the other qualifier), and every real invocation still
   * checks the runtime's identity itself (`invoke` fails closed on a mismatch). So a YES is remembered
   * by this process for a few minutes. A NO or a failed probe is never remembered: the next message asks again.
   */
  async lineBudgetV2CapabilityEnabled(): Promise<boolean> {
    if (!this.expectedRuntimeIdentity) return false;
    if (Date.now() < this.budgetV2CapableUntilMs) return true;
    const capable = await this.probeLineBudgetV2Capability();
    if (capable) this.budgetV2CapableUntilMs = Date.now() + BUDGET_V2_CAPABILITY_TTL_MS;
    return capable;
  }

  private async probeLineBudgetV2Capability(): Promise<boolean> {
    if (!this.expectedRuntimeIdentity) return false;
    try {
      const result = await this.invoke({
        turnId: `line-budget-v2-capability-${randomUUID()}`,
        companyId: 'line-budget-v2-capability-probe', userId: 'line-budget-v2-capability-probe',
        messageText: 'capability probe', locale: 'th-TH', permissions: [],
        lineBudgetV2CapabilityProbe: true,
      });
      const capability = result.lineBudgetV2Capability;
      const identity = result.runtimeIdentity;
      return capability?.supported === true
        && capability.inputContractVersion === 2
        && capability.providerOutputVersion === 2
        && capability.budgetContractVersion === 2
        && capability.profileTableDigest === AI_BUDGET_PROFILE_TABLE_DIGEST_V2
        && capability.estimatorVersion === AI_BUDGET_ESTIMATOR_VERSION_V2
        && !!identity
        && identity.sourceCommit === this.expectedRuntimeIdentity.sourceCommit
        && identity.artifactSha256 === this.expectedRuntimeIdentity.artifactSha256
        && identity.contractVersion === this.expectedRuntimeIdentity.contractVersion;
    } catch {
      return false;
    }
  }

  async invoke(input: AgentCoreInvokeInput): Promise<AgentCoreInvokeResult> {
    if (!this.runtimeArn) {
      throw Object.assign(new Error('AGENTCORE_RUNTIME_ARN not configured'), { code: 'RUNTIME_NOT_CONFIGURED' });
    }
    const runtimeBinding = {
      runtimeArnHash: sha256hex(this.runtimeArn).slice(0, 16),
      qualifier: this.qualifier,
    };
    const failure = (
      message: string,
      code: string,
      stageDurationsMs?: LineAiStageDurations,
      runtimeIdentity?: LineAiRuntimeIdentity,
    ) => Object.assign(new Error(message), {
      code,
      runtimeBinding,
      ...(this.expectedRuntimeIdentity ? { expectedRuntimeIdentity: this.expectedRuntimeIdentity } : {}),
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
      ...(stageDurationsMs ? { stageDurationsMs } : {}),
    });

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

    let creds: AwsCreds;
    try {
      creds = await this.credProvider();
    } catch (error) {
      if (error && typeof error === 'object') {
        Object.assign(error, {
          runtimeBinding,
          ...(this.expectedRuntimeIdentity ? { expectedRuntimeIdentity: this.expectedRuntimeIdentity } : {}),
          stageDurationsMs: { agentcoreHttpMs: 0 },
        });
      }
      throw error;
    }

    const httpStartedAt = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), input.lineDraftEditCapabilityProbe || input.lineBudgetV2CapabilityProbe ? Math.min(this.timeoutMs, 3_000) : this.timeoutMs);
    let response: Response;
    try {
      response = await this.signedPost(url, host, canonicalPath, canonicalQs, sessionId, body, creds, abort.signal);
    } catch (error) {
      if (abort.signal.aborted) {
        throw failure('AgentCore invoke timed out', 'TIMEOUT', { agentcoreHttpMs: Date.now() - httpStartedAt });
      }
      if (error && typeof error === 'object') {
        Object.assign(error, {
          runtimeBinding,
          ...(this.expectedRuntimeIdentity ? { expectedRuntimeIdentity: this.expectedRuntimeIdentity } : {}),
          stageDurationsMs: { agentcoreHttpMs: Date.now() - httpStartedAt },
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const agentcoreHttpMs = Date.now() - httpStartedAt;

    if (!response.ok) {
      if (response.status === 404)
        throw failure('AgentCore runtime not found', 'RUNTIME_NOT_FOUND', { agentcoreHttpMs });
      if (response.status === 429)
        throw failure('AgentCore throttled', 'THROTTLED', { agentcoreHttpMs });
      if (response.status === 400)
        throw failure('AgentCore invalid payload', 'INVALID_PAYLOAD', { agentcoreHttpMs });
      throw failure(`AgentCore invoke failed: ${response.status}`, 'INVOKE_ERROR', { agentcoreHttpMs });
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
     || (raw['deterministicExpenseSummary'] !== undefined && typeof raw['deterministicExpenseSummary'] !== 'boolean')
      || (raw['deterministicExpenseCriterionConfirmation'] !== undefined && typeof raw['deterministicExpenseCriterionConfirmation'] !== 'boolean')
    ) {
      throw failure('Malformed AgentCore response', 'MALFORMED_RESPONSE', { agentcoreHttpMs });
    }
    const semanticCoverage = input.semanticSubrequests
      ? parseLineAiSemanticCoverage(raw['semanticCoverage'], input.semanticSubrequests)
      : undefined;
    if (input.semanticSubrequests && !semanticCoverage) {
      throw failure('AgentCore semantic coverage missing or invalid', 'AI_CONTRACT_UNSUPPORTED', { agentcoreHttpMs });
    }

    const {
      usage: rawUsage,
      runtimeIdentity: rawRuntimeIdentity,
      stageDurationsMs: rawStageDurations,
      modelCallCount: rawModelCallCount,
      refusalReason: rawRefusalReason,
      errorCode: rawErrorCode,
      semanticCoverage: _rawSemanticCoverage,
      ...rest
    } = raw;
    const usage = coerceUsage(rawUsage);
    const runtimeIdentity = coerceRuntimeIdentity(rawRuntimeIdentity);
    const stageDurationsMs = {
      ...coerceStageDurations(rawStageDurations),
      agentcoreHttpMs,
    };
    const modelCallCount = Number.isInteger(rawModelCallCount) && Number(rawModelCallCount) >= 0
      && Number(rawModelCallCount) <= 100
      ? Number(rawModelCallCount)
      : undefined;
    const refusalReason = coerceRefusalReason(rawRefusalReason);
   const deterministicExpenseSummary = raw['deterministicExpenseSummary'] === true;
    const deterministicExpenseCriterionConfirmation = raw['deterministicExpenseCriterionConfirmation'] === true;
    const errorCode = typeof rawErrorCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(rawErrorCode)
      ? rawErrorCode
      : undefined;
    if (this.expectedRuntimeIdentity && !runtimeIdentity) {
      throw failure('AgentCore runtime identity missing', 'RUNTIME_IDENTITY_MISSING', stageDurationsMs);
    }
    if (this.expectedRuntimeIdentity && runtimeIdentity && (
      runtimeIdentity.sourceCommit !== this.expectedRuntimeIdentity.sourceCommit
      || runtimeIdentity.artifactSha256 !== this.expectedRuntimeIdentity.artifactSha256
      || runtimeIdentity.contractVersion !== this.expectedRuntimeIdentity.contractVersion
    )) {
      throw failure(
        'AgentCore runtime identity mismatch',
        'RUNTIME_IDENTITY_MISMATCH',
        stageDurationsMs,
        runtimeIdentity,
      );
    }
    return {
      ...rest,
      ...(rest['presentation'] !== undefined ? { presentation: withParsedCardLayouts(rest['presentation']) } : {}),
      runtimeBinding,
      ...(usage ? { usage } : {}),
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
      ...(this.expectedRuntimeIdentity ? { expectedRuntimeIdentity: this.expectedRuntimeIdentity } : {}),
      stageDurationsMs,
      ...(modelCallCount !== undefined ? { modelCallCount } : {}),
      ...(refusalReason ? { refusalReason } : {}),
      ...(errorCode ? { errorCode } : {}),
     ...(deterministicExpenseSummary ? { deterministicExpenseSummary: true } : {}),
      ...(deterministicExpenseCriterionConfirmation ? { deterministicExpenseCriterionConfirmation: true } : {}),
      ...(semanticCoverage ? { semanticCoverage } : {}),
    } as unknown as AgentCoreInvokeResult;
  }

  private async signedPost(
    url: string,
    host: string,
    canonicalPath: string,
    canonicalQs: string,
    sessionId: string,
    body: string,
    creds: AwsCreds,
    signal: AbortSignal,
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
      signal,
    });
  }
}
