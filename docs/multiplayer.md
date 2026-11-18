# GameDock:联机边界

平台对标 Steam 的"商店/库 + 账号/社交"层,**不提供任何联机服务**:不做大厅、房间、匹配、排位、对战中转、对战凭证、聊天室。每个游戏能不能联机、怎么联机(自建服务器 / P2P)是游戏自己的事,平台不感知也不参与。

平台保留的联机相关能力只有一个:**好友邀请(仅信息传递)**:

1. 邀请的发出与展示:游戏经 SDK 请求邀请好友,平台在好友列表/通知面板展示。
2. 把人带进游戏:点击邀请 → 打开游戏页(iframe 外边框),把游戏自定义参数(如房间号)经 postMessage 交给游戏。
3. 可验证身份凭证:平台签发短时效"我是用户 X"凭证(对应 Steam `GetAuthSessionTicket`),由游戏或其自有服务器向平台校验端点验证连入者身份;平台不参与连接的建立与传输。

对应 Steam:邀请 ≈ Rich Presence `+connect` 深链;Steam SDR 字节管道中转属可选服务,对应本平台不做的部分(曾经的"方案 A"平台中转架构已于 2026-11-16 作废、2026-11-18 删除残留,需恢复从 git 历史找回)。

## 游戏侧现状

- **web-bvn**:`server/room-server.mjs` 回归游戏自有联机服务器定位(标注"已退役·仅作参考",待恢复);`packages/net/platform.ts` 的平台中转适配残留待处置。
- **web-tether-together**:自托管 server 已在方案 A 迁移中删除,`net/client.ts` 的平台化改造残留待恢复或重写。

## 与联机无关、继续有效的契约

- 嵌入:iframe + postMessage 信封 v1 `{v, t}`,`platform:`/`game:` 前缀,`connectGameDock()` 握手(standalone 降级)。
- 存档走平台:`sdk.saves.*`,游戏 iframe 不用 localStorage 存档。
- 好友基础关系、账号会话:平台侧继续有效。
