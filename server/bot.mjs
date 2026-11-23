/**
 * 内置「测试用户」bot(2026-11-23 起,取代原 AI 助手「小舟AI」):
 * 每个用户的好友列表固定含测试用户——不可删除、恒在线、给TA发消息自动回复。
 * bot 是真实 users 行(passSalt/passHash 为占位值,无法登录),与普通好友共用
 * friendships/chat_messages 存储,好友聊天链路因此有一个可自测的对话端。
 */

export const TEST_USER = { id: 'test-user', username: '测试用户', avatar: 'av0' };

/** 确保 bot 的 users 行存在(幂等;并发重复插入撞唯一约束时静默忽略)。 */
export async function ensureTestUser(store) {
  const existing = await store.getUserById(TEST_USER.id);
  if (existing) return existing;
  try {
    await store.insertUser({
      id: TEST_USER.id,
      username: TEST_USER.username,
      // 占位凭据:bot 不走登录,PBKDF2 校验必不通过。
      passSalt: 'bot',
      passHash: 'bot',
      createdAt: new Date().toISOString(),
      avatar: TEST_USER.avatar,
    });
  } catch (err) {
    if (!String(err?.message ?? '').includes('UNIQUE')) throw err;
  }
  return store.getUserById(TEST_USER.id);
}

/** 确保当前用户与测试用户的好友关系(已接受;幂等)。 */
export async function ensureTestUserFriend(store, userId) {
  if (userId === TEST_USER.id) return;
  await ensureTestUser(store);
  const existing = await store.getFriendshipBetween(userId, TEST_USER.id);
  if (existing) return;
  await store.insertFriendship({
    id: crypto.randomUUID(),
    users: [userId, TEST_USER.id].sort(),
    status: 'accepted',
    requestedBy: TEST_USER.id,
    createdAt: new Date().toISOString(),
    respondedAt: new Date().toISOString(),
  });
}
