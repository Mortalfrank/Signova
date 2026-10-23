import { memoryContext as legacyMemoryContext } from './model-context.js';
import { resolveMemoryContext } from './memory-resolution.js';
import { SPEECH_REPLAYS } from './speech-replay.js';
import { createStreamingPolicy } from './streaming-policy.js';

export const EVALUATION_NOW = '2026-10-22T08:00:00.000Z';
export const STREAMING_EVALUATION_SETTINGS = Object.freeze({ minStableMs: 350, riskStableMs: 800, minObservations: 2, maxChars: 4000 });

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

// Every identity, task and dialogue below is hand-authored, fictional evaluation data.
const TASKS = freezeDeep([
  { id: 'demo-internship', profile: 'demo-personal', title: '实习申请', action: '补交实习证明', deadline: '周五', status: 'pending', source: '虚构样本：经本人确认', updatedAt: '2026-10-20T08:00:00Z', history: [{ deadline: '周三', action: '补交实习证明', source: '虚构旧版本', updatedAt: '2026-10-01T08:00:00Z' }] },
  { id: 'demo-transcript', profile: 'demo-personal', title: '成绩单领取', action: '领取盖章成绩单', deadline: '周四', status: 'pending', source: '虚构样本：经本人确认', updatedAt: '2026-10-21T08:00:00Z', history: [] },
  { id: 'demo-enrollment', profile: 'demo-personal', title: '在读证明申请', action: '提交在读证明申请表', deadline: '下周一', status: 'pending', source: '虚构样本：经本人确认', updatedAt: '2026-10-19T08:00:00Z', history: [] },
  { id: 'demo-bank', profile: 'demo-personal', title: '银行卡补办', action: '携身份证到银行补办借记卡', deadline: '', status: 'done', source: '虚构样本：经本人确认', updatedAt: '2026-10-22T07:00:00Z', history: [] },
  { id: 'demo-other-profile', profile: 'demo-another', title: '另档案材料申请', action: '另档案虚构事项', deadline: '下个月', status: 'pending', source: '合成身份隔离样本', updatedAt: '2026-10-22T07:30:00Z', history: [] }
]);
const I = 'demo-internship';
const T = 'demo-transcript';
const E = 'demo-enrollment';
const B = 'demo-bank';
function fixture(id, title, text, expected, extra = {}) {
  return { id, title, input: { tasks: TASKS, profile: 'demo-personal', enabled: true, text, context: [], selectedTaskId: null, now: EVALUATION_NOW, ...extra }, expected };
}
const bound = (id, extra = {}) => ({ status: 'resolved', selectedTaskId: id, relevantTaskIds: [id], ...extra });
const absent = (status = 'none') => ({ status, selectedTaskId: null, relevantTaskIds: [] });
const clarify = (ids = []) => ({ status: 'ambiguous', selectedTaskId: null, relevantTaskIds: ids });

