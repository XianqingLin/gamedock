import { describe, expect, it } from 'vitest';
import { registerUser } from '../auth.mjs';
import { listFriends, respondToRequest, sendFriendRequest } from '../friends.mjs';
import { TEST_USER } from '../bot.mjs';
import {
  acceptGameInvite,
  declineGameInvite,
  getGameInvite,
  listGameInvites,
  sendGameInvite,
} from '../invites.mjs';
import { createMemoryStore } from '../store.mjs';

const gameSlugs = new Set(['bvn']);

async function setup() {
  const store = createMemoryStore();
  const alice = (await registerUser(store, { username: 'alice', password: 'secret66' })).user;
  const bob = (await registerUser(store, { username: 'bob', password: 'secret66' })).user;
  const carol = (await registerUser(store, { username: 'carol', password: 'secret66' })).user;
  await sendFriendRequest(store, alice.id, bob.id);
  await respondToRequest(store, bob.id, (await listFriends(store, bob.id)).incoming[0].id, true);
  return { store, alice, bob, carol };
}

describe('sendGameInvite', () => {
  it('发给好友的邀请进入对方待处理列表,携带 slug 与 params', async () => {
    const { store, alice, bob } = await setup();
    const sent = await sendGameInvite(
      store,
      alice.id,
      { to: bob.id, slug: 'bvn', params: { room: '123456', node: 'cn' } },
      gameSlugs,
    );
    expect(sent.ok).toBe(true);

    const invites = await listGameInvites(store, bob.id);
    expect(invites.invites).toHaveLength(1);
    expect(invites.invites[0]).toMatchObject({
      slug: 'bvn',
      params: { room: '123456', node: 'cn' },
      from: { id: alice.id, username: 'alice' },
    });
  });

  it('只能邀请已接受好友,且测试用户不可被邀请', async () => {
    const { store, alice, carol } = await setup();

    const stranger = await sendGameInvite(store, alice.id, { to: carol.id, slug: 'bvn' }, gameSlugs);
    expect(stranger.error).toBe('只能邀请好友');

    const bot = await sendGameInvite(store, alice.id, { to: TEST_USER.id, slug: 'bvn' }, gameSlugs);
    expect(bot.error).toBe('测试用户无法加入游戏');


    const self = await sendGameInvite(store, alice.id, { to: alice.id, slug: 'bvn' }, gameSlugs);
    expect(self.error).toBe('不能邀请自己');
  });

  it('未接入的 slug 与非法 params 被拒绝', async () => {
    const { store, alice, bob } = await setup();

    const badSlug = await sendGameInvite(store, alice.id, { to: bob.id, slug: 'nope' }, gameSlugs);
    expect(badSlug.error).toBe('未接入该游戏');

    const arrayParams = await sendGameInvite(
      store,
      alice.id,
      { to: bob.id, slug: 'bvn', params: ['x'] },
      gameSlugs,
    );
    expect(arrayParams.error).toBe('邀请参数格式无效');

    const nestedParams = await sendGameInvite(
      store,
      alice.id,
      { to: bob.id, slug: 'bvn', params: { a: { b: 1 } } },
      gameSlugs,
    );
    expect(nestedParams.error).toBe('邀请参数格式无效');

    const hugeParams = await sendGameInvite(
      store,
      alice.id,
      { to: bob.id, slug: 'bvn', params: { a: 'x'.repeat(2000) } },
      gameSlugs,
    );
    expect(hugeParams.error).toBe('邀请参数过大');
  });
});

describe('accept / decline / get', () => {
  it('「进入」标记 accepted,get 可重取 params(刷新后仍能进房)', async () => {
    const { store, alice, bob } = await setup();
    await sendGameInvite(
      store,
      alice.id,
      { to: bob.id, slug: 'bvn', params: { room: '654321', node: 'cf' } },
      gameSlugs,
    );
    const inviteId = (await listGameInvites(store, bob.id)).invites[0].id;

    const accepted = await acceptGameInvite(store, bob.id, inviteId);
    expect(accepted.ok).toBe(true);
    expect(accepted.invite).toMatchObject({ status: 'accepted', params: { room: '654321' } });

    // 接受后不再出现在待处理列表;单条仍可取(运行页刷新兜底)。
    expect((await listGameInvites(store, bob.id)).invites).toHaveLength(0);
    const again = await getGameInvite(store, bob.id, inviteId);
    expect(again.ok).toBe(true);
    expect(again.invite).toMatchObject({ status: 'accepted', params: { room: '654321', node: 'cf' } });

    // 已处理完不能再「进入」或「忽略」。
    expect((await acceptGameInvite(store, bob.id, inviteId)).ok).toBe(false);
    expect((await declineGameInvite(store, bob.id, inviteId)).ok).toBe(false);
  });

  it('「忽略」标记 declined;发出方与陌生人都不能处理', async () => {
    const { store, alice, bob, carol } = await setup();
    await sendGameInvite(store, alice.id, { to: bob.id, slug: 'bvn' }, gameSlugs);
    const inviteId = (await listGameInvites(store, bob.id)).invites[0].id;

    expect((await getGameInvite(store, carol.id, inviteId)).ok).toBe(false);
    expect((await acceptGameInvite(store, carol.id, inviteId)).ok).toBe(false);
    expect((await declineGameInvite(store, alice.id, inviteId)).ok).toBe(false);

    expect((await declineGameInvite(store, bob.id, inviteId)).ok).toBe(true);
    expect((await listGameInvites(store, bob.id)).invites).toHaveLength(0);
  });
});
