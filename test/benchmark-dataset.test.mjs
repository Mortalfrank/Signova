import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MEMORY_EVALUATION_FIXTURES } from '../public/algorithm-evaluation.js';

// Data validation only: these tests never invoke a provider or a resolver.
const DATA_URL = new URL('../benchmarks/datasets/communication-v1.jsonl', import.meta.url);
const README_URL = new URL('../benchmarks/datasets/README.md', import.meta.url);
const FROZEN_SHA256 = '1eff6ec5559a8e1bf054df0b7125a0f0e9ffadf269a9533194559103eeae2f1d';
const NOW = '2026-10-23T00:00:00Z';
const raw = readFileSync(DATA_URL, 'utf8');
const lines = raw.trimEnd().split('\n');
const rows = lines.map(line => JSON.parse(line));
const domains = ['school', 'bank', 'public_service', 'hospital_administration'];
const categories = { explicit: 12, context_reference: 8, ambiguous: 8, unrelated: 8, correction: 8, negation: 4, conditional: 4, version_scope: 8 };
const countBy = (items, fn) => items.reduce((result, item) => { const key = fn(item); result[key] = (result[key] || 0) + 1; return result; }, {});
const sortedKeys = object => Object.keys(object).sort();
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const asciiId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);

function latestCurrent(row) {
  const records = new Map();
  for (const task of row.tasks.filter(item => item.profile === row.profile)) {
    const previous = records.get(task.id);
    if (!previous || Date.parse(task.updatedAt) > Date.parse(previous.updatedAt)) records.set(task.id, task);
  }
  return records;
}

test('communication-v1 freezes exactly 60 UTF-8 JSONL records with a reproducible hash', () => {
  assert.equal(rows.length, 60);
  assert.equal(lines.length, 60);
  assert.equal(raw.endsWith('\n'), true);
  assert.equal(raw.includes('\r'), false);
  assert.equal(raw.includes('\uFFFD'), false);
  assert.equal(createHash('sha256').update(raw, 'utf8').digest('hex'), FROZEN_SHA256);
  const readme = readFileSync(README_URL, 'utf8');
  assert.ok(readme.includes(FROZEN_SHA256));
  assert.ok(readme.includes(NOW));
  assert.match(readme, /不是独立盲测/);
});

test('communication-v1 has four balanced domains and the declared eight categories', () => {
  assert.deepEqual(countBy(rows, item => item.domain), Object.fromEntries(domains.map(domain => [domain, 15])));
  assert.deepEqual(countBy(rows, item => item.category), categories);
  assert.deepEqual(countBy(rows, item => item.expected.decision), { resolved: 40, ambiguous: 8, none: 8, disabled: 4 });
  assert.deepEqual(countBy(rows, item => item.expected.draft), { required: 20, optional: 8, forbidden: 32 });
  assert.equal(rows.filter(item => !/\p{Script=Han}/u.test(item.text)).length, 7);
});

test('communication-v1 samples have complete typed inputs and a prewritten label rationale', () => {
  const keys = ['id', 'split', 'domain', 'category', 'text', 'knowledge', 'context', 'profile', 'memoryEnabled', 'selectedTaskId', 'tasks', 'expected', 'rationale'].sort();
  for (const row of rows) {
    assert.deepEqual(sortedKeys(row), keys, row.id);
    assert.match(row.id, /^comm-v1-\d{3}$/);
    assert.equal(row.split, 'test');
    assert.ok(domains.includes(row.domain));
    assert.ok(Object.hasOwn(categories, row.category));
    assert.ok(nonempty(row.text) && row.text.length <= 4000);
    assert.ok(nonempty(row.knowledge) && row.knowledge.length <= 12000);
    assert.ok(Array.isArray(row.context) && row.context.length <= 6);
    assert.ok(row.context.every(item => nonempty(item) && item.length <= 1000));
    assert.ok(['personal', 'visitor'].includes(row.profile));
    assert.equal(typeof row.memoryEnabled, 'boolean');
    assert.ok(row.selectedTaskId === null || asciiId(row.selectedTaskId));
    assert.ok(Array.isArray(row.tasks) && row.tasks.length >= 1 && row.tasks.length <= 6);
    assert.ok(nonempty(row.rationale) && row.rationale.length >= 20, row.id);
    assert.ok(!/待补|TODO|TBD/u.test(row.rationale));
  }
});

