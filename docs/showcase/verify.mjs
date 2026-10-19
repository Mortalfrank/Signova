import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('.', import.meta.url));
const errors = [];
const checked = new Set();
async function exists(file) {
  if (checked.has(file)) return;
  checked.add(file);
  const target = path.resolve(root, file);
  if (!target.startsWith(root)) { errors.push(`Resource escapes showcase directory: ${file}`); return; }
  try { if (!(await stat(target)).isFile()) errors.push(`Not a file: ${file}`); }
  catch { errors.push(`Missing: ${file}`); }
}
const html = await readFile(path.join(root, 'index.html'), 'utf8');
for (const page of ['index.html', 'technical.html']) {
  const content = await readFile(path.join(root, page), 'utf8');
  for (const match of content.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const value = match[1];
    if (/^(?:https?:|data:|mailto:)/.test(value)) continue;
    const [resource, fragment] = value.split('#');
    const file = resource.split('?')[0] || page;
    await exists(file);
    if (fragment && file.endsWith('.html')) {
      try {
        const targetHtml = file === page ? content : await readFile(path.join(root, file), 'utf8');
        const ids = new Set([...targetHtml.matchAll(/\bid="([^"]+)"/g)].map(item => item[1]));
        if (!ids.has(decodeURIComponent(fragment))) errors.push(`Missing anchor: ${value} in ${page}`);
      } catch { /* Missing resources are reported by exists(). */ }
    }
  }
}
for (const file of ['assets/mobile-live.png','assets/mobile-talk.png','assets/mobile-memory.png','showcase.js','styles.css','media.json']) await exists(file);
const media = JSON.parse(await readFile(path.join(root, 'media.json'), 'utf8'));
for (const key of ['video', 'poster', 'captions']) if (media[key]) await exists(media[key]);
if (media.captions) {
  const captions = await readFile(path.join(root, media.captions), 'utf8');
  if (!/^WEBVTT\r?\n/.test(captions) || !captions.includes('-->')) errors.push('Caption track must contain WebVTT cues.');
}
if (!html.includes('prefers-reduced-motion') && !(await readFile(path.join(root, 'styles.css'),'utf8')).includes('prefers-reduced-motion')) errors.push('Reduced-motion support missing.');
if (/\bautoplay\b/i.test(html)) errors.push('Unexpected autoplay.');
if (/<script[^>]+src="https?:/i.test(html)) errors.push('Unexpected external script.');
const syntax = spawnSync(process.execPath, ['--check', path.join(root,'showcase.js')], { encoding: 'utf8' });
if (syntax.status !== 0) errors.push(syntax.stderr);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Showcase static checks passed: ${checked.size} resources, anchors, media manifest and script syntax. Video configured: ${Boolean(media.video)}.`);
