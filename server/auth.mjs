import { hashPassword, verifyPassword } from './password.mjs';

export const USERNAME_PATTERN = /^[a-zA-Z0-9_一-龥]{2,24}$/u;

// 用户 ID:7-8 位随机数字(1,000,000 ~ 99,999,999),注册时分配、此后不变,对外展示与加好友均用它。
// 空间约 9900 万,D1 主键唯一约束兜底,撞号时换号重试。
const USER_ID_MIN = 1_000_000;
const USER_ID_RANGE = 99_000_000;

// 头像预设编号:av0 = 小舟AI 专属,av1~av16 = 用户可选(清单见前端 src/data/avatars.tsx)。
export const AVATAR_ID_PATTERN = /^av(?:0|[1-9]|1[0-6])$/;

/** [USER_ID_MIN, USER_ID_MIN + USER_ID_RANGE) 内的无偏随机整数,返回十进制字符串。 */
function randomUserId() {
  const buffer = new Uint32Array(1);
  // 拒绝采样消除取模偏差:落在 range 整除界之上的样本丢弃重抽。
  const limit = Math.floor(0x1_0000_0000 / USER_ID_RANGE) * USER_ID_RANGE;
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return String(USER_ID_MIN + (buffer[0] % USER_ID_RANGE));
}

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
  return { id: user.id, username: user.username, createdAt: user.createdAt, avatar: user.avatar ?? null };
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
  const createdAt = new Date().toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const user = { id: randomUserId(), username, passSalt: salt, passHash: hash, createdAt };
    try {
      await store.insertUser(user);
      return { ok: true, user };
    } catch (err) {
      const message = String(err?.message ?? '');
      if (!message.includes('UNIQUE')) throw err;
      // 并发注册撞唯一约束(D1 UNIQUE 冲突)。
      if (message.includes('username_lower')) return { ok: false, error: '用户名已存在' };
      // 用户 ID 撞号(仅并发窗口内可能):换号重试。
    }
  }
  return { ok: false, error: '注册繁忙,请稍后再试' };
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

/**
 * 资料更新(PATCH /api/auth/profile):改用户名(= 登录名,唯一身份)与头像。
 * - username 沿用注册校验(2-24 位)与唯一约束;与现值相同视为未改名,直接通过。
 * - avatar 为系统预设编号(见前端 src/data/avatars.tsx),null 恢复默认首字母头像。
 */
export async function updateProfile(store, userId, { username, avatar } = {}) {
  const user = await store.getUserById(userId);
  if (!user) return { ok: false, error: '用户不存在' };

  const patch = {};
  if (username !== undefined) {
    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
      return { ok: false, error: '用户名需为 2-24 位字母、数字、下划线或中文' };
    }
    const sameName = user.username.toLowerCase() === username.toLowerCase();
    if (!sameName) {
      const existing = await store.getUserByUsernameLower(username.toLowerCase());
      if (existing) return { ok: false, error: '用户名已存在' };
    }
    patch.username = username;
  }
  if (avatar !== undefined) {
    if (avatar !== null && (typeof avatar !== 'string' || !AVATAR_ID_PATTERN.test(avatar))) {
      return { ok: false, error: '未知头像' };
    }
    patch.avatar = avatar;
  }
  if (!Object.keys(patch).length) return { ok: false, error: '没有可更新的字段' };

  try {
    await store.updateUser(userId, patch);
  } catch (err) {
    // 并发改名撞唯一约束(D1 UNIQUE 冲突):统一按用户名已存在处理,其余错误上抛。
    if (String(err?.message ?? '').includes('UNIQUE')) return { ok: false, error: '用户名已存在' };
    throw err;
  }
  return { ok: true, user: await store.getUserById(userId) };
}
