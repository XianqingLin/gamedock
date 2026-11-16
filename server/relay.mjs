import { WebSocketServer } from 'ws';
import { verifyRelayCredential } from './relay-credential.mjs';
import { setPlayerConnected, roomView, sweepRooms } from './rooms.mjs';

/**
 * 通用对战中转:平台只做字节管道 + 成员事件,不解析游戏内容。
 * - 端点:WS upgrade /api/relay;客户端首条消息必须为 hello(带凭证),5 秒内未完成认证断开。
 * - 信封:{ v, t, ch?, payload? };控制消息(ready、peer-joined、peer-left、room-closed、error)不带 ch,
 *   游戏数据 t='data' 必须带 ch(通道是将来限流策略的单位)与 payload(JSON)。
 * - 断线不清槽位:靠房间服务的重连窗口(rooms.mjs)与凭证(短时效)重连。
 * - 限流:每连接 50 msg/s(突发 100),超发丢弃,严重超发断开(4008)。
 */

const HELLO_TIMEOUT_MS = 5 * 1000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const RATE_PER_SECOND = 50;
const RATE_BURST = 100;
const SWEEP_INTERVAL_MS = 15 * 1000;

const CHANNEL_RE = /^[a-z0-9-]{1,16}$/;

const CLOSE_AUTH_FAILED = 4001;
const CLOSE_HELLO_TIMEOUT = 4002;
const CLOSE_ROOM_GONE = 4003;
const CLOSE_RATE = 4008;

const ENVELOPE_VERSION = 1;

function sendEnvelope(socket, envelope) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ v: ENVELOPE_VERSION, ...envelope }));
  }
}

function closeWith(socket, code, reason) {
  if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
    socket.close(code, reason);
  }
}

/**
 * 挂载中转到 HTTP server。ctx 需要:config.sessionSecret、rooms(Map)、config.gameRoots。
 * 同时注册 ctx.relay = { notifyLeave },供房间 REST 在成员离开/解散时广播。
 */
