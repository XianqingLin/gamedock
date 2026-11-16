import crypto from 'node:crypto';
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

export function findUserByUsername(db, username) {
  const lower = String(username ?? '').toLowerCase();
  return db.users.find((u) => u.username.toLowerCase() === lower) || null;
}

export function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export function registerUser(db, { username, password }) {
  const invalid = validateRegistration(username, password);
  if (invalid) return { ok: false, error: invalid };
  if (findUserByUsername(db, username)) return { ok: false, error: '用户名已存在' };

  const { salt, hash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    passSalt: salt,
    passHash: hash,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  return { ok: true, user };
}

export function verifyLogin(db, { username, password }) {
  const user = findUserByUsername(db, username);
  if (!user || typeof password !== 'string') return { ok: false, error: '用户名或密码错误' };
  if (!verifyPassword(password, user.passSalt, user.passHash)) {
    return { ok: false, error: '用户名或密码错误' };
  }
  return { ok: true, user };
}
