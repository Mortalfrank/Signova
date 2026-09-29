import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { WebSocket, WebSocketServer } from 'ws';
import { attachAsr, buildRunTask, getAsrStatus } from '../asr.mjs';

const localListen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
function messages(socket) {
  const queue = [], waiting = [];
  socket.on('message', data => {
    const result = JSON.parse(data.toString());
    if (waiting.length) waiting.shift()(result);
    else queue.push(result);
  });
  return () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve));
}

test('ASR configuration never treats another vendor key as DashScope and never exposes credentials', () => {
  assert.equal(getAsrStatus({ AI_API_KEY: 'test-secret' }).configured, false);
  assert.equal(getAsrStatus({ DASHSCOPE_API_KEY: 'test-secret' }).configured, true);
  assert.equal(getAsrStatus({ ASR_API_KEY: 'test-secret', ASR_WS_URL: 'wss://example.com/api-ws/v1/inference' }).configured, false);
  assert.equal(getAsrStatus({ ASR_API_KEY: 'test-secret', ASR_WS_URL: 'wss://space-123.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference' }).configured, true);
  assert.equal(JSON.stringify(getAsrStatus({ DASHSCOPE_API_KEY: 'test-secret' })).includes('test-secret'), false);
  const request = buildRunTask('task', 'qwen-audio-3.1-asr-flash-streaming', ['实习证明', '实习证明', 7, '']);
  assert.deepEqual(request.payload.parameters.vocabulary, { '实习证明': 3 });
  assert.equal(request.payload.parameters.sample_rate, 16000);
  assert.equal(request.payload.parameters.format, 'pcm');
});

test('ASR bridge enforces origin, starts only on request, streams PCM and final results then finishes', async t => {
  const upstreamHttp = http.createServer();
  const upstreamServer = new WebSocketServer({ server: upstreamHttp });
  const upstreamPort = await localListen(upstreamHttp);
  let connected = 0, run, audio, auth;
  upstreamServer.on('connection', (socket, req) => {
    connected++;
    auth = req.headers.authorization;
    socket.on('message', (data, binary) => {
      if (binary) {
        audio = Buffer.from(data);
        socket.send(JSON.stringify({ header: { event: 'result-generated', task_id: run.header.task_id },
          payload: { output: { sentence: { text: '请提交实习证明。', sentence_end: true, sentence_id: 1 } } } }));
        return;
      }
      const command = JSON.parse(data.toString());
      if (command.header.action === 'run-task') {
        run = command;
        socket.send(JSON.stringify({ header: { event: 'task-started', task_id: run.header.task_id }, payload: {} }));
      } else if (command.header.action === 'finish-task') {
        assert.equal(command.header.task_id, run.header.task_id);
        socket.send(JSON.stringify({ header: { event: 'task-finished', task_id: run.header.task_id }, payload: {} }));
      }
    });
  });
  const server = http.createServer();
  const bridge = attachAsr(server, { env: { ASR_API_KEY: 'test-secret' },
    connect: (_url, options) => new WebSocket(`ws://127.0.0.1:${upstreamPort}`, options) });
  const port = await localListen(server);
  const origin = `http://127.0.0.1:${port}`;
  t.after(async () => {
    bridge.close();
    for (const client of upstreamServer.clients) client.terminate();
    upstreamServer.close();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstreamHttp.close(resolve))]);
  });
  for (const invalidOrigin of [undefined, 'null', 'https://malicious.example']) {
    const denied = new WebSocket(`ws://127.0.0.1:${port}/api/asr`, invalidOrigin ? { origin: invalidOrigin } : {});
    denied.on('error', () => {});
    const status = await new Promise(resolve => denied.on('unexpected-response', (_req, res) => { resolve(res.statusCode); res.resume(); denied.terminate(); }));
    assert.equal(status, 403);
  }
  assert.equal(connected, 0);
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/asr`, { origin });
  const next = messages(client);
  await once(client, 'open');
  assert.equal(connected, 0);
  client.send(JSON.stringify({ type: 'start', hotwords: ['实习证明'] }));
  assert.equal((await next()).type, 'ready');
  assert.equal(auth, 'Bearer test-secret');
  assert.deepEqual(run.payload.parameters.vocabulary, { '实习证明': 3 });
  const second = new WebSocket(`ws://127.0.0.1:${port}/api/asr`, { origin });
  const nextSecond = messages(second);
  await once(second, 'open');
  second.send(JSON.stringify({ type: 'start' }));
  assert.equal((await nextSecond()).code, 'busy');
  const frame = Buffer.alloc(3200);
  client.send(frame);
  const transcript = await next();
  assert.equal(transcript.text, '请提交实习证明。');
  assert.equal(transcript.final, true);
  assert.equal(audio.length, frame.length);
  client.send(JSON.stringify({ type: 'stop' }));
  assert.equal((await next()).type, 'end');
  await once(client, 'close');
});

