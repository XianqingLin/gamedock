# 小林游戏铺：联机协议基线（控制层房间 + 中继层字节管道）

本文是 web-bvn 接入平台的联机协议契约，也是后续所有联机游戏的统一基线。核心决定（2026-11）：

- **平台是唯一权威**，承担通用对战中转；平台只解析"控制层"，不解析游戏内容。
- **房间是原语**。邀请好友、随机匹配、排位赛、（未来的）房间列表都只是"入房入口"，终态统一为：玩家进入房间、持短时效凭证连接 WS 中转。
- web-bvn 的在线功能只保留一个"在线联机"入口，匹配/邀请 UI 全部在平台外边框；web-bvn 自身的 `server/room-server.mjs` 退役为参考实现，其游戏语义（hello/start/pick/input/hash）移入游戏 payload。

标注约定：**[已实现]** 表示当前代码已交付且经过验证；**[待实现]** 表示本文定义契约、代码尚未实现，是 bvn 迁移的工作范围；**[预留]** 表示只定数据结构/消息位、不实现功能。

## 0. 分层原则

```
┌─ 平台外边框（平台 UI 层）────────────────────────┐
│  匹配面板 / 好友邀请 / 房间视图 / 战绩（控制层消费者）│
├─ 平台服务器 ────────────────────────────────────┤
│  控制层：房间 REST、好友、匹配器、排位记账、凭证签发  │ ← 平台定义并解析
│  中继层：/api/relay WS，字节管道 {v,t,ch,payload}   │ ← 不解析 payload
├─ 游戏 iframe ───────────────────────────────────┤
│  game-sdk：saves / rooms / relay / postMessage     │
│  游戏玩法内核（bvn：选人、帧同步、判定）             │ ← payload 协议游戏自定义
└─────────────────────────────────────────────────┘
```

- **控制层**消息平台完全理解：建房/入房/退房/邀请/匹配/凭证/成员事件。排位、好友、战绩记账都挂在这一层。
- **中继层**：房间建立后，成员间的 `{t:'data'}` 消息平台原样转发，`payload` 由游戏自定义（含游戏侧自己的协议版本号）。房间标题等展示元数据是通用字段，由控制层携带，不算解析游戏内容。

## 1. 房间模型 **[已实现，visibility 为预留]**

实现在 `server/rooms.mjs`（纯内存，重启即散——房间是临时态，不进 db.json）。

| 字段 | 现状 | 说明 |
|---|---|---|
| `id` | 已实现 | UUID，REST 与凭证使用 |
| `code` | 已实现 | 6 位数字房间码，自助加入用 |
| `slug` | 已实现 | 所属游戏 |
| `maxPlayers` | 已实现 | 2–8，默认 2（bvn 为 1v1，用默认值） |
| `hostId` | 已实现 | host 离开（主动或断线超时）→ 整屋解散 |
| `players` | 已实现 | `host / guest / spectator` 三种角色；成员断线保留槽位 60s（重连窗口）；每人同时最多持有 3 个房间；房间最长存活 2h |
| `visibility` | **[预留]** | `'private' \| 'public'`，默认 `private`。bvn 只用私有房；公开房 + 列表查询接口留到第二款联机游戏再加，先定结构避免日后迁移 |
| `state` | **[预留]** | `'lobby' \| 'playing'`，供未来房间列表展示"游戏中勿扰" |

当前缺省即等价于 `visibility: 'private'`：房间只有拿到房间码或收到邀请才能进，不进任何列表。

## 2. 已实现契约

### 2.1 房间 REST（`server/api.mjs`，需登录会话）

| 接口 | 入参 | 返回 |
|---|---|---|
| `POST /api/rooms` | `{ slug, maxPlayers? }` | `{ room, credential }`（role: host） |
| `POST /api/rooms/join` | `{ code, asSpectator? }` | `{ room, credential, rejoined? }`（同房重入幂等复用槽位） |
| `POST /api/rooms/:id/leave` | — | `{ closed }`（host 离开 → 解散） |
| `GET /api/rooms/:id` | — | `{ room }`（仅成员可看） |

### 2.2 中转凭证（`server/relay-credential.mjs`）

- HMAC-SHA256 签名的短时效 token：`base64url(payload).base64url(hmac)`。
- payload：`{ roomId, playerId, role, exp, purpose: 'xlp-relay-v1' }`；TTL 600 秒。
- 中转器验签放行、**不查库**；`purpose` 隔离用途，防止会话签名密钥被复用伪造其他 HMAC 场景。
- 凭证过期后重新走房间 REST 换新（见 §4.1 的统一签发端点）。

