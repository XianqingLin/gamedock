import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from './index.mjs';
import { signRelayCredential, verifyRelayCredential } from './relay-credential.mjs';

// ---------- 凭证单元测试 ----------

describe('中转凭证', () => {
  const secret = 'cred-secret';
  const base = { roomId: 'room-1', playerId: 'user-1', role: 'host' };

  it('签发 → 验签往返', () => {
    const token = signRelayCredential(base, secret, 60);
    const payload = verifyRelayCredential(token, secret);
    expect(payload).not.toBeNull();
    expect(payload.roomId).toBe('room-1');
    expect(payload.playerId).toBe('user-1');
    expect(payload.role).toBe('host');
  });

  it('篡改 payload / 换密钥 / 过期 / 错误用途均验签失败', () => {
    const token = signRelayCredential(base, secret, 60);
    const [payloadB64, mac] = token.split('.');
    // 篡改 payload(签名对不上)。
    const forged = `${Buffer.from(JSON.stringify({ roomId: 'other', playerId: 'user-1', role: 'host', purpose: 'wrong-purpose', exp: Date.now() / 1000 + 60 })).toString('base64url')}.${mac}`;
    expect(verifyRelayCredential(forged, secret)).toBeNull();
    // 错误密钥。
    expect(verifyRelayCredential(token, 'other-secret')).toBeNull();
    // 已过期。
    expect(verifyRelayCredential(signRelayCredential(base, secret, -1), secret)).toBeNull();
    // 非字符串。
    expect(verifyRelayCredential(123, secret)).toBeNull();
  });
});

// ---------- HTTP + WS 集成测试 ----------

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedock-relay-test-'));
const config = {
  port: 0,
  platformDistDir: path.join(dataDir, 'unused-dist'),
  gamesDataFile: new URL('../src/data/games.json', `file://${process.cwd().replace(/\\/g, '/')}/`).pathname,
  gameRoots: { 'test-game': path.join(dataDir, 'unused-game') },
  dataDir,
  dbFile: path.join(dataDir, 'db.json'),
  savesDir: path.join(dataDir, 'saves'),
  sessionSecret: 'relay-test-secret',
};

const app = createApp(config);
let baseUrl;
let relayUrl;

beforeAll(async () => {
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  baseUrl = `http://127.0.0.1:${port}`;
  relayUrl = `ws://127.0.0.1:${port}/api/relay`;
});

