import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runAlgorithmEvaluation, MEMORY_EVALUATION_FIXTURES } from '../public/algorithm-evaluation.js';
import { SPEECH_REPLAYS } from '../public/speech-replay.js';

test('fixed input produces byte-for-byte reproducible results without mutation', async () => {
  const inputBefore = JSON.stringify(MEMORY_EVALUATION_FIXTURES);
  const first = await runAlgorithmEvaluation();
  const second = await runAlgorithmEvaluation();
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(MEMORY_EVALUATION_FIXTURES), inputBefore);
  assert.equal(first.memory.cases.length, 30);
  assert.equal(new Set(first.memory.cases.map(item => item.id)).size, 30);
});

test('summary counts can be independently recomputed from manual labels and raw decisions', async () => {
  const report = await runAlgorithmEvaluation();
  for (const strategy of ['baseline', 'optimized']) {
    const cases = report.memory.cases;
    const summary = report.memory.summary[strategy];
    const correctBindings = cases.filter(item => item.expected.status === 'resolved' && item[strategy].selectedTaskId === item.expected.selectedTaskId).length;
    const wrongBindings = cases.filter(item => item[strategy].selectedTaskId !== null && item[strategy].selectedTaskId !== item.expected.selectedTaskId).length;
    const correctClarifications = cases.filter(item => item.expected.status === 'ambiguous' && item[strategy].status === 'ambiguous' && item[strategy].selectedTaskId === null).length;
    const irrelevant = cases.reduce((sum, item) => sum + item[strategy].memories.filter(memory => !item.expected.relevantTaskIds.includes(memory.id)).length, 0);
    const promptCount = cases.reduce((sum, item) => sum + item[strategy].memories.length, 0);
    assert.equal(summary.correctBindings, correctBindings);
    assert.equal(summary.wrongBindings, wrongBindings);
    assert.equal(summary.correctClarifications, correctClarifications);
    assert.equal(summary.irrelevantMemoryCount, irrelevant);
    assert.equal(summary.promptRecordCount, promptCount);
  }
});

test('fixture fingerprints are independently verified by Node SHA-256', async () => {
  const report = await runAlgorithmEvaluation();
  assert.equal(report.metadata.memoryFixtureSha256, createHash('sha256').update(JSON.stringify(MEMORY_EVALUATION_FIXTURES)).digest('hex'));
  assert.equal(report.metadata.speechFixtureSha256, createHash('sha256').update(JSON.stringify(SPEECH_REPLAYS)).digest('hex'));
});

test('every actual final commit preserves the complete fixture source including negation and correction', async () => {
  const report = await runAlgorithmEvaluation();
  for (const item of report.streaming.cases) {
    const original = item.fixture.events.findLast(event => event.isFinal).text;
    const final = item.optimized.commits.findLast(commit => !commit.provisional);
    assert.equal(final.text, original, item.id);
    assert.equal(item.optimized.finalText, original);
    assert.ok(item.optimized.finalSourceExactlyPreserved);
  }
  assert.match(report.streaming.cases.find(item => item.id === 'negation').optimized.finalText, /不用/);
  assert.match(report.streaming.cases.find(item => item.id === 'date-correction').optimized.finalText, /周五，不是周三/);
});

test('lead times and revisions can be recomputed from the actual policy commit log', async () => {
  const report = await runAlgorithmEvaluation();
  for (const item of report.streaming.cases) {
    const finalAt = item.fixture.events.findLast(event => event.isFinal).at;
    const firstCandidate = item.optimized.commits.find(commit => commit.provisional);
    assert.equal(item.optimized.firstCandidateLeadMs, firstCandidate ? finalAt - firstCandidate.committedAt : 0);
    assert.equal(item.optimized.retractionEventCount, item.optimized.retractions.length);
    assert.equal(item.optimized.retractedCandidateCount, new Set(item.optimized.retractions.flatMap(revision => revision.retractIds)).size);
    assert.ok(item.optimized.firstCandidateLeadMs >= 0);
    assert.equal(item.baseline.firstCandidateLeadMs, 0);
  }
});

test('waiting beyond final produces zero early candidates without fabricating a speed improvement', async () => {
  const report = await runAlgorithmEvaluation({ policyOptions: { minStableMs: 10000, riskStableMs: 10000, minObservations: 2 } });
  assert.equal(report.streaming.summary.casesWithEarlyCandidates, 0);
  assert.equal(report.streaming.summary.averageFirstCandidateLeadMs, 0);
  assert.equal(report.streaming.summary.finalSourceExactlyPreserved, true);
});

test('evaluation is local, synthetic and contains no credential fields or historical prompt payloads', async () => {
  const report = await runAlgorithmEvaluation();
  assert.equal(report.metadata.modelCalls, 0);
  assert.equal(report.metadata.trainedModels, 0);
  assert.match(report.metadata.dataOrigin, /虚构/);
  assert.ok(report.metadata.limitations.some(item => item.includes('端到端')));
  for (const item of report.memory.cases) {
    for (const strategy of ['baseline', 'optimized']) {
      assert.ok(item[strategy].memories.every(memory => !('history' in memory) && !('profile' in memory)));
    }
  }
  const json = JSON.stringify(report);
  assert.doesNotMatch(json, /\bsk-[A-Za-z0-9._-]{12,}|Bearer [A-Za-z0-9._-]{12,}|AI_API_KEY|SIGNOVA_ACCESS_KEY/);
  const source = await readFile(new URL('../public/algorithm-evaluation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|readFile|fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/);
});

test('invalid replay tick configuration fails instead of silently changing measurement', async () => {
  for (const tickMs of [0, -1, 1001, NaN, '120']) {
    await assert.rejects(runAlgorithmEvaluation({ tickMs }), /tickMs/);
  }
});
