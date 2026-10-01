import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  resyncWorkflowTemplateRulesForCompany,
  WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID,
} from './workflow-template.use-case';
import { WORKFLOW_TEMPLATE_CATALOG } from '../../domain/workflow-template-catalog';

// NEW spec file (none existed for resyncWorkflowTemplateRulesForCompany before this task) —
// not registered in package.json's "test" script; run directly with tsx --test.

const TEMPLATE_KEY = 'reimbursement_pending_approval';
const catalogSeed = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === TEMPLATE_KEY)!;
// A real WorkflowTemplate row mirrors the catalog seed's condition/action (sync-workflow-templates.ts
// upserts them in), which is what resync compares a company's rule against.
const template = {
  id: 'tmpl-1', key: TEMPLATE_KEY,
  defaultConditionJson: catalogSeed.defaultConditionJson,
  defaultActionJson: catalogSeed.defaultActionJson,
};

/** Only resolves the one template this test cares about; every other autoEnable key is a no-op. */
function fakeRepo(rule: any) {
  // The row is live: a re-pin changes it, so a second sync sees what the first one wrote.
  const updateRule = mock.fn(async (_companyId: string, _id: string, data: any) => Object.assign(rule, data));
  const createRuleVersion = mock.fn(async (_data: any) => undefined);
  // What the sync pinned on this rule when it created it.
  const pinnedBySync = {
    id: 'v-1', ruleId: rule.id, version: 1, status: 'ENABLED',
    triggerSnapshotJson: {}, conditionSnapshotJson: { field: 'stale', op: 'EXISTS' }, actionSnapshotJson: [],
    recipientSnapshotJson: {}, cooldownSeconds: 3600, createdBy: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID, createdAt: new Date(),
  };
  return {
    repo: {
      findTemplateByKey: async (key: string) => (key === TEMPLATE_KEY ? template : null),
      listRules: async () => [rule],
      findLatestRuleVersion: async () => pinnedBySync,
      listRuleVersions: async () => [pinnedBySync],
      updateRule,
      createRuleVersion,
    } as any,
    updateRule,
    createRuleVersion,
  };
}