afterAll(async () => {
  await new Promise((resolve) => app.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Cookie 会话客户端。 */
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
    async register(username) {
      return this.request('POST', '/api/auth/register', { username, password: 'secret66' });
    },
  };
}

/** WS 测试客户端:记录消息队列,waitFor 按谓词取消息。 */
class RelayClient {
  constructor(ws) {
    this.ws = ws;
    this.queue = [];
    this.waiters = [];
    this.closeInfo = null;
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf8'));
      const index = this.waiters.findIndex((w) => w.pred(message));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message);
      else this.queue.push(message);
    });
    ws.on('close', (code, reason) => {
      this.closeInfo = { code, reason: reason.toString() };
      const waiters = this.waiters.splice(0);
      for (const w of waiters) w.resolve(null);
    });
  }

  static connect(url, credential) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on('error', reject);
      ws.on('open', () => {
        const client = new RelayClient(ws);
        if (credential !== undefined) client.send({ t: 'hello', credential });
        resolve(client);
      });
    });
  }

  send(envelope) {
    this.ws.send(JSON.stringify({ v: 1, ...envelope }));
  }

  waitFor(pred, timeoutMs = 2000) {
    const index = this.queue.findIndex(pred);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        resolve(null);
      }, timeoutMs);
      this.waiters.push({
        pred,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  closed(timeoutMs = 2000) {
    if (this.closeInfo) return Promise.resolve(this.closeInfo);
    return this.waitFor(() => false, timeoutMs).then(() => this.closeInfo);
  }

  destroy() {
    this.ws.terminate();
  }
}

describe('房间 REST', () => {
  it('未登录返回 401', async () => {
    const anon = makeClient();
    expect((await anon.request('POST', '/api/rooms', { slug: 'test-game' })).status).toBe(401);
    expect((await anon.request('POST', '/api/rooms/join', { code: '000000' })).status).toBe(401);
  });

  it('创建 → 加入 → 观战 → 满员 → 查询 → host 离开解散', async () => {
    const host = makeClient();
    const guest = makeClient();
    const third = makeClient();
    const viewer = makeClient();
    await host.register('host1');
    await guest.register('guest1');
    await third.register('third1');
    await viewer.register('viewer1');

    const created = await host.request('POST', '/api/rooms', { slug: 'test-game' });
    expect(created.status).toBe(200);
    expect(created.data.room.code).toMatch(/^\d{6}$/);
    expect(created.data.room.players[0].role).toBe('host');
    expect(typeof created.data.credential).toBe('string');

    expect((await host.request('POST', '/api/rooms', { slug: 'no-such-game' })).status).toBe(400);
    expect((await host.request('POST', '/api/rooms', { slug: 'test-game', maxPlayers: 9 })).status).toBe(400);

    // 观战加入(不占玩家槽位)。
    const spectate = await viewer.request('POST', '/api/rooms/join', { code: created.data.room.code, asSpectator: true });
    expect(spectate.status).toBe(200);
    expect(spectate.data.credential).toContain('.');

    const joined = await guest.request('POST', '/api/rooms/join', { code: created.data.room.code });
    expect(joined.status).toBe(200);
    expect(joined.data.rejoined).toBe(false);
    // 幂等重入。
    const again = await guest.request('POST', '/api/rooms/join', { code: created.data.room.code });
    expect(again.data.rejoined).toBe(true);

    // 满员(2 人)。
    expect((await third.request('POST', '/api/rooms/join', { code: created.data.room.code })).status).toBe(400);
    expect((await third.request('POST', '/api/rooms/join', { code: '999999' })).status).toBe(400);
    expect((await third.request('POST', '/api/rooms/join', { code: '12ab34' })).status).toBe(400);

    // 成员可查询,非成员 403。
    expect((await guest.request('GET', `/api/rooms/${created.data.room.id}`)).status).toBe(200);
    expect((await third.request('GET', `/api/rooms/${created.data.room.id}`)).status).toBe(403);

    // host 离开 → 解散。
    const left = await host.request('POST', `/api/rooms/${created.data.room.id}/leave`);
    expect(left.data.closed).toBe(true);
    expect((await guest.request('GET', `/api/rooms/${created.data.room.id}`)).status).toBe(404);
    expect((await guest.request('POST', '/api/rooms/join', { code: created.data.room.code })).status).toBe(400);
  });
});

describe('WS 中转', () => {
  async function setupRoom() {
    const hostApi = makeClient();
    const guestApi = makeClient();
    await hostApi.register(`wh_${Math.random().toString(36).slice(2, 8)}`);
    await guestApi.register(`wg_${Math.random().toString(36).slice(2, 8)}`);
    const created = await hostApi.request('POST', '/api/rooms', { slug: 'test-game' });
    const joined = await guestApi.request('POST', '/api/rooms/join', { code: created.data.room.code });
    return {
      hostApi,
      guestApi,
      hostUserId: created.data.room.players[0].playerId,
      guestUserId: joined.data.room.players.find((p) => p.role === 'guest').playerId,
      hostCredential: created.data.credential,
      guestCredential: joined.data.credential,
      room: created.data.room,
    };
  }

  it('坏凭证被拒(4001),未 hello 先发数据被拒', async () => {
    const bad = await RelayClient.connect(relayUrl, 'garbage.token');
    const err = await bad.waitFor((m) => m.t === 'error');
    expect(err.code).toBe('auth');
    const closed = await bad.closed();
    expect(closed.code).toBe(4001);

    const silent = await RelayClient.connect(relayUrl, undefined);
    silent.send({ t: 'data', ch: 'sync', payload: {} });
    const err2 = await silent.waitFor((m) => m.t === 'error');
    expect(err2.code).toBe('auth');
    silent.destroy();
  });

  it('双端 hello → ready → 双向 data → REST 离开广播', async () => {
    const setup = await setupRoom();
    const host = await RelayClient.connect(relayUrl, setup.hostCredential);
    const guest = await RelayClient.connect(relayUrl, setup.guestCredential);

    const hostReady = await host.waitFor((m) => m.t === 'ready');
    expect(hostReady.you.role).toBe('host');
    expect(hostReady.room.code).toBe(setup.room.code);
    expect(hostReady.reconnected).toBe(false);

    const guestReady = await guest.waitFor((m) => m.t === 'ready');
    expect(guestReady.you.role).toBe('guest');

    // host 收到 guest 上线事件。
    const peerJoined = await host.waitFor((m) => m.t === 'peer-joined');
    expect(peerJoined.player.role).toBe('guest');

    // host → guest。
    host.send({ t: 'data', ch: 'sync', payload: { kind: 'snapshot', tick: 42 } });
    const fromHost = await guest.waitFor((m) => m.t === 'data' && m.ch === 'sync');
    expect(fromHost.payload).toEqual({ kind: 'snapshot', tick: 42 });
    expect(fromHost.from).toBe(setup.hostUserId);
    expect(fromHost.role).toBe('host');

    // guest → host。
    guest.send({ t: 'data', ch: 'input', payload: { keys: { up: true } } });
    const fromGuest = await host.waitFor((m) => m.t === 'data' && m.ch === 'input');
    expect(fromGuest.from).toBe(setup.guestUserId);
    expect(fromGuest.role).toBe('guest');

    // 数据消息必须带通道与 payload。
    guest.send({ t: 'data', payload: {} });
    expect((await guest.waitFor((m) => m.t === 'error')).code).toBe('bad-message');
    guest.send({ t: 'data', ch: 'BAD_CH', payload: {} });
    expect((await guest.waitFor((m) => m.t === 'error')).code).toBe('bad-message');

    // guest REST 离开 → host 收到 peer-left(leave),guest 的连接被服务端关闭。
    const left = await setup.guestApi.request('POST', `/api/rooms/${setup.room.id}/leave`);
    expect(left.data.closed).toBe(false);
    const peerLeft = await host.waitFor((m) => m.t === 'peer-left');
    expect(peerLeft.reason).toBe('leave');
    expect(peerLeft.playerId).toBe(setup.guestUserId);

    const guestClosed = await guest.closed();
    expect(guestClosed.code).toBe(1000);

    host.destroy();
  });

  it('断线 → 重连(ready.reconnected=true + peer-reconnected),host 解散 → guest 收 room-closed', async () => {
    const setup = await setupRoom();
    const host = await RelayClient.connect(relayUrl, setup.hostCredential);
    const guest = await RelayClient.connect(relayUrl, setup.guestCredential);
    await host.waitFor((m) => m.t === 'ready');
    await guest.waitFor((m) => m.t === 'ready');
    await host.waitFor((m) => m.t === 'peer-joined');

    // guest 断线:槽位保留。
    guest.destroy();
    const peerLeft = await host.waitFor((m) => m.t === 'peer-left' && m.reason === 'disconnect');
    expect(peerLeft.playerId).toBe(setup.guestUserId);

    // 同凭证重连。
    const guest2 = await RelayClient.connect(relayUrl, setup.guestCredential);
    const ready2 = await guest2.waitFor((m) => m.t === 'ready');
    expect(ready2.reconnected).toBe(true);
    const reconnected = await host.waitFor((m) => m.t === 'peer-reconnected');
    expect(reconnected.player.playerId).toBe(setup.guestUserId);

    // host 解散(REST leave)→ guest 收 room-closed,之后发数据被拒。
    const left = await setup.hostApi.request('POST', `/api/rooms/${setup.room.id}/leave`);
    expect(left.data.closed).toBe(true);
    const roomClosed = await guest2.waitFor((m) => m.t === 'room-closed');
    expect(roomClosed.roomId).toBe(setup.room.id);
    const guestClosed = await guest2.closed();
    expect(guestClosed.code).toBe(4003);

    // 房间解散后旧凭证失效:重连被拒(no-room + 4003)。
    const stale = await RelayClient.connect(relayUrl, setup.guestCredential);
    const staleErr = await stale.waitFor((m) => m.t === 'error');
    expect(staleErr.code).toBe('no-room');
    expect((await stale.closed()).code).toBe(4003);
    stale.destroy();

    host.destroy();
    guest2.destroy();
  });
});
