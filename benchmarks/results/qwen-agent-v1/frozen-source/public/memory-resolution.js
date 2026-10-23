/**
 * Deterministic, profile-scoped retrieval of the latest confirmed task records.
 * This module only selects context: it never rewrites a statement or saves a task.
 */
const MAX_TASKS = 1000;
const MAX_TEXT = 6000;
const MAX_CONTEXT = 6;
const MAX_RESULTS = 6;
const FORBIDDEN_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const STOP = new Set([
  '请问', '一下', '需要', '办理', '材料', '证明', '申请', '提交', '补交', '更正', '截止', '时间',
  '改为', '改成', '调整', '不是', '之前', '这件', '那件', '上次', '那个', '这个', '好的', '谢谢',
  '现在', '今天', '明天', '下周', '下次', '本次', '事情', '事项', '什么', '怎么', '时候', '已经',
  'the', 'a', 'an', 'to', 'for', 'of', 'is', 'it', 'that', 'this', 'please', 'submit', 'change',
  'deadline', 'document', 'certificate', 'application', 'my', 'last', 'time', 'and', 'on', 'in'
]);
// Deliberately small, inspectable aliases; no general embedding or fuzzy identity substitution.
const ALIASES = [
  ['internship', ['实习证明', '实习证', 'internship certificate', 'internship proof']],
  ['transcript', ['成绩单', '成绩证明', 'academic transcript', 'transcript']],
  ['enrollment', ['在读证明', '在学证明', 'enrollment certificate']],
  ['identity', ['居民身份证', '身份证', 'identity card', 'id card']],
  ['bank-card', ['银行卡', '借记卡', 'bank card', 'debit card']],
  ['payment', ['缴费凭证', '缴费证明', 'payment receipt']]
];
const REFERENCE = /那份|这份|那件|这件|那个|这个|上次|之前那|刚才那|它|继续办理|\b(?:it|that|this|previous|last time)\b/i;
const CORRECTION = /更正|改为|改成|调整为|不是|并非|取消|不需要|不用|\b(?:correct|correction|instead|reschedule|changed?)\b/i;
const ACK = /^(?:好[的吧]?|行|嗯|知道了|明白了|谢谢[您你]?|收到|ok(?:ay)?|thanks?)[。.!！\s]*$/i;

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
  catch { return false; }
}

function own(object, key) {
  if (!isRecord(object)) return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(object, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; }
  catch { return undefined; }
}

function clean(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit).replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
}

