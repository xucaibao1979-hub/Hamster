#!/usr/bin/env bash
set -Eeuo pipefail

export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
PROJECT_DIR=${PROJECT_DIR:-/opt/asset-hub}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/asset-hub/database}
RETENTION_DAYS=${RETENTION_DAYS:-30}

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 )); then
  echo 'RETENTION_DAYS 必须是正整数' >&2
  exit 2
fi

cd "$PROJECT_DIR"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_DIR=$(cd "$BACKUP_DIR" && pwd -P)
PROJECT_DIR=$(pwd -P)
if [[ "$BACKUP_DIR" == "$PROJECT_DIR" || "$BACKUP_DIR" == "$PROJECT_DIR"/* ]]; then
  echo '备份目录必须位于项目目录之外' >&2
  exit 2
fi

# 同一服务器上的定时任务不可重叠执行。
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo '上一次数据库备份仍在运行' >&2; exit 1; }
echo "$(date -Is) 开始数据库备份"

docker compose -p asset-hub run --rm --no-deps --user root \
  -v "$BACKUP_DIR:/backup" --entrypoint node assets \
  deploy/backup-database.mjs /backup
echo "$(date -Is) 数据库备份完成"

# 只有新快照生成并验证成功后才清理过期文件；仅匹配本脚本生成的 SQLite 文件。
find "$BACKUP_DIR" -maxdepth 1 -type f \
  -regextype posix-extended \
  -regex '.*/(asset-hub-database-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z(-[0-9]+)?|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z-[0-9a-f-]{36})\.sqlite' \
  -mmin +"$((RETENTION_DAYS * 24 * 60))" -delete

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name '*.sqlite.tmp-shm' -o -name '*.sqlite.tmp-wal' \) -delete
