/**
 * A deterministic commit policy for cumulative ASR hypotheses from ONE sentence.
 * Commits are cancellable semantic-analysis inputs, never permission to play a
 * hand-sign animation. Stable source words need not be a stable target-language
 * expression. The caller must keep preview, analysis and playback independent.
 *
 * Repeated observations + a quiet interval + an explicit clause boundary make
 * a partial eligible. Dates, numbers, negation, conditions and corrections wait
 * longer. This is a conservative heuristic, not a trained translation model.
 *
 * Usage:
 *   const policy = createStreamingPolicy();
 *   const update = policy.push({ text: hypothesis, isFinal, sentenceId });
 *   cancelAnalysis(update.revision?.retractIds || []);
 *   for (const commit of update.commits) analyze(commit.text, commit.id);
 *   // A timer may call policy.flush({ now: performance.now() }); if push uses
 *   // that same clock. It must handle commits/revisions exactly like push.
 *
 * Final commits always contain the ENTIRE recognized sentence and replace any
 * provisional commits. The caller should cancel replacesIds before analyzing
 * a final commit. No prefix is removed from a final sentence. Starting a new
 * partial (or changing sentenceId) permits a new sentence with identical text.
 * Supplying sentenceId is recommended: without it, consecutive identical final
 * events with no intervening partial cannot be distinguished from duplicates.
 */
export function createStreamingPolicy(options = {}) {
  const settings = {
    minStableMs: nonnegative(options.minStableMs, 350, 'minStableMs'),
    riskStableMs: nonnegative(options.riskStableMs, 800, 'riskStableMs'),
    minObservations: positiveInteger(options.minObservations, 2, 'minObservations'),
    maxChars: positiveInteger(options.maxChars, 4000, 'maxChars'),
  };
  settings.riskStableMs = Math.max(settings.minStableMs, settings.riskStableMs);
  const clock = options.clock ?? options.now ?? Date.now;
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  let active = null;
  let lastFinal = null;
  let nextId = 1;
  let nextSentence = 1;
  let lastNow = -Infinity;

  function time(value) {
    const resolved = value ?? clock();
    if (!Number.isFinite(resolved)) throw new TypeError('now must be a finite timestamp');
    // ASR events may arrive out of order; waiting time must never be negative.
    lastNow = Math.max(lastNow, resolved);
    return lastNow;
  }

  function begin(text, now, sentenceId) {
    return {
      text, sentenceId: sentenceId ?? `sentence-${nextSentence++}`,
      externalId: sentenceId, observedAt: now, changedAt: now,
      commits: [], committedEnd: 0, candidates: new Map(),
    };
  }

  function result({ commits = [], revision, reason = 'waiting', finalText } = {}) {
    const text = finalText ?? active?.text ?? lastFinal?.text ?? '';
    const stableText = finalText ?? (active ? active.text.slice(0, active.committedEnd) : lastFinal?.text ?? '');
    return {
      preview: text,
      stableText,
      commits,
      ...(revision ? { revision } : {}),
      pending: finalText !== undefined ? '' : active ? active.text.slice(active.committedEnd) : '',
      reason,
    };
  }

  function updateCandidates(now) {
    const previous = active.candidates;
    const next = new Map();
    for (const end of clauseEnds(active.text)) {
      if (end <= active.committedEnd) continue;
      const prefix = active.text.slice(0, end);
      const retained = previous.get(prefix);
      next.set(prefix, retained
        ? { ...retained, observations: retained.observations + 1, end }
        : { observedAt: now, observations: 1, end });
    }
    active.candidates = next;
  }

  function commitReady(now, force = false) {
    if (!active) return result({ reason: 'idle' });
    const risky = hasRisk(active.text);
    const waitMs = risky ? settings.riskStableMs : settings.minStableMs;
    let eligible;
    for (const candidate of active.candidates.values()) {
      if (candidate.end <= active.committedEnd) continue;
      if (force || (candidate.observations >= settings.minObservations &&
          now - candidate.observedAt >= waitMs && now - active.changedAt >= waitMs)) eligible = candidate;
    }
    if (!eligible) return result({ reason: !active.candidates.size ? 'awaiting-boundary' : risky ? 'risk-wait' : 'stability-wait' });
    const text = active.text.slice(active.committedEnd, eligible.end);
    const reason = force ? 'forced-boundary' : risky ? 'risk-stable-boundary' : 'stable-boundary';
    const commit = {
      id: `stream-${nextId++}`, sentenceId: active.sentenceId, text, reason,
      observedAt: eligible.observedAt, committedAt: now,
      latencyMs: Math.max(0, now - eligible.observedAt), provisional: true,
    };
    active.committedEnd = eligible.end;
    active.commits.push(commit);
    for (const [prefix, candidate] of active.candidates) {
      if (candidate.end <= active.committedEnd) active.candidates.delete(prefix);
    }
    return result({ commits: [commit], reason });
  }

  function push({ text, isFinal = false, now, sentenceId } = {}) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    // Refuse oversized hypotheses instead of silently dropping final words.
    if ([...text].length > settings.maxChars) throw new RangeError(`ASR hypothesis exceeds maxChars (${settings.maxChars})`);
    const at = time(now);
    if (!text.trim()) return result({ reason: 'empty' });
    let revision;
    const changedSentence = active && sentenceId !== undefined && active.externalId !== undefined && sentenceId !== active.externalId;
    if (changedSentence) {
      revision = retract(active, text, 'sentence-replaced');
      active = null;
    }
    if (isFinal && !active && lastFinal && lastFinal.text === text &&
        (sentenceId === undefined || sentenceId === lastFinal.externalId)) {
      return result({ reason: 'duplicate-final', finalText: text, revision });
    }
    if (!active) active = begin(text, at, sentenceId);
    const previousText = active.text;
    const committedText = previousText.slice(0, active.committedEnd);
    const appendedCorrection = committedText && text.startsWith(committedText) &&
      hasCorrection(text.slice(active.committedEnd));
    if (committedText && (!text.startsWith(committedText) || appendedCorrection)) {
      revision = retract(active, text, appendedCorrection ? 'speaker-correction' : isFinal ? 'final-revision' : 'hypothesis-revision');
      active.commits = [];
      active.committedEnd = 0;
      active.candidates.clear();
    }
    if (text !== previousText) active.changedAt = at;
    active.text = text;
    if (sentenceId !== undefined) active.externalId = sentenceId;

    if (isFinal) {
      const replacesIds = active.commits.map(commit => commit.id);
      if (revision) replacesIds.push(...revision.retractIds);
      const commit = {
        id: `stream-${nextId++}`, sentenceId: active.sentenceId, text, reason: 'final',
        observedAt: active.observedAt, committedAt: at,
        latencyMs: Math.max(0, at - active.observedAt), provisional: false,
        replacesIds: [...new Set(replacesIds)],
      };
      lastFinal = { text, externalId: active.externalId, commit };
      active = null;
      return result({ commits: [commit], revision, reason: 'final', finalText: text });
    }
    updateCandidates(at);
    const update = commitReady(at);
    return revision ? { ...update, revision } : update;
  }

  function flush({ now, force = false } = {}) {
    // force bypasses waiting, never the explicit clause-boundary requirement.
    return commitReady(time(now), Boolean(force));
  }

  function reset() {
    const revision = active?.commits.length ? retract(active, '', 'reset') : undefined;
    active = null;
    lastFinal = null;
    // IDs remain monotonic so an in-flight response cannot collide after reset.
    return result({ reason: 'reset', revision });
  }

  function getState() {
    return {
      ...result({ reason: active ? 'active' : lastFinal ? 'finalized' : 'idle' }),
      active: Boolean(active), sentenceId: active?.sentenceId ?? lastFinal?.commit.sentenceId ?? null,
      committedIds: active?.commits.map(commit => commit.id) ?? [],
      candidateCount: active?.candidates.size ?? 0, nextId,
      options: { ...settings },
    };
  }

  return { push, flush, reset, getState };
}

