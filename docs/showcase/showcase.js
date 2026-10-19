/* Standalone presentation only. No analytics, uploads, or model requests. */
const steps = {
  understand: { src: 'assets/mobile-live.png', alt: 'SIGNOVA 真实模型调用后的交流页面，显示文字输入的原话与 NOVA 形象', count: '01 — 03', caption: '实际 App 界面 · 文字输入 / 真实模型调用' },
  express: { src: 'assets/mobile-talk.png', alt: 'SIGNOVA 面对面交流的滚动视图，用户已选择一条模型候选回复，尚待本人确认表达', count: '02 — 03', caption: '实际 App 界面 · 模型候选回复 / 本人选择' },
  continue: { src: 'assets/mobile-memory.png', alt: 'SIGNOVA 刷新后的继续办理页面，最新截止时间为周五，并保留可编辑的规则回复模板', count: '03 — 03', caption: '实际 App 界面 · 刷新后接续 / 当前浏览器' },
};
const tabs = [...document.querySelectorAll('[data-step]')];
function selectStep(tab) {
  const step = steps[tab.dataset.step];
  if (!step) return;
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    item.classList.toggle('active', selected);
  }
  const image = document.querySelector('#journey-screen');
  image.src = step.src;
  image.alt = step.alt;
  document.querySelector('#screen-counter').textContent = step.count;
  document.querySelector('#screen-caption').textContent = step.caption;
  document.querySelector('#screen-panel').setAttribute('aria-labelledby', tab.id);
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectStep(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); tabs[next].focus(); selectStep(tabs[next]); }
  });
}

// Media is enabled by a local manifest only after the finished files are delivered.
// The designed poster remains visible on file://, without JS, or on media failure.
const localFile = value => typeof value === 'string' && /^[\w./-]+$/.test(value) && !value.includes('..') && !value.startsWith('/');
async function loadMedia() {
  if (!['http:', 'https:'].includes(location.protocol)) return;
  try {
    const response = await fetch('media.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const media = await response.json();
    if (!localFile(media.video)) return;
    const video = document.querySelector('#promo-video');
    const poster = document.querySelector('#film-poster');
    video.addEventListener('loadedmetadata', () => { video.hidden = false; poster.hidden = true; }, { once: true });
    video.addEventListener('error', () => { video.hidden = true; poster.hidden = false; });
    if (localFile(media.poster)) video.poster = media.poster;
    if (localFile(media.captions)) {
      const track = document.createElement('track');
      track.kind = 'captions'; track.label = '简体中文'; track.srclang = 'zh-CN'; track.src = media.captions; track.default = false;
      video.append(track);
    }
    video.src = media.video;
    video.load();
  } catch { /* The brand poster is a complete no-network fallback. */ }
}
loadMedia();
