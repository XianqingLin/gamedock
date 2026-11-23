-- 2026-11-23 迁移:好友在线状态(轻量心跳)。
-- 仅适用于已按旧 schema.sql 建过 users 表的库(本地与远程各执行一次,加 --remote 跑远程):
--   wrangler d1 execute gamedock --file ./server/migration-presence.sql            (本地)
--   wrangler d1 execute gamedock --file ./server/migration-presence.sql --remote   (远程)
-- 新建库直接跑 schema.sql(已含该列),不要再执行本文件(重复加列会报 duplicate column)。
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
