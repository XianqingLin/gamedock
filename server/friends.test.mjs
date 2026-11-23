import { describe, expect, it } from 'vitest';
import { registerUser } from './auth.mjs';
import { cancelRequest, listFriends, removeFriend, respondToRequest, sendFriendRequest } from './friends.mjs';
import { TEST_USER } from './bot.mjs';
import { createMemoryStore } from './store.mjs';

async function setup() {
  const store = createMemoryStore();
  const alice = (await registerUser(store, { username: 'alice', password: 'secret66' })).user;
  const bob = (await registerUser(store, { username: 'bob', password: 'secret66' })).user;
  return { store, alice, bob };
}

describe('sendFriendRequest', () => {
  it('按用户 ID 发出请求后双方列表各自归位', async () => {
    const { store, alice, bob } = await setup();
    const sent = await sendFriendRequest(store, alice.id, bob.id);
    expect(sent.ok).toBe(true);

    const fromAlice = await listFriends(store, alice.id);
    const fromBob = await listFriends(store, bob.id);
    expect(fromAlice.outgoing).toHaveLength(1);
    expect(fromAlice.outgoing[0].to.username).toBe('bob');
    expect(fromBob.incoming).toHaveLength(1);
    expect(fromBob.incoming[0].from.username).toBe('alice');
    expect(fromBob.friends.filter((f) => !f.bot)).toHaveLength(0);
  });

  it('测试用户 bot 固定出现在好友列表首位、恒在线且不可删除', async () => {
    const { store, alice, bob } = await setup();
    await sendFriendRequest(store, alice.id, bob.id);
    await respondToRequest(store, bob.id, (await listFriends(store, bob.id)).incoming[0].id, true);

    const lists = await listFriends(store, alice.id);
    expect(lists.friends[0]).toMatchObject({
      id: TEST_USER.id,
      bot: true,
      user: { id: TEST_USER.id, username: '测试用户', online: true },
    });
    expect(lists.friends[1].user.username).toBe('bob');

    // 不可删除:removeFriend 对 bot 关系明确报错,关系保持(bot 行的 id 是用户 ID,
    // 真正的 friendship 记录从存储内查)。
    const botFriendship = store._db.friendships.find(
      (r) => r.status === 'accepted' && r.users.includes(TEST_USER.id),
    );
    const removed = await removeFriend(store, alice.id, botFriendship.id);
    expect(removed.ok).toBe(false);
    expect(removed.error).toBe('测试用户不可删除');
    expect((await listFriends(store, alice.id)).friends[0].id).toBe(TEST_USER.id);
  });


  it('拒绝自己、陌生人、重复请求', async () => {
    const { store, alice, bob } = await setup();
    expect((await sendFriendRequest(store, alice.id, alice.id)).error).toBe('不能添加自己为好友');
    expect((await sendFriendRequest(store, alice.id, '00000000-0000-0000-0000-000000000000')).error).toBe('找不到该用户');
    expect((await sendFriendRequest(store, alice.id, '   ')).error).toBe('请输入要添加的用户 ID');
    await sendFriendRequest(store, alice.id, bob.id);
    expect((await sendFriendRequest(store, alice.id, bob.id)).error).toBe('已发送过好友请求,等待对方处理');
    expect((await sendFriendRequest(store, bob.id, alice.id)).error).toBe('对方已向你发送好友请求,请在收到的请求中处理');
  });

  it('已经是好友时不能重复发起', async () => {
    const { store, alice, bob } = await setup();
    await sendFriendRequest(store, alice.id, bob.id);
    await respondToRequest(store, bob.id, (await listFriends(store, bob.id)).incoming[0].id, true);
    expect((await sendFriendRequest(store, alice.id, bob.id)).error).toBe('你们已经是好友了');
  });
});

describe('respondToRequest', () => {
  it('接受后进入好友列表', async () => {
    const { store, alice, bob } = await setup();
    await sendFriendRequest(store, alice.id, bob.id);
    const requestId = (await listFriends(store, bob.id)).incoming[0].id;

    const accepted = await respondToRequest(store, bob.id, requestId, true);
    expect(accepted.ok).toBe(true);

    const a = await listFriends(store, alice.id);
    const b = await listFriends(store, bob.id);
    expect(a.friends.filter((f) => !f.bot)).toHaveLength(1);
    expect(a.friends[1].user.username).toBe('bob');
    expect(b.friends.filter((f) => !f.bot)).toHaveLength(1);
    expect(b.friends[1].user.username).toBe('alice');

    expect(a.incoming).toHaveLength(0);
    expect(a.outgoing).toHaveLength(0);
  });

  it('拒绝后关系直接消失', async () => {
    const { store, alice, bob } = await setup();
    await sendFriendRequest(store, alice.id, bob.id);
    const requestId = (await listFriends(store, bob.id)).incoming[0].id;
    await respondToRequest(store, bob.id, requestId, false);
    expect((await listFriends(store, alice.id)).outgoing).toHaveLength(0);
    expect((await listFriends(store, bob.id)).incoming).toHaveLength(0);
    expect(store._db.friendships.filter((r) => !r.users.includes(TEST_USER.id))).toHaveLength(0);
  });


  it('不能处理别人收到的请求或自己发出的请求', async () => {
    const { store, alice, bob } = await setup();
    const carol = (await registerUser(store, { username: 'carol', password: 'secret66' })).user;
    await sendFriendRequest(store, alice.id, bob.id);
    const requestId = (await listFriends(store, bob.id)).incoming[0].id;

    expect((await respondToRequest(store, carol.id, requestId, true)).ok).toBe(false);
    expect((await respondToRequest(store, alice.id, requestId, true)).error).toBe('不能处理自己发出的请求');
  });
});

describe('cancelRequest', () => {
  it('发出方可以取消待处理请求,接收方不能', async () => {
    const { store, alice, bob } = await setup();
    await sendFriendRequest(store, alice.id, bob.id);
    const requestId = (await listFriends(store, bob.id)).incoming[0].id;

    expect((await cancelRequest(store, bob.id, requestId)).ok).toBe(false);
    expect((await listFriends(store, alice.id)).outgoing).toHaveLength(1);

    expect((await cancelRequest(store, alice.id, requestId)).ok).toBe(true);
    expect(store._db.friendships.filter((r) => !r.users.includes(TEST_USER.id))).toHaveLength(0);
  });

  it('已接受的好友关系不能用取消请求接口删除', async () => {
    const { store, alice, bob } = await setup();
    await sendFriendRequest(store, alice.id, bob.id);
    const requestId = (await listFriends(store, bob.id)).incoming[0].id;
    await respondToRequest(store, bob.id, requestId, true);
    expect((await cancelRequest(store, alice.id, requestId)).ok).toBe(false);
    expect((await listFriends(store, alice.id)).friends.filter((f) => !f.bot)).toHaveLength(1);
  });

});

describe('removeFriend', () => {
  it('任一方可以解除好友关系', async () => {
    const { store, alice, bob } = await setup();
    await sendFriendRequest(store, alice.id, bob.id);
    const requestId = (await listFriends(store, bob.id)).incoming[0].id;
    await respondToRequest(store, bob.id, requestId, true);
    const friendshipId = (await listFriends(store, alice.id)).friends.find((f) => !f.bot).id;

    expect((await removeFriend(store, bob.id, friendshipId)).ok).toBe(true);
    expect((await listFriends(store, alice.id)).friends.filter((f) => !f.bot)).toHaveLength(0);
    expect((await listFriends(store, bob.id)).friends.filter((f) => !f.bot)).toHaveLength(0);
  });

});
