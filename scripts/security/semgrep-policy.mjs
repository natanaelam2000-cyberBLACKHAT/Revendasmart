import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync(process.argv[2] ?? '.tmp/security/semgrep.json'));
if (!Array.isArray(report.results)) throw new Error('Invalid Semgrep report');
const blockers = report.results.filter(result => result.extra?.severity === 'ERROR' && result.extra?.metadata?.confidence === 'HIGH');
for (const finding of blockers) console.log(`${finding.check_id}: ${finding.path}:${finding.start.line}`);
console.log(`Semgrep findings=${report.results.length}; blockers=${blockers.length}; scanner errors=${(report.errors ?? []).length}`);
process.exitCode = blockers.length || (report.errors ?? []).length ? 1 : 0;
