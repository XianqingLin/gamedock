import { hashPassword, verifyPassword } from './password.mjs';

export const USERNAME_PATTERN = /^[a-zA-Z0-9_一-龥]{2,24}$/u;

export function validateRegistration(username, password) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return '用户名需为 2-24 位字母、数字、下划线或中文';
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return '密码需为 6-128 位';
  }
  return null;
}

export function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

/** 用户名不区分大小写查找(存储实现负责大小写归一)。 */
export async function findUserByUsername(store, username) {
  return store.getUserByUsernameLower(String(username ?? '').toLowerCase());
}

/** 注册:校验 + 唯一性检查 + 哈希落库。返回 {ok, user|error}。 */
export async function registerUser(store, { username, password }) {
  const invalid = validateRegistration(username, password);
  if (invalid) return { ok: false, error: invalid };
  if (await findUserByUsername(store, username)) return { ok: false, error: '用户名已存在' };

  const { salt, hash } = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    passSalt: salt,
    passHash: hash,
    createdAt: new Date().toISOString(),
  };
  try {
    await store.insertUser(user);
  } catch (err) {
    // 并发注册同一用户名:唯一约束兜底(D1 UNIQUE 冲突),其余错误上抛。
    if (String(err?.message ?? '').includes('UNIQUE')) return { ok: false, error: '用户名已存在' };
    throw err;
  }
  return { ok: true, user };
}

/** 登录:用户名或密码错误时错误信息不区分两者,不泄露用户是否存在。 */
export async function verifyLogin(store, { username, password }) {
  const user = await findUserByUsername(store, username);
  if (!user || typeof password !== 'string') return { ok: false, error: '用户名或密码错误' };
  if (!(await verifyPassword(password, user.passSalt, user.passHash))) {
    return { ok: false, error: '用户名或密码错误' };
  }
  return { ok: true, user };
}
