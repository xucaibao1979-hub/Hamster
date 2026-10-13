# 旧台账领用人状态一次性修正

工具 `deploy/repair-holder-status.mjs` 只在人工执行时运行。领用人非空、且不是“已报废”“未使用”“闲置”的记录，若设备状态不是“使用中”，会改为“使用中”；其余记录不动。它不会清空领用人，也不会自行填写领用日期。若待修正资产存在未处理申请，工具会拒绝执行。

在维护窗口中先备份、预览，再执行：

```bash
cd /opt/asset-hub
docker compose -p asset-hub run --rm --no-deps assets node deploy/repair-holder-status.mjs
docker compose -p asset-hub stop assets
docker compose -p asset-hub run --rm --no-deps assets node deploy/repair-holder-status.mjs --apply
docker compose -p asset-hub up -d assets
```

工具会在数据卷 `/data/manual-backups/` 生成完整 SQLite 快照，逐条写入资产历史。再次预览的 `changeCount` 应为 0。生产环境修改数量取决于生产数据库，不能用本地预览库的数量代替。
