-- 存量库迁移:游戏邀请一次性投递(2026-11-24,邀请票模型配套)。
-- 应用:wrangler d1 execute gamedock --file ./server/migrations/migration-invite-delivered.sql(远程加 --remote)
--
-- 背景:原「运行页可凭 ?invite= 任意状态重取参数(刷新恢复)」语义随 bvn 邀请票
-- 模型作废——游戏侧兑票/忽略后销票,平台重发会把已销的票复活(卡片死而复生)。
-- 改为一次性投递:运行页首次取参标记 delivered_at 并返回 params,之后再取 params 为 null;
-- 刷新恢复由游戏侧邀请票自持(票存 localStorage,TTL 内重进菜单仍显示)。

ALTER TABLE game_invites ADD COLUMN delivered_at TEXT;
