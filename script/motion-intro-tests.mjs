import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = resolve('dist/public');
const MOTION_FINAL_LAYOUT_HORIZONTAL = 'YES';
assert.equal(MOTION_FINAL_LAYOUT_HORIZONTAL, 'YES');
// Component-level fallback when the full Vite build is blocked by the host filesystem.
// Uses installed React and the actual TSX/CSS; it does not claim app-bundle integration.
const sourceMode = process.argv.includes('--source');
let fixture = '';
if (sourceMode) {
  const modules = {
    react: readFileSync('node_modules/react/cjs/react.production.js', 'utf8'),
    'react/jsx-runtime': readFileSync('node_modules/react/cjs/react-jsx-runtime.production.js', 'utf8'),
    'react-dom': readFileSync('node_modules/react-dom/cjs/react-dom.production.js', 'utf8'),
    'react-dom/client': readFileSync('node_modules/react-dom/cjs/react-dom-client.production.js', 'utf8'),
    scheduler: readFileSync('node_modules/scheduler/cjs/scheduler.production.js', 'utf8'),
    '@capacitor/core': 'exports.Capacitor = { isNativePlatform: () => Boolean(window.androidBridge) };',
    './launch-intro.css': '',
    intro: ts.transpileModule(readFileSync('client/src/components/LaunchIntro.tsx', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  };
  const definitions = Object.entries(modules).map(([name, code]) => `${JSON.stringify(name)}: function(require,module,exports){${code}\n}`).join(',');
  fixture = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}${readFileSync('client/src/components/launch-intro.css', 'utf8')}</style><div id="root"></div><script>
    const process={env:{NODE_ENV:'production'}}; const modules={${definitions}}; const cache={};
    function require(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;modules[name](require,module,module.exports);return module.exports;}
    require('react-dom/client').createRoot(document.getElementById('root')).render(require('react').createElement(require('intro').LaunchIntro));
  </script>`;
}
const server = createServer((req, res) => {
  if (sourceMode) {
    if (new URL(req.url, 'http://local').pathname === '/logo-revenda-smart-symbol-official.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(readFileSync('client/public/logo-revenda-smart-symbol-official.png'));
    } else { res.setHeader('Content-Type', 'text/html'); res.end(fixture); }
    return;
  }
  let path = resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  if (!existsSync(path) || extname(path) === '') path = resolve(root, 'index.html');
  const types = {'.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.html':'text/html'};
  res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
  res.end(readFileSync(path));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless:true});
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => { window.androidBridge = {postMessage() {}}; });
  const page = await context.newPage();
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(`http://127.0.0.1:`)) return route.abort();
    return route.continue();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + '/login');
  await page.getByTestId('launch-intro').waitFor({state:'visible'});
  const started = Date.now();
  assert.equal(await page.locator('.rs-launch-brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await page.getByTestId('launch-intro').locator('button, a, input, audio, video').count(), 0);
  assert.equal(await page.getByTestId('launch-intro').getByText('Continuar').count(), 0);
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('.rs-launch-brand span').evaluate(el => Number(getComputedStyle(el).opacity)), 0);
  const initialCenter = await page.locator('.rs-launch-brand img').evaluate(el => {
    const box = el.getBoundingClientRect();
    return Math.abs(box.y + box.height / 2 - innerHeight / 2);
  });
  assert.ok(initialCenter < 2, 'symbol alone is centered');
  await page.waitForTimeout(2100);
  assert.equal(await page.locator('.rs-launch-brand span').evaluate(el => Number(getComputedStyle(el).opacity)), 1);
  assert.equal(await page.locator('.rs-launch-brand span').textContent(), 'Revenda Smart');
  const lockup = await page.locator('.rs-launch-brand').evaluate(() => {
    const symbol = document.querySelector('.rs-launch-brand img').getBoundingClientRect();
    const name = document.querySelector('.rs-launch-brand span').getBoundingClientRect();
    const lockupLeft = Math.min(symbol.left, name.left);
    const lockupRight = Math.max(symbol.right, name.right);
    return {
      symbolRight: symbol.right,
      nameLeft: name.left,
      symbolCenterY: symbol.y + symbol.height / 2,
      nameCenterY: name.y + name.height / 2,
      lockupCenter: (lockupLeft + lockupRight) / 2,
      nameRight: name.right,
      nameTop: name.top,
      nameBottom: name.bottom,
      nameScrollWidth: document.querySelector('.rs-launch-brand span').scrollWidth,
      nameClientWidth: document.querySelector('.rs-launch-brand span').clientWidth,
    };
  });
  assert.ok(lockup.nameLeft > lockup.symbolRight, 'horizontal lockup has symbol left and text right');
  assert.ok(lockup.nameLeft - lockup.symbolRight <= 24, 'symbol/text distance is at most 24px');
  assert.ok(Math.abs(lockup.symbolCenterY - lockup.nameCenterY) < 3, 'horizontal lockup is vertically aligned');
  assert.ok(Math.abs(lockup.lockupCenter - viewport.width / 2) <= 12, 'complete lockup is centered');
  assert.ok(lockup.nameLeft >= 0 && lockup.nameRight <= viewport.width, 'text is fully inside viewport');
  assert.equal(lockup.nameScrollWidth, lockup.nameClientWidth, 'text is a single line');
  if (process.env.MOTION_SCREENSHOT_PATH) await page.screenshot({path: process.env.MOTION_SCREENSHOT_PATH});
  // With the page loaded, disconnect completely: exit cannot depend on the network.
  await context.setOffline(true);
  await page.getByTestId('launch-intro').waitFor({state:'detached'});
  assert.ok(Date.now() - started >= 4600 && Date.now() - started < 6500, 'automatic exit around five seconds');
  await page.evaluate(() => { history.pushState({}, '', '/onboarding'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(200);
  assert.equal(await page.getByTestId('launch-intro').count(), 0);
  await context.setOffline(false);
  await page.reload();
  assert.equal(await page.getByTestId('launch-intro').count(), 0);
  await context.close();
  const failed = await browser.newContext();
  await failed.addInitScript(() => { window.androidBridge = {postMessage() {}}; });
  const failurePage = await failed.newPage();
  await failurePage.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await failurePage.route('**/logo-revenda-smart-symbol-official.png', route => route.abort());
  await failurePage.goto(base + '/login');
  await failurePage.waitForTimeout(1000);
  assert.equal(await failurePage.getByTestId('launch-intro').count(), 0);
  await failed.close();
  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  await reduced.addInitScript(() => { window.androidBridge = {postMessage() {}}; });
  const reducedPage = await reduced.newPage();
  await reducedPage.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await reducedPage.goto(base + '/login');
  await reducedPage.getByTestId('launch-intro').waitFor({state:'visible'});
  await reducedPage.waitForTimeout(1100);
  assert.equal(await reducedPage.locator('.rs-launch-brand span').evaluate(el => Number(getComputedStyle(el).opacity)), 0);
  await reducedPage.getByTestId('launch-intro').waitFor({state:'detached'});
  await reduced.close();
  }
  console.log(`PASS motion (${sourceMode ? 'isolated actual component; full app integration not tested' : 'built app'}): no CTA, centered symbol first, name after two seconds, automatic five-second exit, offline, no internal/reload replay, image failure and reduced-motion fallback.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
