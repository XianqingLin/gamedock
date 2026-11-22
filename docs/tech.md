# GameDock:技术实现要求

工程、数据、部署、安全与测试要求。用户可见行为以[product.md](./product.md)为准,联机边界见[multiplayer.md](./multiplayer.md)。

## 1. 技术栈

- 前端:Vite + React + TypeScript + React Router,普通 CSS;测试用 Vitest + React Testing Library。
- 后端:Cloudflare Workers(`server/worker.mjs` + `wrangler.jsonc`),业务模块面向存储接口编程。
- 存储:D1(用户/好友)、KV(玩家存档)、R2(游戏静态资源,bucket `gamedock-games`)。
- 本地开发:`wrangler dev`(本地模拟 D1/KV/R2)+ vite 代理;测试向业务模块注入内存/fs 实现。

不为简单功能提前搭无关后端,不引入只解决假想需求的大型依赖,不加无实际作用的抽象层。

## 2. 域名与部署形态

- 主域 `gamedock.cn` / `www`:Static Assets 托管 SPA;`/api/*` 业务 API;`/g/*` 生产 301 到内容域。
- 内容域 `games.gamedock.cn`:R2 托管游戏静态资源,key `g/<slug>/<路径>` 与 URL 一一对应;目录路径回退 `index.html`。
- 会话 Cookie 为 host-only + SameSite=Lax(生产 Secure),不进游戏域;`/api` CORS 仅放行内容域与请求自身源(带凭据)。
- 平台发布 = `npm run deploy`;游戏发布 = `node scripts/sync-games.mjs`(`--local` 喂本地模拟)。平台构建不接触游戏产物;sync 先传普通文件、最后写各游戏 `index.html`。
- 本地 dev 陷阱:`wrangler dev` 配置自定义域后会把请求 URL 的 host 重写为第一个自定义域,生产判定以 https 协议为准,游戏域分支靠单测覆盖。

## 3. 路由与启动

- `/` 探索页(精选轮播);`/browse` 浏览页(游戏目录);`/games/:slug` 详情(刷新恢复、前进后退);`/play/:slug` 运行页(详情页经 `window.open` 新窗口打开,不在站内路由跳转);其余路由显示未找到 + 返回首页。
- 关闭详情或筛选失效时同步清理详情路由,避免 URL 指向已取消的选择。
- 启动安全:外链仅 http(s),`javascript:`/`data:` 等按无效地址处理,不执行;新窗口带 `noopener`/`noreferrer`;无效启动不产生空白路由或空白窗口;启动失败不破坏浏览状态。
- postMessage 接口:信封带版本号,`platform:`/`game:` 前缀;双方校验来源(`event.source` + `event.origin`,预期为 iframe 自身源);握手时序双方兜底(平台先发 hello,游戏可请求重发);登录态未确认不挂 iframe,加载后才就绪时重发 hello 补发用户。游戏可经 SDK `reportViewport` 发 `game:viewport`(正数宽高,非法上报忽略),平台据此信箱式收紧 iframe 比例;未上报时用 games.json `aspectRatio` 兜底,两者皆无则填满可用区域。

## 4. 游戏数据

- 单一数据源 `src/data/games.json`,游戏库/列表/详情共用。结构:`{ id, slug, title, cover, accentColor, categories[], topic?, releaseDate?, description?, launchUrl?, aspectRatio?, status, version?, order }`(`status: 'available' | 'coming-soon' | 'maintenance'`)。专题标签字典在 `src/data/topics.json`(经典复刻、AI 创作),标签值只能来自字典。
- `id`/`slug` 唯一稳定,不用数组下标当标识;按 `order` 升序、相同按 `id`;可选字段缺省时不渲染空标签;在线人数无真实来源就不展示。
- 新增游戏 = `server/games.config.json` 声明产物目录 + games.json 加数据,不改平台代码;存档等接口的 slug 校验与游戏数据一致。
- 演示数据只用于开发测试;封面失败回退本地默认图。

## 5. 身份与会话

