#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { evaluateBudgets, kb } from './bundle-budget-core.mjs';

// PERF-BUDGET-ARCH-01 — redesenho do gate de performance para a arquitetura lazy real do app (Services
// SERV-UI-01/02/03 empurraram o total JS quase até o teto do budget único antigo, 3 vezes seguidas, mesmo
// sendo 100% código lazy/sob-demanda que nunca toca o boot). A partir de agora:
//
// 1. Initial boot é gate rígido (a árvore de `imports` estáticos do entry, via dist/public/.vite/manifest.json
//    — nunca `dynamicImports`, nunca regex de filename+hash).
// 2. Cada rota lazy tem budget explícito por nome lógico; sem budget explícito, cai no teto default — uma
//    rota nova gigante não passa só porque o total global ainda cabe.
// 3. Vendor chunks relevantes têm budget pelo mesmo motivo/mecanismo.
// 4. Total JS/gzip viram safety ceilings (detectam crescimento absurdo do artefato inteiro), não o gate
//    principal — não devem subir a cada ticket de feature legítima.
// 5. Nenhum budget deste arquivo deve subir automaticamente num ticket de feature — só depois de uma
//    auditoria real mostrando que não há economia segura (mesmo processo já usado nas rodadas anteriores,
//    documentado nos commits SERV-UI-01/02/03 no histórico deste arquivo).
//
// Lógica de avaliação pura em ./bundle-budget-core.mjs (testada isoladamente em
// script/performance-bundle-budget-tests.ts, sem precisar de um build real do Vite).

const root = process.cwd();
const distDir = path.join(root, 'dist', 'public');
const assetsDir = path.join(distDir, 'assets');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');

const config = {
  // PERF-BUDGET-ARCH-01 — medido em 2026-08-31, build limpo do commit ace0dab: 484827 bytes (recursão real
  // de `imports` a partir de index.html: index + vendor-react-core + vendor-misc + vendor-ui +
  // vendor-app-runtime + vendor-radix). Budget = baseline + ~1,5% (492000 bytes), a mesma ordem de grandeza
  // sugerida pelo ticket (baseline + no máximo ~2%) — margem pequena o bastante para pegar um import lazy
  // virando eager por acidente, folgada o bastante para não quebrar em nondeterminism de build.
  initialBoot: {
    baselineBytes: 484827,
    budgetBytes: 492000,
  },

  // PERF-BUDGET-ARCH-01 — budget = tamanho atual + margem pequena (rotas grandes ~8%, médias/pequenas
  // ~15-25%, arredondado). Nomes vêm de `entry.name` no manifest do Vite (o nome lógico do entry point,
  // nunca do filename com hash) — imune a coincidência de prefixo entre rotas (ex.: "service-agenda" vs
  // "service-agenda-helpers", que uma regex `/^service-agenda-.*\.js$/` teria confundido).
  routes: {
    'marketing': 236,
    'settings': 60,
    'add-product': 36,
    'public-catalog': 35,
    'reports': 29,
    'onboarding': 29,
    'service-work-detail': 29,
    'service-agenda': 20,
    'catalog': 16,
    'service-availability-settings': 15,
    'dashboard': 15,
  },
  // Nenhuma rota lazy nova passa "de graça" só porque o total global ainda cabe (ticket §6) — cobre
  // orders/billings/sell/subscribe/products/client-detail/admin/clients e qualquer rota futura ainda não
  // auditada individualmente. Maior rota hoje sem budget explícito: orders (30.01 kB) — folga confortável.
  defaultRouteBudgetKb: 40,

  // PERF-BUDGET-ARCH-01 — mesmo raciocínio dos budgets de rota, agora para os vendor chunks manuais de
  // vite.config.ts. Objetivo: capturar um novo pacote Radix, uma lib inteira importada sem tree-shaking,
  // ou uma dependência duplicada — sem exigir que ninguém audite manualmente todo build.
  vendor: {
    'vendor-recharts': 352,
    'vendor-firebase-firestore': 286,
    'vendor-react-core': 204,
    'vendor-misc': 198,
    'vendor-scanner': 163,
    'vendor-firebase-core': 91,
    'vendor-firebase-auth': 82,
    'vendor-firebase-observability': 60,
    'vendor-radix': 40,
    'vendor-ui': 36,
    'vendor-lucide': 35,
    'vendor-qrcode': 20,
  },
  defaultVendorBudgetKb: 40,

  // Budget individual só nos chunks compartilhados claramente críticos (reaproveitados entre várias rotas
  // lazy de Services/Catalog); os demais só aparecem no relatório quando crescem além do limiar de
  // visibilidade — evita dezenas de regras frágeis por arquivo pequeno (ticket §8).
  sharedChunks: {
    // PLAN-IMPL-05 — recalibrado 38 -> 39 kB (auditoria, autorizado explicitamente pelo usuário, mesmo
    // padrão de governança do PERF-GOV-CSS-01 para o CSS). Baseline pré-ticket: 37.96 kB. Depois das
    // adições desta ticket: 38.26 kB — 0.26 kB acima do teto antigo. Causa raiz confirmada:
    // PrivateRouter.tsx importa de shared/monetization.ts, e esta ticket precisou estender esse módulo
    // compartilhado com o novo tipo/lógica de AdsProPreparationQuotaSnapshot/buildPlanUsageSnapshot e as
    // duas strings de copy comercial exigidas pelo §37 ("3"/"100 novos produtos preparados
    // profissionalmente por mês") — nenhuma delas é código morto ou redundante. Nenhum outro budget
    // (TOTAL JS 2550 kB, CSS 178 kB, Marketing 236 kB, ou qualquer outro chunk) foi alterado.
    'PrivateRouter': 39,
    'CatalogShowcase': 29,
    'service-agenda-helpers': 28,
  },
  sharedChunkVisibilityThresholdKb: 8,

  // PERF-BUDGET-ARCH-01 — total JS deixa de ser o gate principal (era 2358 kB com só 0,38 kB de margem
  // real após SERV-UI-03, um teto insustentável para arquitetura lazy). Vira um safety ceiling: detecta
  // crescimento absurdo do artefato inteiro, não bloqueia cada rota lazy legítima (essa proteção já é feita
  // pelos budgets de rota/vendor acima). Baseline real: 2357.62 kB / 715.32 kB gzip. Teto escolhido dentro
  // da faixa sugerida pelo ticket (2500-2600 kB): 2550 kB dá ~192 kB (~8%) de headroom, espaço planejado
  // para os próximos blocos conhecidos (SERV-PUBLIC-01, polish final de Services, Ads Pro) sem precisar
  // reabrir este arquivo a cada ticket — sem ser um cheque em branco. Gzip proporcional à mesma margem.
  totalSafetyCeiling: {
    jsKb: 2550,
    gzipKb: 775,
  },

  maxSingleAssetKb: 500,

  forbiddenFrontendChunks: [
    { label: 'date-fns frontend vendor', match: (name) => name === 'vendor-date-fns' },
  ],
};

