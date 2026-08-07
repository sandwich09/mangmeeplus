import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tokensPath = resolve(packageDir, 'tokens.json');
const webOutputPath = resolve(packageDir, 'generated/web/theme.css');
const checkOnly = process.argv.includes('--check');

const tokens = JSON.parse(await readFile(tokensPath, 'utf8'));

function cssVar(name, value) {
  return `  --${name}: ${value};`;
}

function px(value) {
  return `${value}px`;
}

function renderWebCss() {
  const lines = [
    '/* Generated from packages/design-tokens/tokens.json. */',
    '/* Do not edit by hand. */',
    '',
    ':root {',
    cssVar('font-family-sans', tokens.fontFamily.sans),
  ];

  for (const [key, value] of Object.entries(tokens.color)) {
    lines.push(cssVar(`color-${key}`, value));
  }

  for (const [key, value] of Object.entries(tokens.space)) {
    lines.push(cssVar(`space-${key}`, px(value)));
  }

  for (const [key, value] of Object.entries(tokens.radius)) {
    lines.push(cssVar(`radius-${key}`, px(value)));
  }

  for (const [key, value] of Object.entries(tokens.shadow)) {
    lines.push(cssVar(`shadow-${key}`, value));
  }
  lines.push(cssVar('z-index-modal', tokens.zIndex.modal));
  lines.push('}');

  return `${lines.join('\n')}\n`;
}

const outputs = [
  [webOutputPath, renderWebCss()],
];

if (checkOnly) {
  let failed = false;
  for (const [path, nextContent] of outputs) {
    const currentContent = await readFile(path, 'utf8');
    if (currentContent !== nextContent) {
      console.error(`Outdated generated token file: ${path}`);
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
} else {
  await Promise.all(outputs.map(([path, content]) => writeFile(path, content)));
}
