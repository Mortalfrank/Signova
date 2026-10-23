// Authored ASR hypotheses for reproducible UI and policy checks; no recorded audio.
// Times are fixture timestamps, not measured cloud-service or translation latency.
export const SPEECH_REPLAYS = Object.freeze([
  { id: 'campus-clauses', title: '材料说明', description: '稳定分句先生成候选，完整发言随后确认。', finalAt: 3600,
    events: [
      { at: 0, text: '请准备' }, { at: 350, text: '请准备实习证明。' },
      { at: 750, text: '请准备实习证明。' }, { at: 1100, text: '请准备实习证明。' },
      { at: 1800, text: '请准备实习证明。请到学生服务中心提交。' },
      { at: 2400, text: '请准备实习证明。请到学生服务中心提交。' },
      { at: 3600, text: '请准备实习证明。请到学生服务中心提交。', isFinal: true }
    ] },
  { id: 'date-correction', title: '日期自我更正', description: '保留更正后的完整原话，候选内容随识别结果更新。', finalAt: 3300,
    events: [
      { at: 0, text: '截止时间' }, { at: 450, text: '截止时间是周三。' },
      { at: 800, text: '截止时间是周三。' },
      { at: 1100, text: '截止时间是周三，不对' },
      { at: 1700, text: '截止时间改为周五，不是周三。' },
      { at: 2200, text: '截止时间改为周五，不是周三。' },
      { at: 3300, text: '截止时间改为周五，不是周三。', isFinal: true }
    ] },
  { id: 'negation', title: '否定要求', description: '完整保留“不用”，不会反转为提交要求。', finalAt: 2100,
    events: [
      { at: 0, text: '实习证明' }, { at: 450, text: '实习证明不用' },
      { at: 1000, text: '实习证明不用再补交了。' },
      { at: 1450, text: '实习证明不用再补交了。' },
      { at: 2100, text: '实习证明不用再补交了。', isFinal: true }
    ] },
  { id: 'english-clauses', title: 'English captions', description: 'English hypothesis replay; sign vocabulary remains a separate language choice.', finalAt: 3200,
    events: [
      { at: 0, text: 'Please bring' }, { at: 400, text: 'Please bring your form.' },
      { at: 900, text: 'Please bring your form.' },
      { at: 1600, text: 'Please bring your form. We can check it together.' },
      { at: 2200, text: 'Please bring your form. We can check it together.' },
      { at: 3200, text: 'Please bring your form. We can check it together.', isFinal: true }
    ] }
]);

export function playSpeechReplay(replay, { onEvent, onEnd = () => {}, speed = 1, signal } = {}) {
  if (!replay?.events?.length || typeof onEvent !== 'function') throw new TypeError('Invalid replay');
  if (!Number.isFinite(speed) || speed <= 0 || speed > 4) throw new RangeError('Invalid replay speed');
  const timers = new Set();
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; for (const timer of timers) clearTimeout(timer); timers.clear(); signal?.removeEventListener('abort', stop); };
  if (signal?.aborted) { stop(); return { stop }; }
  signal?.addEventListener('abort', stop, { once: true });
  for (const [index, event] of replay.events.entries()) {
    const timer = setTimeout(() => {
      timers.delete(timer); if (stopped) return;
      onEvent({ ...event, sentenceId: replay.id });
      if (index === replay.events.length - 1) { stop(); onEnd(); }
    }, event.at / speed);
    timers.add(timer);
  }
  return { stop };
}
