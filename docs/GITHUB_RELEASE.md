# GitHub 源码发布与版本归档

## 发布内容

使用项目自带的 `node scripts/package-clean.mjs` 生成干净源码目录与 `.tar.gz` 压缩包。脚本仅复制列出的源码、构建配置、测试、示例环境变量和文档；不复制数据库、备份、`.env`、构建缓存、`outputs`、`node_modules` 或本地工具状态。发布包需再次检查文件清单，确认没有公司资产、员工信息、真实域名、口令或服务凭证。

在决定仓库可见性前，确认公司对源码以及 `public/` 图片的发布授权。本包未附加开源许可证；如需真正开源，请由权利人选择许可证。没有许可证不代表允许其他人复制或改造项目。建议在授权未明确前先建立**私有仓库**。

## 生成与检查

```bash
node scripts/package-clean.mjs
```

脚本打印输出目录、归档文件与 SHA-256。进入输出的源码目录，执行 `git status` 前先确认 `.gitignore`，并检视 `deploy/env.example` 仅包含空白示例值。可搜索 `*.sqlite`、`.env`、真实 Token 和个人信息；如果发现任何一项，先修正再发布。**不要从原工作目录直接执行 `git add .`。**

## 推送到新仓库

先在 GitHub 创建一个**空的私有仓库**，不要预先生成 README、许可证或 `.gitignore`。在脚本生成的干净源码目录执行，替换真实仓库地址：

```bash
git init -b main
git add .
git status --short
git commit -m "Initial clean source release"
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

GitHub 官方的[导入本地代码说明](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)介绍了仓库创建和推送。上传前复查暂存文件；凭证一旦进入 Git 历史，仅加入 `.gitignore` 不会将其从历史中删除。

## 打标签与后续更新

验证服务器与测试后，用版本号记录同一份源码，例如：

```bash
git tag -a v2026.10.13 -m "Asset Hub release"
git push origin v2026.10.13
```

将压缩包的 SHA-256、变更说明、升级步骤和验收结果写入 GitHub Release。之后继续在干净源码仓库维护代码与文档；数据库、业务备份和 `.env` 始终留在私有运维存储中。服务器升级说明见 [运维手册](OPERATIONS.md)。
