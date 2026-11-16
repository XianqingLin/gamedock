import crypto from 'node:crypto';

/**
 * 密码哈希:使用 Node 内置 scrypt(OWASP 认可的 KDF,零依赖)。
 * 生产环境如需更换为 argon2/bcrypt,只需替换本模块,存储格式不变语义。
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
