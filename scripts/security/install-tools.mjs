import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const versions = JSON.parse(fs.readFileSync(new URL('./tool-versions.json', import.meta.url)));
if (process.arch !== 'x64') throw new Error('Only verified x64 assets are configured');
const target = path.resolve(process.argv[2] ?? '.tmp/security-tools');
fs.mkdirSync(target, { recursive: true });
for (const [name, tool] of Object.entries(versions)) {
  const asset = tool.assets[process.platform];
  if (!asset) throw new Error(`Unsupported platform: ${process.platform}`);
  const response = await fetch(`https://github.com/${tool.repository}/releases/download/v${tool.version}/${asset.name}`);
  if (!response.ok) throw new Error(`Download failed for ${name}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Checksum mismatch: ${name}`);
  const archive = path.join(target, asset.name);
  fs.writeFileSync(archive, bytes);
  const executable = path.join(target, name + (process.platform === 'win32' ? '.exe' : ''));
  if (asset.name.endsWith('.zip') || asset.name.endsWith('.tar.gz')) {
    const result = spawnSync('tar', ['-xf', archive, '-C', target], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Extraction failed: ${name}`);
  } else fs.copyFileSync(archive, executable);
  if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
  console.log(`${name} ${tool.version}: SHA256 verified`);
}
if (process.env.GITHUB_PATH) fs.appendFileSync(process.env.GITHUB_PATH, `${target}\n`);