test('ASR upstream task failure returns safe classified errors and no provider raw details', async t => {
  const upstreamHttp = http.createServer();
  const upstreamServer = new WebSocketServer({ server: upstreamHttp });
  const upstreamPort = await localListen(upstreamHttp);
  upstreamServer.on('connection', socket => socket.on('message', () => socket.send(JSON.stringify({
    header: { event: 'task-failed', error_code: 'InvalidApiKey', error_message: 'test-secret upstream-private-detail' }, payload: {},
  }))));
  const server = http.createServer();
  const bridge = attachAsr(server, { env: { ASR_API_KEY: 'test-secret' },
    connect: (_url, options) => new WebSocket(`ws://127.0.0.1:${upstreamPort}`, options) });
  const port = await localListen(server);
  t.after(async () => {
    bridge.close();
    for (const client of upstreamServer.clients) client.terminate();
    upstreamServer.close();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstreamHttp.close(resolve))]);
  });
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/asr`, { origin: `http://127.0.0.1:${port}` });
  const next = messages(client);
  await once(client, 'open');
  client.send(JSON.stringify({ type: 'start' }));
  const error = await next();
  assert.equal(error.code, 'auth');
  assert.equal(JSON.stringify(error).includes('upstream-private-detail'), false);
  assert.equal(JSON.stringify(error).includes('test-secret'), false);
});

test('PCM worklet preserves exactly one second across 44.1kHz blocks, mixes mono and writes signed little endian', async () => {
  const script = await readFile(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8');
  let Processor;
  const frames = [];
  const context = { sampleRate: 44100, ArrayBuffer, DataView,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: event => { if (event.type === 'audio') frames.push(event.buffer); } }; } },
    registerProcessor: (_name, Constructor) => { Processor = Constructor; } };
  vm.runInNewContext(script, context);
  const processor = new Processor();
  for (let index = 0; index < 44100; index += 128) {
    const samples = Math.min(128, 44100 - index);
    processor.process([[new Float32Array(samples).fill(1), new Float32Array(samples).fill(0)]]);
  }
  processor.port.onmessage({ data: { type: 'stop' } });
  const data = Buffer.concat(frames.map(frame => Buffer.from(frame)));
  assert.equal(data.length, 32000);
  for (let offset = 0; offset < data.length; offset += 2) assert.equal(data.readInt16LE(offset), 16384);
  assert.equal(processor.process([]), false);
});

test('cancelling a pending microphone permission request releases tracks acquired later', async () => {
  const source = await readFile(new URL('../public/asr-client.js', import.meta.url), 'utf8');
  let resolvePermission, stoppedTracks = 0, closedContexts = 0;
  const permission = new Promise(resolve => { resolvePermission = resolve; });
  const browser = {
    isSecureContext: true, AudioWorkletNode: class {}, addEventListener() {}, removeEventListener() {},
    AudioContext: class {
      constructor() { this.state = 'running'; }
      resume() { return Promise.resolve(); }
      close() { closedContexts++; this.state = 'closed'; return Promise.resolve(); }
    },
  };
  const scope = { window: browser, navigator: { mediaDevices: { getUserMedia: () => permission } }, setTimeout, clearTimeout, URL };
  vm.createContext(scope);
  vm.runInContext(source.replace('export function startCloudMic', 'function startCloudMic'), scope);
  const controller = new AbortController();
  const startup = scope.startCloudMic({ signal: controller.signal });
  const rejected = assert.rejects(startup, error => error.code === 'aborted');
  controller.abort();
  await rejected;
  resolvePermission({ getTracks: () => [{ stop: () => { stoppedTracks++; } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stoppedTracks, 1);
  assert.equal(closedContexts, 1);
});
