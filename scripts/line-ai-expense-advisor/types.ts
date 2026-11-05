/**
 * Corpus format for the LINE AI expense-advisor eval (docs/qa/line-ai-expense-advisor-eval.md).
 *
 * A turn either asks for data (one or more gold `{tool, input}` calls the oracle can run against
 * the seeded DB) or is checked by tags (no_tool / must_answer / must_not_refuse / must_mention_any
 * / must_not_claim / forbidden_tools). A turn may carry both — e.g. an out-of-permission question
 * still calls a tool (scoped to what the role may see) while also being tag-checked for overclaiming.
 *
 * Gold `input` values are never literal dates: a period-bearing field holds `{ $period: token }`
 * (see period.ts) and an id the model could only know from a prior turn's shown list holds
 * `{ $fromShownItems: index }`, both resolved at run time by the oracle (spec §4 R-M1 memory).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PERIOD_TOKENS, type PeriodToken } from './period';
import { isKnownPlaceholder, referencedPlaceholders } from './template';

export const ROLES = ['OWNER', 'MANAGER', 'STAFF', 'ACCOUNTANT', 'AUDITOR_READONLY'] as const;
export type EvalRole = (typeof ROLES)[number];

export const COMPANIES = ['A', 'B', 'C'] as const;
export type EvalCompany = (typeof COMPANIES)[number];
const LEGACY_COMPANIES = ['A', 'B'] as const;

export type PeriodRef = { $period: PeriodToken };
export type ShownItemRef = { $fromShownItems: number };
export type GoldInputValue = string | number | boolean | null | PeriodRef | ShownItemRef;
export type GoldInput = Record<string, GoldInputValue>;

/** Which required-fact rule applies to a gold call's result (docs/qa/line-ai-expense-advisor-eval.md
 * "Required facts by answer shape"). Optional — defaults per tool (oracle.ts DEFAULT_ANSWER_SHAPE);
 * only needed to override the default, e.g. `expense.list_recent` as a `list` instead of its usual
 * `single_metric`. */
export const ANSWER_SHAPES = ['single_metric', 'breakdown', 'list', 'detail', 'pending_approvals', 'daily_closing'] as const;
export type AnswerShape = (typeof ANSWER_SHAPES)[number];

/** Which grouping a `breakdown` shape's required top-3 facts come from. Only meaningful with
 * answerShape "breakdown"; defaults to "category". */
export const GROUP_BY_DIMENSIONS = ['category', 'branch', 'vendor'] as const;
export type GroupByDimension = (typeof GROUP_BY_DIMENSIONS)[number];

/** Task item 2: a turn's own `expect.requiredFacts` narrows — or, for a category the shape's
 * default does not normally cover (`status`), REPLACES — which of the shape's facts are required.
 * E.g. a "who's the vendor" follow-up needs `['vendor']` (maybe `['vendor','date']` if the date
 * also identifies which item), never the shape's default `amount` too; "จ่ายหรือยัง" needs
 * `['status']` alone. Absent: the shape's own defaults, exactly as before this field existed
 * (oracle.ts `SHAPE_DEFAULT_CATEGORIES`). */
export const REQUIRED_FACT_CATEGORIES = ['amount', 'date', 'vendor', 'count', 'total', 'groups', 'items', 'status'] as const;
export type RequiredFactCategory = (typeof REQUIRED_FACT_CATEGORIES)[number];

export type GoldCall = {
  tool: string;
  input: GoldInput;
  answerShape?: AnswerShape;
  groupBy?: GroupByDimension;
  /** Other {tool, input} shapes that would equally correctly answer the same question. */
  alternatives?: GoldCall[];
};

export type TurnTags = {
  no_tool?: boolean;
  must_answer?: boolean;
  must_not_refuse?: boolean;
  must_mention_any?: string[];
  must_not_claim?: string[];
  forbidden_tools?: string[];
  /** The gold call resolved to an ambiguous/not-found category, vendor or branch name (task item
   * 3): the reply must list at least two of the offered names and ask which one. */
  must_ask_choice?: boolean;
};

