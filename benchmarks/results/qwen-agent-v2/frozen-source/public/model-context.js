// Only current, explicitly permitted records are sent to the model. History stays local.
export function memoryContext(tasks, profile, enabled, text) {
  if (!enabled || profile === 'visitor') return [];
  const terms = [...new Set(String(text).match(/[\u4e00-\u9fff]{2}|[a-z0-9]+/gi) || [])];
  return tasks.filter(t => t.profile === profile)
    .map(t => ({ t, score: terms.filter(w => `${t.title}${t.action}`.includes(w)).length }))
    .sort((a, b) => b.score - a.score || String(b.t.updatedAt).localeCompare(String(a.t.updatedAt)))
    .slice(0, 6).map(({ t }) => ({ id: t.id, title: t.title, action: t.action,
      deadline: t.deadline, status: t.status, source: String(t.source || '').slice(0, 500) }));
}

export function draftForTask(draft, old) {
  const d = draft || {};
  return {
    title: d.title ?? old?.title ?? '',
    action: d.action ?? old?.action ?? '',
    deadline: d.deadline ?? old?.deadline ?? '',
    source: d.source || '用户手动输入',
  };
}
