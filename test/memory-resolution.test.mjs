import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMemoryContext } from '../public/memory-resolution.js';

const NOW = '2026-10-22T08:00:00.000Z';
const internship = { id: 'internship', profile: 'personal', title: '实习申请', action: '补交实习证明', deadline: '周五', status: 'pending', source: '本人确认', updatedAt: '2026-10-20T08:00:00Z', history: [{ deadline: '周三', action: '旧的私密行动', source: 'private history' }] };
const transcript = { id: 'transcript', profile: 'personal', title: '成绩单申请', action: '提交成绩单', deadline: '周一', status: 'pending', updatedAt: '2026-10-21T08:00:00Z' };
const resolve = (overrides = {}) => resolveMemoryContext({ tasks: [internship, transcript], profile: 'personal', enabled: true, now: NOW, ...overrides });

test('card/item colloquial references use the recent topic and unanchored ones ask for a choice', () => {
  for (const text of ['这张票据需要重印吗？', '上回那项什么时候办好？']) {
    const result = resolve({ text, context: ['现在确认成绩单申请。'] });
    assert.equal(result.status, 'resolved', text);
    assert.equal(result.selectedTaskId, 'transcript', text);
  }
  assert.equal(resolve({ text: '上回那项什么时候办好？' }).status, 'ambiguous');
});

test('spoken slip corrections may anchor a topic without repeating its name', () => {
  const result = resolve({ text: '刚才我讲错了，周日那版作废，周二前交。', context: ['现在说实习申请。'] });
  assert.equal(result.selectedTaskId, 'internship');
  assert.equal(result.memories[0].deadline, '周五');
});

test('generic demonstratives in unrelated entertainment do not invent a task reference', () => {
  assert.equal(resolve({ text: '这个纪录片的片尾曲叫什么名字？' }).status, 'none');
  assert.equal(resolve({ text: '这张照片的光线很好看。' }).status, 'none');
});

test('disabled and visitor never disclose candidate identifiers or memories', () => {
  for (const options of [{ enabled: false }, { enabled: 'true' }, { profile: 'visitor' }, { profile: '' }]) {
    assert.deepEqual(resolve({ text: '实习证明', ...options }), { status: 'disabled', memories: [], selectedTaskId: null, candidates: [], clarification: null, evidence: [] });
  }
});

test('explicit material resolves relevant latest task without filling unrelated records', () => {
  const result = resolve({ text: '我来补交实习证明。' });
  assert.equal(result.status, 'resolved');
  assert.equal(result.selectedTaskId, 'internship');
  assert.equal(result.memories.length, 1);
});

test('ordinary unrelated conversation sends no recent tasks', () => {
  const result = resolve({ text: '今天天气很不错，我们去吃午饭吧。' });
  assert.equal(result.status, 'none');
  assert.deepEqual(result.memories, []);
  assert.deepEqual(result.candidates, []);
});

test('generic material and deadline words alone do not match a task', () => {
  const result = resolve({ text: '请问提交材料的截止时间是什么时候？' });
  assert.equal(result.status, 'none');
});

test('date correction uses conversation anchor and never reintroduces old deadline', () => {
  const text = '更正一下，截止时间改为周一，不是周五。';
  const result = resolve({ text, context: ['实习证明需要在哪里提交？'] });
  assert.equal(result.selectedTaskId, 'internship');
  assert.equal(result.memories[0].deadline, '周五');
  assert.ok(result.evidence.some(item => item.kind === 'current_statement_priority'));
  assert.ok(!JSON.stringify(result).includes('周三'));
  assert.equal(text, '更正一下，截止时间改为周一，不是周五。');
});

test('current named task takes precedence over a different context anchor', () => {
  const result = resolve({ text: '成绩单的截止时间改到周五。', context: ['上次还缺实习证明'] });
  assert.equal(result.selectedTaskId, 'transcript');
  assert.deepEqual(result.memories.map(item => item.id), ['transcript']);
});

test('new named material cannot be replaced by a prior topic', () => {
  const result = resolve({ text: '这次身份证改到周五办理。', context: ['上次还缺实习证明'] });
  assert.equal(result.status, 'none');
  assert.ok(result.evidence.some(item => item.kind === 'current_topic_unmatched'));
});

