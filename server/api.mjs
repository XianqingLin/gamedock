import fs from 'node:fs';
import { registerUser, verifyLogin, publicUser } from './auth.mjs';
import { sendFriendRequest, respondToRequest, cancelRequest, removeFriend, listFriends } from './friends.mjs';
import { listSaves, readSave, writeSave, deleteSave } from './saves.mjs';
import { createRoom, joinRoom, leaveRoom, roomView } from './rooms.mjs';
import { signRelayCredential } from './relay-credential.mjs';
import { saveDb } from './db.mjs';
import {
  SESSION_COOKIE,
  parseCookies,
  sessionCookieHeader,
  clearSessionCookieHeader,
  signSession,
  verifySession,
} from './session.mjs';
import { sendJson } from './static.mjs';

const BODY_LIMIT = 64 * 1024;
/** 存档写入专用上限:槽位值 256KB,留出信封余量。 */
const SAVE_BODY_LIMIT = 320 * 1024;

function readJsonBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https';
}

function getAuthUser(req, ctx) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = verifySession(token, ctx.config.sessionSecret);
  if (!session) return null;
  return ctx.db.users.find((u) => u.id === session.userId) || null;
}

function requireAuth(req, res, ctx) {
  const user = getAuthUser(req, ctx);
  if (!user) {
    sendJson(res, 401, { error: '需要登录' });
    return null;
  }
  return user;
}

/**
 * 平台 HTTP API。
 * - /api/auth/*:注册、登录、登出、当前用户(httpOnly Cookie 会话)
 * - /api/friends*:好友关系(需登录;首版无在线状态)
 * - /api/saves*:平台存档(需登录;slug 须为已接入游戏,值对平台不透明)
 * - /api/games、/api/health:公开
 */
export async function handleApi(req, res, pathname, ctx) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, { ok: true, service: 'gamedock' });
    return;
  }

  if (pathname === '/api/games' && method === 'GET') {
    try {
      const data = JSON.parse(fs.readFileSync(ctx.config.gamesDataFile, 'utf8'));
      sendJson(res, 200, data);
    } catch {
      sendJson(res, 500, { error: '游戏数据不可用' });
    }
    return;
  }

  if (await handleAuthApi(req, res, pathname, method, ctx)) return;
  if (await handleFriendsApi(req, res, pathname, method, ctx)) return;
  if (await handleSavesApi(req, res, pathname, method, ctx)) return;
  if (await handleRoomsApi(req, res, pathname, method, ctx)) return;

  sendJson(res, 404, { error: '接口不存在' });
}

async function handleAuthApi(req, res, pathname, method, ctx) {
  const secure = isSecureRequest(req);

  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: '请求体无效' });
      return true;
    }
    const result = registerUser(ctx.db, body);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    saveDb(ctx.config.dbFile, ctx.db);
    const { token, maxAge } = signSession(result.user.id, ctx.config.sessionSecret);
    res.setHeader('Set-Cookie', sessionCookieHeader(token, maxAge, secure));
    sendJson(res, 200, { user: publicUser(result.user) });
    return true;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: '请求体无效' });
      return true;
    }
    const result = verifyLogin(ctx.db, body);
    if (!result.ok) {
      sendJson(res, 401, { error: result.error });
      return true;
    }
    const { token, maxAge } = signSession(result.user.id, ctx.config.sessionSecret);
    res.setHeader('Set-Cookie', sessionCookieHeader(token, maxAge, secure));
    sendJson(res, 200, { user: publicUser(result.user) });
    return true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', clearSessionCookieHeader(secure));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = getAuthUser(req, ctx);
    sendJson(res, 200, { user: user ? publicUser(user) : null });
    return true;
  }

  return false;
}

async function handleFriendsApi(req, res, pathname, method, ctx) {
  if (!pathname.startsWith('/api/friends')) return false;

  const user = requireAuth(req, res, ctx);
  if (!user) return true;

  if (pathname === '/api/friends' && method === 'GET') {
    sendJson(res, 200, listFriends(ctx.db, user.id));
    return true;
  }

  const requestAction = /^\/api\/friends\/requests\/([\w-]+)\/(accept|decline)$/.exec(pathname);
  if (requestAction && method === 'POST') {
    const [, requestId, action] = requestAction;
    const result = respondToRequest(ctx.db, user.id, requestId, action === 'accept');
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    saveDb(ctx.config.dbFile, ctx.db);
    sendJson(res, 200, listFriends(ctx.db, user.id));
    return true;
  }

  if (pathname === '/api/friends/requests' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: '请求体无效' });
      return true;
    }
    const result = sendFriendRequest(ctx.db, user.id, body.username);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    saveDb(ctx.config.dbFile, ctx.db);
    sendJson(res, 200, listFriends(ctx.db, user.id));
    return true;
  }

  const cancelMatch = /^\/api\/friends\/requests\/([\w-]+)$/.exec(pathname);
  if (cancelMatch && method === 'DELETE') {
    const result = cancelRequest(ctx.db, user.id, cancelMatch[1]);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    saveDb(ctx.config.dbFile, ctx.db);
    sendJson(res, 200, listFriends(ctx.db, user.id));
    return true;
  }

  const friendMatch = /^\/api\/friends\/([\w-]+)$/.exec(pathname);
  if (friendMatch && method === 'DELETE') {
    const result = removeFriend(ctx.db, user.id, friendMatch[1]);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    saveDb(ctx.config.dbFile, ctx.db);
    sendJson(res, 200, listFriends(ctx.db, user.id));
    return true;
  }

  sendJson(res, 404, { error: '接口不存在' });
  return true;
}

