const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(selectedTab, moveFocus = false) {
  for (const tab of tabs) {
    const selected = tab === selectedTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
  if (moveFocus) selectedTab.focus();
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectTab(tabs[nextIndex], true);
  });
}

const accessCard = document.getElementById('access-card');
const description = document.getElementById('access-description');
const form = document.getElementById('unlock-form');
const keyInput = document.getElementById('experience-key');
const toggleKey = document.getElementById('toggle-key');
const unlockButton = document.getElementById('unlock-button');
const unlockedActions = document.getElementById('unlocked-actions');
const continueLink = document.getElementById('continue-link');
const lockButton = document.getElementById('lock-button');
const retryButton = document.getElementById('retry-button');
const message = document.getElementById('access-message');
let busy = false;
let accessConfigured = false;

function setBusy(value, action = '') {
  busy = value;
  accessCard.setAttribute('aria-busy', String(value));
  keyInput.disabled = value;
  toggleKey.disabled = value;
  unlockButton.disabled = value;
  lockButton.disabled = value;
  retryButton.disabled = value;
  unlockButton.textContent = value && action === 'unlock' ? '正在解锁…' : '解锁体验 ↗';
  lockButton.textContent = value && action === 'lock' ? '正在退出…' : '退出体验';
  continueLink.setAttribute('aria-disabled', String(value));
  continueLink.tabIndex = value ? -1 : 0;
}

function showMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle('success', success);
}

function concealKey() {
  keyInput.value = '';
  keyInput.type = 'password';
  toggleKey.textContent = '显示';
  toggleKey.setAttribute('aria-label', '显示体验 Key');
  toggleKey.setAttribute('aria-pressed', 'false');
}

function renderAccessStatus(status) {
  const unlocked = status.unlocked === true;
  const configured = status.configured === true;
  accessConfigured = configured;
  form.hidden = unlocked || !configured;
  unlockedActions.hidden = !unlocked;
  retryButton.hidden = true;
  description.textContent = unlocked
    ? '已解锁，可以继续你的 SIGNOVA 体验。'
    : configured
      ? '输入体验 Key，开始功能体验。'
      : '功能体验暂未开放，先看看示例。';
  if (unlocked || !configured) concealKey();
}

async function accessRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('暂时无法连接体验入口，请稍后重试。');
    }
    if (!response.ok) {
      const fallback = response.status === 429
        ? '尝试次数较多，请稍后再试。'
        : response.status === 503
          ? '功能体验暂未开放，先看看示例。'
          : '未能完成操作，请稍后重试。';
      const error = new Error(typeof data.error === 'string' && data.error.trim() ? data.error : fallback);
      error.status = response.status;
      throw error;
    }
    if (!data || typeof data !== 'object') throw new Error('暂时无法连接体验入口，请稍后重试。');
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) {
      throw new Error('暂时无法连接体验入口，请稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadStatus() {
  if (busy) return;
  setBusy(true);
  showMessage('');
  try {
    const status = await accessRequest('/api/access/status');
    if (typeof status.unlocked !== 'boolean' || typeof status.configured !== 'boolean') {
      throw new Error('暂时无法确认体验状态，请重试。');
    }
    renderAccessStatus(status);
  } catch (error) {
    description.textContent = '校园示例随时可看，功能体验入口暂时无法连接。';
    form.hidden = true;
    unlockedActions.hidden = true;
    retryButton.hidden = false;
    showMessage(error.message);
  } finally {
    setBusy(false);
  }
}

toggleKey.addEventListener('click', () => {
  const visible = keyInput.type === 'password';
  keyInput.type = visible ? 'text' : 'password';
  toggleKey.textContent = visible ? '隐藏' : '显示';
  toggleKey.setAttribute('aria-label', visible ? '隐藏体验 Key' : '显示体验 Key');
  toggleKey.setAttribute('aria-pressed', String(visible));
});

keyInput.addEventListener('input', () => {
  keyInput.removeAttribute('aria-invalid');
  if (message.textContent) showMessage('');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const key = keyInput.value.trim();
  if (!key) {
    keyInput.setAttribute('aria-invalid', 'true');
    showMessage('请输入体验 Key。');
    keyInput.focus();
    return;
  }
  setBusy(true, 'unlock');
  showMessage('');
  try {
    const result = await accessRequest('/api/access/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    if (result.ok !== true) throw new Error('暂时无法解锁，请稍后重试。');
    concealKey();
    showMessage('已解锁，正在进入体验…', true);
    window.location.assign('/app');
  } catch (error) {
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      keyInput.setAttribute('aria-invalid', 'true');
    }
    if (error.status === 503) renderAccessStatus({ unlocked: false, configured: false });
    showMessage(error.message);
    setBusy(false);
    if (!form.hidden) keyInput.focus();
  }
});

continueLink.addEventListener('click', event => {
  if (busy) event.preventDefault();
});

lockButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true, 'lock');
  showMessage('');
  try {
    const result = await accessRequest('/api/access/lock', { method: 'POST' });
    if (result.ok !== true) throw new Error('暂时无法退出，请稍后重试。');
    concealKey();
    renderAccessStatus({ unlocked: false, configured: accessConfigured });
    showMessage('已退出体验。', true);
  } catch (error) {
    showMessage(error.message);
    retryButton.hidden = false;
  } finally {
    setBusy(false);
  }
});

retryButton.addEventListener('click', loadStatus);
window.addEventListener('pagehide', concealKey);
loadStatus();
