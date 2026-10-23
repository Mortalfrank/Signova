import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Restrict discovery to the live test suite. Archived deliveries may contain old
// test copies and must not inflate the count or run obsolete product snapshots.
const root=fileURLToPath(new URL('../',import.meta.url));
const files=readdirSync(new URL('../test/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>`test/${name}`);
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
const summary={};
for(const key of ['tests','pass','fail','cancelled','skipped','todo']){
  const match=result.stdout?.match(new RegExp('(?:#|ℹ)\\s+'+key+'\\s+(\\d+)'));
  if(match)summary[key]=Number(match[1]);
}
const hashes=Object.fromEntries([...files,'public/app.js','public/memory-resolution.js','public/streaming-policy.js','public/communication-analysis.js','server.mjs','model.mjs'].map(file=>[file,createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
mkdirSync(new URL('../docs/quality/',import.meta.url),{recursive:true});
writeFileSync(new URL('../docs/quality/communication-test-results.json',import.meta.url),JSON.stringify({scope:'Live test/ suite only; archived delivery snapshots excluded. Default tests use local/mock providers, not paid models.',node:process.version,exitCode:result.status??1,testFiles:files.length,summary,sourceSha256:hashes},null,2)+'\n');
if(result.error){console.error('Unable to run the local test suite.');process.exitCode=1;}
else process.exitCode=result.status??1;
