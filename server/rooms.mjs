import crypto from 'node:crypto';

/**
 * 房间服务(纯内存,重启即散——房间是临时态,不进 db.json)。
 * 职责:建房/加入/离开/房间码/槽位管理 + 断线占位。
 * 中转(WS)只消费这里的状态;游戏语义一律不在此层。
 *
 * 生命周期:
 * - 成员断线后槽位保留 DISCONNECT_TTL_MS(重连窗口),超时移除;
 * - host 槽位消失(host 主动离开或断线超时)→ 整屋解散;
 * - 房间存活超过 ROOM_MAX_AGE_MS 强制销毁。
 */

export const ROOM_CODE_LENGTH = 6;
export const DISCONNECT_TTL_MS = 60 * 1000;
export const ROOM_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const MAX_ROOMS_PER_USER = 3;
export const DEFAULT_MAX_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_SPECTATORS = 10;

const fail = (error) => ({ ok: false, error });

function newRoomCode(rooms) {
  for (let i = 0; i < 50; i++) {
    const code = String(crypto.randomInt(0, 10 ** ROOM_CODE_LENGTH)).padStart(ROOM_CODE_LENGTH, '0');
    if (![...rooms.values()].some((room) => room.code === code)) return code;
  }
  return null;
}

function countByRole(room, role) {
  let n = 0;
  for (const player of room.players.values()) if (player.role === role) n++;
  return n;
}

export function createRoom(ctx, user, { slug, maxPlayers } = {}) {
  if (!ctx.config.gameRoots[slug]) return fail('未接入该游戏');
  const owned = [...ctx.rooms.values()].filter((room) => room.hostId === user.id).length;
  if (owned >= MAX_ROOMS_PER_USER) return fail(`同时最多持有 ${MAX_ROOMS_PER_USER} 个房间`);
  const limit = maxPlayers === undefined ? DEFAULT_MAX_PLAYERS : maxPlayers;
  if (!Number.isInteger(limit) || limit < 2 || limit > MAX_PLAYERS) {
    return fail(`maxPlayers 需为 2-${MAX_PLAYERS}`);
  }
  const code = newRoomCode(ctx.rooms);
  if (!code) return fail('房间码分配失败,请重试');

  const room = {
    id: crypto.randomUUID(),
    code,
    slug,
    maxPlayers: limit,
    hostId: user.id,
    createdAt: Date.now(),
    players: new Map([[user.id, { role: 'host', displayName: user.username, connected: false, since: Date.now() }]]),
  };
  ctx.rooms.set(room.id, room);
  return { ok: true, room };
}

/**
 * 按房间码加入。同一用户重入:复用原槽位(重连,role 不变),幂等。
 */
export function joinRoom(ctx, user, { code, asSpectator } = {}) {
  const room = [...ctx.rooms.values()].find((r) => r.code === code);
  if (!room) return fail('房间不存在或已解散');

  const existing = room.players.get(user.id);
  if (existing) {
    return { ok: true, room, rejoined: true, role: existing.role };
  }

  let role;
  if (asSpectator) {
    if (countByRole(room, 'spectator') >= MAX_SPECTATORS) return fail('观战席已满');
    role = 'spectator';
  } else {
    if (countByRole(room, 'guest') + countByRole(room, 'host') >= room.maxPlayers) return fail('房间已满');
    role = 'guest';
  }
  room.players.set(user.id, { role, displayName: user.username, connected: false, since: Date.now() });
  return { ok: true, room, rejoined: false, role };
}

/** 离开房间;host 离开则整屋解散。 */
export function leaveRoom(ctx, userId, roomId) {
  const room = ctx.rooms.get(roomId);
  if (!room) return fail('房间不存在或已解散');
  if (!room.players.has(userId)) return fail('你不在这个房间里');

  room.players.delete(userId);
  let closed = false;
  if (room.hostId === userId || room.players.size === 0) {
    ctx.rooms.delete(roomId);
    closed = true;
  }
  return { ok: true, closed };
}

/**
 * 标记成员连接状态(由 WS 中转调用)。
 * 断线时把 since 刷新为断线时刻,作为重连窗口起点;重连/上线时同样刷新。
 */
export function setPlayerConnected(ctx, roomId, playerId, connected) {
  const room = ctx.rooms.get(roomId);
  if (!room) return null;
  const player = room.players.get(playerId);
  if (!player) return null;
  player.connected = connected;
  player.since = Date.now();
  return room;
}

/** 房间成员可见的房间信息(不含内部字段)。 */
export function roomView(room) {
  const players = [...room.players.entries()].map(([playerId, p]) => ({
    playerId,
    displayName: p.displayName,
    role: p.role,
    connected: p.connected,
  }));
  return {
    id: room.id,
    code: room.code,
    slug: room.slug,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    players,
  };
}

/**
 * 周期清理:断线超时的成员移除;host 槽位消失或超龄的房间销毁。
 * 返回被销毁的房间 id 列表(供中转通知仍在线的成员)。
 */
export function sweepRooms(ctx, now = Date.now()) {
  const destroyed = [];
  for (const room of ctx.rooms.values()) {
    for (const [playerId, player] of room.players) {
      if (!player.connected && now - player.since > DISCONNECT_TTL_MS) {
        room.players.delete(playerId);
      }
    }
    const hostGone = !room.players.has(room.hostId);
    if (room.players.size === 0 || hostGone || now - room.createdAt > ROOM_MAX_AGE_MS) {
      ctx.rooms.delete(room.id);
      destroyed.push(room.id);
    }
  }
  return destroyed;
}