### 2.3 WS 中转 `/api/relay`（`server/relay.mjs`）

信封 `{ v: 1, t, ch?, payload? }`，JSON 文本帧，单条上限 64KB。

**客户端 → 服务端**

| t | 字段 | 说明 |
|---|---|---|
| `hello` | `credential` | 首条消息必须认证，5 秒未完成断开 |
| `leave` | — | 主动离房并断开（host → 解散广播） |
| `data` | `ch`, `payload` | 游戏数据，广播给同房其他成员；`ch` 限 `^[a-z0-9-]{1,16}$` |

**服务端 → 客户端**

| t | 字段 | 说明 |
|---|---|---|
| `ready` | `you`, `room`, `reconnected` | 认证完成；`reconnected=true` 表示重连（host 依此恢复对局状态） |
| `peer-joined` / `peer-reconnected` | `player` | 成员首次出现 / 重连窗口内回归 |
| `peer-left` | `playerId`, `reason` | `reason: 'leave'` 移除槽位；`'disconnect'` 仅标记断线（进重连窗口） |
| `room-closed` | `roomId` | 解散（host 离开、清空、超龄） |
| `data` | `ch`, `payload`, `from`, `role` | 转发的游戏数据 |
| `error` | `code`, `message` | `auth / no-room / rate / bad-message` |

- 限流：每连接 50 msg/s（突发 100），超发丢弃，严重超发断开（4008）。
- 关闭码：4001 凭证无效，4002 认证超时，4003 房间不存在/解散，4008 严重超发。
- 断线不清槽位：靠房间服务的重连窗口 + 短时效凭证重连。

### 2.4 game-sdk（`packages/game-sdk`）

- `connectXlp()` 握手：外边框发 `platform:hello {v, t, slug, user}`，游戏回 `game:ready`；1.5s 未收到 hello 进入 standalone 模式（各 API 异步抛 `XlpError`，游戏单机逻辑不受影响）。
- `sdk.rooms.*`：上述房间 REST 的封装（`create / join / leave / get`）。
- `sdk.relay.connect(credential)`：建立 WS 连接，`ready` 后 resolve；`RelayConnection` 提供 `onData / onPeers / onEvent / onStatus / send(ch, payload) / leave() / close()`，本地维护房间视图随成员事件更新。
- `sdk.saves.*`：存档走平台（与联机无关，列入仅为完整性）。

## 3. 中继层：游戏自定义通道约定 **[bvn 迁移时实现]**

`ch` 是将来限流/统计的单位，命名空间约定：

- 保留前缀 `xlp-` 归平台将来使用，游戏不得占用。
- bvn 通道规划（原 `room-server.mjs` 语义的映射，payload 细节迁移时定）：

| 原 room-server 消息 | 迁移后 | 说明 |
|---|---|---|
| `hello` / `start` | `ch:'hello'` / `ch:'start'` | 就绪宣告与开局，host 收齐双方 hello 后发 start；平台不参与 |
| `pick` | `ch:'pick'` | 角色选择（发生在 `ready` 之后，属于玩法语义） |
| `input` | `ch:'input'` | 帧输入（最高频，将来限流策略按通道区分的原因） |
| `hash` | `ch:'hash'` | 帧一致性校验 |
| `peer-lost` | — | 由控制层 `peer-left`（connected=false）取代，SDK `onPeers` 已上抛 |

游戏 payload 内自带自己的协议版本与消息语义；平台对 payload 不做任何校验以外的处理。

## 4. 控制层扩展 **[待实现]**（bvn 迁移工作范围）

### 4.1 凭证统一签发端点

`POST /api/rooms/:id/credential` → `{ credential }`（需登录且为该房成员，按成员现角色重签）。

- `rooms.create / join` 返回凭证保留为便利封装；一切续签走本端点。
- 匹配成功通知与凭证获取因此解耦：外边框可以 postMessage 通知游戏"匹配成功"，凭证始终只经登录用户自己的会话获取，不经第三方转手。
- 断线重连、凭证 10 分钟过期续签都依赖此端点（当前 SDK 尚无续签途径，属于必补项）。

### 4.2 好友邀请入房

1. `POST /api/rooms/:id/invite { userId }` → 平台给目标玩家发邀请通知（复用好友关系，`server/friends.mjs` 已有好友请求/应答基础，邀请是新增通知类型）。
2. 被邀请方在大厅/通知面板接受 → `POST /api/rooms/join` 按房间信息入房（邀请场景携带 `roomId` 直入，凭邀请记录授权而非房间码）。
3. 被邀请方若正在游戏中（iframe 运行 bvn），外边框先 postMessage `platform:invite` 询问，游戏弹确认后由外边框执行入房流程（见 §5）。