- 注册/登录/登出/me 按真实方案实现;密码 PBKDF2-SHA256 加盐哈希,不存不传明文;凭据不写入本地存储、日志或游戏数据。
- 会话为无状态签名 Cookie(HMAC-SHA256,httpOnly + SameSite=Lax,host-only);密钥经 secret 注入不入库;过期或签名非法按未登录处理。
- 至少区分加载中/未登录/已登录/错误状态,身份未确认不默认按已登录处理。
- 存储接口双实现:内存/fs 供测试,D1/KV 供线上,业务代码只面向接口。

## 6. 组件与状态

- 按职责拆分页面、卡片、详情、搜索筛选、账号区、好友面板、运行页外边框与游戏帧;不为单款游戏写特殊分支。
- 应用采用常驻左侧栏 + 右侧工作区的两栏骨架;左侧栏承载品牌与单个「游戏」入口(指向探索页),右侧顶栏从左到右为返回按钮(层级式,顶级页面禁用)、搜索框、「探索/浏览」导航与好友、账号入口。侧栏与顶栏不使用分割线,与内容区同色相连。好友以右侧浮层按需打开,支持 Escape/遮罩关闭与焦点圈定,不挤压主内容;浏览器全屏只包含运行页主区域,左侧导航不进入全屏。
- 优先 React 内置状态与派生数据;搜索、排序、专题与分类筛选全部从同一数据源派生,不各存一套过滤逻辑;筛选与排序状态写入 URL,选中状态与路由协调,不各存一份冲突值。

## 7. 性能与故障隔离

- 静态资源缓存分层(2026-11-22):index.html 不缓存(永不进边缘缓存);`<slug>/assets/*` 为
  Vite 内容哈希块 → `max-age=31536000, immutable`(文件名即版本);其余游戏数据(baked/
  图集/音频)→ `max-age=86400`(发布后 ≤1 天收敛,与原 nginx `expires 1d` 同取舍)。
  边缘缓存用 Cache API(仅生产 worker 路径,`X-Cache: HIT/MISS` 可验收);带 If-None-Match
  的数据资产请求绕过边缘直连 R2 `head()` 协商——边缘不得拿旧 ETag 回 304,否则更新永不到达。
  按需加载。
- 隔离资源错误:单个封面或文件失败不影响整个应用;正常运行无持续警告、重复报错或资源 404。

## 8. 可访问性

- 语义化控件与无障碍名称,不用裸 `div` 模拟交互;可见焦点、弹层焦点圈定与恢复;200% 缩放可用;状态不只靠颜色。

## 9. 测试与验证

测试至少覆盖:

- 搜索与分类组合筛选、专题筛选、排序方式、空结果与清除筛选、按 slug 查找、启动四态、外链协议校验与危险协议拦截、筛选排除选中项的清理、缺省封面回退。
- 注册/登录/登出/me 全流程(含错误密码、重复注册、会话伪造拒绝);好友全流程及无效操作;存档写读列删、slug 校验、大小上限、未登录拒绝。
- CORS:内容域放行(含 preflight)、自身源放行、第三方源拒绝。
- R2 静态资源服务:目录回退、Content-Type 推断、缓存策略、Range、路径穿越、未命中 404。
- Worker 路由分流:游戏域、主域重定向、本地 dev 直读、SPA 回退。
- 浏览、选择、详情、启动的集成测试。

完成后执行测试、类型检查与生产构建;桌面浏览器检查首页、注册登录、浏览启动、详情 URL 刷新与前进后退、200% 缩放、键盘与焦点。手机端不在验证范围。

## 10. 验收要点

- 可安装、启动、测试、构建;`npm run deploy` 可重复部署。
- 主域承载 SPA 与 API;游戏域承载游戏静态资源且跨源隔离;主域 `/g/*` 生产重定向。
- 游戏发布不触碰平台仓库,平台构建产物不含游戏文件。
- 存储层可替换(内存/fs ↔ D1/KV/R2),测试不依赖真实云资源。
- 无持续控制台错误、重复警告、资源 404 或可触发空白页的启动入口。
