# 小林游戏铺:开发日志

按时间倒序记录已完成的开发、关键决策与验证状态。**行为需求仍以 01/02 号文档为准**,本文件只做进度与决策追溯,新增条目写在最上方。

## 2026-11-16(五):平台通用对战中转 + 房间服务

### 已完成

**房间服务**(`server/rooms.mjs`,纯内存,重启即散,不进 db.json):

- REST(需登录):`POST /api/rooms` { slug, maxPlayers? } 建房(role: host)、`POST /api/rooms/join` { code, asSpectator? } 加入(6 位数字房间码;同人重入幂等复用槽位)、`POST /api/rooms/:id/leave`(host 离开→整屋解散)、`GET /api/rooms/:id`(仅成员)
- 限额:每人同时最多 3 房;maxPlayers 2-8(默认 2);观战席 10
- 生命周期:断线槽位保留 60s(重连窗口);host 槽位消失→解散;房间最长 2h;周期 sweep(15s)

**WS 中转**(`server/relay.mjs`,端点 `/api/relay`,唯一服务端依赖 `ws@8`):

- 凭证认证:首条消息必须 hello{credential},5s 超时断开;HMAC 凭证(`server/relay-credential.mjs`,payload `{roomId, playerId, role, exp, purpose}`,默认 10 分钟,验签不查库,timingSafeEqual)
- 信封 `{v, t, ch?, payload?}`:数据消息 t='data' 必须带 ch(通道,将来限流策略单位,`[a-z0-9-]{1,16}`)与 JSON payload(64KB 上限);控制消息:ready(含 you/room/reconnected)、peer-joined、peer-left(reason: leave/disconnect)、peer-reconnected、room-closed、error
- 路由:转发给房间内其他成员,附 from/role;平台不解析 payload
- 限流:令牌桶 50 msg/s(突发 100),超发丢弃,严重超发断开(4008)
- 断线广播 peer-left(disconnect)但不清槽位;REST 离开通过 ctx.relay.notifyLeave 广播;role 以房间记录为权威
- 关闭码:4001 凭证无效 / 4002 认证超时 / 4003 房间不存在 / 4008 超发;app close 时 terminate 所有 WS(否则 server.close 挂起)

**SDK 中转客户端**(`@xlp/game-sdk`,模块拆分为 errors/env/http/relay/index):

- `xlp.rooms.create/join/leave/get`(/api/rooms 封装,slug 默认取 hello);非法房间码本地拒绝
- `xlp.relay.connect(credential)` → Promise<RelayConnection>,**等 ready 才 resolve**(就绪前被关则 reject);RelayConnection:send(ch,payload)(本地校验 ch/payload)、onData、onPeers(本地维护 room 视图,随成员事件更新)、onEvent(room-closed/error 原样上抛)、onStatus、leave()、close()(仅断开,保留重连窗口);重连 = 同凭证再 connect,`reconnected` 标志供游戏恢复状态
- standalone 模式:rooms/relay/saves 全部异步抛 XlpError

### 已拍板的决策

1. tether 与 bvn 的联机统一收敛到平台中转:tether 的 server/index.ts(房间+转发)迁平台后删除,游戏协议(快照/输入/epoch)原样作为 payload 语义;host 权威在房主浏览器,与纯管道兼容;不保留双栈
2. 房间是临时态,纯内存;跨进程/重启不恢复
3. payload 仅 JSON(64KB);二进制/binary ch 策留待按 ch 限流策略时一起定

### 验证

- 平台 79/79(新增 relay.test.mjs 7 个:凭证往返/篡改/过期、REST 建房/满员/观战/解散、WS 认证拒绝/双向 data/REST 离开广播/断线重连/解散通知)
- SDK 17/17(新增 relay 客户端 9 个:REST 路径/本地校验/错误透传、ready 握手/双向 data/房间视图维护/room-closed/reject 路径/leave)
- 生产构建通过;真实服务端到端冒烟:两用户建房/加入 → 双 WS 客户端 hello→ready→双向 data(from/role 正确)→ 断线重连(reconnected=true + peer-reconnected)→ host 解散(room-closed + 4003)全通过
- 浏览器内完整链路待 tether 迁移时人工验证

### 测试踩坑记录

- 注释里 `peer-*/room-closed` 的 `*/` 会终止块注释导致 Vite 解析报错
- 用户名规则不含连字符,测试账号用下划线
- REST 离开后 socket close 会二次广播 peer-left——dropFromRoom 需检查成员仍在房间

## 2026-11-16(四):游戏侧 SDK `@xlp/game-sdk`(tether 落地)

### 已完成

**SDK 包**(`xiao-lin-game-shop/packages/game-sdk/`,零依赖 TS,tsc 产出 ESM dist + d.ts):

