import crypto from 'node:crypto';

/**
 * 中转凭证:HMAC 签名的短时效 token,格式 base64url(payloadJson).base64url(hmac)。
 * 中转器验签放行、不查库;签发只发生在已登录的房间 REST 接口里。
 * payload:{ roomId, playerId, role: 'host'|'guest'|'spectator', exp(秒级时间戳), purpose }
 * purpose 隔离凭证用途,防止会话签名密钥被复用伪造其他 HMAC 场景。
 */

const PURPOSE = 'gamedock-relay-v1';

export const RELAY_ROLES = ['host', 'guest', 'spectator'];

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hmac(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * 签发凭证。ttlSeconds 默认 600(10 分钟,短时效);过期后需重新走房间 REST 换新凭证。
 */
export function signRelayCredential({ roomId, playerId, role }, secret, ttlSeconds = 600) {
  if (!roomId || !playerId || !RELAY_ROLES.includes(role)) {
    throw new Error('凭证字段不完整');
  }
  const payload = {
    roomId,
    playerId,
    role,
    purpose: PURPOSE,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${hmac(payloadB64, secret)}`;
}

/** 验签 + 查过期 + 查用途;任何一项不符返回 null(不区分原因,不给攻击者信息)。 */
export function verifyRelayCredential(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = hmac(payloadB64, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.purpose !== PURPOSE) return null;
    if (!RELAY_ROLES.includes(payload.role)) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
