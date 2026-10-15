# 小仓鼠资产管理平台

每件资产，都有自己的位置。

小仓鼠资产管理平台是可部署在公司内网的资产台账，提供资产登记、查询、盘点、流转审批、审计与备份。管理员在网页维护数据；IT小爱可通过服务接口，让已验证的企业微信员工查看本人资产、申请领用、归还和转让。服务使用 Node.js 24 和 SQLite，Docker Compose 部署不需要单独安装数据库。

## 主要功能

- 资产概览：数量、状态、原值与分类趋势；统计口径可配置。
- 资产台账：固定资产、易耗品、软件资产；按编号、序列号、归属、分类、类型、状态、领用人和领用日期筛选；自定义展示列、字段和顺序。自定义字段支持文本、数字、日期和单选校验。
- 字典与导入导出：分类、归属、类型和状态可维护；CSV 导入前检查重复编号、日期、字典和领用人，支持导出。
- 流转与盘点：领用、归还、转让、管理员审批；最近本地审批可受限撤销；资产盘点任务按编号或序列号确认，保留操作及资产生命周期历史。
- 管理与保护：管理员账号、密码、操作日志、资产照片及凭证附件、每日自动备份、备份验证和恢复；仪表盘提醒长期闲置与领用资产。
- IT小爱接入：服务凭证与企业微信 UserID 鉴权，按本人身份查询，领用申请幂等处理；真实的企业微信登录和消息通知由 IT小爱负责。

<img width="1915" height="1013" alt="image" src="https://github.com/user-attachments/assets/53d0d6e4-6450-40ec-949e-7f5c47cc6402" /><img width="1883" height="635" alt="image" src="https://github.com/user-attachments/assets/df3f41f1-e688-4233-8b15-219b2ec8238b" />
<img width="1879" height="797" alt="image" src="https://github.com/user-attachments/assets/97a49ecd-f1b5-42d6-94fa-296fcecea05f" />


详见 [功能说明](docs/FEATURES.md) 和 [IT小爱接口说明](docs/INTEGRATION.md)。

## 快速部署

1. 安装 Docker Engine 和 **Docker Compose V2**，确认 `docker compose version` 可用。不要使用旧的 `docker-compose` V1。
2. 复制 `deploy/env.example` 为 `.env`，设置不少于 12 位的 `ADMIN_PASSWORD` 和实际浏览器来源 `APP_ORIGIN`。不要提交 `.env`。
3. 在项目目录执行：

```bash
docker compose -p asset-hub up -d --build assets
docker compose -p asset-hub ps
docker compose -p asset-hub logs --tail=80 assets
```

默认通过服务器 3000 端口访问；数据保存在 Compose 命名卷中的 `/data/assets.sqlite`。新数据库的管理员账号为 `admin`，密码取首次启动时的 `ADMIN_PASSWORD`。已经初始化的数据库不会因修改 `.env` 中的密码而重置账号密码。

完整步骤见 [Ubuntu/Docker 部署](docs/DEPLOYMENT.md)，升级、备份和回退见 [运维手册](docs/OPERATIONS.md)。

服务器定时备份可通过 crontab 分别将数据库快照和部署项目归档保存到项目目录外的 `/var/backups/asset-hub/database` 与 `/var/backups/asset-hub/project`，默认保留 30 天。项目归档含 `.env`，仅用于受控运维存储；干净源码发布包不含 `.env` 和业务数据。

## 本地开发与验证

安装 Node.js 24 和 pnpm 11.25.0 后：

```bash
pnpm install --frozen-lockfile
node deploy/build.mjs
node tests/assets.test.mjs
node tests/access.test.mjs
node tests/upgrade.test.mjs
node tests/holder-status-repair.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

测试使用临时数据库。正式运行入口是 `deploy/server.mjs`，前端打包入口是 `deploy/build.mjs`；早期框架文件保留在源码中供构建使用，不代表另一个生产服务。

## 数据与发布

公开源码包不含 `.env`、SQLite 数据、备份、日志、员工资料、服务凭证或本地构建缓存。使用前自行配置管理员密码、服务凭证和网络访问控制。发布与归档方法见 [GitHub 发布指南](docs/GITHUB_RELEASE.md)。

本项目未附加开源许可证。上传 GitHub 时先确认公司对源码和图片素材的公开授权；未获得授权时使用私有仓库。

完整 SQLite 数据库会按日生成可验证快照，支持管理员下载；停机恢复步骤见 [运维手册](docs/OPERATIONS.md)。数据库快照与原库同处一个 Docker 数据卷，应另存到服务器之外。