export function attachRelay(server, ctx) {
  const wss = new WebSocketServer({ noServer: true });
  /** roomId → Set<连接状态> */
  const roomSockets = new Map();

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/api/relay') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket) => {
    const state = { socket, authed: false, roomId: null, playerId: null, role: null };
    let rateTokens = RATE_BURST;
    let lastRefill = Date.now();

    const helloTimer = setTimeout(() => closeWith(socket, CLOSE_HELLO_TIMEOUT, '认证超时'), HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    const memberViewOf = (room, playerId) =>
      roomView(room).players.find((p) => p.playerId === playerId) ?? null;

    function broadcast(roomId, envelope, excludePlayerId) {
      const sockets = roomSockets.get(roomId);
      if (!sockets) return;
      for (const peer of sockets) {
        if (peer.playerId !== excludePlayerId) sendEnvelope(peer.socket, envelope);
      }
    }

    /** 复用房间服务的离开语义(host 离开 → 解散)。 */
    function leaveMember(roomId, playerId) {
      const room = ctx.rooms.get(roomId);
      if (!room || !room.players.has(playerId)) return { closed: false };
      room.players.delete(playerId);
      const closed = room.hostId === playerId || room.players.size === 0;
      if (closed) ctx.rooms.delete(roomId);
      return { closed };
    }

    function dropFromRoom(reason) {
      clearTimeout(helloTimer);
      if (!state.authed) return;
      const { roomId, playerId } = state;
      const sockets = roomSockets.get(roomId);
      sockets?.delete(state);
      if (sockets && sockets.size === 0) roomSockets.delete(roomId);

      const room = ctx.rooms.get(roomId);
      // 成员已被 REST 离开/清理流程移除时不再重复广播。
      if (!room || !room.players.has(playerId)) return;
      setPlayerConnected(ctx, roomId, playerId, false);
      if (reason === 'leave') {
        const result = leaveMember(roomId, playerId);
        if (result.closed) {
          broadcast(roomId, { t: 'room-closed', roomId });
          roomSockets.delete(roomId);
        } else {
          broadcast(roomId, { t: 'peer-left', playerId, reason });
        }
      } else {
        broadcast(roomId, { t: 'peer-left', playerId, reason });
      }
    }

    const finishAuth = (credential) => {
      const payload = verifyRelayCredential(credential, ctx.config.sessionSecret);
      if (!payload) {
        sendEnvelope(socket, { t: 'error', code: 'auth', message: '凭证无效或已过期' });
        closeWith(socket, CLOSE_AUTH_FAILED, '凭证无效');
        return;
      }
      const room = ctx.rooms.get(payload.roomId);
      const player = room?.players.get(payload.playerId);
      if (!room || !player) {
        sendEnvelope(socket, { t: 'error', code: 'no-room', message: '房间不存在或已解散' });
        closeWith(socket, CLOSE_ROOM_GONE, '房间不存在');
        return;
      }

      state.authed = true;
      state.roomId = room.id;
      state.playerId = payload.playerId;
      // 房间记录是 role 的权威。
      state.role = player.role;

      const firstAppearance = !player.everConnected;
      setPlayerConnected(ctx, room.id, payload.playerId, true);
      player.everConnected = true;
      clearTimeout(helloTimer);

      if (!roomSockets.has(room.id)) roomSockets.set(room.id, new Set());
      roomSockets.get(room.id).add(state);

      sendEnvelope(socket, {
        t: 'ready',
        you: { playerId: payload.playerId, role: player.role, displayName: player.displayName },
        room: roomView(room),
        reconnected: !firstAppearance,
      });
      if (firstAppearance) {
        broadcast(room.id, { t: 'peer-joined', player: memberViewOf(room, payload.playerId) }, payload.playerId);
      } else {
        broadcast(room.id, { t: 'peer-reconnected', player: memberViewOf(room, payload.playerId) }, payload.playerId);
      }
    };

    socket.on('message', (raw, isBinary) => {
      if (!isBinary && raw.length > MAX_MESSAGE_BYTES) {
        closeWith(socket, CLOSE_RATE, '消息过大');
        return;
      }

      // 令牌桶限流。
      const now = Date.now();
      rateTokens = Math.min(RATE_BURST, rateTokens + ((now - lastRefill) / 1000) * RATE_PER_SECOND);
      lastRefill = now;
      if (rateTokens < 1) {
        sendEnvelope(socket, { t: 'error', code: 'rate', message: '发送过快,消息被丢弃' });
        if (rateTokens < -RATE_PER_SECOND * 3) closeWith(socket, CLOSE_RATE, '严重超发');
        rateTokens -= 1;
        return;
      }
      rateTokens -= 1;

      let envelope;
      try {
        envelope = JSON.parse(raw.toString('utf8'));
      } catch {
        sendEnvelope(socket, { t: 'error', code: 'bad-message', message: '消息不是合法 JSON' });
        return;
      }
      if (!envelope || typeof envelope !== 'object' || envelope.v !== ENVELOPE_VERSION) {
        sendEnvelope(socket, { t: 'error', code: 'bad-message', message: '信封版本不正确' });
        return;
      }

      if (!state.authed) {
        if (envelope.t === 'hello' && typeof envelope.credential === 'string') {
          finishAuth(envelope.credential);
        } else {
          sendEnvelope(socket, { t: 'error', code: 'auth', message: '请先发送 hello 完成认证' });
        }
        return;
      }

      if (envelope.t === 'leave') {
        dropFromRoom('leave');
        closeWith(socket, 1000, 'leave');
        return;
      }

      if (envelope.t === 'data') {
        if (typeof envelope.ch !== 'string' || !CHANNEL_RE.test(envelope.ch)) {
          sendEnvelope(socket, { t: 'error', code: 'bad-message', message: '数据消息需带合法通道 ch' });
          return;
        }
        if (envelope.payload === undefined) {
          sendEnvelope(socket, { t: 'error', code: 'bad-message', message: '数据消息缺少 payload' });
          return;
        }
        const room = ctx.rooms.get(state.roomId);
        if (!room || !room.players.has(state.playerId)) {
          sendEnvelope(socket, { t: 'error', code: 'no-room', message: '房间不存在或已解散' });
          closeWith(socket, CLOSE_ROOM_GONE, '房间不存在');
          return;
        }
        broadcast(
          state.roomId,
          { t: 'data', ch: envelope.ch, payload: envelope.payload, from: state.playerId, role: state.role },
          state.playerId,
        );
        return;
      }

      sendEnvelope(socket, { t: 'error', code: 'bad-message', message: `未知消息类型:${String(envelope.t)}` });
    });

    socket.on('close', () => dropFromRoom('disconnect'));
    socket.on('error', () => dropFromRoom('disconnect'));
  });

  // HTTP server 关闭时掐掉所有 WS 连接,否则 server.close() 会等连接而挂起(测试依赖此点)。
  server.on('close', () => {
    for (const sockets of roomSockets.values()) {
      for (const peer of sockets) peer.socket.terminate();
    }
    roomSockets.clear();
    wss.close();
  });

  // 周期清理断线超时的槽位/超龄房间,并通知仍连接的成员房间已解散。
  const sweepTimer = setInterval(() => {
    const destroyed = sweepRooms(ctx);
    for (const roomId of destroyed) {
      const sockets = roomSockets.get(roomId);
      if (sockets) {
        for (const peer of sockets) sendEnvelope(peer.socket, { t: 'room-closed', roomId });
        for (const peer of sockets) closeWith(peer.socket, CLOSE_ROOM_GONE, '房间已解散');
        roomSockets.delete(roomId);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

  /**
   * 房间 REST 层主动离开/解散时调用(该成员可能没有 WS 连接)。
   * 关闭该用户在此房间的连接,并广播 peer-left / room-closed。
   */
  ctx.relay = {
    notifyLeave(roomId, playerId, closed) {
      const sockets = roomSockets.get(roomId);
      if (!sockets) return;
      for (const peer of sockets) {
        if (peer.playerId === playerId) closeWith(peer.socket, 1000, 'leave');
      }
      if (closed) {
        for (const peer of sockets) {
          if (peer.playerId !== playerId) {
            sendEnvelope(peer.socket, { t: 'room-closed', roomId });
            closeWith(peer.socket, CLOSE_ROOM_GONE, '房间已解散');
          }
        }
        roomSockets.delete(roomId);
      } else {
        for (const peer of sockets) {
          if (peer.playerId !== playerId) {
            sendEnvelope(peer.socket, { t: 'peer-left', playerId, reason: 'leave' });
          }
        }
      }
    },
  };
}
