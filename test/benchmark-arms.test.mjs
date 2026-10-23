import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMS, EVALUATION_CONTRACT, permittedRecords, normalizeReference, runArm } from '../benchmarks/lib/arms.mjs';

const task = { id: 'demo-card', profile: 'personal', title: '借记卡补办', action: '提交身份证复印件', deadline: '周三', status: 'pending', source: '补办借记卡需要提交身份证复印件。', updatedAt: '2026-10-20T00:00:00Z' };
const sample = { id: 'unit', text: '借记卡补办改为周五。', knowledge: '虚构银行服务点。', context: [], profile: 'personal', memoryEnabled: true, selectedTaskId: null, tasks: [task], expected: { decision: 'resolved', taskId: task.id, draft: 'required', deadline: '周五' }, rationale: 'THIS_LABEL_MUST_NEVER_REACH_THE_PROVIDER' };
const raw = { replies: ['我确认一下，是改到周五吗？', '请问其他要求不变吗？'], draft: { title: null, action: null, deadline: '周五', correction: true }, suggestedTaskId: task.id, memoryNote: '请确认更正。', benchmarkReference: { decision: 'resolved', taskId: task.id } };
const response = value => new Response(JSON.stringify({ model: 'unit-model', usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }, choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
const env = { AI_API_KEY: 'unit-test-only-not-a-real-key' };

test('common consent/profile/newest-version hygiene is shared, not credited to the agent', () => {
  const newer = { ...task, deadline: '周四', updatedAt: '2026-10-22T00:00:00Z' };
  const input = { ...sample, tasks: [task, { ...task, id: 'other', profile: 'other' }, newer] };
  assert.deepEqual(permittedRecords(input), [newer]);
  assert.deepEqual(permittedRecords({ ...input, profile: 'visitor' }), []);
  assert.deepEqual(permittedRecords({ ...input, memoryEnabled: false }), []);
  assert.equal(input.tasks.length, 3);
  assert.throws(() => permittedRecords({ ...sample, tasks: Array.from({ length: 7 }, (_, i) => ({ ...task, id: `t-${i}` })) }), /six-record/);
});

test('all arms use the same model/system contract and never send expected labels or credentials into messages', async () => {
  const requests = [];
  for (const arm of ARMS) {
    const row = await runArm(sample, arm, { env, fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return response(raw); } });
    assert.equal(row.error, null);
    assert.equal(row.modelCalled, true);
    assert.equal(row.usage.total_tokens, 140);
    assert.equal(row.output.taskId, task.id);
    assert.ok(row.timing.totalMs >= row.timing.modelMs);
    assert.doesNotMatch(JSON.stringify(row.request), /THIS_LABEL|unit-test-only|rationale|"expected"/);
  }
  assert.equal(new Set(requests.map(request => request.messages[0].content)).size, 1);
  assert.ok(requests.every(request => request.temperature === 0 && request.messages[0].content.endsWith(EVALUATION_CONTRACT)));
});

test('actual ambiguity fast path is counted as no model call and no invented token usage', async () => {
  const ambiguous = { ...sample, text: '上次那份改为周五。', tasks: [task, { ...task, id: 'second', title: '存款证明申请', action: '提交收入证明' }] };
  let calls = 0;
  const row = await runArm(ambiguous, 'signova-agent', { env, fetchImpl: async () => { calls++; throw new Error('must not call'); } });
  assert.equal(calls, 0);
  assert.equal(row.modelCalled, false);
  assert.equal(row.usage, null);
  assert.deepEqual(row.output, { decision: 'ambiguous', taskId: null, draft: null, suggestedTaskId: null });
  assert.equal(row.request, null);
});

test('no-gate ablation calls the model even for ambiguous references', async () => {
  const input = { ...sample, text: '上次那份改为周五。' };
  const row = await runArm(input, 'agent-no-gate', { env, fetchImpl: async () => response({ ...raw, draft: null, suggestedTaskId: null, benchmarkReference: { decision: 'ambiguous', taskId: null } }) });
  assert.equal(row.modelCalled, true);
  assert.equal(row.output.decision, 'ambiguous');
});

test('no-context ablation removes conversation from both resolver and model input', async () => {
  const input = { ...sample, context: ['我们现在办理借记卡补办。'] };
  const row = await runArm(input, 'agent-no-context', { env, fetchImpl: async () => response(raw) });
  assert.deepEqual(JSON.parse(row.request.messages[1].content).recentContext, []);
  assert.equal(row.output.suggestedTaskId, task.id);
});

test('malformed extra reference fields and production output errors remain failed observations', async () => {
  const missing = await runArm(sample, 'qwen-direct', { env, fetchImpl: async () => response({ ...raw, benchmarkReference: undefined }) });
  assert.equal(missing.error, 'BENCHMARK_REFERENCE_OUTPUT');
  assert.equal(missing.output, null);
  const invalid = await runArm(sample, 'qwen-direct', { env, fetchImpl: async () => response({ ...raw, replies: [] }) });
  assert.equal(invalid.error, 'MODEL_OUTPUT');
  assert.equal(invalid.usage.total_tokens, 140);
  assert.equal(normalizeReference({ benchmarkReference: { decision: 'none', taskId: 'invented' } }, { draft: null }), null);
});

test('provider auth errors are safely classified; call budget stops before sending', async () => {
  const denied = await runArm(sample, 'qwen-direct', { env, fetchImpl: async () => new Response('PRIVATE_PROVIDER_ERROR_BODY', { status: 401 }) });
  assert.equal(denied.error, 'MODEL_AUTH');
  assert.equal(denied.modelCalled, true);
  assert.doesNotMatch(JSON.stringify(denied), /PRIVATE_PROVIDER_ERROR_BODY/);
  let sent = false;
  const budget = await runArm(sample, 'qwen-direct', { env, reserveCall: () => { throw new Error('MODEL_CALL_BUDGET'); }, fetchImpl: async () => { sent = true; return response(raw); } });
  assert.equal(budget.error, 'MODEL_CALL_BUDGET');
  assert.equal(sent, false);
  assert.equal(budget.modelCalled, false);
});
