import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleApi } from './api.mjs';
import { AI_ASSISTANT, listChatMessages, sendChatMessage } from './chat.mjs';
import { registerUser } from './auth.mjs';
import { createMemoryStore } from './store.mjs';
import { createFsSaves } from './saves.mjs';
import gamesData from '../src/data/games.json' with { type: 'json' };

// 临时数据目录(存档落盘),避免污染真实目录。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedock-chat-test-'));

const env = {
  store: createMemoryStore(),
  saves: createFsSaves(dataDir),
  sessionSecret: 'test-secret',
  gameSlugs: new Set(['bvn']),
  gamesData,
  gameOrigin: 'https://games.gamedock.cn',
};

async function call(method, urlPath, { body, cookie } = {}) {
  const request = new Request(`https://gamedock.test${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const response = await handleApi(request, env);
  const data = await response.json().catch(() => null);
  return { status: response.status, data, setCookies: response.headers.getSetCookie() };
}

function makeClient() {
  const jar = { cookie: '' };
  return {
    async request(method, urlPath, body) {
      const res = await call(method, urlPath, { body, cookie: jar.cookie });
      if (res.setCookies.length) jar.cookie = res.setCookies[0].split(';')[0];
      return { status: res.status, data: res.data };
    },
  };
}

/** stub 全局 fetch:模拟 OpenAI 兼容的 chat/completions 端点。 */
function stubAiFetch(impl) {
  return vi.fn(async (url, options = {}) => {
    const body = options.body ? JSON.parse(String(options.body)) : {};
    return impl(url, body);
  });
}

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendChatMessage(业务层)', () => {
  it('配置齐全时发送消息并收到 AI 回复,双方消息均落库', async () => {
    const store = createMemoryStore();
    const user = (await registerUser(store, { username: 'u1', password: 'secret66' })).user;
    const fetchMock = stubAiFetch((url, body) => {
      expect(url).toBe('https://ai.test/v1/chat/completions');
      expect(body.model).toBe('test-model');
      expect(body.messages[0].role).toBe('system');
      expect(body.messages.at(-1)).toEqual({ role: 'user', content: '你好' });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: ' 你好,我是小舟AI。 ' } }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendChatMessage(store, user.id, AI_ASSISTANT.id, ' 你好 ', {
      baseUrl: 'https://ai.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
    });
    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({ role: 'user', content: '你好' });
    expect(result.messages[1]).toMatchObject({ role: 'assistant', content: '你好,我是小舟AI。' });

    const history = await listChatMessages(store, user.id, AI_ASSISTANT.id);
    expect(history.messages).toHaveLength(2);
  });

  it('未配置 AI 服务时明确报错,不伪造回复', async () => {
    const store = createMemoryStore();
    const user = (await registerUser(store, { username: 'u2', password: 'secret66' })).user;

    const result = await sendChatMessage(store, user.id, AI_ASSISTANT.id, '你好', undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('AI 服务未配置,暂时无法回复');
    // 用户消息已落库,但 assistant 侧没有伪造内容。
    const history = await listChatMessages(store, user.id, AI_ASSISTANT.id);
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0].role).toBe('user');
  });

  it('AI 调用失败时明确报错', async () => {
    const store = createMemoryStore();
    const user = (await registerUser(store, { username: 'u3', password: 'secret66' })).user;

    vi.stubGlobal('fetch', stubAiFetch(() => new Response('boom', { status: 500 })));
    const failed = await sendChatMessage(store, user.id, AI_ASSISTANT.id, '你好', {
      baseUrl: 'https://ai.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe('AI 服务暂时不可用,请稍后重试');

    vi.stubGlobal('fetch', stubAiFetch(() => new Response('not json', { status: 200 })));
    const broken = await sendChatMessage(store, user.id, AI_ASSISTANT.id, '你好', {
      baseUrl: 'https://ai.test/v1',
      apiKey: 'sk-test',
      model: 'test-model',
    });
    expect(broken.ok).toBe(false);
    expect(broken.error).toBe('AI 服务响应异常,请稍后重试');
  });

  it('非法 peer、空消息、超长消息被拒绝', async () => {
    const store = createMemoryStore();
    const user = (await registerUser(store, { username: 'u4', password: 'secret66' })).user;

    expect((await listChatMessages(store, user.id, 'someone-else')).error).toBe('会话不存在');
    expect((await sendChatMessage(store, user.id, 'someone-else', '你好')).error).toBe('会话不存在');
    expect((await sendChatMessage(store, user.id, AI_ASSISTANT.id, '   ')).error).toBe('消息不能为空');
    expect((await sendChatMessage(store, user.id, AI_ASSISTANT.id, 'a'.repeat(2001))).error).toBe(
      '消息过长,最多 2000 字',
    );
  });
});

describe('/api/chat(路由层)', () => {
  it('未登录拒绝', async () => {
    const res = await call('GET', `/api/chat/${AI_ASSISTANT.id}`);
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('需要登录');
  });

  it('登录后历史 → 发送 → AI 回复可见于历史', async () => {
    const client = makeClient();
    const reg = await client.request('POST', '/api/auth/register', { username: '小张', password: 'secret66' });
    expect(reg.status).toBe(200);

    const unknown = await client.request('GET', '/api/chat/other-peer');
    expect(unknown.status).toBe(404);
    expect(unknown.data.error).toBe('会话不存在');

    const empty = await client.request('GET', `/api/chat/${AI_ASSISTANT.id}`);
    expect(empty.status).toBe(200);
    expect(empty.data.messages).toEqual([]);

    vi.stubGlobal(
      'fetch',
      stubAiFetch(() =>
        new Response(JSON.stringify({ choices: [{ message: { content: '我是小舟AI' } }] }), { status: 200 }),
      ),
    );
    env.ai = { baseUrl: 'https://ai.test/v1', apiKey: 'sk-test', model: 'test-model' };

    const sent = await client.request('POST', `/api/chat/${AI_ASSISTANT.id}`, { content: '在吗' });
    expect(sent.status).toBe(200);
    expect(sent.data.messages).toHaveLength(2);
    expect(sent.data.messages[1].content).toBe('我是小舟AI');

    const history = await client.request('GET', `/api/chat/${AI_ASSISTANT.id}`);
    expect(history.status).toBe(200);
    expect(history.data.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('AI 服务未配置时返回明确错误文案', async () => {
    const client = makeClient();
    await client.request('POST', '/api/auth/register', { username: '小王', password: 'secret66' });
    env.ai = undefined;

    const sent = await client.request('POST', `/api/chat/${AI_ASSISTANT.id}`, { content: '在吗' });
    expect(sent.status).toBe(503);
    expect(sent.data.error).toBe('AI 服务未配置,暂时无法回复');
  });

  it('AI 调用失败返回 502,用户消息保留在历史中', async () => {
    const client = makeClient();
    await client.request('POST', '/api/auth/register', { username: '小刘', password: 'secret66' });
    env.ai = { baseUrl: 'https://ai.test/v1', apiKey: 'sk-test', model: 'test-model' };
    vi.stubGlobal('fetch', stubAiFetch(() => new Response('boom', { status: 500 })));

    const sent = await client.request('POST', `/api/chat/${AI_ASSISTANT.id}`, { content: '在吗' });
    expect(sent.status).toBe(502);
    expect(sent.data.error).toBe('AI 服务暂时不可用,请稍后重试');

    const history = await client.request('GET', `/api/chat/${AI_ASSISTANT.id}`);
    expect(history.data.messages).toHaveLength(1);
    expect(history.data.messages[0].role).toBe('user');
  });
});
