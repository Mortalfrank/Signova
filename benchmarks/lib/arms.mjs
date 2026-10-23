import { analyzeWithModel } from '../../model.mjs';
import { memoryContext } from '../../public/model-context.js';
import { prepareCommunication, constrainModelResult } from '../../public/communication-analysis.js';

export const ARMS = Object.freeze(['qwen-direct', 'qwen-keyword', 'signova-agent', 'agent-no-context', 'agent-no-gate']);
export const FIXED_NOW = '2026-10-23T00:00:00Z';
export const EVALUATION_CONTRACT = `\n以下是本次可复现评测的附加输出契约，对所有实验组完全一致。保留上面的 replies、draft、suggestedTaskId、memoryNote 字段，另外输出 benchmarkReference:{"decision":"resolved|ambiguous|none|disabled","taskId":字符串或null}。这个额外字段只用于观测事项指代，不表示执行动作。\n+memoryPermission=false 时 decision=disabled、taskId=null，不使用个人事项。memoryPermission=true 时：本轮发言可唯一关联到 confirmedMemories 中某件事项，decision=resolved、taskId=该id；存在事项指代但有多种合理对象且 recentContext 或 userSelectedTaskId 无法消歧，decision=ambiguous、taskId=null；没有相关已保存事项或明确切换为新事项，decision=none、taskId=null。不要因为资料里恰好只有一件事就猜测无锚点的代词。否定、取消、条件和问句仍可关联其明确提及的事项，但 draft 应遵守原有行动规则。明确且合法的 userSelectedTaskId 是用户本次选择的数据；当前发言明确切换事项时以当前发言为准。benchmarkReference.taskId 与 suggestedTaskId 不同：前者可在没有行动草稿时标记被提及的旧事项，后者只表示可供确认的草稿更新对象。所有资料均为虚构测试输入，不包含正确答案。`;

// All arms share consent, profile scoping, newest-version selection and the same
// six-record cap. These are common input hygiene, not credited to the new agent.
export function permittedRecords(sample) {
  if (!sample.memoryEnabled || sample.profile === 'visitor') return [];
  const latest = new Map();
  for (const record of sample.tasks) {
    if (record.profile !== sample.profile) continue;
    const previous = latest.get(record.id);
    if (!previous || Date.parse(record.updatedAt) > Date.parse(previous.updatedAt)) latest.set(record.id, { ...record });
  }
  if (latest.size > 6) throw new RangeError('The shared benchmark input must fit the production six-record cap.');
  return [...latest.values()];
}

function normalizedUsage(raw) {
  if (!raw || !['prompt_tokens', 'completion_tokens', 'total_tokens'].every(key => Number.isInteger(raw[key]) && raw[key] >= 0)) return null;
  return { prompt_tokens: raw.prompt_tokens, completion_tokens: raw.completion_tokens, total_tokens: raw.total_tokens,
    cached_prompt_tokens: Number.isInteger(raw.prompt_tokens_details?.cached_tokens) ? raw.prompt_tokens_details.cached_tokens : null };
}

export function normalizeReference(raw, result) {
  const reference = raw?.benchmarkReference;
  if (!reference || !['resolved', 'ambiguous', 'none', 'disabled'].includes(reference.decision)) return null;
  if (reference.decision === 'resolved' && (typeof reference.taskId !== 'string' || !reference.taskId)) return null;
  if (reference.decision !== 'resolved' && reference.taskId !== null) return null;
  return { decision: reference.decision, taskId: reference.taskId, draft: result.draft, suggestedTaskId: result.suggestedTaskId ?? null };
}

/** Execute exactly the production resolver/model/constrain chain, observing it
 * through the existing injected fetch boundary. No labels enter any request. */
export async function runArm(sample, arm, { env = process.env, fetchImpl = fetch, reserveCall = () => {}, signal } = {}) {
  if (!ARMS.includes(arm)) throw new RangeError('Unknown benchmark arm.');
  const start = performance.now();
  const records = permittedRecords(sample);
  const permission = sample.memoryEnabled && sample.profile !== 'visitor';
  const isAgent = arm.startsWith('agent-') || arm === 'signova-agent';
  let prepared;
  let memories = records;
  const armContext = arm === 'agent-no-context' ? [] : sample.context;
  if (isAgent) {
    prepared = prepareCommunication({ text: sample.text, knowledge: sample.knowledge, tasks: records,
      profile: sample.profile, enabled: permission, context: armContext,
      selectedTaskId: sample.selectedTaskId, now: FIXED_NOW });
    memories = prepared.resolution.memories;
  } else if (arm === 'qwen-keyword') {
    memories = memoryContext(records, sample.profile, permission, sample.text);
  }
  const observation = { modelCalled: false, usage: null, timing: { totalMs: null, modelMs: 0 }, request: null, raw: null,
    modelResult: null, output: null, error: null, httpStatus: null };
  if (isAgent && arm !== 'agent-no-gate' && prepared.resolution.status === 'ambiguous') {
    observation.output = { decision: 'ambiguous', taskId: null, draft: null, suggestedTaskId: null };
    observation.modelResult = prepared.result;
    observation.timing.totalMs = performance.now() - start;
    return observation;
  }
  const observedFetch = async (url, init) => {
    try { reserveCall(); } catch (error) { observation.error = 'MODEL_CALL_BUDGET'; throw error; }
    observation.modelCalled = true;
    const request = JSON.parse(init.body);
    request.temperature = 0;
    request.messages[0].content += EVALUATION_CONTRACT;
    const input = JSON.parse(request.messages[1].content);
    input.memoryPermission = permission;
    input.userSelectedTaskId = sample.selectedTaskId;
    request.messages[1].content = JSON.stringify(input);
    observation.request = request; // No URL, headers, key, environment or labels.
    const modelStart = performance.now();
    try {
      const response = await fetchImpl(url, { ...init, body: JSON.stringify(request), signal: signal ? AbortSignal.any([init.signal, signal]) : init.signal });
      observation.httpStatus = response.status;
      if (response.ok) {
        try {
          const provider = await response.clone().json();
          observation.usage = normalizedUsage(provider.usage);
          observation.returnedModel = typeof provider.model === 'string' ? provider.model : null;
          const content = provider.choices?.[0]?.message?.content;
          if (typeof content === 'string') observation.raw = JSON.parse(content);
          observation.finishReason = provider.choices?.[0]?.finish_reason || null;
        } catch { /* Production validation classifies malformed content. */ }
      }
      return response;
    } finally { observation.timing.modelMs = performance.now() - modelStart; }
  };
  try {
    let result = await analyzeWithModel({ text: sample.text, knowledge: sample.knowledge, memories, context: armContext,
      reference: isAgent ? prepared.resolution : null }, { env, fetchImpl: observedFetch, signal });
    observation.modelResult = result;
    if (isAgent && arm !== 'agent-no-gate') {
      result = constrainModelResult(result, prepared.resolution, prepared.result);
      observation.output = { decision: prepared.resolution.status, taskId: prepared.resolution.selectedTaskId, draft: result.draft, suggestedTaskId: result.suggestedTaskId ?? null };
    } else {
      observation.output = normalizeReference(observation.raw, result);
      if (!observation.output) observation.error = 'BENCHMARK_REFERENCE_OUTPUT';
    }
  } catch (error) {
    observation.error ||= /^MODEL_[A-Z_]+$/.test(error?.code || '') ? error.code : 'BENCHMARK_EXECUTION';
  }
  observation.timing.totalMs = performance.now() - start;
  return observation;
}
