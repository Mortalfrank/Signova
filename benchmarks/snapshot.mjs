import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const index = process.argv.indexOf('--run');
const directory = resolve(root, index < 0 ? 'benchmarks/results/qwen-agent-v1' : process.argv[index + 1]);
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
const target = resolve(directory, 'frozen-source');
for (const [file, hash] of Object.entries(manifest.sourceSha256)) {
  const payload = readFileSync(resolve(root, file));
  if (createHash('sha256').update(payload).digest('hex') !== hash) throw new Error(`Cannot snapshot changed source: ${file}`);
  mkdirSync(dirname(resolve(target, file)), { recursive: true });
  copyFileSync(resolve(root, file), resolve(target, file));
}
mkdirSync(dirname(resolve(target, manifest.dataset)), { recursive: true });
copyFileSync(resolve(root, manifest.dataset), resolve(target, manifest.dataset));
writeFileSync(resolve(target, 'package.json'), '{"private":true,"type":"module","engines":{"node":">=22"}}\n');
console.log(JSON.stringify({ preservedSourceFiles: Object.keys(manifest.sourceSha256).length, directory: target }));
