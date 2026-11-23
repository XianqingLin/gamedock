/**
 * 用户/好友存储接口(业务模块 auth.mjs/friends.mjs 面向此接口,不感知具体存储)。
 *
 * 每个实现需提供以下异步方法:
 * - getUserById(id) → user | null
 * - getUserByUsernameLower(lower) → user | null
 * - insertUser(user)
 * - updateUser(id, patch)         // { username?, avatar? }
 * - getFriendship(id) → record | null
 * - getFriendshipBetween(userAId, userBId) → record | null
 * - listFriendshipsFor(userId) → [record]
 * - insertFriendship(record)
 * - updateFriendship(id, patch)   // { status?, respondedAt? }
 * - deleteFriendship(id)
 * - insertChatMessage(record)
 * - listChatMessagesBetween(userA, userB, limit) → [record](时间正序,最近 limit 条)
 * - insertInvite(record)
 * - getInvite(id) → record | null
 * - listPendingInvitesFor(toUserId) → [record](时间正序)
 * - updateInvite(id, patch)      // { status?, respondedAt? }
 * - updateLastSeen(userId, isoTime)
 *
 * user 形状:{ id, username, passSalt, passHash, createdAt, lastSeenAt?, avatar? }
 * friendship 形状:{ id, users:[aId,bId](升序), status:'pending'|'accepted', requestedBy, createdAt, respondedAt? }
 * chatMessage 形状:{ id, fromId, toId, content, createdAt }(好友间双向,各存一条)
 * invite 形状:{ id, fromUser, toUser, slug, params(object|null), status:'pending'|'accepted'|'declined', createdAt, respondedAt? }
 *
 * 本文件提供内存实现:测试与纯内存场景用;线上见 store-d1.mjs(D1)。
 */
export function createMemoryStore() {
  const db = { users: [], friendships: [], chatMessages: [], invites: [] };

  return {
    /** 测试用:直接查看底层数据。 */
    _db: db,

    async getUserById(id) {
      return db.users.find((u) => u.id === id) ?? null;
    },

    async getUserByUsernameLower(lower) {
      return db.users.find((u) => u.username.toLowerCase() === lower) ?? null;
    },

    async insertUser(user) {
      db.users.push(user);
    },

    async updateUser(id, patch) {
      const user = db.users.find((u) => u.id === id);
      if (!user) return;
      if (patch.username !== undefined) user.username = patch.username;
      if (patch.avatar !== undefined) user.avatar = patch.avatar;
    },

    async getFriendship(id) {
      return db.friendships.find((r) => r.id === id) ?? null;
    },

    async getFriendshipBetween(userAId, userBId) {
      return (
        db.friendships.find((r) => r.users.includes(userAId) && r.users.includes(userBId)) ?? null
      );
    },

    async listFriendshipsFor(userId) {
      return db.friendships.filter((r) => r.users.includes(userId));
    },

    async insertFriendship(record) {
      db.friendships.push(record);
    },

    async updateFriendship(id, patch) {
      const record = db.friendships.find((r) => r.id === id);
      if (record) Object.assign(record, patch);
    },

    async deleteFriendship(id) {
      const index = db.friendships.findIndex((r) => r.id === id);
      if (index !== -1) db.friendships.splice(index, 1);
    },

    async insertChatMessage(record) {
      db.chatMessages.push(record);
    },

    async listChatMessagesBetween(userA, userB, limit) {
      const rows = db.chatMessages.filter(
        (m) => (m.fromId === userA && m.toId === userB) || (m.fromId === userB && m.toId === userA),
      );
      return rows.slice(-limit);
    },

    async insertInvite(record) {
      db.invites.push(record);
    },

    async getInvite(id) {
      return db.invites.find((r) => r.id === id) ?? null;
    },

    async listPendingInvitesFor(toUserId) {
      return db.invites.filter((r) => r.toUser === toUserId && r.status === 'pending');
    },

    async updateInvite(id, patch) {
      const record = db.invites.find((r) => r.id === id);
      if (record) Object.assign(record, patch);
    },

    async updateLastSeen(userId, isoTime) {
      const user = db.users.find((u) => u.id === userId);
      if (user) user.lastSeenAt = isoTime;
    },
  };
}
