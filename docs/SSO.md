# IT小爱 → 资盒网页免密认证

本文说明企业微信员工从 IT小爱进入资盒网页的免密流程。资盒是资产与权限的最终判断方；IT小爱负责先验证企业微信会话，并仅从后端调用资盒换票接口。员工不需要为免登单独创建资盒账号。

## 前置配置

资盒服务器 `/opt/asset-hub/.env`：

```dotenv
APP_ORIGIN=https://zchub.saybot.net
COOKIE_SECURE=true
IT_SERVICE_TOKEN=<双方约定的至少 32 位服务凭证>
```

IT小爱服务器的环境配置：

```dotenv
HAMSTER_SSO_TICKET_URL=https://zchub.saybot.net/api/sso/ticket
ASSET_HUB_SERVICE_TOKEN=<与资盒 IT_SERVICE_TOKEN 相同的凭证>
```

长期服务凭证只保存在双方服务器环境文件中，不放入网页、跳转地址、Git 仓库或日志。资盒须经 HTTPS 访问。员工的企业微信 UserID 须先同步到资盒员工资料且保持在职；姓名只用于展示，同名人员以 UserID 区分。

## 调用顺序

1. 员工在 IT小爱完成企业微信身份验证。IT小爱从已验证会话取得 UserID、姓名及可选部门，并检查该员工是否可使用免登入口。
2. IT小爱后端向资盒请求票据，不让浏览器直接持有服务凭证：

   ```http
   POST https://zchub.saybot.net/api/sso/ticket
   Authorization: Bearer <ASSET_HUB_SERVICE_TOKEN>
   X-WeCom-UserId: A0264
   X-WeCom-Name: %E5%BE%90%E6%89%8D%E5%AE%9D
   X-WeCom-Department: 326
   Content-Type: application/json

   {}
   ```

3. 资盒成功返回 HTTP 200、JSON：

   ```json
   {"loginUrl":"https://zchub.saybot.net/sso/consume?ticket=<一次性票据>","expiresIn":60}
   ```

4. IT小爱仅将 `loginUrl` 交给当前用户浏览器打开。资盒以 `GET /sso/consume?ticket=...` 核销票据，设置 `Secure; HttpOnly; SameSite=Lax` 的 `asset_session` Cookie，并以 HTTP 303 跳转到 `/`。地址栏不再保留票据。

票据 60 秒内有效且只能使用一次；核销和会话存在当前资盒服务进程内，服务重启后尚未核销的票据及已登录会话都会失效。网页会话最长 8 小时。IT小爱应在用户点击入口时即时换票，不要提前缓存 `loginUrl`。

## 权限规则

- 资盒以请求头中的企业微信 UserID 查找已同步、在职的员工；仅凭姓名不能换票。
- 普通员工进入资盒后，只能查看本人资产，不能维护台账或审批。
- 在资盒“设置 → 集成中心 → IT小爱管理员授权”中登记的 UserID，免登后拥有资盒管理员权限，可查看与管理全部资产。授权或撤销在每次网页请求时重新核对，撤销对已有会话立即生效。
- 若员工另外关联了启用的资盒本地账号，该账号的角色也可授予管理员权限；已停用的关联账号不能通过免登绕过停用限制。
- IT小爱的入口授权决定谁可发起换票；资盒依旧独立执行上述身份和权限检查。

## 返回码与排查

| 现象 | 含义及检查项 |
| --- | --- |
| 换票返回 401 `服务鉴权失败` | 未携带凭证，或双方服务凭证不一致。无凭证的 `curl` 返回 401 是正常现象。 |
| 换票返回 403 | 核对 `X-WeCom-UserId`、资盒员工资料是否已同步且在职，以及关联账号是否启用。姓名参数不能代替 UserID。 |
| 换票返回 503 | 检查资盒 `APP_ORIGIN` 是否配置为正式 HTTPS 地址；过量未核销票据也会暂时拒绝。 |
| 核销返回 400 | 票据已过期、已使用或资盒在换票后重启；从 IT小爱入口重新获取票据。 |
| 已进入资盒但只有本人资产 | 核对当前 UserID 是否在资盒“IT小爱管理员授权”列表中；更改授权后刷新网页。 |
| 跳转后仍显示登录页 | 核对 HTTPS、Cookie、浏览器是否接受 `Secure` Cookie，以及反向代理是否保持同域跳转。 |

发布后用普通员工和已授权管理员各测试一次，并分别检查手机企业微信、电脑企业微信。不要将真实服务凭证或完整 `loginUrl` 粘贴到工单或聊天中。反向代理的 `/sso/consume` 访问日志应省略或遮盖查询参数，避免记录一次性票据。
