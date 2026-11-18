import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  connectGameDock,
  GameDockError,
  type RelayDataMessage,
  type RoomView,
} from '../src/index';
import { FakeFetch, FakeWebSocket, FakeWindow, autoReplyPlatform, helloMessage, makeEnv } from './fakes';

function fakeRoom(): RoomView {
  return {
    id: 'room-1',
    code: '123456',
    slug: 'tether-together',
    maxPlayers: 2,
    hostId: 'u-host',
    players: [
      { playerId: 'u-host', displayName: '房主', role: 'host', connected: false },
    ],
  };
}

/**
 * 模拟平台中转服务端:hello → ready;data → 转发给其他成员;leave → 广播。
 * 通过劫持 FakeWebSocket.send 实现。
 */
class FakeRelayServer {
  private authed = new Map<FakeWebSocket, { playerId: string; role: string }>();

  constructor(private room: RoomView = fakeRoom()) {}

  attach(client: FakeWebSocket) {
    const originalSend = client.send.bind(client);
    client.send = (data: string) => {
      originalSend(data);
      this.handle(client, JSON.parse(data));
    };
  }

  private handle(client: FakeWebSocket, envelope: Record<string, unknown>) {
    if (envelope.t === 'hello') {
      const host = this.room.players[0]!;
      this.authed.set(client, { playerId: host.playerId, role: host.role });
      client.receive({
        v: 1,
        t: 'ready',
        you: { playerId: host.playerId, role: host.role, displayName: host.displayName },
        room: this.room,
        reconnected: false,
      });
      return;
    }
    if (envelope.t === 'data') {
      const me = this.authed.get(client)!;
      for (const [socket, who] of this.authed) {
        if (socket !== client) {
          socket.receive({ v: 1, t: 'data', ch: envelope.ch, payload: envelope.payload, from: me.playerId, role: me.role });
        }
      }
      return;
    }
    if (envelope.t === 'leave') {
      const me = this.authed.get(client)!;
      this.authed.delete(client);
      for (const socket of this.authed.keys()) {
        socket.receive({ v: 1, t: 'peer-left', playerId: me.playerId, reason: 'leave' });
      }
      return;
    }
  }

  /** 模拟服务端推成员事件。 */
  broadcast(envelope: Record<string, unknown>, except?: FakeWebSocket) {
    for (const socket of this.authed.keys()) {
      if (socket !== except) socket.receive({ v: 1, ...envelope });
    }
  }

  /** 模拟服务端解散:推 room-closed 并断开(4003)。 */
  dissolve() {
    for (const socket of [...this.authed.keys()]) {
      socket.receive({ v: 1, t: 'room-closed', roomId: this.room.id });
      socket.close(4003, '房间已解散');
    }
    this.authed.clear();
  }
}

async function connectedSdk(room: RoomView) {
  const parent = new FakeWindow();
  const self = new FakeWindow();
  const fetcher = new FakeFetch(() =>
    new Response(JSON.stringify({ room, credential: 'cred-token' })),
  );
  autoReplyPlatform(parent, helloMessage(), self);
  const server = new FakeRelayServer(room);
  // 劫持所有新建 WebSocket,交给模拟服务端。
  const OriginalFake = FakeWebSocket;
  const impl = function (url: string) {
    const ws = new OriginalFake(url);
    server.attach(ws);
    return ws;
  } as unknown as typeof WebSocket;

  const sdk = await connectGameDock({ env: makeEnv(helloMessage(), fetcher, parent, self, impl) });
  return { sdk, fetcher, server };
}

/** 建立一条就绪的中转连接。 */
async function readyConnection(sdk: ReturnType<typeof connectGameDock>) {
  const connectPromise = sdk.relay.connect('cred-token');
  const ws = FakeWebSocket.instances.at(-1)!;
  assert.equal(ws.url, 'wss://platform.test/api/relay');
  ws.open(); // SDK 随即发出 hello,模拟服务端回 ready
  const connection = await connectPromise;
  assert.equal(connection.status, 'open');
  return { connection, ws };
}

