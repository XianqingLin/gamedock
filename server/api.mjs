import { registerUser, verifyLogin, publicUser } from './auth.mjs';
import { sendFriendRequest, respondToRequest, cancelRequest, removeFriend, listFriends } from './friends.mjs';
import { listChatMessages, sendChatMessage } from './chat.mjs';
import {
  SESSION_COOKIE,
  parseCookies,
  sessionCookieHeader,
  clearSessionCookieHeader,
  signSession,
  verifySession,
} from './session.mjs';

const BODY_LIMIT = 64 * 1024;
/** 存档写入专用上限:槽位值 256KB,留出信封余量。 */
const SAVE_BODY_LIMIT = 320 * 1024;

const encoder = new TextEncoder();

/**
 * 平台 HTTP API(Web 风格:Request 进 Response 出,Workers 与测试共用)。
 * env 形状:{ store, saves, sessionSecret, gameSlugs, gamesData, gameOrigin }
 * - /api/auth/*:注册、登录、登出、当前用户(httpOnly Cookie 会话)
 * - /api/friends*:好友关系(需登录;首版无在线状态)
 * - /api/saves*:平台存档(需登录;slug 须为已接入游戏,值对平台不透明)
 * - /api/games、/api/health:公开
 * - CORS:仅对游戏内容域(gameOrigin)与请求自身源开放,且允许携带凭据——
 *   游戏跑在 games.gamedock.cn 的跨源 iframe 里,SDK 存档等调用需要 Cookie;
 *   会话 Cookie 是 host-only + SameSite=Lax,与游戏域同站(eTLD+1 相同),
 *   跨源请求仍会携带,因此 allowlist 必须收紧,不对任意第三方源开放。
 */
export async function handleApi(request, env) {
  const cors = corsHeadersFor(request, env);

  if (request.method === 'OPTIONS') {
    // 预检:仅 allowlist 内的源放行,其余视为不允许的跨源调用。
    if (!cors) return sendJson(403, { error: '不允许的跨源来源' });
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const response = await routeApi(request, env);
  if (!cors) return response;
  const withCors = new Response(response.body, response);
  for (const [key, value] of Object.entries(cors)) withCors.headers.set(key, value);
  return withCors;
}

/** allowlist:游戏内容域 + 请求自身源(平台 SPA 同源)。返回要附加的 CORS 头。 */
function corsHeadersFor(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  let self;
  try {
    self = new URL(request.url).origin;
  } catch {
    return null;
  }
  if (origin !== env.gameOrigin && origin !== self) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

async function routeApi(request, env) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return sendJson(400, { error: '非法请求路径' });
  }
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const ctx = { request, env, method, secure: isSecureRequest(request) };

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(200, { ok: true, service: 'gamedock' });
  }

  if (pathname === '/api/games' && method === 'GET') {
    if (!env.gamesData) return sendJson(500, { error: '游戏数据不可用' });
    return sendJson(200, env.gamesData);
  }

  if (pathname === '/api/presence' && method === 'POST') {
    // 在线心跳:登录态浏览器周期性调用,服务端记录 last_seen_at 供好友列表判定在线。
    const user = await requireAuth(ctx);
    if (!user) return ctx.response;
    await env.store.updateLastSeen(user.id, new Date().toISOString());
    ctx.response = sendJson(200, { ok: true });
    return ctx.response;
  }

  if (await handleAuthApi(ctx, pathname)) return ctx.response;
  if (await handleFriendsApi(ctx, pathname)) return ctx.response;
  if (await handleChatApi(ctx, pathname)) return ctx.response;
  if (await handleSavesApi(ctx, pathname)) return ctx.response;

  return sendJson(404, { error: '接口不存在' });
}

