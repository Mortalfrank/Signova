import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithModel, getModelStatus, ModelError } from '../model.mjs';

const env = { AI_API_KEY: 'unit-test-secret-key' };
const oldTask = { id: 'task-1', title: '实习申请', action: '补交实习证明', deadline: '周三', source: '周三前补交证明。', status: 'pending', profile: 'personal', history: [{ secret: 'not-sent' }] };
const newTask = () => ({ replies: ['请问在哪里提交？', '请确认材料要求。'], draft: { title: '实习申请', action: '提交实习证明', deadline: '周五', correction: false }, suggestedTaskId: null, memoryNote: '根据当前发言提出待办，保存前需要确认。' });
const modelResponse = (result, finishReason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: finishReason }] }));
const options = result => ({ env, fetchImpl: async () => modelResponse(result) });

test('配置检查接受两种密钥名；不返回密钥或服务地址', () => {
  assert.deepEqual(getModelStatus(env), { configured: true, provider: 'dashscope', model: 'qwen3.7-plus' });
  assert.equal(getModelStatus({ DASHSCOPE_API_KEY: 'test-dashscope-key' }).configured, true);
  for (const key of ['', 'sk-xxx', 'your-api-key', 'sk-your-api-key', '请填入密钥']) {
    assert.equal(getModelStatus({ AI_API_KEY: key }).configured, false);
  }
  assert.doesNotMatch(JSON.stringify(getModelStatus(env)), /unit-test-secret|https/);
});

test('真实请求格式为兼容 Chat Completions，默认关闭千问思考，来源固定为当前发言', async () => {
  let seen;
  const raw = newTask();
  raw.draft.source = '模型伪造的来源';
  const result = await analyzeWithModel({ text: ' 请在周五前提交实习证明。 ', knowledge: '提交至学生服务中心。' }, {
    env,
    fetchImpl: async (url, init) => {
      seen = { url, init, payload: JSON.parse(init.body) };
      return modelResponse(raw);
    }
  });
  assert.equal(seen.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.headers.Authorization, 'Bearer unit-test-secret-key');
  assert.ok(seen.init.signal instanceof AbortSignal);
  assert.equal(seen.payload.model, 'qwen3.7-plus');
  assert.equal(seen.payload.enable_thinking, false);
  assert.deepEqual(seen.payload.response_format, { type: 'json_object' });
  assert.match(seen.payload.messages[0].content, /否定、条件/);
  assert.match(seen.payload.messages[0].content, /null 表示本次没有提到/);
  assert.equal(JSON.parse(seen.payload.messages[1].content).utterance, '请在周五前提交实习证明。');
  assert.equal(result.draft.source, '请在周五前提交实习证明。');
  assert.equal(result.mode, 'model');
});

test('只发送受限的已选记忆和最近上下文，不发送档案或完整历史', async () => {
  let data;
  const long = 'a'.repeat(14000);
  const memories = Array.from({ length: 9 }, (_, index) => ({ ...oldTask, id: `task-${index}`, title: long, action: long, deadline: long, source: long, unknown: 'private' }));
  await analyzeWithModel({ text: '请解释一下。', knowledge: long, memories, context: Array.from({ length: 9 }, (_, index) => ({ text: `${index}${long}`, secret: 'omit' })) }, {
    env,
    fetchImpl: async (_, init) => {
      data = JSON.parse(JSON.parse(init.body).messages[1].content);
      return modelResponse({ replies: ['请再说明一下。', '这是什么意思？'], draft: null, suggestedTaskId: null, memoryNote: '' });
    }
  });
  assert.equal(data.sceneKnowledge.length, 12000);
  assert.equal(data.confirmedMemories.length, 6);
  assert.deepEqual(Object.keys(data.confirmedMemories[0]).sort(), ['action', 'deadline', 'id', 'source', 'status', 'title']);
  assert.deepEqual(['title', 'action', 'deadline', 'source'].map(k => data.confirmedMemories[0][k].length), [80, 200, 80, 500]);
  assert.equal(data.recentContext.length, 6);
  assert.equal(data.recentContext[0][0], '3');
  assert.equal(data.recentContext[0].length, 1000);
  assert.doesNotMatch(JSON.stringify(data), /private|not-sent|personal|omit/);
});

test('更新只带变化字段，未提及的 null 与明确清除的空字符串保持区别', async () => {
  const raw = { ...newTask(), draft: { title: null, action: null, deadline: '周五', correction: true }, suggestedTaskId: oldTask.id };
  const result = await analyzeWithModel({ text: '改成周五，其他不变。', memories: [oldTask] }, options(raw));
  assert.equal(result.suggestedTaskId, oldTask.id);
  assert.equal(result.draft.title, null);
  assert.equal(result.draft.action, null);
  assert.equal(result.draft.deadline, '周五');
  const cleared = await analyzeWithModel({ text: '这件事不设截止时间了。', memories: [oldTask] }, options({ ...raw, draft: { ...raw.draft, deadline: '' } }));
  assert.equal(cleared.draft.deadline, '');
});

test('模型不能更新未提供的事项；缺少原事项的更正转换为澄清', async () => {
  for (const requestedId of ['other-person-task', 'task-7', null]) {
    const result = await analyzeWithModel({ text: '改成周五。', memories: [oldTask] }, options({ ...newTask(), draft: { title: null, action: null, deadline: '周五', correction: true }, suggestedTaskId: requestedId }));
    assert.equal(result.draft, null);
    assert.equal(result.suggestedTaskId, null);
    assert.match(result.replies[0], /哪一件/);
  }
});