// CSS não passa pela mesma árvore lazy/vendor — continua um check simples e isolado (só o entry principal).
//
// PERF-GOV-CSS-01 — recalibração deliberada de 177 -> 178, não uma inflação automática de budget num
// ticket de feature (a mesma regra do topo do arquivo continua valendo para qualquer mudança FUTURA).
// Medido via git worktree isolado no commit anterior a PLAN-IMPL-04A (cebfa59): o baseline real já
// estava em ~176.96 kB (181209 bytes) — só ~41 bytes de folga existiam ANTES deste ticket sequer
// começar. PLAN-IMPL-04A (nova página de comparação de planos + paywalls contextuais) adicionou ~267
// bytes líquidos depois de uma auditoria real e limitada já ter removido as duas únicas classes
// genuinamente supérfluas encontradas (um `-top-3` e um `min-h-[60vh]` sem nenhum outro uso no app).
// Reduzir mais exigiria degradar a distinção visual do Pro ou o badge "Mais Popular" — recursos
// comerciais reais do ticket, não gordura. 178 kB restaura uma folga pequena e deliberada, não um teto
// solto.
const cssBudgets = [
  { label: 'main css', pattern: /^index-.*\.css$/, maxKb: 178 },
];

if (!fs.existsSync(assetsDir)) {
  console.error('dist/public/assets não encontrado. Rode npm run build antes de performance:bundle-check.');
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
  console.error('dist/public/.vite/manifest.json não encontrado. Confirme que vite.config.ts tem build.manifest=true e rode npm run build.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const allFiles = fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js') || name.endsWith('.css'));
const assetSizes = {};
for (const name of allFiles) {
  const raw = fs.readFileSync(path.join(assetsDir, name));
  assetSizes[`assets/${name}`] = { rawBytes: raw.length, gzipBytes: zlib.gzipSync(raw).length };
}

const errors = [];
for (const budget of cssBudgets) {
  const matches = allFiles.filter((name) => budget.pattern.test(name));
  if (matches.length === 0) {
    errors.push(`${budget.label}: asset não encontrado (${budget.pattern})`);
    continue;
  }
  for (const name of matches) {
    const rawKb = kb(assetSizes[`assets/${name}`].rawBytes);
    if (rawKb > budget.maxKb) errors.push(`${budget.label}: ${name} ${rawKb} kB > ${budget.maxKb} kB`);
  }
}

const result = evaluateBudgets({ manifest, assetSizes, config });
errors.push(...result.errors);

console.log('=== Bundle Performance ===');
console.log('');
console.log('TOTAL');
console.log(`  JS:   ${result.totalJsKb} / ${result.totalJsCeilingKb} kB`);
console.log(`  Gzip: ${result.totalGzipKb} / ${result.totalGzipCeilingKb} kB`);
console.log('');
console.log('INITIAL BOOT');
console.log(`  ${result.bootBytes} / ${result.bootBudgetBytes} bytes`);
console.log('');
console.log('VENDOR');
for (const v of result.vendors) {
  console.log(`  ${v.name}: ${v.rawKb} / ${v.budgetKb} kB gzip=${v.gzipKb} kB${v.budgetSource === 'default' ? ' (default budget)' : ''}${v.ok ? '' : '  FAIL'}`);
}
console.log('');
console.log('LAZY ROUTES');
for (const r of result.routes) {
  console.log(`  ${r.name}: ${r.rawKb} / ${r.budgetKb} kB gzip=${r.gzipKb} kB${r.budgetSource === 'default' ? ' (default budget)' : ''}${r.ok ? '' : '  FAIL'}`);
}
if (result.sharedChunks.length) {
  console.log('');
  console.log('SHARED CHUNKS');
  for (const s of result.sharedChunks) {
    const budgetLabel = s.budgetKb === null ? '(sem budget — só visibilidade)' : `/ ${s.budgetKb} kB`;
    console.log(`  ${s.name}: ${s.rawKb} kB ${budgetLabel} gzip=${s.gzipKb} kB${s.ok ? '' : '  FAIL'}`);
  }
}
console.log('');

if (errors.length) {
  console.error('Budget violations:');
  for (const error of errors) console.error(`- ${error}`);
  console.log('');
  console.log('RESULT: FAIL');
  process.exit(1);
}

console.log('RESULT: PASS');