async function readJsonBody(request, limit = BODY_LIMIT) {
  try {
    const raw = await request.text();
    if (encoder.encode(raw).length > limit) return null;
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

function isSecureRequest(request) {
  return (
    request.headers.get('x-forwarded-proto') === 'https' ||
    new URL(request.url).protocol === 'https:'
  );
}

async function getAuthUser(ctx) {
  const token = parseCookies(ctx.request.headers.get('cookie'))[SESSION_COOKIE];
  const session = await verifySession(token, ctx.env.sessionSecret);
  if (!session) return null;
  return ctx.env.store.getUserById(session.userId);
}

async function requireAuth(ctx) {
  const user = await getAuthUser(ctx);
  if (!user) {
    ctx.response = sendJson(401, { error: '需要登录' });
    return null;
  }
  return user;
}

function sendJson(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function handleAuthApi(ctx, pathname) {
  const { request, env, method, secure } = ctx;

  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readJsonBody(request);
    if (!body) return respond(ctx, sendJson(400, { error: '请求体无效' }));
    const result = await registerUser(env.store, body);
    if (!result.ok) return respond(ctx, sendJson(400, { error: result.error }));
    const { token, maxAge } = await signSession(result.user.id, env.sessionSecret);
    ctx.response = sendJson(200, { user: publicUser(result.user) }, {
      'Set-Cookie': sessionCookieHeader(token, maxAge, secure),
    });
    return true;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(request);
    if (!body) return respond(ctx, sendJson(400, { error: '请求体无效' }));
    const result = await verifyLogin(env.store, body);
    if (!result.ok) return respond(ctx, sendJson(401, { error: result.error }));
    const { token, maxAge } = await signSession(result.user.id, env.sessionSecret);
    ctx.response = sendJson(200, { user: publicUser(result.user) }, {
      'Set-Cookie': sessionCookieHeader(token, maxAge, secure),
    });
    return true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    ctx.response = sendJson(200, { ok: true }, {
      'Set-Cookie': clearSessionCookieHeader(secure),
    });
    return true;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = await getAuthUser(ctx);
    ctx.response = sendJson(200, { user: user ? publicUser(user) : null });
    return true;
  }

  return false;
}

function respond(ctx, response) {
  ctx.response = response;
  return true;
}

async function handleFriendsApi(ctx, pathname) {
  if (!pathname.startsWith('/api/friends')) return false;
  const { env, method } = ctx;

  const user = await requireAuth(ctx);
  if (!user) return true;

  if (pathname === '/api/friends' && method === 'GET') {
    return respond(ctx, sendJson(200, await listFriends(env.store, user.id)));
  }

  const requestAction = /^\/api\/friends\/requests\/([\w-]+)\/(accept|decline)$/.exec(pathname);
  if (requestAction && method === 'POST') {
    const [, requestId, action] = requestAction;
    const result = await respondToRequest(env.store, user.id, requestId, action === 'accept');
    if (!result.ok) return respond(ctx, sendJson(400, { error: result.error }));
    return respond(ctx, sendJson(200, await listFriends(env.store, user.id)));
  }

  if (pathname === '/api/friends/requests' && method === 'POST') {
    const body = await readJsonBody(ctx.request);
    if (!body) return respond(ctx, sendJson(400, { error: '请求体无效' }));
    const result = await sendFriendRequest(env.store, user.id, body.id);
    if (!result.ok) return respond(ctx, sendJson(400, { error: result.error }));
    return respond(ctx, sendJson(200, await listFriends(env.store, user.id)));
  }

  const cancelMatch = /^\/api\/friends\/requests\/([\w-]+)$/.exec(pathname);
  if (cancelMatch && method === 'DELETE') {
    const result = await cancelRequest(env.store, user.id, cancelMatch[1]);
    if (!result.ok) return respond(ctx, sendJson(400, { error: result.error }));
    return respond(ctx, sendJson(200, await listFriends(env.store, user.id)));
  }

  const friendMatch = /^\/api\/friends\/([\w-]+)$/.exec(pathname);
  if (friendMatch && method === 'DELETE') {
    const result = await removeFriend(env.store, user.id, friendMatch[1]);
    if (!result.ok) return respond(ctx, sendJson(400, { error: result.error }));
    return respond(ctx, sendJson(200, await listFriends(env.store, user.id)));
  }

  return respond(ctx, sendJson(404, { error: '接口不存在' }));
}

/**
 * 平台聊天:GET /api/chat/:peer(历史)、POST /api/chat/:peer(发送,返回用户消息 + AI 回复)。
 * 需登录;当前仅 AI 助手「小舟AI」一个会话(peer 固定),AI 配置见 env.ai。
 */
async function handleChatApi(ctx, pathname) {
  if (!pathname.startsWith('/api/chat')) return false;
  const { env, method } = ctx;

  const user = await requireAuth(ctx);
  if (!user) return true;

  const match = /^\/api\/chat\/([\w-]+)$/.exec(pathname);
  if (!match) return respond(ctx, sendJson(404, { error: '接口不存在' }));
  const [, peerId] = match;

  if (method === 'GET') {
    const result = await listChatMessages(env.store, user.id, peerId);
    if (!result.ok) return respond(ctx, sendJson(404, { error: result.error }));
    return respond(ctx, sendJson(200, { messages: result.messages }));
  }

  if (method === 'POST') {
    const body = await readJsonBody(ctx.request);
    if (!body) return respond(ctx, sendJson(400, { error: '请求体无效' }));
    const result = await sendChatMessage(env.store, user.id, peerId, body.content, env.ai);
    if (!result.ok) {
      // AI 环节失败(用户消息已落库)返回 5xx,入参校验错误返回 400——前端据此决定是否补显用户消息。
      const status = result.code === 'ai_unconfigured' ? 503 : result.code ? 502 : 400;
      return respond(ctx, sendJson(status, { error: result.error }));
    }
    return respond(ctx, sendJson(200, { messages: result.messages }));
  }

  return respond(ctx, sendJson(404, { error: '接口不存在' }));
}

/**
 * 平台存档:GET /api/saves/:slug(槽位列表)、
 * GET|PUT|DELETE /api/saves/:slug/:key。需登录;slug 必须是已接入的游戏。
 */
async function handleSavesApi(ctx, pathname) {
  if (!pathname.startsWith('/api/saves')) return false;
  const { env, method } = ctx;

  const user = await requireAuth(ctx);
  if (!user) return true;

  const match = /^\/api\/saves\/([a-z0-9-]{1,64})(?:\/([a-zA-Z0-9_-]{1,64}))?$/.exec(pathname);
  if (!match) return respond(ctx, sendJson(404, { error: '接口不存在' }));
  const [, slug, key] = match;

  if (!env.gameSlugs.has(slug)) {
    return respond(ctx, sendJson(404, { error: '未接入该游戏' }));
  }

  if (!key && method === 'GET') {
    return respond(ctx, sendJson(200, await env.saves.listSaves(user.id, slug)));
  }

  if (!key) return respond(ctx, sendJson(404, { error: '接口不存在' }));

  if (method === 'GET') {
    const result = await env.saves.readSave(user.id, slug, key);
    if (!result.ok) return respond(ctx, sendJson(404, { error: result.error }));
    return respond(ctx, sendJson(200, result.record));
  }

  if (method === 'PUT') {
    const body = await readJsonBody(ctx.request, SAVE_BODY_LIMIT);
    if (!body) return respond(ctx, sendJson(400, { error: '请求体无效' }));
    const result = await env.saves.writeSave(user.id, slug, key, body.value, env.saveLimits);
    if (!result.ok) return respond(ctx, sendJson(400, { error: result.error }));
    return respond(ctx, sendJson(200, result.record));
  }

  if (method === 'DELETE') {
    return respond(ctx, sendJson(200, await env.saves.deleteSave(user.id, slug, key)));
  }

  return respond(ctx, sendJson(404, { error: '接口不存在' }));
}
