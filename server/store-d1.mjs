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
    lastSeenAt: row.last_seen_at ?? undefined,
    avatar: row.avatar ?? undefined,
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

function chatMessageFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    content: row.content,
    createdAt: row.created_at,
  };
}

function inviteFromRow(row) {
  if (!row) return null;
  let params = null;
  if (row.params) {
    try {
      params = JSON.parse(row.params);
    } catch {
      params = null;
    }
  }
  return {
    id: row.id,
    fromUser: row.from_user,
    toUser: row.to_user,
    slug: row.slug,
    params,
    status: row.status,
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
          'INSERT INTO users (id, username, username_lower, pass_salt, pass_hash, created_at, avatar) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          user.id,
          user.username,
          user.username.toLowerCase(),
          user.passSalt,
          user.passHash,
          user.createdAt,
          user.avatar ?? null,
        )
        .run();
    },

    async updateUser(id, patch) {
      // patch 仅允许 username/avatar 两个对外可改字段;username 同步写 username_lower。
      const sets = [];
      const values = [];
      if (patch.username !== undefined) {
        sets.push('username = ?', 'username_lower = ?');
        values.push(patch.username, patch.username.toLowerCase());
      }
      if (patch.avatar !== undefined) {
        sets.push('avatar = ?');
        values.push(patch.avatar);
      }
      if (!sets.length) return;
      values.push(id);
      await d1
        .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...values)
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

    async insertChatMessage(record) {
      await d1
        .prepare(
          'INSERT INTO chat_messages (id, from_id, to_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(record.id, record.fromId, record.toId, record.content, record.createdAt)
        .run();
    },

    async listChatMessagesBetween(userA, userB, limit) {
      const { results } = await d1
        .prepare(
          `SELECT * FROM chat_messages
           WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
           ORDER BY rowid DESC LIMIT ?`,
        )
        .bind(userA, userB, userB, userA, limit)
        .all();
      return results.reverse().map(chatMessageFromRow);
    },

    async insertInvite(record) {
      await d1
        .prepare(
          'INSERT INTO game_invites (id, from_user, to_user, slug, params, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          record.id,
          record.fromUser,
          record.toUser,
          record.slug,
          record.params === null ? null : JSON.stringify(record.params),
          record.status,
          record.createdAt,
        )
        .run();
    },

    async getInvite(id) {
      const row = await d1.prepare('SELECT * FROM game_invites WHERE id = ?').bind(id).first();
      return inviteFromRow(row);
    },

    async listPendingInvitesFor(toUserId) {
      const { results } = await d1
        .prepare('SELECT * FROM game_invites WHERE to_user = ? AND status = ? ORDER BY rowid')
        .bind(toUserId, 'pending')
        .all();
      return results.map(inviteFromRow);
    },

    async updateInvite(id, patch) {
      if (patch.status === undefined) return;
      await d1
        .prepare('UPDATE game_invites SET status = ?, responded_at = ? WHERE id = ?')
        .bind(patch.status, patch.respondedAt ?? null, id)
        .run();
    },

    async updateLastSeen(userId, isoTime) {
      await d1.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(isoTime, userId).run();
    },
  };
}
