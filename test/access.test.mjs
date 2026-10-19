import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createServer } from '../server.mjs';

// Keep these independent: a provider credential must never unlock the demo.
const ACCESS_KEY = 'dummy-signova-access-key-12345';
const MODEL_KEY = 'dummy-provider-key-67890';
const configuredEnv = { SIGNOVA_ACCESS_KEY: ACCESS_KEY, AI_API_KEY: MODEL_KEY };
const modelResult = {
  replies: ['请问在哪里提交？', '请确认材料要求。'],
  draft: { title: '实习申请', action: '提交实习证明', deadline: '周五', correction: false },
  suggestedTaskId: null,
  memoryNote: '保存前需要确认。',
};

async function fixture(t, env = configuredEnv) {
  const upstreamCalls = [];
  const server = createServer({
    env,
    fetchImpl: async (url, init) => {
      upstreamCalls.push({ url, init });
      return new Response(JSON.stringify({ choices: [{
        message: { content: JSON.stringify(modelResult) }, finish_reason: 'stop',
      }] }));
    },
  });
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (pathname, options = {}) => {
    const response = await fetch(`${origin}${pathname}`, { ...options, redirect: 'manual' });
    const body = await response.text();
    return { status: response.status, headers: response.headers, body,
      json: () => JSON.parse(body) };
  };
  const post = (pathname, value, headers = {}) => request(pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify(value),
  });
  const unlock = async (key = ACCESS_KEY) => {
    const response = await post('/api/access/unlock', { key });
    assert.equal(response.status, 200, response.body);
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie, 'successful unlock must set a session cookie');
    return { response, cookie: setCookie.split(';', 1)[0] };
  };
  return { origin, request, post, unlock, upstreamCalls, server };
}

