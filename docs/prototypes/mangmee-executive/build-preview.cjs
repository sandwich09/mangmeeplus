const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '../../..');
const req = createRequire(path.join(repo, 'package.json'));
const webReq = createRequire(path.join(repo, 'apps/web/package.json'));
const esbuild = req(require.resolve('esbuild', { paths: [req.resolve('tsx')] }));
const postcss = webReq('postcss');
const tailwind = webReq('@tailwindcss/postcss');
(async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'executive-preview.tsx')], bundle: true, write: false,
    format: 'iife', platform: 'browser', minify: true, jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: [path.join(repo,'apps/web/node_modules'), path.join(repo,'node_modules')],
    alias: {
      '@/common/i18n/use-locale': path.join(__dirname,'preview-locale.ts'),
      '@/common/i18n/workspace-i18n.logic': path.join(__dirname,'preview-locale.ts'),
      '@/common/i18n/locale-context': path.join(__dirname,'preview-locale.ts'),
      '@/common': path.join(repo,'apps/web/src/common'),
      '@watchdog-bms/contracts/external-signup': path.join(repo,'packages/contracts/src/external-signup.ts'),
    },
  });
  let css = fs.readFileSync(path.join(repo,'apps/web/app/globals.css'),'utf8');
  css = css.replace("@source '../app';", `@source "${__dirname}/executive-preview.tsx";`)
    .replace("@source '../src';",'@source "../src/common/components";')
    .replace('@import "../src/common/legal/legal.css";','')
    .replace('@import "../src/common/styles/fonts.css";','');
  const compiled = await postcss([tailwind({ optimize: true })]).process(css,{from:path.join(repo,'apps/web/app/globals.css')});
  const fontCss=fs.readFileSync(path.join(repo,'apps/web/src/common/styles/fonts.css'),'utf8');
  const fonts=[...fontCss.matchAll(/@font-face\s*\{[^}]+\}/g)].map(x=>x[0]).filter(x=>!x.includes('Sarabun')).map(x=>x.replace(/url\('\/fonts\/([^']+)'\)/,(_,name)=>`url('data:font/woff2;base64,${fs.readFileSync(path.join(repo,'apps/web/public/fonts',name)).toString('base64')}')`)).join('\n');
  const layout=fs.readFileSync(path.join(__dirname,'executive-preview.css'),'utf8');
  const fragment=['<div id="mm-executive"></div>','<style>',fonts,compiled.css,layout,'</style>','<script>',result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'),'</script>'].join('\n');
  if(Buffer.byteLength(fragment)>1000000)throw Error(`Fragment too large: ${Buffer.byteLength(fragment)}`);
  fs.writeFileSync(path.join(__dirname,'mangmee-executive.html'),fragment);
  // Preserve the same fictional view state that the conversation host supplies.
  const stateBoot = `<script>(()=>{const key='codex:visualization-widget-state-v2:'+JSON.stringify([parent.location.pathname,parent.location.search]);let state={};try{state=JSON.parse(parent.localStorage.getItem(key)||'{}');}catch{}window.openai={widgetState:state,setWidgetState:async(value)=>{window.openai.widgetState=value;try{parent.localStorage.setItem(key,JSON.stringify(value));}catch{}}};})();</script>`;
  const document = `<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">${stateBoot}${fragment}</body></html>`;
  const srcdoc = document.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  fs.writeFileSync(path.join(__dirname,'mangmee-executive-preview.html'), `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ตัวอย่างหน้าผู้บริหารมั่งมี</title></head>
<body style="margin:0"><iframe title="ตัวอย่างหน้าผู้บริหารมั่งมี" style="display:block;width:100%;border:0" srcdoc="${srcdoc}"></iframe>
<script>const frame=document.querySelector('iframe');frame.addEventListener('load',()=>{const resize=()=>frame.style.height=frame.contentDocument.body.scrollHeight+'px';new ResizeObserver(resize).observe(frame.contentDocument.body);resize();});</script></body></html>`);
  console.log(`Built ${Buffer.byteLength(fragment)} bytes from actual shared components, tokens and fonts.`);
})().catch(error=>{console.error(error);process.exit(1);});