- `connectXlp(options?)`:与平台握手,永不 reject。iframe 内主动发 `game:ready` 请求 hello(解决加载时序竞争),默认 1500ms 超时进入 standalone;`window.parent === window`(非 iframe)直接 standalone
- 握手成功暴露:`user`(登录用户或 null)、`slug`(来自 hello)、`onPlatformMessage`(收 `platform:` 消息,校验信封+来源)、`send`(发 `game:` 消息自动补 v)
- `saves.list/get/put/remove`:封装 `/api/saves/<slug>/...`,`credentials: same-origin`;`get` 404 返回 null,其余非 2xx 抛 `XlpApiError`(带 status,文案为服务端原文);key 客户端先行校验
- standalone 模式:saves 方法异步抛 `XlpError`(必须是 async 抛,同步 throw 会绕过 await 链——测试抓到的坑)
- 测试:node:test + tsx + env 完整注入(不触碰浏览器全局),8 个测试全过(握手/超时/存档读写/非法 key/消息通道)

**平台侧配合改动**:

- hello 信封加 `slug`(游戏侧 SDK 用它拼 API 路径,免配置);`PlatformUser` 对齐为 `{id, username}`;hello 携带真实登录用户(PlayPage 从 auth 状态取)
- GameFrame 收到 `game:ready` 时重发 hello(时序双向兜底)

**tether 接入**(首款落地游戏):

- `@xlp/game-sdk` 以 `file:` 依赖引入;main.ts 启动即 `connectXlp()`,standalone(独立 dev)行为完全不变
- 新增平台存档 key `progress`:`{ lastLevel, completed[] }`;启动恢复上次选关,选关/通关时写回;standalone 或读档失败静默降级(console.warn)

### 验证

- SDK 8/8、平台 72/72、tether 12/12 测试全过;tether 与平台均通过生产构建
- 真实服务冒烟:注册→PUT/GET/LIST `/api/saves/tether-together/progress` 全通过,落盘结构 `saves/<userId>/<slug>/progress.json` 正确,tether 构建产物确认含 SDK 握手代码
- **浏览器内 iframe 握手 + 存档恢复的完整链路未人工验证**(需 `npm run dev` 手工确认)

### 契约备忘

- 游戏接平台 = 安装 `@xlp/game-sdk` + `connectXlp()`,不直接拼 `/api` URL、不自己写 postMessage
- hello 消息带 slug/user;存档值格式由游戏自定义(平台不解析)
- 中转客户端(联机凭证/对战管道)将作为 SDK 下一个能力加在同一连接上

## 2026-11-16(三):平台存档 API

### 已完成

- 接口(全部要求登录,401):
  - `GET /api/saves/:slug` → `{ slug, slots: [{ key, updatedAt, size }] }`(只给元数据不给值)
  - `GET /api/saves/:slug/:key` → `{ key, value, updatedAt }`,不存在 404
  - `PUT /api/saves/:slug/:key` body `{ value }` → `{ key, updatedAt, size }`,last-write-wins
  - `DELETE /api/saves/:slug/:key` → 幂等,不存在也 200
- slug 必须是 `server/games.config.json` 已接入的游戏(否则 404"未接入该游戏");key 限 `[a-zA-Z0-9_-]{1,64}`
- 存储 `server/saves.mjs`:文件落 `server/data/saves/<userId>/<slug>/<key>.json`(原子写),**不进 db.json**(存档体积大、重写频繁);value 对平台不透明,格式由游戏自定义
- 限额:单槽位值 256KB(可通过 config `saves.valueLimit` 调)、每游戏每用户最多 20 槽位(`saves.maxSlots`);`readJsonBody` 支持自定义上限,存档 PUT 用 320KB
- 路径安全:userId/slug/key 三段全部正则校验,无目录穿越;用户隔离靠目录结构

### 验证

- typecheck + **72 个测试全过**(新增 server/saves.test.mjs 6 个:401/未接入 slug/写读改删幂等/用户隔离/限额与非法 key/非法 body)
- 真实浏览器 + 游戏 iframe 内调用未验证(等 SDK 落地时一并验证)

### 契约备忘

- 游戏 iframe 内**不用 localStorage**(存档约定见 2026-11-16(一)),统一走平台存档 API;游戏本地 localStorage 只可作缓存
- SDK `@xlp/game-sdk` 将封装此 API(fetch + 同域 Cookie 自动携带),游戏不直接拼 URL

## 2026-11-16(二):账号体系 + 好友

### 已完成

**服务端**(零依赖,纯 Node 模块):

- 注册/登录/登出/当前用户:`POST /api/auth/register|login|logout`、`GET /api/auth/me`
- 好友:`GET /api/friends`、`POST /api/friends/requests`、`POST /api/friends/requests/:id/accept|decline`、`DELETE /api/friends/requests/:id`(取消)、`DELETE /api/friends/:id`(解除);全部要求登录(401)
- 密码:Node 内置 scrypt + 随机盐 + timingSafeEqual(`server/password.mjs`;生产可换 argon2,调用方不变)
- 会话:HMAC 无状态 Cookie(`server/session.mjs`),`HttpOnly + SameSite=Lax`,30 天,https 自动加 `Secure`;密钥自动生成落盘 `server/data/session-secret.key`(0600)
- 存储:JSON 文件原子写(`server/db.mjs`),`server/data/` 已 gitignore,`XLP_DATA_DIR` 可改址
- 服务入口重构为 `createApp(config)`(`server/index.mjs`),集成测试可在临时端口/临时数据目录启动