test('communication-v1 task records are bounded fictional records dated before the frozen clock', () => {
  const keys = ['id', 'profile', 'title', 'action', 'deadline', 'status', 'source', 'updatedAt'].sort();
  for (const row of rows) for (const item of row.tasks) {
    assert.deepEqual(sortedKeys(item), keys, `${row.id}/${item.id}`);
    assert.ok(asciiId(item.id));
    assert.ok(['personal', 'organization-demo'].includes(item.profile));
    assert.ok(nonempty(item.title) && item.title.length <= 80);
    assert.ok(nonempty(item.action) && item.action.length <= 200);
    assert.equal(typeof item.deadline, 'string');
    assert.ok(['pending', 'done'].includes(item.status));
    assert.ok(nonempty(item.source) && item.source.length <= 300);
    assert.match(item.source, /虚构/u);
    assert.doesNotMatch(item.source, /taskId|expected|resolved|ambiguous|正确答案|标注答案/i);
    assert.ok(Number.isFinite(Date.parse(item.updatedAt)));
    assert.ok(Date.parse(item.updatedAt) <= Date.parse(NOW));
  }
});

test('communication-v1 reference labels point only to lawful current-profile records', () => {
  for (const row of rows) {
    assert.deepEqual(sortedKeys(row.expected), ['deadline', 'decision', 'draft', 'taskId'].sort());
    assert.ok(['resolved', 'ambiguous', 'none', 'disabled'].includes(row.expected.decision));
    assert.ok(['required', 'forbidden', 'optional'].includes(row.expected.draft));
    assert.ok(row.expected.deadline === null || nonempty(row.expected.deadline));
    const latest = latestCurrent(row);
    if (row.expected.decision === 'resolved') {
      assert.equal(row.profile, 'personal', row.id);
      assert.equal(row.memoryEnabled, true, row.id);
      assert.ok(asciiId(row.expected.taskId));
      assert.ok(latest.has(row.expected.taskId), row.id);
    } else assert.equal(row.expected.taskId, null, row.id);
    if (row.selectedTaskId !== null) assert.ok(latest.has(row.selectedTaskId), row.id);
    if (row.expected.decision === 'ambiguous') assert.ok(latest.size >= 2, row.id);
  }
});

test('communication-v1 separates reference resolution, action creation and current dates', () => {
  for (const row of rows) {
    const { decision, draft, deadline } = row.expected;
    if (draft === 'required') {
      assert.equal(decision, 'resolved', row.id);
      assert.match(deadline, /^周[一二三四五六日天](?:前|之前)?$/u);
      assert.ok(row.text.includes(deadline), row.id);
      assert.ok(!/[?？]/u.test(row.text), row.id);
    } else assert.equal(deadline, null, row.id);
    if (['ambiguous', 'none', 'disabled'].includes(decision)) assert.equal(draft, 'forbidden', row.id);
    if (['negation', 'conditional'].includes(row.category)) {
      assert.equal(decision, 'resolved', row.id);
      assert.equal(draft, 'forbidden', row.id);
    }
    if (row.category === 'correction') assert.equal(draft, 'required', row.id);
    if (row.category === 'unrelated') assert.equal(decision, 'none', row.id);
  }
});

test('communication-v1 includes explicit profile/permission isolation and real version conflicts', () => {
  const isolated = rows.filter(row => !row.memoryEnabled || row.profile === 'visitor');
  assert.equal(isolated.length, 4);
  for (const row of rows) assert.equal(row.expected.decision === 'disabled', !row.memoryEnabled || row.profile === 'visitor', row.id);
  const versionCases = rows.filter(row => row.tasks.some((task, index) => row.tasks.findIndex(item => item.id === task.id && item.profile === task.profile) !== index));
  assert.equal(versionCases.length, 4);
  for (const row of versionCases) {
    assert.equal(row.category, 'version_scope');
    const targetVersions = row.tasks.filter(item => item.profile === row.profile && item.id === row.expected.taskId);
    assert.equal(targetVersions.length, 2);
    assert.notEqual(targetVersions[0].updatedAt, targetVersions[1].updatedAt);
    assert.notEqual(targetVersions[0].deadline, targetVersions[1].deadline);
    assert.ok(row.tasks.some(item => item.profile !== row.profile));
    const latest = latestCurrent(row).get(row.expected.taskId);
    assert.equal(latest.updatedAt, targetVersions.map(item => item.updatedAt).sort().at(-1));
  }
});

test('communication-v1 has unique IDs and fresh utterances rather than old fixture copies', () => {
  assert.equal(new Set(rows.map(item => item.id)).size, rows.length);
  const normalizedTexts = rows.map(item => item.text.normalize('NFKC').trim());
  assert.equal(new Set(normalizedTexts).size, rows.length);
  const legacyTexts = new Set(MEMORY_EVALUATION_FIXTURES.map(item => item.input.text.normalize('NFKC').trim()));
  for (const text of normalizedTexts) assert.equal(legacyTexts.has(text), false, text);
});