function normalized(value) { return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
function timestamp(value) { const result = Date.parse(value); return Number.isFinite(result) ? result : -Infinity; }
function affirmative(value) {
  return value
    .replace(/(?:不是|并非)([^，。；,;]{1,80}?)(?:而是|改为|改成)/g, ' ')
    .replace(/\bnot\s+([^,.!?;]{1,80}?)\s+but\s+/gi, ' ')
    .replace(/(?:不是|并非|不再办理|不办理|不要办理)([^，。；,;]{1,80})(?=[，。；,;]|$)/g, ' ');
}

function tokens(value) {
  const result = new Set();
  const text = normalized(value).replace(/(?:星期|周)[一二三四五六日天1-7]/g, ' ');
  for (const match of text.matchAll(/[a-z][a-z0-9'-]{1,39}|[\p{Script=Han}]+/gu)) {
    const word = match[0];
    if (/^[a-z]/.test(word)) { if (!STOP.has(word)) result.add(word); }
    else {
      for (let i = 0; i < word.length - 1 && result.size < 256; i++) {
        const gram = word.slice(i, i + 2);
        if (!STOP.has(gram)) result.add(gram);
      }
    }
    if (result.size >= 256) break;
  }
  return result;
}

function aliases(value) {
  const text = normalized(value);
  return new Set(ALIASES.filter(([, values]) => values.some(alias => {
    if (/^[a-z]/.test(alias)) {
      const index = text.indexOf(alias);
      return index >= 0 && !/[a-z]/.test(text[index - 1] || '') && !/[a-z]/.test(text[index + alias.length] || '');
    }
    return text.includes(alias);
  })).map(([key]) => key));
}

function intersection(left, right) { return [...left].filter(value => right.has(value)); }

function phraseMatch(query, phrase, minimum) {
  if (phrase.length < minimum) return false;
  if (/[a-z]/.test(phrase)) {
    let index = query.indexOf(phrase);
    while (index >= 0) {
      if (!/[a-z0-9]/.test(query[index - 1] || '') && !/[a-z0-9]/.test(query[index + phrase.length] || '')) return true;
      index = query.indexOf(phrase, index + 1);
    }
    return false;
  }
  return query.replace(/[\s，。！？、,.!?]/g, '').includes(phrase.replace(/[\s，。！？、,.!?]/g, ''));
}

function semantic(record, query) {
  const queryTokens = tokens(query);
  const titleTokens = tokens(record.title);
  const actionTokens = tokens(record.action);
  const titleHits = intersection(queryTokens, titleTokens);
  const actionHits = intersection(queryTokens, actionTokens);
  const aliasHits = intersection(aliases(query), aliases(`${record.title} ${record.action}`));
  const normalizedQuery = normalized(query);
  const exactTitle = phraseMatch(normalizedQuery, normalized(record.title), 3);
  const exactAction = phraseMatch(normalizedQuery, normalized(record.action), 4);
  const lexical = Math.min(46, titleHits.length * 8 + actionHits.length * 5);
  const score = lexical + aliasHits.length * 34 + (exactTitle ? 50 : 0) + (exactAction ? 42 : 0);
  const reasons = [];
  if (exactTitle) reasons.push('本次明确提及事项名称');
  if (exactAction) reasons.push('本次明确提及待办内容');
  if (aliasHits.length) reasons.push(`命中限定术语：${aliasHits.join('、')}`);
  if (lexical) reasons.push(`主题词匹配 ${new Set([...titleHits, ...actionHits]).size} 项`);
  return { score, reasons, aliasHits };
}

function sanitizedTasks(input, profile) {
  if (!Array.isArray(input)) return [];
  const latest = new Map();
  for (let i = 0; i < Math.min(input.length, MAX_TASKS); i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    const raw = descriptor && 'value' in descriptor ? descriptor.value : null;
    if (!isRecord(raw) || own(raw, 'profile') !== profile) continue;
    const id = clean(own(raw, 'id'), 120);
    if (!id || FORBIDDEN_IDS.has(id) || id !== own(raw, 'id')) continue;
    const title = clean(own(raw, 'title'), 80);
    const action = clean(own(raw, 'action'), 200);
    if (!title && !action) continue;
    const record = {
      id, title, action,
      deadline: clean(own(raw, 'deadline'), 80),
      status: own(raw, 'status') === 'done' ? 'done' : 'pending',
      source: clean(own(raw, 'source'), 300),
      updatedAt: clean(own(raw, 'updatedAt'), 64)
    };
    const previous = latest.get(id);
    if (!previous || timestamp(record.updatedAt) > timestamp(previous.updatedAt)) latest.set(id, record);
  }
  return [...latest.values()];
}

function contextTexts(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (let i = Math.max(0, value.length - MAX_CONTEXT); i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    const entry = descriptor && 'value' in descriptor ? descriptor.value : null;
    const text = clean(typeof entry === 'string' ? entry : own(entry, 'text'), 1000);
    if (text) result.push(text);
  }
  return result;
}

function baseResult(status, evidence = []) {
  return { status, memories: [], selectedTaskId: null, candidates: [], clarification: null, evidence };
}

/**
 * @returns {{status: 'disabled'|'none'|'resolved'|'ambiguous', memories: object[],
 * selectedTaskId: string|null, candidates: {id:string,title:string,score:number,reasons:string[]}[],
 * clarification: string|null, evidence: {kind:string,taskId?:string,detail:string}[]}}
 */
export function resolveMemoryContext(options = {}) {
  const profile = clean(own(options, 'profile'), 80);
  if (own(options, 'enabled') !== true || !profile || profile !== own(options, 'profile') || profile === 'visitor') return baseResult('disabled');
  const records = sanitizedTasks(own(options, 'tasks'), profile);
  const evidence = [];
  const rawText = clean(own(options, 'text'), MAX_TEXT);
  const current = affirmative(rawText);
  const isReference = REFERENCE.test(rawText);
  const isCorrection = CORRECTION.test(rawText);
  if (isCorrection || /(?:周|星期)[一二三四五六日天]|\d+[年月日号]|不需要|取消/.test(rawText)) {
    evidence.push({ kind: 'current_statement_priority', detail: '保留本次原话中的日期、更正与否定；记忆仅辅助解释指代。' });
  }
  const selected = clean(own(options, 'selectedTaskId'), 120);
  const selectedRecord = selected ? records.find(record => record.id === selected) : null;
  if (selected && (!selectedRecord || selected !== own(options, 'selectedTaskId'))) {
    evidence.push({ kind: 'invalid_selection', detail: '指定事项不存在或不属于当前档案，已拒绝绑定。' });
    return baseResult('none', evidence);
  }
  if (!records.length) return baseResult('none', evidence);

  const ranks = records.map(record => ({ record, current: semantic(record, current), context: null, forced: false }));
  let relevant = ranks.filter(item => item.current.score >= 8);
  const currentAliases = aliases(current);
  // An explicit new material name must not be overwritten by an old conversation topic.
  const currentUnknownTopic = currentAliases.size > 0 && !ranks.some(item => item.current.aliasHits.length);
  if (currentUnknownTopic && !relevant.length) {
    evidence.push({ kind: 'current_topic_unmatched', detail: '本次明确提及另一类材料，未沿用历史话题绑定事项。' });
    return baseResult('none', evidence);
  }

  if (!relevant.length && (isReference || isCorrection) && !selectedRecord) {
    const context = contextTexts(own(options, 'context'));
    for (let i = context.length - 1; i >= 0; i--) {
      const line = affirmative(context[i]);
      const matches = ranks.map(item => ({ item, match: semantic(item.record, line) })).filter(entry => entry.match.score >= 8);
      if (matches.length) {
        relevant = matches.map(({ item, match }) => { item.context = match; return item; });
        evidence.push({ kind: 'conversation_anchor', detail: '本次含指代或更正，使用最近连续话题寻找相关事项。' });
        break;
      }
      if (!ACK.test(line) && !REFERENCE.test(line) && !CORRECTION.test(line)) {
        evidence.push({ kind: 'context_interrupted', detail: '最近话题已切换，较早事项未用于自动绑定。' });
        break;
      }
    }
  }

  if (selectedRecord) {
    const item = ranks.find(entry => entry.record.id === selectedRecord.id);
    if (relevant.length && !relevant.includes(item)) {
      evidence.push({ kind: 'selection_topic_conflict', taskId: selected, detail: '本次明确事项优先于此前选择，避免更正到另一事项。' });
    } else {
      if (!relevant.includes(item)) relevant.push(item);
      item.forced = true;
    }
  }

  if (!relevant.length) {
    if (!(isReference || isCorrection) || !rawText) return baseResult('none', evidence);
    return {
      ...baseResult('ambiguous', [...evidence, { kind: 'unanchored_reference', detail: '缺少可以核验的话题锚点，未凭更新时间猜测事项。' }]),
      candidates: [...records].sort((left, right) => left.id.localeCompare(right.id, 'en')).slice(0, MAX_RESULTS).map(record => ({ id: record.id, title: record.title || record.action, score: 0, reasons: ['指代未明确，请本人选择'] })),
      clarification: records.length === 1 ? `你指的是“${records[0].title || records[0].action}”这件事吗？` : '你指的是哪一件已保存事项？请选择或说出事项名称。'
    };
  }

  const suppliedNow = own(options, 'now');
  const parsedNow = typeof suppliedNow === 'number' ? suppliedNow : timestamp(clean(suppliedNow, 64));
  const clock = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  for (const item of relevant) {
    item.semanticScore = item.forced ? 200 : item.current.score || item.context?.score || 0;
    const age = clock - timestamp(item.record.updatedAt);
    const freshness = Number.isFinite(age) && age >= 0 ? Math.max(0, 3 - Math.floor(age / 86400000 / 30)) : 0;
    item.score = item.semanticScore + (item.record.status === 'pending' ? 2 : 0) + freshness;
    item.reasons = item.forced ? ['本人已明确选择此事项'] : [...(item.current.score ? item.current.reasons : item.context.reasons.map(reason => `对话锚点：${reason}`))];
    if (item.record.status === 'pending') item.reasons.push('事项仍待完成');
    if (freshness) item.reasons.push('更新时间仅用于相关候选的次级排序');
  }
  relevant.sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id, 'en'));
  const top = relevant[0];
  // Resolve on semantic evidence only; freshness/status must never break a semantic tie.
  const ambiguous = !top.forced && relevant.some((item, index) => index > 0 && Math.abs(top.semanticScore - item.semanticScore) < 12);
  const shown = relevant.slice(0, MAX_RESULTS);
  return {
    status: ambiguous ? 'ambiguous' : 'resolved',
    memories: shown.map(item => ({ ...item.record })),
    selectedTaskId: ambiguous ? null : top.record.id,
    candidates: shown.map(item => ({ id: item.record.id, title: item.record.title || item.record.action, score: item.score, reasons: item.reasons })),
    clarification: ambiguous ? `你指的是${shown.slice(0, 3).map(item => `“${item.record.title || item.record.action}”`).join('、')}中的哪一件？` : null,
    evidence: [...evidence, {
      kind: ambiguous ? 'ambiguous_candidates' : 'resolved_reference',
      ...(ambiguous ? {} : { taskId: top.record.id }),
      detail: ambiguous ? '多个候选语义接近，需澄清后再绑定；更新时间不作为消歧依据。' : '根据明确事项、本人选择或连续对话锚点选取最新记录，原始发言保持不变。'
    }]
  };
}
