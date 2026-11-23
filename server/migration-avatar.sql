-- 2026-11-23 迁移:用户头像(存系统预设编号,如 av1;NULL = 默认首字母头像)。
-- 仅适用于已按旧 schema.sql 建过 users 表的库(本地与远程各执行一次,加 --remote 跑远程):
--   wrangler d1 execute gamedock --file ./server/migration-avatar.sql            (本地)
--   wrangler d1 execute gamedock --file ./server/migration-avatar.sql --remote   (远程)
-- 新建库直接跑 schema.sql(已含该列),不要再执行本文件(重复加列会报 duplicate column)。
ALTER TABLE users ADD COLUMN avatar TEXT;