export type TurnExpect = {
  calls?: GoldCall[];
  tags?: TurnTags;
  /** Narrows (or, for `status`, extends) the shape's default required facts for THIS turn only —
   * see `RequiredFactCategory` above. Meaningless without `calls` (there is nothing to extract
   * facts from), but validated regardless so a typo is caught even on a tag-only turn. */
  requiredFacts?: RequiredFactCategory[];
};

export type Turn = {
  user: string;
  /** spec §3 row number ("1".."20") or a free tag for a non-row case (e.g. "R-M4-remove-filter"). */
  category: string;
  /** Language/style tags: th, misspelled, spoken, en-mixed, buddhist-year, ... (free text). */
  language?: string[];
  expect: TurnExpect;
};

export type Conversation = {
  id: string;
  company: EvalCompany;
  role: EvalRole;
  turns: Turn[];
};

export type Corpus = {
  version: 1;
  conversations: Conversation[];
};

export type ActorRef = { key: string };
export type MemberActor = { key: string; kind?: 'member' | 'creator-only'; company: EvalCompany; role: EvalRole; branchScope: 'all' | { branches: string[] }; freeSourceDrafts?: true };
export type UnlinkedActor = { key: string; kind: 'unlinked'; company?: never; role?: never; branchScope?: never; freeSourceDrafts?: never };
export type Actor = MemberActor | UnlinkedActor;
export type KnowledgeGold = { cardId: string; version: number; requiredFacts: string[]; forbiddenFacts: string[]; allowedNumericFacts: string[] };
export type DueDateGold = { formType: 'PND3' | 'PND53'; monthOffset: -1 | 0 | 1 };
export type WorkflowFixtureOp =
  | { op: 'expire'; store: 'expense-action' | 'expense-action-applied' | 'wf-choice' | 'draft-preview' }
  | { op: 'mutate'; table: 'ExpenseRecord' | 'ReimbursementRequest' | 'DisbursementVoucher'; seedKey: string; set: Record<string, string | number | null> }
  | { op: 'setCredit'; state: 'normal' | 'exhausted' };
export type WorkflowPreview = { action: string; target: string; amount?: string; reason?: string; payeeName?: string; paymentMethod?: string; paidDate?: string };
export type WorkflowTurn = {
  as?: ActorRef; user?: string; press?: string; pressFrom?: { turn: number; actor?: ActorRef }; fixture?: WorkflowFixtureOp[];
  expect: { tier?: 0 | 1 | 2; label?: string; card?: 'picker' | 'choice' | 'question' | 'preview' | 'applied' | 'declined' | 'refusal' | 'answer' | 'credit_refusal' | 'expired';
    target?: string; preview?: WorkflowPreview; maxModelCalls?: number; mustNotCaptureAsField?: boolean; tags?: TurnTags;
    knowledge?: KnowledgeGold; dueDate?: DueDateGold; refusal?: { reason: 'permission' | 'package' | 'free'; wayOut: readonly string[] } };
};
export type GoldRecord = {
  table: 'ReimbursementRequest' | 'ReimbursementLine' | 'ReimbursementPayment' | 'ExpenseRecord' | 'ExpensePayment'
    | 'DisbursementVoucher' | 'DisbursementVoucherLine' | 'WhtCertificate' | 'ExpenseSubstituteReceiptEvidence'
    | 'ReimbursementApprovalStep' | 'WhtCertificateHandoff' | 'WhtCertificateHistory';
  ref: string; status?: string; paymentStatus?: string; decisionBy?: string; amount?: string; date?: string; payeeName?: string;
  reason?: string; categoryName?: string; description?: string; paidAmount?: string; paidDate?: string; paymentMethod?: string;
  whtAmount?: string; phase?: 'collect';
};
export type WorkflowTerminalEffect = 'REIMBURSEMENT_DRAFT_SAVED' | 'REIMBURSEMENT_SUBMITTED' | 'REIMBURSEMENT_APPROVED' | 'REIMBURSEMENT_REJECTED'
  | 'REIMBURSEMENT_CANCELLED' | 'REIMBURSEMENT_PAID' | 'EXPENSE_MARKED_READY' | 'EXPENSE_CONFIRMED' | 'EXPENSE_DELETED' | 'EXPENSE_VOIDED'
  | 'EXPENSE_PAID' | 'VOUCHER_CREATED' | 'VOUCHER_SUBMITTED' | 'VOUCHER_APPROVED' | 'VOUCHER_PAID' | 'WHT_ISSUED' | 'SUBSTITUTE_PREPARED'
  | 'DECLINED' | 'ANSWERED' | 'REFUSED';