/** Fixed manual labels, deliberately including disagreement and ambiguity cases. */
export const MEMORY_EVALUATION_FIXTURES = freezeDeep([
  fixture('m01', '明确实习材料', '我来补交实习证明。', bound(I)),
  fixture('m02', '明确成绩单', '成绩单领取需要去哪个窗口？', bound(T)),
  fixture('m03', '明确在读证明', '我想提交在读证明申请表。', bound(E)),
  fixture('m04', '英语实习材料', 'Where should I submit the internship certificate?', bound(I)),
  fixture('m05', '英语成绩单', 'Can I collect my academic transcript today?', bound(T)),
  fixture('m06', '日期更正承接上文', '更正一下，截止时间改为周一，不是周五。', bound(I), { context: ['实习证明需要在哪里提交？'] }),
  fixture('m07', '省略材料名称', '那份可以明天领取吗？', bound(T), { context: ['成绩单已经盖章了吗？'] }),
  fixture('m08', '本人明确选择', '那份的日期改成下周一。', bound(I), { selectedTaskId: I }),
  fixture('m09', '新话题优先于上文', '成绩单的截止时间改到周五。', bound(T), { context: ['上次还缺实习证明'] }),
  fixture('m10', '新话题优先于旧选择', '成绩单要改时间。', bound(T), { selectedTaskId: I }),
  fixture('m11', '新材料没有旧事项', '这次缴费凭证改到周五办理。', absent(), { context: ['实习证明还没提交'] }),
  fixture('m12', '无关天气', '今天天气很不错，我们去吃午饭吧。', absent()),
  fixture('m13', '无关节目', '这个脱口秀的笑话是什么意思？', absent()),
  fixture('m14', '泛化材料问题', '请问提交材料的截止时间是什么时候？', absent()),
  fixture('m15', '多事项泛指', '上次那份还需要带来吗？', clarify()),
  fixture('m16', '缺少话题的日期更正', '更正一下，截止时间改为周五。', clarify()),
  fixture('m17', '单个旧事项也不猜测', '那份的时间改为周五。', clarify(), { tasks: [TASKS[0]] }),
  fixture('m18', '同材料两个办理事项', '实习证明需要重新提交。', clarify([I, 'demo-internship-review']), { tasks: [TASKS[0], { ...TASKS[0], id: 'demo-internship-review', title: '实习证明复核', status: 'done', updatedAt: '2026-01-01T08:00:00Z' }] }),
  fixture('m19', '本次同时明确两份材料', '实习证明和成绩单都要补交。', clarify([I, T])),
  fixture('m20', '访客隔离', '实习证明需要改时间。', absent('disabled'), { profile: 'visitor' }),
  fixture('m21', '记忆未开启', '成绩单什么时候领取？', absent('disabled'), { enabled: false }),
  fixture('m22', '跨档案目标拒绝', '那件的时间更正一下。', absent(), { selectedTaskId: 'demo-other-profile' }),
  fixture('m23', '否定原事项改问另一件', '不是实习证明而是成绩单要改到周五。', bound(T), { context: ['实习证明'] }),
  fixture('m24', '话题中断不拾取旧事项', '那个日期改为周五。', clarify(), { context: ['实习证明', '今天中午去吃面条'] }),
  fixture('m25', '确认词保持连续话题', '那份改成周五。', bound(I), { context: ['实习证明', '好的'] }),
  fixture('m26', '上文旧日期不覆盖最新版本', '上次那份还需要补吗？', bound(I, { latestDeadline: '周五' }), { context: ['实习证明上次要求周三交。'] }),
  fixture('m27', '重复记录选择最新版本', '实习证明什么时候交？', bound(I, { latestDeadline: '周五' }), { tasks: [{ ...TASKS[0], deadline: '周三', updatedAt: '2026-10-01T08:00:00Z' }, TASKS[0], TASKS[1]] }),
  fixture('m28', '已完成事项可被明确提及', '银行卡补办还有后续手续吗？', bound(B)),
  fixture('m29', '限定借记卡同义词', '借记卡的补办进度可以查吗？', bound(B)),
  fixture('m30', '英语近形词不匹配', 'The transcription software looks useful.', absent())
]);

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function ratio(numerator, denominator) { return denominator ? Math.round(numerator / denominator * 10000) / 10000 : 0; }
function rate(numerator, denominator) { return { numerator, denominator, value: ratio(numerator, denominator) }; }

function retrievalOutcome(result, expected) {
  const selected = result.selectedTaskId;
  const wrongBinding = selected !== null && selected !== expected.selectedTaskId;
  const correctBinding = expected.status === 'resolved' && selected === expected.selectedTaskId;
  const correctClarification = expected.status === 'ambiguous' && result.status === 'ambiguous' && selected === null;
  const correctAbstention = ['none', 'disabled'].includes(expected.status) && selected === null && ['none', 'disabled'].includes(result.status);
  const promptRecordCount = result.memories.length;
  const irrelevantMemoryCount = result.memories.filter(item => !expected.relevantTaskIds.includes(item.id)).length;
  const selectedRecord = result.memories.find(item => item.id === expected.selectedTaskId);
  const latestVersionCorrect = expected.latestDeadline === undefined ? null : selectedRecord?.deadline === expected.latestDeadline;
  return {
    correctBinding, wrongBinding, correctClarification, correctAbstention,
    correctDecision: correctBinding || correctClarification || correctAbstention,
    promptRecordCount, irrelevantMemoryCount, latestVersionCorrect
  };
}

function oldStrategy(input) {
  const memories = legacyMemoryContext(input.tasks, input.profile, input.enabled, input.text);
  return {
    status: !input.enabled || input.profile === 'visitor' ? 'disabled' : memories.length ? 'resolved' : 'none',
    selectedTaskId: memories[0]?.id ?? null, memories,
    clarification: null, candidates: [], evidence: []
  };
}

