import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './index.mjs';

// 临时数据目录,避免污染真实 server/data。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedock-test-'));
const config = {
  port: 0,
  platformDistDir: path.join(dataDir, 'unused-dist'),
  gamesDataFile: new URL('../src/data/games.json', `file://${process.cwd().replace(/\\/g, '/')}/`).pathname,
  gameRoots: {},
  dataDir,
  dbFile: path.join(dataDir, 'db.json'),
  sessionSecret: 'test-secret',
};

const app = createApp(config);
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => app.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** 极简 Cookie 会话客户端。 */
function makeClient() {
  const cookie = { value: '' };
  return {
    async request(method, urlPath, body) {
      const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie.value ? { Cookie: cookie.value } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie.value = setCookie.split(';')[0];
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    },
  };
}

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

    const broken = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
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
});

describe('好友 HTTP 流程', () => {
  it('注册两个用户 → 发请求 → 接受 → 解除', async () => {
    const a = makeClient();
    const b = makeClient();
    await a.request('POST', '/api/auth/register', { username: 'alice2', password: 'secret66' });
    await b.request('POST', '/api/auth/register', { username: 'bob2', password: 'secret66' });

    const sent = await a.request('POST', '/api/friends/requests', { username: 'bob2' });
    expect(sent.status).toBe(200);
    expect(sent.data.outgoing).toHaveLength(1);

    const incoming = await b.request('GET', '/api/friends');
    expect(incoming.data.incoming).toHaveLength(1);
    const requestId = incoming.data.incoming[0].id;

    const accepted = await b.request('POST', `/api/friends/requests/${requestId}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.data.friends.map((f) => f.user.username)).toEqual(['alice2']);

    const mine = await a.request('GET', '/api/friends');
    expect(mine.data.friends.map((f) => f.user.username)).toEqual(['bob2']);

    const friendshipId = mine.data.friends[0].id;
    const removed = await a.request('DELETE', `/api/friends/${friendshipId}`);
    expect(removed.status).toBe(200);
    expect(removed.data.friends).toHaveLength(0);
  });

  it('拒绝请求与取消请求', async () => {
    const a = makeClient();
    const b = makeClient();
    await a.request('POST', '/api/auth/register', { username: 'alice3', password: 'secret66' });
    await b.request('POST', '/api/auth/register', { username: 'bob3', password: 'secret66' });

    await a.request('POST', '/api/friends/requests', { username: 'bob3' });
    const requestId = (await b.request('GET', '/api/friends')).data.incoming[0].id;
    const declined = await b.request('POST', `/api/friends/requests/${requestId}/decline`);
    expect(declined.status).toBe(200);
    expect(declined.data.friends).toHaveLength(0);

    await a.request('POST', '/api/friends/requests', { username: 'bob3' });
    const outgoingId = (await a.request('GET', '/api/friends')).data.outgoing[0].id;
    const cancelled = await a.request('DELETE', `/api/friends/requests/${outgoingId}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.data.outgoing).toHaveLength(0);
  });
});

describe('静态与游戏资源', () => {
  it('平台构建产物缺失时返回 503 提示', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(503);
  });

  it('未接入的游戏 slug 返回 404', async () => {
    const res = await fetch(`${baseUrl}/g/no-such/index.html`);
    expect(res.status).toBe(404);
  });
});
