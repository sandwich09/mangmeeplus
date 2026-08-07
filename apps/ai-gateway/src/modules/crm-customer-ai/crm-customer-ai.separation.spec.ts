/**
 * Separation guard for the CRM customer-facing AI family (spec §25 boundary rules).
 * These must stay green as the family grows (B2–B5) — they encode the hard boundary
 * that keeps CRM AI physically apart from the employee LINE-AI tool surface.
 *
 * Source-scan (not reflection): a NestJS route cannot exist without its `@Post(...)`
 * decorator in the source, so scanning the controller files is a faithful, dependency-free
 * check of the wired route table.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ALLOWED_TOOLS as BOOKING_EXTRACT_TOOLS } from './agents/crm-booking-extract.agent';
import { ALLOWED_TOOLS as INTAKE_TOOLS } from './agents/crm-customer-intake.agent';
import { ALLOWED_TOOLS as REPLY_TOOLS } from './agents/crm-customer-reply.agent';
import { ALLOWED_TOOLS as TRUST_TOOLS } from './agents/crm-trust-score.agent';
import { ALLOWED_TOOLS as SUMMARY_TOOLS } from './agents/crm-conversation-summary.agent';
import { ALLOWED_TOOLS as INSIGHTS_TOOLS } from './agents/crm-insights.agent';
import { ALLOWED_TOOLS as PROFILE_EXTRACT_TOOLS } from './agents/crm-customer-profile-extract.agent';

const MODULE_DIR = __dirname;

const CRM_CONTROLLER = join(MODULE_DIR, 'crm-customer-ai-internal.controller.ts');
const LINE_AI_CONTROLLER = join(MODULE_DIR, '../line-ai/presentation/http/line-ai-internal.controller.ts');
const AI_DRAFT_CONTROLLER = join(MODULE_DIR, '../ai-draft/ai-draft-internal.controller.ts');
const LINE_AI_DIR = join(MODULE_DIR, '../line-ai');
const AI_DRAFT_DIR = join(MODULE_DIR, '../ai-draft');

function routePathsOf(controllerFile: string): string[] {
  const src = readFileSync(controllerFile, 'utf8');
  const paths: string[] = [];
  const re = /@(?:Post|Get|Put|Patch|Delete)\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) paths.push(m[1]);
  return paths;
}

// Strip comments so the scan targets actual code references (imports/usage), not the
// doc comments that name the boundary they forbid.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function moduleSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...moduleSourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

// All module specifiers a file imports (comments stripped so the boundary named in prose does
// not register as a real dependency).
function importSpecifiersOf(file: string): string[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  const specs: string[] = [];
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe('crm-customer-ai separation (spec §25 boundary)', () => {
  it('1. crm controller exposes exactly the crm-* route set', () => {
    const crm = routePathsOf(CRM_CONTROLLER).sort();
    assert.deepEqual(crm, ['crm-booking-extract', 'crm-broadcast', 'crm-customer-profile-extract', 'crm-insights', 'crm-intake', 'crm-reply-draft', 'crm-summary', 'crm-trust-score']);
    for (const p of crm) assert.ok(p.startsWith('crm-'), `crm route "${p}" must start with crm-`);
  });

  it('1. line-ai and ai-draft route sets contain no crm-* routes', () => {
    for (const file of [LINE_AI_CONTROLLER, AI_DRAFT_CONTROLLER]) {
      for (const p of routePathsOf(file)) {
        assert.ok(!p.startsWith('crm-'), `${file} must not expose crm route "${p}"`);
      }
    }
  });

  it('2. every CRM agent ALLOWED_TOOLS is empty (zero ERP tools)', () => {
    assert.equal(BOOKING_EXTRACT_TOOLS.size, 0);
    assert.equal(INTAKE_TOOLS.size, 0);
    assert.equal(REPLY_TOOLS.size, 0);
    assert.equal(TRUST_TOOLS.size, 0);
    assert.equal(SUMMARY_TOOLS.size, 0);
    assert.equal(INSIGHTS_TOOLS.size, 0);
    assert.equal(PROFILE_EXTRACT_TOOLS.size, 0);
  });

  it('2. crm-customer-ai module references no ERP tool registry, client, or native tool loop', () => {
    for (const file of moduleSourceFiles(MODULE_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      assert.ok(!code.includes('LINE_TOOL_REGISTRY'), `${file} must not reference LINE_TOOL_REGISTRY`);
      assert.ok(!/erp-tool/i.test(code), `${file} must not reference the ERP tool client`);
      // ALLOWED_TOOLS being empty only matters if the agents also never open the tool-calling
      // surface; generateWithTools is the only way to invoke tools through the provider port.
      assert.ok(!code.includes('generateWithTools'), `${file} must not use the native tool loop`);
    }
  });

  it('3. line-ai and ai-draft never import crm-customer-ai (reverse boundary)', () => {
    for (const dir of [LINE_AI_DIR, AI_DRAFT_DIR]) {
      for (const file of moduleSourceFiles(dir)) {
        for (const spec of importSpecifiersOf(file)) {
          assert.ok(!/crm-customer-ai/.test(spec), `${file} must not import crm-customer-ai (${spec})`);
        }
      }
    }
  });

  it('3. crm-customer-ai imports from sibling modules ONLY the provider port', () => {
    for (const file of moduleSourceFiles(MODULE_DIR)) {
      for (const spec of importSpecifiersOf(file)) {
        if (/\/line-ai\//.test(spec) || /\/ai-draft\//.test(spec)) {
          assert.ok(
            /\/line-ai\/infrastructure\/provider\//.test(spec),
            `${file} may import only the line-ai provider port from a sibling module, not ${spec}`,
          );
        }
      }
    }
  });

  it('3. crm-customer-ai imports no database, repository, or ORM (gateway calls APIs, not the DB)', () => {
    for (const file of moduleSourceFiles(MODULE_DIR)) {
      for (const spec of importSpecifiersOf(file)) {
        assert.ok(!/prisma/i.test(spec), `${file} must not import Prisma (${spec})`);
        assert.ok(!/repositor/i.test(spec), `${file} must not import a repository (${spec})`);
        assert.ok(!/\/database\//i.test(spec), `${file} must not import a database service (${spec})`);
      }
    }
  });
});
