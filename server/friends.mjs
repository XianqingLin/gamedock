import crypto from 'node:crypto';
import { findUserByUsername } from './auth.mjs';

/** 好友关系逻辑。记录:{ id, users:[aId,bId](已排序), status:'pending'|'accepted', requestedBy, createdAt } */

const fail = (error) => ({ ok: false, error });

function findBetween(db, userA, userB) {
  return (
    db.friendships.find(
      (r) => r.users.includes(userA) && r.users.includes(userB),
    ) || null
  );
}

export function sendFriendRequest(db, userId, targetUsername) {
  if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
    return fail('请输入要添加的用户名');
  }
  const target = findUserByUsername(db, targetUsername);
  if (!target) return fail('找不到该用户');
  if (target.id === userId) return fail('不能添加自己为好友');

  const existing = findBetween(db, userId, target.id);
  if (existing) {
    if (existing.status === 'accepted') return fail('你们已经是好友了');
    if (existing.requestedBy === userId) return fail('已发送过好友请求,等待对方处理');
    return fail('对方已向你发送好友请求,请在收到的请求中处理');
  }

  const record = {
    id: crypto.randomUUID(),
    users: [userId, target.id].sort(),
    status: 'pending',
    requestedBy: userId,
    createdAt: new Date().toISOString(),
  };
  db.friendships.push(record);
  return { ok: true, record };
}

function findOwnRequest(db, userId, requestId) {
  const record = db.friendships.find((r) => r.id === requestId);
  if (!record || record.status !== 'pending' || !record.users.includes(userId)) return null;
  return record;
}

export function respondToRequest(db, userId, requestId, accept) {
  const record = findOwnRequest(db, userId, requestId);
  if (!record) return fail('请求不存在或已处理');
  if (record.requestedBy === userId) return fail('不能处理自己发出的请求');

  if (accept) {
    record.status = 'accepted';
    record.respondedAt = new Date().toISOString();
    return { ok: true, record };
  }
  db.friendships.splice(db.friendships.indexOf(record), 1);
  return { ok: true, record: null };
}

export function cancelRequest(db, userId, requestId) {
  const record = findOwnRequest(db, userId, requestId);
  if (!record || record.requestedBy !== userId) return fail('请求不存在或已处理');
  db.friendships.splice(db.friendships.indexOf(record), 1);
  return { ok: true, record: null };
}

export function removeFriend(db, userId, friendshipId) {
  const record = db.friendships.find((r) => r.id === friendshipId);
  if (!record || record.status !== 'accepted' || !record.users.includes(userId)) {
    return fail('好友关系不存在');
  }
  db.friendships.splice(db.friendships.indexOf(record), 1);
  return { ok: true };
}

/** 列表:已确认好友、收到待处理、发出待处理。 */
export function listFriends(db, userId) {
  const usernameOf = (id) => db.users.find((u) => u.id === id)?.username ?? '(已注销)';
  const friends = [];
  const incoming = [];
  const outgoing = [];

  for (const record of db.friendships) {
    if (!record.users.includes(userId)) continue;
    const otherId = record.users[0] === userId ? record.users[1] : record.users[0];
    const other = { id: otherId, username: usernameOf(otherId) };
    if (record.status === 'accepted') {
      friends.push({ id: record.id, user: other, since: record.respondedAt ?? record.createdAt });
    } else if (record.requestedBy === userId) {
      outgoing.push({ id: record.id, to: other, createdAt: record.createdAt });
    } else {
      incoming.push({ id: record.id, from: other, createdAt: record.createdAt });
    }
  }

  return { friends, incoming, outgoing };
}
