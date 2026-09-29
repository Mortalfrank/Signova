import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const DEFAULT_MODEL = 'qwen-audio-3.1-asr-flash-streaming';
const DEFAULT_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const MAX_SECONDS = 600;
const SAMPLE_RATE = 16000;
const errors = {
  unconfigured: '实时语音尚未配置，请先在电脑上填写百炼密钥并重启服务。',
  busy: '已有一个语音会话正在使用，请先停止后再试。',
  rate: '启动过于频繁，请稍等一分钟再试。',
  auth: '语音服务鉴权失败，请检查密钥、地域和模型权限。',
  quota: '语音服务额度不足或请求受限，请检查百炼用量。',
  config: '语音服务模型或参数不可用，请检查模型名称及地域配置。',
  network: '语音服务连接中断，请检查网络后重试。',
  timeout: '语音服务响应超时，请稍后重新开启麦克风。',
  protocol: '语音数据格式异常，请刷新页面后重试。',
  limit: '本次收音已达到 10 分钟限制，请重新开启。',
  backpressure: '网络发送速度不足，收音已停止，请检查网络后重试。',
};

function config(env) {
  const key = env.ASR_API_KEY || env.DASHSCOPE_API_KEY || (env.AI_PROVIDER === 'dashscope' ? env.AI_API_KEY : '');
  const model = env.ASR_MODEL || DEFAULT_MODEL;
  const endpoint = env.ASR_WS_URL || DEFAULT_URL;
  let valid = false;
  try {
    const url = new URL(endpoint);
    valid = url.protocol === 'wss:' && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/api-ws/v1/inference' &&
      /^(dashscope(?:-intl)?\.aliyuncs\.com|[a-zA-Z0-9-]+\.(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com)$/.test(url.hostname);
  } catch { /* Invalid configuration is represented without exposing its contents. */ }
  const configured = Boolean(key?.trim() && valid && /^qwen-audio-3\.[01]-asr-flash-streaming$/.test(model));
  return { key, model, endpoint, configured };
}

export function getAsrStatus(env = process.env) {
  const value = config(env);
  return { configured: value.configured, provider: 'dashscope', model: value.model,
    maxDurationSeconds: MAX_SECONDS, ...(value.configured ? {} : { reason: errors.unconfigured }) };
}

export function buildRunTask(taskId, model, words = []) {
  const hotwords = [...new Set(Array.isArray(words) ? words.filter(word => typeof word === 'string')
    .map(word => word.trim()).filter(word => word && word.length <= 30) : [])].slice(0, 50);
  const parameters = { format: 'pcm', sample_rate: SAMPLE_RATE, language_hints: ['zh', 'en'] };
  // Official streaming protocol supports ephemeral vocabulary, with weights 1–5.
  if (hotwords.length) parameters.vocabulary = Object.fromEntries(hotwords.map(word => [word, 3]));
  return { header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: { task_group: 'audio', task: 'asr', function: 'recognition', model, parameters, input: {} } };
}

function errorCode(code) {
  const value = String(code || '');
  if (/401|403|auth|forbidden|api.?key|access.?denied/i.test(value)) return 'auth';
  if (/429|quota|limit|balance|arrear|throttl/i.test(value)) return 'quota';
  if (/invalid|parameter|model|400|404/i.test(value)) return 'config';
  return 'network';
}

// This bridge intentionally supports one local demo user. It is not public-site authentication.
export function attachAsr(server, { env = process.env, connect = (url, options) => new WebSocket(url, options) } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const sessions = new Set();
  let starts = [];
  const reject = (socket, status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  function upgrade(req, socket, head) {
    if (req.url !== '/api/asr') return reject(socket, '404 Not Found');
    try {
      const origin = new URL(req.headers.origin || '');
      const protocol = req.socket.encrypted ? 'https:' : 'http:';
      if (origin.protocol !== protocol || origin.host !== req.headers.host || origin.username || origin.password)
        return reject(socket, '403 Forbidden');
    } catch { return reject(socket, '403 Forbidden'); }
    wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client));
  }
  server.on('upgrade', upgrade);
  wss.on('connection', client => {
    let upstream, stage = 'idle', bytes = 0, ended = false, taskId, lastAudio = 0;
    const timers = new Set();
    const timer = (fn, ms) => { const value = setTimeout(fn, ms); value.unref?.(); timers.add(value); return value; };
    const send = data => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data)); };
    const cleanup = () => {
      if (ended) return;
      ended = true;
      for (const value of timers) clearTimeout(value);
      sessions.delete(client);
      if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
    };
    const fail = code => {
      if (ended) return;
      send({ type: 'error', code, message: errors[code] || errors.network });
      cleanup();
      client.close(1008, code);
    };
    const done = () => {
      if (ended) return;
      send({ type: 'end' });
      cleanup();
      client.close(1000);
    };
    const finish = () => {
      if (stage === 'finishing') return;
      if (stage !== 'streaming' || upstream?.readyState !== WebSocket.OPEN) return done();
      stage = 'finishing';
      upstream.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } }));
      timer(() => fail('timeout'), 10000);
    };
    const initialTimer = timer(() => fail('timeout'), 15000);
    client.on('error', cleanup);
    client.on('close', cleanup);
    client.on('message', (data, isBinary) => {
      if (ended) return;
      if (isBinary) {
        if (stage !== 'streaming' || !data.length || data.length % 2) return fail('protocol');
        bytes += data.length;
        if (bytes > SAMPLE_RATE * 2 * MAX_SECONDS) return fail('limit');
        if (bytes > (Date.now() - lastAudio) * SAMPLE_RATE * 2 / 1000 + SAMPLE_RATE * 4) return fail('rate');
        if (upstream.readyState !== WebSocket.OPEN) return fail('network');
        if (upstream.bufferedAmount > 256000) return fail('backpressure');
        upstream.send(data, { binary: true });
        return;
      }
      if (data.length > 8000) return fail('protocol');
      let message;
      try { message = JSON.parse(data.toString()); } catch { return fail('protocol'); }
      if (message?.type === 'stop') return finish();
      if (message?.type !== 'start' || stage !== 'idle') return fail('protocol');
      const settings = config(env);
      if (!settings.configured) return fail('unconfigured');
      if (sessions.size) return fail('busy');
      const now = Date.now();
      starts = starts.filter(start => now - start < 60000);
      if (starts.length >= 6) return fail('rate');
      starts.push(now);
      sessions.add(client);
      stage = 'starting';
      taskId = randomUUID();
      clearTimeout(initialTimer);
      const startTimer = timer(() => fail('timeout'), 15000);
      timer(() => fail('limit'), MAX_SECONDS * 1000);
      try {
        upstream = connect(settings.endpoint, { headers: { Authorization: `Bearer ${settings.key}` },
          handshakeTimeout: 10000, maxPayload: 128000, perMessageDeflate: false, followRedirects: false });
      } catch { return fail('network'); }
      upstream.on('open', () => {
        if (ended) return upstream.terminate();
        upstream.send(JSON.stringify(buildRunTask(taskId, settings.model, message.hotwords)));
      });
      upstream.on('unexpected-response', (_req, response) => { response.resume(); fail(errorCode(response.statusCode)); });
      upstream.on('error', () => fail('network'));
      upstream.on('close', () => { if (!ended) fail('network'); });
      upstream.on('message', (payload, binary) => {
        if (ended || binary) return;
        let result;
        try { result = JSON.parse(payload.toString()); } catch { return fail('protocol'); }
        if (result.header?.task_id && result.header.task_id !== taskId) return fail('protocol');
        switch (result.header?.event) {
          case 'task-started':
            if (stage !== 'starting') return fail('protocol');
            clearTimeout(startTimer);
            stage = 'streaming';
            lastAudio = Date.now();
            send({ type: 'ready', sampleRate: SAMPLE_RATE });
            break;
          case 'result-generated': {
            const sentence = result.payload?.output?.sentence;
            if (!sentence?.heartbeat && typeof sentence?.text === 'string' && sentence.text.trim()) {
              send({ type: 'text', text: sentence.text.slice(0, 4000), final: sentence.sentence_end === true,
                sentenceId: Number.isInteger(sentence.sentence_id) ? sentence.sentence_id : null });
            }
            break;
          }
          case 'task-finished': done(); break;
          case 'task-failed': fail(errorCode(result.header?.error_code)); break;
        }
      });
    });
  });
  const close = () => {
    server.off('upgrade', upgrade);
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
  server.once('close', close);
  return { close };
}
