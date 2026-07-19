#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const assetsDir = path.join(root, 'dist', 'public', 'assets');

const budgets = [
  { label: 'main css', pattern: /^index-.*\.css$/, maxKb: 175 },
  { label: 'entry js', pattern: /^index-.*\.js$/, maxKb: 35 },
  { label: 'dashboard route', pattern: /^dashboard-.*\.js$/, maxKb: 55 },
  { label: 'onboarding route', pattern: /^onboarding-.*\.js$/, maxKb: 25 },
  { label: 'add-product route', pattern: /^add-product-.*\.js$/, maxKb: 35 },
  { label: 'public catalog route', pattern: /^public-catalog-.*\.js$/, maxKb: 30 },
  { label: 'reports route', pattern: /^reports-.*\.js$/, maxKb: 35 },
  { label: 'settings route', pattern: /^settings-.*\.js$/, maxKb: 50 },
  { label: 'store intelligence panel', pattern: /^StoreIntelligencePanel-.*\.js$/, maxKb: 18, optional: true },
  { label: 'scanner vendor', pattern: /^vendor-scanner-.*\.js$/, maxKb: 430 },
  { label: 'recharts vendor', pattern: /^vendor-recharts-.*\.js$/, maxKb: 350 },
];

const totalBudgets = {
  jsKb: 2265,
  jsGzipKb: 700,
};

const maxSingleAssetKb = 500;

const forbiddenFrontendChunks = [
  { label: 'date-fns frontend vendor', pattern: /^vendor-date-fns-.*\.js$/ },
];

function kb(bytes) {
  return Math.round((bytes / 1024) * 100) / 100;
}

if (!fs.existsSync(assetsDir)) {
  console.error('dist/public/assets não encontrado. Rode npm run build antes de performance:bundle-check.');
  process.exit(1);
}

const files = fs.readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
  .map((name) => {
    const file = path.join(assetsDir, name);
    const raw = fs.readFileSync(file);
    return {
      name,
      sizeKb: kb(raw.length),
      gzipKb: kb(zlib.gzipSync(raw).length),
      type: path.extname(name).slice(1),
    };
  });

const errors = [];
for (const forbidden of forbiddenFrontendChunks) {
  const matches = files.filter((file) => forbidden.pattern.test(file.name));
  for (const file of matches) {
    errors.push(`${forbidden.label}: ${file.name} não deve voltar ao bundle do frontend`);
  }
}

for (const budget of budgets) {
  const matches = files.filter((file) => budget.pattern.test(file.name));
  if (matches.length === 0) {
    if (budget.optional) continue;
    errors.push(`${budget.label}: asset não encontrado (${budget.pattern})`);
    continue;
  }
  for (const file of matches) {
    if (file.sizeKb > budget.maxKb) {
      errors.push(`${budget.label}: ${file.name} ${file.sizeKb} kB > ${budget.maxKb} kB`);
    }
  }
}

for (const file of files) {
  if (file.sizeKb > maxSingleAssetKb) {
    errors.push(`${file.name}: ${file.sizeKb} kB > ${maxSingleAssetKb} kB por asset individual`);
  }
}

const jsFiles = files.filter((file) => file.type === 'js');
const totalJsKb = kb(jsFiles.reduce((sum, file) => sum + file.sizeKb * 1024, 0));
const totalJsGzipKb = kb(jsFiles.reduce((sum, file) => sum + file.gzipKb * 1024, 0));
if (totalJsKb > totalBudgets.jsKb) errors.push(`total JS: ${totalJsKb} kB > ${totalBudgets.jsKb} kB`);
if (totalJsGzipKb > totalBudgets.jsGzipKb) errors.push(`total JS gzip: ${totalJsGzipKb} kB > ${totalBudgets.jsGzipKb} kB`);

console.log('Performance bundle budget check');
console.log(`Assets analisados: ${files.length}`);
console.log(`Total JS: ${totalJsKb} kB`);
console.log(`Total JS gzip: ${totalJsGzipKb} kB`);
for (const file of files.sort((a, b) => b.sizeKb - a.sizeKb).slice(0, 12)) {
  console.log(`${file.name}: ${file.sizeKb} kB gzip=${file.gzipKb} kB`);
}

if (errors.length) {
  console.error('Budget violations:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('OK');