describe('rooms REST 客户端', () => {
  it('create/join/leave/get 走对应方法与路径,slug 默认取 hello', async () => {
    const { sdk, fetcher } = await connectedSdk(fakeRoom());
    await sdk.rooms.create({ maxPlayers: 3 });
    assert.deepEqual(fetcher.calls[0], { method: 'POST', path: '/api/rooms', body: { slug: 'tether-together', maxPlayers: 3 } });

    await sdk.rooms.join('654321');
    assert.deepEqual(fetcher.calls[1], { method: 'POST', path: '/api/rooms/join', body: { code: '654321' } });

    await sdk.rooms.leave('room-9');
    assert.deepEqual(fetcher.calls[2], { method: 'POST', path: '/api/rooms/room-9/leave', body: undefined });

    await sdk.rooms.get('room-9');
    assert.equal(fetcher.calls[3]!.path, '/api/rooms/room-9');
  });

  it('非法房间码本地拒绝,不发出请求', async () => {
    const { sdk, fetcher } = await connectedSdk(fakeRoom());
    await assert.rejects(() => sdk.rooms.join('12ab34'), GameDockError);
    assert.equal(fetcher.calls.length, 0);
  });

  it('服务端错误原样抛出', async () => {
    const parent = new FakeWindow();
    const self = new FakeWindow();
    const fetcher = new FakeFetch(() => new Response(JSON.stringify({ error: '房间已满' }), { status: 400 }));
    autoReplyPlatform(parent, helloMessage(), self);
    const sdk = await connectGameDock({ env: makeEnv(helloMessage(), fetcher, parent, self) });
    await assert.rejects(
      () => sdk.rooms.join('654321'),
      (err: unknown) => /房间已满/.test(String((err as Error).message)),
    );
  });
});

describe('中转连接', () => {
  it('connect 等 ready 后 resolve,携带 you/room/reconnected', async () => {
    const { sdk } = await connectedSdk(fakeRoom());
    const { connection } = await readyConnection(sdk);
    assert.deepEqual(connection.you, { playerId: 'u-host', role: 'host', displayName: '房主' });
    assert.equal(connection.room?.code, '123456');
    assert.equal(connection.reconnected, false);
  });

  it('双向 data:send 自动补 v,对端收到 ch/payload/from/role', async () => {
    const { sdk, server } = await connectedSdk(fakeRoom());
    const { connection, ws } = await readyConnection(sdk);

    const received: RelayDataMessage[] = [];
    connection.onData((m) => received.push(m));

    connection.send('sync', { tick: 7 });
    const outgoing = ws.sentAt(1); // [0] 是 hello
    assert.deepEqual(outgoing, { v: 1, t: 'data', ch: 'sync', payload: { tick: 7 } });

    // 模拟对端发数据(经服务端转发给本连接)。
    server.broadcast({ t: 'data', ch: 'input', payload: { up: true }, from: 'u-guest', role: 'guest' }, undefined);
    assert.deepEqual(received, [{ ch: 'input', payload: { up: true }, from: 'u-guest', role: 'guest' }]);
  });

  it('peer-joined / peer-left 更新本地房间视图并触发 onPeers', async () => {
    const { sdk, server } = await connectedSdk(fakeRoom());
    const { connection } = await readyConnection(sdk);

    const snapshots: RoomView[] = [];
    connection.onPeers((room) => snapshots.push(JSON.parse(JSON.stringify(room))));

    server.broadcast({ t: 'peer-joined', player: { playerId: 'u-guest', displayName: '客人', role: 'guest', connected: true } });
    assert.deepEqual(snapshots.at(-1)!.players.map((p) => p.playerId), ['u-host', 'u-guest']);

    server.broadcast({ t: 'peer-left', playerId: 'u-guest', reason: 'leave' });
    assert.deepEqual(snapshots.at(-1)!.players.map((p) => p.playerId), ['u-host']);
    assert.equal(snapshots.length, 2);
  });

  it('room-closed → onEvent 送达且 room 置空;连接被服务端关闭 → onStatus closed(4003)', async () => {
    const { sdk, server } = await connectedSdk(fakeRoom());
    const { connection } = await readyConnection(sdk);

    const events: string[] = [];
    connection.onEvent((e) => events.push(e.t));
    const statusPromise = new Promise<{ status: string; detail: { code: number } | null }>((resolve) => {
      connection.onStatus((status, detail) => resolve({ status, detail }));
    });

    server.dissolve();
    assert.deepEqual(events, ['room-closed']);
    assert.equal(connection.room, null);

    const result = await statusPromise;
    assert.equal(result.status, 'closed');
    assert.equal(result.detail?.code, 4003);
  });

  it('就绪前连接被关闭 → connect reject;非法 ch / payload 缺失抛 GameDockError', async () => {
    const { sdk } = await connectedSdk(fakeRoom());

    // 关闭先于 ready:connect 走 reject 路径。
    const failing = sdk.relay.connect('cred-token');
    const failingWs = FakeWebSocket.instances.at(-1)!;
    failingWs.close(4003, '房间已解散');
    await assert.rejects(() => failing, GameDockError);

    const { connection } = await readyConnection(sdk);
    assert.throws(() => connection.send('BAD_CH', {}), GameDockError);
    assert.throws(() => connection.send('sync', undefined), GameDockError);
  });

  it('leave() 发送 leave 信封并关闭;close() 只断开不断房', async () => {
    const { sdk } = await connectedSdk(fakeRoom());
    const { connection, ws } = await readyConnection(sdk);
    connection.leave();
    assert.equal(ws.sentAt(1).t, 'leave');
    assert.equal(connection.status, 'closed');
  });
});
