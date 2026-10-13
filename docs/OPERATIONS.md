# 运行维护、备份与回退

以下命令以 `/opt/asset-hub` 和固定 Compose 项目名 `asset-hub` 为例。使用 Docker Compose V2 的 `docker compose`，服务名是 `assets`。

## 日常检查

```bash
cd /opt/asset-hub
docker compose -p asset-hub ps
docker compose -p asset-hub logs --tail=100 assets
docker volume ls --filter name=asset-hub_asset-data
```

容器内数据在 `/data`；数据库是 `/data/assets.sqlite`，自动业务备份在 `/data/automatic-backups/`，状态批量修正的快照在 `/data/manual-backups/`。服务不需要额外的 MySQL 或 Redis。保持数据卷、项目名及 `.env` 与原部署一致。

## 升级

1. 记录当前源码包、镜像和资产条数，安排维护窗口。
2. 按下节备份完整数据卷和 `.env`，确认备份非空。
3. 将新源码包解压到同一个项目目录，**不要覆盖 `.env`**。
4. 构建、启动并验收：

```bash
docker compose -p asset-hub up -d --build assets
docker compose -p asset-hub ps
docker compose -p asset-hub logs --tail=100 assets
```

核对登录、台账数量、资产详情、字典、备份和 IT小爱查询/申请/审批。`docker-compose` 1.29.x 与较新 Docker 可能在重建时出现 `ContainerConfig` 错误，请使用 `docker compose` V2。如果旧版 Compose 留下已退出的冲突容器，先用 `docker ps -a` 核对目标容器，再仅对那一个已退出容器执行 `docker rm 容器ID`；不加 `-v`，不删除数据卷。

## 备份

业务 JSON 备份可在系统“数据备份”页面下载和验证，适合业务数据迁移，但**不包含账号密码、服务凭证等完整配置**。灾难恢复须保留完整 SQLite 数据卷和单独保存的 `.env`。

在服务器上执行完整数据卷备份：

```bash
cd /opt/asset-hub
mkdir -p backups
chmod 700 backups
docker compose -p asset-hub stop assets
docker compose -p asset-hub run --rm --no-deps --user root --entrypoint sh -v "$PWD/backups:/backup" assets -c 'tar -czf /backup/asset-data-full.tar.gz -C /data .'
docker compose -p asset-hub start assets
test -s backups/asset-data-full.tar.gz
chmod 600 backups/asset-data-full.tar.gz
```

将备份文件、对应源码版本和 `.env` 分开安全存放，并在隔离环境定期验证恢复。不要把备份、员工资料、`.env` 或数据库提交到 GitHub。

## 回退与恢复

代码回退需使用升级前源码和匹配的数据卷快照；只换回旧代码不能保证兼容已经升级的数据库。在隔离环境先验证快照，再对生产数据卷操作。完整数据卷恢复会覆盖当前业务及账号资料，必须先停止服务并另存当前数据。

如需对旧台账执行“有真实领用人则改为使用中”的一次性修正，参考 [状态批量修正](HOLDER_STATUS_REPAIR.md)。该修正有预览与 SQLite 快照，不在每次启动时自动运行。

**不要执行** `docker compose down -v`，也不要删除 `asset-hub_asset-data` 卷。
