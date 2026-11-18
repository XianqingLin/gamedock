import { GameDockError } from './errors';
import { requestPlatform } from './http';
import type { GameDockEnv } from './env';

/**
 * 平台房间 + 对战中转客户端。
 * 服务端契约见 gamedock/server/relay.mjs:
 * - 信封 { v, t, ch?, payload? };数据消息 t='data' 必须带通道 ch 与 JSON payload;
 * - 控制事件:ready / peer-joined / peer-left / peer-reconnected / room-closed / error;
 * - 断线后可用同一凭证重连(重连窗口内),ready.reconnected=true 表示重连。
 */

export type RelayRole = 'host' | 'guest' | 'spectator';
export type RelayStatus = 'connecting' | 'open' | 'closed';

export interface RelayPlayer {
  playerId: string;
  displayName: string;
  role: RelayRole;
  connected: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  slug: string;
  maxPlayers: number;
  hostId: string;
  players: RelayPlayer[];
}

export interface RoomWithCredential {
  room: RoomView;
  credential: string;
  rejoined?: boolean;
}

export interface RelayDataMessage {
  ch: string;
  payload: unknown;
  from: string;
  role: RelayRole;
}

export interface RelayCloseInfo {
  code: number;
  reason: string;
}

export interface RelayConnection {
  /** ready 后为 open;socket 关闭后为 closed。 */
  readonly status: RelayStatus;
  readonly you: { playerId: string; role: RelayRole; displayName: string } | null;
  /** 本地维护的房间视图(随成员事件更新);房间解散后为 null。 */
  readonly room: RoomView | null;
  /** 本次连接是否为重连(host 依此决定是否恢复对局状态)。 */
  readonly reconnected: boolean;
  /** 游戏数据消息(来自其他成员)。 */
  onData(handler: (message: RelayDataMessage) => void): () => void;
  /** 房间成员变化(含连接状态变化)。 */
  onPeers(handler: (room: RoomView) => void): () => void;
  /** 控制事件原样上抛(room-closed、error 等),游戏自行决定处理。 */
  onEvent(handler: (event: { t: string } & Record<string, unknown>) => void): () => void;
  /** 连接关闭(含服务端踢出/解散)。 */
  onStatus(handler: (status: RelayStatus, detail: RelayCloseInfo | null) => void): () => void;
  /** 向其他成员发数据(连接未就绪抛 GameDockError)。 */
  send(ch: string, payload: unknown): void;
  /** 主动离开房间(服务端移除槽位并广播)。 */
  leave(): void;
  /** 直接断开 socket(不离开房间,保留重连窗口)。 */
  close(): void;
}

// ---------- 房间 REST ----------

export function createRoomsApi(env: GameDockEnv, slug: string | null) {
  const assertAvailable = () => {
    if (!slug) throw new GameDockError('未在平台内运行,房间功能不可用');
  };
  return {
    /** 创建房间(本游戏);返回 host 凭证。 */
    async create(options: { slug?: string; maxPlayers?: number } = {}): Promise<RoomWithCredential> {
      assertAvailable();
      const data = await requestPlatform(env, 'POST', '/api/rooms', {
        slug: options.slug ?? slug,
        maxPlayers: options.maxPlayers,
      });
      return data as unknown as RoomWithCredential;
    },
    /** 按房间码加入;返回对应角色的凭证;已在房间内则幂等重入。 */
    async join(code: string, options: { asSpectator?: boolean } = {}): Promise<RoomWithCredential> {
      assertAvailable();
      if (!/^\d{6}$/.test(code)) throw new GameDockError('房间码需为 6 位数字');
      const data = await requestPlatform(env, 'POST', '/api/rooms/join', {
        code,
        asSpectator: options.asSpectator,
      });
      return data as unknown as RoomWithCredential;
    },
    /** 离开房间(host 离开 → 解散)。 */
    async leave(roomId: string): Promise<{ closed: boolean }> {
      assertAvailable();
      const data = await requestPlatform(env, 'POST', `/api/rooms/${roomId}/leave`);
      return { closed: Boolean(data.closed) };
    },
    /** 查询房间(仅成员可查)。 */
    async get(roomId: string): Promise<RoomView> {
      assertAvailable();
      const data = await requestPlatform(env, 'GET', `/api/rooms/${roomId}`);
      return (data.room as unknown as RoomView) ?? null;
    },
  };
}

export type RoomsApi = ReturnType<typeof createRoomsApi>;

// ---------- WS 中转 ----------

const CHANNEL_RE = /^[a-z0-9-]{1,16}$/;
const ENVELOPE_VERSION = 1;

interface ControlEnvelope {
  v: number;
  t: string;
  [key: string]: unknown;
}

function relayUrl(origin: string): string {
  return `${origin.replace(/^http/, 'ws')}/api/relay`;
}

