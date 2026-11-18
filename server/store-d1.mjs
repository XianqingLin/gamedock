/**
 * D1(Cloudflare SQLite)存储实现,接口见 store.mjs。
 * friendships.users 两列(user_a < user_b)对应内存实现的 users 数组;
 * 业务模块传来的 userAId/userBId 顺序不定,查询/写入前先排序。
 */

function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passSalt: row.pass_salt,
    passHash: row.pass_hash,
    createdAt: row.created_at,
  };
}

function friendshipFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    users: [row.user_a, row.user_b],
    status: row.status,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? undefined,
  };
}

export function createD1Store(d1) {
  return {
    async getUserById(id) {
      const row = await d1.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
      return userFromRow(row);
    },

    async getUserByUsernameLower(lower) {
      const row = await d1.prepare('SELECT * FROM users WHERE username_lower = ?').bind(lower).first();
      return userFromRow(row);
    },

    async insertUser(user) {
      await d1
        .prepare(
          'INSERT INTO users (id, username, username_lower, pass_salt, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(user.id, user.username, user.username.toLowerCase(), user.passSalt, user.passHash, user.createdAt)
        .run();
    },

    async getFriendship(id) {
      const row = await d1.prepare('SELECT * FROM friendships WHERE id = ?').bind(id).first();
      return friendshipFromRow(row);
    },

    async getFriendshipBetween(userAId, userBId) {
      const [a, b] = [userAId, userBId].sort();
      const row = await d1
        .prepare('SELECT * FROM friendships WHERE user_a = ? AND user_b = ?')
        .bind(a, b)
        .first();
      return friendshipFromRow(row);
    },

    async listFriendshipsFor(userId) {
      const { results } = await d1
        .prepare('SELECT * FROM friendships WHERE user_a = ? OR user_b = ?')
        .bind(userId, userId)
        .all();
      return results.map(friendshipFromRow);
    },

    async insertFriendship(record) {
      const [a, b] = [...record.users].sort();
      await d1
        .prepare(
          'INSERT INTO friendships (id, user_a, user_b, status, requested_by, created_at, responded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(record.id, a, b, record.status, record.requestedBy, record.createdAt, record.respondedAt ?? null)
        .run();
    },

    async updateFriendship(id, patch) {
      if (patch.status !== undefined && patch.respondedAt !== undefined) {
        await d1
          .prepare('UPDATE friendships SET status = ?, responded_at = ? WHERE id = ?')
          .bind(patch.status, patch.respondedAt, id)
          .run();
        return;
      }
      if (patch.status !== undefined) {
        await d1.prepare('UPDATE friendships SET status = ? WHERE id = ?').bind(patch.status, id).run();
      }
    },

    async deleteFriendship(id) {
      await d1.prepare('DELETE FROM friendships WHERE id = ?').bind(id).run();
    },
  };
}
