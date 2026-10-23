import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCase, aggregateArm, pairedComparison } from '../benchmarks/lib/metrics.mjs';

const sample = (id, overrides = {}) => ({ id, expected: { decision: 'resolved', taskId: 'task-a', draft: 'required', deadline: '本周五前', ...overrides } });
const good = () => ({ decision: 'resolved', taskId: 'task-a', suggestedTaskId: 'task-a', draft: { deadline: '本星期五前' } });
const row = (id, output = good(), overrides = {}) => ({ sample: sample(id), output, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, timing: { totalMs: 100, modelMs: 80 }, modelCalled: true, error: null, ...overrides });

test('optional drafts still require a lawful update target when actually produced', () => {
  const input = sample('optional-target', { draft: 'optional', deadline: null });
  assert.equal(scoreCase(input, { ...good(), draft: null, suggestedTaskId: null }).taskSuccess, true);
  assert.equal(scoreCase(input, { ...good(), suggestedTaskId: null }).taskSuccess, false);
  assert.equal(scoreCase(input, { ...good(), suggestedTaskId: 'wrong' }).taskSuccess, false);
  assert.equal(scoreCase(input, good()).taskSuccess, true);
});

test('case scoring requires correct decision, id, draft and bounded weekday equivalence', () => {
  assert.equal(scoreCase(sample('a'), good()).taskSuccess, true);
  assert.equal(scoreCase(sample('a'), { ...good(), taskId: 'task-b' }).wrongBinding, true);
  assert.equal(scoreCase(sample('a'), { ...good(), taskId: null }).decisionCorrect, false);
  assert.equal(scoreCase(sample('a'), { ...good(), draft: { deadline: '下周五前' } }).deadlineCorrect, false);
  assert.equal(scoreCase(sample('a'), { ...good(), draft: { deadline: '本周五' } }).deadlineCorrect, false);
  assert.equal(scoreCase(sample('a', { deadline: '星期天' }), { ...good(), draft: { deadline: '周日' } }).taskSuccess, true);
  assert.equal(scoreCase(sample('a', { deadline: '周三前' }), { ...good(), draft: { deadline: '星期三之前' } }).deadlineCorrect, true);
  assert.equal(scoreCase(sample('a', { deadline: '周三后' }), { ...good(), draft: { deadline: '星期三之后' } }).deadlineCorrect, true);
  assert.equal(scoreCase(sample('a', { deadline: '周三前' }), { ...good(), draft: { deadline: '周三当天' } }).deadlineCorrect, false);
  assert.equal(scoreCase(sample('a', { deadline: '周三前' }), { ...good(), draft: { deadline: '周三之后' } }).deadlineCorrect, false);
});

test('required drafts must target the expected task, even when reference resolution is correct', () => {
  const missing = scoreCase(sample('a'), { ...good(), suggestedTaskId: null });
  assert.equal(missing.decisionCorrect, true);
  assert.equal(missing.updateTargetApplicable, true);
  assert.equal(missing.updateTargetCorrect, false);
  assert.equal(missing.wrongBinding, false);
  assert.equal(missing.taskSuccess, false);
  const wrong = scoreCase(sample('a'), { ...good(), suggestedTaskId: 'task-b' });
  assert.equal(wrong.decisionCorrect, true);
  assert.equal(wrong.updateTargetCorrect, false);
  assert.equal(wrong.wrongBinding, true);
  assert.equal(wrong.taskSuccess, false);
  const optional = scoreCase(sample('a', { draft: 'optional', deadline: null }), { ...good(), suggestedTaskId: null, draft: null });
  assert.equal(optional.updateTargetApplicable, false);
  assert.equal(optional.taskSuccess, true);
  const aggregate = aggregateArm([row('good'), row('wrong', { ...good(), suggestedTaskId: 'task-b' }), row('failed', null, { error: 'timeout' })]);
  assert.equal(aggregate.counts.updateTargetApplicableCases, 3);
  assert.equal(aggregate.counts.updateTargetCorrectCases, 1);
  assert.equal(aggregate.rates.updateTargetCorrect, 1 / 3);
  assert.equal(aggregate.rates.wrongBinding, 1 / 3);
});

test('none/ambiguous/disabled decisions forbid binding and can forbid drafts', () => {
  for (const decision of ['none', 'ambiguous', 'disabled']) {
    const input = sample(decision, { decision, taskId: null, draft: 'forbidden', deadline: null });
    assert.equal(scoreCase(input, { decision, taskId: null, draft: null }).taskSuccess, true);
    assert.equal(scoreCase(input, { decision, taskId: 'task-a', draft: null }).wrongBinding, true);
    assert.equal(scoreCase(input, { decision, taskId: null, draft: {} }).draftCorrect, false);
  }
  assert.equal(scoreCase(sample('optional', { draft: 'optional', deadline: null }), { ...good(), draft: null }).taskSuccess, true);
});

