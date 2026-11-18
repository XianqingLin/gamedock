# GameDock：联机边界（平台不管联机，只传邀请与身份）

本文取代旧版《联机协议基线（控制层房间 + 中继层字节管道）》（方案 A）。方案 A 已于 2026-11-16 作废，原文见 git 历史。

## 决定（2026-11-16，参考对象从 4399 改为 Steam）

平台对标 Steam 的"商店/库 + 账号/社交"层，**不提供任何联机服务**：不做大厅、房间、匹配、排位、对战中转、对战凭证、聊天室。每个游戏能不能联机、怎么联机（自建服务器 / P2P / 用不用房间服务器）是游戏自己的事，平台不感知也不参与。

平台保留的联机相关能力只有一个：**好友邀请（仅信息传递）**。

## 平台负责（邀请 + 身份）

1. **邀请的发出与展示**：游戏经 SDK/外边框请求"邀请好友 X 进当前游戏"，平台在好友列表/通知面板展示"XX 邀请你加入《游戏》"。
2. **把人带进游戏**：好友点击邀请 → 平台打开该游戏页面（iframe 外边框），把游戏自定义的邀请参数（如房间号）经 postMessage 交给游戏。
3. **可验证身份凭证**：平台签发"我是用户 X"的短时效凭证（对应 Steam `GetAuthSessionTicket`），由游戏或其自己的服务器向平台校验端点验证连入者身份；平台不参与连接的建立与传输。
4. **好友关系列表**（已实现基础版，无 presence）。

对应 Steam：邀请 ≈ Rich Presence / `+connect` 深链。Steam 的 SDR 字节管道中转属可选服务，对应本平台已砍掉的方案 A 部分，不提供。

## 游戏负责（一切联机实现）

- 建房、匹配、连接建立、数据传输、断线重连，全由游戏自己的服务器或客户端逻辑实现。
- 收到邀请参数后怎么用（弹确认、进房、等待）是游戏自己的逻辑；平台只在需要时提供确认 UI 的宿主。
- **web-bvn**：`server/room-server.mjs` 回归游戏自有联机服务器定位（当前头部仍标注"已退役·仅作参考"，待恢复）。
- **web-tether-together**：自托管 server 已在方案 A 迁移中删除，恢复方式待定。

## 待处置

按方案 A 已落地的代码，处置（回退 / 保留改造为游戏侧组件 / 归档）待定：

- 平台侧（2026-11-18 已随 Cloudflare Workers 迁移删除）：`server/rooms.mjs`、`server/relay.mjs`、`server/relay-credential.mjs`，SDK 的 `sdk.rooms.*` / `sdk.relay.*`（改名前称 `xlp.rooms.*` / `xlp.relay.*`）——如需恢复，从 git 历史找回。
- web-bvn：`packages/net/platform.ts`（RelaySocket 适配层）与 app 接线的平台入房改造。
- web-tether-together：`net/client.ts` 的 NetSession 平台化改造（其自托管 server 已删）。

## 保留不变的部分（与联机无关）

- 嵌入契约：iframe + postMessage 信封 v1 `{v, t}`，`platform:` / `game:` 前缀，`connectGameDock()` 握手（standalone 降级）。
- 存档走平台：`sdk.saves.*`，游戏 iframe 不用 localStorage 存档。
- 好友基础关系、账号会话：平台侧继续有效。
