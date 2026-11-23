-- GameDock D1 schema(用户 + 好友关系)。
-- 应用:wrangler d1 execute gamedock --file ./server/schema.sql(远程加 --remote)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
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

-- 平台聊天(当前仅 AI 助手「小舟AI」;user_id 为会话主人,peer_id 为对方)。
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_peer ON chat_messages (user_id, peer_id);