**前端**:

- 身份状态边界 `src/state/auth.tsx`:loading / guest / user / error 四态,错误不伪装成游客或已登录
- 登录/注册弹窗 `AuthDialog`(服务端错误原文展示)、好友面板 `FriendsPanel`、通用模态 `Modal`(焦点圈定/Escape/焦点恢复)
- 头部用户区 `UserArea` 挂在首页与游戏运行页外边框(好友 UI 在外边框,符合平台/游戏分工);游客点"好友"引导先登录

### 已拍板的决策(用户确认)

1. 注册字段:用户名+密码,无邮箱、无找回密码(后续再说)
2. 会话:httpOnly Cookie(同域部署下 iframe 内游戏请求自动携带)
3. 匿名游客可玩单机;存档/好友/联机要求登录
4. 密码 scrypt 哈希
5. 好友首版只有关系列表,无 presence 在线状态(等联机中转上线后 presence 免费)
6. 平台与游戏**同域部署**(一个 Node 服务同时供 `/`、`/g/<slug>/...`、`/api/...`)

### 已知边界

- 会话无状态签名,登出只清 Cookie,服务端不能吊销单个会话;需要"踢人"时加会话表
- JSON 文件存储为单进程同步写,换 SQLite 时 auth/friends 逻辑模块不动

### 验证

- typecheck + **66 个测试全过**(含 23 个服务端测试:注册校验、scrypt 往返、好友全流程、HTTP 集成测试走完整 Cookie 会话)
- 真实服务 curl 冒烟:注册→互加好友→登出全通过;重复注册/错误密码/未登录 401 正确;Cookie 确认 HttpOnly;db.json 无明文密码
- **未做浏览器人工验证**(用户执行 `npm run dev` 手工确认)

## 2026-11-16(一):列表模式 v1

### 已完成

- 技术栈:React 19 + Vite 7 + React Router 7 + Vitest/RTL + 纯 CSS;服务端纯 Node 单进程(端口 8787),dev 用 concurrently 双开(`npm run dev`)
- 首页 `/`:品牌、名称搜索(去空白+忽略大小写)、单选分类、封面网格;筛选状态写入 URL(`?q=&cat=`)
- 详情 `/games/:slug`:可分享可刷新;Escape/返回退出;slug 非法显示独立"未找到"
- 运行页 `/play/:slug`:外边框(返回/标题/全屏)+ 游戏 iframe + `platform:hello` postMessage 握手信封 v1(`src/lib/embed.ts`)
- 启动四态:开始游戏 / 未开放 / 维护中 / 暂不可启动(协议白名单拦截 `javascript:`、`//` 等)
- 服务端:`/api/games`、`/g/<slug>/...` 游戏静态资源(映射在 `server/games.config.json`,路径穿越已防护)、SPA 托管回退
- 游戏数据 manifest(`src/data/games.json` + `categories.json`,唯一数据源 `src/data/index.ts`):bvn(可用但暂不可启动——真实状态,无构建产物)、tether-together(可用,已接入)

### 架构契约(跨会话有效)

- 游戏静态资源走 `/g/<slug>/`,与平台 SPA 路由 `/games/:slug` 分离;**新增游戏 = games.config.json 加一条映射 + games.json 加一条数据,不改平台代码**
- 嵌入形态:iframe + postMessage 信封 v1 `{v, t}`,平台消息 `platform:` 前缀、游戏消息 `game:` 前缀;iframe `sandbox="allow-scripts allow-same-origin allow-pointer-lock"`
- **存档约定:游戏 iframe 内不用 localStorage(分区风险),走平台 API**
- web-tether-together 的 vite 配置已加 `base: './'`(iframe 子路径嵌入必需)并重新构建

### 验证

- 37 个测试全过 + 生产构建 + HTTP 冒烟(API/SPA 回退/tether 嵌入资源/穿越拦截)全通过
- tether 的 iframe 完整启动流程未在真实浏览器验证

## 后续路线(已与用户对齐)

1. **平台存档 API**(账号已就绪,存档挂 userId)
2. **游戏侧 SDK `@xlp/game-sdk`**(封装 postMessage 桥 + 中转客户端,先在 tether 落地验证再迁 bvn)
3. **平台通用对战中转**(方案 A:字节管道信封 `{t, ch, payload}`;HMAC 短时效凭证含 `roomId/playerId/role(host|guest|spectator)/exp`;中转验签不查库;通道 ch 作为平台限流策略单位;tether 的 `room-server.ts` 与 bvn 的 `room-server.mjs` 房间管理部分迁平台,游戏语义留游戏侧)
4. 3D 据点场景(推后,当前阶段不作为目标)
