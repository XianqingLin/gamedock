import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './index.mjs';

// 临时数据目录,避免污染真实 server/data。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedock-saves-test-'));
const config = {
  port: 0,
  platformDistDir: path.join(dataDir, 'unused-dist'),
  gamesDataFile: new URL('../src/data/games.json', `file://${process.cwd().replace(/\\/g, '/')}/`).pathname,
  gameRoots: { 'test-game': path.join(dataDir, 'unused-game') },
  dataDir,
  dbFile: path.join(dataDir, 'db.json'),
  savesDir: path.join(dataDir, 'saves'),
  // 收紧限额便于测试:普通存档 <1KB,最多 2 个槽位。
  saves: { valueLimit: 1024, maxSlots: 2 },
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
    /** 用自定义原始 body 发请求(测试非法 JSON)。 */
    async requestRaw(method, urlPath, rawBody) {
      const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie.value ? { Cookie: cookie.value } : {}),
        },
        body: rawBody,
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    },
    async register(username) {
      return this.request('POST', '/api/auth/register', { username, password: 'secret66' });
    },
  };
}

describe('存档 HTTP 流程', () => {
  it('未登录返回 401', async () => {
    const anon = makeClient();
    expect((await anon.request('GET', '/api/saves/test-game')).status).toBe(401);
    expect((await anon.request('PUT', '/api/saves/test-game/slot1', { value: {} })).status).toBe(401);
    expect((await anon.request('DELETE', '/api/saves/test-game/slot1')).status).toBe(401);
  });

  it('未接入的游戏 slug 返回 404', async () => {
    const client = makeClient();
    await client.register('saver1');
    expect((await client.request('GET', '/api/saves/unknown-game')).status).toBe(404);
    expect((await client.request('PUT', '/api/saves/unknown-game/slot1', { value: 1 })).status).toBe(404);
  });

  it('写 → 读 → 列表 → 覆盖 → 删除 → 幂等', async () => {
    const client = makeClient();
    await client.register('saver2');

    const put = await client.request('PUT', '/api/saves/test-game/slot1', {
      value: { level: 3, items: ['sword'], hp: null, score: 100 },
    });
    expect(put.status).toBe(200);
    expect(put.data.key).toBe('slot1');
    expect(typeof put.data.updatedAt).toBe('string');
    expect(put.data.size).toBeGreaterThan(0);

    const get = await client.request('GET', '/api/saves/test-game/slot1');
    expect(get.status).toBe(200);
    expect(get.data.value).toEqual({ level: 3, items: ['sword'], hp: null, score: 100 });
    expect(get.data.updatedAt).toBe(put.data.updatedAt);

    const overwritten = await client.request('PUT', '/api/saves/test-game/slot1', { value: { level: 4 } });
    expect(overwritten.status).toBe(200);
    const reread = await client.request('GET', '/api/saves/test-game/slot1');
    expect(reread.data.value).toEqual({ level: 4 });
    expect(reread.data.updatedAt).not.toBe(put.data.updatedAt);

    const list = await client.request('GET', '/api/saves/test-game');
    expect(list.status).toBe(200);
    expect(list.data.slug).toBe('test-game');
    expect(list.data.slots).toHaveLength(1);
    expect(list.data.slots[0].key).toBe('slot1');
    expect(list.data.slots[0]).not.toHaveProperty('value');

    expect((await client.request('DELETE', '/api/saves/test-game/slot1')).status).toBe(200);
    expect((await client.request('GET', '/api/saves/test-game/slot1')).status).toBe(404);
    // 幂等删除。
    expect((await client.request('DELETE', '/api/saves/test-game/slot1')).status).toBe(200);
    expect((await client.request('GET', '/api/saves/test-game')).data.slots).toHaveLength(0);
  });

  it('用户之间存档隔离', async () => {
    const a = makeClient();
    const b = makeClient();
    await a.register('saverA');
    await b.register('saverB');

    await a.request('PUT', '/api/saves/test-game/progress', { value: { mine: 'a' } });
    const bRead = await b.request('GET', '/api/saves/test-game/progress');
    expect(bRead.status).toBe(404);
    const bList = await b.request('GET', '/api/saves/test-game');
    expect(bList.data.slots).toHaveLength(0);
  });

  it('超过值上限、非法 key、槽位超限被拒绝', async () => {
    const client = makeClient();
    await client.register('saver3');

    // valueLimit=1024:发送 >1KB 的值。
    const big = await client.request('PUT', '/api/saves/test-game/big', {
      value: { blob: 'x'.repeat(2048) },
    });
    expect(big.status).toBe(400);
    expect(big.data.error).toContain('存档过大');

    // 非法 key(路由正则不匹配,含路径穿越尝试)。
    expect((await client.request('PUT', '/api/saves/test-game/bad.key', { value: 1 })).status).toBe(404);
    expect((await client.request('PUT', '/api/saves/test-game/..%2f..%2fescape', { value: 1 })).status).toBe(404);

    // maxSlots=2。
    await client.request('PUT', '/api/saves/test-game/s1', { value: 1 });
    await client.request('PUT', '/api/saves/test-game/s2', { value: 2 });
    const third = await client.request('PUT', '/api/saves/test-game/s3', { value: 3 });
    expect(third.status).toBe(400);
    expect(third.data.error).toContain('槽位');
    // 已有槽位覆盖不受上限影响。
    expect((await client.request('PUT', '/api/saves/test-game/s1', { value: 11 })).status).toBe(200);
  });

  it('请求体缺失 value、非法 JSON 被拒绝', async () => {
    const client = makeClient();
    await client.register('saver4');

    expect((await client.request('PUT', '/api/saves/test-game/slot9', {})).status).toBe(400);
    expect((await client.requestRaw('PUT', '/api/saves/test-game/slot9', 'not-json')).status).toBe(400);
  });
});
