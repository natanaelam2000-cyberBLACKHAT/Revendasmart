import fs from 'node:fs';
const root = '.tmp/security';
const target = `${root}/artifacts`;
fs.mkdirSync(target, { recursive: true });
for (const file of ['sca-delta.json', 'osv-base.json', 'osv-head.json', 'trivy.json', 'sbom.cdx.json', 'final-results.json']) {
  if (fs.existsSync(`${root}/${file}`)) fs.copyFileSync(`${root}/${file}`, `${target}/${file}`);
}
for (const scope of ['history', 'working-tree']) {
  const file = `${root}/gitleaks-${scope}.json`;
  if (!fs.existsSync(file)) continue;
  const findings = JSON.parse(fs.readFileSync(file)).map(({ RuleID, File, StartLine, Commit, Fingerprint }) => ({ RuleID, File, StartLine, Commit, Fingerprint, validity: 'UNKNOWN' }));
  fs.writeFileSync(`${target}/gitleaks-${scope}.json`, JSON.stringify(findings, null, 2));
}
if (fs.existsSync(`${root}/semgrep.json`)) {
  let report;
  try { report = JSON.parse(fs.readFileSync(`${root}/semgrep.json`)); }
  catch { report = { results: [], errors: [{ type: 'InvalidScannerReport' }] }; }
  const findings = (report.results ?? []).map(({ check_id, path, start, extra }) => ({ rule: check_id, path, line: start.line, severity: extra.severity, confidence: extra.metadata?.confidence }));
  fs.writeFileSync(`${target}/semgrep.json`, JSON.stringify({ status: (report.errors ?? []).length ? 'BLOCKED' : 'COMPLETE', findings, errors: (report.errors ?? []).map(error => ({ type: error.type, code: error.code })) }, null, 2));
}