### 4.3 匹配器（随机匹配 / 排位）

- `POST /api/match/queue { slug, mode: 'casual' | 'ranked' }` → 挂起排队；`DELETE /api/match/queue` 取消。
- 匹配器自动创建/填充房间（casual 先到先配；ranked 按段位加权，段位记账见 §4.4）。
- 成功即"双方被放入同一房间"，各自按 §4.1 拿凭证连 WS。排队状态轮询 `GET /api/match/status`（v1 用轮询，不做长连接推送）。
- 匹配器创建的房间对玩家同样透明：游戏侧感知不到自己走的是邀请还是匹配。

### 4.4 排位记账 **[后续，随排位模式实现]**

- 对局结束由游戏上报：`POST /api/match/:roomId/result { winnerPlayerId, reason }`。v1 信任会话内自报；后续可升级为双方签名确认。
- 平台据此记段位/战绩；报表与段位展示在平台外边框。

### 4.5 房间列表 **[预留不实现]**

数据结构见 §1（`visibility` / `state`）。列表 UI 与 `GET /api/rooms?slug=…&visibility=public` 留到有第二款联机游戏时再做——bvn 用不到公开列表，先实现即是死代码；结构现在定对，将来是纯增量。

## 5. postMessage 生命周期（游戏 iframe ↔ 平台外边框）

信封沿用 `{ v: 1, t, ... }`，`platform:` 前缀归外边框→游戏，`game:` 前缀归游戏→外边框（`connectXlp` 已按前缀过滤）。

| 消息 | 方向 | 状态 | 说明 |
|---|---|---|---|
| `game:ready` | 游戏→平台 | **[已实现]** | 握手应答 |
| `platform:hello` | 平台→游戏 | **[已实现]** | 握手：slug + 登录用户 |
| `game:open-matchmaker` | 游戏→平台 | **[待实现]** | 游戏菜单点"在线联机"后发出；外边框弹出匹配面板（邀请好友/随机/排位）。游戏随后自渲染等待场景，状态由后续消息驱动 |
| `game:cancel-matchmaker` | 游戏→平台 | **[待实现]** | 游戏侧取消（回菜单等），外边框收面板并 `DELETE /api/match/queue` |
| `platform:match-found` | 平台→游戏 | **[待实现]** | 匹配/邀请成功：`{ roomId, slug }`（不含凭证）。游戏自行 SDK 调 §4.1 端点拿凭证连 WS |
| `platform:invite` | 平台→游戏 | **[待实现]** | 被邀请加入对局：`{ roomId, slug, fromUser }`。游戏弹确认（如正在单机对局中），结果由游戏发 `game:invite-accepted / game:invite-declined` |
| `platform:match-ended` | 平台→游戏 | **[待实现]** | 平台侧终结（房间解散/对方离开且不再等待），游戏收尾回菜单。对局内的成员事件仍走中继层 `peer-left / room-closed` |

### 5.1 bvn 完整时序

```
BVN 菜单"在线联机"
  → game:open-matchmaker
  → 外边框匹配面板（邀请好友 / 随机匹配 / 排位赛）
  → [随机/排位] 外边框 POST /api/match/queue，面板显示排队中
  → [邀请] 外边框建房 + 发邀请；对方在大厅接受
  → 匹配成功：外边框 → platform:match-found { roomId }
  → BVN：POST /api/rooms/:id/credential → relay.connect(credential)
  → WS ready（选人 ch:'pick' → 开局 ch:'start' → 对战 ch:'input'/'hash'）
  → 对局结束：POST /api/match/:roomId/result（排位模式）→ 外边框展示战绩
  → 任一方掉线/离开：控制层 peer-left / room-closed，BVN 弹结算回菜单
```

游戏侧全部动作只经由 game-sdk（REST + WS + postMessage），不直接触碰平台内部。

## 6. bvn 迁移对照表

| web-bvn `room-server.mjs`（参考实现，退役） | 去向 |
|---|---|
| `create` / `join` / `welcome` | 平台房间 REST（§2.1）+ WS `ready` |
| 房间槽位、满员、房主语义 | `server/rooms.mjs`（已迁，角色 host/guest/spectator） |
| `peer-lost` | 控制层 `peer-left`（重连窗口语义更强） |
| `hello` / `start` / `pick` / `input` / `hash` | 游戏中继层通道（§3），骨架语义不迁——平台保持无游戏语义 |
| 凭证/鉴权 | `relay-credential.mjs`（已迁） |
