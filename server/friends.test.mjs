import { describe, expect, it } from 'vitest';
import { registerUser } from './auth.mjs';
import { cancelRequest, listFriends, removeFriend, respondToRequest, sendFriendRequest } from './friends.mjs';
import { emptyDb } from './db.mjs';

function setup() {
  const db = emptyDb();
  const alice = registerUser(db, { username: 'alice', password: 'secret66' }).user;
  const bob = registerUser(db, { username: 'bob', password: 'secret66' }).user;
  return { db, alice, bob };
}

describe('sendFriendRequest', () => {
  it('发出请求后双方列表各自归位', () => {
    const { db, alice, bob } = setup();
    const sent = sendFriendRequest(db, alice.id, 'bob');
    expect(sent.ok).toBe(true);

    const fromAlice = listFriends(db, alice.id);
    const fromBob = listFriends(db, bob.id);
    expect(fromAlice.outgoing).toHaveLength(1);
    expect(fromAlice.outgoing[0].to.username).toBe('bob');
    expect(fromBob.incoming).toHaveLength(1);
    expect(fromBob.incoming[0].from.username).toBe('alice');
    expect(fromBob.friends).toHaveLength(0);
  });

  it('拒绝自己、陌生人、重复请求', () => {
    const { db, alice, bob } = setup();
    expect(sendFriendRequest(db, alice.id, 'alice').error).toBe('不能添加自己为好友');
    expect(sendFriendRequest(db, alice.id, 'ghost').error).toBe('找不到该用户');
    sendFriendRequest(db, alice.id, 'bob');
    expect(sendFriendRequest(db, alice.id, 'bob').error).toBe('已发送过好友请求,等待对方处理');
    expect(sendFriendRequest(db, bob.id, 'alice').error).toBe('对方已向你发送好友请求,请在收到的请求中处理');
  });

  it('已经是好友时不能重复发起', () => {
    const { db, alice, bob } = setup();
    sendFriendRequest(db, alice.id, 'bob');
    respondToRequest(db, bob.id, listFriends(db, bob.id).incoming[0].id, true);
    expect(sendFriendRequest(db, alice.id, 'bob').error).toBe('你们已经是好友了');
  });
});

describe('respondToRequest', () => {
  it('接受后进入好友列表', () => {
    const { db, alice, bob } = setup();
    sendFriendRequest(db, alice.id, 'bob');
    const requestId = listFriends(db, bob.id).incoming[0].id;

    const accepted = respondToRequest(db, bob.id, requestId, true);
    expect(accepted.ok).toBe(true);

    const a = listFriends(db, alice.id);
    const b = listFriends(db, bob.id);
    expect(a.friends).toHaveLength(1);
    expect(a.friends[0].user.username).toBe('bob');
    expect(b.friends).toHaveLength(1);
    expect(b.friends[0].user.username).toBe('alice');
    expect(a.incoming).toHaveLength(0);
    expect(a.outgoing).toHaveLength(0);
  });

  it('拒绝后关系直接消失', () => {
    const { db, alice, bob } = setup();
    sendFriendRequest(db, alice.id, 'bob');
    const requestId = listFriends(db, bob.id).incoming[0].id;
    respondToRequest(db, bob.id, requestId, false);
    expect(listFriends(db, alice.id).outgoing).toHaveLength(0);
    expect(listFriends(db, bob.id).incoming).toHaveLength(0);
    expect(db.friendships).toHaveLength(0);
  });

  it('不能处理别人收到的请求或自己发出的请求', () => {
    const { db, alice, bob } = setup();
    const carol = registerUser(db, { username: 'carol', password: 'secret66' }).user;
    sendFriendRequest(db, alice.id, 'bob');
    const requestId = listFriends(db, bob.id).incoming[0].id;

    expect(respondToRequest(db, carol.id, requestId, true).ok).toBe(false);
    expect(respondToRequest(db, alice.id, requestId, true).error).toBe('不能处理自己发出的请求');
  });
});

describe('cancelRequest', () => {
  it('发出方可以取消待处理请求,接收方不能', () => {
    const { db, alice, bob } = setup();
    sendFriendRequest(db, alice.id, 'bob');
    const requestId = listFriends(db, bob.id).incoming[0].id;

    expect(cancelRequest(db, bob.id, requestId).ok).toBe(false);
    expect(listFriends(db, alice.id).outgoing).toHaveLength(1);

    expect(cancelRequest(db, alice.id, requestId).ok).toBe(true);
    expect(db.friendships).toHaveLength(0);
  });

  it('已接受的好友关系不能用取消请求接口删除', () => {
    const { db, alice, bob } = setup();
    sendFriendRequest(db, alice.id, 'bob');
    const requestId = listFriends(db, bob.id).incoming[0].id;
    respondToRequest(db, bob.id, requestId, true);
    expect(cancelRequest(db, alice.id, requestId).ok).toBe(false);
    expect(listFriends(db, alice.id).friends).toHaveLength(1);
  });
});

describe('removeFriend', () => {
  it('任一方可以解除好友关系', () => {
    const { db, alice, bob } = setup();
    sendFriendRequest(db, alice.id, 'bob');
    const requestId = listFriends(db, bob.id).incoming[0].id;
    respondToRequest(db, bob.id, requestId, true);
    const friendshipId = listFriends(db, alice.id).friends[0].id;

    expect(removeFriend(db, bob.id, friendshipId).ok).toBe(true);
    expect(listFriends(db, alice.id).friends).toHaveLength(0);
    expect(listFriends(db, bob.id).friends).toHaveLength(0);
  });
});
