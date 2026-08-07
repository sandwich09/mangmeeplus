import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F1.5.1 blocker — static manifest check over every runtime definition in this repo.
 *
 * `validateProductionConfig` refuses to boot an `APP_ENV=production` process that was not handed
 * the authoritative deployment identity (`DEPLOY_ENVIRONMENT` + a full `GIT_SHA`). That rule is
 * correct and must never be weakened, so the failure it produces is a *deploy-time* failure: a
 * task or runtime definition that sets `APP_ENV` and forgets its two siblings ships fine, passes
 * every unit test, and then dies on the first production invocation.
 *
 * This test moves that failure into CI. It reads the repo from disk — not a copy — and asserts
 * that every place which DEFINES `APP_ENV` also defines `DEPLOY_ENVIRONMENT` and `GIT_SHA`. The
 * rule is deliberately exception-free: there is no allowlist to rot, and `compose.local.yml`
 * carries the identity too, because an operator can run it with `APP_ENV=production`.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Build outputs, vendored trees, and other sessions' git worktrees under `.claude/` are copies of
// this repo, not runtime paths this branch owns.
const SKIP_DIR_NAMES = new Set([
  '.claude',
  '.git',
  '.pnpm-store',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const skipDir = (name: string): boolean => SKIP_DIR_NAMES.has(name) || name.startsWith('.next');

// Every file shape this repo uses to declare a container/runtime environment.
const isScannedFile = (name: string): boolean => (
  /\.(sh|json|ya?ml)$/.test(name) || name.startsWith('Dockerfile')
);

const usesHashComments = (name: string): boolean => (
  /\.(sh|ya?ml)$/.test(name) || name.startsWith('Dockerfile')
);

/**
 * Lines on which `name` is DEFINED (not merely read). Covers the four shapes in this repo:
 *   jq / ECS     `{name:"APP_ENV", value:"production"}` and `{ "name": "APP_ENV", "value": … }`
 *   JSON map     `"APP_ENV": "production"`              (AgentCore `--environment-variables`)
 *   YAML/compose `      APP_ENV: ${APP_ENV:-local}`
 *   shell/docker `export APP_ENV=production` / `ENV APP_ENV=production`
 * Reads such as `"${APP_ENV:-}"` and prefixed names such as `NEXT_PUBLIC_APP_ENV` never match.
 */
function definitionLines(text: string, name: string, hashComments: boolean): number[] {
  const patterns = [
    new RegExp(`name"?\\s*:\\s*"${name}"`),
    new RegExp(`"${name}"\\s*:`),
    new RegExp(`^\\s+${name}\\s*:`),
    new RegExp(`^\\s*(?:export|ENV)\\s+${name}\\s*=`),
  ];
  const lines: number[] = [];
  text.split('\n').forEach((line, index) => {
    if (hashComments && /^\s*#/.test(line)) return;
    if (patterns.some((pattern) => pattern.test(line))) lines.push(index + 1);
  });
  return lines;
}

export type IdentityGap = {
  file: string;
  appEnvLines: number[];
  missing: string[];
};

function scanRuntimeDefinitions(root: string): { scanned: string[]; sites: number; gaps: IdentityGap[] } {
  const scanned: string[] = [];
  const gaps: IdentityGap[] = [];
  let sites = 0;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDir(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile() || !isScannedFile(entry.name)) continue;

      const text = readFileSync(full, 'utf8');
      const hashComments = usesHashComments(entry.name);
      const appEnvLines = definitionLines(text, 'APP_ENV', hashComments);
      if (appEnvLines.length === 0) continue;

      const file = relative(root, full).split(sep).join('/');
      scanned.push(file);
      sites += appEnvLines.length;

      // Count, not proximity: one env block per APP_ENV. A file with three container definitions
      // needs three of each sibling, which is exactly what "every definition carries it" means,
      // and it needs no magic line-distance constant.
      const missing = (['DEPLOY_ENVIRONMENT', 'GIT_SHA'] as const).filter((key) => (
        definitionLines(text, key, hashComments).length < appEnvLines.length
      ));
      if (missing.length > 0) gaps.push({ file, appEnvLines, missing });
    }
  };

  walk(root);
  scanned.sort();
  return { scanned, sites, gaps };
}

describe('deployment identity manifest (F1.5.1)', () => {
  const result = scanRuntimeDefinitions(REPO_ROOT);

  it('every runtime definition that sets APP_ENV also sets DEPLOY_ENVIRONMENT and GIT_SHA', () => {
    assert.deepEqual(
      result.gaps.map((gap) => `${gap.file}:${gap.appEnvLines.join(',')} missing ${gap.missing.join('+')}`),
      [],
      'a production process without the deployment identity cannot boot — add the siblings to the definition above',
    );
  });

  it('the scan actually reaches the known runtime paths', () => {
    // Guards against a silently-broken matcher reporting "no gaps" because it found nothing.
    for (const expected of [
      'infra/ai-gateway/agentcore-deploy.sh',
      'infra/ai-gateway/task-definition.template.json',
      'infra/docker/compose.local.yml',
      'infra/prod-ecs-express/deploy.sh',
      'infra/prod-ecs-express/run-release-task.sh',
    ]) {
      assert.ok(result.scanned.includes(expected), `${expected} was not scanned`);
    }
    assert.ok(result.sites >= 10, `expected at least 10 APP_ENV definitions, found ${result.sites}`);
  });

  it('reports a new runtime path that forgets the identity, and stays quiet when it carries it', () => {
    const root = mkdtempSync(join(tmpdir(), 'watchdog-identity-manifest-'));
    try {
      mkdirSync(join(root, 'infra/new-service'), { recursive: true });
      writeFileSync(
        join(root, 'infra/new-service/deploy.sh'),
        'jq -n \'{environment:[{name:"APP_ENV", value:"production"}]}\'\n',
      );
      const broken = scanRuntimeDefinitions(root);
      assert.deepEqual(broken.gaps, [{
        file: 'infra/new-service/deploy.sh',
        appEnvLines: [1],
        missing: ['DEPLOY_ENVIRONMENT', 'GIT_SHA'],
      }]);

      writeFileSync(
        join(root, 'infra/new-service/deploy.sh'),
        'jq -n \'{environment:[\n'
        + '  {name:"APP_ENV", value:"production"},\n'
        + '  {name:"DEPLOY_ENVIRONMENT", value:$deployEnvironment},\n'
        + '  {name:"GIT_SHA", value:$commit}\n'
        + ']}\'\n',
      );
      assert.deepEqual(scanRuntimeDefinitions(root).gaps, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not mistake a read, a comment, or NEXT_PUBLIC_APP_ENV for a definition', () => {
    const root = mkdtempSync(join(tmpdir(), 'watchdog-identity-manifest-'));
    try {
      mkdirSync(join(root, 'apps'), { recursive: true });
      writeFileSync(
        join(root, 'apps/start.sh'),
        '# its task definition also sets APP_ENV=production\n'
        + 'if [ "${APP_ENV:-}" = "local" ]; then exit 1; fi\n',
      );
      writeFileSync(
        join(root, 'apps/web.yml'),
        'services:\n  web:\n    environment:\n      NEXT_PUBLIC_APP_ENV: ${APP_ENV:-local}\n',
      );
      const result = scanRuntimeDefinitions(root);
      assert.deepEqual(result.scanned, []);
      assert.equal(result.sites, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