function retract(state, replacementText, reason) {
  return {
    type: 'retraction', reason,
    retractIds: state.commits.map(commit => commit.id),
    previousText: state.text.slice(0, state.committedEnd), replacementText,
  };
}

function clauseEnds(text) {
  const ends = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (!/[。！？；.!?;\n]/u.test(char)) continue;
    if (char === '.' && (/\d/u.test(text[index - 1] ?? '') && /\d/u.test(text[index + 1] ?? '') ||
        /\b(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc)\.$/iu.test(text.slice(0, index + 1)))) continue;
    let end = index + 1;
    while (end < text.length && /[。！？；.!?;”’」』）)\]"']/u.test(text[end])) end++;
    if (text.slice(0, end).trim()) ends.push(end);
    index = end - 1;
  }
  return ends;
}

function hasRisk(text) {
  return /\p{N}|[零〇一二三四五六七八九十百千万亿两]|[年月日周]|星期|[不没未无勿别]|禁止|如果|假如|除非|否则|更正|改为|改成|等等|等一下|说错|不是|而是|\b(?:no|not|never|cannot|can't|don't|doesn't|won't|unless|if|except|instead|correction|actually|monday|tuesday|wednesday|thursday|friday|saturday|sunday|dollars?|pounds?|euros?)\b/iu.test(text);
}

function hasCorrection(text) {
  return /不对|说错|更正|改为|改成|等一下|等一等|不是[\s\S]*而是|\b(?:correction|actually|sorry|instead|i mean)\b/iu.test(text);
}

function nonnegative(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0) throw new RangeError(`${name} must be a nonnegative finite number`);
  return result;
}

function positiveInteger(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1) throw new RangeError(`${name} must be a positive integer`);
  return result;
}
