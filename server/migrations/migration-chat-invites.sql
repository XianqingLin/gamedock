-- 存量库迁移:好友聊天 + 游戏邀请(2026-11-23)。
-- 应用:wrangler d1 execute gamedock --file ./server/migrations/migration-chat-invites.sql(远程加 --remote)
--
-- 背景:聊天从「小舟AI」AI 助手会话(role user/assistant,单会话主人视角)
-- 改为好友间双向聊天(from_id/to_id 对等)。旧 AI 聊天数据无保留价值,直接重建表;
-- 新增好友邀请表 game_invites。

DROP TABLE IF EXISTS chat_messages;
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_pair ON chat_messages (from_id, to_id);

CREATE TABLE IF NOT EXISTS game_invites (
  id TEXT PRIMARY KEY,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  slug TEXT NOT NULL,
  params TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_game_invites_to ON game_invites (to_user, status);
