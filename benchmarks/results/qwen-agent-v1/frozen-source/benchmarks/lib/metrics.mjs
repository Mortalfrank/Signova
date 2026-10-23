/** Reproducible case-level metrics. Missing measurements remain unknown. */
const BOOTSTRAP_SEED = 20261023;
const BOOTSTRAP_ITERATIONS = 2000;
const TOKEN_FIELDS = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
const finiteNonNegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

// Only weekday spellings are equivalent: "本周" and "下周" remain distinct.
function canonicalDeadline(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim()
      .replace(/(?:星期|周)([一二三四五六日天])/gu, (_, day) => `周${day === '天' ? '日' : day}`)
      .replace(/之前/gu, '前').replace(/之后/gu, '后')
    : value;
}

export function scoreCase(sample, output) {
  if (!sample?.expected) throw new TypeError('sample.expected is required');
  const expected = sample.expected;
  const error = !output || typeof output !== 'object' || Boolean(output.error);
  const taskId = output?.taskId ?? null;
  const suggestedTaskId = output?.suggestedTaskId ?? null;
  const expectedId = expected.taskId ?? null;
  const hasDraft = output?.draft !== null && typeof output?.draft === 'object' && !Array.isArray(output.draft);
  const deadlineApplicable = expected.draft === 'required' && expected.deadline != null;
  const decisionCorrect = !error && output.decision === expected.decision && taskId === expectedId;
  const wrongBinding = (taskId !== null && taskId !== expectedId)
    || (suggestedTaskId !== null && suggestedTaskId !== expectedId);
  const updateTargetApplicable = expected.draft === 'required' || (hasDraft && expected.decision === 'resolved');
  const updateTargetCorrect = !updateTargetApplicable || (!error && suggestedTaskId === expectedId);
  const draftCorrect = !error && (expected.draft === 'optional'
    || (expected.draft === 'required' && hasDraft)
    || (expected.draft === 'forbidden' && output.draft == null));
  const deadlineCorrect = !deadlineApplicable || (!error && hasDraft
    && canonicalDeadline(output.draft.deadline) === canonicalDeadline(expected.deadline));
  return {
    decisionCorrect, wrongBinding, draftCorrect, deadlineApplicable, deadlineCorrect,
    updateTargetApplicable, updateTargetCorrect,
    taskSuccess: decisionCorrect && !wrongBinding && draftCorrect && deadlineCorrect && updateTargetCorrect,
    error,
  };
}

function scoreRow(row) {
  return scoreCase(row.sample, row.error ? { ...(row.output ?? {}), error: row.error } : row.output);
}

function nearestRank(sorted, percentile) {
  return sorted.length ? sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)] : null;
}

function summarize(values) {
  const sorted = values.filter(finiteNonNegative).sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
  };
}

function tokenValue(row, field) {
  if (row.modelCalled === false) return 0;
  return finiteNonNegative(row.usage?.[field]) ? row.usage[field] : null;
}

function timeValue(row, field) {
  if (field === 'modelMs' && row.modelCalled === false) return 0;
  return finiteNonNegative(row.timing?.[field]) ? row.timing[field] : null;
}

export function aggregateArm(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const scores = rows.map(scoreRow);
  const count = key => scores.filter(score => score[key]).length;
  const deadlineApplicableCases = count('deadlineApplicable');
  const deadlineCorrectCases = scores.filter(score => score.deadlineApplicable && score.deadlineCorrect).length;
  const updateTargetApplicableCases = count('updateTargetApplicable');
  const updateTargetCorrectCases = scores.filter(score => score.updateTargetApplicable && score.updateTargetCorrect).length;
  const missingUsageCount = rows.filter(row => row.modelCalled !== false
    && TOKEN_FIELDS.some(field => tokenValue(row, field) === null)).length;
  const counts = {
    cases: rows.length,
    successfulCases: count('taskSuccess'),
    decisionCorrectCases: count('decisionCorrect'),
    wrongBindingCases: count('wrongBinding'),
    draftCorrectCases: count('draftCorrect'),
    deadlineApplicableCases,
    deadlineCorrectCases,
    updateTargetApplicableCases,
    updateTargetCorrectCases,
    modelCalledCases: rows.filter(row => row.modelCalled === true).length,
    errorCases: count('error'),
    missingUsageCount,
  };
  const tokens = Object.fromEntries(TOKEN_FIELDS.map(field => {
    const values = rows.map(row => tokenValue(row, field)).filter(value => value !== null);
    const total = values.reduce((sum, value) => sum + value, 0);
    return [field, { total, mean: ratio(total, values.length), count: values.length }];
  }));
  return {
    counts,
    rates: {
      taskSuccess: ratio(counts.successfulCases, rows.length),
      decisionCorrect: ratio(counts.decisionCorrectCases, rows.length),
      wrongBinding: ratio(counts.wrongBindingCases, rows.length),
      draftCorrect: ratio(counts.draftCorrectCases, rows.length),
      deadlineCorrect: ratio(deadlineCorrectCases, deadlineApplicableCases),
      updateTargetCorrect: ratio(updateTargetCorrectCases, updateTargetApplicableCases),
    },
    latency: {
      method: 'nearest-rank',
      totalMs: summarize(rows.map(row => timeValue(row, 'totalMs'))),
      modelMs: summarize(rows.map(row => timeValue(row, 'modelMs'))),
    },
    tokens,
    missingUsageCount,
  };
}