function summarizeMemory(cases, strategy) {
  const values = cases.map(item => ({ ...item[strategy].metrics, status: item.expected.status, selected: item[strategy].selectedTaskId }));
  const count = key => values.filter(item => item[key]).length;
  const resolvedLabels = values.filter(item => item.status === 'resolved').length;
  const clarificationLabels = values.filter(item => item.status === 'ambiguous').length;
  const abstentionLabels = values.filter(item => ['none', 'disabled'].includes(item.status)).length;
  const eligible = values.filter(item => item.status !== 'disabled');
  return {
    sampleCount: values.length,
    correctBindings: count('correctBinding'), wrongBindings: count('wrongBinding'),
    correctClarifications: count('correctClarification'), correctAbstentions: count('correctAbstention'),
    correctDecisions: count('correctDecision'),
    decisionAccuracy: rate(count('correctDecision'), values.length),
    bindingRecall: rate(count('correctBinding'), resolvedLabels),
    clarificationRecall: rate(count('correctClarification'), clarificationLabels),
    abstentionRecall: rate(count('correctAbstention'), abstentionLabels),
    bindingCoverage: rate(eligible.filter(item => item.selected !== null).length, eligible.length),
    promptRecordCount: values.reduce((sum, item) => sum + item.promptRecordCount, 0),
    averagePromptRecordCount: Math.round(values.reduce((sum, item) => sum + item.promptRecordCount, 0) / values.length * 10000) / 10000,
    irrelevantMemoryCount: values.reduce((sum, item) => sum + item.irrelevantMemoryCount, 0),
    casesWithIrrelevantMemory: values.filter(item => item.irrelevantMemoryCount > 0).length,
    latestVersionCorrect: values.filter(item => item.latestVersionCorrect === true).length,
    latestVersionChecked: values.filter(item => item.latestVersionCorrect !== null).length
  };
}

