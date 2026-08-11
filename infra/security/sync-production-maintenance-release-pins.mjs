#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const positional = args.filter((arg) => arg !== '--check');
if (positional.length > 1) {
  console.error('Usage: sync-production-maintenance-release-pins.mjs [--check] [repo-root]');
  process.exit(2);
}

const root = resolve(positional[0] ?? process.cwd());
const validatorPath = join(root, 'infra/security/validate-production-maintenance-release.sh');
const workflowPath = join(root, '.github/workflows/deploy-production.yml');
const validator = readFileSync(validatorPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

const specs = [];
const checkPattern = /^\s*check_file\s+(?:(['"])(.*?)\1|(\S+))\s+"\$(expected_[a-z0-9_]+)"\s*$/gm;
for (const match of validator.matchAll(checkPattern)) {
  specs.push({ path: match[2] ?? match[3], variable: match[4] });
}
if (specs.length === 0) throw new Error('No exact maintenance enforcement files were found');

const paths = new Set();
const variables = new Set();
let nextValidator = validator;
for (const spec of specs) {
  if (paths.has(spec.path) || variables.has(spec.variable)) {
    throw new Error(`Duplicate maintenance pin mapping: ${spec.variable} -> ${spec.path}`);
  }
  paths.add(spec.path);
  variables.add(spec.variable);

  const absolute = resolve(root, spec.path);
  if (isAbsolute(spec.path) || relative(root, absolute).startsWith('..')) {
    throw new Error(`Unsafe maintenance pin path: ${spec.path}`);
  }
  const digest = createHash('sha256').update(readFileSync(absolute)).digest('hex');
  const assignment = new RegExp(`^${spec.variable}=[0-9a-f]{64}$`, 'gm');
  const matches = nextValidator.match(assignment) ?? [];
  if (matches.length !== 1) throw new Error(`Expected one assignment for ${spec.variable}`);
  nextValidator = nextValidator.replace(assignment, `${spec.variable}=${digest}`);
}

const validatorDigest = createHash('sha256').update(nextValidator).digest('hex');
const workflowPin = /^([ \t]*EXPECTED_MAINTENANCE_RELEASE_VALIDATOR_SHA256: )[0-9a-f]{64}$/gm;
const workflowMatches = workflow.match(workflowPin) ?? [];
if (workflowMatches.length !== 1) {
  throw new Error('Expected one production workflow maintenance-validator pin');
}
const nextWorkflow = workflow.replace(workflowPin, `$1${validatorDigest}`);

const stale = nextValidator !== validator || nextWorkflow !== workflow;
if (checkOnly && stale) {
  console.error('Production maintenance enforcement pins are stale.');
  console.error('Run: node infra/security/sync-production-maintenance-release-pins.mjs');
  process.exit(1);
}
if (!checkOnly && stale) {
  writeFileSync(validatorPath, nextValidator);
  writeFileSync(workflowPath, nextWorkflow);
}

console.log(`[maintenance-pins] exactFiles=${specs.length} validatorSha256=${validatorDigest} status=${stale ? 'updated' : 'current'}`);
