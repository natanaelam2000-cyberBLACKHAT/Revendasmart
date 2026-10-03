import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve('dist/public');
const server = createServer((req, res) => {
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
  const context = await browser.newContext();
  await context.addInitScript(() => { window.androidBridge = {postMessage() {}}; });
  const page = await context.newPage();
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(`http://127.0.0.1:`)) return route.abort();
    return route.continue();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + '/login');
  await page.getByTestId('launch-intro').waitFor({state:'visible'});
  assert.equal(await page.locator('.rs-launch-brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.waitForTimeout(5200);
  assert.equal(await page.getByTestId('launch-intro').count(), 0);
  await page.reload();
  assert.equal(await page.getByTestId('launch-intro').count(), 0);
  await context.close();
  const failed = await browser.newContext();
  await failed.addInitScript(() => { window.androidBridge = {postMessage() {}}; });
  const failurePage = await failed.newPage();
  await failurePage.route('**/logo-revenda-smart-symbol-official.png', route => route.abort());
  await failurePage.goto(base + '/login');
  await failurePage.waitForTimeout(1000);
  assert.equal(await failurePage.getByTestId('launch-intro').count(), 0);
  await failed.close();
  console.log('PASS motion: real boot connection, local/offline asset, five-second exit, no reload replay, image-failure fallback.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
