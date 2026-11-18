import crypto from 'node:crypto';

/**
 * 无状态会话:payload(userId+过期时间)base64url + HMAC-SHA256 签名。
 * Cookie 为 httpOnly + SameSite=Lax,同域下游戏 iframe 的请求自动携带。
 * v1 不做服务端吊销(登出即清 Cookie);需要强制下线时再引入会话表。
 */

export const SESSION_COOKIE = 'gamedock_session';
const MAX_AGE_SECONDS = 30 * 24 * 3600;

function hmac(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signSession(userId, secret, now = Date.now()) {
  const exp = now + MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp })).toString('base64url');
  return { token: `${payload}.${hmac(payload, secret)}`, maxAge: MAX_AGE_SECONDS };
}

export function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(hmac(payload, secret));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.uid !== 'string' || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { userId: data.uid };
  } catch {
    return null;
  }
}

function cookieParts(value, maxAge, secure) {
  const attrs = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function sessionCookieHeader(token, maxAge, secure) {
  return cookieParts(token, maxAge, secure);
}

export function clearSessionCookieHeader(secure) {
  return cookieParts('', 0, secure);
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}
