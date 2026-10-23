import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, AI_API_KEY: '', DASHSCOPE_API_KEY: '', AI_MODEL: 'qwen-unit-alias', AI_BASE_URL: '', AI_ENABLE_THINKING: 'false' };
const run = args => spawnSync(process.execPath, ['benchmarks/run.mjs', ...args], { cwd, env, encoding: 'utf8', timeout: 10000 });

test('dry-run needs no credentials, makes no provider calls and exposes only hashes/public protocol', () => {
  const result = run(['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.samples, 60);
  assert.equal(plan.maximumRequests, 300);
  assert.equal(plan.noProviderCalls, true);
  assert.equal(plan.model.configured, false);
  assert.match(plan.datasetSha256, /^[a-f0-9]{64}$/);
  assert.match(plan.endpointIdentitySha256, /^[a-f0-9]{64}$/);
  assert.match(plan.sourceSha256['benchmarks/lib/metrics.mjs'], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(result.stdout, /Authorization|Bearer |"expected"|AI_API_KEY|https:\/\//);
});

test('invalid arm and unbounded concurrency are rejected before any provider access', () => {
  for (const args of [['--dry-run', '--arms', 'invented'], ['--dry-run', '--concurrency', '99'], ['--dry-run', '--max-model-calls', '0']]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid/);
  }
});