describe('resyncWorkflowTemplateRulesForCompany (template sync non-destructiveness)', () => {
  it('re-pins a sync-created, unmodified rule to the current catalog action/link/cooldown', async () => {
    const rule = {
      id: 'rule-1', companyId: 'co-1', status: 'ENABLED',
      createdBy: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID, updatedBy: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID,
      cooldownSeconds: 3600, triggerConfigJson: {}, conditionJson: { field: 'stale', op: 'EXISTS' }, actionJson: [],
    };
    const { repo, updateRule, createRuleVersion } = fakeRepo(rule);

    const resynced = await resyncWorkflowTemplateRulesForCompany(repo, 'co-1');

    assert.deepEqual(resynced, [TEMPLATE_KEY]);
    // Once to re-pin the desired action/condition/trigger/cooldown, once more inside
    // createRuleVersionAndEnable to bump status/currentVersion — this rule stays ENABLED, so the
    // runner (which reads the version snapshot, not the mutable row) must see the new version too.
    assert.equal(updateRule.mock.callCount(), 2);
    const updateData = (updateRule.mock.calls[0] as any).arguments[2];
    assert.equal(updateData.cooldownSeconds, 0);
    assert.deepEqual(updateData.actionJson, catalogSeed.defaultActionJson);
    // The re-pinned action carries this task's own changes (journey link + actor exclusion),
    // proving an existing company's already-created rule actually picks them up.
    const notifyCfg = updateData.actionJson[0]!.configJson;
    assert.equal(notifyCfg['deepLinkPathTemplate'], '/companies/{{companyId}}/reimbursements/{{requestId}}');
    assert.deepEqual(notifyCfg['excludeRecipientPayloadKeys'], ['actorUserId']);
    // ENABLED rule: the runner reads the version snapshot, so a new version is stamped too.
    assert.equal(createRuleVersion.mock.callCount(), 1);
  });

  it('never touches a rule an admin has edited — not on the first sync, not on a second', async () => {
    const adminEditedRule = {
      id: 'rule-2', companyId: 'co-1', status: 'DISABLED',
      createdBy: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID, updatedBy: 'admin-user-1',
      // The sync pinned an hour and the `stale` condition; the admin changed both.
      cooldownSeconds: 900, triggerConfigJson: {}, conditionJson: { field: 'amount', op: 'GT', value: 1000 }, actionJson: [],
    };
    const { repo, updateRule, createRuleVersion } = fakeRepo(adminEditedRule);

    const first = await resyncWorkflowTemplateRulesForCompany(repo, 'co-1');
    const second = await resyncWorkflowTemplateRulesForCompany(repo, 'co-1');

    assert.deepEqual(first, []);
    assert.deepEqual(second, []);
    assert.equal(updateRule.mock.callCount(), 0);
    assert.equal(createRuleVersion.mock.callCount(), 0);
  });

  // Review: disabling a rule stamps the admin's id on it and changes nothing else. Reading that
  // stamp as an edit kept the company on the old definition for good, even once switched back on.
  it('brings a rule an admin only switched off up to date, and leaves it switched off', async () => {
    const adminDisabledRule = {
      id: 'rule-2', companyId: 'co-1', status: 'DISABLED',
      createdBy: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID, updatedBy: 'admin-user-1',
      cooldownSeconds: 3600, triggerConfigJson: {}, conditionJson: { field: 'stale', op: 'EXISTS' }, actionJson: [],
    };
    const { repo, updateRule, createRuleVersion } = fakeRepo(adminDisabledRule);

    const first = await resyncWorkflowTemplateRulesForCompany(repo, 'co-1');
    const second = await resyncWorkflowTemplateRulesForCompany(repo, 'co-1');

    assert.deepEqual(first, [TEMPLATE_KEY]);
    assert.deepEqual(second, []);
    // The definition only: no status in the update, and no version, because a rule that is off is not enabled by a sync.
    assert.equal(updateRule.mock.callCount(), 1);
    const updateData = (updateRule.mock.calls[0] as any).arguments[2];
    assert.deepEqual(updateData.actionJson, catalogSeed.defaultActionJson);
    assert.equal('status' in updateData, false);
    assert.equal(adminDisabledRule.status, 'DISABLED');
    assert.equal(createRuleVersion.mock.callCount(), 0);
  });

  it('never touches an admin-created rule (createdBy is not the sync actor)', async () => {
    const adminCreatedRule = {
      id: 'rule-3', companyId: 'co-1', status: 'ENABLED',
      createdBy: 'admin-user-1', updatedBy: 'admin-user-1',
      cooldownSeconds: 3600, triggerConfigJson: {}, conditionJson: {}, actionJson: [],
    };
    const { repo, updateRule } = fakeRepo(adminCreatedRule);

    const resynced = await resyncWorkflowTemplateRulesForCompany(repo, 'co-1');

    assert.deepEqual(resynced, []);
    assert.equal(updateRule.mock.callCount(), 0);
  });

  it('leaves an ARCHIVED rule alone even if it was sync-created and unmodified', async () => {
    const archivedRule = {
      id: 'rule-4', companyId: 'co-1', status: 'ARCHIVED',
      createdBy: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID, updatedBy: WORKFLOW_AUTO_ENABLE_ACTOR_USER_ID,
      cooldownSeconds: 3600, triggerConfigJson: {}, conditionJson: {}, actionJson: [],
    };
    const { repo, updateRule } = fakeRepo(archivedRule);

    const resynced = await resyncWorkflowTemplateRulesForCompany(repo, 'co-1');

    assert.deepEqual(resynced, []);
    assert.equal(updateRule.mock.callCount(), 0);
  });
});
