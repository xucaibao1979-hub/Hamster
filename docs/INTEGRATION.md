# IT小爱 / 企业微信接入

网页登录免密流程、管理员授权及故障排查另见 [免密认证使用手册](SSO.md)。

资盒是资产主数据源。IT小爱后端应先验证企业微信会话，从可信身份取得 UserID 与姓名，然后在服务端调用资盒接口。浏览器传来的姓名、UserID 或 `/api/integration/me` 的查询参数不能作为查询他人资产的权限依据。

## IT小爱跳转资盒网页免登

IT小爱后端在完成自己的企业微信身份验证与入口授权后，调用资盒换票接口。资盒 `.env` 必须配置 `APP_ORIGIN=https://zchub.saybot.net` 和与现有集成接口相同的 `IT_SERVICE_TOKEN`（至少 32 位）。员工应先经通讯录同步至资盒，保持在职并绑定企业微信 UserID；只传姓名不能免登。

```http
POST https://zchub.saybot.net/api/sso/ticket
Authorization: Bearer <IT_SERVICE_TOKEN>
X-WeCom-UserId: A0264
X-WeCom-Name: %E5%BE%90%E6%89%8D%E5%AE%9D
X-WeCom-Department: 326
Content-Type: application/json

{}
```

成功时返回 HTTP 200：

```json
{"loginUrl":"https://zchub.saybot.net/sso/consume?ticket=<一次性票据>","expiresIn":60}
```

IT小爱把 `loginUrl` 交给当前用户的企业微信内置浏览器或电脑浏览器打开。`GET /sso/consume?ticket=...` 会原子核销票据，写入 `Secure; HttpOnly; SameSite=Lax` 网页会话 Cookie，并以 HTTP 303 跳转到 `/`，从地址栏移除票据。票据有效期 60 秒且只能使用一次；服务器重启后未兑换票据失效。资盒不返回 HTTP 重定向作为换票响应。

无效服务凭证返回 401；未登记、停用的 UserID 或其关联账号已停用返回 403；其他失败以包含 `error` 的 JSON 返回。服务端依据 UserID 对应的资盒员工记录决定身份，姓名和部门请求头只作辅助信息。资盒“集成中心”内已授权的企业微信管理员进入网页时拥有资盒管理员权限；普通在职员工仅能查看本人资产。若员工关联了本地登录账号，该账号的角色仍可授予管理员权限。管理员授权和撤销在每次网页请求时重新核对，撤销后已有会话立即失去管理员权限。

IT小爱服务器配置 `HAMSTER_SSO_TICKET_URL=https://zchub.saybot.net/api/sso/ticket`，请求头的长期凭证仅放服务端，不能写入网页或跳转 URL。请将反向代理对 `/sso/consume` 的访问日志配置为不记录查询参数，以免日志留存一次性票据。资盒网页登录须走 HTTPS；手机和电脑企业微信均需分别联调 Cookie 与跳转。

资产附件、字段类型配置、时长提醒和本地审批快捷撤销均由资盒管理员网页管理；本次升级不改变 `/api/integration/*` 的请求参数、服务凭证、员工身份校验和审批规则。快捷撤销仅对资盒网页完成的本地审批开放，IT小爱审批继续沿用原接口与流程。

## 服务配置与请求头

在资盒 `.env` 设置至少 32 位随机 `IT_SERVICE_TOKEN`，通过安全渠道配置到 IT小爱后端。请求应携带：

```http
Authorization: Bearer <IT_SERVICE_TOKEN>
X-WeCom-UserId: <已验证的企业微信 UserID>
X-WeCom-Name: <URL 编码后的企业微信姓名>
Content-Type: application/json
```

需要审批的企业微信管理员在资盒“集成中心”授权 UserID。员工无需分别创建资盒登录账号。重名员工依靠 UserID 区分；姓名匹配旧台账仅在通讯录内姓名唯一且资产没有稳定身份关联时生效。

## 主要接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/integration/identity` | 获取当前可信身份和管理员权限 |
| `GET /api/integration/me` | 查询当前员工名下资产；`received` 与 `receiveDate` 均表示领用日期 |
| `GET /api/integration/lookup?number=...` 或 `?serial=...` | 按编号或序列号精确查询已有资产，返回 `claimable` 和 `claimBlockedReason` |
| `GET /api/integration/requests` | 查询当前员工相关申请 |
| `POST /api/integration/request` | 创建领用、归还、转让申请或确认接收 |
| `GET /api/integration/admin/requests` | 管理员查看待处理申请 |
| `POST /api/integration/admin/decision` | 管理员批准或拒绝 |

写请求须带唯一 `Idempotency-Key`，相同操作重试沿用同一个键。典型领用请求：

```json
{"kind":"领用","assetId":"从 lookup 响应取得的资产 id","reason":"办公领用"}
```

资产编号和序列号用于查找；领用写接口以 `assetId` 为准，且服务端重新检查状态、领用人和待处理申请。旧台账中状态为“未使用”“空闲”“闲置”，领用人为空或未绑定员工的占位值“未使用”“闲置”时可申请。真实领用人或已绑定员工 ID 时不可重复领用。提交成功仅创建待审批申请；批准时再次核验，才更新领用人、使用中状态及北京时间当天的领用日期。

归还与转让必须从当前员工的“我的资产”选择资产。转让由接收员工确认后再由管理员审批；归还由管理员验收。IT小爱页面可把“我的设备”和“资产登记”分开，但都调用同一套身份鉴权。

错误响应为 `{ "error": "原因" }`。`lookup` 的 `claimBlockedReason` 可直接用于解释已有领用人、待处理申请或状态不允许等情况。只有资盒管理员能维护台账；资盒本地操作不会反向投递给 IT小爱。

接口调用应以本页和当前服务代码为准。联调时先使用无真实人员信息的测试资产验证完整申请与审批流程。