export type WorkflowTask = { id: string; kind: string; startTurn: number; endTurn: number; confirmTurn?: number; previewTurn?: number;
  goldTerminal: { effect: WorkflowTerminalEffect; records: GoldRecord[] }; minimalTurns: number; completable: boolean; journeyId?: string };
export type WorkflowConversation = { id: string; actors: Actor[]; category: string; journeyKind: 'typed' | 'button'; credit?: 'normal' | 'exhausted'; tasks: WorkflowTask[]; turns: WorkflowTurn[] };
export type WorkflowCorpus = { version: 2; seed: string; status: 'draft' | 'reviewed'; conversations: WorkflowConversation[] };

const WORKFLOW_WRITE_EXEMPTIONS = new Set<WorkflowTerminalEffect>(['ANSWERED', 'REFUSED', 'DECLINED']);
const PAID_RECORDS: Partial<Record<WorkflowTerminalEffect, { table: GoldRecord['table']; amount: keyof GoldRecord; date: keyof GoldRecord; method: keyof GoldRecord }>> = {
  EXPENSE_PAID: { table: 'ExpensePayment', amount: 'paidAmount', date: 'paidDate', method: 'paymentMethod' },
  REIMBURSEMENT_PAID: { table: 'ReimbursementPayment', amount: 'paidAmount', date: 'paidDate', method: 'paymentMethod' },
  VOUCHER_PAID: { table: 'DisbursementVoucher', amount: 'paidAmount', date: 'paidDate', method: 'paymentMethod' },
};

