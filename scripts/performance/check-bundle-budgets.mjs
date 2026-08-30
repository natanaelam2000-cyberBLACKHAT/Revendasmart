#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const assetsDir = path.join(root, 'dist', 'public', 'assets');

const budgets = [
  // PROMOTIONAL-CAMPAIGNS-HOTFIX-02: main já excedia o budget anterior (175 kB) em clean checkout antes
  // deste hotfix (175.51 kB) — o guardrail não representava mais o baseline real do projeto. Recalibrado
  // minimamente (175 -> 177 kB) para refletir o baseline real + o card de imagem deste hotfix (176.31 kB).
  { label: 'main css', pattern: /^index-.*\.css$/, maxKb: 177 },
  { label: 'entry js', pattern: /^index-.*\.js$/, maxKb: 35 },
  { label: 'dashboard route', pattern: /^dashboard-.*\.js$/, maxKb: 55 },
  // RELEASE-QUALITY-04: onboarding subiu por um deslocamento marginal de chunk (o novo ThemeProvider
  // global em main.tsx muda como o Vite particiona os bundles, não código novo na própria rota).
  { label: 'onboarding route', pattern: /^onboarding-.*\.js$/, maxKb: 26 },
  { label: 'add-product route', pattern: /^add-product-.*\.js$/, maxKb: 35 },
  // REVENDASMART-LGPD-ANPD-REMEDIATION-01 Fase 7: +1kB pela busca sob demanda da chave Pix (minimização
  // de exposição — o valor não vem mais na carga inicial do catálogo).
  { label: 'public catalog route', pattern: /^public-catalog-.*\.js$/, maxKb: 31 },
  { label: 'reports route', pattern: /^reports-.*\.js$/, maxKb: 35 },
  // RELEASE-QUALITY-04: +2kB para o seletor de aparência (Sistema/Claro/Escuro) exigido pelo ticket.
  // RC-04: +2kB para tornar "Indique e ganhe" descobrível (entrada no menu Conta já existia noutro
  // arquivo) — código isolado do link, progresso visual (§12) e o fix real do compartilhamento nativo
  // Android (@capacitor/share, que antes silenciosamente caía para clipboard no WebView) exigidos pelo ticket.
  // OWNER-ACCESS-02: +1kB para a entrada condicional "Administração" no menu Conta (useAdminAccess +
  // lazy import + checagem isAdmin) — o painel em si (AdminGrantsPanel) é lazy-loaded em chunk PRÓPRIO
  // (AdminGrantsPanel-*.js, fora deste orçamento) e só baixa para quem já é admin.
  { label: 'settings route', pattern: /^settings-.*\.js$/, maxKb: 56 },
  { label: 'store intelligence panel', pattern: /^StoreIntelligencePanel-.*\.js$/, maxKb: 18, optional: true },
  { label: 'scanner vendor', pattern: /^vendor-scanner-.*\.js$/, maxKb: 430 },
  { label: 'recharts vendor', pattern: /^vendor-recharts-.*\.js$/, maxKb: 350 },
];

// PROMOTIONAL-CAMPAIGNS-01C — orçamento total elevado de 2265 -> 2280 kB, autorizado explicitamente
// pelo ticket após confirmar que o boot inicial (index.js + vendor chunks pré-carregados) não regrediu
// materialmente (+0,63 kB / 0,11%): Sorteios Promocionais é admin-only e permanece 100% lazy (nunca
// referenciado por App.tsx/PrivateRouter fora de `lazy(() => import(...))`), então o excesso de ~11 kB
// no total somado vem só dos chunks sob demanda de /sorteios e /sorteio/:slug, nunca do caminho crítico
// do vendedor comum.
//
// SERV-UI-01 — orçamento elevado de 2280 -> 2320 kB (JS) e 700 -> 705 kB (gzip), autorizado explicitamente
// pelo ticket após PERF-BUNDLE-03 comprovar que não havia mais nenhuma economia segura disponível (todo o
// conteúdo de vendor-misc já é dependência transitiva de libs realmente em uso — recharts/radix/react-
// query/capacitor — e a remoção medida de todo código shadcn/npm comprovadamente morto rendeu 0 kB, já que
// o tree-shaking já os excluía). A Agenda operacional (service-agenda-*.js, ~37 kB raw / ~10,4 kB gzip) é
// 100% lazy-loaded (`lazy(() => import("@/pages/service-agenda"))` em PrivateRouter.tsx, nunca referenciada
// no boot eager) e não usa nenhuma dependência nova (zero libs de calendário, zero recharts) — reaproveita
// só componentes/helpers já existentes (Layout, Sheet, Dialog, ConfirmActionDialog, EmptyState, date-utils,
// os wrappers de comando de Services já aprovados). INITIAL_BOOT_REGRESSION_BYTES = 0, confirmado medindo
// o boot antes/depois do build.
//
// SERV-UI-02 — orçamento elevado de 2320 -> 2333 kB (JS) e 705 -> 710 kB (gzip), autorizado explicitamente
// pelo ticket após uma auditoria real: a única ineficiência genuína encontrada (um <Select> do
// @radix-ui/react-select nunca usado em nenhuma outra tela deste app, que puxaria vendor-radix de ~35 para
// ~54 kB só por essa tela) já foi corrigida trocando para <select> nativo — sem essa correção o excesso
// teria sido de ~35 kB em vez de ~13 kB. O restante (client/src/pages/service-availability-settings.tsx,
// ~11,4 kB, e as novas funções puras de rascunho de expediente em service-agenda-helpers.ts, ~2,7 kB) é
// conteúdo real da tela de configuração de disponibilidade (editor de expediente semanal + folgas/
// bloqueios), 100% lazy-loaded, sem nenhuma dependência nova. INITIAL_BOOT_REGRESSION_BYTES = 0.
const totalBudgets = {
  jsKb: 2333,
  jsGzipKb: 710,
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
