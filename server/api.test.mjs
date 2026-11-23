import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleApi } from './api.mjs';
import { createMemoryStore } from './store.mjs';
import { createFsSaves } from './saves.mjs';
import gamesData from '../src/data/games.json' with { type: 'json' };

// 临时数据目录(存档落盘),避免污染真实目录。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedock-test-'));

/** handler 直调环境:内存存储 + fs 存档(线上对应 D1 + KV,见 worker.mjs)。 */
const env = {
  store: createMemoryStore(),
  saves: createFsSaves(dataDir),
  sessionSecret: 'test-secret',
  gameSlugs: new Set(['bvn']),
  gamesData,
  gameOrigin: 'https://games.gamedock.cn',
};

async function call(method, urlPath, { body, rawBody, cookie } = {}) {
  const request = new Request(`https://gamedock.test${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const response = await handleApi(request, env);
  const data = await response.json().catch(() => null);
  return { status: response.status, data, setCookies: response.headers.getSetCookie() };
}

/** 极简 Cookie 会话客户端(直调 handler,无网络)。 */
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

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('账号会话流程', () => {
  it('注册 → me → 登出 → 登录 → me', async () => {
    const client = makeClient();

    const reg = await client.request('POST', '/api/auth/register', { username: '小林', password: 'secret66' });
    expect(reg.status).toBe(200);
    expect(reg.data.user.username).toBe('小林');
    expect(reg.data.user).not.toHaveProperty('passHash');
    expect(reg.data.user).not.toHaveProperty('passSalt');

    const me1 = await client.request('GET', '/api/auth/me');
    expect(me1.data.user.username).toBe('小林');

    await client.request('POST', '/api/auth/logout');
    const me2 = await client.request('GET', '/api/auth/me');
    expect(me2.data.user).toBeNull();

    const login = await client.request('POST', '/api/auth/login', { username: '小林', password: 'secret66' });
    expect(login.status).toBe(200);
    const me3 = await client.request('GET', '/api/auth/me');
    expect(me3.data.user.username).toBe('小林');
  });

  it('重复注册、错误密码、非法输入被拒绝', async () => {
    const client = makeClient();
    const dup = await client.request('POST', '/api/auth/register', { username: '小林', password: 'secret66' });
    expect(dup.status).toBe(400);
    expect(dup.data.error).toBe('用户名已存在');

    const badLogin = await client.request('POST', '/api/auth/login', { username: '小林', password: 'nope' });
    expect(badLogin.status).toBe(401);

    const badBody = await client.request('POST', '/api/auth/register', { username: 'x', password: '123' });
    expect(badBody.status).toBe(400);

    const broken = await call('POST', '/api/auth/register', { rawBody: 'not-json' });
    expect(broken.status).toBe(400);
  });

  it('未登录访问好友接口返回 401,匿名会话与登录会话隔离', async () => {
    const anon = makeClient();
    const res = await anon.request('GET', '/api/friends');
    expect(res.status).toBe(401);

    const other = makeClient();
    await other.request('POST', '/api/auth/register', { username: 'other', password: 'secret66' });
    const me = await other.request('GET', '/api/auth/me');
    expect(me.data.user.username).toBe('other');
  });

  it('PATCH /api/auth/profile:未登录 401;改名查重;头像校验;响应不含敏感字段', async () => {
    const anon = makeClient();
    expect((await anon.request('PATCH', '/api/auth/profile', { username: 'x' })).status).toBe(401);

    const client = makeClient();
    await client.request('POST', '/api/auth/register', { username: 'profiler', password: 'secret66' });
    const other = makeClient();
    await other.request('POST', '/api/auth/register', { username: 'taken_user', password: 'secret66' });

    const dup = await client.request('PATCH', '/api/auth/profile', { username: 'taken_user' });
    expect(dup.status).toBe(400);
    expect(dup.data.error).toBe('用户名已存在');

    const badAvatar = await client.request('PATCH', '/api/auth/profile', { avatar: 'av99' });
    expect(badAvatar.status).toBe(400);
    expect(badAvatar.data.error).toBe('未知头像');

    const ok = await client.request('PATCH', '/api/auth/profile', { username: 'renamed', avatar: 'av2' });
    expect(ok.status).toBe(200);
    expect(ok.data.user.username).toBe('renamed');
    expect(ok.data.user.avatar).toBe('av2');
    expect(ok.data.user).not.toHaveProperty('passHash');
    expect((await client.request('GET', '/api/auth/me')).data.user.username).toBe('renamed');
  });
});

describe('好友 HTTP 流程', () => {
  it('注册两个用户 → 发请求 → 接受 → 解除', async () => {
    const a = makeClient();
    const b = makeClient();
    await a.request('POST', '/api/auth/register', { username: 'alice2', password: 'secret66' });
    await b.request('POST', '/api/auth/register', { username: 'bob2', password: 'secret66' });
    const bobId = (await b.request('GET', '/api/auth/me')).data.user.id;

    const sent = await a.request('POST', '/api/friends/requests', { id: bobId });
    expect(sent.status).toBe(200);
    expect(sent.data.outgoing).toHaveLength(1);

    const incoming = await b.request('GET', '/api/friends');
    expect(incoming.data.incoming).toHaveLength(1);
    const requestId = incoming.data.incoming[0].id;

    const accepted = await b.request('POST', `/api/friends/requests/${requestId}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.data.friends.filter((f) => !f.assistant).map((f) => f.user.username)).toEqual(['alice2']);

    const mine = await a.request('GET', '/api/friends');
    expect(mine.data.friends.filter((f) => !f.assistant).map((f) => f.user.username)).toEqual(['bob2']);

    const friendshipId = mine.data.friends.find((f) => !f.assistant).id;
    const removed = await a.request('DELETE', `/api/friends/${friendshipId}`);
    expect(removed.status).toBe(200);
    expect(removed.data.friends.filter((f) => !f.assistant)).toHaveLength(0);
  });

  it('拒绝请求与取消请求', async () => {
    const a = makeClient();
    const b = makeClient();
    await a.request('POST', '/api/auth/register', { username: 'alice3', password: 'secret66' });
    await b.request('POST', '/api/auth/register', { username: 'bob3', password: 'secret66' });
    const bob3Id = (await b.request('GET', '/api/auth/me')).data.user.id;

    await a.request('POST', '/api/friends/requests', { id: bob3Id });
    const requestId = (await b.request('GET', '/api/friends')).data.incoming[0].id;
    const declined = await b.request('POST', `/api/friends/requests/${requestId}/decline`);
    expect(declined.status).toBe(200);
    expect(declined.data.friends.filter((f) => !f.assistant)).toHaveLength(0);

    await a.request('POST', '/api/friends/requests', { id: bob3Id });
    const outgoingId = (await a.request('GET', '/api/friends')).data.outgoing[0].id;
    const cancelled = await a.request('DELETE', `/api/friends/requests/${outgoingId}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.outgoing).toHaveLength(0);
  });
});

describe('在线心跳与好友在线状态', () => {
  it('未登录拒绝;心跳后的好友在好友列表中显示在线', async () => {
    const anon = await call('POST', '/api/presence');
    expect(anon.status).toBe(401);
    expect(anon.data.error).toBe('需要登录');

    const a = makeClient();
    const b = makeClient();
    await a.request('POST', '/api/auth/register', { username: 'online_a', password: 'secret66' });
    await b.request('POST', '/api/auth/register', { username: 'online_b', password: 'secret66' });
    const aId = (await a.request('GET', '/api/auth/me')).data.user.id;
    const bId = (await b.request('GET', '/api/auth/me')).data.user.id;

    await a.request('POST', '/api/friends/requests', { id: bId });
    const requestId = (await b.request('GET', '/api/friends')).data.incoming[0].id;
    await b.request('POST', `/api/friends/requests/${requestId}/accept`);

    const beat = await b.request('POST', '/api/presence');
    expect(beat.status).toBe(200);

    const listsA = await a.request('GET', '/api/friends');
    const bEntry = listsA.data.friends.find((f) => f.user.id === bId);
    expect(bEntry.user.online).toBe(true);

    // a 未发过心跳 → 在 b 眼里离线。
    const listsB = await b.request('GET', '/api/friends');
    const aEntry = listsB.data.friends.find((f) => f.user.id === aId);
    expect(aEntry.user.online).toBe(false);

    // 自身状态与好友共用同一份 last_seen_at 判定:发过心跳的 b 在线,没发过心跳的 a 离线。
    expect(listsB.data.me.id).toBe(bId);
    expect(listsB.data.me.online).toBe(true);
    expect(listsA.data.me.id).toBe(aId);
    expect(listsA.data.me.online).toBe(false);
  });
});

describe('存档 HTTP 流程', () => {
  it('登录后写入/读取/列出/删除存档槽位', async () => {
    const client = makeClient();
    await client.request('POST', '/api/auth/register', { username: 'saver', password: 'secret66' });

    const put = await client.request('PUT', '/api/saves/bvn/slot1', { value: { hp: 9 } });
    expect(put.status).toBe(200);
    expect(put.data.key).toBe('slot1');
    expect(put.data.size).toBeGreaterThan(0);

    const get = await client.request('GET', '/api/saves/bvn/slot1');
    expect(get.status).toBe(200);
    expect(get.data.value).toEqual({ hp: 9 });

    const list = await client.request('GET', '/api/saves/bvn');
    expect(list.status).toBe(200);
    expect(list.data.slots.map((s) => s.key)).toEqual(['slot1']);

    const del = await client.request('DELETE', '/api/saves/bvn/slot1');
    expect(del.status).toBe(200);
    expect((await client.request('GET', '/api/saves/bvn/slot1')).status).toBe(404);
  });

  it('未接入的游戏 slug 返回 404,未登录返回 401', async () => {
    const anon = makeClient();
    expect((await anon.request('GET', '/api/saves/bvn')).status).toBe(401);

    const client = makeClient();
    await client.request('POST', '/api/auth/register', { username: 'slugcheck', password: 'secret66' });
    const res = await client.request('GET', '/api/saves/no-such');
    expect(res.status).toBe(404);
    expect(res.data.error).toBe('未接入该游戏');
  });

  it('GET /api/saves 跨游戏聚合:按游戏分组、空游戏不出现、可未登录 401', async () => {
    const anon = makeClient();
    expect((await anon.request('GET', '/api/saves')).status).toBe(401);

    const client = makeClient();
    await client.request('POST', '/api/auth/register', { username: 'aggregator', password: 'secret66' });

    const empty = await client.request('GET', '/api/saves');
    expect(empty.status).toBe(200);
    expect(empty.data.games).toEqual([]);

    await client.request('PUT', '/api/saves/bvn/slotA', { value: 1 });
    await client.request('PUT', '/api/saves/bvn/slotB', { value: 2 });
    const all = await client.request('GET', '/api/saves');
    expect(all.status).toBe(200);
    const bvnGroup = all.data.games.find((g) => g.slug === 'bvn');
    expect(bvnGroup.slots.map((s) => s.key).sort()).toEqual(['slotA', 'slotB']);
    // 未写入过的游戏不出现
    expect(all.data.games.some((g) => g.slug === 'no-data-game')).toBe(false);
  });
});

describe('CORS(游戏内容域跨源访问)', () => {
  async function callWithOrigin(origin, { method = 'GET', path = '/api/health' } = {}) {
    const headers = {};
    if (origin) headers.Origin = origin;
    const response = await handleApi(new Request(`https://gamedock.test${path}`, { method, headers }), env);
    return {
      status: response.status,
      acao: response.headers.get('Access-Control-Allow-Origin'),
      credentials: response.headers.get('Access-Control-Allow-Credentials'),
    };
  }

  it('游戏内容域来源 → 精确回显 Origin 并允许凭据', async () => {
    const res = await callWithOrigin('https://games.gamedock.cn');
    expect(res.status).toBe(200);
    expect(res.acao).toBe('https://games.gamedock.cn');
    expect(res.credentials).toBe('true');
  });

  it('自身来源(同源请求)→ 同样回显', async () => {
    const res = await callWithOrigin('https://gamedock.test');
    expect(res.acao).toBe('https://gamedock.test');
  });

  it('第三方来源 → 不带 CORS 头(读不到响应)', async () => {
    const res = await callWithOrigin('https://evil.example.com');
    expect(res.status).toBe(200);
    expect(res.acao).toBeNull();
    expect(res.credentials).toBeNull();
  });

  it('无 Origin 头 → 普通响应', async () => {
    const res = await callWithOrigin(null);
    expect(res.status).toBe(200);
    expect(res.acao).toBeNull();
  });

  it('OPTIONS 预检:allowlist 来源 → 204 + 方法声明', async () => {
    const res = await callWithOrigin('https://games.gamedock.cn', {
      method: 'OPTIONS',
      path: '/api/saves/bvn',
    });
    expect(res.status).toBe(204);
    expect(res.acao).toBe('https://games.gamedock.cn');
    expect(res.credentials).toBe('true');
    const response = await handleApi(
      new Request('https://gamedock.test/api/saves/bvn', {
        method: 'OPTIONS',
        headers: { Origin: 'https://games.gamedock.cn' },
      }),
      env,
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });

  it('OPTIONS 预检:第三方来源 → 403', async () => {
    const res = await callWithOrigin('https://evil.example.com', { method: 'OPTIONS' });
    expect(res.status).toBe(403);
  });
});
