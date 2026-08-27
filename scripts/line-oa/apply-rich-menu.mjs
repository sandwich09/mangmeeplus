#!/usr/bin/env node
/**
 * Apply a committed rich-menu profile to a LINE OA through the Messaging API.
 *
 * Implements the sequence in docs/runbooks/line-rich-menu-v2-console-setup.md, with the two
 * safeguards that runbook insists on kept as separate commands rather than one button:
 * `stage` creates and uploads WITHOUT touching what employees see, and `activate` is the only
 * step that flips the default — so a menu can never go live before its backend is deployed.
 *
 * The channel access token is read from Secrets Manager at run time and never printed, stored,
 * or passed on a command line. Nothing here writes into the repository.
 *
 * Usage:
 *   node scripts/line-oa/apply-rich-menu.mjs status
 *   node scripts/line-oa/apply-rich-menu.mjs stage    [--profile line-rich-menu-v2-ver2]
 *   node scripts/line-oa/apply-rich-menu.mjs activate --rich-menu-id richmenu-xxxx --yes
 *   node scripts/line-oa/apply-rich-menu.mjs rollback --rich-menu-id richmenu-previous --yes
 *   node scripts/line-oa/apply-rich-menu.mjs delete   --rich-menu-id richmenu-xxxx --yes
 *
 * Options: --env uat|production (default uat) · --profile <manifest profile id> · --yes (skip prompt)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://api.line.me/v2/bot';
const API_DATA = 'https://api-data.line.me/v2/bot';
const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const env = flag('env', 'uat');
const profileId = flag('profile', 'line-rich-menu-v2-ver2');
const richMenuIdArg = flag('rich-menu-id');
const assumeYes = args.includes('--yes');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

/** Secrets Manager, not an env var: a long-lived OA token must not sit in a shell history. */
function channelToken() {
  if (!['uat', 'production'].includes(env)) fail('--env must be uat or production');
  try {
    return execFileSync('aws', [
      'secretsmanager', 'get-secret-value',
      '--secret-id', `watchdog-bms/${env}/line-messaging-channel-access-token`,
      '--query', 'SecretString', '--output', 'text', '--region', REGION,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    fail(`could not read the ${env} channel access token from Secrets Manager (check AWS credentials)`);
  }
}

/** Never echoes the response body on failure — LINE errors can quote the request headers. */
async function lineFetch(url, { token, method = 'GET', body, contentType = 'application/json' } = {}) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': contentType } : {}) },
    ...(body ? { body } : {}),
  });
  const text = await response.text();
  if (!response.ok) fail(`${method} ${url.replace(/richmenu-[0-9a-f]+/g, 'richmenu-…')} → ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function loadProfile() {
  const manifestPath = resolve(ROOT, `scripts/line-oa/${profileId.replace('line-rich-menu-', 'rich-menu-')}.manifest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.profileId !== profileId) fail(`manifest profileId ${manifest.profileId} does not match --profile ${profileId}`);
  const image = await readFile(resolve(ROOT, manifest.image.path));
  // The manifest checksum is the contract with the spec test: refuse to upload bytes it never saw.
  const sha256 = createHash('sha256').update(image).digest('hex');
  if (manifest.image.sha256 !== sha256) fail(`bitmap sha256 mismatch — manifest ${manifest.image.sha256}, file ${sha256}`);
  if (manifest.image.byteSize !== image.byteLength) fail(`bitmap byteSize mismatch — manifest ${manifest.image.byteSize}, file ${image.byteLength}`);
  return { manifest, image };
}

async function confirm(question) {
  if (assumeYes) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [type yes to continue] `);
  rl.close();
  if (answer.trim() !== 'yes') fail('cancelled');
}

async function status(token) {
  let current = null;
  try {
    current = await lineFetch(`${API}/user/all/richmenu`, { token });
  } catch {
    current = null; // no default set yet is a legitimate state, not an error
  }
  const list = await lineFetch(`${API}/richmenu/list`, { token });
  console.log(`env: ${env}`);
  console.log(`active default: ${current?.richMenuId ?? '(none)'}`);
  console.log('existing rich menus:');
  for (const menu of list.richmenus ?? []) {
    const active = menu.richMenuId === current?.richMenuId ? '  ← ACTIVE' : '';
    console.log(`  ${menu.richMenuId}  ${menu.name}  ${menu.size.width}x${menu.size.height}${active}`);
  }
  console.log('\nRecord the ACTIVE id above as the rollback target before staging anything.');
}

async function stage(token) {
  const { manifest, image } = await loadProfile();
  await status(token);

  console.log(`\nvalidating ${profileId} …`);
  await lineFetch(`${API}/richmenu/validate`, { token, method: 'POST', body: JSON.stringify(manifest.lineRichMenu) });

  console.log('creating …');
  const created = await lineFetch(`${API}/richmenu`, { token, method: 'POST', body: JSON.stringify(manifest.lineRichMenu) });
  const richMenuId = created.richMenuId;
  if (!richMenuId) fail('LINE returned no richMenuId');

  console.log(`uploading bitmap (${image.byteLength} bytes) …`);
  await lineFetch(`${API_DATA}/richmenu/${richMenuId}/content`, {
    token, method: 'POST', body: image, contentType: 'image/png',
  });

  console.log(`\nSTAGED — not visible to anyone yet.`);
  console.log(`  profile:     ${profileId}`);
  console.log(`  richMenuId:  ${richMenuId}`);
  console.log(`  bitmap:      ${manifest.image.path} (sha256 ${manifest.image.sha256.slice(0, 16)}…)`);
  console.log('\nActivate only after the backend carrying this profile is deployed:');
  console.log(`  node scripts/line-oa/apply-rich-menu.mjs activate --env ${env} --rich-menu-id ${richMenuId}`);
}

async function setDefault(token, richMenuId, verb) {
  if (!richMenuId) fail('--rich-menu-id is required');
  await confirm(`${verb} ${richMenuId} as the ${env} default for EVERY employee?`);
  await lineFetch(`${API}/user/all/richmenu/${richMenuId}`, { token, method: 'POST' });
  console.log(`done — ${richMenuId} is now the ${env} default.`);
  console.log('Reopen the LINE chat to see it; a new default can take up to a minute, and a per-user menu overrides it.');
}

async function main() {
  const token = channelToken();
  if (command === 'status') return status(token);
  if (command === 'stage') return stage(token);
  if (command === 'activate') return setDefault(token, richMenuIdArg, 'Set');
  if (command === 'rollback') return setDefault(token, richMenuIdArg, 'Roll back to');
  if (command === 'delete') {
    if (!richMenuIdArg) fail('--rich-menu-id is required');
    await confirm(`Permanently delete ${richMenuIdArg}? (keep the previous menu until the new one is accepted)`);
    await lineFetch(`${API}/richmenu/${richMenuIdArg}`, { token, method: 'DELETE' });
    return console.log('deleted.');
  }
  fail('usage: status | stage | activate | rollback | delete  (see the header of this file)');
}

await main();