test('unanchored pronoun requests clarification even when only one task exists', () => {
  const result = resolve({ tasks: [internship], text: '上次那份，日期改成周一。' });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.selectedTaskId, null);
  assert.deepEqual(result.memories, []);
  assert.match(result.clarification, /实习申请/);
});

test('two near-identical tasks remain ambiguous despite different timestamps and status', () => {
  const old = { ...internship, id: 'old', status: 'done', updatedAt: '2025-01-01' };
  const result = resolve({ tasks: [old, internship], text: '实习证明要再提交一次。' });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.selectedTaskId, null);
  assert.equal(result.candidates.length, 2);
});

test('two explicitly named materials are not silently bound to the first one', () => {
  const result = resolve({ text: '实习证明和成绩单都要补交。' });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.selectedTaskId, null);
});

test('limited material aliases work across English and Chinese', () => {
  const result = resolve({ text: 'Where should I submit the internship certificate?' });
  assert.equal(result.selectedTaskId, 'internship');
  assert.ok(result.candidates[0].reasons.some(reason => reason.includes('限定术语')));
});

test('English word boundaries prevent substring alias matches', () => {
  const result = resolve({ tasks: [{ ...transcript, title: 'Archive', action: 'transcript' }], text: 'transcription software is installed' });
  assert.equal(result.status, 'none');
});

test('explicit user selection resolves an otherwise ambiguous pronoun', () => {
  const result = resolve({ text: '那份改为下周一。', selectedTaskId: 'internship' });
  assert.equal(result.status, 'resolved');
  assert.equal(result.selectedTaskId, 'internship');
  assert.ok(result.candidates[0].reasons.includes('本人已明确选择此事项'));
});

test('a stale selection cannot override a newly named task', () => {
  const result = resolve({ text: '成绩单要改时间。', selectedTaskId: 'internship' });
  assert.equal(result.selectedTaskId, 'transcript');
  assert.ok(result.evidence.some(item => item.kind === 'selection_topic_conflict'));
});

test('cross-profile and nonexistent explicit identifiers fail closed', () => {
  const privateTask = { ...internship, id: 'private', profile: 'another', title: 'Private medical record' };
  for (const selectedTaskId of ['private', 'missing']) {
    const result = resolve({ tasks: [internship, privateTask], text: '实习证明', selectedTaskId });
    assert.equal(result.status, 'none');
    assert.deepEqual(result.memories, []);
    assert.ok(!JSON.stringify(result).includes('Private medical record'));
  }
});

test('duplicate task records choose the newest top-level version, never history', () => {
  const result = resolve({ tasks: [{ ...internship, deadline: '周三', updatedAt: '2026-10-01' }, internship], text: '实习证明' });
  assert.equal(result.memories.length, 1);
  assert.equal(result.memories[0].deadline, '周五');
  assert.ok(!('history' in result.memories[0]));
  assert.ok(!('profile' in result.memories[0]));
  assert.ok(!JSON.stringify(result).includes('private history'));
});

test('negative topic is removed before selecting the affirmative new topic', () => {
  const result = resolve({ text: '不是实习证明，是成绩单的日期改为周五。' });
  assert.equal(result.selectedTaskId, 'transcript');
});

test('a topic switch without punctuation retains the affirmative new material', () => {
  const result = resolve({ text: '不是实习证明而是成绩单要改到周五。', context: ['实习证明'] });
  assert.equal(result.selectedTaskId, 'transcript');
});

test('English not-but topic switch does not retrieve the negated material', () => {
  const result = resolve({ text: 'Not the internship certificate but the transcript needs a correction.' });
  assert.equal(result.selectedTaskId, 'transcript');
});

test('latest conversation topic anchors instead of older topics', () => {
  const result = resolve({ text: '那份改成周五。', context: ['实习证明', { text: '成绩单' }, '好的'] });
  assert.equal(result.selectedTaskId, 'transcript');
});

test('intervening unrelated substantive topic prevents stale context binding', () => {
  const result = resolve({ text: '那个日期改为周五。', context: ['实习证明', '今天中午去吃面条'] });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.selectedTaskId, null);
  assert.ok(result.evidence.some(item => item.kind === 'context_interrupted'));
});

