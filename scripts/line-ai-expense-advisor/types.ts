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
import { PERIOD_TOKENS, type PeriodToken } from './period';
import { isKnownPlaceholder, referencedPlaceholders } from './template';

export const ROLES = ['OWNER', 'MANAGER', 'STAFF', 'ACCOUNTANT', 'AUDITOR_READONLY'] as const;
export type EvalRole = (typeof ROLES)[number];

export const COMPANIES = ['A', 'B'] as const;
export type EvalCompany = (typeof COMPANIES)[number];

export type PeriodRef = { $period: PeriodToken };
export type ShownItemRef = { $fromShownItems: number };
export type GoldInputValue = string | number | boolean | null | PeriodRef | ShownItemRef;
export type GoldInput = Record<string, GoldInputValue>;

export type GoldCall = {
  tool: string;
  input: GoldInput;
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
};

export type TurnExpect = {
  calls?: GoldCall[];
  tags?: TurnTags;
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
  if (call['alternatives'] !== undefined) {
    assert.ok(Array.isArray(call['alternatives']), `${path}.alternatives: must be an array`);
    (call['alternatives'] as unknown[]).forEach((alt, index) => validateGoldCall(alt, `${path}.alternatives[${index}]`));
  }
  const knownKeys = new Set(['tool', 'input', 'alternatives']);
  for (const key of Object.keys(call)) assert.ok(knownKeys.has(key), `${path}.${key}: unknown field`);
}

const TAG_KEYS = new Set(['no_tool', 'must_answer', 'must_not_refuse', 'must_mention_any', 'must_not_claim', 'forbidden_tools']);

function validateTags(tags: unknown, path: string): asserts tags is TurnTags {
  assert.ok(isPlainObject(tags), `${path}: tags must be an object`);
  for (const key of Object.keys(tags)) assert.ok(TAG_KEYS.has(key), `${path}.${key}: unknown tag`);
  for (const key of ['no_tool', 'must_answer', 'must_not_refuse'] as const) {
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
  const knownExpectKeys = new Set(['calls', 'tags']);
  for (const key of Object.keys(expect)) assert.ok(knownExpectKeys.has(key), `${path}.expect.${key}: unknown field`);
  const knownTurnKeys = new Set(['user', 'category', 'language', 'expect']);
  for (const key of Object.keys(turn)) assert.ok(knownTurnKeys.has(key), `${path}.${key}: unknown field`);
}

function validateConversation(conversation: unknown, path: string, seenIds: Set<string>): asserts conversation is Conversation {
  assert.ok(isPlainObject(conversation), `${path}: conversation must be an object`);
  assert.ok(nonEmptyString(conversation['id']), `${path}.id: required non-empty string`);
  assert.ok(!seenIds.has(conversation['id'] as string), `${path}.id: duplicate conversation id ${conversation['id']}`);
  seenIds.add(conversation['id'] as string);
  assert.ok((COMPANIES as readonly string[]).includes(conversation['company'] as string), `${path}.company: must be one of ${COMPANIES.join(', ')}`);
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