test('null/error outputs fail and missing required draft fails even without deadline requirement', () => {
  for (const output of [null, { error: 'timeout' }, { ...good(), error: 'provider failed' }]) {
    assert.equal(scoreCase(sample('a'), output).taskSuccess, false);
    assert.equal(scoreCase(sample('a'), output).decisionCorrect, false);
    assert.equal(scoreCase(sample('a'), output).draftCorrect, false);
  }
  assert.equal(scoreCase(sample('a', { deadline: null }), { ...good(), draft: null }).taskSuccess, false);
});

test('aggregate uses all cases as denominator and nearest-rank known numeric percentiles', () => {
  const rows = [row('a'), row('b', { ...good(), taskId: 'other' }, { timing: { totalMs: 200, modelMs: 180 } }),
    row('c', null, { error: 'timeout', timing: { totalMs: 900, modelMs: 800 }, usage: null })];
  const result = aggregateArm(rows);
  assert.equal(result.counts.cases, 3);
  assert.equal(result.rates.taskSuccess, 1 / 3);
  assert.equal(result.rates.wrongBinding, 1 / 3);
  assert.equal(result.counts.errorCases, 1);
  assert.equal(result.latency.totalMs.p50, 200);
  assert.equal(result.latency.totalMs.p95, 900);
  assert.equal(result.latency.totalMs.mean, 400);
  assert.deepEqual(result.tokens.total_tokens, { total: 30, mean: 15, count: 2 });
  assert.equal(result.missingUsageCount, 1);
  assert.equal(JSON.stringify(result).includes('NaN'), false);
});

test('model not called means zero tokens; missing usage stays unknown; row.score is ignored', () => {
  const result = aggregateArm([row('a', good(), { modelCalled: false, usage: null, timing: { totalMs: 0, modelMs: null } }),
    row('b', null, { error: 'failed', usage: null, score: { taskSuccess: true } })]);
  assert.deepEqual(result.tokens.total_tokens, { total: 0, mean: 0, count: 1 });
  assert.equal(result.missingUsageCount, 1);
  assert.equal(result.rates.taskSuccess, 0.5);
  assert.equal(result.latency.modelMs.p50, 0);
  assert.equal(result.latency.totalMs.p50, 0);
});

test('empty aggregate returns zero counts and null rates and measurements', () => {
  const result = aggregateArm([]);
  assert.equal(result.counts.cases, 0);
  assert.ok(Object.values(result.rates).every(value => value === null));
  assert.deepEqual(result.tokens.total_tokens, { total: 0, mean: null, count: 0 });
  assert.deepEqual(result.latency.totalMs, { count: 0, p50: null, p95: null, mean: null });
});

test('paired comparison has known changes, fixed CI and counts unmatched cases', () => {
  const before = [row('a', null, { error: 'timeout' }), row('b', null), row('only-before')];
  const after = [row('b', good(), { usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }, timing: { totalMs: 50, modelMs: 40 } }),
    row('a', good(), { usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }, timing: { totalMs: 50, modelMs: 40 } }), row('only-after')];
  const result = pairedComparison(before, after);
  assert.equal(result.pairedCases, 2);
  assert.deepEqual(result.unpaired, { baseline: 1, candidate: 1 });
  assert.equal(result.taskSuccess.improvementPp, 100);
  assert.deepEqual(result.taskSuccess.bootstrap95CiPp, [100, 100]);
  assert.equal(result.taskSuccess.bootstrap.iterations, 2000);
  assert.equal(result.latency.totalMs.reductionPct, 50);
  assert.equal(result.tokens.total_tokens.absoluteReduction, 8);
  assert.deepEqual(result, pairedComparison([...before].reverse(), [...after].reverse()));
});

test('paired CI for mixed outcomes spans negative and positive; missing data pairs excluded only from measurement', () => {
  const before = [row('a'), row('b', null)];
  const after = [row('a', null, { usage: null }), row('b')];
  const result = pairedComparison(before, after);
  assert.equal(result.taskSuccess.improvementPp, 0);
  assert.deepEqual(result.taskSuccess.bootstrap95CiPp, [-100, 100]);
  assert.equal(result.tokens.total_tokens.matchedCases, 1);
  assert.equal(result.tokens.total_tokens.reductionPct, 0);
});

test('zero denominators and wholly missing paired measurements are null, never Infinity', () => {
  const before = [row('a', good(), { modelCalled: false, usage: null, timing: null })];
  const after = [row('a', good(), { modelCalled: false, usage: null, timing: null })];
  const result = pairedComparison(before, after);
  assert.equal(result.tokens.total_tokens.reductionPct, null);
  assert.equal(result.latency.modelMs.reductionPct, null);
  assert.deepEqual(result.latency.totalMs, { matchedCases: 0, baselineMean: null, candidateMean: null, absoluteReduction: null, reductionPct: null });
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
});

test('duplicate or missing ids and no common cases are rejected', () => {
  assert.throws(() => pairedComparison([row('a'), row('a')], [row('a')]), /duplicate/);
  assert.throws(() => pairedComparison([row('a')], [row('a'), row('a')]), /duplicate/);
  assert.throws(() => pairedComparison([row('a')], [row('b')]), /No paired/);
  assert.throws(() => pairedComparison([row('')], [row('b')]), /nonempty/);
});
