# GameDock

GameDock([gamedock.cn](https://gamedock.cn))——网页游戏平台:游戏库 + 账号 + 好友社交(个人学习项目)。游戏以跨源 iframe 运行在独立内容域 `games.gamedock.cn`,平台层不做联机。部署在 Cloudflare Workers(D1 存用户/好友,KV 存玩家存档,R2 存游戏静态资源)。

## 文档

- [docs/product.md](./docs/product.md):产品需求——用户可见行为的唯一来源(范围、展示原则、账号/好友/存档、浏览与启动、可访问性、验收标准)。
- [docs/tech.md](./docs/tech.md):技术要求——技术栈、域名与部署形态、路由与启动安全、数据结构、身份会话、测试清单。
- [docs/multiplayer.md](./docs/multiplayer.md):联机边界——平台不做联机,只做好友邀请(信息传递)与身份凭证。
- 跨项目平台接缝契约（身份凭证/邀请深链/用户资料/postMessage）:**`../docs/platform-seam.md`**（工作区 docs/，不入库，两侧文档互认的接口定义，修改须双侧同步）。

## 工作流

- 平台发布:`npm run deploy`(构建 + wrangler deploy;构建产物不含游戏文件)。
- 游戏发布:在游戏仓库构建 → `node scripts/sync-games.mjs`(上传 R2,`--local` 喂本地模拟);平台无需重新部署。
- 新增游戏:`server/games.config.json` 声明产物目录 + `src/data/games.json` 加数据,不改平台代码。
- 本地开发:`npm run dev`(wrangler dev 端口 8787 + vite 5173);游戏首次需 `node scripts/sync-games.mjs --local`。

## 约定

- 产品行为以 product.md 为准,工程实现以 tech.md 为准;同一规则不在两处写成不同结果。
- 平台不做联机:不加大厅、房间、匹配、对战中转;web-bvn 的 `server/room-server.mjs` 是游戏自有联机服务器,不迁入平台。
- 决策与"为什么"记录在对应文档里;变更历史查 git,不维护变更日志文件。
