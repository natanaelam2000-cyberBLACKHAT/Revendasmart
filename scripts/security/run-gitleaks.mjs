import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const directory = '.tmp/security';
fs.mkdirSync(directory, { recursive: true });
const snapshot = fs.mkdtempSync(path.join(directory, 'gitleaks-tree-'));
const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
if (files.status !== 0) throw new Error('Cannot enumerate the working tree');
for (const file of new Set(files.stdout.split('\0').filter(Boolean))) {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
  const destination = path.resolve(snapshot, file);
  if (!destination.startsWith(path.resolve(snapshot) + path.sep)) throw new Error('Unsafe file path');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}
let failed = false;
for (const [scope, args] of [['history', ['git', '--log-opts=--all', '.']], ['working-tree', ['dir', snapshot]]]) {
  const result = spawnSync('gitleaks', [...args, '--config', path.resolve('.gitleaks.toml'), '--redact=100', '--no-banner', '--report-format=json', `--report-path=${directory}/gitleaks-${scope}.json`], { stdio: 'inherit' });
  if (result.error) console.error(`Gitleaks ${scope} unavailable: install the verified binary with npm run security:tools`);
  failed ||= result.status !== 0;
}
fs.rmSync(snapshot, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