export function validateWorkflowCorpus(value: unknown, knownSeedKeys?: ReadonlySet<string>): asserts value is WorkflowCorpus {
  assert.ok(isPlainObject(value) && value['version'] === 2 && nonEmptyString(value['seed']), 'WORKFLOW_CORPUS_VERSION');
  assert.ok(['draft', 'reviewed'].includes(value['status'] as string) && Array.isArray(value['conversations']) && (value['conversations'] as unknown[]).length, 'WORKFLOW_CORPUS_HEADER');
  const ids = new Set<string>(), freeCompanies = new Set<string>(), paidCompanies = new Set<string>();
  for (const [ci, raw] of (value['conversations'] as unknown[]).entries()) {
    const path = `conversations[${ci}]`;
    assert.ok(isPlainObject(raw) && nonEmptyString(raw['id']) && !ids.has(raw['id'] as string), `${path}.id`); ids.add(raw['id'] as string);
    assert.ok(Array.isArray(raw['actors']) && raw['actors'].length > 0 && Array.isArray(raw['turns']) && raw['turns'].length > 0 && Array.isArray(raw['tasks']), `${path}.shape`);
    assert.ok(nonEmptyString(raw['category']) && ['typed', 'button'].includes(raw['journeyKind'] as string), `${path}.journey`);
    const actors = raw['actors'] as unknown[], actorKeys = new Set<string>();
    for (const actor of actors) {
      assert.ok(isPlainObject(actor) && nonEmptyString(actor['key']) && !actorKeys.has(actor['key'] as string), `${path}.actor`);
      actorKeys.add(actor['key'] as string);
      if (actor['kind'] === 'unlinked') {
        assert.ok(['company', 'role', 'branchScope', 'freeSourceDrafts'].every(key => actor[key] === undefined), `${path}.unlinked_actor_scope`);
        continue;
      }
      assert.ok(actor['kind'] === undefined || ['member', 'creator-only'].includes(actor['kind'] as string), `${path}.actor_kind`);
      assert.ok((COMPANIES as readonly unknown[]).includes(actor['company']) && (ROLES as readonly unknown[]).includes(actor['role']), `${path}.actor_scope`);
      if (actor['kind'] === 'creator-only') assert.ok(actor['company'] === 'B' && actor['role'] === 'STAFF' && actor['freeSourceDrafts'] === undefined, `${path}.creator_only_paid_B`);
      if (actor['freeSourceDrafts'] !== undefined) assert.equal(actor['freeSourceDrafts'], true, `${path}.freeSourceDrafts`);
      (actor['freeSourceDrafts'] ? freeCompanies : paidCompanies).add(actor['company'] as string);
      const scope = actor['branchScope'];
      assert.ok(scope === 'all' || isPlainObject(scope) && Array.isArray(scope['branches']) && scope['branches'].every(nonEmptyString), `${path}.branch_scope`);
    }
    const turns = raw['turns'] as unknown[];
    for (const [ti, turn] of turns.entries()) {
      assert.ok(isPlainObject(turn) && (nonEmptyString(turn['user']) || nonEmptyString(turn['press'])), `${path}.turns[${ti}].input`);
      assert.ok(!(nonEmptyString(turn['user']) && nonEmptyString(turn['press'])), `${path}.turns[${ti}].one_input`);
      if (turn['as'] !== undefined) assert.ok(isPlainObject(turn['as']) && actorKeys.has(turn['as']['key'] as string), `${path}.turns[${ti}].as`);
      if (turn['pressFrom'] !== undefined) {
        const from = turn['pressFrom'];
        assert.ok(isPlainObject(from) && Number.isInteger(from['turn']) && (from['turn'] as number) >= 0 && (from['turn'] as number) < ti, `${path}.turns[${ti}].pressFrom`);
        if (from['actor'] !== undefined) assert.ok(isPlainObject(from['actor']) && actorKeys.has(from['actor']['key'] as string), `${path}.turns[${ti}].pressFrom.actor`);
      }
      const expect = turn['expect']; assert.ok(isPlainObject(expect), `${path}.turns[${ti}].expect`);
      const answerPath = `${path} (${raw['id']}).turns[${ti}]`;
      if (expect['knowledge'] !== undefined) {
        const gold = expect['knowledge'];
        assert.ok(isPlainObject(gold) && nonEmptyString(gold['cardId']) && Number.isInteger(gold['version']) && (gold['version'] as number) > 0, `${answerPath}.knowledge.card`);
        for (const key of ['requiredFacts', 'forbiddenFacts', 'allowedNumericFacts'])
          assert.ok(Array.isArray(gold[key]) && (gold[key] as unknown[]).every(nonEmptyString), `${answerPath}.knowledge.${key}`);
      }
      if (expect['dueDate'] !== undefined) {
        const gold = expect['dueDate'];
        assert.ok(isPlainObject(gold) && ['PND3', 'PND53'].includes(gold['formType'] as string) && [-1, 0, 1].includes(gold['monthOffset'] as number), `${answerPath}.dueDate`);
      }
      if (expect['refusal'] !== undefined) {
        const refusal = expect['refusal'];
        assert.ok(isPlainObject(refusal) && ['permission', 'package', 'free'].includes(refusal['reason'] as string)
          && Array.isArray(refusal['wayOut']) && refusal['wayOut'].length > 0 && refusal['wayOut'].every(nonEmptyString), `${answerPath}.refusal`);
        assert.ok(!expect['knowledge'] && !expect['dueDate'], `${answerPath}.refusal_must_not_leak_answer`);
      }
      const actorKey = (turn['as'] as ActorRef | undefined)?.key ?? (actors[0] as Actor).key;
      if ((actors.find(actor => (actor as Actor).key === actorKey) as Actor).freeSourceDrafts) {
        const answer = expect['card'] === 'answer' && ['knowledge', 'dueDate', 'preview', 'refusal'].every(key => expect[key] === undefined);
        assert.ok(expect['maxModelCalls'] === 0 && ((expect['refusal'] as { reason?: string } | undefined)?.reason === 'free' || answer), `${answerPath}.free_zero_model_refusal_or_answer`);
      }
      if (typeof turn['user'] === 'string') for (const key of referencedPlaceholders(turn['user'])) assert.ok(isKnownPlaceholder(key), `${answerPath}.placeholder:${key}`);
      if (expect['label'] !== undefined) assert.ok(nonEmptyString(expect['label']), `${path}.turns[${ti}].expect.label`);
      if (expect['preview'] !== undefined) assert.ok(isPlainObject(expect['preview']) && nonEmptyString(expect['preview']['action']) && nonEmptyString(expect['preview']['target']), `${path}.turns[${ti}].expect.preview`);
      if (expect['maxModelCalls'] !== undefined) assert.ok(Number.isInteger(expect['maxModelCalls']) && (expect['maxModelCalls'] as number) >= 0, `${path}.turns[${ti}].expect.maxModelCalls`);
      if (turn['fixture'] !== undefined) assert.ok(Array.isArray(turn['fixture']), `${path}.turns[${ti}].fixture`);
      for (const op of (turn['fixture'] as unknown[] | undefined) ?? []) {
        assert.ok(isPlainObject(op) && ['expire', 'mutate', 'setCredit'].includes(op['op'] as string), `${path}.fixture_op`);
        if (op['op'] === 'mutate') {
          assert.ok(['ExpenseRecord', 'ReimbursementRequest', 'DisbursementVoucher'].includes(op['table'] as string) && nonEmptyString(op['seedKey']) && isPlainObject(op['set']), `${path}.fixture_mutate`);
          if (knownSeedKeys) assert.ok(knownSeedKeys.has(op['seedKey'] as string), `${path}.fixture_mutate.seedKey`);
        }
      }
    }
    const tasks = raw['tasks'] as unknown[], taskIds = new Set<string>(), occupiedTurns = new Set<number>();
    for (const task of tasks) {
      assert.ok(isPlainObject(task) && nonEmptyString(task['id']) && !taskIds.has(task['id'] as string), `${path}.task_id`); taskIds.add(task['id'] as string);
      assert.ok(nonEmptyString(task['kind']) && Number.isInteger(task['startTurn']) && Number.isInteger(task['endTurn'])
        && (task['startTurn'] as number) >= 0 && (task['endTurn'] as number) >= (task['startTurn'] as number) && (task['endTurn'] as number) < turns.length,
      `${path}.task_range`);
      assert.ok(Number.isInteger(task['minimalTurns']) && (task['minimalTurns'] as number) > 0 && typeof task['completable'] === 'boolean', `${path}.task_metrics`);
      for (let index = task['startTurn'] as number; index <= (task['endTurn'] as number); index++) {
        assert.ok(!occupiedTurns.has(index), `${path}.task_overlap`); occupiedTurns.add(index);
      }
      const terminal = task['goldTerminal']; assert.ok(isPlainObject(terminal) && Array.isArray(terminal['records']), `${path}.gold_terminal`);
      assert.ok((['REIMBURSEMENT_DRAFT_SAVED','REIMBURSEMENT_SUBMITTED','REIMBURSEMENT_APPROVED','REIMBURSEMENT_REJECTED','REIMBURSEMENT_CANCELLED','REIMBURSEMENT_PAID','EXPENSE_MARKED_READY','EXPENSE_CONFIRMED','EXPENSE_DELETED','EXPENSE_VOIDED','EXPENSE_PAID','VOUCHER_CREATED','VOUCHER_SUBMITTED','VOUCHER_APPROVED','VOUCHER_PAID','WHT_ISSUED','SUBSTITUTE_PREPARED','DECLINED','ANSWERED','REFUSED'] as readonly unknown[]).includes(terminal['effect']), `${path}.gold_terminal.effect`);
      const effect = terminal['effect'] as WorkflowTerminalEffect, confirmTurn = task['confirmTurn'] as number | undefined;
      if (task['previewTurn'] !== undefined) {
        const previewTurn = task['previewTurn'] as number;
        assert.ok(effect === 'DECLINED' && Number.isInteger(previewTurn) && previewTurn >= (task['startTurn'] as number) && previewTurn < (task['endTurn'] as number)
          && isPlainObject((turns[previewTurn] as Record<string, any> | undefined)?.['expect']?.['preview']), `${path}.previewTurn`);
      }
      if (!WORKFLOW_WRITE_EXEMPTIONS.has(effect)) {
        assert.ok(Number.isInteger(confirmTurn) && confirmTurn! >= (task['startTurn'] as number) && confirmTurn! <= (task['endTurn'] as number), `${path}.confirmTurn_required`);
        const previewTurn = confirmTurn! - 1;
        const previewExpect = (turns[previewTurn] as Record<string, unknown> | undefined)?.['expect'];
        assert.ok(isPlainObject(previewExpect) && isPlainObject(previewExpect['preview']), `${path} (${raw['id']}).turns[${previewTurn}].preview_before_confirm (confirmTurn ${confirmTurn})`);
      } else assert.ok(confirmTurn === undefined, `${path}.confirmTurn_unexpected`);
      for (const record of terminal['records'] as unknown[]) {
        assert.ok(isPlainObject(record) && nonEmptyString(record['ref']) && nonEmptyString(record['table']), `${path}.gold_record`);
        if (record['phase'] !== undefined) assert.equal(record['phase'], 'collect', `${path}.gold_record.phase`);
        if (record['ref'] && (record['ref'] as string).startsWith('$seed:') && knownSeedKeys)
          assert.ok(knownSeedKeys.has((record['ref'] as string).slice('$seed:'.length)), `${path}.gold_record.seed_ref`);
      }
      const paid = PAID_RECORDS[effect];
      if (paid) assert.ok((terminal['records'] as Array<Record<string, unknown>>).some(record => record['table'] === paid.table
        && nonEmptyString(record[paid.amount]) && nonEmptyString(record[paid.date]) && nonEmptyString(record[paid.method])), `${path}.paid_record_fields`);
    }
    if (raw['journeyKind'] === 'typed') for (const [ti, turn] of turns.entries()) {
      if (!isPlainObject(turn) || !nonEmptyString(turn['press'])) continue;
      assert.ok((turn['expect'] as Record<string, unknown> | undefined)?.['label'] === turn['press'], `${path}.typed_button_not_in_baseline:${ti}`);
    }
    for (const key of Object.keys(raw)) assert.ok(['id', 'actors', 'category', 'journeyKind', 'credit', 'tasks', 'turns'].includes(key), `${path}.${key}:unknown`);
  }
  for (const company of freeCompanies) assert.ok(!paidCompanies.has(company), `WORKFLOW_MIXED_FREE_PAID_SEED:${company}`);
  for (const key of Object.keys(value)) assert.ok(['version', 'seed', 'status', 'conversations'].includes(key), `workflow_corpus.${key}:unknown`);
}

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : isPlainObject(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const workflowCorpusDigest = (corpus: WorkflowCorpus) => createHash('sha256').update(JSON.stringify(canonical(corpus))).digest('hex');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isPeriodRef(value: unknown): value is PeriodRef {
  return isPlainObject(value) && Object.keys(value).length === 1
    && (PERIOD_TOKENS as readonly string[]).includes(value['$period'] as string);
}
function isShownItemRef(value: unknown): value is ShownItemRef {
  return isPlainObject(value) && Object.keys(value).length === 1
    && Number.isInteger(value['$fromShownItems']) && (value['$fromShownItems'] as number) >= 0;
}
function isGoldInputValue(value: unknown): value is GoldInputValue {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value) || isPeriodRef(value) || isShownItemRef(value);
}

