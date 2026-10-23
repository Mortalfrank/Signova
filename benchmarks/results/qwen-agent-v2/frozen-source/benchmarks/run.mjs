import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModelStatus } from '../model.mjs';
import { ARMS, EVALUATION_CONTRACT, runArm } from './lib/arms.mjs';
import { aggregateArm, pairedComparison, scoreCase } from './lib/metrics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const dry = args.includes('--dry-run');
const resume = args.includes('--resume');
const datasetPath = resolve(root, option('--dataset', 'benchmarks/datasets/communication-v1.jsonl'));
const out = resolve(root, option('--out', 'benchmarks/results/qwen-agent-v1'));
const arms = option('--arms', ARMS.join(',')).split(',');
const concurrency = Number(option('--concurrency', '2'));
const maxCalls = Number(option('--max-model-calls', '300'));
if (!arms.length || new Set(arms).size !== arms.length || arms.some(arm => !ARMS.includes(arm))) throw new Error('Invalid arms.');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 1000) throw new Error('Invalid execution limits.');
const datasetBytes = readFileSync(datasetPath);
const samples = datasetBytes.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
if (new Set(samples.map(sample => sample.id)).size !== samples.length || !samples.length) throw new Error('Empty dataset or duplicate ID.');
const model = getModelStatus();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['model.mjs', 'public/communication-analysis.js', 'public/memory-resolution.js', 'public/model-context.js', 'public/core.js', 'benchmarks/run.mjs', 'benchmarks/lib/arms.mjs', 'benchmarks/lib/metrics.mjs', 'benchmarks/report.mjs'];
const endpointIdentitySha256 = sha(new URL(String(process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim()).href.replace(/\/$/, '') + '/chat/completions');
const protocol = { schema: 'signova.qwen-agent-benchmark/1', dataset: relative(root, datasetPath).replaceAll('\\', '/'), datasetSha256: sha(datasetBytes),
  samples: samples.length, arms, repetitions: 1, seed: 231023, temperature: 0, thinking: String(process.env.AI_ENABLE_THINKING ?? 'false'),
  model, endpointIdentitySha256, maxTokens: 2048, timeoutMs: 25000, concurrency, maxCalls, evaluationContractSha256: sha(EVALUATION_CONTRACT), node: process.version,
  sourceSha256: Object.fromEntries(sourceFiles.map(file => [file, sha(readFileSync(resolve(root, file)))])),
  scope: 'Authored fictional frozen development evaluation; no independent blind test, no microphone, no sign-language quality or vendor-product comparison. Same model/system prompt and available evidence; input hygiene shared; no automatic retries.' };
const fingerprint = sha(JSON.stringify(protocol));
if (dry) {
  console.log(JSON.stringify({ dryRun: true, fingerprint, ...protocol, maximumRequests: samples.length * arms.length, noProviderCalls: true }, null, 2));
  process.exit(0);
}
if (!model.configured) throw new Error('Configure AI_API_KEY or DASHSCOPE_API_KEY locally; no key is printed or exported.');
mkdirSync(out, { recursive: true });
const manifestPath = resolve(out, 'manifest.json');
const rowsPath = resolve(out, 'traces.jsonl');
if (existsSync(manifestPath)) {
  if (!resume) throw new Error('Output already exists. Use --resume to keep every prior observation or choose a new output directory.');
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (previous.fingerprint !== fingerprint) throw new Error('Frozen inputs/configuration changed; cannot merge runs.');
} else {
  if (resume || existsSync(rowsPath)) throw new Error('Cannot resume without the frozen manifest.');
  writeFileSync(manifestPath, JSON.stringify({ frozenAt: new Date().toISOString(), fingerprint, ...protocol }, null, 2) + '\n');
}
const previous = existsSync(rowsPath) ? readFileSync(rowsPath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
const plannedKeys = new Set(samples.flatMap(sample => arms.map(arm => `${sample.id}/${arm}`)));
const keys = new Set(previous.map(row => `${row.sampleId}/${row.arm}`));
if (keys.size !== previous.length) throw new Error('Duplicate observations in trace file.');
if ([...keys].some(key => !plannedKeys.has(key))) throw new Error('Unknown sample/arm in saved observations.');
let randomState = 231023;
const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
const shuffled = values => { const result = [...values]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; };
const jobs = shuffled(samples).flatMap(sample => shuffled(arms).map(arm => ({ sample, arm }))).filter(job => !keys.has(`${job.sample.id}/${job.arm}`));
let calls = previous.filter(row => row.modelCalled).length;
let index = 0;
let stopped = false;
const rows = [...previous];
const reserveCall = () => { if (calls >= maxCalls) throw new Error('MODEL_CALL_BUDGET'); calls++; };
console.log(`Frozen ${samples.length} cases; ${arms.length} arms; ${jobs.length} remaining observations; at most ${maxCalls} model calls.`);
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (!stopped && index < jobs.length) {
    const { sample, arm } = jobs[index++];
    const observation = await runArm(sample, arm, { reserveCall });
    const row = { sampleId: sample.id, arm, observedAt: new Date().toISOString(), ...observation, score: scoreCase(sample, observation.error ? null : observation.output) };
    rows.push(row);
    appendFileSync(rowsPath, JSON.stringify(row) + '\n');
    if (rows.length % 10 === 0 || rows.length === samples.length * arms.length) console.log(`Observed ${rows.length}/${samples.length * arms.length}; model calls ${calls}; failures ${rows.filter(item => item.error).length}.`);
    if (['MODEL_AUTH', 'MODEL_CONFIG', 'MODEL_QUOTA', 'MODEL_CALL_BUDGET'].includes(row.error)) stopped = true;
  }
}));
for (const file of sourceFiles) if (sha(readFileSync(resolve(root, file))) !== protocol.sourceSha256[file]) throw new Error('Source changed during the frozen run. Traces retained, summary not certified.');
if (sha(readFileSync(datasetPath)) !== protocol.datasetSha256) throw new Error('Dataset changed during the frozen run. Traces retained, summary not certified.');
const byId = new Map(samples.map(sample => [sample.id, sample]));
const evaluationRows = arm => rows.filter(row => row.arm === arm).map(row => ({ ...row, sample: byId.get(row.sampleId) }));
const summaries = Object.fromEntries(arms.map(arm => [arm, aggregateArm(evaluationRows(arm))]));
const comparisons = {};
const successfulComparisons = {};
if (arms.includes('qwen-direct')) for (const arm of arms.filter(arm => arm !== 'qwen-direct')) {
  const left = evaluationRows('qwen-direct');
  const right = evaluationRows(arm);
  if (left.length && right.length) comparisons[arm] = pairedComparison(left, right);
  const goodLeft = left.filter(row => !row.error && scoreCase(row.sample, row.output).taskSuccess);
  const goodRight = right.filter(row => !row.error && scoreCase(row.sample, row.output).taskSuccess);
  if (goodLeft.some(row => goodRight.some(other => other.sample.id === row.sample.id))) successfulComparisons[arm] = pairedComparison(goodLeft, goodRight);
}
const observedKeys = new Set(rows.map(row => `${row.sampleId}/${row.arm}`));
const report = { schema: protocol.schema, fingerprint, completedAt: new Date().toISOString(), complete: observedKeys.size === plannedKeys.size && [...observedKeys].every(key => plannedKeys.has(key)),
  plannedObservations: samples.length * arms.length, observed: rows.length, providerCalls: calls, summaries, comparisons, successfulComparisons,
  categories: Object.fromEntries([...new Set(samples.map(sample => sample.category))].map(category => [category, Object.fromEntries(arms.map(arm => [arm, aggregateArm(evaluationRows(arm).filter(row => row.sample.category === category))]))])),
  limitations: ['Authored fictional cases are not an independent blind test or a public benchmark.', 'Model is a provider alias; temperature 0 is not a guarantee of deterministic hosted responses.', 'End-to-end latency here is text input to structured candidate, excluding microphone, ASR, sign generation and rendering.', 'Local ambiguity fast paths count as zero provider calls/tokens and are reported separately.', 'One observation per case/arm; wall-clock timing is affected by network, concurrent load and provider prompt caching.', 'Case-level bootstrap is conditional on this authored dataset; related domain/template families are not independent random user samples.', 'Internal taskSuccess means structured reference/draft-presence/update-target/date correctness, not action/material correctness, natural-language reply quality or sign-language comprehension.'] };
writeFileSync(resolve(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ complete: report.complete, out: relative(root, out), summaries, comparisons }, null, 2));
if (!report.complete) process.exitCode = 1;
