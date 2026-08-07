#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');

if (args.length === 0) {
  console.error('Usage: pnpm agent:gates -- <plan-or-memory.md> [...]');
  process.exit(2);
}

const checks = {
  plan: [
    /## Role Gates/i,
    /BA gate:/i,
    /SA gate:/i,
    /DEV gate:/i,
    /Integration gate:/i,
    /## Integration Verification/i,
  ],
  memory: [
    /Role gate status:/i,
    /- BA:/i,
    /- SA:/i,
    /- DEV:/i,
    /- Integration:/i,
    /Verification:/i,
    /Next:/i,
  ],
};

function kindFor(file) {
  if (file.includes('/agent-memory/')) return 'memory';
  if (file.includes('/plans/') || file.includes('/_templates/implementation-plan')) return 'plan';
  return 'plan';
}

let failed = false;

for (const file of args) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    failed = true;
    console.error(`${file}: cannot read (${error.message})`);
    continue;
  }

  const kind = kindFor(file);
  const missing = checks[kind].filter((pattern) => !pattern.test(text));

  if (missing.length > 0) {
    failed = true;
    console.error(`${file}: missing ${kind} gate evidence:`);
    for (const pattern of missing) console.error(`  - ${pattern.source}`);
  } else {
    console.log(`${file}: ${kind} gate evidence ok`);
  }
}

process.exit(failed ? 1 : 0);