function validateGoldCall(call: unknown, path: string): asserts call is GoldCall {
  assert.ok(isPlainObject(call), `${path}: gold call must be an object`);
  assert.ok(nonEmptyString(call['tool']), `${path}.tool: required non-empty string`);
  assert.ok(isPlainObject(call['input']), `${path}.input: required object`);
  for (const [key, value] of Object.entries(call['input'] as Record<string, unknown>)) {
    assert.ok(isGoldInputValue(value), `${path}.input.${key}: unsupported value ${JSON.stringify(value)}`);
  }
  if (call['answerShape'] !== undefined) {
    assert.ok((ANSWER_SHAPES as readonly string[]).includes(call['answerShape'] as string), `${path}.answerShape: must be one of ${ANSWER_SHAPES.join(', ')}`);
  }
  if (call['groupBy'] !== undefined) {
    assert.ok((GROUP_BY_DIMENSIONS as readonly string[]).includes(call['groupBy'] as string), `${path}.groupBy: must be one of ${GROUP_BY_DIMENSIONS.join(', ')}`);
  }
  if (call['alternatives'] !== undefined) {
    assert.ok(Array.isArray(call['alternatives']), `${path}.alternatives: must be an array`);
    (call['alternatives'] as unknown[]).forEach((alt, index) => validateGoldCall(alt, `${path}.alternatives[${index}]`));
  }
  const knownKeys = new Set(['tool', 'input', 'answerShape', 'groupBy', 'alternatives']);
  for (const key of Object.keys(call)) assert.ok(knownKeys.has(key), `${path}.${key}: unknown field`);
}