/**
 * 平台存档:GET /api/saves/:slug(槽位列表)、
 * GET|PUT|DELETE /api/saves/:slug/:key。需登录;slug 必须是 games.config.json 已接入的游戏。
 */
async function handleSavesApi(req, res, pathname, method, ctx) {
  if (!pathname.startsWith('/api/saves')) return false;

  const user = requireAuth(req, res, ctx);
  if (!user) return true;

  const match = /^\/api\/saves\/([a-z0-9-]{1,64})(?:\/([a-zA-Z0-9_-]{1,64}))?$/.exec(pathname);
  if (!match) {
    sendJson(res, 404, { error: '接口不存在' });
    return true;
  }
  const [, slug, key] = match;

  if (!ctx.config.gameRoots[slug]) {
    sendJson(res, 404, { error: '未接入该游戏' });
    return true;
  }

  const savesDir = ctx.config.savesDir;
  const { valueLimit, maxSlots } = ctx.config.saves ?? {};

  if (!key && method === 'GET') {
    sendJson(res, 200, listSaves(savesDir, user.id, slug));
    return true;
  }

  if (!key) {
    sendJson(res, 404, { error: '接口不存在' });
    return true;
  }

  if (method === 'GET') {
    const result = readSave(savesDir, user.id, slug, key);
    if (!result.ok) {
      sendJson(res, 404, { error: result.error });
      return true;
    }
    sendJson(res, 200, result.record);
    return true;
  }

  if (method === 'PUT') {
    const body = await readJsonBody(req, SAVE_BODY_LIMIT);
    if (!body) {
      sendJson(res, 400, { error: '请求体无效' });
      return true;
    }
    const result = writeSave(savesDir, user.id, slug, key, body.value, { valueLimit, maxSlots });
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    sendJson(res, 200, result.record);
    return true;
  }

  if (method === 'DELETE') {
    sendJson(res, 200, deleteSave(savesDir, user.id, slug, key));
    return true;
  }

  sendJson(res, 404, { error: '接口不存在' });
  return true;
}

/**
 * 房间 REST(需登录;房间态在内存,WS 中转凭证从这里签发):
 * - POST /api/rooms        { slug, maxPlayers? } → { room, credential }(role: host)
 * - POST /api/rooms/join   { code, asSpectator? } → { room, credential, rejoined }
 * - POST /api/rooms/:id/leave → { ok, closed }(host 离开 → 解散)
 * - GET  /api/rooms/:id    → 房间视图(仅成员可看)
 */
async function handleRoomsApi(req, res, pathname, method, ctx) {
  if (!pathname.startsWith('/api/rooms')) return false;

  const user = requireAuth(req, res, ctx);
  if (!user) return true;

  const issueCredential = (roomId, role) =>
    signRelayCredential({ roomId, playerId: user.id, role }, ctx.config.sessionSecret);

  if (pathname === '/api/rooms' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: '请求体无效' });
      return true;
    }
    const result = createRoom(ctx, user, { slug: body.slug, maxPlayers: body.maxPlayers });
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    sendJson(res, 200, {
      room: roomView(result.room),
      credential: issueCredential(result.room.id, 'host'),
    });
    return true;
  }

  if (pathname === '/api/rooms/join' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
      sendJson(res, 400, { error: '请输入 6 位房间码' });
      return true;
    }
    const result = joinRoom(ctx, user, { code: body.code, asSpectator: Boolean(body.asSpectator) });
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    sendJson(res, 200, {
      room: roomView(result.room),
      credential: issueCredential(result.room.id, result.role),
      rejoined: result.rejoined,
    });
    return true;
  }

  const leaveMatch = /^\/api\/rooms\/([\w-]+)\/leave$/.exec(pathname);
  if (leaveMatch && method === 'POST') {
    const result = leaveRoom(ctx, user.id, leaveMatch[1]);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    ctx.relay?.notifyLeave(leaveMatch[1], user.id, result.closed);
    sendJson(res, 200, { ok: true, closed: result.closed });
    return true;
  }

  const roomMatch = /^\/api\/rooms\/([\w-]+)$/.exec(pathname);
  if (roomMatch && method === 'GET') {
    const room = ctx.rooms.get(roomMatch[1]);
    if (!room) {
      sendJson(res, 404, { error: '房间不存在或已解散' });
      return true;
    }
    if (!room.players.has(user.id)) {
      sendJson(res, 403, { error: '不在该房间内' });
      return true;
    }
    sendJson(res, 200, { room: roomView(room) });
    return true;
  }

  sendJson(res, 404, { error: '接口不存在' });
  return true;
}