test('否定或未成立条件返回 null 草稿时保留澄清，不用规则重新制造任务', async () => {
  for (const text of ['不用再补交实习证明。', '如果材料不齐，再补交证明。', '是否需要提交实习证明？']) {
    const result = await analyzeWithModel({ text, memories: [oldTask] }, options({ replies: ['请确认目前还需要办理什么？', '这项要求是否适用于我？'], draft: null, suggestedTaskId: null, memoryNote: '先澄清适用条件。' }));
    assert.equal(result.draft, null);
    assert.equal(result.suggestedTaskId, null);
  }
});

test('非千问服务不发送专用思考参数；允许显式配置本机兼容服务', async () => {
  for (const base of ['https://api.example.com/v1', 'http://127.0.0.1:8080/v1']) {
    let payload;
    const custom = { ...env, AI_BASE_URL: base, AI_MODEL: 'custom-model' };
    await analyzeWithModel({ text: '请周五交证明。' }, { env: custom, fetchImpl: async (_, init) => { payload = JSON.parse(init.body); return modelResponse(newTask()); } });
    assert.equal(Object.hasOwn(payload, 'enable_thinking'), false);
    assert.equal(payload.model, 'custom-model');
    assert.equal(getModelStatus(custom).provider, 'openai-compatible');
  }
  let thinking;
  await analyzeWithModel({ text: '请周五交证明。' }, { env: { ...env, AI_ENABLE_THINKING: 'true' }, fetchImpl: async (_, init) => { thinking = JSON.parse(init.body).enable_thinking; return modelResponse(newTask()); } });
  assert.equal(thinking, true);
});

test('配置非法或没有真实密钥时不发出请求', async () => {
  const configurations = [
    [{}, 'MODEL_NOT_CONFIGURED'],
    [{ AI_API_KEY: 'your-api-key' }, 'MODEL_NOT_CONFIGURED'],
    [{ ...env, AI_BASE_URL: 'http://api.example.com/v1' }, 'MODEL_CONFIG'],
    [{ ...env, AI_BASE_URL: 'https://user:secret@api.example.com/v1' }, 'MODEL_CONFIG'],
    [{ ...env, AI_BASE_URL: 'https://api.example.com/v1?token=private' }, 'MODEL_CONFIG'],
    [{ ...env, AI_MODEL: '<invalid>' }, 'MODEL_CONFIG'],
    [{ ...env, AI_ENABLE_THINKING: 'maybe' }, 'MODEL_CONFIG']
  ];
  for (const [configuration, code] of configurations) {
    let calls = 0;
    await assert.rejects(analyzeWithModel({ text: '你好' }, { env: configuration, fetchImpl: () => { calls++; } }), error => error instanceof ModelError && error.code === code);
    assert.equal(calls, 0);
  }
});

test('鉴权、额度、网络和超时只返回固定安全错误', async () => {
  for (const [status, code] of [[400, 'MODEL_CONFIG'], [401, 'MODEL_AUTH'], [403, 'MODEL_AUTH'], [404, 'MODEL_CONFIG'], [402, 'MODEL_QUOTA'], [429, 'MODEL_QUOTA'], [503, 'MODEL_NETWORK']]) {
    await assert.rejects(analyzeWithModel({ text: '你好' }, { env, fetchImpl: async () => new Response('upstream-secret-key-and-url', { status }) }), error => {
      assert.equal(error.code, code);
      assert.equal(error.message, error.publicMessage);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /upstream-secret|unit-test-secret|example\.com/);
      return true;
    });
  }
  for (const [name, code] of [['TypeError', 'MODEL_NETWORK'], ['TimeoutError', 'MODEL_TIMEOUT'], ['AbortError', 'MODEL_TIMEOUT']]) {
    await assert.rejects(analyzeWithModel({ text: '你好' }, { env, fetchImpl: async () => { const error = new Error('secret-token in endpoint'); error.name = name; throw error; } }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.stack, /secret-token/);
      return true;
    });
  }
});

test('拒绝格式错误、无效字段、重复建议、超长响应和截断结果', async () => {
  const invalid = [
    [],
    { ...newTask(), replies: ['只有一条'] },
    { ...newTask(), replies: ['重复', '重复'] },
    { ...newTask(), replies: ['太长'.repeat(100), '另一条'] },
    { ...newTask(), draft: { ...newTask().draft, action: {} } },
    { ...newTask(), draft: { ...newTask().draft, title: undefined } },
    { ...newTask(), draft: { ...newTask().draft, correction: 'false' } },
    { ...newTask(), suggestedTaskId: {} },
    { ...newTask(), memoryNote: '长'.repeat(301) }
  ];
  for (const raw of invalid) await assert.rejects(analyzeWithModel({ text: '请交证明。' }, options(raw)), error => error.code === 'MODEL_OUTPUT');
  for (const response of [new Response('broken secret response'), new Response('null'), new Response(' '.repeat(66000)), modelResponse(newTask(), 'length'), new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }))]) {
    await assert.rejects(analyzeWithModel({ text: '请交证明。' }, { env, fetchImpl: async () => response }), error => error.code === 'MODEL_OUTPUT');
  }
});