const TAG_KEYS = new Set(['no_tool', 'must_answer', 'must_not_refuse', 'must_mention_any', 'must_not_claim', 'forbidden_tools', 'must_ask_choice']);

function validateTags(tags: unknown, path: string): asserts tags is TurnTags {
  assert.ok(isPlainObject(tags), `${path}: tags must be an object`);
  for (const key of Object.keys(tags)) assert.ok(TAG_KEYS.has(key), `${path}.${key}: unknown tag`);
  for (const key of ['no_tool', 'must_answer', 'must_not_refuse', 'must_ask_choice'] as const) {
    if (tags[key] !== undefined) assert.equal(typeof tags[key], 'boolean', `${path}.${key}: must be boolean`);
  }
  for (const key of ['must_mention_any', 'must_not_claim', 'forbidden_tools'] as const) {
    if (tags[key] === undefined) continue;
    assert.ok(Array.isArray(tags[key]) && (tags[key] as unknown[]).every(nonEmptyString), `${path}.${key}: must be a non-empty string array`);
  }
}

function validateTurn(turn: unknown, path: string): asserts turn is Turn {
  assert.ok(isPlainObject(turn), `${path}: turn must be an object`);
  assert.ok(nonEmptyString(turn['user']), `${path}.user: required non-empty string`);
  for (const key of referencedPlaceholders(turn['user'] as string)) {
    assert.ok(isKnownPlaceholder(key), `${path}.user: unknown placeholder {{${key}}} (see template.ts TEMPLATE_PLACEHOLDERS)`);
  }
  assert.ok(nonEmptyString(turn['category']), `${path}.category: required non-empty string`);
  if (turn['language'] !== undefined) {
    assert.ok(Array.isArray(turn['language']) && (turn['language'] as unknown[]).every(nonEmptyString), `${path}.language: must be a string array`);
  }
  const expect = turn['expect'];
  assert.ok(isPlainObject(expect), `${path}.expect: required object`);
  const hasCalls = expect['calls'] !== undefined;
  const hasTags = expect['tags'] !== undefined;
  assert.ok(hasCalls || hasTags, `${path}.expect: needs at least one of calls/tags`);
  if (hasCalls) {
    assert.ok(Array.isArray(expect['calls']) && (expect['calls'] as unknown[]).length > 0, `${path}.expect.calls: must be a non-empty array`);
    (expect['calls'] as unknown[]).forEach((call, index) => validateGoldCall(call, `${path}.expect.calls[${index}]`));
  }
  if (hasTags) validateTags(expect['tags'], `${path}.expect.tags`);
  if (expect['requiredFacts'] !== undefined) {
    assert.ok(Array.isArray(expect['requiredFacts']) && (expect['requiredFacts'] as unknown[]).length > 0,
      `${path}.expect.requiredFacts: must be a non-empty array when present`);
    for (const category of expect['requiredFacts'] as unknown[]) {
      assert.ok((REQUIRED_FACT_CATEGORIES as readonly unknown[]).includes(category),
        `${path}.expect.requiredFacts: "${category}" must be one of ${REQUIRED_FACT_CATEGORIES.join(', ')}`);
    }
  }
  const knownExpectKeys = new Set(['calls', 'tags', 'requiredFacts']);
  for (const key of Object.keys(expect)) assert.ok(knownExpectKeys.has(key), `${path}.expect.${key}: unknown field`);
  const knownTurnKeys = new Set(['user', 'category', 'language', 'expect']);
  for (const key of Object.keys(turn)) assert.ok(knownTurnKeys.has(key), `${path}.${key}: unknown field`);
}

