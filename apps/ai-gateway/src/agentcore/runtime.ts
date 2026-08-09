/**
 * AgentCore Runtime entry point – item 10B Phase 8.
 * Exposes GET /ping and POST /invocations per AgentCore HTTP protocol.
 * Runs standalone (no NestJS DI); constructs dependencies from env vars.
 *
 * Deployment: CodeZip/direct-code preferred (see agentcore.json).
 * Container/ECR fallback only when dependency size blocks CodeZip.
 *
 * LINE and web must never call this endpoint directly.
 * AI Gateway invokes this runtime server-side by ARN/id + qualifier.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  LINE_AI_ACTOR_DELEGATIONS_PER_TOOL,
  LINE_AI_CONTEXT_WINDOW_MINUTES,
  LINE_AI_CONTEXT_MAX_TURNS,
} from '@watchdog-bms/contracts';
import type { LineAiTurnRequest } from '@watchdog-bms/contracts';
import type { AgentRunResult } from '../modules/line-ai/agents/agent-types';
import { drainUsage, runWithUsageContext } from '../common/usage/usage-context';

const PORT = parseInt(process.env['PORT'] ?? '8080', 10);
const MAX_CONTEXT_TURNS = LINE_AI_CONTEXT_MAX_TURNS;
const MAX_CONTEXT_TEXT_CHARS = 500;

/**
 * L-12: invocation bounds. This entrypoint runs standalone (no Nest, no config service), so the
 * limits are read straight from `process.env` under the same names and defaults the gateway config
 * schema declares (AGENTCORE_MAX_*). Read per call, not at module load, so nothing is hardcoded at
 * a call site and an operator can raise a limit without a code change.
 */
function limit(key: string, fallback: number): number {
  const parsed = Number(process.env[key]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
const maxBodyBytes = () => limit('AGENTCORE_MAX_BODY_BYTES', 1048576);
const maxMessageChars = () => limit('AGENTCORE_MAX_MESSAGE_CHARS', 8000);
const maxAttachments = () => limit('AGENTCORE_MAX_ATTACHMENTS', 10);
const maxConcurrentInvocations = () => limit('AGENTCORE_MAX_CONCURRENT_INVOCATIONS', 16);

export class PayloadTooLargeError extends Error {}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RuntimePayload = {
  turnId: string;
  companyId: string;
  userId: string;
  membershipId?: string;
  branchIds?: string[];
  locationIds?: string[];
  roles?: string[];
  messageText: string;
  locale?: string;
  permissions?: string[];
  actorDelegations?: Record<string, string[]>;
  modelPolicy?: LineAiTurnRequest['modelPolicy'];
  attachments?: unknown[];
  conversationContext?: LineAiTurnRequest['conversationContext'];
};

type RuntimeOrchestrator = { run(req: LineAiTurnRequest): Promise<AgentRunResult> };
let runtimeOrchestrator: Promise<RuntimeOrchestrator> | undefined;

// ── Helpers ────────────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function boundedString(value: unknown, max = MAX_CONTEXT_TEXT_CHARS): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, max) : undefined;
}

function parseConversationContext(value: unknown): LineAiTurnRequest['conversationContext'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const turns = Array.isArray(raw['recentTurns']) ? raw['recentTurns'] : [];
  const recentTurns = turns.slice(-MAX_CONTEXT_TURNS).flatMap((turn) => {
    if (!turn || typeof turn !== 'object') return [];
    const t = turn as Record<string, unknown>;
    const at = boundedString(t['at'], 64);
    if (!at) return [];
    const userMessagePreview = boundedString(t['userMessagePreview']);
    const assistantReplyPreview = boundedString(t['assistantReplyPreview']);
    const intent = boundedString(t['intent'], 64);
    const agent = boundedString(t['agent'], 64);
    return [{
      at,
      ...(userMessagePreview && { userMessagePreview }),
      ...(assistantReplyPreview && { assistantReplyPreview }),
      ...(intent && { intent }),
      ...(agent && { agent }),
      ...(typeof t['refused'] === 'boolean' && { refused: t['refused'] }),
    }];
  });
  if (recentTurns.length === 0) return undefined;
  const lastTurnAt = boundedString(raw['lastTurnAt'], 64);
  return {
    windowMinutes: LINE_AI_CONTEXT_WINDOW_MINUTES,
    maxTurns: MAX_CONTEXT_TURNS,
    ...(lastTurnAt && { lastTurnAt }),
    recentTurns,
  };
}

function parseActorDelegations(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length === 0
    || entries.length > 128
    || entries.some(([toolName, tokens]) =>
      !toolName
      || !Array.isArray(tokens)
      || tokens.length === 0
      || tokens.length > LINE_AI_ACTOR_DELEGATIONS_PER_TOOL
      || tokens.some((token) => typeof token !== 'string' || !token || token.length > 4096))
  ) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string[]>;
}

