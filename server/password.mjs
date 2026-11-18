/**
 * 密码哈希:PBKDF2-SHA256(Web Crypto,Workers 兼容,零依赖)。
 * OWASP 认可的 KDF;与旧版 scrypt 存储格式不兼容,旧账号需重新注册。
 * 免费版 Workers 有单请求 CPU 配额,若注册/登录在部署后被限流,可调低 ITERATIONS。
 */
const ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('非法 hex');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** 常数时间比较:等长字符串逐位异或,避免时序侧信道。 */
function timingSafeEqualStrings(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(password, saltHex) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: ITERATIONS },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToHex(saltBytes);
  return { salt, hash: await derive(password, salt) };
}

export async function verifyPassword(password, salt, hash) {
  if (typeof salt !== 'string' || typeof hash !== 'string') return false;
  let candidate;
  try {
    candidate = await derive(password, salt);
  } catch {
    return false;
  }
  return timingSafeEqualStrings(candidate, hash.toLowerCase());
}