function validateConversation(conversation: unknown, path: string, seenIds: Set<string>): asserts conversation is Conversation {
  assert.ok(isPlainObject(conversation), `${path}: conversation must be an object`);
  assert.ok(nonEmptyString(conversation['id']), `${path}.id: required non-empty string`);
  assert.ok(!seenIds.has(conversation['id'] as string), `${path}.id: duplicate conversation id ${conversation['id']}`);
  seenIds.add(conversation['id'] as string);
  assert.ok((LEGACY_COMPANIES as readonly string[]).includes(conversation['company'] as string), `${path}.company: must be one of ${LEGACY_COMPANIES.join(', ')}`);
  assert.ok((ROLES as readonly string[]).includes(conversation['role'] as string), `${path}.role: must be one of ${ROLES.join(', ')}`);
  assert.ok(Array.isArray(conversation['turns']) && (conversation['turns'] as unknown[]).length > 0, `${path}.turns: must be a non-empty array`);
  (conversation['turns'] as unknown[]).forEach((turn, index) => validateTurn(turn, `${path}.turns[${index}]`));
  const knownKeys = new Set(['id', 'company', 'role', 'turns']);
  for (const key of Object.keys(conversation)) assert.ok(knownKeys.has(key), `${path}.${key}: unknown field`);
}