/**
 * L-12: the byte cap is enforced *while streaming*, never after buffering. A declared
 * Content-Length over the cap is refused before a single `data` listener is attached, and a
 * chunked body is counted as it arrives and abandoned the moment it crosses the cap — so one large
 * POST can no longer buffer to heap and OOM the container.
 * Exported for the spec: the "without reading the body" claim is only checkable here.
 */
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new PayloadTooLargeError();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        // Stop pulling bytes (TCP backpressure) and stop counting: nothing more is buffered, and
        // the caller is free to discard the rest of the upload while it answers 413.
        req.off('data', onData);
        req.pause();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(Buffer.from(chunk));
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** How long the socket stays open draining an over-cap upload so the 413 can reach the client. */
const PAYLOAD_TOO_LARGE_LINGER_MS = 250;

/**
 * L-12: answer 413 *and* let the client see it. Destroying the socket while the client is still
 * uploading closes it with unread bytes queued, which is a TCP reset — and a reset discards the
 * response the client had already buffered, so the caller observes ECONNRESET instead of the 413
 * (measured on loopback with an 8 MB over-cap upload: 1/20 clients saw the 413 before this change,
 * 14–18/20 after). So: mark the connection closing, then discard — never buffer — whatever is still
 * in flight for a bounded window, and destroy on end-of-body or when the window expires.
 * Delivery is much likelier, not guaranteed: a client that keeps a large backlog in flight past the
 * window still gets reset, which is inherent to closing a socket with unread data.
 */
function answerPayloadTooLarge(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Connection', 'close');
  json(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
  req.resume();
  const stopLingering = setTimeout(() => req.destroy(), PAYLOAD_TOO_LARGE_LINGER_MS);
  req.on('end', () => { clearTimeout(stopLingering); req.destroy(); });
  res.on('close', () => clearTimeout(stopLingering));
}

// ── AgentCore invocation payload validation ────────────────────────────────────

/**
 * L-12: message text and prompt are bounded before the orchestrator sees them. Over-limit text is
 * rejected rather than silently truncated — a half-message answered as if whole is its own bug.
 */
function boundedMessageText(value: unknown): string | undefined {
  return typeof value === 'string' && value && value.length <= maxMessageChars() ? value : undefined;
}

/** L-12: `null` = over the attachment cap (reject the payload); a non-array stays tolerated as []. */
function boundedAttachments(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return [];
  return value.length > maxAttachments() ? null : value;
}

export function validatePayload(body: unknown): RuntimePayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const p = body as Record<string, unknown>;
  const attachments = boundedAttachments(p['attachments']);
  if (attachments === null) return null;
  if (typeof p['prompt'] === 'string' && p['prompt']) {
    const prompt = boundedMessageText(p['prompt']);
    if (!prompt) return null;
    return {
      turnId: typeof p['turnId'] === 'string' && p['turnId'] ? p['turnId'] : `playground-${Date.now()}`,
      companyId: typeof p['companyId'] === 'string' && p['companyId'] ? p['companyId'] : 'playground-company',
      userId: typeof p['userId'] === 'string' && p['userId'] ? p['userId'] : 'playground-user',
      membershipId: typeof p['membershipId'] === 'string' ? p['membershipId'] : undefined,
      branchIds: Array.isArray(p['branchIds']) ? (p['branchIds'] as string[]) : undefined,
      locationIds: Array.isArray(p['locationIds']) ? (p['locationIds'] as string[]) : undefined,
      roles: Array.isArray(p['roles']) ? (p['roles'] as string[]) : undefined,
      messageText: prompt,
      locale: typeof p['locale'] === 'string' ? p['locale'] : 'th-TH',
      permissions: Array.isArray(p['permissions']) ? (p['permissions'] as string[]) : [],
      actorDelegations: parseActorDelegations(p['actorDelegations']),
      modelPolicy: parseModelPolicy(p['modelPolicy']),
      attachments,
      conversationContext: parseConversationContext(p['conversationContext']),
    };
  }
  if (typeof p['turnId'] !== 'string' || !p['turnId']) return null;
  if (typeof p['companyId'] !== 'string' || !p['companyId']) return null;
  if (typeof p['userId'] !== 'string' || !p['userId']) return null;
  const messageText = boundedMessageText(p['messageText']);
  if (!messageText) return null;
  return {
    turnId: p['turnId'],
    companyId: p['companyId'],
    userId: p['userId'],
    membershipId: typeof p['membershipId'] === 'string' ? p['membershipId'] : undefined,
    branchIds: Array.isArray(p['branchIds']) ? (p['branchIds'] as string[]) : undefined,
    locationIds: Array.isArray(p['locationIds']) ? (p['locationIds'] as string[]) : undefined,
    roles: Array.isArray(p['roles']) ? (p['roles'] as string[]) : undefined,
    messageText,
    locale: typeof p['locale'] === 'string' ? p['locale'] : 'th-TH',
    permissions: Array.isArray(p['permissions']) ? (p['permissions'] as string[]) : [],
    actorDelegations: parseActorDelegations(p['actorDelegations']),
    modelPolicy: parseModelPolicy(p['modelPolicy']),
    attachments,
    conversationContext: parseConversationContext(p['conversationContext']),
  };
}

