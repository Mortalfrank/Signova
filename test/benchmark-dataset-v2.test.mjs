import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Pure data validation: no production parser, provider, environment file or result files.
const SHA = '7b167c456400341b0de015cff9e2d1adb702e9a868f4edc8d80264d4ee901b24';
const NOW = '2026-10-23T00:00:00Z';
const raw = readFileSync(new URL('../benchmarks/datasets/communication-v2.jsonl', import.meta.url), 'utf8');
const rows = raw.trimEnd().split('\n').map(line => JSON.parse(line));
const v1 = readFileSync(new URL('../benchmarks/datasets/communication-v1.jsonl', import.meta.url), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
const readme = readFileSync(new URL('../benchmarks/datasets/communication-v2.md', import.meta.url), 'utf8');
const domainCounts = { school: 15, bank: 15, public_service: 15, hospital_administration: 15 };
const categoryCounts = { explicit: 12, context_reference: 8, ambiguous: 8, unrelated: 8, correction: 8, negation: 4, conditional: 4, version_scope: 8 };
const count = (items, fn) => items.reduce((out, item) => { const key = fn(item); out[key] = (out[key] || 0) + 1; return out; }, {});
const keys = item => Object.keys(item).sort();
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const latestCurrent = row => {
  const latest = new Map();
  for (const record of row.tasks.filter(item => item.profile === row.profile)) {
    if (!latest.has(record.id) || Date.parse(record.updatedAt) > Date.parse(latest.get(record.id).updatedAt)) latest.set(record.id, record);
  }
  return latest;
};

test('communication-v2 freezes 60 UTF-8 LF records at the declared SHA-256', () => {
  assert.equal(rows.length, 60);
  assert.equal(raw.trimEnd().split('\n').length, 60);
  assert.equal(raw.endsWith('\n'), true);
  assert.equal(raw.includes('\r'), false);
  assert.equal(raw.includes('\uFFFD'), false);
  assert.equal(createHash('sha256').update(raw, 'utf8').digest('hex'), SHA);
  assert.ok(readme.includes(SHA));
  assert.ok(readme.includes(NOW));
  assert.match(readme, /AI 辅助构建/);
  assert.match(readme, /尚未经独立人工复核/);
});

test('communication-v2 keeps the four-domain eight-category allocation', () => {
  assert.deepEqual(count(rows, row => row.domain), domainCounts);
  assert.deepEqual(count(rows, row => row.category), categoryCounts);
  assert.deepEqual(count(rows, row => row.expected.decision), { resolved: 40, ambiguous: 8, none: 8, disabled: 4 });
  assert.deepEqual(count(rows, row => row.expected.draft), { required: 22, optional: 8, forbidden: 30 });
  assert.equal(rows.filter(row => !/\p{Script=Han}/u.test(row.text)).length, 7);
});

test('communication-v2 supplies complete typed input and separate label-intent explanation', () => {
  const required = ['id', 'split', 'domain', 'category', 'text', 'knowledge', 'context', 'profile', 'memoryEnabled', 'selectedTaskId', 'tasks', 'expected', 'rationale'].sort();
  for (const row of rows) {
    assert.deepEqual(keys(row), required, row.id);
    assert.match(row.id, /^comm-v2-\d{3}$/);
    assert.equal(row.split, 'test');
    assert.ok(Object.hasOwn(domainCounts, row.domain));
    assert.ok(Object.hasOwn(categoryCounts, row.category));
    assert.ok(nonempty(row.text) && row.text.length <= 4000);
    assert.ok(nonempty(row.knowledge) && row.knowledge.length <= 12000);
    assert.ok(Array.isArray(row.context) && row.context.length <= 6);
    assert.ok(row.context.every(item => nonempty(item) && item.length <= 1000));
    assert.ok(['personal', 'visitor'].includes(row.profile));
    assert.equal(typeof row.memoryEnabled, 'boolean');
    assert.ok(row.selectedTaskId === null || validId(row.selectedTaskId));
    assert.ok(Array.isArray(row.tasks) && row.tasks.length >= 1 && row.tasks.length <= 6);
    assert.ok(nonempty(row.rationale) && row.rationale.length >= 20, row.id);
    assert.doesNotMatch(row.rationale, /TODO|TBD|待补/u);
  }
});

test('communication-v2 records have safe IDs, complete fields and timestamps before the fixed clock', () => {
  const required = ['id', 'profile', 'title', 'action', 'deadline', 'status', 'source', 'updatedAt'].sort();
  for (const row of rows) for (const record of row.tasks) {
    assert.deepEqual(keys(record), required, `${row.id}/${record.id}`);
    assert.ok(validId(record.id));
    assert.ok(['personal', 'organization-demo'].includes(record.profile));
    assert.ok(nonempty(record.title) && record.title.length <= 80);
    assert.ok(nonempty(record.action) && record.action.length <= 200);
    assert.equal(typeof record.deadline, 'string');
    assert.ok(['pending', 'done'].includes(record.status));
    assert.ok(nonempty(record.source) && record.source.length <= 300);
    assert.match(record.source, /合成/u);
    assert.doesNotMatch(record.source, /expected|taskId|resolved|ambiguous|正确答案|标注答案/i);
    assert.ok(Number.isFinite(Date.parse(record.updatedAt)));
    assert.ok(Date.parse(record.updatedAt) <= Date.parse(NOW));
  }
});

test('communication-v2 resolved labels reference only current-profile latest valid IDs', () => {
  for (const row of rows) {
    assert.deepEqual(keys(row.expected), ['decision', 'taskId', 'draft', 'deadline'].sort());
    assert.ok(['resolved', 'ambiguous', 'none', 'disabled'].includes(row.expected.decision));
    assert.ok(['required', 'optional', 'forbidden'].includes(row.expected.draft));
    assert.ok(row.expected.deadline === null || nonempty(row.expected.deadline));
    const current = latestCurrent(row);
    if (row.expected.decision === 'resolved') {
      assert.equal(row.profile, 'personal', row.id);
      assert.equal(row.memoryEnabled, true, row.id);
      assert.ok(validId(row.expected.taskId));
      assert.ok(current.has(row.expected.taskId), row.id);
    } else assert.equal(row.expected.taskId, null, row.id);
    if (row.selectedTaskId !== null) assert.ok(current.has(row.selectedTaskId));
    if (row.expected.decision === 'ambiguous') assert.ok(current.size >= 2, row.id);
  }
});

test('communication-v2 action labels preserve current dates and do not turn questions into actions', () => {
  for (const row of rows) {
    const { decision, draft, deadline } = row.expected;
    if (draft === 'required') {
      assert.ok(['resolved', 'disabled'].includes(decision), row.id);
      assert.ok(nonempty(deadline) && row.text.includes(deadline), row.id);
      assert.doesNotMatch(row.text, /[?？]/u);
    } else assert.equal(deadline, null, row.id);
    if (/[?？]/u.test(row.text)) assert.equal(draft, 'forbidden', row.id);
    if (['ambiguous', 'none'].includes(decision)) assert.equal(draft, 'forbidden', row.id);
    if (['conditional', 'negation'].includes(row.category)) {
      assert.equal(decision, 'resolved', row.id);
      assert.equal(draft, 'forbidden', row.id);
    }
    if (row.category === 'correction') assert.equal(draft, 'required', row.id);
    if (row.category === 'unrelated') assert.equal(decision, 'none', row.id);
  }
});

test('communication-v2 permits explicit new drafts while disabled memory still blocks old IDs', () => {
  const isolated = rows.filter(row => !row.memoryEnabled || row.profile === 'visitor');
  assert.equal(isolated.length, 4);
  assert.equal(isolated.filter(row => row.expected.draft === 'required').length, 2);
  assert.equal(isolated.filter(row => row.expected.draft === 'forbidden').length, 2);
  for (const row of rows) {
    assert.equal(row.expected.decision === 'disabled', !row.memoryEnabled || row.profile === 'visitor', row.id);
    if (row.expected.decision === 'disabled') {
      assert.equal(row.expected.taskId, null, row.id);
      assert.equal(row.selectedTaskId, null, row.id);
    }
  }
});

test('communication-v2 includes four genuine duplicate-version and cross-profile challenges', () => {
  const versions = rows.filter(row => new Set(row.tasks.map(item => `${item.profile}/${item.id}`)).size < row.tasks.length);
  assert.equal(versions.length, 4);
  for (const row of versions) {
    assert.equal(row.category, 'version_scope');
    const target = row.tasks.filter(record => record.id === row.expected.taskId && record.profile === row.profile);
    assert.equal(target.length, 2);
    assert.notEqual(target[0].updatedAt, target[1].updatedAt);
    assert.notEqual(target[0].action, target[1].action);
    assert.notEqual(target[0].deadline, target[1].deadline);
    assert.ok(row.tasks.some(record => record.profile !== row.profile));
    assert.equal(latestCurrent(row).get(row.expected.taskId).updatedAt, target.map(record => record.updatedAt).sort().at(-1));
  }
});

test('communication-v2 temporal labels retain week, before/after and day-part constraints', () => {
  const deadlines = rows.filter(row => row.expected.draft === 'required').map(row => row.expected.deadline);
  assert.ok(deadlines.some(value => value.includes('下周')));
  assert.ok(deadlines.some(value => value.includes('之前')));
  assert.ok(deadlines.some(value => value.includes('之后')));
  assert.ok(deadlines.some(value => value.includes('中午前')));
  assert.ok(deadlines.some(value => value.includes('下午')));
  assert.ok(deadlines.some(value => value.includes('早上')));
  assert.ok(deadlines.some(value => /\d+月\d+日/u.test(value)));
});

test('communication-v2 has unique IDs, fresh utterances, fresh record titles and new scene knowledge', () => {
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.equal(new Set(rows.map(row => row.text.normalize('NFKC').trim())).size, rows.length);
  const oldTexts = new Set(v1.map(row => row.text.normalize('NFKC').trim()));
  const oldTitles = new Set(v1.flatMap(row => row.tasks.map(record => record.title.normalize('NFKC').trim())));
  const oldKnowledge = new Set(v1.map(row => row.knowledge));
  for (const row of rows) {
    assert.equal(oldTexts.has(row.text.normalize('NFKC').trim()), false, row.id);
    assert.equal(oldKnowledge.has(row.knowledge), false, row.id);
    for (const record of row.tasks) assert.equal(oldTitles.has(record.title.normalize('NFKC').trim()), false, record.title);
  }
});