/** Structural validation only (shape, enums, referential sanity of `$fromShownItems` indices are
 * NOT checked here — that needs the oracle's per-turn shownItems, see oracle.ts). */
export function validateCorpus(value: unknown): asserts value is Corpus {
  assert.ok(isPlainObject(value), 'corpus must be an object');
  assert.equal(value['version'], 1, 'corpus.version must be 1');
  assert.ok(Array.isArray(value['conversations']) && value['conversations'].length > 0, 'corpus.conversations must be a non-empty array');
  const seenIds = new Set<string>();
  (value['conversations'] as unknown[]).forEach((conversation, index) => validateConversation(conversation, `conversations[${index}]`, seenIds));
}

/** Flat list of every turn with its conversation context, in corpus order — the shape both the
 * oracle and the report want to iterate over. */
export function flattenTurns(corpus: Corpus): Array<{ conversation: Conversation; turnIndex: number; turn: Turn }> {
  return corpus.conversations.flatMap((conversation) =>
    conversation.turns.map((turn, turnIndex) => ({ conversation, turnIndex, turn })));
}

/** The minimal shape run-real.ts's own `*.evidence.json` has, for re-running just the
 * conversations that failed last time (task item "re-run a subset"). */
export type EvidenceFileForSubsetSelection = { summary: { failures: Array<{ conversationId: string }> } };

/** Every conversation id that had at least one failing turn, in first-seen order, de-duplicated —
 * a conversation with 2 failing turns is still just ONE id to re-run (whole conversations only:
 * a follow-up turn needs its own history, never a single turn in isolation). */
export function parseFailedConversationIds(evidence: EvidenceFileForSubsetSelection): string[] {
  return [...new Set(evidence.summary.failures.map((failure) => failure.conversationId))];
}

/** `onlyIds === null` means "no subset requested" — every conversation runs, unchanged. Otherwise
 * keeps the corpus's own order (never `onlyIds`' order) and refuses a stale/misspelled id outright
 * — silently running fewer conversations than asked for is the one wrong failure mode for a
 * re-run whose whole point is confirming a specific fix. */
export function selectConversations(corpus: Corpus, onlyIds: readonly string[] | null): Conversation[] {
  if (onlyIds === null) return corpus.conversations;
  const known = new Set(corpus.conversations.map((conversation) => conversation.id));
  for (const id of onlyIds) assert.ok(known.has(id), `MANGMEE_EVAL_ONLY: no conversation with id "${id}" in this corpus`);
  const wanted = new Set(onlyIds);
  return corpus.conversations.filter((conversation) => wanted.has(conversation.id));
}
