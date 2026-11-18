/**
 * 无状态会话:payload(userId+过期时间)base64url + HMAC-SHA256 签名(Web Crypto,Workers 兼容)。
 * Cookie 为 httpOnly + SameSite=Lax,同域下游戏 iframe 的请求自动携带。
 * v1 不做服务端吊销(登出即清 Cookie);需要强制下线时再引入会话表。
 */

export const SESSION_COOKIE = 'gamedock_session';
const MAX_AGE_SECONDS = 30 * 24 * 3600;
const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacBase64Url(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

/** 常数时间比较:等长字符串逐位异或,避免时序侧信道。 */
function timingSafeEqualStrings(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(userId, secret, now = Date.now()) {
  const exp = now + MAX_AGE_SECONDS * 1000;
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ uid: userId, exp })));
  return { token: `${payload}.${await hmacBase64Url(payload, secret)}`, maxAge: MAX_AGE_SECONDS };
}

export async function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  let expected;
  try {
    expected = await hmacBase64Url(payload, secret);
  } catch {
    return null;
  }
  if (!timingSafeEqualStrings(token.slice(dot + 1), expected)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
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

/** 解析 Cookie 请求头("a=1; b=2" → {a,b});值经 decodeURIComponent。 */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}
