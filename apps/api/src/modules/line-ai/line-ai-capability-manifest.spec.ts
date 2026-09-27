import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { apiConfigSchema } from '../../../../../packages/config/src/index';
import {
  FEATURE_CATALOG,
  LINE_TOOL_REGISTRY,
  lineToolRegistryFor,
} from '@watchdog-bms/contracts';
import { PublicLookupAdmissionTool } from './infrastructure/public-lookup';
import { InternalToolsController } from './presentation/http/internal-tools.controller';
import {
  buildLineAiCapabilityManifest,
  instantiateInternalToolsController,
  lineAiCapabilityManifestDigestFor,
  lineAiCapabilityManifestArtifactPath,
} from './line-ai-capability-manifest';

const GLOBAL_AI_PERMISSION = 'ai.tool.invoke';
const OFF_FLAGS = {
  aiGatewayInternalSecret: 'test-secret',
  aiFinalMutationEnabled: false,
  lineAiDraftEditEnabled: false,
  lineAiReimbursementDraftWriteEnabled: false,
  lineAiDocumentQaEnabled: false,
  lineAiApprovedKnowledgeEnabled: false,
  lineAiPublicLookupEnabled: false,
  lineAiPreferencesEnabled: false,
  lineAiReliabilityV2Mode: 'off',
  lineAiReliabilityV2CompanyIds: [],
};

function makeController() {
  const allPermissions = [...new Set([
    GLOBAL_AI_PERMISSION,
    ...LINE_TOOL_REGISTRY.flatMap(meta => [...meta.requiredPermissions, ...(meta.anyOfPermissions ?? [])]),
  ])];
  const prisma = {
    client: {
      user: { findUnique: async () => ({ status: 'ACTIVE', aiAssistantOptOutAt: null }) },
      companyFeatureEntitlement: { findMany: async () => [] },
      company: { findUnique: async () => ({ name: 'Test Company', status: 'ACTIVE' }) },
    },
  };
  const resolver = {
    resolveAccess: async (_userId: string, companyId?: string) => ({
      membershipId: 'membership-1', companyId: companyId ?? 'company-1', roles: ['OWNER'],
      permissions: allPermissions, entitlementDeniedPermissions: {}, scopes: {},
    }),
  };
  const actorDelegation = {
    consume: async (_token: string, expected: any) => ({
      v: 1, iss: 'watchdog-api', aud: 'watchdog-erp-core:internal-ai-tools', workload: 'ai-gateway',
      sub: expected.userId, companyId: expected.companyId, membershipId: 'membership-1',
      requestId: expected.requestId ?? 'request-1', toolName: expected.toolName, jti: 'test-jti', iat: 1, exp: 2,
    }),
  };
  const audit = { log: async () => undefined, logOrThrow: async () => undefined };
  const controller = instantiateInternalToolsController({
    AppConfigService: OFF_FLAGS,
    PrismaService: prisma,
    AuditService: audit,
    PermissionResolverService: resolver,
    ActorDelegationService: actorDelegation,
    PublicLookupAdmissionTool: new PublicLookupAdmissionTool(OFF_FLAGS as any, prisma as any),
  }).controller as unknown as { toolMap: Map<string, any>; readEvidence: unknown; invoke: InternalToolsController['invoke'] };
  controller.readEvidence = { record: async () => 'evidence-id' };
  return controller;
}

