# GitHub 仓库与版本说明文案

以下文案可复制到 GitHub 的仓库简介与 Release 页面。发布前确认公司允许公开源码和 `public/` 图片；不确定时将仓库设为私有。

## 仓库简介

> 资盒：面向公司内网的资产台账与流转管理系统。支持资产分类、CSV 导入导出、盘点、审批、生命周期历史、备份恢复，以及基于企业微信身份的 IT小爱接口。Node.js + SQLite，支持 Docker Compose 部署。

建议仓库名：`asset-hub`。建议主题：`asset-management`、`inventory`、`sqlite`、`docker-compose`、`wecom`。这些只是仓库检索标签，不影响系统功能。

## Release 标题

`资盒 v2026.10.13 · 首次整理的干净源码包`

## Release 正文

> 本版本提供资盒资产管理系统的干净源码及 Ubuntu 22.04 / Docker Compose 部署资料。源码包不包含公司资产记录、员工资料、SQLite 数据库、业务备份、环境变量或服务凭证。
>
> 功能包括仪表盘、资产台账、分类与字段字典、CSV 导入预检查、盘点任务、资产流转与审批、生命周期历史、管理员设置、自动备份与恢复，以及 IT小爱服务接口。旧台账中的“空闲／未使用／闲置”状态与领用人占位值兼容领用申请；申请需管理员批准才更新资产。
>
> 部署前复制 `deploy/env.example` 为 `.env`，设置强管理员密码和正确的 `APP_ORIGIN`。使用 Docker Compose V2，固定项目名与数据卷。具体步骤见 `docs/DEPLOYMENT.md`，升级与备份见 `docs/OPERATIONS.md`，IT小爱接入见 `docs/INTEGRATION.md`。
>
> 已通过构建、类型检查、权限与业务集成测试。正式上线仍须在目标 Ubuntu 服务器完成镜像构建、备份恢复演练和业务验收。发布时填写本次归档的 SHA-256，便于验证文件完整性。

发布附件可使用 `asset-hub-source-*.tar.gz` 或 `.zip`；两者内容相同。不要将生产数据卷或 `.env` 附加到 Release。