function indexRows(rows, label) {
  const result = new Map();
  for (const row of rows) {
    const id = row.sample?.id;
    if (typeof id !== 'string' || !id) throw new TypeError(`${label}: every sample needs a nonempty string id`);
    if (result.has(id)) throw new Error(`${label}: duplicate sample id ${id}`);
    result.set(id, row);
  }
  return result;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pairedReduction(pairs, getValue) {
  const values = pairs.map(([baseline, candidate]) => [getValue(baseline), getValue(candidate)])
    .filter(([baseline, candidate]) => baseline !== null && candidate !== null);
  if (!values.length) return { matchedCases: 0, baselineMean: null, candidateMean: null, absoluteReduction: null, reductionPct: null };
  const baselineMean = values.reduce((sum, [value]) => sum + value, 0) / values.length;
  const candidateMean = values.reduce((sum, [, value]) => sum + value, 0) / values.length;
  const absoluteReduction = baselineMean - candidateMean;
  return {
    matchedCases: values.length, baselineMean, candidateMean, absoluteReduction,
    reductionPct: baselineMean === 0 ? null : absoluteReduction / baselineMean * 100,
  };
}

export function pairedComparison(baselineRows, candidateRows) {
  const baseline = indexRows(baselineRows, 'baseline');
  const candidate = indexRows(candidateRows, 'candidate');
  // Sort identifiers so reordering input rows cannot change the fixed-seed CI.
  const ids = [...baseline.keys()].filter(id => candidate.has(id)).sort();
  if (!ids.length) throw new Error('No paired sample ids');
  const pairs = ids.map(id => [baseline.get(id), candidate.get(id)]);
  const outcomes = pairs.map(([before, after]) => [Number(scoreRow(before).taskSuccess), Number(scoreRow(after).taskSuccess)]);
  const differences = outcomes.map(([before, after]) => after - before);
  const baselineRate = outcomes.reduce((sum, [before]) => sum + before, 0) / pairs.length;
  const candidateRate = outcomes.reduce((sum, [, after]) => sum + after, 0) / pairs.length;
  const random = seededRandom(BOOTSTRAP_SEED);
  const bootstrap = [];
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration++) {
    let sum = 0;
    for (let index = 0; index < differences.length; index++) sum += differences[Math.floor(random() * differences.length)];
    bootstrap.push(sum / differences.length * 100);
  }
  bootstrap.sort((a, b) => a - b);
  return {
    pairedCases: pairs.length,
    unpaired: { baseline: baseline.size - pairs.length, candidate: candidate.size - pairs.length },
    taskSuccess: {
      baselineRate, candidateRate, improvementPp: (candidateRate - baselineRate) * 100,
      bootstrap95CiPp: [nearestRank(bootstrap, 0.025), nearestRank(bootstrap, 0.975)],
      bootstrap: { method: 'paired-percentile-nearest-rank', iterations: BOOTSTRAP_ITERATIONS, seed: BOOTSTRAP_SEED },
    },
    tokens: Object.fromEntries(TOKEN_FIELDS.map(field => [field, pairedReduction(pairs, row => tokenValue(row, field))])),
    latency: Object.fromEntries(['totalMs', 'modelMs'].map(field => [field, pairedReduction(pairs, row => timeValue(row, field))])),
  };
}
