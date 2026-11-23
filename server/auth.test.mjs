import { describe, expect, it } from 'vitest';
import {
  registerUser,
  validateRegistration,
  verifyLogin,
  findUserByUsername,
  updateProfile,
  publicUser,
} from './auth.mjs';
import { hashPassword, verifyPassword } from './password.mjs';
import { createMemoryStore } from './store.mjs';

describe('validateRegistration 注册校验', () => {
  it('合法用户名:字母数字下划线中文,2-24 位', () => {
    expect(validateRegistration('xiaolin', '123456')).toBeNull();
    expect(validateRegistration('小林', '123456')).toBeNull();
    expect(validateRegistration('a_01', '123456')).toBeNull();
  });

  it('拒绝过短、过长、非法字符', () => {
    expect(validateRegistration('a', '123456')).not.toBeNull();
    expect(validateRegistration('x'.repeat(25), '123456')).not.toBeNull();
    expect(validateRegistration('bad name!', '123456')).not.toBeNull();
    expect(validateRegistration('', '123456')).not.toBeNull();
  });

  it('密码需 6-128 位', () => {
    expect(validateRegistration('xiaolin', '12345')).not.toBeNull();
    expect(validateRegistration('xiaolin', '1'.repeat(129))).not.toBeNull();
    expect(validateRegistration('xiaolin', '1'.repeat(128))).toBeNull();
  });
});

describe('registerUser / verifyLogin', () => {
  it('注册成功后可以用原密码登录', async () => {
    const store = createMemoryStore();
    const reg = await registerUser(store, { username: '小林', password: 'secret66' });
    expect(reg.ok).toBe(true);
    expect(reg.user.username).toBe('小林');
    // 哈希只存在内部记录上;对外暴露由 publicUser 投影保证(见 api.test.mjs 的响应字段)。

    const login = await verifyLogin(store, { username: '小林', password: 'secret66' });
    expect(login.ok).toBe(true);
    expect(login.user.id).toBe(reg.user.id);
  });

  it('错误密码登录失败,错误信息不泄露用户是否存在', async () => {
    const store = createMemoryStore();
    await registerUser(store, { username: 'xiaolin', password: 'secret66' });
    const wrong = await verifyLogin(store, { username: 'xiaolin', password: 'wrong!' });
    const missing = await verifyLogin(store, { username: 'ghost', password: 'whatever' });
    expect(wrong.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(wrong.error).toBe(missing.error);
  });

  it('用户 ID 为 7-8 位数字,多次注册不重复', async () => {
    const store = createMemoryStore();
    const a = await registerUser(store, { username: 'player_a', password: 'secret66' });
    const b = await registerUser(store, { username: 'player_b', password: 'secret66' });
    expect(a.ok && b.ok).toBe(true);
    expect(a.user.id).toMatch(/^\d{7,8}$/);
    expect(b.user.id).toMatch(/^\d{7,8}$/);
    expect(a.user.id).not.toBe(b.user.id);
  });

  it('updateProfile 改名:校验/查重/大小写归一,成功后可按新名登录', async () => {
    const store = createMemoryStore();
    const a = await registerUser(store, { username: 'alice', password: 'secret66' });
    const b = await registerUser(store, { username: 'bobby', password: 'secret66' });
    expect(a.ok && b.ok).toBe(true);

    const bad = await updateProfile(store, a.user.id, { username: 'x!' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('用户名需为 2-24 位字母、数字、下划线或中文');

    const dup = await updateProfile(store, a.user.id, { username: 'BOBBY' });
    expect(dup.ok).toBe(false);
    expect(dup.error).toBe('用户名已存在');

    const same = await updateProfile(store, b.user.id, { username: 'Bobby' });
    expect(same.ok).toBe(true);

    const renamed = await updateProfile(store, a.user.id, { username: 'alice2' });
    expect(renamed.ok).toBe(true);
    expect(renamed.user.username).toBe('alice2');
    const login = await verifyLogin(store, { username: 'alice2', password: 'secret66' });
    expect(login.ok).toBe(true);
  });

  it('updateProfile 头像:合法预设编号写入,非法拒绝,null 恢复默认', async () => {
    const store = createMemoryStore();
    const reg = await registerUser(store, { username: 'avatar_user', password: 'secret66' });

    const bad = await updateProfile(store, reg.user.id, { avatar: 'av99' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('未知头像');

    const set = await updateProfile(store, reg.user.id, { avatar: 'av3' });
    expect(set.ok).toBe(true);
    expect(set.user.avatar).toBe('av3');
    expect(publicUser(set.user).avatar).toBe('av3');

    const clear = await updateProfile(store, reg.user.id, { avatar: null });
    expect(clear.ok).toBe(true);
    expect(clear.user.avatar ?? null).toBeNull();

    const empty = await updateProfile(store, reg.user.id, {});
    expect(empty.ok).toBe(false);
    expect(empty.error).toBe('没有可更新的字段');
  });

  it('用户名不区分大小写唯一', async () => {
    const store = createMemoryStore();
    await registerUser(store, { username: 'PlayerOne', password: 'secret66' });
    expect(await findUserByUsername(store, 'playerone')).not.toBeNull();
    const dup = await registerUser(store, { username: 'playerone', password: 'secret66' });
    expect(dup.ok).toBe(false);
    expect(dup.error).toBe('用户名已存在');
  });
});

describe('hashPassword / verifyPassword', () => {
  it('相同密码不同盐,哈希不同;验证仅接受正确密码', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword('same-password', a.salt, a.hash)).toBe(true);
    expect(await verifyPassword('wrong-password', a.salt, a.hash)).toBe(false);
  });
});
