// Run inside the exact candidate image with --network none. Input/output never include secret values.
import fs from 'node:fs';
import crypto from 'node:crypto';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const modulePath = input.service === 'api-web'
  ? '/app/api-runtime/packages/config/dist/index.js' : '/app/packages/config/dist/index.js';
const schemas = await import(modulePath);
const name = { 'api-web': 'apiConfigSchema', 'ai-gateway': 'aiGatewayConfigSchema', workers: 'workersConfigSchema' }[input.service];
if (!name) throw new Error('Unknown service');
const errors = [];
if (input.environment.APP_ENV !== 'production') errors.push('APP_ENV must be production for this verification');
if (!['uat', 'production'].includes(input.environment.DEPLOY_ENVIRONMENT)) errors.push('Invalid deployment environment');
if (!/^[0-9a-f]{40}$/.test(input.sourceCommit) || input.environment.GIT_SHA !== input.sourceCommit) errors.push('Source mismatch');
const schema = schemas[name];
const parsed = schema.safeParse(input.environment);
if (!parsed.success) errors.push(...parsed.error.issues.map(issue => 'Invalid config key: ' + issue.path.join('.')));
else {
  try { schemas.validateProductionConfig(parsed.data); }
  catch (error) { errors.push(...error.message.split('\n').filter(x => x.startsWith('  - ')).map(x => x.slice(4))); }
}
// A refined schema (.superRefine) wraps the object: parse with the refined one, list keys from the object inside.
let objectSchema = schema;
while (!objectSchema.shape && objectSchema._def?.schema) objectSchema = objectSchema._def.schema;
const keys = Object.keys(objectSchema.shape).sort();
const configured = Object.keys(input.environment).sort();
console.log(JSON.stringify({
  service: input.service, sourceCommit: input.sourceCommit, schema: name,
  configModuleSha256: crypto.createHash('sha256').update(fs.readFileSync(modulePath)).digest('hex'),
  configuredKeys: configured, schemaKeys: keys,
  defaultedKeys: parsed.success ? Object.keys(parsed.data).filter(k => !(k in input.environment)).sort() : [],
  absentOptionalKeys: parsed.success ? keys.filter(k => !(k in parsed.data)) : [],
  keysOutsideSchema: configured.filter(k => !keys.includes(k)),
  passed: errors.length === 0, errors,
}));
process.exitCode = errors.length ? 1 : 0;