export function payloadToTurnRequest(p: RuntimePayload): LineAiTurnRequest {
  return {
    requestId: p.turnId,
    webhookEventId: p.turnId,
    messageText: p.messageText,
    messagePreviewHash: '',
    actorDelegations: p.actorDelegations,
    modelPolicy: p.modelPolicy,
    attachments: (p.attachments ?? []) as LineAiTurnRequest['attachments'],
    conversationContext: p.conversationContext,
    userContext: {
      lineUserId: '',
      internalUserId: p.userId,
      companyId: p.companyId,
      membershipId: p.membershipId ?? '',
      permissions: p.permissions ?? [],
      roles: p.roles ?? [],
      ...(p.branchIds && { branchIds: p.branchIds }),
      ...(p.locationIds && { locationIds: p.locationIds }),
      locale: p.locale ?? 'th-TH',
    },
  };
}

function parseModelPolicy(value: unknown): LineAiTurnRequest['modelPolicy'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const modelId = (value as Record<string, unknown>)['modelId'];
  if (typeof modelId !== 'string' || !modelId || modelId.length > 300) return undefined;
  return { modelId };
}

type SecretReader = (secretId: string, region: string) => Promise<string | undefined>;

const readFromSecretsManager: SecretReader = async (id, awsRegion) => {
  const { GetSecretValueCommand, SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
  const result = await new SecretsManagerClient({ region: awsRegion }).send(new GetSecretValueCommand({ SecretId: id }));
  return result.SecretString;
};

// ECS injects secret material with `valueFrom`, so a task simply has the value in its
// environment. AgentCore has no equivalent - every variable it carries is literal and readable
// by anyone who can call GetAgentRuntime - so the runtime fetches its own secrets at boot from
// an ARN instead. Each secret therefore has two variables: the one the config layer reads,
// holding material, and a `*_SOURCE_ARN`/`*_ARN` pointer that says where to get it.
async function resolveSecretInto(
  env: NodeJS.ProcessEnv,
  valueKey: string,
  sourceKey: string,
  read: SecretReader,
): Promise<void> {
  if (env[valueKey]) return;
  const secretId = env[sourceKey];
  if (!secretId) throw new Error(`${sourceKey} is required`);
  const secret = await read(secretId, env['AWS_REGION'] ?? env['BEDROCK_REGION'] ?? 'ap-southeast-1');
  if (!secret) throw new Error(`${valueKey} is empty`);
  env[valueKey] = secret;
}

export async function loadInternalSecret(
  env: NodeJS.ProcessEnv = process.env,
  getSecret?: SecretReader,
): Promise<void> {
  await resolveSecretInto(env, 'AI_GATEWAY_INTERNAL_SECRET', 'AI_GATEWAY_INTERNAL_SECRET_ARN', getSecret ?? readFromSecretsManager);
}

// WATCHDOG_JWT_SECRET_ARN is a misnomer kept for compatibility with the ECS wiring: it holds the
// signing key itself, not an ARN. The pointer therefore needs its own name. validateProductionConfig
// demands this key for any process carrying JWT_CLOCK_TOLERANCE_SECONDS - which the shared
// aiGatewayConfigSchema always does - so without this the runtime cannot finish booting even
// though it never verifies a token itself.
export async function loadJwtSecret(
  env: NodeJS.ProcessEnv = process.env,
  getSecret?: SecretReader,
): Promise<void> {
  await resolveSecretInto(env, 'WATCHDOG_JWT_SECRET_ARN', 'WATCHDOG_JWT_SECRET_SOURCE_ARN', getSecret ?? readFromSecretsManager);
}

async function getRuntimeOrchestrator(): Promise<RuntimeOrchestrator> {
  runtimeOrchestrator ??= (async () => {
    await loadInternalSecret();
    await loadJwtSecret();
    const [
      { aiGatewayConfigSchema },
      { AiGatewayConfigService },
      { ToolPolicyEnforcerService },
      { ErpToolClient },
      { OrchestratorAgent },
    ] = await Promise.all([
      import('@watchdog-bms/config'),
      import('../common/config/ai-gateway-config.service'),
      import('../common/ai/tool-policy-enforcer.service'),
      import('../modules/line-ai/infrastructure/erp-tool.client'),
      import('../modules/line-ai/agents/orchestrator.agent'),
    ]);

    const envResult = aiGatewayConfigSchema.safeParse(process.env);
    if (!envResult.success) {
      throw new Error(`Config error: ${envResult.error.message}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = new (AiGatewayConfigService as any)() as InstanceType<typeof AiGatewayConfigService>;
    const policyEnforcer = new ToolPolicyEnforcerService(config);
    const erpTools = new ErpToolClient(config, policyEnforcer);
    return new OrchestratorAgent(erpTools, config);
  })();
  return runtimeOrchestrator;
}

// ── HTTP server factory (exported for testing) ─────────────────────────────────

async function handleInvocation(
  orchestrator: RuntimeOrchestrator,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readBody(req, maxBodyBytes());
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      answerPayloadTooLarge(req, res);
      return;
    }
    json(res, 400, { error: 'BODY_READ_ERROR' });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    json(res, 400, { error: 'INVALID_JSON' });
    return;
  }

  const payload = validatePayload(body);
  if (!payload) {
    json(res, 400, { error: 'INVALID_PAYLOAD', message: 'turnId, companyId, userId, and messageText are required' });
    return;
  }

  try {
    const turnReq = payloadToTurnRequest(payload);
    // This entrypoint runs outside the gateway's HTTP stack, so it opens its own collector —
    // otherwise a rebuilt artifact would report no usage at all and the API could never meter the
    // agentcore runtime. An older artifact simply omits the field (metering spec §7.2).
    const { result, usage } = await runWithUsageContext({ companyId: payload.companyId }, async () => {
      const run = await orchestrator.run(turnReq);
      return { result: run, usage: drainUsage() };
    });
    json(res, 200, {
      turnId: payload.turnId,
      replyText: result.replyText,
      plan: result.plan,
      durationMs: result.durationMs,
      refused: result.plan.status === 'UNROUTABLE',
      sourceRefs: result.sourceRefs,
      webLinks: result.webLinks,
      ...(result.presentation ? { presentation: result.presentation } : {}),
      // AgentRunResult exposes sources only in aggregate; do not fabricate per-tool attribution.
      toolsInvoked: result.outputs.flatMap((output) => output.toolCalls),
      ...(usage.length > 0 ? { usage } : {}),
    });
  } catch (err) {
    console.error('[agentcore-runtime] invocation error:', (err as Error).message);
    json(res, 500, { error: 'INVOCATION_ERROR' });
  }
}

export function makeHttpServer(orchestrator: RuntimeOrchestrator) {
  // L-12: per-server in-flight counter. AgentCore fans out concurrent invocations, and each one
  // holds a model call open, so an unbounded count is a memory and cost amplifier.
  let inFlight = 0;
  return createServer(async (req, res) => {
    // GET /ping – health check required by AgentCore protocol.
    // L-13: liveness only; the internal service name is not an unauthenticated caller's business.
    if (req.method === 'GET' && req.url === '/ping') {
      json(res, 200, { status: 'ok' });
      return;
    }

    // POST /invocations – AgentCore invocation endpoint
    if (req.method === 'POST' && req.url === '/invocations') {
      if (inFlight >= maxConcurrentInvocations()) {
        json(res, 429, { error: 'TOO_MANY_CONCURRENT_INVOCATIONS' });
        return;
      }
      inFlight += 1;
      try {
        await handleInvocation(orchestrator, req, res);
      } finally {
        inFlight -= 1;
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });
}

// ── Standalone entry point ─────────────────────────────────────────────────────

export function startRuntime(): void {
  const server = makeHttpServer({ run: async (req) => (await getRuntimeOrchestrator()).run(req) });
  server.listen(PORT, () => {
    console.log(`[agentcore-runtime] listening on :${PORT}`);
  });
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  startRuntime();
}
