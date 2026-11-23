import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleApi } from './api.mjs';
import { listChatMessages, sendChatMessage } from './chat.mjs';
import { TEST_USER } from './bot.mjs';
import { registerUser } from './auth.mjs';
import { sendFriendRequest, respondToRequest, listFriends } from './friends.mjs';
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

/** 两个已互为好友的用户(好友间聊天需要 accepted 关系)。 */
async function setup() {
  const store = createMemoryStore();
  const alice = (await registerUser(store, { username: 'alice', password: 'secret66' })).user;
  const bob = (await registerUser(store, { username: 'bob', password: 'secret66' })).user;
  await sendFriendRequest(store, alice.id, bob.id);
  await respondToRequest(store, bob.id, (await listFriends(store, bob.id)).incoming[0].id, true);
  return { store, alice, bob };
}



afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('sendChatMessage(业务层)', () => {
  it('发给测试用户 bot 会得到自动回复,双方消息均落库', async () => {
    const { store, alice } = await setup();

    const result = await sendChatMessage(store, alice.id, TEST_USER.id, ' 你好 ');
    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({ peer: TEST_USER.id, mine: true, content: '你好' });
    expect(result.messages[1]).toMatchObject({
      peer: TEST_USER.id,
      mine: false,
      content: expect.stringContaining('你好'),
    });

    const history = await listChatMessages(store, alice.id, TEST_USER.id);
    expect(history.messages).toHaveLength(2);
  });

  it('发给普通好友只落自己那条,对方轮询可见', async () => {
    const { store, alice, bob } = await setup();

    const result = await sendChatMessage(store, alice.id, bob.id, '来一局?');
    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ peer: bob.id, mine: true, content: '来一局?' });

    // bob 侧视角:同一条消息投影为对方发出。
    const history = await listChatMessages(store, bob.id, alice.id);
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]).toMatchObject({ peer: alice.id, mine: false, content: '来一局?' });
  });

  it('非法 peer、空消息、超长消息被拒绝', async () => {
    const { store, alice } = await setup();
    await registerUser(store, { username: 'carol', password: 'secret66' });

    expect((await listChatMessages(store, alice.id, 'someone-else')).error).toBe('只能与好友聊天');
    expect((await sendChatMessage(store, alice.id, 'someone-else', '你好')).error).toBe('只能与好友聊天');
    expect((await sendChatMessage(store, alice.id, TEST_USER.id, '   ')).error).toBe('消息不能为空');
    expect((await sendChatMessage(store, alice.id, TEST_USER.id, 'a'.repeat(2001))).error).toBe(
      '消息过长,最多 2000 字',
    );
  });
});

describe('/api/chat(路由层)', () => {
  it('未登录拒绝', async () => {
    const res = await call('GET', `/api/chat/${TEST_USER.id}`);
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('需要登录');
  });

  it('登录后历史 → 发给测试用户 → 自动回复可见于历史', async () => {
    const client = makeClient();
    const reg = await client.request('POST', '/api/auth/register', { username: '小张', password: 'secret66' });
    expect(reg.status).toBe(200);

    const unknown = await client.request('GET', '/api/chat/other-peer');
    expect(unknown.status).toBe(404);
    expect(unknown.data.error).toBe('只能与好友聊天');

    const empty = await client.request('GET', `/api/chat/${TEST_USER.id}`);
    expect(empty.status).toBe(200);
    expect(empty.data.messages).toEqual([]);

    const sent = await client.request('POST', `/api/chat/${TEST_USER.id}`, { content: '在吗' });
    expect(sent.status).toBe(200);
    expect(sent.data.messages).toHaveLength(2);
    expect(sent.data.messages[1].content).toContain('在吗');

    const history = await client.request('GET', `/api/chat/${TEST_USER.id}`);
    expect(history.status).toBe(200);
    expect(history.data.messages.map((m) => m.mine)).toEqual([true, false]);
  });

  it('非好友与本人不能通过接口聊天', async () => {
    const client = makeClient();
    await client.request('POST', '/api/auth/register', { username: '小王', password: 'secret66' });
    const carolClient = makeClient();
    const carol = await carolClient.request('POST', '/api/auth/register', { username: '小刘', password: 'secret66' });
    const carolId = carol.data.user.id;

    // 非好友:POST 返回 400(只能与好友聊天),GET 历史按会话不存在 404。
    const sent = await client.request('POST', `/api/chat/${carolId}`, { content: '在吗' });
    expect(sent.status).toBe(400);
    expect(sent.data.error).toBe('只能与好友聊天');
    const history = await client.request('GET', `/api/chat/${carolId}`);
    expect(history.status).toBe(404);

    // 本人:同一条 bot 好友关系不能被用来对自己发消息。
    const me = await client.request('GET', '/api/auth/me');
    const selfId = me.data.user.id;

    const self = await client.request('POST', `/api/chat/${selfId}`, { content: '自言自语' });
    expect(self.status).toBe(400);
    expect(self.data.error).toBe('只能与好友聊天');
  });

});
