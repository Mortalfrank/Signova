import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamingPolicy } from '../public/streaming-policy.js';

function observe(policy, text, from = 0) {
  policy.push({ text, now: from });
  return policy.push({ text, now: from + 100 });
}

test('stable Chinese clause waits for repeat observation and quiet interval', () => {
  const policy = createStreamingPolicy();
  assert.equal(observe(policy, '您好。').commits.length, 0);
  assert.equal(policy.flush({ now: 349 }).commits.length, 0);
  const update = policy.flush({ now: 350 });
  assert.equal(update.commits[0].text, '您好。');
  assert.equal(update.commits[0].latencyMs, 350);
  assert.equal(update.commits[0].provisional, true);
  assert.equal(update.stableText, '您好。');
  assert.equal(update.pending, '');
});

test('one observation cannot become stable by elapsed time alone', () => {
  const policy = createStreamingPolicy();
  policy.push({ text: '您好。', now: 0 });
  assert.equal(policy.flush({ now: 5000 }).commits.length, 0);
});

test('unfinished clause with no punctuation never commits halfway', () => {
  const policy = createStreamingPolicy();
  observe(policy, '请到服务窗口');
  const update = policy.flush({ now: 5000, force: true });
  assert.deepEqual(update.commits, []);
  assert.equal(update.pending, '请到服务窗口');
  assert.equal(update.reason, 'awaiting-boundary');
});

test('continuing speech restarts the quiet interval even for stable prefix', () => {
  const policy = createStreamingPolicy();
  policy.push({ text: '您好。', now: 0 });
  policy.push({ text: '您好。请坐', now: 250 });
  assert.equal(policy.flush({ now: 350 }).commits.length, 0);
  const update = policy.flush({ now: 600 });
  assert.equal(update.stableText, '您好。');
  assert.equal(update.pending, '请坐');
});

test('negation waits for the longer risk threshold', () => {
  const policy = createStreamingPolicy();
  observe(policy, '不要去服务窗口。');
  assert.equal(policy.flush({ now: 350 }).reason, 'risk-wait');
  assert.equal(policy.flush({ now: 799 }).commits.length, 0);
  assert.equal(policy.flush({ now: 800 }).commits[0].reason, 'risk-stable-boundary');
});

test('dates and money are conservatively delayed', () => {
  for (const text of ['周五提交。', '请付100元。', '金额为3.50元。', 'Submit on Friday.', 'Pay 20 dollars.']) {
    const policy = createStreamingPolicy();
    observe(policy, text);
    assert.equal(policy.flush({ now: 350 }).commits.length, 0, text);
    assert.equal(policy.flush({ now: 800 }).commits[0].text, text);
  }
});

test('English punctuation commits but decimal point does not split a number', () => {
  const policy = createStreamingPolicy();
  observe(policy, 'Hello! Please wait');
  assert.equal(policy.flush({ now: 350 }).commits[0].text, 'Hello!');
  const decimal = createStreamingPolicy();
  observe(decimal, 'Pay 3.50');
  assert.equal(decimal.flush({ now: 5000 }).commits.length, 0);
});

test('common English title abbreviation does not become a semantic boundary', () => {
  const policy = createStreamingPolicy();
  observe(policy, 'Dr. Smith');
  assert.equal(policy.flush({ now: 5000 }).commits.length, 0);
});

test('self-correction retracts provisional analysis and waits again', () => {
  const policy = createStreamingPolicy();
  observe(policy, '材料周三交。');
  const first = policy.flush({ now: 800 }).commits[0];
  const revised = policy.push({ text: '材料周五交。', now: 900 });
  assert.deepEqual(revised.revision.retractIds, [first.id]);
  assert.equal(revised.stableText, '');
  assert.equal(revised.revision.reason, 'hypothesis-revision');
  policy.push({ text: '材料周五交。', now: 1000 });
  assert.equal(policy.flush({ now: 1699 }).commits.length, 0);
  assert.equal(policy.flush({ now: 1700 }).commits[0].text, '材料周五交。');
});

test('final revision preserves full sentence and identifies superseded commits', () => {
  const policy = createStreamingPolicy();
  observe(policy, '您好。');
  const first = policy.flush({ now: 350 }).commits[0];
  const update = policy.push({ text: '你好，请去东侧服务窗口。', isFinal: true, now: 400 });
  assert.equal(update.commits[0].text, '你好，请去东侧服务窗口。');
  assert.equal(update.commits[0].provisional, false);
  assert.deepEqual(update.revision.retractIds, [first.id]);
  assert.deepEqual(update.commits[0].replacesIds, [first.id]);
  assert.equal(update.pending, '');
  assert.equal(policy.getState().active, false);
});

test('appended spoken correction retracts earlier analysis even when ASR prefix is unchanged', () => {
  const policy = createStreamingPolicy();
  observe(policy, '材料周三交。');
  const first = policy.flush({ now: 800 }).commits[0];
  const update = policy.push({ text: '材料周三交。不对，周五交。', now: 900 });
  assert.equal(update.revision.reason, 'speaker-correction');
  assert.deepEqual(update.revision.retractIds, [first.id]);
  assert.equal(update.stableText, '');
  const final = policy.push({ text: '材料周三交。不对，周五交。', isFinal: true, now: 950 });
  assert.equal(final.commits[0].text, '材料周三交。不对，周五交。');
});

test('matching final still contains its committed prefix instead of dropping words', () => {
  const policy = createStreamingPolicy();
  observe(policy, '您好。请坐');
  const first = policy.flush({ now: 350 }).commits[0];
  const update = policy.push({ text: '您好。请坐这里。', isFinal: true, now: 500 });
  assert.equal(update.commits[0].text, '您好。请坐这里。');
  assert.deepEqual(update.commits[0].replacesIds, [first.id]);
  assert.equal(update.revision, undefined);
});

