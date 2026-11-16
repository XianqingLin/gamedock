# 测试账号(本地开发)

平台级测试账号,用于联机/存档等需要登录态的手工验证。注册于 2026-11-16,存放在 `server/data/db.json`(该目录已 gitignore,只存在于本机;换机器或删库后需重新注册)。

| 用户名 | 密码 | 角色 | 用途 |
| --- | --- | --- | --- |
| `test_host` | `xlp-test-1234` | 房主 / 玩家 1 | 建房、1P 操作 |
| `test_guest` | `xlp-test-1234` | 客人 / 玩家 2 | 加入房间、2P 操作、刷新重连测试 |

## 使用方式

1. 启动平台:`npm run dev`(或 `npm run server`,端口 8787)。
2. 浏览器分别用两个账号登录(可用普通窗口 + 无痕窗口,或两个浏览器配置文件)。
3. 联机验证流程见 `../../web-tether-together/TESTING.md` 第 4-6 步;账号也可用于存档 API、好友等后续功能验证。

## 重新注册(库被清空时)

用户名规则:2-24 位字母、数字、下划线或中文(**不含连字符**);密码 6-128 位。

```bash
curl -X POST http://localhost:8787/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test_host","password":"xlp-test-1234"}'
curl -X POST http://localhost:8787/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test_guest","password":"xlp-test-1234"}'
```

仅限本地测试环境使用,不要用于任何部署环境。
