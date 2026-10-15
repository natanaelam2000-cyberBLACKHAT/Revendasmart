import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
fs.mkdirSync('.tmp/security', { recursive: true });
const steps = ['skills:validate', 'check', 'lint', 'test', 'test:security:final', 'security:gitleaks', 'security:sca'];
const results = {};
for (const script of steps) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', script], { stdio: 'inherit' });
  results[script] = result.status === 0 ? 'PASS' : 'FAIL';
}
fs.writeFileSync('.tmp/security/final-results.json', JSON.stringify(results, null, 2));
process.exitCode = Object.values(results).includes('FAIL') ? 1 : 0;
