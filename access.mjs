import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'signova_access';
const SESSION_MS = 8 * 60 * 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const digest = value => createHash('sha256').update(value).digest();
const publicFiles = new Set(['/', '/preview.html', '/preview.css', '/preview.js', '/assets/nova.png', '/assets/icon.svg', '/favicon.ico']);

export function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return origin.host === req.headers.host && origin.protocol === (req.socket.encrypted ? 'https:' : 'http:') && !origin.username && !origin.password;
  } catch { return false; }
}

function reply(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
  return true;
}

// A deployment-specific experience gate. A downloaded source tree remains editable by its owner.
export function createAccessGate({ env = process.env, now = () => Date.now() } = {}) {
  const key = typeof env.SIGNOVA_ACCESS_KEY === 'string' ? env.SIGNOVA_ACCESS_KEY.trim() : '';
  const configured = key.length >= 16 && key.length <= 256;
  const keyHash = digest(key);
  const sessions = new Map();
  const failures = new Map();
  const listeners = new Set();

  function tokenId(req) {
    const pairs = String(req.headers.cookie || '').split(';').map(pair => pair.trim());
    const values = pairs.filter(pair => pair.startsWith(`${COOKIE}=`));
    if (values.length !== 1) return null;
    const token = values[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? digest(token).toString('hex') : null;
  }
  function expiresAt(req) {
    const id = tokenId(req);
    const expires = id && sessions.get(id);
    if (!configured || !expires || expires <= now()) {
      if (id) sessions.delete(id);
      return 0;
    }
    return expires;
  }
  const isUnlocked = req => Boolean(expiresAt(req));
  function prune() {
    const time = now();
    for (const [id, expiry] of sessions) if (expiry <= time) sessions.delete(id);
    for (const [ip, bucket] of failures) if (bucket.until <= time) failures.delete(ip);
  }
  function cookie(req, value, seconds) {
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${req.socket.encrypted ? '; Secure' : ''}`;
  }

  async function handle(req, res, pathname) {
    // Windows treats backslashes as separators; never let routing and filesystem parsing disagree.
    if (pathname.includes('\\') || pathname.includes('\0')) return reply(res, 404, { error: 'Not found' });
    // Do not serve dotfiles, research inputs or real-person reference footage, even after unlock.
    if (pathname.split('/').some(part => part.startsWith('.')) || pathname.startsWith('/data/') || /^\/assets\/csl\/.*\.mp4$/i.test(pathname)) return reply(res, 404, { error: 'Not found' });
    if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return reply(res, 403, { error: '不允许跨站请求' });
    if (pathname === '/api/access/status') {
      if (req.method !== 'GET') return reply(res, 405, { error: 'Method not allowed' });
      return reply(res, 200, { unlocked: isUnlocked(req), configured });
    }
    if (pathname === '/api/access/lock') {
      if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });
      const id = tokenId(req);
      if (id) sessions.delete(id);
      for (const listener of listeners) listener();
      return reply(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }
    if (pathname === '/api/access/unlock') {
      if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });
      if (!configured) return reply(res, 503, { error: '功能体验暂未开放，可以先浏览示例。' });
      prune();
      const ip = req.socket.remoteAddress || 'unknown';
      const bucket = failures.get(ip);
      if (bucket?.count >= MAX_FAILURES || (!bucket && failures.size >= 4096)) {
        return reply(res, 429, { error: '尝试次数较多，请稍后再试。' }, { 'Retry-After': String(Math.max(1, Math.ceil(((bucket?.until || now() + WINDOW_MS) - now()) / 1000))) });
      }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 400, { error: '请求格式错误' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) return reply(res, 413, { error: '请求内容过长' });
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, { error: '请求格式错误' }); }
      if (typeof input?.key !== 'string' || !input.key.trim() || input.key.length > 256) return reply(res, 400, { error: '请输入有效的体验 Key。' });
      // Reading the body yields to concurrent requests; recheck before counting or comparing.
      prune();
      const currentBucket = failures.get(ip);
      if (currentBucket?.count >= MAX_FAILURES || (!currentBucket && failures.size >= 4096)) {
        return reply(res, 429, { error: '尝试次数较多，请稍后再试。' }, { 'Retry-After': String(Math.max(1, Math.ceil(((currentBucket?.until || now() + WINDOW_MS) - now()) / 1000))) });
      }
      if (!timingSafeEqual(keyHash, digest(input.key.trim()))) {
        failures.set(ip, { count: (currentBucket?.count || 0) + 1, until: currentBucket?.until || now() + WINDOW_MS });
        return reply(res, 401, { error: '体验 Key 不正确，请检查后重试。' });
      }
      if (sessions.size >= 1024) return reply(res, 503, { error: '体验人数较多，请稍后再试。' });
      failures.delete(ip);
      const oldId = tokenId(req);
      if (oldId) {
        sessions.delete(oldId);
        for (const listener of listeners) listener();
      }
      const token = randomBytes(32).toString('base64url');
      sessions.set(digest(token).toString('hex'), now() + SESSION_MS);
      return reply(res, 200, { ok: true, redirect: '/app' }, { 'Set-Cookie': cookie(req, token, SESSION_MS / 1000) });
    }
    if (publicFiles.has(pathname) || pathname === '/showcase' || pathname.startsWith('/showcase/')) return false;
    // All functional scripts, models, API endpoints and secondary HTML routes require a session.
    if (!isUnlocked(req)) {
      if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/app' || pathname === '/app/' || pathname.endsWith('.html'))) {
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      return reply(res, 401, { error: '请先输入体验 Key 解锁功能。', code: 'ACCESS_REQUIRED' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return false;
  }
  return { handle, isUnlocked, expiresAt, onRevoke(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
