# 运行维护、备份与回退

以下命令以 `/opt/asset-hub` 和固定 Compose 项目名 `asset-hub` 为例。使用 Docker Compose V2 的 `docker compose`，服务名是 `assets`。

## 日常检查

```bash
cd /opt/asset-hub
docker compose -p asset-hub ps
docker compose -p asset-hub logs --tail=100 assets
docker volume ls --filter name=asset-hub_asset-data
```

容器内数据在 `/data`；数据库是 `/data/assets.sqlite`，自动业务 JSON 备份在 `/data/automatic-backups/`，完整 SQLite 快照在 `/data/database-backups/`，状态批量修正的快照在 `/data/manual-backups/`。服务不需要额外的 MySQL 或 Redis。保持数据卷、项目名及 `.env` 与原部署一致。

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

系统启动时和此后每小时检查一次，每个 UTC 日期自动生成一份完整 SQLite 快照，并执行数据库完整性检查；管理员也可在“设置 → 数据备份 → 完整数据库备份”立即创建、验证和下载。快照包含资产、账号、密码哈希、员工关联、附件及业务历史；`.env` 中的服务凭证仍需单独备份。项目自动生成的业务 JSON 和完整 SQLite 快照都只保留最近 30 天：成功创建新备份后清理过期文件，已有当天备份时也会执行清理；`manual-backups` 中的一次性修正快照不受此规则影响。快照与数据库位于同一 Docker 数据卷，**务必定期下载到服务器之外**。

### Ubuntu 服务器 crontab 自动备份数据库

下列脚本通过 SQLite 在线备份 API，从运行中的数据库生成一致快照，校验后写入**项目目录外**的宿主机目录 `/var/backups/asset-hub/database`；不需要停止服务。另一个脚本把部署项目（含 `.env`，但排除数据库、依赖和历史发布包）归档到 `/var/backups/asset-hub/project`。两类备份目录仅允许管理员读取，且必须有足够空间。先部署含 `deploy/backup-database.mjs` 的镜像，然后在服务器执行：

```bash
cd /opt/asset-hub
docker compose -p asset-hub build assets
chmod +x scripts/backup-database-cron.sh scripts/backup-project-cron.sh
sudo bash scripts/backup-database-cron.sh
sudo bash scripts/backup-project-cron.sh
sudo ls -lh /var/backups/asset-hub/database/*.sqlite
sudo ls -lh /var/backups/asset-hub/project/*.tar.gz
```

确认两项手动备份都成功后，为 root 安装每日凌晨 02:30 和 02:45 的 crontab（服务器本地时区）：

```bash
sudo crontab -e
```

加入下面一行，保存退出：

```cron
30 2 * * * /opt/asset-hub/scripts/backup-database-cron.sh >> /var/log/asset-hub-db-backup.log 2>&1
45 2 * * * /opt/asset-hub/scripts/backup-project-cron.sh >> /var/log/asset-hub-project-backup.log 2>&1
```

两个脚本默认只保留 30 天；可在 crontab 命令前设置 `RETENTION_DAYS=90`。成功生成并验证新备份后才清理超过保留期的旧文件。检查最近结果：

```bash
sudo tail -n 30 /var/log/asset-hub-db-backup.log
sudo tail -n 30 /var/log/asset-hub-project-backup.log
sudo find /var/backups/asset-hub/database -maxdepth 1 -name '*.sqlite' -printf '%TY-%Tm-%Td %s %f\n' | sort -r | head
sudo find /var/backups/asset-hub/project -maxdepth 1 -name '*.tar.gz' -printf '%TY-%Tm-%Td %s %f\n' | sort -r | head
```

这两个目录虽在项目之外，仍在同一台服务器，建议再同步到异机或离线存储。项目归档包含 `.env` 凭证，复制时保持访问控制；不要将它、数据库快照或日志上传 GitHub。

要从服务器上的完整快照恢复，先核对文件名和资产数量，并安排停机。以下命令会在替换前自动保留一份当前数据库快照；将 `备份文件名.sqlite` 换成实际文件名：

```bash
cd /opt/asset-hub
docker compose -p asset-hub stop assets
docker compose -p asset-hub run --rm --no-deps --user root --entrypoint node assets \
  deploy/restore-database.mjs /data/database-backups/备份文件名.sqlite --confirm=RESTORE
docker compose -p asset-hub start assets
docker compose -p asset-hub ps
docker compose -p asset-hub logs --tail=100 assets
```

仅在资产服务已经停止时执行恢复；恢复的是**整个数据库**，当前账号、资产和操作记录都会回到快照时点。恢复脚本验证快照完整性、先保存当前数据库，并保持数据库文件权限。若恢复命令失败，不要继续写入数据，先检查输出及 `/data/database-backups/` 中的安全快照。恢复后核对管理员登录、台账资产数及 IT小爱身份查询。若源文件已下载到其他位置，可通过 `docker compose run -v /主机备份目录:/restore:ro` 挂入容器，并将脚本源路径改为 `/restore/文件名.sqlite`。

使用上述 crontab 生成的宿主机快照恢复时，把备份目录挂入临时容器（将文件名换成实际文件名）：

```bash
cd /opt/asset-hub
docker compose -p asset-hub stop assets
docker compose -p asset-hub run --rm --no-deps --user root \
  -v "/var/backups/asset-hub/database:/restore:ro" --entrypoint node assets \
  deploy/restore-database.mjs /restore/备份文件名.sqlite --confirm=RESTORE
docker compose -p asset-hub start assets
```

在服务器上执行完整数据卷备份：

```bash
cd /opt/asset-hub
sudo mkdir -p /var/backups/asset-hub/full-volume
sudo chmod 700 /var/backups/asset-hub/full-volume
docker compose -p asset-hub stop assets
docker compose -p asset-hub run --rm --no-deps --user root --entrypoint sh -v "/var/backups/asset-hub/full-volume:/backup" assets -c 'tar -czf /backup/asset-data-full.tar.gz -C /data .'
docker compose -p asset-hub start assets
sudo test -s /var/backups/asset-hub/full-volume/asset-data-full.tar.gz
sudo chmod 600 /var/backups/asset-hub/full-volume/asset-data-full.tar.gz
```

将备份文件、对应源码版本和 `.env` 分开安全存放，并在隔离环境定期验证恢复。不要把备份、员工资料、`.env` 或数据库提交到 GitHub。

## 回退与恢复

代码回退需使用升级前源码和匹配的数据卷快照；只换回旧代码不能保证兼容已经升级的数据库。在隔离环境先验证快照，再对生产数据卷操作。完整数据卷恢复会覆盖当前业务及账号资料，必须先停止服务并另存当前数据。

如需对旧台账执行“有真实领用人则改为使用中”的一次性修正，参考 [状态批量修正](HOLDER_STATUS_REPAIR.md)。该修正有预览与 SQLite 快照，不在每次启动时自动运行。

**不要执行** `docker compose down -v`，也不要删除 `asset-hub_asset-data` 卷。
