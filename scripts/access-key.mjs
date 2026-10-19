import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const examplePath = fileURLToPath(new URL('../.env.example', import.meta.url));
let source;
try { source = await readFile(envPath, 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; source = await readFile(examplePath, 'utf8'); }
let key = parseEnv(source).SIGNOVA_ACCESS_KEY?.trim();
const rotate = process.argv.includes('--rotate');
if (!key || key.length < 16 || key.length > 256 || rotate) {
  key = randomBytes(24).toString('base64url');
  const line = `SIGNOVA_ACCESS_KEY=${key}`;
  source = /^SIGNOVA_ACCESS_KEY\s*=/m.test(source)
    ? source.replace(/^SIGNOVA_ACCESS_KEY\s*=.*$/gm, line)
    : `${source.trimEnd()}\n\n# Local experience access key; never commit this file.\n${line}\n`;
  await writeFile(envPath, source, { mode: 0o600 });
  console.log('体验 Key 已写入本地 .env；重启服务后生效。');
} else console.log('本地 .env 已有有效体验 Key，保持原值。');
if (process.argv.includes('--show')) console.log(key);
else console.log('在 .env 的 SIGNOVA_ACCESS_KEY 行查看，或使用 --show 在自己的终端显示。');
