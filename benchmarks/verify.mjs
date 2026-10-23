import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { aggregateArm, pairedComparison, scoreCase } from './lib/metrics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const index = process.argv.indexOf('--run');
const directory = resolve(root, index < 0 ? 'benchmarks/results/qwen-agent-v1' : process.argv[index + 1]);
const read = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const manifest = read('manifest.json');
const { frozenAt, fingerprint, ...protocol } = manifest;
assert.equal(hash(JSON.stringify(protocol)), fingerprint, 'Frozen protocol fingerprint changed.');
const historicalFiles = [];
for (const [file, sha256] of Object.entries(manifest.sourceSha256)) {
  if (hash(readFileSync(resolve(root, file))) === sha256) continue;
  const historical = resolve(directory, 'frozen-source', file);
  assert.ok(existsSync(historical), `Frozen source differs without a snapshot: ${file}`);
  assert.equal(hash(readFileSync(historical)), sha256, `Frozen snapshot differs: ${file}`);
  historicalFiles.push(file);
}
assert.equal(hash(readFileSync(resolve(root, 'benchmarks/lib/metrics.mjs'))), manifest.sourceSha256['benchmarks/lib/metrics.mjs'], 'Run verifier with the original scoring version.');
const datasetBytes = readFileSync(resolve(root, manifest.dataset));
assert.equal(hash(datasetBytes), manifest.datasetSha256, 'Frozen dataset differs.');
const samples = datasetBytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const byId = new Map(samples.map(sample => [sample.id, sample]));
const traces = readFileSync(resolve(directory, 'traces.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const expectedKeys = new Set(samples.flatMap(sample => manifest.arms.map(arm => `${sample.id}/${arm}`)));
const seen = new Set();
for (const row of traces) {
  const key = `${row.sampleId}/${row.arm}`;
  assert.ok(expectedKeys.has(key), `Unknown trace ${key}`);
  assert.ok(!seen.has(key), `Duplicate trace ${key}`);
  seen.add(key);
  const sample = byId.get(row.sampleId);
  assert.deepEqual(row.score, scoreCase(sample, row.error ? null : row.output), `Stored score differs ${key}`);
  if (row.modelCalled) {
    assert.equal(row.request.model, manifest.model.model);
    assert.equal(row.request.temperature, manifest.temperature);
    assert.equal(row.request.max_tokens, manifest.maxTokens);
    assert.equal(row.request.messages.length, 2);
    const input = JSON.parse(row.request.messages[1].content);
    assert.equal(input.utterance, sample.text.trim());
    assert.ok(!Object.hasOwn(input, 'expected') && !Object.hasOwn(input, 'rationale'));
    assert.ok(!Object.hasOwn(row.request, 'headers') && !Object.hasOwn(row.request, 'Authorization'));
  } else {
    assert.equal(row.request, null);
    assert.equal(row.usage, null);
  }
}
assert.equal(seen.size, expectedKeys.size, 'Run is incomplete.');
const summary = read('summary.json');
assert.equal(summary.complete, true);
assert.equal(summary.fingerprint, fingerprint);
assert.equal(summary.observed, traces.length);
assert.equal(summary.providerCalls, traces.filter(row => row.modelCalled).length);
const rows = arm => traces.filter(row => row.arm === arm).map(row => ({ ...row, sample: byId.get(row.sampleId) }));
for (const arm of manifest.arms) {
  assert.deepEqual(summary.summaries[arm], aggregateArm(rows(arm)), `Aggregate differs ${arm}`);
  if (arm !== 'qwen-direct') assert.deepEqual(summary.comparisons[arm], pairedComparison(rows('qwen-direct'), rows(arm)), `Paired comparison differs ${arm}`);
}
console.log(JSON.stringify({ verified: true, cases: samples.length, arms: manifest.arms.length, observations: traces.length, providerCalls: summary.providerCalls, frozenAt, fingerprint, historicalFiles, scope: 'Local artifact integrity and score recomputation; historical snapshots identify the original measured implementation, not the current app; not a provider-signed attestation or independent label validation.' }, null, 2));
