import { registerUser, verifyLogin, publicUser } from './auth.mjs';
import { sendFriendRequest, respondToRequest, cancelRequest, removeFriend, listFriends } from './friends.mjs';
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
 * env 形状:{ store, saves, sessionSecret, gameSlugs, gamesData }
 * - /api/auth/*:注册、登录、登出、当前用户(httpOnly Cookie 会话)
 * - /api/friends*:好友关系(需登录;首版无在线状态)
 * - /api/saves*:平台存档(需登录;slug 须为已接入游戏,值对平台不透明)
 * - /api/games、/api/health:公开
 */
export async function handleApi(request, env) {
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

  if (await handleAuthApi(ctx, pathname)) return ctx.response;
  if (await handleFriendsApi(ctx, pathname)) return ctx.response;
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
    const result = await sendFriendRequest(env.store, user.id, body.username);
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
