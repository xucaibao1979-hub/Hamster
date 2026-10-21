# Ubuntu 22.04 / Docker Compose 部署

适用环境：Docker Engine、Docker Compose **V2**、可访问容器镜像与 npm 包源的构建机。`docker-compose` V1 在较新 Docker 上可能出现 `KeyError: 'ContainerConfig'`；所有命令使用带空格的 `docker compose`。

## 首次部署

将干净源码包解压到固定目录，例如 `/opt/asset-hub`。保持 Compose 项目名不变，避免连接到另一个空数据卷。

```bash
cd /opt/asset-hub
docker compose version
cp deploy/env.example .env
chmod 600 .env
```

编辑 `.env`：

```dotenv
ADMIN_PASSWORD=填写至少12位的新密码
ADMIN_EMAIL=admin@company.local
ASSET_PORT=3000
APP_ORIGIN=https://你的资产系统域名
COOKIE_SECURE=true
IT_SERVICE_TOKEN=
IT_SYNC_URL=
IT_SYNC_TOKEN=
```

`APP_ORIGIN` 必须与浏览器实际使用的协议、域名和端口完全一致，不包含路径和末尾斜杠；HTTP 测试时将 `COOKIE_SECURE=false`。`IT_SERVICE_TOKEN` 为可选的至少 32 位随机字符串，配置后才能调用 IT小爱接口；只保存在双方后端。不要把服务凭证放进浏览器代码或 Git 仓库。

IT小爱网页免登要求 `APP_ORIGIN` 为正式 HTTPS 域名，例如 `https://zchub.saybot.net`。资盒的 `POST /api/sso/ticket` 与现有集成接口共用 `IT_SERVICE_TOKEN`；员工须先同步企业微信 UserID。换票和浏览器兑换方式见 [IT小爱接入说明](INTEGRATION.md)。发布后请分别用手机、电脑企业微信验证跳转；反向代理访问日志应避免记录 `/sso/consume` 的查询参数。

```bash
docker compose -p asset-hub up -d --build assets
docker compose -p asset-hub ps
docker compose -p asset-hub logs --tail=80 assets
```

首次初始化的账号是 `admin`，密码为首次启动时的 `ADMIN_PASSWORD`。数据库位于命名卷的 `/data/assets.sqlite`，不是项目源码目录。运行中的服务可从 `http://服务器IP:3000` 或配置的 HTTPS 域名访问。

## 网络与 HTTPS

正式部署应通过可信 HTTPS 反向代理，并限制后台端口和服务凭证的访问范围。反向代理应保留原始 `Host`，并转发到容器映射端口。只有确认 HTTPS 可用后才设置 `COOKIE_SECURE=true`。若浏览器提示“请求来源无效”，核对 `.env` 的 `APP_ORIGIN` 与实际打开的网址。

## 上线检查

- `docker compose -p asset-hub ps` 显示 `assets` 持续运行且健康。
- 管理员能登录；台账、字典、备份和资产数量符合预期。
- IT小爱使用已验证企业微信身份请求 `/api/integration/identity`、`/api/integration/me`、`/api/integration/lookup`；领用提交后出现待审批申请，管理员批准后才更新资产。
- 确认 `asset-hub_asset-data` 数据卷和 `.env` 已纳入私有备份计划。

升级、回退及备份请继续阅读 [运维手册](OPERATIONS.md)。其中提供项目和数据库的 crontab 脚本，备份默认存放在项目目录外的 `/var/backups/asset-hub/`，各保留 30 天。