function handshake(origin, { cookie, requestOrigin = origin, pathname = '/api/asr' } = {}) {
  return new Promise((resolve, reject) => {
    // Never send a start message, microphone data, or provider credentials.
    const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}${pathname}`, {
      origin: requestOrigin,
      headers: cookie ? { Cookie: cookie } : {},
      handshakeTimeout: 2000,
    });
    let settled = false;
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      socket.terminate();
      if (error) reject(error);
      else resolve(status);
    };
    socket.on('open', () => finish(101));
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(response.statusCode);
    });
    socket.on('error', error => finish(undefined, error));
  });
}

test('public landing page, preview assets and showcase remain usable without an access key', async t => {
  const app = await fixture(t);
  const page = await app.request('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.body, /preview\.js/);
  assert.doesNotMatch(page.body, /\bapp\.js\b/);
  for (const pathname of ['/preview.js', '/preview.css', '/assets/nova.png', '/assets/icon.svg',
    '/showcase/', '/showcase/showcase.js', '/showcase/styles.css', '/showcase/assets/nova.png']) {
    const response = await app.request(pathname, { method: 'HEAD' });
    assert.equal(response.status, 200, pathname);
  }
  const status = await app.request('/api/access/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.json(), { unlocked: false, configured: true });
  assert.doesNotMatch(page.body + status.body, /dummy-signova|dummy-provider/);
  assert.equal(app.upstreamCalls.length, 0);
});

test('protected pages redirect and protected scripts, models and encoded paths deny anonymous access', async t => {
  const app = await fixture(t);
  for (const pathname of ['/app', '/index.html', '/character.html', '/%61pp', '/%69ndex.html', '/%63haracter.html']) {
    const response = await app.request(pathname);
    assert.ok([302, 303, 307].includes(response.status), `${pathname}: ${response.status}`);
    assert.equal(response.headers.get('location'), '/');
    assert.doesNotMatch(response.body, /\bapp\.js\b/);
  }
  for (const pathname of ['/app.js', '/core.js', '/assets/nova-rigged.glb', '/assets/nova-complete.glb',
    '/%61pp.js', '/%63ore.js', '/assets/%6eova-rigged.glb', '/assets%2fnova-rigged.glb']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await app.request(pathname, { method });
      assert.equal(response.status, 401, `${method} ${pathname}`);
    }
  }
  assert.equal(app.upstreamCalls.length, 0);
});

test('model APIs deny anonymous and encoded requests before reaching the provider', async t => {
  const app = await fixture(t);
  for (const pathname of ['/api/analyze', '/api/model/check', '/api/%61nalyze', '/api/model/%63heck']) {
    const response = await app.post(pathname, { text: '请周五提交实习证明。' });
    assert.equal(response.status, 401, pathname);
  }
  for (const pathname of ['/api/status', '/api/%73tatus']) {
    assert.equal((await app.request(pathname)).status, 401, pathname);
  }
  assert.equal(app.upstreamCalls.length, 0, 'authentication must run before model work');
});

test('missing or short access configuration fails closed even with a configured provider', async t => {
  for (const env of [{}, { AI_API_KEY: MODEL_KEY }, { ...configuredEnv, SIGNOVA_ACCESS_KEY: 'too-short' }]) {
    const app = await fixture(t, env);
    assert.deepEqual((await app.request('/api/access/status')).json(), { unlocked: false, configured: false });
    assert.equal((await app.post('/api/access/unlock', { key: ACCESS_KEY })).status, 503);
    assert.equal((await app.post('/api/analyze', { text: '你好' })).status, 401);
    assert.equal((await app.request('/api/status')).status, 401);
    assert.equal((await app.request('/')).status, 200);
    assert.equal(app.upstreamCalls.length, 0);
  }
});

test('unlock grants an HttpOnly strict session and permits app, status and stubbed model requests', async t => {
  const app = await fixture(t);
  const { response, cookie } = await app.unlock();
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /(?:^|;\s*)HttpOnly(?:;|$)/i);
  assert.match(setCookie, /(?:^|;\s*)SameSite=Strict(?:;|$)/i);
  assert.match(setCookie, /(?:^|;\s*)Path=\/(?:;|$)/i);
  assert.doesNotMatch(response.body + setCookie, /dummy-signova|dummy-provider/);
  const headers = { Cookie: cookie };
  assert.deepEqual((await app.request('/api/access/status', { headers })).json(), { unlocked: true, configured: true });
  const page = await app.request('/app', { headers });
  assert.equal(page.status, 200);
  assert.match(page.body, /\bapp\.js\b/);
  assert.equal((await app.request('/app.js', { headers, method: 'HEAD' })).status, 200);
  assert.equal((await app.request('/core.js', { headers, method: 'HEAD' })).status, 200);
  const publicPage = await app.request('/', { headers });
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.body, /preview\.js/);
  assert.doesNotMatch(publicPage.body, /\bapp\.js\b/);
  const status = await app.request('/api/status', { headers });
  assert.equal(status.status, 200);
  assert.equal(status.json().model.configured, true);
  assert.equal(app.upstreamCalls.length, 0, 'status checks must not spend provider requests');
  const analyzed = await app.post('/api/analyze', { text: '请周五提交实习证明。' }, headers);
  assert.equal(analyzed.status, 200, analyzed.body);
  assert.equal(analyzed.json().mode, 'model');
  const checked = await app.post('/api/model/check', {}, headers);
  assert.equal(checked.status, 200, checked.body);
  assert.equal(checked.json().ok, true);
  assert.equal(app.upstreamCalls.length, 2);
  assert.doesNotMatch(status.body + analyzed.body + checked.body, /dummy-signova|dummy-provider/);
});

test('malformed unlock payloads return 400 and provider credentials are not access credentials', async t => {
  const app = await fixture(t);
  for (const body of ['{', 'null', '[]', '{}', '{"key":42}', '{"key":{}}']) {
    const response = await app.request('/api/access/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin }, body,
    });
    assert.equal(response.status, 400, body);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const wrong = await app.post('/api/access/unlock', { key: MODEL_KEY });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.equal((await app.request('/api/access/status')).json().unlocked, false);
  await app.unlock();
  assert.equal(app.upstreamCalls.length, 0);
});

test('cross-site origins cannot unlock, use the model, or log out an existing session', async t => {
  const app = await fixture(t);
  const invalidOrigins = ['https://foreign.example', 'null', app.origin.replace('http:', 'https:')];
  for (const Origin of invalidOrigins) {
    const response = await app.post('/api/access/unlock', { key: ACCESS_KEY }, { Origin });
    assert.equal(response.status, 403, Origin);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const { cookie } = await app.unlock();
  for (const pathname of ['/api/analyze', '/api/model/check', '/api/access/lock']) {
    const response = await app.post(pathname, { text: '你好' }, { Cookie: cookie, Origin: 'https://foreign.example' });
    assert.equal(response.status, 403, pathname);
  }
  assert.equal((await app.request('/api/access/status', { headers: { Cookie: cookie } })).json().unlocked, true);
  assert.equal(app.upstreamCalls.length, 0);
});

test('five failures limit the remote address for ten minutes, ignoring spoofed forwarding headers', async t => {
  const app = await fixture(t);
  const realNow = Date.now();
  let now = realNow;
  t.mock.method(Date, 'now', () => now);
  for (let index = 0; index < 5; index++) {
    const response = await app.post('/api/access/unlock', { key: `wrong-access-key-${index}` }, {
      'X-Forwarded-For': `192.0.2.${index + 1}`,
    });
    assert.equal(response.status, 401, `failed attempt ${index + 1}`);
  }
  const blocked = await app.post('/api/access/unlock', { key: ACCESS_KEY }, { 'X-Forwarded-For': '198.51.100.9' });
  assert.equal(blocked.status, 429);
  const retryAfter = Number(blocked.headers.get('retry-after'));
  assert.ok(retryAfter > 0 && retryAfter <= 600, `unexpected Retry-After: ${retryAfter}`);
  now = realNow + 599000;
  assert.equal((await app.post('/api/access/unlock', { key: ACCESS_KEY })).status, 429);
  now = realNow + 600001;
  await app.unlock();
  assert.equal(app.upstreamCalls.length, 0);
});

test('concurrent unlock bodies cannot overwrite the remote address failure count', { timeout: 5000 }, async t => {
  const app = await fixture(t);
  const requestCount = 8;
  let seenHeaders = 0;
  const headersReceived = new Promise(resolve => {
    const onRequest = req => {
      if (req.url !== '/api/access/unlock' || ++seenHeaders !== requestCount) return;
      app.server.off('request', onRequest);
      resolve();
    };
    app.server.on('request', onRequest);
  });
  const body = JSON.stringify({ key: 'incorrect-dummy-access-key' });
  const pending = [];
  const responses = Array.from({ length: requestCount }, () => new Promise((resolve, reject) => {
    const request = http.request(`${app.origin}/api/access/unlock`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Origin: app.origin,
      },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    pending.push(request);
    request.flushHeaders();
  }));
  // Let every request reach body parsing before allowing any comparison to finish.
  await headersReceived;
  for (const request of pending) request.end(body);
  const statuses = await Promise.all(responses);
  assert.ok(statuses.every(status => status === 401 || status === 429), JSON.stringify(statuses));
  assert.equal((await app.post('/api/access/unlock', { key: ACCESS_KEY })).status, 429);
  assert.equal(app.upstreamCalls.length, 0);
});

test('tampered, forged, revoked and other-server cookies cannot restore access', async t => {
  const app = await fixture(t);
  const { cookie } = await app.unlock();
  const separator = cookie.indexOf('=');
  const name = cookie.slice(0, separator);
  const value = cookie.slice(separator + 1);
  const changed = `${name}=${value[0] === 'a' ? 'b' : 'a'}${value.slice(1)}`;
  for (const invalid of [changed, `${name}=forged-session-token`, `${name}=${ACCESS_KEY}`]) {
    const headers = { Cookie: invalid };
    assert.equal((await app.request('/api/access/status', { headers })).json().unlocked, false);
    assert.equal((await app.request('/api/status', { headers })).status, 401);
    assert.equal((await app.post('/api/analyze', { text: '你好' }, headers)).status, 401);
  }
  const separateServer = await fixture(t);
  assert.equal((await separateServer.request('/api/status', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await separateServer.request('/api/access/status', { headers: { Cookie: cookie } })).json().unlocked, false);
  const locked = await app.post('/api/access/lock', {}, { Cookie: cookie });
  assert.ok([200, 204].includes(locked.status), locked.body);
  const cleared = locked.headers.get('set-cookie');
  assert.ok(cleared, 'logout must expire the browser cookie');
  assert.match(cleared, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  assert.equal((await app.request('/api/status', { headers: { Cookie: cookie } })).status, 401, 'copied pre-logout cookie must be revoked');
  assert.equal((await app.request('/api/access/status', { headers: { Cookie: cookie } })).json().unlocked, false);
  assert.equal(app.upstreamCalls.length + separateServer.upstreamCalls.length, 0);
});

test('ASR requires a valid session before upgrading and still enforces origin after unlock', async t => {
  const app = await fixture(t);
  assert.equal(await handshake(app.origin), 401, 'matching Origin alone must not authorize ASR');
  const { cookie } = await app.unlock();
  assert.equal(await handshake(app.origin, { cookie: `${cookie}tampered` }), 401);
  assert.equal(await handshake(app.origin, { cookie, requestOrigin: 'https://foreign.example' }), 403);
  assert.equal(await handshake(app.origin, { cookie }), 101);
  await app.post('/api/access/lock', {}, { Cookie: cookie });
  assert.equal(await handshake(app.origin, { cookie }), 401);
  assert.equal(app.upstreamCalls.length, 0);
});

test('sessions expire after eight hours even if used immediately before their fixed deadline', async t => {
  const app = await fixture(t);
  const startedAt = Date.now();
  let now = startedAt;
  t.mock.method(Date, 'now', () => now);
  const { cookie, response } = await app.unlock();
  assert.match(response.headers.get('set-cookie'), /(?:^|;\s*)Max-Age=28800(?:;|$)/i);
  const headers = { Cookie: cookie };
  now = startedAt + 8 * 60 * 60 * 1000 - 1;
  assert.equal((await app.request('/api/status', { headers })).status, 200);
  assert.equal((await app.request('/api/access/status', { headers })).json().unlocked, true);
  now++;
  assert.equal((await app.request('/api/status', { headers })).status, 401);
  assert.equal((await app.request('/api/access/status', { headers })).json().unlocked, false);
  assert.equal((await app.post('/api/analyze', { text: '你好' }, headers)).status, 401);
  assert.equal(await handshake(app.origin, { cookie }), 401);
  assert.equal(app.upstreamCalls.length, 0);
});

test('logout and token rotation close their established ASR sockets without revoking other sessions', async t => {
  const app = await fixture(t);
  const first = await app.unlock();
  const second = await app.unlock();
  const connectIdle = async cookie => {
    const client = new WebSocket(`${app.origin.replace(/^http/, 'ws')}/api/asr`, {
      origin: app.origin, headers: { Cookie: cookie }, handshakeTimeout: 2000,
    });
    t.after(() => client.terminate());
    await once(client, 'open', { signal: AbortSignal.timeout(3000) });
    return client;
  };
  const firstSocket = await connectIdle(first.cookie);
  const secondSocket = await connectIdle(second.cookie);
  const firstClosed = once(firstSocket, 'close', { signal: AbortSignal.timeout(3000) });
  assert.equal((await app.post('/api/access/lock', {}, { Cookie: first.cookie })).status, 200);
  const [logoutCode, logoutReason] = await firstClosed;
  assert.equal(logoutCode, 1008);
  assert.equal(logoutReason.toString(), 'access');
  assert.equal(secondSocket.readyState, WebSocket.OPEN);
  assert.equal((await app.request('/api/status', { headers: { Cookie: second.cookie } })).status, 200);
  const secondClosed = once(secondSocket, 'close', { signal: AbortSignal.timeout(3000) });
  const rotated = await app.post('/api/access/unlock', { key: ACCESS_KEY }, { Cookie: second.cookie });
  assert.equal(rotated.status, 200);
  const [rotationCode, rotationReason] = await secondClosed;
  assert.equal(rotationCode, 1008);
  assert.equal(rotationReason.toString(), 'access');
  assert.equal((await app.request('/api/status', { headers: { Cookie: second.cookie } })).status, 401);
  assert.equal(app.upstreamCalls.length, 0);
  // Neither idle WebSocket sends start or audio, so no paid ASR is started.
});

test('the public film supports bounded, suffix and rejected byte ranges without unlocking', async t => {
  const app = await fixture(t);
  const pathname = '/showcase/promo.mp4';
  const head = await app.request(pathname, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'video/mp4');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  const size = Number(head.headers.get('content-length'));
  assert.ok(size > 16);
  for (const [range, start, end] of [['bytes=0-15', 0, 15], ['bytes=-8', size - 8, size - 1]]) {
    const response = await fetch(`${app.origin}${pathname}`, { headers: { Range: range }, redirect: 'manual' });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${size}`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.equal((await response.arrayBuffer()).byteLength, end - start + 1);
  }
  const invalid = await app.request(pathname, { headers: { Range: `bytes=${size}-` } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), `bytes */${size}`);
  assert.equal(app.upstreamCalls.length, 0);
});

test('showcase URL encoding and traversal cannot expose functional scripts or files outside its directory', async t => {
  const app = await fixture(t);
  const traversalPaths = [
    '/showcase/../app.js',
    '/showcase/%2e%2e/app.js',
    '/showcase/%2e%2e%2f%2e%2e%2fserver.mjs',
    '/showcase/%5c..%5capp.js',
    '/%73howcase/%5c..%5capp.js',
    '/showcase%2f%5c..%5capp.js',
    '/showcase/%252e%252e%252fserver.mjs',
  ];
  for (const pathname of traversalPaths) {
    const response = await app.request(pathname);
    assert.ok([400, 401, 403, 404].includes(response.status), `${pathname}: ${response.status}`);
    assert.doesNotMatch(response.body, /DEFAULT_KNOWLEDGE|createAccessGate|createServer/);
  }
  // With a session, traversing out of the showcase is still not a public-file capability.
  const { cookie } = await app.unlock();
  for (const pathname of traversalPaths.slice(2)) {
    const response = await app.request(pathname, { headers: { Cookie: cookie } });
    assert.ok([400, 403, 404].includes(response.status), `${pathname}: ${response.status}`);
  }
  assert.equal(app.upstreamCalls.length, 0);
});