function replayPolicy(replay, settings, tickMs) {
  const policy = createStreamingPolicy({ ...settings, clock: () => 0 });
  const finalEvent = replay.events.findLast(item => item.isFinal);
  const schedule = [
    ...replay.events.map((event, index) => ({ at: event.at, kind: 'event', order: index, event })),
    ...Array.from({ length: Math.floor(finalEvent.at / tickMs) }, (_, index) => ({ at: (index + 1) * tickMs, kind: 'tick', order: index }))
  ].sort((left, right) => left.at - right.at || (left.kind === right.kind ? left.order - right.order : left.kind === 'event' ? -1 : 1));
  const commits = [];
  const retractions = [];
  let finalText = null;
  for (const step of schedule) {
    const update = step.kind === 'event'
      ? policy.push({ ...step.event, sentenceId: replay.id, now: step.at })
      : policy.flush({ now: step.at });
    for (const commit of update.commits) {
      commits.push({ ...commit, trigger: step.kind });
      if (!commit.provisional) finalText = commit.text;
    }
    if (update.revision?.retractIds?.length) retractions.push({ at: step.at, ...update.revision });
  }
  const first = commits.find(item => item.provisional);
  const final = commits.findLast(item => !item.provisional);
  return {
    firstCandidateAt: first?.committedAt ?? final?.committedAt ?? null,
    firstProvisionalAt: first?.committedAt ?? null,
    firstCandidateLeadMs: first ? Math.max(0, finalEvent.at - first.committedAt) : 0,
    provisionalCommitCount: commits.filter(item => item.provisional).length,
    retractionEventCount: retractions.length,
    retractedCandidateCount: new Set(retractions.flatMap(item => item.retractIds)).size,
    finalReplacementCount: final?.replacesIds?.length ?? 0,
    finalText,
    finalSourceExactlyPreserved: finalText === finalEvent.text,
    commits, retractions
  };
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 requires WebCrypto (Node 22+ or a secure browser context).');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Local deterministic fixtures only. No network, audio recording, model training or
 * model invocation occurs. The old strategy is its first retrieval item as a
 * binding proxy, not the old product/model's actual decision accuracy.
 */
export async function runAlgorithmEvaluation({ tickMs = 120, policyOptions = STREAMING_EVALUATION_SETTINGS } = {}) {
  if (!Number.isInteger(tickMs) || tickMs < 1 || tickMs > 1000) throw new RangeError('tickMs must be an integer from 1 to 1000');
  const cases = MEMORY_EVALUATION_FIXTURES.map(item => {
    const baseline = oldStrategy(copy(item.input));
    const optimized = resolveMemoryContext(copy(item.input));
    return {
      id: item.id, title: item.title, input: copy(item.input), expected: copy(item.expected),
      baseline: { ...baseline, metrics: retrievalOutcome(baseline, item.expected) },
      optimized: { ...optimized, metrics: retrievalOutcome(optimized, item.expected) }
    };
  });
  const streams = SPEECH_REPLAYS.map(replay => {
    const final = replay.events.findLast(item => item.isFinal);
    return {
      id: replay.id, title: replay.title, fixture: copy(replay),
      baseline: { strategy: 'wait-final', firstCandidateAt: final.at, firstCandidateLeadMs: 0, finalText: final.text, retractionEventCount: 0, retractedCandidateCount: 0, finalSourceExactlyPreserved: true },
      optimized: replayPolicy(replay, policyOptions, tickMs)
    };
  });
  const leadTimes = streams.map(item => item.optimized.firstCandidateLeadMs);
  const settings = createStreamingPolicy(policyOptions).getState().options;
  return {
    schemaVersion: 'signova-algorithm-evaluation/1',
    metadata: {
      fixtureVersion: '2026-10-22.1', now: EVALUATION_NOW,
      dataOrigin: '手写标注的虚构校园/窗口事项与ASR假设事件，不含真实用户资料或录音。',
      memoryFixtureSha256: await sha256(MEMORY_EVALUATION_FIXTURES),
      speechFixtureSha256: await sha256(SPEECH_REPLAYS),
      algorithms: { memory: '确定性词项/限定同义词/版本感知/话题锚定/歧义澄清', baseline: '原memoryContext关键词排序的首项绑定代理', streaming: '重复观测、语义边界、风险等待、可撤销候选' },
      parameters: { memory: { maxTasks: 1000, maxTextChars: 6000, maxContextEntries: 6, maxContextChars: 1000, maxOutputRecords: 6 }, streaming: { tickMs, ...settings } },
      modelCalls: 0, trainedModels: 0,
      definitions: {
        correctBindings: '人工标签为可绑定且选中相同事项。',
        wrongBindings: '自动选中了事项，但与人工标签不同，或人工标签要求澄清/不绑定。',
        correctClarifications: '人工标签要求澄清，策略返回ambiguous且未选中事项。',
        bindingCoverage: '自动绑定次数 / 非disabled样本数；高覆盖率可能伴随错误，不单独代表更好。',
        promptRecordCount: '策略返回的memories记录总数，作为可发送模型的记录数代理，不是实际token或费用。',
        irrelevantMemoryCount: '返回的memories中不属于手写相关事项集合的记录数。',
        firstCandidateLeadMs: '同一手写事件回放中，final事件时间减首次可撤销分析候选时间；没有提前候选记0。',
        retractions: 'revision.retractIds造成的候选撤销；final正常替换另列finalReplacementCount。'
      },
      limitations: [
        '30条手写样本属于开发评测，未独立采样、未盲测，不证明真实用户总体准确率。',
        '旧策略首项绑定是检索代理对照，不代表旧模型整体，也不代表百度或vivo产品。',
        '新旧策略使用相同样本与记忆数据；新策略另使用上下文、本人选择和明确的歧义规则。',
        '流式结果只描述四条手写ASR假设回放，不包含真实采音、网络、云识别、模型推理或动作渲染时延，不代表云端端到端提速。',
        '提前候选可以撤销，不是最终译文，也不允许据此直接播放未经验证的手语动作。',
        '未训练基础模型，未测手语语言准确率或听障用户理解度；零撤销只代表这些回放未触发，不代表没有风险。'
      ]
    },
    memory: { summary: { baseline: summarizeMemory(cases, 'baseline'), optimized: summarizeMemory(cases, 'optimized') }, cases },
    streaming: {
      summary: {
        sampleCount: streams.length,
        casesWithEarlyCandidates: leadTimes.filter(value => value > 0).length,
        averageFirstCandidateLeadMs: leadTimes.reduce((sum, value) => sum + value, 0) / streams.length,
        minFirstCandidateLeadMs: Math.min(...leadTimes), maxFirstCandidateLeadMs: Math.max(...leadTimes),
        retractionEventCount: streams.reduce((sum, item) => sum + item.optimized.retractionEventCount, 0),
        retractedCandidateCount: streams.reduce((sum, item) => sum + item.optimized.retractedCandidateCount, 0),
        finalSourceExactlyPreserved: streams.every(item => item.optimized.finalSourceExactlyPreserved)
      }, cases: streams
    }
  };
}
