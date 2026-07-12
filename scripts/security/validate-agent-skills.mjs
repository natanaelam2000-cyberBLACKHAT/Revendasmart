#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skillsRoot = path.join(root, '.codex', 'skills');
const indexPath = path.join(skillsRoot, 'index.json');
const requiredFields = ['name','description','version','source','sourceCommit','license','riskLevel','defaultMode'];
const allowedCategories = new Set(['security', 'performance-engineering', 'ux', 'architecture', 'production-readiness']);
const errors = [];
const warnings = [];

function read(file) { return fs.readFileSync(file, 'utf8'); }
function parseFrontmatter(text, file) {
  if (!text.startsWith('---\n')) {
    errors.push(`${file}: missing YAML frontmatter`);
    return {};
  }
  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    errors.push(`${file}: unterminated YAML frontmatter`);
    return {};
  }
  const raw = text.slice(4, end);
  const data = {};
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      current = m[1];
      const value = m[2].trim();
      data[current] = value === '' ? [] : value.replace(/^['"]|['"]$/g, '');
      continue;
    }
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item && current) {
      if (!Array.isArray(data[current])) data[current] = data[current] ? [data[current]] : [];
      data[current].push(item[1].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return data;
}

if (!fs.existsSync(skillsRoot)) errors.push('missing .codex/skills directory');
if (!fs.existsSync(indexPath)) errors.push('missing .codex/skills/index.json');

const dirs = fs.existsSync(skillsRoot) ? fs.readdirSync(skillsRoot, {withFileTypes:true}).filter(d => d.isDirectory()).map(d => d.name).sort() : [];
const names = new Set();
for (const dir of dirs) {
  const file = path.join(skillsRoot, dir, 'SKILL.md');
  if (!fs.existsSync(file)) { errors.push(`${dir}: missing SKILL.md`); continue; }
  const text = read(file);
  const fm = parseFrontmatter(text, file);
  for (const field of requiredFields) if (!fm[field]) errors.push(`${dir}: missing frontmatter field ${field}`);
  if (fm.name !== dir) errors.push(`${dir}: frontmatter name must match folder name (${fm.name})`);
  if (names.has(fm.name)) errors.push(`${dir}: duplicate skill name ${fm.name}`);
  names.add(fm.name);
  const allowed = Array.isArray(fm.allowedEnvironments) ? fm.allowedEnvironments : [];
  const prohibited = Array.isArray(fm.prohibitedEnvironments) ? fm.prohibitedEnvironments : [];
  if (fm.category && !allowedCategories.has(fm.category)) errors.push(`${dir}: invalid category ${fm.category}`);
  if (!allowed.includes('local')) errors.push(`${dir}: allowedEnvironments must include local`);
  if (!prohibited.includes('production')) errors.push(`${dir}: prohibitedEnvironments must include production`);
  if (!text.includes('Não fazer commit')) errors.push(`${dir}: missing no-commit rule`);
  if (!text.includes('Não fazer deploy')) errors.push(`${dir}: missing no-deploy rule`);
  if (!text.includes('Não imprimir segredos')) errors.push(`${dir}: missing no-secret-printing rule`);
  if (!text.toLowerCase().includes('produção')) errors.push(`${dir}: missing production prohibition language`);
  const tags = Array.isArray(fm.tags) ? fm.tags : [];
  const isPerformanceSkill = fm.category === 'performance-engineering' || tags.includes('performance');
  if (isPerformanceSkill) {
    if (fm.category !== 'performance-engineering') errors.push(`${dir}: performance skill must use category performance-engineering`);
    if (!tags.includes('performance')) errors.push(`${dir}: performance skill must include performance tag`);
    if (!fm.tier) errors.push(`${dir}: performance skill must declare tier`);
    if (fm.defaultMode !== 'REVIEW_ONLY') errors.push(`${dir}: performance skill must default to REVIEW_ONLY`);
    for (const section of ['## Escopo Revenda Smart', '## Métricas recomendadas', '## Critérios de parada']) {
      if (!text.includes(section)) errors.push(`${dir}: performance skill missing section ${section}`);
    }
    if (!/(client\/|server\/|package\.json|vite\.config\.ts|docs\/|scripts\/|firestore\.rules|storage\.rules|\.codex\/skills\/)/.test(text)) {
      errors.push(`${dir}: performance skill must reference real project files or directories`);
    }
    if (!/(budget|budgets|Bundle|chunk|Core Web Vitals|reads|latência|p95|p99)/i.test(text)) {
      errors.push(`${dir}: performance skill must define measurable budgets or metrics`);
    }
  }
  const offensiveName = /(exploit|intercept|penetration|bypass|ssrf|race|webhook|bola|idor|rate-limiting|deeplink)/i.test(dir);
  if (offensiveName && fm.defaultMode !== 'REVIEW_ONLY') errors.push(`${dir}: offensive/hybrid skill must default to REVIEW_ONLY`);
  if (/APP_USR-|-----BEGIN PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-/i.test(text)) errors.push(`${dir}: possible hardcoded secret`);
  if (/\brm\s+-rf\s+\/|git\s+push\s+--force|terraform\s+destroy/i.test(text)) errors.push(`${dir}: destructive command pattern`);
  if (/curl\s+[^\n]*\|\s*(bash|sh)|wget\s+[^\n]*\|\s*(bash|sh)|base64\s+-d\s*\|\s*(bash|sh)/i.test(text)) errors.push(`${dir}: suspicious remote execution pattern`);
  if (text.length > 18000) warnings.push(`${dir}: large SKILL.md (${text.length} bytes)`);
}

if (fs.existsSync(indexPath)) {
  try {
    const index = JSON.parse(read(indexPath));
    const indexed = (index.skills || []).map(s => s.name).sort();
    const actual = [...names].sort();
    if (JSON.stringify(indexed) !== JSON.stringify(actual)) errors.push('index.json is not synchronized with skill directories');
    const indexCategories = Array.isArray(index.categories) ? index.categories : [];
    for (const category of indexCategories) if (!allowedCategories.has(category)) errors.push(`index.json invalid category ${category}`);
    for (const entry of index.skills || []) {
      for (const field of ['category', 'tier', 'tags', 'riskLevel', 'defaultMode', 'source']) {
        if (entry[field] === undefined) errors.push(`index.json skill ${entry.name || '<unknown>'} missing ${field}`);
      }
      if (entry.category && !allowedCategories.has(entry.category)) errors.push(`index.json skill ${entry.name} invalid category ${entry.category}`);
      if (entry.tags && !Array.isArray(entry.tags)) errors.push(`index.json skill ${entry.name} tags must be an array`);
    }
    if (index.runtimeImpact !== 'none') errors.push('index.json runtimeImpact must be none');
    if (index.productionTestsAllowed !== false) errors.push('index.json productionTestsAllowed must be false');
  } catch (err) {
    errors.push(`invalid index.json: ${err.message}`);
  }
}

console.log(`Agent skills validated: ${names.size}`);
if (warnings.length) {
  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 20)) console.log(`WARN ${warning}`);
}
if (errors.length) {
  console.error(`Errors: ${errors.length}`);
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}
console.log('OK');
