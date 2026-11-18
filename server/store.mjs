/**
 * 用户/好友存储接口(业务模块 auth.mjs/friends.mjs 面向此接口,不感知具体存储)。
 *
 * 每个实现需提供以下异步方法:
 * - getUserById(id) → user | null
 * - getUserByUsernameLower(lower) → user | null
 * - insertUser(user)
 * - getFriendship(id) → record | null
 * - getFriendshipBetween(userAId, userBId) → record | null
 * - listFriendshipsFor(userId) → [record]
 * - insertFriendship(record)
 * - updateFriendship(id, patch)   // { status?, respondedAt? }
 * - deleteFriendship(id)
 *
 * user 形状:{ id, username, passSalt, passHash, createdAt }
 * friendship 形状:{ id, users:[aId,bId](升序), status:'pending'|'accepted', requestedBy, createdAt, respondedAt? }
 *
 * 本文件提供内存实现:测试与纯内存场景用;线上见 store-d1.mjs(D1)。
 */
export function createMemoryStore() {
  const db = { users: [], friendships: [] };

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
  };
}