describe('W00 executable capability manifest', () => {
  it('matches the frozen artifact to live registry, handler, DI and catalog metadata', () => {
    const manifest = buildLineAiCapabilityManifest();
    const artifactPath = lineAiCapabilityManifestArtifactPath();
    if (process.env['UPDATE_LINE_AI_CAPABILITY_MANIFEST'] === '1') {
      writeFileSync(artifactPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    const frozen = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;
    const frozenDigest = lineAiCapabilityManifestDigestFor(frozen);
    assert.equal(frozen.manifestDigest, frozenDigest, 'frozen artifact content must match its digest');
    assert.equal(lineAiCapabilityManifestDigestFor({ ...frozen, sourceRevision: 'new-commit', baseRevision: 'new-merge-base', checkoutBranch: null, checkoutDirty: false }), frozenDigest, 'identical source parity survives commit and detached CI checkout');
    const frozenHashes = new Map((frozen['sourceHashes'] as Array<{ path: string; sha256: string }>).map(item => [item.path, item.sha256]));
    const currentHashes = new Map(manifest.sourceHashes.map(item => [item.path, item.sha256]));
    const changedSources = [...new Set([...frozenHashes.keys(), ...currentHashes.keys()])]
      .filter(path => frozenHashes.get(path) !== currentHashes.get(path)).sort();
    assert.equal(frozenDigest, manifest.manifestDigest,
      `source, registry, controller, DI, route, or catalog drift requires regenerating/reviewing W00 artifact${changedSources.length ? `; changed files: ${changedSources.join(', ')}` : ''}`);

    const registryNames = LINE_TOOL_REGISTRY.map(meta => meta.name).sort();
    const operationNames = manifest.operations.map(operation => operation.operation).sort();
    assert.deepEqual(operationNames, registryNames, 'every registry operation must be represented exactly once');
    assert.deepEqual(manifest.operations.filter(operation => operation.implementation === 'wired'
      && operation.sourceReferences.some(reference => reference.path === 'unknown')).map(operation => operation.operation), [],
    'wired adapters need source-file references');
    assert.deepEqual(manifest.moduleWiring.registryOrphanHandlers, [], 'controller toolMap must not contain an unregistered handler');
    assert.deepEqual(manifest.moduleWiring.duplicateRegistryNames, [], 'registry operation names must be unique');
    assert.deepEqual(manifest.menuEntitlementKeysMissingFromFeatureCatalog, [], 'sellable menu bindings must resolve to the feature catalog');

    const sellableKeys = FEATURE_CATALOG.filter(feature => feature.sellable).map(feature => feature.key).sort();
    assert.deepEqual(manifest.soldFeatureCoverage.map(feature => feature.featureKey).sort(), sellableKeys, 'every sellable feature must have assistant or web-only coverage');
    assert.ok(manifest.w00FamilyCoverage.some(family => family.family === 'attachment_evidence' && family.apiIntakes.includes('line.receipt_capture')));
    assert.ok(manifest.deferred.some(capability => capability.capability === 'voice_input_and_transcription' && capability.implementation === 'deferred'));
    assert.ok(manifest.apiRoutes.every(route => route.bodyShapeStatus === 'documented'), 'registered LINE AI routes need an input-boundary entry');
    assert.deepEqual(manifest.defaultVisibleButNonReady, [], 'unwired registry operations must never be offered as callable');

    const knownUnwired = manifest.declaredRegisteredUnwiredOperations as Record<string, string>;
    for (const [name, reason] of Object.entries(knownUnwired)) {
      const operation = manifest.operations.find(item => item.operation === name);
      assert.equal(operation?.implementation, 'registered_unwired', `${name} must remain explicitly non-ready`);
      assert.equal(operation?.wiringEvidence.nonReadyReason, reason, `${name} non-ready reason`);
    }
    const replayBoundaryGaps = manifest.operations.filter(operation => operation.wiringEvidence.controllerHandler
      && operation.wiringEvidence.moduleProvider && operation.wiringEvidence.evidenceRegistryExpected
      && (!operation.wiringEvidence.evidenceRegistryInjected || !operation.wiringEvidence.evidenceRegistryFactoryMapped))
      .map(operation => operation.operation).sort();
    assert.deepEqual(replayBoundaryGaps, [], 'read-evidence handlers must be injected into the replay registry');
    const unexpectedWiringGaps = manifest.operations.filter(operation => operation.execution !== 'api_intake'
      && !Object.hasOwn(knownUnwired, operation.operation)
      && (!operation.wiringEvidence.controllerHandler || !operation.wiringEvidence.moduleProvider
        || operation.wiringEvidence.evidenceRegistryExpected && (!operation.wiringEvidence.evidenceRegistryInjected || !operation.wiringEvidence.evidenceRegistryFactoryMapped)));
    assert.deepEqual(unexpectedWiringGaps.map(operation => ({ operation: operation.operation, reason: operation.wiringEvidence.nonReadyReason })), [],
      'unclassified missing handlers/providers or evidence replay adapters must fail parity');
  });

  it('enables built-in gates by default, defers public lookup and honors explicit registry visibility flags', () => {
    const shape = apiConfigSchema.shape as Record<string, { parse(value: unknown): unknown }>;
    for (const name of [
      'LINE_AI_DRAFT_EDIT_ENABLED', 'LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED', 'LINE_AI_DOCUMENT_QA_ENABLED',
      'LINE_AI_APPROVED_KNOWLEDGE_ENABLED', 'LINE_AI_PUBLIC_LOOKUP_ENABLED', 'LINE_AI_PREFERENCES_ENABLED',
    ]) assert.equal(shape[name]!.parse(undefined), name !== 'LINE_AI_PUBLIC_LOOKUP_ENABLED', `${name} default`);

    const configuredNames = new Set(lineToolRegistryFor({
      draftEditEnabled: shape['LINE_AI_DRAFT_EDIT_ENABLED']!.parse(undefined) === true,
      reimbursementDraftWriteEnabled: shape['LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED']!.parse(undefined) === true,
      publicLookupEnabled: shape['LINE_AI_PUBLIC_LOOKUP_ENABLED']!.parse(undefined) === true,
    }).map(meta => meta.name));
    assert.equal(configuredNames.has('public.lookup'), false);
    assert.equal(configuredNames.has('reimbursement.draft.preview_create'), true);
    assert.ok(LINE_TOOL_REGISTRY.filter(tool => tool.category === 'draft_update').every(meta => configuredNames.has(meta.name)));

    const defaultNames = new Set(lineToolRegistryFor().map(meta => meta.name));
    assert.equal(defaultNames.has('public.lookup'), false);
    for (const name of ['accounting.capture_receipt_evidence', 'crm.suggest_sales_followups', 'hr.get_leave_summary']) assert.equal(defaultNames.has(name), false);
    for (const name of ['reimbursement.draft.get_options', 'reimbursement.draft.preview_create', 'reimbursement.draft.preview_update']) {
      assert.equal(defaultNames.has(name), false, `${name} must stay hidden while the draft flag is off`);
    }
    for (const meta of LINE_TOOL_REGISTRY.filter(tool => tool.category === 'draft_update')) assert.equal(defaultNames.has(meta.name), false);

    const enabledNames = new Set(lineToolRegistryFor({ draftEditEnabled: true, publicLookupEnabled: true, reimbursementDraftWriteEnabled: true }).map(meta => meta.name));
    assert.equal(enabledNames.has('public.lookup'), true);
    assert.equal(enabledNames.has('reimbursement.draft.get_options'), true);
    assert.ok(LINE_TOOL_REGISTRY.filter(tool => tool.category === 'draft_update').every(meta => enabledNames.has(meta.name)));
  });

  it('rejects undeclared tool input at the actual InternalToolsController boundary', async () => {
    const controller = makeController();
    const result = await controller.invoke('test-secret', 'signed-delegation', {
      toolName: 'company.get_current_context',
      context: { requestId: 'request-input-check', companyId: 'company-1', userId: 'user-1', locale: 'th' },
      input: { manifestUnsupportedInput: true },
    });
    assert.equal(result.errorCode, 'UNSUPPORTED_FILTER');
    assert.equal(result.status, 'error');
  });

  it('refuses direct reimbursement and public lookup calls while their flags are off', async () => {
    const controller = makeController();
    const context = { requestId: 'request-off-check', companyId: 'company-1', userId: 'user-1', locale: 'th' };
    const reimbursement = await controller.invoke('test-secret', 'signed-delegation', {
      toolName: 'reimbursement.draft.get_options', context,
    });
    assert.equal(reimbursement.status, 'forbidden');
    assert.equal(reimbursement.errorCode, 'AI_TOOL_CATEGORY_DENIED');

    const publicLookup = await controller.invoke('test-secret', 'signed-delegation', {
      toolName: 'public.lookup', context, input: { publicQuestion: 'weather' },
    });
    assert.equal(publicLookup.status, 'unavailable');
    assert.equal(publicLookup.errorCode, 'PUBLIC_POLICY_UNAVAILABLE');
  });
});
