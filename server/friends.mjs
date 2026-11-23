/**
 * 好友关系逻辑(存储接口见 store.mjs)。
 * 记录:{ id, users:[aId,bId](升序), status:'pending'|'accepted', requestedBy, createdAt, respondedAt? }
 */
import { TEST_USER, ensureTestUserFriend } from './bot.mjs';

export { TEST_USER };

const fail = (error) => ({ ok: false, error });

/**
 * 在线判定:轻量心跳来源(前端登录后周期性 POST /api/presence),
 * 最近 ONLINE_WINDOW_MS 内有心跳视为在线;无真实来源不编造在线状态。
 */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const time = Date.parse(lastSeenAt);
  return Number.isFinite(time) && Date.now() - time < ONLINE_WINDOW_MS;
}

export async function sendFriendRequest(store, userId, targetId) {
  if (typeof targetId !== 'string' || !targetId.trim()) {
    return fail('请输入要添加的用户 ID');
  }
  const target = await store.getUserById(targetId.trim());
  if (!target) return fail('找不到该用户');
  if (target.id === userId) return fail('不能添加自己为好友');

  const existing = await store.getFriendshipBetween(userId, target.id);
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
  await store.insertFriendship(record);
  return { ok: true, record };
}

async function findOwnRequest(store, userId, requestId) {
  const record = await store.getFriendship(requestId);
  if (!record || record.status !== 'pending' || !record.users.includes(userId)) return null;
  return record;
}

export async function respondToRequest(store, userId, requestId, accept) {
  const record = await findOwnRequest(store, userId, requestId);
  if (!record) return fail('请求不存在或已处理');
  if (record.requestedBy === userId) return fail('不能处理自己发出的请求');

  if (accept) {
    const respondedAt = new Date().toISOString();
    await store.updateFriendship(record.id, { status: 'accepted', respondedAt });
    return { ok: true, record: { ...record, status: 'accepted', respondedAt } };
  }
  await store.deleteFriendship(record.id);
  return { ok: true, record: null };
}

export async function cancelRequest(store, userId, requestId) {
  const record = await findOwnRequest(store, userId, requestId);
  if (!record || record.requestedBy !== userId) return fail('请求不存在或已处理');
  await store.deleteFriendship(record.id);
  return { ok: true, record: null };
}

export async function removeFriend(store, userId, friendshipId) {
  const record = await store.getFriendship(friendshipId);
  if (!record || record.status !== 'accepted' || !record.users.includes(userId)) {
    return fail('好友关系不存在');
  }
  const otherId = record.users[0] === userId ? record.users[1] : record.users[0];
  if (otherId === TEST_USER.id) return fail('测试用户不可删除');
  await store.deleteFriendship(record.id);
  return { ok: true };
}

/** 列表:当前用户自身状态 + 固定「测试用户」bot + 已确认好友、收到待处理、发出待处理。 */
export async function listFriends(store, userId) {
  // 幂等补建测试用户好友关系:存量用户首次打开面板时也能看到 bot(注册路径同样有兜底)。
  await ensureTestUserFriend(store, userId);
  const records = await store.listFriendshipsFor(userId);
  const self = await store.getUserById(userId);
  const me = {
    id: userId,
    username: self?.username ?? '(已注销)',
    online: isOnline(self?.lastSeenAt),
    avatar: self?.avatar ?? null,
  };
  const friends = [
    {
      id: TEST_USER.id,
      user: { id: TEST_USER.id, username: TEST_USER.username, online: true, avatar: TEST_USER.avatar },
      since: '',
      bot: true,
    },
  ];
  const incoming = [];
  const outgoing = [];

  for (const record of records) {
    const otherId = record.users[0] === userId ? record.users[1] : record.users[0];
    // 测试用户已作为固定首项输出,跳过其 friendship 记录,避免重复。
    if (otherId === TEST_USER.id) continue;
    const otherUser = await store.getUserById(otherId);
    const other = {
      id: otherId,
      username: otherUser?.username ?? '(已注销)',
      online: isOnline(otherUser?.lastSeenAt),
      avatar: otherUser?.avatar ?? null,
    };
    if (record.status === 'accepted') {
      friends.push({ id: record.id, user: other, since: record.respondedAt ?? record.createdAt });
    } else if (record.requestedBy === userId) {
      outgoing.push({ id: record.id, to: other, createdAt: record.createdAt });
    } else {
      incoming.push({ id: record.id, from: other, createdAt: record.createdAt });
    }
  }

  return { me, friends, incoming, outgoing };
}
