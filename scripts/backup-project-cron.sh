#!/usr/bin/env bash
set -Eeuo pipefail

export PATH=/usr/sbin:/usr/bin:/sbin:/bin
PROJECT_DIR=${PROJECT_DIR:-/opt/asset-hub}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/asset-hub/project}
RETENTION_DAYS=${RETENTION_DAYS:-30}

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 )); then
  echo 'RETENTION_DAYS 必须是正整数' >&2
  exit 2
fi

cd "$PROJECT_DIR"
PROJECT_DIR=$(pwd -P)
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_DIR=$(cd "$BACKUP_DIR" && pwd -P)
if [[ "$BACKUP_DIR" == "$PROJECT_DIR" || "$BACKUP_DIR" == "$PROJECT_DIR"/* ]]; then
  echo '备份目录必须位于项目目录之外' >&2
  exit 2
fi

exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo '上一次项目备份仍在运行' >&2; exit 1; }

umask 077
filename="asset-hub-project-$(date -u +%Y-%m-%dT%H-%M-%SZ).tar.gz"
temporary="$BACKUP_DIR/$filename.tmp"
target="$BACKUP_DIR/$filename"
trap 'rm -f -- "$temporary"' EXIT

# .env 包含部署凭证，因此归档和目录都仅允许管理员读取。
# 数据库另由 backup-database-cron.sh 备份；跳过依赖、构建产物和历史发布包。
tar -czf "$temporary" -C "$PROJECT_DIR" \
  --exclude='./.git' --exclude='./node_modules' --exclude='./outputs' \
  --exclude='./internal-dist' --exclude='./dist' --exclude='./data' \
  --exclude='./backups' --exclude='./.next' --exclude='./.wrangler' \
  --exclude='./.pnpm-store' --exclude='./.codex' --exclude='./.agents' \
  --exclude='./.openai' --exclude='./.sites-runtime' --exclude='./work' .
tar -tzf "$temporary" >/dev/null
mv -- "$temporary" "$target"
chmod 600 "$target"
trap - EXIT
echo "项目备份完成：$target"

find "$BACKUP_DIR" -maxdepth 1 -type f \
  -regextype posix-extended \
  -regex '.*/asset-hub-project-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z\.tar\.gz' \
  -mmin +"$((RETENTION_DAYS * 24 * 60))" -delete
