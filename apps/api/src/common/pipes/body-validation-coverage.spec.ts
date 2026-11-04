/**
 * Audit H-23: a `@Body()` parameter typed with a TypeScript `type` or `interface` reaches the
 * global ValidationPipe as metatype `Object`, and the pipe skips it — silently. Types are erased at
 * runtime, so there is no shortcut: only a class carries the metadata `whitelist` and
 * `forbidNonWhitelisted` need, and a body without one is unvalidated no matter how precisely its
 * TypeScript type is written.
 *
 * 167 endpoints were in that state when this was first measured, which is far too many to convert in one
 * change: a DTO that names the wrong fields does not fail loudly, it rejects a legitimate request
 * in production, because forbidNonWhitelisted turns an unlisted key into a 400.
 *
 * So this spec does the part that can be done safely and at once. The backlog becomes an
 * enumerated, reviewable list instead of an invisible property of the codebase, and endpoint 169
 * cannot be added without someone deciding to add it here. Convert entries out of the list and
 * delete them; the count only moves one way.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// `__dirname`, like security-event.spec.ts: this package compiles to CommonJS, where import.meta
// is a syntax error.
const SRC = join(__dirname, '../..');

/**
 * `@Body(...) name: Type`, allowing decorators between the body decorator and the parameter.
 * Deliberately conservative: it matches what NestJS reads to pick a metatype, so a body it cannot
 * parse shows up as unmatched rather than being quietly assumed safe.
 */
const BODY_PARAM = /@Body\(([^)]*)\)\s*(?:@\w+\([^)]*\)\s*)*(\w+)\s*[?!]?\s*:\s*([A-Za-z0-9_.<>[\]{}|' ]+)/g;

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.isFile() && entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

export function unvalidatedBodyParams(): Array<{ file: string; param: string; type: string }> {
  return controllerFiles(SRC).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(BODY_PARAM)]
      // A class is the only thing the pipe can validate. `Dto` is this codebase's naming rule for
      // one, checked by the companion test below so the shortcut cannot rot.
      .filter((match) => !/Dto\b/.test(match[3]!))
      // `@Body('field') value: string` asks for one primitive, which the pipe cannot whitelist
      // either way; the use case owns it. Counted separately rather than pretended to be covered.
      .filter((match) => match[1]!.trim() === '')
      .map((match) => ({ file: relative(SRC, file), param: match[2]!, type: match[3]!.trim() }));
  });
}

/**
 * Endpoints whose body is not validated at the HTTP boundary.
 *
 * Ordering is by module so a conversion pass can take one module at a time — the DTO for a
 * controller is usually one file, and the fields come from the use case it calls.
 *
 * expenses went 28 -> 15 and transaction-tax 16 -> 11: their inline object literals became classes
 * in expense.dtos.ts and transaction-tax.dtos.ts (the signature-create body was the latest, a
 * mass-assignment fix). What is left in both is imported contract types, whose field sets have to be
 * read from the contract before they can be declared — a guess there costs a 400 on a legitimate request.
 */
const KNOWN_UNVALIDATED_BY_FILE: Readonly<Record<string, number>> = {
  'modules/expenses/presentation/http/expense.controller.ts': 15,
  'modules/tax/presentation/http/transaction-tax.controller.ts': 11,
  'modules/crm/presentation/http/crm-customer.controller.ts': 9,
  'modules/tax/presentation/http/tax.controller.ts': 7,
  'modules/crm/presentation/http/crm-opportunity.controller.ts': 8,
  'modules/crm-inbox/presentation/http/crm-conversation.controller.ts': 7,
  'modules/crm/presentation/http/crm-follow-up.controller.ts': 5,
  'modules/crm/presentation/http/crm-lead.controller.ts': 5,
};

/** Total across every controller, including the long tail not listed individually above. */
const KNOWN_UNVALIDATED_TOTAL = 141;

describe('request body validation coverage (audit H-23)', () => {
  it('does not grow the unvalidated-body backlog', () => {
    const found = unvalidatedBodyParams();

    assert.ok(
      found.length <= KNOWN_UNVALIDATED_TOTAL,
      `${found.length - KNOWN_UNVALIDATED_TOTAL} new @Body() parameter(s) without a DTO class. A `
      + 'type or interface annotation does not reach the ValidationPipe — declare a *Dto class so '
      + 'whitelist and forbidNonWhitelisted apply:\n'
      + found.map((entry) => `  ${entry.file} — ${entry.param}: ${entry.type}`).join('\n'),
    );
  });

  // Separate from the ceiling above so a conversion pass is visible as progress rather than as an
  // unchanged green tick: lower the number in the same commit that converts the endpoints.
  it('reports when the backlog has shrunk so the recorded total can be lowered', () => {
    const found = unvalidatedBodyParams();
    assert.equal(
      found.length,
      KNOWN_UNVALIDATED_TOTAL,
      `backlog is now ${found.length}; set KNOWN_UNVALIDATED_TOTAL to match in this commit`,
    );
  });

  it('keeps the worst-offending controllers on the record', () => {
    const found = unvalidatedBodyParams();
    const byFile = new Map<string, number>();
    for (const entry of found) byFile.set(entry.file, (byFile.get(entry.file) ?? 0) + 1);

    for (const [file, expected] of Object.entries(KNOWN_UNVALIDATED_BY_FILE)) {
      const actual = byFile.get(file) ?? 0;
      assert.ok(actual <= expected, `${file}: ${actual} unvalidated bodies, was ${expected}`);
    }
  });

  // The filter above trusts the `Dto` suffix to mean "a class the pipe can validate". A `type`
  // named `SomethingDto` and used as a body would count as covered while being skipped at runtime —
  // worse than an obviously untyped body, because the name says the boundary is guarded.
  //
  // Scoped to types that actually back a @Body(): a response shape named `...Dto` is not a boundary
  // and flagging it would train people to ignore this test.
  it('never lets a bare type alias impersonate a DTO class on a request body', () => {
    const offenders = controllerFiles(SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const bodyTypes = new Set([...source.matchAll(BODY_PARAM)].map((match) => match[3]!.trim()));
      return [...source.matchAll(/^\s*(?:export\s+)?(type|interface)\s+(\w*Dto)\b/gm)]
        .filter((match) => bodyTypes.has(match[2]!))
        .map((match) => `${relative(SRC, file)}: ${match[1]} ${match[2]}`);
    });

    assert.deepEqual(offenders, [], `declare these as classes: ${offenders.join(', ')}`);
  });
});