test('consecutive duplicate final delivery emits no second analysis', () => {
  const policy = createStreamingPolicy();
  policy.push({ text: '您好。', isFinal: true, now: 0 });
  const duplicate = policy.push({ text: '您好。', isFinal: true, now: 20 });
  assert.equal(duplicate.reason, 'duplicate-final');
  assert.deepEqual(duplicate.commits, []);
});

test('identical text in a new partial sentence is not globally deduplicated', () => {
  const policy = createStreamingPolicy();
  const first = policy.push({ text: '您好。', isFinal: true, now: 0 });
  policy.push({ text: '您好。', now: 100 });
  const second = policy.push({ text: '您好。', isFinal: true, now: 200 });
  assert.equal(second.commits.length, 1);
  assert.notEqual(first.commits[0].id, second.commits[0].id);
  assert.notEqual(first.commits[0].sentenceId, second.commits[0].sentenceId);
});

test('sentence IDs distinguish identical final-only sentences', () => {
  const policy = createStreamingPolicy();
  policy.push({ text: '您好。', isFinal: true, sentenceId: 1, now: 0 });
  const next = policy.push({ text: '您好。', isFinal: true, sentenceId: 2, now: 100 });
  assert.equal(next.commits.length, 1);
  assert.equal(policy.push({ text: '您好。', isFinal: true, sentenceId: 2, now: 200 }).commits.length, 0);
});

test('reset cancels active analysis and preserves unique monotonic commit IDs', () => {
  const policy = createStreamingPolicy();
  observe(policy, '您好。');
  const first = policy.flush({ now: 350 }).commits[0];
  const reset = policy.reset();
  assert.deepEqual(reset.revision.retractIds, [first.id]);
  assert.equal(reset.preview, '');
  assert.equal(policy.getState().candidateCount, 0);
  const second = policy.push({ text: '您好。', isFinal: true, now: 400 }).commits[0];
  assert.notEqual(second.id, first.id);
});

test('input cap rejects excess text without truncating valid final or corrupting state', () => {
  const policy = createStreamingPolicy({ maxChars: 6 });
  policy.push({ text: '您好。', now: 0 });
  assert.throws(() => policy.push({ text: '这句话已经超过上限。', isFinal: true, now: 100 }), /maxChars/);
  assert.equal(policy.getState().preview, '您好。');
  assert.equal(policy.push({ text: '您好。', isFinal: true, now: 200 }).commits[0].text, '您好。');
});

test('Unicode code points are preserved and input cap does not count surrogate halves', () => {
  const policy = createStreamingPolicy({ maxChars: 4 });
  observe(policy, '👩🏽好。');
  const update = policy.flush({ now: 350 });
  assert.equal(update.commits[0].text, '👩🏽好。');
  assert.equal(update.stableText, '👩🏽好。');
});

test('append-only second clause emits only new provisional text then full final', () => {
  const policy = createStreamingPolicy();
  observe(policy, '您好。');
  policy.flush({ now: 350 });
  policy.push({ text: '您好。请坐。', now: 400 });
  policy.push({ text: '您好。请坐。', now: 500 });
  const update = policy.flush({ now: 750 });
  assert.equal(update.commits[0].text, '请坐。');
  assert.equal(update.stableText, '您好。请坐。');
  assert.equal(policy.push({ text: '您好。请坐。', isFinal: true, now: 800 }).commits[0].text, '您好。请坐。');
});

test('injected clock supports deterministic silence flush replay', () => {
  let now = 0;
  const policy = createStreamingPolicy({ clock: () => now });
  policy.push({ text: '您好。' });
  now = 100;
  policy.push({ text: '您好。' });
  now = 350;
  assert.equal(policy.flush().commits[0].latencyMs, 350);
  assert.deepEqual(policy.flush().commits, []);
});

test('backward timestamps do not create negative timing or duplicate commits', () => {
  const policy = createStreamingPolicy();
  observe(policy, '您好。', 100);
  assert.equal(policy.flush({ now: 50 }).commits.length, 0);
  assert.equal(policy.flush({ now: 450 }).commits[0].latencyMs, 350);
});

test('force flush releases a complete boundary while keeping incomplete suffix pending', () => {
  const policy = createStreamingPolicy();
  policy.push({ text: '您好。请到', now: 0 });
  const update = policy.flush({ now: 10, force: true });
  assert.equal(update.commits[0].reason, 'forced-boundary');
  assert.equal(update.commits[0].text, '您好。');
  assert.equal(update.pending, '请到');
});

test('empty observations and final results invent no speech', () => {
  const policy = createStreamingPolicy();
  assert.equal(policy.push({ text: '', now: 0 }).reason, 'empty');
  assert.equal(policy.push({ text: ' ', isFinal: true, now: 100 }).commits.length, 0);
  assert.equal(policy.getState().active, false);
});

test('invalid options and input types fail clearly', () => {
  assert.throws(() => createStreamingPolicy({ minStableMs: -1 }), /minStableMs/);
  assert.throws(() => createStreamingPolicy({ minObservations: 0 }), /minObservations/);
  assert.throws(() => createStreamingPolicy({ maxChars: 0 }), /maxChars/);
  assert.throws(() => createStreamingPolicy({ clock: 42 }), /clock/);
  const policy = createStreamingPolicy();
  assert.throws(() => policy.push({ text: 42 }), /text/);
  assert.throws(() => policy.push({ text: 'Hi', now: Infinity }), /timestamp/);
});

test('quoted boundary retains closing quotes with the clause', () => {
  const policy = createStreamingPolicy();
  observe(policy, '她说：“您好。”请坐');
  assert.equal(policy.flush({ now: 350 }).commits[0].text, '她说：“您好。”');
});
