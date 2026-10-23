import { demoAnalyze } from './core.js';
import { resolveMemoryContext } from './memory-resolution.js';

export const COMMUNICATION_VERSION = 'signova.communication/1';
const CORRECTION = /更正|改为|改成|调整|延后|提前|最新|补上|补交|改到|改一下|change|instead|reschedul/iu;
const REFERENCE = /上次|那份|那件|这个|这件|之前|原来|刚才|它|that|previous|last time/iu;
const UNCERTAIN = /不用|不需要|无需|不必|取消|如果|假如|是否|要不要|需不需要|\?|？|don't|do not|if\b/iu;

export function currentDeadline(text) {
  const candidates = [...String(text).matchAll(/(?:周|星期)[一二三四五六日天](?:前|之前|下午|上午|晚上)?|\d{1,2}月\d{1,2}[日号]|(?:明天|后天|今天)(?:前|下午|上午|晚上)?/gu)];
  return candidates.filter(match => !/(?:不是|并非|不在|不要在)\s*$/u.test(text.slice(Math.max(0, match.index - 6), match.index))).at(-1)?.[0] || '';
}

/** Current speech always remains separate from a memory-supported interpretation. */
export function prepareCommunication({ text = '', knowledge = '', tasks = [], profile = 'personal', enabled = false, context = [], selectedTaskId = null, now } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new RangeError('请输入 1–4000 字的发言');
  const utterance = text.trim();
  const resolution = resolveMemoryContext({ tasks, profile, enabled, text: utterance, context, selectedTaskId, now });
  const base = demoAnalyze(utterance, typeof knowledge === 'string' ? knowledge.slice(0, 12000) : '');
  const initialDraft=base.draft?.action ? {...base.draft,action:/补交/u.test(utterance)?'补交实习证明':'提交实习证明'} : null;
  let result = { ...base, draft: initialDraft, suggestedTaskId: null };
  const selected = resolution.memories.find(item => item.id === resolution.selectedTaskId);
  if (resolution.status === 'ambiguous') {
    result = { ...base, mode: 'demo', draft: null, suggestedTaskId: null,
      replies: ['请问您说的是哪一件事项？', '请再说明需要办理的事项和材料名称。'],
      memoryNote: resolution.clarification || '有多件事项可能相关，请先选择本次正在办理的事项。' };
  } else if (selected && (REFERENCE.test(utterance) || CORRECTION.test(utterance))) {
    const deadline = currentDeadline(utterance);
    const actionable = !UNCERTAIN.test(utterance) && Boolean(deadline || /补上|补交|提交|办理|交上/u.test(utterance));
    result = { ...base, mode: 'demo', suggestedTaskId: actionable ? selected.id : null,
      draft: actionable ? { title: null, action: null, deadline: deadline || null, correction: true, source: utterance } : null,
      replies: [`我确认一下，您说的是“${selected.title}”，对吗？`, deadline ? `我确认一下，这件事的最新截止时间是${deadline}，对吗？` : '请问这件事项下一步需要做什么？'],
      memoryNote: actionable ? `建议更正“${selected.title}”，请核对本次要求后确认保存。` : `参考已确认的“${selected.title}”辅助理解，请先确认所指事项。` };
  }
  return { resolution, result: attachResolution(result, resolution) };
}

export function attachResolution(result, resolution) {
  const selected = resolution.memories.find(item => item.id === resolution.selectedTaskId);
  return { ...result, memoryResolution: {
    version: COMMUNICATION_VERSION, status: resolution.status,
    selectedTaskId: resolution.selectedTaskId || null,
    selected: selected ? { id: selected.id, title: selected.title, action: selected.action, deadline: selected.deadline, status: selected.status } : null,
    candidates: resolution.candidates.slice(0, 6).map(candidate => {
      const memory = resolution.memories.find(item => item.id === candidate.id);
      return { id: candidate.id, title: candidate.title || memory?.title || '相关事项' };
    }), clarification: resolution.clarification || null
  } };
}

/** A model cannot silently override the deterministic ambiguous-reference decision. */
export function constrainModelResult(result, resolution, fallback) {
  if (resolution.status === 'ambiguous') return fallback;
  if (result.suggestedTaskId && resolution.selectedTaskId && result.suggestedTaskId !== resolution.selectedTaskId) {
    return attachResolution({ ...result, draft: null, suggestedTaskId: null,
      replies: ['请再确认一下，您说的是哪一件事项？', '请说明本次需要更正的事项名称。'],
      memoryNote: '本次事项关联出现不同结果，请选择正在办理的事项后重试。' }, resolution);
  }
  return attachResolution(result, resolution);
}
