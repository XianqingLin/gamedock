-- GameDock D1 schema(用户 + 好友关系)。
-- 应用:wrangler d1 execute gamedock --file ./server/schema.sql(远程加 --remote)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  avatar TEXT
);

-- 内存实现里 users 是升序数组;D1 用 user_a < user_b 两列表达同一语义。
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  responded_at TEXT,
  CHECK (user_a < user_b)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON friendships (user_a);
CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON friendships (user_b);

-- 平台聊天(2026-11-23 起:好友间双向聊天;from_id/to_id 各存一条,对等)。
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_pair ON chat_messages (from_id, to_id);

-- 好友邀请(仅信息传递;params 为游戏自定义参数的 JSON 序列化,平台不解析)。
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