test('inherited fields, custom prototypes, and accessors do not enter retrieval', () => {
  let reads = 0;
  const getterTask = { ...internship, id: 'getter' };
  Object.defineProperty(getterTask, 'title', { enumerable: true, get() { reads++; throw new Error('not data'); } });
  const inherited = Object.create(internship);
  const result = resolve({ tasks: [inherited, getterTask, { ...internship, id: '__proto__' }], text: '实习证明' });
  assert.equal(reads, 0);
  assert.ok(!result.memories.some(item => item.id === '__proto__'));
  assert.equal(result.memories.length, 1);
});

test('frozen inputs are unchanged and returned records are independent copies', () => {
  const task = Object.freeze({ ...internship, history: Object.freeze([...internship.history]) });
  const tasks = Object.freeze([task]);
  const before = JSON.stringify(tasks);
  const result = resolve({ tasks, text: '实习证明' });
  result.memories[0].deadline = 'changed outside';
  assert.equal(JSON.stringify(tasks), before);
});

test('very long user text and field payloads have bounded processing and output', () => {
  const longTask = { ...internship, title: '实习申请' + 'X'.repeat(100000), action: '实习证明' + 'Y'.repeat(100000), source: 'Z'.repeat(100000) };
  const result = resolve({ tasks: [longTask], text: '实习证明' + '文'.repeat(100000) });
  assert.equal(result.selectedTaskId, 'internship');
  assert.ok(result.memories[0].title.length <= 80);
  assert.ok(result.memories[0].action.length <= 200);
  assert.ok(result.memories[0].source.length <= 300);
  assert.ok(JSON.stringify(result).length < 3000);
});

test('invalid option values are safely ignored without string coercion', () => {
  assert.equal(resolveMemoryContext(null).status, 'disabled');
  assert.equal(resolveMemoryContext({ enabled: true, profile: { toString() { throw new Error('unsafe'); } } }).status, 'disabled');
  const result = resolve({ tasks: null, text: { toString() { throw new Error('unsafe'); } } });
  assert.equal(result.status, 'none');
});

test('overlong profile and selected identifiers are rejected instead of prefix-matched', () => {
  const profile = 'P'.repeat(80);
  assert.equal(resolve({ tasks: [{ ...internship, profile }], profile: profile + 'private', text: '实习证明' }).status, 'disabled');
  const id = 'I'.repeat(120);
  const result = resolve({ tasks: [{ ...internship, id }], selectedTaskId: id + 'suffix', text: '实习证明' });
  assert.equal(result.status, 'none');
  assert.deepEqual(result.memories, []);
});

test('a valid latest timestamp beats an invalid or older duplicate timestamp', () => {
  const result = resolve({ tasks: [
    { ...internship, deadline: 'OLD', updatedAt: 'not-a-date' },
    internship,
    { ...internship, deadline: 'OLDER', updatedAt: '2020-01-01' }
  ], text: '实习证明' });
  assert.equal(result.memories[0].deadline, '周五');
});

test('old dates in dialogue identify a task but never replace its latest stored version', () => {
  const result = resolve({ text: '上次那份还需要补吗？', context: [{ text: '实习证明上次要求周三交。' }] });
  assert.equal(result.selectedTaskId, 'internship');
  assert.equal(result.memories[0].deadline, '周五');
  assert.ok(!JSON.stringify(result).includes('周三'));
});

test('more than six context entries cannot reactivate a remote old topic', () => {
  const result = resolve({ text: '那份的日期改为周五。', context: ['实习证明', ...Array(6).fill('好的')] });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.selectedTaskId, null);
});

test('ties use deterministic identifiers and at most six sanitized candidates', () => {
  const tasks = Array.from({ length: 12 }, (_, index) => ({ ...internship, id: String(11 - index).padStart(2, '0') }));
  const first = resolve({ tasks, text: '实习证明' });
  const second = resolve({ tasks: [...tasks].reverse(), text: '实习证明' });
  assert.deepEqual(first, second);
  assert.equal(first.memories.length, 6);
  assert.equal(first.candidates.length, 6);
});
