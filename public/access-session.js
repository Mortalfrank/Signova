// A visible exit plus session checks for already-open tabs. No access key is stored in JS.
const bar = document.createElement('aside');
bar.className = 'access-session';
bar.setAttribute('aria-label', '体验访问');
bar.innerHTML = '<a href="/">返回示例</a><button type="button">退出体验</button><span role="status" aria-live="polite"></span>';
document.body.prepend(bar);
let leaving = false;
function returnToPreview() {
  if (leaving) return;
  leaving = true;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  location.replace('/');
}
async function checkAccess() {
  if (leaving || document.hidden) return;
  try {
    const response = await fetch('/api/access/status', { cache: 'no-store' });
    if (response.ok && !(await response.json()).unlocked) returnToPreview();
  } catch { /* A temporary connection loss does not erase local app data. */ }
}
bar.querySelector('button').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    const response = await fetch('/api/access/lock', { method: 'POST' });
    if (!response.ok) throw new Error();
    returnToPreview();
  } catch {
    event.target.disabled = false;
    bar.querySelector('[role="status"]').textContent = '退出失败，请检查连接后重试。';
  }
});
const interval = setInterval(checkAccess, 15000);
window.addEventListener('pageshow', checkAccess);
document.addEventListener('visibilitychange', checkAccess);
window.addEventListener('pagehide', () => clearInterval(interval));
void checkAccess();