export function createRelayConnection(env: GameDockEnv, credential: string): RelayConnection {
  const WebSocketImpl = env.WebSocketImpl;
  if (!WebSocketImpl) throw new GameDockError('环境缺少 WebSocket 支持');

  const handlers = {
    data: new Set<(m: RelayDataMessage) => void>(),
    peers: new Set<(room: RoomView) => void>(),
    event: new Set<(e: { t: string } & Record<string, unknown>) => void>(),
    status: new Set<(s: RelayStatus, d: RelayCloseInfo | null) => void>(),
  };

  const state: {
    status: RelayStatus;
    you: RelayConnection['you'];
    room: RoomView | null;
    reconnected: boolean;
    closeInfo: RelayCloseInfo | null;
  } = { status: 'connecting', you: null, room: null, reconnected: false, closeInfo: null };

  const setStatus = (status: RelayStatus, detail: RelayCloseInfo | null) => {
    state.status = status;
    state.closeInfo = detail;
    for (const handler of handlers.status) handler(status, detail);
  };

  const updateRoom = (mutate: (room: RoomView) => void) => {
    if (!state.room) return;
    mutate(state.room);
    for (const handler of handlers.peers) handler(state.room);
  };

  const socket = new WebSocketImpl(relayUrl(env.origin));
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ v: ENVELOPE_VERSION, t: 'hello', credential }));
  });

  socket.addEventListener('message', (event: MessageEvent) => {
    let envelope: ControlEnvelope;
    try {
      envelope = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!envelope || typeof envelope !== 'object' || envelope.v !== ENVELOPE_VERSION) return;

    switch (envelope.t) {
      case 'ready': {
        state.you = envelope.you as RelayConnection['you'];
        state.room = envelope.room as RoomView;
        state.reconnected = Boolean(envelope.reconnected);
        setStatus('open', null);
        for (const handler of handlers.peers) handler(state.room);
        break;
      }
      case 'peer-joined': {
        const player = envelope.player as RelayPlayer;
        updateRoom((room) => {
          const existing = room.players.find((p) => p.playerId === player.playerId);
          if (existing) Object.assign(existing, player);
          else room.players.push(player);
        });
        break;
      }
      case 'peer-reconnected': {
        const player = envelope.player as RelayPlayer;
        updateRoom((room) => {
          const existing = room.players.find((p) => p.playerId === player.playerId);
          if (existing) existing.connected = true;
        });
        break;
      }
      case 'peer-left': {
        const playerId = envelope.playerId as string;
        const removed = envelope.reason === 'leave';
        updateRoom((room) => {
          const existing = room.players.find((p) => p.playerId === playerId);
          if (!existing) return;
          if (removed) room.players.splice(room.players.indexOf(existing), 1);
          else existing.connected = false;
        });
        break;
      }
      case 'data': {
        const message: RelayDataMessage = {
          ch: envelope.ch as string,
          payload: envelope.payload,
          from: envelope.from as string,
          role: envelope.role as RelayRole,
        };
        for (const handler of handlers.data) handler(message);
        break;
      }
      default: {
        // room-closed / error 等控制事件原样上抛。
        for (const handler of handlers.event) handler(envelope as { t: string } & Record<string, unknown>);
        if (envelope.t === 'room-closed') {
          state.room = null;
          for (const handler of handlers.peers) handler(null as unknown as RoomView);
        }
      }
    }
  });

  socket.addEventListener('close', (event: CloseEvent) => {
    setStatus('closed', { code: event.code, reason: event.reason || '' });
  });
  socket.addEventListener('error', () => {
    // error 后通常紧跟 close;不重复置状态。
  });

  return {
    get status() {
      return state.status;
    },
    get you() {
      return state.you;
    },
    get room() {
      return state.room;
    },
    get reconnected() {
      return state.reconnected;
    },
    onData(handler) {
      handlers.data.add(handler);
      return () => handlers.data.delete(handler);
    },
    onPeers(handler) {
      handlers.peers.add(handler);
      return () => handlers.peers.delete(handler);
    },
    onEvent(handler) {
      handlers.event.add(handler);
      return () => handlers.event.delete(handler);
    },
    onStatus(handler) {
      handlers.status.add(handler);
      return () => handlers.status.delete(handler);
    },
    send(ch, payload) {
      if (state.status !== 'open') throw new GameDockError('中转连接未就绪');
      if (typeof ch !== 'string' || !CHANNEL_RE.test(ch)) throw new GameDockError(`非法通道 ch:${ch}`);
      if (payload === undefined) throw new GameDockError('payload 不能为 undefined');
      socket.send(JSON.stringify({ v: ENVELOPE_VERSION, t: 'data', ch, payload }));
    },
    leave() {
      if (state.status === 'open') {
        socket.send(JSON.stringify({ v: ENVELOPE_VERSION, t: 'leave' }));
      }
      socket.close();
    },
    close() {
      socket.close();
    },
  };
}
