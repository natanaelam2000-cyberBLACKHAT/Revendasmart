import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { osvFindings, compareFindings } from './sca-policy.mjs';
const directory = '.tmp/security';
fs.mkdirSync(directory, { recursive: true });
const base = process.env.SECURITY_BASE_SHA || '60f6226596d1156785b3a39b62a16580d4beb229';
if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('SECURITY_BASE_SHA must be a full immutable commit SHA');
const lock = spawnSync('git', ['show', `${base}:package-lock.json`], { encoding: 'utf8' });
if (lock.status !== 0) throw new Error('Base lockfile unavailable; fetch the base history');
fs.mkdirSync(`${directory}/base`, { recursive: true });
fs.writeFileSync(`${directory}/base/package-lock.json`, lock.stdout);
for (const [name, file] of [['base', `${directory}/base/package-lock.json`], ['head', 'package-lock.json']]) {
  const result = spawnSync('osv-scanner', ['scan', 'source', '-L', file, '--format', 'json', '--output-file', `${directory}/osv-${name}.json`], { stdio: 'inherit' });
  if (result.error || ![0, 1].includes(result.status)) throw new Error(`OSV ${name} failed (${result.status})`);
}
const read = name => osvFindings(JSON.parse(fs.readFileSync(`${directory}/osv-${name}.json`)));
const delta = compareFindings(read('head'), read('base'));
fs.writeFileSync(`${directory}/sca-delta.json`, JSON.stringify({ base, ...delta }, null, 2));
console.log(`New critical=${delta.critical.length}; high=${delta.high.length}; unknown=${delta.unknown.length}; preexisting=${delta.preexisting.length}`);
process.exitCode = delta.critical.length || delta.unknown.length ? 1 : 0;
